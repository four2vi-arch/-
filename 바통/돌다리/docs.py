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
ATTACH_NAME = re.compile(r'^\(?붙임|\[붙임|\(별첨|별지|별표', re.I)
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
CONTACT_LINE = re.compile(r'문의|담당|☎|☏|연락|주무관|팀장|과장|실장')
SYS3 = ('너는 공공기관 업무 인수인계 도우미다. 전임자의 문서 하나(공문·메일·보고서)를 읽고 후임자에게 필요한 것만 JSON 객체 하나로 답하라.\n'
        '형식: {"요지":"이 문서가 무엇을 요구하거나 알리는지 한 문장","할 일":"우리 부서(전임자 자리)가 해야 하는 일 한 문장, 없으면 빈 문자열","기한":"YYYY-MM-DD 또는 빈 문자열","담당":"문의할 사람·부서와 전화, 없으면 빈 문자열","상태":"진행 중|끝남|모름"}\n'
        '규칙: (1) 문서에 없는 내용은 만들지 않는다. (2) 기한은 문서에 적힌 날짜만 쓴다. (3) 한 문장은 60자 안. (4) 설명문·코드 펜스 없이 JSON만.')
CLS_ISSUE = {'공문', '메일', '메모', '회의록', '보고서·계획'}
HISTORY = re.compile(r'협약|체결|계약|신설|폐지|개정|변경|도입|종료|이관|지정|선정|개편|설치|시범|확정|개소|폐국|통합|승인|감사|지적|제정|전환|위탁|수탁')   # 업무의 전환점을 뜻하는 제목 말
STATUS_NAME = re.compile(r'(현황|대장|명단|목록|일정표?|리스트|실적표?)\s*(\(.*\)|_?\d{4}(년)?)?\s*$')                                  # 현황 자료: 제목이 현황·대장·명단·목록으로 끝나는 것(최신판 하나만)
HIST_CAP = 12   # 업무마다 연혁으로 올리는 기간 밖 문서 상한(최근 것부터)


def text_of(f):
    return '\n'.join(u['text'] for u in f.get('units', []))


def base_name(f):
    return os.path.basename(str(f.get('file', '')).split(' ▸ ')[0])


def iso(y, m, d):
    try:
        return datetime.date(int(y), int(m), int(d)).isoformat()
    except Exception:
        return ''


def doc_date(f, text):
    """문서 날짜: 파일 이름 YYYYMMDD → 이름 YYYYMM → 본문 「시행」 근처 날짜 → 본문 첫 날짜 → 파일 수정일."""
    name = base_name(f)
    m = FNAME_DATE.search(name)
    if m and iso(*m.groups()):
        return iso(*m.groups()), '파일 이름'
    m = FNAME_YM.search(name)
    if m:
        return iso(m.group(1), m.group(2), 1), '파일 이름(월)'
    i = text.find('시행 ')
    if i >= 0:
        win = text[max(0, i - 300):i + 200]
        ds = [iso(*x.groups()) for x in FULLDATE.finditer(win)]
        ds = [d for d in ds if d]
        if ds:
            return ds[-1] if i - 300 > 0 else ds[0], '본문(시행)'
    for x in FULLDATE.finditer(text[:3000]):
        d = iso(*x.groups())
        if d:
            return d, '본문'
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


def classify(f, text):
    name = base_name(f); kind = f.get('kind', '')
    head = text[:400]
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
    if core.REFERENCE_NAME.search(name):
        return '규정·지침'
    if ATTACH_NAME.search(name):
        return '붙임'
    if re.search(r'(^|\n)\s*제\s*목\s', head) and (re.search(r'(^|\n)\s*수\s*신\s', head) or SI_LINE.search(text)):
        return '공문'
    if kind in ('txt', 'md'):
        return '메모'
    if re.search(r'(^|\n)\s*[□ㅇ○◦]\s', text[:2000]):
        return '보고서·계획'
    return '기타'


def due_dates(text, base):
    """기한: 「○. ○.까지」「○월 ○일까지」「2026. 3. 13.까지」「~ 9. 11.」. 연도는 문서 연도, 문서 달보다 두 달 넘게 이르면 이듬해."""
    try:
        by, bm = int(base[:4]), int(base[5:7])
    except Exception:
        by, bm = datetime.date.today().year, datetime.date.today().month
    out, seen = [], set()
    for line in text.split('\n'):
        s = line.strip()
        if not s or len(s) > 400:
            continue
        for pat in DUE_PATS:
            for m in pat.finditer(s):
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
            if not CONTACT_LINE.search(s):
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


def area_of(title, text, areas):
    hay = (title + ' ') * 3 + text[:800]
    hay = hay.lower()
    best, score = '기타', 0
    for a in areas:
        keys = [k.strip().lower() for k in str(a.get('keys', '')).split(',') if k.strip()]
        n = sum(hay.count(k) for k in keys)
        if n > score:
            best, score = a['name'], n
    return best


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
             'area': area_of(title, text, areas), 'due': due_dates(text, date) if cls in CLS_ISSUE | {'붙임'} else [], 'contacts': contacts_of(text) if cls != '표·대장' else [],
             'issue_words': bool(ISSUE.search(text[:6000])) if cls in CLS_ISSUE else False, 'chars': f.get('chars', 0), 'recur': None, 'attachments': []}
        docs.append(d)
    # 붙임은 같은 날짜 머리의 공문에 붙인다(파일 이름 「YYYYMMDD_NN」 꼴일 때)
    by_prefix = collections.defaultdict(list)
    for d in docs:
        m = re.match(r'^(\d{8})_', base_name({'file': d['file']}))
        if m:
            by_prefix[(os.path.dirname(d['file']), m.group(1))].append(d)
    for key, group in by_prefix.items():
        parents = [d for d in group if d['cls'] == '공문']
        if len(parents) == 1:
            for d in group:
                if d['cls'] == '붙임':
                    parents[0]['attachments'].append(d['file']); d['parent'] = parents[0]['file']
                    if d['due'] and not parents[0]['due']:
                        parents[0]['due'] = d['due']
    # 반복 업무: 같은 제목 꼴이 서로 다른 해에 2번 이상
    groups = collections.defaultdict(list)
    lim_recur = (today - datetime.timedelta(days=30 * recur_months)).isoformat()
    for d in docs:
        if d['cls'] in ('공문', '보고서·계획', '회의록', '메일') and d['date'] and d['date'] >= lim_recur:
            k = recur_key(d['title'])
            if k:
                groups[k].append(d)
    for k, g in groups.items():
        years = sorted({d['date'][:4] for d in g})
        if len(years) >= 2:
            months_seen = collections.Counter(int(d['date'][5:7]) for d in g)
            mon = months_seen.most_common(1)[0][0]
            latest = max(g, key=lambda d: d['date'])
            for d in g:
                d['recur'] = {'years': years, 'month': mon, 'n': len(g), 'latest': latest['file']}
    # 항목이 되는 문서: 기간 안(업무별) 또는 반복 업무의 최근 판
    by_title = collections.defaultdict(list)   # 같은 문서를 docx와 pdf로 둘 다 둔 경우: pdf 쪽만 중복으로 뺀다(제목만 같은 다른 문서는 남긴다)
    for d in docs:
        d['dup'] = False
        by_title[(d['cls'], core.norm(d['title']))].append(d)
    for k, g in by_title.items():
        for d in g:
            if d['kind'] == 'pdf' and any(o is not d and o['kind'] != 'pdf' and abs(o['chars'] - d['chars']) <= 0.3 * max(o['chars'], d['chars'], 1) for o in g):
                d['dup'] = True
    for d in docs:
        am = area_months.get(d['area'], months)
        lim = (today - datetime.timedelta(days=30 * am)).isoformat()
        in_window = bool(d['date']) and d['date'] >= lim
        d['in_window'] = in_window
        due_next = ''
        for x in d['due']:
            if x['date'] >= (today - datetime.timedelta(days=60)).isoformat():
                due_next = x['date']; break
        d['due_next'] = due_next
        recent = d['date_src'] != '수정일' and d['date'] >= (today - datetime.timedelta(days=120)).isoformat()
        if d.get('parent'):
            d['kind3'] = '붙임'
        elif d['cls'] == '매뉴얼' or d.get('dup'):
            d['kind3'] = '매뉴얼' if d['cls'] == '매뉴얼' else '중복'
        elif d['cls'] in CLS_ISSUE and in_window and (due_next or d['issue_words'] or recent):
            d['kind3'] = '현안'
        elif d['recur'] and d['recur']['latest'] == d['file'] and d['cls'] in ('공문', '보고서·계획', '회의록'):
            d['kind3'] = '반복'
        elif in_window and d['cls'] not in ('표·대장', '붙임'):
            d['kind3'] = '문서'
        else:
            d['kind3'] = '기간 밖'
        d['to_model'] = d['kind3'] == '현안' if model_scope == 'issues' else d['kind3'] in ('현안', '반복', '문서')
    # 현황 자료: 표·대장이거나 이름에 현황·대장·명단·실적·일정 — 같은 제목 꼴은 최신판 하나만
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
        d['hist'] = bool(d['cls'] in ('공문', '보고서·계획', '회의록', '인수인계서', '기타') and not d.get('parent') and not d.get('dup') and (d['cls'] == '인수인계서' or HISTORY.search(d['title'])))
        if d['hist'] and d['kind3'] == '기간 밖':
            per_area[d['area']].append(d)
    for a, g in per_area.items():
        g.sort(key=lambda d: d['date'] or '', reverse=True)
        for d in g[:HIST_CAP]:
            d['kind3'] = '연혁'
    return docs


def build_docs(files, areas, months=12, model='none', url='http://127.0.0.1:11434/v1/chat/completions', key='', model_scope='issues', max_chars=4000,
               progress=None, should_stop=None, checkpoint=None, folder='', prev_items=None, fake=None, max_consecutive_failures=5, today=None):
    """문서 항목을 만든다. 반환: items, calls, errors, info."""
    t_all = time.time()
    docs = plan_docs(files, areas, months, model_scope, today=today)
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
        it = {'id': n, 'file': d['file'], 'kind': d['kind'], 'cls': d['cls'], 'date': d['date'], 'docno': d['docno'], 'title': d['title'], 'area': d['area'],
              'due': d['due'], 'due_next': d['due_next'], 'contacts': d['contacts'], 'recur': d['recur'], 'attachments': d['attachments'], 'kind3': d['kind3'],
              'reflected': reflected(d, nos, line_grams) if manual is not None else '', 'hist': d.get('hist', False), 'is_status': d.get('is_status', False), 'summary': '', 'todo': '', 'owner': '', 'model_status': '',
              'src': '규칙', 'keep': True, 'decided': False, 'status': '진행', 'next': '', 'note': '', 'seen': False, 'quote': ''}
        if manual is not None and it['reflected'] and d['kind3'] in ('연혁', '문서'):
            it['hist'] = True
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
                    if owner and ((ph and ph.group(0) in text) or (not ph and owner[:4] in text)):
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
            for k in ('keep', 'decided', 'status', 'next', 'note', 'seen'):
                if k in p:
                    it[k] = p[k]
            if p.get('area_by') == '사람':
                it['area'] = p.get('area', it['area']); it['area_by'] = '사람'
            if p.get('title_by') == '사람':
                it['title'] = p.get('title', it['title']); it['title_by'] = '사람'
            if p.get('todo_by') == '사람':
                it['todo'] = p.get('todo', ''); it['todo_by'] = '사람'
        items.append(it)
        report(d)
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
            'docs_old': [{'file': d['file'], 'date': d['date'], 'title': d['title'], 'area': d['area'], 'cls': d['cls']} for d in docs if d['kind3'] == '기간 밖'][:5000]}
    return items, calls, errors, info


def plan_summary(files, areas, months=12, model_scope='issues', avg_sec=30.0, today=None):
    docs = plan_docs(files, areas, months, model_scope, today=today)
    n_model = sum(1 for d in docs if d['to_model'])
    return {'calls': n_model, 'est_sec': round(n_model * avg_sec), 'avg_sec': avg_sec, 'n_items': sum(1 for d in docs if d['kind3'] in ('현안', '반복', '문서', '연혁', '현황')),
            'n_hist': sum(1 for d in docs if d['kind3'] == '연혁'), 'n_status': sum(1 for d in docs if d['kind3'] == '현황'),
            'n_issue': sum(1 for d in docs if d['kind3'] == '현안'), 'n_recur': sum(1 for d in docs if d['kind3'] == '반복'), 'n_doc': sum(1 for d in docs if d['kind3'] == '문서'),
            'n_old': sum(1 for d in docs if d['kind3'] == '기간 밖'), 'n_attach': sum(1 for d in docs if d['kind3'] == '붙임'), 'files_model': n_model, 'files_rule_only': len(docs) - n_model}
