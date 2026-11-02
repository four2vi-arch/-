// 물어물어 v1.11 최종(11.2.) 어르신 화면 점검: 직원 단추 키보드 2초, 넘기기 단추 맨 앞, 작업 중인 주소록 확인 창,
// 넘긴 비고 글(보내는 분 모름), 넘긴 뒤 양식1 안내의 「창구에서 확인할 행」, AI 주소 고쳐 쓰기, 알림이 단추 누름을 막지 않음.
// 사용: node kiosk11_test.js <출품본.html> <결과 폴더>   (가상 이름만, 모델 서버 없이)
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const [HTML, OUT] = process.argv.slice(2); fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x) => { (c ? pass++ : fail++); console.log((c ? '통과  ' : '실패  ') + n + (x ? ' · ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const ctx = await browser.newContext({ acceptDownloads: true, locale: 'ko-KR', viewport: { width: 1366, height: 768 } });
  await ctx.addInitScript(() => { window.print = () => {}; });
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await page.goto('file://' + path.resolve(HTML));
  await page.waitForFunction(() => /구간/.test(document.querySelector('#dbInfo').textContent), null, { timeout: 60000 });
  if (await page.isVisible('#btnPrivacyOk')) await page.click('#btnPrivacyOk');
  // 직원 화면에 작업 중인 주소록(예시 10건)
  await page.click('#btnSample'); await sleep(600); if (await page.isVisible('#btnRun')) await page.click('#btnRun');
  await page.waitForFunction(() => !document.querySelector('#step3').hidden && document.querySelector('#busy').hidden, null, { timeout: 60000 });
  const kBtn = async (t) => { await page.waitForFunction(x => Array.from(document.querySelectorAll('#kiosk .k-btn')).some(b => b.textContent.trim().startsWith(x)), t, { timeout: 15000 }); await page.evaluate(x => { Array.from(document.querySelectorAll('#kiosk .k-btn')).find(b => b.textContent.trim().startsWith(x)).click(); }, t); await sleep(300); };
  // 알림은 누름을 막지 않음
  await page.click('#btnKiosk'); await page.waitForSelector('#kiosk:not([hidden])');
  ok('어르신 화면 알림(.k-toast)은 누름을 통과', await page.evaluate(() => { const d = document.createElement('div'); d.className = 'k-toast'; document.body.appendChild(d); const v = getComputedStyle(d).pointerEvents; d.remove(); return v === 'none'; }));
  await kBtn('시작하기'); await page.fill('#kIn', '전주시 완산구 효자로 225 302호'); await page.click('#kGo');
  await page.waitForFunction(() => /맞으세요/.test(document.querySelector('#kMain').textContent), null, { timeout: 30000 });
  await kBtn('네, 맞아요'); await kBtn('다음'); await kBtn('모르겠어요'); await kBtn('건너뛰기');
  await kBtn('다 했어요'); await kBtn('모르겠어요'); await kBtn('건너뛰기'); await kBtn('창구에서 적을게요');
  await page.waitForFunction(() => /다 됐어요/.test(document.querySelector('#kMain').textContent), null, { timeout: 15000 });
  // 직원 단추: 키보드 Enter 2초
  await page.focus('#kStaff'); await page.keyboard.down('Enter'); await sleep(2300); await page.keyboard.up('Enter');
  const opened = await page.waitForSelector('#kfExit', { timeout: 4000 }).then(() => true).catch(() => false);
  ok('「직원」 단추를 키보드(Enter 2초)로도 열 수 있음', opened);
  const first = await page.$eval('#kModalBtns button', b => b.textContent.trim()).catch(() => '');
  ok('마침 뒤 직원 창 단추 줄 맨 앞이 「이 어르신 입력을 접수 화면으로 넘기기」', /접수 화면으로 넘기기/.test(first), first);
  // AI 주소를 「127.0.0.1:11479」처럼 적어도 OpenAI 호환 주소로 고쳐 씀(연결 시험은 실패해도 됨)
  await page.evaluate(() => { const d = document.querySelector('#kModal details'); if (d) d.open = true; });
  await page.fill('#kfUrl', '127.0.0.1:11479'); await page.fill('#kfModel', 'x');
  await page.evaluate(() => Array.from(document.querySelectorAll('#kModalBtns button')).find(b => /AI 연결 시험/.test(b.textContent)).click()); await sleep(600);
  ok('AI 주소 「127.0.0.1:11479」 → 「http://127.0.0.1:11479/v1/chat/completions」', (await page.inputValue('#kfUrl')) === 'http://127.0.0.1:11479/v1/chat/completions', await page.inputValue('#kfUrl'));
  ok('그 주소를 「외부 주소」로 막지 않음', !/외부 주소/.test(await page.textContent('#kfMsg')), (await page.textContent('#kfMsg')).slice(0, 80));
  // 넘기기: 작업 중인 주소록을 바꿀지 묻는다
  dialogs.length = 0;
  await page.evaluate(() => Array.from(document.querySelectorAll('#kModalBtns button')).find(b => /접수 화면으로 넘기기/.test(b.textContent)).click());
  await page.waitForFunction(() => /어르신입력/.test(document.querySelector('#fileLabel').textContent), null, { timeout: 20000 }).catch(() => {});
  ok('넘길 때 작업 중인 주소록(예시 10건)을 바꿀지 물음', dialogs.some(m => /작업 중인 주소록/.test(m) && /10건/.test(m)), dialogs[0]);
  ok('확인 창은 한 번만(직원 화면이 다시 묻지 않음)', dialogs.length === 1, String(dialogs.length));
  await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 60000 });
  const memo = await page.evaluate(() => { const S = window.__zip.S; return S.cols.memo >= 0 ? String((S.aoa[1] || [])[S.cols.memo] || '') : '(비고 열 없음)'; });
  ok('넘긴 비고: 「보내는 분 성함·주소 창구 확인」 한 번(빈 이름·같은 말 두 번 없음)', /보내는 분 성함·주소 창구 확인/.test(memo) && !/보내는 분\s+·/.test(memo) && (memo.match(/주소 창구 확인/g) || []).length === 1, memo);
  if (await page.isVisible('#btnRun')) { await page.click('#btnRun'); }
  await page.waitForFunction(() => !document.querySelector('#step3').hidden && document.querySelector('#busy').hidden, null, { timeout: 60000 });
  const i1 = await page.$$eval('#presets .preset b', bs => bs.findIndex(b => b.textContent === '양식1 · 등기용')); await page.click('#presets .preset:nth-child(' + (i1 + 1) + ')'); await sleep(300);
  await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#btnDownload')]);
  const msg = (await page.textContent('#dlMsg')).trim();
  ok('넘긴 입력을 양식1로 받으면 「창구에서 확인할 행」과 「수취인이 빈 행」 안내', /창구에서 확인할 행 1건/.test(msg) && /수취인이 빈 행 1건/.test(msg), msg.slice(0, 220));
  ok('화면 오류 없음', errs.length === 0, errs.join(' | '));
  console.log(`\n통과 ${pass} · 실패 ${fail}`); await browser.close(); process.exit(fail ? 1 : 0);
})();
