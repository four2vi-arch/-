#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""공공API 길잡이 — 말 한 줄로 공공데이터 도구 만들기 (시제품 v0.1)

실행:  python apigil.py   (브라우저가 자동으로 열립니다)
- 파이썬 표준 라이브러리만 씁니다(설치할 것 없음).
- 이 PC(127.0.0.1)에서만 열리고, 인증키는 이 폴더의 config.json 에만 저장됩니다.
- AI(거대언어모델)는 선택입니다. OpenAI 호환 주소(로컬 모델·AI 공통기반 등)를 넣으면
  말뜻을 알아듣고 API를 골라 주며, 없으면 낱말 검색으로 동작합니다.
- AI는 '고르고 설명'만 합니다. 도구는 검증된 명세(카탈로그)와 정해진 틀로 만듭니다.
"""
import json, os, re, sys, time, math, secrets, threading, webbrowser, datetime
import urllib.request, urllib.parse, urllib.error
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

APP, VER = '공공API 길잡이', '0.1.6'
BASE = os.path.dirname(sys.executable if getattr(sys, 'frozen', False) else os.path.abspath(__file__))
CFG_PATH = os.path.join(BASE, 'config.json')
CAT_PATH = os.path.join(BASE, 'catalog.json')
OUT_DIR = os.path.join(BASE, '만든도구')
TOKEN = secrets.token_hex(16)

# ---------------------------------------------------------------------------------------------
# 공통 핵심(CORE) — 길잡이와 '만든 도구'가 같은 코드를 씁니다(만든 도구에 그대로 들어감).
# ---------------------------------------------------------------------------------------------
CORE = r'''
import json, re, time, datetime, os, urllib.request, urllib.parse, urllib.error
import xml.etree.ElementTree as ET

ERR_KO = {
    '10': '요청 값의 이름·형식이 맞지 않습니다(명세 확인).',
    '12': '없는 서비스이거나 주소가 바뀌었습니다(호출 주소 확인).',
    '20': '이 인증키로는 쓸 수 없습니다. 공공데이터포털에서 이 API를 「활용신청」했는지 확인하세요.',
    '22': '오늘 쓸 수 있는 호출 횟수를 넘었습니다. 내일 다시 하거나 트래픽 증설을 신청하세요.',
    '23': '너무 빨리 여러 번 불렀습니다. 잠시 뒤 다시 하세요.',
    '30': '등록되지 않은 인증키입니다. 키를 정확히 넣었는지, 활용신청 승인이 났는지 확인하세요(승인 직후엔 1시간쯤 걸릴 수 있음).',
    '31': '인증키 사용 기한이 끝났습니다. 공공데이터포털에서 연장하세요.',
}
HTTP_KO = {
    400: '요청 형식이 맞지 않습니다. 번호 자릿수와 입력값을 확인하세요.',
    401: '인증키를 인식하지 못했습니다. 설정의 인증키를 다시 붙여 넣어 보세요.',
    403: '이 API를 쓸 권한이 아직 없습니다. 공공데이터포털에서 이 API를 「활용신청」했는지 확인하고, 승인 직후라면 1시간쯤 뒤에 다시 해 보세요.',
    404: '호출 주소가 맞지 않습니다(명세 확인 필요).',
    411: '요청 본문이 비어 있습니다. 조회할 번호를 넣어 주세요.',
    413: '한 번에 보낼 수 있는 양을 넘었습니다(예: 사업자번호는 1회 100개까지).',
    429: '짧은 시간에 너무 많이 불렀습니다. 잠시 뒤 다시 해 보세요.',
}
WEEK = '월화수목금토일'

def http_error_ko(code):
    if code in HTTP_KO: return HTTP_KO[code]
    if 500 <= code < 600: return '제공기관 서버에 문제가 있습니다. 잠시 뒤 다시 해 보세요.'
    return '서버가 %s 오류를 돌려줬습니다. 주소·키·활용신청을 확인하세요.' % code

def kma_grid(lat, lon):
    # 위경도 → 기상청 동네예보 격자(nx, ny). 기상청 공개 변환식(LCC).
    import math
    RE, GRID, SLAT1, SLAT2, OLON, OLAT, XO, YO = 6371.00877, 5.0, 30.0, 60.0, 126.0, 38.0, 43, 136
    D = math.pi / 180.0
    re_ = RE / GRID
    slat1, slat2, olon, olat = SLAT1 * D, SLAT2 * D, OLON * D, OLAT * D
    sn = math.log(math.cos(slat1) / math.cos(slat2)) / math.log(math.tan(math.pi * 0.25 + slat2 * 0.5) / math.tan(math.pi * 0.25 + slat1 * 0.5))
    sf = math.pow(math.tan(math.pi * 0.25 + slat1 * 0.5), sn) * math.cos(slat1) / sn
    ro = re_ * sf / math.pow(math.tan(math.pi * 0.25 + olat * 0.5), sn)
    ra = re_ * sf / math.pow(math.tan(math.pi * 0.25 + lat * D * 0.5), sn)
    theta = lon * D - olon
    if theta > math.pi: theta -= 2.0 * math.pi
    if theta < -math.pi: theta += 2.0 * math.pi
    theta *= sn
    return int(ra * math.sin(theta) + XO + 0.5), int(ro - ra * math.cos(theta) + YO + 0.5)

def kma_base(now=None):
    # 단기예보 발표 기준(02·05·08·11·14·17·20·23시, 발표 10분 뒤부터 조회).
    now = now or datetime.datetime.now()
    t = now - datetime.timedelta(minutes=15)
    hours = [h for h in (2, 5, 8, 11, 14, 17, 20, 23) if h <= t.hour]
    if not hours:
        t = t - datetime.timedelta(days=1)
        return t.strftime('%Y%m%d'), '2300'
    return t.strftime('%Y%m%d'), '%02d00' % hours[-1]

def dynamic_default(kind, now=None):
    now = now or datetime.datetime.now()
    if kind == 'year': return now.strftime('%Y')
    if kind == 'month': return now.strftime('%m')
    if kind == 'date': return now.strftime('%Y%m%d')
    if kind == 'kma_date': return kma_base(now)[0]
    if kind == 'kma_time': return kma_base(now)[1]
    return ''

def build_request(spec, params, key):
    q = dict(spec.get('fixed') or {})
    body = None
    for p in spec['params']:
        name, v = p['name'], params.get(p['name'], '')
        v = '' if v is None else str(v).strip()
        if v == '':
            if p.get('required'):
                raise ValueError('「%s」 값을 넣어 주세요.' % p.get('label', name))
            continue
        if p.get('in') == 'body':
            body = body or {}
            if p.get('kind') == 'list':
                body[name] = [x.replace('-', '') for x in re.split(r'[,\s]+', v) if x]
            else:
                body[name] = v
        else:
            q[name] = v
    kp = spec.get('key_param')
    if kp:
        k = (key or '').strip()
        if not k:
            if spec.get('key_type') == 'juso':
                raise ValueError('주소정보누리집 승인키가 없습니다. 「설정」의 「주소정보누리집 승인키」 칸에 넣어 주세요.')
            raise ValueError('공공데이터포털 인증키가 없습니다. 「설정」의 「공공데이터포털 인증키」 칸에 넣어 주세요.')
        if '%' in k:                      # 인코딩된 키를 붙여 넣은 경우 한 번 풀어서 이중 인코딩을 막는다
            k = urllib.parse.unquote(k)
        q[kp] = k
    url = spec['url'] + ('&' if '?' in spec['url'] else '?') + urllib.parse.urlencode(q)
    headers = {'Accept': 'application/json, application/xml;q=0.9, */*;q=0.5', 'User-Agent': 'apigil/0.1'}
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    return urllib.request.Request(url, data=data, headers=headers, method=spec.get('method', 'GET').upper())

def xml_obj(el):
    kids = list(el)
    if not kids:
        return (el.text or '').strip()
    out = {}
    for c in kids:
        v = xml_obj(c)
        if c.tag in out:
            if not isinstance(out[c.tag], list): out[c.tag] = [out[c.tag]]
            out[c.tag].append(v)
        else:
            out[c.tag] = v
    return out

def parse_body(raw):
    txt = raw.decode('utf-8', 'replace').lstrip('\ufeff').strip()
    if txt[:1] in '{[':
        return json.loads(txt)
    root = ET.fromstring(txt)
    return {root.tag: xml_obj(root)}

def find_error(obj):
    if not isinstance(obj, dict): return None
    g = obj.get('OpenAPI_ServiceResponse')
    if isinstance(g, dict):
        h = g.get('cmmMsgHeader') or {}
        code = str(h.get('returnReasonCode', '')).strip()
        return ERR_KO.get(code, '') + ' [%s %s]' % (h.get('returnAuthMsg', ''), code)
    r = obj.get('response')
    if isinstance(r, dict) and isinstance(r.get('header'), dict):
        code = str(r['header'].get('resultCode', '')).strip()
        if code not in ('', '00', '0', '0000', 'INFO-000'):
            return '%s [%s]' % (r['header'].get('resultMsg', '오류'), code)
    res = obj.get('results')
    if isinstance(res, dict) and isinstance(res.get('common'), dict):
        c = res['common']
        if str(c.get('errorCode', '0')) != '0':
            return '%s [%s]' % (c.get('errorMessage', '오류'), c.get('errorCode'))
    if len(obj) == 1:                     # 우정사업본부 계열: <...Response><cmmMsgHeader>
        root = next(iter(obj.values()))
        if isinstance(root, dict) and isinstance(root.get('cmmMsgHeader'), dict):
            h = root['cmmMsgHeader']
            code = str(h.get('returnCode', '00')).strip()
            if str(h.get('successYN', 'Y')).strip().upper() == 'N' or code not in ('00', '0', ''):
                return '%s [%s]' % (h.get('errMsg') or '조회 결과가 없습니다', code)
    if 'code' in obj and 'msg' in obj and not obj.get('data'):
        return '%s [%s]' % (obj.get('msg'), obj.get('code'))
    return None

def get_path(obj, path):
    cur = obj
    for part in [p for p in (path or '').split('.') if p]:
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return []
    if cur in (None, ''): return []
    if isinstance(cur, dict): return [cur]
    return cur if isinstance(cur, list) else []

def flat(item):
    if not isinstance(item, dict): return {'값': str(item)}
    return {k: ('' if v is None else str(v)) for k, v in item.items() if not isinstance(v, (dict, list))}

def call_api(spec, params, key, timeout=20):
    req = build_request(spec, params, key)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    obj = parse_body(raw)
    err = find_error(obj)
    rows = [] if err else [flat(x) for x in get_path(obj, spec.get('list_path'))]
    return {'error': err, 'rows': rows, 'bytes': len(raw), 'url': mask(req.full_url, spec.get('key_param'))}

def mask(url, kp):
    if not kp: return url
    return re.sub(r'([?&]%s=)[^&]*' % re.escape(kp), r'\1***', url)

def fmt_value(kind, v):
    v = '' if v is None else str(v)
    if kind == 'date' and re.fullmatch(r'\d{8}', v):
        try:
            d = datetime.date(int(v[:4]), int(v[4:6]), int(v[6:]))
            return '%s (%s)' % (d.isoformat(), WEEK[d.weekday()])
        except ValueError:
            return v
    if kind == 'time' and re.fullmatch(r'\d{4}', v):
        return v[:2] + ':' + v[2:]
    if kind == 'bizno' and re.fullmatch(r'\d{10}', v):
        return '%s-%s-%s' % (v[:3], v[3:5], v[5:])
    return v

def transform(spec, rows):
    # 사람이 읽기 좋게: 세로로 긴 자료 펼치기(pivot) → 코드 풀이 → 날짜·번호 모양 다듬기.
    pv = spec.get('pivot')
    if pv:
        out, order = {}, []
        for r in rows:
            k = tuple(r.get(x, '') for x in pv['index'])
            if k not in out:
                out[k] = {x: r.get(x, '') for x in pv['index']}
                order.append(k)
            c = r.get(pv['col'])
            if pv.get('keep') and c not in pv['keep']:
                continue
            out[k][c] = r.get(pv['val'], '')
        rows = [out[k] for k in order]
    codes, fmts = spec.get('codes') or {}, spec.get('fmt') or {}
    for r in rows:
        for k, v in list(r.items()):
            if isinstance(v, str) and v.strip().lower() in ('null', 'none', 'nan'):
                r[k] = ''
        for f, m in codes.items():
            if f in r and str(r[f]) in m:
                r[f] = m[str(r[f])]
        for f, kind in fmts.items():
            if f in r:
                r[f] = fmt_value(kind, r[f])
    return rows

def columns(spec, rows):
    names = spec.get('fields') or {}
    show = spec.get('show')
    if show:
        keys = [k for k in show if any(k in r for r in rows)]
    else:
        keys = [k for k in names if any(k in r for r in rows)]
        for r in rows:
            for k in r:
                if k not in keys and not k.startswith('_'): keys.append(k)
    if any('_오류' in r for r in rows): keys.append('_오류')
    return keys, [names.get(k, '오류' if k == '_오류' else k) for k in keys]

def split_values(v, pattern=None):
    # 여러 건 입력: 쉼표·줄바꿈으로 구분하거나, 번호가 든 txt·csv 파일 경로를 넣는다.
    v = '' if v is None else str(v).strip()
    if v and len(v) < 260 and os.path.isfile(v):
        with open(v, encoding='utf-8-sig', errors='replace') as f:
            v = f.read()
    text = v.replace('-', '')
    if pattern:
        vals = re.findall(pattern, text)
        bad = [t for t in re.findall(r'\d+', text) if not re.fullmatch(pattern, t)]
    else:
        vals, bad = [t for t in re.split(r'[,\s]+', text) if t], []
    seen, out = set(), []
    for x in vals:
        if x not in seen:
            seen.add(x); out.append(x)
    return out, bad

def call_all(spec, params, key, limit=None, pause=0.15, progress=None):
    # 한 건이면 그대로, 여러 건(multi)이면 건마다, 목록(list+chunk)이면 묶음마다 불러 한 표로 합친다.
    mp = next((p for p in spec['params'] if p.get('kind') == 'multi'), None)
    lp = next((p for p in spec['params'] if p.get('kind') == 'list' and p.get('chunk')), None)
    target = mp or lp
    if not target:
        r = call_api(spec, params, key)
        r['rows'] = transform(spec, r['rows'])
        r.update(total=1, used=1, bad=[])
        return r
    vals, bad = split_values(params.get(target['name'], ''), target.get('pattern'))
    if not vals:
        raise ValueError('「%s」에서 올바른 번호를 찾지 못했습니다.' % target.get('label', target['name']))
    total = len(vals)
    if limit:
        vals = vals[:limit]
    rows, url = [], ''
    if mp:
        for i, v in enumerate(vals):
            try:
                r = call_api(spec, dict(params, **{mp['name']: v}), key)
            except urllib.error.HTTPError as e:
                if i == 0 or e.code in (401, 403):
                    raise
                rows.append({mp['name']: v, '_오류': http_error_ko(e.code)})
                continue
            url = url or r['url']
            if r['error']:
                if i == 0 and ('인증키' in r['error'] or '활용신청' in r['error']):
                    return {'error': r['error'], 'rows': [], 'url': r['url']}
                rows.append({mp['name']: v, '_오류': r['error']})
            else:
                for x in r['rows'] or [{mp['name']: v, '_오류': '조회 결과가 없습니다'}]:
                    x.setdefault(mp['name'], v)
                    rows.append(x)
            if progress: progress(i + 1, len(vals))
            if pause and i < len(vals) - 1:
                time.sleep(pause)
    else:
        n = int(lp['chunk'])
        for i in range(0, len(vals), n):
            r = call_api(spec, dict(params, **{lp['name']: ','.join(vals[i:i + n])}), key)
            url = url or r['url']
            if r['error']:
                return {'error': r['error'], 'rows': [], 'url': r['url']}
            rows.extend(r['rows'])
            if progress: progress(min(i + n, len(vals)), len(vals))
    return {'error': None, 'rows': transform(spec, rows), 'url': url, 'total': total, 'used': len(vals), 'bad': bad}
'''
exec(CORE, globals())

# ---------------------------------------------------------------------------------------------
# 카탈로그 — '도구까지 만들 수 있는' 검증 대상 API(명세를 사람이 확인한 것만 넣는다)
#   verified: 실제 키로 호출해 확인했는지. 시제품 단계라 모두 False에서 출발한다.
# ---------------------------------------------------------------------------------------------
PLACES = [  # 기상청 격자 변환용(대표 지점 위경도)
    ('서울 종로구', 37.5735, 126.9790), ('세종시', 36.4800, 127.2890), ('전주시', 35.8242, 127.1480),
    ('정읍시', 35.5699, 126.8559), ('광주 서구', 35.1520, 126.8900), ('부산 연제구', 35.1760, 129.0800),
    ('대구 중구', 35.8690, 128.6062), ('대전 서구', 36.3550, 127.3840), ('제주시', 33.4996, 126.5312)]

GRADE = {'1': '좋음', '2': '보통', '3': '나쁨', '4': '매우나쁨'}
DEFAULT_CATALOG = [
    {'id': 'holiday', 'name': '특일 정보(공휴일)', 'org': '한국천문연구원', 'domain': '생활·일정',
     'desc': '연·월을 넣으면 그달의 공휴일(국경일·대체공휴일 포함) 목록을 줍니다.',
     'keywords': ['공휴일', '휴일', '특일', '쉬는 날', '대체공휴일', '근무일', '영업일', '달력', '일정'],
     'approval': '자동승인', 'license': '이용허락범위 제한 없음', 'key_type': 'data.go.kr',
     'method': 'GET', 'url': 'http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo',
     'key_param': 'ServiceKey', 'fixed': {'_type': 'json', 'numOfRows': '50'},
     'params': [{'name': 'solYear', 'label': '연도', 'required': True, 'kind': 'year'},
                {'name': 'solMonth', 'label': '월(두 자리)', 'required': True, 'kind': 'month'}],
     'list_path': 'response.body.items.item',
     'fields': {'locdate': '날짜', 'dateName': '공휴일 이름', 'isHoliday': '휴일 여부'},
     'show': ['locdate', 'dateName', 'isHoliday'], 'fmt': {'locdate': 'date'},
     'codes': {'isHoliday': {'Y': '예', 'N': '아니오'}},
     'ideas': ['행사·교육 일정을 잡을 때 공휴일 자동 제외', '월별 영업일 수 계산(실적 목표 일할 계산)', '민원 처리기한 계산 도우미'],
     'verified': True},
    {'id': 'forecast', 'name': '단기예보(동네예보)', 'org': '기상청', 'domain': '기상·재난',
     'desc': '지역(격자)을 고르면 앞으로 사흘간 기온·하늘·강수를 시간별 한 줄씩 정리해 줍니다.',
     'keywords': ['날씨', '기상', '예보', '기온', '비', '강수', '폭염', '한파', '행사', '야외'],
     'approval': '자동승인', 'license': '이용허락범위 제한 없음', 'key_type': 'data.go.kr',
     'method': 'GET', 'url': 'http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst',
     'key_param': 'serviceKey', 'fixed': {'dataType': 'JSON', 'numOfRows': '1000', 'pageNo': '1'},
     'params': [{'name': 'base_date', 'label': '발표일(YYYYMMDD)', 'required': True, 'kind': 'kma_date'},
                {'name': 'base_time', 'label': '발표시각(0200·0500…)', 'required': True, 'kind': 'kma_time'},
                {'name': 'nx', 'label': '격자 X', 'required': True, 'kind': 'kma_nx', 'default': '60'},
                {'name': 'ny', 'label': '격자 Y', 'required': True, 'kind': 'kma_ny', 'default': '127'}],
     'list_path': 'response.body.items.item',
     'pivot': {'index': ['fcstDate', 'fcstTime'], 'col': 'category', 'val': 'fcstValue',
               'keep': ['TMP', 'SKY', 'PTY', 'POP', 'PCP', 'REH', 'WSD']},
     'fields': {'fcstDate': '예보일', 'fcstTime': '시각', 'TMP': '기온(℃)', 'SKY': '하늘', 'PTY': '강수 형태',
                'POP': '강수확률(%)', 'PCP': '1시간 강수량', 'REH': '습도(%)', 'WSD': '풍속(m/s)'},
     'show': ['fcstDate', 'fcstTime', 'TMP', 'SKY', 'PTY', 'POP', 'PCP', 'REH', 'WSD'],
     'codes': {'SKY': {'1': '맑음', '3': '구름많음', '4': '흐림'},
               'PTY': {'0': '없음', '1': '비', '2': '비/눈', '3': '눈', '4': '소나기'}},
     'fmt': {'fcstDate': 'date', 'fcstTime': 'time'},
     'ideas': ['야외 행사 전날 비·기온 확인표', '폭염·한파 안내 문자 초안 만들기', '공중실 전광판 날씨 문구'],
     'verified': True},
    {'id': 'airkorea', 'name': '측정소별 실시간 대기오염', 'org': '한국환경공단(에어코리아)', 'domain': '환경',
     'desc': '측정소 이름을 넣으면 미세먼지·초미세먼지·통합대기환경지수를 시간별로 줍니다(등급은 좋음~매우나쁨으로 풀이).',
     'keywords': ['미세먼지', '초미세먼지', '대기', '공기', '황사', '마스크', '야외활동', '환경'],
     'approval': '자동승인', 'license': '이용허락범위 제한 없음', 'key_type': 'data.go.kr',
     'method': 'GET', 'url': 'http://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMsrstnAcctoRltmMesureDnsty',
     'key_param': 'serviceKey', 'fixed': {'returnType': 'json', 'numOfRows': '24', 'pageNo': '1', 'dataTerm': 'DAILY', 'ver': '1.0'},
     'params': [{'name': 'stationName', 'label': '측정소 이름(예: 종로구, 연지동)', 'required': True, 'default': '종로구'}],
     'list_path': 'response.body.items',
     'fields': {'dataTime': '측정 시각', 'pm10Value': '미세먼지(㎍/㎥)', 'pm10Grade': '미세먼지 등급',
                'pm25Value': '초미세먼지(㎍/㎥)', 'pm25Grade': '초미세먼지 등급', 'khaiValue': '통합대기환경지수',
                'khaiGrade': '통합지수 등급', 'o3Value': '오존(ppm)', 'o3Grade': '오존 등급', 'no2Value': '이산화질소(ppm)',
                'coValue': '일산화탄소(ppm)', 'so2Value': '아황산가스(ppm)'},
     'show': ['dataTime', 'pm10Value', 'pm10Grade', 'pm25Value', 'pm25Grade', 'khaiValue', 'khaiGrade', 'o3Value'],
     'codes': {g: GRADE for g in ('pm10Grade', 'pm25Grade', 'khaiGrade', 'o3Grade', 'no2Grade', 'coGrade', 'so2Grade')},
     'ideas': ['미세먼지 나쁨일 때 야외 행사 알림', '어린이·어르신 시설 안내문 자동 작성', '집배원 안전 공지'],
     'verified': True},
    {'id': 'bizstatus', 'name': '사업자등록 상태조회(휴·폐업)', 'org': '국세청', 'domain': '행정·계약',
     'desc': '사업자등록번호 여러 개(또는 번호가 든 파일)를 넣으면 계속·휴업·폐업 상태와 과세유형을 한 번에 확인합니다(100개씩 나눠 조회).',
     'keywords': ['사업자', '사업자등록번호', '휴업', '폐업', '거래처', '계약', '업체', '과세', '납세자'],
     'approval': '자동승인', 'license': '이용허락범위 제한 없음', 'key_type': 'data.go.kr',
     'method': 'POST', 'url': 'https://api.odcloud.kr/api/nts-businessman/v1/status',
     'key_param': 'serviceKey', 'fixed': {},
     'params': [{'name': 'b_no', 'label': '사업자등록번호(쉼표·줄바꿈으로 여러 개, 또는 번호가 든 txt·csv 파일 경로)',
                 'required': True, 'in': 'body', 'kind': 'list', 'chunk': 100, 'pattern': r'(?<!\d)\d{10}(?!\d)'}],
     'list_path': 'data',
     'fields': {'b_no': '사업자등록번호', 'b_stt': '상태', 'tax_type': '과세유형', 'end_dt': '폐업일',
                'tax_type_change_dt': '과세유형 전환일', 'invoice_apply_dt': '세금계산서 적용일', 'rbf_tax_type': '직전 과세유형',
                'utcc_yn': '단위과세 전환 여부'},
     'show': ['b_no', 'b_stt', 'tax_type', 'end_dt', 'tax_type_change_dt', 'rbf_tax_type'],
     'fmt': {'b_no': 'bizno', 'end_dt': 'date', 'tax_type_change_dt': 'date', 'invoice_apply_dt': 'date'},
     'ideas': ['계약·납품 업체 휴·폐업 일괄 확인', '협력업체 명단 정기 점검', '보조금 지급 전 사업자 상태 확인'],
     'verified': True},
    {'id': 'juso', 'name': '도로명주소 검색', 'org': '행정안전부(주소정보누리집)', 'domain': '주소·우편',
     'desc': '주소 일부를 넣으면 도로명·지번주소와 우편번호를 찾아 줍니다(주소정보누리집 승인키 필요).',
     'keywords': ['주소', '도로명', '지번', '우편번호', '주소록', '발송', '고지서', '배달'],
     'approval': '승인키 별도(주소정보누리집)', 'license': '주소정보누리집 이용약관', 'key_type': 'juso',
     'method': 'GET', 'url': 'https://business.juso.go.kr/addrlink/addrLinkApi.do',
     'key_param': 'confmKey', 'fixed': {'resultType': 'json', 'currentPage': '1', 'countPerPage': '20'},
     'params': [{'name': 'keyword', 'label': '찾을 주소', 'required': True, 'default': '세종대로 209'}],
     'list_path': 'results.juso',
     'fields': {'roadAddr': '도로명주소', 'jibunAddr': '지번주소', 'zipNo': '우편번호', 'bdNm': '건물명'},
     'show': ['roadAddr', 'jibunAddr', 'zipNo', 'bdNm'],
     'ideas': ['주소 한 건씩 확인·정정', '민원 신청서의 주소 표기 점검', '(일괄 처리는 「우편번호 자동검색기」 연계)'],
     'verified': True},
    {'id': 'regmail', 'name': '등기우편물 배달상태 일괄조회', 'org': '우정사업본부', 'domain': '우편·물류',
     'desc': '등기번호 여러 개(또는 번호가 든 파일)를 넣으면 건마다 우편물 종류·취급구분·배달상태·배달일시를 한 표로 정리합니다.',
     'keywords': ['등기', '등기번호', '배송', '배달', '배달조회', '송달', '우편물', '종적', '추적', '반송', '고지서', '통지서', '내용증명', '소포', '택배'],
     'approval': '활용신청(개발계정)', 'license': '공공데이터포털 이용조건 참조', 'key_type': 'data.go.kr',
     'method': 'GET', 'url': 'http://openapi.epost.go.kr/trace/retrieveLongitudinalService/retrieveLongitudinalService/getLongitudinalDomesticList',
     'key_param': 'serviceKey', 'fixed': {},
     'params': [{'name': 'rgist', 'label': '등기번호 13자리(쉼표·줄바꿈으로 여러 개, 또는 번호가 든 txt·csv 파일 경로)',
                 'required': True, 'kind': 'multi', 'pattern': r'(?<!\d)\d{13}(?!\d)'}],
     'list_path': 'LongitudinalDomesticListResponse',
     'fields': {'rgist': '등기번호', 'pstmtrKnd': '우편물 종류', 'trtmntSe': '취급구분', 'dlvySttus': '배달상태',
                'dlvyDe': '배달일시', 'applcntNm': '발송인', 'addrseNm': '수취인'},
     'show': ['rgist', 'pstmtrKnd', 'trtmntSe', 'dlvySttus', 'dlvyDe', 'applcntNm', 'addrseNm'],
     'ideas': ['다량 등기 발송 뒤 배달 상태 일괄 확인(미배달·반송 추적)', '고지서·통지서 송달 확인 대장 자동 작성', '민원 회신 등기의 배달 완료 확인'],
     'verified': True},
    {'id': 'regmail_hist', 'name': '등기우편물 배송 경로(종적) 조회', 'org': '우정사업본부', 'domain': '우편·물류',
     'desc': '등기번호 하나를 넣으면 접수부터 배달까지 날짜·시각·위치·처리현황을 순서대로 보여 줍니다.',
     'keywords': ['등기', '종적', '배송경로', '배송 조회', '위치', '처리현황', '배달', '우편물', '추적'],
     'approval': '활용신청(개발계정)', 'license': '공공데이터포털 이용조건 참조', 'key_type': 'data.go.kr',
     'method': 'GET', 'url': 'http://openapi.epost.go.kr/trace/retrieveLongitudinalService/retrieveLongitudinalService/getLongitudinalDomesticList',
     'key_param': 'serviceKey', 'fixed': {},
     'params': [{'name': 'rgist', 'label': '등기번호 13자리', 'required': True}],
     'list_path': 'LongitudinalDomesticListResponse.longitudinalDomesticList',
     'fields': {'dlvyDate': '날짜', 'dlvyTime': '시각', 'nowLc': '현재 위치', 'processSttus': '처리현황', 'detailDc': '상세설명'},
     'show': ['dlvyDate', 'dlvyTime', 'nowLc', 'processSttus', 'detailDc'],
     'ideas': ['민원인 문의 때 배송 경로 바로 안내', '배달 지연 구간 확인'],
     'verified': True},
]

SYN = {'공휴일': ['휴일', '특일', '빨간날', '쉬는날'], '날씨': ['기상', '예보', '기온'], '미세먼지': ['대기', '공기', 'pm'],
       '업체': ['사업자', '거래처', '휴업', '폐업'], '주소': ['도로명', '우편번호', '지번'],
       '등기': ['배송', '배달', '송달', '우편물', '종적']}


def load_json(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def catalog():
    extra = load_json(CAT_PATH, [])
    cat = {c['id']: c for c in DEFAULT_CATALOG}
    for c in extra if isinstance(extra, list) else []:
        if isinstance(c, dict) and c.get('id'):
            cat[c['id']] = c
    return cat


def cfg():
    c = load_json(CFG_PATH, {})
    return c if isinstance(c, dict) else {}


def save_cfg(c):
    with open(CFG_PATH, 'w', encoding='utf-8') as f:
        json.dump(c, f, ensure_ascii=False, indent=2)


def key_for(spec):
    c = cfg()
    return c.get('juso_key', '') if spec.get('key_type') == 'juso' else c.get('data_key', '')


def with_defaults(spec):
    s = json.loads(json.dumps(spec))
    for p in s['params']:
        if not p.get('default') and p.get('kind') in ('year', 'month', 'date', 'kma_date', 'kma_time'):
            p['default'] = dynamic_default(p['kind'])
    return s


# ---------------------------------------------------------------------------------------------
# 찾기 — 낱말 점수(항상) + AI 추천(연결했을 때만, 카탈로그 안에서만 고르게 하고 검증)
# ---------------------------------------------------------------------------------------------
def tokens(q):
    words = [w for w in re.split(r'[^0-9A-Za-z가-힣]+', q.lower()) if w]
    out = set(words)
    for w in words:
        for k, v in SYN.items():
            if w.startswith(k) or k in w:
                out.update(v); out.add(k)
            for s in v:
                if s in w:
                    out.add(k)
        if re.fullmatch(r'[가-힣]{3,}', w):  # 조사 붙은 말(공휴일을, 날씨는)도 걸리게 앞 두세 글자
            out.add(w[:2]); out.add(w[:3])
    return out


STOP = {'확인', '확인해', '하고', '싶어', '싶어요', '싶다', '궁금', '궁금해', '궁금해요', '알고', '알려', '보기', '조회', '정보',
        '방법', '어떻게', '있는지', '했는지', '한꺼', '한꺼번', '한꺼번에', '관련', '해주', '해줘', '해주세요', '하는', '되는', '됐는', '됐는지',
        '내일', '오늘', '다음', '이번', '우리', '좀', '빨리'}


def keyword_search(q, cat, n=3):
    toks = {t for t in tokens(q) if t not in STOP}
    scored = []
    for c in cat.values():
        hay_name, hay_kw = c['name'].lower(), ' '.join(c.get('keywords', [])).lower()
        hay_desc = (c.get('desc', '') + ' ' + ' '.join(c.get('ideas', []))).lower()
        s, hits = 0, []
        for t in toks:
            if len(t) < 2: continue
            w = (3 if t in hay_name else 0) + (2 if t in hay_kw else 0) + (1 if t in hay_desc else 0)
            if w: s += w; hits.append(t)
        if s: scored.append((s, c['id'], hits))
    scored.sort(key=lambda x: -x[0])
    if scored:
        cut = max(2, scored[0][0] * 0.2)          # 한 낱말만 스친 후보·1등의 20% 미만 후보만 뺀다(관련 후보는 남김)
        scored = [x for x in scored if x[0] >= cut]
    return [{'id': i, 'why': '겹치는 말: ' + ', '.join(sorted(set(h))[:5]), 'params': {}} for _, i, h in scored[:n]]


SYS_PICK = ('너는 공무원을 돕는 공공데이터 API 길잡이다. 사용자의 말과 아래 API 목록을 보고, 목록 안에서만 골라라. '
            '목록에 없는 API·파라미터를 지어내면 안 된다. 반드시 JSON 하나로만 답하라. 형식: '
            '{"picks":[{"id":"","why":"한 문장","params":{"파라미터이름":"값"}}],'
            '"ideas":[{"title":"만들 수 있는 것","ids":["id"],"how":"한두 문장"}]} '
            'picks는 최대 3개, ideas는 최대 4개. params는 사용자의 말에서 알 수 있는 값만 넣는다(예: 연도·월·측정소).')


def llm_call(messages, timeout=60):
    c = cfg().get('llm') or {}
    if not (c.get('url') and c.get('model')):
        return None
    headers = {'Content-Type': 'application/json'}
    if c.get('key'): headers['Authorization'] = 'Bearer ' + c['key']
    body = json.dumps({'model': c['model'], 'temperature': 0, 'stream': False, 'messages': messages}).encode('utf-8')
    req = urllib.request.Request(c['url'], data=body, headers=headers, method='POST')
    with urllib.request.urlopen(req, timeout=timeout) as r:
        j = json.loads(r.read().decode('utf-8'))
    content = ((j.get('choices') or [{}])[0].get('message') or {}).get('content') or (j.get('message') or {}).get('content') or ''
    m = re.search(r'\{[\s\S]*\}', content)
    return json.loads(m.group(0)) if m else None


def ai_pick(q, cat):
    brief = [{'id': c['id'], 'name': c['name'], 'org': c['org'], 'desc': c['desc'],
              'params': [{'name': p['name'], 'label': p['label']} for p in c['params']]} for c in cat.values()]
    t0 = time.time()
    out = llm_call([{'role': 'system', 'content': SYS_PICK},
                    {'role': 'user', 'content': '사용자 말: ' + q + '\nAPI 목록: ' + json.dumps(brief, ensure_ascii=False)}])
    if not isinstance(out, dict):
        return None
    picks, seen = [], set()
    for p in out.get('picks') or []:
        if not isinstance(p, dict) or p.get('id') not in cat or p['id'] in seen: continue
        seen.add(p['id'])
        names = {x['name'] for x in cat[p['id']]['params']}
        params = {k: str(v)[:60] for k, v in (p.get('params') or {}).items() if k in names and v not in (None, '')}
        picks.append({'id': p['id'], 'why': str(p.get('why', ''))[:120], 'params': params})
    ideas = []
    for i in out.get('ideas') or []:
        if not isinstance(i, dict): continue
        ids = [x for x in (i.get('ids') or []) if x in cat]
        if ids and i.get('title'):
            ideas.append({'title': str(i['title'])[:60], 'ids': ids, 'how': str(i.get('how', ''))[:160]})
    return {'picks': picks[:3], 'ideas': ideas[:4], 'ms': int((time.time() - t0) * 1000)}


def catalog_list():
    return [{'id': c['id'], 'name': c['name'], 'org': c['org'], 'domain': c.get('domain', ''), 'verified': bool(c.get('verified'))}
            for c in catalog().values()]


def spec_pick(api_id):
    cat = catalog()
    if api_id not in cat:
        return {'mode': 'list', 'picks': [], 'ideas': [], 'specs': {}}
    c = cat[api_id]
    return {'mode': 'list', 'picks': [{'id': api_id, 'why': '목록에서 직접 골랐습니다.', 'params': {}}],
            'ideas': [{'title': t, 'ids': [api_id], 'how': c['name'] + ' 활용'} for t in c.get('ideas', [])],
            'specs': {api_id: with_defaults(c)}}


def search(q):
    cat = catalog()
    res = {'mode': 'keyword', 'picks': keyword_search(q, cat), 'ideas': []}
    try:
        ai = ai_pick(q, cat)
    except Exception as e:
        ai, res['ai_error'] = None, 'AI 연결 실패: %s' % e.__class__.__name__
    if ai and ai['picks']:
        res.update(mode='ai', picks=ai['picks'], ideas=ai['ideas'], ms=ai['ms'])
    if not res['ideas']:
        for p in res['picks']:
            for t in cat[p['id']].get('ideas', [])[:2]:
                res['ideas'].append({'title': t, 'ids': [p['id']], 'how': cat[p['id']]['name'] + ' 활용'})
    res['specs'] = {p['id']: with_defaults(cat[p['id']]) for p in res['picks']}
    return res


# ---------------------------------------------------------------------------------------------
# 시험 호출 · 도구 만들기
# ---------------------------------------------------------------------------------------------
def test_call(api_id, params):
    cat = catalog()
    if api_id not in cat:
        return {'ok': False, 'message': '목록에 없는 API입니다.'}
    spec = cat[api_id]
    t0 = time.time()
    note = ''
    try:
        limit = 10 if any(p.get('kind') == 'multi' for p in spec['params']) else 100
        try:
            r = call_all(spec, params, key_for(spec), limit=limit)
        except urllib.error.HTTPError as e:
            alt = {'ServiceKey': 'serviceKey', 'serviceKey': 'ServiceKey'}.get(spec.get('key_param'))
            if e.code in (401, 403) and alt:
                spec = dict(spec, key_param=alt)
                r = call_all(spec, params, key_for(spec), limit=limit)
                note = ' (인증키 이름을 %s로 바꿔 성공)' % alt
            else:
                raise
        if r.get('total', 1) > r.get('used', 1):
            note += ' · 앞 %d건만 시험했습니다(전체 %d건은 만든 도구에서 처리)' % (r['used'], r['total'])
        if r.get('bad'):
            note += ' · 번호 형식이 아닌 값 %d개는 뺐습니다' % len(r['bad'])
    except ValueError as e:
        return {'ok': False, 'message': str(e)}
    except urllib.error.HTTPError as e:
        return {'ok': False, 'message': http_error_ko(e.code) + ' [HTTP %s]' % e.code}
    except Exception as e:
        return {'ok': False, 'message': '연결하지 못했습니다(%s). 인터넷이 되는 PC인지 확인하세요.' % e.__class__.__name__}
    ms = int((time.time() - t0) * 1000)
    if r['error']:
        return {'ok': False, 'message': r['error'], 'url': r['url'], 'ms': ms}
    keys, labels = columns(spec, r['rows'])
    return {'ok': True, 'count': len(r['rows']), 'labels': labels, 'note': note,
            'rows': [[row.get(k, '') for k in keys] for row in r['rows'][:20]], 'url': r['url'], 'ms': ms}


TOOL_TMPL = r'''# -*- coding: utf-8 -*-
# @@TITLE@@ — 「공공API 길잡이」로 만든 도구 (@@DATE@@)
# 출처: @@ORG@@ 「@@NAME@@」(공공데이터포털) · 이용허락범위: @@LICENSE@@
# 사용법: 같은 폴더의 설정.ini 에 인증키를 넣고 실행.bat 을 두 번 누르세요. 결과는 CSV(엑셀)로 저장됩니다.
# 인증키는 이 파일에 들어 있지 않습니다(설정.ini 에만 보관).
import os, sys, csv, configparser, urllib.error
@@CORE@@
SPEC = json.loads(r"""@@SPEC@@""")
PRESET = json.loads(r"""@@PRESET@@""")
HERE = os.path.dirname(os.path.abspath(__file__))

def load_key():
    if os.environ.get('APIGIL_KEY'): return os.environ['APIGIL_KEY']
    ini = configparser.ConfigParser()
    ini.read(os.path.join(HERE, '설정.ini'), encoding='utf-8')
    return ini.get('인증', '인증키', fallback='').strip()

def ask(p):
    d = PRESET.get(p['name']) or p.get('default') or dynamic_default(p.get('kind', ''))
    if p.get('kind') in ('multi', 'list'):
        print('※ 여러 개는 쉼표로 넣거나, 번호가 든 txt·csv 파일 경로를 넣으세요(엔터 = 기본값).')
    if os.environ.get('APIGIL_NONINTERACTIVE'): return d
    v = input('%s [%s]: ' % (p.get('label', p['name']), d)).strip()
    return v or d

def main():
    print('=' * 60); print(SPEC['name'], '—', SPEC['org']); print('=' * 60)
    key = load_key()
    if SPEC.get('key_param') and not key:
        print('설정.ini 에 인증키를 먼저 넣어 주세요.'); return 1
    params = {p['name']: ask(p) for p in SPEC['params']}
    prog = lambda i, n: print('  진행 %d/%d' % (i, n)) if n > 1 and (i % 10 == 0 or i == n) else None
    try:
        r = call_all(SPEC, params, key, progress=prog)
    except urllib.error.HTTPError as e:
        print('호출 실패:', http_error_ko(e.code), '[HTTP %s]' % e.code); return 1
    except Exception as e:
        print('호출 실패:', e); return 1
    if r['error']:
        print('오류:', r['error']); return 1
    keys, labels = columns(SPEC, r['rows'])
    name = '결과_' + datetime.datetime.now().strftime('%Y%m%d_%H%M%S') + '.csv'
    path = os.path.join(HERE, name)
    with open(path, 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.writer(f); w.writerow(labels)
        for row in r['rows']: w.writerow([row.get(k, '') for k in keys])
    print('%d건을 %s 에 저장했습니다.' % (len(r['rows']), name))
    if r.get('bad'):
        print('번호 형식이 아닌 값 %d개는 뺐습니다: %s' % (len(r['bad']), ', '.join(r['bad'][:10])))
    if os.name == 'nt' and not os.environ.get('APIGIL_NONINTERACTIVE'):
        os.startfile(path)
    return 0

if __name__ == '__main__':
    sys.exit(main())
'''


def slug(s):
    return re.sub(r'[^0-9A-Za-z가-힣]+', '_', s).strip('_')[:30] or '도구'


def make_tool(api_id, params, title):
    cat = catalog()
    if api_id not in cat:
        return {'ok': False, 'message': '목록에 없는 API입니다.'}
    spec = cat[api_id]
    names = {p['name'] for p in spec['params']}
    preset = {k: str(v) for k, v in (params or {}).items() if k in names and str(v).strip()}
    title = (title or spec['name'] + ' 도구').strip()[:40]
    folder = os.path.join(OUT_DIR, datetime.datetime.now().strftime('%Y%m%d_%H%M%S') + '_' + slug(title))
    os.makedirs(folder, exist_ok=True)
    code = (TOOL_TMPL.replace('@@CORE@@', CORE.strip()).replace('@@SPEC@@', json.dumps(spec, ensure_ascii=False))
            .replace('@@PRESET@@', json.dumps(preset, ensure_ascii=False)).replace('@@TITLE@@', title)
            .replace('@@DATE@@', datetime.date.today().isoformat()).replace('@@ORG@@', spec['org'])
            .replace('@@NAME@@', spec['name']).replace('@@LICENSE@@', spec.get('license', '')))
    files = {
        '도구.py': code,
        '설정.ini': '[인증]\n; 공공데이터포털(또는 주소정보누리집)에서 받은 인증키를 = 뒤에 붙여 넣으세요.\n인증키 = \n',
        '실행.bat': ('@echo off\r\ncd /d "%~dp0"\r\nwhere py >nul 2>nul\r\nif errorlevel 1 goto NOPY\r\n'
                   'py -3 도구.py\r\ngoto END\r\n:NOPY\r\npython 도구.py\r\n:END\r\npause\r\n'),
        '읽어보기.txt': ('%s\n\n- 만든 날: %s\n- 쓰는 API: %s 「%s」\n- 승인 방식: %s / 이용허락범위: %s\n'
                      '- 쓰는 법: 설정.ini 에 인증키 → 실행.bat → 결과 CSV가 이 폴더에 생깁니다.\n'
                      '- 인터넷이 되는 PC에서 실행하세요. 인증키는 설정.ini 에만 있으니 남에게 줄 때는 지우고 주세요.\n'
                      % (title, datetime.date.today().isoformat(), spec['org'], spec['name'], spec.get('approval', ''), spec.get('license', ''))),
    }
    for fn, txt in files.items():
        enc = 'cp949' if fn.endswith('.bat') else 'utf-8'      # cmd는 한글 윈도 기본 코드페이지(949)로 읽는다
        with open(os.path.join(folder, fn), 'w', encoding=enc, newline='' if fn.endswith('.bat') else None) as f:
            f.write(txt)
    return {'ok': True, 'folder': folder, 'files': list(files), 'preview': '\n'.join(code.splitlines()[:14])}


# ---------------------------------------------------------------------------------------------
# 화면
# ---------------------------------------------------------------------------------------------
PAGE = r'''<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>공공API 길잡이</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--red:#c8102e;--ink:#1d2433;--sub:#5b6476;--line:#e3e6ec;--bg:#f6f7f9}
*{box-sizing:border-box}body{margin:0;font-family:"맑은 고딕","Malgun Gothic",system-ui,sans-serif;color:var(--ink);background:var(--bg)}
header{background:#fff;border-bottom:3px solid var(--red);padding:14px 22px;display:flex;align-items:center;gap:12px}
header h1{font-size:20px;margin:0}header .v{color:var(--sub);font-size:13px}header .sp{flex:1}
button{font:inherit;border:1px solid #c9ced8;background:#fff;border-radius:8px;padding:8px 14px;cursor:pointer}
button.pri{background:var(--red);border-color:var(--red);color:#fff}button:disabled{opacity:.5}
main{max-width:1060px;margin:0 auto;padding:18px}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:0 0 14px}
.card h2{font-size:16px;margin:0 0 10px}.muted{color:var(--sub);font-size:13px}
textarea,input{font:inherit;width:100%;padding:10px 12px;border:1px solid #c9ced8;border-radius:8px}
textarea{min-height:64px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.picks{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}
.pick{border:1px solid var(--line);border-radius:10px;padding:12px;cursor:pointer;background:#fff}
.pick.on{border-color:var(--red);box-shadow:0 0 0 2px rgba(200,16,46,.15)}
.pick b{display:block;font-size:15px}.badge{display:inline-block;font-size:12px;border-radius:999px;padding:1px 8px;background:#eef1f6;color:#344;margin:4px 4px 0 0}
.badge.ok{background:#e5f5ea;color:#17663a}.badge.ai{background:#fdeaea;color:var(--red)}
.ideas li{margin:4px 0}.form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
label.f span{display:block;font-size:13px;color:var(--sub);margin-bottom:3px}
.tbl{overflow:auto;max-height:340px;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;white-space:nowrap}
th{background:#f2f4f8;position:sticky;top:0}.msg{padding:10px 12px;border-radius:8px;margin-top:10px;font-size:14px}
.msg.bad{background:#fdeaea;color:#8a1020}.msg.good{background:#e5f5ea;color:#17663a}pre{background:#0f1420;color:#d7e0f0;padding:12px;border-radius:8px;overflow:auto;font-size:12px}
dialog{border:none;border-radius:12px;padding:0;width:min(560px,94vw)}dialog .in{padding:18px}
.steps{display:flex;gap:6px;margin:0 0 12px}.steps span{font-size:12px;padding:3px 10px;border-radius:999px;background:#eef1f6}
.steps span.on{background:var(--red);color:#fff}
</style></head><body>
<header><h1>공공API 길잡이</h1><span class="v">말 한 줄로 공공데이터 도구 만들기 · 시제품 v0.1.6</span><span class="sp"></span>
<span id="aiChip" class="badge">AI 연결 안 됨</span><button id="bCfg">설정</button></header>
<main>
<div class="steps"><span id="s1" class="on">① 하고 싶은 일</span><span id="s2">② API 고르기</span><span id="s3">③ 실제로 불러 보기</span><span id="s4">④ 도구 만들기</span></div>
<section class="card"><h2>무엇을 하고 싶으세요?</h2>
<textarea id="q" placeholder="예) 다음 달 공휴일을 빼고 교육 일정을 잡고 싶어요 / 거래처 사업자 휴·폐업을 한 번에 확인하고 싶어요"></textarea>
<div class="row" style="margin-top:8px"><button class="pri" id="bGo">찾기</button>
<span class="muted">예시:</span><button class="ex">내일 야외 행사 날씨가 궁금해요</button><button class="ex">계약 업체가 폐업했는지 확인</button><button class="ex">다음 달 공휴일</button><button class="ex">보낸 등기 배달됐는지 확인</button></div>
<div class="row" style="margin-top:8px"><span class="muted">또는 목록에서 직접 고르기:</span><select id="selApi" style="font:inherit;padding:7px 10px;border:1px solid #c9ced8;border-radius:8px;max-width:420px"><option value="">— API 고르기 —</option></select></div>
<div id="qMsg"></div></section>
<section class="card" id="cPick" hidden><h2>이 API로 할 수 있어요</h2><div class="picks" id="picks"></div>
<h2 style="margin-top:14px">만들 수 있는 것</h2><ul class="ideas" id="ideas"></ul></section>
<section class="card" id="cForm" hidden><h2 id="fTitle">값 넣기</h2><div class="form" id="form"></div>
<div class="row" style="margin-top:10px"><button class="pri" id="bTest">실제로 불러 보기</button><span class="muted" id="kHint"></span></div>
<div id="tMsg"></div><div class="tbl" id="tbl" hidden></div></section>
<section class="card" id="cMake" hidden><h2>도구 만들기</h2>
<div class="row"><input id="title" style="max-width:420px" placeholder="도구 이름"><button class="pri" id="bMake">이 설정으로 도구 만들기</button></div>
<p class="muted">만든 도구는 파이썬 파일 하나와 실행 파일로 저장됩니다. 인증키는 도구 안에 넣지 않고 같은 폴더의 설정.ini 에만 둡니다.</p>
<div id="mMsg"></div><pre id="code" hidden></pre></section>
</main>
<dialog id="dCfg"><div class="in"><h2 style="margin-top:0">설정</h2>
<label class="f"><span>공공데이터포털 인증키(일반 인증키, Decoding·Encoding 아무거나)</span><input id="kData" type="password" autocomplete="off"></label>
<label class="f" style="margin-top:8px"><span>주소정보누리집 승인키(도로명주소 검색용, 선택)</span><input id="kJuso" type="password" autocomplete="off"></label>
<hr style="border:none;border-top:1px solid #e3e6ec;margin:14px 0">
<label class="f"><span>AI 연결(선택) — OpenAI 호환 주소</span><input id="lUrl" placeholder="예) http://127.0.0.1:11434/v1/chat/completions"></label>
<label class="f" style="margin-top:8px"><span>모델 이름</span><input id="lModel" placeholder="예) exaone3.5:7.8b · gemma3:4b"></label>
<label class="f" style="margin-top:8px"><span>AI 키(필요한 곳만)</span><input id="lKey" type="password" autocomplete="off"></label>
<p class="muted">키는 이 PC의 config.json 에만 저장됩니다. AI에는 사용자의 문장과 API 목록(공개 명세)만 보내고 인증키는 보내지 않습니다.</p>
<div class="row" style="justify-content:flex-end"><button id="bCfgClose">닫기</button><button class="pri" id="bCfgSave">저장</button></div></div></dialog>
<script>
const T='@@TOKEN@@';const $=s=>document.querySelector(s);
async function api(p,b){const r=await fetch(p,{method:b?'POST':'GET',headers:{'Content-Type':'application/json','X-Token':T},body:b?JSON.stringify(b):undefined});return r.json();}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
let R=null,cur=null;
function step(n){for(let i=1;i<=4;i++)$('#s'+i).classList.toggle('on',i<=n);}
async function refreshCfg(){const c=await api('/api/config');$('#aiChip').textContent=c.llm_on?('AI 연결됨 · '+c.model):'AI 연결 안 됨 (낱말 검색)';$('#aiChip').className='badge'+(c.llm_on?' ai':'');return c;}
function render(){
 if(!R.picks.length){$('#qMsg').innerHTML+='<div class="msg bad">맞는 API를 찾지 못했습니다. 다른 말로 적거나 아래 목록에서 직접 고르세요.</div>';return;}
 const tag=R.mode==='ai'?'AI 추천':(R.mode==='list'?'목록에서 선택':'낱말 일치');
 $('#picks').innerHTML=R.picks.map((p,i)=>{const s=R.specs[p.id];return '<div class="pick" data-i="'+i+'"><b>'+esc(s.name)+'</b><span class="muted">'+esc(s.org)+'</span><div>'+
  '<span class="badge'+(R.mode==='ai'?' ai':'')+'">'+tag+'</span><span class="badge">'+esc(s.approval)+'</span>'+(s.verified?'<span class="badge ok">호출 확인됨</span>':'<span class="badge">명세 확인 대기</span>')+'</div><p class="muted" style="margin:6px 0 0">'+esc(p.why)+'</p></div>';}).join('');
 $('#ideas').innerHTML=R.ideas.map(x=>'<li><b>'+esc(x.title)+'</b> <span class="muted">— '+esc(x.how)+'</span></li>').join('');
 $('#cPick').hidden=false;step(2);document.querySelectorAll('.pick').forEach(el=>el.onclick=()=>pick(+el.dataset.i));pick(0);}
async function go(){const q=$('#q').value.trim();if(!q)return;$('#qMsg').innerHTML='<p class="muted">찾는 중…</p>';
 R=await api('/api/search',{q});$('#qMsg').innerHTML=R.ai_error?'<div class="msg bad">'+esc(R.ai_error)+' — 낱말 검색으로 보여 드립니다.</div>':'';render();}
async function fromList(id){if(!id)return;R=await api('/api/spec',{id});$('#qMsg').innerHTML='';render();}
async function loadList(){const L=await api('/api/catalog');const sel=$('#selApi');
 sel.innerHTML='<option value="">— API 고르기 —</option>'+L.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+' · '+esc(c.org)+(c.verified?' (호출 확인됨)':'')+'</option>').join('');
 sel.onchange=()=>fromList(sel.value);}
function pick(i){document.querySelectorAll('.pick').forEach((el,j)=>el.classList.toggle('on',i===j));const p=R.picks[i],s=R.specs[p.id];cur={id:p.id,spec:s};
 $('#fTitle').textContent='값 넣기 — '+s.name;$('#form').innerHTML=s.params.map(x=>{const v=(p.params&&p.params[x.name])||x.default||'';
  let extra='';if(x.kind==='kma_nx')extra='<select id="place" style="margin-top:4px;width:100%"><option value="">— 지역으로 고르기 —</option>'+(window.PLACES||[]).map(pl=>'<option value="'+pl[1]+','+pl[2]+'">'+esc(pl[0])+'</option>').join('')+'</select>';
  return '<label class="f"><span>'+esc(x.label)+(x.required?' *':'')+'</span>'+(x.kind==='list'||x.kind==='multi'?'<textarea data-n="'+x.name+'">'+esc(v)+'</textarea>':'<input data-n="'+x.name+'" value="'+esc(v)+'">')+extra+'</label>';}).join('');
 const pl=$('#place');if(pl)pl.onchange=()=>{const v=pl.value.split(',');if(v.length===2){$('[data-n="nx"]').value=v[0];$('[data-n="ny"]').value=v[1];}};
 $('#kHint').textContent=s.key_type==='juso'?'주소정보누리집 승인키가 필요합니다.':'공공데이터포털에서 이 API를 활용신청한 인증키가 필요합니다.';
 $('#title').value=s.name+' 도구';$('#tMsg').innerHTML='';$('#tbl').hidden=true;$('#cForm').hidden=false;$('#cMake').hidden=true;$('#code').hidden=true;$('#mMsg').innerHTML='';}
function vals(){const o={};document.querySelectorAll('[data-n]').forEach(el=>o[el.dataset.n]=el.value);return o;}
async function test(){if(!cur)return;$('#tMsg').innerHTML='<p class="muted">부르는 중…</p>';const r=await api('/api/test',{id:cur.id,params:vals()});
 if(!r.ok){$('#tMsg').innerHTML='<div class="msg bad">'+esc(r.message)+(r.url?'<br><span class="muted">'+esc(r.url)+'</span>':'')+'</div>';$('#tbl').hidden=true;return;}
 $('#tMsg').innerHTML='<div class="msg good">'+r.count+'건을 받았습니다 ('+r.ms+'ms)'+esc(r.note||'')+'. 처음 20건을 보여 드립니다.</div>';
 $('#tbl').innerHTML='<table><thead><tr>'+r.labels.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+r.rows.map(row=>'<tr>'+row.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
 $('#tbl').hidden=false;$('#cMake').hidden=false;step(3);}
async function make(){const r=await api('/api/make',{id:cur.id,params:vals(),title:$('#title').value});
 if(!r.ok){$('#mMsg').innerHTML='<div class="msg bad">'+esc(r.message)+'</div>';return;}
 $('#mMsg').innerHTML='<div class="msg good">도구를 만들었습니다: '+esc(r.folder)+'<br>파일: '+r.files.map(esc).join(', ')+'</div>';$('#code').textContent=r.preview+'\n…';$('#code').hidden=false;step(4);}
$('#bGo').onclick=go;$('#q').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))go();});
document.querySelectorAll('.ex').forEach(b=>b.onclick=()=>{$('#q').value=b.textContent;go();});
$('#bTest').onclick=test;$('#bMake').onclick=make;
$('#bCfg').onclick=async()=>{const c=await refreshCfg();$('#kData').value='';$('#kJuso').value='';$('#kData').placeholder=c.data_key?'저장됨 '+c.data_key:'';$('#kJuso').placeholder=c.juso_key?'저장됨 '+c.juso_key:'';
 $('#lUrl').value=c.url||'';$('#lModel').value=c.model||'';$('#lKey').value='';$('#dCfg').showModal();};
$('#bCfgClose').onclick=()=>$('#dCfg').close();
$('#bCfgSave').onclick=async()=>{await api('/api/config',{data_key:$('#kData').value,juso_key:$('#kJuso').value,url:$('#lUrl').value,model:$('#lModel').value,key:$('#lKey').value});$('#dCfg').close();refreshCfg();};
window.PLACES=@@PLACES@@;refreshCfg();loadList();
</script></body></html>'''


def places_grid():
    return [[n] + list(kma_grid(la, lo)) for n, la, lo in PLACES]


class H(BaseHTTPRequestHandler):
    server_version = 'apigil/' + VER

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype='application/json; charset=utf-8'):
        data = body if isinstance(body, bytes) else (json.dumps(body, ensure_ascii=False).encode('utf-8') if not isinstance(body, str) else body.encode('utf-8'))
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

    def _ok_origin(self):
        host = (self.headers.get('Host') or '').split(':')[0]
        return host in ('127.0.0.1', 'localhost') and self.headers.get('X-Token') == TOKEN

    def do_GET(self):
        if self.path in ('/', '/index.html'):
            page = PAGE.replace('@@TOKEN@@', TOKEN).replace('@@PLACES@@', json.dumps(places_grid(), ensure_ascii=False))
            return self._send(200, page, 'text/html; charset=utf-8')
        if self.path == '/api/catalog':
            if not self._ok_origin(): return self._send(403, {'ok': False})
            return self._send(200, catalog_list())
        if self.path == '/api/config':
            if not self._ok_origin(): return self._send(403, {'ok': False})
            c = cfg(); l = c.get('llm') or {}
            m = lambda s: (s[:4] + '…' + s[-4:]) if s and len(s) > 10 else ('있음' if s else '')
            return self._send(200, {'data_key': m(c.get('data_key', '')), 'juso_key': m(c.get('juso_key', '')),
                                    'llm_on': bool(l.get('url') and l.get('model')), 'url': l.get('url', ''), 'model': l.get('model', '')})
        return self._send(404, {'ok': False})

    def do_POST(self):
        if not self._ok_origin():
            return self._send(403, {'ok': False, 'message': '허용되지 않은 요청'})
        try:
            n = int(self.headers.get('Content-Length') or 0)
            body = json.loads(self.rfile.read(min(n, 1_000_000)).decode('utf-8') or '{}')
        except Exception:
            return self._send(400, {'ok': False, 'message': '요청 형식 오류'})
        if self.path == '/api/search':
            return self._send(200, search(str(body.get('q', ''))[:300]))
        if self.path == '/api/spec':
            return self._send(200, spec_pick(body.get('id')))
        if self.path == '/api/test':
            return self._send(200, test_call(body.get('id'), body.get('params') or {}))
        if self.path == '/api/make':
            return self._send(200, make_tool(body.get('id'), body.get('params') or {}, body.get('title', '')))
        if self.path == '/api/config':
            c = cfg()
            for k in ('data_key', 'juso_key'):
                if str(body.get(k, '')).strip(): c[k] = str(body[k]).strip()
            l = c.get('llm') or {}
            l['url'], l['model'] = str(body.get('url', '')).strip(), str(body.get('model', '')).strip()
            if str(body.get('key', '')).strip(): l['key'] = str(body['key']).strip()
            c['llm'] = l
            save_cfg(c)
            return self._send(200, {'ok': True})
        return self._send(404, {'ok': False})


def main():
    port = int(os.environ.get('APIGIL_PORT', '8765'))
    srv = ThreadingHTTPServer(('127.0.0.1', port), H)
    url = 'http://127.0.0.1:%d/' % port
    print('%s v%s — %s 에서 열렸습니다. 끝내려면 이 창을 닫으세요.' % (APP, VER, url))
    if not os.environ.get('APIGIL_NO_BROWSER'):
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
