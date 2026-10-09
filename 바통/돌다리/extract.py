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
import os, sys, io, re, json, zlib, struct, hashlib, zipfile, csv, tempfile, email, email.policy
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


def extract_hwp(path):
    import olefile
    with open(path, 'rb') as fh:
        head = fh.read(32)
    if head.startswith(b'HWP Document File V'):
        raise ValueError('한글 %s 형식(옛 한글 2.x·3.x 문서). 한글에서 열어 .hwp(5.0) 또는 .hwpx로 다시 저장하면 읽습니다' % head[19:23].decode('ascii', 'ignore').strip())
    if not olefile.isOleFile(path):
        raise ValueError('한글 5.0 형식이 아님(다른 파일이거나 손상)')
    ole = olefile.OleFileIO(path)
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
        raise ValueError('글자가 없는 PDF(스캔 이미지로 보임, OCR 미지원)')
    return units


# ---------------------------------------------------------------- 엑셀
def extract_xlsx(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        units = _xlsx_units(wb)
    finally:
        wb.close()  # 윈도에서는 닫지 않으면 임시 폴더를 지울 수 없다
    return units


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


HANDLERS = {'.hwp': extract_hwp, '.hwpx': extract_hwpx, '.pdf': extract_pdf, '.xlsx': extract_xlsx, '.xlsm': extract_xlsx,
            '.docx': extract_docx, '.eml': extract_eml, '.txt': extract_text, '.md': extract_text, '.csv': extract_text}


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
    if not fn:
        failures.append({'file': rel, 'reason': '지원하지 않는 형식(%s)' % (ext or '확장자 없음')})
        return
    try:
        units = fn(path)
        if not units:
            failures.append({'file': rel, 'reason': '글자가 없음'})
            return
        results.append({'file': rel, 'kind': ext[1:], 'chars': sum(len(u['text']) for u in units), 'units': units})
    except Exception as e:
        failures.append({'file': rel, 'reason': str(e)[:160] or type(e).__name__})


def extract_folder(folder):
    results, failures, fps = [], [], []
    for root, dirs, files in os.walk(folder):
        dirs.sort()
        for name in sorted(files):
            p = os.path.join(root, name)
            rel = os.path.relpath(p, folder)
            before = sha256(p)
            extract_file(p, rel, results, failures)
            after = sha256(p)
            fps.append({'file': rel, 'bytes': os.path.getsize(p), 'sha256_before': before, 'sha256_after': after, 'unchanged': before == after})
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
