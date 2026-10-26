// 물어물어 v1.11(8차) 새 기능·고친 곳 시험: 주소 쪽지 보내는 동안 막기, 앱으로 보내기(직원만·잠금·다시 누르기·내려받기 대체),
// 끊김 띠 위치·다시 연결 멈춤, 프린터 오류 문구, 옛 설정 옮김, 가로 보정 상한, 이 기기 상태, 키보드 숫자판, 말로 하기, 직원 설정, 엑셀 작성자.
// 사용: node v111_test.js <출품본.html> <주소록.xlsx> <결과 폴더>   (가짜 프린터·가짜 음성 인식·가상 자료만)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const [HTML, INPUT, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x) => { (c ? pass++ : fail++); console.log((c ? '통과  ' : '실패  ') + n + (x ? ' · ' + x : '')); };

// 가짜 BLE 프린터: 끊김 알림(gattserverdisconnected)을 낼 수 있고, 쓰기 하나에 writeMs 만큼 걸린다. window.__bt 로 조종한다
const MOCK = `(() => {
  // 자리 비움 타이머를 줄인다: 뽑은 뒤 3분은 __idleMs, 입력 있음 5분·마친 뒤 10분은 __idleMs2 (시험 10·11)
  const T0 = window.setTimeout; window.setTimeout = function (f, ms) { if (ms === 180000 && window.__idleMs) { ms = window.__idleMs; } if ((ms === 300000 || ms === 600000) && window.__idleMs2) { ms = window.__idleMs2; } return T0.apply(this, [f, ms].concat([].slice.call(arguments, 2))); };
  const bt = window.__bt = { writes: [], connects: 0, failConnect: false, writeMs: 0, reqErr: null, reqs: 0, listeners: [] };
  const ch = { uuid: 'ffe1', properties: { write: true, writeWithoutResponse: true },
    writeValueWithoutResponse: (v) => new Promise(r => setTimeout(() => { bt.writes.push(Array.from(v)); r(); }, bt.writeMs)), writeValue: async (v) => { bt.writes.push(Array.from(v)); } };
  const svc = { uuid: 'ffe0', getCharacteristics: async () => [ch] };
  const dev = bt.dev = { name: 'Bluetooth Printer', addEventListener(t, f) { if (t === 'gattserverdisconnected') bt.listeners.push(f); },
    gatt: { connected: false, connect: async function () { bt.connects++; if (bt.connMs) { await new Promise(r => setTimeout(r, bt.connMs)); } if (bt.failConnect) { const e = new Error('Connection failed for unknown reason.'); e.name = 'NetworkError'; throw e; } dev.gatt.connected = true; return dev.gatt; },
      disconnect() { dev.gatt.connected = false; bt.listeners.forEach(f => f()); }, getPrimaryServices: async () => [svc] } };
  bt.drop = () => { dev.gatt.connected = false; bt.listeners.forEach(f => f()); };
  // 프린터가 아닌 기기(이어폰): 붙기는 하지만 서비스가 없다. bt.pickEar 이면 선택 창에서 이것을 고른 것으로 한다
  const ear = bt.ear = { name: 'Galaxy Buds', addEventListener() { },
    gatt: { connected: false, connect: async function () { if (bt.earMs) { await new Promise(r => setTimeout(r, bt.earMs)); } ear.gatt.connected = true; return ear.gatt; }, disconnect() { ear.gatt.connected = false; },
      getPrimaryServices: async () => { const e = new Error('No Services found in device.'); e.name = 'NotFoundError'; throw e; } } };
  // 다른 이름의 프린터 B(빨리 붙음). bt.pickB 이면 선택 창에서 이것을 고른 것으로 한다
  const devB = bt.devB = { name: 'Printer B', addEventListener() { }, gatt: { connected: false, connect: async function () { devB.gatt.connected = true; return devB.gatt; }, disconnect() { devB.gatt.connected = false; }, getPrimaryServices: async () => [svc] } };
  Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: async () => { bt.reqs++; if (bt.reqMs) { await new Promise(r => setTimeout(r, bt.reqMs)); } if (bt.reqErr) { const e = new Error(bt.reqErr[1]); e.name = bt.reqErr[0]; throw e; } return bt.pickEar ? ear : (bt.pickB ? devB : dev); } } });
  // 공유: 부른 횟수와 넘긴 파일. shareErr 가 있으면 그 이름의 오류
  const sh = window.__sh = { calls: [], err: null, can: true, dl: [] };
  navigator.canShare = (o) => sh.can && !!(o && o.files);
  navigator.share = (o) => { sh.calls.push({ n: o.files.length, name: o.files[0].name, size: o.files[0].size, type: o.files[0].type }); if (sh.err) { const e = new Error(sh.err); e.name = sh.err; return Promise.reject(e); } return Promise.resolve(); };
  const click0 = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download && !sh.passDl) { sh.dl.push(this.download); return; } return click0.call(this); };
  // 화면 꺼짐 막기
  const wl = window.__wl = { req: 0, rel: 0 };
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => { wl.req++; const l = { released: false, _h: [], addEventListener(t, f) { this._h.push(f); }, release() { wl.rel++; this.released = true; this._h.forEach(f => f()); return Promise.resolve(); } }; return l; } } });
  // 가짜 음성 인식: __sr.next = { error: 'not-allowed' } 또는 { text: '...', ms: 500 }
  const sr = window.__sr = { next: null, starts: 0, aborts: 0 };
  window.SpeechRecognition = window.webkitSpeechRecognition = function () {
    const me = this; let t = 0;
    me.start = function () { sr.starts++; const n = sr.next || { error: 'no-speech' };
      t = setTimeout(() => { if (n.error) { me.onerror && me.onerror({ error: n.error }); } else { me.onresult && me.onresult({ results: [[{ transcript: n.text }]] }); } me.onend && me.onend(); }, n.ms || 50); };
    me.abort = function () { sr.aborts++; clearTimeout(t); me.onerror && me.onerror({ error: 'aborted' }); me.onend && me.onend(); };
  };
})();`;
async function open(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext(Object.assign({ locale: 'ko-KR', viewport: { width: 1280, height: 800 }, acceptDownloads: true }, opts.ctx || {}));
  const page = await ctx.newPage(); page.errs = [];
  page.on('pageerror', e => page.errs.push(e.message));
  await page.addInitScript(MOCK);
  if (opts.init) await page.addInitScript(opts.init[0], opts.init[1]);
  await page.goto('file://' + HTML + (opts.hash || ''));
  await page.waitForFunction(() => /구간/.test(document.querySelector('#dbInfo').textContent), null, { timeout: 60000 });
  await page.waitForFunction(() => !/확인 중/.test(document.querySelector('#intChip').textContent), null, { timeout: 30000 });
  if (await page.isVisible('#btnPrivacyOk')) await page.click('#btnPrivacyOk');
  return page;
}
const toasts = p => p.evaluate(() => Array.from(document.querySelectorAll('.k-toast')).map(e => e.textContent).join(' | '));
const SET = (ble, kiosk) => [([b, k]) => { localStorage.setItem('zipfinder.ble.v1', JSON.stringify(b)); localStorage.setItem('zipfinder.kiosk.v1', JSON.stringify(Object.assign({ region: '전북특별자치도 정읍시', idle: 300 }, k))); }, [ble, kiosk]];
async function longPress(p, el, ms) {   // 직원 단추: 눌렀다(ms) 떼기
  const b = await el.boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await p.waitForTimeout(ms); await p.mouse.up();
}
async function toFinish(p, sender) {
  await p.evaluate((sender) => { const st = __kiosk.state(); st.entries.push(
    { name: '가상일', phone: '010-0000-1111', zip: '56180', addr1: '전북특별자치도 정읍시 충정로 234-1', addr2: '정읍시청 3층', check: false },
    { name: '가상이', phone: '', zip: '56204', addr1: '전북특별자치도 정읍시 시기4길 42', addr2: '101동 1004호', check: true, why: '비슷한 주소' });
    st.sender = sender; __kiosk.finish(); }, sender);
  await p.waitForSelector('#kFinMsg');
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--allow-file-access-from-files'] });

  // ---- 1. 주소 쪽지(영수증 롤, 블루투스): 보내는 동안 단추 막기 · 다시 눌러도 한 장 · 끝나면 안내
  let p = await open(browser, { init: SET({ via: 'ble', media: 'cont', rollW: 76, chunk: 500, delay: 0, cfgv: 2 }, { paper: '80' }) });
  await p.evaluate(() => { window.__bt.writeMs = 40; const o = __ble.printMemo; __ble.printMemo = function (m, w) { window.__memo = { m: m, w: w }; return o.apply(this, arguments); }; });
  await p.click('#btnKiosk'); await p.waitForSelector('#kiosk:not([hidden])');
  ok('직원이 연 어르신 화면: 프린터 고르기 안내 창', !!(await p.waitForSelector('#kModal', { timeout: 3000 }).catch(() => null)));
  ok('아래 줄 「프린터 연결 전(직원)」 표시', !!(await p.$('#kPrnHint')));
  await p.click('#kModal button.k-btn.pri');   // 프린터 연결(누름 = 사용자 몸짓)
  await p.waitForFunction(() => !document.querySelector('#kModal'), null, { timeout: 5000 });
  ok('연결 뒤 표시 사라짐', !(await p.$('#kPrnHint')));
  await toFinish(p, { name: '가상발송', phone: '010-0000-9999', zip: '56180', addr1: '전북특별자치도 정읍시 충정로 234-1', addr2: '', check: true, why: '비슷한 주소' });
  ok('마침 단추 「주소 쪽지 뽑기」', (await p.textContent('#kPrintBtn')).trim() === '주소 쪽지 뽑기');
  await p.click('#kPrintBtn');
  await p.waitForTimeout(150);
  ok('보내는 동안 단추 막힘·「뽑는 중」', await p.evaluate(() => { const b = document.getElementById('kPrintBtn'); return b.disabled && /뽑는 중/.test(b.textContent); }));
  ok('말풍선 「잠시 기다려 주세요 · 30초쯤」', /기다려 주세요/.test(await p.textContent('#kFinMsg')) && /30초/.test(await p.textContent('#kFinMsg')));
  await p.evaluate(() => { document.getElementById('kPrintBtn').disabled = false; document.getElementById('kPrintBtn').click(); });   // 막힌 단추를 억지로 다시 눌러도
  await p.waitForTimeout(200);
  ok('다시 눌러도 실패 창 없이 「지금 뽑고 있어요」', !(await p.$('#kModal')) && /지금 뽑고 있어요/.test(await toasts(p)));
  await p.waitForFunction(() => /다 됐어요! 뽑은/.test(document.getElementById('kFinMsg').textContent), null, { timeout: 60000 });
  const nSize = await p.evaluate(() => { const all = [].concat.apply([], window.__bt.writes); let s = ''; for (const c of all) s += String.fromCharCode(c); return (s.match(/SIZE /g) || []).length; });
  ok('쪽지는 한 장만 나감', nSize === 1, nSize + '장');
  ok('끝나면 단추 다시 켜짐', await p.evaluate(() => !document.getElementById('kPrintBtn').disabled));
  const memo = await p.evaluate(() => window.__memo);
  ok('쪽지 폭 = 프린터 롤 폭(76mm)', memo && memo.w === 76, memo && memo.w);
  ok('보내는 분 칸에도 「창구 확인 필요」', memo && memo.m.blocks[0].title === '보내는 분' && /창구 확인 필요/.test(memo.m.blocks[0].note || ''), memo && JSON.stringify(memo.m.blocks[0]));
  ok('쪽지에 번호·QR 없음', memo && !memo.m.no && !memo.m.qr);
  ok('처음 화면으로: 뽑은 뒤라 「지워도 괜찮아요」', await (async () => { await p.click('#kDone'); const t = await p.textContent('#kModal'); await p.click('#kModal button.k-btn.pri'); return /지워도 괜찮아요/.test(t); })());
  // 보내는 분 주소를 창구에서 적기로 한 경우
  await p.evaluate(() => { const st = __kiosk.state(); st.entries.length = 0; });
  await toFinish(p, { name: '가상발송', phone: '010-0000-9999' });
  await p.click('#kPrintBtn');
  await p.waitForFunction(() => /다 됐어요! 뽑은/.test(document.getElementById('kFinMsg').textContent), null, { timeout: 60000 });
  const memo2 = await p.evaluate(() => window.__memo);
  ok('보내는 분 주소 없음 → 「주소는 창구에서 적기」', memo2 && memo2.m.blocks[0].note === '주소는 창구에서 적기', memo2 && memo2.m.blocks[0].note);
  // 끊김 띠: 「직원」 단추를 가리지 않음
  await p.evaluate(() => { window.__bt.failConnect = true; window.__bt.drop(); });
  await p.waitForSelector('#kBleBar', { timeout: 3000 });
  const geo = await p.evaluate(() => { const bar = document.getElementById('kBleBar').getBoundingClientRect(), sb = document.getElementById('kStaff').getBoundingClientRect(), mn = document.getElementById('kMain').getBoundingClientRect(); const hit = document.elementFromPoint(sb.left + sb.width / 2, sb.top + sb.height / 2); return { barTop: bar.top, barBottom: bar.bottom, staffTop: sb.top, mainBottom: mn.bottom, hit: hit && hit.id }; });
  ok('끊김 띠가 「직원」 단추 위에 뜸(단추를 누를 수 있음)', geo.barBottom <= geo.staffTop + 1 && geo.hit === 'kStaff', JSON.stringify(geo));
  ok('끊김 띠가 본문(어르신 단추)을 덮지 않음(본문이 띠 위에서 끝남)', geo.mainBottom <= geo.barTop + 1, JSON.stringify(geo));
  // 인쇄 방식을 바꾸면 다시 연결을 멈춤
  await p.evaluate(() => __ble.set({ via: 'dialog' }));
  const c0 = await p.evaluate(() => window.__bt.connects);
  await p.waitForTimeout(5000);
  const c1 = await p.evaluate(() => window.__bt.connects);
  ok('방식을 바꾸면 다시 연결 시도 멈춤', c1 - c0 <= 1 && (await p.evaluate(() => __ble.status())) === 'none', (c1 - c0) + '번 · ' + (await p.evaluate(() => __ble.status())));
  ok('페이지 오류 없음(1)', p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();

  // ---- 2. 이미 고른 프린터가 꺼져 있음 → 「전원·거리」(선택 창으로 넘어가지 않음) / 오류 문구 나눔
  p = await open(browser, { init: SET({ via: 'ble', cfgv: 2 }, { paper: 'lbl' }) });
  await p.evaluate(() => { const b = document.createElement('button'); b.id = 'tConn'; b.textContent = 'c'; b.onclick = () => { window.__r = null; __ble.connect(window.__copt).then(() => { window.__r = 'ok'; }, e => { window.__r = e.message; }); }; document.body.appendChild(b); });
  await p.click('#tConn'); await p.waitForFunction(() => window.__r);
  await p.evaluate(() => { window.__bt.failConnect = true; window.__bt.drop(); __ble.set({ keep: false }); });
  const reqs0 = await p.evaluate(() => window.__bt.reqs);
  await p.click('#tConn'); await p.waitForFunction(() => window.__r, null, { timeout: 20000 });
  const r1 = await p.evaluate(() => window.__r);
  ok('꺼진 프린터: 「전원·거리」 안내', /전원/.test(r1) && /가까이/.test(r1), r1);
  ok('꺼진 프린터: 선택 창을 열지 않음', (await p.evaluate(() => window.__bt.reqs)) === reqs0);
  // 직원이 「프린터 연결」(pick): 이전 프린터가 응답 없이 매달려도 누른 그 자리에서 선택 창
  await p.evaluate(() => { window.__bt.failConnect = false; const d = window.__bt.dev; d.gatt.connect = () => new Promise(() => { }); window.__copt = { pick: true }; });
  const reqs1 = await p.evaluate(() => window.__bt.reqs);
  await p.evaluate(() => { window.__r = null; }); await p.click('#tConn'); await p.waitForTimeout(500);
  ok('직원 「프린터 연결」은 기다리지 않고 곧바로 선택 창', (await p.evaluate(() => window.__bt.reqs)) === reqs1 + 1);
  await p.evaluate(() => { window.__copt = undefined; });
  await p.context().close(); p = await open(browser, { init: SET({ via: 'ble', cfgv: 2 }, { paper: 'lbl' }) });
  await p.evaluate(() => { const b = document.createElement('button'); b.id = 'tConn'; b.textContent = 'c'; b.onclick = () => { window.__r = null; __ble.connect(window.__copt).then(() => { window.__r = 'ok'; }, e => { window.__r = e.message; }); }; document.body.appendChild(b); });
  for (const [name, msg, want] of [['NotFoundError', 'No Services found in device.', /서비스 번호/], ['NotFoundError', 'Bluetooth adapter not available.', /블루투스가 꺼져/], ['NotFoundError', 'User cancelled the requestDevice() chooser.', /고르지 않았어요/], ['NetworkError', 'Connection failed for unknown reason.', /전원/], ['NotFoundError', 'User denied the browser permission to scan for Bluetooth devices.', /근처 기기/], ['NotFoundError', 'Web Bluetooth API globally disabled.', /쓸 수 없어요/], ['NetworkError', 'GATT Server is disconnected. Cannot retrieve services. (Re)connect first with `device.gatt.connect`.', /끊겼어요/]]) {
    await p.evaluate(([a, b]) => { window.__bt.reqErr = [a, b]; window.__copt = { pick: true }; }, [name, msg]);
    await p.evaluate(() => { location.hash = ''; });
    const r = await (async () => { await p.evaluate(() => { window.__r = null; }); await p.click('#tConn'); await p.waitForFunction(() => window.__r, null, { timeout: 5000 }); return p.evaluate(() => window.__r); })();
    ok('오류 문구: ' + msg.slice(0, 30), want.test(r), r);
  }
  ok('「다시 해 볼게요」(없는 단추) 안내 없음', !(await p.evaluate(() => /다시 해 볼게요/.test(document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/g, '')) || /다시 해 볼게요/.test(String(__ble.connect)))));
  // 옛 설정 옮김 · 다른 키 보존 · 가로 보정 상한 · 이 기기 상태
  const mig = await p.evaluate(() => {
    localStorage.setItem('zipfinder.ble.v1', JSON.stringify({ via: 'ble', delay: 10, futureKey: 7 })); const a = __ble.get().delay;
    __ble.set({ proto: 'tspl' }); const raw = JSON.parse(localStorage.getItem('zipfinder.ble.v1'));
    localStorage.setItem('zipfinder.ble.v1', JSON.stringify({ via: 'ble', delay: 10, cfgv: 2 })); const b = __ble.get().delay;
    return { a, keep: raw.futureKey, cfgv: raw.cfgv, b };
  });
  ok('옛 설정(판 없음)의 간격 10ms → 30ms', mig.a === 30, JSON.stringify(mig));
  ok('설정을 저장해도 모르는 키는 남김 · 판 표시', mig.keep === 7 && mig.cfgv === 2);
  ok('새 판에서 직원이 고른 10ms는 그대로', mig.b === 10);
  const head = await p.evaluate(() => { __ble.set({ media: 'cont', rollW: 100, xoff: 12, head: 104, proto: 'tspl' }); const c = document.createElement('canvas'); c.width = 800; c.height = 80; const b = __ble.encodeCanvas(c, 100, 10); let s = ''; for (let i = 0; i < 120; i++) s += String.fromCharCode(b[i]); return s; });
  ok('가로 보정 + 용지 폭이 헤드 폭을 넘지 않음(100mm 롤·보정 12 → 4mm)', /^SIZE 104 mm/.test(head) && /BITMAP 32,0,/.test(head), head.split('\r\n').filter(l => /SIZE|BITMAP/.test(l)).join(' / ').slice(0, 80));
  const env = await p.evaluate(() => __ble.envText());
  ok('이 기기 상태 한 줄(파일·안전한 연결·블루투스·USB·공유)', /이 기기 상태: 파일\(file:\/\/\)/.test(env) && /안전한 연결 됨/.test(env) && /블루투스 됨/.test(env) && /앱 공유 됨/.test(env), env);
  await p.evaluate(() => __ble.openSettings({}));
  ok('설정 창 첫 줄에 이 기기 상태', /이 기기 상태/.test(await p.textContent('#bsEnv')));
  await p.selectOption('#bsVia', 'app');
  ok('앱으로 보내기 안내에 개인정보 알림', /이름·주소·전화/.test(await p.textContent('#bsAppNote')) && /다른 앱은 고르지/.test(await p.textContent('#bsAppNote')));
  ok('설정 안내: 네트워크 프린터·「항상 이 앱으로」·근처 기기', await p.evaluate(() => { const t = document.querySelector('#bleSet .b-note:last-of-type').textContent; return /9100/.test(t) && /항상 이 앱으로 열기/.test(t) && /근처 기기/.test(t); }));
  await p.click('#bsSave');
  // USB: 다른 앱이 잡고 있음(claimInterface 실패)은 「다른 앱」 안내로
  await p.evaluate(() => {
    __ble.set({ via: 'usb', usbId: '' });
    const d = { productName: 'MockUSB', vendorId: 1, productId: 2, opened: false, configuration: { interfaces: [{ interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 7, endpoints: [{ direction: 'out', type: 'bulk', endpointNumber: 1 }] }] }] },
      open: async function () { d.opened = true; }, selectConfiguration: async () => { }, claimInterface: async () => { const e = new Error('Unable to claim interface.'); e.name = 'NetworkError'; throw e; } };
    Object.defineProperty(navigator, 'usb', { configurable: true, value: { requestDevice: async () => d, getDevices: async () => [], addEventListener() { } } });
    const b = document.createElement('button'); b.id = 'tUsb'; b.textContent = 'u'; b.onclick = () => { window.__u = null; __ble.connect().then(() => { window.__u = 'ok'; }, e => { window.__u = e.message; }); }; document.body.appendChild(b);
  });
  await p.click('#tUsb'); await p.waitForFunction(() => window.__u, null, { timeout: 5000 });
  const usbMsg = await p.evaluate(() => window.__u);
  ok('USB 다른 앱이 잡고 있음 → 「다른 앱」·「항상 이 앱으로」 안내', /다른 앱/.test(usbMsg) && /항상 이 앱으로 열기/.test(usbMsg), usbMsg);
  ok('페이지 오류 없음(2)', p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();

  // ---- 3. 앱으로 보내기: 어르신 화면은 직원이 누를 때만 · 자동 뽑기는 공유 안 함 · 공유 막힘은 저장하지 않고 다시 누르기 · 공유를 못 여는 기기만 내려받기
  p = await open(browser, { init: SET({ via: 'app', media: 'gap', cfgv: 2 }, { paper: 'lbl', lblW: 100, lblH: 45, autoPrint: true }) });
  await p.click('#btnKiosk'); await p.waitForSelector('#kiosk:not([hidden])');
  ok('앱 방식: 어르신 화면을 열 때 프린터 안내 창 없음', !(await p.waitForSelector('#kModal', { timeout: 1200 }).catch(() => null)));
  await toFinish(p, { name: '가상발송', phone: '010-0000-9999', zip: '56180', addr1: '전북특별자치도 정읍시 충정로 234-1', addr2: '' });
  await p.waitForTimeout(1200);
  ok('자동 뽑기여도 공유 창을 띄우지 않음', (await p.evaluate(() => window.__sh.calls.length)) === 0 && (await p.evaluate(() => window.__sh.dl.length)) === 0);
  ok('앱 방식 마침 화면: 「직원을 불러 주세요」', /직원을 불러 주세요/.test(await p.textContent('#kFinMsg')));
  await p.click('#kPrintBtn');
  ok('뽑기 → 「직원을 불러 주세요」 창(공유 창은 아직)', /직원을 불러 주세요/.test(await p.textContent('#kModal')) && (await p.evaluate(() => window.__sh.calls.length)) === 0);
  ok('직원 확인 창의 주 단추는 「닫기」', (await p.textContent('#kModal button.k-btn.pri')).trim() === '닫기');
  const staffBtn = async () => (await p.$$('#kModalBtns button'))[1];
  await (await staffBtn()).click(); await p.waitForTimeout(300);
  ok('직원 단추를 짧게 누르면 공유 창 안 열림', (await p.evaluate(() => window.__sh.calls.length)) === 0 && !!(await p.$('#kModal')));
  await longPress(p, await staffBtn(), 2200);
  await p.waitForFunction(() => window.__sh.calls.length === 1, null, { timeout: 10000 });
  const sc = await p.evaluate(() => window.__sh.calls[0]);
  ok('직원이 누르면 PDF 한 개 공유(받는 분 2장)', sc.type === 'application/pdf' && /^주소스티커_/.test(sc.name), JSON.stringify(sc));
  await p.waitForTimeout(400);
  ok('공유 뒤 결과 안내(앱에서 인쇄)', /앱으로 넘겼어요/.test(await toasts(p)));
  // 공유가 막힘(NotAllowedError): 내려받지 않고 「한 번 더」, 다시 누르면 만든 PDF로 곧바로
  await p.evaluate(() => { window.__sh.err = 'NotAllowedError'; });
  await p.click('#kPrintBtn'); await longPress(p, await staffBtn(), 2200);
  await p.waitForSelector('#kModal', { timeout: 10000 });
  ok('공유 막힘 → PDF를 내려받지 않고 「한 번 더 누르면」', (await p.evaluate(() => window.__sh.dl.length)) === 0 && /한 번 더 누르면/.test(await p.textContent('#kModal')), (await p.textContent('#kModal')).slice(0, 80));
  await p.evaluate(() => { window.__sh.err = null; });
  const n0 = await p.evaluate(() => window.__sh.calls.length);
  ok('실패 창: 주 단추 「닫기」, 직원 단추 「직원: 다시 보내기(2초)」', (await p.textContent('#kModal button.k-btn.pri')).trim() === '닫기' && /직원: 다시 보내기\(2초\)/.test(await (await staffBtn()).textContent()));
  await (await staffBtn()).click(); await p.waitForTimeout(200);
  ok('실패 창 직원 단추도 짧게 누르면 공유 안 함', (await p.evaluate(() => window.__sh.calls.length)) === n0);
  await longPress(p, await staffBtn(), 2200);   // 직원: 다시 보내기
  await p.waitForFunction((n) => window.__sh.calls.length === n + 1, n0, { timeout: 10000 });
  ok('다시 누르면 같은 PDF를 곧바로 공유', (await p.evaluate(() => window.__sh.calls[window.__sh.calls.length - 1].name)) === (await p.evaluate(() => window.__sh.calls[window.__sh.calls.length - 2].name)));
  // 잠금: 공유 중 또 누르면 거절
  const lock = await p.evaluate(() => { let hold; window.__sh.err = null; const s0 = navigator.share; navigator.share = (o) => new Promise(r => { hold = r; }); const e = [{ zip: '12345', name: '시험', addr1: '정읍시 충정로 234-1' }]; const a = __ble.print(e, 100, 45); return __ble.print(e, 100, 45).then(() => 'ok', x => x.message).then(m => { hold(); navigator.share = s0; return a.then(() => m); }); });
  ok('앱으로 보내는 중 또 누르면 「보내는 중이에요」', /보내는 중/.test(lock), lock);
  // 공유를 아예 못 여는 기기 → 내려받기 + 지우라는 안내
  await p.evaluate(() => { window.__sh.can = false; });
  const saved = await p.evaluate(() => __ble.print([{ zip: '12345', name: '시험', addr1: '정읍시 충정로 234-1' }], 100, 45).then(n => __ble.resultText(n, '')));
  ok('공유 못 여는 기기: 다운로드 저장 + 「인쇄한 뒤 지워」', (await p.evaluate(() => window.__sh.dl.length)) === 1 && /지워 주세요/.test(saved), saved);
  ok('페이지 오류 없음(3)', p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();

  // ---- 4. #kiosk 자동 시작: 프린터 안내 창을 어르신 앞에 띄우지 않음 · 화면 꺼짐 막기
  p = await open(browser, { hash: '#kiosk', init: SET({ via: 'ble', cfgv: 2 }, { paper: 'lbl' }) });
  await p.waitForSelector('#kiosk:not([hidden])', { timeout: 60000 }); await p.waitForTimeout(1200);
  ok('#kiosk 자동 시작: 안내 창 없이 아래 줄 표시만', !(await p.$('#kModal')) && !!(await p.$('#kPrnHint')));
  ok('화면 꺼짐 막기 요청', (await p.evaluate(() => window.__wl.req)) >= 1);
  // 숫자판: 키보드 「234-1」 · Enter 는 다음
  await (await p.waitForSelector('#kStart')).click();
  await p.fill('#kIn', '정읍시 충정로'); await p.click('#kGo'); await p.waitForTimeout(600);
  const hasPad = !!(await p.$('#kNum'));
  ok('번호 묻는 숫자판', hasPad, (await p.textContent('#kMain .k-bubble')).slice(0, 40));
  if (hasPad) {
    await p.click('#kNum'); await p.click('#kMain [data-k="2"]');
    await p.keyboard.type('34-1');
    ok('키보드 「-」 받음(234-1)', (await p.textContent('#kNum')).trim() === '234-1', await p.textContent('#kNum'));
    await p.keyboard.press('Enter'); await p.waitForTimeout(600);
    ok('숫자를 손으로 누른 뒤 Enter = 다음(숫자 한 번 더 들어가지 않음)', !(await p.$('#kNum')) || (await p.textContent('#kNum')).trim() !== '234-11', (await p.textContent('#kMain .k-bubble')).slice(0, 40));
  }
  // 직원 설정: 맨 위 끝내기·전체 화면·말로 하기·화면 꺼짐
  await p.evaluate(() => { const b = document.getElementById('kStaff'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await p.waitForSelector('#kfExit', { timeout: 4000 });
  ok('직원 설정 맨 위에 「어르신 화면 끝내기」', await p.evaluate(() => { const m = document.querySelector('#kModal > div'); return m.firstElementChild.contains(document.getElementById('kfExit')); }));
  ok('직원 설정에 전체 화면·말로 하기·화면 꺼짐 막기', !!(await p.$('#kfFull')) && !!(await p.$('#kfMic')) && (await p.isChecked('#kfWake')));
  ok('직원 설정 아래 단추 줄에 끝내기 중복 없음', (await p.$$eval('#kModalBtns button', bs => bs.filter(b => /어르신 화면 끝내기/.test(b.textContent)).length)) === 0);
  p.once('dialog', d => d.accept());   // 적힌 내용이 있으면 지울지 묻는다
  await p.click('#kfExit'); await p.waitForTimeout(500);
  const closed = await p.evaluate(() => document.getElementById('kiosk').hidden);
  ok('끝내기 → 직원 화면', closed);
  ok('어르신 화면을 닫으면 화면 꺼짐 막기 풂', (await p.evaluate(() => window.__wl.rel)) >= 1, JSON.stringify(await p.evaluate(() => window.__wl)));
  ok('페이지 오류 없음(4)', p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();

  // ---- 5. 말로 하기: 오류 종류별 안내 · 두 번 인터넷 오류에만 숨김 · 직원이 다시 켜기 · 늦은 결과 버림
  p = await open(browser, { init: SET({ via: 'dialog', cfgv: 2 }, { paper: 'a4' }) });
  await p.click('#btnKiosk'); await p.waitForSelector('#kiosk:not([hidden])');
  await (await p.waitForSelector('#kStart')).click(); await p.waitForSelector('#kMic');
  await p.evaluate(() => { window.__sr.next = { error: 'audio-capture' }; }); await p.click('#kMic'); await p.waitForTimeout(300);
  ok('audio-capture → 「마이크를 쓸 수 없어요」(단추 남음)', /마이크를 쓸 수 없어요/.test(await toasts(p)) && !!(await p.$('#kMic')));
  await p.evaluate(() => { window.__sr.next = { error: 'network' }; }); await p.click('#kMic'); await p.waitForTimeout(300);
  ok('인터넷 오류 한 번 → 단추 남음 · 직원 코드', !!(await p.$('#kMic')) && /직원 확인: network/.test(await toasts(p)));
  await p.click('#kMic'); await p.waitForTimeout(300);
  ok('인터넷 오류 두 번 → 단추 숨김', !(await p.$('#kMic')));
  await p.evaluate(() => { const b = document.getElementById('kStaff'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await p.waitForSelector('#kfMic', { timeout: 4000 });
  ok('직원 설정: 「말로 하기 쓰기」는 켜진 채 「이 탭에서 숨겨 둠」 안내', (await p.isChecked('#kfMic')) && /숨겨 둠/.test(await p.textContent('#kModal')));
  await p.fill('#kfOrg', '가상우체국'); await p.click('#kModal .k-btn.pri');   // 다른 설정만 고쳐 저장
  ok('다른 설정만 저장해도 「말로 하기」가 영구로 꺼지지 않음', await p.evaluate(() => !JSON.parse(localStorage.getItem('zipfinder.kiosk.v1')).noMic));
  await p.waitForTimeout(300);
  await p.evaluate(() => __kiosk.close()); await p.click('#btnKiosk'); await (await p.waitForSelector('#kStart')).click();
  ok('직원이 다시 켜면 단추가 돌아옴', !!(await p.waitForSelector('#kMic', { timeout: 3000 }).catch(() => null)));
  await p.evaluate(() => { window.__sr.next = { error: 'not-allowed' }; }); await p.click('#kMic'); await p.waitForTimeout(300);
  ok('not-allowed → 「안 돼요」 + 직원 코드 + 숨김', /직원 확인: not-allowed/.test(await toasts(p)) && !(await p.$('#kMic')));
  // 늦은 결과는 버림: 다시 켜고, 듣는 중에 화면을 바꾼다
  await p.evaluate(() => { sessionStorage.removeItem('zipfinder.kiosk.micoff'); __kiosk.close(); }); await p.click('#btnKiosk'); await (await p.waitForSelector('#kStart')).click(); await p.waitForSelector('#kMic');
  await p.evaluate(() => { window.__sr.next = { text: '서울 종로구 세종대로 209', ms: 800 }; }); await p.click('#kMic'); await p.waitForTimeout(100);
  await p.click('#kRegion'); await p.waitForTimeout(1500);
  await p.click('#kBack').catch(() => { }); await p.waitForTimeout(300);
  if (await p.$('#kMic')) {
    await p.evaluate(() => { window.__sr.next = { text: '서울', ms: 1500 }; });
    await p.click('#kMic'); await p.waitForTimeout(80); await p.click('#kMic'); await p.waitForTimeout(400);
    ok('말로 하기를 두 번 눌러도 듣는 중에 「잘 못 들었어요」 안 뜸', !/잘 못 들었어요/.test(await toasts(p)), await toasts(p));
  }
  ok('듣는 중 화면을 바꾸면 늦은 결과로 끌려가지 않음(듣기 멈춤)', (await p.evaluate(() => window.__sr.aborts)) >= 1 && !/세종대로/.test(await p.textContent('#kMain')), (await p.textContent('#kMain .k-bubble')).slice(0, 30));
  ok('페이지 오류 없음(5)', p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();

  // ---- 7. #kiosk 자동 시작·연결 전: 어르신이 뽑기를 눌러도 선택 창 대신 「직원을 불러 주세요」 / 직원 설정 맨 위 「프린터 연결」
  p = await open(browser, { hash: '#kiosk', init: SET({ via: 'ble', media: 'cont', rollW: 80, chunk: 500, delay: 0, cfgv: 2 }, { paper: '80' }) });
  await p.waitForSelector('#kiosk:not([hidden])', { timeout: 60000 }); await p.waitForTimeout(800);
  await toFinish(p, { name: '가상발송', phone: '010-0000-9999', zip: '56180', addr1: '전북특별자치도 정읍시 충정로 234-1', addr2: '' });
  await p.click('#kPrintBtn'); await p.waitForSelector('#kModal', { timeout: 5000 });
  ok('연결 전 어르신 뽑기 → 선택 창 없이 「직원을 불러 주세요(직원: …프린터 연결)」', (await p.evaluate(() => window.__bt.reqs)) === 0 && /프린터 연결/.test(await p.textContent('#kModal')), (await p.textContent('#kModal')).slice(0, 90));
  ok('연결 전 실패 창: 직원 단추 「프린터 고르고 뽑기(2초)」', /프린터 고르고 뽑기\(2초\)/.test(await (await p.$$('#kModalBtns button'))[1].textContent()));
  ok('실패한 뒤에는 「뽑으셨으면 지워도」라고 하지 않음', await (async () => { await p.locator('#kModalBtns button', { hasText: /^닫기$/ }).click(); await p.click('#kDone'); const t = await p.textContent('#kModal'); await p.click('#kModal .k-btn.pri'); return /뽑지 않으셨어요/.test(t); })());
  await p.evaluate(() => { const b = document.getElementById('kStaff'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await p.waitForSelector('#kfPrn', { timeout: 4000 });
  ok('직원 설정 맨 위 「프린터 연결」', await p.evaluate(() => document.querySelector('#kModal > div').firstElementChild.contains(document.getElementById('kfPrn'))));
  await p.click('#kfPrn'); await p.waitForFunction(() => /연결됨/.test(document.getElementById('kfMsg').textContent), null, { timeout: 5000 });
  ok('「프린터 연결」 → 선택 창 → 연결됨 · 아래 줄 표시 사라짐', (await p.evaluate(() => window.__bt.reqs)) === 1 && !(await p.$('#kPrnHint')));
  await p.evaluate(() => { const m = document.getElementById('kModal'); if (m) m.remove(); });   // 직원 설정 창 닫기
  // 뽑는 중 「처음 화면으로」 → 기다리라는 안내, 직원이 닫은 뒤 실패 → 직원 화면에 어르신 실패 창 없음
  await p.evaluate(() => { window.__bt.writeMs = 30; window.__bt.failAfter = 20; });
  await p.evaluate(() => { const bt = window.__bt; const svcP = bt.dev.gatt.getPrimaryServices; bt.dev.gatt.getPrimaryServices = async () => { const s = await svcP(); const cs = await s[0].getCharacteristics(); const c = cs[0]; const w = c.writeValueWithoutResponse; let k = 0; c.writeValueWithoutResponse = (v) => { if (++k > bt.failAfter) { const e = new Error('GATT operation failed for unknown reason.'); e.name = 'NetworkError'; return Promise.reject(e); } return w(v); }; return s; }; });
  await p.evaluate(() => { __ble.disconnect(); });   // 놓은 뒤 뽑기를 누르면 고른 프린터에 선택 창 없이 다시 붙는다(이번에는 쓰다가 실패하는 특성으로)
  await p.click('#kPrintBtn'); await p.waitForTimeout(200);
  await p.click('#kDone'); await p.waitForTimeout(200);
  ok('뽑는 중 「처음 화면으로」 → 「지금 뽑고 있어요. 종이가 나온 뒤에」', /종이가 나온 뒤에/.test(await toasts(p)) && !(await p.$('#kModal')));
  await p.evaluate(() => __kiosk.close());
  await p.waitForFunction(() => Array.from(document.querySelectorAll('.k-toast')).some(t => /앞 분/.test(t.textContent)), null, { timeout: 20000 }).catch(() => null);
  ok('직원이 닫은 뒤 실패 → 어르신 실패 창 없이 직원 알림만', !(await p.$('#kModal')) && /앞 분 주소 쪽지를 뽑지 못했어요/.test(await toasts(p)), (await toasts(p)).slice(0, 80));
  const logs = await p.evaluate(() => localStorage.getItem('zipfinder.log.v1') || '');
  ok('처리 이력: 결과(인쇄 실패)로 남김', /주소 쪽지 인쇄 실패/.test(logs));
  // 숫자판에서 직원 설정 창의 단추에 포커스 → Enter는 그 단추(숫자판으로 가지 않음)
  await p.click('#btnKiosk'); await (await p.waitForSelector('#kStart')).click();
  await p.fill('#kIn', '정읍시 충정로'); await p.click('#kGo'); await p.waitForTimeout(600);
  if (await p.$('#kNum')) {
    await p.evaluate(() => { const b = document.getElementById('kStaff'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    await p.waitForSelector('#kfExit', { timeout: 4000 });
    await p.locator('#kModalBtns button', { hasText: /^닫기$/ }).focus();
    await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    ok('직원 설정 창에서 Enter는 창 단추로(숫자판 「다음」 안 됨)', !(await p.$('#kModal')) && !!(await p.$('#kNum')) && !/몰라요/.test(await toasts(p)), (await toasts(p)).slice(0, 60));
  }
  // 직원 도움만: 넘기기 단추 없음·처음 화면으로는 바로
  await p.evaluate(() => __kiosk.close()); await p.click('#btnKiosk'); await (await p.waitForSelector('#kStart')).click();
  await p.waitForSelector('#kHelp'); await p.click('#kHelp'); await p.waitForTimeout(300);
  { const b = await p.$$('#kMain button'); for (const x of b) { if (/창구에서 할게요/.test(await x.textContent())) { await x.click(); break; } } }
  await p.waitForSelector('#kFinMsg');
  await p.evaluate(() => { const b = document.getElementById('kStaff'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await p.waitForSelector('#kfExit', { timeout: 4000 });
  ok('직원 도움만: 「접수 화면으로 넘기기」 단추 없음', !(await p.$$eval('#kModalBtns button', bs => bs.some(b => /넘기기/.test(b.textContent)))));
  await p.locator('#kModalBtns button', { hasText: /^닫기$/ }).click();
  await p.evaluate(() => { const m = document.getElementById('kModal'); if (m) m.remove(); });
  await p.click('#kDone'); await p.waitForTimeout(300);
  ok('직원 도움만: 「처음 화면으로」는 확인 없이 바로', !(await p.$('#kModal')) && !!(await p.$('#kStart')));
  ok('페이지 오류 없음(7)', p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();

  // ---- 8. 연결 전 실패 창에서 직원이 「프린터 고르고 뽑기」를 2초 눌렀다 떼면 선택 창 → 연결 → 그 분 쪽지가 나옴
  p = await open(browser, { hash: '#kiosk', init: SET({ via: 'ble', media: 'cont', rollW: 80, chunk: 500, delay: 0, cfgv: 2 }, { paper: '80' }) });
  await p.waitForSelector('#kiosk:not([hidden])', { timeout: 60000 }); await p.waitForTimeout(600);
  await toFinish(p, { name: '가상발송', phone: '010-0000-9999' });
  await p.click('#kPrintBtn'); await p.waitForSelector('#kModal', { timeout: 5000 });
  await longPress(p, (await p.$$('#kModalBtns button'))[1], 2200);
  await p.waitForFunction(() => /다 됐어요! 뽑은/.test(document.getElementById('kFinMsg').textContent), null, { timeout: 30000 }).catch(() => null);
  ok('실패 창 직원 단추(2초) → 선택 창 1번 → 그 분 쪽지 인쇄', (await p.evaluate(() => window.__bt.reqs)) === 1 && /다 됐어요! 뽑은/.test(await p.textContent('#kFinMsg')), (await p.textContent('#kFinMsg')).slice(0, 40));
  ok('뽑은 뒤 표시(doneAt)', await p.evaluate(() => !!__kiosk.state().doneAt));
  ok('페이지 오류 없음(8)', p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();

  // ---- 9. 처음 고를 때 이어폰을 고르면 놓고 「고른 프린터 없음」으로 되돌림 → 실패 창이 다시 「프린터 고르고 뽑기」 → 프린터를 고르면 그 분 쪽지
  p = await open(browser, { hash: '#kiosk', init: SET({ via: 'ble', media: 'cont', rollW: 80, chunk: 500, delay: 0, cfgv: 2 }, { paper: '80' }) });
  await p.waitForSelector('#kiosk:not([hidden])', { timeout: 60000 }); await p.waitForTimeout(600);
  await toFinish(p, { name: '가상발송', phone: '010-0000-9999' });
  await p.click('#kPrintBtn'); await p.waitForSelector('#kModal', { timeout: 5000 });
  await p.evaluate(() => { window.__bt.pickEar = true; });
  await longPress(p, (await p.$$('#kModalBtns button'))[1], 2200);
  await p.waitForFunction(() => window.__bt.reqs === 1 && document.querySelector('#kModal') && /서비스 번호/.test(document.querySelector('#kModal').textContent), null, { timeout: 15000 }).catch(() => null);
  { const lab = await (await p.$$('#kModalBtns button'))[1].textContent();
    const s = await p.evaluate(() => ({ ready: __ble.ready(), ear: window.__bt.ear.gatt.connected, name: __ble.deviceName() }));
    ok('처음 고를 때 이어폰 → 실패 창 문구 「서비스 번호」, 단추는 다시 「프린터 고르고 뽑기(2초)」', /서비스 번호/.test(await p.textContent('#kModal')) && /프린터 고르고 뽑기\(2초\)/.test(lab), lab);
    ok('이어폰 연결은 놓고 고른 프린터 없음으로 되돌림', !s.ready && !s.ear && !s.name, JSON.stringify(s)); }
  await p.evaluate(() => { window.__bt.pickEar = false; });
  await longPress(p, (await p.$$('#kModalBtns button'))[1], 2200);
  await p.waitForFunction(() => /다 됐어요! 뽑은/.test(document.getElementById('kFinMsg').textContent), null, { timeout: 30000 }).catch(() => null);
  ok('다시 2초 → 선택 창 2번째 → 프린터 → 그 분 쪽지 인쇄', (await p.evaluate(() => window.__bt.reqs)) === 2 && /다 됐어요! 뽑은/.test(await p.textContent('#kFinMsg')), (await p.textContent('#kFinMsg')).slice(0, 40));
  { const h = fs.readFileSync(HTML, 'utf8'); ok('「처음 인쇄할 때는 프린터를 한 번 골라야」 문구가 지금 단추 이름을 가리킴', h.includes('「직원: 프린터 고르고 뽑기(2초)」나 프린터 연결 설정의') && !h.includes('다시 연결하고 뽑기(직원)')); }
  // 이미 쓰던 프린터가 있을 때(연결만 끊긴 상태) 직원이 이어폰을 고르면 그 프린터로 되돌림(이어폰 연결은 놓음). 연결돼 있으면 connect는 선택 창 없이 그대로 쓴다
  await p.evaluate(() => { window.__bt.dev.gatt.connected = false; window.__bt.pickEar = true; });
  const kept = await p.evaluate(() => __ble.connect({ pick: true }).then(() => 'ok', e => e.message)).catch(e => String(e));
  { const s = await p.evaluate(() => ({ name: __ble.deviceName(), ear: window.__bt.ear.gatt.connected })); await p.evaluate(() => { window.__bt.pickEar = false; });
    ok('쓰던 프린터가 있을 때 이어폰 → 실패 알림 뒤 그 프린터로 되돌림·이어폰 놓음', /서비스 번호/.test(kept) && s.name === 'Bluetooth Printer' && !s.ear && (await p.evaluate(() => window.__bt.reqs)) === 3, kept.slice(0, 30) + ' ' + JSON.stringify(s)); }
  ok('되돌린 프린터로 다시 연결(선택 창 없이)', await p.evaluate(() => __ble.connect().then(() => __ble.connected() && window.__bt.reqs === 3, () => false)));
  ok('페이지 오류 없음(9)', p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();

  // ---- 10. 뽑은 뒤 3분 자리 비움: 열어 둔 창(처음 화면 확인·직원 설정)까지 닫고 지움 / 입력 없는 자리 비움도 직원 설정을 닫음 / USB는 연결 전 알림 안 띄움
  for (const kind of ['done', 'staff']) {
    p = await open(browser, { hash: '#kiosk', init: SET({ via: 'ble', media: 'cont', rollW: 80, chunk: 500, delay: 0, cfgv: 2 }, { paper: '80' }) });
    await p.waitForSelector('#kiosk:not([hidden])', { timeout: 60000 }); await p.waitForTimeout(600);
    await p.evaluate(() => { const b = document.getElementById('kStaff'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    await p.waitForSelector('#kfPrn', { timeout: 4000 }); await p.click('#kfPrn');
    await p.waitForFunction(() => /연결됨/.test(document.getElementById('kfMsg').textContent), null, { timeout: 5000 });
    await p.evaluate(() => { const m = document.getElementById('kModal'); if (m) m.remove(); });
    await toFinish(p, { name: '가상발송', phone: '010-0000-9999' });
    await p.click('#kPrintBtn');
    await p.waitForFunction(() => !!__kiosk.state().doneAt, null, { timeout: 20000 }).catch(() => null);
    await p.evaluate(() => { window.__idleMs = 4000; });
    if (kind === 'done') { await p.click('#kDone'); } else { await p.evaluate(() => { const b = document.getElementById('kStaff'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }); }
    await p.waitForSelector('#kModal', { timeout: 4000 });
    const before = await p.evaluate(() => __kiosk.state().entries.length);
    await p.waitForTimeout(5500);
    const s = await p.evaluate(() => ({ modal: !!document.getElementById('kModal'), start: !!document.getElementById('kStart'), n: __kiosk.state().entries.length }));
    ok('뽑은 뒤 3분 지우기: ' + (kind === 'done' ? '「처음 화면으로」 확인 창' : '직원 설정 창') + '까지 닫고 처음 화면', before === 2 && !s.modal && s.start && s.n === 0, JSON.stringify(s));
    ok('페이지 오류 없음(10' + kind + ')', p.errs.length === 0, p.errs.join(' / '));
    await p.context().close();
  }
  p = await open(browser, { hash: '#kiosk', init: SET({ via: 'ble', media: 'cont', rollW: 80, chunk: 500, delay: 0, cfgv: 2 }, { paper: '80', idle: 4 }) });
  await p.waitForSelector('#kiosk:not([hidden])', { timeout: 60000 }); await p.waitForTimeout(600);
  await p.evaluate(() => { const b = document.getElementById('kStaff'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await p.waitForSelector('#kfExit', { timeout: 4000 });
  await p.waitForTimeout(5000);
  ok('입력 없는 자리 비움: 열어 둔 직원 설정 창을 닫고 처음 화면', !(await p.$('#kModal')) && !!(await p.$('#kStart')));
  await p.context().close();
  // USB: 화면을 연 뒤 첫 분 자동 뽑기에 「프린터가 아직 연결되지 않았어요」를 띄우지 않는다(허용한 프린터는 선택 창 없이 붙음)
  const USB = (none) => [(none) => {
    localStorage.setItem('zipfinder.ble.v1', JSON.stringify({ via: 'usb', proto: 'tspl', usbId: none ? '' : '4660:22136', delay: 0, cfgv: 2 }));
    localStorage.setItem('zipfinder.kiosk.v1', JSON.stringify({ region: '전북특별자치도 정읍시', idle: 300, paper: 'lbl', autoPrint: true }));
    const u = window.__u = { reqs: 0, outs: 0, none: none };
    u.dev = { vendorId: 0x1234, productId: 0x5678, productName: 'Label USB', opened: false,
      configuration: { interfaces: [{ interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 7, endpoints: [{ direction: 'out', type: 'bulk', endpointNumber: 1 }] }] }] },
      open: async function () { this.opened = true; }, selectConfiguration: async () => { }, close: async function () { this.opened = false; }, claimInterface: async () => { },
      transferOut: async (ep, d) => { u.outs++; return { status: 'ok', bytesWritten: d.length }; } };
    Object.defineProperty(navigator, 'usb', { configurable: true, value: { requestDevice: async () => { u.reqs++; return u.dev; }, getDevices: async () => u.none ? [] : [u.dev], addEventListener() { } } });
  }, none];
  p = await open(browser, { hash: '#kiosk', init: USB(false) });
  await p.waitForSelector('#kiosk:not([hidden])', { timeout: 60000 }); await p.waitForTimeout(600);
  await toFinish(p, { name: '가상발송', phone: '010-0000-9999' });
  await p.waitForFunction(() => window.__u.outs > 0, null, { timeout: 15000 }).catch(() => null);
  { const u = await p.evaluate(() => ({ reqs: window.__u.reqs, outs: window.__u.outs })); const tt = await toasts(p);
    ok('USB 자동 뽑기: 「아직 연결되지 않았어요」 알림 없이 허용한 프린터로 선택 창 없이 뽑음', !/아직 연결되지 않았어요/.test(tt) && u.reqs === 0 && u.outs > 0, JSON.stringify(u) + ' ' + tt.slice(0, 60)); }
  ok('페이지 오류 없음(10usb)', p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();

  // ---- 11. 마지막 반박 검토에서 나온 것
  // (가) 쓰던 프린터에 다시 붙어 뽑는 사이 직원이 이어폰을 골라 실패해도 진행 중인 인쇄가 끊기지 않는다
  p = await open(browser, { hash: '#kiosk', init: SET({ via: 'ble', media: 'gap', chunk: 500, delay: 0, cfgv: 2 }, { paper: 'lbl', autoPrint: false }) });
  await p.waitForSelector('#kiosk:not([hidden])', { timeout: 60000 }); await p.waitForTimeout(600);
  await p.evaluate(() => { const b = document.getElementById('kStaff'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await p.waitForSelector('#kfPrn', { timeout: 4000 }); await p.click('#kfPrn');
  await p.waitForFunction(() => /연결됨/.test(document.getElementById('kfMsg').textContent), null, { timeout: 5000 });
  await p.evaluate(() => { document.getElementById('kModal').remove(); const bt = window.__bt; bt.dev.gatt.connected = false; bt.connMs = 400; bt.earMs = 1000; bt.writeMs = 3; bt.pickEar = true;
    const x = document.createElement('button'); x.id = 'tPickEar'; x.textContent = 'pick'; x.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;width:60px;height:40px';
    x.onclick = () => { __ble.connect({ pick: true }).catch(() => { }); }; document.body.appendChild(x); });
  await toFinish(p, { name: '가상발송', phone: '010-0000-9999' });
  const w0 = await p.evaluate(() => window.__bt.writes.length);
  await p.click('#kPrintBtn'); await p.waitForTimeout(100); await p.click('#tPickEar', { force: true });
  await p.waitForFunction(() => /다 됐어요|뽑지 못했어요/.test(document.getElementById('kFinMsg').textContent), null, { timeout: 30000 }).catch(() => null);
  { const s = await p.evaluate((w0) => ({ fin: document.getElementById('kFinMsg').textContent.slice(0, 20), writes: window.__bt.writes.length - w0, ear: window.__bt.ear.gatt.connected, name: __ble.deviceName(), reqs: window.__bt.reqs }), w0);
    ok('뽑는 사이 직원이 이어폰을 골라 실패해도 인쇄가 끝까지 나감·이어폰 놓음·쓰던 프린터 유지', /다 됐어요/.test(s.fin) && !s.ear && s.name === 'Bluetooth Printer' && s.reqs === 2, JSON.stringify(s)); }
  // 쓰던 프린터에 다시 붙는 사이 직원이 다른 프린터 B를 골라 B가 먼저 붙으면, 늦게 붙은 앞 프린터가 저장 이름을 덮지 않는다
  await p.evaluate(() => { const bt = window.__bt; __ble.release(); bt.dev.gatt.connected = false; bt.devB.gatt.connected = false; bt.connMs = 1200; bt.earMs = 0; bt.pickEar = false; bt.pickB = true; });
  await p.evaluate(() => { window.__pr = __ble.connect().then(() => 'ok', e => e.message); });
  await p.waitForTimeout(100); await p.click('#tPickEar', { force: true });
  await p.waitForTimeout(2000);
  { const s = await p.evaluate(() => ({ saved: __ble.get().name, now: __ble.deviceName() }));
    ok('다른 프린터 B를 고르면 저장 이름은 B(늦게 붙은 앞 프린터가 덮지 않음)', s.saved === 'Printer B' && s.now === 'Printer B', JSON.stringify(s)); }
  ok('페이지 오류 없음(11가)', p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();
  // (나) 프린터 연결 설정 창을 연 채 아무도 만지지 않으면: 직원 창(직원 설정·프린터 연결 설정)까지 닫고 평소대로(입력 없음 → 처음 화면, 뽑은 뒤 → 지움, 뽑기 전 → 「계속하시겠어요?」)
  for (const kind of ['nodata', 'done', 'data']) {
    p = await open(browser, { hash: '#kiosk', init: SET({ via: 'ble', media: 'cont', rollW: 80, chunk: 500, delay: 0, cfgv: 2 }, { paper: '80', idle: 4, autoPrint: false }) });
    await p.waitForSelector('#kiosk:not([hidden])', { timeout: 60000 }); await p.waitForTimeout(600);
    if (kind === 'done') {
      await p.evaluate(() => { const b = document.getElementById('kStaff'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
      await p.waitForSelector('#kfPrn', { timeout: 4000 }); await p.click('#kfPrn');
      await p.waitForFunction(() => /연결됨/.test(document.getElementById('kfMsg').textContent), null, { timeout: 5000 });
      await p.evaluate(() => { document.getElementById('kModal').remove(); });
      await toFinish(p, { name: '가상발송', phone: '010-0000-9999' });
      await p.click('#kPrintBtn'); await p.waitForFunction(() => !!__kiosk.state().doneAt, null, { timeout: 20000 }).catch(() => null);
      await p.evaluate(() => { window.__idleMs = 4000; });
    }
    if (kind === 'data') { await toFinish(p, { name: '가상발송', phone: '010-0000-9999' }); await p.evaluate(() => { window.__idleMs2 = 4000; }); }
    await p.evaluate(() => { const b = document.getElementById('kStaff'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    await p.waitForSelector('#kfExit', { timeout: 4000 });
    await p.locator('#kModalBtns button', { hasText: '프린터 연결 설정' }).click();
    await p.waitForSelector('#bleSet', { timeout: 4000 });
    await p.waitForTimeout(5500);
    const s = await p.evaluate(() => ({ bleSet: !!document.getElementById('bleSet'), staff: !!document.getElementById('kfExit'), left: !!document.getElementById('kLeft'), start: !!document.getElementById('kStart'), n: __kiosk.state().entries.length }));
    const want = kind === 'data' ? (!s.bleSet && !s.staff && s.left && s.n === 2) : (!s.bleSet && !s.staff && s.start && s.n === 0);
    ok('프린터 연결 설정을 연 채 자리 비움(' + ({ nodata: '입력 없음 → 처음 화면', done: '뽑은 뒤 → 지움', data: '뽑기 전 → 「계속하시겠어요?」' })[kind] + '): 직원 창까지 닫음·오류 없음', want && p.errs.length === 0, JSON.stringify(s) + ' ' + p.errs.join(' / '));
    await p.context().close();
  }
  // (다) 어르신 화면을 연 직후 직원 안내 창에서 「프린터 연결」을 누르고 선택 창이 오래 걸려도, 자리 비움이 창을 닫지 않아 실패 까닭이 보임
  p = await open(browser, { init: SET({ via: 'ble', media: 'cont', rollW: 80, chunk: 500, delay: 0, cfgv: 2 }, { paper: '80', idle: 4 }) });
  await p.click('#btnKiosk'); await p.waitForSelector('#kModal', { timeout: 5000 });
  await p.evaluate(() => { window.__bt.reqMs = 6000; window.__bt.reqErr = ['NotFoundError', 'User cancelled the requestDevice() chooser.']; });
  await p.click('#kModal button.k-btn.pri');
  await p.waitForTimeout(7000);
  { const s = await p.evaluate(() => ({ modal: !!document.getElementById('kModal'), msg: (document.getElementById('kPrnMsg') || {}).textContent || '' }));
    ok('직원 안내 창 「프린터 연결」 중 자리 비움: 창이 남고 실패 까닭 표시', s.modal && /연결하지 못했어요/.test(s.msg), JSON.stringify(s).slice(0, 100)); }
  // 같은 경우 직원 설정 맨 위 「프린터 연결」(kfPrn)도 오류 없이 결과 표시
  await p.evaluate(() => { const m = document.getElementById('kModal'); if (m) m.remove(); const b = document.getElementById('kStaff'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await p.waitForSelector('#kfPrn', { timeout: 4000 }); await p.click('#kfPrn');
  await p.waitForTimeout(7000);
  ok('직원 설정 「프린터 연결」 중 자리 비움: 창이 남고 결과 표시·오류 없음', p.errs.length === 0 && /연결 실패/.test((await p.textContent('#kfMsg').catch(() => '')) || ''), p.errs.join(' / '));
  await p.context().close();
  // 선택 창이 끝나지 않아도 자리 비움은 한 번만 미루고 직원 창을 닫음(직원이 선택 창을 연 채 떠난 경우)
  p = await open(browser, { init: SET({ via: 'ble', media: 'cont', rollW: 80, chunk: 500, delay: 0, cfgv: 2 }, { paper: '80', idle: 4 }) });
  await p.click('#btnKiosk'); await p.waitForSelector('#kModal', { timeout: 5000 });
  await p.evaluate(() => { window.__bt.reqMs = 1e9; });
  await p.click('#kModal button.k-btn.pri');
  await p.waitForTimeout(6000);
  const half = await p.evaluate(() => !!document.getElementById('kModal'));
  await p.waitForTimeout(4000);
  ok('선택 창이 끝나지 않아도 자리 비움은 한 번만 미룸(4초 뒤 창 남음 → 8초 뒤 닫고 처음 화면)', half && !(await p.$('#kModal')) && !!(await p.$('#kStart')) && p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();
  // (라) USB에 허용한 프린터가 없는 날 자동 뽑기: 실패 창 위에 「창구에 가져가세요」 알림이 겹치지 않음
  p = await open(browser, { hash: '#kiosk', init: USB(true) });
  await p.waitForSelector('#kiosk:not([hidden])', { timeout: 60000 }); await p.waitForTimeout(600);
  await toFinish(p, { name: '가상발송', phone: '010-0000-9999' });
  await p.waitForSelector('#kModal', { timeout: 8000 }).catch(() => null);
  { const lab = await p.evaluate(() => { const b = document.querySelectorAll('#kModalBtns button')[1]; return b ? b.textContent : ''; }); const tt = await toasts(p); const u = await p.evaluate(() => window.__u.reqs);
    ok('USB 허용 프린터 없음 자동 뽑기: 실패 창(「직원: 프린터 고르고 뽑기」)만, 「창구에 가져가세요」 알림 없음, 선택 창 0번', /프린터 고르고 뽑기/.test(lab) && !/창구에 가져가세요/.test(tt) && u === 0, lab + ' | ' + tt.slice(0, 60)); }
  ok('페이지 오류 없음(11라)', p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();

  // ---- 12. 자리 비움 마무리(선택 창과 겹칠 때)
  const PICKBTN = () => { const x = document.createElement('button'); x.id = 'tPick'; x.textContent = 'pick'; x.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;width:60px;height:40px';
    x.onclick = () => { __ble.connect({ pick: true }).catch(() => { }); }; document.body.appendChild(x); };
  // (가) 「계속하시겠어요?」 사이에 늦게 뜬 실패 창이 확인 창을 덮어도 자리 비움을 다시 걸어 결국 지움
  p = await open(browser, { hash: '#kiosk', init: SET({ via: 'ble', media: 'cont', rollW: 80, chunk: 500, delay: 0, cfgv: 2 }, { paper: '80', idle: 4, autoPrint: false }) });
  await p.waitForSelector('#kiosk:not([hidden])', { timeout: 60000 }); await p.waitForTimeout(600);
  await toFinish(p, { name: '가상발송', phone: '010-0000-9999' });
  await p.click('#kPrintBtn'); await p.waitForSelector('#kModal', { timeout: 5000 });
  await p.evaluate(() => { window.__idleMs2 = 4000; window.__bt.reqMs = 9000; window.__bt.reqErr = ['NotFoundError', 'User cancelled the requestDevice() chooser.']; });
  await longPress(p, (await p.$$('#kModalBtns button'))[1], 2200);
  await p.waitForTimeout(15500);
  { const s = await p.evaluate(() => ({ left: !!document.getElementById('kLeft'), n: __kiosk.state().entries.length }));
    ok('확인 창 사이에 늦게 뜬 실패 창이 덮어도 자리 비움을 다시 걸어 「계속하시겠어요?」가 다시 뜸', s.left && s.n === 2, JSON.stringify(s)); }
  ok('페이지 오류 없음(12가)', p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();
  // (나) 뽑은 뒤 3분 지우기는 선택 창이 열려 있어도 미루지 않음
  p = await open(browser, { hash: '#kiosk', init: SET({ via: 'ble', media: 'cont', rollW: 80, chunk: 500, delay: 0, cfgv: 2 }, { paper: '80', autoPrint: false }) });
  await p.waitForSelector('#kiosk:not([hidden])', { timeout: 60000 }); await p.waitForTimeout(600);
  await p.evaluate(() => { const b = document.getElementById('kStaff'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await p.waitForSelector('#kfPrn', { timeout: 4000 }); await p.click('#kfPrn');
  await p.waitForFunction(() => /연결됨/.test(document.getElementById('kfMsg').textContent), null, { timeout: 5000 });
  await p.evaluate(() => { document.getElementById('kModal').remove(); });
  await toFinish(p, { name: '가상발송', phone: '010-0000-9999' });
  await p.click('#kPrintBtn'); await p.waitForFunction(() => !!__kiosk.state().doneAt, null, { timeout: 20000 }).catch(() => null);
  await p.evaluate(PICKBTN);
  await p.evaluate(() => { window.__idleMs = 4000; window.__bt.dev.gatt.connected = false; window.__bt.reqMs = 1e9; });
  await p.click('#tPick', { force: true });
  await p.waitForTimeout(5500);
  { const s = await p.evaluate(() => ({ picking: __ble.picking(), n: __kiosk.state().entries.length, start: !!document.getElementById('kStart') }));
    ok('뽑은 뒤 3분 지우기는 선택 창이 열려 있어도 미루지 않음', s.picking === 1 && s.n === 0 && s.start, JSON.stringify(s)); }
  await p.context().close();
  // (다) 프린터 연결 설정 창 안의 「프린터 연결」 선택 창도 한 번 미루고, 창이 닫힌 뒤 온 결과는 알림으로
  p = await open(browser, { hash: '#kiosk', init: SET({ via: 'ble', media: 'cont', rollW: 80, chunk: 500, delay: 0, cfgv: 2 }, { paper: '80', idle: 4 }) });
  await p.waitForSelector('#kiosk:not([hidden])', { timeout: 60000 }); await p.waitForTimeout(600);
  await p.evaluate(() => { const b = document.getElementById('kStaff'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  await p.waitForSelector('#kfExit', { timeout: 4000 });
  await p.locator('#kModalBtns button', { hasText: '프린터 연결 설정' }).click();
  await p.waitForSelector('#bleSet', { timeout: 4000 });
  await p.evaluate(() => { window.__bt.reqMs = 10000; });
  await p.click('#bsConn');
  await p.waitForTimeout(6000);
  const keptSet = await p.evaluate(() => !!document.getElementById('bleSet'));
  await p.waitForTimeout(5500);
  { const s = await p.evaluate(() => ({ bleSet: !!document.getElementById('bleSet'), start: !!document.getElementById('kStart'), conn: __ble.connected() })); const tt = await toasts(p);
    ok('프린터 연결 설정의 선택 창도 한 번 미룸 → 닫힌 뒤 온 결과는 「(직원 확인) 프린터 연결 설정: 연결됨」 알림', keptSet && !s.bleSet && s.start && s.conn && /프린터 연결 설정: 연결됨/.test(tt) && p.errs.length === 0, JSON.stringify(s) + ' ' + tt.slice(0, 60) + ' ' + p.errs.join(' / ')); }
  await p.context().close();
  // (라) 처음 고르는 사이 다시 눌러 이어폰을 골라 실패하면, 먼저 붙은 프린터로 되돌리며 그 이름을 저장
  p = await open(browser, { init: SET({ via: 'ble', media: 'cont', rollW: 80, chunk: 500, delay: 0, cfgv: 2 }, { paper: '80' }) });
  await p.evaluate(PICKBTN);
  await p.evaluate(() => { const bt = window.__bt; bt.connMs = 300; bt.earMs = 2500; });
  await p.click('#tPick', { force: true }); await p.waitForTimeout(150);
  await p.evaluate(() => { window.__bt.pickEar = true; }); await p.click('#tPick', { force: true });
  await p.waitForTimeout(3300);
  { const s = await p.evaluate(() => ({ saved: __ble.get().name, now: __ble.deviceName(), conn: __ble.connected(), ear: window.__bt.ear.gatt.connected }));
    ok('처음 고르는 사이 이어폰을 골라 실패 → 먼저 붙은 프린터로 되돌리고 이름 저장', s.saved === 'Bluetooth Printer' && s.now === 'Bluetooth Printer' && s.conn && !s.ear, JSON.stringify(s)); }
  ok('페이지 오류 없음(12라)', p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();

  // ---- 6. 엑셀 파일 정보 작성자 = 물어물어
  p = await open(browser, {});
  await p.evaluate(() => { window.__sh.passDl = true; });   // 이 시험은 실제 내려받기를 받는다
  const b64 = fs.readFileSync(INPUT).toString('base64');
  await p.evaluate(([b64, name]) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const f = new File([u], name); const dt = new DataTransfer(); dt.items.add(f); const el = document.querySelector('#fileInput'); el.files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true })); }, [b64, 'addr.xlsx']);
  await p.waitForFunction(() => !document.querySelector('#step2').hidden, null, { timeout: 60000 });
  await p.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 60000 });
  await p.click('#btnRun');
  await p.waitForFunction(() => !document.querySelector('#step3').hidden && document.querySelectorAll('#resultTable tbody tr').length > 0, null, { timeout: 120000 });
  await p.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 120000 });
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('#btnDownload')]);
  const f = path.join(OUT, 'author__' + dl.suggestedFilename()); await dl.saveAs(f);
  const core = cp.execFileSync('python3', ['-I', '-c', 'import zipfile,sys;print(zipfile.ZipFile(sys.argv[1]).read("docProps/core.xml").decode())', f]).toString();
  ok('엑셀 작성자 = 물어물어(제작자 이름 아님)', /<dc:creator>물어물어<\/dc:creator>/.test(core) && !/<dc:creator>이희재/.test(core), (core.match(/<dc:creator>[^<]*/) || [''])[0]);
  ok('페이지 오류 없음(6)', p.errs.length === 0, p.errs.join(' / '));
  await p.context().close();

  await browser.close();
  console.log('\n통과 ' + pass + ' · 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
