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


def _quickedit_off():
    """윈도 검은 창(conhost)의 「빠른 편집」을 끈다. 켜져 있으면 창을 한 번 클릭하는 것만으로 글자 출력이 멈추고,
    그 출력을 기다리는 동안 프로그램도 멈춘다(10.22. 검토). 이 창에만 적용되고 끝날 때 되돌린다. 윈도 터미널에서는 아무 일도 하지 않는다."""
    if os.name != 'nt':
        return
    try:
        import ctypes, atexit
        k = ctypes.windll.kernel32
        k.GetStdHandle.restype = ctypes.c_void_p
        h = ctypes.c_void_p(k.GetStdHandle(-10))   # STD_INPUT_HANDLE
        m = ctypes.c_uint32()
        if h.value and k.GetConsoleMode(h, ctypes.byref(m)):
            old = m.value
            if k.SetConsoleMode(h, (old & ~0x0040) | 0x0080):   # ENABLE_QUICK_EDIT_MODE 끔, ENABLE_EXTENDED_FLAGS 켬
                atexit.register(lambda: k.SetConsoleMode(h, old))
    except Exception:
        pass


if __name__ == '__main__':
    _quickedit_off()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract as EX
import core
import docs
import ocr
import export

HERE = os.path.dirname(os.path.abspath(__file__))
VERSION = '3.8 (2026-10-26)'
MAX_CHARS3 = 4000   # 문서 한 건에서 모델에 보내는 글자 상한
SKIP_DIRS = {'__pycache__', '.git', 'node_modules', '$RECYCLE.BIN', 'System Volume Information'}   # 돌다리 작업 폴더는 이름이 아니라 실제 경로(WORK)로 뺀다(업무 폴더 안 「작업」 폴더는 읽는다)
SKIP_NAMES = r'^(인수인계서_\d{8}_\d{4,6}(_\d+)?(_원본지문|_온나라)?\.(md|docx|csv|txt)|인수인계_초안\.md|결과\.(md|json)|세션\.json|초안_백업_.*\.json|초안_원본_최근\.json|모델응답_이어하기\.jsonl|정답표\.xlsx|돌다리 v.*\.pdf)$'   # 돌다리 자신의 산출물(화면 인쇄 PDF 포함)은 읽지 않는다
PROGRAM_FILES = ('server.py', 'core.py', 'extract.py', '돌다리_실행.bat', 'measure.py')
STATE = {'step': 1, 'folder': '', 'subdirs': [], 'exclude': [], 'warn': '', 'suggest': '', 'files': [], 'failures': [], 'fingerprints': [], 'plan': None, 'progress': None,
         'items': [], 'dropped': [], 'model': '', 'url': 'http://127.0.0.1:11434/v1/chat/completions', 'include_tables': False,
         'recent_years': 0, 'max_calls': 3, 'skip_reference': True, 'avg_sec': 40.0, 'running': False, 'stop': False, 'errors': [], 'calls': [], 'exports': [], 'title': '', 'log': [],
         'areas': core.DEFAULT_AREAS, 'overview': {}, 'handover_from': '', 'handover_to': '', 'assets': {}, 'keyfiles': [],
         'months': 12, 'model_scope': 'issues', 'witness': '', 'handover_date': '', 'org': '', 'info': {}, 'manual_path': '', 'ocr': 'auto', 'ocr_pages': 5, 'ocr_images': False, 'key': '', 'recent': []}
_ocr_status = None   # ocr.available() 결과(시작·설정 때만 다시 센다)
_units = {}   # 파일 → units (메모리만; 세션.json에는 넣지 않는다)
CHECKPOINT = '모델응답_이어하기.jsonl'   # 모델 응답을 호출마다 바로 적어 두는 파일. 같은 폴더·모델이면 다음 「초안 만들기」가 재사용한다(죽어도 한 호출만 잃음)
_extracting = False
LOCK = threading.Lock()
WORK = ''


def ocr_status(refresh=False):
    global _ocr_status
    if _ocr_status is None or refresh:
        try:
            _ocr_status = ocr.available()
        except Exception as e:
            _ocr_status = {'error': str(e)[:120]}
    return _ocr_status


def set_ocr_config():
    """읽기 전에 extract.OCR_CONFIG를 채운다. 엔진을 못 찾으면 OCR 없이 읽는다(스캔 PDF는 못 읽음으로 남는다)."""
    want = str(STATE.get('ocr') or 'off')
    eng = '' if want == 'off' else ocr.pick(want)
    EX.OCR_CONFIG.update({'engine': eng, 'cache': os.path.join(WORK, 'ocr_cache'), 'pages': int(STATE.get('ocr_pages') or 5), 'dpi': 200, 'images': bool(STATE.get('ocr_images'))})
    return eng


_LOGQ = None


def _log_printer(q):
    while True:
        m = q.get()
        try:
            print(m, flush=True)
        except Exception:
            pass


def log(msg):
    """화면 기록에 남기고 검은 창에 찍는다. 찍기는 따로 도는 스레드가 해서, 창 출력이 막혀도(선택 모드 등) 읽기·초안 작업과 화면 응답은 멈추지 않는다."""
    global _LOGQ
    STATE['log'] = (STATE['log'] + ['%s %s' % (datetime.datetime.now().strftime('%H:%M:%S'), msg)])[-50:]
    if _LOGQ is None:
        import queue
        _LOGQ = queue.SimpleQueue()
        threading.Thread(target=_log_printer, args=(_LOGQ,), daemon=True).start()
    _LOGQ.put(msg)


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
        set_ocr_config()
        files, _, _ = EX.extract_folder(folder, skip_dirs=SKIP_DIRS | set(STATE.get('exclude', [])), skip_names=SKIP_NAMES, skip_paths=[WORK])
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


def recheck_originals():
    """내보내기 때 원본을 다시 SHA-256으로 재어 지문표의 「처리 후」를 지금 값으로 바꾼다. 없어진 파일은 「없어짐」."""
    folder = STATE.get('folder') or ''
    for x in STATE['fingerprints']:
        p = EX.long_path(os.path.join(folder, *x['file'].split('/')))
        try:
            x['sha256_after'] = EX.sha256(p)
        except Exception:
            x['sha256_after'] = '없어짐'
        x['unchanged'] = x['sha256_after'] == x['sha256_before']


def check_modules():
    """읽기에 필요한 부품이 있는지(없으면 화면 맨 위에 알린다. 파일이 손상된 것처럼 보이지 않게)."""
    miss = []
    for mod, what in (('pypdf', 'PDF'), ('olefile', '한글(.hwp)'), ('openpyxl', '엑셀(.xlsx)')):
        try:
            __import__(mod)
        except Exception:
            miss.append({'module': mod, 'what': what})
    return miss


MISSING = check_modules()


def is_work(path):
    """돌다리 작업 폴더(결과·세션 저장 위치)인지: 이름이 아니라 실제 경로로 본다."""
    try:
        return bool(WORK) and os.path.normcase(os.path.realpath(path)) == os.path.normcase(os.path.realpath(WORK))
    except Exception:
        return False


def do_extract(folder, exclude=None):
    t0 = time.time()
    backup_draft()
    exclude = set(exclude or [])
    subdirs = sorted(d for d in os.listdir(folder) if os.path.isdir(os.path.join(folder, d)) and d not in SKIP_DIRS and not d.startswith('.') and not is_work(os.path.join(folder, d)))
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
    eng = set_ocr_config()
    log('OCR: %s' % (eng or '끔(엔진 없음 또는 설정 끔)'))
    files, failures, fps = EX.extract_folder(folder, skip_dirs=SKIP_DIRS | exclude, skip_names=SKIP_NAMES, skip_root_files=bool(warn), progress=prog, skip_paths=[WORK])
    n_ocr = 0
    for f in files:
        f['file'] = f['file'].replace('\\', '/')
        _units[f['file']] = f['units']
        if any('(OCR)' in u.get('loc', '') for u in f['units']):
            n_ocr += 1; f['ocr'] = True
    for x in failures + fps:
        x['file'] = x['file'].replace('\\', '/')
    with LOCK:
        if STATE.get('folder') and STATE.get('folder') != folder:
            STATE['areas_mode'] = ''   # 다른 폴더: 「키워드로 나누기」를 풀어 폴더 이름 나누기를 다시 본다
        STATE.update({'folder': folder, 'subdirs': subdirs, 'exclude': sorted(exclude), 'warn': warn, 'suggest': suggest, 'files': [{'file': f['file'], 'kind': f['kind'], 'chars': f['chars'], 'mchars': f.get('mchars', f['chars']), 'mtime': f.get('mtime', ''), 'year': year_of(f), 'ocr': bool(f.get('ocr'))} for f in files], 'n_ocr': n_ocr,
                      'failures': failures, 'fingerprints': fps, 'items': [], 'dropped': [], 'errors': [], 'calls': [], 'exports': [], 'step': 2, 'progress': None,
                      'prev_items': STATE['items'] or STATE.get('prev_items') or []})   # 넣기·버리기·메모·직접 적은 항목은 다시 만들 때 파일 기준으로 이어 간다
        if not files:
            STATE['extract_error'] = ('이 폴더(하위 폴더 포함)에서 읽을 수 있는 문서를 찾지 못했습니다.' + (' 못 읽은 파일 %d개의 사유는 4절 「확인하지 못한 자료」에 있습니다.' % len(failures) if failures else ' 폴더가 비어 있습니다.') + ' 업무 폴더를 다시 고르세요.')
        fa = docs.folder_areas(files)   # 맨 위 폴더가 업무 이름이면 그것으로 업무를 나눈다(사용자가 키워드를 손본 뒤에는 그대로 둔다)
        if fa and STATE.get('areas_src') in (None, '', '기본', '폴더') and STATE.get('areas_mode') != 'keyword':
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
    sha = {x['file']: x.get('sha256_before', '') for x in STATE.get('fingerprints') or []}   # 같은 파일 사본을 한 항목으로 묶는 데 쓴다
    return [{'file': f['file'], 'kind': f['kind'], 'chars': f['chars'], 'mtime': f.get('mtime', ''), 'units': _units.get(f['file'], []), 'sha': sha.get(f['file'], '')} for f in STATE['files']]


def _base():
    files = _files_with_units()
    return files, docs.base_date(files, STATE.get('handover_date') or '')


def make_plan():
    """문서 단위 계획(v3): 기간 안 문서·현안 후보·반복 업무·모델 호출 수. 글자가 아직 안 읽혔으면(되읽기 중) 이름·수정일만으로 센다."""
    files, (bd, why) = _base()
    p = docs.plan_summary(files, STATE.get('areas') or core.DEFAULT_AREAS, int(STATE.get('months') or 12), STATE.get('model_scope') or 'issues', avg_sec=STATE['avg_sec'], today=bd)
    p['base_why'] = why
    if why == '인계 일자':   # 인계 일자가 폴더의 마지막 문서보다 1년 넘게 뒤면 「최근 12개월」이 비어 버린다
        nd = docs.newest_doc_date(files)
        if nd and (bd - datetime.date.fromisoformat(nd)).days > 365:
            p['base_warn'] = '폴더의 가장 최근 문서가 %s라 인계 일자 기준 최근 %s개월 안에 든 문서가 적습니다. 인계 일자를 비우거나 기간(개월)을 늘리세요.' % (nd, STATE.get('months') or 12)
    return p


def run_draft():
    files, (bd, bwhy) = _base()
    t0 = time.time()
    fa = docs.folder_areas(files)
    if fa and STATE.get('areas_src') in (None, '', '기본', '폴더') and STATE.get('areas_mode') != 'keyword' and [a['name'] for a in fa] != [a['name'] for a in (STATE.get('areas') or [])]:
        with LOCK:
            STATE['areas'] = fa; STATE['areas_src'] = '폴더'
        log('업무를 폴더 이름으로 나눕니다: %d개' % len(fa))

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
        items, calls, errors, info = docs.build_docs(files, STATE.get('areas') or core.DEFAULT_AREAS, int(STATE.get('months') or 12), STATE['model'] or 'none', STATE['url'], str(STATE.get('key') or ''),
                                                      STATE.get('model_scope') or 'issues', MAX_CHARS3, progress=progress, should_stop=lambda: STATE['stop'],
                                                      checkpoint=os.path.join(WORK, CHECKPOINT), folder=STATE['folder'], prev_items=STATE['items'] or STATE.get('prev_items') or [], manual=manual, today=bd)
        info['base_why'] = bwhy
        n_reused = sum(1 for c in calls if c.get('reused'))
        if n_reused:
            log('이전 회차의 모델 응답 %d회를 다시 부르지 않고 재사용' % n_reused)
        with LOCK:
            STATE['items'], STATE['dropped'], STATE['calls'], STATE['errors'], STATE['info'] = items, [], calls, errors, info
            STATE['prev_items'] = []
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
    """모델 목록: Ollama(/api/tags)를 먼저, 아니면 OpenAI 호환 서버의 /v1/models(기관 모델 서버 등). 허용 목록 밖 주소는 빈 목록."""
    base = urllib.parse.urlsplit(url)
    if not core.is_local_url(url):
        return []
    root = '%s://%s' % (base.scheme, base.netloc)
    try:
        with NOPROXY.open(root + '/api/tags', timeout=3) as r:
            j = json.loads(r.read().decode('utf-8'))
        return [m['name'] for m in j.get('models', [])]
    except Exception:
        pass
    try:
        hd = {'Authorization': 'Bearer ' + str(STATE.get('key'))} if STATE.get('key') else {}
        with NOPROXY.open(urllib.request.Request(root + '/v1/models', headers=hd), timeout=3) as r:
            j = json.loads(r.read().decode('utf-8'))
        return [str(m.get('id') or m.get('name')) for m in (j.get('data') or j.get('models') or []) if isinstance(m, dict) and (m.get('id') or m.get('name'))]
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
            if name.startswith('.') or name.startswith('$') or name in SKIP_DIRS or is_work(full):
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
        try:
            return self._get()
        except Exception as e:   # 어떤 예외든 화면에 한글로(「Failed to fetch」 대신), 서버는 계속
            log('요청 처리 실패(%s): %s' % (self.path.split('?')[0], str(e)[:160]))
            return self._send(500, {'error': '처리 중 오류: %s' % str(e)[:200]})

    def _get(self):
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
        if p.path == '/api/ping':   # 두 번째 실행이 「켜져 있음」을 알아보는 작은 응답(state는 파일 목록이 들어 커질 수 있다)
            return self._send(200, {'app': 'doldari', 'version': VERSION, 'work': WORK})
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
                st['ocr_status'] = ocr_status(); st['ocr_engine'] = EX.OCR_CONFIG.get('engine', '')
                st['missing'] = MISSING; st.pop('prev_items', None)
                st['presets'] = [[n, docs.areas_text(a)] for n, a in core.AREA_PRESETS]   # 업무 키워드 보기(다른 기관용)
                st['allowed_hosts'] = sorted(core.ALLOWED_MODEL_HOSTS); st['remote_ok'] = core.remote_allowed()
            return self._send(200, st)
        if p.path == '/api/items':
            with LOCK:
                return self._send(200, {'items': STATE['items'], 'dropped': STATE['dropped']})
        if p.path == '/api/doc':   # 원문 보기: 앞부분과 기한·미결 같은 말이 든 줄(이 PC 안에서만)
            name = urllib.parse.parse_qs(p.query).get('file', [''])[0]
            units = _units.get(name)
            if units is None:
                return self._send(404, {'error': '이 문서의 글자를 아직 읽지 않았습니다(폴더를 다시 읽으면 보입니다)'})
            lines = [l.strip() for u in units for l in u['text'].split('\n') if l.strip()]
            hot = [i for i, l in enumerate(lines) if docs.HOT_LINE.search(l)][:12]
            m = docs.mask_secret   # 화면에도 비밀번호·아이디 값은 가린다
            return self._send(200, {'file': name, 'head': [m(l) for l in lines[:30]], 'hot': [m(lines[i][:200]) for i in hot], 'n_lines': len(lines)})
        if p.path in ('/api/onnara', '/api/report'):   # 온나라 붙여넣기용 절별 평문 / 인쇄용 서식 HTML(현재 상태로 바로 만든다)
            with LOCK:
                session = {'items': STATE['items'], 'areas': STATE.get('areas') or core.DEFAULT_AREAS, 'overview': STATE.get('overview') or {}, 'assets': STATE.get('assets') or {},
                           'info': STATE.get('info') or {}, 'months': STATE.get('months', 12), 'failures': STATE['failures'], 'handover_from': STATE.get('handover_from', ''),
                           'handover_to': STATE.get('handover_to', ''), 'witness': STATE.get('witness', ''), 'handover_date': STATE.get('handover_date', ''), 'org': STATE.get('org', '')}
                session.update({'title': STATE.get('title') or '', 'files': STATE['files'], 'fingerprints': STATE['fingerprints'], 'model': STATE['model'] or '없음(규칙층만)', 'version': VERSION})
            if p.path == '/api/report':
                return self._send(200, {'html': export.to_html(session)})
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
                            lines.append(docs.mask_secret(line.strip()[:140]))
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
            ctype = {'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json'}.get(os.path.splitext(name)[1].lower(), 'text/markdown; charset=utf-8')
            with open(full, 'rb') as f:
                return self._send(200, f.read(), ctype, {'Content-Disposition': "attachment; filename*=UTF-8''" + urllib.parse.quote(name)})
        return self._send(404, {'error': '없는 주소'})

    def do_POST(self):
        try:
            return self._post()
        except Exception as e:
            log('요청 처리 실패(%s): %s' % (self.path.split('?')[0], str(e)[:160]))
            return self._send(500, {'error': '처리 중 오류: %s' % str(e)[:200]})

    def _post(self):
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
            with LOCK:   # 최근 폴더(화면 ①의 「최근 폴더」 목록, 8개까지)
                STATE['recent'] = ([folder] + [r for r in (STATE.get('recent') or []) if r != folder])[:8]
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
                for k in ('model', 'key', 'include_tables', 'recent_years', 'title', 'max_calls', 'skip_reference', 'overview', 'handover_from', 'handover_to', 'assets', 'keyfiles', 'months', 'model_scope', 'witness', 'handover_date', 'org', 'manual_path', 'ocr', 'ocr_pages', 'ocr_images', 'areas_mode'):
                    if k in body:
                        STATE[k] = body[k]
                if 'areas_text' in body:
                    STATE['areas'] = docs.parse_areas(body['areas_text']) or core.DEFAULT_AREAS; STATE['areas_src'] = '사람' if body['areas_text'].strip() else '기본'
                    for it in STATE['items']:
                        if it.get('area_by') != '사람':
                            it['area'] = docs.area_of(it.get('title', ''), '', STATE['areas'], it.get('file', ''))
                if 'url' in body:
                    if not core.is_local_url(str(body['url'])):
                        return self._send(400, {'error': '모델 주소는 이 PC(127.0.0.1·localhost)만 허용합니다. 기관 모델 서버는 「돌다리_실행.bat --allow-model-host 주소:포트」로 실행하면 받습니다'})
                    STATE['url'] = str(body['url'])
                if STATE['files']:
                    STATE['plan'] = make_plan()
                if any(k in body for k in ('ocr', 'ocr_pages', 'ocr_images')):
                    ocr_status(refresh=True); set_ocr_config()
            save_session()
            return self._send(200, {'ok': True, 'plan': STATE['plan']})
        if p == '/api/draft':
            if STATE['running']:
                return self._send(409, {'error': '이미 만드는 중'})
            if STATE.get('reloading'):
                return self._send(409, {'error': '이전 폴더의 글자를 아직 되읽는 중입니다(큰 폴더는 몇 분). 잠시 뒤 다시 누르거나, ①에서 폴더를 다시 「읽기」 하세요.'})
            if not STATE['files']:
                if STATE.get('folder'):
                    return self._send(400, {'error': '이 폴더에서 읽을 수 있는 문서를 찾지 못했습니다(못 읽은 파일 %d개는 ②의 「못 읽은 파일」에 사유가 있습니다). 업무 폴더를 다시 고르세요.' % len(STATE.get('failures') or [])})
                return self._send(400, {'error': '먼저 ①에서 업무 폴더를 고르고 「읽기」를 누르세요'})
            with LOCK:
                STATE['running'] = True; STATE['stop'] = False; STATE['step'] = 3; STATE['progress'] = {'index': 0, 'total': (STATE['plan'] or {}).get('n_items', 0), 'calls_done': 0, 'calls_total': (STATE['plan'] or {}).get('calls', 0), 'sec': 0}
            threading.Thread(target=run_draft, daemon=True).start()
            return self._send(200, {'ok': True})
        if p == '/api/openwork':   # 내보낸 파일이 있는 작업 폴더를 탐색기로 연다
            try:
                if os.name == 'nt':
                    os.startfile(WORK)
                else:
                    subprocess.Popen(['xdg-open', WORK], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return self._send(200, {'ok': True})
            except Exception as e:
                return self._send(200, {'ok': False, 'error': '폴더를 열지 못했습니다. 탐색기에서 직접 여세요: ' + WORK})
        if p == '/api/stop':
            STATE['stop'] = True
            return self._send(200, {'ok': True})
        if p == '/api/items':
            if not isinstance(body, dict) or not isinstance(body.get('changes', []), list) or not isinstance(body.get('bulk', []), list):
                return self._send(400, {'error': '잘못된 요청 꼴'})
            with LOCK:
                by_id = {it['id']: it for it in STATE['items']}
                for ch in body.get('changes', []):
                    if not isinstance(ch, dict):
                        continue
                    it = by_id.get(ch.get('id'))
                    if not it:
                        continue
                    for k in ('due_next', 'date'):   # 「2026.11.3」「2026. 11. 3.」도 ISO로(정렬·「(지남)」 판정이 어긋나던 것)
                        if k in ch:
                            ch[k] = iso_date(ch[k])
                    for k in ('keep', 'decided', 'status', 'next', 'note', 'seen', 'question', 'answer'):
                        if k in ch:
                            it[k] = ch[k]
                    if 'keep' in ch or 'decided' in ch:
                        it['bulk'] = False   # 하나씩 고른 것은 「일괄 넣음」이 아니다
                    if 'status' in ch or 'next' in ch:
                        it['status_by'] = '사람'
                    for k in ('due_next', 'summary', 'when'):   # 사람이 고친 표시를 남긴다(초안을 다시 만들어도 잃지 않게)
                        if k in ch:
                            it[k] = ch[k]; it[k + '_by'] = '사람'
                    for k in ('title', 'todo'):
                        if k in ch:
                            it[k] = str(ch[k]); it[k + '_by'] = '사람'
                    if 'area' in ch:
                        it['area'] = str(ch['area']); it['area_by'] = '사람'
                    if 'kind3' in ch and ch['kind3'] in ('현안', '반복', '문서', '연혁', '현황'):
                        it['kind3'] = ch['kind3']; it['kind3_by'] = '사람'
                for b in body.get('bulk', []):          # 일괄: {'ids': [...], 'keep': true/false}
                    for i in b.get('ids', []):
                        it = by_id.get(i)
                        if it is not None:
                            it['keep'] = bool(b.get('keep')); it['decided'] = True; it['bulk'] = bool(b.get('keep')) and not b.get('area_done')   # 일괄 넣기는 결과물에 「일괄 넣음」으로 남긴다
                for new in body.get('add', []):
                    nid = max([0] + [it['id'] for it in STATE['items']]) + 1
                    d_in, w_in = str(new.get('date', '')).strip(), str(new.get('when', '')).strip()
                    if d_in and not re.match(r'^\d{4}(-\d{2}(-\d{2})?)?$', d_in):   # 「매주 금요일」처럼 날짜가 아닌 글은 시기로
                        w_in, d_in = (w_in or d_in), ''
                    new = dict(new, date=d_in, when=w_in)
                    rec = {'id': nid, 'file': '', 'kind': '', 'cls': '직접 입력', 'date': str(new.get('date', '')).strip()[:10], 'docno': '', 'title': str(new.get('title', '')).strip()[:160],
                           'area': str(new.get('area') or '기타'), 'area_by': '사람', 'due': [], 'due_next': iso_date(new.get('due_next', '')), 'contacts': [], 'recur': None, 'attachments': [],
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
            stem = '인수인계서_' + datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
            base, k = stem, 2
            while os.path.exists(os.path.join(WORK, stem + '.md')):   # 같은 초에 두 번 눌러도 앞 파일을 덮어쓰지 않게
                stem = '%s_%d' % (base, k); k += 1
            recheck_originals()   # 내보내는 지금 원본을 다시 재어 「처리 후」 지문을 채운다(읽은 뒤 바뀐 파일도 잡힌다)
            session['fingerprints'] = STATE['fingerprints']
            paths = export.write_all(session, WORK, stem)
            safe = lambda v: ("'" + v) if v[:1] in ('=', '+', '-', '@', '\t', '\r') else v   # 엑셀에서 열 때 수식으로 실행되지 않게
            with open(os.path.join(WORK, stem + '_원본지문.csv'), 'w', encoding='utf-8-sig', newline='') as f:
                f.write('파일,바이트,처리 전 SHA-256,내보낼 때 SHA-256,변경 없음\n')
                for x in STATE['fingerprints']:
                    f.write('"%s",%d,%s,%s,%s\n' % (safe(x['file']).replace('"', '""'), x['bytes'], x['sha256_before'], x['sha256_after'], '예' if x['unchanged'] else '아니오'))
            with LOCK:
                STATE['exports'] = [os.path.basename(x) for x in paths] + [stem + '_원본지문.csv']
                STATE['step'] = 5
            save_session()
            log('내보내기: ' + ', '.join(STATE['exports']))
            return self._send(200, {'ok': True, 'files': STATE['exports'], 'work': WORK})
        return self._send(404, {'error': '없는 주소'})


def iso_date(v):
    """'2026.11.3' / '2026. 11. 3.' / '2026-11-03' → '2026-11-03'. 날짜가 아니면 앞 10자 그대로."""
    s = str(v or '').strip()
    m = re.match(r'^(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})', s)
    if m:
        try:
            return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
        except ValueError:
            pass
    return s[:10]


NOPROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # 127.0.0.1 요청이 PC의 프록시 설정(사무실 PC)을 타지 않게


def port_open(port):
    import socket
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=0.5):
            return True
    except OSError:
        return False


def doldari_at(port):
    """그 포트에 켜진 돌다리의 {'version','work'}, 돌다리가 아니면 None. 작은 /api/ping으로 묻고(옛 판은 없으므로) 안 되면 /api/state 전체를 읽는다.
    10.20. 실측: state 앞 4KB만 읽던 검사가 이어서 연 상태(파일 42개)를 놓쳐 8766에 두 번째 서버가 떴음."""
    for path, limit in (('/api/ping', 4000), ('/api/state', 4_000_000)):
        try:
            with NOPROXY.open('http://127.0.0.1:%d%s' % (port, path), timeout=3) as r:
                if r.status != 200:
                    continue
                j = json.loads(r.read(limit).decode('utf-8', 'replace'))
            if isinstance(j, dict) and 'version' in j and (j.get('app') == 'doldari' or 'step' in j):
                return {'version': str(j.get('version') or ''), 'work': str(j.get('work') or '')}
        except Exception:
            pass
    return None


def is_doldari(port):
    return doldari_at(port) is not None


def same_work(a, b):
    try:
        return bool(a) and bool(b) and os.path.normcase(os.path.realpath(a)) == os.path.normcase(os.path.realpath(b))
    except Exception:
        return False


PORT_FILE = '실행중_포트.txt'


def open_server(start, work, span=10, say=print):
    """(서버 또는 None, 포트, 이미 켜진 같은 작업 폴더 돌다리 정보 또는 None).
    빈 포트인지 묻고 나서 잡으면, 두 창을 거의 같이 열 때 둘 다 「비었다」고 보고 하나가 실패한다(10.22. 검토에서 재현).
    그래서 실제로 자리를 잡아 보고, 못 잡았을 때만 그 포트의 주인이 돌다리인지 묻는다.
    1) 이 작업 폴더에 남긴 포트(지난번 8766 등)에 같은 작업 폴더의 돌다리가 있으면 그것을 쓴다(그새 8765가 비었어도).
    2) start부터 차례로 잡아 본다. 같은 작업 폴더의 돌다리(작업 폴더를 알리지 않는 옛 판 포함)면 그것을 쓰고,
       다른 위치의 돌다리·다른 프로그램·쓸 수 없는 번호는 건너뛴다."""
    seen = {}

    def probe(q):
        if q not in seen:
            seen[q] = doldari_at(q)
        return seen[q]

    try:
        with open(os.path.join(work, PORT_FILE), encoding='utf-8') as f:
            last = int((f.read(64).split() or ['0'])[0])
    except Exception:
        last = 0
    if 0 < last < 65536 and port_open(last):
        info = probe(last)
        if info and same_work(info['work'], work):
            return None, last, info
    for p in range(start, start + span + 1):
        try:
            return ExclusiveServer(('127.0.0.1', p), H), p, None
        except OSError:
            pass
        if not port_open(p):
            say('포트 %d는 쓸 수 없어 건너뜁니다.' % p)
            continue
        info = probe(p)   # 막 켜지는 돌다리여도 연결은 받아 두므로 응답을 기다린다(최대 3초씩)
        if info and (same_work(info['work'], work) or not info['work']):   # 작업 폴더를 알리지 않는 옛 판은 같은 것으로 본다(두 서버가 한 세션을 나눠 쓰지 않게)
            return None, p, info
        if info:
            say('포트 %d에는 다른 위치의 돌다리(v%s, 작업 폴더 %s)가 켜져 있어 건너뜁니다.' % (p, info['version'], info['work']))
        else:
            say('포트 %d는 다른 프로그램이 쓰고 있어 건너뜁니다.' % p)
    return None, None, None


def write_port_file(port):
    try:
        with open(os.path.join(WORK, PORT_FILE), 'w', encoding='utf-8') as f:
            f.write(str(port))
    except OSError:
        pass


def remove_port_file(port):
    p = os.path.join(WORK, PORT_FILE)
    try:
        with open(p, encoding='utf-8') as f:
            if f.read().strip() == str(port):
                os.remove(p)
    except OSError:
        pass


class ExclusiveServer(ThreadingHTTPServer):
    """윈도: 이미 듣고 있는 포트에 두 번째 서버가 또 묶이지 않게(SO_EXCLUSIVEADDRUSE). 리눅스·맥: 껐다 바로 켤 때 TIME_WAIT 포트를 다시 쓰게(기본값)."""
    allow_reuse_address = os.name != 'nt'

    def server_bind(self):
        if os.name == 'nt':
            import socket
            try:
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            except Exception:
                pass
        super().server_bind()


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
    ap.add_argument('--allow-model-host', action='append', default=[], metavar='주소[:포트]',
                    help='이 PC 밖 모델 서버(OpenAI 호환 주소)를 허용 목록에 더함. 예) --allow-model-host 10.1.2.3:8000 (기관 서버로 옮길 때, 코드 수정 없음)')
    a = ap.parse_args()
    for h in a.allow_model_host:
        h2 = core.allow_model_host(h)
        print('모델 서버 허용: %s (이 PC 밖 주소입니다. 현안 후보 문서의 제목과 본문 앞부분이 그 서버로 갑니다. 기관 개인정보 검토를 거친 서버만 적으세요)' % (h2 or h), flush=True)
    WORK = os.path.abspath(a.work)
    try:
        os.makedirs(WORK, exist_ok=True)
        open(os.path.join(WORK, '.쓰기확인'), 'w').close(); os.remove(os.path.join(WORK, '.쓰기확인'))
    except OSError:   # 읽기 전용 위치(Program Files 등)에 풀었을 때: 사용자 폴더로 대신(파이썬 오류 화면 대신 한 줄 안내)
        alt = os.path.join(os.environ.get('LOCALAPPDATA') or os.path.expanduser('~'), 'doldari', '작업')
        print('작업 폴더에 쓸 수 없어 %s 를 대신 씁니다(압축을 바탕화면 같은 곳에 풀면 그 안에 남습니다).' % alt, flush=True)
        WORK = alt; os.makedirs(WORK, exist_ok=True)
    srv, port, running = open_server(a.port, WORK)   # 세션을 읽기 전에 본다: 두 번째 실행이 큰 폴더를 다시 읽지 않게
    if running:
        url = 'http://127.0.0.1:%d/' % port
        print('돌다리가 이미 켜져 있습니다(포트 %d). 먼저 연 화면을 브라우저로 다시 엽니다: %s' % (port, url), flush=True)
        if running['version'] and running['version'] != VERSION:
            print('켜져 있는 것은 v%s입니다. 이 판(v%s)으로 바꾸려면 먼저 연 검은 창을 닫고 다시 실행하세요.' % (running['version'], VERSION), flush=True)
        print('이 창은 닫아도 됩니다. 돌다리는 먼저 연 검은 창에서 계속 돌아갑니다.', flush=True)
        if not a.no_browser:
            webbrowser.open(url)
        sys.exit(0)   # 실패가 아니다(실행 bat이 「시작하지 못했습니다」를 띄우지 않게)
    if srv is None:
        print('포트 %d~%d를 열 수 없습니다(다른 프로그램이 쓰거나 윈도가 막아 둔 번호). 「돌다리_실행.bat --port 9000」처럼 다른 번호로 실행하세요.' % (a.port, a.port + 10), flush=True)
        sys.exit(2)
    if port != a.port:
        print('포트 %d 대신 %d번으로 엽니다.' % (a.port, port), flush=True)
    a.port = port
    url = 'http://127.0.0.1:%d/' % a.port
    load_session()
    write_port_file(a.port)
    srv_thread = threading.Thread(target=srv.serve_forever, daemon=True)   # 화면 응답을 먼저 시작한다: 아래 글자 출력이 막혀도 화면·두 번째 실행 확인은 된다
    srv_thread.start()
    if not a.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        if MISSING:
            print('주의: 부품이 없어 읽지 못하는 형식이 있습니다: %s. 휴대용 묶음을 쓰거나 「python -m pip install -r 부품목록.txt」.' % ', '.join('%s(%s)' % (m['what'], m['module']) for m in MISSING), flush=True)
        print('돌다리 v%s · %s (이 PC 안에서만 열립니다)' % (VERSION, url), flush=True)
        print('이 검은 창을 닫으면 돌다리가 끝납니다(또는 Ctrl+C).', flush=True)
        print('작업 폴더: %s' % WORK, flush=True)
        while srv_thread.is_alive():
            srv_thread.join(0.5)   # 짧게 나눠 기다려야 윈도에서도 Ctrl+C가 들어온다
    except KeyboardInterrupt:
        pass
    finally:
        try:
            srv.shutdown()
            srv.server_close()
        except Exception:
            pass
        remove_port_file(a.port)

if __name__ == '__main__':
    main()
