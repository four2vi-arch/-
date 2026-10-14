#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""돌다리 v1.0 · 내보내기(2026-10-10): 검토가 끝난 인수인계서를 .md와 .docx로 쓴다. 외부 패키지 없이 표준 라이브러리만 쓴다."""
import os, re, json, zipfile, datetime
from xml.sax.saxutils import escape

TYPES = ['월별 할 일', '협의할 사람', '진행 중 현안']
CREDIT = '돌다리(업무바통) · 이희재(정읍우체국)'


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
            '업무 폴더: %s' % session.get('folder', ''),
            '읽은 파일 %d개 · 못 읽은 문서 %d개 · 읽지 않는 형식(그림·프로그램 등) %d개 · 원본 변경 %d개(처리 전후 SHA-256 대조)' % (len(files), sum(1 for x in failures if not x.get('skip')), sum(1 for x in failures if x.get('skip')), changed),
            '모델: %s · 문서 항목 %d(규칙만 %d · 모델 요지 %d · 직접 적음 %d)' % (
                session.get('model', '없음'), len(kept_items(session)),
                sum(1 for it in kept_items(session) if it.get('src') == '규칙'),
                sum(1 for it in kept_items(session) if str(it.get('src', '')).startswith('모델')),
                sum(1 for it in kept_items(session) if it.get('src') == '직접 입력'))]


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
    return [it for it in session.get('items', []) if it.get('keep', True)]   # 넣기 전 제안도 싣는다(「확인 전」 표시). 버리기·빼기만 뺀다.


def area_list(session, items):
    areas = [a['name'] for a in (session.get('areas') or [])] + ['기타']
    return [a for a in areas if any((it.get('area') or '기타') == a for it in items)]


def undecided(it):
    return it.get('decided') is not True and it.get('src') != '직접 입력'


def doc_line(it):
    """[2026-02-01] 제목 (우편영업과-658) · 확인 전"""
    return '%s%s%s%s' % (('[%s] ' % it['date']) if it.get('date') else '', it.get('title', ''), (' (%s)' % it['docno']) if it.get('docno') else '', ' · 확인 전' if undecided(it) else '')


def src_line(it):
    if not it.get('file'):
        return '출처: 전임자가 직접 적음'
    return '파일: %s%s' % (it['file'], (' · 붙임 %d개' % len(it['attachments'])) if it.get('attachments') else '')


def chapters(session):
    """별지 제12호서식(행정업무의 운영 및 혁신에 관한 규정 시행규칙) 업무인계·인수서 차례.
    1. 업무현황(가 담당 업무 / 나 주요 업무계획 및 진행사항 / 다 현안사항 및 문제점 / 라 주요 미결사항) → 2. 관련 문서 현황 → 3. 주요 물품 및 예산 등 → 4. 그 밖의 참고사항 → 붙임 확인하지 못한 자료.
    (종류, 글) 목록. 종류: h1·h2·h3·p·li·sub."""
    out = []
    items = kept_docs(session)
    overview = session.get('overview') or {}
    assets = session.get('assets') or {}
    info = session.get('info') or {}
    used = area_list(session, items)
    issues = [it for it in items if it.get('kind3') == '현안']
    recur = [it for it in items if it.get('kind3') == '반복' or (it.get('kind3') == '현안' and it.get('recur'))]
    n_und = sum(1 for it in items if undecided(it))
    out.append(('h1', '1. 업무현황'))
    if n_und:
        out.append(('p', '※ 「확인 전」 %d건은 전임자가 아직 넣기·버리기를 누르지 않은 제안이다. 화면에서 정리하면 표시가 사라진다.' % n_und))
    out.append(('h2', '가. 담당 업무'))
    for a in used:
        rows = [it for it in items if (it.get('area') or '기타') == a]
        ov = overview.get(a) or {}
        desc = (ov.get('desc') or '').strip() if isinstance(ov, dict) else str(ov)
        out.append(('li', '%s — %s' % (a, desc or '(설명을 적지 않음) 문서 %d건' % len(rows))))
        if isinstance(ov, dict) and (ov.get('tip') or '').strip():
            out.append(('sub', '조심할 것: ' + ov['tip'].strip()))
        hist = sorted([it for it in rows if it.get('kind3') == '연혁' or it.get('hist')], key=lambda it: it.get('date') or '')
        for it in hist:   # 연혁: 전환점 문서를 연도순으로
            out.append(('sub', '연혁 %s · %s%s' % ((it.get('date') or '')[:7], it.get('title', ''), (' (%s)' % it['docno']) if it.get('docno') else '')))
        for it in sorted([it for it in rows if it.get('kind3') == '현황'], key=lambda it: it.get('title', '')):
            out.append(('sub', '현황 자료: %s (%s 기준) — %s' % (it.get('title', ''), it.get('date') or '날짜 없음', it.get('file', ''))))
    out.append(('h2', '나. 주요 업무계획 및 진행사항'))
    out.append(('p', '해마다·정기적으로 오는 업무(최근 %d개월 문서와 지난 3년 파일 날짜로 찾음). 달은 가장 최근 문서의 달.' % int(session.get('months') or 12)))
    if not recur:
        out.append(('p', '(없음)'))
    months = {m: [] for m in range(1, 13)}
    for it in recur:
        m = (it.get('recur') or {}).get('month') or month_of(it.get('date') or it.get('when') or '')
        months.setdefault(m if 1 <= m <= 12 else 0, []).append(it)
    for m in range(1, 13):
        for it in months[m]:
            r = it.get('recur') or {}
            out.append(('li', '%s · %s%s%s' % ('매월' if r.get('cycle') == '매월' else '%d월' % m, it.get('title', ''), (' (%s년 %d회)' % ('·'.join(r['years']), r['n'])) if r.get('years') and r.get('cycle') != '매월' else ((' (%d개월 %d회)' % (len(r['months']), r['n'])) if r.get('months') else ''), ' · 확인 전' if undecided(it) else '')))
            if it.get('todo'):
                out.append(('sub', '할 일: ' + it['todo']))
            if it.get('note'):
                out.append(('sub', '메모: ' + it['note']))
            out.append(('sub', src_line(it)))
    for it in months.get(0, []):
        out.append(('li', it.get('title', ''))); out.append(('sub', src_line(it)))
    out.append(('h2', '다. 현안사항 및 문제점'))
    cur = [it for it in issues if (it.get('status') or '진행') != '미결']
    if not cur:
        out.append(('p', '(없음)'))
    for a in used:
        rows = [it for it in cur if (it.get('area') or '기타') == a]
        if not rows:
            continue
        out.append(('h3', a))
        for it in rows:
            out.append(('li', '[%s] %s%s' % (STATUS_LABEL.get(it.get('status') or '진행', '진행 중'), doc_line(it), (' · 기한 %s' % it['due_next']) if it.get('due_next') else '')))
            if it.get('summary'):
                out.append(('sub', '요지: ' + it['summary']))
            if it.get('todo'):
                out.append(('sub', '할 일: ' + it['todo']))
            if it.get('next'):
                out.append(('sub', '다음에 할 일: ' + it['next']))
            if it.get('owner'):
                out.append(('sub', '담당: ' + it['owner']))
            if it.get('note'):
                out.append(('sub', '메모: ' + it['note']))
            out.append(('sub', src_line(it)))
    out.append(('h2', '라. 주요 미결사항'))
    pend = [it for it in issues if (it.get('status') or '진행') == '미결']
    if not pend:
        out.append(('p', '(없음)'))
    for it in pend:
        out.append(('li', '%s · %s%s' % (it.get('area') or '기타', doc_line(it), (' · 기한 %s' % it['due_next']) if it.get('due_next') else '')))
        if it.get('next'):
            out.append(('sub', '다음에 할 일: ' + it['next']))
        if it.get('note'):
            out.append(('sub', '메모: ' + it['note']))
        out.append(('sub', src_line(it)))
    out.append(('h1', '2. 관련 문서 현황'))
    out.append(('p', '최근 %d개월 문서 %d건(업무별 기간을 달리 둔 곳은 그 기간). 그 이전 문서 %d건은 폴더에 그대로 있다.%s' % (
        int(session.get('months') or 12), len(items), info.get('n_old', 0),
        (' 누적 매뉴얼 「%s」에 아직 반영되지 않은 공문 %d건은 ★로 표시.' % (info['manual'], info.get('n_unreflected', 0))) if info.get('manual') else '')))
    for a in used:
        rows = sorted([it for it in items if (it.get('area') or '기타') == a], key=lambda it: it.get('date') or '', reverse=True)
        out.append(('h2', '%s (%d건)' % (a, len(rows))))
        for it in rows:
            star = '★ ' if (info.get('manual') and it.get('cls') == '공문' and not it.get('reflected')) else ''
            out.append(('li', '%s%s · %s%s' % (star, doc_line(it), it.get('cls', ''), {'연혁': ' · 연혁', '현황': ' · 현황 자료'}.get(it.get('kind3'), ''))))
            out.append(('sub', src_line(it)))
    out.append(('h1', '3. 주요 물품 및 예산 등'))
    AS = [('acct', '계정·비밀번호 보관처(비밀번호 자체는 적지 않음)'), ('goods', '열쇠·물품·비품'), ('budget', '예산·미지급·정산'), ('etc', '그 밖의 당부')]
    for k, label in AS:
        out.append(('p', '%s: %s' % (label, assets.get(k) or '(적지 않음)')))
    out.append(('h1', '4. 그 밖의 참고사항'))
    out.append(('h2', '관계자 연락처'))
    seen, people = set(), []
    for it in items:
        for c in it.get('contacts') or []:
            if c['phone'] in seen:
                continue
            seen.add(c['phone']); people.append((it.get('area') or '기타', c, it))
    if not people:
        out.append(('p', '(없음)'))
    for a in used:
        rows = [p for p in people if p[0] == a]
        if not rows:
            continue
        out.append(('h3', a))
        for _, c, it in rows:
            out.append(('li', '%s · %s · %s' % (c['name'], c['phone'], c['line'][:60]))); out.append(('sub', '문서: ' + it.get('title', '')))
    if info.get('manual'):
        out.append(('h2', '누적 업무 매뉴얼'))
        out.append(('p', '%s (문서번호 %d개 반영). 위 2절의 ★ 공문은 매뉴얼에 아직 들어가지 않았으니 후임자가 해당 절에 반영할 것.' % (info['manual'], info.get('manual_refs', 0))))
    old = info.get('docs_old') or []
    out.append(('h1', '붙임 1. 참고 문서 목록(기간 밖, 업무·연도별)'))
    out.append(('p', '최근 %d개월 밖의 문서 %d건. 연혁·현황으로 올린 것은 뺐다. 제목만 적었으니 필요하면 폴더에서 연 이름으로 찾는다.' % (int(session.get('months') or 12), len(old))))
    for a in [a['name'] for a in (session.get('areas') or [])] + ['기타']:
        rows = [d for d in old if (d.get('area') or '기타') == a]
        if not rows:
            continue
        out.append(('h2', '%s (%d건)' % (a, len(rows))))
        by_year = {}
        for d in rows:
            by_year.setdefault((d.get('date') or '')[:4] or '날짜 없음', []).append(d)
        for y in sorted(by_year, reverse=True):
            g = sorted(by_year[y], key=lambda d: d.get('date') or '', reverse=True)
            out.append(('li', '%s년 %d건: %s%s' % (y, len(g), ' / '.join(d.get('title', '')[:40] for d in g[:15]), (' / 외 %d건' % (len(g) - 15)) if len(g) > 15 else '')))
    failures = [x for x in session.get('failures', []) if not x.get('skip')]
    skipped = [x for x in session.get('failures', []) if x.get('skip')]
    out.append(('h1', '붙임 2. 확인하지 못한 자료(후임자가 직접 열어 볼 것)'))
    for x in failures:
        out.append(('li', '%s: %s' % (x['file'], x['reason'])))
    if skipped:
        out.append(('p', '그 밖에 그림·영상·프로그램·글꼴·임시 파일 %d개는 읽지 않았다(문서가 아님).' % len(skipped)))
    if not failures and not skipped:
        out.append(('p', '(없음)'))
    return out


def head_block(session):
    return ['인계자: %s · 인수자: %s · 입회자: %s · 일자: %s · 소속: %s' % (session.get('handover_from') or '', session.get('handover_to') or '', session.get('witness') or '',
                                                            session.get('handover_date') or datetime.date.today().isoformat(), session.get('org') or '')]


def to_markdown(session):
    out = ['# 업무인계·인수서(%s)' % session.get('title', '전임자 확인 후 확정'), '']
    out += ['- ' + l for l in head_block(session) + header_lines(session)] + ['']
    for kind, text in chapters(session):
        if kind == 'h1': out += ['', '## ' + text, '']
        elif kind == 'h2': out += ['', '### ' + text, '']
        elif kind == 'h3': out += ['', '#### ' + text, '']
        elif kind == 'p': out.append(text)
        elif kind == 'li': out.append('- ' + text)
        elif kind == 'sub': out.append('  - ' + text)
    out += ['', '---', '%s · 문서마다 출처 파일을 붙였고, 문서에서 확인되지 않은 내용은 싣지 않았다. 원본 파일은 읽기만 했다.' % CREDIT]
    return '\n'.join(out) + '\n'


def onnara_sections(session):
    """온나라·e-사람 인계서 입력 칸에 붙여 넣을 글. 서식의 칸(1-가·나·다·라, 2, 3, 4)마다 평문 한 덩이."""
    secs, cur, buf = [], None, []
    def flush():
        if cur is not None:
            secs.append((cur, '\n'.join(buf).strip()))
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
            buf.append(text)
        elif kind == 'li':
            buf.append('○ ' + text)
        elif kind == 'sub':
            buf.append('   - ' + text)
    flush()
    return secs


def to_onnara_txt(session):
    out = ['업무인계·인수서 — 온나라 붙여넣기용', head_block(session)[0], '']
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


def to_docx(session, path):
    body = [_p('업무인계·인수서(%s)' % session.get('title', '전임자 확인 후 확정'), style='Title')]
    for l in head_block(session) + header_lines(session):
        body.append(_p(l, size=10.5, color='555555'))
    for kind, text in chapters(session):
        if kind == 'h1': body.append(_p(text, style='Heading1'))
        elif kind == 'h2': body.append(_p(text, style='Heading2'))
        elif kind == 'h3': body.append(_p(text, bold=True))
        elif kind == 'p': body.append(_p(text))
        elif kind == 'li': body.append(_p('• ' + text, indent=360))
        elif kind == 'sub': body.append(_p(text, size=10, color='666666', indent=720))
    body.append(_p(CREDIT + ' · 문서마다 출처 파일을 붙였고, 문서에서 확인되지 않은 내용은 싣지 않았다. 원본 파일은 읽기만 했다.', size=9.5, color='888888'))
    W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="%s"><w:body>%s<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
                '<w:pgMar w:top="1418" w:right="1134" w:bottom="1418" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>' % (W, ''.join(body)))
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
                     '</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
    doc_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                '</Relationships>')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', content_types)
        z.writestr('_rels/.rels', rels)
        z.writestr('word/document.xml', document)
        z.writestr('word/_rels/document.xml.rels', doc_rels)
        z.writestr('word/styles.xml', styles)
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
