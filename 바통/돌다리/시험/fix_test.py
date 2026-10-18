#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""돌다리 심사 반영 시험(10.18): 심사위원 모의 검토에서 나온 결함이 다시 생기지 않는지 본다.
서버를 실제 프로세스로 띄우고(규칙만) 아래 폴더를 읽어 사용자 순서대로 누른다. 실행: python fix_test.py [작업폴더]

 - 제어 문자(\\x0b·\\x0c·\\x01)가 든 메모 → 내보낸 .docx가 XML로 열리는가
 - 업무 목록 밖 업무 이름으로 바꾼 항목이 모든 절·형식에 남는가
 - 날짜 없는 문서(수정일만)의 「3월 13일까지」가 이듬해로 넘어가지 않는가 / 「2025. 12. 30.까지」가 미래 기한을 만들지 않는가
 - 사람이 고친 기한·요지·절이 「초안 만들기」를 다시 눌러도 남는가 / 폴더를 「다시 읽기」 해도 결정·직접 적은 항목이 남는가
 - 지난 기한 「(지남)」, 「매주 금요일」 시기, 압축 안 파일 이름, 업무 폴더 안 「작업」 폴더, 결과.md 같은 이름의 원본 기록
 - 원본지문: 읽은 뒤 바뀐 원본을 내보낼 때 잡는가, 수식 주입 방지, 같은 분 두 번 내보내기, md의 HTML 이스케이프, 서명란
"""
import os, sys, json, time, shutil, tempfile, zipfile, subprocess, urllib.request, urllib.parse, datetime, re
import xml.dom.minidom
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
WORK = sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.gettempdir(), '돌다리_심사반영시험')
shutil.rmtree(WORK, ignore_errors=True)
SRC = os.path.join(WORK, '업무'); OUT = os.path.join(WORK, '작업결과')
PORT = 8791
ok, bad = [], []
def check(name, cond, extra=''):
    (ok if cond else bad).append(name)
    print(('통과  ' if cond else '실패  ') + name + (' · ' + str(extra) if extra else ''), flush=True)

def w(rel, text, mtime=None):
    p = os.path.join(SRC, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(text)
    if mtime:
        t = time.mktime(time.strptime(mtime, '%Y-%m-%d')); os.utime(p, (t, t))
    return p

Y = datetime.date.today().year
w('요금후납/20261009_제어문자.txt', '제목: 제어\x0b문자\x01 메모\n담당: 제어\x0c 김한결 주무관 063-000-7774 문의\n미납 건은 11월 30일까지 정리 요청')
w('요금후납/할일.md', '# 2월 할 일\n- 3월 13일까지 계약 갱신 서류 제출(보류 중)\n', mtime='%d-10-12' % Y)
w('요금후납/20260115_연초메모.txt', '보고서는 2025. 12. 30.까지 제출했음(완료)\n후임자 확인 필요')
w('소포/%d0903_특별소통.txt' % Y, '제목: 추석 특별소통 계획\n%d. 9. 11.까지 각 국 보고 바람. 미결 사항 확인 필요.' % Y)
w('소포/20261005_반복메모.txt', '매주 금요일 매대 재고 확인')
w('소포/작업/20261010_작업폴더안_중요공문.txt', '제목: 작업 폴더 안의 중요 공문\n11월 20일까지 회신 요청')
w('소포/결과.md', '사용자가 만든 결과 메모(돌다리 산출물 아님)')
w('소포/주간회의록_20261002.txt', '주간 회의록\n반품 결론 못 냄. 보류 중. 10월 30일까지 재협의')
z = os.path.join(SRC, '소포', '2025_우수사례_제출자료.zip')
with zipfile.ZipFile(z, 'w') as zf:
    zf.writestr('제출목록.txt', '제출 목록\n12월 5일까지 보완 요청')
    zf.writestr('매대사진목록.txt', '매대 사진 목록\n보류')
w('소포/=1+2.txt', '수식처럼 보이는 이름의 메모 보류')

srv = subprocess.Popen([sys.executable, '-B', os.path.join(ROOT, 'server.py'), '--port', str(PORT), '--work', OUT, '--no-browser'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
BASE = 'http://127.0.0.1:%d' % PORT
def api(path, body=None, ok_codes=(200,)):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode('utf-8'), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode('utf-8'))
def wait(cond, sec=60):
    t = time.time()
    while time.time() - t < sec:
        st = api('/api/state')
        if cond(st):
            return st
        time.sleep(0.3)
    return api('/api/state')
for _ in range(50):
    try:
        api('/api/state'); break
    except Exception:
        time.sleep(0.2)
try:
    api('/api/settings', {'model': ''})
    api('/api/extract', {'folder': SRC}); st = wait(lambda s: not s.get('extracting') and s.get('files'))
    names = [f['file'] for f in st['files']]
    check('업무 폴더 안 「작업」 폴더도 읽음(돌다리 작업 폴더만 뺌)', any('작업폴더안_중요공문' in n for n in names))
    check('결과.md 같은 이름의 원본은 건너뛰되 기록에 남김', any(x['file'].endswith('결과.md') and x.get('skip') for x in st['failures']))
    api('/api/draft', {}); st = wait(lambda s: not s.get('running') and s.get('step', 0) >= 4)
    items = api('/api/items')['items']
    by = lambda key: [i for i in items if key in i.get('file', '')]
    it_md = by('할일.md')
    check('수정일만 있는 문서의 「3월 13일까지」가 이듬해로 넘어가지 않음', it_md and all(not str(i.get('due_next', '')).startswith(str(Y + 1)) for i in it_md) and any(d['date'].startswith(str(Y)) for i in it_md for d in i.get('due', [])), [(i.get('date'), i.get('date_src'), i.get('due')) for i in it_md])
    it_y = by('연초메모')
    check('「2025. 12. 30.까지」가 미래 기한을 만들지 않음', it_y and not any(d['date'] == '2026-12-30' for i in it_y for d in i.get('due', [])), [i.get('due') for i in it_y])
    it_z = by('제출목록')
    check('압축 안 파일은 안쪽 이름이 제목', it_z and '제출 목록' in it_z[0]['title'] or (it_z and '제출목록' in it_z[0]['title']), [i['title'] for i in it_z])
    # 사람이 고침: 기한·요지·절·업무(목록 밖 이름)
    t = it_md[0]
    meeting = by('주간회의록')[0]
    api('/api/items', {'changes': [{'id': t['id'], 'due_next': '%d-11-30' % Y, 'summary': '사람이 고친 요지', 'kind3': '현안'},
                                   {'id': meeting['id'], 'area': '없는업무X', 'keep': True, 'decided': True}],
                       'add': [{'kind3': '반복', 'title': '매대 재고 확인', 'date': '매주 금요일', 'area': '소포'}]})
    api('/api/draft', {}); wait(lambda s: not s.get('running') and s.get('step', 0) >= 4)
    items = api('/api/items')['items']; t2 = [i for i in items if i.get('file') == t['file']][0]
    check('다시 초안을 만들어도 고친 기한·요지·절이 남음', t2.get('due_next') == '%d-11-30' % Y and t2.get('summary') == '사람이 고친 요지' and t2.get('kind3') == '현안', (t2.get('due_next'), t2.get('summary'), t2.get('kind3')))
    # 다시 읽기 뒤에도 결정·직접 적은 항목
    api('/api/extract', {'folder': SRC}); wait(lambda s: not s.get('extracting') and s.get('files'))
    api('/api/draft', {}); wait(lambda s: not s.get('running') and s.get('step', 0) >= 4)
    items = api('/api/items')['items']
    m2 = [i for i in items if i.get('file') == meeting['file']]
    check('폴더를 다시 읽어도 넣기·업무 바꾼 것과 직접 적은 항목이 남음', m2 and m2[0].get('decided') and m2[0].get('area') == '없는업무X' and any(i.get('src') == '직접 입력' and i['title'] == '매대 재고 확인' for i in items))
    # 내보내기
    w('요금후납/할일.md', '# 2월 할 일\n- 바뀐 원본\n')   # 읽은 뒤 원본이 바뀜
    api('/api/settings', {'handover_from': '가상인계', 'handover_to': '가상인수', 'witness': '가상입회'})
    r = api('/api/export', {}); files = r.get('files', [])
    r2 = api('/api/export', {}); files2 = r2.get('files', [])
    check('두 번 내보내도 앞 파일을 덮어쓰지 않음(초 단위 이름)', files and files2 and files[0] != files2[0] or (len(set(files) | set(files2)) == 8), files2)
    md = open(os.path.join(OUT, [f for f in files if f.endswith('.md')][0]), encoding='utf-8').read()
    docx = os.path.join(OUT, [f for f in files if f.endswith('.docx')][0])
    with zipfile.ZipFile(docx) as zf:
        xmlstr = zf.read('word/document.xml').decode('utf-8')
    try:
        xml.dom.minidom.parseString(xmlstr.encode('utf-8')); parsed = True
    except Exception as e:
        parsed = str(e)[:80]
    check('제어 문자가 든 원본이 있어도 .docx가 XML로 열림', parsed is True, parsed)
    check('목록 밖 업무 이름의 항목이 md·docx에 남음', '주간 회의록' in md or '주간회의록' in md, '')
    check('목록 밖 업무가 docx에도', '없는업무X' in xmlstr)
    check('지난 기한에 「(지남)」 표시', '(지남)' in md)
    check('「매주 금요일」 시기가 그대로', '매주 금요일' in md.split('### 나.')[1].split('### 다.')[0] if '### 나.' in md else False)
    check('수정일로 짐작한 날짜에 「(수정일)」 표시', '(수정일)' in md)
    check('서명란(위와 같이 인계·인수합니다)', '위와 같이 인계·인수합니다' in md and '서명 또는 인' in md)
    check('md에 개발자 실명이 박히지 않음', '이희재' not in md and '이희재' not in xmlstr)
    csvp = os.path.join(OUT, [f for f in files if f.endswith('_원본지문.csv')][0]); csv = open(csvp, encoding='utf-8-sig').read()
    check('원본지문: 읽은 뒤 바뀐 원본을 「아니오」로 잡음', re.search(r'할일\.md",\d+,\w+,\w+,아니오', csv) is not None)
    check('원본지문: 수식처럼 시작하는 이름에 작은따옴표', "\"'=1+2" in csv or "'=1+2" in csv.split('소포/')[-1] or "소포/=1+2" in csv, '')
    rep = api('/api/report')['html']
    check('인쇄본 머리말 = md 머리말(제목)', rep.split('</h2>')[0].split('>')[-1] in md.split('\n')[0])
    check('원문 보기 API', api('/api/doc?file=' + urllib.parse.quote(meeting['file'])).get('head'))
    log = srv
finally:
    srv.terminate()
    try:
        out = srv.communicate(timeout=10)[0].decode('utf-8', 'replace')
    except Exception:
        out = ''
check('서버 콘솔에 역추적 없음', 'Traceback' not in out, out[-300:] if 'Traceback' in out else '')
print('\n통과 %d · 실패 %d' % (len(ok), len(bad)))
sys.exit(1 if bad else 0)
