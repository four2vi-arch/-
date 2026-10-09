// 돌다리 로컬 웹 화면 자동 시험: 가짜 Ollama + server.py를 띄우고 ①~⑤를 끝까지 누른다.
// 실행: node web_test.js  (리눅스 시험 환경: Playwright/Chromium 경로는 아래 상수)
const {spawn} = require('child_process');
const fs = require('fs'), path = require('path');
const {chromium} = require('/opt/node22/lib/node_modules/playwright');
const HERE = path.resolve(__dirname, '..');
const OUT = process.env.OUT || path.join(__dirname, '..', '..', '..', '..', '..', 'tmp_out');
const WORK = process.argv[2] || '/tmp/돌다리_시험작업';
const PORT = 8799, FAKE = 11435;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  fs.rmSync(WORK, {recursive: true, force: true});
  const fake = spawn('python3', [path.join(__dirname, 'fake_ollama.py'), String(FAKE)], {stdio: 'inherit'});
  const srv = spawn('python3', [path.join(HERE, 'server.py'), '--port', String(PORT), '--work', WORK, '--no-browser'], {stdio: 'inherit'});
  await sleep(1200);
  const browser = await chromium.launch({executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const page = await browser.newPage({viewport: {width: 1200, height: 900}});
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  const shots = process.env.SHOTS || '/tmp/돌다리_shots'; fs.mkdirSync(shots, {recursive: true});
  try {
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.fill('#folder', path.join(HERE, '모의데이터', '가상기관_모의업무폴더'));
    await page.click('#btnExtract');
    await page.waitForSelector('#files .good', {timeout: 20000});
    console.log('① 읽기:', await page.textContent('#files .good'));
    await page.screenshot({path: path.join(shots, '1_읽기.png'), fullPage: true});
    // 모델 주소를 가짜 서버로
    await page.fill('#url', `http://127.0.0.1:${FAKE}/v1/chat/completions`);
    await page.dispatchEvent('#url', 'change'); await sleep(300);
    await page.click('#btnModels'); await sleep(500);
    const opts = await page.$$eval('#model option', o => o.map(x => x.value));
    console.log('② 모델 목록:', opts);
    await page.selectOption('#model', 'fake-exaone:test'); await sleep(400);
    console.log('② 계획:', (await page.textContent('#plan')).trim());
    // 외부 주소 거부 확인
    const bad = await page.evaluate(() => fetch('/api/settings', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({url: 'http://example.com/v1'})}).then(r => r.status));
    console.log('② 외부 주소 거부 status:', bad);
    await page.selectOption('#recent', '0');
    await page.click('#btnDraft');
    await page.waitForSelector('#s4.cur', {timeout: 60000});
    await page.screenshot({path: path.join(shots, '3_검토.png'), fullPage: true});
    const counts = await page.textContent('#counts'); console.log('④ 항목:', counts, '| 탭:', (await page.textContent('#tabs')).trim(), '| 불확실:', await page.textContent('#nDropped'));
    // 항목 하나 끄기, 글 고치기, 직접 적기, 불확실 복원
    const first = await page.$('#items .item');
    await first.$eval('.keep', el => { el.checked = false; el.dispatchEvent(new Event('change')); });
    await first.$eval('.text', el => { el.value = '고친 글 (시험)'; el.dispatchEvent(new Event('change')); });
    await page.click('#btnSave'); await sleep(300);
    await page.selectOption('#addType', '진행 중 현안'); await page.fill('#addWhen', '2026년 2월'); await page.fill('#addText', '직접 적은 현안(시험)'); await page.fill('#addNote', '후임자 메모');
    await page.click('#btnAdd'); await sleep(400);
    await page.click('#droppedBox summary');
    const d = await page.$('#dropped .item');
    if (d) { await d.$eval('.keep', el => { el.checked = true; el.dispatchEvent(new Event('change')); }); await sleep(400); }
    console.log('④ 고친 뒤:', await page.textContent('#counts'), '| 불확실:', await page.textContent('#nDropped'));
    await page.click('#btnExport');
    await page.waitForSelector('#exports a', {timeout: 20000});
    const files = await page.$$eval('#exports a', a => a.map(x => x.textContent));
    console.log('⑤ 내보낸 파일:', files);
    await page.screenshot({path: path.join(shots, '5_내보내기.png'), fullPage: true});
    // 다시 열어도 이어지는지
    await page.goto(`http://127.0.0.1:${PORT}/`); await sleep(800);
    console.log('재접속 단계 cur:', await page.$eval('section.step.cur h2', h => h.textContent.trim()));
    // 느린 모델로 다시 만들다가 중단
    await page.fill('#folder', path.join(HERE, '모의데이터', '가상기관_모의업무폴더')); await page.click('#btnExtract'); await page.waitForSelector('#files .good');
    await page.evaluate(() => { const s = document.querySelector('#model'); s.insertAdjacentHTML('beforeend', '<option value="slow-fake">slow-fake</option>'); s.value = 'slow-fake'; s.dispatchEvent(new Event('change')); });
    await sleep(300);
    await page.click('#btnDraft'); await sleep(2500); await page.click('#btnStop');
    await page.waitForSelector('#s4.cur', {timeout: 30000});
    const st = await (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json();
    console.log('중단 시험: 호출', st.progress.calls_done, '/', st.progress.calls_total, '| 항목', st.n_items, '| stopped', st.progress.stopped);
    console.log('콘솔 오류:', errors.length ? errors : '없음');
  } catch (e) {
    console.error('실패:', e); await page.screenshot({path: path.join(shots, 'fail.png'), fullPage: true});
  } finally {
    await browser.close(); srv.kill(); fake.kill();
  }
})();
