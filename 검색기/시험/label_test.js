// 물어물어 v1.6 롤 스티커(라벨) 인쇄 시험 — 직원 라벨 창 + 어르신 화면 스티커. 크기·장수·넘침을 PDF로 확인한다.
// 사용: node label_test.js <출품본.html> <주소록.xlsx> <결과 폴더>   (가상 자료만)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const [HTML, INPUT, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x) => { (c ? pass++ : fail++); console.log((c ? '통과  ' : '실패  ') + n + (x ? ' · ' + x : '')); };
function pdfInfo(f) { const o = cp.execFileSync('pdfinfo', [f]).toString(); const pg = Number((o.match(/Pages:\s+(\d+)/) || [])[1]); const m = o.match(/Page size:\s+([\d.]+) x ([\d.]+) pts/); return { pages: pg, wmm: m ? Number(m[1]) * 25.4 / 72 : 0, hmm: m ? Number(m[2]) * 25.4 / 72 : 0 }; }
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--allow-file-access-from-files'] });
  const ctx = await browser.newContext({ acceptDownloads: true, locale: 'ko-KR', viewport: { width: 1360, height: 950 } });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + HTML);
  await page.waitForFunction(() => /구간/.test(document.querySelector('#dbInfo').textContent), null, { timeout: 60000 });
  await page.waitForFunction(() => !/확인 중/.test(document.querySelector('#intChip').textContent), null, { timeout: 30000 });
  if (await page.isVisible('#btnPrivacyOk')) await page.click('#btnPrivacyOk');
  // ---- 1. 직원 라벨 창: 롤 스티커
  const b64 = fs.readFileSync(INPUT).toString('base64');
  await page.evaluate(([b64, name]) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const f = new File([u], name); const dt = new DataTransfer(); dt.items.add(f); const el = document.querySelector('#fileInput'); el.files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true })); }, [b64, 'addr.xlsx']);
  await page.waitForFunction(() => !document.querySelector('#step2').hidden, null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 60000 });
  await page.click('#btnRun');
  await page.waitForFunction(() => !document.querySelector('#step3').hidden && document.querySelectorAll('#resultTable tbody tr').length > 0, null, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 120000 });
  await page.click('#btnLabel'); await page.waitForSelector('#labelDlg[open]');
  const kinds = await page.$$eval('#lbKind option', os => os.map(o => o.value));
  ok('라벨 규격에 롤 스티커 있음', kinds.indexOf('roll') >= 0, kinds.join(','));
  await page.selectOption('#lbKind', 'roll'); await page.waitForTimeout(200);
  ok('롤 선택 시 크기 입력 보임', await page.isVisible('#lbW'));
  await page.selectOption('#lbRollP', '100,45'); await page.waitForTimeout(300);
  const nRows = await page.$$eval('#labelArea .sheet.roll', xs => xs.length);
  ok('롤 스티커 한 장씩 만들어짐', nRows >= 6, nRows + '장');
  const over = await page.$$eval('#labelArea .sheet.roll', xs => xs.filter(sh => sh.firstChild.scrollHeight > sh.clientHeight + 1 || sh.firstChild.scrollWidth > sh.clientWidth + 1).length);
  ok('글자가 칸을 넘치지 않음(100×45)', over === 0, over + '장 넘침');
  await page.screenshot({ path: path.join(OUT, '직원_롤스티커.png') });
  // 진짜 「인쇄」 단추를 누르되, 창 인쇄 대신 인쇄 모양(print 미디어)으로 PDF를 만든다
  await page.evaluate(() => { window.__pr = 0; window.print = () => { window.__pr++; }; });
  await page.click('#btnLabelPrint'); await page.waitForFunction(() => window.__pr === 1);
  await page.emulateMedia({ media: 'print' });
  const pdf1 = path.join(OUT, '직원_롤.pdf'); await page.pdf({ path: pdf1, preferCSSPageSize: true, printBackground: true });
  const i1 = pdfInfo(pdf1);
  ok('인쇄 용지가 100×45mm', Math.abs(i1.wmm - 100) < 1 && Math.abs(i1.hmm - 45) < 1, i1.wmm.toFixed(1) + '×' + i1.hmm.toFixed(1) + 'mm');
  ok('인쇄 장수 = 스티커 수', i1.pages === nRows, i1.pages + '쪽 / ' + nRows + '장');
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  ok('인쇄 뒤 라벨 창이 다시 모달로 돌아옴', await page.evaluate(() => document.querySelector('#labelDlg').matches(':modal')));
  await page.selectOption('#lbKind', '1x6'); await page.waitForTimeout(300);
  await page.click('#btnLabelPrint'); await page.waitForFunction(() => window.__pr === 2);
  await page.emulateMedia({ media: 'print' });
  const pdf2 = path.join(OUT, '직원_A4.pdf'); await page.pdf({ path: pdf2, preferCSSPageSize: true, printBackground: true });
  const i2 = pdfInfo(pdf2);
  ok('A4 시트로 돌아오면 A4 용지', Math.abs(i2.wmm - 210) < 1 && Math.abs(i2.hmm - 297) < 1, i2.wmm.toFixed(1) + '×' + i2.hmm.toFixed(1));
  ok('A4 6칸 시트 여러 장도 모두 인쇄(8줄 → 2쪽)', i2.pages === 2, i2.pages + '쪽');
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.evaluate(() => document.querySelector('#labelDlg').close());
  // ---- 2. 어르신 화면 스티커
  await page.evaluate(() => { const k = JSON.parse(localStorage.getItem('zipfinder.kiosk.v1') || '{}'); k.paper = 'lbl'; k.lblW = 80; k.lblH = 50; k.org = '정읍우체국'; localStorage.setItem('zipfinder.kiosk.v1', JSON.stringify(k)); });
  await page.click('#btnKiosk'); await page.waitForSelector('#kiosk:not([hidden])');
  await page.evaluate(() => { const st = __kiosk.state(); st.entries.push(
    { name: '가상일', phone: '010-0000-1111', zip: '56180', addr1: '전북특별자치도 정읍시 충정로 234-1', addr2: '정읍시청 3층', check: false },
    { name: '가상이', phone: '', zip: '56204', addr1: '전북특별자치도 정읍시 시기4길 42', addr2: '101동 1004호(시기동,가상아파트)', check: true },
    { name: '가상삼', phone: '010-0000-3333', zip: '58324', addr1: '전남광주통합특별시 나주시 빛가람로 760', addr2: '한국전력공사 본사 신관 12층 경영지원처 우편실 가상팀 아주긴이름의부서', check: false });
    st.sender = { name: '가상발송', phone: '010-0000-9999', zip: '56180', addr1: '전북특별자치도 정읍시 충정로 234-1', addr2: '' }; });
  await page.evaluate(() => __kiosk.preparePrint());
  const over2 = await page.$$eval('#kPrint .p-lbl', xs => xs.map(el => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1));
  ok('어르신 스티커 3장, 넘침 없음(80×50)', over2.length === 3 && over2.every(v => !v), JSON.stringify(over2));
  await page.emulateMedia({ media: 'print' });
  const pdf3 = path.join(OUT, '어르신_스티커.pdf'); await page.pdf({ path: pdf3, preferCSSPageSize: true, printBackground: true });
  const i3 = pdfInfo(pdf3);
  ok('인쇄 용지가 80×50mm', Math.abs(i3.wmm - 80) < 1 && Math.abs(i3.hmm - 50) < 1, i3.wmm.toFixed(1) + '×' + i3.hmm.toFixed(1) + 'mm');
  ok('인쇄 장수 3쪽', i3.pages === 3, i3.pages + '쪽');
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => __kiosk.cleanupPrint());
  cp.execFileSync('pdftoppm', ['-r', '150', '-png', pdf3, path.join(OUT, '어르신_스티커')]);
  cp.execFileSync('pdftoppm', ['-r', '150', '-png', '-f', '1', '-l', '2', pdf1, path.join(OUT, '직원_롤')]);
  ok('콘솔 오류 없음', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`\n통과 ${pass} · 실패 ${fail}`); await browser.close(); process.exit(fail ? 1 : 0);
})();
