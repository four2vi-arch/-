#!/usr/bin/env python3
"""돌다리 공공 GitLab(handover-doldari) 올림 폴더 만들기(10.22.).

공공 GitLab 서버 검사는 4KB 넘는 .py 낱개와 requirements.txt 이름을 거절한다(10.19. 실측). 그래서
  소스/돌다리_소스_v<판>.zip      ← 파이썬 소스·화면·시험·도구 전부(압축 안은 검사하지 않음)
  소스/읽기용/*.py.txt            ← 화면에서 바로 읽는 사본(내용 같음)
  소스/web/, 소스/*.bat, 소스/부품목록.txt, 소스/README.md
  소스/실측결과.zip, 소스/모의데이터_v1_한빛군청.zip
  실행물/doldari_v<판>_portable_win64.zip, 실행물/읽어보기.txt
  모의데이터/가온우체국_모의업무폴더.zip, 모의데이터/정답표.xlsx, 모의데이터/README.md
  예시결과/(모의 폴더로 만든 인수인계서 .docx·.md·온나라 글·원본지문 .csv와 화면 4장)
  README.md(저장소 첫 화면), .gitattributes, .gitignore
로 둔다. 압축은 모두 파이썬 zipfile로 만든다: 한글 이름에 UTF-8 표시(0x800)가 붙어 윈도 기본 「압축 풀기」에서도 이름이 깨지지 않는다
(리눅스 zip 명령으로 만든 압축은 표시가 없어 cp949로 읽히며 깨졌다, 10.22. 검토).

사용: python 도구/make_gitlab_upload.py --out <빈 폴더> --readme <저장소 첫 화면 README> --portable <휴대용 zip>
"""
import argparse, datetime, os, re, shutil, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIRS = ('실측결과', '모의데이터', '모의데이터_v1_한빛군청', '예시결과')
SKIP = re.compile(r'(^|/)(__pycache__|\.git)(/|$)|\.pyc$|(^|/)점검결과_v1\.1\.md$|(^|/)작업(/|$)|(^|/)배포(/|$)|^개발기록\.md$')   # 개발기록(개발 일지)은 GitHub에만 둔다
READ_COPIES = ('core', 'docs', 'export', 'extract', 'make_mock', 'make_mock_v1', 'measure', 'ocr', 'server')
GITATTR = '# 모든 파일의 바이트를 그대로 지킨다(모의데이터·결과 파일 SHA-256 유지)\n* -text\n*.zip binary\n*.xlsx binary\n*.docx binary\n*.hwp binary\n*.hwpx binary\n*.odt binary\n*.pdf binary\n*.png binary\n*.mp4 binary\n'


def version():
    s = open(os.path.join(ROOT, 'server.py'), encoding='utf-8').read()
    return re.search(r"VERSION\s*=\s*'([0-9.]+)", s).group(1)


def files_under(base, rel_root=''):
    out = []
    for d, dirs, fs in os.walk(os.path.join(base, rel_root)):
        dirs.sort()
        for f in sorted(fs):
            p = os.path.join(d, f)
            rel = os.path.relpath(p, base).replace(os.sep, '/')
            if not SKIP.search(rel):
                out.append(rel)
    return out


def zip_files(dst, base, rels):
    """파이썬 zipfile: 한글 이름이면 UTF-8 표시가 자동으로 붙는다. 내용 바이트(bat의 CRLF 등)는 그대로."""
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel in rels:
            p = os.path.join(base, *rel.split('/'))
            info = zipfile.ZipInfo(rel, datetime.datetime.fromtimestamp(os.path.getmtime(p)).timetuple()[:6])
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(p, 'rb') as f:
                z.writestr(info, f.read())
    check_zip(dst)


def check_zip(path):
    with zipfile.ZipFile(path) as z:
        bad = [i.filename for i in z.infolist() if not i.filename.isascii() and not (i.flag_bits & 0x800)]
        if bad:
            raise SystemExit('UTF-8 표시 없는 한글 이름: %s %s' % (path, bad[:3]))
        if z.testzip() is not None:
            raise SystemExit('압축 손상: %s' % path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--readme', required=True, help='저장소 첫 화면 README.md(바통/돌다리_GitLab_README_*.md)')
    ap.add_argument('--portable', required=True, help='도구/make_portable.py로 만든 휴대용 zip')
    a = ap.parse_args()
    ver = version()
    out = os.path.abspath(a.out)
    if os.path.exists(out) and os.listdir(out):
        raise SystemExit('빈 폴더를 주세요: ' + out)
    for d in ('실행물', '모의데이터', '소스/읽기용', '소스/web'):
        os.makedirs(os.path.join(out, *d.split('/')), exist_ok=True)
    shutil.copyfile(a.readme, os.path.join(out, 'README.md'))
    open(os.path.join(out, '.gitattributes'), 'w', encoding='utf-8', newline='\n').write(GITATTR)
    open(os.path.join(out, '.gitignore'), 'w', encoding='utf-8', newline='\n').write('__pycache__/\n*.pyc\n작업/\n')
    # 실행물
    check_zip(a.portable)
    shutil.copyfile(a.portable, os.path.join(out, '실행물', os.path.basename(a.portable)))
    txt = ('돌다리 v{v} 휴대용 묶음(윈도 10·11, 64비트)\n1. doldari_v{v}_portable_win64.zip 을 바탕화면 등에 압축 풀기(압축 안에서 바로 실행하지 마세요)\n'
           '2. 풀린 doldari 폴더의 「돌다리_실행.bat」(또는 run.bat) 두 번 누르기\n   - 「Windows의 PC 보호」 창이 뜨면 「추가 정보 → 실행」\n'
           '3. 브라우저에 http://127.0.0.1:8765/ 가 열립니다(안 열리면 주소창에 직접 입력)\n4. 끝낼 때는 검은 창을 닫습니다\n'
           '파이썬 설치·인터넷이 필요 없습니다. 원본 폴더는 읽기만 합니다.\n').format(v=ver)
    open(os.path.join(out, '실행물', '읽어보기.txt'), 'w', encoding='utf-8-sig', newline='\r\n').write(txt)
    # 모의데이터: 폴더째 묶는다(PDF·손상 파일 포함, 맨 위 폴더 이름 「가온우체국_모의업무폴더」)
    mock = os.path.join(ROOT, '모의데이터')
    zip_files(os.path.join(out, '모의데이터', '가온우체국_모의업무폴더.zip'), mock, files_under(mock, '가온우체국_모의업무폴더'))
    for f in ('정답표.xlsx', 'README.md'):
        shutil.copyfile(os.path.join(ROOT, '모의데이터', f), os.path.join(out, '모의데이터', f))
    # 예시결과(저장소 맨 위): 모의 폴더로 만든 인수인계서·화면(도구/make_example_outputs.py)
    ex = os.path.join(ROOT, '예시결과')
    if os.path.isdir(ex):
        shutil.copytree(ex, os.path.join(out, '예시결과'), ignore=shutil.ignore_patterns('__pycache__'))
    # 소스
    src = [r for r in files_under(ROOT) if r.split('/')[0] not in DATA_DIRS]
    zip_files(os.path.join(out, '소스', '돌다리_소스_v%s.zip' % ver), ROOT, src)
    zip_files(os.path.join(out, '소스', '실측결과.zip'), ROOT, files_under(ROOT, '실측결과'))
    zip_files(os.path.join(out, '소스', '모의데이터_v1_한빛군청.zip'), ROOT, files_under(ROOT, '모의데이터_v1_한빛군청'))
    for n in READ_COPIES:
        shutil.copyfile(os.path.join(ROOT, n + '.py'), os.path.join(out, '소스', '읽기용', n + '.py.txt'))
    for f in ('README.md', '돌다리_실행.bat', '실측.bat', '부품목록.txt'):
        shutil.copyfile(os.path.join(ROOT, f), os.path.join(out, '소스', f))
    for f in ('app.js', 'index.html'):
        shutil.copyfile(os.path.join(ROOT, 'web', f), os.path.join(out, '소스', 'web', f))
    n = sum(len(fs) for _, _, fs in os.walk(out))
    print('만듦: %s (파일 %d개, 소스 zip %d개 항목)' % (out, n, len(src)))


if __name__ == '__main__':
    main()
