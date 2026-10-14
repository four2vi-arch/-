#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""돌다리 · 스캔 문서 글자 읽기(OCR, 2026-10-14).

글자가 없는 PDF(스캔)와 그림 파일을 글자로 바꾼다. 외부 서비스 없이 이 PC 안에서만 돈다. 엔진은 세 가지 가운데 있는 것을 쓴다.
  1) windows  — 윈도 10·11에 든 OCR(Windows.Media.Ocr). 설치할 모델이 없고 한국어 언어 팩이 있으면 바로 된다. pip: winocr (또는 winrt-Windows.Media.Ocr 묶음)
  2) rapidocr — onnxruntime 기반(RapidOCR). pip: rapidocr-onnxruntime. 한국어는 인식 모델(korean_PP-OCRv3_rec_infer.onnx)을 도구/ocr_models/에 두어야 한다.
  3) tesseract — tesseract.exe + kor 언어 자료가 설치돼 있을 때(pytesseract 없이 바로 부른다).
PDF 쪽 그림화는 pypdfium2(pip, 외부 프로그램 없음). 전처리: 회색조 → 대비 보정 → 작은 글자면 확대 → 기울기 보정(±3°) → 이진화.
결과는 파일 지문·엔진·설정으로 캐시(작업/ocr_cache/*.json)해 두 번째부터는 바로 쓴다.
"""
import os, re, io, json, hashlib, shutil, subprocess, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(HERE, '도구', 'ocr_models')
DEFAULT_DPI = 200
MAX_PAGES = 5
_rapid = None


# ---------------------------------------------------------------- 엔진 찾기
def _try_import(name):
    try:
        return __import__(name)
    except Exception:
        return None


def available():
    """엔진별 상태. {'windows': {'ok': bool, 'why': str}, 'rapidocr': {...}, 'tesseract': {...}, 'pdf': {...}}"""
    st = {}
    pdfium = _try_import('pypdfium2')
    st['pdf'] = {'ok': pdfium is not None, 'why': '' if pdfium else 'pypdfium2가 없습니다(pip install pypdfium2). PDF 쪽을 그림으로 바꾸는 데 필요합니다.'}
    if os.name == 'nt':
        win = _try_import('winocr')
        if win is not None:
            st['windows'] = {'ok': True, 'why': 'winocr'}
        else:
            try:
                from winrt.windows.media.ocr import OcrEngine  # noqa
                st['windows'] = {'ok': True, 'why': 'winrt'}
            except Exception:
                st['windows'] = {'ok': False, 'why': 'pip install winocr 로 설치하면 윈도 내장 OCR을 씁니다(모델 내려받기 없음). 한국어 언어 팩이 있어야 합니다.'}
        if st['windows']['ok']:
            langs = windows_languages()
            if langs is not None and not any(l.lower().startswith('ko') for l in langs):
                st['windows'] = {'ok': False, 'why': '윈도 OCR에 한국어가 없습니다(설정 → 시간 및 언어 → 언어 → 한국어 → 언어 기능 「광학 문자 인식」). 지금 있는 언어: %s' % ', '.join(langs)}
    else:
        st['windows'] = {'ok': False, 'why': '윈도에서만'}
    rapid = _try_import('rapidocr_onnxruntime')
    if rapid is None:
        st['rapidocr'] = {'ok': False, 'why': 'pip install rapidocr-onnxruntime 로 설치합니다.'}
    else:
        kor = korean_rec_model()
        st['rapidocr'] = {'ok': True, 'why': ('한국어 모델 ' + os.path.basename(kor)) if kor else '한국어 인식 모델이 없어 영문·숫자만 읽습니다. korean_PP-OCRv3_rec_infer.onnx를 도구/ocr_models/에 두세요.'}
        st['rapidocr']['korean'] = bool(kor)
    tes = shutil.which('tesseract')
    if not tes:
        st['tesseract'] = {'ok': False, 'why': 'tesseract가 설치돼 있지 않습니다.'}
    else:
        try:
            out = subprocess.run([tes, '--list-langs'], capture_output=True, text=True, timeout=20).stdout
            st['tesseract'] = {'ok': 'kor' in out, 'why': '' if 'kor' in out else 'tesseract에 한국어(kor) 자료가 없습니다.'}
        except Exception as e:
            st['tesseract'] = {'ok': False, 'why': str(e)[:80]}
    return st


def pick(engine='auto'):
    """쓸 엔진 이름. auto면 windows → tesseract → rapidocr(한국어 모델 있을 때) 순. 없으면 ''."""
    st = available()
    if engine and engine != 'auto':
        return engine if st.get(engine, {}).get('ok') else ''
    for name in ('windows', 'tesseract', 'rapidocr'):
        if st.get(name, {}).get('ok') and (name != 'rapidocr' or st[name].get('korean')):
            return name
    if st.get('rapidocr', {}).get('ok'):
        return 'rapidocr'
    return ''


def korean_rec_model():
    if os.path.isdir(MODEL_DIR):
        for n in sorted(os.listdir(MODEL_DIR)):
            if re.search(r'korean.*rec.*\.onnx$', n, re.I):
                return os.path.join(MODEL_DIR, n)
    return ''


def windows_languages():
    try:
        from winrt.windows.media.ocr import OcrEngine
        return [l.language_tag for l in OcrEngine.available_recognizer_languages]
    except Exception:
        return None


# ---------------------------------------------------------------- 그림 만들기·전처리
def pdf_to_images(path, dpi=DEFAULT_DPI, max_pages=MAX_PAGES):
    """PDF 쪽을 PIL 그림으로. (쪽 번호, 그림) 목록. 앞 max_pages쪽까지."""
    import pypdfium2 as pdfium
    out = []
    pdf = pdfium.PdfDocument(path)
    try:
        n = min(len(pdf), max_pages)
        for i in range(n):
            page = pdf[i]
            img = page.render(scale=dpi / 72.0).to_pil()
            out.append((i + 1, img))
            page.close()
    finally:
        pdf.close()
    return out


def preprocess(img, upscale_min=1600, deskew=True):
    """회색조 → 대비 보정 → 작은 그림 확대 → 기울기 보정 → 이진화. PIL 그림을 돌려준다(엔진이 회색조를 받는다)."""
    from PIL import Image, ImageOps
    g = ImageOps.grayscale(img)
    g = ImageOps.autocontrast(g, cutoff=1)
    w, h = g.size
    if max(w, h) < upscale_min:
        k = upscale_min / max(w, h)
        g = g.resize((int(w * k), int(h * k)), Image.LANCZOS)
    if deskew:
        try:
            ang = skew_angle(g)
            if abs(ang) >= 0.3:
                g = g.rotate(ang, resample=Image.BICUBIC, expand=False, fillcolor=255)
        except Exception:
            pass
    th = otsu(g)
    return g.point(lambda v: 255 if v > th else 0)


def otsu(g):
    hist = g.histogram()
    total = sum(hist); sum_all = sum(i * h for i, h in enumerate(hist))
    best, best_t, wb, sb = 0.0, 128, 0, 0.0
    for t in range(256):
        wb += hist[t]
        if wb == 0:
            continue
        wf = total - wb
        if wf == 0:
            break
        sb += t * hist[t]
        mb, mf = sb / wb, (sum_all - sb) / wf
        v = wb * wf * (mb - mf) ** 2
        if v > best:
            best, best_t = v, t
    return best_t


def skew_angle(g, limit=3.0, step=0.25):
    """가로줄 투영의 분산이 가장 큰 각도(글줄이 수평일 때 분산 최대). 작은 각만 본다(스캔은 보통 ±2° 안)."""
    import numpy as np
    from PIL import Image
    small = g.resize((max(200, g.size[0] // 4), max(200, g.size[1] // 4)))
    arr = 255 - np.asarray(small, dtype=np.float32)
    best, best_a = -1.0, 0.0
    a = -limit
    while a <= limit + 1e-9:
        rot = small.rotate(a, resample=Image.BILINEAR, expand=False, fillcolor=255)
        prof = (255 - np.asarray(rot, dtype=np.float32)).sum(axis=1)
        v = float(prof.var())
        if v > best:
            best, best_a = v, a
        a += step
    return best_a if arr.size else 0.0


# ---------------------------------------------------------------- 엔진별 읽기: (text, x, y, w, h) 줄 목록을 돌려준다
def _png_bytes(img):
    b = io.BytesIO(); img.convert('L').save(b, format='PNG'); return b.getvalue()


def _fit_windows(img):
    """윈도 OCR은 한 변이 MaxImageDimension(보통 2600)을 넘으면 거부한다 → 미리 줄인다."""
    try:
        from winrt.windows.media.ocr import OcrEngine
        mx = int(OcrEngine.max_image_dimension)
    except Exception:
        mx = 2600
    w, h = img.size
    if max(w, h) > mx:
        k = (mx - 1) / max(w, h); img = img.resize((max(1, int(w * k)), max(1, int(h * k))))
    return img


def ocr_windows(img, lang='ko'):
    img = _fit_windows(img)
    try:
        import winocr
        res = winocr.recognize_pil_sync(img.convert('RGB'), lang)
        lines = []
        for ln in res.get('lines', []):
            words = ln.get('words', [])
            if words:
                x = min(w['bounding_rect']['x'] for w in words); y = min(w['bounding_rect']['y'] for w in words)
                x2 = max(w['bounding_rect']['x'] + w['bounding_rect']['width'] for w in words); y2 = max(w['bounding_rect']['y'] + w['bounding_rect']['height'] for w in words)
            else:
                x = y = 0; x2 = y2 = 1
            lines.append((ln.get('text', ''), x, y, x2 - x, y2 - y))
        return lines
    except ImportError:
        pass
    import asyncio
    from winrt.windows.media.ocr import OcrEngine
    from winrt.windows.globalization import Language
    from winrt.windows.graphics.imaging import BitmapDecoder
    from winrt.windows.storage.streams import InMemoryRandomAccessStream, DataWriter

    async def run():
        stream = InMemoryRandomAccessStream()
        writer = DataWriter(stream.get_output_stream_at(0))
        writer.write_bytes(_png_bytes(img))
        await writer.store_async(); await writer.flush_async()
        decoder = await BitmapDecoder.create_async(stream)
        bmp = await decoder.get_software_bitmap_async()
        engine = OcrEngine.try_create_from_language(Language(lang)) or OcrEngine.try_create_from_user_profile_languages()
        if engine is None:
            raise RuntimeError('윈도 OCR 엔진을 만들지 못했습니다(한국어 언어 팩 확인)')
        result = await engine.recognize_async(bmp)
        out = []
        for ln in result.lines:
            ws = list(ln.words)
            if ws:
                x = min(wd.bounding_rect.x for wd in ws); y = min(wd.bounding_rect.y for wd in ws)
                x2 = max(wd.bounding_rect.x + wd.bounding_rect.width for wd in ws); y2 = max(wd.bounding_rect.y + wd.bounding_rect.height for wd in ws)
            else:
                x = y = 0; x2 = y2 = 1
            out.append((ln.text, x, y, x2 - x, y2 - y))
        return out
    return asyncio.run(run())


def ocr_rapid(img):
    global _rapid
    if _rapid is None:
        from rapidocr_onnxruntime import RapidOCR
        kor = korean_rec_model()
        _rapid = RapidOCR(rec_model_path=kor) if kor else RapidOCR()
    import numpy as np
    arr = np.asarray(img.convert('RGB'))
    result, _ = _rapid(arr)
    lines = []
    for box, text, score in (result or []):
        xs = [p[0] for p in box]; ys = [p[1] for p in box]
        lines.append((str(text), min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)))
    return lines


def ocr_tesseract(img, lang='kor+eng'):
    tes = shutil.which('tesseract')
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, 'page.png'); img.save(p)
        out = subprocess.run([tes, p, 'stdout', '-l', lang, '--psm', '6', 'tsv'], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=300).stdout
    lines, cur, key = [], [], None
    for row in out.split('\n')[1:]:
        c = row.split('\t')
        if len(c) < 12:
            continue
        k = (c[1], c[2], c[3], c[4])   # page, block, par, line
        if k != key and cur:
            lines.append(_join_words(cur)); cur = []
        key = k
        if c[11].strip():
            cur.append((c[11], int(c[6]), int(c[7]), int(c[8]), int(c[9])))
    if cur:
        lines.append(_join_words(cur))
    return lines


def _join_words(ws):
    x = min(w[1] for w in ws); y = min(w[2] for w in ws); x2 = max(w[1] + w[3] for w in ws); y2 = max(w[2] + w[4] for w in ws)
    return (' '.join(w[0] for w in ws), x, y, x2 - x, y2 - y)


ENGINES = {'windows': ocr_windows, 'rapidocr': ocr_rapid, 'tesseract': ocr_tesseract}


# ---------------------------------------------------------------- 줄 정리(읽는 순서·후처리)
def order_lines(lines):
    """위→아래, 같은 줄이면 왼쪽→오른쪽. 세로 간격이 글자 높이의 절반 안이면 같은 줄로 본다(두 단 문서도 큰 틀은 맞는다)."""
    if not lines:
        return []
    hs = sorted(h for _, _, _, _, h in lines if h > 0)
    med = hs[len(hs) // 2] if hs else 10
    rows = []
    for ln in sorted(lines, key=lambda l: (l[2], l[1])):
        if rows and abs(ln[2] - rows[-1][0]) <= med * 0.5:
            rows[-1][1].append(ln)
        else:
            rows.append([ln[2], [ln]])
    out = []
    for _, group in rows:
        out.append(' '.join(t.strip() for t, *_ in sorted(group, key=lambda l: l[1]) if t.strip()))
    return [l for l in out if l]


def clean_line(s):
    s = re.sub(r'[ \t]+', ' ', s).strip()
    s = re.sub(r'(?<=[가-힣])\s+(?=[,.·:;)])', '', s)          # 한글 뒤 띄어쓴 문장부호
    s = re.sub(r'(\d)\s*\.\s*(\d)\s*\.\s*(\d)', r'\1. \2. \3', s)  # 날짜 「2026 . 9 . 1」 → 「2026. 9. 1」
    s = s.replace('ㅇ ', 'ㅇ ').replace('口', '□')
    return s


def recognize_image(img, engine):
    g = preprocess(img)
    lines = ENGINES[engine](g)
    return [clean_line(l) for l in order_lines(lines)]


# ---------------------------------------------------------------- 파일 단위 + 캐시
def file_key(path, engine, dpi, max_pages):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    h.update(('|%s|%d|%d|v1' % (engine, dpi, max_pages)).encode('utf-8'))
    return h.hexdigest()


def ocr_pdf(path, engine, cache_dir=None, dpi=DEFAULT_DPI, max_pages=MAX_PAGES, progress=None):
    """스캔 PDF → units [{'loc': 'n쪽(OCR)', 'text': ...}]. 캐시가 있으면 바로 돌려준다. 실패하면 예외."""
    key = file_key(path, engine, dpi, max_pages)
    cp = os.path.join(cache_dir, key + '.json') if cache_dir else None
    if cp and os.path.exists(cp):
        try:
            with open(cp, encoding='utf-8') as f:
                return json.load(f)['units']
        except Exception:
            pass
    t0 = time.time()
    units = []
    for no, img in pdf_to_images(path, dpi, max_pages):
        if progress:
            progress(no)
        lines = recognize_image(img, engine)
        if lines:
            units.append({'loc': '%d쪽(OCR)' % no, 'text': '\n'.join(lines)})
    if cp:
        try:
            os.makedirs(cache_dir, exist_ok=True)
            with open(cp, 'w', encoding='utf-8') as f:
                json.dump({'file': os.path.basename(path), 'engine': engine, 'dpi': dpi, 'pages': max_pages, 'sec': round(time.time() - t0, 1), 'units': units}, f, ensure_ascii=False)
        except Exception:
            pass
    return units


def ocr_image_file(path, engine, cache_dir=None):
    from PIL import Image
    key = file_key(path, engine, 0, 1)
    cp = os.path.join(cache_dir, key + '.json') if cache_dir else None
    if cp and os.path.exists(cp):
        try:
            with open(cp, encoding='utf-8') as f:
                return json.load(f)['units']
        except Exception:
            pass
    img = Image.open(path); img.load()
    lines = recognize_image(img, engine)
    units = [{'loc': '그림(OCR)', 'text': '\n'.join(lines)}] if lines else []
    if cp:
        try:
            os.makedirs(cache_dir, exist_ok=True)
            with open(cp, 'w', encoding='utf-8') as f:
                json.dump({'file': os.path.basename(path), 'engine': engine, 'units': units}, f, ensure_ascii=False)
        except Exception:
            pass
    return units


if __name__ == '__main__':
    import sys
    print(json.dumps(available(), ensure_ascii=False, indent=1))
    if len(sys.argv) > 1:
        eng = pick()
        print('엔진:', eng)
        for u in ocr_pdf(sys.argv[1], eng):
            print(u['loc']); print(u['text'][:800])
