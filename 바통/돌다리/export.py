#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""돌다리 v1.0 · 내보내기(2026-10-10): 검토가 끝난 인수인계서를 .md와 .docx로 쓴다. 외부 패키지 없이 표준 라이브러리만 쓴다."""
import os, re, json, zipfile, datetime
from xml.sax.saxutils import escape

TYPES = ['월별 할 일', '협의할 사람', '진행 중 현안']
CREDIT = '돌다리 v2.0(업무바통) · 이희재(정읍우체국)'


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
            '모델: %s · 규칙 항목 %d · 모델 항목 %d · 직접 적은 항목 %d' % (
                session.get('model', '없음'),
                sum(1 for it in kept_items(session) if it.get('src') == '규칙'),
                sum(1 for it in kept_items(session) if str(it.get('src', '')).startswith('모델')),
                sum(1 for it in kept_items(session) if it.get('src') == '직접 입력'))]


STANDING = ('매주', '매월', '분기', '반기', '매년')


def calendar_buckets(items):
    """월별 할 일을 늘 하는 일 / 1~12월 / 시기 없음으로 나눈다(화면 「월별 일정표」와 같은 규칙)."""
    todo = [it for it in items if it.get('type') == '월별 할 일']
    standing = [it for it in todo if it.get('cycle') in STANDING]
    months = {m: [] for m in range(1, 13)}
    none = []
    for it in todo:
        if it in standing:
            continue
        m = month_key(it.get('when'))
        (months[m] if 1 <= m <= 12 else none).append(it)
    standing.sort(key=lambda it: STANDING.index(it.get('cycle')) if it.get('cycle') in STANDING else 99)
    return standing, months, none


def calendar_lines(items):
    standing, months, none = calendar_buckets(items)
    out = []
    def row(it):
        return '%s%s' % (('[%s] ' % it['when']) if it.get('when') else '', it.get('text', '')) + ((' (%s)' % it['area']) if it.get('area') else '')
    if standing:
        out += ['### 늘 하는 일(매주·매월·분기·반기·매년)', ''] + ['- %s · %s' % (it.get('cycle'), row(it)) for it in standing] + ['']
    for m in range(1, 13):
        if months[m]:
            out += ['### %d월' % m, ''] + ['- ' + row(it) for it in months[m]] + ['']
    if none:
        out += ['### 시기 없음', ''] + ['- ' + row(it) for it in none] + ['']
    return out


STATUS_LABEL = {'진행': '진행 중', '대기': '회신·결정 대기', '완료': '끝남'}


def chapters(session):
    """인수인계서 여덟 절. (종류, 글) 목록. 종류: h1·h2·h3·p·li·sub.
    1 업무 현황 → 2 주요 현안 및 미결 사항 → 3 연간 업무 일정 → 4 업무별 인수인계 사항 → 5 관계자 연락처 → 6 계정·물품·예산 → 7 주요 자료 목록 → 8 확인하지 못한 자료."""
    out = []
    items = [it for it in kept_items(session) if it.get('decided', True)]
    overview = session.get('overview') or {}
    assets = session.get('assets') or {}
    areas = [a['name'] for a in (session.get('areas') or [])] + ['기타']
    used = [a for a in areas if any((it.get('area') or '기타') == a for it in items)]
    def src(it):
        if it.get('file'):
            return '출처: %s · 「%s」' % (it['file'], str(it.get('quote', '')).replace('\n', ' / ')[:120]) + ((' · 같은 내용 %d곳' % len(it['also'])) if it.get('also') else '')
        return '출처: 전임자가 직접 적음'
    def person(it):
        return it.get('text', '') + ((' — ' + it['note']) if it.get('note') else '')
    out.append(('h1', '1. 업무 현황'))
    if session.get('handover_from') or session.get('handover_to'):
        out.append(('p', '인계자: %s · 인수자: %s' % (session.get('handover_from') or '', session.get('handover_to') or '')))
    for a in used:
        rows = [it for it in items if (it.get('area') or '기타') == a]
        n = lambda t: sum(1 for it in rows if it.get('type') == t)
        out.append(('li', '%s — 할 일 %d · 현안 %d · 연락처 %d' % (a, n('월별 할 일'), n('진행 중 현안'), n('협의할 사람'))))
        ov = overview.get(a) or {}
        if isinstance(ov, dict) and ov.get('q1'):
            out.append(('sub', '처음 한 달에 꼭: ' + ov['q1']))
    issues = [it for it in items if it.get('type') == '진행 중 현안']
    out.append(('h1', '2. 주요 현안 및 미결 사항'))
    if not issues:
        out.append(('p', '(없음)'))
    for a in used:
        rows = [it for it in issues if (it.get('area') or '기타') == a]
        if not rows:
            continue
        out.append(('h2', a))
        for it in rows:
            out.append(('li', '[%s] %s' % (STATUS_LABEL.get(it.get('status') or '진행', '진행 중'), it.get('text', ''))))
            if it.get('next'):
                out.append(('sub', '다음에 할 일: ' + it['next']))
            if it.get('note'):
                out.append(('sub', '메모: ' + it['note']))
            out.append(('sub', src(it)))
    cal = calendar_lines(items)
    out.append(('h1', '3. 연간 업무 일정'))
    if cal:
        for l in cal:
            if l.startswith('### '):
                out.append(('h3', l[4:]))
            elif l.startswith('- '):
                out.append(('li', l[2:]))
    else:
        out.append(('p', '(없음)'))
    out.append(('h1', '4. 업무별 인수인계 사항'))
    QS = [('q1', '처음 한 달 안에 꼭 해야 하는 것'), ('q2', '자주 틀리거나 조심할 것'), ('q3', '이 일로 연락 오는 사람과 이유')]
    for a in used:
        rows = [it for it in items if (it.get('area') or '기타') == a]
        out.append(('h2', a))
        ov = overview.get(a) or {}
        if not isinstance(ov, dict):
            ov = {'q1': str(ov)}
        for k, label in QS:
            out.append(('p', '%s: %s' % (label, ov.get(k) or '(적지 않음)')))
        standing, months, none = calendar_buckets(rows)
        if standing or any(months.values()) or none:
            out.append(('h3', '이 업무의 달력'))
            for it in standing:
                out.append(('li', '%s · %s' % (it.get('cycle'), it.get('text', '')))); out.append(('sub', src(it)))
            for m in range(1, 13):
                for it in months[m]:
                    out.append(('li', '[%s] %s' % (it.get('when'), it.get('text', '')))); out.append(('sub', src(it)))
            for it in none:
                out.append(('li', it.get('text', ''))); out.append(('sub', src(it)))
        people = [it for it in rows if it.get('type') == '협의할 사람']
        if people:
            out.append(('h3', '연락할 사람'))
            for it in people:
                out.append(('li', person(it))); out.append(('sub', src(it)))
    people = [it for it in items if it.get('type') == '협의할 사람']
    out.append(('h1', '5. 관계자 연락처'))
    if not people:
        out.append(('p', '(없음)'))
    for it in people:
        out.append(('li', '%s · %s' % (it.get('area') or '기타', person(it))))
    out.append(('h1', '6. 계정·물품·예산 등 인계 물품'))
    AS = [('acct', '계정·비밀번호 보관처'), ('goods', '열쇠·물품·비품'), ('budget', '예산·미지급·정산'), ('etc', '그 밖의 당부')]
    for k, label in AS:
        out.append(('p', '%s: %s' % (label, assets.get(k) or '(적지 않음)')))
    out.append(('h1', '7. 주요 자료 목록'))
    keyfiles = session.get('keyfiles') or []
    files = {}
    for it in items:
        if it.get('file'):
            files[it['file']] = files.get(it['file'], 0) + 1
        for al in it.get('also', []):
            files[al['file']] = files.get(al['file'], 0) + 1
    listed = keyfiles or [f for f, n in sorted(files.items(), key=lambda x: -x[1])[:15]]
    if not listed:
        out.append(('p', '(없음)'))
    for f in listed:
        out.append(('li', '%s (항목 %d개의 출처)' % (f, files.get(f, 0))))
    failures = [x for x in session.get('failures', []) if not x.get('skip')]
    skipped = [x for x in session.get('failures', []) if x.get('skip')]
    out.append(('h1', '8. 확인하지 못한 자료(후임자가 직접 열어 볼 것)'))
    for x in failures:
        out.append(('li', '%s: %s' % (x['file'], x['reason'])))
    if skipped:
        out.append(('p', '그 밖에 그림·영상·프로그램·글꼴·임시 파일 %d개는 읽지 않았다(문서가 아님).' % len(skipped)))
    if not failures and not skipped:
        out.append(('p', '(없음)'))
    return out


def to_markdown(session):
    out = ['# 업무 인수인계서(%s)' % session.get('title', '전임자 확인 후 확정'), '']
    out += ['- ' + l for l in header_lines(session)] + ['']
    for kind, text in chapters(session):
        if kind == 'h1': out += ['', '## ' + text, '']
        elif kind == 'h2': out += ['', '### ' + text, '']
        elif kind == 'h3': out += ['', '#### ' + text, '']
        elif kind == 'p': out.append(text)
        elif kind == 'li': out.append('- ' + text)
        elif kind == 'sub': out.append('  - ' + text)
    out += ['', '---', '%s · 항목마다 출처 파일과 원문 발췌를 붙였고, 원문에서 확인되지 않은 항목은 싣지 않았다. 원본 파일은 읽기만 했다.' % CREDIT]
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
    body = [_p('업무 인수인계서(%s)' % session.get('title', '전임자 확인 후 확정'), style='Title')]
    for l in header_lines(session):
        body.append(_p(l, size=10.5, color='555555'))
    for kind, text in chapters(session):
        if kind == 'h1': body.append(_p(text, style='Heading1'))
        elif kind == 'h2': body.append(_p(text, style='Heading2'))
        elif kind == 'h3': body.append(_p(text, bold=True))
        elif kind == 'p': body.append(_p(text))
        elif kind == 'li': body.append(_p('• ' + text, indent=360))
        elif kind == 'sub': body.append(_p(text, size=10, color='666666', indent=720))
    body.append(_p(CREDIT + ' · 항목마다 출처 파일과 원문 발췌를 붙였고, 원문에서 확인되지 않은 항목은 싣지 않았다. 원본 파일은 읽기만 했다.', size=9.5, color='888888'))
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
    return [md, docx]
