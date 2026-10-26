#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""물어물어 AI 주소 정리 실측(선택, 브라우저 없이)

어르신 화면이 규칙만으로 확정하지 못한 문장을 모델에 보낼 때와 똑같은 요청(src/kiosk.js의 aiExtractRaw: 같은 지시문 SYS,
temperature 0, response_format json_object, system + user 문장 하나)을 이 PC의 Ollama(또는 OpenAI 호환 서버)에 보내,
모델별로 「JSON으로 답했는지·걸린 시간·뽑은 주소 조각」을 기록한다. 우편번호 재확인(고시 자료 대조)은 화면의 엔진이 하므로
이 도구는 「조각 정리」 단계만 잰다. 지시문은 src/kiosk.js에서 그대로 읽어 화면과 다를 수 없다.

사용(이 PC에 Ollama와 모델이 있을 때):
  python tools/ai_실측.py --model exaone3.5:7.8b
  python tools/ai_실측.py --model gemma3:4b --sentences ../모의데이터/어르신_입력_시연문장.txt --label "Ryzen 7 6800H, RAM 28GB, CPU"
결과: tools/out/AI실측_<모델>_<날짜>.json 과 .md(문장별 표). 문장 파일이 없으면 아래 기본 문장 2개만 쓴다.
보내는 것은 문장뿐이다(이름·전화 없음). 모델 주소는 127.0.0.1·localhost만 받는다(화면과 같은 제한).
"""
import argparse, datetime, json, os, re, sys, time, urllib.request, urllib.error, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DEFAULT_SENTENCES = ['우리 딸네 집인디 전주시 완산구 효자로 이백이십오 삼백이호여', '우리 딸이 도청에서 일허는디 거기로 보낼라고']
NOPROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # 이 PC 주소에 프록시를 거치지 않는다


def read_sys_prompt():
    """src/kiosk.js의 SYS 문자열(연결된 리터럴)을 그대로 읽는다."""
    s = open(os.path.join(ROOT, 'src', 'kiosk.js'), encoding='utf-8').read()
    m = re.search(r"var SYS = ((?:'[^'\\]*(?:\\.[^'\\]*)*'\s*\+?\s*)+);", s)
    if not m:
        raise SystemExit('src/kiosk.js에서 SYS 지시문을 찾지 못했습니다')
    parts = re.findall(r"'([^'\\]*(?:\\.[^'\\]*)*)'", m.group(1))
    return ''.join(p.encode('utf-8').decode('unicode_escape').encode('latin-1').decode('utf-8') if '\\' in p else p for p in parts)


def is_local(url):
    h = urllib.parse.urlsplit(url).hostname or ''
    return h in ('127.0.0.1', 'localhost', '::1')


def parse_json_loose(c):
    """kiosk.js parseJsonLoose와 같은 규칙: <think>와 코드 표시를 지우고 중괄호 짝이 맞는 첫 JSON 객체 하나."""
    s = re.sub(r'<think>[\s\S]*?</think>', '', str(c or ''))
    s = re.sub(r'```[a-z]*', '', s, flags=re.I)
    i = s.find('{')
    while i >= 0:
        depth, in_str, k = 0, False, i
        while k < len(s):
            ch = s[k]
            if in_str:
                if ch == '\\':
                    k += 1
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if not depth:
                    try:
                        return json.loads(s[i:k + 1])
                    except Exception:
                        break
            k += 1
        i = s.find('{', i + 1)
    return None


def ask(url, model, key, sys_prompt, text, timeout=25):
    body = {'model': model, 'temperature': 0, 'stream': False, 'response_format': {'type': 'json_object'},
            'messages': [{'role': 'system', 'content': sys_prompt}, {'role': 'user', 'content': text}]}
    headers = {'Content-Type': 'application/json'}
    if key:
        headers['Authorization'] = 'Bearer ' + key
    req = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=False).encode('utf-8'), headers=headers)
    t0 = time.time()
    with NOPROXY.open(req, timeout=timeout) as r:
        j = json.loads(r.read().decode('utf-8'))
    content = ((j.get('choices') or [{}])[0].get('message') or {}).get('content') or (j.get('message') or {}).get('content') or ''
    return content, round(time.time() - t0, 1)


def main():
    ap = argparse.ArgumentParser(description='물어물어 AI 주소 정리 실측')
    ap.add_argument('--model', required=True)
    ap.add_argument('--url', default='http://127.0.0.1:11434/v1/chat/completions')
    ap.add_argument('--key', default='')
    ap.add_argument('--sentences', default='', help='한 줄에 문장 하나(빈 줄·#으로 시작하는 줄은 뺌)')
    ap.add_argument('--label', default='', help='PC 사양 등 메모')
    ap.add_argument('--out', default=os.path.join(HERE, 'out'))
    a = ap.parse_args()
    if not is_local(a.url):
        raise SystemExit('모델 주소는 127.0.0.1·localhost만 받습니다(화면과 같은 제한): ' + a.url)
    sys_prompt = read_sys_prompt()
    sents = DEFAULT_SENTENCES
    if a.sentences:
        sents = [l.strip() for l in open(a.sentences, encoding='utf-8-sig') if l.strip() and not l.lstrip().startswith('#')]
    os.makedirs(a.out, exist_ok=True)
    rows = []
    print('모델 %s · 주소 %s · 문장 %d개 · 지시문 %d자' % (a.model, a.url, len(sents), len(sys_prompt)))
    for i, s in enumerate(sents, 1):
        row = {'n': i, 'sentence': s, 'ok_json': False, 'sec': None, 'error': '', 'pieces': None, 'raw': ''}
        try:
            content, sec = ask(a.url, a.model, a.key, sys_prompt, s)
            row['sec'] = sec; row['raw'] = content[:2000]
            o = parse_json_loose(content)
            if o is None:
                row['error'] = 'JSON 아님'
            else:
                row['ok_json'] = True
                row['pieces'] = {k: str(o.get(k, '')) for k in ('sido', 'sigungu', 'eupmyeondong', 'ri', 'road', 'buildingNo', 'jibun', 'buildingName', 'detail')}
                row['has_zip_like'] = bool(re.search(r'\b\d{5}\b', json.dumps(o, ensure_ascii=False)))   # 지시문대로 우편번호를 만들지 않았는지
        except urllib.error.HTTPError as e:
            row['error'] = 'HTTP %d' % e.code
        except Exception as e:
            row['error'] = ('시간 초과(25초)' if 'timed out' in str(e) else str(e))[:160]
        rows.append(row)
        print('%2d. %s → %s%s' % (i, s[:40], '조각 ' + json.dumps({k: v for k, v in (row['pieces'] or {}).items() if v}, ensure_ascii=False) if row['ok_json'] else row['error'], (' · %.1f초' % row['sec']) if row['sec'] is not None else ''))
    n_ok = sum(1 for r in rows if r['ok_json']); secs = [r['sec'] for r in rows if r['sec'] is not None]
    summary = {'model': a.model, 'url': a.url, 'label': a.label, 'date': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'), 'n': len(rows), 'json_ok': n_ok,
               'avg_sec': round(sum(secs) / len(secs), 1) if secs else None, 'zip_made': sum(1 for r in rows if r.get('has_zip_like')), 'sys_prompt': sys_prompt, 'rows': rows}
    stem = 'AI실측_%s_%s' % (re.sub(r'[^0-9A-Za-z가-힣._-]+', '_', a.model), datetime.datetime.now().strftime('%Y%m%d_%H%M'))
    with open(os.path.join(a.out, stem + '.json'), 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=1)
    md = ['# 물어물어 AI 주소 정리 실측 · %s' % a.model, '', '- 측정: %s · 주소 %s%s' % (summary['date'], a.url, (' · ' + a.label) if a.label else ''),
          '- 문장 %d개 중 JSON 답 %d개 · 평균 %s초 · 답 안에 5자리 숫자(우편번호 꼴) %d건' % (len(rows), n_ok, summary['avg_sec'], summary['zip_made']),
          '- 이 표는 「조각 정리」 단계만 잰 것이다. 우편번호 확정은 화면의 엔진이 고시 자료로 다시 한다.', '', '| 번호 | 문장 | 결과 | 초 | 뽑은 조각 |', '|---|---|---|---|---|']
    for r in rows:
        md.append('| %d | %s | %s | %s | %s |' % (r['n'], r['sentence'].replace('|', '｜'), 'JSON' if r['ok_json'] else r['error'], r['sec'] if r['sec'] is not None else '', json.dumps({k: v for k, v in (r['pieces'] or {}).items() if v}, ensure_ascii=False).replace('|', '｜')))
    with open(os.path.join(a.out, stem + '.md'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(md) + '\n')
    print('결과: %s' % os.path.join(a.out, stem + '.md'))


if __name__ == '__main__':
    main()
