#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""돌다리 v1.0 · 관문 ② 실측(3차판, 2026-10-10): 규칙층 + 로컬 모델로 출처 달린 인수인계 초안을 만들고 정답표로 채점한다.

쓰임:
  python measure.py <업무폴더> <정답표.xlsx> <결과 폴더> --model exaone3.5:7.8b [--url ...] [--key ...] [--label "PC 사양"]
  python measure.py <업무폴더> <정답표.xlsx> <결과 폴더> --model none      (규칙층만, 모델 없이)
  python measure.py <업무폴더> <정답표.xlsx> <결과 폴더> --model fake      (정답을 그대로 돌려주는 가짜 모델: 배관 점검)
  python measure.py <업무폴더> <정답표.xlsx> <결과 폴더> --model exaone3.5:7.8b --replay <이전 결과.json>
                                                                            (모델을 다시 부르지 않고 이전 실측의 모델 답을 새 채점기로 다시 채점)

2차(10.10.)에서 고친 것(3차판)
  - 규칙층 확장: 기한 표현을 「○월 말/초/중순까지」·「○월 ○일~○일」·「2025-09-11」꼴 날짜(제출·기한 낱말과 함께)·「○개월/○주 전」까지 넓힘.
    전화번호 줄에서 이름은 「이름 담당/주무관/과장」 또는 번호 바로 앞 낱말을 쓴다(「복합기 · …」처럼 엉뚱한 낱말을 이름으로 쓰던 것 고침).
    「미조치·미결·반려·보류·지연·끝나지 않음·안 됨·재협의」 같은 현안 신호어가 든 줄은 「진행 중 현안」으로 뽑는다.
  - 근거 확인 보정: 발췌가 원문 한 줄(또는 이어진 두 줄)과 2-gram 70% 이상 겹치면 그 원문 줄로 바꿔 넣고 「발췌 보정」 표시. 발췌가 비었으면 요약이 원문 한 줄과 70% 이상 겹칠 때만 그 줄을 발췌로 붙인다. 그 밖은 여전히 「불확실(제외)」.
  - 채점: 정답과 같은 파일·같은 유형일 때, 요약·발췌 2-gram 유사도 0.35 이상이거나 짧은 쪽이 긴 쪽에 60% 이상 담기거나 발췌 줄이 서로 포함되면 적중. (같은 줄을 다른 말로 요약한 맞는 항목을 놓치던 것 고침)
  - 모델 호출이 HTTP 5xx로 실패하면 response_format 없이 한 번 다시 부른다(젬마 2차에서 2개 파일 HTTP 500).
  - --replay: 이전 결과.json의 모델 답을 그대로 쓰고 채점기만 바꿔 다시 채점한다(모델 재호출 없음, 시간은 이전 값을 그대로 적음).

1차(10.9.)에서 고친 것(2차판)
  - 규칙층: 「협의 담당: 이름(소속, 전화)」·전화번호가 있는 줄·기한(「○월 ○일까지」)이 있는 문장을 규칙으로 먼저 뽑는다(발췌는 원문 그대로라 언제나 근거 있음).
  - 모델: 유형 3가지를 정의·예시와 함께 주고, 발췌는 문서의 한 줄을 그대로 베끼게 한다. 유형이 셋 밖이면 규칙으로 바로잡는다.
  - 근거 확인: 발췌가 원문에 글자 그대로 있거나(띄어쓰기 무시) 거의 그대로(2-gram 90% 이상) 있으면 근거 있음. 근거 없는 모델 항목은 초안에 넣지 않고 「불확실(제외)」 목록으로 내린다(신청서 문구 그대로).
  - 윈도 경로(역슬래시)를 정답표와 같게 맞춘다.
"""
import os, sys, re, json, time, argparse, datetime, platform
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract as EX
from core import TYPES, norm, grams, sim, contain, line_overlap, build_draft, rule_items, grounded, source_lines, best_line, ground_fix, fix_type, parse_json_loose, call_model, name_near_phone, PHONE


def match_score(ans, d):
    if line_overlap(ans['quote'], d['quote']):
        return 1.0
    s = max(sim(ans['text'], d['text']), sim(ans['quote'], d['quote']))
    c = max(contain(ans['text'], d['text']), contain(ans['text'], d['quote']), contain(ans['quote'], d['text']))
    return max(s, 0.35 * c / 0.6)  # 담김 60%가 유사도 0.35와 같은 문턱이 되게


def load_answers(path):
    import openpyxl
    ws = openpyxl.load_workbook(path, read_only=True).active
    rows = list(ws.iter_rows(values_only=True))[1:]
    return [{'no': r[0], 'type': r[1], 'text': r[2], 'when': r[3] or '', 'file': str(r[4]).replace('\\', '/'), 'loc': r[5], 'quote': r[6]} for r in rows if r and r[1]]


def fake_model(kind, fobj, answers):
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
    ap.add_argument('--max-chars', type=int, default=6000)
    ap.add_argument('--label', default='')
    ap.add_argument('--tables', action='store_true', help='표 파일(엑셀·csv)도 모델에 보낸다(기본은 규칙층만)')
    ap.add_argument('--replay', default='', help='이전 결과.json: 모델을 다시 부르지 않고 그때의 모델 답을 새 채점기로 다시 채점')
    a = ap.parse_args()
    replay = None
    if a.replay:
        with open(a.replay, encoding='utf-8') as fh:
            replay = json.load(fh)
    os.makedirs(a.out, exist_ok=True)
    t_all = time.time()
    files, failures, fps = EX.extract_folder(a.folder)
    for f in files:
        f['file'] = f['file'].replace('\\', '/')
    for x in failures + fps:
        x['file'] = x['file'].replace('\\', '/')
    t_extract = time.time() - t_all
    answers = load_answers(a.answers)
    fake = (lambda fobj: fake_model(a.model, fobj, answers)) if a.model in ('fake', 'noisy') else None
    draft, dropped, calls, errors = build_draft(files, a.model, a.url, a.key, a.max_chars, include_tables=a.tables or a.model in ('fake', 'noisy'),
                                                fake=fake, replay=replay, max_calls_per_file=99)
    t_total = time.time() - t_all
    if replay is not None:  # 시간·호출 수는 이전 실측 값을 그대로 쓴다
        rs = replay['summary']
        t_extract, t_total, calls = rs['sec_extract'], rs['sec_total'], replay['calls']
        errors = rs.get('errors', []) + errors
    # 채점
    for d in draft:
        best, bs = None, 0.0
        for ans in answers:
            if ans['file'] != d['file'] or ans['type'] != d['type']:
                continue
            s = match_score(ans, d)
            if s > bs:
                best, bs = ans, s
        d['match'] = best['no'] if best and bs >= 0.35 else None
        d['match_sim'] = round(bs, 2)
    n_ans, n_draft, n_model_raw = len(answers), len(draft), sum(1 for d in draft if d['src'].startswith('모델')) + len(dropped)
    n_fixed = sum(1 for d in draft if d['src'] == '모델(발췌 보정)')
    n_hit = sum(1 for ans in answers if any(d['match'] == ans['no'] for d in draft))
    n_in = sum(1 for d in draft if d['match'])
    n_fab_draft = sum(1 for d in draft if not d['grounded'])
    per_type = {}
    for ans in answers:
        per_type.setdefault(ans['type'], [0, 0]); per_type[ans['type']][1] += 1
        if any(d['match'] == ans['no'] for d in draft):
            per_type[ans['type']][0] += 1
    res = {'model': a.model, 'url': a.url, 'label': a.label, 'when': datetime.datetime.now().isoformat(timespec='seconds'), 'machine': platform.platform(),
           'files_total': len(fps), 'files_read': len(files), 'files_failed': len(failures), 'originals_changed': sum(1 for x in fps if not x['unchanged']),
           'calls': len(calls), 'sec_extract': round(t_extract, 1), 'sec_total': round(t_total, 1), 'sec_model_avg': round(sum(c['sec'] for c in calls) / max(1, len(calls)), 1),
           'answers': n_ans, 'draft_items': n_draft, 'rule_items': sum(1 for d in draft if d['src'] == '규칙'), 'model_items_raw': n_model_raw, 'model_items_dropped': len(dropped),
           'hit_with_source': n_hit, 'draft_in_answers': n_in, 'fabricated_in_draft': n_fab_draft, 'model_items_fixed': n_fixed, 'replay_of': a.replay or '',
           'pct_hit_with_source': round(100.0 * n_hit / max(1, n_ans), 1), 'pct_draft_in_answers': round(100.0 * n_in / max(1, n_draft), 1),
           'pct_fabricated_in_draft': round(100.0 * n_fab_draft / max(1, n_draft), 1), 'pct_model_dropped': round(100.0 * len(dropped) / max(1, n_model_raw), 1),
           'per_type': per_type, 'errors': errors}
    gate = {'시간 20분 안': res['sec_total'] <= 1200, '출처까지 맞은 항목 70% 이상': res['pct_hit_with_source'] >= 70, '지어낸 항목 5% 이하(초안 기준)': res['pct_fabricated_in_draft'] <= 5}
    res['gate'] = gate
    with open(os.path.join(a.out, '결과.json'), 'w', encoding='utf-8') as f:
        json.dump({'summary': res, 'calls': calls, 'draft': draft, 'dropped': dropped, 'failures': failures, 'fingerprints': fps}, f, ensure_ascii=False, indent=1)
    with open(os.path.join(a.out, '결과.md'), 'w', encoding='utf-8') as f:
        f.write('# 돌다리 관문 ② 실측 결과(3차판 채점%s)\n\n모델 `%s` · %s · %s\n%s\n\n' % (', 이전 모델 답 재채점: ' + os.path.basename(os.path.dirname(a.replay) or a.replay) if a.replay else '', a.model, res['when'], res['machine'], ('측정 환경: ' + a.label) if a.label else ''))
        f.write('| 항목 | 값 | 관문 기준 |\n|---|---|---|\n')
        f.write('| 파일 수(읽음/못 읽음/원본 변경) | %d (%d / %d / %d) | 못 읽은 파일 사유 표시, 원본 변경 0 |\n' % (res['files_total'], res['files_read'], res['files_failed'], res['originals_changed']))
        f.write('| 처리 시간(추출 / 전체) | %.1f초 / %.1f초 (모델 호출 %d회, 평균 %.1f초) | 20분(1,200초) 안 |\n' % (res['sec_extract'], res['sec_total'], res['calls'], res['sec_model_avg']))
        f.write('| 초안 항목 수(규칙 / 모델) | %d (%d / %d) | |\n' % (n_draft, res['rule_items'], n_draft - res['rule_items']))
        f.write('| 출처까지 맞은 정답 항목 | %d / %d = %.1f%% | 70%% 이상 |\n' % (n_hit, n_ans, res['pct_hit_with_source']))
        f.write('| 초안 항목 중 정답에 있는 비율 | %d / %d = %.1f%% | (참고) |\n' % (n_in, n_draft, res['pct_draft_in_answers']))
        f.write('| 초안에 든 지어낸 항목 | %d / %d = %.1f%% | 5%% 이하 |\n' % (n_fab_draft, n_draft, res['pct_fabricated_in_draft']))
        f.write('| 모델이 낸 항목 중 발췌가 원문에 없어 뺀 것 | %d / %d = %.1f%% | (참고: 모델 자체의 정확도) |\n' % (len(dropped), n_model_raw, res['pct_model_dropped']))
        f.write('| 모델이 낸 항목 중 발췌를 원문 줄로 바로잡아 넣은 것 | %d / %d | (참고: 초안에 「발췌 보정」 표시) |\n' % (n_fixed, n_model_raw))
        f.write('\n유형별 적중: ' + ' · '.join('%s %d/%d' % (k, v[0], v[1]) for k, v in per_type.items()) + '\n\n')
        f.write('관문 판정: ' + ' · '.join('%s %s' % ('○' if ok else '×', k) for k, ok in gate.items()) + '\n')
        if errors:
            f.write('\n오류 %d건: ' % len(errors) + '; '.join('%s(%s)' % (e['file'], e['reason']) for e in errors[:10]) + '\n')
        if failures:
            f.write('\n못 읽은 파일: ' + '; '.join('%s(%s)' % (x['file'], x['reason']) for x in failures) + '\n')
    with open(os.path.join(a.out, '인수인계_초안.md'), 'w', encoding='utf-8') as f:
        f.write('# 인수인계 초안(출처 달림, 전임자 확인 전)\n\n모델 `%s` · %s. 항목마다 출처 파일과 원문 발췌를 붙였다. 발췌가 원문에서 확인되지 않은 모델 항목은 초안에 넣지 않고 맨 끝 「불확실(제외)」에 두었다. 「모델(발췌 보정)」은 모델이 쓴 발췌가 원문과 조금 달라 원문 줄로 바꿔 넣은 것이다.\n\n' % (a.model, res['when']))
        for kind in TYPES:
            f.write('## %s\n\n' % kind)
            for d in sorted([d for d in draft if d['type'] == kind], key=lambda d: (d['when'], d['file'])):
                f.write('- %s%s <small>(%s)</small>\n  - 출처: %s · 「%s」\n' % (('[' + d['when'] + '] ') if d['when'] else '', d['text'], d['src'], d['file'], d['quote'].replace('\n', ' / ')))
            f.write('\n')
        if dropped:
            f.write('## 불확실(제외): 발췌가 원문에 없음\n\n' + ''.join('- %s · %s · 「%s」\n' % (d['file'], d['text'], d['quote'][:80]) for d in dropped))
    print(open(os.path.join(a.out, '결과.md'), encoding='utf-8').read())


if __name__ == '__main__':
    main()
