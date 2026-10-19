"""공공 GitLab 서버 훅 흉내(10.19). 올릴 폴더를 임시 bare 저장소에 밀어 넣어, 흔한 서버 규칙 가운데 어느 것이 어느 파일에 걸리는지 전부 적는다.
실제 서버(gitlab.aigov.go.kr)는 「Prevented by server hooks」만 보여 주고 이유를 알려 주지 않으므로, 올리기 전에 여기서 걸러 본다.

사용:  python 도구/gitlab_hook_sim.py <올릴 폴더>          (예: 바탕화면의 handover-doldari)
규칙(관찰·보정 결과):
  R1 의존성 목록 파일 이름(requirements.txt 등) ← 실제 서버에서 확인됨(웹 업로드 「파일 업로드에 실패」)
  R2 실행 파일 확장자(.bat .exe .dll .ps1 …)   ← 흔한 규칙, 미확인
  R3 압축 안 실행 파일 / R3b 압축 안 압축      ← 흔한 규칙, 미확인
  R4 20MB 초과                                  ← 미확인(17.6MB HTML은 통과)
  (비밀 값 꼴·전화·카드 번호 꼴은 실제 서버가 통과시킨 물어물어 묶음에 걸리므로 규칙이 아님 → 넣지 않음)
"""
import os, re, sys, io, zipfile, subprocess, tempfile, shutil, stat

MANIFEST = {'requirements.txt', 'requirements-dev.txt', 'package.json', 'package-lock.json', 'yarn.lock', 'pipfile', 'pipfile.lock', 'setup.py', 'pyproject.toml',
            'poetry.lock', 'environment.yml', 'gemfile', 'pom.xml', 'build.gradle', 'go.mod', 'cargo.toml', 'composer.json', 'dockerfile'}
EXEC = ('.exe', '.dll', '.pyd', '.bat', '.cmd', '.ps1', '.sh', '.msi', '.vbs', '.com', '.scr', '.jar', '.so', '.dylib', '.apk', '.lnk', '.hta', '.wsf', '.reg')
ARCHIVE = ('.zip', '.7z', '.rar', '.tar', '.gz', '.tgz')
MAXMB = 20


def check(path, data):
    hits = []
    base = os.path.basename(path).lower()
    if base in MANIFEST:
        hits.append('R1 의존성 목록 파일 이름')
    if base.endswith(EXEC):
        hits.append('R2 실행 파일 확장자')
    if base.endswith('.zip'):
        try:
            names = zipfile.ZipFile(io.BytesIO(data)).namelist()
            inner = [n for n in names if n.lower().endswith(EXEC)]
            if inner:
                hits.append('R3 압축 안 실행 파일 %d개(예: %s)' % (len(inner), inner[0]))
            if any(n.lower().endswith(ARCHIVE) for n in names):
                hits.append('R3b 압축 안 압축')
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
