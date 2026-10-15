// 물어물어 v1.6 사진으로 읽기 · 직원 창과 예외(카메라 거부·없음) 시험
// 사용: node cam_extra_test.js <출품본.html> <사진 폴더> <결과 폴더>
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'); const path = require('path');
const [HTML, DIR, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const truth = JSON.parse(fs.readFileSync(path.join(DIR, 'truth.json'), 'utf8'));
let pass = 0, fail = 0; const ok = (n, c, x) => { (c ? pass++ : fail++); console.log((c ? '통과  ' : '실패  ') + n + (x ? ' · ' + x : '')); };
async function open(browser, mode) {
  const ctx = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage(); const errs = []; page.errs = errs;
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(path.join(DIR, truth[1].file)).toString('base64');
  await page.addInitScript(([u, mode]) => {
    if (mode === 'ok') {
      const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const g = cv.getContext('2d'); const im = new Image(); im.src = u;
      im.onload = () => { const tick = () => { g.drawImage(im, 0, 0, 1280, 720); }; tick(); setInterval(tick, 100); };
      navigator.mediaDevices.getUserMedia = async () => cv.captureStream(10);
    } else if (mode === 'denied') {
      navigator.mediaDevices.getUserMedia = async () => { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e; };
    } else if (mode === 'nocam') {
      Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    }
  }, [dataUrl, mode]);
  await page.goto('file://' + HTML);
  await page.waitForFunction(() => /구간/.test(document.querySelector('#dbInfo').textContent), null, { timeout: 60000 });
  await page.waitForFunction(() => !/확인 중/.test(document.querySelector('#intChip').textContent), null, { timeout: 30000 });
  if (await page.isVisible('#btnPrivacyOk')) await page.click('#btnPrivacyOk');
  await page.evaluate(() => { const k = JSON.parse(localStorage.getItem('zipfinder.kiosk.v1') || '{}'); k.region = '전북특별자치도 정읍시'; localStorage.setItem('zipfinder.kiosk.v1', JSON.stringify(k)); });
  return page;
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--allow-file-access-from-files'] });
  // 1. 직원 「주소 찾기」 → 사진으로 읽기
  let page = await open(browser, 'ok');
  await page.click('#btnFind'); await page.waitForSelector('#findDlg[open]');
  ok('주소 찾기 창에 「사진으로 읽기」 단추', await page.isVisible('#btnFindCam'));
  await page.click('#btnFindCam'); await page.waitForSelector('#camDlg[open]');
  await page.waitForFunction(() => !document.querySelector('#btnCamShot').disabled, null, { timeout: 30000 });
  await page.click('#btnCamShot');
  await page.waitForFunction(() => document.querySelectorAll('#camRes [data-cam]').length > 0 || /읽지 못/.test(document.querySelector('#camRes').textContent), null, { timeout: 90000 });
  const n = await page.$$eval('#camRes [data-cam]', xs => xs.length);
  ok('직원 창에 주소 후보가 나옴', n >= 1, n + '개');
  await page.screenshot({ path: path.join(OUT, '직원_사진읽기.png') });
  await page.click('#camRes [data-cam]'); await page.waitForTimeout(500);
  const q = await page.inputValue('#findQ'); const best = await page.textContent('#findBest');
  ok('후보를 누르면 주소 찾기가 그 주소로 찾음', /시기4길/.test(q) && /56204/.test(best), q + ' → ' + best.replace(/\s+/g, ' ').slice(0, 40));
  ok('창을 닫으면 카메라가 꺼짐', (await page.evaluate(() => __cam.active())) === false);
  ok('직원 창 오류 없음', page.errs.length === 0, page.errs.slice(0, 2).join('|'));
  await page.context().close();
  // 2. 카메라 허용 안 함: 어르신 화면·직원 창 모두 안내만 하고 멈추지 않음
  page = await open(browser, 'denied');
  await page.click('#btnKiosk'); await page.waitForSelector('#kiosk:not([hidden])');
  await page.evaluate(() => Array.from(document.querySelectorAll('#kiosk .k-btn')).find(b => b.textContent.startsWith('시작하기')).click());
  await page.waitForSelector('#kCam'); await page.click('#kCam');
  await page.waitForFunction(() => /허용되지 않았어요/.test(document.querySelector('#kMain').textContent), null, { timeout: 10000 });
  ok('카메라 거부 시 어르신 화면 안내', true);
  await page.evaluate(() => Array.from(document.querySelectorAll('#kiosk .k-btn')).find(b => b.textContent.startsWith('글자로 적을게요')).click());
  await page.waitForSelector('#kIn'); ok('「글자로 적을게요」로 입력 화면 복귀', true);
  ok('거부 시 오류 없음', page.errs.length === 0, page.errs.slice(0, 2).join('|'));
  await page.context().close();
  // 3. 카메라 장치 자체가 없음: 단추를 숨김
  page = await open(browser, 'nocam');
  ok('카메라 없으면 supported=false', (await page.evaluate(() => __cam.supported())) === false);
  await page.click('#btnKiosk'); await page.waitForSelector('#kiosk:not([hidden])');
  await page.evaluate(() => Array.from(document.querySelectorAll('#kiosk .k-btn')).find(b => b.textContent.startsWith('시작하기')).click());
  await page.waitForSelector('#kIn');
  ok('카메라 없으면 어르신 화면에 사진 단추 없음', (await page.$('#kCam')) === null);
  await page.evaluate(() => __kiosk.close());
  await page.click('#btnFind'); await page.waitForSelector('#findDlg[open]');
  ok('카메라 없으면 직원 창에도 단추 없음', !(await page.isVisible('#btnFindCam')));
  ok('카메라 없음 오류 없음', page.errs.length === 0, page.errs.slice(0, 2).join('|'));
  await browser.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`); process.exit(fail ? 1 : 0);
})();
