#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""돌다리 v1.0 · 관문 ② 실측(3차판, 2026-10-10): 규칙층 + 로컬 모델로 출처 달린 인수인계 초안을 만들고 정답표로 채점한다.

쓰임:
  python measure.py <업무폴더> <정답표.xlsx> <결과 폴더> --model exaone3.5:7.8b [--url ...] [--key ...] [--label "PC 사양"]
  python measure.py <업무폴더> <정답표.xlsx> <결과 폴더> --model none      (규칙층만, 모델 없이)
  python measure.py <업무폴더> <정답표.xlsx> <결과 폴더> --model fake      (정답을 그대로 돌려주는 가짜 모델: 배관 점검)
  python measure.py <업무폴더> <정답표.xlsx> <결과 폴더> --model exaone3.5:7.8b --replay <이전 결과.json>
                                                                            (모델을 다시 부르지 않고 이전 실측의 모델 답을 새 채점기로 다시 채점)

2차(10.10.)에서 고친 것(3차판)
  - 규칙층 확장: 기한 표현을 「○월 말/초/중순까지」·「○월 ○일~○일」·「2025-09-11」꼴 날짜(제출·기한 낱말과 함께)·「○개월/○주 전」까지 넓힘.
    전화번호 줄에서 이름은 「이름 담당/주무관/과장」 또는 번호 바로 앞 낱말을 쓴다(「복합기 · …」처럼 엉뚱한 낱말을 이름으로 쓰던 것 고침).
    「미조치·미결·반려·보류·지연·끝나지 않음·안 됨·재협의」 같은 현안 신호어가 든 줄은 「진행 중 현안」으로 뽑는다.
  - 근거 확인 보정: 발췌가 원문 한 줄(또는 이어진 두 줄)과 2-gram 70% 이상 겹치면 그 원문 줄로 바꿔 넣고 「발췌 보정」 표시. 발췌가 비었으면 요약이 원문 한 줄과 70% 이상 겹칠 때만 그 줄을 발췌로 붙인다. 그 밖은 여전히 「불확실(제외)」.
  - 채점: 정답과 같은 파일·같은 유형일 때, 요약·발췌 2-gram 유사도 0.35 이상이거나 짧은 쪽이 긴 쪽에 60% 이상 담기거나 발췌 줄이 서로 포함되면 적중. (같은 줄을 다른 말로 요약한 맞는 항목을 놓치던 것 고침)
  - 모델 호출이 HTTP 5xx로 실패하면 response_format 없이 한 번 다시 부른다(젬마 2차에서 2개 파일 HTTP 500).
  - --replay: 이전 결과.json의 모델 답을 그대로 쓰고 채점기만 바꿔 다시 채점한다(모델 재호출 없음, 시간은 이전 값을 그대로 적음).

1차(10.9.)에서 고친 것(2차판)
  - 규칙층: 「협의 담당: 이름(소속, 전화)」·전화번호가 있는 줄·기한(「○월 ○일까지」)이 있는 문장을 규칙으로 먼저 뽑는다(발췌는 원문 그대로라 언제나 근거 있음).
  - 모델: 유형 3가지를 정의·예시와 함께 주고, 발췌는 문서의 한 줄을 그대로 베끼게 한다. 유형이 셋 밖이면 규칙으로 바로잡는다.
  - 근거 확인: 발췌가 원문에 글자 그대로 있거나(띄어쓰기 무시) 거의 그대로(2-gram 90% 이상) 있으면 근거 있음. 근거 없는 모델 항목은 초안에 넣지 않고 「불확실(제외)」 목록으로 내린다(신청서 문구 그대로).
  - 윈도 경로(역슬래시)를 정답표와 같게 맞춘다.
"""
import os, sys, re, json, time, argparse, urllib.request, urllib.error, datetime, platform
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract as EX

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

PHONE = re.compile(r'0\d{1,2}-\d{3,4}-\d{4}')
DUE = re.compile(r'(\d{1,2})월\s*(?:(\d{1,2})일|말|초|중순)\s*까지')
DUE_RANGE = re.compile(r'(\d{1,2})월\s*\d{1,2}일\s*[~∼～-]\s*(?:\d{1,2}월\s*)?\d{1,2}일')
DATE_FULL = re.compile(r'(20\d{2})[-.]\s?(\d{1,2})[-.]\s?(\d{1,2})')
REL_DUE = re.compile(r'\d+\s*(?:개월|주|일)\s*전')
ACTION = re.compile(r'합니다|한다|할 것|제출|수립|실시|협의|조치|이관|정리|보완|결정|검토|점검|제출일|기한|마감')
ISSUE = re.compile(r'미조치|미결|미완료|미이행|미납|미확정|미해결|반려|보류|지연|끝나지 않|결론 못|안 됨|못 냄|재협의|협의 중|이견|고장|누수|파손|분실')
TITLE = re.compile(r'([가-힣]{2,4})\s+(?:담당|주무관|과장|팀장|실장|계장|대리|주임|사원)')
NOT_NAME = re.compile(r'과$|팀$|실$|부$|처$|국$|군청|시청|도청|구청|사무소|소방서|담당|요청|업체|연락|전화|번호|협의|문의|총괄|업무|서무|예산|보안|청사|관리|기록|감사|계약|현안|회의|참석|발견|보수')
MONTH = re.compile(r'(\d{1,2})월')


def name_near_phone(line_body, phone):
    """전화번호 줄에서 사람 이름을 고른다: 「이름 담당/과장…」 → 번호 바로 앞 낱말 → '담당자'."""
    for m in TITLE.finditer(line_body):
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


def match_score(ans, d):
    if line_overlap(ans['quote'], d['quote']):
        return 1.0
    s = max(sim(ans['text'], d['text']), sim(ans['quote'], d['quote']))
    c = max(contain(ans['text'], d['text']), contain(ans['text'], d['quote']), contain(ans['quote'], d['text']))
    return max(s, 0.35 * c / 0.6)  # 담김 60%가 유사도 0.35와 같은 문턱이 되게


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


def load_answers(path):
    import openpyxl
    ws = openpyxl.load_workbook(path, read_only=True).active
    rows = list(ws.iter_rows(values_only=True))[1:]
    return [{'no': r[0], 'type': r[1], 'text': r[2], 'when': r[3] or '', 'file': str(r[4]).replace('\\', '/'), 'loc': r[5], 'quote': r[6]} for r in rows if r and r[1]]


# ---------------------------------------------------------------- 규칙층: 구조가 뚜렷한 사실은 규칙으로(발췌 = 원문 줄 그대로)
def rule_items(fobj):
    items = []
    seen = set()
    year_hint = ''

    def add(kind, text, when, raw, loc):
        key = (kind, norm(raw))
        if key in seen:
            return
        seen.add(key)
        items.append({'type': kind, 'text': re.sub(r'\s+', ' ', text).strip()[:80], 'when': when, 'quote': raw, 'loc': loc, 'src': '규칙'})

    for u in fobj['units']:
        for line in re.split(r'\n+', u['text']):
            raw = line.strip()
            if not raw:
                continue
            line_body = re.sub(r'^\d+행:\s*', '', raw)  # 엑셀 줄 머리 제거
            ym = re.search(r'(20\d{2})\.\s*(\d{1,2})\.', raw)
            if ym:
                year_hint = ym.group(1)
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
                mon = int(d.group(1))
                add('월별 할 일', re.sub(r'^\d+\.\s*', '', line_body), ('%s년 ' % year_hint if year_hint else '') + '%d월' % mon, raw, u['loc'])
                continue
            f = DATE_FULL.search(line_body)
            if f and re.search(r'제출|기한|마감|까지|완료|예정', line_body) and not PHONE.search(line_body):
                add('월별 할 일', re.sub(r'^\d+\.\s*', '', line_body), '%s년 %d월' % (f.group(1), int(f.group(2))), raw, u['loc'])
                continue
            if REL_DUE.search(line_body) and ACTION.search(line_body):
                add('월별 할 일', re.sub(r'^\d+\.\s*', '', line_body), '', raw, u['loc'])
                continue
            # 진행 중 현안: 현안 신호어가 든 줄(전화번호 줄은 위에서 처리)
            if ISSUE.search(line_body) and len(norm(line_body)) >= 8 and not PHONE.search(line_body):
                add('진행 중 현안', re.sub(r'^\d+\.\s*', '', line_body), '', raw, u['loc'])
    return items


def fake_model(kind, fobj, answers):
    mine = [a for a in answers if a['file'] == fobj['file']]
    items = [{'type': a['type'], 'text': a['text'], 'when': a['when'], 'quote': a['quote']} for a in mine]
    if kind == 'noisy':
        items = items[::2] + [{'type': '진행 중 현안', 'text': '지어낸 현안(시험용)', 'when': '', 'quote': '이 문장은 문서에 없습니다'}]
    return json.dumps({'items': items}, ensure_ascii=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('folder'); ap.add_argument('answers'); ap.add_argument('out')
    ap.add_argument('--url', default='http://127.0.0.1:11434/v1/chat/completions')
    ap.add_argument('--model', required=True); ap.add_argument('--key', default='')
    ap.add_argument('--max-chars', type=int, default=6000)
    ap.add_argument('--label', default='')
    ap.add_argument('--replay', default='', help='이전 결과.json: 모델을 다시 부르지 않고 그때의 모델 답을 새 채점기로 다시 채점')
    a = ap.parse_args()
    replay = None
    if a.replay:
        with open(a.replay, encoding='utf-8') as fh:
            replay = json.load(fh)
    os.makedirs(a.out, exist_ok=True)
    t_all = time.time()
    files, failures, fps = EX.extract_folder(a.folder)
    for f in files:
        f['file'] = f['file'].replace('\\', '/')
    for x in failures + fps:
        x['file'] = x['file'].replace('\\', '/')
    t_extract = time.time() - t_all
    answers = load_answers(a.answers)
    texts = {f['file']: '\n'.join(u['text'] for u in f['units']) for f in files}
    lines = {k: source_lines(v) for k, v in texts.items()}
    draft, dropped, calls, errors = [], [], [], []
    for f in files:
        # 1) 규칙층
        for it in rule_items(f):
            draft.append({'file': f['file'], 'type': it['type'], 'text': it['text'], 'when': it['when'], 'quote': it['quote'], 'grounded': True, 'src': '규칙'})
        if a.model == 'none':
            continue
        if replay is not None:  # 이전 실측의 모델 답(초안에 든 것 + 뺀 것)을 그대로 다시 채점
            items = [{'type': d['type'], 'text': d['text'], 'when': d['when'], 'quote': d['quote']}
                     for d in replay['draft'] + replay['dropped'] if d['file'] == f['file'] and d['src'].startswith('모델')]
            chunks = ['(재채점)']
        else:
            chunks = None
        # 2) 모델
        full = '\n'.join('[%s] %s' % (u['loc'], u['text']) for u in f['units'])
        if chunks is None:
            chunks = [full[i:i + a.max_chars] for i in range(0, len(full), a.max_chars)] or ['']
        for ci, chunk in enumerate(chunks):
            prompt = '파일 이름: %s\n(아래가 문서 글자다. [ ] 안은 위치 표시다. quote는 이 글자 가운데 한 줄을 그대로 복사한다. 표(엑셀)는 「n행: …」 줄 전체를 복사한다.)\n---\n%s' % (f['file'], chunk)
            t0 = time.time()
            try:
                if replay is not None:
                    content, usage = json.dumps({'items': items}, ensure_ascii=False), {}
                elif a.model in ('fake', 'noisy'):
                    content, usage = fake_model(a.model, f, answers), {}
                else:
                    content, usage = call_model(a.url, a.model, a.key, prompt)
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
            for it in items:
                if not isinstance(it, dict):
                    continue
                q = str(it.get('quote') or '').strip()
                text = str(it.get('text') or '').strip()
                if not text:
                    continue
                q2, how = ground_fix(q, text, texts[f['file']], lines[f['file']])
                rec = {'file': f['file'], 'type': fix_type(it.get('type'), text, q), 'text': text, 'when': str(it.get('when') or ''), 'quote': q2 if q2 is not None else q,
                       'grounded': q2 is not None, 'src': '모델' if how == '원문' else ('모델(발췌 보정)' if how else '모델'), 'quote_raw': q}
                # 규칙 항목과 중복이면 버림
                if any(d['file'] == rec['file'] and d['type'] == rec['type'] and (sim(d['text'], rec['text']) >= 0.5 or sim(d['quote'], rec['quote']) >= 0.6 or line_overlap(d['quote'], rec['quote'])) for d in draft):
                    continue
                if rec['grounded']:
                    draft.append(rec)
                else:
                    dropped.append(rec)
    t_total = time.time() - t_all
    if replay is not None:  # 시간·호출 수는 이전 실측 값을 그대로 쓴다
        rs = replay['summary']
        t_extract, t_total, calls = rs['sec_extract'], rs['sec_total'], replay['calls']
        errors = rs.get('errors', []) + errors
    # 채점
    for d in draft:
        best, bs = None, 0.0
        for ans in answers:
            if ans['file'] != d['file'] or ans['type'] != d['type']:
                continue
            s = match_score(ans, d)
            if s > bs:
                best, bs = ans, s
        d['match'] = best['no'] if best and bs >= 0.35 else None
        d['match_sim'] = round(bs, 2)
    n_ans, n_draft, n_model_raw = len(answers), len(draft), sum(1 for d in draft if d['src'].startswith('모델')) + len(dropped)
    n_fixed = sum(1 for d in draft if d['src'] == '모델(발췌 보정)')
    n_hit = sum(1 for ans in answers if any(d['match'] == ans['no'] for d in draft))
    n_in = sum(1 for d in draft if d['match'])
    n_fab_draft = sum(1 for d in draft if not d['grounded'])
    per_type = {}
    for ans in answers:
        per_type.setdefault(ans['type'], [0, 0]); per_type[ans['type']][1] += 1
        if any(d['match'] == ans['no'] for d in draft):
            per_type[ans['type']][0] += 1
    res = {'model': a.model, 'url': a.url, 'label': a.label, 'when': datetime.datetime.now().isoformat(timespec='seconds'), 'machine': platform.platform(),
           'files_total': len(fps), 'files_read': len(files), 'files_failed': len(failures), 'originals_changed': sum(1 for x in fps if not x['unchanged']),
           'calls': len(calls), 'sec_extract': round(t_extract, 1), 'sec_total': round(t_total, 1), 'sec_model_avg': round(sum(c['sec'] for c in calls) / max(1, len(calls)), 1),
           'answers': n_ans, 'draft_items': n_draft, 'rule_items': sum(1 for d in draft if d['src'] == '규칙'), 'model_items_raw': n_model_raw, 'model_items_dropped': len(dropped),
           'hit_with_source': n_hit, 'draft_in_answers': n_in, 'fabricated_in_draft': n_fab_draft, 'model_items_fixed': n_fixed, 'replay_of': a.replay or '',
           'pct_hit_with_source': round(100.0 * n_hit / max(1, n_ans), 1), 'pct_draft_in_answers': round(100.0 * n_in / max(1, n_draft), 1),
           'pct_fabricated_in_draft': round(100.0 * n_fab_draft / max(1, n_draft), 1), 'pct_model_dropped': round(100.0 * len(dropped) / max(1, n_model_raw), 1),
           'per_type': per_type, 'errors': errors}
    gate = {'시간 20분 안': res['sec_total'] <= 1200, '출처까지 맞은 항목 70% 이상': res['pct_hit_with_source'] >= 70, '지어낸 항목 5% 이하(초안 기준)': res['pct_fabricated_in_draft'] <= 5}
    res['gate'] = gate
    with open(os.path.join(a.out, '결과.json'), 'w', encoding='utf-8') as f:
        json.dump({'summary': res, 'calls': calls, 'draft': draft, 'dropped': dropped, 'failures': failures, 'fingerprints': fps}, f, ensure_ascii=False, indent=1)
    with open(os.path.join(a.out, '결과.md'), 'w', encoding='utf-8') as f:
        f.write('# 돌다리 관문 ② 실측 결과(3차판 채점%s)\n\n모델 `%s` · %s · %s\n%s\n\n' % (', 이전 모델 답 재채점: ' + os.path.basename(os.path.dirname(a.replay) or a.replay) if a.replay else '', a.model, res['when'], res['machine'], ('측정 환경: ' + a.label) if a.label else ''))
        f.write('| 항목 | 값 | 관문 기준 |\n|---|---|---|\n')
        f.write('| 파일 수(읽음/못 읽음/원본 변경) | %d (%d / %d / %d) | 못 읽은 파일 사유 표시, 원본 변경 0 |\n' % (res['files_total'], res['files_read'], res['files_failed'], res['originals_changed']))
        f.write('| 처리 시간(추출 / 전체) | %.1f초 / %.1f초 (모델 호출 %d회, 평균 %.1f초) | 20분(1,200초) 안 |\n' % (res['sec_extract'], res['sec_total'], res['calls'], res['sec_model_avg']))
        f.write('| 초안 항목 수(규칙 / 모델) | %d (%d / %d) | |\n' % (n_draft, res['rule_items'], n_draft - res['rule_items']))
        f.write('| 출처까지 맞은 정답 항목 | %d / %d = %.1f%% | 70%% 이상 |\n' % (n_hit, n_ans, res['pct_hit_with_source']))
        f.write('| 초안 항목 중 정답에 있는 비율 | %d / %d = %.1f%% | (참고) |\n' % (n_in, n_draft, res['pct_draft_in_answers']))
        f.write('| 초안에 든 지어낸 항목 | %d / %d = %.1f%% | 5%% 이하 |\n' % (n_fab_draft, n_draft, res['pct_fabricated_in_draft']))
        f.write('| 모델이 낸 항목 중 발췌가 원문에 없어 뺀 것 | %d / %d = %.1f%% | (참고: 모델 자체의 정확도) |\n' % (len(dropped), n_model_raw, res['pct_model_dropped']))
        f.write('| 모델이 낸 항목 중 발췌를 원문 줄로 바로잡아 넣은 것 | %d / %d | (참고: 초안에 「발췌 보정」 표시) |\n' % (n_fixed, n_model_raw))
        f.write('\n유형별 적중: ' + ' · '.join('%s %d/%d' % (k, v[0], v[1]) for k, v in per_type.items()) + '\n\n')
        f.write('관문 판정: ' + ' · '.join('%s %s' % ('○' if ok else '×', k) for k, ok in gate.items()) + '\n')
        if errors:
            f.write('\n오류 %d건: ' % len(errors) + '; '.join('%s(%s)' % (e['file'], e['reason']) for e in errors[:10]) + '\n')
        if failures:
            f.write('\n못 읽은 파일: ' + '; '.join('%s(%s)' % (x['file'], x['reason']) for x in failures) + '\n')
    with open(os.path.join(a.out, '인수인계_초안.md'), 'w', encoding='utf-8') as f:
        f.write('# 인수인계 초안(출처 달림, 전임자 확인 전)\n\n모델 `%s` · %s. 항목마다 출처 파일과 원문 발췌를 붙였다. 발췌가 원문에서 확인되지 않은 모델 항목은 초안에 넣지 않고 맨 끝 「불확실(제외)」에 두었다. 「모델(발췌 보정)」은 모델이 쓴 발췌가 원문과 조금 달라 원문 줄로 바꿔 넣은 것이다.\n\n' % (a.model, res['when']))
        for kind in TYPES:
            f.write('## %s\n\n' % kind)
            for d in sorted([d for d in draft if d['type'] == kind], key=lambda d: (d['when'], d['file'])):
                f.write('- %s%s <small>(%s)</small>\n  - 출처: %s · 「%s」\n' % (('[' + d['when'] + '] ') if d['when'] else '', d['text'], d['src'], d['file'], d['quote'].replace('\n', ' / ')))
            f.write('\n')
        if dropped:
            f.write('## 불확실(제외): 발췌가 원문에 없음\n\n' + ''.join('- %s · %s · 「%s」\n' % (d['file'], d['text'], d['quote'][:80]) for d in dropped))
    print(open(os.path.join(a.out, '결과.md'), encoding='utf-8').read())


if __name__ == '__main__':
    main()
