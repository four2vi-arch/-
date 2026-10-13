#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""돌다리 v1.0 · 추출층(자체 추출기)

업무폴더 안의 파일에서 글자만 뽑아 JSON으로 남긴다. 원본은 읽기만 하고 고치거나 옮기지 않는다.
처리 전후 원본 SHA-256을 함께 적어 「원본 변경 0」을 결과로 증명한다.

형식: .hwp(한글 5.0) · .hwpx · .pdf · .xlsx · .docx · .eml · .txt/.md/.csv · .zip(안의 파일을 다시 처리)
못 읽는 파일은 건너뛰지 않고 사유와 함께 목록에 남긴다.

쓰임: python extract.py <입력 폴더> <결과 폴더>
      결과 폴더에 추출.json(파일별 글자·위치), 원본_지문.csv(처리 전후 SHA-256), 못읽은_파일.csv
의존: olefile(BSD), pypdf(BSD), openpyxl(MIT). 나머지는 파이썬 표준 라이브러리. 재배포 제한 없음.
"""
import os, datetime, sys, io, re, json, zlib, struct, hashlib, zipfile, csv, tempfile, email, email.policy
import warnings, logging
warnings.filterwarnings('ignore')                      # openpyxl·pypdf의 서식·글꼴 경고는 검은 창에 찍지 않는다(못 읽은 파일은 따로 집계)
for _n in ('pypdf', 'pypdf._reader', 'pypdf.generic', 'pypdf._cmap'):
    logging.getLogger(_n).setLevel(logging.ERROR)
from xml.etree import ElementTree as ET

HWP_NS = {'hp': 'http://www.hancom.co.kr/hwpml/2011/paragraph'}
W_NS = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


# ---------------------------------------------------------------- 한글 .hwp (5.0, 한컴 공개 규격)
# 파일 구조: OLE 복합 문서. FileHeader 스트림의 속성 비트 0=압축, 1=암호, 2=배포용.
# BodyText/Section{n} 스트림은 레코드 나열. 레코드 머리 4바이트: tag(10비트)·level(10비트)·size(12비트, 0xFFF이면 다음 4바이트가 크기)
# HWPTAG_PARA_TEXT(67)의 본문은 UTF-16LE. 제어문자 가운데 8글자(16바이트)를 차지하는 것은 건너뛴다.
HWPTAG_PARA_TEXT = 0x10 + 51
HWPTAG_TABLE = 0x10 + 61
_EXT8 = {1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23}


def _hwp_para_text(data):
    out = []
    i, n = 0, len(data) - 1
    while i < n:
        c = data[i] | (data[i + 1] << 8)
        if c in _EXT8:
            i += 16
            continue
        if c == 10 or c == 13:
            out.append('\n')
        elif c in (24, 25, 26, 27, 28, 29):
            pass
        elif c in (30, 31):
            out.append(' ')
        elif c < 32:
            pass
        else:
            out.append(chr(c))
        i += 2
    return ''.join(out)


# ---------------------------------------------------------------- 한글 97(2.x·3.x) 문서: 어림 읽기
# 글자는 2바이트 상용 조합형(KSSM: 1+초성5+중성5+종성5)과 ASCII 2바이트다. 문단 구조를 다 풀지 않고
# 글자 줄기만 긁어 모은다(줄기 사이의 서식 자료는 글자로 안 풀리므로 끊긴다). 기호·한자는 ?로 남는다.
_KS_CHO = [None, '', 'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
_KS_JUNG = {2: '', 3: 'ㅏ', 4: 'ㅐ', 5: 'ㅑ', 6: 'ㅒ', 7: 'ㅓ', 10: 'ㅔ', 11: 'ㅕ', 12: 'ㅖ', 13: 'ㅗ', 14: 'ㅘ', 15: 'ㅙ', 18: 'ㅚ', 19: 'ㅛ', 20: 'ㅜ', 21: 'ㅝ', 22: 'ㅞ', 23: 'ㅟ', 26: 'ㅠ', 27: 'ㅡ', 28: 'ㅢ', 29: 'ㅣ'}
_KS_JONG = [None, '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', None, 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
_L = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
_V = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'
_T = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']


def _kssm_char(w):
    """상용 조합형 2바이트 → 글자. 완성 음절, 홑자모(ㅇ·ㅁ 등), ASCII. 모르면 None."""
    if 0x20 <= w <= 0x7E:
        return chr(w)
    if not (w & 0x8000):
        return None
    c, j, g = (w >> 10) & 31, (w >> 5) & 31, w & 31
    if not (1 <= c <= 20) or j not in _KS_JUNG or g < 1 or g > 29 or _KS_JONG[g] is None:
        return None
    cho, jung, jong = _KS_CHO[c], _KS_JUNG[j], _KS_JONG[g]
    if cho and jung:
        return chr(0xAC00 + _L.index(cho) * 588 + _V.index(jung) * 28 + _T.index(jong))
    if cho and not jung and not jong:   # 홑자모 ㅇ, ㅁ …
        return cho
    if jung and not cho and not jong:
        return jung
    return None


def extract_hwp3(path, ver=''):
    with open(path, 'rb') as fh:
        b = fh.read()
    start = 30 + 128 + 1008   # 서명·문서 정보·요약 정보(작성자·날짜)는 건너뛴다
    units, run, n_unknown = [], [], 0
    i = start
    while i + 1 < len(b):
        w = b[i] | (b[i + 1] << 8)
        ch = _kssm_char(w)
        if ch is None:
            if w >= 0x8000 and run and (w & 0x3FF) not in (0, 0x3FF):   # 글자 줄기 안의 모르는 기호(한자·특수문자)
                run.append('?'); n_unknown += 1
            else:
                if len(run) >= 4 and len(set(run)) >= 3:
                    units.append({'loc': '문단 %d(옛 한글 어림)' % (len(units) + 1), 'text': ''.join(run).strip('? ')})
                run = []
        else:
            run.append(ch)
        i += 2
    if len(run) >= 4 and len(set(run)) >= 3:
        units.append({'loc': '문단 %d(옛 한글 어림)' % (len(units) + 1), 'text': ''.join(run).strip('? ')})
    units = [u for u in units if re.search(r'[가-힣]', u['text']) or re.search(r'\d', u['text'])]
    if not units:
        raise ValueError('한글 %s 형식(옛 한글 2.x·3.x 문서)에서 글자를 찾지 못함(압축 저장본일 수 있음). 한글에서 열어 .hwpx로 저장하면 읽습니다' % ver)
    return units


def extract_hwp(path):
    import olefile
    with open(path, 'rb') as fh:
        head = fh.read(32)
    if head.startswith(b'HWP Document File V'):
        return extract_hwp3(path, head[19:23].decode('ascii', 'ignore').strip())
    if not olefile.isOleFile(path):
        raise ValueError('한글 5.0 형식이 아님(다른 파일이거나 손상)')
    try:
        ole = olefile.OleFileIO(path)
    except Exception:
        raise ValueError('한글 5.0 형식이 아님(다른 파일이거나 손상)')
    try:
        if not ole.exists('FileHeader'):
            raise ValueError('FileHeader 없음(한글 문서가 아님)')
        hdr = ole.openstream('FileHeader').read()
        if not hdr.startswith(b'HWP Document File'):
            raise ValueError('한글 문서 서명 없음')
        flags = struct.unpack('<I', hdr[36:40])[0]
        compressed = bool(flags & 1)
        if flags & 2:
            raise ValueError('암호가 걸린 문서(읽기 제한)')
        if flags & 4:
            raise ValueError('배포용 문서(본문 암호화, 읽기 제한)')
        secs = sorted([e for e in ole.listdir() if len(e) == 2 and e[0] == 'BodyText' and e[1].startswith('Section')],
                      key=lambda e: int(re.sub(r'\D', '', e[1]) or 0))
        if not secs:
            raise ValueError('본문(BodyText) 없음')
        units = []
        for e in secs:
            raw = ole.openstream(e).read()
            if compressed:
                raw = zlib.decompress(raw, -15)
            sec = int(re.sub(r'\D', '', e[1]) or 0) + 1
            pos, pno, in_table = 0, 0, 0
            while pos + 4 <= len(raw):
                h = struct.unpack('<I', raw[pos:pos + 4])[0]
                tag, level, size = h & 0x3FF, (h >> 10) & 0x3FF, (h >> 20) & 0xFFF
                pos += 4
                if size == 0xFFF:
                    size = struct.unpack('<I', raw[pos:pos + 4])[0]
                    pos += 4
                body = raw[pos:pos + size]
                pos += size
                if tag == HWPTAG_TABLE:
                    in_table = level
                if tag == HWPTAG_PARA_TEXT:
                    t = _hwp_para_text(body).strip()
                    pno += 1
                    if t:
                        units.append({'loc': '구역 %d 문단 %d%s' % (sec, pno, ' (표 안)' if in_table and level > in_table else ''), 'text': t})
        return units
    finally:
        ole.close()


# ---------------------------------------------------------------- 한글 .hwpx (압축 안 XML)
def extract_hwpx(path):
    units = []
    with zipfile.ZipFile(path) as z:
        names = sorted([n for n in z.namelist() if re.match(r'Contents/section\d+\.xml$', n)],
                       key=lambda n: int(re.sub(r'\D', '', n)))
        if not names:
            raise ValueError('본문(Contents/section*.xml) 없음')
        for n in names:
            sec = int(re.sub(r'\D', '', n)) + 1
            root = ET.fromstring(z.read(n))
            pno = 0
            for p in root.iter('{%s}p' % HWP_NS['hp']):
                t = ''.join(x.text or '' for x in p.iter('{%s}t' % HWP_NS['hp'])).strip()
                pno += 1
                if t:
                    units.append({'loc': '구역 %d 문단 %d' % (sec, pno), 'text': t})
    return units


# ---------------------------------------------------------------- PDF
def extract_pdf(path):
    from pypdf import PdfReader
    r = PdfReader(path)
    if r.is_encrypted:
        try:
            ok = r.decrypt('')
        except Exception:
            ok = 0
        if not ok:
            raise ValueError('암호가 걸린 PDF(읽기 제한)')
    units = []
    for i, pg in enumerate(r.pages, 1):
        t = (pg.extract_text() or '').strip()
        if t:
            units.append({'loc': '%d쪽' % i, 'text': t})
    if not units:
        if OCR_CONFIG.get('engine'):   # 스캔 PDF: OCR 엔진이 잡혀 있으면 글자를 읽는다(앞 N쪽, 결과는 캐시)
            import ocr
            try:
                units = ocr.ocr_pdf(path, OCR_CONFIG['engine'], OCR_CONFIG.get('cache') or None, int(OCR_CONFIG.get('dpi') or 200), int(OCR_CONFIG.get('pages') or 5))
            except Exception as ex:
                raise ValueError('스캔 PDF OCR 실패(%s): %s' % (OCR_CONFIG['engine'], str(ex)[:100]))
            if not units:
                raise ValueError('스캔 PDF에서 글자를 읽지 못함(OCR %s, 앞 %d쪽)' % (OCR_CONFIG['engine'], int(OCR_CONFIG.get('pages') or 5)))
            return units
        raise ValueError('글자가 없는 PDF(스캔 이미지로 보임). 준비 화면에서 OCR을 켜면 읽습니다')
    return units


OCR_CONFIG = {'engine': '', 'cache': '', 'pages': 5, 'dpi': 200, 'images': False}   # server.py가 읽기 전에 채운다. engine이 비면 OCR 안 함
IMAGE_EXT = {'.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp'}


def extract_image(path):
    if not (OCR_CONFIG.get('engine') and OCR_CONFIG.get('images')):
        raise ValueError('읽지 않는 형식(그림). 준비 화면에서 「그림 파일도 OCR」을 켜면 읽습니다')
    import ocr
    try:
        return ocr.ocr_image_file(path, OCR_CONFIG['engine'], OCR_CONFIG.get('cache') or None)
    except Exception as ex:
        raise ValueError('그림 OCR 실패(%s): %s' % (OCR_CONFIG['engine'], str(ex)[:100]))


# ---------------------------------------------------------------- 엑셀
def extract_xlsx(path):
    with open(path, 'rb') as fh:
        head = fh.read(8)
    if head.startswith(b'\xd0\xcf\x11\xe0'):
        raise ValueError('옛 엑셀(.xls, 97-2003) 형식입니다. 엑셀에서 열어 .xlsx로 다시 저장하면 읽습니다')
    if head.startswith(b'<') or head.lower().startswith(b'<!doc'):
        raise ValueError('이름만 .xlsx인 웹(HTML) 파일입니다. 엑셀에서 열어 .xlsx로 다시 저장하면 읽습니다')
    try:
        import openpyxl
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        try:
            units = _xlsx_units(wb)
        finally:
            wb.close()  # 윈도에서는 닫지 않으면 임시 폴더를 지울 수 없다
        return units
    except Exception as e:   # 실제 폴더에서 60개: 「list index out of range」「Value must be a sequence」「_NamedCellStyle」— openpyxl이 한컴·옛 엑셀이 만든 서식을 못 읽음. 글자만 XML에서 직접 읽는다
        try:
            return _xlsx_raw(path)
        except Exception:
            raise e


def _xlsx_raw(path, max_rows=5000):
    """openpyxl 없이 xlsx(zip+XML)에서 셀 글자만 읽는다. 서식·수식은 보지 않는다(값만)."""
    ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    rns = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        shared = []
        if 'xl/sharedStrings.xml' in names:
            for si in ET.fromstring(z.read('xl/sharedStrings.xml')).iter(ns + 'si'):
                shared.append(''.join(t.text or '' for t in si.iter(ns + 't')))
        sheets = []
        if 'xl/workbook.xml' in names:
            rels = {}
            if 'xl/_rels/workbook.xml.rels' in names:
                for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels')):
                    rels[r.get('Id')] = r.get('Target')
            for sh in ET.fromstring(z.read('xl/workbook.xml')).iter(ns + 'sheet'):
                tgt = rels.get(sh.get(rns + 'id'), '')
                tgt = tgt if tgt.startswith('/') else 'xl/' + tgt
                sheets.append((sh.get('name') or '시트', tgt.lstrip('/')))
        if not sheets:
            sheets = [(n.split('/')[-1], n) for n in sorted(names) if n.startswith('xl/worksheets/sheet') and n.endswith('.xml')]
        units = []
        for title, target in sheets:
            if target not in names:
                continue
            lines, r = [], 0
            for row in ET.fromstring(z.read(target)).iter(ns + 'row'):
                r += 1
                if r > max_rows:
                    lines.append('(%d행 이후 생략)' % max_rows); break
                vals = []
                for c in row.iter(ns + 'c'):
                    v = c.find(ns + 'v'); t = c.get('t')
                    if t == 's' and v is not None and v.text and v.text.isdigit() and int(v.text) < len(shared):
                        vals.append(shared[int(v.text)])
                    elif t == 'inlineStr':
                        vals.append(''.join(x.text or '' for x in c.iter(ns + 't')))
                    elif v is not None and v.text:
                        vals.append(v.text)
                    else:
                        vals.append('')
                if any(x.strip() for x in vals):
                    lines.append('%s행: ' % (row.get('r') or r) + '\t'.join(x.strip() for x in vals).rstrip('\t'))
            if lines:
                units.append({'loc': '시트 「%s」' % title, 'text': '\n'.join(lines)})
    return units


# ---------------------------------------------------------------- 파워포인트·웹 문서
def extract_pptx(path):
    ans = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
    units = []
    with zipfile.ZipFile(path) as z:
        slides = sorted((n for n in z.namelist() if re.match(r'ppt/slides/slide\d+\.xml$', n)), key=lambda n: int(re.search(r'(\d+)', n.split('/')[-1]).group(1)))
        if not slides:
            raise ValueError('파워포인트 슬라이드(ppt/slides) 없음')
        for i, n in enumerate(slides, 1):
            paras = []
            for p in ET.fromstring(z.read(n)).iter(ans + 'p'):
                t = ''.join(x.text or '' for x in p.iter(ans + 't')).strip()
                if t:
                    paras.append(t)
            if paras:
                units.append({'loc': '슬라이드 %d' % i, 'text': '\n'.join(paras)})
    return units


def extract_html(path):
    import html as _html
    raw = open(path, 'rb').read()
    t = None
    for enc in ('utf-8-sig', 'utf-8', 'cp949', 'euc-kr'):
        try:
            t = raw.decode(enc); break
        except UnicodeDecodeError:
            pass
    if t is None:
        raise ValueError('글자 인코딩을 알 수 없음')
    t = re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', t)
    t = re.sub(r'(?i)<br\s*/?>|</(p|div|tr|li|h\d)>', '\n', t)
    t = _html.unescape(re.sub(r'<[^>]+>', ' ', t))
    lines = [re.sub(r'[ \t]+', ' ', l).strip() for l in t.split('\n')]
    lines = [l for l in lines if l]
    return [{'loc': '본문', 'text': '\n'.join(lines)}] if lines else []


def _xlsx_units(wb):
    units = []
    for ws in wb.worksheets:
        lines = []
        for r, row in enumerate(ws.iter_rows(values_only=True), 1):
            vals = ['' if v is None else str(v).strip() for v in row]
            if any(vals):
                lines.append('%d행: ' % r + '\t'.join(vals).rstrip('\t'))
            if r > 5000:
                lines.append('(5,000행 이후 생략)')
                break
        if lines:
            units.append({'loc': '시트 「%s」' % ws.title, 'text': '\n'.join(lines)})
    return units


# ---------------------------------------------------------------- 워드
def extract_docx(path):
    units = []
    with zipfile.ZipFile(path) as z:
        if 'word/document.xml' not in z.namelist():
            raise ValueError('워드 본문(word/document.xml) 없음')
        root = ET.fromstring(z.read('word/document.xml'))
    body = root.find(W_NS + 'body')
    pno = 0
    for el in body.iter():
        if el.tag == W_NS + 'p':
            t = ''.join(x.text or '' for x in el.iter(W_NS + 't')).strip()
            pno += 1
            if t:
                units.append({'loc': '문단 %d' % pno, 'text': t})
    return units


# ---------------------------------------------------------------- 메일
def extract_eml(path):
    with open(path, 'rb') as f:
        msg = email.message_from_binary_file(f, policy=email.policy.default)
    if not (msg['From'] or msg['Subject'] or msg['Date']):
        raise ValueError('메일 형식이 아님(보낸 사람·제목·날짜가 없음)')
    head = ['보낸 사람: %s' % (msg['From'] or ''), '받는 사람: %s' % (msg['To'] or ''), '날짜: %s' % (msg['Date'] or ''), '제목: %s' % (msg['Subject'] or '')]
    body = ''
    part = msg.get_body(preferencelist=('plain', 'html'))
    if part is not None:
        body = part.get_content()
        if part.get_content_type() == 'text/html':
            body = re.sub(r'<[^>]+>', ' ', body)
    atts = [p.get_filename() for p in msg.iter_attachments() if p.get_filename()]
    units = [{'loc': '머리글', 'text': '\n'.join(head)}]
    if body.strip():
        units.append({'loc': '본문', 'text': body.strip()})
    if atts:
        units.append({'loc': '첨부', 'text': '첨부 파일: ' + ', '.join(atts)})
    return units


# ---------------------------------------------------------------- 글자 파일
def extract_text(path):
    raw = open(path, 'rb').read()
    for enc in ('utf-8-sig', 'utf-8', 'cp949', 'utf-16'):
        try:
            t = raw.decode(enc)
            break
        except UnicodeDecodeError:
            t = None
    if t is None:
        raise ValueError('글자 인코딩을 알 수 없음')
    return [{'loc': '전체', 'text': t.strip()}]


def _odf_text(el):
    """ODF 요소 안의 글자(공백·탭·줄바꿈 요소 포함)를 이어 붙인다."""
    T = '{urn:oasis:names:tc:opendocument:xmlns:text:1.0}'
    out = []
    if el.text:
        out.append(el.text)
    for ch in el:
        tag = ch.tag
        if tag == T + 's':
            out.append(' ' * int(ch.get(T + 'c', '1')))
        elif tag == T + 'tab':
            out.append('\t')
        elif tag == T + 'line-break':
            out.append('\n')
        elif tag in (T + 'note', T + 'tracked-changes', T + 'soft-page-break'):
            pass
        else:
            out.append(_odf_text(ch))
        if ch.tail:
            out.append(ch.tail)
    return ''.join(out)


def extract_odt(path):
    """ODT(오픈도큐먼트 글, 우정사업본부 전자문서 공문)·ODS(표). 문단·제목·표 셀을 읽는다."""
    T = '{urn:oasis:names:tc:opendocument:xmlns:text:1.0}'
    TB = '{urn:oasis:names:tc:opendocument:xmlns:table:1.0}'
    with zipfile.ZipFile(path) as z:
        if 'content.xml' not in z.namelist():
            raise ValueError('오픈도큐먼트 형식이 아님(content.xml 없음)')
        root = ET.fromstring(z.read('content.xml'))
    units = []
    body = root.find('{urn:oasis:names:tc:opendocument:xmlns:office:1.0}body')
    if body is None:
        return units
    n = 0

    def walk(node, in_table):
        nonlocal n
        for ch in list(node):
            if ch.tag == TB + 'table':
                for ri, row in enumerate(ch.iter(TB + 'table-row')):
                    cells = []
                    for cell in row:
                        if cell.tag in (TB + 'table-cell', TB + 'covered-table-cell'):
                            cells.append(' '.join(_odf_text(p).strip() for p in cell.iter() if p.tag in (T + 'p', T + 'h')).strip())
                    line = '\t'.join(c for c in cells if c)
                    if line.strip():
                        n += 1
                        units.append({'loc': '표 %d행' % (ri + 1), 'text': line})
            elif ch.tag in (T + 'p', T + 'h'):
                t = _odf_text(ch).strip()
                if t:
                    n += 1
                    units.append({'loc': '문단 %d' % n, 'text': t})
            else:
                walk(ch, in_table)
    walk(body, False)
    return units


def _old_office(kind):
    def fn(path):
        raise ValueError('옛 %s 형식입니다. 해당 프로그램에서 열어 새 형식(.docx/.xlsx/.pptx)으로 다시 저장하면 읽습니다' % kind)
    return fn


HANDLERS = {'.hwp': extract_hwp, '.hwpx': extract_hwpx, '.pdf': extract_pdf, '.xlsx': extract_xlsx, '.xlsm': extract_xlsx,
            '.doc': _old_office('워드(97-2003, .doc)'), '.xls': _old_office('엑셀(97-2003, .xls)'), '.ppt': _old_office('파워포인트(97-2003, .ppt)'),
            '.docx': extract_docx, '.eml': extract_eml, '.txt': extract_text, '.md': extract_text, '.csv': extract_text,
            '.odt': extract_odt, '.ods': extract_odt, '.pptx': extract_pptx, '.html': extract_html, '.htm': extract_html}
HANCOM_HINT = {'.cell': '한셀(.cell) 문서는 읽지 못합니다. 한셀에서 「다른 이름으로 저장 → Excel(.xlsx)」 하면 읽습니다',
               '.show': '한쇼(.show) 문서는 읽지 못합니다. 한쇼에서 PowerPoint(.pptx)로 저장하면 읽습니다',
               '.rtf': '서식 있는 텍스트(.rtf)는 읽지 못합니다. 워드·한글에서 .docx로 저장하면 읽습니다'}
# 읽지 않는 형식: 문서가 아니라 그림·영상·프로그램·글꼴·임시 파일. 「못 읽음」이 아니라 「읽지 않음」으로 따로 센다(인수인계서에 「직접 열어 볼 것」으로는 적지 않음)
NON_DOC = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.webp', '.heic', '.svg', '.ico', '.psd', '.ai',
           '.mp4', '.mp3', '.wav', '.avi', '.mov', '.wmv', '.m4a',
           '.exe', '.dll', '.msi', '.bat', '.cmd', '.lnk', '.url', '.ini', '.db', '.dat', '.pia', '.fnt', '.ttf', '.otf', '.woff',
           '.tmp', '.bak', '.backup', '.log', '.json', '.xml', '.js', '.css', '.py', '.pyc', '.iso', '.7z', '.rar', '.egg', '.alz'}
MAX_BYTES = 200 * 1024 * 1024


def clean_text(s):
    """PDF(UniKS-UTF16 대체 디코딩)·깨진 파일에서 나온 서러게이트 문자를 정리한다. 짝이 맞는 것은 합치고, 홀로 남은 것은 �로. 그대로 두면 JSON 저장(utf-8)에서 죽는다."""
    if not s or not isinstance(s, str):
        return s or ''
    try:
        s.encode('utf-8')
        return s
    except UnicodeEncodeError:
        return s.encode('utf-16', 'surrogatepass').decode('utf-16', 'replace')


def extract_file(path, rel, results, failures, depth=0):
    ext = os.path.splitext(path)[1].lower()
    if ext == '.zip':
        if depth >= 2:
            failures.append({'file': rel, 'reason': '압축이 3겹 이상이라 풀지 않음'})
            return
        try:
            with zipfile.ZipFile(path) as z, tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td:
                for info in z.infolist():
                    if info.is_dir():
                        continue
                    name = info.filename
                    try:
                        name = name.encode('cp437').decode('cp949') if not (info.flag_bits & 0x800) else name
                    except Exception:
                        pass
                    out = os.path.join(td, os.path.basename(name))
                    with open(out, 'wb') as f:
                        f.write(z.read(info))
                    extract_file(out, rel + ' ▸ ' + name, results, failures, depth + 1)
        except zipfile.BadZipFile:
            failures.append({'file': rel, 'reason': '손상된 압축 파일'})
        except RuntimeError as e:
            failures.append({'file': rel, 'reason': '암호가 걸린 압축 파일' if 'password' in str(e).lower() else str(e)})
        return
    fn = HANDLERS.get(ext)
    base = os.path.basename(path)
    if base.startswith('~$') or base.lower() in ('thumbs.db', 'desktop.ini'):
        failures.append({'file': rel, 'reason': '임시·시스템 파일', 'skip': True}); return
    if ext in HANCOM_HINT:
        failures.append({'file': rel, 'reason': HANCOM_HINT[ext]}); return
    if not fn and ext in IMAGE_EXT and OCR_CONFIG.get('engine') and OCR_CONFIG.get('images'):
        fn = extract_image
    if not fn:
        if ext in NON_DOC:
            failures.append({'file': rel, 'reason': '읽지 않는 형식(%s: 그림·영상·프로그램·글꼴·임시 파일)' % ext, 'skip': True})
        else:
            failures.append({'file': rel, 'reason': '지원하지 않는 형식(%s)' % (ext or '확장자 없음')})
        return
    try:
        if os.path.getsize(path) > MAX_BYTES:
            failures.append({'file': rel, 'reason': '너무 커서 건너뜀(200MB 넘음) — 직접 열어 볼 것'}); return
    except OSError:
        pass
    try:
        units = fn(path)
        if not units:
            failures.append({'file': rel, 'reason': '글자가 없음'})
            return
        for u in units:
            u['text'] = clean_text(u.get('text', '')); u['loc'] = clean_text(str(u.get('loc', '')))
        try:
            mtime = datetime.date.fromtimestamp(os.path.getmtime(path)).isoformat()
        except Exception:
            mtime = ''
        results.append({'file': clean_text(rel), 'kind': ext[1:], 'chars': sum(len(u['text']) for u in units), 'mtime': mtime,
                        'mchars': sum(len(u['loc']) + len(u['text']) + 3 for u in units) + max(0, len(units) - 1), 'units': units})
    except ValueError as e:
        failures.append({'file': clean_text(rel), 'reason': clean_text(str(e)[:160])})
    except Exception as e:
        failures.append({'file': clean_text(rel), 'reason': '%s(파일 손상 가능: %s)' % ({'.hwp': '한글 5.0 구조를 읽지 못함', '.hwpx': 'hwpx 구조를 읽지 못함', '.pdf': 'PDF 구조를 읽지 못함', '.xlsx': '엑셀 구조를 읽지 못함', '.docx': '워드 구조를 읽지 못함', '.odt': 'ODT 구조를 읽지 못함'}.get(ext, '읽지 못함'), (str(e)[:80] or type(e).__name__))})


def extract_folder(folder, skip_dirs=None, skip_names=None, skip_root_files=False, progress=None):
    """skip_dirs: 건너뛸 폴더 이름(어느 깊이든 같은 이름). skip_names: 건너뛸 파일 이름 정규식. 숨김 폴더(.으로 시작)는 늘 건너뛴다.
    progress(dict): 파일마다 {'index','total','file'}로 불린다(화면 진행 표시용)."""
    results, failures, fps = [], [], []
    skip = set(skip_dirs or ())
    total = 0
    if progress:
        for root, dirs, files in os.walk(folder):
            dirs[:] = [d for d in dirs if d not in skip and not d.startswith('.')]
            total += len(files)
    done = 0
    walk_root = folder
    if os.name == 'nt' and not str(folder).startswith('\\\\?\\'):
        walk_root = '\\\\?\\' + os.path.abspath(folder)   # 260자 넘는 경로도 열리게(윈도 긴 경로 접두)
    for root, dirs, files in os.walk(walk_root):
        dirs[:] = sorted(d for d in dirs if d not in skip and not d.startswith('.'))
        if skip_root_files and os.path.normcase(os.path.abspath(root)) == os.path.normcase(os.path.abspath(walk_root)):
            continue   # 프로그램 폴더를 골랐을 때: 최상위의 README·설정 파일은 업무 문서가 아니다
        for name in sorted(files):
            if skip_names and re.search(skip_names, name):
                continue
            p = os.path.join(root, name)
            rel = os.path.relpath(p, walk_root)
            done += 1
            if progress and (done % 5 == 0 or done == total):
                progress({'index': done, 'total': total, 'file': clean_text(rel)})
            try:
                before = sha256(p)
                extract_file(p, rel, results, failures)
                after = sha256(p)
                fps.append({'file': clean_text(rel), 'bytes': os.path.getsize(p), 'sha256_before': before, 'sha256_after': after, 'unchanged': before == after})
            except Exception as e:   # 권한 없음·너무 긴 경로·읽는 중 삭제 등: 그 파일만 못 읽음으로
                failures.append({'file': clean_text(rel), 'reason': '열지 못함(%s)' % clean_text(str(e)[:100] or type(e).__name__)})
    return results, failures, fps


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    src, dst = sys.argv[1], sys.argv[2]
    os.makedirs(dst, exist_ok=True)
    results, failures, fps = extract_folder(src)
    with open(os.path.join(dst, '추출.json'), 'w', encoding='utf-8') as f:
        json.dump({'folder': os.path.abspath(src), 'files': results, 'failures': failures}, f, ensure_ascii=False, indent=1)
    with open(os.path.join(dst, '원본_지문.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['파일', '크기(바이트)', '처리 전 SHA-256', '처리 후 SHA-256', '변경 없음'])
        for x in fps:
            w.writerow([x['file'], x['bytes'], x['sha256_before'], x['sha256_after'], '예' if x['unchanged'] else '아니요'])
    with open(os.path.join(dst, '못읽은_파일.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['파일', '사유'])
        for x in failures:
            w.writerow([x['file'], x['reason']])
    total = len(fps)
    print('파일 %d개 · 추출 %d개 · 못 읽음 %d개 · 원본 변경 %d개' % (total, len(results), len(failures), sum(1 for x in fps if not x['unchanged'])))
    for x in failures:
        print('  못 읽음:', x['file'], '·', x['reason'])


if __name__ == '__main__':
    main()
