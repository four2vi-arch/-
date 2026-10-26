#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""돌다리 v1.0 · 내보내기(2026-10-10): 검토가 끝난 인수인계서를 .md와 .docx로 쓴다. 외부 패키지 없이 표준 라이브러리만 쓴다."""
import os, re, json, zipfile, datetime, html as _html
from xml.sax.saxutils import escape as _xesc

TYPES = ['월별 할 일', '협의할 사람', '진행 중 현안']
CREDIT = '돌다리(업무 인수인계 도우미)로 만든 초안을 전임자가 확인함'
FOOT = '문서마다 출처 파일을 붙였고, 문서에서 확인되지 않은 내용은 싣지 않았다. 원본 파일은 읽기만 했다.'
_XML_BAD = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffe\uffff]')


def escape(s):
    """XML(docx)용 이스케이프. XML에 넣을 수 없는 제어 문자는 지운다(남기면 워드가 파일을 열지 못한다)."""
    s = str(s)
    if _XML_BAD.search(s):
        s = _XML_BAD.sub('', s.replace('\x0b', ' ').replace('\x0c', ' '))
    return _xesc(s)


_REF = None   # 「(지남)」을 가르는 날: 인계 일자를 적었으면 그날(인계서는 그날 기준 문서), 아니면 오늘


def _set_ref(session):
    global _REF
    _REF = None
    m = re.search(r'(20\d{2})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})', str((session or {}).get('handover_date') or ''))
    if m:
        try:
            _REF = datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
        except ValueError:
            _REF = None


def today_iso():
    return _REF or datetime.date.today().isoformat()


def dshow(it, n=10):
    """표에 쓰는 날짜. 파일 수정일로 짐작한 날짜·연도만 아는 날짜·이름의 연월만 아는 날짜는 그렇게 적는다."""
    d = str(it.get('date') or '')
    src = it.get('date_src') or ''
    if src == '연도만':
        return d[:4] + '년'
    if src == '수정일' and d:
        return d[:n] + '(수정일)'
    if src == '파일 이름(월)' and d:
        return d[:7]   # 이름 「202509」만 알면 달까지만(그달 1일이 시행일처럼 찍히던 것)
    return d[:n]


def dwhen(it, n=10):
    """날짜가 없으면 사람이 적은 시기(「매주 금요일」)를 쓴다(직접 적은 현안의 시기가 결과물에서 빠지던 것)."""
    return dshow(it, n) if (it.get('date') or '')[:4].isdigit() else (it.get('when') or it.get('date') or '')


def todo_cell(it):
    """1-다·1-라의 「요지·할 일」 칸. 모델이 쓴 글은 (AI)로 표시하고, 규칙이 원문에서 그대로 가져온 근거 줄은 언제나 함께 둔다(요지가 있으면 원문이 사라지던 것)."""
    ai = it.get('src') == '모델'
    lines = {'summary': (('요지(AI): ' if ai and it.get('summary_by') != '사람' else '요지: ') + it['summary']) if it.get('summary') else '',
             'todo': (('할 일(AI): ' if ai and it.get('todo_src') == '모델' and it.get('todo_by') != '사람' else '할 일: ') + it['todo']) if it.get('todo') else '',
             'next': ('다음: ' + it['next']) if it.get('next') else '',
             'quote': ('원문: ' + it['quote']) if it.get('quote') else '',
             'note': ('메모: ' + it['note']) if it.get('note') else ''}
    order = ['next', 'summary', 'todo', 'quote', 'note'] if (it.get('status') or '진행') == '미결' else ['summary', 'todo', 'next', 'quote', 'note']
    return '\n'.join(lines[k] for k in order if lines[k])


def owner_cell(it):
    """「담당」: 규칙이 원문에서 찾은 연락처를 먼저, 모델이 고른 담당은 (AI)를 붙여 뒤에(화면 카드와 같은 차례)."""
    rule = ', '.join('%s %s' % (c['name'], c['phone']) for c in (it.get('contacts') or [])[:2])
    ai = str(it.get('owner') or '').strip()
    if ai and ai not in rule:
        return (rule + ' / ' if rule else '') + ai + '(AI)'
    return rule


def note_tail(it, sep='\n'):
    """2절·연혁·현황 칸에 덧붙이는 메모·할 일(칸에 적은 것이 결과물에 실리지 않던 것)."""
    out = []
    if it.get('todo') and it.get('todo_by') == '사람':
        out.append('할 일: ' + it['todo'])
    if it.get('note'):
        out.append('메모: ' + it['note'])
    return (sep + sep.join(out)) if out else ''


def due_show(it):
    d = it.get('due_next') or ''
    if not d:
        return ''
    return '기한\n%s%s' % (d, '\n(지남)' if d < today_iso() else '')   # 날짜가 칸 안에서 중간에 끊기지 않게 줄을 나눈다


def kept_items(session):
    return [it for it in session.get('items', []) if it.get('keep', True)]


def month_key(when):
    m = re.search(r'(\d{1,2})월', when or '')
    return int(m.group(1)) if m else 99


def header_lines(session):
    files = session.get('files', [])
    failures = session.get('failures', [])
    fps = session.get('fingerprints', [])
    changed = sum(1 for x in fps if not x.get('unchanged', True))
    return ['작성 기준: %s · 돌다리 v%s' % (datetime.datetime.now().strftime('%Y-%m-%d %H:%M'), session.get('version', '1.0')),
            '업무 폴더: %s' % os.path.basename(str(session.get('folder', '')).rstrip('\\/')),
            '읽은 파일 %d개 · 못 읽은 문서 %d개 · 읽지 않는 형식(그림·프로그램 등) %d개 · 원본 변경 %d개(처리 전후 SHA-256 대조)' % (len(files), sum(1 for x in failures if not x.get('skip')), sum(1 for x in failures if x.get('skip')), changed),
            '모델: %s · 본문 항목 %d(규칙만 %d · 모델 요지 %d · 직접 적음 %d) · 붙임 1 확인 전 문서 %d' % (   # 본문에 실은 항목만 센다(「확인한 항목 0/24」와 분모가 다르던 것)
                session.get('model', '없음'), len(kept_docs(session)),
                sum(1 for it in kept_docs(session) if str(it.get('src', '')).startswith('규칙')),   # 「규칙(반복 문장)」도 규칙(10.23. 사용자 결과에서 27≠23+0+0)
                sum(1 for it in kept_docs(session) if str(it.get('src', '')).startswith('모델')),
                sum(1 for it in kept_docs(session) if it.get('src') == '직접 입력'), len(pending_docs(session)))]


CLS_ORDER = ['공문', '메일', '회의록', '보고서·계획', '메모', '인수인계서', '규정·지침', '기타', '직접 입력']
STATUS_LABEL = {'진행': '진행 중', '미결': '미결(회신·결정 대기)', '완료': '끝남'}


def month_of(s):
    """'2026-09-10' → 9, '매년 3월' → 3, '매주 화요일' → 0. 사람이 적은 날짜는 아무 꼴이나 올 수 있다."""
    s = str(s or '')
    m = re.match(r'^\d{4}-(\d{2})', s) or re.search(r'(\d{1,2})\s*월', s)
    try:
        v = int(m.group(1)) if m else 0
    except Exception:
        v = 0
    return v if 1 <= v <= 12 else 0


def kept_docs(session):
    """본문에 싣는 것: 넣은 것 + 아직 고르지 않은 현안·반복 제안(「[확인 전]」 표시). 고르지 않은 문서·현황·연혁 제안과 개인 문서는 본문에 싣지 않고
    붙임에 제목만 둔다(v3.7: 정리 없이 내려받으면 멘토 면담·계정 목록 같은 문서 이름이 결재본에 섞이던 것)."""
    out = []
    for it in session.get('items', []):
        if not it.get('keep', True):
            continue
        if undecided(it) and (it.get('private') or it.get('kind3') not in ('현안', '반복')):
            continue
        out.append(it)
    return out


def pending_docs(session):
    return [it for it in session.get('items', []) if it.get('keep', True) and undecided(it) and (it.get('private') or it.get('kind3') not in ('현안', '반복'))]


def area_order(session, rows):
    """업무 순서: 설정한 업무 → 설정 밖 업무 이름(사람이 고르거나 키워드를 바꿔 생긴 것) → 기타. 항목이 있는 업무만."""
    conf = [a['name'] for a in (session.get('areas') or [])]
    have = []
    for it in rows:
        a = it.get('area') or '기타'
        if a not in have:
            have.append(a)
    extra = sorted(a for a in have if a not in conf and a != '기타')
    return [a for a in conf if a in have] + extra + (['기타'] if '기타' in have else [])


def area_list(session, items):
    """업무 순서. 「이미 넘긴 업무」(항목을 다 뺐어도)는 1-가에 「인계 완료」로 남긴다."""
    ov = session.get('overview') or {}
    gone = [{'area': a} for a, v in ov.items() if isinstance(v, dict) and v.get('gone')]
    return area_order(session, list(items) + gone)


def undecided(it):
    return it.get('decided') is not True and it.get('src') != '직접 입력'


def doc_line(it):
    """[2026-02-01] 제목 (우편영업과-658) · 확인 전"""
    return '%s%s%s%s' % (('[%s] ' % it['date']) if it.get('date') else '', it.get('title', ''), (' (%s)' % it['docno']) if it.get('docno') else '', ' · 확인 전' if undecided(it) else '')


def src_line(it):
    if not it.get('file'):
        return '출처: 전임자가 직접 적음'
    return '파일: %s%s' % (it['file'], (' · 붙임 %d개' % len(it['attachments'])) if it.get('attachments') else '')


def fname(it):
    """파일 이름(바로 위 폴더 하나까지: 다른 폴더의 같은 이름 파일을 구분). 압축 안 파일은 「묶음.zip ▸ 파일」. 붙임 수를 덧붙인다."""
    f = str(it.get('file') or '')
    if not f:
        return '직접 적음'
    parts = []
    for i, seg in enumerate(f.split(' ▸ ')):
        segs = [x for x in seg.replace('\\', '/').split('/') if x]
        parts.append('/'.join(segs[-2:]) if i == 0 else segs[-1] if segs else seg)
    return ' ▸ '.join(parts) + ((' (+붙임 %d)' % len(it['attachments'])) if it.get('attachments') else '')


def cycle_label(it):
    r = it.get('recur') or {}
    if r.get('cycle') in ('매월', '매주', '분기', '반기'):
        return it.get('when') or r['cycle']
    if r.get('cycle') == '매년' and not r.get('month') and not r.get('years'):
        return it.get('when') or '매년'   # 문장에 달이 없으면 「매년」만(파일 날짜의 달이 찍히던 것)
    m = r.get('month') or month_of(it.get('date') or it.get('when') or '')
    if m:
        return '%d월' % m
    d = str(it.get('date') or '')
    return it.get('when') or ('' if re.match(r'^\d{4}', d) else d) or '시기 미정'   # 「매주 금요일」처럼 사람이 적은 시기는 그대로


def contact_rows(session):
    """4절 관계자 연락처(화면 4절·목차 배지도 이 목록을 그대로 쓴다: 화면과 파일이 다르던 것).
    넣은 항목과 확인 전 현안·반복의 연락처, 그리고 표·명단 파일의 연락처. 버리기 한 문서·명단의 번호, 인계자 자신, 1-가 소속의 자기 부서 번호, 일반전화가 있는 사람의 휴대전화는 뺀다."""
    items = kept_docs(session)
    info = session.get('info') or {}
    used = area_list(session, items)
    who_from = str(session.get('handover_from') or '').split('(')[0].strip()
    own_units = [t for t in re.split(r'\s+', str(session.get('org') or '').strip())[1:] if len(t) >= 2]
    dropped = {it['file'] for it in session.get('items', []) if it.get('file') and not it.get('keep', True)}
    seen, rows, names_landline = set(), [], set()
    def add_c(a, name, phone, ln, title, pending, src):
        if phone in seen or (who_from and name and name == who_from):   # 인계자 자신은 뺀다
            return
        if own_units and name and any(u in name for u in own_units):   # 1-가 「소속」의 자기 부서(우편영업실 등) 대표 번호는 뺀다
            return
        mobile = phone.startswith('010')
        if mobile and name and name in names_landline:   # 같은 사람의 휴대전화는 일반전화가 있으면 뺀다
            return
        if not mobile and name:
            names_landline.add(name)
        ln = str(ln or '')
        seen.add(phone); rows.append({'area': a, 'name': name, 'phone': phone, 'mobile': mobile, 'line': ln if len(ln) <= 70 else ln[:68].rstrip(' ([（') + '…', 'title': title, 'pending': pending, 'src': src})
    for a in used:
        for it in sorted([x for x in items if (x.get('area') or '기타') == a], key=lambda x: any(str(c.get('phone', '')).startswith('010') for c in x.get('contacts') or [])):
            for c in sorted(it.get('contacts') or [], key=lambda c: c['phone'].startswith('010')):
                add_c(a, c['name'], c['phone'], c.get('line'), it.get('title', '') + und_mark(it), undecided(it), '문서')
    for pp in sorted(info.get('people') or [], key=lambda x: x['phone'].startswith('010')):   # 표·명단 파일에서 찾은 연락처(그 명단 항목을 버리면 함께 뺀다)
        if pp.get('file') and pp['file'] in dropped:
            continue
        add_c(pp.get('area') or '기타', pp.get('name', ''), pp['phone'], pp.get('line'), pp.get('title', '') + ' (명단)', False, '명단')
    return rows


def und_mark(it):
    return ' [확인 전]' if undecided(it) else (' [일괄 넣음]' if it.get('bulk') else '')


def chapters(session):
    """별지 제12호서식(행정업무의 운영 및 혁신에 관한 규정 시행규칙) 업무인계·인수서 차례. 표 중심.
    (종류, 값) 목록. 종류: h1·h2·h3·p·li·sub·table. table 값은 {'cols': [...], 'rows': [[...]], 'w': [비율...]}.
    1. 업무현황(가 담당 업무 / 나 주요 업무계획 및 진행사항 / 다 현안사항 및 문제점 / 라 주요 미결사항) → 2. 관련 문서 현황 → 3. 주요 물품 및 예산 등 → 4. 그 밖의 참고사항 → 붙임 1·2."""
    out = []
    items = kept_docs(session)
    overview = session.get('overview') or {}
    assets = session.get('assets') or {}
    info = session.get('info') or {}
    used = area_list(session, items)
    issues = [it for it in items if it.get('kind3') == '현안']
    recur = [it for it in items if it.get('kind3') == '반복' or (it.get('kind3') == '현안' and it.get('recur'))]
    n_und = sum(1 for it in items if undecided(it))
    n_bulk = sum(1 for it in items if it.get('bulk') and not undecided(it))
    und = lambda it: ' [확인 전]' if undecided(it) else (' [일괄 넣음]' if it.get('bulk') else '')
    T = lambda cols, rows, w=None: ('table', {'cols': cols, 'rows': rows, 'w': w})
    chk = lambda it: '☑' if it.get('seen') else '☐'
    who_from = str(session.get('handover_from') or '').split('(')[0].strip()
    own_units = [t for t in re.split(r'\s+', str(session.get('org') or '').strip())[1:] if len(t) >= 2]
    out.append(('h1', '1. 업무현황'))
    if n_und or n_bulk:
        out.append(('p', '※ 읽는 분께: [확인 전] %d건은 프로그램이 문서에서 찾아 제안했으나 전임자가 아직 확인하지 않은 것이고, [일괄 넣음] %d건은 한꺼번에 넣어 하나씩 확인하지 않은 것이다. 원문(근거 파일)으로 확인하고, 모르면 전임자에게 물어 「인수 확인」 칸에 표시한다.' % (n_und, n_bulk)))
    # 가. 담당 업무: 업무 | 업무 내용 | 조심할 것 | 현황 자료
    out.append(('h2', '가. 담당 업무'))
    rows = []
    for a in used:
        r = [it for it in items if (it.get('area') or '기타') == a]
        ov = overview.get(a) or {}
        desc = (ov.get('desc') or '').strip() if isinstance(ov, dict) else str(ov)
        tip = (ov.get('tip') or '').strip() if isinstance(ov, dict) else ''
        stat = [it for it in r if it.get('kind3') == '현황']
        gone = (ov.get('gone') or '').strip() if isinstance(ov, dict) else ''
        if gone:
            desc = ('[인계 완료] ' + gone + ('\n' + desc if desc else ''))
        rows.append([a, desc or '(적지 않음)', tip or '', '\n'.join('%s (%s)%s' % (it.get('title', ''), dshow(it, 7), note_tail(it, ' · ')) for it in stat[:4]) + ((' 외 %d' % (len(stat) - 4)) if len(stat) > 4 else '')])
    if rows:
        out.append(T(['업무', '업무 내용', '조심할 것', '현황 자료(최신 대장)'], rows, [16, 34, 28, 22]))
    else:
        out.append(('p', '(없음)'))
    hist = sorted([it for it in items if it.get('kind3') == '연혁' or it.get('hist')], key=lambda it: it.get('date') or '')
    if hist:
        out.append(('h3', '연혁(업무의 전환점)'))
        out.append(T(['시기', '업무', '전환점 문서'], [[dwhen(it, 7), it.get('area') or '기타', '%s%s%s%s' % (it.get('title', ''), (' (%s)' % it['docno']) if it.get('docno') else '', und(it), note_tail(it))] for it in hist], [12, 20, 68]))
    # 나. 주요 업무계획 및 진행사항: 시기 | 업무 | 할 일 | 근거 문서
    out.append(('h2', '나. 주요 업무계획 및 진행사항'))
    base = str(info.get('base_date') or today_iso())
    soon_lim = (datetime.date.fromisoformat(base[:10]) - datetime.timedelta(days=14)).isoformat() if re.match(r'^\d{4}-\d{2}-\d{2}', base) else ''
    soon = sorted([it for it in items if it.get('due_next') and it['due_next'] >= soon_lim and (it.get('status') or '진행') != '완료'], key=lambda it: it['due_next'])
    out.append(('h3', '인수 직후 할 일(기한 순)'))
    if soon:
        out.append(T(['기한', '업무', '할 일·문서', '상태'], [[it['due_next'] + (' (지남)' if it['due_next'] < today_iso() else ''), it.get('area') or '기타', ((it.get('todo') or it.get('next') or '') + '\n' if (it.get('todo') or it.get('next')) else '') + it.get('title', '') + und(it), STATUS_LABEL.get(it.get('status') or '진행', '진행 중')] for it in soon[:20]] + ([['', '', '외 %d건(1-다 현안 표 참고)' % (len(soon) - 20), '']] if len(soon) > 20 else []), [15, 15, 55, 15]))
    else:
        out.append(('p', '(문서에서 다가오는 기한을 찾지 못함. 아래 반복 업무와 1-다 현안을 볼 것)'))
    out.append(('h3', '해마다·매월·매주 되풀이되는 업무'))
    out.append(('p', '같은 제목으로 해마다·매월 오는 문서(지난 3년 파일 날짜)와 본문의 「매월 ○일까지」「매주 ○요일」「익월」 줄, 옛 인수인계서·연간 일정표의 「○월 ○일까지」 줄에서 찾음.'))
    if recur:
        rows = []
        for it in sorted(recur, key=lambda it: (0 if (it.get('recur') or {}).get('cycle') == '매월' else 1, (it.get('recur') or {}).get('month') or month_of(it.get('date') or ''), it.get('date') or '')):
            r = it.get('recur') or {}
            ev = (' · %s년' % '·'.join(r['years'])) if r.get('years') and r.get('cycle') != '매월' else ((' · %d개월 %d회' % (len(r['months']), r['n'])) if r.get('months') else '')
            rows.append([cycle_label(it), it.get('area') or '기타', (it.get('todo') or it.get('summary') or (('원문: ' + it['quote']) if it.get('quote') else '') or '(할 일 적지 않음)') + ((' / 메모: ' + it['note']) if it.get('note') else ''), '%s%s%s' % (it.get('title', '') if it.get('src') != '규칙(반복 문장)' else fname(it), ev, und(it))])
        out.append(T(['시기', '업무', '할 일', '근거 문서'], rows, [9, 16, 40, 35]))
    else:
        out.append(('p', '(없음)'))
    # 다. 현안사항 및 문제점: 업무 | 현안 | 기한·상태 | 할 일·다음 | 담당
    out.append(('h2', '다. 현안사항 및 문제점'))
    cur = [it for it in issues if (it.get('status') or '진행') != '미결']
    if cur:
        rows = []
        for a in used:
            for it in [x for x in cur if (x.get('area') or '기타') == a]:
                rows.append([a, '%s%s%s\n%s' % (it.get('title', ''), (' (%s)' % it['docno']) if it.get('docno') else '', und(it), dwhen(it) + ' · ' + fname(it)),
                             ((due_show(it) + '\n') if it.get('due_next') else '') + STATUS_LABEL.get(it.get('status') or '진행', '진행 중'), todo_cell(it), owner_cell(it), chk(it)])
        out.append(T(['업무', '현안(문서)', '기한·상태', '요지·할 일', '담당', '인수 확인'], rows, [10, 27, 14, 30, 12, 7]))
    else:
        out.append(('p', '(없음)'))
    # 라. 주요 미결사항
    out.append(('h2', '라. 주요 미결사항'))
    pend = [it for it in issues if (it.get('status') or '진행') == '미결']
    if pend:
        out.append(T(['업무', '미결 사항(문서)', '기한', '기다리는 것·다음에 할 일', '인수 확인'], [[it.get('area') or '기타', '%s%s%s\n%s' % (it.get('title', ''), (' (%s)' % it['docno']) if it.get('docno') else '', und(it), dwhen(it) + ' · ' + fname(it)), due_show(it).replace('기한\n', ''), todo_cell(it), chk(it)] for it in sorted(pend, key=lambda x: (used.index(x.get('area') or '기타') if (x.get('area') or '기타') in used else 99))], [12, 34, 14, 33, 7]))
    else:
        out.append(('p', '(없음)'))
    # 2. 관련 문서 현황
    out.append(('h1', '2. 관련 문서 현황'))
    in_sec1 = [it for it in items if it.get('kind3') != '문서']
    items2 = [it for it in items if it.get('kind3') == '문서']
    n_direct = sum(1 for it in items2 if it.get('src') == '직접 입력')
    out.append(('p', '1절에 실은 문서(현안·반복·연혁·현황) %d건을 뺀 그 밖의 문서 %d건(최근 %d개월%s). 오래된 문서 %d건과 확인 전 문서는 붙임 1. 날짜에 「(수정일)」이 붙은 것은 문서에 날짜가 없어 파일 수정일로 대신한 것.%s' % (len(in_sec1), len(items2), int(session.get('months') or 12), (', 전임자가 직접 적은 %d건 포함' % n_direct) if n_direct else '', info.get('n_old', 0),
                     (' 누적 매뉴얼 「%s」에 아직 반영되지 않은 공문은 「★ 미반영」.' % fname({'file': info['manual']})) if info.get('manual') else '')))
    for a in area_order(session, items2):
        r = sorted([it for it in items2 if (it.get('area') or '기타') == a], key=lambda it: it.get('date') or '', reverse=True)
        out.append(('h3', '%s (%d건)' % (a, len(r))))
        out.append(T(['날짜', '문서(파일)', '종류', '구분', '매뉴얼'], [[dwhen(it), '%s%s%s\n%s%s' % (it.get('title', ''), (' (%s)' % it['docno']) if it.get('docno') else '', und(it), fname(it), note_tail(it)), it.get('cls', ''), {'현안': '현안', '반복': '반복', '연혁': '연혁', '현황': '현황 자료'}.get(it.get('kind3'), ''), ('★ 미반영' if (info.get('manual') and it.get('cls') == '공문' and not it.get('reflected')) else ('반영' if it.get('reflected') else ''))] for it in r], [15, 52, 11, 11, 11]))
    # 3. 주요 물품 및 예산 등
    out.append(('h1', '3. 주요 물품 및 예산 등'))
    AS = [('acct', '계정·비밀번호 보관처(비밀번호 자체는 적지 않음)'), ('goods', '열쇠·물품·비품'), ('budget', '예산·미지급·정산'), ('etc', '그 밖의 당부')]
    out.append(T(['항목', '내용'], [[label, assets.get(k) or '(적지 않음)'] for k, label in AS], [28, 72]))
    # 4. 그 밖의 참고사항
    out.append(('h1', '4. 그 밖의 참고사항'))
    out.append(('h3', '관계자 연락처'))
    rows = [[c['area'], c['name'], c['phone'] + (' (휴대)' if c['mobile'] else ''), c['line'], c['title']] for c in contact_rows(session)]
    if rows:
        out.append(T(['업무', '이름', '전화', '무슨 일로', '문서'], rows, [14, 12, 16, 30, 28]))
    else:
        out.append(('p', '(없음)'))
    out.append(('h3', '인수자 질문·전임자 답'))
    qs = [it for it in session.get('items', []) if str(it.get('question') or '').strip()]
    out.append(T(['항목(문서)', '인수자 질문', '전임자 답'], [[it.get('title', ''), it['question'], it.get('answer') or ''] for it in qs] + [['', '', ''] for _ in range(max(0, 3 - len(qs)))], [30, 35, 35]))
    if info.get('manual'):
        out.append(('h3', '누적 업무 매뉴얼'))
        out.append(('p', '%s (문서번호 %d개 반영). 2절의 「★ 미반영」 공문은 매뉴얼에 아직 들어가지 않았으니 후임자가 해당 절에 반영할 것.' % (info['manual'], info.get('manual_refs', 0))))
    # 별지 제12호서식 끝: 인계·인수 확인과 서명
    out.append(('p', '위와 같이 인계·인수합니다.'))
    out.append(('p', '%s' % (session.get('handover_date') or '        년      월      일')))
    out.append(T(['구분', '소속·직위', '성명', '서명 또는 인'], [['인계자', session.get('org') or '', session.get('handover_from') or '', ''], ['인수자', session.get('org') or '', session.get('handover_to') or '', ''], ['입회자', '', session.get('witness') or '', '']], [16, 40, 24, 20]))
    old = info.get('docs_old') or []
    out.append(('h1', '붙임 1. 참고 문서 목록(기간 밖, 업무·연도별)'))
    out.append(('p', '최근 %d개월 밖의 문서 %d건. 연혁·현황으로 올린 것은 뺐다. 제목만 적었으니 필요하면 폴더에서 연 이름으로 찾는다.' % (int(session.get('months') or 12), len(old))))
    for a in area_order(session, old):
        rows = [d for d in old if (d.get('area') or '기타') == a]
        if not rows:
            continue
        out.append(('h3', '%s (%d건)' % (a, len(rows))))
        by_year = {}
        for d in rows:
            by_year.setdefault((d.get('date') or '')[:4] or '날짜 없음', []).append(d)
        for y in sorted(by_year, reverse=True):
            g = sorted(by_year[y], key=lambda d: d.get('date') or '', reverse=True)
            out.append(('li', '%s년 %d건: %s%s' % (y, len(g), ' / '.join(d.get('title', '')[:40] for d in g[:15]), (' / 외 %d건' % (len(g) - 15)) if len(g) > 15 else '')))
    pend_docs = pending_docs(session)
    if pend_docs:
        priv = [it for it in pend_docs if it.get('private')]
        rest = [it for it in pend_docs if not it.get('private')]
        out.append(('h3', '확인 전 문서 %d건(전임자가 넣기·버리기를 하지 않아 본문에 싣지 않음)' % len(pend_docs)))
        if rest:
            out.append(('li', ' / '.join('%s(%s)' % (it.get('title', '')[:40], it.get('kind3', '')) for it in rest[:40]) + ((' / 외 %d건' % (len(rest) - 40)) if len(rest) > 40 else '')))
        if priv:
            out.append(('li', '개인 문서로 보이는 %d건(멘토 면담·교육과제 등)은 제목도 싣지 않음' % len(priv)))
    other = info.get('docs_other') or []
    if other:
        out.append(('h3', '항목으로 올리지 않은 문서 %d건(업무 매뉴얼·같은 문서의 다른 형식)' % len(other)))
        out.append(('li', ' / '.join('%s(%s)' % (d.get('title', '')[:40], d.get('why', '')) for d in other[:30]) + ((' / 외 %d건' % (len(other) - 30)) if len(other) > 30 else '')))
    failures = [x for x in session.get('failures', []) if not x.get('skip')]
    skipped = [x for x in session.get('failures', []) if x.get('skip')]
    IMG = re.compile(r'\.(jpe?g|png|tiff?|bmp|gif|heic)$', re.I)
    scans = [x for x in skipped if IMG.search(x['file'])]
    named = [x for x in skipped if not IMG.search(x['file']) and '돌다리가 만든' in x.get('reason', '')]
    out.append(('h1', '붙임 2. 확인하지 못한 자료(후임자가 직접 열어 볼 것)'))
    rows = [[x['file'], x['reason']] for x in failures] + [[x['file'], '그림 파일: 스캔한 문서일 수 있음, 열어 볼 것'] for x in scans] + [[x['file'], x['reason']] for x in named]
    if rows:
        out.append(T(['파일', '사유'], rows, [55, 45]))
    rest = len(skipped) - len(scans) - len(named)
    if rest:
        out.append(('p', '그 밖에 영상·프로그램·글꼴·임시 파일 %d개는 읽지 않았다(문서가 아님).' % rest))
    if not rows and not rest:
        out.append(('p', '(없음)'))
    return out


FORM_LABEL = '■ 행정업무의 운영 및 혁신에 관한 규정 시행규칙 [별지 제12호서식]'


def credit(session):
    items = kept_docs(session)
    n = len(items); m = sum(1 for it in items if not undecided(it) and not it.get('bulk'))
    if n and m == n:
        return CREDIT
    return '돌다리(업무 인수인계 도우미)로 만든 초안 · 전임자가 하나씩 확인한 항목 %d/%d건' % (m, n)


def head_block(session):
    return ['인계자: %s · 인수자: %s · 입회자: %s · 일자: %s · 소속: %s' % (session.get('handover_from') or '', session.get('handover_to') or '', session.get('witness') or '',
                                                            session.get('handover_date') or '', session.get('org') or '')]


def doc_title_line(session):
    t = (session.get('title') or '').strip()
    return '업무인계·인수서' + ((' (%s)' % t) if t and t != '전임자 확인 후 확정' else '')


def to_markdown(session):
    _set_ref(session)
    h = lambda v: _html.escape(str(v), quote=False)   # 글 속 <script> 같은 것이 미리보기에서 실행되지 않게
    out = [h(FORM_LABEL), '', '# ' + h(doc_title_line(session)), '']
    out += ['- ' + h(l) for l in head_block(session)] + ['']
    for kind, text in chapters(session):
        if kind == 'h1': out += ['', '## ' + h(text), '']
        elif kind == 'h2': out += ['', '### ' + h(text), '']
        elif kind == 'h3': out += ['', '#### ' + h(text), '']
        elif kind == 'p': out += [h(text), '']
        elif kind == 'li': out.append('- ' + h(text))
        elif kind == 'sub': out.append('  - ' + h(text))
        elif kind == 'table':
            cell = lambda v: h(v).replace('|', '\\|').replace('\n', '<br>')
            out += ['', '| ' + ' | '.join(h(c) for c in text['cols']) + ' |', '|' + '---|' * len(text['cols'])] + ['| ' + ' | '.join(cell(v) for v in r) + ' |' for r in text['rows']] + ['']
    out += ['', '---', h('%s. %s' % (credit(session), FOOT)), ''] + ['- ' + h(l) for l in header_lines(session)]
    return '\n'.join(out) + '\n'


def onnara_sections(session):
    """온나라·e-사람 인계서 입력 칸에 붙여 넣을 글. 서식의 칸(1-가·나·다·라, 2, 3, 4)마다 평문 한 덩이."""
    _set_ref(session)   # 「(지남)」 기준을 인계 일자로(내려받은 파일과 복사한 글이 다르던 것)
    secs, cur, buf, pre = [], None, [], []
    def flush():
        if cur is not None:
            secs.append((cur, '\n'.join(pre + buf).strip()))
            del pre[:]
    for kind, text in chapters(session):
        if kind == 'h1' or (kind == 'h2' and text.startswith(('가.', '나.', '다.', '라.'))):   # 칸은 1-가·나·다·라, 2, 3, 4뿐. 그 안의 작은 제목은 [제목] 줄로
            if kind == 'h1' and text.startswith('1.'):
                continue   # 1.은 가·나·다·라로 나뉜다
            if kind == 'h1' and text.startswith('붙임'):
                flush(); cur = None; break   # 붙임 목록은 온나라 칸에 넣지 않는다
            flush(); cur, buf = text, []
        elif kind in ('h2', 'h3'):
            buf.append('[%s]' % text)
        elif kind == 'p':
            (buf if cur is not None else pre).append(text)   # 「가.」 앞의 안내(※ [확인 전] n건)는 첫 칸에 붙인다
        elif kind == 'li':
            buf.append('○ ' + text)
        elif kind == 'sub':
            buf.append('   - ' + text)
        elif kind == 'table':
            for r in text['rows']:
                buf.append('○ ' + ' · '.join(str(v).replace('\n', ' / ') for v in r if str(v).strip()))
    flush()
    return secs


def to_onnara_txt(session):
    _set_ref(session)
    out = [doc_title_line(session) + ' · 온나라 붙여넣기용', head_block(session)[0], '']
    for name, body in onnara_sections(session):
        out += ['=' * 8 + ' ' + name + ' ' + '=' * 8, body, '']
    return '\n'.join(out) + '\n'


# ---------------------------------------------------------------- .docx(표준 라이브러리만)
def _p(text, style=None, size=None, color=None, bold=False, indent=0):
    rpr = ''
    if bold:
        rpr += '<w:b/>'
    if color:
        rpr += '<w:color w:val="%s"/>' % color
    if size:
        rpr += '<w:sz w:val="%d"/>' % int(round(size * 2))
    ppr = ''
    if style:
        ppr += '<w:pStyle w:val="%s"/>' % style
    if indent:
        ppr += '<w:ind w:left="%d"/>' % indent
    runs = ''
    parts = str(text).split('\n')
    for i, part in enumerate(parts):
        if i:
            runs += '<w:r><w:br/></w:r>'
        runs += '<w:r><w:rPr>%s</w:rPr><w:t xml:space="preserve">%s</w:t></w:r>' % (rpr, escape(part))
    return '<w:p><w:pPr>%s</w:pPr>%s</w:p>' % (ppr, runs)


def _tbl(cols, rows, w=None):
    """docx 표(머리행 음영, 테두리, 열 너비 비율). 글자 10pt."""
    n = len(cols); w = w or [100 // n] * n
    tot = 9600   # A4 세로, 좌우 여백 2cm 기준 본문 너비(twips)
    widths = [int(tot * x / sum(w)) for x in w]
    def cell(v, i, head=False):
        shade = '<w:shd w:val="clear" w:color="auto" w:fill="EEF1F5"/>' if head else ''
        paras = ''.join('<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr>%s<w:sz w:val="%d"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>' % ('<w:b/>' if head else '', 19 if head else 19, escape(line)) for line in str(v).split('\n')) or '<w:p/>'
        return '<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/>%s</w:tcPr>%s</w:tc>' % (widths[i], shade, paras)
    grid = ''.join('<w:gridCol w:w="%d"/>' % x for x in widths)
    b = '<w:tblBorders>' + ''.join('<w:%s w:val="single" w:sz="4" w:space="0" w:color="999999"/>' % s for s in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV')) + '</w:tblBorders>'
    head = '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + ''.join(cell(c, i, True) for i, c in enumerate(cols)) + '</w:tr>'
    body = ''.join('<w:tr><w:trPr><w:cantSplit/></w:trPr>' + ''.join(cell(v, i) for i, v in enumerate(r)) + '</w:tr>' for r in rows)
    return '<w:tbl><w:tblPr><w:tblW w:w="%d" w:type="dxa"/>%s<w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>%s</w:tblGrid>%s%s</w:tbl><w:p><w:pPr><w:spacing w:after="60"/></w:pPr></w:p>' % (tot, b, grid, head, body)


def to_html(session):
    """인쇄·미리보기용 HTML 조각(서식 표). 화면의 「인쇄」가 이것을 쓴다."""
    _set_ref(session)
    h = ['<p class="meta">%s</p><h2>%s</h2>' % (escape(FORM_LABEL), escape(doc_title_line(session)))]
    hb = [('인계자', session.get('handover_from')), ('인수자', session.get('handover_to')), ('입회자', session.get('witness')), ('일자', session.get('handover_date')), ('소속', session.get('org'))]
    h.append('<table class="hdr"><tr>' + ''.join('<th>%s</th><td>%s</td>' % (k, escape(str(v or ''))) for k, v in hb) + '</tr></table>')
    for kind, text in chapters(session):
        if kind == 'h1': h.append('<h3>%s</h3>' % escape(text))
        elif kind == 'h2': h.append('<h4>%s</h4>' % escape(text))
        elif kind == 'h3': h.append('<h5>%s</h5>' % escape(text))
        elif kind == 'p': h.append('<p>%s</p>' % escape(text))
        elif kind == 'li': h.append('<div class="pi">%s</div>' % escape(text))
        elif kind == 'sub': h.append('<div class="pi sub">%s</div>' % escape(text))
        elif kind == 'table':
            w = text.get('w') or [100 // len(text['cols'])] * len(text['cols'])
            h.append('<table class="f"><colgroup>%s</colgroup><thead><tr>%s</tr></thead><tbody>%s</tbody></table>' % (
                ''.join('<col style="width:%d%%">' % x for x in w), ''.join('<th>%s</th>' % escape(c) for c in text['cols']),
                ''.join('<tr>%s</tr>' % ''.join('<td>%s</td>' % escape(str(v)).replace('\n', '<br>') for v in r) for r in text['rows'])))
    h.append('<p class="meta">%s. %s</p>' % (escape(credit(session)), escape(FOOT)))
    h.append('<p class="meta">%s</p>' % '<br>'.join(escape(l) for l in header_lines(session)))
    return '\n'.join(h)


def to_docx(session, path):
    _set_ref(session)
    body = [_p(FORM_LABEL, size=8.5, color='666666'), _p(doc_title_line(session), style='Title')]
    body.append(_tbl(['인계자', '인수자', '입회자', '일자', '소속'], [[session.get('handover_from') or '', session.get('handover_to') or '', session.get('witness') or '', session.get('handover_date') or '', session.get('org') or '']], [18, 18, 18, 16, 30]))
    for kind, text in chapters(session):
        if kind == 'h1': body.append(_p(text, style='Heading1'))
        elif kind == 'h2': body.append(_p(text, style='Heading2'))
        elif kind == 'h3': body.append(_p(text, bold=True))
        elif kind == 'p': body.append(_p(text))
        elif kind == 'li': body.append(_p('• ' + text, indent=360))
        elif kind == 'sub': body.append(_p(text, size=10, color='666666', indent=720))
        elif kind == 'table': body.append(_tbl(text['cols'], text['rows'], text.get('w')))
    body.append(_p('%s. %s' % (credit(session), FOOT), size=9, color='888888'))
    for l in header_lines(session):   # 작성 정보(판·원본 대조)는 맨 끝에 작게
        body.append(_p(l, size=8, color='888888'))
    W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="%s" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>%s<w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/>'
                '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>' % (W, ''.join(body)))
    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<w:styles xmlns:w="%s">'
              '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="맑은 고딕"/><w:sz w:val="24"/><w:lang w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault>'
              '<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
              '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
              '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="200"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>'
              '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="1F3864"/></w:rPr></w:style>'
              '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="1F3864"/></w:rPr></w:style>'
              '</w:styles>' % W)
    content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                     '<Default Extension="xml" ContentType="application/xml"/>'
                     '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                     '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
                     '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
                     '</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
    doc_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
                '</Relationships>')
    footer = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'   # 쪽 번호(「- 1 / 6 -」)
              '<w:ftr xmlns:w="%s"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">- </w:t></w:r>'
              '<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>'
              '<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"> / </w:t></w:r>'
              '<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>'
              '<w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"> -</w:t></w:r></w:p></w:ftr>' % W)
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', content_types)
        z.writestr('_rels/.rels', rels)
        z.writestr('word/document.xml', document)
        z.writestr('word/_rels/document.xml.rels', doc_rels)
        z.writestr('word/styles.xml', styles)
        z.writestr('word/footer1.xml', footer)
    return path


def write_all(session, out_dir, stem='인수인계서'):
    os.makedirs(out_dir, exist_ok=True)
    md = os.path.join(out_dir, stem + '.md')
    with open(md, 'w', encoding='utf-8') as f:
        f.write(to_markdown(session))
    docx = to_docx(session, os.path.join(out_dir, stem + '.docx'))
    txt = os.path.join(out_dir, stem + '_온나라.txt')
    with open(txt, 'w', encoding='utf-8') as f:
        f.write(to_onnara_txt(session))
    return [md, docx, txt]
