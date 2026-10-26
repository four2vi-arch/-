/*! 물어물어(우편번호 자동검색기) v1.11 (출품본) · 블루투스(BLE)·USB(OTG) 라벨프린터 직접 인쇄 | (c) 2026 이희재 · 정읍우체국 | 2026 공공 AI 대전환 챌린지 출품본. 대회 규정에 따라 사용권 부여 */
/* 태블릿(안드로이드 크롬)에서 컴퓨터 없이 무선 라벨프린터로 바로 뽑기 위한 모듈.
   - 브라우저의 인쇄 창을 거치지 않고, 스티커 한 장을 그림(캔버스)으로 그려 흑백 점으로 바꾼 뒤 TSPL 또는 ESC/POS 명령으로 BLE(저전력 블루투스)에 보낸다.
   - Web Bluetooth 는 BLE 만 된다(클래식 블루투스·SPP 전용 프린터는 못 쓴다). 프린터 쪽 규격은 기종마다 달라 실기 시험이 필요하며, 설정 창에서 명령·해상도·색 반전·회전·전송 크기를 고칠 수 있게 했다.
   - v1.8: 선으로 잇는 방식(WebUSB)을 더했다. 태블릿에 OTG 어댑터로 USB 라벨프린터를 꽂으면 컴퓨터·블루투스 없이 같은 TSPL/ESC·POS 명령을 USB 대량 전송(bulk OUT)으로 보낸다.
   - v1.11: 4인치 감열 라벨프린터(기본 이름 「Bluetooth Printer」, 제조사 앱 Print Label) 실기 대응.
     용지 종류(갭 라벨·연속지(영수증 롤)·블랙마크)와 가로 위치 보정(넓은 프린터에 좁은 용지)을 더하고,
     제조사 앱처럼 인쇄할 때만 붙었다가 끝나면 연결을 놓아(휴대폰 앱과 프린터를 같이 쓰도록) 둔다.
     브라우저 블루투스로 안 되는 기종을 위해 스티커를 라벨 크기 PDF로 만들어 제조사 앱으로 넘기는 길(공유)을 더했다.
     라벨지(스티커 크기대로 한 장씩)와 영수증 롤(롤 폭에 맞춰 내용 길이만큼)을 나누고, 어르신 화면의 접수 메모(QR 포함)를
     롤로 바로 뽑게 했다. 헤드 폭 전체에 mm 눈금을 찍는 「위치 맞춤 시험지」로 가로 위치 보정값을 읽는다.
   - 주소·이름은 이 기기 안에서 그림으로만 만들어 프린터로 보낸다(인터넷으로 나가지 않는다). */
(function () {
  'use strict';

  var KEY = 'zipfinder.ble.v1';
  var BUILD = 'v1.11 7차(10.26)';
  var NEED_TAP = '이 화면을 연 뒤 처음 인쇄할 때는 프린터를 한 번 골라야 해요. 「다시 해 볼게요」나 「프린터 연결」을 눌러 「Bluetooth Printer」를 골라 주세요(직원이 프린터 연결 설정에서 미리 연결해 두면 이 창이 뜨지 않아요).';   // 설정 창 제목·시험 인쇄에 찍어, 어느 파일로 뽑혔는지 종이에서 확인한다
  // 흔한 BLE 프린터 서비스(Web Bluetooth 는 미리 적어 둔 서비스만 열 수 있다). 설정에서 더 보탤 수 있다.
  var SERVICES = [0x18f0, 0xff00, 0xffe0, 0xffe5, 0xfff0, 0xfee7, 0xae30, 0xff12,
    '49535343-fe7d-4ae5-8fa9-9fafd205e455', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e', 0xff10, 0xffb0];
  var dev = null, ch = null, busy = false, lastErr = '', lastRes = '';
  var status = 'none', listeners = [], dropping = false, rcT = 0, rcN = 0;   // 연결 상태: none · connected · reconnecting · lost
  function emit(st) { if (st === status) { return; } status = st; listeners.forEach(function (f) { try { f(st); } catch (e) { } }); }
  // 끊기면(프린터 절전·거리·전원) 같은 프린터에 저절로 다시 붙는다. 선택 창이 필요 없어 화면을 누르지 않아도 된다.
  function onDrop() {
    ch = null;
    if (dropping) { dropping = false; return; }       // 우리가 일부러 놓은 것
    if (!get().keep || get().via !== 'ble' || !dev) { emit('none'); return; }
    rcN = 0; emit('reconnecting'); retry();
  }
  function retry() {
    clearTimeout(rcT);
    var waits = [700, 1500, 3000, 6000, 10000], wait = rcN < waits.length ? waits[rcN] : 20000;
    rcT = setTimeout(function () {
      if (!dev || !get().keep) { return; }
      if (dev.gatt && dev.gatt.connected && ch) { emit('connected'); return; }
      Promise.resolve(dev.gatt.connect()).then(pickChar).then(function (c) { ch = c; rcN = 0; emit('connected'); }, function () {
        rcN++;
        if (rcN >= waits.length) { emit('lost'); }   // 다섯 번 안 되면 직원을 부르게 하고, 그 뒤로도 20초마다 계속 시도
        retry();
      });
    }, wait);
  }
  var udev = null, uep = 0, uifc = -1, uhook = false;   // USB(WebUSB): 장치, 내보내기 끝점 번호, 인터페이스 번호

  function $(id) { return document.getElementById(id); }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // media: gap(라벨지·틈) · bline(라벨지·뒷면 검은 표시) · cont(영수증 롤·연속지) / xoff: 가로 위치 보정 mm / release: 인쇄 뒤 연결 놓기(블루투스)
  // rollW: 영수증 롤 폭 mm / tail: 영수증 끝 여백(자를 자리) mm / head: 프린터 헤드 폭 mm(위치 맞춤 시험지)
  // rollDir: side(돌려 찍기 · 라벨 높이 = 롤 폭) · down(위에서 아래로) / rollLen: 돌려 찍기 라벨 길이 mm
  // keep: 연결 계속 잡아 두기(화면을 닫을 때까지 · 끊기면 저절로 다시 연결). 끄면 인쇄 뒤 연결을 놓는다(휴대폰 앱과 같이 쓰기)
  // delay 30ms: 4인치 감열 라벨프린터 실기 시험에서 10ms는 받다가 몇십 바이트를 놓쳐 그림이 옆으로 밀렸다
  var DEF = { via: 'dialog', proto: 'tspl', dpi: 203, gap: 2, chunk: 100, delay: 30, invert: false, rotate: 0, after: 'ff', uuids: '', name: '', usbId: '', media: 'gap', xoff: 0, release: true, rollW: 80, tail: 12, head: 104, rollDir: 'side', rollLen: 100, keep: true };
  function get() {
    var o = {};
    try { o = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { o = {}; }
    var r = {};
    for (var k in DEF) { r[k] = o[k] === undefined ? DEF[k] : o[k]; }
    return r;
  }
  function set(p) {
    var c = get();
    for (var k in p) { c[k] = p[k]; }
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { }
    return c;
  }
  function viaUsb() { return get().via === 'usb'; }
  function viaApp() { return get().via === 'app'; }
  // 앱으로 보내기는 그림(캔버스)과 파일만 만들면 되므로 어느 브라우저에서나 된다
  function appOk() { return !!(window.Blob && window.Uint8Array && document.createElement('canvas').getContext); }
  function btOk() { return !!(navigator.bluetooth && navigator.bluetooth.requestDevice && window.isSecureContext !== false); }
  function usbOk() { return !!(navigator.usb && navigator.usb.requestDevice && window.isSecureContext !== false); }
  // 지금 고른 방식(블루투스 또는 USB)을 이 브라우저가 쓸 수 있는지
  function supported() { var v = get().via; return v === 'app' ? appOk() : (v === 'usb' ? usbOk() : btOk()); }
  function connected() { return viaUsb() ? !!(udev && udev.opened && uep) : !!(dev && dev.gatt && dev.gatt.connected && ch); }
  function deviceName() { return viaUsb() ? (udev && (udev.productName || 'USB 프린터')) || '' : (dev && dev.name) || ''; }

  // ------------------------------------------------------------------ 연결
  function userUuids() {
    var out = [];
    String(get().uuids || '').split(/[\s,;]+/).forEach(function (u) {
      u = u.trim().toLowerCase();
      if (/^[0-9a-f]{4}$/.test(u)) { out.push(parseInt(u, 16)); } else if (/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(u)) { out.push(u); }
    });
    return out;
  }
  function pickChar(server) {
    return server.getPrimaryServices().then(function (svcs) {
      var tasks = svcs.map(function (s) { return s.getCharacteristics().then(function (cs) { return cs.map(function (c) { return { s: s, c: c }; }); }, function () { return []; }); });
      return Promise.all(tasks);
    }).then(function (lists) {
      var all = [].concat.apply([], lists), best = null;
      all.forEach(function (x) {
        var p = x.c.properties;
        if (!(p.writeWithoutResponse || p.write)) { return; }
        // 응답 없이 쓰기가 되는 것을 먼저, 그다음 쓰기
        var score = (p.writeWithoutResponse ? 2 : 1);
        if (!best || score > best.score) { best = { c: x.c, score: score }; }
      });
      if (!best) { throw new Error('이 프린터에서 글자를 보낼 곳(쓰기 가능한 특성)을 찾지 못했어요. 설정의 「추가 서비스 번호」에 프린터 서비스 번호를 넣어 보세요.'); }
      return best.c;
    });
  }
  function attach(device) {
    dev = device; ch = null;
    if (!dev.__zfHook) { dev.__zfHook = true; dev.addEventListener('gattserverdisconnected', onDrop); }
    return dev.gatt.connect().then(pickChar).then(function (c) {
      ch = c;
      set({ name: dev.name || '' });
      clearTimeout(rcT); rcN = 0; emit('connected');
      return dev;
    });
  }
  // 사용자가 누른 단추 안에서 불러야 한다(선택 창이 뜬다)
  function connect() {
    lastErr = '';
    if (viaUsb()) { return usbConnect(); }
    if (!supported()) { return Promise.reject(new Error('이 브라우저에서는 블루투스 인쇄를 쓸 수 없어요(안드로이드 크롬이 필요해요).')); }
    if (connected()) { return Promise.resolve(dev); }
    // 같은 기기가 이미 허용돼 있으면 선택 창 없이 다시 붙는다
    var saved = get().name, again = Promise.resolve(null);
    if (dev && dev.gatt) {
      again = attach(dev).catch(function () { return null; });
    } else if (saved && navigator.bluetooth.getDevices) {
      again = navigator.bluetooth.getDevices().then(function (ds) {
        var d = ds.filter(function (x) { return x.name === saved; })[0];
        return d ? attach(d).catch(function () { return null; }) : null;
      }, function () { return null; });
    }
    return again.then(function (d) {
      if (d) { return d; }
      // 선택 창은 화면을 누른 직후에만 열린다(자동 뽑기 등에서는 크롬이 막는다)
      if (navigator.userActivation && navigator.userActivation.isActive === false) { var ne = new Error(NEED_TAP); ne.code = 'NEED_TAP'; throw ne; }
      var opt = SERVICES.concat(userUuids());
      return navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: opt }).then(attach);
    }).catch(function (e) {
      lastErr = errText(e);
      throw new Error(lastErr);
    });
  }
  function disconnect() {
    if (udev) { try { udev.close(); } catch (e) { } udev = null; uep = 0; }
    clearTimeout(rcT);
    try { if (dev && dev.gatt && dev.gatt.connected) { dropping = true; dev.gatt.disconnect(); } } catch (e) { }
    ch = null; emit('none');
  }
  function errText(e) {
    var n = e && e.name, m = String(e && e.message || e || '');
    if (n === 'NotFoundError' || /cancel|chooser/i.test(m)) { return '프린터를 고르지 않았어요. 다시 눌러 프린터를 골라 주세요.'; }
    if (viaUsb() && (n === 'SecurityError' || /protected class/i.test(m))) { return 'USB 프린터를 열 수 없어요. 이 장치는 크롬에서 막혀 있어요(컴퓨터에서는 프린터 드라이버가 잡고 있을 수 있어요). 태블릿에서 다시 해 보세요.'; }
    if (e && e.code === 'NEED_TAP') { return NEED_TAP; }
    if (n === 'SecurityError' && /gesture|activation/i.test(m)) { return NEED_TAP; }
    if (n === 'SecurityError' || n === 'NotAllowedError') {
      return viaUsb() ? 'USB 사용이 허용되지 않았어요. 크롬 설정에서 허용해 주세요.'
        : '블루투스 사용이 막혀 있어요. ① 태블릿 설정 → 애플리케이션 → Chrome → 권한에서 「근처 기기」(안드로이드 11 이하는 「위치」)를 허용하고, ② 크롬 주소창 왼쪽 ⓘ → 권한에서 블루투스를 허용한 뒤 다시 눌러 주세요.';
    }
    if (/claimInterface|Unable to claim|Access denied|protected/i.test(m)) { return 'USB 프린터를 쓸 수 없어요(다른 앱이나 시스템이 쓰는 중이거나 허용되지 않은 장치). 케이블을 뽑았다 다시 꽂고 해 보세요.'; }
    if (viaUsb() && /disconnected|no device|not open|closed/i.test(m)) { return '프린터와 연결이 끊겼어요. USB 선(OTG 어댑터)과 프린터 전원을 확인하고 다시 연결해 주세요.'; }
    if (/disconnected|GATT/i.test(m)) { return '프린터와 연결이 끊겼어요. 프린터 전원과 거리를 확인하고 다시 연결해 주세요.'; }
    return m || (viaUsb() ? 'USB 연결에 실패했어요.' : '블루투스 연결에 실패했어요.');
  }

  // ------------------------------------------------------------------ USB(WebUSB) 연결
  // 안드로이드 크롬은 프린터 종류(클래스 7)와 제조사 전용(255) 인터페이스를 WebUSB 로 열 수 있다. 윈도우·맥은 운영체제 드라이버가 먼저 잡고 있어 열리지 않는 경우가 많다.
  function usbHook() {
    if (uhook || !navigator.usb || !navigator.usb.addEventListener) { return; }
    uhook = true;
    navigator.usb.addEventListener('disconnect', function (ev) { if (ev && ev.device === udev) { udev = null; uep = 0; } });
  }
  function usbAttach(d) {
    usbHook();
    udev = d; uep = 0; uifc = -1;
    return Promise.resolve(d.opened ? null : d.open()).then(function () {
      return d.configuration ? null : d.selectConfiguration(1);
    }).then(function () {
      var best = null;
      ((d.configuration && d.configuration.interfaces) || []).forEach(function (itf) {
        (itf.alternates || []).forEach(function (alt) {
          (alt.endpoints || []).forEach(function (ep) {
            if (ep.direction === 'out' && ep.type === 'bulk') {
              var sc = alt.interfaceClass === 7 ? 3 : (alt.interfaceClass === 255 ? 2 : 1);
              if (!best || sc > best.sc) { best = { sc: sc, itf: itf.interfaceNumber, alt: alt.alternateSetting, ep: ep.endpointNumber }; }
            }
          });
        });
      });
      if (!best) { throw new Error('이 USB 장치에서 글자를 보낼 곳(내보내기 끝점)을 찾지 못했어요. 프린터가 맞는지 확인해 주세요.'); }
      return Promise.resolve(d.claimInterface(best.itf)).then(function () {
        return best.alt ? d.selectAlternateInterface(best.itf, best.alt) : null;
      }).then(function () {
        uep = best.ep; uifc = best.itf;
        set({ name: d.productName || '', usbId: d.vendorId + ':' + d.productId });
        return { name: d.productName || 'USB 프린터' };
      });
    });
  }
  function usbConnect() {
    if (!usbOk()) { return Promise.reject(new Error('이 브라우저에서는 USB 인쇄를 쓸 수 없어요(안드로이드 크롬이 필요해요).')); }
    if (connected()) { return Promise.resolve({ name: deviceName() }); }
    var saved = get().usbId, again = Promise.resolve(null);
    if (udev) {
      again = usbAttach(udev).catch(function () { return null; });
    } else if (saved && navigator.usb.getDevices) {
      // 한 번 허용한 프린터는 선택 창 없이 다시 붙는다
      again = navigator.usb.getDevices().then(function (ds) {
        var d = ds.filter(function (x) { return x.vendorId + ':' + x.productId === saved; })[0];
        return d ? usbAttach(d).catch(function () { return null; }) : null;
      }, function () { return null; });
    }
    return again.then(function (r) {
      if (r) { return r; }
      return navigator.usb.requestDevice({ filters: [] }).then(usbAttach);
    }).catch(function (e) {
      lastErr = errText(e);
      throw new Error(lastErr);
    });
  }
  function usbWrite(bytes) {
    var pos = 0, SIZE = 16384, healed = false;
    function one() {
      if (pos >= bytes.length) { return Promise.resolve(); }
      if (!connected()) { return Promise.reject(new Error('프린터와 연결이 끊겼어요. 케이블을 확인하고 다시 연결해 주세요.')); }
      var part = bytes.subarray(pos, pos + SIZE);
      return udev.transferOut(uep, part).then(function (r) {
        if (r && r.status && r.status !== 'ok') {
          if (r.status === 'stall' && !healed) { healed = true; return udev.clearHalt('out', uep).then(one); }
          throw new Error('프린터가 글자를 받지 않았어요(' + r.status + '). 프린터 전원과 종이를 확인해 주세요.');
        }
        pos += (r && r.bytesWritten) || part.length;
      }).then(function () { return pos >= bytes.length ? null : one(); });
    }
    return one();
  }

  // ------------------------------------------------------------------ 스티커 그리기(캔버스)
  var FONT = '"Noto Sans CJK KR","Noto Sans KR","맑은 고딕","Malgun Gothic","Apple SD Gothic Neo","Nanum Gothic",sans-serif';
  function wrap(g, text, maxW) {
    var words = String(text || '').split(/\s+/).filter(Boolean), lines = [], cur = '';
    function push(w) {
      // 한 낱말이 한 줄보다 길면 글자 단위로 끊는다
      while (g.measureText(w).width > maxW && w.length > 1) {
        var k = w.length - 1;
        while (k > 1 && g.measureText(w.slice(0, k)).width > maxW) { k--; }
        lines.push(w.slice(0, k)); w = w.slice(k);
      }
      cur = w;
    }
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (g.measureText(t).width <= maxW) { cur = t; } else { if (cur) { lines.push(cur); } cur = ''; push(w); }
    });
    if (cur) { lines.push(cur); }
    return lines;
  }
  // entry: {zip, name, addr1, addr2, phone, check, from, no}  note: 시험 인쇄 문구(있으면 시험 모양)
  function render(entry, wmm, hmm, dpi, note) {
    var pxmm = dpi / 25.4, W = Math.round(wmm * pxmm), H = Math.round(hmm * pxmm);
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#000'; g.textBaseline = 'alphabetic';
    var m = Math.round(2.2 * pxmm), aw = W - 2 * m, ah = H - 2 * m;
    var zip = String(entry.zip || '확인필요'), nm = entry.name ? entry.name + (entry.title == null ? ' 귀하' : (entry.title ? ' ' + entry.title : '')) : '';
    var addr = clean((entry.addr1 || '') + ' ' + (entry.addr2 || ''));
    var tel = entry.phone ? '☎ ' + entry.phone : '';
    var foot = note ? String(note) : clean((entry.from || '') + (entry.from && entry.no ? ' · ' : '') + (entry.no ? '접수 ' + entry.no + '번' : '') + (entry.check ? ' · 창구 확인' : ''));
    function font(u, w) { return w + ' ' + u + 'px ' + FONT; }
    // 글자 크기(u)를 키에서 줄여 가며 칸에 들어가는 가장 큰 값을 찾는다
    function layout(u) {
      var L = { u: u, blocks: [], h: 0 }, lh = 1.22;
      g.font = font(u * 2.1, 900); var zw = g.measureText(zip).width;
      g.font = font(u * 1.3, 800); var nw = g.measureText(nm).width;
      var sameRow = zw + nw + u * 0.8 <= aw;
      if (sameRow) { L.blocks.push({ t: 'row', zip: zip, nm: nm, size: u * 2.1, nsize: u * 1.3, h: u * 2.1 * lh }); }
      else {
        L.blocks.push({ t: 'text', s: zip, size: u * 2.1, w: 900, h: u * 2.1 * lh });
        if (nm) { g.font = font(u * 1.3, 800); wrap(g, nm, aw).forEach(function (s) { L.blocks.push({ t: 'text', s: s, size: u * 1.3, w: 800, h: u * 1.3 * lh }); }); }
      }
      g.font = font(u * 1.05, 700);
      wrap(g, addr, aw).forEach(function (s) { L.blocks.push({ t: 'text', s: s, size: u * 1.05, w: 700, h: u * 1.05 * lh }); });
      if (tel) { L.blocks.push({ t: 'text', s: tel, size: u * 0.85, w: 600, h: u * 0.85 * lh }); }
      g.font = font(u * 0.62, 400);
      L.foot = wrap(g, foot, aw).map(function (s) { return { s: s, size: u * 0.62, h: u * 0.62 * lh }; });
      var hh = 0; L.blocks.forEach(function (b) { hh += b.h; });
      var fh = 0; L.foot.forEach(function (b) { fh += b.h; });
      L.h = hh + fh + (L.foot.length ? u * 0.4 : 0);
      return L;
    }
    var u = Math.min(ah * 0.4, 80), L = layout(u);
    for (var n = 0; n < 120 && u > 6 && L.h > ah; n++) { u -= 1; L = layout(u); }
    var y = m;
    L.blocks.forEach(function (b) {
      y += b.h;
      var base = y - b.size * 0.22;
      if (b.t === 'row') {
        g.font = font(b.size, 900); g.textAlign = 'left'; g.fillText(b.zip, m, base);
        g.font = font(b.nsize, 800); g.textAlign = 'right'; g.fillText(b.nm, W - m, base);
      } else { g.font = font(b.size, b.w); g.textAlign = 'left'; g.fillText(b.s, m, base); }
    });
    if (L.foot.length) {
      var fh = 0; L.foot.forEach(function (b) { fh += b.h; });
      var top = H - m - fh;
      g.fillRect(m, top - L.u * 0.3, aw, Math.max(1, Math.round(0.2 * pxmm)));
      var yy = top;
      L.foot.forEach(function (b) { yy += b.h; g.font = font(b.size, 400); g.textAlign = 'left'; g.fillText(b.s, m, yy - b.size * 0.22); });
    }
    if (note) {
      // 시험 모양: 가장자리 테두리와 10mm 눈금(크기 맞추기용)
      var lw = Math.max(2, Math.round(0.3 * pxmm));
      g.fillRect(0, 0, W, lw); g.fillRect(0, H - lw, W, lw); g.fillRect(0, 0, lw, H); g.fillRect(W - lw, 0, lw, H);
      for (var x = 10; x < wmm; x += 10) { g.fillRect(Math.round(x * pxmm), 0, lw, Math.round((x % 50 === 0 ? 4 : 2) * pxmm)); }
      for (var yv = 10; yv < hmm; yv += 10) { g.fillRect(0, Math.round(yv * pxmm), Math.round((yv % 50 === 0 ? 4 : 2) * pxmm), lw); }
    }
    return c;
  }
  function turn(c, deg) {
    if (!deg) { return c; }
    var o = document.createElement('canvas'), g;
    if (deg === 180) { o.width = c.width; o.height = c.height; g = o.getContext('2d'); g.translate(c.width, c.height); g.rotate(Math.PI); }
    else { o.width = c.height; o.height = c.width; g = o.getContext('2d'); if (deg === 90) { g.translate(c.height, 0); g.rotate(Math.PI / 2); } else { g.translate(0, c.width); g.rotate(-Math.PI / 2); } }
    g.drawImage(c, 0, 0);
    return o;
  }
  // 시험 인쇄 문구: 이번에 실제로 쓰인 값(종이만 보고 설정이 반영됐는지 안다)
  function testNote(w, h) {
    var s = get();
    return (s.media === 'cont' ? '영수증 롤 ' + rollWidth() + 'mm' + (rollSide() ? ' · 돌려 찍기 ' + rollLen() + 'mm' : ' · 위에서 아래로') + ' · 끝 여백 ' + (Number(s.tail) || 0) + 'mm' : (s.media === 'bline' ? '라벨지(블랙마크) ' : '라벨지 ') + w + '×' + h + 'mm') +
      (s.via === 'app' ? ' · 앱으로 보내기(위치는 앱에서)' : ' · 가로 보정 ' + (Number(s.xoff) || 0) + 'mm' + (s.via === 'ble' ? ' · 간격 ' + (Number(s.delay) || 0) + 'ms' : '')) + ' · ' + BUILD;
  }
  // ------------------------------------------------------------------ 영수증 롤(연속지): 폭만 정하고 길이는 내용만큼
  function rollWidth() { return Math.min(112, Math.max(40, Number(get().rollW) || 80)); }
  function isRoll() { return get().media === 'cont'; }
  function qrMatrix(text) {
    if (!text || typeof qrcode !== 'function') { return null; }
    try {
      var t = String(text), q = qrcode(0, 'L');
      q.addData(t, /^[0-9A-Z $%*+\-.\/:]*$/.test(t) ? 'Alphanumeric' : 'Byte'); q.make();
      var n = q.getModuleCount(), mat = [];
      for (var r = 0; r < n; r++) { var row = []; for (var k = 0; k < n; k++) { row.push(q.isDark(r, k)); } mat.push(row); }
      return mat;
    } catch (e) { return null; }
  }
  // 위에서 아래로 쌓아 그린다. items: text{s,size,w,align} · row{a,b,size,w,bsize,bw}(같은 줄 왼쪽·오른쪽) · rule{h,pad} · gap{h} · qr{text,px}
  function stack(W, m, items, tailPx) {
    var g0 = document.createElement('canvas').getContext('2d'), aw = W - 2 * m, lh = 1.25, out = [], y = 0;
    function font(size, w) { return (w || 400) + ' ' + Math.max(6, Math.round(size)) + 'px ' + FONT; }
    function lines(t, size, w, align) { g0.font = font(size, w); wrap(g0, t, aw).forEach(function (ln) { out.push({ t: 'text', s: ln, size: size, w: w, align: align, y: y }); y += size * lh; }); }
    items.forEach(function (it) {
      if (it.t === 'text') { if (it.s) { lines(it.s, it.size, it.w, it.align); } }
      else if (it.t === 'row') {
        g0.font = font(it.size, it.w); var wa = g0.measureText(it.a).width;
        g0.font = font(it.bsize, it.bw); var wb = it.b ? g0.measureText(it.b).width : 0;
        if (it.b && wa + wb + it.size * 0.5 <= aw) { out.push({ t: 'row', a: it.a, b: it.b, size: it.size, w: it.w, bsize: it.bsize, bw: it.bw, y: y }); y += it.size * lh; }
        else { lines(it.a, it.size, it.w); if (it.b) { lines(it.b, it.bsize, it.bw); } }
      } else if (it.t === 'rule') { y += it.pad || 0; out.push({ t: 'rule', y: y, h: it.h || 2 }); y += (it.h || 2) + (it.pad || 0); }
      else if (it.t === 'bar') { out.push({ t: 'bar', s: it.s, size: it.size, y: y }); y += it.size * 1.7; }
      else if (it.t === 'gap') { y += it.h || 0; }
      else if (it.t === 'qr') {
        var mat = qrMatrix(it.text);
        if (mat) { var n = mat.length + 4, cell = Math.max(3, Math.floor(Math.min(it.px, aw) / n)); out.push({ t: 'qr', mat: mat, cell: cell, y: y, size: cell * n }); y += cell * n; }
      }
    });
    var top = Math.round(m * 0.6), H = Math.ceil(top + y + m * 0.6 + (tailPx || 0));
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#000'; g.textBaseline = 'alphabetic';
    out.forEach(function (b) {
      var yy = top + b.y;
      if (b.t === 'text') {
        g.font = font(b.size, b.w); g.textAlign = b.align === 'center' ? 'center' : 'left';
        g.fillText(b.s, b.align === 'center' ? W / 2 : m, yy + b.size * (lh - 0.22));
      } else if (b.t === 'row') {
        var base = yy + b.size * (lh - 0.22);
        g.font = font(b.size, b.w); g.textAlign = 'left'; g.fillText(b.a, m, base);
        g.font = font(b.bsize, b.bw); g.textAlign = 'right'; g.fillText(b.b, W - m, base);
      } else if (b.t === 'rule') { g.fillRect(m, Math.round(yy), aw, Math.max(1, Math.round(b.h))); }
      else if (b.t === 'bar') {   // 검은 띠에 흰 글자(보내는 분·받는 분 구분)
        g.fillRect(m, Math.round(yy), aw, Math.round(b.size * 1.5));
        g.fillStyle = '#fff'; g.font = font(b.size, 800); g.textAlign = 'left';
        g.fillText(b.s, m + Math.round(b.size * 0.5), Math.round(yy + b.size * 1.12));
        g.fillStyle = '#000';
      }
      else if (b.t === 'qr') {
        var x0 = Math.round((W - b.size) / 2) + b.cell * 2, y0 = Math.round(yy) + b.cell * 2;
        b.mat.forEach(function (row, r) { row.forEach(function (on, k) { if (on) { g.fillRect(x0 + k * b.cell, y0 + r * b.cell, b.cell, b.cell); } }); });
      }
    });
    return c;
  }
  // 주소 한 곳을 영수증 롤에: 우편번호·받는 분 → 주소 → 전화 → (선) 보내는 분·접수 번호. 글자 크기는 줄이지 않고 길이를 늘린다.
  function renderRoll(entry, wmm, dpi, note) {
    var pxmm = dpi / 25.4, k = Math.max(0.6, wmm / 80), W = Math.round(wmm * pxmm), m = Math.round(3 * pxmm);
    function sz(mm) { return mm * k * pxmm; }
    var zip = String(entry.zip || '우편번호 확인필요'), nm = entry.name ? entry.name + (entry.title == null ? ' 귀하' : (entry.title ? ' ' + entry.title : '')) : '';
    var addr = clean((entry.addr1 || '') + ' ' + (entry.addr2 || ''));
    var foot = note ? String(note) : clean((entry.from || '') + (entry.from && entry.no ? ' · ' : '') + (entry.no ? '접수 ' + entry.no + '번' : '') + (entry.check ? ' · 창구 확인' : ''));
    var items = [{ t: 'row', a: zip, b: nm, size: sz(9.5), w: 900, bsize: sz(6), bw: 800 }, { t: 'gap', h: sz(0.6) }, { t: 'text', s: addr, size: sz(5), w: 700 }];
    if (entry.phone) { items.push({ t: 'text', s: '☎ ' + entry.phone, size: sz(4), w: 600 }); }
    if (foot) { items.push({ t: 'rule', h: Math.max(1, Math.round(0.25 * pxmm)), pad: sz(1.2) }, { t: 'text', s: foot, size: sz(3.2), w: 400 }); }
    var c = stack(W, m, items, (Number(get().tail) || 0) * pxmm);
    if (note) {   // 시험 모양: 왼쪽·오른쪽·위 테두리(용지 끝이 다 보이면 위치가 맞은 것)
      var lw = Math.max(2, Math.round(0.3 * pxmm)), g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, lw, c.height); g.fillRect(c.width - lw, 0, lw, c.height); g.fillRect(0, 0, c.width, lw);
    }
    return c;
  }
  // 주소 쪽지: memo = { blocks:[{ title, zip, name, addr, phone, note }], foot } — 창구에서 받아 적도록 크게
  function renderBlocks(memo, wmm, dpi) {
    var pxmm = dpi / 25.4, k = Math.max(0.6, wmm / 80), W = Math.round(wmm * pxmm), m = Math.round(3 * pxmm);
    function sz(mm) { return mm * k * pxmm; }
    var items = [];
    (memo.blocks || []).forEach(function (b, i) {
      if (i) { items.push({ t: 'gap', h: sz(3) }); }
      items.push({ t: 'bar', s: b.title || '', size: sz(4.4) }, { t: 'gap', h: sz(0.8) });
      items.push({ t: 'text', s: b.zip || '', size: /^\d{5}$/.test(b.zip || '') ? sz(10) : sz(6), w: 900 });   // 숫자 우편번호만 크게
      items.push({ t: 'text', s: b.name || '', size: sz(7.5), w: 800 });
      items.push({ t: 'text', s: b.addr || '', size: sz(6.2), w: 700 });
      items.push({ t: 'text', s: b.phone ? '☎ ' + b.phone : '', size: sz(5.6), w: 700 });
      items.push({ t: 'text', s: b.note ? '※ ' + b.note : '', size: sz(4.2), w: 600 });
    });
    if (memo.foot) { items.push({ t: 'gap', h: sz(3) }, { t: 'rule', h: Math.max(1, Math.round(0.25 * pxmm)), pad: sz(0.8) }, { t: 'text', s: memo.foot, size: sz(3.2), w: 400 }); }
    return stack(W, m, items, (Number(get().tail) || 0) * pxmm);
  }
  // 어르신 화면 접수 메모(영수증): memo = { title, no, sub, items:[{zip, addr, sub}], qr, qrNote, foot } · blocks 가 있으면 주소 쪽지
  function renderMemo(memo, wmm, dpi) {
    if (memo && memo.blocks) { return renderBlocks(memo, wmm, dpi); }
    var pxmm = dpi / 25.4, k = Math.max(0.6, wmm / 80), W = Math.round(wmm * pxmm), m = Math.round(3 * pxmm);
    function sz(mm) { return mm * k * pxmm; }
    var hair = Math.max(1, Math.round(0.25 * pxmm)), items = [];
    if (memo.title) { items.push({ t: 'text', s: memo.title, size: sz(5), w: 800, align: 'center' }); }
    if (memo.no) { items.push({ t: 'text', s: memo.no, size: sz(12), w: 900, align: 'center' }); }
    if (memo.sub) { items.push({ t: 'text', s: memo.sub, size: sz(3.2), w: 400 }); }
    (memo.items || []).forEach(function (it) {
      items.push({ t: 'rule', h: hair, pad: sz(1.5) });
      items.push({ t: 'text', s: it.zip || '', size: sz(7.5), w: 900 });
      items.push({ t: 'text', s: it.addr || '', size: sz(4.6), w: 700 });
      items.push({ t: 'text', s: it.sub || '', size: sz(3.4), w: 500 });
    });
    if (memo.qr) {
      items.push({ t: 'rule', h: hair, pad: sz(1.5) }, { t: 'qr', text: memo.qr, px: sz(36) });
      items.push({ t: 'text', s: memo.qrNote || '', size: sz(3.2), w: 400, align: 'center' });
    }
    if (memo.foot) { items.push({ t: 'gap', h: sz(1.5) }, { t: 'text', s: memo.foot, size: sz(3), w: 400 }); }
    return stack(W, m, items, (Number(get().tail) || 0) * pxmm);
  }
  // 위치 맞춤 시험지: 헤드 폭 전체에 1mm 눈금과 5mm마다 숫자. 용지 왼쪽 끝에 보이는 눈금 = 가로 위치 보정값(mm)
  function renderRuler(hw, dpi, tailMm) {
    var pxmm = dpi / 25.4, W = Math.round(hw * pxmm), H = Math.round((30 + (tailMm || 0)) * pxmm), c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d'), lw = Math.max(2, Math.round(0.25 * pxmm));
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#000'; g.textBaseline = 'alphabetic';
    for (var x = 0; x <= hw; x++) {
      var px = Math.min(W - lw, Math.round(x * pxmm)), len = x % 10 === 0 ? 8 : (x % 5 === 0 ? 5 : 2.5);
      g.fillRect(px, 0, lw, Math.round(len * pxmm));
      if (x % 5 === 0 && x > 0 && x < hw) {
        g.textAlign = 'center';
        g.font = (x % 10 === 0 ? '800 ' + Math.round(3.6 * pxmm) : '600 ' + Math.round(2.6 * pxmm)) + 'px ' + FONT;
        g.fillText(String(x), px, Math.round((x % 10 === 0 ? 12.5 : 9) * pxmm));
      }
    }
    g.fillRect(0, Math.round(14.5 * pxmm), W, lw);
    g.textAlign = 'left'; g.font = '700 ' + Math.round(3.2 * pxmm) + 'px ' + FONT;
    g.fillText('맨 왼쪽에 보이는 눈금(mm)을', Math.round(26 * pxmm), Math.round(20 * pxmm));
    g.fillText('「가로 위치 보정」에 넣으세요', Math.round(26 * pxmm), Math.round(25 * pxmm));
    return c;
  }
  function rollLen() { return Math.min(300, Math.max(30, Number(get().rollLen) || 100)); }
  function rollSide() { return get().rollDir !== 'down'; }
  // 아래쪽에 빈 종이(자를 자리)를 더 붙인다
  function padTail(c, px) {
    px = Math.round(px || 0);
    if (px <= 0) { return c; }
    var o = document.createElement('canvas'); o.width = c.width; o.height = c.height + px;
    var g = o.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, o.width, o.height); g.drawImage(c, 0, 0);
    c.width = c.height = 0;
    return o;
  }
  // 영수증 롤 주소 한 장: 돌려 찍기(가로 라벨을 눕혀 롤 길이 방향으로 · 높이 = 롤 폭) 또는 위에서 아래로(영수증처럼)
  function rollCanvas(entry, dpi, note) {
    var rw = rollWidth();
    if (!rollSide()) { return renderRoll(entry, rw, dpi, note); }
    var flat = render(entry, rollLen(), rw, dpi, note), c = turn(flat, 90);
    flat.width = flat.height = 0;
    return padTail(c, (Number(get().tail) || 0) * dpi / 25.4);
  }
  // 흑백 점(1 = 검정)으로
  function toBits(c) {
    var W = c.width, H = c.height, wb = Math.ceil(W / 8), d = c.getContext('2d').getImageData(0, 0, W, H).data, out = new Uint8Array(wb * H);
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = (y * W + x) * 4, lum = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
        if (lum < 150) { out[y * wb + (x >> 3)] |= 0x80 >> (x & 7); }
      }
    }
    return { bits: out, wb: wb, w: W, h: H };
  }
  function ascii(s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) { u[i] = s.charCodeAt(i) & 255; } return u; }
  function cat(list) {
    var n = 0; list.forEach(function (a) { n += a.length; });
    var o = new Uint8Array(n), p = 0; list.forEach(function (a) { o.set(a, p); p += a.length; });
    return o;
  }
  // TSPL: BITMAP 은 0 이 검정, 1 이 흰색(TSC 규격). 거꾸로 나오면 설정의 「색 반전」을 켠다.
  function mmStr(v) { return (Math.round(Number(v) * 10) / 10).toFixed(1).replace(/\.0$/, ''); }
  function xDots(o) { return Math.max(0, Math.round((Number(o.xoff) || 0) * (Number(o.dpi) || 203) / 25.4)); }
  function encodeTspl(c, o) {
    var b = toBits(c), data = new Uint8Array(b.bits.length), xo = Math.max(0, Number(o.xoff) || 0), g = Number(o.gap) || 0;
    var wv = o.wmm || (c.width / o.dpi * 25.4), hv = o.hmm || (c.height / o.dpi * 25.4);
    for (var i = 0; i < data.length; i++) { data[i] = o.invert ? b.bits[i] : (~b.bits[i]) & 255; }
    // 용지 종류: 갭 라벨(라벨 사이 틈) · 연속지(영수증 롤, 틈 없음 → GAP 0) · 블랙마크(뒷면 검은 표시 → BLINE)
    var feed = o.media === 'cont' ? 'GAP 0 mm,0 mm' : (o.media === 'bline' ? 'BLINE ' + mmStr(g || 3) + ' mm,0 mm' : 'GAP ' + mmStr(g) + ' mm,0 mm');
    // 가로 위치 보정: 넓은 프린터(4인치)에 좁은 용지(80mm 영수증 롤 등)를 넣으면 그림을 오른쪽으로 민다. 인쇄 폭도 그만큼 넓힌다.
    var head = 'SIZE ' + mmStr(wv + xo) + ' mm,' + mmStr(hv) + ' mm\r\n' + feed + '\r\nDIRECTION 0\r\nCLS\r\nBITMAP ' + xDots(o) + ',0,' + b.wb + ',' + b.h + ',0,';
    return cat([ascii(head), data, ascii('\r\nPRINT 1,1\r\n')]);
  }
  // ESC/POS: ESC @ 초기화 → GS v 0 래스터(1 이 검정) 128줄씩 → 이송
  function encodeEscpos(c, o) {
    var b = toBits(c), parts = [new Uint8Array([0x1b, 0x40])], xd = xDots(o);
    if (xd) { parts.push(new Uint8Array([0x1d, 0x4c, xd & 255, xd >> 8])); }   // GS L: 왼쪽 여백(가로 위치 보정)
    for (var y = 0; y < b.h; y += 128) {
      var rows = Math.min(128, b.h - y), seg = b.bits.subarray(y * b.wb, (y + rows) * b.wb), data = seg;
      if (o.invert) { data = new Uint8Array(seg.length); for (var i = 0; i < seg.length; i++) { data[i] = (~seg[i]) & 255; } }
      parts.push(new Uint8Array([0x1d, 0x76, 0x30, 0x00, b.wb & 255, b.wb >> 8, rows & 255, rows >> 8]), data);
    }
    if (o.after === 'ff') { parts.push(new Uint8Array([0x0c])); } else if (o.after === 'lf') { parts.push(new Uint8Array([0x1b, 0x64, 0x03])); }
    return cat(parts);
  }
  // 그림 한 장을 프린터 명령으로. force: 이번 인쇄에만 덮어쓸 값({ media, xoff })
  function encodeCanvas(c, wmm, hmm, force) {
    var s = get(), f = force || {}, rot = Number(s.rotate) || 0, media = f.media || s.media;
    if (media === 'cont' && (rot === 90 || rot === 270)) { rot = 0; }   // 영수증 롤은 길이가 내용만큼이라 90도 회전을 쓰지 않는다
    var side = rot === 90 || rot === 270, t = turn(c, rot);
    var o = { dpi: Number(s.dpi) || 203, gap: s.gap, media: media, xoff: f.xoff == null ? s.xoff : f.xoff, invert: !!s.invert, after: s.after, wmm: side ? hmm : wmm, hmm: side ? wmm : hmm };
    var bytes = s.proto === 'escpos' ? encodeEscpos(t, o) : encodeTspl(t, o);
    t.width = t.height = 0; c.width = c.height = 0;
    return bytes;
  }
  function pxToMm(px) { return px * 25.4 / (Number(get().dpi) || 203); }
  // 라벨지는 스티커 크기대로, 영수증 롤은 롤 폭에 맞춰 내용 길이만큼
  function encode(entry, wmm, hmm, note) {
    var s = get(), dpi = Number(s.dpi) || 203;
    if (s.media === 'cont') { var rw = rollWidth(), rc = rollCanvas(entry, dpi, note); return encodeCanvas(rc, rw, pxToMm(rc.height)); }
    return encodeCanvas(render(entry, wmm, hmm, dpi, note), wmm, hmm);
  }

  // ------------------------------------------------------------------ 보내기
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function writeAll(bytes) {
    if (viaUsb()) { return usbWrite(bytes); }
    var s = get(), size = Math.max(20, Math.min(512, Number(s.chunk) || 100)), delay = Math.max(0, Number(s.delay) || 0), pos = 0, tries = 0;
    function one() {
      if (pos >= bytes.length) { return Promise.resolve(); }
      if (!ch) { return Promise.reject(new Error('프린터와 연결이 끊겼어요. 다시 연결해 주세요.')); }
      var part = bytes.subarray(pos, pos + size), p;
      try { p = ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse ? ch.writeValueWithoutResponse(part) : ch.writeValue(part); } catch (e) { p = Promise.reject(e); }
      return p.then(function () { pos += part.length; tries = 0; return delay ? sleep(delay) : null; }, function (e) {
        // 보내는 크기가 크면 막히는 프린터가 있어 20바이트까지 줄여 다시 시도
        if (tries < 3 && size > 20) { tries++; size = size > 100 ? 100 : 20; return sleep(60).then(one).then(null, function (e2) { throw e2; }); }
        throw e;
      }).then(function () { return pos >= bytes.length ? null : one(); });
    }
    return one();
  }
  // 블루투스 연결만 놓는다(같은 화면에서 다시 누르면 선택 창 없이 다시 붙는다)
  function release() {
    try { if (dev && dev.gatt && dev.gatt.connected) { dropping = true; dev.gatt.disconnect(); } } catch (e) { }
    ch = null;
  }

  // ------------------------------------------------------------------ 전용 앱으로 보내기(PDF 공유)
  // 브라우저 블루투스가 안 되는 기종·환경을 위한 길. 스티커 한 장 = PDF 한 쪽(라벨 크기 그대로, 흑백 1비트 그림).
  // 공유 창에서 제조사 앱(Print Label 등)을 고르면 그 앱이 인쇄한다. 공유가 안 되면 PDF로 내려받는다.
  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  // list: toBits 결과. 쪽 크기는 그림 크기(점 수 ÷ 해상도)대로라 영수증처럼 쪽마다 길이가 달라도 된다.
  function makePdf(list, dpi) {
    dpi = Number(dpi) || 203;
    var parts = [], off = [], pos = 0, nObj = 2 + list.length * 3, kids = [];
    function add(u) { parts.push(u); pos += u.length; }
    function obj(i, body, stream) {
      off[i] = pos;
      add(ascii(i + ' 0 obj\n' + body + (stream ? '\nstream\n' : '\nendobj\n')));
      if (stream) { add(stream); add(ascii('\nendstream\nendobj\n')); }
    }
    add(ascii('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n'));
    for (var i = 0; i < list.length; i++) { kids.push((3 + i * 3) + ' 0 R'); }
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + list.length + ' >>');
    list.forEach(function (b, k) {
      var W = (b.w * 72 / dpi).toFixed(2), H = (b.h * 72 / dpi).toFixed(2), p = 3 + k * 3, cs = ascii('q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im0 Do Q'), raw = new Uint8Array(b.bits.length), z = null;
      for (var j = 0; j < raw.length; j++) { raw[j] = (~b.bits[j]) & 255; }   // PDF 회색 1비트: 0 = 검정, 1 = 흰색
      try { if (window.fflate && fflate.zlibSync) { z = fflate.zlibSync(raw, { level: 9 }); } } catch (e) { z = null; }
      obj(p, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im0 ' + (p + 2) + ' 0 R >> >> /Contents ' + (p + 1) + ' 0 R >>');
      obj(p + 1, '<< /Length ' + cs.length + ' >>', cs);
      obj(p + 2, '<< /Type /XObject /Subtype /Image /Width ' + b.w + ' /Height ' + b.h + ' /ColorSpace /DeviceGray /BitsPerComponent 1' + (z ? ' /Filter /FlateDecode' : '') + ' /Length ' + (z || raw).length + ' >>', z || raw);
    });
    var xref = pos, x = 'xref\n0 ' + (nObj + 1) + '\n0000000000 65535 f \n';
    for (var n = 1; n <= nObj; n++) { x += ('0000000000' + off[n]).slice(-10) + ' 00000 n \n'; }
    add(ascii(x + 'trailer\n<< /Size ' + (nObj + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'));
    return cat(parts);
  }
  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  // 그림들을 PDF 하나로 묶어 공유 창으로(안 되면 내려받기). 사용자가 누른 단추 안에서 곧바로(기다림 없이) 불러야 한다.
  function shareCanvases(list, what, prefix) {
    var dpi = Number(get().dpi) || 203, pdf, n = list.length;
    try { pdf = makePdf(list.map(function (c) { var b = toBits(c); c.width = c.height = 0; return b; }), dpi); }
    catch (e) { return Promise.reject(new Error(what + ' PDF를 만들지 못했어요. ' + ((e && e.message) || ''))); }
    var name = (prefix || '주소스티커') + '_' + stamp() + '.pdf', blob = new Blob([pdf], { type: 'application/pdf' }), file = null;
    try { file = new File([blob], name, { type: 'application/pdf' }); } catch (e) { file = null; }
    var can = false;
    try { can = !!(file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { can = false; }
    if (can) {
      return navigator.share({ files: [file], title: what + ' ' + n + '장' }).then(function () { lastRes = 'shared'; return n; }, function (e) {
        if (e && e.name === 'AbortError') { throw new Error('보내기를 취소했어요. 다시 눌러 Print Label 앱을 골라 주세요.'); }
        saveBlob(blob, name); lastRes = 'saved'; return n;
      });
    }
    saveBlob(blob, name); lastRes = 'saved';
    return Promise.resolve(n);
  }
  function sendToApp(entries, wmm, hmm, note) {
    var s = get(), dpi = Number(s.dpi) || 203, list;
    try { list = entries.map(function (e) { return s.media === 'cont' ? rollCanvas(e, dpi, note) : render(e, wmm, hmm, dpi, note); }); }
    catch (e) { return Promise.reject(new Error('스티커를 그리지 못했어요. ' + ((e && e.message) || ''))); }
    return shareCanvases(list, '주소 스티커', '주소스티커');
  }
  // 프린터로 보내기 공통: jobs = 명령(바이트)을 만드는 함수들. 연결 → 차례로 보냄 → (설정 시) 연결 놓기
  function sendJobs(jobs) {
    if (busy) { return Promise.reject(new Error('인쇄 중이에요. 잠시 뒤에 다시 눌러 주세요.')); }
    busy = true;
    var done = 0;
    return connect().then(function () {
      var chain = Promise.resolve();
      jobs.forEach(function (job) {
        chain = chain.then(function () { return writeAll(job()); }).then(function () { done++; return sleep(150); });
      });
      return chain;
    }).then(function () {
      // 인쇄 뒤 연결 놓기: 프린터가 받은 내용을 다 처리하도록 잠시 기다린 뒤 놓는다(휴대폰 앱과 같이 쓰기)
      if (!viaUsb() && !get().keep) { return sleep(1500).then(release); }
    }).then(function () { busy = false; lastRes = 'printed'; return done; }, function (e) {
      busy = false;
      if (!(e && e.message && /[가-힣]/.test(e.message))) { e = new Error(errText(e)); }
      e.done = done;
      throw e;
    });
  }

  // entries: 스티커 한 장씩. 크기는 mm(영수증 롤이면 무시하고 롤 폭·내용 길이). 연결이 없으면(사용자 단추 안에서만) 선택 창을 띄운다.
  function print(entries, wmm, hmm, note) {
    if (busy) { return Promise.reject(new Error('인쇄 중이에요. 잠시 뒤에 다시 눌러 주세요.')); }
    lastRes = '';
    if (viaApp()) { return sendToApp(entries, wmm, hmm, note); }
    return sendJobs(entries.map(function (e) { return function () { return encode(e, wmm, hmm, note); }; }));
  }
  // 영수증 롤에 접수 메모 한 장(어르신 화면 「감열 영수증」). 용지 설정과 상관없이 연속지로 뽑는다.
  function printMemo(memo, rollW) {
    if (busy) { return Promise.reject(new Error('인쇄 중이에요. 잠시 뒤에 다시 눌러 주세요.')); }
    lastRes = '';
    var dpi = Number(get().dpi) || 203, rw = Math.min(112, Math.max(40, Number(rollW) || rollWidth())), c;
    try { c = renderMemo(memo || {}, rw, dpi); } catch (e) { return Promise.reject(new Error('메모를 그리지 못했어요. ' + ((e && e.message) || ''))); }
    if (viaApp()) { return shareCanvases([c], '접수 메모', '접수메모'); }
    return sendJobs([function () { return encodeCanvas(c, rw, pxToMm(c.height), { media: 'cont' }); }]);
  }
  // 위치 맞춤 시험지(헤드 폭 전체, 가로 보정 없이)
  function printRuler() {
    if (viaApp()) { return Promise.reject(new Error('위치 맞춤 시험지는 블루투스·USB로 바로 인쇄할 때 씁니다.')); }
    lastRes = '';
    var s = get(), dpi = Number(s.dpi) || 203, hw = Math.min(112, Math.max(40, Number(s.head) || 104));
    var c = renderRuler(hw, dpi, s.media === 'cont' ? (Number(s.tail) || 0) : 0);
    return sendJobs([function () { return encodeCanvas(c, hw, pxToMm(c.height), { xoff: 0 }); }]);
  }

  // ------------------------------------------------------------------ 설정 창(키오스크·직원 화면 공용)
  var cssDone = false;
  function injectCss() {
    if (cssDone) { return; }
    cssDone = true;
    var s = document.createElement('style');
    s.textContent = '#bleSet{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:7000;font-family:"맑은 고딕","Malgun Gothic",sans-serif}' +
      '#bleSet .b-card{background:#fff;color:#222;border-radius:16px;padding:20px 22px;width:min(560px,94vw);max-height:92vh;overflow:auto;font-size:16px;line-height:1.5}' +
      '#bleSet h3{margin:0 0 8px;font-size:20px}#bleSet label{display:block;margin:8px 0;font-weight:700}#bleSet label small{font-weight:400;color:#666}' +
      '#bleSet select,#bleSet input[type=text],#bleSet input[type=number]{width:100%;box-sizing:border-box;font-size:16px;padding:9px;margin-top:3px}' +
      '#bleSet .b-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}#bleSet .b-chk{display:flex;gap:8px;align-items:center}#bleSet .b-chk input{width:22px;height:22px}' +
      '#bleSet .b-adv{margin:10px 0}#bleSet .b-adv summary{cursor:pointer;color:#555;font-weight:700}' +
      '#bleSet .b-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}#bleSet button{font-size:16px;padding:12px 16px;border-radius:10px;border:2px solid #999;background:#fff;cursor:pointer;font-family:inherit;font-weight:700}' +
      '#bleSet button.pri{background:#c8102e;border-color:#c8102e;color:#fff}#bleSet .b-msg{min-height:3em;margin-top:8px;font-weight:700}#bleSet .b-note{font-size:13px;color:#555}';
    document.head.appendChild(s);
  }
  // opts: { size: function() → [가로mm, 세로mm], onClose }
  function openSettings(opts) {
    injectCss();
    opts = opts || {};
    var s = get(), old = $('bleSet'); if (old) { old.remove(); }
    var m = document.createElement('div'); m.id = 'bleSet';
    function sel(id, label, cur, list) { return '<label>' + label + '<select id="' + id + '">' + list.map(function (x) { return '<option value="' + x[0] + '"' + (String(x[0]) === String(cur) ? ' selected' : '') + '>' + esc(x[1]) + '</option>'; }).join('') + '</select></label>'; }
    m.innerHTML = '<div class="b-card" role="dialog" aria-label="프린터 연결 설정"><h3>프린터 연결 설정 <small style="font-weight:400;color:#888;font-size:13px">' + esc(BUILD) + '</small></h3>' +
      sel('bsVia', '인쇄 방식', s.via, [['dialog', '기기 인쇄 창(컴퓨터 등 · 크롬 인쇄 창)'], ['usb', 'USB 선(OTG)으로 바로 인쇄(태블릿)'], ['ble', '블루투스(BLE)로 바로 인쇄(태블릿)'], ['app', '전용 앱(Print Label 등)으로 보내기 · PDF 공유(태블릿)']]) +
      '<div id="bsAppNote" class="b-note" style="display:none;background:#f3f6fa;border-radius:10px;padding:10px 12px;margin:8px 0">' +
      '<b>전용 앱으로 보내기</b> — 프린터와 직접 연결하지 않고, 스티커를 라벨 크기 PDF로 만들어 공유 창으로 넘깁니다. 공유 창에서 <b>Print Label</b>을 고르고, 앱에서 인쇄 너비·높이를 스티커 크기와 같게 두고 인쇄하세요.' +
      ' 공유 창이 열리지 않으면 PDF가 다운로드 폴더에 저장되니, 앱의 「PDF 인쇄」로 여세요. 브라우저 블루투스로 바로 인쇄가 안 되는 프린터에 쓰는 길입니다.</div>' +
      '<div id="bsPaper"><div class="b-two">' + sel('bsMedia', '용지', s.media, [['gap', '라벨지 · 갭(라벨 사이 틈)'], ['bline', '라벨지 · 블랙마크(뒷면 검은 표시)'], ['cont', '영수증 롤(연속지)']]) +
      '<label class="b-dir">가로 위치 보정(mm) <small>위치 맞춤 시험지로 확인</small><input id="bsXoff" type="number" min="0" max="40" step="0.5" value="' + esc(s.xoff) + '"></label></div>' +
      '<div class="b-two" id="bsRollBox">' + sel('bsRollW', '롤 폭', s.rollW, [[80, '80mm'], [58, '58mm'], [76, '76mm'], [100, '100mm']]) +
      '<label>끝 여백(mm) <small>자를 자리까지 더 내보냄</small><input id="bsTail" type="number" min="0" max="40" step="1" value="' + esc(s.tail) + '"></label></div>' +
      '<div class="b-two" id="bsRollBox2">' + sel('bsRollDir', '롤에 찍는 방향', s.rollDir, [['side', '돌려 찍기(옆으로 긴 라벨)'], ['down', '위에서 아래로(영수증처럼)']]) +
      '<label id="bsLenL">라벨 길이(mm) <small>돌려 찍기</small><input id="bsRollLen" type="number" min="30" max="300" step="5" value="' + esc(s.rollLen) + '"></label></div></div>' +
      '<div id="bsDirect">' +
      '<label class="b-chk b-bt"><input id="bsKeep" type="checkbox"' + (s.keep ? ' checked' : '') + '> 연결 계속 잡아 두기(화면을 닫을 때까지 · 끊기면 저절로 다시 연결 · 휴대폰 앱과 같이 쓸 때만 끄세요)</label>' +
      '<div class="b-two">' + sel('bsProto', '프린터 명령', s.proto, [['tspl', 'TSPL (라벨 프린터 대부분)'], ['escpos', 'ESC/POS (영수증·일부 라벨)']]) +
      sel('bsDpi', '해상도', s.dpi, [[203, '203dpi (대부분)'], [300, '300dpi']]) + '</div>' +
      '<div class="b-two">' + sel('bsRot', '회전', s.rotate, [[0, '0도'], [90, '90도'], [180, '180도'], [270, '270도']]) +
      '<label>라벨 간격·표시 높이(mm) <small>갭·블랙마크</small><input id="bsGap" type="number" min="0" max="10" step="0.5" value="' + esc(s.gap) + '"></label></div>' +
      '<details class="b-adv"><summary>고급 설정(처음에는 그대로 두세요)</summary>' +
      '<div class="b-two b-bt">' + sel('bsChunk', '한 번에 보내는 크기', s.chunk, [[20, '20바이트(가장 안전)'], [100, '100바이트'], [180, '180바이트'], [500, '500바이트(빠름)']]) +
      '<label>보내는 간격(ms)<input id="bsDelay" type="number" min="0" max="200" value="' + esc(s.delay) + '"></label></div>' +
      sel('bsAfter', '인쇄 뒤 이송(ESC/POS)', s.after, [['ff', '용지 이송(FF)'], ['lf', '줄 이송 3줄'], ['none', '없음']]) +
      sel('bsHead', '프린터 헤드 폭(위치 맞춤 시험지)', s.head, [[104, '104mm (4인치 · 대부분 라벨프린터)'], [72, '72mm (3인치)'], [48, '48mm (2인치)']]) +
      '<label class="b-chk"><input id="bsInv" type="checkbox"' + (s.invert ? ' checked' : '') + '> 색 반전(검은 바탕으로 나오면 켜세요)</label>' +
      '<label class="b-bt">추가 서비스 번호(선택) <small>프린터를 못 찾으면 제조사 자료의 번호를 넣으세요(쉼표로 여러 개)</small><input id="bsUuid" type="text" value="' + esc(s.uuids) + '" placeholder="예) ffe0, 49535343-fe7d-4ae5-8fa9-9fafd205e455"></label></details></div>' +
      '<div class="b-msg" id="bsMsg">' + (s.via === 'app' ? '연결할 필요가 없어요. 인쇄를 누르면 공유 창이 열립니다.' : (connected() ? '연결됨: ' + esc(deviceName() || '프린터') : '연결되지 않았어요.')) + '</div>' +
      '<div class="b-row"><button class="pri" id="bsConn">프린터 연결</button><button id="bsTest">시험 인쇄</button><button id="bsRuler">위치 맞춤 시험지</button><button id="bsSave">저장하고 닫기</button></div>' +
      '<p class="b-note"><b>USB</b>: 태블릿 충전 단자에 OTG 어댑터를 끼우고 프린터 USB 선을 연결한 뒤 「프린터 연결」을 누르세요. 처음에는 안드로이드가 허용 여부를 묻습니다(허용). 컴퓨터(윈도우)에서는 프린터 드라이버가 먼저 잡고 있어 열리지 않을 수 있습니다. 「한 번에 보내는 크기」·「보내는 간격」은 블루투스에서만 씁니다.<br><b>라벨지와 영수증 롤</b>: 라벨지는 스티커 크기(가로×세로)대로 한 장씩, 영수증 롤은 「돌려 찍기」(라벨 높이 = 롤 폭, 길이는 직접 지정)나 「위에서 아래로」(내용 길이만큼)로 뽑습니다(어르신 화면의 「감열 영수증」 접수 메모는 늘 위에서 아래로). 블루투스로 보낼 때 글자가 중간부터 옆으로 밀려 나오면 고급 설정의 「보내는 간격」을 늘리세요(기본 30ms). 먼저 <b>위치 맞춤 시험지</b>를 뽑아 용지 왼쪽 끝에 보이는 맨 왼쪽 눈금(mm)을 「가로 위치 보정」에 넣으면 좌우가 맞습니다. 용지를 바꾼 뒤에는 프린터의 FEED 단추를 5~6초 눌러 용지 보정을 다시 하세요(영수증 롤을 「라벨지」로 두면 틈을 찾느라 빈 종이가 길게 나옵니다).<br><b>블루투스</b>: 태블릿(안드로이드 크롬)에서 BLE(저전력 블루투스) 라벨프린터를 쓸 때의 설정입니다. 탭의 블루투스 설정에서 미리 등록하지 않아도 됩니다(「프린터 연결」을 누르면 뜨는 목록에서 「Bluetooth Printer」를 고릅니다). 프린터가 클래식 블루투스(SPP)만 지원하면 연결되지 않습니다. 안드로이드 11 이하는 「위치」 기능을 켜야 프린터가 검색될 수 있습니다. 시험 인쇄의 테두리가 라벨 가장자리와 맞는지 확인하고, 거꾸로·검은 바탕이면 회전·색 반전을 바꾸세요.</p></div>';
    // 「라벨 인쇄」 창처럼 모달 대화상자가 열려 있으면 그 바깥은 눌리지 않으므로, 맨 위 모달 안에 띄운다
    var host = null;
    try { Array.prototype.forEach.call(document.querySelectorAll('dialog[open]'), function (d) { if (d.matches(':modal')) { host = d; } }); } catch (e) { host = null; }
    (host || document.body).appendChild(m);
    function showFor() {   // 고른 방식에 맞는 칸만 보인다
      var v = $('bsVia').value;
      $('bsDirect').style.display = (v === 'dialog' || v === 'app') ? 'none' : '';
      $('bsPaper').style.display = v === 'dialog' ? 'none' : '';
      $('bsRollBox').style.display = $('bsMedia').value === 'cont' ? '' : 'none';
      $('bsRollBox2').style.display = $('bsMedia').value === 'cont' ? '' : 'none';
      $('bsLenL').style.visibility = $('bsRollDir').value === 'side' ? 'visible' : 'hidden';
      Array.prototype.forEach.call(m.querySelectorAll('.b-dir'), function (el) { el.style.display = (v === 'ble' || v === 'usb') ? '' : 'none'; });
      $('bsRuler').style.display = (v === 'ble' || v === 'usb') ? '' : 'none';
      $('bsAppNote').style.display = v === 'app' ? '' : 'none';
      Array.prototype.forEach.call(m.querySelectorAll('.b-bt'), function (el) { el.style.display = v === 'ble' ? '' : 'none'; });
      $('bsConn').style.display = (v === 'dialog' || v === 'app') ? 'none' : '';
      $('bsTest').style.display = v === 'dialog' ? 'none' : '';
      $('bsMsg').textContent = v === 'app' ? '연결할 필요가 없어요. 시험 인쇄를 누르면 공유 창이 열립니다.' : (connected() ? '연결됨: ' + (deviceName() || '프린터') : '연결되지 않았어요.');
    }
    $('bsVia').onchange = showFor;
    $('bsMedia').onchange = showFor;
    $('bsRollDir').onchange = showFor;
    showFor();
    function read() {
      return set({ via: $('bsVia').value, proto: $('bsProto').value, dpi: Number($('bsDpi').value), rotate: Number($('bsRot').value), gap: Number($('bsGap').value) || 0,
        chunk: Number($('bsChunk').value), delay: Number($('bsDelay').value) || 0, after: $('bsAfter').value, invert: $('bsInv').checked, uuids: clean($('bsUuid').value),
        media: $('bsMedia').value, xoff: Math.min(40, Math.max(0, Number($('bsXoff').value) || 0)), keep: $('bsKeep').checked,
        rollW: Number($('bsRollW').value) || 80, tail: Math.min(40, Math.max(0, Number($('bsTail').value) || 0)), head: Number($('bsHead').value) || 104,
        rollDir: $('bsRollDir').value, rollLen: Math.min(300, Math.max(30, Number($('bsRollLen').value) || 100)) });
    }
    function msg(t) { $('bsMsg').textContent = t; }
    $('bsConn').onclick = function () {
      read(); msg(viaUsb() ? 'USB 프린터를 찾는 중… 선택 창에서 프린터를 골라 주세요.' : '프린터를 찾는 중… 선택 창에서 프린터를 골라 주세요.');
      connect().then(function (d) { msg('연결됨: ' + ((d && d.name) || '프린터')); }, function (e) { msg('연결 실패: ' + e.message); });
    };
    $('bsTest').onclick = function () {
      read();
      var sz = opts.size ? opts.size() : [100, 45];
      msg(viaApp() ? '시험 스티커 PDF를 만드는 중…' : '시험 인쇄를 보내는 중…');
      print([{ zip: '12345', name: '시험용', phone: '010-0000-0000', addr1: '전북특별자치도 정읍시 충정로 234-1', addr2: '시험동 101호' }], sz[0], sz[1], testNote(sz[0], sz[1])).then(function () { msg(resultText(1, '보냈어요. 용지가 나왔는지, 테두리가 라벨과 맞는지 확인하세요.')); }, function (e) { msg('실패: ' + e.message); });
    };
    $('bsRuler').onclick = function () {
      read(); msg('위치 맞춤 시험지를 보내는 중…');
      printRuler().then(function () { msg('보냈어요. 용지 왼쪽 끝에 보이는 맨 왼쪽 눈금(mm)을 「가로 위치 보정」에 넣고 저장하세요. 오른쪽 끝 눈금 − 왼쪽 끝 눈금이 실제 인쇄 폭입니다.'); }, function (e) { msg('실패: ' + e.message); });
    };
    $('bsSave').onclick = function () { read(); m.remove(); if (opts.onClose) { opts.onClose(get()); } };
  }

  // 인쇄 결과 안내 문구(앱으로 보내기는 공유했는지·내려받았는지에 따라 다르다)
  function resultText(n, printed, what) {
    what = what || '스티커';
    if (lastRes === 'shared') { return what + ' ' + n + '장을 앱으로 넘겼어요. Print Label 앱에서 인쇄를 누르세요(인쇄 너비·높이를 용지와 같게).'; }
    if (lastRes === 'saved') { return what + ' ' + n + '장을 PDF로 저장했어요(다운로드 폴더). Print Label 앱의 「PDF 인쇄」로 열어 인쇄하세요.'; }
    return printed || (what + ' ' + n + '장을 프린터로 보냈어요.');
  }

  window.__ble = { supported: supported, connected: connected, connect: connect, disconnect: disconnect, release: release, print: print, get: get, set: set, openSettings: openSettings,
    render: render, renderRoll: renderRoll, renderMemo: renderMemo, renderRuler: renderRuler, printMemo: printMemo, printRuler: printRuler, isRoll: isRoll, rollWidth: rollWidth, rollCanvas: rollCanvas, rollLen: rollLen, rollSide: rollSide,
    encode: encode, encodeCanvas: encodeCanvas, encodeTspl: encodeTspl, encodeEscpos: encodeEscpos, toBits: toBits, makePdf: makePdf, deviceName: deviceName, via: function () { return get().via; },
    direct: function () { var v = get().via; return (v === 'ble' || v === 'usb' || v === 'app') && supported(); }, lastError: function () { return lastErr; },
    lastResult: function () { return lastRes; }, resultText: resultText, testNote: testNote, build: BUILD,
    // 이 화면에서 프린터를 이미 골랐는지(골랐으면 끊겨 있어도 선택 창 없이 다시 붙는다)
    ready: function () { var v = get().via; return v === 'app' || v === 'dialog' || (v === 'usb' ? !!udev : !!(dev && dev.gatt)); },
    status: function () { return status; }, onStatus: function (f) { if (typeof f === 'function') { listeners.push(f); } } };
})();
