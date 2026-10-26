// 물어물어 v1.8(v1.11 갱신) USB(OTG·WebUSB) 직접 인쇄 시험 — 가짜 USB 프린터(navigator.usb 대역)로 보낸 바이트를 받아 스티커 그림을 되살려 확인한다.
// 사용: node ble_test.js <출품본.html> <주소록.xlsx> <결과 폴더>   (가상 자료만)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const [HTML, INPUT, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x) => { (c ? pass++ : fail++); console.log((c ? '통과  ' : '실패  ') + n + (x ? ' · ' + x : '')); };

function jobs(writes) { // 쓰기 조각을 이어 붙여 SIZE 로 시작하는 일(스티커 한 장)들로 나눈다
  const all = Buffer.concat(writes.map(w => Buffer.from(w))); const out = []; let pos = 0;
  while (true) { const i = all.indexOf('SIZE ', pos, 'latin1'); if (i < 0) break; const j = all.indexOf('SIZE ', i + 5, 'latin1'); out.push(all.slice(i, j < 0 ? all.length : j)); pos = j < 0 ? all.length : j; }
  return out;
}
function tsplImage(buf, file) { // TSPL 한 장 → PNG (0 = 검정)
  const head = buf.toString('latin1', 0, 200); const m = head.match(/SIZE ([\d.]+) mm,([\d.]+) mm\r\nGAP ([\d.]+) mm,0 mm\r\nDIRECTION (\d)\r\nCLS\r\nBITMAP 0,0,(\d+),(\d+),0,/);
  if (!m) return null; const wb = +m[5], h = +m[6], off = m[0].length; const data = buf.slice(off, off + wb * h);
  const tail = buf.toString('latin1', off + wb * h, off + wb * h + 20);
  const pgm = Buffer.alloc(wb * 8 * h); for (let y = 0; y < h; y++) for (let x = 0; x < wb * 8; x++) { const bit = (data[y * wb + (x >> 3)] >> (7 - (x & 7))) & 1; pgm[y * wb * 8 + x] = bit ? 255 : 0; }
  fs.writeFileSync(file + '.pgm', Buffer.concat([Buffer.from(`P5\n${wb * 8} ${h}\n255\n`), pgm]));
  cp.execFileSync('python3', ['-I', '-c', `from PIL import Image;Image.open(r"${file}.pgm").save(r"${file}.png")`]);
  return { wmm: +m[1], hmm: +m[2], gap: +m[3], wb, h, tail, size: data.length };
}
async function open(browser, mock, extra) {
  const ctx = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage(); page.errs = [];
  page.on('pageerror', e => page.errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') page.errs.push(m.text()); });
  await page.addInitScript(mock); if (extra) await page.addInitScript(extra);
  await page.goto('file://' + HTML);
  await page.waitForFunction(() => /구간/.test(document.querySelector('#dbInfo').textContent), null, { timeout: 60000 });
  await page.waitForFunction(() => !/확인 중/.test(document.querySelector('#intChip').textContent), null, { timeout: 30000 });
  if (await page.isVisible('#btnPrivacyOk')) await page.click('#btnPrivacyOk');
  return page;
}

// 가짜 USB 프린터: 인터페이스 0 = 오디오 아닌 제조사(255, 끝점 없음), 인터페이스 1 = 프린터(7, bulk OUT 2번). opt: {noDev, claimErr, stallOnce, saved, dropAfter}
const MOCK = (opt) => `(() => {
  const opt = ${JSON.stringify(opt || {})};
  window.__w = []; window.__chooser = 0; window.__claimed = []; window.__clear = 0; window.__open = 0; let stalled = false, n = 0;
  const ep = (num, dir) => ({ endpointNumber: num, direction: dir, type: 'bulk', packetSize: 64 });
  const dev = { productName: 'Mock-XP-4B', vendorId: 0x2d37, productId: 0x0123, opened: false, configuration: null,
    open: async function () { dev.opened = true; window.__open++; }, close: async function () { dev.opened = false; },
    selectConfiguration: async function () { dev.configuration = { interfaces: [
      { interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 255, endpoints: [ep(1, 'in')] }] },
      { interfaceNumber: 1, alternates: [{ alternateSetting: 0, interfaceClass: 7, endpoints: [ep(2, 'out'), ep(2, 'in')] }] }] }; },
    claimInterface: async function (i) { if (opt.claimErr) { const e = new Error('The requested interface implements a protected class.'); e.name = 'SecurityError'; throw e; } window.__claimed.push(i); },
    selectAlternateInterface: async function () {},
    clearHalt: async function () { window.__clear++; },
    transferOut: async function (e, d) { if (e !== 2) { throw new Error('wrong endpoint ' + e); } n++;
      if (opt.stallOnce && !stalled) { stalled = true; return { status: 'stall', bytesWritten: 0 }; }
      if (opt.dropAfter && n > opt.dropAfter) { dev.opened = false; throw new Error('NetworkError: The device was disconnected.'); }
      window.__w.push(Array.from(d)); return { status: 'ok', bytesWritten: d.length }; } };
  if (opt.saved) { dev.configuration = null; }
  Object.defineProperty(navigator, 'usb', { configurable: true, value: { addEventListener() {},
    getDevices: async () => (opt.saved ? [dev] : []),
    requestDevice: async (o) => { window.__chooser++; window.__opts = o; if (opt.noDev) { const e = new Error('No device selected.'); e.name = 'NotFoundError'; throw e; } return dev; } } });
})();`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--allow-file-access-from-files'] });
  const entries = `[
    { name: '가상일', phone: '010-0000-1111', zip: '56180', addr1: '전북특별자치도 정읍시 충정로 234-1', addr2: '정읍시청 3층', check: false },
    { name: '가상이', phone: '', zip: '56204', addr1: '전북특별자치도 정읍시 시기4길 42', addr2: '101동 1004호(시기동,가상아파트)', check: true }]`;
  // ---- 1. 어르신 화면: USB 로 스티커 2장
  let page = await open(browser, MOCK());
  ok('USB 지원(가짜 장치)이면 supported', await page.evaluate(() => { __ble.set({ via: 'usb' }); return __ble.supported(); }));
  await page.evaluate(() => { localStorage.setItem('zipfinder.ble.v1', JSON.stringify({ via: 'usb' })); const k = JSON.parse(localStorage.getItem('zipfinder.kiosk.v1') || '{}'); k.paper = 'lbl'; k.lblW = 100; k.lblH = 45; localStorage.setItem('zipfinder.kiosk.v1', JSON.stringify(k)); });
  await page.click('#btnKiosk'); await page.waitForSelector('#kiosk:not([hidden])');
  await page.evaluate((E) => { const st = __kiosk.state(); eval('st.entries.push(...' + E + ')'); st.sender = { name: '가상발송', phone: '010-0000-9999', zip: '56180', addr1: '전북특별자치도 정읍시 충정로 234-1', addr2: '' }; __kiosk.finish(); }, entries);
  await page.waitForSelector('#kPrintBtn');
  // v1.11: 어르신 뽑기는 선택 창을 열지 않으므로 직원이 먼저 연결한다
  await page.evaluate(() => { const b = document.createElement('button'); b.id = 'tStaffConn'; b.textContent = '직원 연결'; b.style.cssText = 'position:fixed;left:0;top:0;z-index:9999'; b.onclick = () => { __ble.connect({ pick: true }).then(() => { window.__sc = 'ok'; }, e => { window.__sc = e.message; }); }; document.body.appendChild(b); });
  await page.click('#tStaffConn'); await page.waitForFunction(() => window.__sc, null, { timeout: 5000 });
  await page.click('#kPrintBtn');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.k-toast,#kModal')).some(e => /스티커 2장을 보냈어요|뽑지 못했/.test(e.textContent)), null, { timeout: 20000 });
  ok('토스트 「스티커 2장을 보냈어요」', true);
  const w1 = await page.evaluate(() => window.__w); const js = jobs(w1);
  ok('선택 창 요청: filters 빈 목록(모든 USB 기기)', await page.evaluate(() => Array.isArray(window.__opts.filters) && window.__opts.filters.length === 0));
  ok('프린터 인터페이스(1번, 클래스 7)만 점유', JSON.stringify(await page.evaluate(() => window.__claimed)) === '[1]');
  ok('스티커 2장 전송', js.length === 2, js.length + '장 · 쓰기 ' + w1.length + '회 · 최대 조각 ' + Math.max.apply(null, w1.map(w => w.length)));
  const imgs = js.map((b, i) => tsplImage(b, path.join(OUT, 'USB_' + i)));
  ok('TSPL 100×45mm · 800×360 비트맵', imgs[0] && imgs[0].wmm === 100 && imgs[0].hmm === 45 && imgs[0].wb === 100 && imgs[0].h === 360, JSON.stringify(imgs[0]));
  ok('각 장이 PRINT 로 끝남', imgs.every(i => i && /PRINT 1,1/.test(i.tail)));
  ok('선택 창은 한 번만', (await page.evaluate(() => window.__chooser)) === 1);
  ok('저장된 USB 식별값', await page.evaluate(() => __ble.get().usbId === '11575:291'), await page.evaluate(() => __ble.get().usbId));
  ok('오류 없음(어르신 화면)', page.errs.length === 0, page.errs.slice(0, 2).join('|'));
  await page.context().close();
  // ---- 2. 이미 허용된 프린터는 선택 창 없이 다시 붙음
  page = await open(browser, MOCK({ saved: true }));
  const r2 = await page.evaluate(async () => { __ble.set({ via: 'usb', usbId: '11575:291' }); const n = await __ble.print([{ zip: '12345', name: '시험', addr1: '전북 정읍시 충정로 1' }], 100, 45); return { n, ch: window.__chooser, name: __ble.deviceName() }; });
  ok('허용된 프린터는 선택 창 없이 연결', r2.n === 1 && r2.ch === 0 && r2.name === 'Mock-XP-4B', JSON.stringify(r2));
  await page.context().close();
  // ---- 3. 프린터 고르기 취소
  page = await open(browser, MOCK({ noDev: true }));
  const r3 = await page.evaluate(async () => { __ble.set({ via: 'usb' }); try { await __ble.print([{ zip: '1', name: 'a', addr1: 'b' }], 100, 45); return 'no error'; } catch (e) { return e.message; } });
  ok('고르지 않으면 안내 문구', /프린터를 고르지 않았어요/.test(r3), r3);
  await page.context().close();
  // ---- 4. 막힌 장치(보호 클래스)
  page = await open(browser, MOCK({ claimErr: true }));
  const r4 = await page.evaluate(async () => { __ble.set({ via: 'usb' }); try { await __ble.print([{ zip: '1', name: 'a', addr1: 'b' }], 100, 45); return 'no error'; } catch (e) { return e.message; } });
  ok('보호 클래스 거부 → 알아듣는 안내', /USB 프린터를 열 수 없어요/.test(r4), r4);
  await page.context().close();
  // ---- 5. 전송 중 막힘(stall) 복구 · 중간에 뽑힘
  page = await open(browser, MOCK({ stallOnce: true }));
  const r5 = await page.evaluate(async () => { __ble.set({ via: 'usb' }); const n = await __ble.print([{ zip: '12345', name: '시험', addr1: '전북 정읍시 충정로 1' }], 100, 45); return { n, clear: window.__clear, bytes: window.__w.reduce((a, w) => a + w.length, 0) }; });
  ok('stall 이면 clearHalt 후 같은 조각 다시 보냄', r5.n === 1 && r5.clear === 1 && r5.bytes > 36000, JSON.stringify(r5));
  await page.context().close();
  page = await open(browser, MOCK({ dropAfter: 1 }));
  const r5b = await page.evaluate(async () => { __ble.set({ via: 'usb' }); try { await __ble.print([{ zip: '12345', name: '시험', addr1: '전북 정읍시 충정로 1' }, { zip: '2', name: 'b', addr1: 'c' }], 100, 45); return 'no error'; } catch (e) { return e.message + ' | done=' + e.done; } });
  ok('전송 중 케이블이 빠지면 오류 안내', /연결이 끊겼|disconnected/.test(r5b), r5b);
  await page.context().close();
  // ---- 6. 설정 창: USB 선택 → 연결 → 시험 인쇄(80×50) → 저장
  page = await open(browser, MOCK());
  await page.evaluate(() => { __ble.openSettings({ size: () => [80, 50] }); });
  await page.waitForSelector('#bleSet');
  await page.selectOption('#bsVia', 'usb');
  await page.click('#bsConn'); await page.waitForFunction(() => /연결됨: Mock-XP-4B/.test(document.querySelector('#bsMsg').textContent));
  ok('설정 창에서 USB 프린터 연결', true);
  await page.click('#bsTest'); await page.waitForFunction(() => /보냈어요/.test(document.querySelector('#bsMsg').textContent), null, { timeout: 15000 });
  const j6 = jobs(await page.evaluate(() => window.__w)); const t6 = j6[0] && tsplImage(j6[0], path.join(OUT, 'USB_시험인쇄'));
  ok('시험 인쇄 1장 · 80×50mm', j6.length === 1 && t6 && t6.wmm === 80 && t6.hmm === 50, JSON.stringify(t6));
  await page.click('#bsSave'); ok('저장되어 설정 유지', await page.evaluate(() => __ble.get().via === 'usb'));
  ok('오류 없음(설정 창)', page.errs.length === 0, page.errs.slice(0, 2).join('|'));
  await page.context().close();
  // ---- 7. 직원 라벨 창: 롤 스티커 → USB
  page = await open(browser, MOCK());
  const b64 = fs.readFileSync(INPUT).toString('base64');
  await page.evaluate(([b64, name]) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const f = new File([u], name); const dt = new DataTransfer(); dt.items.add(f); const el = document.querySelector('#fileInput'); el.files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true })); }, [b64, 'addr.xlsx']);
  await page.waitForFunction(() => !document.querySelector('#step2').hidden, null, { timeout: 60000 });
  await page.click('#btnRun');
  await page.waitForFunction(() => !document.querySelector('#step3').hidden && document.querySelectorAll('#resultTable tbody tr').length > 0, null, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 120000 });
  await page.evaluate(() => __ble.set({ via: 'usb' }));
  await page.click('#btnLabel'); await page.waitForSelector('#labelDlg[open]');
  await page.selectOption('#lbKind', 'roll'); await page.selectOption('#lbRollP', '100,45'); await page.waitForTimeout(300);
  ok('롤 스티커 + USB 에서 「프린터로 바로 인쇄」 단추가 보임', await page.isVisible('#btnLabelBle') && (await page.textContent('#btnLabelBle')).trim() === '프린터로 바로 인쇄');
  const nRows = await page.$$eval('#labelArea .sheet.roll', xs => xs.length);
  await page.click('#btnLabelBle'); await page.waitForFunction(() => /프린터로 보냈습니다|실패/.test(document.querySelector('#lbInfo').textContent), null, { timeout: 60000 });
  const j7 = jobs(await page.evaluate(() => window.__w));
  ok('주소록 줄 수만큼 USB 전송', j7.length === nRows && nRows >= 6, j7.length + '장 / ' + nRows + '줄');
  ok('오류 없음(직원 라벨 창)', page.errs.length === 0, page.errs.slice(0, 2).join('|'));
  await page.context().close();
  // ---- 8. USB 없는 브라우저: 단추 동작·기존 인쇄 창
  page = await open(browser, 'Object.defineProperty(navigator,"usb",{configurable:true,value:undefined});');
  ok('USB 없으면 supported=false', await page.evaluate(() => { __ble.set({ via: 'usb' }); return __ble.supported() === false && __ble.direct() === false; }));
  await page.evaluate(() => { const k = JSON.parse(localStorage.getItem('zipfinder.kiosk.v1') || '{}'); k.paper = 'lbl'; localStorage.setItem('zipfinder.kiosk.v1', JSON.stringify(k)); });
  await page.click('#btnKiosk'); await page.waitForSelector('#kiosk:not([hidden])');
  await page.evaluate(() => { const st = __kiosk.state(); st.entries.push({ name: '가상일', phone: '', zip: '56180', addr1: '전북특별자치도 정읍시 충정로 234-1', addr2: '', check: false }); window.__pr = 0; window.print = () => { window.__pr++; }; __kiosk.finish(); });
  await page.click('#kPrintBtn'); await page.waitForFunction(() => window.__pr === 1, null, { timeout: 5000 });
  ok('USB 를 못 쓰면 기존 인쇄 창으로 대신 인쇄', true);
  ok('오류 없음(USB 없음)', page.errs.length === 0, page.errs.slice(0, 2).join('|'));
  await browser.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`); process.exit(fail ? 1 : 0);
})();
