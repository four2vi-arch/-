#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""돌다리 v1.0 · 관문 ② 실측: 로컬 모델로 출처 달린 인수인계 초안을 만들고 정답표로 채점한다.

쓰임:
  python measure.py <업무폴더> <정답표.xlsx> <결과 폴더> --url http://127.0.0.1:11434/v1/chat/completions --model exaone3.5:7.8b [--key ...]
  python measure.py <업무폴더> <정답표.xlsx> <결과 폴더> --model fake      (모델 없이 배관 점검: 정답을 그대로 돌려주는 가짜 모델)
  python measure.py <업무폴더> <정답표.xlsx> <결과 폴더> --model noisy     (절반만 맞고 지어낸 항목을 섞는 가짜 모델: 채점기 점검)

하는 일:
  1) extract.py로 폴더를 읽는다(원본 읽기 전용, SHA-256 대조).
  2) 파일마다 모델에 「이 문서에서 후임자에게 필요한 항목을 JSON으로」 묻는다. 출처(파일·위치·원문 발췌)를 반드시 붙이게 한다.
  3) 모델이 낸 항목의 발췌가 그 파일의 글자에 실제로 있는지 확인한다(없으면 「지어낸 항목」).
  4) 정답표와 대조해 「출처까지 맞은 정답 비율」·「초안 항목 중 정답에 있는 비율」·「지어낸 항목 비율」·처리 시간을 낸다.
  5) 결과 폴더에 결과.md(표), 결과.json(항목별 상세), 인수인계_초안.md(출처 달린 초안)를 쓴다.

관문 ②(10.20.): CPU 로컬 모델 1종 20분 안, 출처까지 맞은 항목 70% 이상, 지어낸 항목 5% 이하.
"""
import os, sys, re, json, time, argparse, urllib.request, urllib.error, datetime, platform
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract as EX

SYS = ('너는 공공기관 인수인계 도우미다. 전임자의 업무 문서 하나를 읽고 후임자에게 필요한 항목만 뽑아 JSON 객체 하나로만 답하라. '
       '형식: {"items":[{"type":"월별 할 일|협의할 사람|진행 중 현안","text":"한 줄 요약","when":"시기(연월 또는 날짜, 없으면 빈 문자열)","quote":"문서 원문에서 그대로 옮긴 한 구절(20~60자)"}]} '
       '규칙: 문서에 없는 내용은 절대 만들지 마라. quote는 반드시 문서에 있는 글자를 그대로 복사하라. 해당 항목이 없으면 {"items":[]}로 답하라. 설명문·코드 펜스 없이 JSON만.')


def norm(s):
    return re.sub(r'\s+', '', str(s or '')).lower()


def parse_json_loose(s):
    s = re.sub(r'<think>[\s\S]*?</think>', '', str(s or ''))
    s = re.sub(r'```[a-zA-Z]*', '', s)
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
                if depth == 0:
                    try:
                        return json.loads(s[i:k + 1])
                    except Exception:
                        break
            k += 1
        i = s.find('{', i + 1)
    return None


def call_model(url, model, key, text, timeout=600):
    body = {'model': model, 'temperature': 0, 'stream': False, 'response_format': {'type': 'json_object'},
            'messages': [{'role': 'system', 'content': SYS}, {'role': 'user', 'content': text}]}
    req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), headers={'Content-Type': 'application/json'} | ({'Authorization': 'Bearer ' + key} if key else {}))
    with urllib.request.urlopen(req, timeout=timeout) as r:
        j = json.loads(r.read().decode('utf-8'))
    c = (j.get('choices') or [{}])[0].get('message', {}).get('content') or j.get('message', {}).get('content') or ''
    usage = j.get('usage') or {}
    return c, usage


def load_answers(path):
    import openpyxl
    ws = openpyxl.load_workbook(path, read_only=True).active
    rows = list(ws.iter_rows(values_only=True))[1:]
    return [{'no': r[0], 'type': r[1], 'text': r[2], 'when': r[3] or '', 'file': r[4], 'loc': r[5], 'quote': r[6]} for r in rows if r and r[1]]


def sim(a, b):
    """글자 2-gram 자카드 유사도(띄어쓰기 무시)"""
    a, b = norm(a), norm(b)
    if len(a) < 2 or len(b) < 2:
        return 1.0 if a == b else 0.0
    A = {a[i:i + 2] for i in range(len(a) - 1)}
    B = {b[i:i + 2] for i in range(len(b) - 1)}
    return len(A & B) / len(A | B)


def fake_model(kind, fobj, answers):
    """fake: 그 파일의 정답을 그대로. noisy: 홀수 번째 정답만 + 지어낸 항목 1개."""
    mine = [a for a in answers if a['file'] == fobj['file']]
    items = [{'type': a['type'], 'text': a['text'], 'when': a['when'], 'quote': a['quote']} for a in mine]
    if kind == 'noisy':
        items = items[::2] + [{'type': '진행 중 현안', 'text': '지어낸 현안(시험용)', 'when': '', 'quote': '이 문장은 문서에 없습니다'}]
    return json.dumps({'items': items}, ensure_ascii=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('folder'); ap.add_argument('answers'); ap.add_argument('out')
    ap.add_argument('--url', default='http://127.0.0.1:11434/v1/chat/completions')
    ap.add_argument('--model', required=True); ap.add_argument('--key', default='')
    ap.add_argument('--max-chars', type=int, default=6000, help='한 번에 모델에 넣는 글자 수 상한(긴 파일은 나눔)')
    ap.add_argument('--label', default='', help='결과표에 적을 PC 사양 등')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    t_all = time.time()
    files, failures, fps = EX.extract_folder(a.folder)
    t_extract = time.time() - t_all
    answers = load_answers(a.answers)
    texts = {f['file']: '\n'.join(u['text'] for u in f['units']) for f in files}
    draft, calls, errors = [], [], []
    for f in files:
        full = '\n'.join('[%s] %s' % (u['loc'], u['text']) for u in f['units'])
        chunks = [full[i:i + a.max_chars] for i in range(0, len(full), a.max_chars)] or ['']
        for ci, chunk in enumerate(chunks):
            prompt = '파일 이름: %s\n(문서 글자, 위치 표시는 [ ] 안)\n---\n%s' % (f['file'], chunk)
            t0 = time.time()
            try:
                if a.model in ('fake', 'noisy'):
                    content, usage = fake_model(a.model, f, answers), {}
                else:
                    content, usage = call_model(a.url, a.model, a.key, prompt)
                obj = parse_json_loose(content)
                items = (obj or {}).get('items') if isinstance(obj, dict) else None
                if items is None:
                    errors.append({'file': f['file'], 'chunk': ci, 'reason': 'JSON 아님', 'head': str(content)[:200]})
                    items = []
            except urllib.error.HTTPError as e:
                errors.append({'file': f['file'], 'chunk': ci, 'reason': 'HTTP %d' % e.code}); items = []
            except Exception as e:
                errors.append({'file': f['file'], 'chunk': ci, 'reason': str(e)[:160]}); items = []
            dt = time.time() - t0
            calls.append({'file': f['file'], 'chunk': ci, 'chars': len(chunk), 'sec': round(dt, 1), 'items': len(items), 'usage': usage})
            ftext = norm(texts[f['file']])
            for it in items:
                if not isinstance(it, dict):
                    continue
                q = str(it.get('quote') or '')
                grounded = bool(q) and norm(q) in ftext
                draft.append({'file': f['file'], 'type': str(it.get('type') or ''), 'text': str(it.get('text') or ''), 'when': str(it.get('when') or ''), 'quote': q, 'grounded': grounded})
    t_total = time.time() - t_all
    # 채점
    for d in draft:
        best, bs = None, 0.0
        for ans in answers:
            if ans['file'] != d['file'] or ans['type'] != d['type']:
                continue
            s = max(sim(ans['text'], d['text']), sim(ans['quote'], d['quote']))
            if s > bs:
                best, bs = ans, s
        d['match'] = best['no'] if best and bs >= 0.35 else None
        d['match_sim'] = round(bs, 2)
    matched = {d['match'] for d in draft if d['match']}
    n_ans, n_draft = len(answers), len(draft)
    n_fab = sum(1 for d in draft if not d['grounded'])
    n_in = sum(1 for d in draft if d['match'])
    n_hit = sum(1 for ans in answers if ans['no'] in matched and any(d['match'] == ans['no'] and d['grounded'] for d in draft))
    per_type = {}
    for ans in answers:
        per_type.setdefault(ans['type'], [0, 0]); per_type[ans['type']][1] += 1
        if any(d['match'] == ans['no'] and d['grounded'] for d in draft):
            per_type[ans['type']][0] += 1
    res = {'model': a.model, 'url': a.url, 'label': a.label, 'when': datetime.datetime.now().isoformat(timespec='seconds'), 'machine': platform.platform(),
           'files_total': len(fps), 'files_read': len(files), 'files_failed': len(failures), 'originals_changed': sum(1 for x in fps if not x['unchanged']),
           'calls': len(calls), 'sec_extract': round(t_extract, 1), 'sec_total': round(t_total, 1), 'sec_model_avg': round(sum(c['sec'] for c in calls) / max(1, len(calls)), 1),
           'answers': n_ans, 'draft_items': n_draft, 'hit_with_source': n_hit, 'draft_in_answers': n_in, 'fabricated': n_fab,
           'pct_hit_with_source': round(100.0 * n_hit / max(1, n_ans), 1), 'pct_draft_in_answers': round(100.0 * n_in / max(1, n_draft), 1), 'pct_fabricated': round(100.0 * n_fab / max(1, n_draft), 1),
           'per_type': per_type, 'errors': errors}
    gate = {'시간 20분 안': res['sec_total'] <= 1200, '출처까지 맞은 항목 70% 이상': res['pct_hit_with_source'] >= 70, '지어낸 항목 5% 이하': res['pct_fabricated'] <= 5}
    res['gate'] = gate
    with open(os.path.join(a.out, '결과.json'), 'w', encoding='utf-8') as f:
        json.dump({'summary': res, 'calls': calls, 'draft': draft, 'failures': failures, 'fingerprints': fps}, f, ensure_ascii=False, indent=1)
    with open(os.path.join(a.out, '결과.md'), 'w', encoding='utf-8') as f:
        f.write('# 돌다리 관문 ② 실측 결과\n\n모델 `%s` · %s · %s\n%s\n\n' % (a.model, res['when'], res['machine'], ('측정 환경: ' + a.label) if a.label else ''))
        f.write('| 항목 | 값 | 관문 기준 |\n|---|---|---|\n')
        f.write('| 파일 수(읽음/못 읽음/원본 변경) | %d (%d / %d / %d) | 못 읽은 파일 사유 표시, 원본 변경 0 |\n' % (res['files_total'], res['files_read'], res['files_failed'], res['originals_changed']))
        f.write('| 처리 시간(추출 / 전체) | %.1f초 / %.1f초 (모델 호출 %d회, 평균 %.1f초) | 20분(1,200초) 안 |\n' % (res['sec_extract'], res['sec_total'], res['calls'], res['sec_model_avg']))
        f.write('| 출처까지 맞은 정답 항목 | %d / %d = %.1f%% | 70%% 이상 |\n' % (n_hit, n_ans, res['pct_hit_with_source']))
        f.write('| 초안 항목 중 정답에 있는 비율 | %d / %d = %.1f%% | (참고) |\n' % (n_in, n_draft, res['pct_draft_in_answers']))
        f.write('| 지어낸 항목(발췌가 원문에 없음) | %d / %d = %.1f%% | 5%% 이하 |\n' % (n_fab, n_draft, res['pct_fabricated']))
        f.write('\n유형별 적중: ' + ' · '.join('%s %d/%d' % (k, v[0], v[1]) for k, v in per_type.items()) + '\n\n')
        f.write('관문 판정: ' + ' · '.join('%s %s' % ('○' if ok else '×', k) for k, ok in gate.items()) + '\n')
        if errors:
            f.write('\n오류 %d건: ' % len(errors) + '; '.join('%s(%s)' % (e['file'], e['reason']) for e in errors[:10]) + '\n')
        if failures:
            f.write('\n못 읽은 파일: ' + '; '.join('%s(%s)' % (x['file'], x['reason']) for x in failures) + '\n')
    with open(os.path.join(a.out, '인수인계_초안.md'), 'w', encoding='utf-8') as f:
        f.write('# 인수인계 초안(출처 달림, 전임자 확인 전)\n\n모델 `%s` · %s. 「확인 필요」는 발췌가 원문에서 확인되지 않은 항목이다.\n\n' % (a.model, res['when']))
        for kind in ['월별 할 일', '협의할 사람', '진행 중 현안']:
            f.write('## %s\n\n' % kind)
            for d in sorted([d for d in draft if d['type'] == kind], key=lambda d: d['when']):
                f.write('- %s%s%s\n  - 출처: %s · 「%s」\n' % (('[' + d['when'] + '] ') if d['when'] else '', d['text'], '' if d['grounded'] else ' **(확인 필요: 발췌가 원문에 없음)**', d['file'], d['quote']))
            f.write('\n')
        other = [d for d in draft if d['type'] not in ('월별 할 일', '협의할 사람', '진행 중 현안')]
        if other:
            f.write('## 분류 밖\n\n' + ''.join('- %s · %s\n' % (d['type'], d['text']) for d in other))
    print(open(os.path.join(a.out, '결과.md'), encoding='utf-8').read())


if __name__ == '__main__':
    main()
