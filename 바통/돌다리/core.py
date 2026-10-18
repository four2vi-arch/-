#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""돌다리 v1.0 · 공통 처리부(2026-10-10): 규칙층 + 로컬 모델로 출처 달린 인수인계 초안을 만든다.

measure.py(관문 실측·채점)와 server.py(로컬 웹 화면)가 같이 쓴다. 모델 호출은 이 파일의 call_model만 하며,
주소는 127.0.0.1/localhost만 허용한다(is_local_url). 원본 파일은 extract.py가 읽기만 한다.

처리 흐름(build_draft)
  1) 규칙층: 「협의 담당: 이름(소속, 전화)」·전화번호 줄·기한 문장·현안 신호어 줄을 규칙으로 뽑는다(발췌 = 원문 줄).
  2) 모델: 파일마다(긴 파일은 max_chars씩 나눠) 유형 3가지 항목을 JSON으로 받는다. 표 파일(엑셀·csv)은 기본으로 모델에 보내지 않는다(오독이 많음).
  3) 근거 확인: 발췌가 원문에 그대로 있으면 싣고, 원문 한 줄과 70% 이상 겹치면 그 줄로 바꿔 「발췌 보정」, 아니면 「불확실(제외)」.
  4) 규칙 항목과 겹치는 모델 항목은 버린다.
"""
import os, re, json, time, math, urllib.request, urllib.error, urllib.parse

SENTENCE_KINDS = {'hwp', 'hwpx', 'docx', 'pdf', 'eml', 'txt', 'md'}   # 문장 파일: 모델에 보낸다
TABLE_KINDS = {'xlsx', 'xlsm', 'csv'}                                  # 표 파일: 기본은 규칙층만


def is_local_url(url):
    try:
        h = urllib.parse.urlsplit(url).hostname or ''
    except Exception:
        return False
    return h in ('127.0.0.1', 'localhost', '::1')


TYPES = ['월별 할 일', '협의할 사람', '진행 중 현안']
SYS = ('너는 공공기관 인수인계 도우미다. 전임자의 업무 문서 하나를 읽고 후임자에게 필요한 항목만 뽑아 JSON 객체 하나로만 답하라.\n'
       '유형은 다음 셋 중 하나만 쓴다.\n'
       '- "월별 할 일": 날짜·기한이 있거나 매년 되풀이되는 업무. 예) 7월 18일까지 예산 요구서 제출\n'
       '- "협의할 사람": 이름과 소속·전화가 적힌 담당자. 예) 강민재(재정과 예산담당, 063-000-0101)\n'
       '- "진행 중 현안": 아직 끝나지 않았거나 문제가 남은 일(미조치·반려·미결·협의 중·고장 등). 예) 계약 갱신 협의가 끝나지 않음\n'
       '답 형식(예시):\n'
       '{"items":[{"type":"월별 할 일","text":"7월 18일까지 2026년도 본예산 편성 요구서 제출","when":"2025년 7월","quote":"2026년도 본예산 편성 요구서를 7월 18일까지 재정과에 제출합니다."}]}\n'
       '규칙: (1) quote는 문서에 있는 한 줄(한 문장)을 글자 그대로 복사한다. 줄여 쓰거나 합치거나 고치지 않는다. (2) 문서에 없는 내용은 만들지 않는다. '
       '(3) quote를 채울 수 없는 항목은 넣지 않는다. (4) 해당 항목이 없으면 {"items":[]}. (5) 설명문·코드 펜스 없이 JSON만.')

PHONE = re.compile(r'0\d{1,2}-\d{3,4}-\d{4}')  # ☎·☏ 뒤에 와도 번호만 잡힌다
DUE = re.compile(r'(\d{1,2})월\s*(?:(\d{1,2})일|말|초|중순)\s*까지')
DUE_EVERY = re.compile(r'(매월|익월|매주|매년|매분기)\s*(?:\d{1,2}일|[월화수목금토일]요일|말|초)?\s*(?:까지)?')
DUE_RANGE = re.compile(r'(\d{1,2})월\s*\d{1,2}일\s*[~∼～-]\s*(?:\d{1,2}월\s*)?\d{1,2}일')
DATE_FULL = re.compile(r'(20\d{2})[-.]\s?(\d{1,2})[-.]\s?(\d{1,2})')
REL_DUE = re.compile(r'\d+\s*(?:개월|주|일)\s*전')
ACTION = re.compile(r'합니다|한다|할 것|제출|수립|실시|협의|조치|이관|정리|보완|결정|검토|점검|제출일|기한|마감|통보|안내|채용|납부|독촉|배정|정산|회신|보고|작성|접수|발송|게시|확인|신청|제출|갱신|이동|교환')
ISSUE = re.compile(r'미조치|미결|미완료|미이행|미납|미확정|미해결|반려|보류 중|보류됨|보류하|지연되|지연 중|지연됨|끝나지 않|결론 못|안 됨|못 냄|재협의|협의 중|이견|고장|누수')
REFERENCE_NAME = re.compile(r'지침|매뉴얼|길라잡이|규정|서식|편람|가이드|안내서|업무처리|FAQ', re.I)   # 절차를 설명하는 참고 문서: 현안 규칙을 적용하지 않는다
TITLE = re.compile(r'([가-힣]{2,4})\s+(?:담당|주무관|과장|팀장|실장|계장|대리|주임|사원)')
TITLE2 = re.compile(r'(?:담당|주무관|과장|팀장|실장|계장|대리|주임|사원|국장)\s+([가-힣]{2,4})(?![가-힣])')
NOT_NAME = re.compile(r'과$|팀$|실$|부$|처$|국$|군청|시청|도청|구청|사무소|소방서|담당|요청|업체|연락|전화|번호|협의|문의|총괄|업무|서무|예산|보안|청사|관리|기록|감사|계약|현안|회의|참석|발견|보수')
MONTH = re.compile(r'(\d{1,2})월')


def name_near_phone(line_body, phone):
    """전화번호 줄에서 사람 이름을 고른다: 「이름 담당/과장…」 → 번호 바로 앞 낱말 → '담당자'."""
    for rx in (TITLE, TITLE2):
        for m in rx.finditer(line_body):
            if not NOT_NAME.search(m.group(1)):
                return m.group(1)
    before = re.sub(r'\([^()]*\)', ' ', line_body[:line_body.find(phone)])  # 괄호 안(소속 설명)은 이름 후보에서 뺀다
    m = re.search(r'([가-힣]{2,4})\s*[\(:·,]?\s*$', before)
    if m and not NOT_NAME.search(m.group(1)):
        return m.group(1)
    for tok in reversed(re.findall(r'(?<![가-힣])([가-힣]{2,4})(?![가-힣])', before)):  # 번호 앞 낱말들 가운데 이름꼴
        if not NOT_NAME.search(tok):
            return tok
    org = re.findall(r'[가-힣]{2,8}(?:과|팀|실|센터|국|소|원|부서)', before)   # 이름이 없으면 소속(○○과·○○팀)으로
    return org[-1] if org else '담당자'


def norm(s):
    return re.sub(r'\s+', '', str(s or '')).lower()


def grams(s):
    s = norm(s)
    return {s[i:i + 2] for i in range(len(s) - 1)}


def grounded(q, ftext):
    q = str(q or '')
    if not q.strip():
        return False
    nf = norm(ftext)
    lines = [l for l in re.split(r'\n+', q) if l.strip()]
    if all(norm(l) in nf for l in lines):
        return True
    g = grams(q)
    return len(g) >= 6 and len(g & grams(ftext)) / len(g) >= 0.9


def source_lines(ftext):
    """원문을 줄 단위로(엑셀 「n행:」 머리 제거), 이어진 두 줄도 후보에 넣는다."""
    L = [re.sub(r'^\d+행:\s*', '', l.strip()) for l in re.split(r'\n+', ftext) if l.strip()]
    return L + [L[i] + ' ' + L[i + 1] for i in range(len(L) - 1)]


def best_line(s, lines):
    """s의 2-gram이 가장 많이 담긴 원문 줄과 그 비율."""
    g = grams(s)
    if len(g) < 4:
        return None, 0.0
    best, bs = None, 0.0
    for l in lines:
        c = len(g & grams(l)) / len(g)
        if c > bs:
            best, bs = l, c
    return best, bs


def ground_fix(q, text, ftext, lines, th_snap=0.7, th_text=0.7):
    """(발췌, 방법) 반환. 방법: '원문'(그대로 있음) · '발췌 보정'(원문 줄로 바꿈) · None(근거 없음)."""
    if grounded(q, ftext):
        return q, '원문'
    if q.strip():
        l, c = best_line(q, lines)
        return (l, '발췌 보정') if c >= th_snap else (None, None)
    l, c = best_line(text, lines)
    return (l, '발췌 보정') if c >= th_text else (None, None)


def contain(a, b):
    """짧은 쪽 2-gram이 긴 쪽에 담긴 비율."""
    A, B = grams(a), grams(b)
    if min(len(A), len(B)) < 4:
        return 0.0
    return len(A & B) / min(len(A), len(B))


def line_overlap(a, b):
    """발췌 줄이 서로 포함되는가(짧은 쪽 6자 이상)."""
    a, b = norm(a), norm(b)
    return min(len(a), len(b)) >= 6 and (a in b or b in a)


def fix_type(t, text, quote):
    t = str(t or '').strip()
    if t in TYPES:
        return t
    s = text + ' ' + quote
    if PHONE.search(s) or re.search(r'담당|협의할|연락', s):
        return '협의할 사람'
    if re.search(r'까지|기한|\d{1,2}월|매월|분기|연간|실시|제출|수립', s):
        return '월별 할 일'
    return '진행 중 현안'


def sim(a, b):
    a, b = norm(a), norm(b)
    if len(a) < 2 or len(b) < 2:
        return 1.0 if a == b else 0.0
    A = {a[i:i + 2] for i in range(len(a) - 1)}
    B = {b[i:i + 2] for i in range(len(b) - 1)}
    return len(A & B) / len(A | B)


def parse_json_loose(s):
    s = re.sub(r'<think>[\s\S]*?</think>', '', str(s or ''))
    s = re.sub(r'```[a-zA-Z]*', '', s)
    i = s.find('{')
    while i >= 0:
        depth, in_str, k = 0, False, i
        while k < len(s):
            ch = s[k]
            if in_str:
                if ch == '\\':
                    k += 1
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(s[i:k + 1])
                    except Exception:
                        break
            k += 1
        i = s.find('{', i + 1)
    return None


def call_model(url, model, key, text, timeout=600, json_mode=True, system=None):
    body = {'model': model, 'temperature': 0, 'stream': False,
            'messages': [{'role': 'system', 'content': system or SYS}, {'role': 'user', 'content': text}]}
    if json_mode:
        body['response_format'] = {'type': 'json_object'}
    headers = {'Content-Type': 'application/json'}
    if key:
        headers['Authorization'] = 'Bearer ' + key
    req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            j = json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        if json_mode and e.code >= 500:  # 젬마 2차에서 HTTP 500 2건: JSON 강제 없이 한 번 더
            return call_model(url, model, key, text, timeout, json_mode=False, system=system)
        raise
    c = (j.get('choices') or [{}])[0].get('message', {}).get('content') or j.get('message', {}).get('content') or ''
    return c, j.get('usage') or {}


# ---------------------------------------------------------------- 규칙층: 구조가 뚜렷한 사실은 규칙으로(발췌 = 원문 줄 그대로)
TABLE_CONTACT_CAP = 30   # 표 파일 하나에서 싣는 연락처 상한(그 이상은 명단으로 보고 한 줄로 알림)
DOC_ROW_CONTACT_CAP = 5  # 문서 속 표 행(수신처·업체 명단)에서 싣는 연락처 상한


def rule_items(fobj):
    items = []
    seen = set()
    year_hint, month_hint = '', 0
    is_table = fobj.get('kind') in TABLE_KINDS                      # 표 파일(엑셀·csv): 담당자·「○월 ○일까지」만 규칙 적용
    is_reference = bool(REFERENCE_NAME.search(os.path.basename(fobj.get('file', ''))))   # 지침·매뉴얼: 현안 규칙 제외
    n_contacts = 0

    def add(kind, text, when, raw, loc):
        key = (kind, norm(raw))
        if key in seen:
            return
        seen.add(key)
        text = re.sub(r'^(?:[-•*·]\s*|\[[^\]]{1,12}\]\s*|\d+\.\s*|[가-힣]\.\s*|\d+\)\s*|[ㅇ○]\s*|※\s*)+', '', text)  # 글머리 기호·항목 부호 제거
        text = re.sub(r'\s*<small>.*?</small>', '', text)
        items.append({'type': kind, 'text': re.sub(r'\s+', ' ', text).strip()[:80], 'when': when, 'quote': raw, 'loc': loc, 'src': '규칙'})

    def when_of(mon):
        """문서 날짜(연·월)로 기한의 연도를 추정: 문서 월보다 이른 달이면 이듬해."""
        if not year_hint:
            return '%d월' % mon
        y = int(year_hint) + (1 if month_hint and mon < month_hint - 1 else 0)
        return '%d년 %d월' % (y, mon)

    for u in fobj['units']:
        for line in re.split(r'\n+', u['text']):
            raw = line.strip()
            if not raw:
                continue
            line_body = re.sub(r'^\d+행:\s*', '', raw)  # 엑셀 줄 머리 제거
            long_para = len(line_body) > 300                 # 매뉴얼의 긴 문단: 한 줄짜리 할 일이 아니다(전화번호만 본다)
            md_table = line_body.startswith('|')
            md_table = md_table or line_body.count('\t') >= 3             # 마크다운 표 줄: 표 파일처럼 다룬다
            ym = re.search(r'(20\d{2})\.\s*(\d{1,2})\.', raw) or re.search(r'(20\d{2})-(\d{2})-\d{2}', raw) or re.search(r'(20\d{2})(\d{2})\d{2}', fobj.get('file', ''))
            if ym and not year_hint:
                year_hint, month_hint = ym.group(1), int(ym.group(2))
            # 협의할 사람: 「협의 담당: 이름(소속, 전화)」 또는 전화번호가 든 줄
            m = re.search(r'협의 담당:\s*([가-힣]{2,4})\(([^,()]+(?:\([^()]*\)[^,()]*)?),\s*(0\d{1,2}-\d{3,4}-\d{4})\)', raw)
            if m:
                if ('p', m.group(3)) not in seen:
                    seen.add(('p', m.group(3)))
                    add('협의할 사람', '%s · %s · %s' % (m.group(1), m.group(2).strip(), m.group(3)), '', raw, u['loc'])
                continue
            is_row = line_body.count('\t') >= 3 or md_table          # 문서 안의 표 행(수신처·업체 명단): 실제 폴더에서 사람 항목 1,063개 중 599개가 여기서 나왔다
            cap = TABLE_CONTACT_CAP if is_table else (DOC_ROW_CONTACT_CAP if is_row else 10 ** 9)
            for m_ph in PHONE.finditer(line_body):
                ph = m_ph.group(0)
                if ('p', ph) in seen:
                    continue
                seen.add(('p', ph))
                if re.search(r'팩스|FAX|fax|Fax', line_body[max(0, m_ph.start() - 12):m_ph.start()]):   # 팩스 번호는 협의 상대가 아니다
                    continue
                if n_contacts >= cap:   # 명단 성격(표 파일·문서 속 표)은 앞 몇 건만 싣고 나머지는 파일을 직접 보게 한다
                    n_contacts += 1
                    continue
                n_contacts += 1
                add('협의할 사람', '%s · %s · %s' % (name_near_phone(line_body, ph), ph, re.sub(r'\s+', ' ', line_body)[:50]), '', raw, u['loc'])
            # 월별 할 일: 「○월 ○일/말/초까지」·「○월 ○일~○일」·「2025-09-11」(제출·기한과 함께)·「○개월/○주 전」이 든 문장
            if long_para or md_table:
                continue
            d = DUE.search(line_body) or DUE_RANGE.search(line_body)
            if d and ACTION.search(line_body):
                add('월별 할 일', line_body, when_of(int(d.group(1))), raw, u['loc'])
                continue
            f = DATE_FULL.search(line_body)
            if f and not is_table and re.search(r'제출|기한|마감|까지|완료|예정', line_body) and not PHONE.search(line_body):
                add('월별 할 일', line_body, '%s년 %d월' % (f.group(1), int(f.group(2))), raw, u['loc'])
                continue
            if REL_DUE.search(line_body) and ACTION.search(line_body) and not is_table:
                add('월별 할 일', line_body, '', raw, u['loc'])
                continue
            e = DUE_EVERY.search(line_body)
            if e and ACTION.search(line_body) and len(norm(line_body)) >= 8 and not is_table:
                add('월별 할 일', line_body, e.group(1), raw, u['loc'])
                continue
            # 진행 중 현안: 현안 신호어가 든 줄(전화번호 줄은 위에서 처리)
            if ISSUE.search(line_body) and 8 <= len(norm(line_body)) <= 150 and not PHONE.search(line_body) and not is_table and not is_reference:
                add('진행 중 현안', line_body, '', raw, u['loc'])
    cap_used = TABLE_CONTACT_CAP if is_table else DOC_ROW_CONTACT_CAP
    if n_contacts > cap_used:
        items.append({'type': '협의할 사람', 'text': '(이 %s에 연락처가 %d건 더 있음 · 명단은 파일에서 직접 볼 것)' % ('표' if is_table else '문서의 표', n_contacts - cap_used), 'when': '', 'quote': '', 'loc': '', 'src': '규칙', 'nomerge': True})
    return items


def merge_similar(draft, progress=None, time_budget=180, bucket_cap=400):
    """같은 유형에서 발췌 줄이 서로 포함되거나 요약이 비슷한 항목(같은 공문이 일정표·메모·초안에 되풀이된 것)을 한 항목으로 묶는다.
    첫 항목이 대표가 되고 나머지 출처는 also 목록에 들어간다. 문장 파일(공문·보고서) 출처를 대표로 우선한다.
    수천~수만 항목에서도 끝나도록 2-gram 집합을 한 번만 만들고, 후보는 (유형, 발췌 앞 12자)·(유형, 요약 앞 12자)·공유 2-gram이 많은 묶음으로 좁힌다."""
    order = {k: i for i, k in enumerate(['odt', 'hwp', 'hwpx', 'docx', 'pdf', 'eml', 'txt', 'md', 'xlsx', 'xlsm', 'csv'])}

    def kind_of(f):
        return os.path.splitext(f.split(' ▸ ')[-1])[1].lower().lstrip('.')

    def jacc(A, B):
        if not A or not B:
            return 0.0
        return len(A & B) / len(A | B)

    def cont(A, B):
        if min(len(A), len(B)) < 4:
            return 0.0
        return len(A & B) / min(len(A), len(B))

    groups, by_key, by_gram = [], {}, {}
    t_start = time.time(); over_budget = False
    for i, d in enumerate(draft):
        nq, nt = norm(d['quote']), norm(d['text'])
        gq, gt = grams(d['quote']), grams(d['text'])
        keys = [(d['type'], 'q', nq[:12]), (d['type'], 't', nt[:12])]
        if d['type'] == '협의할 사람':
            m_ph = PHONE.search(str(d.get('text') or ''))
            if m_ph:
                keys.append((d['type'], 'p', m_ph.group(0)))   # 같은 번호는 같은 사람(여러 문서에 되풀이된 연락처를 한 항목으로)
        cand = set()
        if not over_budget:
            for k in keys:
                b = by_key.get(k, ())
                cand.update(b[-bucket_cap:])                 # 같은 앞머리가 수천이면(명단·같은 서식) 최근 것만 본다
            # 공유 2-gram이 많은 묶음(요약 기준): 흔치 않은 2-gram 8개를 골라 색인을 본다(「우편」처럼 어디에나 있는 조각은 가려내지 못함)
            seen_g = [g for g in gt if (d['type'], g) in by_gram]          # 아직 색인에 없는 조각은 후보를 못 내므로 뺀다
            rare = sorted(seen_g, key=lambda g: len(by_gram[(d['type'], g)]))[:8]
            for g in rare:
                b = by_gram.get((d['type'], g), ())
                if len(b) <= bucket_cap:
                    cand.update(b)
        if time.time() - t_start > time_budget and not over_budget:   # 시간 예산을 넘기면 남은 항목은 묶지 않고 그대로 싣는다
            over_budget = True
        hit = None
        for gi in cand:
            g = groups[gi]
            if g['type'] != d['type'] or g.get('nomerge') or d.get('nomerge'):
                continue
            if (d['type'] == '협의할 사람' and g.get('_ph') and PHONE.search(str(d.get('text') or '')) and g['_ph'] == PHONE.search(str(d.get('text') or '')).group(0)) \
               or (min(len(g['_nq']), len(nq)) >= 6 and (g['_nq'] in nq or nq in g['_nq'])) or jacc(g['_gt'], gt) >= 0.6 or cont(g['_gq'], gq) >= 0.8:
                hit = g
                break
        if hit is None:
            g = dict(d); g['also'] = []; g['_nq'], g['_nt'], g['_gq'], g['_gt'] = nq, nt, gq, gt
            g['_ph'] = (PHONE.search(str(d.get('text') or '')).group(0) if d['type'] == '협의할 사람' and PHONE.search(str(d.get('text') or '')) else None)
            groups.append(g); gi = len(groups) - 1
            for k in keys:
                by_key.setdefault(k, []).append(gi)
            for gram in gt:
                by_gram.setdefault((d['type'], gram), []).append(gi)
        else:
            if order.get(kind_of(d['file']), 99) < order.get(kind_of(hit['file']), 99) and d['src'] == hit['src']:
                also = hit['also'] + [{'file': hit['file'], 'quote': hit['quote']}]
                hit.update({k: d[k] for k in ('file', 'text', 'when', 'quote', 'src')}); hit['also'] = also
                hit['_nq'], hit['_nt'], hit['_gq'], hit['_gt'] = nq, nt, gq, gt
            else:
                hit['also'].append({'file': d['file'], 'quote': d['quote']})
        if progress and i % 500 == 0:
            progress({'phase': '같은 내용 묶는 중', 'index': i, 'total': len(draft)})
    for g in groups:
        for k in ('_nq', '_nt', '_gq', '_gt', '_ph'):
            g.pop(k, None)
    if over_budget:
        print('같은 내용 묶기: %d초 예산을 넘겨 나머지는 묶지 않음' % time_budget, flush=True)
    return groups


# ---------------------------------------------------------------- 부하 계획·초안 만들기(화면·실측 공용)
def model_text(units):
    """모델에 보내는 글자 그대로(위치 표시 포함). 호출 수 계산과 토막 나누기가 같은 길이를 쓰도록 한 곳에 둔다."""
    return '\n'.join('[%s] %s' % (u['loc'], u['text']) for u in units)


def model_chars(f):
    """plan_load·진행률이 쓰는 글자 수. units가 있으면 model_text 길이, 없으면 추출 때 적어 둔 mchars, 그것도 없으면 본문 글자 수."""
    if f.get('units'):
        return len(model_text(f['units']))
    return f.get('mchars') or f.get('chars', 0)


def plan_load(files, max_chars=6000, include_tables=False, avg_sec=22.0, only_files=None, max_calls_per_file=3, skip_reference=True):
    """파일별 모델 호출 횟수와 예상 시간. 추출은 수 초 안이라 부하는 거의 모델 호출(호출당 avg_sec초; 모의 폴더 21~23초, 실제 긴 공문은 2분 넘기도 함).
    skip_reference: 지침·매뉴얼·길라잡이 같은 참고 문서는 모델에 보내지 않는다(길고, 할 일·담당은 규칙으로 충분히 잡힘)."""
    rows = []
    for f in files:
        to_model = (f['kind'] in SENTENCE_KINDS or (include_tables and f['kind'] in TABLE_KINDS))
        if skip_reference and REFERENCE_NAME.search(os.path.basename(f['file'].split(' ▸ ')[0])):
            to_model = False
        if only_files is not None:
            to_model = to_model and f['file'] in only_files
        mc = model_chars(f)
        calls = min(max_calls_per_file, max(1, math.ceil(mc / max_chars))) if to_model else 0  # 긴 파일은 앞부분 max_calls_per_file 토막까지만
        rows.append({'file': f['file'], 'kind': f['kind'], 'chars': mc, 'calls': calls, 'to_model': to_model})
    n_calls = sum(r['calls'] for r in rows)
    return {'rows': rows, 'calls': n_calls, 'est_sec': round(n_calls * avg_sec), 'avg_sec': avg_sec,
            'files_model': sum(1 for r in rows if r['to_model']), 'files_rule_only': sum(1 for r in rows if not r['to_model'])}


def make_prompt(fobj, chunk):
    return ('파일 이름: %s\n(아래가 문서 글자다. [ ] 안은 위치 표시다. quote는 이 글자 가운데 한 줄을 그대로 복사한다. '
            '표(엑셀)는 「n행: …」 줄 전체를 복사한다.)\n---\n%s' % (fobj['file'], chunk))


def load_checkpoint(path, folder, model, max_chars):
    """이전 회차의 모델 응답(jsonl). 첫 줄 머리글의 폴더·모델·토막 크기가 같을 때만 쓴다. 손상된 줄은 건너뛴다."""
    out = {}
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            head = json.loads(f.readline() or '{}')
            if not (head.get('folder') == folder and head.get('model') == model and head.get('max_chars') == max_chars):
                return {}
            for line in f:
                try:
                    r = json.loads(line)
                    out[(r['file'], r['chunk'], r['chars'])] = r['content']
                except Exception:
                    continue
    except Exception:
        return {}
    return out


def build_draft(files, model, url='http://127.0.0.1:11434/v1/chat/completions', key='', max_chars=6000,
                include_tables=False, only_files=None, fake=None, replay=None, progress=None, should_stop=None, max_calls_per_file=3, skip_reference=True,
                checkpoint=None, folder='', max_consecutive_failures=5):
    """출처 달린 초안을 만든다. 반환: draft, dropped, calls, errors.
    model='none'이면 규칙층만. fake(fobj)->JSON 문자열이면 모델 대신 쓴다(시험용). replay=이전 결과 dict이면 그때의 모델 답을 다시 쓴다.
    progress(dict)는 파일마다 불린다. should_stop()이 True면 남은 모델 호출을 건너뛴다(규칙 항목은 모두 남음).
    checkpoint=jsonl 경로이면 모델 응답을 호출마다 바로 적고, 같은 폴더·모델·토막 크기의 이전 응답은 다시 부르지 않고 재사용한다(중간에 죽어도 호출 한 번만 잃음).
    모델 서버가 max_consecutive_failures회 연속 응답하지 않으면 남은 파일은 규칙만으로 간다.
    파일 하나에서 무슨 예외가 나도 그 파일만 오류로 남기고 계속 간다."""
    if model not in ('none',) and fake is None and replay is None and not is_local_url(url):
        raise ValueError('모델 주소는 127.0.0.1 또는 localhost만 허용합니다: ' + url)
    texts = {f['file']: '\n'.join(u['text'] for u in f['units']) for f in files}
    lines = {k: source_lines(v) for k, v in texts.items()}
    plan = plan_load(files, max_chars, include_tables, only_files=only_files, max_calls_per_file=max_calls_per_file, skip_reference=skip_reference)
    to_model = {r['file'] for r in plan['rows'] if r['to_model']}
    chars_total = sum(min(r['chars'], max_chars * max_calls_per_file) for r in plan['rows'] if r['to_model'])
    draft, dropped, calls, errors = [], [], [], []
    by_file = {}                                   # 파일 → draft 인덱스(같은 파일 안에서만 중복을 본다; 전체를 훑으면 항목 수의 제곱)
    done_calls, stopped, chars_done, consecutive_fail = 0, False, 0, 0
    prev = {}
    ck = None
    if checkpoint and replay is None and fake is None and model != 'none':
        prev = load_checkpoint(checkpoint, folder, model, max_chars)
        try:
            mode = 'a' if prev else 'w'
            ck = open(checkpoint, mode, encoding='utf-8', errors='replace')
            if mode == 'w':
                ck.write(json.dumps({'folder': folder, 'model': model, 'max_chars': max_chars, 'started': time.strftime('%Y-%m-%d %H:%M:%S')}, ensure_ascii=False) + '\n'); ck.flush()
        except Exception:
            ck = None

    def add_draft(rec):
        by_file.setdefault(rec['file'], []).append(len(draft)); draft.append(rec)

    # 규칙층은 전 파일에 먼저, 모델은 짧은 파일부터(중간에 끊어도 더 많은 파일이 모델을 거치도록)
    for f in files:
        try:
            for it in rule_items(f):
                add_draft({'file': f['file'], 'type': it['type'], 'text': it['text'], 'when': it['when'], 'quote': it['quote'], 'grounded': True, 'src': '규칙', **({'nomerge': True} if it.get('nomerge') else {})})
        except Exception as e:
            errors.append({'file': f['file'], 'chunk': -1, 'reason': '규칙 처리 실패: ' + str(e)[:120]})
    order = sorted(files, key=lambda f: (f['file'] not in to_model, f.get('chars', 0)))
    for fi, f in enumerate(order):
        def report(**kw):
            if progress:
                progress(dict({'file': f['file'], 'index': fi + 1, 'total': len(files), 'calls_done': done_calls, 'calls_total': plan['calls'],
                               'chars_done': chars_done, 'chars_total': chars_total, 'stopped': stopped}, **kw))
        if model == 'none' or (f['file'] not in to_model and replay is None):
            report(skipped=True)
            continue
        if stopped or (should_stop and should_stop()):   # 중단: 남은 파일은 규칙층만(모델 호출 없음)
            stopped = True
            report(skipped=True)
            continue
        try:
            if replay is not None:
                items_all = [{'type': d['type'], 'text': d['text'], 'when': d['when'], 'quote': d.get('quote_raw', d['quote'])}
                             for d in replay['draft'] + replay['dropped'] if d['file'] == f['file'] and d['src'].startswith('모델')]
                chunks = ['(재채점)']
            else:
                full = model_text(f['units'])
                chunks = ([full[i:i + max_chars] for i in range(0, len(full), max_chars)] or [''])[:max_calls_per_file]
            for ci, chunk in enumerate(chunks):
                if should_stop and should_stop():
                    stopped = True
                    break
                t0 = time.time()
                usage = {}; reused = False
                try:
                    if replay is not None:
                        items = items_all
                    else:
                        if fake is not None:
                            content = fake(f)
                        elif (f['file'], ci, len(chunk)) in prev:
                            content = prev[(f['file'], ci, len(chunk))]; reused = True
                        else:
                            content, usage = call_model(url, model, key, make_prompt(f, chunk))
                            if ck is not None:
                                try:
                                    ck.write(json.dumps({'file': f['file'], 'chunk': ci, 'chars': len(chunk), 'content': content}, ensure_ascii=False) + '\n'); ck.flush()
                                except Exception:
                                    pass
                        consecutive_fail = 0
                        obj = parse_json_loose(content)
                        items = (obj or {}).get('items') if isinstance(obj, dict) else None
                        if items is None:
                            errors.append({'file': f['file'], 'chunk': ci, 'reason': 'JSON 아님', 'head': str(content)[:200]}); items = []
                except urllib.error.HTTPError as e:
                    errors.append({'file': f['file'], 'chunk': ci, 'reason': 'HTTP %d' % e.code}); items = []
                    consecutive_fail += 1
                except Exception as e:
                    errors.append({'file': f['file'], 'chunk': ci, 'reason': str(e)[:160]}); items = []
                    consecutive_fail += 1
                if replay is None:
                    calls.append({'file': f['file'], 'chunk': ci, 'chars': len(chunk), 'sec': round(time.time() - t0, 1), 'items': len(items), 'usage': usage, 'reused': reused})
                done_calls += 1; chars_done += len(chunk)
                if consecutive_fail >= max_consecutive_failures:
                    errors.append({'file': '', 'chunk': -1, 'reason': '모델 서버가 %d회 연속 응답하지 않아 남은 파일은 규칙만 적용했습니다(모델 주소·Ollama 실행 여부를 확인하세요)' % consecutive_fail})
                    stopped = True
                    break
                mine = by_file.get(f['file'], [])
                for it in items:
                    if not isinstance(it, dict):
                        continue
                    q = str(it.get('quote') or '').strip()
                    text = str(it.get('text') or '').strip()
                    if not text:
                        continue
                    q2, how = ground_fix(q, text, texts[f['file']], lines[f['file']])
                    if fix_type(it.get('type'), text, q) == '협의할 사람' and not (PHONE.search(text + ' ' + (q2 or q)) or TITLE.search(text + ' ' + (q2 or q)) or TITLE2.search(text + ' ' + (q2 or q))):
                        continue   # 「우편영업실장」「과장」처럼 누구인지 특정되지 않는 사람 항목은 싣지 않는다
                    rec = {'file': f['file'], 'type': fix_type(it.get('type'), text, q), 'text': text, 'when': str(it.get('when') or ''),
                           'quote': q2 if q2 is not None else q, 'grounded': q2 is not None,
                           'src': '모델' if how == '원문' else ('모델(발췌 보정)' if how else '모델'), 'quote_raw': q}
                    if any(draft[k]['type'] == rec['type'] and (sim(draft[k]['text'], rec['text']) >= 0.5 or sim(draft[k]['quote'], rec['quote']) >= 0.6 or line_overlap(draft[k]['quote'], rec['quote'])) for k in mine):
                        continue
                    if rec['grounded']:
                        add_draft(rec); mine = by_file.get(f['file'], [])
                    else:
                        dropped.append(rec)
        except Exception as e:   # 파일 하나의 예상 못 한 예외: 그 파일만 오류로 남기고 계속
            errors.append({'file': f['file'], 'chunk': -1, 'reason': '파일 처리 실패: ' + str(e)[:140]})
        report(skipped=False)
    if ck is not None:
        try:
            ck.close()
        except Exception:
            pass
    return draft, dropped, calls, errors

# ---------------------------------------------------------------- 분야(키워드)·주기 꼬리표
DEFAULT_AREAS = [
    {'name': '요금후납·계약', 'keys': '요금후납, 후납, 계약, 갱신, 수탁, 업체'},
    {'name': '소포·택배·EMS', 'keys': '소포, 택배, EMS, 국제우편, 특별소통, 명절, 설 , 추석'},
    {'name': '우체국쇼핑', 'keys': '쇼핑, 특산품, 입점, 카탈로그, 선물, 공급업체'},
    {'name': '창구전시판매', 'keys': '전시판매, 매대, POP, 창구판매, 진열'},
    {'name': '매출·실적', 'keys': '매출, 실적, 목표, 달성, 진도, 점검'},
    {'name': '고객만족·KPCSI', 'keys': 'KPCSI, 만족도, 친절, 민원, 고객'},
    {'name': '홍보·마케팅', 'keys': '홍보, 마케팅, 판촉, 캠페인, 이벤트, 안내문'},
    {'name': '회의·보고', 'keys': '회의, 보고, 결과보고, 계획, 추진'},
    {'name': '규정·매뉴얼', 'keys': '지침, 매뉴얼, 규정, 서식, 길라잡이, 편람'},
    {'name': '예산·정산', 'keys': '예산, 정산, 지급, 수수료, 경비, 환급'},
    {'name': '인사·복무', 'keys': '인사, 발령, 근무평정, 근무성적, 교육훈련, 정원, 복무, 인력, 채용'},   # v3.7: 순환보직(경영지원) 자료가 「기타」로 몰리던 것
]
CYCLE_PATTERNS = [('매주', r'매주|주간|주별|매 ?주'), ('매월', r'매월|월별|월마감|익월|매 ?달|월 초|월말|매월말'), ('분기', r'분기'), ('반기', r'반기|상반기|하반기'),
                  ('매년', r'매년|연간|연말|연초|연 ?1회|해마다|매 ?해')]


def parse_areas(text):
    """설정 글(한 줄에 「분야: 키워드, 키워드」)을 목록으로."""
    out = []
    for line in str(text or '').splitlines():
        if ':' not in line and '：' not in line:
            continue
        name, keys = re.split(r'[:：]', line, 1)
        if name.strip():
            out.append({'name': name.strip(), 'keys': keys.strip()})
    return out


def areas_text(areas):
    return '\n'.join('%s: %s' % (a['name'], a['keys']) for a in areas)


def area_of(item, areas):
    hay = ' '.join(str(item.get(k) or '') for k in ('text', 'quote', 'file', 'note')).lower()
    best, score = '기타', 0
    for a in areas:
        keys = [k.strip().lower() for k in str(a.get('keys', '')).split(',') if k.strip()]
        n = sum(hay.count(k) for k in keys)
        if n > score:
            best, score = a['name'], n
    return best


def cycle_of(item):
    hay = ' '.join(str(item.get(k) or '') for k in ('when', 'text', 'quote'))
    for name, pat in CYCLE_PATTERNS:
        if re.search(pat, hay):
            return name
    return '해당 월' if re.search(r'\d{1,2}월', str(item.get('when') or '')) else '1회'


def tag_items(items, areas, keep_manual=True):
    """분야·주기 꼬리표를 붙인다. 사람이 고른 분야(area_by)는 바꾸지 않는다."""
    for it in items:
        if keep_manual and it.get('area_by') == '사람':
            continue
        it['area'] = area_of(it, areas)
        it['cycle'] = cycle_of(it)
    return items
