# 돌다리 v3.7.1 회귀 시험: 10.18. 2차 검토(고친 뒤 새로 생긴 결함)에서 잡은 것. 가상 자료만.
# 사용: python 시험/review2_test.py
import os, sys, re, datetime, hashlib, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import docs, export, core

P = F_ = 0
def ok(name, cond, extra=''):
    global P, F_
    P += bool(cond); F_ += (not cond)
    print(('통과  ' if cond else '실패  ') + name + (' · ' + str(extra) if extra and not cond else ''))

def F(path, text, mtime='2026-09-01'):
    return {'file': path, 'kind': os.path.splitext(path)[1][1:], 'chars': len(text), 'mtime': mtime, 'units': [{'text': text, 'loc': '본문'}], 'sha': hashlib.sha256((path + text).encode()).hexdigest()}

TODAY = datetime.date(2026, 10, 18)
def build(files, prev=None):
    return docs.build_docs(files, core.DEFAULT_AREAS, 12, 'none', today=TODAY, prev_items=prev)
def session(items, info, **kw):
    s = {'items': items, 'info': info, 'areas': core.DEFAULT_AREAS, 'overview': {}, 'assets': {}, 'months': 12, 'failures': [], 'files': [], 'fingerprints': [], 'model': '없음', 'version': 'x', 'title': 't',
         'handover_from': '', 'handover_to': '', 'witness': '', 'handover_date': '', 'org': ''}
    s.update(kw); return s
def allout(s):
    return export.to_markdown(s) + export.to_html(s) + export.to_onnara_txt(s)

# 1. 반복 문장 항목이 같은 파일의 문서 항목 결정을 덮지 않음
f1 = F('예산/2026년 예산 배정 계획(안).txt', '2026년 예산 배정 계획(안)\n2026. 10. 1.\n매월 10일까지 집행 실적 보고할 것\n10월 30일까지 배정 요청 회신 대기')
items, _, _, info = build([f1])
doc = [i for i in items if not i.get('rkey')][0]; rule = [i for i in items if i.get('rkey')]
doc.update(keep=True, decided=True, note='중요')
for r in rule:
    r.update(keep=False, decided=True)
items2, _, _, _ = build([f1], prev=items)
d2 = [i for i in items2 if not i.get('rkey')][0]
ok('다시 만들어도 문서 항목의 넣기·메모 유지(반복 항목과 섞이지 않음)', d2['keep'] is True and d2['note'] == '중요' and rule, (d2['keep'], d2['note']))

# 2. 판 묶기: 1차·2차 회의, 다른 폴더 같은 이름, 이름만 같은 다른 문서는 따로
fs = [F('민원/정기협의회 결과보고_1차.txt', '정기협의회 1차 결과\n시청 회신 대기 9월 30일까지'), F('민원/정기협의회 결과보고_2차.txt', '정기협의회 2차 결과\n다음 회의 11월'),
      F('회계/결과보고_최종.txt', '회계 결과보고\n미납 1,240천원 10월 31일까지'), F('민원/결과보고_최종.txt', '민원 결과보고\n처리 완료 11월 15일 보고'),
      F('a/새 문서(3).txt', '직원 복무 점검 결과 보고 10월 20일까지'), F('a/새 문서.txt', '점심 메뉴 메모')]
items, _, _, info = build(fs)
files_in = {i['file'] for i in items}
ok('1차·2차 회의 보고는 따로', {'민원/정기협의회 결과보고_1차.txt', '민원/정기협의회 결과보고_2차.txt'} <= files_in, files_in)
ok('다른 폴더의 같은 이름(회계·민원 결과보고_최종)은 따로', {'회계/결과보고_최종.txt', '민원/결과보고_최종.txt'} <= files_in, files_in)
ok('이름만 같고 내용이 다른 「새 문서(3)」은 이전 판이 아님', not any('새 문서' in o['file'] and '이전 판' in o['why'] for o in info['docs_other']), info['docs_other'])
fv = [F('b/활성화 방안 보고_v1.txt', '제목: 활성화 방안 보고\n2026. 8. 1.\n추진 방향 1. 우편 활성화 2. 창구 개선 3. 홍보', '2026-10-10'),
      F('b/활성화 방안 보고_최종.txt', '제목: 활성화 방안 보고\n2026. 9. 20.\n추진 방향 1. 우편 활성화 2. 창구 개선 3. 홍보 10월 30일까지 시행', '2026-09-20')]
items, _, _, info = build(fv)
ok('같은 보고서의 판은 문서 날짜가 늦은 「최종」을 남김(수정일이 늦은 v1이 아니라)', [i['file'] for i in items if '활성화' in i['file']] == ['b/활성화 방안 보고_최종.txt'], [i['file'] for i in items])

# 3. 업무 문서는 개인 문서가 아님 / 개인 문서는 붙임 제목에도 없음
work = ['고충민원 처리 결과 회신', '우체국 금융 상담창구 운영 계획', '다문화가족 우편요금 감면 시행', '직원 건강검진 실시 안내', '고객 면담 결과보고', '가족친화 인증 신청']
items, _, _, info = build([F('w/%s.txt' % t, '%s\n2026. 10. 2.\n10월 30일까지 제출해야 함' % t) for t in work] + [F('w/수습 멘토링 면담 기록.txt', '2024. 3. 1. 멘토 면담\n교육 과제 제출'),
                                                                                     F('old/병가 신청서.txt', '2024. 1. 5. 병가 신청', '2024-01-05')])
ok('「고충민원·상담창구·다문화가족·건강검진·고객 면담·가족친화」는 업무 문서(현안)', sum(1 for i in items if i['kind3'] == '현안' and not i.get('private')) == len(work), [(i['title'], i['kind3'], i.get('private')) for i in items])
md = export.to_markdown(session(items, info))
ok('개인 문서(멘토링 면담·병가)는 붙임 제목에도 없음', '병가' not in md and '멘토링' not in md)

# 4. 비밀번호·아이디 값은 어느 결과물에도 없음
sec = '시스템 계정 인계 메모\n2026. 10. 2.\n계정 정보: gaon01 / Pass1234 (후임자가 10월 30일까지 변경 요청)\n매월 5일까지 접속 기록 점검 (초기 암호 gaonpw99)\n담당 정보화 주무관 이하람 063-000-0404 (비번 Zz9!xx)\n비밀번호는 매월 바뀜(현재 Gaon#77). 회신 대기 중\n패스워드는 qwer1234\n'
items, _, _, info = build([F('정보화/시스템 계정 인계 메모.txt', sec)])
out = allout(session(items, info, org='가온우체국 우편영업실'))
leak = [x for x in ('gaon01', 'Pass1234', 'gaonpw99', 'Zz9!xx', 'Gaon#77', 'qwer1234') if x in out or x in repr(items) or x in repr(info)]
ok('비밀번호·아이디 값이 결과물·세션에 없음', not leak, leak)
ok('가린 뒤에도 할 일 줄은 남음(「10월 30일까지 변경 요청」)', '변경 요청' in out)
tbl = F('총무/업무용 시스템 계정 목록.xlsx', '1행: 시스템\t아이디\t비고\n2행: 가온전자결재\tga_lee77\t권한 해제 요청함\n3행: 예산시스템\tga_lee77\t비밀번호는 보안USB 계정.txt에 있음')
tbl['kind'] = 'xlsx'
_, _, _, info_t = build([tbl])
ok('계정 목록 표의 아이디 칸은 3절 참고 줄에서도 가림', not any('ga_lee77' in h['line'] for h in info_t['asset_hints']['acct']) and any('●●●' in h['line'] for h in info_t['asset_hints']['acct']), info_t['asset_hints']['acct'])
ok('「계정.txt」의 확장자는 아이디로 보지 않음', docs.mask_secret('비밀번호는 보안USB 계정.txt에 있음') == '비밀번호는 보안USB 계정.txt에 있음')
ok('지나치게 가리지 않음(계정 2026년·ID 2026-001호·암호화·비밀번호 변경해야 함)', all(docs.mask_secret(t) == t for t in ('특별회계 계정 2026년 결산', 'ID 2026-001호 공문', '암호화 모듈 점검', '매월 1일 비밀번호 변경해야 함', '비밀번호 변경 후 063-000-0404로 연락')))

# 5. 직원 비상연락망의 휴대전화·주소는 4절에 없음
roster = '직원 비상연락망\n이름\t직위\t전화\t주소\n김가상\t주무관\t010-0000-1000\t가온시 ○○동 1\n이가상\t주무관\t010-0000-1001\t가온시 ○○동 2\n박가상\t주무관\t010-0000-1002\t가온시 ○○동 3\n'
f_r = F('총무/직원 비상연락망.xlsx', roster); f_r['kind'] = 'xlsx'
items, _, _, info = build([f_r])
ok('비상연락망의 휴대전화를 연락처로 쓰지 않음', not any(p['phone'].startswith('010') for p in info['people']), info['people'])

# 6. 미결: 부정 줄은 미결이 아님, 「회신 바랍니다」는 할 일
items, _, _, _ = build([F('m/주간회의 결과.txt', '주간회의 결과\n2026. 10. 6.\n미결 사항 없음(모두 완료)\n시청 회신 받음, 기다리는 건 없음'), F('m/협조 요청.txt', '협조 요청\n2026. 10. 6.\n10월 30일까지 회신 바랍니다')])
ok('「미결 사항 없음」「회신 받음」은 미결 아님', not any(i.get('status') == '미결' for i in items), [(i['title'], i.get('status')) for i in items])

# 7. 반복: 옛 해의 일회성·완료·통계 줄은 반복 업무가 아님, 상한이 최근 문서를 밀어내지 않음
ho = '인수인계서(2024 전임자)\n2024. 2. 1.\n2024. 11. 15.까지 감사 자료 제출 완료\n2024년 5월 30일까지 시설 보수 업체 정산 (일회성)\n3월 13일까지 세부추진계획 제출\n'
mail = '주간 회의 결과\n2026. 10. 6.\n작년에는 매월 평균 120건 접수됨\n매월 말 기준 실적은 붙임 확인\n매월 5일까지 실적 보고 바람\n매월 5일까지 실적 보고합니다\n'
items, _, _, _ = build([F('인수인계/인수인계서_2024.txt', ho, '2024-02-01'), F('회의/주간회의 결과.txt', mail, '2026-10-06')])
rec = [i['title'] for i in items if i.get('rkey')]
ok('반복: 옛 일회성·완료·통계·「붙임 확인」 줄 제외, 같은 말 끝만 다른 줄은 하나', not any(re.search(r'일회성|완료|평균|붙임', t) for t in rec), rec)
ok('반복: 「매월 5일까지 실적 보고」 하나, 「3월 13일까지 세부추진계획」 있음', sum('매월 5일' in t for t in rec) == 1 and any('세부추진계획' in t for t in rec), rec)
man = '업무 매뉴얼\n' + '\n'.join('%d월 %d일까지 서류 %d 제출' % (m, d, m * 10 + d) for m in range(1, 13) for d in (3, 7, 11, 15)) + '\n'
items, _, _, _ = build([F('매뉴얼/업무 매뉴얼.txt', man, '2023-01-01'), F('요금/월간 업무.txt', '월간 업무\n2026. 10. 7.\n매월 10일까지 우편 실적 보고할 것')])
ok('반복 상한(40)이 최근 문서의 「매월 10일까지」를 밀어내지 않음', any('매월 10일' in i['title'] for i in items if i.get('rkey')))

# 8. 이미 넘긴 업무는 내보내기에 「인계 완료」로
items, _, _, info = build([F('정산/정산 안내.txt', '정산 안내\n2026. 10. 2.\n10월 30일까지 정산해야 함')])
area = items[0]['area']
for i in items:
    i.update(keep=False, decided=True, bulk=True)
md = export.to_markdown(session(items, info, overview={area: {'gone': '2026-10-01 이가상에게'}}))
ok('「이미 넘긴 업무」는 항목을 다 빼도 1-가에 남음', '인계 완료' in md, md[:300])

# 9. 인계 일자 「2026. 11. 20.」 꼴
bd, why = docs.base_date([], '2026. 11. 20.')
ok('인계 일자 「2026. 11. 20.」 꼴을 읽음', bd == datetime.date(2026, 11, 20) and why == '인계 일자', (bd, why))

# 10. 판 묶기 속도(6,000개)
many = [F('d%d/보고서_%d_v%d.txt' % (i % 50, i, i % 3), '보고서 %d 내용' % i) for i in range(6000)]
t0 = time.time(); docs.plan_docs(many, core.DEFAULT_AREAS, today=TODAY); sec_ = time.time() - t0
ok('파일 6,000개 계획이 10초 안(판 묶기가 제곱으로 느려지지 않음)', sec_ < 10, '%.1fs' % sec_)

print('\n통과 %d · 실패 %d' % (P, F_))
sys.exit(1 if F_ else 0)
