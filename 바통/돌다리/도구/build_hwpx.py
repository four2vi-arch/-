#!/usr/bin/env python3
"""우정사업본부 표준양식(hwpx)을 틀로 삼아 본문만 갈아 끼운다.

서식(편집용지·제목표·글꼴·문단모양)은 한글이 직접 저장한 값을 그대로 쓴다.
새로 만들지 않으므로 어긋날 수 없다.
"""
import re, shutil, zipfile, tempfile, os, copy
from lxml import etree

NS = {'hp': 'http://www.hancom.co.kr/hwpml/2011/paragraph',
      'hs': 'http://www.hancom.co.kr/hwpml/2011/section'}
P = '{%s}p' % NS['hp']
RUN = '{%s}run' % NS['hp']
T = '{%s}t' % NS['hp']
LSA = '{%s}linesegarray' % NS['hp']

# 템플릿에 이미 정의된 스타일 ID
#   28번 중고딕은 파란색(설명용)이므로 쓰지 않는다. 검정은 31번.
#   휴먼명조 13pt(본문 괄호용)는 템플릿에 없어 새로 만든다 → id 90
#   ID 는 배열 순번이다. 새로 만들 때는 반드시 마지막 번호 다음을 이어 붙인다.
#   임의 번호(90 등)를 쓰면 한글이 찾지 못해 기본값으로 되돌아간다.
CHAR = {'제목': 7, '말머리': 27, '□': 30, '본문': 6, '요약어': 15,
        '각주': 31, '빈15': 6, '빈10': 16, '빈6': 17, '빈3': 20}
# 내어쓰기(HWPUNIT) — 부호와 뒤따르는 빈칸까지의 폭. 왼쪽 여백은 0.
HANG = {'□': 2440, 'ㅇ': 3074, '-': 3700, '*': 4423}
PARA = {'제목': 5, '빈': 14}
NEW_PARA = {}


def mkpara(para_id, runs):
    p = etree.Element(P)
    p.set('id', '0'); p.set('paraPrIDRef', str(para_id)); p.set('styleIDRef', '0')
    p.set('pageBreak', '0'); p.set('columnBreak', '0'); p.set('merged', '0')
    for cid, text in runs:
        r = etree.SubElement(p, RUN); r.set('charPrIDRef', str(cid))
        t = etree.SubElement(r, T); t.text = text
    return p


def runs_for(line):
    """한 줄을 런으로 쪼갠다. 핵심요약어는 볼드, 뒤쪽 괄호는 2pt 작게."""
    m = re.match(r'^(\s*[ㅇ○]\s*)(\([^)]{1,20}\))(.*)$', line)
    if m:
        head, kw, tail = m.groups()
        out = [(CHAR['본문'], head), (CHAR['요약어'], kw)]
        out += split_paren(tail, CHAR['본문'])
        return out
    if line.lstrip().startswith('□'):
        return [(CHAR['□'], line)]
    if line.lstrip().startswith('*'):
        return split_paren(line, CHAR['각주'])
    return split_paren(line, CHAR['본문'])


def split_paren(text, base):
    """문장 끝 괄호를 2pt 작은 글자로 분리."""
    parts, last = [], 0
    for m in re.finditer(r'\([^)]{1,40}\)', text):
        if m.start() > last:
            parts.append((base, text[last:m.start()]))
        parts.append((CHAR['괄호'] if base == CHAR['본문'] else base, m.group(0)))
        last = m.end()
    if last < len(text):
        parts.append((base, text[last:]))
    return parts or [(base, text)]


def gap_before(kind, prev):
    if kind == '□' and prev: return CHAR['빈15']
    if kind == 'ㅇ' and prev == '□': return CHAR['빈10']
    if kind == 'ㅇ' and prev in ('ㅇ', '-', '*'): return CHAR['빈6']
    if kind == '-' and prev in ('ㅇ', '-'): return CHAR['빈3']
    return None


def classify(line):
    s = line.lstrip()
    for k, sym in [('□', '□'), ('ㅇ', 'ㅇ'), ('ㅇ', '○'), ('-', '-'), ('*', '*')]:
        if s.startswith(sym): return k
    return '기타'


def patch_header(path):
    """본문 괄호용 휴먼명조 13pt 와 부호별 내어쓰기 문단모양을 추가한다.

    ID 는 기존 목록의 다음 번호를 순서대로 이어 붙인다.
    한글은 id 속성이 아니라 배열 순번으로 스타일을 찾기 때문이다.
    """
    h = open(path, encoding='utf-8').read()

    # --- charPr : 본문 괄호용 휴먼명조 13pt
    next_c = int(re.search(r'<hh:charProperties itemCnt="(\d+)"', h).group(1))
    base = re.search(r'<hh:charPr id="6".*?</hh:charPr>', h, re.S).group(0)
    cp = base.replace('id="6"', 'id="%d"' % next_c, 1)
    cp = re.sub(r'height="\d+"', 'height="1300"', cp, count=1)
    h = h.replace('</hh:charProperties>', cp + '</hh:charProperties>')
    h = h.replace('<hh:charProperties itemCnt="%d"' % next_c,
                  '<hh:charProperties itemCnt="%d"' % (next_c + 1))
    CHAR['괄호'] = next_c

    # --- paraPr : 부호별 내어쓰기
    next_p = int(re.search(r'<hh:paraProperties itemCnt="(\d+)"', h).group(1))
    pbase = re.search(r'<hh:paraPr id="14".*?</hh:paraPr>', h, re.S).group(0)
    add = ''
    NEW_PARA.clear()
    for kind in ('□', 'ㅇ', '-', '*'):
        p = pbase.replace('id="14"', 'id="%d"' % next_p, 1)
        p = re.sub(r'<hc:intent value="-?\d+"', '<hc:intent value="-%d"' % HANG[kind], p, count=1)
        p = re.sub(r'<hc:left value="-?\d+"', '<hc:left value="0"', p, count=1)
        add += p
        NEW_PARA[kind] = next_p
        next_p += 1
    h = h.replace('</hh:paraProperties>', add + '</hh:paraProperties>')
    h = h.replace('<hh:paraProperties itemCnt="%d"' % NEW_PARA['□'],
                  '<hh:paraProperties itemCnt="%d"' % next_p)
    open(path, 'w', encoding='utf-8').write(h)


def build(template, out, title, body_lines, head=None):
    tmp = tempfile.mkdtemp()
    with zipfile.ZipFile(template) as z:
        z.extractall(tmp)
    patch_header(os.path.join(tmp, 'Contents/header.xml'))
    sec = os.path.join(tmp, 'Contents/section0.xml')
    tree = etree.parse(sec)
    root = tree.getroot()
    tops = [c for c in root if c.tag == P]

    # 제목은 표(tbl > tr > tc > subList > p) 안에 있다. 전체를 훑어 교체한다.
    done = False
    for t in root.iter(T):
        if t.text and '표준보고서 양식' in t.text:
            t.text = title; done = True; break
    if not done:
        raise RuntimeError('템플릿에서 제목 자리를 찾지 못했습니다')

    # 말머리는 제목 표와 같은 문단 안의 런으로 들어 있다.
    # 대외용이면 그 런을 통째로 걷어내고, 내부용이면 텍스트만 바꾼다.
    for r in root.iter(RUN):
        for t in list(r.findall(T)):          # 표 안이 아닌, 런 바로 밑의 텍스트만
            if (t.text or '').lstrip().startswith('- ’26. 0.'):
                if head:
                    t.text = head
                else:
                    r.remove(t)

    # 본문 구간 = 말머리(있으면) 또는 첫 □ 문단부터 마지막 내용 문단까지
    def text_of(p):
        return ''.join(t.text or '' for t in p.iter(T))
    start = next(i for i, p in enumerate(tops)
                 if text_of(p).lstrip().startswith(('□', '- ’')))
    end = len(tops) - 1
    while end > start and not text_of(tops[end]).strip():
        end -= 1

    new = [mkpara(PARA['빈'], [(CHAR['빈15'], '')])]   # 제목 아래 15pt 빈 줄
    prev = None
    for line in body_lines:
        if not line.strip():
            continue
        k = classify(line)
        g = gap_before(k, prev)
        if g:
            new.append(mkpara(PARA['빈'], [(g, '')]))
        new.append(mkpara(NEW_PARA.get(k, NEW_PARA['ㅇ']), runs_for(line)))
        if k != '기타':
            prev = k

    # 제목과 본문 사이에 남은 템플릿 빈 문단 제거 (그림·표가 든 것은 보존)
    title_i = next(i for i, p in enumerate(tops) if p.iter('{%s}tbl' % NS['hp']).__next__() is not None) \
        if any(len(list(p.iter('{%s}tbl' % NS['hp']))) for p in tops) else 0
    for p in tops[title_i + 1:start]:
        if text_of(p).strip():
            continue
        if list(p.iter('{%s}pic' % NS['hp'])) or list(p.iter('{%s}tbl' % NS['hp'])):
            continue
        root.remove(p)

    anchor = tops[start]
    idx = list(root).index(anchor)
    for p in tops[start:end + 1]:
        root.remove(p)
    for off, p in enumerate(new):
        root.insert(idx + off, p)

    tree.write(sec, xml_declaration=True, encoding='UTF-8', standalone=True)

    if os.path.exists(out):
        os.remove(out)
    zf = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
    zf.write(os.path.join(tmp, 'mimetype'), 'mimetype', zipfile.ZIP_STORED)
    for base, _, files in os.walk(tmp):
        for f in files:
            full = os.path.join(base, f)
            rel = os.path.relpath(full, tmp)
            if rel == 'mimetype':
                continue
            zf.write(full, rel)
    zf.close()
    shutil.rmtree(tmp)
    return out
