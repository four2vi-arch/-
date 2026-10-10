#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""돌다리 v1.0 · 내보내기(2026-10-10): 검토가 끝난 인수인계서를 .md와 .docx로 쓴다. 외부 패키지 없이 표준 라이브러리만 쓴다."""
import os, re, json, zipfile, datetime
from xml.sax.saxutils import escape

TYPES = ['월별 할 일', '협의할 사람', '진행 중 현안']
CREDIT = '돌다리 v1.0(업무바통) · 이희재(정읍우체국)'


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
            '읽은 파일 %d개 · 못 읽은 파일 %d개 · 원본 변경 %d개(처리 전후 SHA-256 대조)' % (len(files), len(failures), changed),
            '모델: %s · 규칙 항목 %d · 모델 항목 %d · 직접 적은 항목 %d' % (
                session.get('model', '없음'),
                sum(1 for it in kept_items(session) if it.get('src') == '규칙'),
                sum(1 for it in kept_items(session) if str(it.get('src', '')).startswith('모델')),
                sum(1 for it in kept_items(session) if it.get('src') == '직접 입력'))]


def to_markdown(session):
    out = ['# 업무 인수인계서(초안 · %s)' % session.get('title', '전임자 확인 후 확정'), '']
    out += ['- ' + l for l in header_lines(session)] + ['']
    items = kept_items(session)
    for kind in TYPES:
        out.append('## ' + kind)
        out.append('')
        rows = [it for it in items if it.get('type') == kind]
        if kind == '월별 할 일':
            rows.sort(key=lambda it: (month_key(it.get('when')), it.get('file', '')))
        if not rows:
            out.append('- (없음)')
        for it in rows:
            head = ('[%s] ' % it['when']) if it.get('when') else ''
            out.append('- %s%s' % (head, it.get('text', '')))
            if it.get('note'):
                out.append('  - 메모: %s' % it['note'])
            if it.get('file'):
                out.append('  - 출처: %s · 「%s」' % (it['file'], str(it.get('quote', '')).replace('\n', ' / ')))
                for al in it.get('also', [])[:5]:
                    out.append('  - 같은 내용: %s · 「%s」' % (al['file'], str(al.get('quote', '')).replace('\n', ' / ')[:80]))
            elif it.get('src') == '직접 입력':
                out.append('  - 출처: 전임자가 직접 적음')
        out.append('')
    failures = session.get('failures', [])
    if failures:
        out.append('## 못 읽은 파일(후임자가 직접 열어 볼 것)')
        out.append('')
        out += ['- %s: %s' % (x['file'], x['reason']) for x in failures]
        out.append('')
    out.append('---')
    out.append('%s · 항목마다 출처 파일과 원문 발췌를 붙였고, 원문에서 확인되지 않은 항목은 싣지 않았다. 원본 파일은 읽기만 했다.' % CREDIT)
    return '\n'.join(out) + '\n'


# ---------------------------------------------------------------- .docx(표준 라이브러리만)
def _p(text, style=None, size=None, color=None, bold=False, indent=0):
    rpr = ''
    if bold:
        rpr += '<w:b/>'
    if color:
        rpr += '<w:color w:val="%s"/>' % color
    if size:
        rpr += '<w:sz w:val="%d"/>' % (size * 2)
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
    body = [_p('업무 인수인계서(초안 · %s)' % session.get('title', '전임자 확인 후 확정'), style='Title')]
    for l in header_lines(session):
        body.append(_p(l, size=9, color='555555'))
    items = kept_items(session)
    for kind in TYPES:
        body.append(_p(kind, style='Heading1'))
        rows = [it for it in items if it.get('type') == kind]
        if kind == '월별 할 일':
            rows.sort(key=lambda it: (month_key(it.get('when')), it.get('file', '')))
        if not rows:
            body.append(_p('(없음)', indent=360))
        for it in rows:
            head = ('[%s] ' % it['when']) if it.get('when') else ''
            body.append(_p('• ' + head + it.get('text', ''), indent=360))
            if it.get('note'):
                body.append(_p('메모: ' + it['note'], size=9, indent=720))
            if it.get('file'):
                body.append(_p('출처: %s · 「%s」' % (it['file'], str(it.get('quote', '')).replace('\n', ' / ')), size=8, color='666666', indent=720))
                for al in it.get('also', [])[:5]:
                    body.append(_p('같은 내용: %s · 「%s」' % (al['file'], str(al.get('quote', '')).replace('\n', ' / ')[:80]), size=8, color='888888', indent=720))
            elif it.get('src') == '직접 입력':
                body.append(_p('출처: 전임자가 직접 적음', size=8, color='666666', indent=720))
    failures = session.get('failures', [])
    if failures:
        body.append(_p('못 읽은 파일(후임자가 직접 열어 볼 것)', style='Heading1'))
        for x in failures:
            body.append(_p('• %s: %s' % (x['file'], x['reason']), indent=360))
    body.append(_p(CREDIT + ' · 항목마다 출처 파일과 원문 발췌를 붙였고, 원문에서 확인되지 않은 항목은 싣지 않았다. 원본 파일은 읽기만 했다.', size=8, color='888888'))
    W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="%s"><w:body>%s<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
                '<w:pgMar w:top="1418" w:right="1134" w:bottom="1418" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>' % (W, ''.join(body)))
    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<w:styles xmlns:w="%s">'
              '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="맑은 고딕"/><w:sz w:val="21"/><w:lang w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault>'
              '<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
              '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
              '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="200"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>'
              '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="1F3864"/></w:rPr></w:style>'
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
