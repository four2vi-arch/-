#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""돌다리 v3 · 문서 단위 처리부(2026-10-13): 「문서 한 건 = 항목 한 개」.

v2까지는 문장을 뽑아 수천 항목이 나왔다(실제 폴더 2,434개 → 3,205항목, 쓸 수 없음). v3는 파일마다 날짜·문서번호·제목·기한·담당·소관 업무를
규칙으로 읽어 한 건으로 만들고, 기본 최근 12개월(업무마다 다르게 둘 수 있음) 안의 문서만 항목으로 삼는다. 해마다 오는 문서는 3년치 파일 날짜로
찾아 「반복 업무」로 올린다(규칙만, 빠름). 폴더에 누적 매뉴얼이 있으면 그 매뉴얼의 문서번호·제목과 대조해 「매뉴얼에 아직 안 들어간 문서」를 표시한다.
모델(선택)은 문서 한 건에 한 번만 불러 요지·후임자가 할 일을 받는다. 호출은 호출마다 저장되어 이어진다(core.load_checkpoint).
"""
import os, re, json, time, datetime, collections
import core

TABLE_KINDS = core.TABLE_KINDS
MANUAL_NAME = re.compile(r'매뉴얼|업무편람|편람', re.I)
HANDOVER_NAME = re.compile(r'인수인계', re.I)
ATTACH_NAME = re.compile(r'^[\(\[]?\s*(붙임|별첨|별지|별표)', re.I)
DOCNO = re.compile(r'(?<![가-힣A-Za-z])([가-힣A-Za-z]{2,12}(?:과|실|팀|국|청|부|원|센터|본부|처|관|소))-(\d{2,6})(?!\d)')
SI_LINE = re.compile(r'시행\s+([가-힣A-Za-z]{2,14}-\d{2,6})')
FULLDATE = re.compile(r'(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})')
FNAME_DATE = re.compile(r'(20\d{2})(\d{2})(\d{2})(?!\d)')
FNAME_YM = re.compile(r'(?<!\d)(20\d{2})(0[1-9]|1[0-2])(?!\d)')
WD = r'(?:\s*\([월화수목금토일]\))?'
DUE_PATS = [re.compile(r'(20\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?' + WD + r'\s*까지'),
            re.compile(r'(?<![\d.])(\d{1,2})\.\s*(\d{1,2})\.?' + WD + r'\s*까지'),
            re.compile(r'(\d{1,2})월\s*(\d{1,2})일' + WD + r'\s*까지'),
            re.compile(r'[~∼～]\s*(?:(20\d{2})\.\s*)?(\d{1,2})\.\s*(\d{1,2})\.?' + WD)]
ISSUE = core.ISSUE
HOT_LINE = re.compile(r'까지|기한|미결|보류|미납|지연|후임|요청|회신|협의 중|확인 필요|반려|재제출|못 받|안 됨|예정|해야|결정|지시|미결 사항|못 냄')   # 원문 보기·발췌에서 먼저 보여 줄 줄
CONTACT_LINE = re.compile(r'문의|담당|☎|☏|연락|주무관|팀장|과장|실장')
SYS3 = ('너는 공공기관 업무 인수인계 도우미다. 전임자의 문서 하나(공문·메일·보고서)를 읽고 후임자에게 필요한 것만 JSON 객체 하나로 답하라.\n'
        '형식: {"요지":"이 문서가 무엇을 요구하거나 알리는지 한 문장","할 일":"우리 부서(전임자 자리)가 해야 하는 일 한 문장, 없으면 빈 문자열","기한":"YYYY-MM-DD 또는 빈 문자열","담당":"문의할 사람·부서와 전화, 없으면 빈 문자열","상태":"진행 중|끝남|모름"}\n'
        '규칙: (1) 문서에 없는 내용은 만들지 않는다. (2) 기한은 문서에 적힌 날짜만 쓴다. (3) 한 문장은 60자 안. (4) 설명문·코드 펜스 없이 JSON만.')
CLS_ISSUE = {'공문', '메일', '메모', '회의록', '보고서·계획'}
HISTORY = re.compile(r'협약|체결|계약|신설|폐지|개정|변경|도입|종료|이관|지정|선정|개편|설치|시범|확정|개소|폐국|통합|승인|감사|지적|제정|전환|위탁|수탁')   # 업무의 전환점을 뜻하는 제목 말(기간 밖 문서용)
HISTORY_STRONG = re.compile(r'협약|체결|신설|폐지|제정|이관|통합|개소|폐국|위탁|수탁')   # 기간 안 문서에도 연혁 꼬리표를 붙이는 센 말
DOC_TYPE_FOLDER = re.compile(r'공문|보고서|대장|엑셀|워드|메일|메모|기타|한글|pdf|사진|그림|서식$|미분류|참고', re.I)   # 업무가 아니라 문서 종류로 나눈 폴더
DUMMY_PHONE = re.compile(r'^0*-0*-0*$|123-?4567|1234-?5678|0000-?0000|^0\d{1,2}-(\d)\1{2,3}-(\d)\2{3}$')          # 서식의 보기 번호
STATUS_NAME = re.compile(r'(현황|대장|명단|목록|일정표?|리스트|실적표?)\s*(\(.*\)|_?\d{4}(년)?)?\s*$')                                  # 현황 자료: 제목이 현황·대장·명단·목록으로 끝나는 것(최신판 하나만)
HR_NAME = re.compile(r'인사|임용|경력|신상|요약카드|근무평정|발령')
# v3.7(10.18) 인계자 모의 심사: 개인 문서·계정 정보가 인수인계서에 그대로 실리던 것
PRIVATE_NAME = re.compile(r'멘토|면담|상담|고충|교육\s*과제|실습\s*일지|건강|병가|가족|개인\s*사정|인사\s*기록|평정표|자기\s*소개|일기')
SECRET_LINE = re.compile(r'비밀\s*번호|비번|패스\s*워드|password|passwd|(?<![A-Za-z])PW(?![A-Za-z])|암호\s*[:：=]', re.I)
DATE_FOLDER = re.compile(r'^(\d{2,4}([.\-_ ]\d{1,2}){0,2}\s*(월|년|년도)?|\d{1,2}\s*월|다운로드|downloads?|바탕\s*화면|desktop|새\s*폴더|new folder|임시|temp|tmp|백업|backup|문서|documents?)$', re.I)
YY_DATE = re.compile(r"[’'‘`]\s?(\d{2})\.\s?(\d{1,2})\.\s?(\d{1,2})")
VERSION_TAIL = re.compile(r'(?:[\s_\-]*(?:v\d+|ver\.?\s*\d+|\d차|수정본?|최종\S*|진짜\S*|복사본|사본|copy|\(\d+\)))+$', re.I)   # 끝 숫자만(「현황_09」)은 월별로 다른 문서라 꼬리로 보지 않는다
MIGYEOL = re.compile(r'결론\s*못|아직\s*안\s*[옴왔와]|회신\s*(?:부탁|바랍|요청|대기|없|기다)|답변\s*(?:대기|없)|미결|검토\s*중|협의\s*중|결정\s*(?:못|안\s*됨|해야)|기다리|못\s*받')
TODO_LINE = re.compile(r'후임|지시|할\s*것|해야|하기로|필요|요망|바람|까지')


def mask_secret(s):
    """비밀번호·아이디 값을 가린다(줄 자체는 남겨야 할 때)."""
    s = re.sub(r'((?:비밀\s*번호|비번|패스\s*워드|password|passwd|PW|암호)\s*[:：=]?\s*)(\S+)', r'\1●●●', str(s), flags=re.I)
    return re.sub(r'((?:아이디|ID|계정)\s*[:：=]?\s*)([A-Za-z0-9_.@\-]{3,})', r'\1●●●', s, flags=re.I)


def all_dates(text):
    """본문 날짜(2026. 3. 13. / 2026-03-13 / ’26. 2. 20.)를 나온 순서대로."""
    out = []
    for m in FULLDATE.finditer(text):
        d = iso(*m.groups())
        if d:
            out.append((m.start(), d))
    for m in YY_DATE.finditer(text):
        d = iso(2000 + int(m.group(1)), m.group(2), m.group(3))
        if d:
            out.append((m.start(), d))
    return [d for _, d in sorted(out)]
HIST_CAP = 12   # 업무마다 연혁으로 올리는 기간 밖 문서 상한(최근 것부터)


def text_of(f):
    return '\n'.join(u['text'] for u in f.get('units', []))


def base_name(f):
    """파일 이름. 압축 안 파일(「묶음.zip ▸ 안/파일.txt」)은 안쪽 파일 이름."""
    return os.path.basename(str(f.get('file', '')).split(' ▸ ')[-1].replace('\\', '/'))


def outer_name(f):
    return os.path.basename(str(f.get('file', '')).split(' ▸ ')[0].replace('\\', '/'))


TITLE_YEAR = re.compile(r'(?<!\d)(20\d{2})\s*(?:년|년도|_|\s|$)')


def iso(y, m, d):
    try:
        return datetime.date(int(y), int(m), int(d)).isoformat()
    except Exception:
        return ''


def doc_date(f, text):
    """문서 날짜: 파일 이름 YYYYMMDD → 이름 YYYYMM → 본문 「시행」 근처 날짜 → 본문 첫 날짜 → 파일 수정일."""
    for name in dict.fromkeys([base_name(f), outer_name(f)]):   # 안쪽 이름 → 압축 파일 이름
        m = FNAME_DATE.search(name)
        if m and iso(*m.groups()):
            return iso(*m.groups()), '파일 이름'
        m = FNAME_YM.search(name)
        if m:
            return iso(m.group(1), m.group(2), 1), '파일 이름(월)'
    if f.get('kind') == 'eml':   # 메일은 머리의 날짜(Date)
        m = re.search(r'^날짜:\s*(.+)$', text[:600], re.M)
        if m:
            try:
                import email.utils
                return email.utils.parsedate_to_datetime(m.group(1).strip()).date().isoformat(), '본문'
            except Exception:
                pass
    i = text.find('시행 ')
    if i >= 0:
        ds = all_dates(text[max(0, i - 300):i + 200])
        if ds:
            return ds[-1] if i - 300 > 0 else ds[0], '본문(시행)'
    ds = all_dates(text[:3000])
    if ds:
        return ds[0], '본문'
    # 날짜가 없고 이름에 연도만 있으면(「인수인계서_2024_전전임자」) 그 해로 둔다. 수정일(복사·내려받기 날짜)보다 낫다.
    # 단 수정일보다 늦은 연도(연말에 쓴 「2026년 계획」)는 계획 대상 연도라 수정일을 쓴다
    m = TITLE_YEAR.search(os.path.splitext(base_name(f))[0] + ' ' + text[:300])
    if m and f.get('mtime') and m.group(1) < f['mtime'][:4]:
        return '%s-01-01' % m.group(1), '연도만'
    if m and not f.get('mtime'):
        return '%s-01-01' % m.group(1), '연도만'
    if f.get('mtime'):
        return f['mtime'], '수정일'
    return '', ''


def doc_title(f, text):
    for line in text.split('\n')[:40]:
        s = line.strip()
        if re.match(r'^제\s*목\s*[:：]?\s*\S', s):
            t = re.sub(r'^제\s*목\s*[:：]?\s*', '', s).strip()
            if 4 <= len(t) <= 120:
                return t
    stem = os.path.splitext(base_name(f))[0]
    stem = re.sub(r'^\d{6,8}[_\-\s]*(?:\d{1,3}(?:\(\d+\))?[_\-\s]*)?', '', stem)
    stem = re.sub(r'^\d{1,3}[_\-\s]+', '', stem)
    return re.sub(r'[_]+', ' ', stem).strip() or base_name(f)


def doc_no(text):
    m = SI_LINE.search(text)
    if m:
        return m.group(1)
    return ''


def stem_wo_prefix(name):
    """「20260911_07_붙임3_홍보물.pdf」 → 「붙임3_홍보물」: 날짜·순번 머리를 뗀 파일 이름."""
    stem = os.path.splitext(name)[0]
    stem = re.sub(r'^\d{6,8}[_\-\s]*(?:\d{1,3}(?:\(\d+\))?[_\-\s]*)?', '', stem)
    return re.sub(r'^\d{1,3}[_\-\s]+', '', stem)


def classify(f, text):
    name = base_name(f); kind = f.get('kind', '')
    head = text[:400]
    stem = stem_wo_prefix(name)
    if ATTACH_NAME.search(stem) or re.match(r'^[\(\[]?(붙임|별첨|별지|별표)\s*\d*', stem):   # 「(붙임2) ….xlsx」도 붙임(표보다 먼저 본다)
        return '붙임'
    if kind in TABLE_KINDS:
        return '표·대장'
    if kind == 'eml':
        return '메일'
    if '회의록' in name or '회의록' in head:
        return '회의록'
    if HANDOVER_NAME.search(name):
        return '인수인계서'
    if MANUAL_NAME.search(name):
        return '매뉴얼'
    if re.search(r'(^|\n)\s*제\s*목\s', head) and (re.search(r'(^|\n)\s*수\s*신\s', head) or SI_LINE.search(text)):
        return '공문'   # 공문 꼴(제목+수신·시행)이면 제목에 「안내서」가 있어도 공문(「위조 도착안내서 조치 안내」 같은 것)
    if core.REFERENCE_NAME.search(name):
        return '규정·지침'
    if kind in ('txt', 'md'):
        return '메모'
    if re.search(r'(^|\n)\s*[□ㅇ○◦]\s', text[:2000]):
        return '보고서·계획'
    return '기타'


def due_dates(text, base, base_src=''):
    """기한: 「○. ○.까지」「○월 ○일까지」「2026. 3. 13.까지」「~ 9. 11.」. 연도는 문서 연도, 문서 달보다 두 달 넘게 이르면 이듬해.
    문서 날짜가 확실하지 않으면(파일 수정일·연도만) 이듬해로 넘기지 않는다(복사한 날짜를 기준으로 미래 기한을 지어내지 않게)."""
    try:
        by, bm = int(base[:4]), int(base[5:7])
    except Exception:
        by, bm = datetime.date.today().year, datetime.date.today().month
    if base_src in ('수정일', '연도만', ''):
        bm = 1
    out, seen = [], set()
    for line in text.split('\n'):
        s = line.strip()
        if not s or len(s) > 400:
            continue
        spans = []   # 앞 꼴이 이미 잡은 자리(「2025. 12. 30.까지」의 「12. 30.까지」)는 다시 잡지 않는다
        for pat in DUE_PATS:
            for m in pat.finditer(s):
                if any(m.start() < b and a < m.end() for a, b in spans):
                    continue
                spans.append((m.start(), m.end()))
                g = m.groups()
                if len(g) == 3:
                    y, mo, d = g
                    if y is None:
                        y = by + (1 if int(mo) < bm - 1 else 0)
                else:
                    mo, d = g
                    y = by + (1 if int(mo) < bm - 1 else 0)
                dt = iso(y, mo, d)
                if dt and dt not in seen:
                    seen.add(dt)
                    out.append({'date': dt, 'line': re.sub(r'\s+', ' ', s)[:100]})
    out.sort(key=lambda x: x['date'])
    return out[:6]


def contacts_of(text):
    out, seen = [], set()
    for line in text.split('\n'):
        s = re.sub(r'\s+', ' ', line.strip())
        if not s or len(s) > 300 or s.count('\t') >= 3:
            continue
        for m in core.PHONE.finditer(s):
            ph = m.group(0)
            if ph in seen or re.search(r'팩스|FAX|fax|Fax', s[max(0, m.start() - 12):m.start()]):
                continue
            if not CONTACT_LINE.search(s) or DUMMY_PHONE.search(ph):
                continue
            seen.add(ph)
            out.append({'name': core.name_near_phone(s, ph), 'phone': ph, 'line': s[:80]})
            if len(out) >= 3:
                return out
    return out


def recur_key(title):
    t = re.sub(r'[’\'`]?\d{2,4}\s*년도?|\d{4}', ' ', title)
    t = re.sub(r'\([^)]*\)|\[[^\]]*\]|\d+(?:차|회|분기|월|일|호)?', ' ', t)
    t = re.sub(r'제\s*차|상반기|하반기|분기|변경|재|수정|최종|긴급|알림|안내|요청|제출|보고|계획|결과|추진|시행|개최', ' ', t)
    t = re.sub(r'[^가-힣A-Za-z]+', '', t).lower()
    return t if len(t) >= 6 else ''


def area_of(title, text, areas, file=''):
    """업무 이름이 맨 위 폴더 이름과 같으면 그 업무(폴더로 정리한 폴더). 아니면 키워드 많이 든 업무."""
    if file:
        fa = folder_area_name(file)
        if fa and any(a['name'] == fa for a in areas):
            return fa
        if fa:
            for a in areas:
                if fa.lower() in [k.strip().lower() for k in str(a.get('keys', '')).split(',')]:
                    return a['name']
    hay = (title + ' ') * 3 + text[:800]
    hay = hay.lower()
    tl = title.lower()
    best, score = '기타', (0, 0)
    for a in areas:
        keys = [k.strip().lower() for k in str(a.get('keys', '')).split(',') if k.strip()]
        n = (sum(hay.count(k) for k in keys), sum(tl.count(k) for k in keys))   # 같으면 제목에 든 키워드가 많은 업무
        if n[0] > 0 and n > score:
            best, score = a['name'], n
    return best


def top_folder(file):
    f = str(file or '').replace('\\', '/')
    return f.split('/')[0] if '/' in f else ''


def folder_area_name(file):
    return re.sub(r'^\d+[_\-.\s]*', '', top_folder(file)).strip()


def folder_areas(files):
    """맨 위 하위 폴더 이름이 업무 이름이면(공문·보고서 같은 문서 종류 이름이 아니면) 그 이름으로 업무 목록을 만든다. 아니면 None."""
    names, raws = [], {}
    for f in files:
        n = folder_area_name(f['file'])
        if n and n not in names:
            names.append(n); raws[n] = top_folder(f['file']).strip()
    dated = [n for n in names if DATE_FOLDER.search(raws[n]) or DATE_FOLDER.search(n)]   # 「2025.11」「다운로드」「바탕화면」은 업무가 아니다
    if len(dated) >= len(names) * 0.5:
        return None
    good = [n for n in names if not DOC_TYPE_FOLDER.search(n) and n not in dated]
    if len(good) < 3 or len(good) < len(names) * 0.5:
        return None
    return [{'name': n, 'keys': ', '.join(p for p in re.split(r'[·,/\s]+', n) if len(p) >= 2)} for n in good]


def parse_areas(text):
    """한 줄에 「업무 이름: 키워드, 키워드 | 24개월」. 「| N개월」은 그 업무의 기간(없으면 기본 기간)."""
    out = []
    for line in str(text or '').splitlines():
        if ':' not in line and '：' not in line:
            continue
        name, rest = re.split(r'[:：]', line, 1)
        months = None
        if '|' in rest:
            rest, opt = rest.rsplit('|', 1)
            m = re.search(r'(\d{1,3})', opt)
            months = int(m.group(1)) if m else None
        if name.strip():
            a = {'name': name.strip(), 'keys': rest.strip()}
            if months:
                a['months'] = months
            out.append(a)
    return out


def areas_text(areas):
    return '\n'.join('%s: %s%s' % (a['name'], a['keys'], (' | %d개월' % a['months']) if a.get('months') else '') for a in areas)


def find_manual(files):
    """폴더 안 누적 매뉴얼(이름에 매뉴얼·편람). 판 번호(v49)가 큰 것 → 날짜 → 수정일 순으로 가장 최근 것."""
    best, score = None, None
    for f in files:
        name = base_name(f)
        if not MANUAL_NAME.search(name) or f.get('kind') not in ('docx', 'hwpx', 'hwp', 'md', 'odt', 'pdf', 'txt'):
            continue
        if ' ▸ ' in f.get('file', ''):
            continue
        v = re.search(r'[vV](\d{1,3})', name)
        sc = (int(v.group(1)) if v else -1, f.get('mtime') or '', f.get('chars', 0))
        if score is None or sc > score:
            best, score = f, sc
    return best


def manual_refs(f):
    """매뉴얼 본문의 문서번호 집합과 줄 목록(제목 대조용)."""
    text = text_of(f)
    nos = {m.group(1) + '-' + m.group(2) for m in DOCNO.finditer(text)}
    lines = [re.sub(r'\s+', ' ', l.strip()) for l in text.split('\n')]
    lines = [l for l in lines if 10 <= len(l) <= 300]
    return nos, lines


def reflected(doc, nos, line_grams):
    if doc.get('docno') and doc['docno'] in nos:
        return '문서번호'
    g = core.grams(doc.get('title', ''))
    if len(g) < 10:
        return ''
    for lg in line_grams:
        if len(g & lg) / len(g) >= 0.7:
            return '제목'
    return ''


def base_date(files, handover=''):
    """기간을 세는 기준일. 인계 일자를 적었으면 그날, 아니면 오늘. 다만 폴더의 가장 최근 문서가 석 달보다 오래됐으면(지난 폴더 사본)
    그 문서 날짜를 기준으로 한다(「최근 12개월」이 비어 버리지 않게). 반환: (date, 이유)"""
    real = datetime.date.today()
    try:
        if handover:
            return datetime.date.fromisoformat(str(handover)[:10]), '인계 일자'
    except Exception:
        pass
    latest = ''
    for f in files:
        d, src = doc_date(f, text_of(f)[:3000])
        if d and src not in ('수정일', '연도만', '') and d <= real.isoformat() and d > latest:
            latest = d
    if latest and latest < (real - datetime.timedelta(days=90)).isoformat():
        return datetime.date.fromisoformat(latest) + datetime.timedelta(days=1), '폴더의 가장 최근 문서(%s)' % latest
    return real, '오늘'


def plan_docs(files, areas, months=12, model_scope='issues', today=None, recur_months=36):
    """파일 → 문서 목록(규칙만, 몇 초). 반환: docs(전부), 그리고 어떤 문서가 항목이 되는지 kind3로 표시."""
    today = today or datetime.date.today()
    area_months = {a['name']: a.get('months') or months for a in areas}
    docs = []
    for f in files:
        text = text_of(f)
        name = base_name(f)
        date, date_src = doc_date(f, text)
        cls = classify(f, text)
        title = doc_title(f, text)
        d = {'file': f['file'], 'kind': f.get('kind', ''), 'cls': cls, 'date': date, 'date_src': date_src, 'docno': doc_no(text), 'title': title,
             'area': area_of(title, text, areas, f['file']), 'due': due_dates(text, date, date_src) if cls in CLS_ISSUE | {'붙임'} else [],
             'contacts': contacts_of(text) if (cls != '표·대장' and not HR_NAME.search(title)) else [],   # 인사·임용·경력 자료의 번호는 개인정보 → 연락처로 쓰지 않는다
             'issue_words': bool(ISSUE.search(text[:6000])) if cls in CLS_ISSUE else False, 'chars': f.get('chars', 0), 'recur': None, 'attachments': [],
             'sha': f.get('sha', ''), 'mtime': f.get('mtime', ''), 'private': bool(PRIVATE_NAME.search(title + ' ' + name)), 'secret': bool(SECRET_LINE.search(text[:20000]))}
        if d['private']:   # 개인 문서(멘토 면담·교육과제 등): 현안·연락처·발췌를 만들지 않는다
            d['issue_words'] = False; d['contacts'] = []; d['due'] = []
        docs.append(d)
    # 같은 파일 사본(지문이 같음)·같은 보고서의 수정본(_v1·_최종·(1))은 가장 최근 하나만 항목으로(나머지는 붙임에 「이전 판·사본」)
    by_sha = collections.defaultdict(list)
    for d in docs:
        if d['sha']:
            by_sha[d['sha']].append(d)
    for g in by_sha.values():
        if len(g) > 1:
            g.sort(key=lambda d: (bool(re.search(r'다운로드|download|바탕|desktop|복사|사본', d['file'], re.I)), len(d['file'])))
            for d in g[1:]:
                d['dup'] = 'copy'; d['dup_of'] = g[0]['file']
    by_ver = collections.defaultdict(list)
    for d in docs:
        if d.get('dup'):
            continue
        stem = VERSION_TAIL.sub('', os.path.splitext(base_name(d))[0]).strip(' _-')
        if len(stem) >= 4 and stem != os.path.splitext(base_name(d))[0]:
            by_ver[(d['cls'], core.norm(stem))].append(d)
    for k, g in list(by_ver.items()):   # 꼬리 없는 원본 이름도 같은 묶음에
        for d in docs:
            if not d.get('dup') and d['cls'] == k[0] and d not in g and core.norm(os.path.splitext(base_name(d))[0]) == k[1]:
                g.append(d)
    for g in by_ver.values():
        if len(g) > 1:
            g.sort(key=lambda d: (d.get('mtime') or '', '최종' in base_name(d), d['date'] or ''), reverse=True)
            for d in g[1:]:
                d['dup'] = 'version'; d['dup_of'] = g[0]['file']
    # 붙임은 같은 날짜 머리의 공문에 붙인다(파일 이름 「YYYYMMDD_NN」 꼴일 때)
    by_prefix = collections.defaultdict(list)
    for d in docs:
        m = re.match(r'^(\d{8})_', base_name({'file': d['file']}))
        if m:
            by_prefix[(os.path.dirname(d['file']), m.group(1))].append(d)
    def seq_of(d):
        m = re.match(r'^\d{8}_(\d{1,3})', base_name({'file': d['file']}))
        return int(m.group(1)) if m else 0
    for key, group in by_prefix.items():
        parents = sorted([d for d in group if d['cls'] == '공문'], key=seq_of)
        if not parents:
            continue
        for d in group:
            if d['cls'] != '붙임':
                continue
            before = [p for p in parents if seq_of(p) < seq_of(d)]
            p = before[-1] if before else parents[0]   # 순번이 바로 앞인 공문, 없으면 그 날의 첫 공문
            p['attachments'].append(d['file']); d['parent'] = p['file']
            if d['due'] and not p['due']:
                p['due'] = d['due']
    # 반복 업무: 같은 제목 꼴이 서로 다른 해에 2번 이상
    groups = collections.defaultdict(list)
    lim_recur = (today - datetime.timedelta(days=30 * recur_months)).isoformat()
    for d in docs:
        if d['cls'] in ('공문', '보고서·계획', '회의록', '메일') and d['date'] and d['date'] >= lim_recur:
            k = recur_key(d['title'])
            if k:
                groups[k].append(d)
    lim12 = (today - datetime.timedelta(days=365)).isoformat()
    for k, g in groups.items():
        years = sorted({d['date'][:4] for d in g})
        yms = sorted({d['date'][:7] for d in g if d['date'] >= lim12})
        latest = max(g, key=lambda d: d['date'])
        if len(years) >= 2:
            months_seen = collections.Counter(int(d['date'][5:7]) for d in g)
            mon = months_seen.most_common(1)[0][0]
            for d in g:
                d['recur'] = {'years': years, 'month': mon, 'n': len(g), 'latest': latest['file'], 'cycle': '매년'}
        elif len(yms) >= 3:   # 같은 제목 꼴이 1년 안에 서로 다른 달 3번 이상 → 매월 업무(과오취급 현황 알림 같은 것)
            for d in g:
                d['recur'] = {'years': years, 'month': int(latest['date'][5:7]), 'n': len(g), 'latest': latest['file'], 'cycle': '매월', 'months': yms}
    # 항목이 되는 문서: 기간 안(업무별) 또는 반복 업무의 최근 판
    by_title = collections.defaultdict(list)   # 같은 문서를 docx와 pdf로 둘 다 둔 경우: pdf 쪽만 중복으로 뺀다(제목만 같은 다른 문서는 남긴다)
    for d in docs:
        d['dup'] = d.get('dup') or False
        by_title[(d['cls'], core.norm(d['title']))].append(d)
    RANK = {'hwpx': 0, 'hwp': 1, 'docx': 2, 'odt': 3, 'md': 4, 'txt': 5, 'pdf': 6}
    for k, g in by_title.items():
        g = [d for d in g if not d['dup']]
        if len(g) < 2:
            continue
        g2 = sorted(g, key=lambda d: (RANK.get(d['kind'], 9), -d['chars']))
        for d in g2[1:]:   # 형식이 다른 같은 문서(docx와 그 pdf·md)만 중복. 이름만 같은 같은 형식 파일은 각각 다른 문서로 둔다
            same_doc = d['date'] == g2[0]['date'] or os.path.splitext(base_name(d))[0] == os.path.splitext(base_name(g2[0]))[0]   # 같은 회차(날짜) 또는 같은 파일 이름일 때만
            if d['kind'] in RANK and d['kind'] != g2[0]['kind'] and same_doc and abs(g2[0]['chars'] - d['chars']) <= 0.5 * max(g2[0]['chars'], d['chars'], 1):
                d['dup'] = True
    for d in docs:
        am = area_months.get(d['area'], months)
        lim = (today - datetime.timedelta(days=30 * am)).isoformat()
        in_window = bool(d['date']) and d['date'] >= lim
        d['in_window'] = in_window
        future = [x['date'] for x in d['due'] if x['date'] >= today.isoformat()]
        recent_past = [x['date'] for x in d['due'] if (today - datetime.timedelta(days=60)).isoformat() <= x['date'] < today.isoformat()]
        due_next = future[0] if future else (recent_past[-1] if recent_past else '')   # 다가올 기한 먼저, 없으면 최근 두 달 안에 지난 기한(지남 표시)
        d['due_next'] = due_next
        recent = d['date_src'] != '수정일' and d['date'] >= (today - datetime.timedelta(days=120)).isoformat()
        if d.get('parent'):
            d['kind3'] = '붙임'
        elif d['cls'] == '매뉴얼' or d.get('dup'):
            d['kind3'] = '매뉴얼' if d['cls'] == '매뉴얼' else '중복'
        elif d['cls'] in CLS_ISSUE and in_window and not d.get('private') and (due_next or d['issue_words'] or recent):
            d['kind3'] = '현안'
        elif d['recur'] and d['recur']['latest'] == d['file'] and d['cls'] in ('공문', '보고서·계획', '회의록'):
            d['kind3'] = '반복'
        elif in_window and d['cls'] != '표·대장':   # 부모 공문을 못 읽은(스캔 PDF 등) 붙임도 문서로 남긴다
            d['kind3'] = '문서'
        else:
            d['kind3'] = '기간 밖'
        d['to_model'] = d['kind3'] == '현안' if model_scope == 'issues' else d['kind3'] in ('현안', '반복', '문서')
    # 현황 자료: 표·대장이거나 이름에 현황·대장·명단·실적·일정 · 같은 제목 꼴은 최신판 하나만
    latest = {}
    for d in docs:
        is_status = (d['cls'] == '표·대장' or (STATUS_NAME.search(d['title']) and d['cls'] in ('보고서·계획', '기타', '메모') and ' ▸ ' not in d['file'])) and not d.get('parent') and not d.get('dup')
        d['is_status'] = bool(is_status)
        if is_status:
            k = recur_key(d['title']) or core.norm(d['title'])
            if k not in latest or (d['date'] or '') > (latest[k]['date'] or ''):
                latest[k] = d
    for k, d in latest.items():
        if d['kind3'] in ('기간 밖', '문서') or d['cls'] == '표·대장':
            d['kind3'] = '현황'
    # 연혁: 전환점 말이 든 제목·옛 인수인계서·매뉴얼에 반영된 문서. 기간 밖이면 업무마다 최근 HIST_CAP건까지 「연혁」 항목으로
    per_area = collections.defaultdict(list)
    for d in docs:
        words = HISTORY if d['kind3'] == '기간 밖' else HISTORY_STRONG
        d['hist'] = bool(d['cls'] in ('공문', '보고서·계획', '회의록', '인수인계서', '기타') and not d.get('parent') and not d.get('dup') and (d['cls'] == '인수인계서' or words.search(d['title'])))
        if d['hist'] and d['kind3'] == '기간 밖':
            per_area[d['area']].append(d)
    for a, g in per_area.items():
        g.sort(key=lambda d: d['date'] or '', reverse=True)
        for d in g[:HIST_CAP]:
            d['kind3'] = '연혁'
    return docs


def build_docs(files, areas, months=12, model='none', url='http://127.0.0.1:11434/v1/chat/completions', key='', model_scope='issues', max_chars=4000,
               progress=None, should_stop=None, checkpoint=None, folder='', prev_items=None, fake=None, max_consecutive_failures=5, today=None, manual=None):
    """문서 항목을 만든다. 반환: items, calls, errors, info. manual: 폴더 밖 매뉴얼을 직접 넘길 때(파일 dict)."""
    t_all = time.time()
    base_why = '지정'
    if today is None:
        today, base_why = base_date(files)
    docs = plan_docs(files, areas, months, model_scope, today=today)
    if manual is None:
        manual = find_manual(files)
    nos, lines = (set(), [])
    if manual is not None:
        nos, lines = manual_refs(manual)
    line_grams = [core.grams(l) for l in lines]
    by_file = {f['file']: f for f in files}
    items, calls, errors = [], [], []
    prev = {}
    if checkpoint and model != 'none':
        prev = core.load_checkpoint(checkpoint, folder, model, max_chars)
    ck = None
    if checkpoint and model != 'none' and fake is None:
        try:
            mode = 'a' if prev else 'w'
            ck = open(checkpoint, mode, encoding='utf-8')
            if mode == 'w':
                ck.write(json.dumps({'folder': folder, 'model': model, 'max_chars': max_chars, 'started': time.strftime('%Y-%m-%d %H:%M:%S')}, ensure_ascii=False) + '\n'); ck.flush()
        except Exception:
            ck = None
    cand = [d for d in docs if d['kind3'] in ('현안', '반복', '문서', '연혁', '현황')]
    cand.sort(key=lambda d: (d['kind3'] != '현안', d['kind3'] != '반복', d['date'] or ''), reverse=False)
    to_model = [d for d in cand if d['to_model']] if model != 'none' else []
    total_calls = len(to_model)
    done_calls, consecutive_fail, stopped = 0, 0, False
    old = {p['file']: p for p in (prev_items or []) if p.get('file')}

    def report(d, **kw):
        if progress:
            progress(dict({'file': d['file'] if d else '', 'index': done_calls, 'total': len(cand), 'calls_done': done_calls, 'calls_total': total_calls,
                           'chars_done': done_calls, 'chars_total': total_calls, 'stopped': stopped}, **kw))

    n = 0
    for d in cand:
        n += 1
        it = {'id': n, 'file': d['file'], 'kind': d['kind'], 'cls': d['cls'], 'date': d['date'], 'date_src': d.get('date_src', ''), 'docno': d['docno'], 'title': d['title'], 'area': d['area'],
              'due': d['due'], 'due_next': d['due_next'], 'contacts': d['contacts'], 'recur': d['recur'], 'attachments': d['attachments'], 'kind3': d['kind3'],
              'reflected': reflected(d, nos, line_grams) if manual is not None else '', 'hist': d.get('hist', False), 'is_status': d.get('is_status', False), 'summary': '', 'todo': '', 'owner': '', 'model_status': '',
              'src': '규칙', 'keep': True, 'decided': False, 'status': '진행', 'next': '', 'note': '', 'seen': False, 'quote': ''}
        if manual is not None and it['reflected'] and d['kind3'] == '연혁':
            it['hist'] = True
        it['private'] = bool(d.get('private')); it['secret'] = bool(d.get('secret')); it['date_src'] = d.get('date_src', '')
        if d['kind3'] in ('현안', '반복') and not d.get('private'):   # 규칙 발췌: 기한·미결·후임 같은 말이 든 원문 줄(글자 그대로, 고치지 않음). 모델 없이도 무엇을 넣고 버릴지 볼 수 있게
            f0 = by_file.get(d['file'])
            if f0:
                cand_l = []
                for l in text_of(f0).split('\n'):
                    l = re.sub(r'\s+', ' ', l).strip()
                    if 8 <= len(l) <= 160 and HOT_LINE.search(l) and not SECRET_LINE.search(l) and core.norm(l) != core.norm(d['title']) and l not in cand_l:
                        cand_l.append(l)
                pri = lambda l: (0 if re.search(r'후임|지시|해야|결정|미결', l) else 1)
                qs = sorted(cand_l, key=pri)[:3]   # 후임자·지시·해야·미결 줄을 먼저, 3줄까지
                it['quote'] = ' / '.join(mask_secret(l if len(l) <= 110 else l[:108] + '…') for l in sorted(qs, key=cand_l.index))
                if d['kind3'] == '현안':
                    mig = [l for l in cand_l if MIGYEOL.search(l)]
                    if mig:   # 「결론 못 냄」「회신 부탁」「아직 안 옴」: 미결로 제안(전임자가 확인), 기다리는 것을 다음 칸에
                        it['status'] = '미결'; it['next'] = mask_secret(mig[0][:110]); it['status_by'] = '규칙'
                    td = [l for l in cand_l if TODO_LINE.search(l) and (re.search(r'후임|지시|해야|할\s*것', l) or DUE_PATS[2].search(l) or DUE_PATS[1].search(l))]
                    if td:
                        it['todo'] = mask_secret(td[0][:110]); it['todo_src'] = '원문'
        if d['to_model'] and model != 'none' and not stopped and not (should_stop and should_stop()):
            f = by_file.get(d['file'])
            chunk = ('제목: %s\n' % d['title']) + text_of(f)[:max_chars]
            t0 = time.time(); usage = {}; reused = False; content = ''
            try:
                if fake is not None:
                    content = fake(f)
                elif (d['file'], 0, len(chunk)) in prev:
                    content = prev[(d['file'], 0, len(chunk))]; reused = True
                else:
                    content, usage = core.call_model(url, model, key, chunk, system=SYS3)
                    if ck is not None:
                        try:
                            ck.write(json.dumps({'file': d['file'], 'chunk': 0, 'chars': len(chunk), 'content': content}, ensure_ascii=False) + '\n'); ck.flush()
                        except Exception:
                            pass
                consecutive_fail = 0
                obj = core.parse_json_loose(content)
                if isinstance(obj, dict):
                    text = text_of(f)
                    it['summary'] = str(obj.get('요지') or '').strip()[:120]
                    it['todo'] = str(obj.get('할 일') or obj.get('할일') or '').strip()[:120]
                    due = str(obj.get('기한') or '').strip()[:10]
                    if due and any(x['date'] == due for x in d['due']):
                        it['due_next'] = due
                    owner = str(obj.get('담당') or '').strip()[:60]
                    ph = core.PHONE.search(owner)
                    nm = re.search(r'([가-힣]{2,4})\s*(?:주무관|담당|과장|팀장|실장|국장|계장|사무관|서기관)', owner)
                    if owner and not re.search(r'미기재|확인 필요|없음|모름|○○', owner) and ((ph and ph.group(0) in text) or (nm and nm.group(1) in text and nm.group(1) not in ('담당자',))):
                        it['owner'] = owner
                    st = str(obj.get('상태') or '')
                    it['model_status'] = '끝남' if '끝' in st else ('진행 중' if '진행' in st else '')
                    it['src'] = '모델'
                else:
                    errors.append({'file': d['file'], 'chunk': 0, 'reason': 'JSON 아님', 'head': str(content)[:160]})
            except Exception as e:
                errors.append({'file': d['file'], 'chunk': 0, 'reason': str(e)[:160]}); consecutive_fail += 1
            calls.append({'file': d['file'], 'chunk': 0, 'chars': len(chunk), 'sec': round(time.time() - t0, 1), 'usage': usage, 'reused': reused})
            done_calls += 1
            if consecutive_fail >= max_consecutive_failures:
                errors.append({'file': '', 'chunk': -1, 'reason': '모델 서버가 %d회 연속 응답하지 않아 남은 문서는 규칙만 적용했습니다(모델 주소·Ollama 실행 여부를 확인하세요)' % consecutive_fail})
                stopped = True
        elif d['to_model'] and model != 'none':
            stopped = True
        p = old.get(d['file'])
        if p:   # 이전 초안에서 사람이 정한 것은 그대로(다시 만들어도 잃지 않는다)
            for k in ('keep', 'decided', 'status', 'next', 'note', 'seen', 'question', 'bulk'):   # 상태·다음은 사람이 정했을 때만(규칙이 고른 「미결」을 빈 값으로 덮지 않게)
                if k in p and (p.get('decided') or k in ('note', 'seen', 'question')):
                    it[k] = p[k]
            if p.get('area_by') == '사람':
                it['area'] = p.get('area', it['area']); it['area_by'] = '사람'
            if p.get('title_by') == '사람':
                it['title'] = p.get('title', it['title']); it['title_by'] = '사람'
            for k in ('todo', 'due_next', 'summary', 'when', 'kind3'):
                if p.get(k + '_by') == '사람':
                    it[k] = p.get(k, it.get(k, '')); it[k + '_by'] = '사람'
        items.append(it)
        report(d)
    # 반복 업무(v3.7): 본문의 「매월 ○일까지」「매주 금요일」「익월」 줄, 옛 인수인계서·매뉴얼·연간 일정표의 「○월 ○일까지」 줄
    by_doc = {d['file']: d for d in docs}
    old_r = {p['rkey']: p for p in (prev_items or []) if p.get('rkey')}
    seen_r, people, n_rule = set(), {}, 0
    phone_files = collections.Counter()
    for d in docs:
        for c in d.get('contacts') or []:
            phone_files[c['phone']] += 1
    for f in files:
        d = by_doc.get(f['file'])
        if not d or d.get('private') or d.get('dup') or d.get('parent'):
            continue
        try:
            ritems = core.rule_items(f)
        except Exception:
            continue
        for r in ritems:
            if r['type'] == '협의할 사람' and ' · ' in r['text'] and not r.get('nomerge'):
                parts = r['text'].split(' · ')
                if len(parts) >= 2 and core.PHONE.fullmatch(parts[1].strip()) and not DUMMY_PHONE.search(parts[1]) and not HR_NAME.search(d['title']):
                    ph = parts[1].strip()
                    if ph not in people and parts[0] and parts[0] not in ('담당자', '?'):
                        people[ph] = {'name': parts[0], 'phone': ph, 'line': mask_secret(' · '.join(parts[2:]))[:70], 'file': d['file'], 'title': d['title'], 'area': d['area']}
                continue
            if r['type'] != '월별 할 일' or SECRET_LINE.search(r['text']) or n_rule >= 40:
                continue
            when = r.get('when') or ''
            ev = core.DUE_EVERY.search(r['text'])
            annual = d['cls'] in ('인수인계서', '매뉴얼') or (d['cls'] == '표·대장' and re.search(r'일정|계획|달력|캘린더', d['title']))
            mo = re.search(r'(\d{1,2})월', when)
            if ev and when in ('매월', '익월', '매주', '매년', '매분기'):
                cyc = {'익월': '매월', '매분기': '분기'}.get(when, when)
                recur = {'cycle': cyc}; label = re.sub(r'\s*까지$', '', ev.group(0)).strip()
            elif annual and mo:
                recur = {'cycle': '매년', 'month': int(mo.group(1)), 'years': []}; label = '%s월' % mo.group(1)
            else:
                continue
            key = core.norm(r['text'])[:30]
            if key in seen_r:
                continue
            seen_r.add(key); n_rule += 1; n += 1
            it = {'id': n, 'file': d['file'], 'kind': d['kind'], 'cls': d['cls'], 'date': d['date'], 'date_src': d.get('date_src', ''), 'docno': '', 'title': r['text'][:80], 'area': d['area'],
                  'due': [], 'due_next': '', 'contacts': [], 'recur': recur, 'attachments': [], 'kind3': '반복', 'reflected': '', 'hist': False, 'is_status': False,
                  'summary': '', 'todo': r['text'][:110], 'todo_src': '원문', 'owner': '', 'model_status': '', 'src': '규칙(반복 문장)', 'keep': True, 'decided': False, 'status': '진행',
                  'next': '', 'note': '', 'seen': False, 'quote': mask_secret(r['quote'][:110]), 'when': label, 'rkey': 'R:' + key}
            p = old_r.get(it['rkey'])
            if p:
                for k in ('keep', 'decided', 'note', 'seen', 'question', 'bulk'):
                    if k in p and (p.get('decided') or k in ('note', 'seen', 'question')):
                        it[k] = p[k]
                for k in ('title', 'todo', 'area', 'when'):
                    if p.get(k + '_by') == '사람':
                        it[k] = p.get(k, it[k]); it[k + '_by'] = '사람'
            items.append(it)
    # 연락처: 표·명단(엑셀)에서도 뽑고, 공문 대부분에 찍힌 자기 사무실 번호는 뺀다
    n_with = sum(1 for d in docs if d.get('contacts'))
    own = set()   # 자기 사무실 번호는 내보낼 때 소속(1-가) 이름으로 거른다(공문에 자주 나오는 번호는 상대 기관 담당일 수도 있어 여기서 빼지 않는다)
    for it in items:
        it['contacts'] = [c for c in (it.get('contacts') or []) if c['phone'] not in own]
    in_items = {c['phone'] for it in items for c in (it.get('contacts') or [])}
    people_list = [v for ph, v in people.items() if ph not in own and ph not in in_items][:200]
    for p in (prev_items or []):   # 전임자가 직접 적은 항목은 파일이 없으니 그대로 이어 간다
        if p.get('src') == '직접 입력':
            n += 1
            items.append(dict(p, id=n))
    if ck is not None:
        try:
            ck.close()
        except Exception:
            pass
    info = {'manual': manual['file'] if manual is not None else '', 'manual_refs': len(nos), 'n_docs': len(docs), 'n_window': sum(1 for d in docs if d.get('in_window')),
            'n_items': len(items), 'n_issue': sum(1 for i in items if i['kind3'] == '현안'), 'n_recur': sum(1 for i in items if i['kind3'] == '반복'),
            'n_doc': sum(1 for i in items if i['kind3'] == '문서'), 'n_old': sum(1 for d in docs if d['kind3'] == '기간 밖'), 'n_attach': sum(1 for d in docs if d['kind3'] == '붙임'),
            'n_unreflected': sum(1 for i in items if manual is not None and not i['reflected'] and i['cls'] == '공문'), 'sec': round(time.time() - t_all, 1), 'stopped': stopped,
            'n_hist': sum(1 for i in items if i['kind3'] == '연혁'), 'n_status': sum(1 for i in items if i['kind3'] == '현황'),
            'people': people_list, 'own_phones': sorted(own), 'secret_files': [d['file'] for d in docs if d.get('secret')][:50], 'private_files': [d['file'] for d in docs if d.get('private')][:50],
            'base_date': today.isoformat() if today else '', 'base_why': base_why, 'asset_hints': asset_hints(files, docs),
            'docs_old': [{'file': d['file'], 'date': d['date'], 'title': d['title'], 'area': d['area'], 'cls': d['cls']} for d in docs if d['kind3'] == '기간 밖'][:5000],
            'docs_other': [{'file': d['file'], 'date': d['date'], 'title': d['title'], 'area': d['area'], 'why': '업무 매뉴얼' if d['kind3'] == '매뉴얼' else {'copy': '같은 파일 사본', 'version': '이전 판(수정본, 최신: %s)' % base_name({'file': d.get('dup_of', '')})}.get(d.get('dup'), '같은 문서의 다른 형식(중복본)')} for d in docs if d['kind3'] in ('매뉴얼', '중복')][:2000]}
    return items, calls, errors, info


ASSET_LINE = {'acct': re.compile(r'계정|아이디|접속|권한|인증서|공인인증|OTP'), 'goods': re.compile(r'열쇠|키\s*보관|비품|물품|재고|장비|태블릿|카드\s*보관|도장|직인'),
              'budget': re.compile(r'예산|정산|미지급|잔액|집행|지출|결산|선급|미수')}


def asset_hints(files, docs):
    """3절(물품·예산·계정) 칸을 채울 때 참고할 원문 줄(문서에 있는 것만, 비밀번호 줄 제외). 칸마다 6줄까지."""
    by_doc = {d['file']: d for d in docs}
    out = {k: [] for k in ASSET_LINE}
    for f in files:
        d = by_doc.get(f['file'])
        if not d or d.get('private') or d.get('dup') or d['kind3'] == '기간 밖':
            continue
        for l in text_of(f).split('\n'):
            l = re.sub(r'\s+', ' ', l).strip()
            if not (10 <= len(l) <= 140) or SECRET_LINE.search(l):
                continue
            for k, rx in ASSET_LINE.items():
                if len(out[k]) < 6 and rx.search(l) and not any(l == x['line'] for x in out[k]):
                    out[k].append({'line': mask_secret(l), 'file': f['file']})
    return out


def plan_summary(files, areas, months=12, model_scope='issues', avg_sec=30.0, today=None):
    base_why = '지정'
    if today is None:
        today, base_why = base_date(files)
    docs = plan_docs(files, areas, months, model_scope, today=today)
    n_model = sum(1 for d in docs if d['to_model'])
    return {'calls': n_model, 'est_sec': round(n_model * avg_sec), 'avg_sec': avg_sec, 'n_items': sum(1 for d in docs if d['kind3'] in ('현안', '반복', '문서', '연혁', '현황')),
            'n_hist': sum(1 for d in docs if d['kind3'] == '연혁'), 'n_status': sum(1 for d in docs if d['kind3'] == '현황'),
            'n_issue': sum(1 for d in docs if d['kind3'] == '현안'), 'n_recur': sum(1 for d in docs if d['kind3'] == '반복'), 'n_doc': sum(1 for d in docs if d['kind3'] == '문서'),
            'n_old': sum(1 for d in docs if d['kind3'] == '기간 밖'), 'n_attach': sum(1 for d in docs if d['kind3'] == '붙임'), 'files_model': n_model, 'files_rule_only': len(docs) - n_model,
            'base_date': today.isoformat(), 'base_why': base_why, 'n_private': sum(1 for d in docs if d.get('private')), 'n_secret': sum(1 for d in docs if d.get('secret')),
            'n_dupver': sum(1 for d in docs if d.get('dup') in ('copy', 'version'))}
