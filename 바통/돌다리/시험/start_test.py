# 돌다리 v3.7.3 시작·두 번 실행 시험(실제 프로세스). 10.20.~22. 윈도 실측: 두 번째 실행이 8766에 두 번째 서버로 뜸 / 감지 뒤 bat이 「시작하지 못했습니다」.
# 사용: python 시험/start_test.py   (가상 자료만, 127.0.0.1만 씀)
import os, sys, time, json, socket, signal, shutil, tempfile, subprocess, threading, urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(HERE, 'server.py')
TMP = tempfile.mkdtemp(prefix='dd_start_')
P = F_ = 0
procs = []


def ok(name, cond, extra=''):
    global P, F_
    P += bool(cond); F_ += (not cond)
    print(('통과  ' if cond else '실패  ') + name + (' · ' + str(extra)[:400] if extra and not cond else ''))


def free_block(n):
    """연속으로 빈 포트 n개의 첫 번호."""
    for base in range(18800, 19800, 20):
        socks = []
        try:
            for p in range(base, base + n):
                s = socket.socket(); s.bind(('127.0.0.1', p)); socks.append(s)
            return base
        except OSError:
            pass
        finally:
            for s in socks:
                s.close()
    raise SystemExit('빈 포트 없음')


def work(name):
    d = os.path.join(TMP, name); os.makedirs(d, exist_ok=True); return d


def start(port, wd):
    pr = subprocess.Popen([sys.executable, '-B', SERVER, '--port', str(port), '--work', wd, '--no-browser'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8')
    procs.append(pr)
    out = []
    threading.Thread(target=lambda: [out.append(l) for l in pr.stdout], daemon=True).start()
    return pr, out


def wait_line(out, needle, sec=20):
    t0 = time.time()
    while time.time() - t0 < sec:
        if any(needle in l for l in out):
            return True
        time.sleep(0.1)
    return False


def run_once(port, wd, sec=30):
    """끝나기를 기다린다. 끝나지 않으면(= 두 번째 서버가 떠 버림) 죽이고 (None, 출력)으로 실패를 알린다."""
    pr = subprocess.Popen([sys.executable, '-B', SERVER, '--port', str(port), '--work', wd, '--no-browser'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8')
    try:
        out, _ = pr.communicate(timeout=sec)
        return pr.returncode, out
    except subprocess.TimeoutExpired:
        pr.kill(); out, _ = pr.communicate()
        return None, '[끝나지 않음: 두 번째 서버가 뜬 것으로 봄] ' + (out or '')


def listening(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=0.5):
            return True
    except OSError:
        return False


class Dummy(BaseHTTPRequestHandler):   # 다른 프로그램(HTTP)
    def do_GET(self):
        b = b'<html>other app</html>'
        self.send_response(200); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a):
        pass


def old_doldari(work_dir):   # 옛 판 흉내: /api/ping 없음(404), /api/state는 큰 JSON 끝에 version·work
    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == '/api/state':
                b = json.dumps({'step': 2, 'files': ['f%d' % i for i in range(3000)], 'version': '3.7.1 (2026-10-18)', 'work': work_dir}).encode()
                self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
            else:
                self.send_response(404); self.send_header('Content-Length', '0'); self.end_headers()
        def log_message(self, *a):
            pass
    return H


def serve(handler, port):
    s = ThreadingHTTPServer(('127.0.0.1', port), handler)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


try:
    # 1. 첫 실행 → 두 번째 실행(같은 작업 폴더)
    A = free_block(3); W1 = work('w1')
    p1, o1 = start(A, W1)
    ok('첫 실행이 뜸', wait_line(o1, '돌다리 v'), ''.join(o1))
    ok('실행 중 포트를 작업 폴더에 남김', open(os.path.join(W1, '실행중_포트.txt'), encoding='utf-8').read().strip() == str(A))
    with urllib.request.urlopen('http://127.0.0.1:%d/api/ping' % A, timeout=5) as r:
        ping = json.loads(r.read().decode())
    ok('ping이 판·작업 폴더를 알림', ping.get('app') == 'doldari' and os.path.realpath(ping.get('work', '')) == os.path.realpath(W1), ping)
    t0 = time.time(); rc, out = run_once(A, W1); dt = time.time() - t0
    ok('두 번째 실행은 성공(종료 코드 0, bat이 「시작하지 못했습니다」를 띄우지 않음)', rc == 0, (rc, out))
    ok('두 번째 실행: 「이미 켜져 있습니다」와 「이 창은 닫아도 됩니다」', '이미 켜져 있습니다(포트 %d)' % A in out and '이 창은 닫아도 됩니다' in out, out)
    ok('두 번째 실행은 세션·폴더를 다시 읽지 않고 곧 끝남', '이전 작업' not in out and dt < 10, (round(dt, 1), out))
    ok('두 번째 서버가 다음 포트에 뜨지 않음', not listening(A + 1))
    ok('같은 판이면 판 다름 안내 없음', '이 판(v' not in out, out)

    # 2. 다른 위치(다른 작업 폴더)의 돌다리 → 건너뛰고 다음 포트
    W2 = work('w2')
    p2, o2 = start(A, W2)
    ok('다른 작업 폴더면 다음 포트로 따로 뜸', wait_line(o2, '돌다리 v') and any('%d번으로 엽니다' % (A + 1) in l for l in o2), ''.join(o2))
    ok('건너뛴 까닭(다른 위치의 돌다리)을 알림', any('다른 위치의 돌다리' in l for l in o2), ''.join(o2))
    rc, out = run_once(A, W2)
    ok('그 두 번째 위치도 다시 누르면 자기 것(포트 %d)을 엶' % (A + 1), rc == 0 and '이미 켜져 있습니다(포트 %d)' % (A + 1) in out, (rc, out))

    # 3. 다른 프로그램이 첫 포트를 씀 → 다음 포트, 다시 누르면 그것을 찾음
    B = free_block(4); W3 = work('w3')
    d = serve(Dummy, B)
    p3, o3 = start(B, W3)
    ok('다른 프로그램이 쓰는 포트는 건너뜀', wait_line(o3, '돌다리 v') and any('다른 프로그램이 쓰고 있어' in l for l in o3) and any('%d번으로 엽니다' % (B + 1) in l for l in o3), ''.join(o3))
    rc, out = run_once(B, W3)
    ok('다시 누르면 다음 포트의 돌다리를 찾음(10.20. 실측 경우)', rc == 0 and '이미 켜져 있습니다(포트 %d)' % (B + 1) in out, (rc, out))
    # 4. 그 사이 첫 포트가 비면: 남긴 포트로 찾아야 함(차례로만 보면 첫 포트에 두 번째 서버)
    d.shutdown(); d.server_close(); time.sleep(0.3)
    rc, out = run_once(B, W3)
    ok('첫 포트가 비어도 남긴 포트로 켜진 돌다리를 찾음', rc == 0 and '이미 켜져 있습니다(포트 %d)' % (B + 1) in out and not listening(B), (rc, out))

    # 5. 옛 판(ping 없음, state가 큼)
    C = free_block(2); W5 = work('w5')
    o = serve(old_doldari(W5), C)
    rc, out = run_once(C, W5)
    ok('옛 판(ping 없음·state 큼)도 같은 작업 폴더면 알아봄', rc == 0 and '이미 켜져 있습니다(포트 %d)' % C in out, (rc, out))
    ok('판이 다르면 「먼저 연 검은 창을 닫고 다시 실행」 안내', '켜져 있는 것은 v3.7.1' in out, out)
    o.shutdown(); o.server_close()

    # 6. 열한 포트가 모두 다른 프로그램 → 종료 코드 2, 다른 번호 안내
    D = free_block(11); ds = [serve(Dummy, D + i) for i in range(11)]
    rc, out = run_once(D, work('w6'), sec=90)
    ok('포트가 모두 막히면 실패(종료 코드 2)와 「--port」 안내', rc == 2 and '--port' in out, (rc, out))
    for s in ds:
        s.shutdown(); s.server_close()

    # 7. Ctrl+C로 끝내면 종료 코드 0, 남긴 포트 지움
    p1.send_signal(signal.SIGINT)
    try:
        rc1 = p1.wait(timeout=15)
    except subprocess.TimeoutExpired:
        rc1 = None
    ok('Ctrl+C로 끝내면 종료 코드 0(bat이 실패로 보지 않음)', rc1 == 0, rc1)
    ok('끝낼 때 남긴 포트 파일을 지움', not os.path.exists(os.path.join(W1, '실행중_포트.txt')))
    # 8. 창을 닫아 남은(오래된) 포트 파일: 무시하고 새로 뜸
    open(os.path.join(W1, '실행중_포트.txt'), 'w', encoding='utf-8').write(str(D + 3))
    p8, o8 = start(A, W1)
    ok('오래된 포트 파일이 있어도 정상 시작', wait_line(o8, '돌다리 v') and any('127.0.0.1:%d/' % A in l for l in o8), ''.join(o8))
finally:
    for pr in procs:
        if pr.poll() is None:
            pr.terminate()
            try:
                pr.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pr.kill()
    shutil.rmtree(TMP, ignore_errors=True)

print('\n통과 %d · 실패 %d' % (P, F_))
sys.exit(1 if F_ else 0)
