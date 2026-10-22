# 시험용 감싸개: 윈도처럼 「닫힌 포트에 연결」이 바로 거절되지 않고 시간 제한까지 기다리게 한 뒤 server.py를 실행한다.
# (윈도는 거절(RST) 뒤에도 SYN을 다시 보내 약 0.5초 이상 걸린다. 리눅스는 즉시 거절해 동시 실행 경합이 거의 안 보인다.)
# 사용: python 시험/winlike_run.py <server.py 인자들>
import os, sys, socket, time, runpy
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_orig = socket.create_connection


def slow_refuse(address, timeout=None, *a, **k):
    try:
        return _orig(address, timeout, *a, **k)
    except ConnectionRefusedError:
        time.sleep(min(timeout or 1.0, 1.0))
        raise


socket.create_connection = slow_refuse
sys.path.insert(0, HERE)
sys.argv = [os.path.join(HERE, 'server.py')] + sys.argv[1:]
runpy.run_path(os.path.join(HERE, 'server.py'), run_name='__main__')
