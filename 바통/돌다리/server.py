#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""돌다리 v1.0 · 로컬 웹 화면(2026-10-10). 127.0.0.1에만 열리고, 모델 호출도 127.0.0.1(Ollama 등)만 허용한다.

쓰임:  python server.py [--port 8765] [--work 작업폴더] [--no-browser]
흐름:  ① 업무 폴더 고르기 → ② 추출·부하 계획(모델에 보낼 파일·예상 시간) → ③ 초안 만들기(진행률, 중단 가능)
       → ④ 검토(지우기·고치기·현안 직접 적기·불확실 항목 복원) → ⑤ 내보내기(.md·.docx)
작업 상태는 작업폴더/세션.json에 남아 화면을 닫았다 열어도 이어진다. 원본 파일은 읽기만 한다.
"""
import os, sys, re, json, time, threading, argparse, webbrowser, datetime, subprocess, urllib.request, urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract as EX
import core
import export

HERE = os.path.dirname(os.path.abspath(__file__))
VERSION = '1.0 (2026-10-10.e)'
SKIP_DIRS = {'__pycache__', '.git', 'node_modules', '작업', '$RECYCLE.BIN', 'System Volume Information'}
SKIP_NAMES = r'^(인수인계서_\d{8}_\d{4}(_원본지문)?\.(md|docx|csv)|인수인계_초안\.md|결과\.(md|json)|세션\.json|정답표\.xlsx)$'   # 돌다리 자신의 산출물은 읽지 않는다
PROGRAM_FILES = ('server.py', 'core.py', 'extract.py', '돌다리_실행.bat', 'measure.py')
STATE = {'step': 1, 'folder': '', 'subdirs': [], 'exclude': [], 'warn': '', 'suggest': '', 'files': [], 'failures': [], 'fingerprints': [], 'plan': None, 'progress': None,
         'items': [], 'dropped': [], 'model': '', 'url': 'http://127.0.0.1:11434/v1/chat/completions', 'include_tables': False,
         'recent_years': 0, 'max_calls': 3, 'avg_sec': 22.0, 'running': False, 'stop': False, 'errors': [], 'calls': [], 'exports': [], 'title': '', 'log': []}
_units = {}   # 파일 → units (메모리만; 세션.json에는 넣지 않는다)
LOCK = threading.Lock()
WORK = ''


def log(msg):
    STATE['log'] = (STATE['log'] + ['%s %s' % (datetime.datetime.now().strftime('%H:%M:%S'), msg)])[-50:]
    print(msg, flush=True)


def save_session():
    keep = {k: v for k, v in STATE.items() if k not in ('running', 'stop', 'log')}
    with open(os.path.join(WORK, '세션.json'), 'w', encoding='utf-8') as f:
        json.dump(keep, f, ensure_ascii=False, indent=1)


def load_session():
    p = os.path.join(WORK, '세션.json')
    if os.path.exists(p):
        try:
            with open(p, encoding='utf-8') as f:
                STATE.update(json.load(f))
            STATE['running'] = False; STATE['stop'] = False
            if STATE['files'] and STATE['folder'] and os.path.isdir(STATE['folder']):
                files, _, _ = EX.extract_folder(STATE['folder'], skip_dirs=SKIP_DIRS | set(STATE.get('exclude', [])), skip_names=SKIP_NAMES)   # 발췌 확인·재실행을 위해 글자만 다시 읽는다(원본은 읽기만)
                for f in files:
                    _units[f['file'].replace('\\', '/')] = f['units']
            log('이전 작업을 이어서 엽니다: ' + STATE['folder'])
        except Exception as e:
            log('세션 파일을 읽지 못해 새로 시작합니다: %s' % e)


def year_of(f):
    m = re.search(r'(20\d{2})', f['file']) or re.search(r'(20\d{2})', '\n'.join(u['text'] for u in f['units'])[:400])
    return int(m.group(1)) if m else None


def do_extract(folder, exclude=None):
    t0 = time.time()
    exclude = set(exclude or [])
    subdirs = sorted(d for d in os.listdir(folder) if os.path.isdir(os.path.join(folder, d)) and d not in SKIP_DIRS and not d.startswith('.'))
    warn, suggest = '', ''
    if any(os.path.exists(os.path.join(folder, x)) for x in PROGRAM_FILES):
        # 프로그램 폴더를 골랐다: 결과·web 폴더는 기본으로 빼고, 업무 폴더로 보이는 하위 폴더가 하나면 바꾸기를 제안한다
        auto = {d for d in subdirs if d == 'web' or re.match(r'^(결과|실측결과|시험|도구|모의데이터_v1)', d)}
        exclude |= auto
        cand = [d for d in subdirs if d not in auto]
        if len(cand) == 1:
            suggest = os.path.join(folder, cand[0])
        warn = ('이 폴더에는 돌다리 프로그램 파일이 들어 있습니다. 업무 폴더는 보통 그 안의 하위 폴더입니다. '
                + ('「%s」 폴더로 바꾸는 것을 권합니다.' % cand[0] if suggest else '아래에서 뺄 폴더를 고르거나 폴더를 다시 지정하세요.'))
    files, failures, fps = EX.extract_folder(folder, skip_dirs=SKIP_DIRS | exclude, skip_names=SKIP_NAMES, skip_root_files=bool(warn))
    for f in files:
        f['file'] = f['file'].replace('\\', '/')
        _units[f['file']] = f['units']
    for x in failures + fps:
        x['file'] = x['file'].replace('\\', '/')
    with LOCK:
        STATE.update({'folder': folder, 'subdirs': subdirs, 'exclude': sorted(exclude), 'warn': warn, 'suggest': suggest, 'files': [{'file': f['file'], 'kind': f['kind'], 'chars': f['chars'], 'year': year_of(f)} for f in files],
                      'failures': failures, 'fingerprints': fps, 'items': [], 'dropped': [], 'errors': [], 'calls': [], 'exports': [], 'step': 2, 'progress': None})
        STATE['plan'] = make_plan()
    log('추출 %.1f초: 읽음 %d · 못 읽음 %d · 원본 변경 %d' % (time.time() - t0, len(files), len(failures), sum(1 for x in fps if not x['unchanged'])))
    save_session()


def make_plan():
    only = None
    if STATE['recent_years']:
        lim = datetime.date.today().year - STATE['recent_years']
        only = {f['file'] for f in STATE['files'] if f.get('year') is None or f['year'] >= lim}
    files = [dict(f, units=[]) for f in STATE['files']]
    return core.plan_load(files, include_tables=STATE['include_tables'], avg_sec=STATE['avg_sec'], only_files=only, max_calls_per_file=int(STATE.get('max_calls') or 3))


def run_draft():
    files = [{'file': f['file'], 'kind': f['kind'], 'chars': f['chars'], 'units': _units.get(f['file'], [])} for f in STATE['files']]
    plan = make_plan()
    only = {r['file'] for r in plan['rows'] if r['to_model']}
    t0 = time.time()

    def progress(p):
        with LOCK:
            STATE['progress'] = dict(p, sec=round(time.time() - t0))

    try:
        draft, dropped, calls, errors = core.build_draft(files, STATE['model'] or 'none', STATE['url'], '', 6000, include_tables=STATE['include_tables'],
                                                         only_files=only, progress=progress, should_stop=lambda: STATE['stop'], max_calls_per_file=int(STATE.get('max_calls') or 3))
        draft = core.merge_similar(draft)
        with LOCK:
            n = 0
            for d in draft:
                n += 1; d['id'] = n; d['keep'] = True; d['note'] = ''
            for d in dropped:
                n += 1; d['id'] = n; d['keep'] = False; d['note'] = ''
            STATE['items'], STATE['dropped'], STATE['calls'], STATE['errors'] = draft, dropped, calls, errors
            if calls:
                STATE['avg_sec'] = round(sum(c['sec'] for c in calls) / len(calls), 1)
            STATE['step'] = 4
        log('초안 %d항목(규칙 %d·모델 %d, 같은 내용 %d건 묶음), 불확실 %d, 오류 %d, %.0f초' % (len(draft), sum(1 for d in draft if d['src'] == '규칙'), sum(1 for d in draft if d['src'] != '규칙'), sum(len(d.get('also', [])) for d in draft), len(dropped), len(errors), time.time() - t0))
    except Exception as e:
        with LOCK:
            STATE['errors'] = [{'file': '', 'chunk': 0, 'reason': str(e)[:200]}]
            STATE['step'] = 2
        log('초안 만들기 실패: %s' % e)
    finally:
        with LOCK:
            STATE['running'] = False; STATE['stop'] = False
        save_session()


def ollama_models(url):
    base = urllib.parse.urlsplit(url)
    if not core.is_local_url(url):
        return []
    try:
        with urllib.request.urlopen('%s://%s/api/tags' % (base.scheme, base.netloc), timeout=3) as r:
            j = json.loads(r.read().decode('utf-8'))
        return [m['name'] for m in j.get('models', [])]
    except Exception:
        return []


def browse_folder():
    """윈도 폴더 고르기 창(tkinter)을 별도 프로세스로 띄운다. 안 되면 빈 문자열."""
    code = 'import tkinter,tkinter.filedialog as d;r=tkinter.Tk();r.withdraw();r.attributes("-topmost",1);print(d.askdirectory(title="업무 폴더 고르기") or "")'
    try:
        out = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True, timeout=300, encoding='utf-8')
        return out.stdout.strip()
    except Exception:
        return ''


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype='application/json; charset=utf-8', extra=None):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'")
        self.send_header('X-Frame-Options', 'DENY')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _ok_host(self):
        h = (self.headers.get('Host') or '').split(':')[0]
        return h in ('127.0.0.1', 'localhost')

    def do_GET(self):
        if not self._ok_host():
            return self._send(403, {'error': 'localhost만'})
        p = urllib.parse.urlsplit(self.path)
        if p.path in ('/', '/index.html'):
            with open(os.path.join(HERE, 'web', 'index.html'), 'rb') as f:
                return self._send(200, f.read(), 'text/html; charset=utf-8')
        if p.path == '/favicon.ico':
            return self._send(200, b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#1f5fbf"/><rect x="3" y="9" width="10" height="3" fill="#fff"/></svg>', 'image/svg+xml')
        if p.path == '/app.js':
            with open(os.path.join(HERE, 'web', 'app.js'), 'rb') as f:
                return self._send(200, f.read(), 'text/javascript; charset=utf-8')
        if p.path == '/api/state':
            with LOCK:
                st = {k: v for k, v in STATE.items() if k not in ('items', 'dropped', 'fingerprints')}
                st['n_items'] = len(STATE['items']); st['n_dropped'] = len(STATE['dropped'])
                st['originals_changed'] = sum(1 for x in STATE['fingerprints'] if not x.get('unchanged', True))
                st['work'] = WORK; st['version'] = VERSION
            return self._send(200, st)
        if p.path == '/api/items':
            with LOCK:
                return self._send(200, {'items': STATE['items'], 'dropped': STATE['dropped']})
        if p.path == '/api/models':
            return self._send(200, {'models': ollama_models(STATE['url'])})
        if p.path == '/api/download':
            name = urllib.parse.parse_qs(p.query).get('name', [''])[0]
            full = os.path.realpath(os.path.join(WORK, name))
            if not name or os.path.dirname(full) != os.path.realpath(WORK) or not os.path.exists(full):
                return self._send(404, {'error': '없음'})
            ctype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' if name.endswith('.docx') else 'text/markdown; charset=utf-8'
            with open(full, 'rb') as f:
                return self._send(200, f.read(), ctype, {'Content-Disposition': "attachment; filename*=UTF-8''" + urllib.parse.quote(name)})
        return self._send(404, {'error': '없는 주소'})

    def do_POST(self):
        if not self._ok_host():
            return self._send(403, {'error': 'localhost만'})
        n = int(self.headers.get('Content-Length') or 0)
        try:
            body = json.loads(self.rfile.read(n).decode('utf-8') or '{}')
        except Exception:
            body = {}
        p = urllib.parse.urlsplit(self.path).path
        if p == '/api/browse':
            return self._send(200, {'folder': browse_folder()})
        if p == '/api/extract':
            folder = os.path.abspath(os.path.expanduser(str(body.get('folder', '')).strip().strip('"')))
            if not os.path.isdir(folder):
                return self._send(400, {'error': '폴더를 찾지 못했습니다: ' + folder})
            if STATE['running']:
                return self._send(409, {'error': '초안을 만드는 중입니다'})
            do_extract(folder, [str(x) for x in body.get('exclude', [])])
            return self._send(200, {'ok': True})
        if p == '/api/settings':
            with LOCK:
                for k in ('model', 'include_tables', 'recent_years', 'title', 'max_calls'):
                    if k in body:
                        STATE[k] = body[k]
                if 'url' in body:
                    if not core.is_local_url(str(body['url'])):
                        return self._send(400, {'error': '모델 주소는 127.0.0.1 또는 localhost만 허용합니다'})
                    STATE['url'] = str(body['url'])
                if STATE['files']:
                    STATE['plan'] = make_plan()
            save_session()
            return self._send(200, {'ok': True, 'plan': STATE['plan']})
        if p == '/api/draft':
            if STATE['running']:
                return self._send(409, {'error': '이미 만드는 중'})
            if not STATE['files']:
                return self._send(400, {'error': '먼저 폴더를 읽어야 합니다'})
            with LOCK:
                STATE['running'] = True; STATE['stop'] = False; STATE['step'] = 3; STATE['progress'] = {'index': 0, 'total': len(STATE['files']), 'calls_done': 0, 'calls_total': STATE['plan']['calls'], 'sec': 0}
            threading.Thread(target=run_draft, daemon=True).start()
            return self._send(200, {'ok': True})
        if p == '/api/stop':
            STATE['stop'] = True
            return self._send(200, {'ok': True})
        if p == '/api/items':
            with LOCK:
                by_id = {it['id']: it for it in STATE['items'] + STATE['dropped']}
                for ch in body.get('changes', []):
                    it = by_id.get(ch.get('id'))
                    if not it:
                        continue
                    for k in ('keep', 'text', 'when', 'type', 'note'):
                        if k in ch:
                            it[k] = ch[k]
                    if it in STATE['dropped'] and it.get('keep'):
                        STATE['dropped'].remove(it); it['src'] = '모델(불확실→전임자 복원)'; STATE['items'].append(it)
                for new in body.get('add', []):
                    nid = max([0] + [it['id'] for it in STATE['items'] + STATE['dropped']]) + 1
                    STATE['items'].append({'id': nid, 'file': '', 'type': new.get('type') if new.get('type') in core.TYPES else '진행 중 현안',
                                           'text': str(new.get('text', '')).strip(), 'when': str(new.get('when', '')).strip(), 'quote': '', 'grounded': True,
                                           'src': '직접 입력', 'keep': True, 'note': str(new.get('note', '')).strip()})
            save_session()
            return self._send(200, {'ok': True, 'items': STATE['items'], 'dropped': STATE['dropped']})
        if p == '/api/export':
            with LOCK:
                session = {'folder': STATE['folder'], 'files': STATE['files'], 'failures': STATE['failures'], 'fingerprints': STATE['fingerprints'],
                           'items': STATE['items'], 'model': STATE['model'] or '없음(규칙층만)', 'title': STATE['title'] or '전임자 확인 후 확정', 'version': VERSION}
            stem = '인수인계서_' + datetime.datetime.now().strftime('%Y%m%d_%H%M')
            paths = export.write_all(session, WORK, stem)
            with open(os.path.join(WORK, stem + '_원본지문.csv'), 'w', encoding='utf-8-sig', newline='') as f:
                f.write('파일,바이트,처리 전 SHA-256,처리 후 SHA-256,변경 없음\n')
                for x in STATE['fingerprints']:
                    f.write('"%s",%d,%s,%s,%s\n' % (x['file'].replace('"', '""'), x['bytes'], x['sha256_before'], x['sha256_after'], '예' if x['unchanged'] else '아니오'))
            with LOCK:
                STATE['exports'] = [os.path.basename(x) for x in paths] + [stem + '_원본지문.csv']
                STATE['step'] = 5
            save_session()
            log('내보내기: ' + ', '.join(STATE['exports']))
            return self._send(200, {'ok': True, 'files': STATE['exports'], 'work': WORK})
        return self._send(404, {'error': '없는 주소'})


def main():
    global WORK
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--work', default=os.path.join(HERE, '작업'))
    ap.add_argument('--no-browser', action='store_true')
    a = ap.parse_args()
    WORK = os.path.abspath(a.work)
    os.makedirs(WORK, exist_ok=True)
    load_session()
    srv = ThreadingHTTPServer(('127.0.0.1', a.port), H)
    url = 'http://127.0.0.1:%d/' % a.port
    print('돌다리 v%s · %s (이 PC 안에서만 열립니다. 끝내려면 이 창을 닫거나 Ctrl+C)' % (VERSION, url), flush=True)
    print('작업 폴더: %s' % WORK, flush=True)
    if not a.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
