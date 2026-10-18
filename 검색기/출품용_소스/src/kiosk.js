/*! 물어물어(우편번호 자동검색기) v1.10 (출품본) · 어르신 직접 입력·사진으로 읽기·감열 인쇄·QR 접수 메모 | (c) 2026 이희재 · 정읍우체국 | 2026 공공 AI 대전환 챌린지 출품본. 대회 규정에 따라 사용권 부여 */
/* 민원실에서 어르신이 직접 쓰는 대화형 주소 입력.
   - 말(인터넷 PC)·글자로 받은 주소를 정리해 엔진에 묻고, 빠진 부분만 되묻는다.
   - 우편번호는 언제나 엔진(우편번호 고시 DB)이 확정한다. AI는 주소 조각을 뽑는 보조 역할만 한다.
   - 적은 내용은 이 기기 안에서만 쓰고, 마치거나 자리를 비우면 지운다. */
(function () {
  'use strict';

  var KEY = 'zipfinder.kiosk.v1';
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function cfg() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function setCfg(o) {
    try { var c = cfg(); for (var k in o) { c[k] = o[k]; } localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { }
  }
  function mainRegion() {
    try { return (JSON.parse(localStorage.getItem('zipfinder.v1') || '{}') || {}).region || ''; } catch (e) { return ''; }
  }
  function E() { return window.__zip && window.__zip.S && window.__zip.S.engine; }
  function log(a, n, m) { try { if (window.__zip && window.__zip.log) { window.__zip.log(a, n, m); } } catch (e) { } }
  function phoneFmt(d) {
    d = String(d || '').replace(/\D/g, '');
    var m;
    if ((m = d.match(/^(02)(\d{3,4})(\d{4})$/))) { return m[1] + '-' + m[2] + '-' + m[3]; }
    if ((m = d.match(/^(0\d{2})(\d{3,4})(\d{4})$/))) { return m[1] + '-' + m[2] + '-' + m[3]; }
    return d;
  }
  function stamp() {
    var t = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return t.getFullYear() + p(t.getMonth() + 1) + p(t.getDate()) + '_' + p(t.getHours()) + p(t.getMinutes());
  }

  // ------------------------------------------------------------------ 말 다듬기
  var FILLER = /^(거시기|거시기는|거시기가|뭐시기|뭐더라|있잖아|있잖여|저기|저기요|그|그게|무슨|어디|우리|내|제|저희|아들|딸|아들네|딸네|아들집|딸집|손주|손주네|사돈|사돈네|큰집|작은집|집|집이여|주소|주소는|주소가|보낼라는디|보낼라고|보내려고|보낼려고|보낼거여|보내유|보내요|그러니까|그니께|근디|인디|요|여|예|네|쪽|쪽에|근처|여기|거기)$/;
  var TAIL = /(으로요|으로|에다가|에다|에게|한테|에서|이여|이에요|이예요|예요|에요|이요|인디|인데요|인데|여요|이랑|이고|이구요|이유|유|여|에)$/;
  var KD = { '영': 0, '공': 0, '일': 1, '이': 2, '삼': 3, '사': 4, '오': 5, '육': 6, '륙': 6, '칠': 7, '팔': 8, '구': 9 };
  function knum(s) {
    if (!/^[영공일이삼사오육륙칠팔구십백천]+$/.test(s)) { return null; }
    if (!/[십백천]/.test(s)) {
      var d = '';
      for (var i = 0; i < s.length; i++) { d += KD[s.charAt(i)]; }
      return d;
    }
    var total = 0, cur = 0;
    for (var j = 0; j < s.length; j++) {
      var ch = s.charAt(j);
      if (KD.hasOwnProperty(ch)) { cur = KD[ch]; }
      else { total += (cur || 1) * (ch === '십' ? 10 : ch === '백' ? 100 : 1000); cur = 0; }
    }
    return String(total + cur);
  }
  function knumTok(w) {
    var m = w.match(/^([영공일이삼사오육륙칠팔구십백천]+)(호|층|번지|번)$/);
    if (m) { var n = knum(m[1]); if (n !== null) { return n + m[2]; } }
    m = w.match(/^([영공일이삼사오육륙칠팔구십백천]{2,})(동)$/);       // 「사동」「이동」 같은 실제 동 이름은 그대로
    if (m && (/[십백천]/.test(m[1]) || m[1].length >= 3)) { var n2 = knum(m[1]); if (n2 !== null) { return n2 + m[2]; } }
    return w;
  }
  function normalize(text) {
    var t = clean(text).replace(/[,.!?~…"“”‘’]/g, ' ');
    t = t.replace(/0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/g, ' ');             // 전화번호는 주소에서 뺀다
    var prev = '';
    var toks = t.split(/\s+/).filter(Boolean).map(function (w) {
      var m = w.match(TAIL);
      if (m) {
        var base = w.slice(0, w.length - m[1].length);
        if (/(\d|동|호|층|번지|리|면|읍|로|길|가|아파트|빌라|타운|맨션|주택|빌딩|오피스텔)$/.test(base) || /(청|실|관|센터|학교|병원|회관|역|교회|사무소)$/.test(base) || FILLER.test(base)) { w = base; }
      }
      w = knumTok(w);
      var lm = w.match(/^([가-힣]{1,4}(?:시|군|구))(청|청사)$/);   // 전주시청 → 전주시 전주시청
      if (lm) { w = lm[1] + ' ' + w; }
      // 「효자로 이백이십오」「시랑리 사백팔」처럼 길·리·동 바로 뒤의 우리말 숫자는 번호로 읽는다
      if (/(로|길|리|동|가)$/.test(prev) && /^[영공일이삼사오육륙칠팔구십백천]{2,}$/.test(w)) { var kn = knum(w); if (kn !== null) { w = kn; } }
      prev = w;
      return w;
    }).filter(function (w) { return !FILLER.test(w); });
    return toks.join(' ');
  }
  var BLD = /(아파트|빌라|맨션|타운|오피스텔|주공|빌딩|하이츠|캐슬|자이|푸르지오|힐스테이트|래미안|더샵|편한세상|센트럴|스위첸|휴먼시아|리젠시|팰리스|타워|주택|연립|상가|병원|학교|교회|회관|센터|우체국|시청|군청|구청|면사무소|주민센터)/;
  function tailDetail(t) {
    var m = String(t || '').match(/(\d{1,4}\s*동\s*)?\d{1,4}\s*호|\d{1,3}\s*층/);
    return m ? clean(m[0]) : '';
  }
  function rank(r) {
    if (!r) { return 0; }
    if (r.grade === '정확') { return 5; }
    if (r.grade === '유사') { return r.conf === '상' ? 4 : r.conf === '중' ? 3 : 2; }
    return 0;
  }
  // 「동은 맞고 번지가 없음 → 후보 n개 중 구간이 가장 넓은 번호」는 추정이다: 화면·스티커에 우편번호로 쓰지 않는다(v1.10, 어르신 모의 심사에서 틀린 번호가 확정되던 것)
  function isGuess(r) { var n = (r && r.note) || ''; return !!r && r.grade !== '정확' && /구간이 가장 넓은|가까운 구간|번지 없음|번호 없음/.test(n) && !/우편번호는 1개/.test(n); }
  // 건물 이름으로 다시 찾기: 「대치동 은마아파트」처럼 동 이름이 같이 있으면 일반 검색이 비므로 건물명 판정과 「동 이름 줄기+단지명」을 써 본다
  function byBuilding(q) {
    var e = E(), o = regionOpts(), b = null;
    try { b = e._lookupBuilding(q, o); } catch (x) { b = null; }
    if (b && rank(b) >= 3) { return { r: b }; }
    var list = [];
    try { list = (e.search(q, 12) || []).filter(function (x) { return x.range === '건물명'; }); } catch (x) { list = []; }
    var m = q.match(/([가-힣]{1,4})동\s+([가-힣A-Za-z0-9]+)/);
    if (!list.length && m && BLD.test(m[2])) {   // 「시기동 주공아파트」 → 「시기주공아파트」
      var q3 = clean(q.replace(m[0], m[1] + m[2]).replace(/(\d{1,4}\s*동\s*)?\d{1,4}\s*호|\d{1,3}\s*층/g, ' '));
      try { list = (e.search(q3, 12) || []).filter(function (x) { return x.range === '건물명'; }); } catch (x) { list = []; }
    }
    if (!list.length) {
      var q2 = clean(q.replace(/[가-힣]{1,4}동(?=\s)/, ' ').replace(/(\d{1,4}\s*동\s*)?\d{1,4}\s*호|\d{1,3}\s*층/g, ' '));   // 동 낱말을 빼고
      try { list = (e.search(q2, 12) || []).filter(function (x) { return x.range === '건물명'; }); } catch (x) { list = []; }
    }
    return list.length ? { list: list } : null;
  }
  function regionOpts() {
    var r = clean(cfg().region || mainRegion());
    var e = E();
    if (!r || !e) { return null; }
    var g = e.parseRegion(r);
    return g && g.length ? { defaultSggs: g } : null;
  }
  function look(text) { return E().lookup(text, regionOpts()); }

  // ------------------------------------------------------------------ AI 보조(선택) · 주소 조각만 뽑는다
  var SYS = '너는 우편 주소 정리기다. 사용자가 말한 문장에서 한국 주소 조각만 뽑아 JSON 하나로만 답하라. ' +
    '모르는 값은 빈 문자열로 둔다. 우편번호는 절대 만들지 마라. 사람 이름·전화번호는 넣지 마라. ' +
    '형식: {"sido":"","sigungu":"","eupmyeondong":"","ri":"","road":"","buildingNo":"","jibun":"","buildingName":"","detail":""}';
  function isLocalUrl(u) { return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(clean(u)); }
  function aiCfg() { var a = cfg().ai || {}; return a.url && a.model && isLocalUrl(a.url) ? a : null; }
  function aiReason(e) {
    var m = String(e && e.message || e || '');
    if (/^abort/i.test(m) || (e && e.name === 'AbortError')) { return '시간 초과(25초). 모델이 너무 느리거나 멈춰 있어요.'; }
    if (/^HTTP 404/.test(m)) { return '모델 이름을 찾지 못했어요(404). ollama pull 로 받은 이름과 같은지 확인하세요.'; }
    if (/^HTTP 401|^HTTP 403/.test(m)) { return '키가 없거나 틀렸어요(' + m + ').'; }
    if (/^HTTP/.test(m)) { return '모델 실행기가 오류를 냈어요(' + m + ').'; }
    if (/^JSON/.test(m)) { return '모델 답이 JSON이 아니에요. 다른 모델 이름으로 해 보세요.'; }
    return '연결이 거부됐어요. 모델 실행기가 켜져 있는지, 허용 출처(OLLAMA_ORIGINS에 「*」 또는 file://*)를 확인하고 다시 시작하세요.';
  }
  function aiExtractRaw(text, override) {
    var a = override || aiCfg();
    if (!a || !window.fetch) { return Promise.reject(new Error('설정 없음')); }
    var headers = { 'Content-Type': 'application/json' };
    if (a.key) { headers.Authorization = 'Bearer ' + a.key; }
    var ctl = window.AbortController ? new AbortController() : null;
    var tm = setTimeout(function () { if (ctl) { ctl.abort(); } }, 25000);
    return fetch(a.url, {
      method: 'POST', headers: headers, signal: ctl ? ctl.signal : undefined,
      body: JSON.stringify({ model: a.model, temperature: 0, stream: false, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYS }, { role: 'user', content: text }] })
    }).then(function (r) {
      if (!r.ok) { throw new Error('HTTP ' + r.status); }
      return r.json();
    }).then(function (j) {
      clearTimeout(tm);
      var c = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || (j && j.message && j.message.content) || '';
      var o = parseJsonLoose(c);
      if (!o) { throw new Error('JSON 아님'); }
      return o;
    }).catch(function (e) { clearTimeout(tm); throw e; });
  }
  // 모델 답에서 JSON 객체 하나만 꺼낸다(<think>…</think>·코드 펜스·설명문 제거, 중괄호 짝 맞춤)
  function parseJsonLoose(c) {
    var s = String(c || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```[a-z]*/gi, '');
    var i = s.indexOf('{');
    while (i >= 0) {
      var depth = 0, inStr = false;
      for (var k = i; k < s.length; k++) {
        var ch = s.charAt(k);
        if (inStr) { if (ch === '\\') { k++; } else if (ch === '"') { inStr = false; } continue; }
        if (ch === '"') { inStr = true; } else if (ch === '{') { depth++; } else if (ch === '}') { depth--; if (!depth) { try { return JSON.parse(s.slice(i, k + 1)); } catch (e) { break; } } }
      }
      i = s.indexOf('{', i + 1);
    }
    return null;
  }
  function aiExtract(text, override) {
    return aiExtractRaw(text, override).catch(function () { return null; });
  }
  function aiAssist(t) {
    return aiExtract(t).then(function (o) {
      if (!o) { return null; }
      function j(a) { return clean(a.filter(Boolean).join(' ')); }
      var base = j([o.sido, o.sigungu]);
      var cands = [j([base, o.road, o.buildingNo]), j([base, o.eupmyeondong, o.ri, o.jibun]),
        j([base, o.eupmyeondong, o.buildingName]), j([base, o.buildingName])];
      var best = null;
      cands.forEach(function (c) {
        if (!c || c === base) { return; }
        var r = look(c);
        if (!best || rank(r) > rank(best.r)) { best = { r: r, c: c }; }
      });
      if (!best || !rank(best.r)) { return null; }
      best.detail = clean([o.buildingName && best.c.indexOf(o.buildingName) < 0 ? o.buildingName : '', o.detail].join(' '));
      return best;
    });
  }

  // ------------------------------------------------------------------ 상태
  var st, hist, root, main, idleT, warnT;
  // 접수 메모 번호: 그날 001부터 차례로(같은 날 번호가 겹치지 않게). 저장이 막힌 브라우저는 무작위로
  function nextNo() {
    var KEY = 'zipfinder.kiosk.no', d = new Date(), day = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || '{}');
      var n = o.d === day ? (o.n || 0) + 1 : 1;
      localStorage.setItem(KEY, JSON.stringify({ d: day, n: n }));
      return ('00' + n).slice(-3);
    } catch (e) { return String(Math.floor(Math.random() * 900) + 100); }
  }
  function fresh() {
    st = { entries: [], sender: null, cur: null, no: '', trail: [] };
    hist = [];
  }
  function newCur(kind) {
    st.cur = { kind: kind, raw: '', text: '', region: '', regionToks: [], res: null, check: false, ai: false, triedAI: false, detail: '', name: '', phone: '', tries: 0 };
    st.trail = [];
  }
  function hasData() { return st && (st.entries.length || (st.cur && st.cur.raw) || st.sender); }

  // ------------------------------------------------------------------ 화면 틀
  var CSS = '#kiosk{position:fixed;inset:0;z-index:5000;background:#fffdf8;color:#1d1d1d;display:flex;flex-direction:column;font-family:"맑은 고딕","Malgun Gothic",sans-serif;font-size:calc(22px*var(--kf,1))}' +
    '#kiosk[hidden]{display:none}html.k-on,html.k-on body{overflow:hidden}' +
    '.k-top{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 10px;padding:12px 22px;background:#c8102e;color:#fff}' +
    '.k-brand{font-size:1.2em;font-weight:800;white-space:nowrap}.k-tools button{font-size:.75em;margin-left:6px;background:#fff;color:#c8102e;border:0;border-radius:10px;padding:8px 12px;font-weight:800;cursor:pointer}' +
    '.k-tools button.on{background:#ffd8de}' +
    '.k-main{flex:1;overflow:auto;padding:22px 26px 30px;max-width:980px;width:100%;margin:0 auto;box-sizing:border-box}' +
    '.k-trail{font-size:.78em;color:#555;margin:0 0 6px;line-height:1.5}.k-trail b{color:#1d1d1d}' +
    '.k-bubble{background:#fff;border:3px solid #f1c3ca;border-radius:22px;padding:18px 22px;font-size:1.28em;font-weight:800;line-height:1.45;margin:6px 0 16px}' +
    '.k-bubble small{display:block;font-size:.66em;font-weight:500;color:#555;margin-top:8px;line-height:1.5}' +
    '.k-input{width:100%;box-sizing:border-box;font-size:1.25em;padding:16px 18px;border:3px solid #999;border-radius:16px;font-family:inherit}' +
    '.k-input:focus{border-color:#c8102e;outline:none}' +
    '.k-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:16px}' +
    '.k-btn{flex:1 1 220px;min-height:84px;font-size:1.12em;font-weight:800;border-radius:18px;border:3px solid #c8102e;background:#fff;color:#c8102e;cursor:pointer;padding:10px 16px;font-family:inherit}' +
    '.k-btn.pri{background:#c8102e;color:#fff}.k-btn.ok{background:#1b7f3b;border-color:#1b7f3b;color:#fff}.k-btn.sub{border-color:#999;color:#333}' +
    '.k-btn.sm{flex:0 0 auto;min-height:56px;font-size:.85em}' +
    '.k-choice{display:block;width:100%;text-align:left;margin:10px 0;min-height:74px;font-size:1.08em;font-weight:700;border-radius:16px;border:3px solid #ccc;background:#fff;padding:12px 18px;cursor:pointer;font-family:inherit}' +
    '.k-choice small{display:block;color:#666;font-size:.72em;margin-top:4px;font-weight:500}.k-choice:hover{border-color:#c8102e}' +
    '.k-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}.k-grid .k-choice{margin:0;text-align:center}' +
    '.k-zip{font-size:2.6em;font-weight:900;letter-spacing:.08em;color:#c8102e;line-height:1.1}' +
    '.k-addr{font-size:1.22em;font-weight:800;line-height:1.5;margin-top:6px}.k-sub{font-size:.8em;color:#555;margin-top:6px}' +
    '.k-card{background:#fff;border:3px solid #ddd;border-radius:18px;padding:14px 18px;margin:10px 0}.k-card .k-zip{font-size:1.6em}' +
    '.k-warn{color:#a35a00;font-weight:800}.k-ai{color:#1d5fb4;font-weight:800}' +
    '.k-keys{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px;max-width:540px}' +
    '.k-keys button{min-height:78px;font-size:1.5em;font-weight:900;border-radius:16px;border:2px solid #bbb;background:#fff;cursor:pointer;font-family:inherit}' +
    '.k-num{font-size:1.8em;font-weight:900;letter-spacing:.05em;min-height:1.45em;border-bottom:4px solid #c8102e;padding:6px 0;max-width:540px}' +
    '.k-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 22px;font-size:.66em;color:#555;border-top:1px solid #eee}' +
    '.k-staff{flex:0 0 auto;white-space:nowrap;font-size:.9em;background:transparent;border:1px solid #ccc;border-radius:8px;padding:8px 12px;color:#777;cursor:pointer;user-select:none}' +
    '.k-act{position:sticky;bottom:0;z-index:3;margin-top:10px;padding:14px 0 6px;background:linear-gradient(rgba(255,253,248,0),#fffdf8 22%)}' +
    '.k-grid{margin-bottom:12px}.k-choice{word-break:keep-all}.k-btn:disabled{opacity:.4;cursor:default;border-color:#bbb;background:#f3f3f3;color:#777}' +
    '.k-chip{cursor:pointer;border:0;font-family:inherit}' +
    '.k-padwrap{display:flex;flex-wrap:wrap;gap:6px 22px;align-items:flex-end}.k-padl{flex:1 1 100%;max-width:540px}.k-padr{flex:1 1 100%}' +
    '.k-padr .k-row{flex-wrap:nowrap}.k-padr .k-btn{flex:1 1 0;min-width:0;padding:10px 8px}' +
    '@media (min-width:900px){.k-padwrap{flex-wrap:nowrap}.k-padl{flex:0 1 540px}.k-padr{flex:1 1 260px}.k-padr .k-row{flex-direction:column}.k-padr .k-btn{flex:0 0 auto;width:100%}}' +
    '@media (max-width:899px){.k-keys button{min-height:66px}.k-num{min-height:1.15em}.k-padr .k-row{margin-top:10px}}' +
    '@media (max-width:760px){.k-brand{font-size:1.02em}.k-tools button{padding:6px 10px}}' +
    '@media (max-height:820px){.k-trail{font-size:.66em;max-height:1.6em;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.k-foot>span{display:none}.k-foot{padding:4px 22px !important;justify-content:flex-end}.k-main{padding-top:12px}.k-keys{gap:8px;margin-top:6px}.k-keys button{min-height:50px;font-size:1.2em}.k-num{font-size:1.4em;padding:2px 0}.k-bubble{padding:10px 16px;margin:2px 0 8px;font-size:1.12em}.k-btn{min-height:64px}.k-foot{padding:6px 22px}}' +
    '.k-cam{position:relative;background:#111;border-radius:18px;overflow:hidden;margin:6px 0 4px;min-height:220px}.k-cam video,.k-cam canvas{display:block;width:100%;max-height:min(36vh,400px);object-fit:contain;background:#111}' +
    '.k-guide{position:absolute;inset:7% 10%;border:4px dashed rgba(255,255,255,.85);border-radius:20px;pointer-events:none;display:flex;align-items:flex-end;justify-content:center}.k-guide span{background:rgba(0,0,0,.65);color:#fff;font-size:1em;font-weight:700;padding:4px 12px;border-radius:10px 10px 0 0}' +
    '.k-prog{height:16px;background:#eee;border-radius:10px;overflow:hidden;margin:12px 0}.k-prog i{display:block;height:100%;width:6%;background:#c8102e;transition:width .4s}' +
    '.k-chip{display:inline-block;margin:8px 8px 0 0;font-size:.78em;padding:8px 12px;border-radius:12px;background:#f1f1f1;color:#444}' +
    '.k-big{font-size:2em;font-weight:900;color:#1b7f3b;margin:10px 0}' +
    '.k-modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:5100}' +
    '.k-modal>div{background:#fff;border-radius:22px;padding:26px;max-width:680px;width:92%;font-size:calc(21px*var(--kf,1));max-height:90vh;overflow:auto}' +
    '#kModalBtns{position:sticky;bottom:-26px;background:#fff;padding:10px 0 4px;margin-bottom:-4px}' +
    '.k-toast{position:fixed;left:50%;bottom:86px;transform:translateX(-50%);background:#333;color:#fff;padding:14px 22px;border-radius:14px;font-size:calc(20px*var(--kf,1));z-index:5200;max-width:90%}' +
    '.k-field{display:block;margin:10px 0;font-size:16px}.k-field b{display:block;margin-bottom:4px}.k-field input{width:100%;font-size:16px;padding:8px;box-sizing:border-box}' +
    '.k-note{font-size:14px;color:#555;line-height:1.5}' +
    '#kPrint{display:none}' +
    '#kPrint.p-th{width:72mm;padding:1mm 3mm 3mm;box-sizing:border-box;font-family:"맑은 고딕","Malgun Gothic",sans-serif;color:#000;line-height:1.28;background:#fff}' +
    '#kPrint.p-th.p-58{width:48mm;padding:1mm 1mm 3mm}' +
    '#kPrint.p-th h1{font-size:10pt;font-weight:800;text-align:center;margin:0 0 1pt}' +
    '#kPrint.p-th .p-no{font-size:22pt;font-weight:900;text-align:center;margin:0 0 2pt}' +
    '#kPrint.p-th .p-it{border:0;border-top:1pt dashed #000;border-radius:0;padding:3pt 0 2pt;margin:3pt 0 0;font-size:11pt;font-weight:700}' +
    '#kPrint.p-th .p-zip{font-size:20pt;font-weight:900;letter-spacing:1pt}#kPrint.p-th.p-58 .p-zip{font-size:16pt}#kPrint.p-th.p-58 .p-it{font-size:9.5pt}' +
    '#kPrint.p-th .p-s{font-size:8.5pt;font-weight:400}#kPrint.p-th .p-foot{font-size:7.5pt;border-top:1pt dashed #000;padding-top:3pt;margin-top:4pt;text-align:center}' +
    '#kPrint.p-lbl{width:auto;background:#fff;color:#000;font-family:"맑은 고딕","Malgun Gothic",sans-serif}' +
    '#kPrint .p-lbl{box-sizing:border-box;overflow:hidden;padding:2mm 2.5mm;display:flex;flex-direction:column;justify-content:space-between;font-size:var(--b,12pt);line-height:1.22;font-weight:700;break-after:page;page-break-after:always;background:#fff}' +
    '#kPrint .p-lbl:last-child{break-after:auto;page-break-after:auto}' +
    '#kPrint .p-lbl .l-top{display:flex;align-items:baseline;justify-content:space-between;gap:3mm}#kPrint .p-lbl .l-zip{font-size:2.1em;font-weight:900;letter-spacing:.06em;line-height:1}' +
    '#kPrint .p-lbl .l-name{font-size:1.3em;font-weight:800;text-align:right}#kPrint .p-lbl .l-addr{font-size:1.05em;word-break:keep-all}' +
    '#kPrint .p-lbl .l-tel{font-size:.85em;font-weight:600}#kPrint .p-lbl .l-from{font-size:.62em;font-weight:400;color:#000;border-top:.2mm solid #000;padding-top:.8mm}#kPrint .p-lbl .l-chk{font-size:1em;font-weight:900}#kPrint .p-lbl .l-name{white-space:nowrap}' +
    '#kPrint .p-lbl.l-test{border:.3mm solid #000}#kPrint .p-lbl .l-ruler{font-size:.6em;font-weight:400}' +
    '.k-chk{display:flex;gap:10px;align-items:center;font-size:16px;margin:10px 0}.k-chk input{width:22px;height:22px}' +
    '#kPrint.p-th .p-qr{text-align:center;margin-top:4pt}#kPrint.p-th .p-qr svg{width:36mm;height:36mm}#kPrint.p-th.p-58 .p-qr svg{width:34mm;height:34mm}' +
    '@media print{#kPrint .p-qr{text-align:center;margin-top:8pt;page-break-inside:avoid}#kPrint .p-qr svg{width:40mm;height:40mm}}' +
    '#qrRecv{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:6000;font-family:inherit}#qrRecv[hidden]{display:none}' +
    '#qrRecv .qr-card{background:#fff;color:#222;border-radius:14px;padding:20px 22px;width:min(560px,92vw);font-size:16px;line-height:1.5;box-shadow:0 10px 40px rgba(0,0,0,.3)}' +
    '#qrRecv h2{margin:0 0 6px;font-size:20px}#qrRecv input{width:100%;font-size:18px;padding:10px 12px;border:2px solid #c8102e;border-radius:8px;box-sizing:border-box;margin-top:6px}' +
    '#qrRecv .qr-list{max-height:40vh;overflow:auto;margin:8px 0 0;font-size:15px}#qrRecv .qr-list div{padding:6px 0;border-bottom:1px solid #eee}' +
    '#qrRecv .qr-msg{min-height:1.5em;margin-top:8px;font-weight:700}#qrRecv .qr-row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}' +
    '#qrRecv button{font-size:16px;padding:10px 16px;border-radius:8px;border:1px solid #bbb;background:#fff;cursor:pointer}#qrRecv button.pri{background:#c8102e;color:#fff;border-color:#c8102e}' +
    '@media print{html.k-on,body.k-printing{margin:0 !important;padding:0 !important;min-height:0 !important;height:auto !important;overflow:visible !important}body.k-printing>*:not(#kPrint){display:none !important}body.k-printing #kPrint{display:block !important;font-family:"맑은 고딕",sans-serif;color:#000}' +
    '#kPrint h1{font-size:20pt;margin:0 0 4pt}#kPrint .p-no{font-size:26pt;font-weight:900;margin:2pt 0 8pt}#kPrint .p-it{border:1.5pt solid #000;border-radius:6pt;padding:8pt 10pt;margin:8pt 0;font-size:15pt;page-break-inside:avoid}' +
    '#kPrint .p-zip{font-size:24pt;font-weight:900;letter-spacing:2pt}#kPrint .p-s{font-size:12pt}#kPrint .p-foot{font-size:10pt;margin-top:10pt}}';

  function build() {
    if (root) { return; }
    var sty = document.createElement('style');
    sty.textContent = CSS;
    document.head.appendChild(sty);
    root = document.createElement('div');
    root.id = 'kiosk';
    root.hidden = true;
    root.setAttribute('role', 'application');
    root.setAttribute('aria-label', '어르신 직접 주소 입력');
    root.innerHTML = '<div class="k-top"><div class="k-brand">우편 주소 쉽게 쓰기</div><div class="k-tools">' +
      '<button type="button" data-f="1">가</button><button type="button" data-f="1.25">가+</button><button type="button" data-f="1.5">가++</button>' +
      '<button type="button" id="kSound">소리로 듣기</button></div></div>' +
      '<div class="k-main" id="kMain" aria-live="polite"></div>' +
      '<div class="k-foot"><span>적으신 내용은 이 기기 안에서만 쓰고, 마치면 바로 지워집니다. 우편번호는 정부 고시 자료로 찾습니다.</span>' +
      '<button type="button" class="k-staff" id="kStaff" title="직원: 2초 동안 누르세요">직원</button></div>';
    document.body.appendChild(root);
    var pr = document.createElement('div');
    pr.id = 'kPrint';
    document.body.appendChild(pr);
    main = $('#kMain', root);
    main.setAttribute('aria-live', 'polite');
    Array.prototype.forEach.call(root.querySelectorAll('[data-f]'), function (b) {
      b.onclick = function () { setCfg({ font: b.getAttribute('data-f') }); applyFont(); };
    });
    $('#kSound', root).onclick = function () {
      setCfg({ sound: !cfg().sound });
      applyFont();
      if (cfg().sound) { speak('소리로 읽어 드릴게요.'); } else if (window.speechSynthesis) { speechSynthesis.cancel(); }
    };
    var hold = null;
    var sb = $('#kStaff', root);
    var t0 = 0;
    function down(e) { e.preventDefault(); t0 = Date.now(); hold = setTimeout(function () { hold = null; staffPanel(); }, 2000); }
    function up() { if (hold && t0 && Date.now() - t0 < 2000) { toast('직원용 설정이에요. 2초 동안 꾹 누르세요.'); } clearTimeout(hold); hold = null; t0 = 0; }
    sb.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    sb.addEventListener('pointerdown', down);
    sb.addEventListener('pointerup', up);
    sb.addEventListener('pointerleave', function () { clearTimeout(hold); hold = null; t0 = 0; });
    document.addEventListener('pointerdown', touch, true);
    document.addEventListener('keydown', touch, true);
    applyFont();
  }
  function applyFont() {
    var f = cfg().font || '1.25';
    root.style.setProperty('--kf', f);
    Array.prototype.forEach.call(root.querySelectorAll('[data-f]'), function (b) { b.classList.toggle('on', b.getAttribute('data-f') === f); });
    $('#kSound', root).classList.toggle('on', !!cfg().sound);
  }
  function speak(t) {
    try {
      if (!cfg().sound || !window.speechSynthesis) { return; }
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(String(t).replace(/<[^>]+>/g, ' '));
      u.lang = 'ko-KR'; u.rate = 0.9;
      speechSynthesis.speak(u);
    } catch (e) { }
  }
  function toast(t) {
    var d = document.createElement('div');
    d.className = 'k-toast';
    d.textContent = t;
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 3500);
  }
  function modal(html, buttons) {
    closeModal();
    var m = document.createElement('div');
    m.className = 'k-modal';
    m.id = 'kModal';
    m.innerHTML = '<div>' + html + '<div class="k-row" id="kModalBtns"></div></div>';
    document.body.appendChild(m);
    var box = $('#kModalBtns', m);
    (buttons || []).forEach(function (b) {
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'k-btn ' + (b[2] || 'pri');
      x.textContent = b[0];
      x.onclick = b[1];
      box.appendChild(x);
    });
    return m;
  }
  function closeModal() { var m = $('#kModal'); if (m) { m.remove(); } }

  // 화면 하나 = 말풍선 + 입력/선택. trail 은 지금까지 주고받은 말.
  function stopCam() { try { if (window.__cam) { __cam.stop(); } } catch (e) { } }
  function screen(fn, args) { stopCam(); hist.push([fn, args || []]); fn.apply(null, args || []); }
  function back() {
    if (hist.length < 2) { return; }
    stopCam();
    hist.pop();
    var h = hist[hist.length - 1];
    h[0].apply(null, h[1]);
  }
  function frame(q, sub, body) {
    var tr = st.trail.length ? '<div class="k-trail">' + st.trail.slice(-3).map(function (x) { return esc(x[0]) + ' → <b>' + esc(x[1]) + '</b>'; }).join('<br>') + '</div>' : '';
    main.innerHTML = tr + '<div class="k-bubble">' + q + (sub ? '<small>' + sub + '</small>' : '') + '</div>' + body;
    main.scrollTop = 0;
    speak(q + (sub ? '. ' + sub : ''));
  }
  function btn(label, cls, fn, id) {
    return { label: label, cls: cls, fn: fn, id: id };
  }
  function row(btns, plain) {
    var h = '<div class="k-row' + (plain ? '' : ' k-act') + '">';
    btns.forEach(function (b, i) { h += '<button type="button" class="k-btn ' + (b.cls || '') + '" data-b="' + i + '"' + (b.id ? ' id="' + b.id + '"' : '') + '>' + esc(b.label) + '</button>'; });
    return h + '</div>';
  }
  function bindRow(btns) {
    Array.prototype.forEach.call(main.querySelectorAll('[data-b]'), function (el) {
      var b = btns[Number(el.getAttribute('data-b'))];
      if (b) { el.onclick = b.fn; }
    });
  }

  // ------------------------------------------------------------------ 1. 처음 화면
  function welcome() {
    hist = [];
    main.innerHTML = '<div class="k-bubble" style="text-align:center">우편 보낼 주소를<br>쉽게 적어 드려요' +
      '<small>말씀하시거나 글자로 적어 주세요. 우편번호는 저희가 찾아 드려요.<br>동네 이름이나 아파트 이름만 아셔도 괜찮아요.</small></div>' +
      row([btn('시작하기', 'pri', function () { newCur('recv'); screen(askAddress); }, 'kStart')]);
    bindRow([btn('시작하기', 'pri', function () { newCur('recv'); screen(askAddress); })]);
    speak('우편 보낼 주소를 쉽게 적어 드려요. 시작하기를 눌러 주세요.');
  }

  // ------------------------------------------------------------------ 2. 주소 묻기
  function askAddress(again, prefill) {
    var c = st.cur;
    var who = c.kind === 'send' ? '보내시는 분(어르신) 주소를 말씀해 주세요.' : (st.entries.length ? '다음 분은 어디로 보내세요?' : '어디로 보내세요?');
    var sub = again || '동네 이름, 길 이름과 번호, 아파트 이름 중 아시는 대로 적어 주세요.';
    var mic = SR && !micOff() ? '<button type="button" class="k-btn" id="kMic">말로 하기</button>' : '';
    var cam = camOk() ? '<button type="button" class="k-btn ok" id="kCam">📷 휴대폰에 온 주소 문자 보여 주기</button>' : '';
    var city = clean(cfg().region || mainRegion()).split(' ').slice(-1)[0] || '정읍시';
    frame(esc(who), esc(sub),
      '<input class="k-input" id="kIn" autocomplete="off" placeholder="예) 정읍시 수성동 현대아파트 102동" value="' + esc(prefill || '') + '" style="margin-top:4px">' +
      '<div class="k-sub" style="margin-top:6px">이렇게 적으시면 돼요: 「' + esc(city) + ' ○○동 ○○아파트 101동」 · 「○○로 12」 · 「○○면 ○○리 123」</div>' +
      '<div class="k-row">' + mic + '<button type="button" class="k-btn pri" id="kGo">다 적었어요</button></div>' +
      (cam ? '<div class="k-row">' + cam + '</div>' : '') +
      '<div class="k-row"><button type="button" class="k-btn sub sm" id="kRegion">지역부터 고르기</button>' +
      (hist.length > 1 ? '<button type="button" class="k-btn sub sm" id="kBack">이전으로</button>' : '') + '<button type="button" class="k-btn sub sm" id="kHelp">직원 도움 받기(창구에서 할게요)</button></div>');
    var inp = $('#kIn', main);
    setTimeout(function () { inp.focus(); }, 50);
    $('#kHelp', main).onclick = function () { var v = clean(inp.value); if (v) { st.cur.raw = v; } if (c.kind === 'send') { st.trail.push(['보내는 분 주소', '창구에서']); return screen(finish); } screen(giveUp); };
    if ($('#kCam', main)) { $('#kCam', main).onclick = function () { screen(camScreen); }; }
    function go() {
      var v = clean(inp.value);
      if (!v) { toast('주소를 조금이라도 적어 주세요.'); return; }
      onAddress(v);
    }
    $('#kGo', main).onclick = go;
    inp.onkeydown = function (e) { if (e.key === 'Enter') { go(); } };
    $('#kRegion', main).onclick = function () { st.cur.raw = clean(inp.value); st.cur.text = normalize(inp.value); screen(pickSido); };
    if ($('#kBack', main)) { $('#kBack', main).onclick = back; }
    if ($('#kMic', main)) {
      $('#kMic', main).onclick = function () {
        listen(function (t) { inp.value = t; toast('이렇게 들었어요: ' + t); setTimeout(go, 900); });
      };
    }
  }
  function listen(onText) {
    try {
      var rec = new SR();
      rec.lang = 'ko-KR'; rec.interimResults = false; rec.maxAlternatives = 1;
      rec.onresult = function (e) { onText(e.results[0][0].transcript); };
      rec.onerror = function (e) {
        var off = e.error === 'network' || e.error === 'not-allowed' || e.error === 'service-not-allowed';
        if (off) { try { sessionStorage.setItem('zipfinder.kiosk.micoff', '1'); } catch (x) { } Array.prototype.forEach.call(document.querySelectorAll('#kMic'), function (b) { b.remove(); }); }   // 인터넷 없는 민원실: 한 번 안 되면 단추를 숨긴다
        toast(off ? '이 기기에서는 말로 하기가 안 돼요. 글자로 적어 주세요.' : '잘 못 들었어요. 다시 눌러 주세요.');
      };
      rec.start();
      toast('말씀해 주세요. 듣고 있어요.');
    } catch (e) { toast('이 기기에서는 말로 하기가 안 돼요. 글자로 적어 주세요.'); }
  }
  function micOff() { try { return sessionStorage.getItem('zipfinder.kiosk.micoff') === '1' || !!cfg().noMic; } catch (e) { return false; } }
  function onAddress(v) {
    var c = st.cur;
    c.raw = v;
    c.text = normalize(v);
    c.region = ''; c.regionToks = []; c.triedAI = false; c.ai = false;   // tries는 새 주소(newCur)에서만 0으로: 같은 주소를 몇 번 다시 적었는지 세어 막다른 반복을 끊는다
    st.trail.push(['주소', v]);
    resolve();
  }
  function withRegion(t) {
    var c = st.cur;
    if (!c.region) { return t; }
    var rest = t.split(' ').filter(function (w) { return c.regionToks.indexOf(w) < 0; }).join(' ');
    return clean(c.region + ' ' + rest);
  }
  function resolve() {
    var c = st.cur;
    var q = withRegion(c.text);
    var r = look(q);
    if (rank(r) >= 4 && !/건물번호 없음|번지 없음|번호 없음/.test(r.note || '')) { return screen(confirmAddr, [r, false]); }   // 번호 없이 찾은 것은 번호를 한 번 묻는다
    if (aiCfg() && !c.triedAI) {
      c.triedAI = true;
      c.aiSkip = false;
      var skipBtn = [btn('기다리지 않고 진행', 'sub', function () { c.aiSkip = true; decide(r, q); })];
      main.innerHTML = '<div class="k-bubble">주소를 정리하고 있어요… 잠시만요.<small>AI가 말씀을 주소로 정리하는 중이에요(최대 25초).</small></div>' + row(skipBtn);
      bindRow(skipBtn);
      return aiAssist(c.raw).then(function (b) {
        if (c.aiSkip) { return; }
        if (b && rank(b.r) > rank(r)) {
          c.ai = true;
          if (b.detail) { c.aiDetail = b.detail; }
          if (rank(b.r) >= 4) { return screen(confirmAddr, [b.r, false]); }
          r = b.r;
        }
        decide(r, q);
      });
    }
    decide(r, q);
  }
  function decide(r, q) {
    var c = st.cur;
    c.tries++;
    var note = r.note || '';
    if (!rank(r) && /시·도와 시·군·구/.test(note) && !c.region) { return screen(pickRegion); }
    if (rank(r) < 4 && BLD.test(c.text) && c.tries <= 3) {
      var hb = byBuilding(q);
      if (!hb) {                       // 「현대아파트」처럼 흔한 꼬리말을 떼고 이름만으로 한 번 더
        var q2 = clean(q.replace(/(\d{1,4}\s*동\s*)?\d{1,4}\s*호|\d{1,3}\s*층/g, ' ').replace(/(아파트|빌라|맨션|오피스텔)(?=\s|$)/g, ' '));
        if (q2 && q2 !== q) { hb = byBuilding(q2); }
      }
      if (hb && hb.r) { return screen(confirmAddr, [hb.r, hb.r.conf !== '상']); }
      if (hb && hb.list) { return screen(chooseCand, [hb.list.slice(0, 8)]); }
    }
    if (rank(r) >= 2 && /번지 없음|건물번호 없음|번호 없음|번호가 없|가까운|구간이 가장 넓은/.test(note)) { return screen(askNumber, [r]); }
    if (rank(r) >= 2) { return screen(confirmAddr, [r, true]); }
    var list = [];
    try { list = E().search(q, 8) || []; } catch (e) { list = []; }
    if (list.length && c.tries <= 3) { return screen(chooseCand, [list]); }
    if (c.tries > 3) {
      return screen(giveUp);
    }
    screen(askAddress, [c.tries >= 2 ? '여전히 찾기 어려워요. 받는 분 휴대폰 문자에 온 주소를 그대로 적거나, 아래 「직원 도움 받기」를 눌러 주세요.' : '찾기 어려워요. 시·군 이름부터 천천히 적어 주세요. 예) 정읍시 수성동, 전주시 효자로 225']);
  }

  // ------------------------------------------------------------------ 3. 지역 고르기
  function pickRegion() {
    var e = E(), c = st.cur, seen = {}, cands = [];
    var toks = c.text.split(' ');
    toks.forEach(function (w, i) {
      [w, i + 1 < toks.length ? w + ' ' + toks[i + 1] : ''].forEach(function (s) {
        if (!s) { return; }
        var gs = [];
        try { gs = e.parseRegion(s) || []; } catch (x) { gs = []; }
        gs.forEach(function (g) { if (!seen[g]) { seen[g] = 1; cands.push({ g: g, tok: s }); } });
      });
    });
    if (cands.length === 1) { return setRegion(cands[0].g, cands[0].tok); }
    if (!cands.length || cands.length > 12) { return pickSido(!cands.length ? '적으신 「' + clean(st.cur.text || st.cur.raw || '').slice(0, 30) + '」로는 찾지 못했어요. 지역부터 골라 볼까요?' : '같은 이름이 여러 곳에 있어요. 지역부터 골라 주세요.'); }
    var body = '<div>' + cands.map(function (x, i) { return '<button type="button" class="k-choice" data-c="' + i + '">' + esc(e.sggLabel(x.g)) + '</button>'; }).join('') + '</div>' +
      row([btn('여기 없어요', 'sub', pickSido), btn('이전으로', 'sub', back)]);
    frame('어느 시·군·구인가요?', '맞는 곳을 눌러 주세요.', body);
    bindRow([btn('여기 없어요', 'sub', pickSido), btn('이전으로', 'sub', back)]);
    Array.prototype.forEach.call(main.querySelectorAll('[data-c]'), function (el) {
      el.onclick = function () { var x = cands[Number(el.getAttribute('data-c'))]; setRegion(x.g, x.tok); };
    });
  }
  function pickSido(why) {
    var e = E(), db = e.db || {};
    var sido = db.sido || [];
    var mine = clean(cfg().region || mainRegion()).split(' ')[0];   // 우리 동네 시·도를 맨 앞에
    var order = sido.map(function (n, i) { return i; });
    order.sort(function (a, b) { return (sido[b] === mine) - (sido[a] === mine) || a - b; });
    var body = '<div class="k-grid">' + order.map(function (i) { return '<button type="button" class="k-choice" data-s="' + i + '">' + esc(sido[i]) + '</button>'; }).join('') + '</div>' +
      row([btn('이전으로', 'sub', back)]);
    frame('보내실 곳이 어느 시·도인가요?', typeof why === 'string' ? esc(why) : '', body);
    bindRow([btn('이전으로', 'sub', back)]);
    Array.prototype.forEach.call(main.querySelectorAll('[data-s]'), function (el) {
      el.onclick = function () { screen(pickSgg, [Number(el.getAttribute('data-s'))]); };
    });
  }
  function pickSgg(si) {
    var e = E(), db = e.db || {};
    var list = [];
    (db.sgg || []).forEach(function (x, g) { if (x[0] === si) { list.push({ g: g, n: x[1] || db.sido[si] }); } });
    list.sort(function (a, b) { return String(a.n).localeCompare(String(b.n), 'ko'); });
    if (list.length === 1) { return setRegion(list[0].g, ''); }
    var body = '<div class="k-grid">' + list.map(function (x, i) { return '<button type="button" class="k-choice" data-g="' + i + '">' + esc(x.n) + '</button>'; }).join('') + '</div>' +
      row([btn('이전으로', 'sub', back)]);
    frame('어느 시·군·구인가요?', esc(db.sido[si] || ''), body);
    bindRow([btn('이전으로', 'sub', back)]);
    Array.prototype.forEach.call(main.querySelectorAll('[data-g]'), function (el) {
      el.onclick = function () { setRegion(list[Number(el.getAttribute('data-g'))].g, ''); };
    });
  }
  function setRegion(g, tok) {
    var c = st.cur, e = E();
    c.region = e.sggLabel(g);
    c.regionToks = tok ? tok.split(' ') : [];
    st.trail.push(['지역', c.region]);
    if (!clean(c.text)) { return screen(askAddress, ['좋아요. ' + c.region + ' 다음 주소(동네·길 이름, 번지, 아파트 이름)를 적어 주세요.']); }
    resolve();
  }

  // ------------------------------------------------------------------ 4. 후보 고르기·번호 묻기
  function chooseCand(list) {
    var body = '<div>' + list.map(function (x, i) {
      return '<button type="button" class="k-choice" data-c="' + i + '">' + esc(x.addr) + '<small>' + esc(x.range || '') + (x.zip ? ' · 우편번호 ' + esc(x.zip) : '') + '</small></button>';
    }).join('') + '</div>' + row([btn('여기 없어요', 'sub', function () { screen(askAddress, ['다르게 한 번 더 적어 주세요. 아파트·건물 이름이나 길 이름을 넣으면 쉬워요.']); }), btn('이전으로', 'sub', back)]);
    frame('혹시 이 중에 있나요?', '맞는 곳을 눌러 주세요.', body);
    bindRow([btn('여기 없어요', 'sub', function () { screen(askAddress, ['다르게 한 번 더 적어 주세요. 아파트·건물 이름이나 길 이름을 넣으면 쉬워요.']); }), btn('이전으로', 'sub', back)]);
    Array.prototype.forEach.call(main.querySelectorAll('[data-c]'), function (el) {
      el.onclick = function () {
        var x = list[Number(el.getAttribute('data-c'))];
        st.trail.push(['고른 곳', x.addr]);
        if (x.range === '건물명' && x.zip) {   // 건물을 골랐으면 그 건물의 우편번호 그대로(다시 찾으면 동 전체 추정 번호로 바뀌던 것)
          return screen(confirmAddr, [{ grade: '유사', conf: '상', zip: x.zip, addr1: x.addr, addr2: '', note: '건물명 일치(목록에서 고름)' }, false]);
        }
        var r = look(x.addr);
        if (rank(r) >= 2 && /번지 없음|건물번호 없음|번호 없음|가까운|구간이 가장 넓은/.test(r.note || '')) { st.cur.text = x.addr; st.cur.region = ''; return screen(askNumber, [r]); }
        if (rank(r) >= 4) { return screen(confirmAddr, [r, false]); }
        if (rank(r) >= 2) { return screen(confirmAddr, [r, true]); }
        screen(confirmAddr, [{ grade: '유사', conf: '중', zip: x.zip, addr1: x.addr, addr2: '', note: '목록에서 고름' }, true]);
      };
    });
  }
  function askNumber(r) {
    keypad({
      q: '번지나 대문(건물) 번호를 아세요?',
      sub: '찾은 곳: ' + (r.addr1 || '') + '. 아시면 눌러 주시고, 모르시면 「몰라요」를 눌러 주세요.',
      dash: true,
      done: function (v) {
        if (!v) { toast('번호를 모르시면 「몰라요」를 눌러 주세요.'); speak('번호를 모르시면 몰라요를 눌러 주세요.'); return; }
        st.trail.push(['번호', v]);
        var c = st.cur, prev = c.text;
        c.text = clean(c.text + ' ' + v);
        var q = withRegion(c.text);
        var r2 = look(q);
        if (rank(r2) >= 4) { return screen(confirmAddr, [r2, false]); }
        screen(numMiss, [r, v, prev]);   // 없는 번호: 「맞으세요?」로 넘기지 않고 다시 묻는다
      },
      skip: ['몰라요', function () { st.trail.push(['번호', '모름']); screen(confirmAddr, [r, true]); }]
    });
  }
  function numMiss(r, v, prev) {
    var b = [btn('번호 다시 누르기', 'pri', function () { st.cur.text = prev; back(); }),
      btn('번호 없이 갈게요', 'sub', function () { st.cur.text = prev; st.trail.push(['번호', '모름']); screen(confirmAddr, [r, true]); })];
    frame('「' + esc(v) + '」번은 ' + (/[로길]\s*$/.test(clean(prev)) || /[로길](\s|$)/.test(prev) ? '이 길' : '이 동네') + '에서 찾지 못했어요.', '번호를 한 번 더 확인해 주세요. 모르시면 번호 없이 가고, 창구에서 확인해 드릴게요.', row(b));
    bindRow(b);
  }
  function giveUp() {
    var send = st.cur && st.cur.kind === 'send';
    var b = [btn('다시 적기', 'pri', function () { newCurKeep(); screen(askAddress); }), btn('창구에서 할게요', 'sub', function () { screen(send ? finish : listView); })];
    frame('주소를 찾기가 어려워요.', '괜찮아요. 창구 직원이 도와 드릴게요. 적으신 내용은 메모로 남겨 둘게요.', row(b));
    bindRow(b);
    var c = st.cur;
    if (c.kind === 'recv' && c.raw && !c.gaveUp) {
      c.gaveUp = true;
      st.entries.push({ name: '', phone: '', zip: '', addr1: c.raw, addr2: '', check: true, note: '주소 찾기 실패 · 창구 확인' });
    }
  }
  function newCurKeep() { var k = st.cur ? st.cur.kind : 'recv'; newCur(k); }

  // ------------------------------------------------------------------ 5. 주소 확인
  // 엔진 결과를 「주소 본체」와 「나머지(동·호수)」로 나눈다. 지번(리·번지)과 건물명은 본체에 남긴다.
  function splitAddr(r) {
    var a1 = r.addr1 || '', a2 = clean(r.addr2 || ''), k = r.canon || {};
    if (!k.road && k.m) {
      var ess = clean([k.ri || '', (k.san ? '산' : '') + k.m + (k.s ? '-' + k.s : '')].join(' '));
      if (a2.indexOf(ess) === 0) { return { base: clean(a1 + ' ' + ess), detail: clean(a2.slice(ess.length)) }; }
    }
    var bm = (r.note || '').match(/건물명[^(]*\(([^)]+)\)/);
    if (bm && a2.indexOf(bm[1]) === 0) { return { base: clean(a1 + ' ' + bm[1]), detail: clean(a2.slice(bm[1].length)) }; }
    return { base: a1, detail: a2 };
  }
  function confirmAddr(r, check) {
    var c = st.cur;
    var sp = splitAddr(r);
    var detail = clean(c.aiDetail || sp.detail || tailDetail(c.text) || '');
    c.base = sp.base;
    var guess = isGuess(r);
    if (guess) { check = true; }
    var body = '<div class="k-card">' + (guess ? '<div class="k-warn" style="font-size:1.15em">우편번호는 창구에서 정해 드려요</div><div class="k-sub">동네까지는 찾았는데 번지가 없어 우편번호를 하나로 정할 수 없어요.</div>' : '<div class="k-zip">' + esc(r.zip || '-') + '</div>') + '<div class="k-addr">' + esc(sp.base) + (detail ? ' ' + esc(detail) : '') + '</div>' +
      (c.ai ? '<div class="k-sub k-ai">AI 도움으로 말씀을 정리한 뒤, 우편번호는 정부 고시 자료로 확인했어요.</div>' : '') +
      (check && !guess ? '<div class="k-sub k-warn">비슷한 주소로 찾았어요. 창구에서 한 번 더 확인해 드릴게요.</div>' : '') + '</div>';
    var b = [btn('네, 맞아요', 'ok', function () {
      c.res = guess ? Object.assign({}, r, { zip: '', zipGuess: r.zip }) : r; c.check = !!check; c.detail = detail;
      c.why = guess ? '번지 없음: 동 안 우편번호 여러 개' : (check ? '비슷한 주소로 찾음' : '');
      st.trail.push(['확인', (guess ? '우편번호 창구 확인' : (r.zip || '')) + ' ' + sp.base]);
      screen(askDetail);
    }), btn('아니요, 다시 할게요', 'sub', function () { newCurKeep(); screen(askAddress, ['다시 적어 주세요. 길 이름과 번호, 또는 동네와 번지를 적으면 정확해요.']); })];
    frame('이 주소가 맞으세요?', (guess ? '' : '우편번호 ' + esc(r.zip || '') + '. ') + esc(sp.base), body + row(b));
    bindRow(b);
  }
  function askDetail() {
    var c = st.cur;
    var b = [btn('다음', 'pri', function () { c.detail = clean($('#kIn', main).value); st.trail.push(['나머지 주소', c.detail || '없음']); afterDetail(); }),
      btn('더 적을 게 없어요', 'sub', function () { c.detail = ''; st.trail.push(['나머지 주소', '없음']); afterDetail(); }), btn('이전으로', 'sub', back)];
    frame('동·호수나 층처럼 더 적을 게 있으세요?', '예) 102동 304호, 2층. 없으면 「더 적을 게 없어요」를 눌러 주세요.',
      '<input class="k-input" id="kIn" autocomplete="off" value="' + esc(c.detail) + '" placeholder="예) 102동 304호">' + row(b));
    bindRow(b);
    var inp = $('#kIn', main);
    inp.onkeydown = function (e) { if (e.key === 'Enter') { b[0].fn(); } };
    setTimeout(function () { inp.focus(); }, 50);
  }
  function afterDetail() {
    var c = st.cur;
    if (c.kind === 'send') {
      st.sender.zip = c.res.zip || '';
      st.sender.addr1 = c.base || c.res.addr1 || '';
      st.sender.addr2 = c.detail;
      return screen(finish);
    }
    screen(askName);
  }

  // ------------------------------------------------------------------ 6. 이름·전화
  function askName() {
    var c = st.cur, send = c.kind === 'send';
    var mic = SR && !micOff() ? btn('말로 하기', '', function () { listen(function (t) { $('#kIn', main).value = clean(t); }); }) : null;
    var b = [btn('다음', 'pri', function () {
      var v = clean($('#kIn', main).value);
      if (!v) { toast('성함을 적어 주세요. 모르시면 「아들」처럼 적으셔도 돼요.'); return; }
      if (v.length > 15) { toast('성함은 15자 안으로 적어 주세요.'); return; }
      v = clean(v.replace(/\s*(할머니|할아버지|어머님|아버님|님|씨|선생님|여사님?)$/, '')) || v;   // 스티커에 「할머니 귀하」가 찍히지 않게 호칭은 뗀다
      if (/^(아들|딸|손주|손자|손녀|며느리|사위|동생|언니|오빠|형|누나|큰아들|작은아들|큰딸|작은딸|아들네|딸네)$/.test(v)) { c.check = true; c.why = clean((c.why || '') + ' · 받는 분 성함 창구 확인'); }
      st.trail.push([send ? '보내시는 분' : '받으실 분', v]);
      if (send) { st.sender = st.sender || {}; st.sender.name = v; } else { c.name = v; }
      screen(askPhone);
    })];
    if (mic) { b.unshift(mic); }
    b.push(btn('이전으로', 'sub', back));
    frame(send ? '보내시는 분(어르신) 성함은요?' : '받으실 분 성함은요?', send ? '택배·소포에 보내는 분으로 적혀요.' : (c.ocr && c.ocr.name ? '사진에서 읽은 이름이에요. 맞는지 확인해 주세요.' : ''), '<input class="k-input" id="kIn" autocomplete="off" placeholder="예) 홍길동" value="' + esc(send ? (st.sender && st.sender.name || '') : (c.name || (c.ocr && c.ocr.name) || '')) + '">' + row(b));
    bindRow(b);
    var inp = $('#kIn', main);
    inp.onkeydown = function (e) { if (e.key === 'Enter') { b[mic ? 1 : 0].fn(); } };
    setTimeout(function () { inp.focus(); }, 50);
  }
  function askPhone() {
    var c = st.cur, send = c.kind === 'send';
    keypad({
      q: send ? '보내시는 분 전화번호를 눌러 주세요.' : '받으실 분 전화번호를 아세요?',
      sub: send ? '배달 소식을 알려 드릴 때 써요. 모르시면 「건너뛰기」를 눌러 주세요.' : (c.ocr && c.ocr.phone ? '사진에서 읽은 번호예요. 맞는지 꼭 확인해 주세요. 다르면 「지우기」로 지우고 다시 눌러 주세요.' : '배달할 때 연락드려요. 모르시면 「건너뛰기」를 눌러 주세요.'),
      phone: true,
      init: send ? '' : (c.ocr && c.ocr.phone || ''),
      done: function (v) {
        v = phoneFmt(v);
        if (v && !/^0\d{1,2}-\d{3,4}-\d{4}$/.test(v)) { toast('번호가 ' + String(v).replace(/\D/g, '').length + '자리예요. 다 아시면 고쳐 주시고, 모르시면 「건너뛰기」를 눌러 주세요.'); return; }
        st.trail.push(['전화', v || '없음']);
        if (send) { st.sender.phone = v; return screen(askSenderAddr); }
        c.phone = v;
        saveEntry();
      },
      skip: ['건너뛰기', function () {
        st.trail.push(['전화', '없음']);
        if (send) { st.sender.phone = ''; return screen(askSenderAddr); }
        c.phone = ''; saveEntry();
      }]
    });
  }
  function saveEntry() {
    var c = st.cur, r = c.res || {};
    if (!st.no) { st.no = nextNo(); }   // 접수 번호는 첫 받는 곳을 저장할 때 받는다(지울 때마다 번호가 건너뛰던 것)
    st.entries.push({ name: c.name, phone: c.phone, zip: r.zip || '', zipGuess: r.zipGuess || '', addr1: c.base || r.addr1 || '', addr2: c.detail, check: c.check, why: c.why || '', note: [c.ai ? 'AI 정리' : '', c.why || ''].filter(Boolean).join(' · ') });
    log('어르신 직접 입력', 1, '접수번호 ' + st.no + ' · ' + st.entries.length + '번째');
    screen(listView);
  }

  // ------------------------------------------------------------------ 사진으로 읽기(웹캠 → 글자 → 주소 후보)
  function camOk() { return !!(window.__cam && __cam.supported()); }
  function camScreen() {
    var b = [btn('사진 찍기', 'pri', null, 'kShot'), btn('글자로 적을게요', 'sub', back)];
    var switchBtn = '<div class="k-row" style="margin-top:8px"><button type="button" class="k-btn sub sm" id="kFlip" hidden>앞·뒤 카메라 바꾸기</button></div>';
    frame('휴대폰 문자 화면을 카메라에 보여 주세요', '받은 주소가 보이게 화면을 켜고, 글자가 크게 보이도록 선 안에 가득 차게 대 주세요. 화면은 밝게!',
      '<div class="k-cam" id="kCamBox"><video id="kVid" playsinline muted></video><div class="k-guide"><span>이 선 안에 휴대폰 화면</span></div></div><div class="k-sub">태블릿이면 <b>뒤쪽 동그란 카메라</b> 앞에, 노트북이면 <b>화면 위 작은 카메라</b> 앞에 휴대폰을 대 주세요.</div>' + switchBtn + row(b));
    bindRow(b);
    var vid = $('#kVid', main), shot = $('#kShot', main), box = $('#kCamBox', main);
    shot.disabled = true;
    var flip = $('#kFlip', main);
    function startCam() {
      shot.disabled = true;
      return __cam.start(vid).then(function () {
        shot.disabled = false;
        try { __cam.load(); } catch (e) { }   // 찍기 전에 글자 읽기 엔진을 미리 깨워 둔다
        __cam.cameraCount().then(function (n) { if (flip) { flip.hidden = n < 2; } });
      });
    }
    if (flip) { flip.onclick = function () { __cam.toggleFacing(); startCam().then(null, function () { toast('카메라를 바꾸지 못했어요.'); }); }; }
    startCam().then(null, function (e) {
      var denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      box.innerHTML = '<div class="k-bubble" style="margin:0;border-color:#eee">' + (denied ? '카메라 사용이 허용되지 않았어요.' : '카메라를 켤 수 없어요.') +
        '<small>직원에게 말씀해 주시거나, 글자로 적어 주세요.</small></div>';
    });
    shot.onclick = function () {
      if (__cam.busy()) { return; }
      var cv = __cam.grab(vid);
      __cam.stop();
      shot.disabled = true;
      box.innerHTML = '<div class="k-bubble" style="margin:0;border-color:#eee">글자를 읽고 있어요. 잠시만 기다려 주세요.<div class="k-prog"><i id="kBar"></i></div></div>';
      var bar = $('#kBar', box), tm = null;
      var fin = function (res, err) {
        clearTimeout(tm); cv.width = cv.height = 0;   // 찍은 사진은 바로 지운다
        if (!root || root.hidden || !st) { return; }
        if (err) { toast('사진을 읽지 못했어요. 다시 찍어 주세요.'); screen(camScreen); return; }
        log('사진으로 읽기', res.cands.length, '주소 후보 ' + res.cands.length + '개');
        screen(camResult, [res]);
      };
      tm = setTimeout(function () { fin(null, true); }, 90000);
      // 첫 읽기에서 정확한 주소와 이름·전화가 나오면 두 번째 읽기는 건너뛴다
      var good = function (all) { var r = __cam.extract(all, __cam.lookupFn(regionOpts()), { max: 1 }); return r.cands.length && r.cands[0].grade === '정확' && (r.name || r.phone); };
      __cam.read(cv, function (p) { if (bar) { bar.style.width = Math.max(12, Math.round(p * 100)) + '%'; } }, good).then(function (lines) {
        fin(__cam.extract(lines, __cam.lookupFn(regionOpts())));
      }, function () { fin(null, true); });
    };
  }
  function camResult(res) {
    var c = st.cur;
    c.ocr = { name: res.name || '', phone: res.phone || '' };
    var again = btn('다시 찍기', 'sub', function () { screen(camScreen); });
    var typed = btn('글자로 적을게요', 'sub', function () { screen(askAddress, ['읽은 글자를 보고 고쳐 적어 주세요.', res.guess || '']); });
    if (!res.cands.length) {
      var b0 = [btn('다시 찍기', 'pri', function () { screen(camScreen); })];
      if (res.guess) { b0.push(btn('읽은 글자를 고쳐 쓸게요', '', function () { screen(askAddress, ['읽은 글자를 보고 고쳐 적어 주세요.', res.guess]); })); }
      b0.push(btn('이전으로', 'sub', back));
      frame('주소를 잘 읽지 못했어요', '글자가 작거나 흐리면 어려워요. 휴대폰을 카메라에 가까이 대고, 화면을 밝게 해서 다시 찍어 보세요.' +
        (res.guess ? '<br>읽은 글자: ' + esc(res.guess) : ''), row(b0));
      bindRow(b0);
      return;
    }
    var who = (res.name || res.phone) ? '<div class="k-card"><div class="k-sub">함께 읽은 내용 · 다음 화면에서 한 번 더 확인해요</div>' +
      (res.name ? '받는 분 <b>' + esc(res.name) + '</b>' : '') + (res.name && res.phone ? ' · ' : '') + (res.phone ? '전화 <b>' + esc(res.phone) + '</b>' : '') + '</div>' : '';
    var list = '<div>' + res.cands.map(function (x, i) {
      var det = clean(x.addr2);
      return '<button type="button" class="k-choice" data-c="' + i + '"><span class="k-zip" style="font-size:1.5em">' + esc(x.zip) + '</span> ' + esc(x.addr1) +
        '<small>' + (det ? esc(det) + ' · ' : '') + (x.grade === '정확' ? '주소가 정확히 맞아요' : '비슷한 주소예요. 창구에서 한 번 더 확인해요') + '</small></button>';
    }).join('') + '</div>';
    var b = [again, typed];
    if (res.cands.length === 1) { b.unshift(btn('네, 이 주소예요', 'ok', function () { var el = main.querySelector('[data-c="0"]'); if (el) { el.click(); } })); }
    frame(res.cands.length > 1 ? '이 중에 맞는 주소를 눌러 주세요' : '이 주소가 맞으면 눌러 주세요', '사진에서 읽은 주소를 우편번호 자료로 다시 확인했어요.', who + list + row(b));
    bindRow(b);
    Array.prototype.forEach.call(main.querySelectorAll('[data-c]'), function (el) {
      el.onclick = function () {
        var x = res.cands[Number(el.getAttribute('data-c'))];
        c.raw = x.text; c.text = x.text; c.region = ''; c.regionToks = []; c.ai = false; c.aiDetail = '';
        st.trail.push(['사진에서 읽은 주소', x.text]);
        screen(confirmAddr, [x.r, x.grade !== '정확' || x.conf === '하']);
      };
    });
  }

  // ------------------------------------------------------------------ 7. 모은 주소
  function listView() {
    st.trail = [];
    var cards = st.entries.map(function (x, i) {
      return '<div class="k-card"><div class="k-zip">' + esc(x.zip || '확인 필요') + '</div><div class="k-addr">' + esc(x.addr1) + ' ' + esc(x.addr2) + '</div>' +
        '<div class="k-sub">' + esc(x.name || '받는 분 미입력') + (x.phone ? ' · ' + esc(x.phone) : '') + (x.check ? ' · <span class="k-warn">창구 확인</span>' : '') + '</div>' +
        '<div class="k-row"><button type="button" class="k-btn sub sm" data-del="' + i + '">이 주소 지우기</button></div></div>';
    }).join('');
    var b = [btn('한 곳 더 보내기', '', function () { newCur('recv'); screen(askAddress); }), btn('다 했어요', 'pri', function () {
      if (!st.entries.length) { toast('보낼 곳을 한 곳 이상 적어 주세요.'); return; }
      newCur('send'); screen(askName);
    })];
    frame('보내실 곳이 ' + st.entries.length + '곳이에요.', '더 보내실 곳이 있으면 「한 곳 더 보내기」, 다 되셨으면 「다 했어요」를 눌러 주세요.', cards + row(b));
    bindRow(b);
    Array.prototype.forEach.call(main.querySelectorAll('[data-del]'), function (el) {
      el.onclick = function () {
        var i = Number(el.getAttribute('data-del'));
        modal('<div class="k-bubble">이 주소를 지울까요?</div>', [['지울게요', function () { st.entries.splice(i, 1); closeModal(); listView(); }, 'pri'], ['아니요', closeModal, 'sub']]);
      };
    });
  }
  function askSenderAddr() {
    var b = [btn('네, 적을게요', 'pri', function () { var s = st.sender; newCur('send'); st.sender = s; screen(askAddress); }),
      btn('창구에서 적을게요', 'sub', function () { screen(finish); })];
    frame('보내시는 분 주소도 적어 주세요.', '택배·소포에는 보내는 분 주소가 꼭 들어가요. 어려우시면 창구에서 적으셔도 돼요.', row(b));
    bindRow(b);
  }

  // ------------------------------------------------------------------ 8. 마침
  function finish() {
    hist = [];
    var s = st.sender || {};
    if (!st.no) { st.no = nextNo(); }
    var what = paper() === 'lbl' ? '주소 스티커' : '접수 메모';
    var list = st.entries.map(function (x) { return '<div class="k-card"><b>' + esc(x.zip || '우편번호 창구 확인') + '</b> ' + esc(x.addr1) + ' ' + esc(x.addr2) + '<div class="k-sub">' + esc(x.name) + (x.phone ? ' · ' + esc(x.phone) : '') + (x.check ? ' · <span class="k-warn">창구에서 한 번 더 확인</span>' : '') + '</div></div>'; }).join('');
    main.innerHTML = '<div class="k-bubble" style="text-align:center">다 됐어요! 아래 빨간 단추를 눌러 ' + what + '를 뽑아 주세요.<div class="k-big">' + esc(st.no) + '번</div>' +
      '<small>소포 상자와 뽑은 ' + what + '를 들고 창구로 오세요. 뽑지 못하셨으면 직원을 불러 「' + esc(st.no) + '번」이라고 말씀해 주세요(이 화면은 10분 동안 남아 있어요).</small></div>' +
      '<div class="k-row" style="margin-top:4px"><button type="button" class="k-btn pri" id="kPrintBtn">' + what + ' 뽑기</button><button type="button" class="k-btn sub" id="kDone">처음 화면으로</button></div>' +
      '<div class="k-sub">보내시는 분: ' + esc(s.name || '') + (s.phone ? ' · ' + esc(s.phone) : '') + (s.addr1 ? ' · ' + esc(s.zip) + ' ' + esc(s.addr1) + ' ' + esc(s.addr2 || '') : '') + '</div>' + list;   // 뽑기 단추를 맨 위에(화면 아래로 밀려 안 보이던 것)
    st.finished = true;   // 직원이 「접수 화면으로 넘기기」(직원 설정)를 할 수 있게 자동 지우기를 늦춘다
    speak('다 됐어요. 빨간 단추를 눌러 ' + what + '를 뽑아 주세요. ' + st.no + '번입니다.');
    $('#kPrintBtn', main).onclick = function () { st.printed = true; printSlip(); };
    $('#kDone', main).onclick = function () {
      modal('<div class="k-bubble">적으신 내용을 지우고 처음으로 갈까요?<small>' + (st.printed ? '뽑으셨으면 지워도 괜찮아요.' : '아직 ' + what + '를 뽑지 않으셨어요. 먼저 「' + what + ' 뽑기」를 눌러 주세요.') + '</small></div>',
        [['아니요, 돌아갈게요', closeModal, 'pri'], ['지우고 처음으로', function () { closeModal(); wipe(); }, 'sub']]);   // 실수로 지우지 않게 「아니요」가 주 단추
    };
    touch();
    log('어르신 입력 완료', st.entries.length, '접수번호 ' + st.no);
    if (cfg().autoPrint) { toast('메모를 뽑고 있어요. 창구에 가져가세요.'); setTimeout(printSlip, 700); }
  }
  // ------------------------------------------------------------------ QR 접수 메모
  // 메모 내용 → JSON → (압축) → base32 대문자. QR 영숫자 모드에 맞고, 창구 스캐너가 한글 입력 상태여도 되살릴 수 있다.
  var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function b32enc(bytes) {
    var out = '', bits = 0, val = 0;
    for (var i = 0; i < bytes.length; i++) {
      val = ((val << 8) | bytes[i]) & 0xFFFF; bits += 8;
      while (bits >= 5) { out += B32.charAt((val >>> (bits - 5)) & 31); bits -= 5; val &= (1 << bits) - 1; }
    }
    if (bits > 0) { out += B32.charAt((val << (5 - bits)) & 31); }
    return out;
  }
  function b32dec(str) {
    var out = [], bits = 0, val = 0;
    for (var i = 0; i < str.length; i++) {
      var k = B32.indexOf(str.charAt(i)); if (k < 0) { continue; }
      val = ((val << 5) | k) & 0xFFFF; bits += 5;
      if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; val &= (1 << bits) - 1; }
    }
    return new Uint8Array(out);
  }
  function memoPayload() {
    if (!window.TextEncoder) { return ''; }
    var s = st.sender;
    var o = { v: 1, no: st.no, s: s ? [s.name || '', s.phone || '', s.zip || '', s.addr1 || '', s.addr2 || ''] : null,
      e: st.entries.map(function (x) { return [x.name || '', x.phone || '', x.zip || '', x.addr1 || '', x.addr2 || '', x.check ? 1 : 0]; }) };
    var bytes = new TextEncoder().encode(JSON.stringify(o)), tag = 'R';
    if (window.fflate && fflate.deflateSync) { try { bytes = fflate.deflateSync(bytes, { level: 9 }); tag = 'D'; } catch (e) { tag = 'R'; } }
    var t = 'ZQ1' + tag + ':' + b32enc(bytes);
    return t.length <= 3600 ? t : '';
  }
  function qrSvg(text) {
    if (!text || typeof qrcode !== 'function') { return ''; }
    try {
      var q = qrcode(0, 'L'); q.addData(text, 'Alphanumeric'); q.make();
      return q.createSvgTag({ cellSize: 2, margin: 2, scalable: true });
    } catch (e) { return ''; }
  }
  // 한글 입력 상태의 스캐너가 친 글자(ㅋㅂ1ㅇ: …)를 영문 자판 글자로 되돌린다(두벌식)
  var CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ', JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
  var JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  var KEYS = { 'ㄱ': 'r', 'ㄲ': 'R', 'ㄴ': 's', 'ㄷ': 'e', 'ㄸ': 'E', 'ㄹ': 'f', 'ㅁ': 'a', 'ㅂ': 'q', 'ㅃ': 'Q', 'ㅅ': 't', 'ㅆ': 'T', 'ㅇ': 'd', 'ㅈ': 'w', 'ㅉ': 'W', 'ㅊ': 'c', 'ㅋ': 'z', 'ㅌ': 'x', 'ㅍ': 'v', 'ㅎ': 'g',
    'ㅏ': 'k', 'ㅐ': 'o', 'ㅑ': 'i', 'ㅒ': 'O', 'ㅓ': 'j', 'ㅔ': 'p', 'ㅕ': 'u', 'ㅖ': 'P', 'ㅗ': 'h', 'ㅘ': 'hk', 'ㅙ': 'ho', 'ㅚ': 'hl', 'ㅛ': 'y', 'ㅜ': 'n', 'ㅝ': 'nj', 'ㅞ': 'np', 'ㅟ': 'nl', 'ㅠ': 'b', 'ㅡ': 'm', 'ㅢ': 'ml', 'ㅣ': 'l',
    'ㄳ': 'rt', 'ㄵ': 'sw', 'ㄶ': 'sg', 'ㄺ': 'fr', 'ㄻ': 'fa', 'ㄼ': 'fq', 'ㄽ': 'ft', 'ㄾ': 'fx', 'ㄿ': 'fv', 'ㅀ': 'fg', 'ㅄ': 'qt' };
  function toQwerty(t) {
    var out = '';
    for (var i = 0; i < t.length; i++) {
      var ch = t.charAt(i), c = t.charCodeAt(i);
      if (c >= 0xAC00 && c <= 0xD7A3) {
        var n = c - 0xAC00, jo = n % 28, ju = ((n - jo) / 28) % 21, ch0 = Math.floor(n / 588);
        out += KEYS[CHO.charAt(ch0)] + KEYS[JUNG.charAt(ju)] + (jo ? KEYS[JONG[jo]] : '');
      } else if (KEYS[ch]) { out += KEYS[ch]; } else { out += ch; }
    }
    return out;
  }
  function parseMemo(raw) {
    var t = toQwerty(String(raw || '')).toUpperCase().replace(/\s+/g, '');
    var m = t.match(/ZQ1([DR]):([A-Z2-7]+)/);
    if (!m) { return null; }
    try {
      var bytes = b32dec(m[2]);
      if (m[1] === 'D') { if (!window.fflate) { return null; } bytes = fflate.inflateSync(bytes); }
      var o = JSON.parse(new TextDecoder().decode(bytes));
      return o && o.v === 1 && o.e && o.e.length ? o : null;
    } catch (e) { return null; }
  }
  function slipHtml() {
    var s = st.sender || {};
    var t = new Date();
    var org = clean(cfg().org || ''), qr = qrSvg(memoPayload());
    return '<h1>' + (org ? esc(org) + ' ' : '') + '우편 접수 메모</h1><div class="p-no">' + esc(st.no) + '번</div>' +
      '<div class="p-s">' + t.toLocaleString('ko-KR') + ' · 보내는 분: ' + esc(s.name || '') + (s.phone ? ' (' + esc(s.phone) + ')' : '') +
      (s.addr1 ? ' · ' + esc(s.zip || '') + ' ' + esc(s.addr1) + ' ' + esc(s.addr2 || '') : '') + '</div>' +
      st.entries.map(function (x, i) {
        return '<div class="p-it"><div class="p-zip">' + esc(x.zip || '우편번호 확인 필요') + '</div><div>' + esc(x.addr1) + ' ' + esc(x.addr2) + '</div>' +
          '<div class="p-s">' + (i + 1) + '. 받는 분 ' + esc(x.name || '(미입력)') + (x.phone ? ' · ' + esc(x.phone) : '') + (x.check ? ' · 창구 확인 필요' + (x.why ? '(' + esc(x.why.replace(/^ · /, '')) + ')' : '') : '') + '</div></div>';
      }).join('') + (qr ? '<div class="p-qr">' + qr + '<div class="p-s">창구에서 이 QR을 찍으면 주소가 바로 들어갑니다</div></div>' : '') +
      '<div class="p-foot">개인정보가 담긴 메모입니다. 접수가 끝나면 창구에서 파기합니다.</div>';
  }
  function paper() { var p = cfg().paper; return p === '80' || p === '58' || p === 'lbl' ? p : 'a4'; }
  // 스티커(라벨 프린터) 용지 크기 mm · 기본은 인터넷우체국 주소라벨 2×6 규격(100×45)과 같은 크기
  var LBL_PRESETS = [[100, 45, '100×45 (인터넷우체국 라벨 2×6 규격)'], [100, 50, '100×50'], [80, 50, '80×50'], [70, 50, '70×50'], [60, 40, '60×40'], [100, 150, '100×150 (택배 송장 크기)']];
  function lblSize() {
    var c = cfg(), w = Number(c.lblW) || 100, h = Number(c.lblH) || 45;
    return [Math.min(Math.max(w, 30), 210), Math.min(Math.max(h, 20), 300)];
  }
  // 받는 분 한 곳 = 스티커 한 장. 기표지 주소란에 바로 붙인다
  function labelHtml(x, i, test) {
    var s = st.sender || {};
    var from = s.name ? '보내는 분 ' + esc(s.name) + (s.phone ? ' ' + esc(s.phone) : '') + (s.addr1 ? ' · ' + esc(s.addr1) + ' ' + esc(s.addr2 || '') : '') : '';
    return '<div class="p-lbl' + (test ? ' l-test' : '') + '"><div class="l-top"><span class="l-zip">' + esc(x.zip || '우편번호 확인필요') + '</span><span class="l-name">' + esc(x.name || '') + (x.name ? ' 귀하' : '') + '</span></div>' +
      '<div class="l-addr">' + esc(x.addr1) + ' ' + esc(x.addr2 || '') + '</div>' +
      (x.phone ? '<div class="l-tel">☎ ' + esc(x.phone) + '</div>' : '') +
      (test ? '<div class="l-ruler">' + test + '</div>' : '<div class="l-from">' + (from || '') + (from ? ' · ' : '') + '접수 ' + esc(st.no) + '번' + (x.check ? ' <span class="l-chk">· 창구 확인</span>' : '') + '</div>') + '</div>';
  }
  function labelsHtml(list, test) { return list.map(function (x, i) { return labelHtml(x, i, test); }).join(''); }
  // 글자가 칸을 넘치면 조금씩 줄여 맞춘다
  function fitLabels(box, w, h) {
    Array.prototype.forEach.call(box.querySelectorAll('.p-lbl'), function (el) {
      el.style.width = w + 'mm'; el.style.height = h + 'mm';
      var b = Math.min(20, h * 0.42);
      el.style.setProperty('--b', b + 'pt');
      for (var n = 0; n < 60 && b > 5 && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1); n++) { b -= 0.5; el.style.setProperty('--b', b + 'pt'); }
    });
  }
  function preparePrint(test) {
    var box = $('#kPrint'), pp = paper();
    var ps = $('#kPageCss');
    if (!ps) { ps = document.createElement('style'); ps.id = 'kPageCss'; document.head.appendChild(ps); }
    if (pp === 'lbl') {
      var sz = lblSize();
      box.className = 'p-lbl-wrap';
      box.innerHTML = test ? labelsHtml([test.entry], test.note) : labelsHtml(st.entries);
      box.style.cssText = 'display:block;position:fixed;left:-10000px;top:0;visibility:hidden';
      fitLabels(box, sz[0], sz[1]);
      box.removeAttribute('style');
      ps.textContent = '@page{size:' + sz[0] + 'mm ' + sz[1] + 'mm;margin:0}';
      document.body.classList.add('k-printing');
      return;
    }
    box.className = pp === 'a4' ? '' : 'p-th' + (pp === '58' ? ' p-58' : '');
    box.innerHTML = slipHtml();
    if (pp === 'a4') { ps.textContent = '@page{size:A4;margin:12mm}'; }
    else {
      // 감열지는 폭을 용지에 맞추고, 길이는 내용만큼만 잡아 빈 종이가 나가지 않게 한다
      box.style.cssText = 'display:block;position:fixed;left:-10000px;top:0;visibility:hidden';
      var mm = Math.ceil(box.offsetHeight * 25.4 / 96) + 16;
      box.removeAttribute('style');
      ps.textContent = '@page{size:' + pp + 'mm ' + Math.min(Math.max(mm, 50), 1000) + 'mm;margin:0}';
    }
    document.body.classList.add('k-printing');
  }
  function cleanupPrint() {
    document.body.classList.remove('k-printing');
    var box = $('#kPrint'); box.innerHTML = ''; box.className = '';
    var ps = $('#kPageCss'); if (ps) { ps.textContent = ''; }
  }
  // 태블릿: 인쇄 창 없이 블루투스(BLE)·USB(OTG) 라벨프린터로 스티커를 바로 보낸다
  function bleOn() { return paper() === 'lbl' && window.__ble && __ble.direct(); }
  function bleSlip() {
    var sz = lblSize(), sd = st.sender || {};
    var from = sd.name ? '보내는 분 ' + sd.name + (sd.phone ? ' ' + sd.phone : '') + (sd.addr1 ? ' · ' + sd.addr1 + ' ' + (sd.addr2 || '') : '') : '';
    var list = st.entries.map(function (x) { return { zip: x.zip, name: x.name, phone: x.phone, addr1: x.addr1, addr2: x.addr2, check: x.check, from: from, no: st.no }; });
    toast('스티커를 프린터로 보내고 있어요…');
    log('어르신 입력 스티커 인쇄(직접)', list.length, '접수번호 ' + st.no);
    __ble.print(list, sz[0], sz[1]).then(function (n) { toast('스티커 ' + n + '장을 보냈어요. 프린터에서 받아 가세요.'); }, function (e) {
      modal('<div class="k-bubble">스티커를 뽑지 못했어요.<small>' + esc(e.message) + '<br>직원에게 말씀해 주세요.</small></div>', [['다시 해 볼게요', function () { closeModal(); bleSlip(); }, 'pri'], ['닫기', closeModal, 'sub']]);
    });
  }
  function printSlip() {
    if (bleOn()) { return bleSlip(); }
    preparePrint();
    log(paper() === 'lbl' ? '어르신 입력 스티커 인쇄' : '어르신 입력 인쇄', st.entries.length, '접수번호 ' + st.no);
    setTimeout(function () {
      try { window.print(); } catch (e) { }
      cleanupPrint();
    }, 60);
  }
  function handOff() {
    if (!st.entries.length || !window.XLSX) { return; }
    var s = st.sender || {};
    var full = !!s.addr1;
    var head = (full ? ['보내는 분', '보내는 분 전화', '보내는 분 우편번호', '보내는 분 주소', '보내는 분 상세주소'] : [])
      .concat(['받는 분', '받는 분 전화', '우편번호', '주소', '상세주소', '비고(접수 확인)']);   // 「비고」가 들어가야 메모 열로 알아보고 양식 비고에 「창구 확인 필요」가 남는다
    var memo = full ? '' : '보내는 분 ' + (s.name || '') + (s.phone ? ' ' + s.phone : '') + ' · 주소 창구 확인';
    var rows = st.entries.map(function (x) {
      var note = [x.check ? '창구 확인 필요' : '', memo].filter(Boolean).join(' / ');
      return (full ? [s.name || '', s.phone || '', s.zip || '', s.addr1 || '', s.addr2 || ''] : []).concat([x.name, x.phone, x.zip, x.addr1, x.addr2, note]);
    });
    var ws = XLSX.utils.aoa_to_sheet([head].concat(rows));
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '어르신입력');
    var buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    var name = '어르신입력_' + st.no + '번_' + stamp() + '.xlsx';
    var inp = document.getElementById('fileInput');
    try {
      var f = new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var dt = new DataTransfer();
      dt.items.add(f);
      inp.files = dt.files;
    } catch (e) { toast('이 브라우저에서는 바로 넘길 수 없어요. 종이로 뽑아 주세요.'); return; }
    log('어르신 입력 넘김', st.entries.length, '접수번호 ' + st.no);
    wipe(true);
    closeKiosk();
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ------------------------------------------------------------------ 숫자판
  function keypad(o) {
    var val = o.init ? String(o.init).replace(/\D/g, '').slice(0, o.phone ? 11 : 9) : '';
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', o.dash ? '-' : '', '0', '지우기'];
    var body = '<div class="k-padwrap"><div class="k-padl"><div class="k-num" id="kNum">&nbsp;</div><div class="k-keys">' + keys.map(function (k) {
      return k ? '<button type="button" data-k="' + esc(k) + '">' + esc(k) + '</button>' : '<span></span>';
    }).join('') + '</div></div><div class="k-padr">';
    var b = [btn('다음', 'pri', function () { o.done(val); })];
    if (o.skip) { b.push(btn(o.skip[0], 'sub', o.skip[1])); }
    b.push(btn('이전으로', 'sub', back));
    frame(esc(o.q), esc(o.sub || ''), body + row(b, true) + '</div></div>');
    bindRow(b);
    var show = $('#kNum', main);
    function paint() { show.textContent = (o.phone ? phoneFmt(val) : val) || '\u00a0'; }
    paint();
    Array.prototype.forEach.call(main.querySelectorAll('[data-k]'), function (el) {
      el.onclick = function () {
        var k = el.getAttribute('data-k');
        if (k === '지우기') { val = val.slice(0, -1); }
        else if (val.length < (o.phone ? 11 : 9)) { val += k; }
        paint();
      };
    });
  }

  // ------------------------------------------------------------------ 직원 설정
  function aiTest() {
    var a = { url: clean($('#kfUrl').value), model: clean($('#kfModel').value), key: $('#kfKey').value };
    var m = $('#kfMsg');
    if (!a.url || !a.model) { m.textContent = '주소와 모델 이름을 먼저 넣어 주세요.'; return; }
    if (!isLocalUrl(a.url)) { m.textContent = '이 PC의 모델 주소만 연결됩니다. http://127.0.0.1:포트/… 또는 http://localhost:포트/… 로 적어 주세요(외부 주소는 접속 허용 목록에서 막힙니다).'; return; }
    m.textContent = '시험 중…';
    var t0 = Date.now();
    aiExtractRaw('우리 아들네 정읍시 충정로 이백삼십사 시청으로 보내 주세요', a).then(function (o) {
      var got = clean([o.sido, o.sigungu, o.eupmyeondong, o.road, o.buildingNo, o.jibun].filter(Boolean).join(' '));
      m.textContent = '연결됨 · ' + a.model + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + '초 · 뽑은 주소: ' + (got || '(없음)');
    }, function (e) {
      m.textContent = '연결되지 않았어요. ' + aiReason(e);
    });
  }
  function lblTest() {
    // 입력창의 크기로 한 장 뽑아 기표지에 대 본다(저장 전에도 쓸 수 있게 임시로 크기를 적용)
    var prev = { lblW: cfg().lblW, lblH: cfg().lblH, paper: cfg().paper };
    var w = Number($('#kfLblW').value) || 100, h = Number($('#kfLblH').value) || 45;
    setCfg({ lblW: w, lblH: h, paper: 'lbl' });
    if (!st) { fresh(); }
    var keepEntries = st.entries;
    st.entries = [];
    preparePrint({ entry: { zip: '12345', name: '시험용', phone: '010-0000-0000', addr1: '전북특별자치도 정읍시 충정로 234-1', addr2: '시험동 101호', check: false },
      note: '가로 ' + w + 'mm × 세로 ' + h + 'mm · 테두리가 라벨 가장자리와 맞는지 확인하세요' });
    setTimeout(function () {
      try { window.print(); } catch (e) { }
      cleanupPrint(); st.entries = keepEntries;
      setCfg({ lblW: w, lblH: h, paper: prev.paper });
    }, 60);
  }
  function staffPanel() {
    var c = cfg(), a = c.ai || {};
    var m = modal('<h3 style="margin:0 0 6px">직원 설정</h3>' +
      '<label class="k-field"><b>우리 동네(기본 지역)</b><input id="kfRegion" value="' + esc(c.region || mainRegion()) + '" placeholder="예) 전북특별자치도 정읍시"></label>' +
      '<p class="k-note">시·군을 빼고 말씀하시는 주소에 이 지역을 붙여 찾습니다. 확인 화면에서 어르신이 한 번 더 봅니다.</p>' +
      '<label class="k-field"><b>자리 비움 후 자동 지우기(초)</b><input id="kfIdle" type="number" min="30" value="' + esc(c.idle || 120) + '"></label>' +
      '<label class="k-field"><b>기관 이름(메모 머리에 찍힘)</b><input id="kfOrg" value="' + esc(c.org || '') + '" placeholder="예) 정읍우체국"></label>' +
      '<label class="k-field"><b>종이로 뽑기 용지</b><select id="kfPaper" style="width:100%;font-size:16px;padding:8px"><option value="a4">A4 일반 프린터</option><option value="80">감열 영수증 80mm</option><option value="58">감열 영수증 58mm</option><option value="lbl">주소 스티커(라벨 프린터)</option></select></label>' +
      '<div id="kfLbl" style="display:none"><label class="k-field"><b>스티커 크기(가로×세로 mm) · 기표지 주소란에 맞춰 재 보세요</b>' +
      '<select id="kfLblP" style="width:100%;font-size:16px;padding:8px"><option value="">직접 입력</option>' + LBL_PRESETS.map(function (p, i) { return '<option value="' + i + '">' + esc(p[2]) + '</option>'; }).join('') + '</select></label>' +
      '<div style="display:flex;gap:8px;align-items:center"><input id="kfLblW" type="number" min="30" max="210" step="0.5" style="width:90px;font-size:16px;padding:8px"> × <input id="kfLblH" type="number" min="20" max="300" step="0.5" style="width:90px;font-size:16px;padding:8px"> mm</div>' +
      '<p class="k-note">라벨 프린터를 「기본 프린터」로 두고, 프린터 속성의 용지 크기를 같은 크기로 맞춰 두세요. 아래 「스티커 시험 인쇄」로 실제 기표지에 대 보고 크기를 고치면 됩니다. 감열(리본 없는) 접착 라벨 롤이면 됩니다.</p></div>' +
      '<label class="k-chk"><input type="checkbox" id="kfAuto"> 다 마치면 메모를 바로 뽑기</label>' +
      '<details><summary style="cursor:pointer;margin:8px 0;font-weight:700">고급 설정(인쇄 확인 창 없애기 · AI 주소 정리)</summary>' +
      '<p class="k-note">감열 프린터를 「기본 프린터」로 두고 크롬을 <b>--kiosk --kiosk-printing</b> 옵션으로 실행하면 인쇄 확인 창 없이 바로 뽑힙니다. 영수증 용지는 붙지 않으니 창구 전달용 메모로 씁니다.</p>' +
      '<label class="k-field"><b>AI 주소 정리 연결(선택) · 주소</b><input id="kfUrl" value="' + esc(a.url || '') + '" placeholder="예) http://127.0.0.1:11434/v1/chat/completions"></label>' +
      '<label class="k-field"><b>모델 이름</b><input id="kfModel" value="' + esc(a.model || '') + '" placeholder="예) gemma3:4b · exaone3.5:7.8b"></label>' +
      '<label class="k-field"><b>키(필요한 곳만)</b><input id="kfKey" type="password" value="' + esc(a.key || '') + '"></label>' +
      '<p class="k-note">이 PC에서 돌리는 로컬 모델(127.0.0.1)만 연결할 수 있습니다. AI에는 주소 문장만 보내고 이름·전화는 보내지 않으며, 우편번호는 언제나 고시 자료로 확정합니다.</p></details>' +
      '<p class="k-note" id="kfMsg"></p>',
      [['저장', function () {
        var u = clean($('#kfUrl').value);
        if (u && !isLocalUrl(u)) { $('#kfMsg').textContent = '이 PC의 모델 주소만 저장됩니다. http://127.0.0.1:포트/… 또는 http://localhost:포트/… 로 적어 주세요.'; return; }
        setCfg({ org: clean($('#kfOrg').value), region: clean($('#kfRegion').value), idle: Math.max(30, Number($('#kfIdle').value) || 120), paper: $('#kfPaper').value, lblW: Number($('#kfLblW').value) || 100, lblH: Number($('#kfLblH').value) || 45, autoPrint: $('#kfAuto').checked, ai: { url: clean($('#kfUrl').value), model: clean($('#kfModel').value), key: $('#kfKey').value } });
        closeModal(); toast('저장했어요.');
      }, 'pri'],
      ['AI 연결 시험', aiTest, 'sub'],
      ['스티커 시험 인쇄', lblTest, 'sub'],
      ['프린터 연결 설정(블루투스·USB)', function () {
        if (!window.__ble) { return; }
        var keepVals = { w: $('#kfLblW').value, h: $('#kfLblH').value };
        __ble.openSettings({ size: function () { return [Number(keepVals.w) || lblSize()[0], Number(keepVals.h) || lblSize()[1]]; }, onClose: function (c) {
          if (c.via === 'ble' || c.via === 'usb') { setCfg({ paper: 'lbl' }); $('#kfPaper').value = 'lbl'; $('#kfPaper').onchange(); toast('바로 인쇄를 쓰도록 용지를 「주소 스티커」로 바꿨어요. 저장을 눌러 주세요.'); }
        } });
      }, 'sub'],
      ['닫기', closeModal, 'sub']].concat(st && st.entries && st.entries.length ? [['이 어르신 입력을 접수 화면으로 넘기기', function () { closeModal(); handOff(); }, 'sub']] : []).concat([['어르신 화면 끝내기(직원 화면으로)', function () { closeModal(); if (!hasData() || confirm('적힌 내용이 있습니다. 지우고 어르신 화면을 닫을까요?')) { fresh(); closeKiosk(); } }, 'sub']]));
    $('#kfPaper').value = paper();
    $('#kfAuto').checked = !!c.autoPrint;
    var lz = lblSize();
    $('#kfLblW').value = lz[0]; $('#kfLblH').value = lz[1];
    function lblShow() { $('#kfLbl').style.display = $('#kfPaper').value === 'lbl' ? 'block' : 'none'; }
    lblShow();
    $('#kfPaper').onchange = lblShow;
    $('#kfLblP').onchange = function () { var p = LBL_PRESETS[Number(this.value)]; if (p) { $('#kfLblW').value = p[0]; $('#kfLblH').value = p[1]; } };
    return m;
  }

  // ------------------------------------------------------------------ 자리 비움·지우기
  function touch() {
    if (!root || root.hidden) { return; }
    clearTimeout(idleT);
    var sec = Number(cfg().idle) || 120;
    if (st && st.entries && st.entries.length) { sec = Math.max(sec, 300); }   // 저장한 받는 곳이 있으면 5분(휴대폰에서 번호를 찾는 동안 지워지던 것)
    if (st && st.finished) { sec = Math.max(sec, 600); }
    idleT = setTimeout(idleWarn, sec * 1000);
  }
  function idleWarn() {
    if (!root || root.hidden) { return; }
    if (!hasData()) { welcome(); return; }
    var left = 30;
    var m = modal('<div class="k-bubble">계속하시겠어요?<small><b id="kLeft">30</b>초 뒤에 적으신 내용을 지웁니다. 화면 아무 곳이나 누르면 계속해요.</small></div>', [['계속할게요', function () { clearTimeout(warnT); closeModal(); touch(); }, 'pri']]);
    speak('계속하시려면 화면을 눌러 주세요.');
    m.addEventListener('pointerdown', function () { clearTimeout(warnT); closeModal(); touch(); });
    (function tick() { var el = document.getElementById('kLeft'); if (!el) { return; } if (left <= 0) { closeModal(); wipe(); return; } el.textContent = left; left--; warnT = setTimeout(tick, 1000); })();
  }
  function wipe(silent) {
    clearTimeout(warnT);
    stopCam();
    try { if (window.__cam) { __cam.dispose(); } } catch (e) { }
    fresh();
    try { if (window.speechSynthesis) { speechSynthesis.cancel(); } } catch (e) { }
    if (main) { main.innerHTML = ''; }
    if (!silent && root && !root.hidden) { welcome(); }
  }

  // ------------------------------------------------------------------ 열기·닫기
  function injectSheet(head, rows, sheet, fname) {
    if (!window.XLSX) { return false; }
    var ws = XLSX.utils.aoa_to_sheet([head].concat(rows));
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheet);
    var buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    var inp = document.getElementById('fileInput');
    try {
      var f = new File([buf], fname, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var dt = new DataTransfer(); dt.items.add(f); inp.files = dt.files;
    } catch (e) { return false; }
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  var rc = { list: [], seen: {} };
  function maskName(n) { n = String(n || ''); return n ? n.charAt(0) + new Array(Math.max(2, n.length)).join('○') : '(이름 없음)'; }
  function recvMsg(t) { var el = document.getElementById('qrMsg'); if (el) { el.textContent = t; } }
  function paintRecv() {
    var box = document.getElementById('qrList'); if (!box) { return; }
    var n = 0;
    box.innerHTML = rc.list.map(function (o) {
      n += o.e.length;
      return '<div>' + esc(o.no) + '번 메모 · 받는 분 ' + o.e.length + '명' + (o.s && o.s[0] ? ' · 보내는 분 ' + esc(maskName(o.s[0])) : '') + '</div>';
    }).join('') || '<div style="color:#888">아직 읽은 메모가 없습니다.</div>';
    var go = document.getElementById('qrGo'); if (go) { go.textContent = n ? '주소록으로 넣기(' + n + '건)' : '주소록으로 넣기'; }
  }
  function recvTake(v) {
    var o = parseMemo(v);
    if (!o) { recvMsg('QR을 읽지 못했어요. 메모의 QR을 다시 찍어 주세요.'); return; }
    var key = o.no + ':' + JSON.stringify(o.e).length;
    if (rc.seen[key]) { recvMsg(o.no + '번 메모는 이미 읽었어요.'); return; }
    rc.seen[key] = 1; rc.list.push(o);
    recvMsg(o.no + '번 메모에서 받는 분 ' + o.e.length + '명을 읽었어요.');
    paintRecv();
  }
  function recvInject() {
    if (!rc.list.length) { recvMsg('먼저 QR을 찍어 주세요.'); return; }
    var head = ['보내는 분', '보내는 분 전화', '보내는 분 우편번호', '보내는 분 주소', '보내는 분 상세주소', '받는 분', '받는 분 전화', '우편번호', '주소', '상세주소', '비고'];
    var rows = [], n = 0;
    rc.list.forEach(function (o) {
      var s = o.s || ['', '', '', '', ''];
      o.e.forEach(function (x) {
        n++;
        rows.push([s[0], s[1], s[2], s[3], s[4], x[0], x[1], x[2], x[3], x[4], [x[5] ? '창구 확인 필요' : '', '메모 ' + o.no + '번'].filter(Boolean).join(' / ')]);
      });
    });
    if (!injectSheet(head, rows, 'QR메모', 'QR메모_' + stamp() + '.xlsx')) { recvMsg('이 브라우저에서는 넣을 수 없어요.'); return; }
    log('QR 메모 넣기', n, '메모 ' + rc.list.length + '장');
    rc = { list: [], seen: {} };
    closeRecv();
  }
  function closeRecv() { var el = document.getElementById('qrRecv'); if (el) { el.hidden = true; } }
  function openRecv() {
    var el = document.getElementById('qrRecv');
    if (!el) {
      el = document.createElement('div'); el.id = 'qrRecv'; el.hidden = true;
      el.innerHTML = '<div class="qr-card" role="dialog" aria-modal="true" aria-labelledby="qrT"><h2 id="qrT">접수 메모 QR 읽기</h2>' +
        '<div>창구 스캐너로 어르신 접수 메모의 QR을 찍으세요. 여러 장을 이어서 찍어도 되고, 한/영 상태와 관계없이 읽습니다.</div>' +
        '<input id="qrIn" autocomplete="off" spellcheck="false" placeholder="여기를 누른 뒤 QR을 찍으세요">' +
        '<div class="qr-msg" id="qrMsg" aria-live="polite"></div><div class="qr-list" id="qrList"></div>' +
        '<div class="qr-row"><button type="button" id="qrClear">모두 지우기</button><button type="button" id="qrClose">닫기</button><button type="button" class="pri" id="qrGo">주소록으로 넣기</button></div></div>';
      document.body.appendChild(el);
      document.getElementById('qrIn').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); recvTake(this.value); this.value = ''; }
      });
      document.getElementById('qrClear').onclick = function () { rc = { list: [], seen: {} }; paintRecv(); recvMsg('지웠어요.'); };
      document.getElementById('qrClose').onclick = closeRecv;
      document.getElementById('qrGo').onclick = recvInject;
      el.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeRecv(); } });
    }
    el.hidden = false; recvMsg(''); paintRecv();
    setTimeout(function () { document.getElementById('qrIn').focus(); }, 30);
  }
  // 심사·교육용 체험: 공개된 기관 주소와 가상 이름으로 만든 모의 주문서
  var SAMPLE_HEAD = ['주문자', '주문자 연락처', '주문자 주소', '받는 분', '받는 분 연락처', '받는 분 주소', '상세주소', '상품명', '수량'];
  var SAMPLE = [
    ['홍길동', '010-0000-0001', '전북특별자치도 정읍시 충정로 234', '', '', '', '', '잡곡 선물세트', 2],
    ['홍길동', '010-0000-0001', '전북특별자치도 정읍시 충정로 234', '김예시', '010-0000-0011', '서울특별시 종로구 세종대로 209', '', '잡곡 선물세트', 1],
    ['홍길동', '010-0000-0001', '전북특별자치도 정읍시 충정로 234', '이시험', '', '부산 연제구 중앙대로 1001', '', '잡곡 선물세트', 1],
    ['홍길동', '010-0000-0001', '전북특별자치도 정읍시 충정로 234', '박모의', '010-0000-0013', '서울 종로 세종데로 209', '2층', '잡곡 선물세트', 1],
    ['최연습', '063-000-0002', '전주시 완산구 효자로 225', '최연습', '063-000-0002', '전주시 완산구 효자로 225', '민원실', '한우 세트', 1],
    ['최연습', '063-000-0002', '전주시 완산구 효자로 225', '정샘플', '010-0000-0021', '강원도 춘천시 중앙로 1', '', '한우 세트', 1],
    ['최연습', '063-000-0002', '전주시 완산구 효자로 225', '한가상', '010-0000-0022', '광주광역시 서구 내방로 111', '', '한우 세트', 1],
    ['최연습', '063-000-0002', '전주시 완산구 효자로 225', '오시연', '010-0000-0023', '대전 서구 둔산동 920', '정부대전청사 1동 11층', '한우 세트', 1],
    ['최연습', '063-000-0002', '전주시 완산구 효자로 225', '유보기', '010-0000-0024', '부산 기장군 기장읍 시랑리 408-1', '', '한우 세트', 1],
    ['최연습', '063-000-0002', '전주시 완산구 효자로 225', '남예제', '010-0000-0025', '세종시 한누리대로 2130', '', '한우 세트', 1]
  ];
  function loadSample() {
    var Z = window.__zip && __zip.S;
    if (Z && ((Z.rows && Z.rows.length) || (Z.aoa && Z.aoa.length)) && !confirm('지금 열어 둔 주소록과 결과를 지우고 예시 주문서를 열까요?')) { return; }
    if (!injectSheet(SAMPLE_HEAD, SAMPLE, '예시', '예시_주문서(모의데이터).xlsx')) { alert('이 브라우저에서는 예시를 불러올 수 없습니다.'); return; }
    log('예시 체험', SAMPLE.length, '모의데이터');
  }
  function openKiosk() {
    if (!E()) { alert('우편번호 DB를 여는 중입니다. 잠시 뒤 다시 눌러 주세요.'); return; }
    build();
    fresh();
    root.hidden = false;
    document.documentElement.classList.add('k-on');
    welcome();
    touch();
    try { history.pushState({ kiosk: 1 }, ''); } catch (e) { }   // 안드로이드 「뒤로」가 프로그램을 닫지 않고 앞 화면으로 가게
    log('어르신 직접 입력 화면 열기', 0, '');
  }
  window.addEventListener('popstate', function () {
    if (!root || root.hidden) { return; }
    if ($('#kModal')) { closeModal(); } else { back(); }
    try { history.pushState({ kiosk: 1 }, ''); } catch (e) { }
  });
  function closeKiosk() {
    if (!root) { return; }
    clearTimeout(idleT); clearTimeout(warnT);
    closeModal();
    root.hidden = true;
    document.documentElement.classList.remove('k-on');
  }
  function addEntry() {
    var box = document.querySelector('.dbbtns');
    if (!box || document.getElementById('btnKiosk')) { return; }
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn sm';
    b.id = 'btnKiosk';
    b.textContent = '어르신 직접 입력';
    b.title = '민원실에서 어르신이 직접 주소를 적는 큰 글씨 대화 화면';
    b.onclick = openKiosk;
    box.insertBefore(b, box.firstChild);
    var q = document.createElement('button');
    q.type = 'button'; q.className = 'btn sm'; q.id = 'btnQrRecv'; q.textContent = 'QR 메모 읽기';
    q.title = '어르신 접수 메모의 QR을 창구 스캐너로 찍어 주소록으로 넣습니다';
    q.onclick = openRecv;
    box.insertBefore(q, b.nextSibling);
    var x = document.createElement('button');
    x.type = 'button'; x.className = 'btn sm ghost'; x.id = 'btnSample'; x.textContent = '예시로 해 보기';
    x.title = '공개 기관 주소와 가상 이름으로 만든 모의 주문서로 전 과정을 체험합니다';
    x.onclick = loadSample;
    box.insertBefore(x, q.nextSibling);
  }
  function boot() {
    addEntry();
    if (/(^|[#&])kiosk\b/.test(location.hash)) {
      var n = 0;
      (function wait() { if (E()) { openKiosk(); } else if (n++ < 300) { setTimeout(wait, 200); } })();
    }
  }
  fresh();
  window.__kiosk = { finish: function () { screen(finish); }, print: printSlip, open: openKiosk, close: closeKiosk, normalize: normalize, state: function () { return st; }, preparePrint: preparePrint, cleanupPrint: cleanupPrint,
    memoPayload: memoPayload, parseMemo: parseMemo, toQwerty: toQwerty, openRecv: openRecv, loadSample: loadSample, qrSvg: qrSvg };
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', boot); } else { boot(); }
})();
