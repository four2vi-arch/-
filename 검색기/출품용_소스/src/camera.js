/*! 물어물어(우편번호 자동검색기) v1.9 (출품본) · 사진으로 읽기(웹캠 → 글자 판독 → 주소 후보) | (c) 2026 이희재 · 정읍우체국 | 2026 공공 AI 대전환 챌린지 출품본. 대회 규정에 따라 사용권 부여 */
/* 휴대폰 문자 화면을 웹캠으로 찍으면 글자로 읽어, 이름·전화·주소 후보를 뽑는다.
   - 글자 읽기(Tesseract.js 5.1.1 · 한국어 학습자료 tessdata_best, 모두 Apache-2.0)는 이 파일 안에 들어 있어 인터넷 없이 이 PC 안에서만 돈다.
   - 사진은 저장·전송하지 않는다. 읽은 직후 화면 메모리에서 지운다(connect-src 가 이 PC·우체국 주소로 막혀 있어 밖으로 나갈 길도 없다).
   - 읽은 글자는 틀릴 수 있으므로, 주소는 우편번호 고시 DB(엔진)로 맞는지 다시 확인한 것만 후보로 내고, 최종 확인은 언제나 사람이 한다. */
(function () {
  'use strict';

  var SUMS = { core: '@@OCRSUM_CORE@@', worker: '@@OCRSUM_WORKER@@', lang: '@@OCRSUM_LANG@@' };
  var ocr = { worker: null, ready: null, busy: false };
  var stream = null;

  function el(id) { return document.getElementById(id); }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function E() { return window.__zip && window.__zip.S && window.__zip.S.engine; }

  // ------------------------------------------------------------------ 글자 읽기 엔진(이 파일 안에 내장)
  // 내장 엔진은 wasm SIMD 판(크롬·엣지 91 이상)이라, 안 되는 브라우저는 단추를 숨긴다
  function hasSimd() {
    try {
      return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    } catch (e) { return false; }
  }
  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.Worker && window.WebAssembly && hasSimd() && window.Tesseract && el('ocrCore'));
  }
  function sha256(text) {
    if (!(window.crypto && crypto.subtle && window.TextEncoder)) { return Promise.resolve(''); }
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) {
      var u = new Uint8Array(b), h = '';
      for (var i = 0; i < u.length; i++) { h += ('0' + u[i].toString(16)).slice(-2); }
      return h;
    });
  }
  // 내장 블록(글자 읽기 엔진·한국어 자료)이 원본 그대로인지 빌드 때 박은 지문과 대조한다
  function verifyBlocks() {
    var names = [['core', 'ocrCore'], ['worker', 'ocrWorker'], ['lang', 'ocrLang']];
    return Promise.all(names.map(function (n) {
      return sha256(el(n[1]).textContent).then(function (h) { return !h || h === SUMS[n[0]]; });
    })).then(function (r) { return r.every(Boolean); });
  }
  function load(onProg) {
    if (ocr.ready) { return ocr.ready; }
    ocr.ready = verifyBlocks().then(function (ok) {
      if (!ok) { throw new Error('글자 읽기 엔진이 원본과 달라 쓰지 않습니다.'); }
      var lang = el('ocrLang').textContent.replace(/\s+/g, '');
      // 한국어 자료는 파일 안에서 꺼내 주고(밖으로 요청하지 않음), 엔진은 같은 작업자 안에 한 덩이로 묶는다
      var pre = '(function(){var D=null,L="' + lang + '";function d(){if(!D){var b=atob(L),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++){u[i]=b.charCodeAt(i);}D=u;}return D;}' +
        'var f=self.fetch;self.fetch=function(u){if(/kor\\.traineddata/.test(String(u))){return Promise.resolve(new Response(d()));}return f.apply(self,arguments);};})();\n';
      var blob = new Blob([pre, el('ocrCore').textContent, '\n', el('ocrWorker').textContent], { type: 'text/javascript' });
      var url = URL.createObjectURL(blob);
      return Tesseract.createWorker('kor', 1, {
        workerPath: url, workerBlobURL: false, corePath: 'blob:none/core.js', langPath: 'https://invalid.local/lang', cacheMethod: 'none', gzip: true,
        logger: function (m) { if (onProg && m && m.status === 'recognizing text') { onProg(m.progress || 0); } }
      }).then(function (w) { ocr.worker = w; ocr.url = url; return w; });
    });
    ocr.ready.catch(function () { ocr.ready = null; });
    return ocr.ready;
  }
  function dispose() {
    var w = ocr.worker; ocr.worker = null; ocr.ready = null;
    if (w) { try { w.terminate(); } catch (e) { } }
    if (ocr.url) { try { URL.revokeObjectURL(ocr.url); } catch (e) { } ocr.url = null; }
  }

  // ------------------------------------------------------------------ 웹캠
  // 태블릿은 뒷 카메라(environment)가 휴대폰 화면을 찍기 좋다. 한 대뿐인 웹캠은 이 값을 무시한다.
  var facing = 'environment';
  try { facing = localStorage.getItem('zipfinder.cam.facing') === 'user' ? 'user' : 'environment'; } catch (e) { }
  function toggleFacing() {
    facing = facing === 'user' ? 'environment' : 'user';
    try { localStorage.setItem('zipfinder.cam.facing', facing); } catch (e) { }
    return facing;
  }
  function cameraCount() {
    if (!(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices)) { return Promise.resolve(1); }
    return navigator.mediaDevices.enumerateDevices().then(function (ds) { return ds.filter(function (d) { return d.kind === 'videoinput'; }).length; }, function () { return 1; });
  }
  function start(video) {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { return Promise.reject(new Error('nocam')); }
    stop();
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(null, function (e) {
      // 해상도·방향 조건 때문에 안 되면 조건 없이 한 번 더
      if (e && (e.name === 'OverconstrainedError' || e.name === 'NotReadableError' || e.name === 'TypeError')) { return navigator.mediaDevices.getUserMedia({ video: true, audio: false }); }
      throw e;
    }).then(function (s) {
      stream = s;
      video.srcObject = s;
      video.muted = true; video.setAttribute('playsinline', '');
      return video.play().then(function () { return s; }, function () { return s; });
    });
  }
  function stop() {
    if (stream) { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { } stream = null; }
  }
  function grab(video) {
    var w = video.videoWidth || 1280, h = video.videoHeight || 720;
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(video, 0, 0, w, h);
    return c;
  }

  // ------------------------------------------------------------------ 사진 다듬기: 어두운 화면은 뒤집고, 명암을 늘린다
  function luminance(d, i) { return (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; }
  function variants(src) {
    var w = src.width, h = src.height;
    // 너무 크면 줄이고(느려짐), 너무 작으면 키운다(글자 높이 확보)
    var k = Math.max(0.5, Math.min(1.6, 1800 / Math.max(w, h)));
    var out = [];
    var a = document.createElement('canvas'); a.width = Math.round(w * k); a.height = Math.round(h * k);
    var ax = a.getContext('2d'); ax.drawImage(src, 0, 0, a.width, a.height);
    var img = ax.getImageData(0, 0, a.width, a.height), d = img.data, n = a.width * a.height, hist = new Array(256), i, sum = 0;
    for (i = 0; i < 256; i++) { hist[i] = 0; }
    for (i = 0; i < d.length; i += 4) { var L = luminance(d, i) | 0; hist[L]++; sum += L; }
    var mean = sum / n;
    // 하위 2%·상위 2% 밝기를 끝으로 잡아 늘린다
    var lo = 0, hi = 255, acc = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * 0.02) { lo = i; break; } }
    acc = 0;
    for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * 0.02) { hi = i; break; } }
    var span = Math.max(40, hi - lo), dark = mean < 105;
    for (i = 0; i < d.length; i += 4) {
      var v = (luminance(d, i) - lo) * 255 / span;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      if (dark) { v = 255 - v; }
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ax.putImageData(img, 0, 0);
    out.push({ c: a, psm: '11', tag: dark ? '뒤집음' : '명암' });
    // 원본 그대로(색 글자·옅은 화면은 오히려 이쪽이 낫다)
    var b = document.createElement('canvas'); b.width = a.width; b.height = a.height;
    b.getContext('2d').drawImage(src, 0, 0, b.width, b.height);
    if (dark) {
      var bx = b.getContext('2d'), im2 = bx.getImageData(0, 0, b.width, b.height), e = im2.data;
      for (i = 0; i < e.length; i += 4) { e[i] = 255 - e[i]; e[i + 1] = 255 - e[i + 1]; e[i + 2] = 255 - e[i + 2]; }
      bx.putImageData(im2, 0, 0);
    }
    out.unshift({ c: b, psm: '6', tag: '원본' });
    return out;
  }
  // 사진에서 글자 줄을 읽는다. 두 번(원본·명암 보정) 읽어 줄을 합친다.
  // accept(지금까지 읽은 줄들) 가 true 를 돌려주면 두 번째 읽기를 건너뛴다(느린 태블릿에서 시간을 반으로)
  function read(canvas, onProg, accept) {
    if (ocr.busy) { return Promise.reject(new Error('busy')); }
    ocr.busy = true;
    var vs = variants(canvas), all = [], done = 0, stopEarly = false;
    return load().then(function (w) {
      var chain = Promise.resolve();
      vs.forEach(function (v) {
        chain = chain.then(function () {
          if (stopEarly) { return null; }
          return w.setParameters({ tessedit_pageseg_mode: v.psm, preserve_interword_spaces: '1' }).then(function () {
            return w.recognize(v.c);
          }).then(function (r) {
            var lines = String(r.data.text || '').split(/\n+/).map(clean).filter(Boolean);
            all.push(lines); done++;
            if (onProg) { onProg(done / vs.length); }
            if (accept) { try { stopEarly = !!accept(all); } catch (e) { stopEarly = false; } }
          });
        });
      });
      return chain;
    }).then(function () {
      ocr.busy = false;
      vs.forEach(function (v) { v.c.width = v.c.height = 0; });   // 다듬은 사진 지움
      return all;
    }, function (e) {
      ocr.busy = false;
      vs.forEach(function (v) { v.c.width = v.c.height = 0; });
      throw e;
    });
  }

  // ------------------------------------------------------------------ 읽은 글자 → 이름·전화·주소 후보 (순수 함수 · 시험하기 쉽게 따로 둔다)
  var LABEL = /^(?:[받빋할밭발]\s*[는눈]\s*(?:분|사람|이)|수취인|수신인|배송지|배달지|도착지|보낼\s*(?:곳|주소)|주소|연락처|전화번호|전화|휴대폰|핸드폰|이름|성함|성명)\s*[:：]?\s*/;
  var FROM = /(?:보내는|보낸|발신|보낼)\s*(?:분|사람|이|곳)?/;
  var ADDR_TOK = /[가-힣]{1,}(?:시|군|구|읍|면|동|리|로|길|가)(?![가-힣])|\d+(?:-\d+)?\s*(?:번지|호|동|층)/;
  var NOT_NAME = /^(?:주소|연락처|전화|휴대폰|핸드폰|받는분|이름|성함|성명|배송지|우편번호|메시지|문자메시지|오전|오후)$/;

  function fixDigits(s) {
    // 숫자 사이에 낀 영문 O·o·l·I 를 숫자로
    return String(s).replace(/(\d)[Oo](?=[\d\s.-]|$)/g, '$10').replace(/(^|[\s.-])[Oo](?=\d)/g, '$10').replace(/(\d)[lI|](?=\d)/g, '$11');
  }
  function formatPhone(d) {
    if (/^02\d{7,8}$/.test(d)) { return d.length === 9 ? d.replace(/^(02)(\d{3})(\d{4})$/, '$1-$2-$3') : d.replace(/^(02)(\d{4})(\d{4})$/, '$1-$2-$3'); }
    if (/^01[016789]\d{7,8}$/.test(d)) { return d.length === 10 ? d.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3') : d.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3'); }
    if (/^0(?:3[1-3]|4[1-4]|5[1-5]|6[1-4])\d{7,8}$/.test(d)) { return d.length === 10 ? d.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3') : d.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3'); }
    return '';
  }
  function findPhones(text) {
    // 숫자·구분 글자(- . 공백)가 이어진 덩이에서 전화번호 꼴만
    var out = [], t = fixDigits(text), re = /(?:\+82[\s-]?)?0?[\d][\d\s.\-]{8,14}\d/g, m;
    while ((m = re.exec(t))) {
      var d = m[0].replace(/^\+82[\s-]?/, '0').replace(/\D/g, '');
      var f = formatPhone(d);
      if (f && out.indexOf(f) < 0) { out.push(f); }
    }
    return out;
  }
  function findName(lines) {
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/(?:[받빋할밭발]\s*[는눈]\s*(?:분|사람|이)|수취인|수신인|이름|성함|성명)\s*[:：]?\s*([가-힣]{2,4})(?![가-힣])/);
      if (m && !NOT_NAME.test(m[1])) { return m[1]; }
    }
    return '';
  }
  // 흔한 읽기 오류를 주소 찾기 전에 바로잡는다: 번지 사이 빠진 줄표(234 1 → 234-1), 모양이 비슷한 글자 쪼가리 정리
  function tidyAddr(s) {
    var t = clean(String(s).replace(/[|\[\]{}_~`"“”‘’<>]/g, ' ').replace(/[\u1100-\u11ff\u3130-\u318f]/g, ''));   // 낱자모 찌꺼기 제거
    t = fixDigits(t).replace(/(\d)\s+(동|호|층|번지)(?![가-힣])/g, '$1$2');
    t = t.replace(/(\d)\s*[후흐효]/g, '$1호').replace(/(\d)\s*충/g, '$1층').replace(/(\d)\s*[통둥]/g, '$1동');   // 흔한 오독: 숫자 뒤 호·층·동
    t = t.replace(/(\d{1,4})\s*[.·]\s*(\d{1,3})(?=\s|$)/g, '$1-$2');                 // 689.3 → 689-3
    return clean(t);
  }

  // linesList: 읽은 줄 배열의 목록(읽기 한 번에 한 배열), look: 주소 한 덩이 → 엔진 결과({zip, grade, conf, addr1, addr2, ...}) 또는 null
  var PHONE_RE = /0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/g;
  function guessFrom(lines) {
    // 못 찾았을 때 어르신이 고쳐 쓰기 쉽게, 「주소」 머리말 아래 줄들(없으면 주소 낱말이 가장 많은 줄)을 그대로 준다
    var i, start = -1;
    for (i = 0; i < lines.length; i++) { if (/^주소/.test(lines[i]) && !FROM.test(lines[i])) { start = i; break; } }
    var picked = [];
    if (start >= 0) {
      var first = lines[start].replace(LABEL, '');
      if (first) { picked.push(first); }
      for (i = start + 1; i < lines.length && picked.length < 3; i++) {
        if (LABEL.test(lines[i]) && !/^주소/.test(lines[i])) { break; }
        if (!/[가-힣0-9]/.test(lines[i])) { break; }
        picked.push(lines[i]);
      }
    } else {
      var bestN = 0, bi = -1;
      lines.forEach(function (l, k) { var n = (l.match(new RegExp(ADDR_TOK.source, 'g')) || []).length; if (n > bestN) { bestN = n; bi = k; } });
      if (bi >= 0) { picked.push(lines[bi]); }
    }
    return tidyAddr(picked.join(' ').replace(PHONE_RE, ' '));
  }
  function extract(linesList, look, opts) {
    opts = opts || {};
    var lines = [], seen = {};   // 여러 번 읽은 줄을 합친다(같은 줄은 한 번만)
    linesList.forEach(function (ls) { ls.forEach(function (l) { var k = l.replace(/\s+/g, ''); if (k && !seen[k]) { seen[k] = 1; lines.push(l); } }); });
    var phones = [];
    linesList.forEach(function (ls) { findPhones(ls.join('\n')).forEach(function (p) { if (phones.indexOf(p) < 0) { phones.push(p); } }); });
    var name = findName(lines);
    // 줄 묶음 후보: 한 줄, 두 줄, 세 줄. 문자 화면은 줄바꿈이 낱말 한가운데서 나기도 해서(「충정로 2 / 34-1」) 이을 때 띄우기·붙이기·줄표 세 가지를 모두 엔진에 물어 가장 잘 맞는 것을 쓴다.
    var wins = {}, order = [];
    function add(txt, fromHint, pref, n) {
      txt = clean(txt);
      if (txt.length < 5 || !ADDR_TOK.test(txt)) { return; }
      if (!wins[txt]) { wins[txt] = { text: txt, from: fromHint, pref: pref, n: n }; order.push(txt); }
    }
    linesList.forEach(function (ls) {
      for (var i = 0; i < ls.length; i++) {
        var prev = i > 0 ? ls[i - 1] : '';
        var fromHint = FROM.test(ls[i]) || (/^\s*(?:주소|보낼\s*주소)?\s*$/.test(ls[i].replace(LABEL, '')) && FROM.test(prev));
        for (var n = 1; n <= 3 && i + n <= ls.length; n++) {
          var part = ls.slice(i, i + n);
          var texts = part.map(function (x) { return x.replace(LABEL, ''); });
          if (n > 1 && texts.slice(1).some(function (x) { return LABEL.test(x) && !/^주소/.test(x); })) { break; }
          // 이름·전화가 든 머리말 줄은 주소에서 뺀다
          texts = texts.map(function (x) { return x.replace(/(?:[받빋할밭발]\s*[는눈]\s*(?:분|사람)|이름|성함|연락처|전화번호)\s*[:：]?\s*[가-힣]{0,4}/g, ' ').replace(PHONE_RE, ' '); });
          if (!clean(texts[0])) { continue; }   // 머리말·전화만 있던 줄에서 시작하는 묶음은 다음 줄에서 시작하는 묶음과 같다
          add(tidyAddr(texts.join(' ')), fromHint, 0, n);
          if (n > 1) { add(tidyAddr(texts.join('')), fromHint, 1, n); }
          var dashed = tidyAddr(texts.join(' ')).replace(/([로길]\s*\d{1,4})\s+(\d{1,3})(?=\s|$)/g, '$1-$2');
          if (n > 1 || dashed !== tidyAddr(texts.join(' '))) { add(dashed, fromHint, 2, n); }
        }
      }
    });
    // 점수가 높은 쪽, 같으면 줄을 더 많이 이은(동·호까지 담은) 쪽, 같으면 손을 덜 댄(띄우기 → 붙이기 → 줄표) 쪽, 같으면 글자가 긴 쪽
    function better(a, b) {
      if (Math.abs(a.rank - b.rank) > 0.005) { return a.rank > b.rank; }
      if (a.n !== b.n) { return a.n > b.n; }
      if (a.pref !== b.pref) { return a.pref < b.pref; }
      return a.len > b.len;
    }
    var best = {};
    order.forEach(function (k) {
      var w = wins[k], r = null;
      try { r = look(w.text); } catch (e) { r = null; }
      if (!r || !r.zip || r.grade === '실패') { return; }
      // 숫자가 단위(동·호·층) 앞에서 갈라진 꼴(「10 1동」)은 줄바꿈·띄어 읽기 오류일 가능성이 커 점수를 깎는다
      var split = /(?:^|[\s,])\d{1,3}\s+\d{1,2}\s*(?:동|호|층)/.test(w.text) ? 0.3 : 0;
      var rankv = (r.grade === '정확' ? 4 : 3) + (r.conf === '상' ? 0.6 : r.conf === '중' ? 0.3 : 0) - split;
      var bk = r.zip + '|' + (r.addr1 || '');
      var cand = { zip: r.zip, addr1: r.addr1 || '', addr2: r.addr2 || '', grade: r.grade, conf: r.conf, note: r.note || '', r: r, text: w.text, from: w.from, rank: rankv, len: w.text.length, n: w.n, pref: w.pref };
      var cur = best[bk];
      if (!cur || better(cand, cur)) { best[bk] = cand; }
    });
    var cands = Object.keys(best).map(function (k) { return best[k]; });
    if (cands.some(function (c) { return !c.from; })) { cands = cands.filter(function (c) { return !c.from; }); }
    cands.sort(function (a, b) { return better(a, b) ? -1 : better(b, a) ? 1 : 0; });
    // 우편번호가 같은 후보는 하나만(번지 표기만 다른 같은 곳), 훨씬 못한 후보는 숨긴다
    var seenZip = {};
    cands = cands.filter(function (c) { if (seenZip[c.zip]) { return false; } seenZip[c.zip] = 1; return true; });
    if (cands.length) { var top = cands[0].rank; cands = cands.filter(function (c) { return c.rank >= top - 0.3; }); }
    // 더 나은(또는 같은) 후보의 글자에 통째로 들어 있는 짧은 후보는 같은 주소의 조각이므로 뺀다
    cands = cands.filter(function (c, i) {
      var k = c.text.replace(/\s+/g, '');
      return !cands.some(function (o, j) { return j !== i && o.text.replace(/\s+/g, '').length > k.length && o.text.replace(/\s+/g, '').indexOf(k) >= 0 && o.rank >= c.rank - 0.5; });
    });
    return { name: name, phone: phones[0] || '', phones: phones, cands: cands.slice(0, opts.max || 3), lines: lines, guess: cands.length ? '' : guessFrom(lines) };
  }

  // 엔진에 묻는 기본 방식(어르신 화면의 기본 지역을 쓴다)
  function lookupFn(regionOpts) {
    var o = {}; if (regionOpts) { for (var k in regionOpts) { o[k] = regionOpts[k]; } }
    o.fuzz = 2;   // 사진 글자는 한두 글자 틀리게 읽히므로 시·군·구 오타 보정을 넓게
    return function (t) { var e = E(); return e ? e.lookup(t, o) : null; };
  }

  window.__cam = {
    toggleFacing: toggleFacing, cameraCount: cameraCount, facing: function () { return facing; },
    supported: supported, start: start, stop: stop, grab: grab, read: read, load: load, dispose: dispose,
    extract: extract, lookupFn: lookupFn, findPhones: findPhones, findName: findName, tidyAddr: tidyAddr,
    busy: function () { return ocr.busy; }, active: function () { return !!stream; }
  };
})();
