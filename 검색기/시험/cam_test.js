// 물어물어 v1.6 사진으로 읽기 시험 — 크로미움 가짜 웹캠(y4m 영상 파일)으로 키오스크 흐름을 끝까지 돈다
// 사용: node cam_test.js <출품본.html> <사진 폴더> <결과 폴더> [번호]   (사진 폴더에는 cam0.png… 와 truth.json — 가상 자료만)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const [HTML, DIR, OUT, ONLY] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const truth = JSON.parse(fs.readFileSync(path.join(DIR, 'truth.json'), 'utf8'));
let pass = 0, fail = 0; const ok = (n, c, x) => { (c ? pass++ : fail++); console.log((c ? '통과  ' : '실패  ') + n + (x ? ' · ' + x : '')); };
(async () => {
  const idxs = ONLY ? ONLY.split(',').map(Number) : truth.map((_, i) => i);
  let strict = 0, total = 0;
  for (const i of idxs) {
    const t = truth[i];
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      args: ['--allow-file-access-from-files', '--use-fake-ui-for-media-stream'] });
    const ctx = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    // 가짜 웹캠: 시험 사진을 그리는 캔버스의 영상 흐름(MediaStream)을 getUserMedia 대신 돌려준다 — 사진 찍기부터 읽기까지 실제 코드 경로가 그대로 돈다
    const dataUrl = 'data:image/png;base64,' + fs.readFileSync(path.join(DIR, t.file)).toString('base64');
    await page.addInitScript((u) => {
      const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720; const g = cv.getContext('2d'); const im = new Image(); im.src = u;
      im.onload = () => { const tick = () => { g.drawImage(im, 0, 0, 1280, 720); }; tick(); setInterval(tick, 100); };
      navigator.mediaDevices.getUserMedia = async () => cv.captureStream(10);
    }, dataUrl);
    await page.goto('file://' + HTML);
    await page.waitForFunction(() => /구간/.test(document.querySelector('#dbInfo').textContent), null, { timeout: 60000 });
    await page.waitForFunction(() => !/확인 중/.test(document.querySelector('#intChip').textContent), null, { timeout: 30000 });
    if (i === idxs[0]) ok('무결성(글자 읽기 엔진 포함)', /원본/.test(await page.textContent('#intChip')));
    if (await page.isVisible('#btnPrivacyOk')) await page.click('#btnPrivacyOk');
    await page.evaluate(() => { const k = JSON.parse(localStorage.getItem('zipfinder.kiosk.v1') || '{}'); k.region = '전북특별자치도 정읍시'; localStorage.setItem('zipfinder.kiosk.v1', JSON.stringify(k)); });
    const kBtn = async (text) => { await page.waitForFunction(t => Array.from(document.querySelectorAll('#kiosk .k-btn')).some(b => b.textContent.trim().startsWith(t) && !b.disabled), text, { timeout: 30000 });
      await page.evaluate(t => { Array.from(document.querySelectorAll('#kiosk .k-btn')).find(b => b.textContent.trim().startsWith(t) && !b.disabled).click(); }, text); };
    await page.click('#btnKiosk'); await page.waitForSelector('#kiosk:not([hidden])');
    await kBtn('시작하기');
    await page.waitForSelector('#kCam', { timeout: 10000 });
    if (i === idxs[0]) ok('주소 화면에 「사진으로 찍기」 단추', true);
    await page.click('#kCam');
    await page.waitForSelector('#kVid');
    await page.waitForTimeout(600); await page.screenshot({ path: path.join(OUT, '카메라_' + i + '.png') });
    await kBtn('사진 찍기');
    // 읽는 중 → 결과
    await page.waitForFunction(() => /이 주소가 맞으면|이 중에 맞는|잘 읽지 못했어요/.test(document.querySelector('#kMain').textContent), null, { timeout: 90000 });
    await page.screenshot({ path: path.join(OUT, '결과_' + i + '.png') });
    const txt = await page.textContent('#kMain');
    const gotCand = /이 주소가 맞으면|이 중에 맞는/.test(txt);
    total++;
    if (!gotCand) { console.log(`  [${i}] 후보 없음(고쳐 쓰기 안내) · 정답 ${t.addr}`); await browser.close(); ok('오류 없음 [' + i + ']', errs.length === 0, errs.slice(0, 2).join('|')); continue; }
    // 첫 후보를 눌러 확인 → 동·호 → 이름·전화 미리 채움 확인
    const first = await page.evaluate(() => document.querySelector('#kMain .k-choice').textContent);
    await page.evaluate(() => document.querySelector('#kMain .k-choice').click());
    await page.waitForFunction(() => /이 주소가 맞으세요/.test(document.querySelector('#kMain').textContent));
    await kBtn('네, 맞아요');
    await page.waitForFunction(() => /더 적을 게 있으세요/.test(document.querySelector('#kMain').textContent));
    await kBtn('다음');
    await page.waitForFunction(() => /성함은요/.test(document.querySelector('#kMain').textContent));
    const nm = await page.inputValue('#kIn');
    await kBtn('다음');
    await page.waitForFunction(() => /전화번호/.test(document.querySelector('#kMain').textContent));
    const ph = await page.textContent('#kNum');
    const zipTruth = await page.evaluate(a => { const r = __zip.S.engine.lookup(a); return r.zip; }, t.addr);
    const zipOk = first.indexOf(zipTruth) >= 0;
    if (zipOk) strict++;
    console.log(`  [${i}] 첫 후보 ${zipOk ? '맞음' : '다름'}(${zipTruth}) · 이름 미리 채움 「${nm}」(정답 ${t.name}) · 전화 「${ph.trim()}」(정답 ${t.phone})`);
    if (process.env.FULL && i === idxs[0]) {
      // 끝까지: 전화 확인 → 모은 주소 → 보내는 분 → 마침 → 주소 스티커 인쇄(라벨 프린터 설정 80×50)
      await page.evaluate(() => { const k = JSON.parse(localStorage.getItem('zipfinder.kiosk.v1') || '{}'); k.paper = 'lbl'; k.lblW = 80; k.lblH = 50; localStorage.setItem('zipfinder.kiosk.v1', JSON.stringify(k)); });
      await kBtn('다음');
      await page.waitForFunction(() => /보내실 곳이/.test(document.querySelector('#kMain').textContent));
      await kBtn('다 했어요');
      await page.waitForFunction(() => /성함은요/.test(document.querySelector('#kMain').textContent));
      await page.fill('#kIn', '가상발송'); await kBtn('다음');
      await page.waitForFunction(() => /전화번호/.test(document.querySelector('#kMain').textContent));
      await kBtn('건너뛰기');
      await page.waitForFunction(() => /주소도 적어 주세요/.test(document.querySelector('#kMain').textContent));
      await kBtn('창구에서 적을게요');
      await page.waitForFunction(() => /다 됐어요/.test(document.querySelector('#kMain').textContent));
      const lbl = await page.textContent('#kPrintBtn');
      ok('마침 화면 단추가 「주소 스티커 뽑기」', lbl.trim() === '주소 스티커 뽑기', lbl.trim());
      await page.evaluate(() => { window.__pr = 0; window.print = () => { window.__pr++; window.__ps = (document.querySelector('#kPageCss') || {}).textContent; window.__n = document.querySelectorAll('#kPrint .p-lbl').length; }; });
      await page.click('#kPrintBtn'); await page.waitForFunction(() => window.__pr === 1);
      const ps = await page.evaluate(() => window.__ps);
      ok('스티커 인쇄 용지 80×50mm', /size:80mm 50mm/.test(ps || ''), ps);
      ok('스티커 1장(받는 분 1명)', (await page.evaluate(() => window.__n)) === 1);
      console.log('  스티커 인쇄까지 정상');
    }
    // 카메라가 꺼졌는지(화면을 벗어난 뒤)
    const camOn = await page.evaluate(() => __cam.active());
    ok('다음 화면에서 카메라 꺼짐 [' + i + ']', camOn === false);
    ok('오류 없음 [' + i + ']', errs.length === 0, errs.slice(0, 2).join('|'));
    await browser.close();
  }
  console.log(`\n첫 후보 정답 ${strict}/${total} · 통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
})();
