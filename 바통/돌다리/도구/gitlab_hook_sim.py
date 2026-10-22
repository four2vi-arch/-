"""공공 GitLab 서버 훅 흉내(10.19). 올릴 폴더를 임시 bare 저장소에 밀어 넣어, 흔한 서버 규칙 가운데 어느 것이 어느 파일에 걸리는지 전부 적는다.
실제 서버(gitlab.aigov.go.kr)는 「Prevented by server hooks」만 보여 주고 이유를 알려 주지 않으므로, 올리기 전에 여기서 걸러 본다.

사용:  python 도구/gitlab_hook_sim.py <올릴 폴더>          (예: 바탕화면의 handover-doldari)
규칙(10.19. 실제 서버 웹 「파일 업로드」로 하나씩 확인한 결과):
  R1 의존성 목록 파일 이름(requirements.txt 등) ← 확인됨(「파일 업로드에 실패」). 부품목록.txt로 이름을 바꿈
  R5 .py 파일 내용 검사                          ← 확인됨. 같은 내용을 .txt로 올리면 통과, 한 줄짜리 .py는 통과,
     core.py(36KB)는 3번 모두 거절. 2~3KB 조각 8개는 각각 통과했는데 이어 붙이면 거절, 9.7KB 조각은 한 번 통과·한 번 거절,
     5KB 조각도 거절 → 어떤 줄이 걸리는 게 아니라 크기·부하에 따라 흔들리는 검사(시간 초과 꼴). 4KB 넘는 .py는 못 믿는다
  R6 압축 안 한글 이름의 UTF-8 표시(서버 규칙 아님, 받는 쪽 점검) ← 10.22. 검토: 리눅스 zip 명령으로 묶으면 표시가 없어 윈도 기본 압축 풀기에서 깨짐
  R4 20MB 초과                                  ← 미확인(17.6MB HTML·15MB zip은 통과)
  뺀 규칙: 실행 파일 확장자(.bat 통과), 압축 안 실행 파일(python.exe 든 휴대용 zip 통과), 압축 안 압축(모의 폴더 zip 통과),
     cp949 텍스트(통과), 셔뱅 줄(물어물어 build.py 통과), 비밀 값·전화·카드 꼴(물어물어 묶음 통과),
     암호 PDF·손상 hwp·eml·괄호 든 폴더 이름(모두 통과)
  대비: .py는 소스 zip(소스/돌다리_소스_v3.7.3.zip)에 넣고, 읽기용 사본은 .py.txt로 올린다(소스/읽기용/)
"""
import os, re, sys, io, zipfile, subprocess, tempfile, shutil, stat

MANIFEST = {'requirements.txt', 'requirements-dev.txt', 'package.json', 'package-lock.json', 'yarn.lock', 'pipfile', 'pipfile.lock', 'setup.py', 'pyproject.toml',
            'poetry.lock', 'environment.yml', 'gemfile', 'pom.xml', 'build.gradle', 'go.mod', 'cargo.toml', 'composer.json', 'dockerfile'}
MAXMB = 20
PYMAX = 4000   # 10.19. 실측: 5.3KB .py 거절, 2.9KB 통과


def check(path, data):
    hits = []
    base = os.path.basename(path).lower()
    if base in MANIFEST:
        hits.append('R1 의존성 목록 파일 이름')
    if base.endswith('.py') and len(data) > PYMAX:
        hits.append('R5 .py %dKB(4KB 넘는 .py는 거절될 수 있음, 17KB 넘으면 3/3 거절)' % (len(data) // 1024))
    if base.endswith('.zip'):
        try:
            infos = zipfile.ZipFile(io.BytesIO(data)).infolist()
            noflag = [i.filename for i in infos if not i.filename.isascii() and not (i.flag_bits & 0x800)]
            if not noflag:
                noflag = [i.filename for i in infos if not (i.flag_bits & 0x800) and any(b >= 0x80 for b in i.filename.encode('cp437', 'replace'))]
            if noflag:
                hits.append('R6 압축 안 한글 이름에 UTF-8 표시 없음 %d개(서버 규칙 아님: 윈도 기본 「압축 풀기」에서 이름이 깨짐. 도구/make_gitlab_upload.py로 다시 묶기)' % len(noflag))
        except Exception:
            hits.append('R3x 압축 열기 실패')
    if len(data) > MAXMB * 1e6:
        hits.append('R4 %dMB 초과' % MAXMB)
    return hits


HOOK = r'''#!/usr/bin/env python3
import sys, subprocess, os
sys.path.insert(0, %r)
from gitlab_hook_sim import check
bad = []
for line in sys.stdin:
    old, new, ref = line.split()
    if set(old) == {'0'}:
        out = subprocess.run(['git', 'ls-tree', '-r', '--name-only', '-z', new], capture_output=True).stdout
    else:
        out = subprocess.run(['git', 'diff', '--name-only', '--diff-filter=AM', '-z', old, new], capture_output=True).stdout
    for f in [x for x in out.decode('utf-8', 'surrogateescape').split('\0') if x]:
        data = subprocess.run(['git', 'show', '%%s:%%s' %% (new, f)], capture_output=True).stdout
        h = check(f, data)
        if h:
            bad.append((f, h))
if bad:
    print('GL-HOOK-ERR: 거절 %%d개 파일' %% len(bad))
    for f, h in bad:
        print('  ', f, '<-', '; '.join(h))
    sys.exit(1)
print('GL-HOOK: 통과')
'''


def main(folder):
    folder = os.path.abspath(folder)
    tmp = tempfile.mkdtemp(prefix='gl_sim_')
    remote = os.path.join(tmp, 'remote.git'); work = os.path.join(tmp, 'work')
    subprocess.run(['git', 'init', '-q', '--bare', remote], check=True)
    hp = os.path.join(remote, 'hooks', 'pre-receive')
    open(hp, 'w', encoding='utf-8').write(HOOK % os.path.dirname(os.path.abspath(__file__)))
    os.chmod(hp, os.stat(hp).st_mode | stat.S_IEXEC)
    subprocess.run(['git', 'clone', '-q', remote, work], check=True, capture_output=True)
    shutil.copytree(folder, work, dirs_exist_ok=True, ignore=shutil.ignore_patterns('.git'))
    env = dict(os.environ, GIT_AUTHOR_NAME='sim', GIT_AUTHOR_EMAIL='sim@local', GIT_COMMITTER_NAME='sim', GIT_COMMITTER_EMAIL='sim@local')
    subprocess.run(['git', '-C', work, 'add', '-A'], check=True)
    subprocess.run(['git', '-C', work, 'commit', '-q', '-m', 'sim'], check=True, env=env)
    r = subprocess.run(['git', '-C', work, 'push', 'origin', 'HEAD:main'], capture_output=True, text=True, env=env)
    msg = [l.replace('remote: ', '').rstrip() for l in (r.stdout + r.stderr).split('\n') if 'GL-HOOK' in l or '<-' in l]
    print('\n'.join(msg) or r.stderr)
    shutil.rmtree(tmp, ignore_errors=True)
    return 0 if r.returncode == 0 else 1


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    sys.exit(main(sys.argv[1]))
