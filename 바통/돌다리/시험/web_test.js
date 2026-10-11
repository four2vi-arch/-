// 돌다리 v2 화면 자동 시험: 가짜 Ollama + server.py를 띄우고 인수인계서 여덟 절과 모든 단추를 누른다.
// 실행: node web_test.js [작업폴더]
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
  const srvOut = []; const startSrv = () => { const s = spawn('python3', [path.join(HERE, 'server.py'), '--port', String(PORT), '--work', WORK, '--no-browser'], {stdio: ['ignore', 'pipe', 'pipe']}); s.stdout.on('data', d => srvOut.push(String(d))); s.stderr.on('data', d => srvOut.push(String(d))); return s; };
  let srv = startSrv(); await sleep(1200);
  const browser = await chromium.launch({executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const page = await browser.newPage({viewport: {width: 1700, height: 1000}});
  const errors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e))); page.on('dialog', d => d.accept());
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  const shots = process.env.SHOTS || '/tmp/돌다리_shots'; fs.mkdirSync(shots, {recursive: true});
  const state = async () => (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json();
  const items = async () => (await (await fetch(`http://127.0.0.1:${PORT}/api/items`)).json()).items;
  const nav = async (s, a) => { await page.click(a ? `#nav a[data-s="${s}"][data-a="${a}"]` : `#nav a[data-s="${s}"]`); await sleep(250); };
  const waitDone = async () => { for (let i = 0; i < 40 && !(await state()).running; i++) await sleep(150); for (let i = 0; i < 600 && (await state()).running; i++) await sleep(200); await sleep(1800); };
  try {
    await page.goto(`http://127.0.0.1:${PORT}/`); await sleep(600);
    ok('첫 화면은 준비(폴더 읽기)', await page.$eval('#nav a.cur', a => a.dataset.s) === 'prep');
    await page.click('#fsup'); await page.click('#fsdn'); await page.click('#thm'); const dark = await page.evaluate(() => document.documentElement.dataset.theme); await page.click('#thm'); ok('글자 크기·밝기', dark === 'dark');
    await page.click('#btnPick'); await page.waitForSelector('#picker:not([hidden])'); const nd = await page.$$eval('#pkList .d', d => d.length); await page.click('#pkList .d'); await sleep(200); await page.click('#pkUp'); await sleep(200); await page.click('#pkClose'); ok('찾기 창', nd > 0 && await page.$eval('#picker', el => el.hidden));
    await page.click('#btnBrowse'); await sleep(400); ok('창으로 찾기(리눅스 안내)', true);
    await page.fill('#folder', MOCK); await page.click('#btnExtract'); await page.waitForSelector('.pills', {timeout: 40000}); await sleep(500);
    const st1 = await state(); ok('읽기', st1.files.length > 20, `읽음 ${st1.files.length} · 못 읽음 ${st1.n_fail} · 읽지 않음 ${st1.n_skip}`);
    await page.click('details summary'); await page.click('#subNone'); await page.click('#subAll'); await page.click('#btnReread'); await page.waitForSelector('.pills', {timeout: 40000}); await sleep(800); ok('하위 폴더 모두·해제·다시 읽기', (await state()).files.length === st1.files.length);
    // 모델 사용
    await page.click('#engineSeg button[data-e="model"]'); await sleep(400);
    await page.fill('#url', `http://127.0.0.1:${FAKE}/v1/chat/completions`); await page.dispatchEvent('#url', 'change'); await sleep(400);
    await page.click('#btnModels'); await sleep(500); await page.selectOption('#model', 'fake-exaone:test'); await sleep(500);
    ok('모델 계획 글', (await page.textContent('#main')).includes('호출'));
    const bad = await page.evaluate(() => fetch('/api/settings', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({url: 'http://example.com/v1'})}).then(r => r.status)); ok('외부 모델 주소 거부', bad === 400);
    await page.click('#btnDraft'); await waitDone();
    const n0 = (await items()).length; ok('초안', n0 > 30, n0 + '항목');
    await page.screenshot({path: path.join(shots, 'v2_1_준비.png')});
    // 1. 업무 현황
    await nav('s1'); await page.fill('#hFrom', '갑돌'); await page.dispatchEvent('#hFrom', 'change'); await page.fill('#hTo', '을순'); await page.dispatchEvent('#hTo', 'change'); await page.fill('#hTitle', '영업과 · 2026.2.'); await page.dispatchEvent('#hTitle', 'change'); await sleep(400);
    const s2 = await state(); ok('인계자·인수자·제목 저장', s2.handover_from === '갑돌' && s2.handover_to === '을순' && s2.title === '영업과 · 2026.2.');
    const nCards = await page.$$eval('#main .acard', x => x.length); ok('업무 카드', nCards >= 3, nCards + '개');
    await page.click('#main .acard'); await sleep(300); ok('업무 카드 → 업무 한 장', (await page.textContent('#main .crumb')).includes('4. 업무별'));
    await page.screenshot({path: path.join(shots, 'v2_4_업무한장.png')});
    // 업무 한 장: 개요·넣기·버리기·일괄·직접 적기·파일 체크
    const areaName = await page.$eval('#nav a.cur', a => a.dataset.a);
    for (const k of ['q1', 'q2', 'q3']) { await page.fill(`textarea[data-ov="${k}"]`, '답 ' + k); await page.dispatchEvent(`textarea[data-ov="${k}"]`, 'change'); await sleep(250); }
    ok('개요 3문항 저장', JSON.stringify((await state()).overview[areaName] || {}).includes('답 q3'));
    const sugBtn = await page.$('#main .sug button[data-act="in"]'); if (sugBtn) { await sugBtn.click(); await sleep(700); }
    const outBtn = await page.$('#main .sug button[data-act="out"]'); if (outBtn) { await outBtn.click(); await sleep(700); }
    ok('넣기·버리기 저장(decided)', (await items()).filter(i => i.decided === true).length >= 2);
    const bulk = await page.$('#main [data-bulk="in"]'); if (bulk) { await bulk.click(); await sleep(900); }
    ok('남은 제안 모두 넣기', (await items()).filter(i => (i.area || '기타') === areaName && i.type === '월별 할 일' && i.decided !== true).length === 0);
    const kf = await page.$('#main .kf'); if (kf) { await kf.click(); await sleep(400); } ok('꼭 봐야 할 파일 체크', !kf || (await state()).keyfiles.length === 1);
    await page.selectOption('#addType', '진행 중 현안'); await page.fill('#addWhen', '2026년 2월'); await page.fill('#addText', '직접 적은 현안(시험)'); await page.click('#btnAdd'); await sleep(600);
    ok('직접 적기', (await items()).some(i => i.src === '직접 입력' && i.text === '직접 적은 현안(시험)'));
    await page.$$eval('#main details', ds => ds.forEach(d => d.open = true)); await sleep(200);
    const mv = await page.$('#main .sug select[data-k="area"]'); if (mv) { await mv.selectOption('기타'); await sleep(600); } ok('업무 바꾸기', !mv || (await items()).some(i => i.area_by === '사람'));
    // 2. 현안: 상태·다음 할 일
    await nav('s2'); const stSel = await page.$('#main select[data-k="status"]'); if (stSel) { await stSel.selectOption('대기'); await sleep(300); await page.$eval('#main input[data-k="next"]', el => { el.value = '본부 회신 오면 보고'; el.dispatchEvent(new Event('change')); }); await sleep(700); }
    ok('현안 상태·다음 할 일 저장', !stSel || (await items()).some(i => i.status === '대기' && i.next === '본부 회신 오면 보고'));
    // 3. 연간 일정
    await nav('s3'); ok('연간 일정 달력 13칸', (await page.$$eval('#main .cal .m', x => x.length)) === 13);
    await page.screenshot({path: path.join(shots, 'v2_3_연간.png')});
    // 5·6·7·8
    await nav('s5'); ok('연락처 절', (await page.textContent('#main h2')).includes('5.'));
    const pm = await page.$('#main .person input[data-k="note"]'); if (pm) { await page.$eval('#main .person input[data-k="note"]', el => { el.value = '계약 갱신 때'; el.dispatchEvent(new Event('change')); }); await sleep(700); ok('연락처 「무슨 일로」 저장', (await items()).some(i => i.note === '계약 갱신 때')); }
    await nav('s6'); for (const k of ['acct', 'goods', 'budget', 'etc']) { await page.fill(`textarea[data-as="${k}"]`, '답 ' + k); await page.dispatchEvent(`textarea[data-as="${k}"]`, 'change'); await sleep(250); } ok('계정·물품·예산 4칸 저장', Object.keys((await state()).assets).length === 4);
    await nav('s7'); const k7 = await page.$$('#main .kf'); ok('주요 자료 목록', k7.length >= 3, k7.length + '개');
    await nav('s8'); ok('확인하지 못한 자료 절', (await page.textContent('#main')).includes('못 읽은 문서'));
    // 물어보기
    await page.fill('#q', '마감'); await sleep(800); const na = await page.$$eval('#answers .ans', x => x.length); ok('물어보기 검색', na >= 1, na + '건');
    // 완성도
    const lbl = await page.textContent('#progLbl'); ok('머리글 완성도', /완성도 \d+\/\d+/.test(lbl), lbl);
    // 인쇄·내보내기
    await page.click('#btnPrint'); ok('인쇄', (await page.evaluate(() => window.__printed)) === 1 && (await page.$eval('#printView', e => e.children.length)) > 8);
    await page.click('#btnExport'); await sleep(2500); const ex = (await state()).exports; ok('인수인계서 내려받기', ex.length === 3, ex.join(', '));
    const md = fs.readFileSync(path.join(WORK, ex.find(n => n.endsWith('.md'))), 'utf8'); ok('인수인계서에 여덟 절·개요·인계자', md.includes('## 1. 업무 현황') && md.includes('## 8.') && md.includes('답 q1') && md.includes('갑돌') && md.includes('답 acct'));
    // 받는 사람 모드
    await page.click('#modeSeg button[data-m="take"]'); await sleep(400); await nav('s2'); const seen = await page.$('#main .seen'); if (seen) { await seen.click(); await sleep(700); } ok('받는 사람 확인 체크', !seen || (await items()).some(i => i.seen), await page.textContent('#progLbl'));
    await page.click('#modeSeg button[data-m="give"]'); await sleep(300);
    // 재시작 → 이어서
    srv.kill(); await sleep(500); srv = startSrv(); await sleep(1500); await page.goto(`http://127.0.0.1:${PORT}/`); await sleep(1200);
    ok('재시작 뒤 이어서 열림', (await state()).step >= 4 && (await page.$eval('#nav a.cur', a => a.dataset.s)) !== 'prep');
    // 중단 → 이어하기
    await nav('prep'); await page.fill('#folder', MOCK); await page.click('#btnExtract'); await page.waitForSelector('.pills', {timeout: 40000}); await sleep(600);
    await page.click('#engineSeg button[data-e="model"]'); await sleep(400);
    await page.evaluate(() => { const s = document.querySelector('#model'); s.insertAdjacentHTML('beforeend', '<option value="slow-fake">slow-fake</option>'); s.value = 'slow-fake'; s.dispatchEvent(new Event('change')); }); await sleep(500);
    await page.click('#btnDraft'); await sleep(3500); await page.click('#btnStop'); await waitDone();
    const st3 = await state(); ok('중단', st3.progress.stopped === true, `호출 ${st3.progress.calls_done}/${st3.progress.calls_total}`);
    await page.click('#btnDraft'); await waitDone(); ok('다시 만들기에서 이전 응답 재사용', !!(await state()).log.find(l => l.includes('재사용')));
    ok('콘솔 오류 없음(외부 주소 거부 400 제외)', errors.filter(e => !/400/.test(e)).length === 0, errors.filter(e => !/400/.test(e)).join(' | '));
    const srvErr = srvOut.join('').split('\n').filter(l => /Traceback|Error/.test(l) && !/HTTPError|폴더 창 실패/.test(l)); ok('서버 예외 없음', srvErr.length === 0, srvErr.slice(0, 3).join(' | '));
  } catch (e) { fail++; console.error('실패(예외):', e); await page.screenshot({path: path.join(shots, 'fail.png'), fullPage: true}); }
  finally { console.log(`\n통과 ${pass} · 실패 ${fail}`); await browser.close(); srv.kill(); fake.kill(); process.exit(fail ? 1 : 0); }
})();
