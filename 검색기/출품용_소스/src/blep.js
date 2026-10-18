/*! 물어물어(우편번호 자동검색기) v1.10 (출품본) · 블루투스(BLE)·USB(OTG) 라벨프린터 직접 인쇄 | (c) 2026 이희재 · 정읍우체국 | 2026 공공 AI 대전환 챌린지 출품본. 대회 규정에 따라 사용권 부여 */
/* 태블릿(안드로이드 크롬)에서 컴퓨터 없이 무선 라벨프린터로 바로 뽑기 위한 모듈.
   - 브라우저의 인쇄 창을 거치지 않고, 스티커 한 장을 그림(캔버스)으로 그려 흑백 점으로 바꾼 뒤 TSPL 또는 ESC/POS 명령으로 BLE(저전력 블루투스)에 보낸다.
   - Web Bluetooth 는 BLE 만 된다(클래식 블루투스·SPP 전용 프린터는 못 쓴다). 프린터 쪽 규격은 기종마다 달라 실기 시험이 필요하며, 설정 창에서 명령·해상도·색 반전·회전·전송 크기를 고칠 수 있게 했다.
   - v1.8: 선으로 잇는 방식(WebUSB)을 더했다. 태블릿에 OTG 어댑터로 USB 라벨프린터를 꽂으면 컴퓨터·블루투스 없이 같은 TSPL/ESC·POS 명령을 USB 대량 전송(bulk OUT)으로 보낸다.
   - 주소·이름은 이 기기 안에서 그림으로만 만들어 프린터로 보낸다(인터넷으로 나가지 않는다). */
(function () {
  'use strict';

  var KEY = 'zipfinder.ble.v1';
  // 흔한 BLE 프린터 서비스(Web Bluetooth 는 미리 적어 둔 서비스만 열 수 있다). 설정에서 더 보탤 수 있다.
  var SERVICES = [0x18f0, 0xff00, 0xffe0, 0xffe5, 0xfff0, 0xfee7, 0xae30, 0xff12,
    '49535343-fe7d-4ae5-8fa9-9fafd205e455', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f'];
  var dev = null, ch = null, busy = false, lastErr = '';
  var udev = null, uep = 0, uifc = -1, uhook = false;   // USB(WebUSB): 장치, 내보내기 끝점 번호, 인터페이스 번호

  function $(id) { return document.getElementById(id); }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var DEF = { via: 'dialog', proto: 'tspl', dpi: 203, gap: 2, chunk: 100, delay: 10, invert: false, rotate: 0, after: 'ff', uuids: '', name: '', usbId: '' };
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
  function btOk() { return !!(navigator.bluetooth && navigator.bluetooth.requestDevice && window.isSecureContext !== false); }
  function usbOk() { return !!(navigator.usb && navigator.usb.requestDevice && window.isSecureContext !== false); }
  // 지금 고른 방식(블루투스 또는 USB)을 이 브라우저가 쓸 수 있는지
  function supported() { return viaUsb() ? usbOk() : btOk(); }
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
    dev.addEventListener('gattserverdisconnected', function () { ch = null; });
    return dev.gatt.connect().then(pickChar).then(function (c) {
      ch = c;
      set({ name: dev.name || '' });
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
      var opt = SERVICES.concat(userUuids());
      return navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: opt }).then(attach);
    }).catch(function (e) {
      lastErr = errText(e);
      throw new Error(lastErr);
    });
  }
  function disconnect() {
    if (udev) { try { udev.close(); } catch (e) { } udev = null; uep = 0; }
    try { if (dev && dev.gatt && dev.gatt.connected) { dev.gatt.disconnect(); } } catch (e) { }
    ch = null;
  }
  function errText(e) {
    var n = e && e.name, m = String(e && e.message || e || '');
    if (n === 'NotFoundError' || /cancel|chooser/i.test(m)) { return '프린터를 고르지 않았어요. 다시 눌러 프린터를 골라 주세요.'; }
    if (viaUsb() && (n === 'SecurityError' || /protected class/i.test(m))) { return 'USB 프린터를 열 수 없어요. 이 장치는 크롬에서 막혀 있어요(컴퓨터에서는 프린터 드라이버가 잡고 있을 수 있어요). 태블릿에서 다시 해 보세요.'; }
    if (n === 'SecurityError' || n === 'NotAllowedError') { return (viaUsb() ? 'USB' : '블루투스') + ' 사용이 허용되지 않았어요. 크롬 설정에서 허용해 주세요.'; }
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
  function encodeTspl(c, o) {
    var b = toBits(c), data = new Uint8Array(b.bits.length), wmm = (o.wmm || (c.width / o.dpi * 25.4)).toFixed(1).replace(/\.0$/, ''), hmm = (o.hmm || (c.height / o.dpi * 25.4)).toFixed(1).replace(/\.0$/, '');
    for (var i = 0; i < data.length; i++) { data[i] = o.invert ? b.bits[i] : (~b.bits[i]) & 255; }
    var head = 'SIZE ' + wmm + ' mm,' + hmm + ' mm\r\nGAP ' + (Number(o.gap) || 0) + ' mm,0 mm\r\nDIRECTION 0\r\nCLS\r\nBITMAP 0,0,' + b.wb + ',' + b.h + ',0,';
    return cat([ascii(head), data, ascii('\r\nPRINT 1,1\r\n')]);
  }
  // ESC/POS: ESC @ 초기화 → GS v 0 래스터(1 이 검정) 128줄씩 → 이송
  function encodeEscpos(c, o) {
    var b = toBits(c), parts = [new Uint8Array([0x1b, 0x40])];
    for (var y = 0; y < b.h; y += 128) {
      var rows = Math.min(128, b.h - y), seg = b.bits.subarray(y * b.wb, (y + rows) * b.wb), data = seg;
      if (o.invert) { data = new Uint8Array(seg.length); for (var i = 0; i < seg.length; i++) { data[i] = (~seg[i]) & 255; } }
      parts.push(new Uint8Array([0x1d, 0x76, 0x30, 0x00, b.wb & 255, b.wb >> 8, rows & 255, rows >> 8]), data);
    }
    if (o.after === 'ff') { parts.push(new Uint8Array([0x0c])); } else if (o.after === 'lf') { parts.push(new Uint8Array([0x1b, 0x64, 0x03])); }
    return cat(parts);
  }
  function encode(entry, wmm, hmm, note) {
    var s = get(), c = turn(render(entry, wmm, hmm, Number(s.dpi) || 203, note), Number(s.rotate) || 0);
    var o = { dpi: Number(s.dpi) || 203, gap: s.gap, invert: !!s.invert, after: s.after, wmm: (Number(s.rotate) === 90 || Number(s.rotate) === 270) ? hmm : wmm, hmm: (Number(s.rotate) === 90 || Number(s.rotate) === 270) ? wmm : hmm };
    var bytes = s.proto === 'escpos' ? encodeEscpos(c, o) : encodeTspl(c, o);
    c.width = c.height = 0;
    return bytes;
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
  // entries: 스티커 한 장씩. 크기는 mm. 연결이 없으면(사용자 단추 안에서만) 선택 창을 띄운다.
  function print(entries, wmm, hmm, note) {
    if (busy) { return Promise.reject(new Error('인쇄 중이에요. 잠시 뒤에 다시 눌러 주세요.')); }
    busy = true;
    var done = 0;
    return connect().then(function () {
      var chain = Promise.resolve();
      entries.forEach(function (e) {
        chain = chain.then(function () { return writeAll(encode(e, wmm, hmm, note)); }).then(function () { done++; return sleep(150); });
      });
      return chain;
    }).then(function () { busy = false; return done; }, function (e) {
      busy = false;
      if (!(e && e.message && /[가-힣]/.test(e.message))) { e = new Error(errText(e)); }
      e.done = done;
      throw e;
    });
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
    m.innerHTML = '<div class="b-card" role="dialog" aria-label="프린터 연결 설정"><h3>프린터 연결 설정</h3>' +
      sel('bsVia', '인쇄 방식', s.via, [['dialog', '기기 인쇄 창(컴퓨터 등 · 크롬 인쇄 창)'], ['usb', 'USB 선(OTG)으로 바로 인쇄(태블릿)'], ['ble', '블루투스(BLE)로 바로 인쇄(태블릿)']]) +
      '<div id="bsDirect">' +
      '<div class="b-two">' + sel('bsProto', '프린터 명령', s.proto, [['tspl', 'TSPL (라벨 프린터 대부분)'], ['escpos', 'ESC/POS (영수증·일부 라벨)']]) +
      sel('bsDpi', '해상도', s.dpi, [[203, '203dpi (대부분)'], [300, '300dpi']]) + '</div>' +
      '<div class="b-two">' + sel('bsRot', '회전', s.rotate, [[0, '0도'], [90, '90도'], [180, '180도'], [270, '270도']]) +
      '<label>라벨 간격(mm) <small>TSPL</small><input id="bsGap" type="number" min="0" max="10" step="0.5" value="' + esc(s.gap) + '"></label></div>' +
      '<details class="b-adv"><summary>고급 설정(처음에는 그대로 두세요)</summary>' +
      '<div class="b-two b-bt">' + sel('bsChunk', '한 번에 보내는 크기', s.chunk, [[20, '20바이트(가장 안전)'], [100, '100바이트'], [180, '180바이트'], [500, '500바이트(빠름)']]) +
      '<label>보내는 간격(ms)<input id="bsDelay" type="number" min="0" max="200" value="' + esc(s.delay) + '"></label></div>' +
      sel('bsAfter', '인쇄 뒤 이송(ESC/POS)', s.after, [['ff', '용지 이송(FF)'], ['lf', '줄 이송 3줄'], ['none', '없음']]) +
      '<label class="b-chk"><input id="bsInv" type="checkbox"' + (s.invert ? ' checked' : '') + '> 색 반전(검은 바탕으로 나오면 켜세요)</label>' +
      '<label class="b-bt">추가 서비스 번호(선택) <small>프린터를 못 찾으면 제조사 자료의 번호를 넣으세요(쉼표로 여러 개)</small><input id="bsUuid" type="text" value="' + esc(s.uuids) + '" placeholder="예) ffe0, 49535343-fe7d-4ae5-8fa9-9fafd205e455"></label></details></div>' +
      '<div class="b-msg" id="bsMsg">' + (connected() ? '연결됨: ' + esc(deviceName() || '프린터') : '연결되지 않았어요.') + '</div>' +
      '<div class="b-row"><button class="pri" id="bsConn">프린터 연결</button><button id="bsTest">시험 인쇄</button><button id="bsSave">저장하고 닫기</button></div>' +
      '<p class="b-note"><b>USB</b>: 태블릿 충전 단자에 OTG 어댑터를 끼우고 프린터 USB 선을 연결한 뒤 「프린터 연결」을 누르세요. 처음에는 안드로이드가 허용 여부를 묻습니다(허용). 컴퓨터(윈도우)에서는 프린터 드라이버가 먼저 잡고 있어 열리지 않을 수 있습니다. 「한 번에 보내는 크기」·「보내는 간격」은 블루투스에서만 씁니다.<br><b>블루투스</b>: 태블릿(안드로이드 크롬)에서 BLE(저전력 블루투스) 라벨프린터를 쓸 때의 설정입니다. 프린터가 클래식 블루투스(SPP)만 지원하면 연결되지 않습니다. 안드로이드 11 이하는 「위치」 기능을 켜야 프린터가 검색될 수 있습니다. 시험 인쇄의 테두리가 라벨 가장자리와 맞는지 확인하고, 거꾸로·검은 바탕이면 회전·색 반전을 바꾸세요.</p></div>';
    document.body.appendChild(m);
    function showFor() {   // 고른 방식에 맞는 칸만 보인다
      var v = $('bsVia').value;
      $('bsDirect').style.display = v === 'dialog' ? 'none' : '';
      Array.prototype.forEach.call(m.querySelectorAll('.b-bt'), function (el) { el.style.display = v === 'ble' ? '' : 'none'; });
      $('bsConn').style.display = $('bsTest').style.display = v === 'dialog' ? 'none' : '';
    }
    $('bsVia').onchange = showFor;
    showFor();
    function read() {
      return set({ via: $('bsVia').value, proto: $('bsProto').value, dpi: Number($('bsDpi').value), rotate: Number($('bsRot').value), gap: Number($('bsGap').value) || 0,
        chunk: Number($('bsChunk').value), delay: Number($('bsDelay').value) || 0, after: $('bsAfter').value, invert: $('bsInv').checked, uuids: clean($('bsUuid').value) });
    }
    function msg(t) { $('bsMsg').textContent = t; }
    $('bsConn').onclick = function () {
      read(); msg(viaUsb() ? 'USB 프린터를 찾는 중… 선택 창에서 프린터를 골라 주세요.' : '프린터를 찾는 중… 선택 창에서 프린터를 골라 주세요.');
      connect().then(function (d) { msg('연결됨: ' + ((d && d.name) || '프린터')); }, function (e) { msg('연결 실패: ' + e.message); });
    };
    $('bsTest').onclick = function () {
      read();
      var sz = opts.size ? opts.size() : [100, 45];
      msg('시험 인쇄를 보내는 중…');
      print([{ zip: '12345', name: '시험용', phone: '010-0000-0000', addr1: '전북특별자치도 정읍시 충정로 234-1', addr2: '시험동 101호' }], sz[0], sz[1], '가로 ' + sz[0] + ' × 세로 ' + sz[1] + 'mm').then(function () { msg('보냈어요. 용지가 나왔는지, 테두리가 라벨과 맞는지 확인하세요.'); }, function (e) { msg('실패: ' + e.message); });
    };
    $('bsSave').onclick = function () { read(); m.remove(); if (opts.onClose) { opts.onClose(get()); } };
  }

  window.__ble = { supported: supported, connected: connected, connect: connect, disconnect: disconnect, print: print, get: get, set: set, openSettings: openSettings,
    render: render, encode: encode, encodeTspl: encodeTspl, encodeEscpos: encodeEscpos, toBits: toBits, deviceName: deviceName, via: function () { return get().via; }, direct: function () { var v = get().via; return (v === 'ble' || v === 'usb') && supported(); }, lastError: function () { return lastErr; } };
})();
