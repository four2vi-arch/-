#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""시험용 가짜 Ollama(OpenAI 호환). 프롬프트 안의 문서 줄 가운데 「까지」·「담당」·「미조치」 줄을 그대로 발췌해 돌려주고,
파일마다 지어낸 항목 1개를 섞는다(근거 필터가 빼야 정상). 실행: python fake_ollama.py [포트=11435]"""
import json, re, sys, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, obj, code=200):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)

    def do_GET(self):
        if self.path == '/api/tags':
            return self._send({'models': [{'name': 'fake-exaone:test'}, {'name': 'fake-gemma:test'}]})
        self._send({'error': 'no'}, 404)

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self.rfile.read(n).decode('utf-8'))
        user = [m for m in body['messages'] if m['role'] == 'user'][0]['content']
        sysmsg = ''.join(m['content'] for m in body['messages'] if m['role'] == 'system')
        if 'slow' in body.get('model', ''):
            time.sleep(1.0)
        if '요지' in sysmsg:   # v3 문서 단위 프롬프트: 요지·할 일·기한·담당
            due = re.search(r'(\d{1,2})월\s*(\d{1,2})일\s*까지', user)
            title = re.search(r'제목:\s*(.+)', user)
            out = {'요지': (title.group(1).strip()[:50] if title else '문서') + '에 관한 문서', '할 일': '기한까지 제출·회신한다' if due else '', '기한': '', '담당': '', '상태': '진행 중'}
            if due:
                out['기한'] = '2026-%02d-%02d' % (int(due.group(1)), int(due.group(2)))   # 연도는 틀릴 수 있음 → 근거 확인이 걸러야 정상
            return self._send({'choices': [{'message': {'role': 'assistant', 'content': json.dumps(out, ensure_ascii=False)}}], 'usage': {'prompt_tokens': 100, 'completion_tokens': 30}})
        doc = user.split('---\n', 1)[-1]
        items = []
        for line in doc.split('\n'):
            raw = re.sub(r'^\[[^\]]*\]\s*', '', line).strip()
            if not raw:
                continue
            if re.search(r'까지', raw):
                items.append({'type': '월별 할 일', 'text': raw[:40], 'when': '', 'quote': raw})
            elif re.search(r'협의합니다|검토합니다|갱신합니다', raw):
                items.append({'type': '월별 할 일', 'text': raw[:40], 'when': '', 'quote': raw.replace('합니다', '한다')})  # 고쳐 쓴 발췌 → 발췌 보정
            elif re.search(r'미조치|반려|안 됨', raw):
                items.append({'type': '진행 중 현안', 'text': raw[:40], 'when': '', 'quote': raw.replace('습니다', '음')})  # 살짝 고쳐 씀 → 발췌 보정 대상
        items.append({'type': '진행 중 현안', 'text': '지어낸 현안(시험용)', 'when': '', 'quote': '이 문장은 문서에 없습니다'})
        self._send({'choices': [{'message': {'role': 'assistant', 'content': json.dumps({'items': items[:6]}, ensure_ascii=False)}}], 'usage': {'prompt_tokens': 100, 'completion_tokens': 50}})


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 11435
    print('fake ollama on 127.0.0.1:%d' % port, flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
