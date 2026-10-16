// 물어물어 v1.7 블루투스(BLE) 직접 인쇄 시험 — 가짜 BLE 프린터(navigator.bluetooth 대역)로 보낸 바이트를 받아 스티커 그림을 되살려 확인한다.
// 사용: node ble_test.js <출품본.html> <주소록.xlsx> <결과 폴더>   (가상 자료만)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const [HTML, INPUT, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x) => { (c ? pass++ : fail++); console.log((c ? '통과  ' : '실패  ') + n + (x ? ' · ' + x : '')); };
// 가짜 BLE 프린터: 서비스 ffe0 / 특성 ffe1(쓰기), maxWrite 바이트를 넘으면 오류를 낸다
const MOCK = (maxWrite, nodev) => `(() => {
  window.__w = []; window.__opts = null; window.__connects = 0;
  const ch = { uuid: 'ffe1', properties: { write: true, writeWithoutResponse: true },
    writeValueWithoutResponse: async (v) => { if (v.length > ${maxWrite}) { throw new Error('NetworkError: GATT operation failed (too large)'); } window.__w.push(Array.from(v)); },
    writeValue: async (v) => { window.__w.push(Array.from(v)); } };
  const svc = { uuid: 'ffe0', getCharacteristics: async () => [ch] };
  const dev = { name: 'MockLabel-BLE', addEventListener() {}, gatt: { connected: false, connect: async function () { dev.gatt.connected = true; window.__connects++; return dev.gatt; }, disconnect() { dev.gatt.connected = false; }, getPrimaryServices: async () => [svc] } };
  Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: async (o) => { window.__opts = o; ${nodev ? "const e = new Error('User cancelled the requestDevice() chooser.'); e.name = 'NotFoundError'; throw e;" : 'return dev;'} } } });
})();`;
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
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--allow-file-access-from-files'] });
  // ---- 1. 어르신 화면: 블루투스로 스티커 3장
  let page = await open(browser, MOCK(512));
  ok('무결성 · 블루투스 모듈 포함', /원본/.test(await page.textContent('#intChip')));
  ok('__ble 지원(가짜 장치)', await page.evaluate(() => __ble.supported()));
  await page.evaluate(() => { localStorage.setItem('zipfinder.ble.v1', JSON.stringify({ via: 'ble', chunk: 500, delay: 0 })); const k = JSON.parse(localStorage.getItem('zipfinder.kiosk.v1') || '{}'); k.paper = 'lbl'; k.lblW = 100; k.lblH = 45; localStorage.setItem('zipfinder.kiosk.v1', JSON.stringify(k)); });
  await page.click('#btnKiosk'); await page.waitForSelector('#kiosk:not([hidden])');
  await page.evaluate(() => { const st = __kiosk.state(); st.entries.push(
    { name: '가상일', phone: '010-0000-1111', zip: '56180', addr1: '전북특별자치도 정읍시 충정로 234-1', addr2: '정읍시청 3층', check: false },
    { name: '가상이', phone: '', zip: '56204', addr1: '전북특별자치도 정읍시 시기4길 42', addr2: '101동 1004호(시기동,가상아파트)', check: true },
    { name: '가상삼', phone: '010-0000-3333', zip: '58324', addr1: '전남광주통합특별시 나주시 빛가람로 760', addr2: '한국전력공사 본사 신관 12층 경영지원처 우편실 가상팀 아주긴이름의부서', check: false });
    st.sender = { name: '가상발송', phone: '010-0000-9999', zip: '56180', addr1: '전북특별자치도 정읍시 충정로 234-1', addr2: '' }; __kiosk.finish(); });
  await page.waitForSelector('#kPrintBtn');
  ok('마침 화면 단추 「주소 스티커 뽑기」', (await page.textContent('#kPrintBtn')).trim() === '주소 스티커 뽑기');
  await page.click('#kPrintBtn');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.k-toast,#kModal')).some(e => /스티커 3장을 보냈어요|뽑지 못했/.test(e.textContent)), null, { timeout: 20000 });
  ok('토스트 「스티커 3장을 보냈어요」', true);
  const w1 = await page.evaluate(() => window.__w); const opts = await page.evaluate(() => window.__opts);
  const js = jobs(w1);
  ok('선택 창 요청: 모든 기기 + 서비스 번호 목록', opts && opts.acceptAllDevices === true && opts.optionalServices.length >= 8, opts && opts.optionalServices.length + '개');
  ok('스티커 3장이 전송됨', js.length === 3, js.length + '장 · 쓰기 ' + w1.length + '회');
  const imgs = js.map((b, i) => tsplImage(b, path.join(OUT, '블루투스_' + i)));
  ok('TSPL 머리말 100×45mm · 203dpi 비트맵(800×360)', imgs[0] && imgs[0].wmm === 100 && imgs[0].hmm === 45 && imgs[0].wb === 100 && imgs[0].h === 360, JSON.stringify(imgs[0]));
  ok('각 장이 PRINT 로 끝남', imgs.every(i => i && /PRINT 1,1/.test(i.tail)));
  ok('연결은 한 번만', (await page.evaluate(() => window.__connects)) === 1);
  ok('오류 없음(어르신 화면)', page.errs.length === 0, page.errs.slice(0, 2).join('|'));
  await page.context().close();
  // ---- 2. 전송 크기 제한(60바이트 넘으면 오류)인 프린터: 크기를 자동으로 줄여 끝까지 보냄
  page = await open(browser, MOCK(60));
  const r2 = await page.evaluate(async () => { localStorage.setItem('zipfinder.ble.v1', JSON.stringify({ chunk: 500, delay: 0 })); try { const n = await __ble.print([{ zip: '12345', name: '시험', addr1: '전북 정읍시 충정로 1', addr2: '' }], 100, 45); return { n, maxChunk: Math.max.apply(null, window.__w.map(w => w.length)), cnt: window.__w.length }; } catch (e) { return { err: e.message }; } });
  ok('큰 조각이 막히면 20바이트까지 줄여 전송', r2.n === 1 && r2.maxChunk <= 60, JSON.stringify(r2));
  await page.context().close();
  // ---- 3. 프린터 고르기 취소 → 안내 문구
  page = await open(browser, MOCK(512, true));
  const r3 = await page.evaluate(async () => { try { await __ble.print([{ zip: '1', name: 'a', addr1: 'b' }], 100, 45); return 'no error'; } catch (e) { return e.message; } });
  ok('프린터를 고르지 않으면 안내 문구', /프린터를 고르지 않았어요/.test(r3), r3);
  // ---- 4. ESC/POS 래스터·색 반전·회전
  const r4 = await page.evaluate(() => {
    __ble.set({ proto: 'escpos', dpi: 203, invert: false, rotate: 0, after: 'ff' });
    const a = __ble.encode({ zip: '12345', name: '시험', addr1: '전북 정읍시 충정로 1', addr2: '', no: '1' }, 80, 50);
    __ble.set({ proto: 'tspl', invert: false, rotate: 90 });
    const b = __ble.encode({ zip: '12345', name: '시험', addr1: '전북 정읍시 충정로 1', addr2: '', no: '1' }, 100, 45);
    const head = String.fromCharCode.apply(null, Array.from(b.slice(0, 40)));
    __ble.set({ rotate: 0, invert: true });
    const c = __ble.encode({ zip: '12345', name: '시험', addr1: '전북 정읍시 충정로 1', addr2: '', no: '1' }, 100, 45);
    __ble.set({ invert: false });
    const d = __ble.encode({ zip: '12345', name: '시험', addr1: '전북 정읍시 충정로 1', addr2: '', no: '1' }, 100, 45);
    return { escHead: Array.from(a.slice(0, 12)), escTail: Array.from(a.slice(-1)), escLen: a.length, rotHead: head, invLen: c.length, normLen: d.length, diff: (function () { let n = 0; const off = String.fromCharCode.apply(null, Array.from(d.slice(0, 120))).indexOf('BITMAP'); for (let i = off + 20; i < Math.min(d.length, c.length) - 20; i++) { if ((d[i] ^ c[i]) === 255) n++; } return n; })() };
  });
  ok('ESC/POS: ESC @ → GS v 0 래스터 → FF', r4.escHead[0] === 0x1b && r4.escHead[1] === 0x40 && r4.escHead[2] === 0x1d && r4.escHead[3] === 0x76 && r4.escTail[0] === 0x0c, JSON.stringify(r4.escHead));
  ok('회전 90도면 SIZE 가 45×100 으로 바뀜', /SIZE 45 mm,100 mm/.test(r4.rotHead), r4.rotHead.replace(/\r\n/g, ' | '));
  ok('색 반전이 비트맵을 뒤집음(같은 길이·거의 모든 바이트 반전)', r4.invLen === r4.normLen && r4.diff > r4.normLen * 0.9, r4.diff + '/' + r4.normLen);
  ok('오류 없음(예외 경로)', page.errs.length === 0, page.errs.slice(0, 2).join('|'));
  await page.context().close();
  // ---- 5. 설정 창: 연결·시험 인쇄·저장
  page = await open(browser, MOCK(512));
  await page.evaluate(() => { __ble.openSettings({ size: () => [80, 50] }); });
  await page.waitForSelector('#bleSet');
  await page.selectOption('#bsVia', 'ble'); await page.selectOption('#bsChunk', '180');
  await page.click('#bsConn'); await page.waitForFunction(() => /연결됨: MockLabel-BLE/.test(document.querySelector('#bsMsg').textContent));
  ok('설정 창에서 프린터 연결', true);
  await page.click('#bsTest'); await page.waitForFunction(() => /보냈어요/.test(document.querySelector('#bsMsg').textContent), null, { timeout: 15000 });
  const w5 = await page.evaluate(() => window.__w); const j5 = jobs(w5);
  const t5 = j5[0] && tsplImage(j5[0], path.join(OUT, '시험인쇄'));
  ok('시험 인쇄 1장 · 80×50mm', j5.length === 1 && t5 && t5.wmm === 80 && t5.hmm === 50, JSON.stringify(t5));
  ok('보내는 조각이 180바이트 이하', Math.max.apply(null, w5.map(w => w.length)) <= 180);
  await page.click('#bsSave');
  ok('저장되어 설정 유지', await page.evaluate(() => { const g = __ble.get(); return g.via === 'ble' && g.chunk === 180; }));
  ok('오류 없음(설정 창)', page.errs.length === 0, page.errs.slice(0, 2).join('|'));
  await page.context().close();
  // ---- 6. 직원 라벨 창: 롤 스티커 → 블루투스로 인쇄
  page = await open(browser, MOCK(512));
  const b64 = fs.readFileSync(INPUT).toString('base64');
  await page.evaluate(([b64, name]) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const f = new File([u], name); const dt = new DataTransfer(); dt.items.add(f); const el = document.querySelector('#fileInput'); el.files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true })); }, [b64, 'addr.xlsx']);
  await page.waitForFunction(() => !document.querySelector('#step2').hidden, null, { timeout: 60000 });
  await page.click('#btnRun');
  await page.waitForFunction(() => !document.querySelector('#step3').hidden && document.querySelectorAll('#resultTable tbody tr').length > 0, null, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 120000 });
  await page.click('#btnLabel'); await page.waitForSelector('#labelDlg[open]');
  ok('A4 시트에서는 블루투스 단추가 숨겨짐', !(await page.isVisible('#btnLabelBle')));
  await page.selectOption('#lbKind', 'roll'); await page.selectOption('#lbRollP', '80,50'); await page.waitForTimeout(300);
  ok('롤 스티커에서 블루투스 단추가 보임', await page.isVisible('#btnLabelBle'));
  await page.evaluate(() => { __ble.set({ via: 'ble', chunk: 500, delay: 0 }); });
  const nRows = await page.$$eval('#labelArea .sheet.roll', xs => xs.length);
  await page.click('#btnLabelBle'); await page.waitForFunction(() => /프린터로 보냈습니다|실패/.test(document.querySelector('#lbInfo').textContent), null, { timeout: 60000 });
  const w6 = await page.evaluate(() => window.__w); const j6 = jobs(w6);
  ok('주소록 줄 수만큼 스티커 전송', j6.length === nRows && nRows >= 6, j6.length + '장 / ' + nRows + '줄');
  const t6 = tsplImage(j6[0], path.join(OUT, '직원_블루투스_0')); tsplImage(j6[1], path.join(OUT, '직원_블루투스_1'));
  ok('직원 스티커 80×50mm', t6 && t6.wmm === 80 && t6.hmm === 50, JSON.stringify(t6));
  ok('오류 없음(직원 라벨 창)', page.errs.length === 0, page.errs.slice(0, 2).join('|'));
  await page.context().close();
  // ---- 7. 블루투스 없는 브라우저(컴퓨터 등): 단추 숨김, 기존 인쇄 창 방식 유지
  page = await open(browser, 'Object.defineProperty(navigator,"bluetooth",{configurable:true,value:undefined});');
  ok('블루투스 없으면 supported=false', (await page.evaluate(() => __ble.supported())) === false);
  await page.evaluate(() => { const k = JSON.parse(localStorage.getItem('zipfinder.kiosk.v1') || '{}'); k.paper = 'lbl'; localStorage.setItem('zipfinder.kiosk.v1', JSON.stringify(k)); localStorage.setItem('zipfinder.ble.v1', JSON.stringify({ via: 'ble' })); });
  await page.click('#btnKiosk'); await page.waitForSelector('#kiosk:not([hidden])');
  await page.evaluate(() => { const st = __kiosk.state(); st.entries.push({ name: '가상일', phone: '', zip: '56180', addr1: '전북특별자치도 정읍시 충정로 234-1', addr2: '', check: false }); window.__pr = 0; window.print = () => { window.__pr++; }; __kiosk.finish(); });
  await page.click('#kPrintBtn'); await page.waitForFunction(() => window.__pr === 1, null, { timeout: 5000 });
  ok('블루투스를 못 쓰면 기존 인쇄 창으로 대신 인쇄', true);
  ok('오류 없음(블루투스 없음)', page.errs.length === 0, page.errs.slice(0, 2).join('|'));
  await browser.close();
  cp.execFileSync('python3', ['-I', '-c', `
from PIL import Image
fs=[r"${OUT}/블루투스_0.png",r"${OUT}/블루투스_1.png",r"${OUT}/블루투스_2.png",r"${OUT}/시험인쇄.png",r"${OUT}/직원_블루투스_0.png"]
ims=[Image.open(f) for f in fs]
W=max(i.width for i in ims)+20; H=sum(i.height+16 for i in ims)
c=Image.new('L',(W,H),200); y=8
for i in ims: c.paste(i,(10,y)); y+=i.height+16
c.save(r"${OUT}/모음.png")`]);
  console.log(`\n통과 ${pass} · 실패 ${fail}`); process.exit(fail ? 1 : 0);
})();
