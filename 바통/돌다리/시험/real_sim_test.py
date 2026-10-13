#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""돌다리 실제 조건 모의 시험(v3.3): 사용자 폴더와 같은 꼴(업무 이름 폴더 17개, 「YYYYMMDD_NN_제목」 파일 이름, 공문 PDF+붙임 hwpx·xlsx, 스캔 PDF,
.cell, 이름만 .xlsx인 옛 .xls, 대문자 확장자, 누적 매뉴얼 md(반영 이력), 길라잡이 docx+md, 99_미분류)을 만들어 서버 API를 사용자 순서대로 누른다.
서버를 실제 프로세스로 띄우고(가짜 모델 포함) 읽기 → 초안 → 카드 고치기(절·업무·날짜 글) → 내보내기 → 재시작 → 다시 초안(재사용) → 내보내기까지.
실행: python real_sim_test.py [작업폴더]
"""
import os, sys, re, json, time, shutil, tempfile, zipfile, subprocess, urllib.request, urllib.parse, random
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT); sys.path.insert(0, os.path.join(ROOT, '도구'))
from build_odt import build as build_odt
from build_hwpx import build as build_hwpx
import openpyxl
WORK = sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.gettempdir(), '돌다리_실제조건시험')
shutil.rmtree(WORK, ignore_errors=True); os.makedirs(WORK)
SRC = os.path.join(WORK, '업무폴더'); PORT, FAKE = 8798, 11436
ok, bad = [], []
def check(name, cond, extra=''):
    (ok if cond else bad).append(name + (' · ' + extra if extra else ''))
    print(('통과  ' if cond else '실패  ') + name + (' · ' + extra if extra else ''), flush=True)

# ---------------- 1. 사용자 폴더 꼴 만들기
FOLDERS = ['00_업무총괄·규정·매뉴얼·서식', '02_창구운영·요금납부', '03_우표류·수탁상품', '04_우체국쇼핑·창구전시판매', '05_고객만족CS·전광판', '06_KPCSI', '07_민원·손해배상',
           '08_우편CRM·다량우편', '09_마케팅_추진', '10_전략상품·준등기', '11_우취문화', '12_국제우편', '13_이벤트·명절마케팅', '15_우편통계·자접자배', '16_안부살핌·복지사업', '17_실적·목표·평가', '99_미분류_확인필요']
for f in FOLDERS:
    os.makedirs(os.path.join(SRC, f), exist_ok=True)
random.seed(11)
def gongmun(folder, date, seq, no, title, due_line, extra=None, to_pdf=False):
    body = ['1. 관련 : 우편영업과-%d(%s)' % (random.randint(100, 4000), date), '', '2. %s을 다음과 같이 알려드리니 협조하여 주시기 바랍니다.' % title,
            ' 가. ' + due_line, ' 나. 담당 : 영업과 홍길순(☎ 063-530-7771)', ' 다. 보기 : 담당자 02-123-4567 / 관련 000-0000-0000'] + (extra or []) + ['', '붙임  관련 자료 1부.  끝.', '', '정읍우체국장', '시행 %s (%s)  접수' % (no, date)]
    y, m, dd = [int(x) for x in re.findall(r'\d+', date)]
    fn = '%04d%02d%02d_%02d_%s' % (y, m, dd, seq, re.sub(r'[/\\:*?"<>|]', '_', title))
    path = os.path.join(SRC, folder, fn + '.odt')
    build_odt(out=path, 수신='수신자 참조', 제목=title, 본문=body)
    if to_pdf:
        try:
            subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', os.path.join(SRC, folder), path], capture_output=True, timeout=120)
            if os.path.exists(path[:-4] + '.pdf'):
                os.remove(path)
        except Exception:
            pass
    return fn
# 2026년 9~10월 공문 40건 + 붙임, 2024~2025년 반복 공문, 연혁 문서
titles = ['안부살핌 우편서비스 대상자 명단 송부(%d차)', '국제선편소포 과오취급 현황 알림', '우체국쇼핑 추석 한가위 장터 운영 계획 알림', '2026년 고객만족도(KCSI) 1위 선정에 따른 홍보 추진 알림',
          '등기통상 다량 발송고객 접수정보 등록 안내 강화 알림', '국제반신우표권 서비스 폐지 및 아비장권 판매 재개 안내', '우편물 정기발송 이용계약 체결', '모바일 영수증 재발행 제도 개선 안내',
          '4분기 통상우편 마케팅 추진계획 수립·시행', '위조된 우편물 도착안내서 관련 조치사항 안내', '2026년 신규직원 CS 교육 실시 알림', '군사우편 정산내역 알림']
n = 0
for i in range(40):
    folder = FOLDERS[1 + (i % 15)]
    day = 1 + (i % 28); mon = 9 if i < 25 else 10
    date = '2026. %d. %d.' % (mon, day)
    t = titles[i % len(titles)] % (3 + i // 12) if '%d' in titles[i % len(titles)] else titles[i % len(titles)]
    if i % 3 == 0:
        t = t + '(%d)' % i
    seq = 1 + (i % 4) * 3
    fn = gongmun(folder, date, seq, '우편영업과-%d' % (4000 + i), t, '%d월 %d일까지 회신' % (mon if day < 20 else mon + 1, (day + 10) % 28 + 1), to_pdf=(i < 6))
    n += 1
    # 붙임: 같은 날짜, 순번 +1·+2 (hwpx·xlsx)
    d8 = fn[:8]
    build_hwpx(template=os.path.join(ROOT, '도구', 'template.hwpx'), out=os.path.join(SRC, folder, '%s_%02d_(붙임1) %s 세부계획.hwpx' % (d8, seq + 1, t[:12])), title='(붙임1) ' + t[:12], body_lines=['□ 추진 개요', 'ㅇ (목적) ' + t, 'ㅇ (기한) %d월 말까지' % mon], head='붙임')
    wb = openpyxl.Workbook(); ws = wb.active; ws.append(['번호', '국명', '담당', '전화']); [ws.append([k, '정읍%d국' % k, '담당%d' % k, '063-000-%04d' % k]) for k in range(1, 12)]
    wb.save(os.path.join(SRC, folder, '%s_%02d_(붙임2) %s 현황.xlsx' % (d8, seq + 2, t[:10])))
# 반복 공문(2024·2025·2026 같은 제목)
for y in (2024, 2025, 2026):
    gongmun('13_이벤트·명절마케팅', '%d. 8. 20.' % y, 1, '우편영업과-%d' % (1500 + y), '%d년 추석 명절 소포우편물 특별소통 대책 추진' % y, '9월 10일까지 통보')
    gongmun('17_실적·목표·평가', '%d. 2. 10.' % y, 1, '우편영업과-%d' % (600 + y), '%d년도 우편매출액 목표 배정 알림' % y, '3월 13일까지 제출')
# 연혁(기간 밖, 전환점 말)
gongmun('02_창구운영·요금납부', '2023. 5. 2.', 1, '영업과-800', '우편요금 후납 계약 체결(가온물류)', '5월 30일까지 서류 제출')
gongmun('16_안부살핌·복지사업', '2025. 3. 4.', 1, '영업과-310', '안부살핌 우편서비스 업무협약 체결(정읍시)', '3월 31일까지 협약서 제출')
# 00_업무총괄: 매뉴얼 md(반영 이력), 길라잡이 docx+md, 사무관리비 지침 pdf(스캔 흉내)
rows = ['| 버전 | 일자 | 반영 내용 | 문서번호 | 반영 위치 |', '| --- | --- | --- | --- | --- |'] + ['| v%d | ’26.10.12. | %s | 우편영업과-%d | Ⅳ-1 |' % (50 + k % 2, titles[k % len(titles)].replace('%d', '3'), 4000 + k) for k in range(0, 40, 4)]
open(os.path.join(SRC, '00_업무총괄·규정·매뉴얼·서식', '정읍우체국_우편영업실장_업무매뉴얼_v51.md'), 'w', encoding='utf-8').write('# 업무매뉴얼 v51\n\n# 반영 이력\n\n' + '\n'.join(rows) + '\n\n# Ⅳ. 업무\n\n매월 5일 실적 보고. 안부살핌 우편서비스 3차 발송.\n')
open(os.path.join(SRC, '00_업무총괄·규정·매뉴얼·서식', '정읍우체국_우편영업실장_업무매뉴얼_v49.md'), 'w', encoding='utf-8').write('# 업무매뉴얼 v49\n\n옛 판.\n')
sys.path.insert(0, ROOT)
from make_mock import write_docx, write_eml
G = ['국제우편 길라잡이 (2026 개정판)', '제1장 국제우편 상품 및 요금', '1.1 상품 종류', 'EMS프리미엄 배터리 창구 접수(2026. 7. 1. 시행)', 'K-Packet 취급국가 51개국']
write_docx(os.path.join(SRC, '00_업무총괄·규정·매뉴얼·서식', '국제우편_길라잡이_2026_10.docx'), G)
open(os.path.join(SRC, '00_업무총괄·규정·매뉴얼·서식', '국제우편_길라잡이_2026_10.md'), 'w', encoding='utf-8').write('# ' + G[0] + '\n\n' + '\n\n'.join(G[1:]) + '\n')
# 스캔 PDF(글자 없음) · .cell · 이름만 .xlsx인 옛 .xls · 대문자 확장자 · 긴 이름
from PIL import Image, ImageDraw, ImageFont
_img = Image.new('L', (2480, 3508), 255); _d = ImageDraw.Draw(_img)
try:
    _font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 56)
except Exception:
    _font = ImageFont.load_default()
for _i, _l in enumerate(['JEONGEUP POST OFFICE', 'Subject: KCSI banner notice 2026', 'Submit by 2026-10-31. Contact 063-530-7771']):
    _d.text((200, 300 + _i * 120), _l, font=_font, fill=0)
_img.rotate(0.8, expand=False, fillcolor=255).save(os.path.join(SRC, '05_고객만족CS·전광판', '20260922_19_2026년 한국산업의 고객만족도 1위 달성 현수막.pdf'), 'PDF', resolution=300.0)
Image.new('RGB', (600, 800), 'white').save(os.path.join(SRC, '07_민원·손해배상', '20260930_09_빈 스캔.pdf'))
open(os.path.join(SRC, '10_전략상품·준등기', '20261012_11_통상우편 전략상품 이벤트 실적현황(7.1.-9.30.).cell'), 'wb').write(os.urandom(2000))
open(os.path.join(SRC, '16_안부살핌·복지사업', '20261008_02_4차 안부살핌 우편서비스 지원대상자 명단(최종).xlsx'), 'wb').write(b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1' + b'\x00' * 2000)
shutil.copy(os.path.join(ROOT, '모의데이터', '가온우체국_모의업무폴더', '02_보고서·계획(한글)', '03_2026년_우편영업_업무_추진계획_초안_.hwpx'), os.path.join(SRC, '00_업무총괄·규정·매뉴얼·서식', '20261006_19_제5절 우편사서함 사용계약.HWPX'))
wb = openpyxl.Workbook(); ws = wb.active; ws.append(['월', '목표', '실적']); [ws.append(['%d월' % m, 1000 + m, 990 + m]) for m in range(1, 10)]
wb.save(os.path.join(SRC, '17_실적·목표·평가', '20261006_12_★2026년 8월 경영평가 수지율 개선도_261004.xlsx'))
wb.save(os.path.join(SRC, '17_실적·목표·평가', '20260906_02_★2026년 7월 경영평가 수지율 개선도_260904.xlsx'))
write_eml(os.path.join(SRC, '12_국제우편', '20261012_15_(공유) 국제우편 관련 안내사항 공유.eml'), '우편영업과 <a@example.kr>', '정읍 <b@example.kr>', '(공유) 국제우편 관련 안내사항 공유', '사우디행 국제우편 접수 중단(10. 12.~). K-Packet 전국가 확대 예정(11월 말~).\n문의 : 우편영업과 담당 063-240-0000', __import__('datetime').datetime(2026, 10, 12, 9, 0))
write_docx(os.path.join(SRC, '99_미분류_확인필요', '20260918_02_1. 2026년 4분기_세출예산 정기재배정 내역서.docx'), ['4분기 세출예산 정기재배정 내역서', '사무관리비 1,200천원 / 10월 31일까지 집행'])
long = os.path.join(SRC, '12_국제우편', '20261001_11_' + '국제항공우편물 과오취급 청별 누계 상세내역 ' * 3 + '(2026. 8월).xlsx'); wb.save(long)
check('폴더 만들기', True, '%d개 파일' % sum(len(f) for _, _, f in os.walk(SRC)))

# ---------------- 2. 서버·가짜 모델 띄우기
def api(path, body=None, port=None):
    req = urllib.request.Request('http://127.0.0.1:%d%s' % (port or PORT, path), data=None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8'), headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode('utf-8') or '{}')
fake = subprocess.Popen([sys.executable, os.path.join(HERE, 'fake_ollama.py'), str(FAKE)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
LOGW = os.path.join(WORK, '작업')
def start_server():
    p = subprocess.Popen([sys.executable, os.path.join(ROOT, 'server.py'), '--port', str(PORT), '--work', LOGW, '--no-browser'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
    time.sleep(1.5); return p
srv = start_server()
def wait(key, secs=180):
    for _ in range(secs * 5):
        st = api('/api/state')[1]
        if not st.get(key):
            return st
        time.sleep(0.2)
    return api('/api/state')[1]
try:
    st0 = api('/api/state')[1]; has_rapid = bool((st0.get('ocr_status') or {}).get('rapidocr', {}).get('ok'))
    code, r = api('/api/settings', {'ocr': 'rapidocr' if has_rapid else 'off', 'ocr_pages': 3}); check('OCR 설정 저장', code == 200, 'rapidocr %s' % has_rapid)
    code, r = api('/api/extract', {'folder': SRC, 'exclude': []}); check('읽기 시작', code == 200 and r.get('started'))
    st = wait('extracting')
    check('읽기 결과: 못 읽은 문서가 빈 스캔·cell·옛 xls', st['n_fail'] >= 3 and st['files'] and len(st['files']) > 90, '읽음 %d · 못 읽음 %d · 읽지 않음 %d · OCR %d' % (len(st['files']), st['n_fail'], st['n_skip'], st.get('n_ocr', 0)))
    if has_rapid:
        check('스캔 PDF를 OCR로 읽음(영문·숫자)', st.get('n_ocr', 0) >= 1 and any(f.get('ocr') and '현수막' in f['file'] for f in st['files']))
        check('빈 스캔 PDF는 「글자를 읽지 못함」으로', any('읽지 못함' in x['reason'] for x in api('/api/state')[1]['failures']))
        check('OCR 캐시 생성', os.path.isdir(os.path.join(LOGW, 'ocr_cache')) and len(os.listdir(os.path.join(LOGW, 'ocr_cache'))) >= 1)
    check('업무를 폴더 이름으로 나눔', st.get('areas_src') == '폴더' and any(a.startswith('창구운영') for a in st['areas_text'].split('\n')), st['areas_text'].split('\n')[1][:30])
    p = st['plan']; check('계획: 붙임이 공문에 접힘(붙임 수 ≥ 60)', p['n_attach'] >= 60, json.dumps({k: p[k] for k in ('n_items', 'n_issue', 'n_recur', 'n_hist', 'n_status', 'n_old', 'n_attach')}, ensure_ascii=False))
    check('계획: 반복 업무 1건 이상(현안이기도 한 것은 현안으로 셈)', p['n_recur'] >= 1, str(p['n_recur']))
    code, r = api('/api/settings', {'model': 'fake-exaone:test', 'url': 'http://127.0.0.1:%d/v1/chat/completions' % FAKE, 'months': 12}); check('모델 설정', code == 200)
    code, r = api('/api/draft', {}); check('초안 시작', code == 200)
    st = wait('running'); items = api('/api/items')[1]['items']
    check('초안: 항목 수가 파일 수보다 훨씬 적음(붙임·중복 접힘)', 0 < len(items) < len(st['files']) * 0.6, '%d / %d' % (len(items), len(st['files'])))
    info = st['info']; check('매뉴얼 v51 md 자동 인식(v49 아님)', info['manual'].endswith('v51.md') and info['manual_refs'] >= 10, '%s · 문서번호 %d' % (os.path.basename(info['manual']), info['manual_refs']))
    check('★ 미반영 공문 수 = 전체 공문 - 반영 10건 근처', 20 <= info['n_unreflected'] <= 40, str(info['n_unreflected']))
    check('길라잡이 docx·md 중복 하나만', sum(1 for i in items if '길라잡이' in i['title']) == 1)
    check('대문자 .HWPX 읽힘', any(i['file'].endswith('.HWPX') for i in items))
    check('긴 이름 xlsx가 현황 자료로', any('과오취급' in i['title'] and i['kind3'] == '현황' for i in items))
    check('경영평가 수지율 xlsx는 최신판 하나만 현황', sum(1 for i in items if '수지율' in i['title'] and i['kind3'] == '현황') == 1)
    check('공문은 폴더 이름 업무로 분류(소포 섞임 없음)', all(docs_area_ok for docs_area_ok in [i['area'] == re.sub(r'^\d+_', '', i['file'].split('/')[0]) for i in items if i['cls'] == '공문' and not i['file'].startswith(('00_', '99_'))]))
    check('보기 번호(123-4567·000-0000-0000) 제외, 실제 번호는 실림', not any(c['phone'] in ('02-123-4567', '000-0000-0000') for i in items for c in i['contacts']) and any(c['phone'] == '063-530-7771' for i in items for c in i['contacts']))
    check('기간 안 공문에 연혁 꼬리표 남발 없음(센 말만)', sum(1 for i in items if i['hist'] and i['kind3'] != '연혁') <= 6, str(sum(1 for i in items if i['hist'] and i['kind3'] != '연혁')))
    check('기간 밖 전환점 문서가 연혁으로', sum(1 for i in items if i['kind3'] == '연혁') >= 2, str(sum(1 for i in items if i['kind3'] == '연혁')))
    check('해마다 오는 공문 2묶음(추석·목표 배정) 찾음', len({tuple(i['recur']['years']) + (i['recur']['month'],) for i in items if i.get('recur')}) >= 2)
    check('붙임 xlsx가 현황 자료로 따로 오르지 않음', not any('(붙임2)' in i['title'] for i in items))
    check('모델 요지 붙음·오류 0', sum(1 for i in items if i['src'] == '모델') >= 10 and not st['errors'], '모델 %d · 호출 %d' % (sum(1 for i in items if i['src'] == '모델'), len(st['calls'])))
    # 사용자 조작: 절 바꾸기(연혁·현황), 업무 바꾸기, 미결, 직접 적기(날짜 글), 일괄 넣기
    first = [i for i in items if i['kind3'] == '현안'][:3]
    code, r = api('/api/items', {'changes': [{'id': first[0]['id'], 'kind3': '연혁'}, {'id': first[1]['id'], 'kind3': '현황'}, {'id': first[2]['id'], 'area': '기타', 'status': '미결', 'next': '회신 대기', 'keep': True, 'decided': True}],
                                 'add': [{'kind3': '반복', 'title': '소속국 실적 산출', 'date': '매주 화요일', 'todo': '포스트넷에서 기초자료 추출', 'area': '실적·목표·평가'}, {'kind3': '현안', 'title': '직접 현안', 'date': '2026년 10월 14일'}]})
    items = r['items']; check('절 바꾸기(연혁·현황) 저장됨', code == 200 and any(i['id'] == first[0]['id'] and i['kind3'] == '연혁' for i in items) and any(i['id'] == first[1]['id'] and i['kind3'] == '현황' for i in items))
    code, r = api('/api/items', {'bulk': [{'ids': [i['id'] for i in items if i['kind3'] in ('현안', '반복')], 'keep': True}]}); items = r['items']
    code, r = api('/api/settings', {'handover_from': '갑돌', 'handover_to': '을순', 'witness': '병수', 'handover_date': '2026-10-14', 'org': '정읍우체국 영업과', 'overview': {'창구운영·요금납부': {'desc': '창구 운영', 'tip': '마감 확인'}}, 'assets': {'acct': '봉투'}})
    code, r = api('/api/export', {}); check('내보내기(날짜 글 항목 포함) 성공', code == 200 and len(r.get('files', [])) == 4, json.dumps(r, ensure_ascii=False)[:160])
    md = open(os.path.join(LOGW, [f for f in r['files'] if f.endswith('.md')][0]), encoding='utf-8').read()
    check('md: 서식 차례·확인 전·★·연혁·현황·직접 적은 항목', all(k in md for k in ('### 가. 담당 업무', '### 라. 주요 미결사항', '회신 대기', '★', '현황 자료:', '소속국 실적 산출', '확인 전', '붙임 1.', '붙임 2.')))
    code, r = api('/api/onnara'); check('온나라 절별 글', code == 200 and len(r['sections']) >= 7)
    code, r = api('/api/search?q=' + urllib.parse.quote('안부살핌')); check('물어보기 검색', code == 200 and r['hits'])
    # 재시작 → 이어서 → 다시 초안(재사용) → 내보내기
    srv.terminate(); srv.wait(timeout=10); out1 = srv.stdout.read()
    srv = start_server(); st = api('/api/state')[1]; check('재시작 뒤 세션 이어짐', st['step'] >= 4 and st.get('areas_src') == '폴더')
    wait('reloading')
    code, r = api('/api/draft', {}); st = wait('running'); items2 = api('/api/items')[1]['items']
    check('다시 초안: 이전 응답 재사용·결정 유지·직접 적은 항목 유지', any('재사용' in l for l in st['log']) and any(i['id'] == first[2]['id'] or (i['file'] == first[2]['file'] and i['status'] == '미결') for i in items2) and any(i['title'] == '소속국 실적 산출' for i in items2), 'calls %d' % len(st['calls']))
    code, r = api('/api/export', {}); check('두 번째 내보내기', code == 200)
    # 모델 고장: 주소를 죽은 포트로 → 초안이 끝까지 가고 규칙 항목은 남음
    api('/api/settings', {'url': 'http://127.0.0.1:1/v1/chat/completions', 'model': 'dead-model:test'}); api('/api/draft', {}); st = wait('running')
    check('모델 서버가 죽어도 초안은 끝나고 한글 오류', st['step'] == 4 and any('연속' in e['reason'] for e in st['errors']))
    code, r = api('/api/items', {'changes': [{'id': 999999, 'kind3': '현안'}]}); check('없는 항목 고치기 요청도 200', code == 200)
    srv.terminate(); srv.wait(timeout=10); out2 = srv.stdout.read()
    tb = [l for l in (out1 + out2).split('\n') if 'Traceback' in l or 'Error' in l and 'HTTPError' not in l and '요청 처리 실패' not in l]
    check('서버 콘솔에 역추적 없음', not tb, ' | '.join(tb[:3]))
finally:
    try:
        srv.terminate()
    except Exception:
        pass
    fake.terminate()
print('\n통과 %d · 실패 %d' % (len(ok), len(bad)))
for b in bad:
    print('  실패:', b)
sys.exit(1 if bad else 0)
