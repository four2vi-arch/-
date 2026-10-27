# 돌다리 v3.8 결과물 시험: 10.26. 독립 검토(결과물 관점 18건)에서 잡은 것. 가상 자료만, 서버 없이 docs·export·server 함수로 확인한다.
# 사용: python 시험/output38_test.py
import os, sys, re, json, datetime, hashlib
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import docs, export, core

P = F_ = 0
def ok(name, cond, extra=''):
    global P, F_
    P += bool(cond); F_ += (not cond)
    print(('통과  ' if cond else '실패  ') + name + (' · ' + str(extra) if extra and not cond else ''))

def F(path, text, mtime='2026-09-01'):
    return {'file': path, 'kind': os.path.splitext(path)[1][1:], 'chars': len(text), 'mtime': mtime, 'units': [{'text': text, 'loc': '본문'}], 'sha': hashlib.sha256((path + text).encode()).hexdigest()}

TODAY = datetime.date(2026, 10, 26)
def build(files, prev=None, **kw):
    a = dict(today=TODAY, prev_items=prev); a.update(kw)
    return docs.build_docs(files, core.DEFAULT_AREAS, 12, a.pop('model', 'none'), **a)
def session(items, info, **kw):
    s = {'items': items, 'info': info, 'areas': core.DEFAULT_AREAS, 'overview': {}, 'assets': {}, 'months': 12, 'failures': [], 'files': [], 'fingerprints': [], 'model': '없음', 'version': 'x', 'title': 't',
         'handover_from': '', 'handover_to': '', 'witness': '', 'handover_date': '', 'org': ''}
    s.update(kw); return s
def allout(s):
    return export.to_markdown(s) + export.to_html(s) + export.to_onnara_txt(s)
def cell(md, head, key):
    """표 머리(head)가 있는 절에서 key가 든 줄"""
    sec = md.split(head, 1)[1] if head in md else ''
    return next((l for l in sec.split('\n') if key in l), '')

# 1. 주민등록번호·두 값 비밀번호·로그인 아이디 가림
m = docs.mask_secret
ok('주민등록번호 뒷자리 가림', m('청구인 홍가상(주민등록번호 801231-1000000) 서류 보완') == '청구인 홍가상(주민등록번호 801231-●●●●●●●) 서류 보완')
ok('외국인등록번호도 가림', '5000000' not in m('외국인등록번호 801231-5000000 청구 건') and docs.has_secret('801231-5000000'))
ok('전화·계좌·날짜는 그대로', m('☎ 063-000-1235 · 계좌 123456-78-901234 · 2026-03-02') == '☎ 063-000-1235 · 계좌 123456-78-901234 · 2026-03-02')
two = m('비밀번호 바꿈(기존 gaon2025 → 신규 Gaon2026!), 11월 5일까지 알림')
ok('「기존 → 신규」 두 값 모두 가림, 날짜는 남김', 'gaon2025' not in two and 'Gaon2026' not in two and '11월 5일까지' in two, two)
ok('「로그인: 아이디」도 가림', 'gaon_kim' not in m('로그인: gaon_kim, 비밀번호: kim!2026') and 'kim!2026' not in m('로그인: gaon_kim, 비밀번호: kim!2026'))
items, _, _, info = build([F('보상/손해배상 청구 회신.txt', '손해배상 청구 회신\n2026. 10. 2.\n청구인 홍가상(주민등록번호 801231-1000000) 위임장을 11월 7일까지 보완하여 회신 바랍니다.\n※ 문의 : 고객지원과 이가상 주무관(☎ 063-000-1235)'),
                           F('옛/2024_업무계정_비번_gaon1234.txt', '2024년 계정 메모 비밀번호 gaon1234', '2024-01-05')])
out = allout(session(items, info, handover_date='2026-10-30'))
ok('결과물(md·인쇄·온나라) 어디에도 등록번호 뒷자리 없음', '1000000' not in out and '801231-●' in out)
ok('붙임 1(기간 밖) 제목의 비밀번호도 가림', 'gaon1234' not in out and all('gaon1234' not in d['title'] for d in info['docs_old']), [d['title'] for d in info['docs_old']])

# 2. 자를 때 「…」, 문서 날짜는 「시행 부서-번호 (날짜)」 줄
ok('cut은 「…」를 붙인다', docs.cut('가나다라마바사아자차', 5) == '가나다라…' and docs.cut('짧다', 5) == '짧다')
ok('이름 202509 + 본문 시행일 → 시행일', docs.doc_date({'file': 'x/07_영업과1612_202509_점검.odt'}, '제목\n시행 영업과-1612 (2025. 9. 15.) 접수 2025. 9. 16.') == ('2025-09-15', '본문(시행)'))
ok('이름에 날짜 없고 「1. 관련: …(날짜)」가 먼저 와도 시행일', docs.doc_date({'file': 'x/협조요청.odt'}, '1. 우편영업과-3310(2025. 10. 2., 우수사례) 관련\n2. 다음과 같이 요청\n시행 영업과-1803 (2025. 10. 16.)') == ('2025-10-16', '본문(시행)'))
ok('이름의 연월만 알면 달까지만 적는다', export.dshow({'date': '2025-09-01', 'date_src': '파일 이름(월)'}) == '2025-09')

# 3. 미결 항목의 할 일·원문이 1-라에, 현안 근거 줄(재협의·아직 안 옴·미조치)이 발췌에
memo = F('메모/메모_매대.txt', '[메모] 매대\n2026. 2. 20.\n- 가온배 5kg 재고 12개, 유통기한 2026.2.28.\n- 농협 이하람 담당에게 반품 요청(1.15). "반품은 어렵고 교환은 가능"이라 함. 결론 못 냄.\n- 2월 중 교환 또는 할인 판매 결정해야 함.')
gong = F('공문/요금후납 점검 결과 보고.txt', '요금후납 계약업체 우편물 발송 현황 점검 결과 보고\n시행 영업과-1612 (2025. 9. 15.)\n가. 점검결과 : 월평균 발송 통수 전년 대비 4.2% 증가\n나. 조치사항 : 미납 업체에 9월 30일까지 납부를 독촉\n다. 계약변경 : 2개소는 발송 물량 감소로 계약 조건 재협의 필요', '2025-09-15')
hoe = F('회의록/과 업무회의 회의록 202510.txt', '과 업무회의 회의록\n2025. 10. 20.\n2. 경비 정산\n1건은 영수증을 찾지 못해 미조치 상태입니다.\n담당자가 11월 10일까지 처리해야 합니다.', '2025-10-20')
items, _, _, info = build([memo, gong, hoe], today=datetime.date(2026, 3, 2))
it_memo = next(i for i in items if i['file'] == memo['file'])
ok('「결론 못 냄」 메모는 미결 제안, 할 일은 「결정해야 함」 줄', it_memo['status'] == '미결' and '결정해야' in it_memo['todo'], (it_memo['status'], it_memo['todo']))
md = export.to_markdown(session(items, info, handover_date='2026-03-02'))
row = cell(md, '라. 주요 미결사항', '메모 매대')
ok('1-라 줄에 다음·할 일·원문이 모두', '다음:' in row and '할 일: - 2월 중 교환' in row and '원문:' in row, row)
it_g = next(i for i in items if i['file'] == gong['file'])
ok('현안 근거 줄 「재협의 필요」가 원문 발췌에', '재협의 필요' in it_g.get('quote', ''), it_g.get('quote'))
it_h = next(i for i in items if i['file'] == hoe['file'])
ok('「미조치 상태」 줄이 원문 발췌에', '미조치' in it_h.get('quote', ''), it_h.get('quote'))

# 4. 모델 값 검증: 담당은 이름·전화가 같은 원문 줄에 있을 때만, 할 일에 문서에 없는 날짜가 들면 버림, 비우면 규칙 할 일 유지, 결과물에 (AI) 표시와 원문
plain = F('공문/추석 특별소통.txt', '2026년 추석 명절 소포우편물 특별소통 대책 추진\n시행 영업과-1510 (2026. 8. 13.)\n다. 계약소포 : 요금후납 계약업체에 발송 예정 물량을 9월 11일까지 통보하도록 안내\n※ 문의 : 영업과 김도현 주무관(☎ 063-000-0202)', '2026-08-13')
mail = F('메일/우수사례 재제출.txt', 'RE: 우편영업 우수사례 제출\n2025. 10. 14.\n서진우 실장님, 서식에 수치가 빠져 반려합니다.\n수치를 넣어 10월 17일까지 다시 보내 주세요.\n우편영업과 민서현 주무관 063-000-0101', '2025-10-14')
def fake(f):
    if '추석' in f['file']:
        return json.dumps({'요지': '추석 특별소통 대책 안내', '할 일': '12월 31일까지 계약 해지 공문 발송', '기한': '2026-12-31', '담당': '홍가짜 주무관 063-000-0202', '상태': '진행 중'}, ensure_ascii=False)
    return json.dumps({'요지': '우수사례 서식 재제출 요청', '할 일': '', '기한': '', '담당': '서진우 주무관 063-999-0000', '상태': '진행 중'}, ensure_ascii=False)
items, calls, errors, info = build([plain, mail], model='fake-model', fake=fake, today=datetime.date(2026, 3, 2))
a = next(i for i in items if '추석' in i['file']); b = next(i for i in items if '우수사례' in i['file'])
ok('모델이 문서 전화에 다른 이름을 붙이면 담당 버림', a.get('owner', '') == '' and a['src'] == '모델', a.get('owner'))
ok('모델이 문서 이름에 다른 전화를 붙이면 담당 버림', b.get('owner', '') == '', b.get('owner'))
ok('문서에 없는 날짜(12월 31일)가 든 모델 할 일은 버리고 규칙 할 일 유지', '해지' not in a['todo'] and '9월 11일까지' in a['todo'] and a.get('todo_src') == '원문', a['todo'])
ok('모델이 할 일을 비우면 규칙 할 일 그대로', '10월 17일까지' in b['todo'], b['todo'])
ok('지어낸 기한(2026-12-31)은 채택되지 않음', a['due_next'] != '2026-12-31')
md = export.to_markdown(session(items, info, handover_date='2026-03-02'))
row = cell(md, '다. 현안사항', '추석 특별소통 (영업과-1510)')
ok('1-다 줄에 「요지(AI):」와 「원문:」이 함께, 담당은 규칙 연락처', '요지(AI):' in row and '원문:' in row and '김도현 063-000-0202' in row and '(AI)' not in row.split('|')[5], row)
b0 = build([plain], today=datetime.date(2026, 3, 2))
ok('규칙만 항목에는 (AI) 표시가 없다', '(AI)' not in cell(export.to_markdown(session(b0[0], b0[3])), '다. 현안사항', '추석 특별소통 (영업과-1510)'))

# 5. 「매년 N월」은 문장 속 달, 달이 없으면 「매년」, 반복 문장의 업무는 줄 위의 제목·줄 속 꼬리표
man = F('매뉴얼/요금후납 업무매뉴얼.txt', '요금후납 업무 매뉴얼\n2025. 11. 1.\n1. 기록물\n가. 보존기간이 지난 기록물은 매년 11월에 기록관으로 이관한다.\n나. 매년 자체감사를 받는다.\n2. 창구전시판매\n가. 매주 금요일 매대 재고를 점검하고 판매대장에 기록한다.\n나. 판매대금은 익월 10일까지 공급업체에 정산한다.', '2026-10-09')
items, _, _, info = build([man])
rec = [i for i in items if i.get('rkey')]
r11 = next((i for i in rec if '기록관' in i['title']), None)
ok('「매년 11월에 이관」의 시기는 11월(파일 수정일 10월이 아님)', r11 and r11['recur'].get('month') == 11 and export.cycle_label(r11) == '11월', r11 and (r11['recur'], export.cycle_label(r11)))
ok('달이 없는 「매년 …」은 시기 「매년」(파일 날짜의 달이 아님)', export.cycle_label({'recur': {'cycle': '매년'}, 'date': '2026-10-09', 'when': '매년'}) == '매년')
rF = next((i for i in rec if '매대 재고' in i['title']), None); rJ = next((i for i in rec if '판매대금' in i['title']), None)
ok('매뉴얼 줄의 업무는 위 제목 「2. 창구전시판매」로(문서 전체의 요금후납이 아님)', rF and rF['area'] == '창구전시판매' and rJ and rJ['area'] == '창구전시판매', (rF and rF['area'], rJ and rJ['area']))
ok('반복 제목은 글머리 기호 없이 원문 그대로', rF and rF['title'].startswith('매주 금요일') and rF['todo'].endswith('기록한다.'), rF and (rF['title'], rF['todo']))
plan = F('계획/2025년 우편매출액 목표 달성 세부추진계획.txt', '2025년 우편매출액 목표 달성 세부추진계획\n2025. 3. 20.\nㅇ (창구전시판매) 민원실 매대에 우체국쇼핑 지역특산품 6종 진열, 매주 금요일 재고 점검\nㅇ (월별 점검) 매월 5일까지 전월 실적 집계 후 과장 보고', '2025-03-20')
items, _, _, info = build([plan], today=datetime.date(2026, 3, 2))
rT = next((i for i in items if i.get('rkey') and '특산품' in i['title']), None); rM = next((i for i in items if i.get('rkey') and '전월 실적' in i['title']), None)
doc_area = next(i for i in items if not i.get('rkey'))['area']
ok('줄 앞 「(창구전시판매)」 꼬리표면 그 업무, 꼬리표 없는 줄은 문서 업무', rT and rT['area'] == '창구전시판매' and rM and rM['area'] == doc_area, (rT and rT['area'], rM and rM['area'], doc_area))
long_line = '2. 2026년도 우편매출액 목표를 붙임과 같이 배정하니 관서별 실적표와 세부추진계획을 붙임 서식(엑셀)에 따라 수립하여 지방우정청 우편영업과로 2026. 3. 13.(금)까지 제출하여 주시기 바랍니다.'
items, _, _, info = build([F('공문/목표 배정.txt', '수신 내부결재\n제목 2026년도 우편매출액 목표 배정 알림\n시행 우편영업과-658 (2026. 2. 18.)\n' + long_line, '2026-02-18')], today=datetime.date(2026, 3, 2))
it = next(i for i in items if not i.get('rkey'))
ok('110자가 넘는 원문 줄의 할 일은 「…」로 끝난다(말없이 끊기지 않음)', len(long_line) > 110 and it['todo'].endswith('…') and len(it['todo']) <= 110, (len(long_line), it['todo'][-20:]))

# 6. 끝줄은 본문 항목 기준, 인수 직후 할 일 「외 n건」, 직접 적은 현안의 시기, 문서·연혁·현황 메모
items, _, _, info = build([F('공문/기한 %02d.txt' % i, '기한 공문 %d\n시행 영업과-%d (2026. 10. 1.)\n자료를 11월 %d일까지 제출 바랍니다.' % (i, 1000 + i, i), '2026-10-01') for i in range(1, 26)] +
                          [F('표/요금후납 계약현황.txt', '요금후납 계약현황\n업체|담당|전화\n한결물류|오세린|063-000-0808\n', '2026-09-01')])
s = session(items, info, handover_date='2026-10-26')
md = export.to_markdown(s)
foot = next(l for l in md.split('\n') if '본문 항목' in l)
nums = [int(x) for x in re.findall(r'\d+', foot.split('본문 항목')[1])]
ok('끝줄 「본문 항목」 = 본문에 실은 항목 수 = 규칙만+모델+직접, 붙임 1 확인 전 수도 적음', nums[0] == len(export.kept_docs(s)) == sum(nums[1:4]) and '붙임 1 확인 전 문서 %d' % len(export.pending_docs(s)) in foot, foot)
ok('인수 직후 할 일은 20건 뒤에 「외 n건」', '외 5건(1-다 현안 표 참고)' in md, [l for l in md.split('\n') if '외 ' in l][:2])
items.append({'id': 999, 'file': '', 'cls': '직접 입력', 'date': '', 'when': '매주 금요일', 'title': '직접 적은 현안', 'area': '기타', 'due': [], 'due_next': '', 'contacts': [], 'kind3': '현안', 'todo': '열쇠 반납', 'src': '직접 입력', 'keep': True, 'decided': True, 'status': '진행', 'note': '', 'quote': ''})
doc_it = next(i for i in items if i['kind3'] == '현황'); doc_it.update(keep=True, decided=True, note='매년 4월 갱신 공문의 본보기', todo='올해 갱신 접수 대장 확인', todo_by='사람')
md = export.to_markdown(s)
ok('직접 적은 현안의 「매주 금요일」이 1-다 줄에', '매주 금요일' in cell(md, '다. 현안사항', '직접 적은 현안'))
ok('현황 자료의 메모·할 일이 1-가 현황 칸에', '메모: 매년 4월 갱신' in cell(md, '가. 담당 업무', '요금후납 계약현황'), cell(md, '가. 담당 업무', '요금후납 계약현황'))

# 7. 4절 연락처는 한 목록(contact_rows): 명단 항목을 버리면 그 연락처도 빠짐, 확인 전 문서 연락처는 [확인 전]
rows = export.contact_rows(s)
ok('명단 연락처(오세린)가 목록에 있고 출처 「(명단)」', any(r['name'] == '오세린' and r['src'] == '명단' for r in rows), [(r['name'], r['src']) for r in rows][:5])
s['contact_excl'] = ['063-000-0808']   # 전임자가 4절에서 「빼기」 한 번호
ok('4절에서 뺀 번호는 목록·결과물에서 빠짐', not any(r['phone'] == '063-000-0808' for r in export.contact_rows(s)) and '063-000-0808' not in export.to_markdown(s).split('관계자 연락처', 1)[1].split('인수자 질문')[0])
s['contact_excl'] = []
doc_it.update(keep=False)
rows2 = export.contact_rows(s)
ok('명단 문서를 버리면 그 연락처도 빠짐', not any(r['name'] == '오세린' for r in rows2))
md = export.to_markdown(s)
ok('내려받는 4절도 같은 목록(오세린 없음)', '오세린' not in md.split('관계자 연락처', 1)[1].split('인수자 질문')[0])

# 8. 온나라 복사 글의 「(지남)」 기준도 인계 일자(새 서버에서 복사부터 해도)
items, _, _, info = build([F('공문/실적 제출.txt', '연말연시 실적보고\n시행 영업과-2015 (2025. 11. 17.)\n기간 중 접수 실적을 1월 12일까지 영업과로 제출', '2025-11-17'),
                           F('공문/계획 제출.txt', '목표 배정 알림\n시행 영업과-658 (2026. 2. 18.)\n세부추진계획을 3월 13일까지 제출하여 주시기 바랍니다.', '2026-02-18')], today=datetime.date(2026, 3, 2))
s = session(items, info, handover_date='2026-03-02')
export._REF = None   # 서버를 막 켠 상태(내려받기 전)
on = '\n'.join(t for _, t in export.onnara_sections(s))
l1 = next((l for l in on.split('\n') if '2026-01-12' in l), ''); l2 = next((l for l in on.split('\n') if '2026-03-13' in l), '')
ok('복사 글: 1월 12일은 (지남), 3월 13일은 지남 아님(인계 일자 2026-03-02 기준)', '(지남)' in l1 and '(지남)' not in l2, (l1[:80], l2[:80]))

# 9. 연도 없는 기한(「11월 30일」「12.1」「3/20」)은 인계 일자의 연도로
try:
    import server
    server.STATE['handover_date'] = '2026-03-02'; server.STATE['info'] = {}
    ok('「11월 30일」 → 2026-11-30, 「12.1」 → 2026-12-01, 「3/20」 → 2026-03-20', server.iso_date('11월 30일') == '2026-11-30' and server.iso_date('12.1') == '2026-12-01' and server.iso_date('3/20') == '2026-03-20', (server.iso_date('11월 30일'), server.iso_date('12.1')))
    server.STATE['handover_date'] = '2026-11-20'
    ok('기준 달(11월)보다 두 달 넘게 이른 「1월 15일」은 이듬해', server.iso_date('1월 15일') == '2027-01-15' and server.iso_date('2026.11.3') == '2026-11-03', server.iso_date('1월 15일'))
except Exception as e:
    ok('server.iso_date 불러오기', False, e)

print('\n통과 %d · 실패 %d' % (P, F_))
sys.exit(1 if F_ else 0)
