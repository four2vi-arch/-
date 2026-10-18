#!/usr/bin/env python3
"""우편번호 자동검색기 · 소스에서 단일 HTML 만들기.

python build.py  ->  dist/우편번호_자동검색기_v1.10_출품본.html
1) template.html 자리표시자에 data·vendor·src 파일을 그대로 끼워 넣고
2) 핵심 코드 9개(라이브러리 2 + DB 빌더·엔진·화면·글자 읽기 라이브러리·사진 읽기·블루투스 인쇄·어르신 화면)를 줄바꿈으로 이어 SHA-256 지문을 계산해
   무결성 검증기(EXPECTED)와 「파일 정보」에 적고
3) 실행되는 inline script 의 SHA-256 으로 CSP(script-src)를 다시 만든다.
"""
import re, hashlib, base64, pathlib
ROOT = pathlib.Path(__file__).resolve().parent
def read(p): return (ROOT / p).read_text(encoding="utf-8")
def sha(t): return hashlib.sha256(t.encode("utf-8")).hexdigest()
# 사진으로 읽기: 글자 읽기 엔진·한국어 자료는 데이터 블록(지문 검증에서 제외)으로 넣고,
# 대신 블록마다 SHA-256 을 계산해 사진 읽기 코드(핵심 코드)에 박아 둔다. 쓰기 직전에 대조한다.
ocr_core = read("vendor/ocr/core-simd-lstm.wasm.js")
ocr_worker = read("vendor/ocr/worker.min.js")
ocr_lang = base64.b64encode((ROOT / "vendor/ocr/kor.traineddata.gz").read_bytes()).decode()
camera = (read("src/camera.js").replace("@@OCRSUM_CORE@@", sha(ocr_core)).replace("@@OCRSUM_WORKER@@", sha(ocr_worker))
          .replace("@@OCRSUM_LANG@@", sha(ocr_lang)))
core = [read("vendor/fflate.js"), read("vendor/xlsx-js-style.js"), read("src/dbbuild.js"), read("src/engine.js"), read("src/ui.js"),
        read("vendor/ocr/tesseract.min.js"), camera, read("src/blep.js"),
        read("vendor/qrcode-generator.js") + "\n" + read("src/kiosk.js")]
expected = hashlib.sha256("\n".join(core).encode("utf-8")).hexdigest()
html = read("template.html")
slots = ["@@FILE:data/zipdb.b64@@", "@@FILE:data/zipextra.b64@@", "@@FILE:vendor/ocr/core-simd-lstm.wasm.js@@", "@@FILE:vendor/ocr/worker.min.js@@", "@@OCRLANG@@",
         "@@FILE:vendor/fflate.js@@", "@@FILE:vendor/xlsx-js-style.js@@",
         "@@FILE:src/dbbuild.js@@", "@@FILE:src/engine.js@@", "@@FILE:src/ui.js@@", "@@FILE:vendor/ocr/tesseract.min.js@@", "@@FILE:src/camera.js@@", "@@FILE:src/blep.js@@", "@@KIOSK@@"]
texts = [read("data/zipdb.b64"), read("data/zipextra.b64"), ocr_core, ocr_worker, ocr_lang,
         core[0], core[1], core[2], core[3], core[4], core[5], core[6], core[7], core[8]]
for slot, text in zip(slots, texts):
    i = html.index(slot)
    html = html[:i] + text + html[i + len(slot):]
html = html.replace("@@EXPECTED@@", expected)
hashes = []
for m in re.finditer(r"<script([^>]*)>", html):
    if "type=" in m.group(1):
        continue
    body = html[m.end():html.index("</script>", m.end())]
    hashes.append("'sha256-%s'" % base64.b64encode(hashlib.sha256(body.encode("utf-8")).digest()).decode())
html = html.replace("@@CSP@@", " ".join(hashes), 1)
out = ROOT / "dist" / "우편번호_자동검색기_v1.10_출품본.html"
out.parent.mkdir(exist_ok=True)
out.write_bytes(html.replace("\r\n", "\n").encode("utf-8"))  # 줄바꿈을 LF로 고정(윈도에서도 같은 SHA-256)
print("핵심 지문:", expected)
print("파일 SHA-256:", hashlib.sha256(out.read_bytes()).hexdigest())
