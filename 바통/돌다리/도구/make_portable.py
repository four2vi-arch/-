#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""돌다리 휴대용 묶음(윈도 64비트) 만들기 · 파이썬 설치 없이 압축만 풀어 「돌다리_실행.bat」을 누르면 되는 묶음.

구성(압축 안 이름은 모두 영문: 윈도 기본 압축 풀기에서 한글 이름이 깨지는 일을 피한다)
  doldari/run.bat            ← 실행(같은 내용의 「돌다리_실행.bat」도 함께 둔다)
  doldari/python/            ← CPython 3.12 윈도 x64(NuGet 공식 패키지 python, 저자 Python Software Foundation)
  doldari/python/Lib/site-packages/  ← 부품목록.txt의 바퀴(win_amd64)를 풀어 넣은 것
  doldari/app/               ← 돌다리 소스(server.py 등 + web/)
  doldari/README.txt         ← 읽어보기

사용: python make_portable.py --nupkg python.3.12.10.nupkg --wheels <바퀴 폴더> --out <출력 폴더>
바퀴 폴더는 미리 받아 둔다(인터넷 되는 PC에서 한 번):
  pip download --only-binary=:all: --platform win_amd64 --python-version 3.12 --implementation cp -d wheels olefile pypdf openpyxl pypdfium2 Pillow winocr
nupkg: https://api.nuget.org/v3-flatcontainer/python/3.12.10/python.3.12.10.nupkg
"""
import argparse, hashlib, os, re, sys, zipfile, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
APP_FILES = ['server.py', 'core.py', 'docs.py', 'export.py', 'extract.py', 'ocr.py', '부품목록.txt']
APP_DIRS = ['web']
# 파이썬 표준 라이브러리 중 돌다리가 쓰지 않는 큰 묶음(빼도 동작에 영향 없음)
DROP = re.compile(r'^tools/(Lib/(ensurepip|idlelib|turtledemo|tkinter|test|lib2to3|venv|pydoc_data|sqlite3)/|Lib/site-packages/pip|Scripts/|tcl/|include/|libs/'
                  r'|DLLs/(_ssl|_hashlib|_sqlite3)\.pyd$|DLLs/(libssl-3|libcrypto-3|sqlite3)\.dll$)', re.I)
# 10.18. 공공 GitLab이 큰 파일을 서버 검사로 거절(22.9MB): 돌다리는 https·sqlite를 쓰지 않고(이 PC 127.0.0.1만, hashlib은 내장 sha256으로 대신)
# Pillow의 AVIF 그림 부품(4.3MB)도 쓰지 않는다. 빠져도 Pillow·urllib·asyncio는 ImportError를 받아 그 기능만 끈다
WDROP = re.compile(r'^PIL/_avif\.', re.I)

RUN_BAT = r'''@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  돌다리 업무 인수인계 도우미를 시작합니다. 잠시 뒤 브라우저가 열립니다.
echo  이 검은 창을 닫으면 돌다리가 끝납니다.
echo.
"%~dp0python\python.exe" -I -X utf8 "%~dp0app\server.py" %*
if errorlevel 1 (
  echo.
  echo  시작하지 못했습니다. 위의 오류 문장을 사진으로 찍어 담당자에게 보내 주세요.
  echo  흔한 원인: 압축을 풀지 않고 압축 파일 안에서 바로 실행함 / 다른 돌다리 창이 이미 열려 있음
)
pause
'''

README = '''돌다리 v{ver} 휴대용 묶음(윈도 10·11, 64비트)

1. 이 압축 파일을 원하는 곳(예: 바탕화면)에 「압축 풀기」 합니다. 압축 파일 안에서 바로 실행하지 마세요.
2. 풀린 doldari 폴더에서 「돌다리_실행.bat」(또는 run.bat)을 두 번 누릅니다.
   - 처음 실행할 때 윈도 보안 경고(「Windows의 PC 보호」)가 뜨면 「추가 정보 → 실행」을 누릅니다.
   - 방화벽 창이 뜨면 「취소」해도 됩니다(돌다리는 이 PC 안 127.0.0.1에서만 동작합니다).
3. 브라우저에 http://127.0.0.1:8765/ 가 열립니다. 안 열리면 주소창에 직접 적습니다.
4. 끝낼 때는 검은 창을 닫습니다.

- 파이썬을 따로 설치하지 않아도 됩니다(이 폴더 안 python에 들어 있음). 인터넷도 필요 없습니다.
- AI 모델(선택): Ollama를 설치하고 「ollama pull exaone3.5:7.8b」 또는 「ollama pull gemma3:4b」. 없으면 규칙만으로 동작합니다.
- 스캔 PDF 글자 읽기(선택): 윈도 설정 → 시간 및 언어 → 언어 → 한국어 → 언어 옵션에서 「광학 문자 인식」이 설치돼 있으면 자동으로 씁니다.
- 작업 기록은 doldari\\app\\작업\\ 에 남습니다. 원본 업무 폴더는 읽기만 합니다.

구성 요소와 라이선스: python(CPython {pyver}, PSF 라이선스, python\\LICENSE.txt), {pkgs}
만든 날: {day}
'''


def sha256(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def app_version():
    s = open(os.path.join(ROOT, 'server.py'), encoding='utf-8').read()
    m = re.search(r"VERSION\s*=\s*['\"]([^'\"]+)", s)
    return m.group(1) if m else 'x'


def build(nupkg, wheels, out):
    ver = app_version()
    pyver = re.search(r'python\.(\d+\.\d+\.\d+)\.nupkg', os.path.basename(nupkg))
    pyver = pyver.group(1) if pyver else '3.12'
    os.makedirs(out, exist_ok=True)
    safe = re.sub(r'[^0-9A-Za-z._-]', '_', ver.split()[0])
    dst = os.path.join(out, 'doldari_v%s_portable_win64.zip' % safe)
    pkgs = []
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        # 1) 파이썬
        with zipfile.ZipFile(nupkg) as n:
            for i in n.infolist():
                nm = i.filename.replace('\\', '/')
                if not nm.startswith('tools/') or nm.endswith('/') or DROP.match(nm):
                    continue
                z.writestr('doldari/python/' + nm[len('tools/'):], n.read(i))
        # 2) 바퀴를 site-packages에 풀기(.data/purelib·platlib는 그 자리로)
        for w in sorted(os.listdir(wheels)):
            if not w.endswith('.whl'):
                continue
            if not (w.endswith('-none-any.whl') or 'win_amd64' in w):
                raise SystemExit('윈도 64비트가 아닌 바퀴: ' + w)
            pkgs.append(re.sub(r'-(py|cp)\d.*$', '', w))
            with zipfile.ZipFile(os.path.join(wheels, w)) as wz:
                for i in wz.infolist():
                    nm = i.filename
                    if nm.endswith('/'):
                        continue
                    m = re.match(r'^[^/]+\.data/(purelib|platlib)/(.*)$', nm)
                    if m:
                        nm = m.group(2)
                    elif re.match(r'^[^/]+\.data/', nm):
                        continue   # scripts·headers는 쓰지 않는다
                    if WDROP.match(nm):
                        continue
                    z.writestr('doldari/python/Lib/site-packages/' + nm, wz.read(i))
        # 3) 돌다리 소스
        for f in APP_FILES:
            z.write(os.path.join(ROOT, f), 'doldari/app/' + f)
        for d in APP_DIRS:
            for base, _, files in os.walk(os.path.join(ROOT, d)):
                for f in files:
                    p = os.path.join(base, f)
                    z.write(p, 'doldari/app/' + os.path.relpath(p, ROOT).replace(os.sep, '/'))
        # 4) 실행 파일·읽어보기(줄바꿈 CRLF, UTF-8)
        bat = RUN_BAT.replace('\n', '\r\n').encode('utf-8')
        z.writestr('doldari/run.bat', bat)
        z.writestr(zipfile.ZipInfo('doldari/돌다리_실행.bat', date_time=datetime.datetime.now().timetuple()[:6]), bat)
        txt = README.format(ver=ver, pyver=pyver, pkgs=', '.join(pkgs), day=datetime.date.today().isoformat())
        z.writestr('doldari/README.txt', ('﻿' + txt).replace('\n', '\r\n').encode('utf-8'))
    print('만듦:', dst)
    print('크기: %.1f MB' % (os.path.getsize(dst) / 1e6))
    print('SHA-256:', sha256(dst))
    return dst


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--nupkg', required=True)
    ap.add_argument('--wheels', required=True)
    ap.add_argument('--out', default=os.path.join(ROOT, '배포'))
    a = ap.parse_args()
    build(a.nupkg, a.wheels, a.out)
