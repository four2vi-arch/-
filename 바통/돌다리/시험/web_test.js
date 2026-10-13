// 돌다리 v3 화면 자동 시험: 가짜 Ollama + server.py를 띄우고 서식 일곱 절과 모든 단추를 누른다.
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
  const nav = async s => { await page.click(`#nav a[data-s="${s}"]`); await sleep(250); };
  const waitDone = async () => { for (let i = 0; i < 40 && !(await state()).running; i++) await sleep(150); for (let i = 0; i < 600 && (await state()).running; i++) await sleep(200); await sleep(1800); };
  const setVal = async (sel, v) => page.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event('change')); }, v);
  try {
    await page.goto(`http://127.0.0.1:${PORT}/`); await sleep(600);
    ok('첫 화면은 준비(폴더 읽기)', await page.$eval('#nav a.cur', a => a.dataset.s) === 'prep');
    await page.click('#fsup'); await page.click('#fsdn'); await page.click('#thm'); const dark = await page.evaluate(() => document.documentElement.dataset.theme); await page.click('#thm'); ok('글자 크기·밝기', dark === 'dark');
    await page.click('#btnPick'); await page.waitForSelector('#picker:not([hidden])'); const nd = await page.$$eval('#pkList .d', d => d.length); await page.click('#pkList .d'); await sleep(200); await page.click('#pkUp'); await sleep(200); await page.click('#pkClose'); ok('찾기 창', nd > 0 && await page.$eval('#picker', el => el.hidden));
    await page.fill('#folder', MOCK); await page.click('#btnExtract'); await page.waitForSelector('.pills', {timeout: 40000}); await sleep(500);
    const st1 = await state(); ok('읽기', st1.files.length > 30, `읽음 ${st1.files.length} · 못 읽음 ${st1.n_fail} · 읽지 않음 ${st1.n_skip}`);
    ok('문서 단위 계획(현안·반복·기간 밖)', st1.plan && st1.plan.n_issue > 0 && st1.plan.n_recur > 0 && st1.plan.n_old >= 0, JSON.stringify({n_items: st1.plan.n_items, n_issue: st1.plan.n_issue, n_recur: st1.plan.n_recur, n_old: st1.plan.n_old}));
    await page.click('details summary'); await page.click('#subNone'); await page.click('#subAll'); await page.click('#btnReread'); await page.waitForSelector('.pills', {timeout: 40000}); await sleep(800); ok('하위 폴더 모두·해제·다시 읽기', (await state()).files.length === st1.files.length);
    // 기간 바꾸기
    await page.selectOption('#months', '36'); await sleep(500); const p36 = (await state()).plan; await page.selectOption('#months', '12'); await sleep(500); const p12 = (await state()).plan;
    ok('기간 36개월이 12개월보다 문서가 많거나 같음', p36.n_items >= p12.n_items, `${p36.n_items} ≥ ${p12.n_items}`);
    // 모델 사용
    await page.click('#engineSeg button[data-e="model"]'); await sleep(400);
    await page.fill('#url', `http://127.0.0.1:${FAKE}/v1/chat/completions`); await page.dispatchEvent('#url', 'change'); await sleep(400);
    await page.click('#btnModels'); await sleep(500); await page.selectOption('#model', 'fake-exaone:test'); await sleep(500);
    ok('모델 계획 글(한 건에 한 번)', (await page.textContent('#main')).includes('한 건에 한 번'));
    const bad = await page.evaluate(() => fetch('/api/settings', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({url: 'http://example.com/v1'})}).then(r => r.status)); ok('외부 모델 주소 거부', bad === 400);
    await page.click('#btnDraft'); await waitDone();
    const it0 = await items(); ok('초안: 문서 한 건 = 항목 한 개', it0.length > 15 && it0.length < 60 && it0.every(i => i.title && i.kind3), it0.length + '건');
    ok('모델 요지가 붙음', it0.some(i => i.src === '모델' && i.summary), it0.filter(i => i.src === '모델').length + '건');
    ok('매뉴얼 대조(문서번호 3개 읽음·미반영 공문 표시)', (await state()).info.manual_refs === 3 && (await state()).info.n_unreflected >= 1, `미반영 ${(await state()).info.n_unreflected}`);
    ok('반복 업무를 찾음', it0.some(i => i.kind3 === '반복' && i.recur && i.recur.years.length >= 2));
    await page.screenshot({path: path.join(shots, 'v3_1_준비.png')});
    // 1-가
    await nav('s1a'); await setVal('#hFrom', '갑돌'); await setVal('#hTo', '을순'); await setVal('#hWit', '병수'); await setVal('#hDate', '2026-02-20'); await setVal('#hOrg', '가온우체국 영업과'); await sleep(500);
    const s2 = await state(); ok('인계자·인수자·입회자·일자·소속 저장', s2.handover_from === '갑돌' && s2.handover_to === '을순' && s2.witness === '병수' && s2.handover_date === '2026-02-20' && s2.org === '가온우체국 영업과');
    const firstArea = await page.$eval('#main input[data-ov="desc"]', el => el.dataset.a);
    await setVal('#main input[data-ov="desc"]', '설명 한 줄'); await sleep(300); await setVal('#main input[data-ov="tip"]', '조심할 것'); await sleep(400);
    ok('1-가에 연혁·현황 카드', (await page.$$eval('#main .sug', x => x.length)) >= 2 && (await page.textContent('#main')).includes('현황 자료'), (await page.$$eval('#main .sug', x => x.length)) + '장');
    const hb = await page.$('#main [data-bulk="in"]'); if (hb) { await hb.click(); await sleep(900); } ok('연혁·현황 제안 모두 넣기', (await items()).filter(i => (i.kind3 === '연혁' || i.kind3 === '현황') && i.decided !== true).length < (await items()).filter(i => i.kind3 === '연혁' || i.kind3 === '현황').length);
    ok('업무 설명·조심할 것 저장', ((await state()).overview[firstArea] || {}).desc === '설명 한 줄' && ((await state()).overview[firstArea] || {}).tip === '조심할 것');
    await page.screenshot({path: path.join(shots, 'v3_2_담당업무.png')});
    // 1-나 반복
    await nav('s1b'); ok('반복 업무 달력 12칸', (await page.$$eval('#main .cal .m', x => x.length)) === 12);
    const inB = await page.$('#main .sug button[data-act="in"]'); if (inB) { await inB.click(); await sleep(700); }
    ok('반복 업무 넣기 → 달력에 듦', (await page.$$eval('#main .cal .m:not(.empty)', x => x.length)) >= 1);
    // 1-다 현안
    await nav('s1c'); const nSug = (await items()).filter(i => i.kind3 === '현안' && i.decided !== true).length;
    const inC = await page.$('#main .sug button[data-act="in"]'); await inC.click(); await sleep(700);
    const outC = await page.$('#main .sug button[data-act="out"]'); await outC.click(); await sleep(700);
    ok('현안 넣기·버리기 저장', (await items()).filter(i => i.kind3 === '현안' && i.decided === true).length >= 2);
    await page.selectOption('#main select[data-k="status"]', '미결'); await sleep(300); await setVal('#main input[data-k="next"]', '본부 회신 오면 보고'); await sleep(700);
    ok('현안 상태 미결·다음 할 일 저장', (await items()).some(i => i.status === '미결' && i.next === '본부 회신 오면 보고'));
    await setVal('#main input[data-k="todo"]', '후임자 할 일(시험)'); await sleep(700); ok('할 일 직접 고침(todo_by=사람)', (await items()).some(i => i.todo === '후임자 할 일(시험)' && i.todo_by === '사람'));
    const bulk = await page.$('#main [data-bulk="in"]'); if (bulk) { await bulk.click(); await sleep(900); }
    ok('남은 현안 제안 모두 넣기', (await items()).filter(i => i.kind3 === '현안' && i.decided !== true).length === 0, `제안 ${nSug}개였음`);
    await page.fill('#addTitle', '직접 적은 현안(시험)'); await page.fill('#addTodo', '전화하기'); await page.click('#btnAdd'); await sleep(600);
    ok('직접 적기', (await items()).some(i => i.src === '직접 입력' && i.title === '직접 적은 현안(시험)' && i.kind3 === '현안'));
    await page.selectOption('#main .sug select[data-k="area"]', '기타'); await sleep(600); ok('업무 바꾸기', (await items()).some(i => i.area_by === '사람' && i.area === '기타'));
    await page.screenshot({path: path.join(shots, 'v3_3_현안.png')});
    // 1-라 미결
    await nav('s1d'); ok('미결 절에 미결 현안', (await page.$$eval('#main input[data-k="next"]', x => x.map(e => e.value))).includes('본부 회신 오면 보고'));
    // 온나라 복사
    const onn = await (await fetch(`http://127.0.0.1:${PORT}/api/onnara`)).json(); ok('온나라 절별 글', onn.sections.length >= 7 && onn.sections.some(s => s.name.startsWith('라.') && s.text.includes('본부 회신')), onn.sections.map(s => s.name).join(' / '));
    await page.click('#btnCopy'); await sleep(400); ok('복사 단추', true);
    // 2·3·4
    await nav('s2'); ok('관련 문서 현황에 ★ 미반영 표시', (await page.textContent('#main')).includes('매뉴얼 미반영'));
    await nav('s3'); for (const k of ['acct', 'goods', 'budget', 'etc']) { await page.fill(`textarea[data-as="${k}"]`, '답 ' + k); await page.dispatchEvent(`textarea[data-as="${k}"]`, 'change'); await sleep(250); } ok('물품·예산 4칸 저장', Object.keys((await state()).assets).length === 4);
    await nav('s4'); const np = await page.$$eval('#main .person', x => x.length); ok('연락처(같은 번호 하나로)', np >= 2, np + '명'); ok('매뉴얼 안내·못 읽은 자료', (await page.textContent('#main')).includes('매뉴얼') && (await page.textContent('#main')).includes('못 읽은 문서'));
    // 물어보기
    await page.fill('#q', '마감'); await sleep(800); const na = await page.$$eval('#answers .ans', x => x.length); ok('물어보기 검색', na >= 1, na + '건');
    const lbl = await page.textContent('#progLbl'); ok('머리글 완성도', /완성도 \d+\/\d+/.test(lbl), lbl);
    // 인쇄·내보내기
    await page.click('#btnPrint'); ok('인쇄', (await page.evaluate(() => window.__printed)) === 1 && (await page.$eval('#printView', e => e.children.length)) > 8);
    await page.click('#btnExport'); await sleep(2500); const ex = (await state()).exports; ok('내려받기 4개(md·docx·온나라 txt·원본지문)', ex.length === 4, ex.join(', '));
    const md = fs.readFileSync(path.join(WORK, ex.find(n => n.endsWith('.md'))), 'utf8');
    ok('서식 차례(1-가·나·다·라, 2, 3, 4, 붙임 1·2)와 입력값', ['### 가. 담당 업무', '### 나. 주요 업무계획', '### 다. 현안사항', '### 라. 주요 미결사항', '## 2. 관련 문서 현황', '## 3. 주요 물품', '## 4. 그 밖의 참고사항', '## 붙임 1. 참고 문서 목록', '## 붙임 2.', '현황 자료:'].every(k => md.includes(k)) && md.includes('병수') && md.includes('설명 한 줄') && md.includes('답 acct') && md.includes('★'));
    ok('넣기 전 제안도 「확인 전」으로 실림', md.includes('확인 전'));
    const txt = fs.readFileSync(path.join(WORK, ex.find(n => n.endsWith('_온나라.txt'))), 'utf8'); ok('온나라 txt', txt.includes('가. 담당 업무') && txt.includes('본부 회신 오면 보고'));
    // 받는 사람 모드
    await page.click('#modeSeg button[data-m="take"]'); await sleep(400); await nav('s1c'); const seen = await page.$('#main .seen'); if (seen) { await seen.click(); await sleep(700); } ok('받는 사람 확인 체크', !!seen && (await items()).some(i => i.seen), await page.textContent('#progLbl'));
    await page.click('#modeSeg button[data-m="give"]'); await sleep(300);
    // 재시작 → 이어서
    srv.kill(); await sleep(500); srv = startSrv(); await sleep(1500); await page.goto(`http://127.0.0.1:${PORT}/`); await sleep(1200);
    ok('재시작 뒤 이어서 열림', (await state()).step >= 4 && (await page.$eval('#nav a.cur', a => a.dataset.s)) !== 'prep');
    // 고르는 중에는 화면을 다시 그리지 않는다: 모델 목록에 초점을 두고 폴링이 지나가도 같은 요소가 남아야 한다
    await nav('prep'); await page.click('#engineSeg button[data-e="model"]'); await sleep(300); await page.focus('#model'); await page.evaluate(() => { window.__sel = document.querySelector('#model'); }); await page.evaluate(() => refresh()); await sleep(600);
    ok('모델 고르는 중 화면 유지', await page.evaluate(() => window.__sel === document.querySelector('#model')));
    // 다시 만들기 → 결정 유지 + 이전 응답 재사용
    const before = (await items()).filter(i => i.decided === true && i.file).length;
    await nav('prep'); await page.click('#btnDraft'); await waitDone();
    const after = await items(); ok('다시 만들어도 넣기·버리기·상태·메모 유지', after.filter(i => i.decided === true && i.file).length >= before - 1 && after.some(i => i.next === '본부 회신 오면 보고') && after.some(i => i.src === '직접 입력'), `${before} → ${after.filter(i => i.decided === true && i.file).length}`);
    ok('다시 만들기에서 이전 응답 재사용', !!(await state()).log.find(l => l.includes('재사용')));
    // 매뉴얼 파일 직접 지정(폴더 밖)
    await setVal('#manualPath', path.join(MOCK, '04_매뉴얼·회의록(워드)', '우편영업실_업무매뉴얼_v3.docx')); await sleep(400); await page.click('#engineSeg button[data-e="rules"]'); await sleep(300); await page.click('#btnDraft'); await waitDone();
    ok('매뉴얼 파일 직접 지정', (await state()).info.manual_refs === 3 && !!(await state()).log.find(l => l.includes('매뉴얼 파일 지정')));
    await setVal('#manualPath', ''); await sleep(300); await page.click('#engineSeg button[data-e="model"]'); await sleep(400);
    // 중단
    await page.evaluate(() => { const s = document.querySelector('#model'); s.insertAdjacentHTML('beforeend', '<option value="slow-fake">slow-fake</option>'); s.value = 'slow-fake'; s.dispatchEvent(new Event('change')); }); await sleep(500);
    await page.click('#btnDraft'); await sleep(2500); await page.click('#btnStop'); await waitDone();
    const st3 = await state(); ok('중단', st3.progress.stopped === true, `호출 ${st3.progress.calls_done}/${st3.progress.calls_total}`);
    ok('콘솔 오류 없음(외부 주소 거부 400 제외)', errors.filter(e => !/400/.test(e)).length === 0, errors.filter(e => !/400/.test(e)).join(' | '));
    const srvErr = srvOut.join('').split('\n').filter(l => /Traceback|Error/.test(l) && !/HTTPError|폴더 창 실패/.test(l)); ok('서버 예외 없음', srvErr.length === 0, srvErr.slice(0, 3).join(' | '));
  } catch (e) { fail++; console.error('실패(예외):', e); await page.screenshot({path: path.join(shots, 'fail.png'), fullPage: true}); }
  finally { console.log(`\n통과 ${pass} · 실패 ${fail}`); await browser.close(); srv.kill(); fake.kill(); process.exit(fail ? 1 : 0); }
})();
