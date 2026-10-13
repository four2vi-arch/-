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
import docs
import export

HERE = os.path.dirname(os.path.abspath(__file__))
VERSION = '3.3 (2026-10-14)'
MAX_CHARS3 = 4000   # 문서 한 건에서 모델에 보내는 글자 상한
SKIP_DIRS = {'__pycache__', '.git', 'node_modules', '작업', '$RECYCLE.BIN', 'System Volume Information'}
SKIP_NAMES = r'^(인수인계서_\d{8}_\d{4}(_원본지문|_온나라)?\.(md|docx|csv|txt)|인수인계_초안\.md|결과\.(md|json)|세션\.json|초안_백업_.*\.json|초안_원본_최근\.json|모델응답_이어하기\.jsonl|정답표\.xlsx|돌다리 v.*\.pdf)$'   # 돌다리 자신의 산출물(화면 인쇄 PDF 포함)은 읽지 않는다
PROGRAM_FILES = ('server.py', 'core.py', 'extract.py', '돌다리_실행.bat', 'measure.py')
STATE = {'step': 1, 'folder': '', 'subdirs': [], 'exclude': [], 'warn': '', 'suggest': '', 'files': [], 'failures': [], 'fingerprints': [], 'plan': None, 'progress': None,
         'items': [], 'dropped': [], 'model': '', 'url': 'http://127.0.0.1:11434/v1/chat/completions', 'include_tables': False,
         'recent_years': 0, 'max_calls': 3, 'skip_reference': True, 'avg_sec': 22.0, 'running': False, 'stop': False, 'errors': [], 'calls': [], 'exports': [], 'title': '', 'log': [],
         'areas': core.DEFAULT_AREAS, 'overview': {}, 'handover_from': '', 'handover_to': '', 'assets': {}, 'keyfiles': [],
         'months': 12, 'model_scope': 'issues', 'witness': '', 'handover_date': '', 'org': '', 'info': {}, 'manual_path': ''}
_units = {}   # 파일 → units (메모리만; 세션.json에는 넣지 않는다)
CHECKPOINT = '모델응답_이어하기.jsonl'   # 모델 응답을 호출마다 바로 적어 두는 파일. 같은 폴더·모델이면 다음 「초안 만들기」가 재사용한다(죽어도 한 호출만 잃음)
_extracting = False
LOCK = threading.Lock()
WORK = ''


def log(msg):
    STATE['log'] = (STATE['log'] + ['%s %s' % (datetime.datetime.now().strftime('%H:%M:%S'), msg)])[-50:]
    print(msg, flush=True)


def save_session():
    keep = {k: v for k, v in STATE.items() if k not in ('running', 'stop', 'log', 'reloading', 'extracting', 'extract_error')}
    try:
        with open(os.path.join(WORK, '세션.json'), 'w', encoding='utf-8', errors='replace') as f:
            json.dump(keep, f, ensure_ascii=False, indent=1)
    except Exception as e:
        log('세션 저장 실패(화면은 계속 됨): %s' % str(e)[:120])


def _reload_units():
    """이전 세션의 폴더를 뒤에서 다시 읽어 발췌 확인·재실행에 쓸 글자를 채운다(원본은 읽기만). 끝날 때까지 ③은 기다리라고 답한다."""
    t0 = time.time(); folder = STATE['folder']
    try:
        files, _, _ = EX.extract_folder(folder, skip_dirs=SKIP_DIRS | set(STATE.get('exclude', [])), skip_names=SKIP_NAMES)
        if STATE['folder'] == folder:   # 되읽는 사이에 다른 폴더를 읽었으면 버린다
            mc = {}
            for f in files:
                _units[f['file'].replace('\\', '/')] = f['units']; mc[f['file'].replace('\\', '/')] = (f.get('mchars', f['chars']), f.get('mtime', ''))
            with LOCK:
                for f in STATE['files']:
                    if f['file'] in mc:
                        if not f.get('mchars'):
                            f['mchars'] = mc[f['file']][0]
                        if not f.get('mtime'):
                            f['mtime'] = mc[f['file']][1]
                STATE['plan'] = make_plan()   # 옛 세션은 모델에 보내는 길이를 몰라 호출 수가 적게 잡혔던 것을 바로잡는다
        log('이전 폴더 되읽기 끝: %d개, %.0f초' % (len(files), time.time() - t0))
    except Exception as e:
        log('이전 폴더 되읽기 실패(다시 「읽기」를 누르세요): %s' % e)
    finally:
        STATE['reloading'] = False


def load_session():
    p = os.path.join(WORK, '세션.json')
    if os.path.exists(p):
        try:
            with open(p, encoding='utf-8') as f:
                STATE.update(json.load(f))
            STATE['running'] = False; STATE['stop'] = False
            if STATE['files'] and STATE['folder'] and os.path.isdir(STATE['folder']):
                STATE['reloading'] = True
                threading.Thread(target=_reload_units, daemon=True).start()   # 화면은 바로 열고, 글자 되읽기는 뒤에서(큰 폴더는 몇 분 걸림)
            log('이전 작업을 이어서 엽니다: ' + STATE['folder'])
        except Exception as e:
            log('세션 파일을 읽지 못해 새로 시작합니다: %s' % e)


def year_of(f):
    m = re.search(r'(20\d{2})', f['file']) or re.search(r'(20\d{2})', '\n'.join(u['text'] for u in f['units'])[:400])
    return int(m.group(1)) if m else None


def backup_draft():
    """폴더를 다시 읽기 전에 지금 초안을 작업 폴더에 남긴다(실수로 지워지지 않게)."""
    if STATE['items'] or STATE['dropped']:
        name = '초안_백업_%s.json' % datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        with open(os.path.join(WORK, name), 'w', encoding='utf-8') as f:
            json.dump({'folder': STATE['folder'], 'model': STATE['model'], 'items': STATE['items'], 'dropped': STATE['dropped']}, f, ensure_ascii=False, indent=1)
        log('이전 초안 %d항목을 %s에 남기고 폴더를 다시 읽습니다' % (len(STATE['items']), name))


def do_extract(folder, exclude=None):
    t0 = time.time()
    backup_draft()
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
    def prog(p):
        STATE['extracting'] = dict(p, sec=round(time.time() - t0))
    STATE['extracting'] = {'index': 0, 'total': 0, 'file': '', 'sec': 0}
    files, failures, fps = EX.extract_folder(folder, skip_dirs=SKIP_DIRS | exclude, skip_names=SKIP_NAMES, skip_root_files=bool(warn), progress=prog)
    for f in files:
        f['file'] = f['file'].replace('\\', '/')
        _units[f['file']] = f['units']
    for x in failures + fps:
        x['file'] = x['file'].replace('\\', '/')
    with LOCK:
        STATE.update({'folder': folder, 'subdirs': subdirs, 'exclude': sorted(exclude), 'warn': warn, 'suggest': suggest, 'files': [{'file': f['file'], 'kind': f['kind'], 'chars': f['chars'], 'mchars': f.get('mchars', f['chars']), 'mtime': f.get('mtime', ''), 'year': year_of(f)} for f in files],
                      'failures': failures, 'fingerprints': fps, 'items': [], 'dropped': [], 'errors': [], 'calls': [], 'exports': [], 'step': 2, 'progress': None})
        fa = docs.folder_areas(files)   # 맨 위 폴더가 업무 이름이면 그것으로 업무를 나눈다(사용자가 키워드를 손본 뒤에는 그대로 둔다)
        if fa and STATE.get('areas_src') in (None, '', '기본', '폴더'):
            STATE['areas'] = fa; STATE['areas_src'] = '폴더'
            log('업무를 폴더 이름으로 나눕니다: %d개' % len(fa))
        STATE['plan'] = make_plan()
    log('추출 %.1f초: 읽음 %d · 못 읽음 %d · 원본 변경 %d' % (time.time() - t0, len(files), len(failures), sum(1 for x in fps if not x['unchanged'])))
    save_session()


def checkpoint_info():
    """이전 회차 모델 응답이 지금 폴더·모델에 맞게 남아 있으면 그 수(화면 ② 안내용)."""
    try:
        prev = core.load_checkpoint(os.path.join(WORK, CHECKPOINT), STATE['folder'], STATE['model'], MAX_CHARS3)
        return {'reusable': len(prev)}
    except Exception:
        return {'reusable': 0}


def _files_with_units():
    return [{'file': f['file'], 'kind': f['kind'], 'chars': f['chars'], 'mtime': f.get('mtime', ''), 'units': _units.get(f['file'], [])} for f in STATE['files']]


def make_plan():
    """문서 단위 계획(v3): 기간 안 문서·현안 후보·반복 업무·모델 호출 수. 글자가 아직 안 읽혔으면(되읽기 중) 이름·수정일만으로 센다."""
    return docs.plan_summary(_files_with_units(), STATE.get('areas') or core.DEFAULT_AREAS, int(STATE.get('months') or 12), STATE.get('model_scope') or 'issues', avg_sec=STATE['avg_sec'])


def run_draft():
    files = _files_with_units()
    t0 = time.time()

    def progress(p):
        with LOCK:
            STATE['progress'] = dict(p, sec=round(time.time() - t0))

    try:
        manual = None
        mp = str(STATE.get('manual_path') or '').strip().strip('"')
        if mp:   # 폴더 밖의 누적 매뉴얼을 직접 지정한 경우(「그 사이 문서만」 폴더로 돌릴 때)
            if os.path.isfile(mp):
                res, fl = [], []
                EX.extract_file(mp, os.path.basename(mp), res, fl)
                if res:
                    manual = dict(res[0], file=mp)
                    log('누적 매뉴얼 파일 지정: %s (%d자)' % (mp, manual.get('chars', 0)))
                else:
                    log('누적 매뉴얼 파일을 읽지 못했습니다: %s' % (fl[0]['reason'] if fl else mp))
            else:
                log('누적 매뉴얼 파일이 없습니다: ' + mp)
        items, calls, errors, info = docs.build_docs(files, STATE.get('areas') or core.DEFAULT_AREAS, int(STATE.get('months') or 12), STATE['model'] or 'none', STATE['url'], '',
                                                      STATE.get('model_scope') or 'issues', MAX_CHARS3, progress=progress, should_stop=lambda: STATE['stop'],
                                                      checkpoint=os.path.join(WORK, CHECKPOINT), folder=STATE['folder'], prev_items=STATE['items'], manual=manual)
        n_reused = sum(1 for c in calls if c.get('reused'))
        if n_reused:
            log('이전 회차의 모델 응답 %d회를 다시 부르지 않고 재사용' % n_reused)
        with LOCK:
            STATE['items'], STATE['dropped'], STATE['calls'], STATE['errors'], STATE['info'] = items, [], calls, errors, info
            STATE['progress'] = dict(STATE['progress'] or {}, index=len(items), total=len(items), calls_done=len(calls), calls_total=len(calls), sec=round(time.time() - t0), stopped=info.get('stopped', False))
            if calls:
                STATE['avg_sec'] = round(sum(c['sec'] for c in calls) / len(calls), 1)
            STATE['step'] = 4
        log('초안 %d건(현안 %d·반복 %d·문서 %d, 기간 밖 %d, 붙임 %d) · 매뉴얼 %s(문서번호 %d개) · 모델 호출 %d · 오류 %d · %.0f초' % (
            len(items), info['n_issue'], info['n_recur'], info['n_doc'], info['n_old'], info['n_attach'], info['manual'] or '없음', info['manual_refs'], len(calls), len(errors), time.time() - t0))
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
    """OS 폴더 고르기 창. 윈도는 PowerShell 창을 먼저, 안 되면 tkinter. 둘 다 안 되면 빈 문자열(화면의 폴더 목록으로 고른다)."""
    cmds = []
    if sys.platform.startswith('win'):
        ps = ('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; '   # 한글 경로가 깨지지 않게 UTF-8로 내보낸다
              'Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; '
              '$d.Description = "업무 폴더 고르기"; $d.ShowNewFolderButton = $false; '
              'if ($d.ShowDialog((New-Object System.Windows.Forms.Form -Property @{TopMost = $true})) -eq "OK") { Write-Output $d.SelectedPath }')
        cmds.append(['powershell', '-NoProfile', '-STA', '-Command', ps])
    code = 'import tkinter,tkinter.filedialog as d;r=tkinter.Tk();r.withdraw();r.attributes("-topmost",1);print(d.askdirectory(title="업무 폴더 고르기") or "")'
    cmds.append([sys.executable, '-c', code])
    env = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONUTF8='1')
    for cmd in cmds:
        try:
            out = subprocess.run(cmd, capture_output=True, timeout=300, env=env)
            raw = out.stdout or b''
            text = ''
            for enc in ('utf-8', 'cp949', 'mbcs' if sys.platform.startswith('win') else 'latin-1'):   # UTF-8이 아니면 윈도 한글 코드페이지로
                try:
                    text = raw.decode(enc).strip()
                    break
                except Exception:
                    continue
            if text and os.path.isdir(text):
                return text
            if text:
                log('폴더 창이 돌려준 경로를 찾지 못함: %r' % text[:80])
            if out.returncode != 0:
                log('폴더 창 실패(%s): %s' % (cmd[0], (out.stderr or b'').decode('utf-8', 'replace').strip()[:120]))
        except Exception as e:
            log('폴더 창 실패(%s): %s' % (cmd[0], str(e)[:120]))
    return ''


def list_dir(path):
    """화면 안 폴더 고르기용: 드라이브 목록(빈 경로) 또는 하위 폴더 목록. 숨김·시스템 폴더는 뺀다."""
    if not path:
        if sys.platform.startswith('win'):
            import string
            roots = [d + ':\\' for d in string.ascii_uppercase if os.path.exists(d + ':\\')]
        else:
            roots = ['/']
        home = os.path.expanduser('~')
        return {'path': '', 'parent': None, 'dirs': [{'name': r, 'path': r} for r in roots] + [{'name': '바탕 화면', 'path': os.path.join(home, 'Desktop')}, {'name': '문서', 'path': os.path.join(home, 'Documents')}, {'name': '내 폴더(%s)' % os.path.basename(home), 'path': home}], 'files': 0}
    path = os.path.abspath(path)
    if not os.path.isdir(path):
        return {'error': '폴더가 없습니다: ' + path}
    dirs, nfiles = [], 0
    try:
        for name in sorted(os.listdir(path), key=str.lower):
            full = os.path.join(path, name)
            if name.startswith('.') or name.startswith('$') or name in SKIP_DIRS:
                continue
            if os.path.isdir(full):
                dirs.append({'name': name, 'path': full})
            else:
                nfiles += 1
    except PermissionError:
        return {'error': '접근 권한이 없는 폴더입니다: ' + path}
    parent = os.path.dirname(path.rstrip('\\/'))
    return {'path': path, 'parent': parent if parent and parent != path else '', 'dirs': dirs, 'files': nfiles}


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
                st['checkpoint'] = checkpoint_info()
                st['extracting'] = STATE.get('extracting') if _extracting else None; st['extract_error'] = STATE.get('extract_error', '')
                st['areas_text'] = docs.areas_text(STATE.get('areas') or core.DEFAULT_AREAS)
                st['n_skip'] = sum(1 for x in STATE['failures'] if x.get('skip')); st['n_fail'] = len(STATE['failures']) - st['n_skip']
            return self._send(200, st)
        if p.path == '/api/items':
            with LOCK:
                return self._send(200, {'items': STATE['items'], 'dropped': STATE['dropped']})
        if p.path == '/api/onnara':   # 온나라 붙여넣기용 절별 평문(현재 상태로 바로 만든다)
            with LOCK:
                session = {'items': STATE['items'], 'areas': STATE.get('areas') or core.DEFAULT_AREAS, 'overview': STATE.get('overview') or {}, 'assets': STATE.get('assets') or {},
                           'info': STATE.get('info') or {}, 'months': STATE.get('months', 12), 'failures': STATE['failures'], 'handover_from': STATE.get('handover_from', ''),
                           'handover_to': STATE.get('handover_to', ''), 'witness': STATE.get('witness', ''), 'handover_date': STATE.get('handover_date', ''), 'org': STATE.get('org', '')}
            return self._send(200, {'sections': [{'name': n, 'text': t} for n, t in export.onnara_sections(session)]})
        if p.path == '/api/search':   # 물어보기(1안): 파일 이름·본문 검색. 모델 없이 즉시. 이 PC 안에서만.
            q = urllib.parse.parse_qs(p.query).get('q', [''])[0].strip().lower()
            if len(q) < 2:
                return self._send(200, {'hits': []})
            hits = []
            for f in STATE['files']:
                name = f['file']; units = _units.get(name, [])
                n_name = name.lower().count(q)
                lines = []
                for u in units:
                    for line in u['text'].split('\n'):
                        if q in line.lower():
                            lines.append(line.strip()[:140])
                            if len(lines) >= 3:
                                break
                    if len(lines) >= 3:
                        break
                n_body = sum(u['text'].lower().count(q) for u in units)
                if n_name or n_body:
                    hits.append({'file': name, 'name_hits': n_name, 'body_hits': n_body, 'lines': lines, 'kind': f['kind']})
            hits.sort(key=lambda h: (-h['name_hits'], -h['body_hits']))
            return self._send(200, {'hits': hits[:20], 'total': len(hits)})
        if p.path == '/api/ls':
            return self._send(200, list_dir(urllib.parse.parse_qs(p.query).get('path', [''])[0]))
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
            global _extracting
            folder = os.path.abspath(os.path.expanduser(str(body.get('folder', '')).strip().strip('"')))
            if not os.path.isdir(folder):
                return self._send(400, {'error': '폴더를 찾지 못했습니다: ' + folder})
            if STATE['running']:
                return self._send(409, {'error': '초안을 만드는 중입니다'})
            if _extracting:
                return self._send(409, {'error': '폴더를 읽는 중입니다. 끝날 때까지 기다리세요(큰 폴더는 몇 분).'})
            _extracting = True
            STATE['extracting'] = {'index': 0, 'total': 0, 'file': '', 'sec': 0}; STATE['extract_error'] = ''
            def run():   # 11분 넘는 읽기를 HTTP 요청 안에서 기다리지 않는다(브라우저가 끊어도 서버는 계속, 화면은 진행을 묻는다)
                global _extracting
                try:
                    do_extract(folder, [str(x) for x in body.get('exclude', [])])
                except Exception as e:
                    log('폴더 읽기 실패: %s' % str(e)[:160]); STATE['extract_error'] = '폴더를 읽다가 실패했습니다: ' + str(e)[:160]
                finally:
                    _extracting = False; STATE['extracting'] = None
            threading.Thread(target=run, daemon=True).start()
            return self._send(200, {'ok': True, 'started': True})
            return self._send(200, {'ok': True})
        if p == '/api/settings':
            with LOCK:
                for k in ('model', 'include_tables', 'recent_years', 'title', 'max_calls', 'skip_reference', 'overview', 'handover_from', 'handover_to', 'assets', 'keyfiles', 'months', 'model_scope', 'witness', 'handover_date', 'org', 'manual_path'):
                    if k in body:
                        STATE[k] = body[k]
                if 'areas_text' in body:
                    STATE['areas'] = docs.parse_areas(body['areas_text']) or core.DEFAULT_AREAS; STATE['areas_src'] = '사람' if body['areas_text'].strip() else '기본'
                    for it in STATE['items']:
                        if it.get('area_by') != '사람':
                            it['area'] = docs.area_of(it.get('title', ''), '', STATE['areas'], it.get('file', ''))
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
            if STATE.get('reloading'):
                return self._send(409, {'error': '이전 폴더의 글자를 아직 되읽는 중입니다(큰 폴더는 몇 분). 잠시 뒤 다시 누르거나, ①에서 폴더를 다시 「읽기」 하세요.'})
            if not STATE['files']:
                return self._send(400, {'error': '먼저 폴더를 읽어야 합니다'})
            with LOCK:
                STATE['running'] = True; STATE['stop'] = False; STATE['step'] = 3; STATE['progress'] = {'index': 0, 'total': (STATE['plan'] or {}).get('n_items', 0), 'calls_done': 0, 'calls_total': (STATE['plan'] or {}).get('calls', 0), 'sec': 0}
            threading.Thread(target=run_draft, daemon=True).start()
            return self._send(200, {'ok': True})
        if p == '/api/stop':
            STATE['stop'] = True
            return self._send(200, {'ok': True})
        if p == '/api/items':
            with LOCK:
                by_id = {it['id']: it for it in STATE['items']}
                for ch in body.get('changes', []):
                    it = by_id.get(ch.get('id'))
                    if not it:
                        continue
                    for k in ('keep', 'decided', 'status', 'next', 'note', 'seen', 'due_next', 'summary', 'when'):
                        if k in ch:
                            it[k] = ch[k]
                    for k in ('title', 'todo'):
                        if k in ch:
                            it[k] = str(ch[k]); it[k + '_by'] = '사람'
                    if 'area' in ch:
                        it['area'] = str(ch['area']); it['area_by'] = '사람'
                    if 'kind3' in ch and ch['kind3'] in ('현안', '반복', '문서', '연혁', '현황'):
                        it['kind3'] = ch['kind3']
                for b in body.get('bulk', []):          # 일괄: {'ids': [...], 'keep': true/false}
                    for i in b.get('ids', []):
                        it = by_id.get(i)
                        if it is not None:
                            it['keep'] = bool(b.get('keep')); it['decided'] = True
                for new in body.get('add', []):
                    nid = max([0] + [it['id'] for it in STATE['items']]) + 1
                    rec = {'id': nid, 'file': '', 'kind': '', 'cls': '직접 입력', 'date': str(new.get('date', '')).strip()[:10], 'docno': '', 'title': str(new.get('title', '')).strip()[:160],
                           'area': str(new.get('area') or '기타'), 'area_by': '사람', 'due': [], 'due_next': str(new.get('due_next', '')).strip()[:10], 'contacts': [], 'recur': None, 'attachments': [],
                           'kind3': new.get('kind3') if new.get('kind3') in ('현안', '반복', '문서', '연혁', '현황') else '현안', 'reflected': '', 'summary': '', 'todo': str(new.get('todo', '')).strip()[:160], 'todo_by': '사람',
                           'owner': '', 'model_status': '', 'src': '직접 입력', 'keep': True, 'decided': True, 'status': '진행', 'next': '', 'note': str(new.get('note', '')).strip(), 'seen': False, 'quote': '',
                           'when': str(new.get('when', '')).strip()[:40]}
                    STATE['items'].append(rec)
            save_session()
            return self._send(200, {'ok': True, 'items': STATE['items'], 'dropped': []})
        if p == '/api/export':
            if not STATE['items']:
                return self._send(400, {'error': '초안이 없습니다. ③ 초안 만들기를 먼저 하거나, 폴더를 다시 읽었다면 초안을 다시 만드세요(이전 초안은 작업 폴더의 초안_백업 파일에 있습니다)'})
            with LOCK:
                session = {'folder': STATE['folder'], 'files': STATE['files'], 'failures': STATE['failures'], 'fingerprints': STATE['fingerprints'],
                           'items': STATE['items'], 'model': STATE['model'] or '없음(규칙층만)', 'title': STATE['title'] or '전임자 확인 후 확정', 'version': VERSION,
                           'overview': STATE.get('overview') or {}, 'assets': STATE.get('assets') or {}, 'keyfiles': STATE.get('keyfiles') or [], 'areas': STATE.get('areas') or core.DEFAULT_AREAS,
                           'handover_from': STATE.get('handover_from', ''), 'handover_to': STATE.get('handover_to', ''), 'witness': STATE.get('witness', ''), 'handover_date': STATE.get('handover_date', ''),
                           'org': STATE.get('org', ''), 'months': STATE.get('months', 12), 'info': STATE.get('info') or {}}
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
    for stream in (sys.stdout, sys.stderr):   # 윈도 콘솔(cp949)에서 한글·특수문자 출력으로 죽지 않게
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass
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
