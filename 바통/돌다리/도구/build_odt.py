#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""공문 기안 초안을 ODT로 만든다.

전자문서시스템에 **제목과 본문을 복사해 붙여넣기 위한 초안**이다.
기관명·발신명의·결재선·시행번호는 시스템이 채우므로 넣지 않는다.
어느 관서, 어느 부서에서 쓰든 상관없도록 특정 관서 정보를 담지 않는다.

붙여넣기가 깨지지 않도록 지키는 것은 네 가지뿐이다.

    좌·우 여백 20mm · 돋움체 12pt · 줄간격 160% · 들여쓰기는 공백 문자

문단 왼쪽 여백과 들여쓰기 속성은 전부 0으로 둔다. 문단 속성으로 들여쓰면
붙여넣을 때 문단모양이 따라가지 않아 정렬이 무너진다.

사용법
    from build_odt import build

    build(
        out='/mnt/user-data/outputs/문서.odt',
        수신='전북지방우정청장(우편영업과장)',   # 생략 가능, 내부결재면 '내부결재'
        제목='2026년 하반기 우편매출 증대 추진계획 보고',
        본문=[
            '1. 관련',
            '  가. ○○과-1234(2026. 8. 1., 「○○」 계획 알림)',
            '',
            '2. 아래와 같이 보고합니다.',
            '',
            {'표': [['구 분', '수 량', '금 액'],
                    ['안전화', '23', '851']],
             '단위': '(단위: 켤레, 천원)'},
            '',
            '붙임  ○○○ 1부.  끝.',
        ],
    )
"""

import os
import re
import zipfile

FULL_PT, HALF_PT = 12.0, 6.0
LINE_W_MM = 170.0          # A4 210mm − 좌우 20mm
CHARS_PER_LINE = 40        # 170mm ÷ (12pt=4.233mm)

FULLWIDTH = set('※○●◎◇◆□■△▲▽▼☆★→←↑↓↔㎜㎝㎞㎏㏊℃￦「」『』〈〉《》【】·…‥')

MARKER = re.compile(
    r'^(\s*)('
    r'\d+\.|[가-힣]\.|\d+\)|[가-힣]\)|\(\d+\)|\([가-힣]\)|'
    r'[①-⑳㉮-㉻]|[ㅇ○●o]|[-–]|[※*]|붙\s*임|첨\s*부'
    r')(\s+)')


def _is_full(ch):
    if ch in FULLWIDTH:
        return True
    o = ord(ch)
    return (0x1100 <= o <= 0x11FF or 0x3000 <= o <= 0x303F or
            0x3130 <= o <= 0x318F or 0x3200 <= o <= 0x32FF or
            0x2460 <= o <= 0x24FF or 0x4E00 <= o <= 0x9FFF or
            0xAC00 <= o <= 0xD7A3 or 0xF900 <= o <= 0xFAFF or
            0xFF00 <= o <= 0xFF60)


def width_pt(s):
    return sum(FULL_PT if _is_full(c) else HALF_PT for c in s)


def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def to_spans(text):
    """공백을 <text:s>로. ODT는 연속 공백을 접으므로 그대로 두면 사라진다."""
    out, i = [], 0
    while i < len(text):
        if text[i] == ' ':
            j = i
            while j < len(text) and text[j] == ' ':
                j += 1
            n = j - i
            if i == 0 or n > 1:
                out.append('<text:s text:c="%d"/>' % n if n > 1 else '<text:s/>')
            else:
                out.append(' ')
            i = j
        else:
            j = i
            while j < len(text) and text[j] != ' ':
                j += 1
            out.append(esc(text[i:j]))
            i = j
    return ''.join(out)


# ---------------------------------------------------------------- styles.xml
STYLES = '''<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles
 xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
 xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
 office:version="1.2">
<office:font-face-decls>
<style:font-face style:name="돋움체" svg:font-family="돋움체"/>
</office:font-face-decls>
<office:styles>
<style:default-style style:family="paragraph">
<style:paragraph-properties fo:line-height="123%" fo:text-align="justify"
 fo:margin-left="0cm" fo:margin-right="0cm" fo:text-indent="0cm"
 fo:margin-top="0cm" fo:margin-bottom="0cm" style:text-autospace="none"/>
<style:text-properties style:font-name="돋움체"
 style:font-name-asian="돋움체"
 fo:font-size="12pt" style:font-size-asian="12pt"
 fo:language="ko" fo:country="KR" style:language-asian="ko" style:country-asian="KR"/>
</style:default-style>
<style:style style:name="Standard" style:family="paragraph"/>
</office:styles>
<office:automatic-styles>
<style:page-layout style:name="pm1">
<style:page-layout-properties fo:page-width="21.000cm" fo:page-height="29.700cm"
 style:print-orientation="portrait" fo:margin-left="2.000cm" fo:margin-right="2.000cm"
 fo:margin-top="2.000cm" fo:margin-bottom="1.500cm"/>
</style:page-layout>
</office:automatic-styles>
<office:master-styles>
<style:master-page style:name="Standard" style:page-layout-name="pm1"/>
</office:master-styles>
</office:document-styles>'''

CONTENT_HEAD = '''<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
 xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
 xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
 office:version="1.2">
<office:font-face-decls>
<style:font-face style:name="돋움체" svg:font-family="돋움체"/>
</office:font-face-decls>
<office:automatic-styles>
%s</office:automatic-styles>
<office:body><office:text>
%s</office:text></office:body></office:document-content>'''

MANIFEST = '''<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"
 manifest:version="1.2">
<manifest:file-entry manifest:full-path="/"
 manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
</manifest:manifest>'''


def _para_style(name, size=12.0, align='justify', hang_cm=0.0, lh='123%'):
    ind = ('fo:margin-left="%.3fcm" fo:text-indent="-%.3fcm" ' % (hang_cm, hang_cm)
           if hang_cm > 0.001 else 'fo:margin-left="0cm" fo:text-indent="0cm" ')
    return ('<style:style style:name="%s" style:family="paragraph" '
            'style:parent-style-name="Standard">'
            '<style:paragraph-properties fo:line-height="%s" fo:text-align="%s" '
            '%sfo:margin-right="0cm" fo:margin-top="0cm" fo:margin-bottom="0cm" '
            'style:text-autospace="none"/>'
            '<style:text-properties style:font-name="돋움체" style:font-name-asian="돋움체" '
            'fo:font-size="%gpt" style:font-size-asian="%gpt"/></style:style>'
            % (name, lh, align, ind, size, size))


class Doc:
    def __init__(self, 내어쓰기=False, 표글자=10.0):
        self.styles = []
        self.body = []
        self.seen = {}
        self.hang = 내어쓰기
        self.tbl_size = 표글자
        self.n_tbl = 0

    def _pstyle(self, size, align, hang_cm, lh='123%'):
        key = (round(size, 1), align, round(hang_cm, 3), lh)
        if key not in self.seen:
            name = 'KP%d' % len(self.seen)
            self.seen[key] = name
            self.styles.append(_para_style(name, size, align, hang_cm, lh))
        return self.seen[key]

    def para(self, line, size=12.0, align='justify'):
        if not line.strip():
            st = self._pstyle(size, align, 0.0)
            self.body.append('<text:p text:style-name="%s"/>' % st)
            return
        hang = 0.0
        if self.hang:
            m = MARKER.match(line)
            if m:
                hang = width_pt(m.group(1) + m.group(2) + m.group(3)) / 72.0 * 2.54
        st = self._pstyle(size, align, hang)
        self.body.append('<text:p text:style-name="%s">%s</text:p>'
                         % (st, to_spans(line)))

    def table(self, rows, 단위=None, 열너비=None, 머리행=True):
        """표를 넣는다. rows는 2차원 리스트, 첫 행은 머리행."""
        if not rows:
            return
        ncol = max(len(r) for r in rows)
        rows = [list(r) + [''] * (ncol - len(r)) for r in rows]
        self.n_tbl += 1
        tn = 'T%d' % self.n_tbl

        if 단위:
            self.para(단위, size=self.tbl_size, align='end')

        widths = 열너비 or [LINE_W_MM / ncol] * ncol
        total = sum(widths)
        widths = [w / total * LINE_W_MM for w in widths]

        self.styles.append(
            '<style:style style:name="%s" style:family="table">'
            '<style:table-properties style:width="%.3fcm" table:align="center"/>'
            '</style:style>' % (tn, LINE_W_MM / 10.0))
        for i, w in enumerate(widths):
            self.styles.append(
                '<style:style style:name="%s.%d" style:family="table-column">'
                '<style:table-column-properties style:column-width="%.3fcm"/>'
                '</style:style>' % (tn, i, w / 10.0))
        self.styles.append(
            '<style:style style:name="%s.C" style:family="table-cell">'
            '<style:table-cell-properties fo:border="0.5pt solid #000000" '
            'fo:padding="0.05cm" style:vertical-align="middle"/></style:style>' % tn)

        head_st = self._pstyle(self.tbl_size, 'center', 0.0, lh='130%')
        cell_st = self._pstyle(self.tbl_size, 'center', 0.0, lh='130%')

        out = ['<table:table table:name="%s" table:style-name="%s">' % (tn, tn)]
        for i in range(ncol):
            out.append('<table:table-column table:style-name="%s.%d"/>' % (tn, i))
        for ri, row in enumerate(rows):
            st = head_st if (머리행 and ri == 0) else cell_st
            out.append('<table:table-row>')
            for cell in row:
                txt = ('<text:p text:style-name="%s">%s</text:p>'
                       % (st, to_spans(str(cell))) if str(cell).strip()
                       else '<text:p text:style-name="%s"/>' % st)
                out.append('<table:table-cell table:style-name="%s.C" '
                           'office:value-type="string">%s</table:table-cell>' % (tn, txt))
            out.append('</table:table-row>')
        out.append('</table:table>')
        self.body.append(''.join(out))

    def save(self, out):
        os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
        content = CONTENT_HEAD % ('\n'.join(self.styles), '\n'.join(self.body))
        with zipfile.ZipFile(out, 'w') as z:
            z.writestr(zipfile.ZipInfo('mimetype'),
                       'application/vnd.oasis.opendocument.text',
                       compress_type=zipfile.ZIP_STORED)
            z.writestr('META-INF/manifest.xml', MANIFEST, zipfile.ZIP_DEFLATED)
            z.writestr('styles.xml', STYLES, zipfile.ZIP_DEFLATED)
            z.writestr('content.xml', content, zipfile.ZIP_DEFLATED)
        return out


def build(out, 본문, 제목=None, 수신=None, 내어쓰기=False, 표글자=10.0):
    """공문 초안 ODT를 만든다.

    본문은 문자열 리스트다. 빈 문자열이 빈 줄이 된다.
    들여쓰기는 앞 공백으로 준다.  1. → 0칸 / 가. → 1칸 / 1) → 2칸 / 그 아래 3칸

    표는 dict로 끼워 넣는다.
        {'표': [['머리1','머리2'], ['값1','값2']],
         '단위': '(단위: 천원)',      # 생략 가능
         '열너비': [40, 30, 30]}      # 생략 가능, 비율

    내어쓰기=True 를 주면 넘어간 줄을 내용 첫 글자에 맞춘다.
    문단 속성을 쓰므로 붙여넣을 때 따라가지 않을 수 있어 기본은 꺼 둔다.
    """
    d = Doc(내어쓰기=내어쓰기, 표글자=표글자)
    if 수신:
        d.para('수신  ' + 수신)
    if 제목:
        d.para('제목  ' + 제목)
    if 수신 or 제목:
        d.para('')
    for item in 본문:
        if isinstance(item, dict):
            d.table(item.get('표') or item.get('rows') or [],
                    단위=item.get('단위'), 열너비=item.get('열너비'),
                    머리행=item.get('머리행', True))
        else:
            d.para(item)
    return d.save(out)


if __name__ == '__main__':
    print(__doc__)
