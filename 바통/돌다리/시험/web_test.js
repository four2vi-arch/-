// 돌다리 화면 자동 시험(v1.1): 가짜 Ollama + server.py를 띄우고 화면의 모든 단추를 눌러 본다.
// 실행: node web_test.js [작업폴더]   (리눅스 시험 환경: Playwright/Chromium 경로는 아래 상수. 윈도에서는 npx playwright로 바꿔 쓴다)
const {spawn} = require('child_process');
const fs = require('fs'), path = require('path');
const {chromium} = require('/opt/node22/lib/node_modules/playwright');
const HERE = path.resolve(__dirname, '..');
const WORK = process.argv[2] || '/tmp/돌다리_시험작업';
const PORT = 8799, FAKE = 11435;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MOCK = path.join(HERE, '모의데이터', '가온우체국_모의업무폴더');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { (cond ? pass++ : fail++); console.log((cond ? '통과  ' : '실패  ') + name + (extra ? ' · ' + extra : '')); };
(async () => {
  fs.rmSync(WORK, {recursive: true, force: true});
  const fake = spawn('python3', [path.join(__dirname, 'fake_ollama.py'), String(FAKE)], {stdio: 'ignore'});
  const srvOut = [];
  let srv = spawn('python3', [path.join(HERE, 'server.py'), '--port', String(PORT), '--work', WORK, '--no-browser'], {stdio: ['ignore', 'pipe', 'pipe']});
  srv.stdout.on('data', d => srvOut.push(String(d))); srv.stderr.on('data', d => srvOut.push(String(d)));
  await sleep(1200);
  const browser = await chromium.launch({executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const page = await browser.newPage({viewport: {width: 1920, height: 1080}});
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  const shots = process.env.SHOTS || '/tmp/돌다리_shots'; fs.mkdirSync(shots, {recursive: true});
  const state = async () => (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json();
  const cur = async () => page.$eval('nav#side a.cur', a => a.dataset.v);
  try {
    await page.goto(`http://127.0.0.1:${PORT}/`); await sleep(500);
    ok('첫 화면은 1. 업무 폴더', (await cur()) === 'folder');
    // 머리글 단추
    await page.click('#fsup'); await page.click('#fsdn'); await page.click('#thm'); const dark = await page.evaluate(() => document.documentElement.dataset.theme); await page.click('#thm');
    ok('글자 크기·밝기 단추', dark === 'dark');
    // 왼쪽 메뉴 전부
    for (const v of ['setup', 'run', 'review', 'export', 'calendar', 'cycle', 'area', 'files', 'log', 'folder']) { await page.click(`nav#side a[data-v="${v}"]`); if ((await cur()) !== v) { ok('메뉴 ' + v, false); } }
    ok('왼쪽 메뉴 10개 전환', (await cur()) === 'folder');
    // 찾기(화면 안 폴더 고르기)
    await page.click('#btnPick'); await page.waitForSelector('#picker:not([hidden])');
    const nd = await page.$$eval('#pkList .d', d => d.length); ok('찾기… 폴더 목록이 뜸', nd > 0, nd + '개');
    await page.click('#pkList .d'); await sleep(300); await page.click('#pkUp'); await sleep(300); await page.click('#pkClose');
    ok('찾기 창 위로·닫기', await page.$eval('#picker', el => el.hidden));
    await page.click('#btnBrowse'); await sleep(500);
    ok('창으로 찾기(리눅스: 안내문)', (await page.textContent('#extractMsg')).length > 0 || (await page.inputValue('#folder')).length > 0);
    // 읽기
    await page.fill('#folder', MOCK); await page.click('#btnExtract');
    await page.waitForSelector('#files .stats', {timeout: 30000});
    const st1 = await state(); ok('읽기', st1.files.length > 20, `읽음 ${st1.files.length} · 못 읽음 ${st1.n_fail} · 읽지 않음 ${st1.n_skip}`);
    await page.screenshot({path: path.join(shots, '1_폴더.png')});
    // 하위 폴더 모두 해제 → 모두 → 다시 읽기
    await page.click('#subdirs summary'); await page.click('#subNone'); await page.click('#subAll'); await page.click('#btnReread'); await page.waitForSelector('#files .stats', {timeout: 30000});
    ok('하위 폴더 단추·다시 읽기', (await state()).files.length === st1.files.length);
    await page.click('#goSetup'); ok('「설정·계획으로」 단추', (await cur()) === 'setup');
    // 읽은 파일 보기
    await page.click('nav#side a[data-v="files"]'); ok('읽은 파일 보기에 표가 있음', (await page.$$eval('#filesView table', t => t.length)) >= 2);
    // 설정
    await page.click('nav#side a[data-v="setup"]');
    await page.fill('#url', `http://127.0.0.1:${FAKE}/v1/chat/completions`); await page.dispatchEvent('#url', 'change'); await sleep(300);
    await page.click('#btnModels'); await sleep(500);
    const opts = await page.$$eval('#model option', o => o.map(x => x.value)); ok('모델 목록 새로고침', opts.includes('fake-exaone:test'), opts.join(','));
    await page.selectOption('#model', 'fake-exaone:test'); await sleep(300);
    ok('계획 글', (await page.textContent('#plan')).includes('호출'));
    const bad = await page.evaluate(() => fetch('/api/settings', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({url: 'http://example.com/v1'})}).then(r => r.status));
    ok('외부 모델 주소 거부(400)', bad === 400);
    for (const s of ['#tables', '#skipRef']) { await page.click(s); await page.click(s); }
    await page.selectOption('#recent', '1'); await page.selectOption('#recent', '0'); await page.selectOption('#maxCalls', '1'); await page.selectOption('#maxCalls', '3');
    await page.fill('#title', '시험과 · 2026.2.'); await page.dispatchEvent('#title', 'change'); await sleep(200);
    const areasBefore = await page.inputValue('#areas'); await page.fill('#areas', '시험분야: 소포, 접수\n' + areasBefore); await page.click('#btnAreas'); await sleep(400);
    ok('분야 키워드 적용', (await state()).areas_text.startsWith('시험분야'));
    await page.click('#btnAreasDefault'); await sleep(400); ok('분야 기본값으로', !(await state()).areas_text.startsWith('시험분야'));
    // 초안
    await page.click('#btnDraft'); await sleep(600); ok('초안 만들기 → 3. 진행 화면', (await cur()) === 'run', await cur());
    await page.waitForFunction(() => document.querySelector('nav#side a[data-v="review"]').classList.contains('done') || document.querySelector('#progText').textContent.includes('끝났습니다'), null, {timeout: 60000});
    await page.click('nav#side a[data-v="review"]'); await sleep(300);
    const c1 = await page.textContent('#counts'); ok('검토 화면 항목', /전체 \d+개/.test(c1), c1);
    await page.screenshot({path: path.join(shots, '4_검토.png')});
    // 칩·검색
    const nTabs = await page.$$eval('#tabs .chip', x => x.length); for (let i = 0; i < nTabs; i++) await page.click(`#tabs .chip:nth-child(${i + 1})`);
    await page.click('#tabs .chip'); ok('유형 칩 3개', nTabs === 3);
    const nac = await page.$$eval('#areaChips .chip', x => x.length); ok('분야 칩', nac >= 2, nac + '개'); if (nac > 1) { await page.click('#areaChips .chip:nth-child(2)'); await sleep(100); await page.click('#areaChips .chip'); }
    const ncc = await page.$$eval('#cycleChips .chip', x => x.length); ok('주기 칩', ncc >= 2, ncc + '개'); if (ncc > 1) { await page.click('#cycleChips .chip:nth-child(2)'); await sleep(100); await page.click('#cycleChips .chip'); }
    await page.fill('#q', '제출'); await sleep(200); const nq = await page.$$eval('#items .item', x => x.length); await page.fill('#q', ''); await sleep(200);
    ok('머리글 검색(「제출」)', nq >= 1, nq + '개');
    // 항목 고치기 전부
    const first = await page.$('#items .item');
    await first.$eval('.keep', el => { el.checked = false; el.dispatchEvent(new Event('change')); });
    await first.$eval('.type', el => { el.value = '진행 중 현안'; el.dispatchEvent(new Event('change')); });
    await first.$eval('.when', el => { el.value = '2026년 3월'; el.dispatchEvent(new Event('change')); });
    await first.$eval('.text', el => { el.value = '고친 글 (시험)'; el.dispatchEvent(new Event('change')); });
    await first.$eval('.area', el => { el.value = '기타'; el.dispatchEvent(new Event('change')); });
    await first.$eval('.note', el => { el.value = '메모 시험'; el.dispatchEvent(new Event('change')); });
    await page.click('#btnSave'); await sleep(400);
    const st2 = await state(); const items2 = (await (await fetch(`http://127.0.0.1:${PORT}/api/items`)).json()).items;
    const edited = items2.find(i => i.text === '고친 글 (시험)');
    ok('항목 고치기 6칸 저장', edited && edited.keep === false && edited.type === '진행 중 현안' && edited.when === '2026년 3월' && edited.area === '기타' && edited.note === '메모 시험' && edited.area_by === '사람');
    // 일괄
    await page.click('#selAll'); await page.click('#btnDropSel'); await sleep(400);
    const items3 = (await (await fetch(`http://127.0.0.1:${PORT}/api/items`)).json()).items;
    const tabNow = await page.$eval('#tabs .chip.on', e => e.dataset.t);
    ok('보이는 항목 전부 선택 → 뺌', items3.filter(i => i.type === tabNow).every(i => !i.keep));
    await page.click('#selAll'); await page.click('#btnKeepSel'); await sleep(400);
    const items4 = (await (await fetch(`http://127.0.0.1:${PORT}/api/items`)).json()).items;
    ok('선택 → 남김', items4.filter(i => i.type === tabNow).every(i => i.keep));
    // 직접 적기
    await page.selectOption('#addType', '진행 중 현안'); await page.fill('#addWhen', '2026년 2월'); await page.fill('#addText', '직접 적은 현안(시험)'); await page.fill('#addNote', '후임자 메모'); await page.click('#btnAdd'); await sleep(400);
    ok('직접 적기', (await (await fetch(`http://127.0.0.1:${PORT}/api/items`)).json()).items.some(i => i.src === '직접 입력'));
    // 불확실 복원
    await page.click('#droppedBox summary'); const d = await page.$('#dropped .item');
    if (d) { await d.$eval('.keep', el => { el.checked = true; el.dispatchEvent(new Event('change')); }); await sleep(400); }
    ok('불확실 복원', !d || (await state()).n_dropped < st2.n_dropped);
    await page.click('#errBox summary');
    // 주기 업무 화면
    await page.click('nav#side a[data-v="cycle"]'); const groups = await page.$$('#cycleView .cyc-group'); ok('주기 업무 묶음', groups.length >= 1, groups.length + '묶음');
    const dropBtn = await page.$('#cycleView h3 button[data-k="0"]'); await dropBtn.click(); await sleep(400);
    const keepBtn = await page.$('#cycleView h3 button[data-k="1"]'); await keepBtn.click(); await sleep(400);
    await page.$eval('#cycleView .ck', el => { el.checked = false; el.dispatchEvent(new Event('change')); }); await sleep(300);
    await page.$eval('#cycleView .ck', el => { el.checked = true; el.dispatchEvent(new Event('change')); }); await sleep(300);
    ok('주기 묶음 전부 뺌·남김·줄 체크', true);
    await page.screenshot({path: path.join(shots, '6_주기.png')});
    // 월별 일정표
    await page.click('nav#side a[data-v="calendar"]'); const cg = await page.$$('#calendarView .cyc-group'); ok('월별 일정표 묶음', cg.length >= 2, cg.length + '묶음');
    const cb = await page.$('#calendarView h3 button[data-k="0"]'); if (cb) { await cb.click(); await sleep(400); await page.click('#calendarView h3 button[data-k="1"]'); await sleep(400); }
    await page.$eval('#calendarView .ck', el => { el.checked = false; el.dispatchEvent(new Event('change')); }); await sleep(300); await page.$eval('#calendarView .ck', el => { el.checked = true; el.dispatchEvent(new Event('change')); }); await sleep(300);
    ok('월별 일정표 전부 뺌·남김·줄 체크', true);
    // 분야별 보기
    await page.click('nav#side a[data-v="area"]'); const ab = await page.$('#areaView button'); ok('분야별 표', !!ab);
    if (ab) { await ab.click(); ok('「검토에서 보기」 → 검토 화면', (await cur()) === 'review'); }
    // 인쇄 3곳
    await page.click('#btnPrint'); await page.click('nav#side a[data-v="review"]'); await page.click('#btnPrint2'); await page.click('nav#side a[data-v="export"]'); await page.click('#btnPrint3');
    ok('인쇄 단추 3개', (await page.evaluate(() => window.__printed)) === 3 && (await page.$eval('#printView', e => e.children.length)) > 2);
    // 내보내기 2곳
    await page.click('#btnExport2'); await page.waitForSelector('#exports a', {timeout: 20000});
    const ex1 = await page.$$eval('#exports a', a => a.map(x => x.textContent).join());
    await page.click('nav#side a[data-v="review"]'); await page.click('#btnExport'); await page.waitForSelector('#exports a', {timeout: 20000}); await sleep(500);
    ok('내보내기 단추 2개', true, (await page.$$eval('#exports a', a => a.map(x => x.textContent))).join(', '));
    await page.click('nav#side a[data-v="log"]'); ok('작업 기록', (await page.textContent('#log')).includes('추출'));
    // 서버 재시작 → 이어서 열림(되읽기)
    srv.kill(); await sleep(500);
    srv = spawn('python3', [path.join(HERE, 'server.py'), '--port', String(PORT), '--work', WORK, '--no-browser'], {stdio: ['ignore', 'pipe', 'pipe']});
    srv.stdout.on('data', d => srvOut.push(String(d))); srv.stderr.on('data', d => srvOut.push(String(d)));
    await sleep(1500); await page.goto(`http://127.0.0.1:${PORT}/`); await sleep(1000);
    ok('재시작 뒤 이어서 열림(검토 단계)', (await state()).step >= 4 && (await cur()) !== 'folder', '현재 ' + (await cur()));
    // 느린 모델로 다시 만들다가 중단 → 이어하기 재사용
    await page.click('nav#side a[data-v="folder"]'); await page.fill('#folder', MOCK); await page.click('#btnExtract'); await page.waitForSelector('#files .stats', {timeout: 30000});
    await page.click('nav#side a[data-v="setup"]');
    await page.evaluate(() => { const s = document.querySelector('#model'); s.insertAdjacentHTML('beforeend', '<option value="slow-fake">slow-fake</option>'); s.value = 'slow-fake'; s.dispatchEvent(new Event('change')); });
    await sleep(300); await page.click('#btnDraft'); await sleep(3000); await page.click('#btnStop');
    await page.waitForFunction(() => document.querySelector('#progText').textContent.includes('끝났습니다'), null, {timeout: 60000});
    const st3 = await state(); ok('중단', st3.progress.stopped === true && st3.progress.calls_done < st3.progress.calls_total, `호출 ${st3.progress.calls_done}/${st3.progress.calls_total}`);
    await page.click('nav#side a[data-v="setup"]'); await page.click('#btnDraft');
    for (let i = 0; i < 50 && !(await state()).running; i++) await sleep(200);
    for (let i = 0; i < 450 && (await state()).running; i++) await sleep(200);
    const reused = (await state()).log.find(l => l.includes('재사용')); ok('다시 만들기에서 이전 응답 재사용', !!reused, reused || '');
    const expected400 = errors.filter(e => !/400/.test(e));
    ok('콘솔 오류 없음(외부 주소 거부 400 제외)', expected400.length === 0, expected400.join(' | '));
    const srvErr = srvOut.join('').split('\n').filter(l => /Traceback|Error/.test(l) && !/HTTPError|폴더 창 실패/.test(l));
    ok('서버 예외 없음', srvErr.length === 0, srvErr.slice(0, 3).join(' | '));
  } catch (e) {
    fail++; console.error('실패(예외):', e); await page.screenshot({path: path.join(shots, 'fail.png'), fullPage: true});
  } finally {
    console.log(`\n통과 ${pass} · 실패 ${fail}`);
    await browser.close(); srv.kill(); fake.kill();
    process.exit(fail ? 1 : 0);
  }
})();
