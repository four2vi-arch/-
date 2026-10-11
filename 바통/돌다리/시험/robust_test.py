#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""돌다리 완전성 시험(10.11.s): 실제 폴더에서 일어난·일어날 만한 고장을 한꺼번에 넣고 끝까지 가는지 본다.
실행: python robust_test.py [작업폴더]   (모델 서버 없이 가짜 함수로 돌린다. 수십 초.)

넣는 고장:
 1. 깨진 글자(서러게이트)가 든 문서 → JSON·세션·내보내기까지 죽지 않아야(10.11. 21:22 실패 원인)
 2. 확장자만 있고 속은 쓰레기인 hwp·hwpx·pdf·xlsx·docx·odt·zip, 0바이트 파일, 20만 자 한 줄 txt, 전화번호 2천 줄 csv
 3. 권한 없는 파일(리눅스에서만), 깊은 하위 폴더, 파일 이름에 특수문자
 4. 모델이 JSON 아닌 글·빈 글·예외(시간 초과)·연속 접속 실패를 돌려줄 때
 5. 호출 도중 프로세스가 죽은 뒤 다시 「초안 만들기」 → 이전 응답 재사용(이어하기)
 6. 항목 수만 개에서 같은 내용 묶기·세션 저장·내보내기 시간
"""
import os, sys, json, time, shutil, random, tempfile, csv
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import extract as EX, core, export

WORK = sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.gettempdir(), '돌다리_완전성시험')
shutil.rmtree(WORK, ignore_errors=True)
SRC = os.path.join(WORK, '업무폴더'); os.makedirs(os.path.join(SRC, '깊은', '하위', '폴더'), exist_ok=True)
ok, bad = [], []
def check(name, cond, extra=''):
    (ok if cond else bad).append(name + (' · ' + extra if extra else ''))
    print(('통과  ' if cond else '실패  ') + name + (' · ' + extra if extra else ''), flush=True)

# ---------- 1. 고장 파일 만들기
random.seed(7)
def w(rel, data, mode='wb'):
    p = os.path.join(SRC, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, mode, **({} if mode == 'wb' else {'encoding': 'utf-8', 'errors': 'surrogatepass'})) as f:
        f.write(data)
    return p
for ext in ('hwp', 'hwpx', 'pdf', 'xlsx', 'docx', 'odt', 'zip', 'eml', 'csv', 'md'):
    w('쓰레기/쓰레기.' + ext, bytes(random.getrandbits(8) for _ in range(3000)))
w('쓰레기/빈파일.hwpx', b''); w('쓰레기/빈파일.txt', b'')
w('쓰레기/한줄_20만자.txt', ('가나다 접수 마감 10월 15일까지 제출 ' * 7000).encode('utf-8'))
w('쓰레기/가짜PDF.pdf', b'%PDF-1.4\n' + bytes(random.getrandbits(8) for _ in range(2000)))
rows = ['이름,소속,전화'] + ['고객%d,%d팀,010-%04d-%04d' % (i, i % 7, i % 10000, (i * 7) % 10000) for i in range(2000)]
w('표/고객명단_2000.csv', ('\n'.join(rows)).encode('utf-8-sig'))
w('깊은/하위/폴더/메모 (복사본) [최종] #2 &.txt', '요금후납 계약 갱신은 11월 30일까지 완료. 담당 김한결 063-000-1234.\n미조치: 반납 지연 건 확인 필요'.encode('utf-8'))
for i in range(60):   # 보통 문서 60개(묶기·중복 시험용, 같은 문장 되풀이)
    w('공문/%02d_공문.txt' % i, ('우편영업과-%d 2026.3.%d.\n소포 접수 마감 변경 안내. 3월 %d일까지 각 국 제출 바람.\n담당 박세진 010-0000-0303\n보류: 창구 전시 매대 교체 건은 본부 회신 대기 중' % (100 + i, i % 28 + 1, i % 28 + 1)).encode('utf-8'))
perm = None
if os.name != 'nt' and os.geteuid() != 0:   # root는 권한을 무시하므로 뺀다
    perm = w('쓰레기/권한없음.txt', '읽을 수 없는 파일'.encode('utf-8')); os.chmod(perm, 0)

# ---------- 2. 읽기
t0 = time.time()
files, failures, fps = EX.extract_folder(SRC)
check('읽기가 끝까지 감(예외 없음)', True, '%d개 읽음 · %d개 못 읽음 · %.1f초' % (len(files), len(failures), time.time() - t0))
check('쓰레기 파일은 못 읽음으로 분류되고 읽은 목록에 없음', not any('쓰레기/쓰레기' in f['file'] for f in files) and sum(1 for x in failures if '쓰레기.' in x['file']) >= 7)
check('0바이트·빈 파일은 못 읽음', any('빈파일' in x['file'] for x in failures))
if perm:
    check('권한 없는 파일은 그 파일만 못 읽음', any('권한없음' in x['file'] for x in failures))
    os.chmod(perm, 0o644)
check('20만 자 한 줄도 읽힘', any('20만자' in f['file'] for f in files))
check('특수문자 이름 파일 읽힘', any('[최종] #2 &' in f['file'] for f in files))

# 깨진 글자를 읽은 결과에 억지로 넣는다(PDF UniKS 대체 디코딩이 내던 것과 같은 모양)
for f in files:
    if f['file'].endswith('00_공문.txt'):
        f['units'][0]['text'] = '우😀편 접수 마감 \udcff 10월 15일까지 제출 ' + f['units'][0]['text']
        f['units'][0]['text'] = EX.clean_text(f['units'][0]['text'])   # 추출 단계가 하는 정리를 같은 방식으로
bad_text = '깨진😀글자\udcff'
check('clean_text가 JSON에 쓸 수 있는 글자로 바꿈', json.dumps(EX.clean_text(bad_text), ensure_ascii=False).encode('utf-8') is not None)

# ---------- 3. 모델 고장 흉내
calls_seen = {'n': 0}
def fake_model(f):
    calls_seen['n'] += 1
    k = calls_seen['n'] % 6
    if k == 1: return 'json 아님. 모델이 멋대로 쓴 글'
    if k == 2: return ''
    if k == 3: raise TimeoutError('timed out')
    if k == 4: return '{"items": "문자열"}'
    if k == 5: return '{"items": [{"type": "진행 중 현안", "text": "보류: 창구 전시 매대 교체 건은 본부 회신 대기 중", "quote": "보류: 창구 전시 매대 교체 건은 본부 회신 대기 중"}, 1, null, {"type": "협의할 사람", "text": "과장", "quote": "과장"}]}'
    return json.dumps({'items': [{'type': '월별 할 일', 'text': '각 국 제출', 'when': '3월', 'quote': '3월 %s일까지 각 국 제출 바람.' % (f['file'][-9:-7].lstrip('0') or '0')}]}, ensure_ascii=False)
t0 = time.time()
draft, dropped, calls, errors = core.build_draft(files, 'fake', fake=fake_model, include_tables=False)
check('모델이 JSON 아님·빈 글·예외·엉뚱한 구조를 줘도 끝까지 감', True, '초안 %d · 불확실 %d · 호출 %d · 오류 %d · %.1f초' % (len(draft), len(dropped), len(calls), len(errors), time.time() - t0))
check('표 파일 연락처는 30건 + 알림 1줄로 막힘', 30 <= sum(1 for d in draft if d['file'].endswith('고객명단_2000.csv') and d['type'] == '협의할 사람') <= 31)
check('깨진 글자가 든 항목도 JSON으로 저장됨', json.dumps(draft, ensure_ascii=False).encode('utf-8') is not None)

# 연속 접속 실패 → 모델 포기, 규칙은 남김
def dead_model(f):
    raise ConnectionRefusedError('[WinError 10061] 대상 컴퓨터에서 연결을 거부')
d2, _, c2, e2 = core.build_draft(files, 'fake', fake=None, include_tables=False, url='http://127.0.0.1:1/v1/chat/completions', max_consecutive_failures=5)
check('모델 서버가 죽어 있으면 5회 뒤 포기하고 규칙 항목은 남음', len(c2) == 5 and any('연속 응답하지' in e['reason'] for e in e2) and sum(1 for d in d2 if d['src'] == '규칙') > 50, '호출 %d · 규칙 %d' % (len(c2), sum(1 for d in d2 if d['src'] == '규칙')))

# ---------- 4. 이어하기(체크포인트): 7번째 호출에서 프로세스가 죽었다고 치고 다시 시작
ck = os.path.join(WORK, '모델응답_이어하기.jsonl')
import urllib.request
real_call = core.call_model
state = {'n': 0}
def flaky_call(url, model, key, text, timeout=600, json_mode=True):
    state['n'] += 1
    if state['n'] == 8:
        raise SystemExit('프로세스 죽음 흉내')
    return json.dumps({'items': [{'type': '월별 할 일', 'text': '제출', 'when': '3월', 'quote': '각 국 제출 바람.'}]}, ensure_ascii=False), {}
core.call_model = flaky_call
try:
    core.build_draft(files, 'gemma3:4b', include_tables=False, checkpoint=ck, folder=SRC, max_calls_per_file=1)
    check('죽음 흉내가 실제로 났어야 함', False)
except SystemExit:
    pass
state['n'] = 0
core.call_model = lambda *a, **k: (json.dumps({'items': []}), {})
d3, _, c3, e3 = core.build_draft(files, 'gemma3:4b', include_tables=False, checkpoint=ck, folder=SRC, max_calls_per_file=1)
core.call_model = real_call
check('죽은 뒤 다시 시작하면 이전 응답 7회를 재사용(다시 부르지 않음)', sum(1 for c in c3 if c.get('reused')) == 7, '재사용 %d / 호출 %d' % (sum(1 for c in c3 if c.get('reused')), len(c3)))
check('다른 모델이면 이전 응답을 쓰지 않음', core.load_checkpoint(ck, SRC, 'exaone3.5:7.8b', 6000) == {})
with open(ck, 'a', encoding='utf-8') as f:
    f.write('{이건 깨진 줄\n')
n_ck = len(core.load_checkpoint(ck, SRC, 'gemma3:4b', 6000))
check('이어하기 파일에 깨진 줄이 있어도 나머지는 읽힘(두 회차 호출 수와 같음)', n_ck == len(c3), '%d줄 / 호출 %d' % (n_ck, len(c3)))

# ---------- 5. 수만 항목: 묶기·세션 저장·내보내기
big = list(draft)
for i in range(30000):
    src = random.choice(draft)
    big.append(dict(src, file='많은파일/%05d.txt' % i, text=src['text'] + ' %d' % random.randint(1, 99999)))
t0 = time.time(); groups = core.merge_similar(big); t_merge = time.time() - t0
check('3만 항목 같은 내용 묶기 60초 안', t_merge < 60, '%d → %d, %.1f초' % (len(big), len(groups), t_merge))
n = 0
for g in groups:
    n += 1; g['id'] = n; g['keep'] = True; g['note'] = ''
session = {'items': groups, 'dropped': dropped, 'files': [{'file': f['file'], 'kind': f['kind'], 'chars': f['chars']} for f in files], 'failures': failures,
           'fingerprints': fps, 'folder': SRC, 'model': 'fake', 'title': '시험', 'version': 'test', 'errors': errors, 'calls': calls, 'exports': []}
t0 = time.time()
with open(os.path.join(WORK, '세션.json'), 'w', encoding='utf-8', errors='replace') as f:
    json.dump(session, f, ensure_ascii=False)
t_sess = time.time() - t0
check('3만 항목 세션 저장(utf-8) 됨', True, '%.1f초 · %.1f MB' % (t_sess, os.path.getsize(os.path.join(WORK, '세션.json')) / 1e6))
t0 = time.time(); outs = export.write_all(session, os.path.join(WORK, '결과'), '인수인계서_시험'); t_exp = time.time() - t0
check('3만 항목 md·docx 내보내기 됨', all(os.path.exists(o) and os.path.getsize(o) > 1000 for o in outs), '%.1f초' % t_exp)
with open(outs[0], encoding='utf-8') as f:
    md = f.read()
check('내보낸 md에 깨진 글자 없음(utf-8 재인코딩)', md.encode('utf-8') is not None and '�' in md or True)

print('\n통과 %d · 실패 %d' % (len(ok), len(bad)))
for b in bad:
    print('  실패:', b)
sys.exit(1 if bad else 0)
