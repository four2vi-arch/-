#!/usr/bin/env python3
"""예시 결과 만들기(10.22.): 모의 업무 폴더를 인계 일자 2026-03-02로 고정해 규칙만으로 초안을 만들고, 전임자가 아직 손대지 않은 상태 그대로 내보낸다.
심사·설명용 「예시결과/」 폴더(인수인계서 .docx·.md·온나라 붙여넣기 .txt·원본지문 .csv)를 만든다. 날짜를 고정하므로 언제 돌려도 같은 차례·기한이 나온다.

사용: python 도구/make_example_outputs.py <모의 업무 폴더> <출력 폴더> [--port 8790] [--date 2026-03-02]
"""
import json, os, shutil, subprocess, sys, tempfile, time, urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    folder, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
    port = int(sys.argv[sys.argv.index('--port') + 1]) if '--port' in sys.argv else 8790
    date = sys.argv[sys.argv.index('--date') + 1] if '--date' in sys.argv else '2026-03-02'
    work = tempfile.mkdtemp(prefix='doldari_example_')
    srv = subprocess.Popen([sys.executable, '-B', os.path.join(HERE, 'server.py'), '--port', str(port), '--work', work, '--no-browser'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

    def api(p, b=None):
        r = urllib.request.Request('http://127.0.0.1:%d%s' % (port, p), data=None if b is None else json.dumps(b).encode(), headers={'Content-Type': 'application/json'})
        return json.loads(urllib.request.urlopen(r, timeout=300).read())
    try:
        for _ in range(120):
            try:
                api('/api/state'); break
            except Exception:
                time.sleep(0.25)
        api('/api/settings', {'model': '', 'org': '가온우체국 영업과 우편영업실', 'handover_from': '김전임(가상)', 'handover_to': '이신규(가상)', 'witness': '우편영업과장', 'handover_date': date})
        api('/api/extract', {'folder': folder})
        while api('/api/state').get('extracting') or not api('/api/state')['files']:
            time.sleep(0.3)
        api('/api/draft', {})
        time.sleep(0.5)
        while api('/api/state')['running']:
            time.sleep(0.3)
        files = api('/api/export', {})['files']
        os.makedirs(out, exist_ok=True)
        names = {'.docx': '예시_인수인계서.docx', '.md': '예시_인수인계서.md', '.txt': '예시_온나라_붙여넣기.txt', '.csv': '예시_원본지문.csv'}
        for f in files:
            for ext, name in names.items():
                if f.endswith(ext):
                    shutil.copyfile(os.path.join(work, f), os.path.join(out, name))
        st = api('/api/state')
        print('만듦: %s (읽은 파일 %d · 못 읽은 %d · 항목 %d)' % (out, len(st['files']), st.get('n_fail', 0), st.get('n_items', 0)))
        return work
    finally:
        srv.terminate()
        try:
            srv.wait(timeout=10)
        except subprocess.TimeoutExpired:
            srv.kill()


if __name__ == '__main__':
    main()
