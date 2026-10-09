#!/usr/bin/env python3
"""우편번호 자동검색기 — 소스에서 단일 HTML 만들기.

python build.py  ->  dist/우편번호_자동검색기_v1.4_출품본.html
1) template.html 자리표시자에 data·vendor·src 파일을 그대로 끼워 넣고
2) 핵심 코드 6개(라이브러리 2 + DB 빌더·엔진·화면·어르신 화면)를 줄바꿈으로 이어 SHA-256 지문을 계산해
   무결성 검증기(EXPECTED)와 「파일 정보」에 적고
3) 실행되는 inline script 의 SHA-256 으로 CSP(script-src)를 다시 만든다.
"""
import re, hashlib, base64, pathlib
ROOT = pathlib.Path(__file__).resolve().parent
def read(p): return (ROOT / p).read_text(encoding="utf-8")
core = [read("vendor/fflate.js"), read("vendor/xlsx-js-style.js"), read("src/dbbuild.js"), read("src/engine.js"), read("src/ui.js"),
        read("vendor/qrcode-generator.js") + "\n" + read("src/kiosk.js")]
expected = hashlib.sha256("\n".join(core).encode("utf-8")).hexdigest()
html = read("template.html")
slots = ["@@FILE:data/zipdb.b64@@", "@@FILE:data/zipextra.b64@@", "@@FILE:vendor/fflate.js@@", "@@FILE:vendor/xlsx-js-style.js@@",
         "@@FILE:src/dbbuild.js@@", "@@FILE:src/engine.js@@", "@@FILE:src/ui.js@@", "@@KIOSK@@"]
texts = [read("data/zipdb.b64"), read("data/zipextra.b64")] + core
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
out = ROOT / "dist" / "우편번호_자동검색기_v1.4_출품본.html"
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding="utf-8")
print("핵심 지문:", expected)
print("파일 SHA-256:", hashlib.sha256(out.read_bytes()).hexdigest())
