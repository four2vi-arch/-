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
ISSUE = re.compile(r'미조치|미결|미완료|미이행|미납|미확정|미해결|반려|보류|지연|끝나지 않|결론 못|안 됨|못 냄|재협의|협의 중|이견|고장|누수|파손|분실')
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
    return '담당자'


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


def call_model(url, model, key, text, timeout=600, json_mode=True):
    body = {'model': model, 'temperature': 0, 'stream': False,
            'messages': [{'role': 'system', 'content': SYS}, {'role': 'user', 'content': text}]}
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
            return call_model(url, model, key, text, timeout, json_mode=False)
        raise
    c = (j.get('choices') or [{}])[0].get('message', {}).get('content') or j.get('message', {}).get('content') or ''
    return c, j.get('usage') or {}


# ---------------------------------------------------------------- 규칙층: 구조가 뚜렷한 사실은 규칙으로(발췌 = 원문 줄 그대로)
def rule_items(fobj):
    items = []
    seen = set()
    year_hint, month_hint = '', 0

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
            for ph in PHONE.findall(line_body):
                if ('p', ph) in seen:
                    continue
                seen.add(('p', ph))
                add('협의할 사람', '%s · %s · %s' % (name_near_phone(line_body, ph), ph, re.sub(r'\s+', ' ', line_body)[:50]), '', raw, u['loc'])
            # 월별 할 일: 「○월 ○일/말/초까지」·「○월 ○일~○일」·「2025-09-11」(제출·기한과 함께)·「○개월/○주 전」이 든 문장
            d = DUE.search(line_body) or DUE_RANGE.search(line_body)
            if d and ACTION.search(line_body):
                add('월별 할 일', line_body, when_of(int(d.group(1))), raw, u['loc'])
                continue
            f = DATE_FULL.search(line_body)
            if f and re.search(r'제출|기한|마감|까지|완료|예정', line_body) and not PHONE.search(line_body):
                add('월별 할 일', line_body, '%s년 %d월' % (f.group(1), int(f.group(2))), raw, u['loc'])
                continue
            if REL_DUE.search(line_body) and ACTION.search(line_body):
                add('월별 할 일', line_body, '', raw, u['loc'])
                continue
            e = DUE_EVERY.search(line_body)
            if e and ACTION.search(line_body) and len(norm(line_body)) >= 8:
                add('월별 할 일', line_body, e.group(1), raw, u['loc'])
                continue
            # 진행 중 현안: 현안 신호어가 든 줄(전화번호 줄은 위에서 처리)
            if ISSUE.search(line_body) and len(norm(line_body)) >= 8 and not PHONE.search(line_body):
                add('진행 중 현안', line_body, '', raw, u['loc'])
    return items


def merge_similar(draft):
    """같은 유형에서 발췌 줄이 서로 포함되거나 요약이 비슷한 항목(같은 공문이 일정표·메모·초안에 되풀이된 것)을 한 항목으로 묶는다.
    첫 항목이 대표가 되고 나머지 출처는 also 목록에 들어간다. 문장 파일(공문·보고서) 출처를 대표로 우선한다."""
    order = {k: i for i, k in enumerate(['odt', 'hwp', 'hwpx', 'docx', 'pdf', 'eml', 'txt', 'md', 'xlsx', 'xlsm', 'csv'])}
    def kind_of(f):
        return os.path.splitext(f.split(' ▸ ')[-1])[1].lower().lstrip('.')
    groups = []
    for d in draft:
        hit = None
        for g in groups:
            if g['type'] != d['type']:
                continue
            if line_overlap(g['quote'], d['quote']) or sim(g['text'], d['text']) >= 0.6 or contain(g['quote'], d['quote']) >= 0.8:
                hit = g
                break
        if hit is None:
            d = dict(d); d['also'] = []
            groups.append(d)
        else:
            # 문장 파일이 대표가 되도록 자리를 바꾼다
            if order.get(kind_of(d['file']), 99) < order.get(kind_of(hit['file']), 99) and d['src'] == hit['src']:
                also = hit['also'] + [{'file': hit['file'], 'quote': hit['quote']}]
                hit.update({k: d[k] for k in ('file', 'text', 'when', 'quote', 'src')}); hit['also'] = also
            else:
                hit['also'].append({'file': d['file'], 'quote': d['quote']})
    return groups


# ---------------------------------------------------------------- 부하 계획·초안 만들기(화면·실측 공용)
def plan_load(files, max_chars=6000, include_tables=False, avg_sec=22.0, only_files=None, max_calls_per_file=3):
    """파일별 모델 호출 횟수와 예상 시간. 추출은 수 초 안이라 부하는 거의 모델 호출(호출당 avg_sec초, CPU 미니PC 실측 21~23초)."""
    rows = []
    for f in files:
        to_model = (f['kind'] in SENTENCE_KINDS or (include_tables and f['kind'] in TABLE_KINDS))
        if only_files is not None:
            to_model = to_model and f['file'] in only_files
        calls = min(max_calls_per_file, max(1, math.ceil(f['chars'] / max_chars))) if to_model else 0  # 긴 파일은 앞부분 max_calls_per_file 토막까지만
        rows.append({'file': f['file'], 'kind': f['kind'], 'chars': f['chars'], 'calls': calls, 'to_model': to_model})
    n_calls = sum(r['calls'] for r in rows)
    return {'rows': rows, 'calls': n_calls, 'est_sec': round(n_calls * avg_sec), 'avg_sec': avg_sec,
            'files_model': sum(1 for r in rows if r['to_model']), 'files_rule_only': sum(1 for r in rows if not r['to_model'])}


def make_prompt(fobj, chunk):
    return ('파일 이름: %s\n(아래가 문서 글자다. [ ] 안은 위치 표시다. quote는 이 글자 가운데 한 줄을 그대로 복사한다. '
            '표(엑셀)는 「n행: …」 줄 전체를 복사한다.)\n---\n%s' % (fobj['file'], chunk))


def build_draft(files, model, url='http://127.0.0.1:11434/v1/chat/completions', key='', max_chars=6000,
                include_tables=False, only_files=None, fake=None, replay=None, progress=None, should_stop=None, max_calls_per_file=3):
    """출처 달린 초안을 만든다. 반환: draft, dropped, calls, errors.
    model='none'이면 규칙층만. fake(fobj)->JSON 문자열이면 모델 대신 쓴다(시험용). replay=이전 결과 dict이면 그때의 모델 답을 다시 쓴다.
    progress(dict)는 파일마다 불린다. should_stop()이 True면 남은 모델 호출을 건너뛴다(규칙 항목은 모두 남음)."""
    if model not in ('none',) and fake is None and replay is None and not is_local_url(url):
        raise ValueError('모델 주소는 127.0.0.1 또는 localhost만 허용합니다: ' + url)
    texts = {f['file']: '\n'.join(u['text'] for u in f['units']) for f in files}
    lines = {k: source_lines(v) for k, v in texts.items()}
    plan = plan_load(files, max_chars, include_tables, only_files=only_files, max_calls_per_file=max_calls_per_file)
    to_model = {r['file'] for r in plan['rows'] if r['to_model']}
    draft, dropped, calls, errors = [], [], [], []
    done_calls, stopped = 0, False
    for fi, f in enumerate(files):
        for it in rule_items(f):
            draft.append({'file': f['file'], 'type': it['type'], 'text': it['text'], 'when': it['when'], 'quote': it['quote'], 'grounded': True, 'src': '규칙'})
        if model == 'none' or (f['file'] not in to_model and replay is None):
            if progress:
                progress({'file': f['file'], 'index': fi + 1, 'total': len(files), 'calls_done': done_calls, 'calls_total': plan['calls'], 'skipped': True})
            continue
        if replay is not None:
            items_all = [{'type': d['type'], 'text': d['text'], 'when': d['when'], 'quote': d.get('quote_raw', d['quote'])}
                         for d in replay['draft'] + replay['dropped'] if d['file'] == f['file'] and d['src'].startswith('모델')]
            chunks = ['(재채점)']
        else:
            full = '\n'.join('[%s] %s' % (u['loc'], u['text']) for u in f['units'])
            chunks = ([full[i:i + max_chars] for i in range(0, len(full), max_chars)] or [''])[:max_calls_per_file]
        if stopped or (should_stop and should_stop()):   # 중단: 남은 파일은 규칙층만(모델 호출 없음)
            stopped = True
            if progress:
                progress({'file': f['file'], 'index': fi + 1, 'total': len(files), 'calls_done': done_calls, 'calls_total': plan['calls'], 'skipped': True, 'stopped': True})
            continue
        for ci, chunk in enumerate(chunks):
            if should_stop and should_stop():
                stopped = True
                break
            t0 = time.time()
            usage = {}
            try:
                if replay is not None:
                    items = items_all
                else:
                    if fake is not None:
                        content = fake(f)
                    else:
                        content, usage = call_model(url, model, key, make_prompt(f, chunk))
                    obj = parse_json_loose(content)
                    items = (obj or {}).get('items') if isinstance(obj, dict) else None
                    if items is None:
                        errors.append({'file': f['file'], 'chunk': ci, 'reason': 'JSON 아님', 'head': str(content)[:200]}); items = []
            except urllib.error.HTTPError as e:
                errors.append({'file': f['file'], 'chunk': ci, 'reason': 'HTTP %d' % e.code}); items = []
            except Exception as e:
                errors.append({'file': f['file'], 'chunk': ci, 'reason': str(e)[:160]}); items = []
            if replay is None:
                calls.append({'file': f['file'], 'chunk': ci, 'chars': len(chunk), 'sec': round(time.time() - t0, 1), 'items': len(items), 'usage': usage})
            done_calls += 1
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
                if any(d['file'] == rec['file'] and d['type'] == rec['type'] and (sim(d['text'], rec['text']) >= 0.5 or sim(d['quote'], rec['quote']) >= 0.6 or line_overlap(d['quote'], rec['quote'])) for d in draft):
                    continue
                (draft if rec['grounded'] else dropped).append(rec)
        if progress:
            progress({'file': f['file'], 'index': fi + 1, 'total': len(files), 'calls_done': done_calls, 'calls_total': plan['calls'], 'skipped': False, 'stopped': stopped})
    return draft, dropped, calls, errors
