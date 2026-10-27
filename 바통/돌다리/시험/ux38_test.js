// 돌다리 v3.8 화면·설정 시험: ② 인계 일자와 낡은 초안 띠, 초안 완료 띠, 넣기·버리기 토글, 다음 절 단추, 업무 머리 건수,
// 업무 키워드 「다른 기관 보기」, 최근 폴더, 폴더 창 못 띄울 때 화면 안 목록, 모델 주소 허용 옵션(--allow-model-host)과 키 칸·/v1/models 목록.
// 실행: node 시험/ux38_test.js [작업폴더]   (web_test와 같이 모의데이터/가온우체국_모의업무폴더가 있어야 함. 가짜 서버만 씀)
const {spawn} = require('child_process');
const http = require('http');
const fs = require('fs'), path = require('path');
const {chromium} = require('/opt/node22/lib/node_modules/playwright');
const HERE = path.resolve(__dirname, '..');
const WORK = process.argv[2] || '/tmp/돌다리_ux38시험';
const PORT = 8803, PORT2 = 8804, OAI = 11458;   // OAI: 「기관 서버」를 흉내 내는 OpenAI 호환 서버(127.0.0.2에 열어 이 PC 밖 주소처럼 봄)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MOCK = path.join(HERE, '모의데이터', '가온우체국_모의업무폴더');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { (cond ? pass++ : fail++); console.log((cond ? '통과  ' : '실패  ') + name + (extra ? ' · ' + extra : '')); };
// OpenAI 호환 가짜 서버: /api/tags 없음(404), /v1/models 목록, /v1/chat/completions JSON 답
const oai = http.createServer((req, res) => {
  if (req.url === '/v1/models') { res.writeHead(200, {'Content-Type': 'application/json'}); return res.end(JSON.stringify({object: 'list', data: [{id: 'fake-openai:test', object: 'model'}]})); }
  if (req.url === '/v1/chat/completions') { let b = ''; req.on('data', d => b += d); return req.on('end', () => { const auth = req.headers.authorization || ''; res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify({choices: [{message: {content: JSON.stringify({'요지': '가짜 요지(' + (auth ? '키 있음' : '키 없음') + ')', '할 일': '가짜 할 일', '기한': '', '담당': '', '상태': '진행'})}}]})); }); }
  res.writeHead(404, {'Content-Type': 'application/json'}); res.end('{"error":"없음"}');
});
(async () => {
  fs.rmSync(WORK, {recursive: true, force: true}); fs.mkdirSync(WORK, {recursive: true});
  await new Promise(r => oai.listen(OAI, '127.0.0.2', r));
  const startSrv = (port, work, extra) => { const s = spawn('python3', [path.join(HERE, 'server.py'), '--port', String(port), '--work', work, '--no-browser'].concat(extra || []), {stdio: ['ignore', 'pipe', 'pipe']}); s.out = []; s.stdout.on('data', d => s.out.push(String(d))); s.stderr.on('data', d => s.out.push(String(d))); return s; };
  const srv = startSrv(PORT, path.join(WORK, 'a'));
  const srv2 = startSrv(PORT2, path.join(WORK, 'b'), ['--allow-model-host', '127.0.0.2:' + OAI]);
  await sleep(1500);
  const browser = await chromium.launch({executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const page = await browser.newPage({viewport: {width: 1500, height: 950}});
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('dialog', d => d.accept());
  const api = (p, port) => fetch(`http://127.0.0.1:${port || PORT}${p}`).then(r => r.json());
  const post = (p, body, port) => fetch(`http://127.0.0.1:${port || PORT}${p}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const state = async port => api('/api/state', port);
  const items = async () => (await api('/api/items')).items;
  const cur = () => page.$eval('#nav a.cur', a => a.dataset.s);
  const nav = async s => { await page.click(`#nav a[data-s="${s}"]`); await sleep(300); };
  const waitDone = async () => { for (let i = 0; i < 40 && !(await state()).running; i++) await sleep(150); for (let i = 0; i < 600 && (await state()).running; i++) await sleep(200); await sleep(1800); };
  const setVal = async (sel, v) => page.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event('change')); }, v);
  try {
    await page.goto(`http://127.0.0.1:${PORT}/`); await sleep(700);
    // ① 폴더: 윈도 창을 못 띄우는 PC(리눅스)에서는 화면 안 목록으로 넘어감 · 「폴더 찾아보기…」가 주 단추
    ok('① 「폴더 찾아보기…」가 맨 앞 주 단추, 「화면에서 고르기」는 보조', await page.$eval('#btnBrowse', b => b.className.includes('btn') && b.textContent.includes('폴더 찾아보기')) && await page.$eval('#btnPick', b => b.textContent.includes('화면에서 고르기')));
    await page.click('#btnBrowse'); await page.waitForSelector('#picker:not([hidden])', {timeout: 20000}).catch(() => null);
    ok('폴더 창을 못 띄우면 화면 안 목록이 저절로 열림', !!(await page.$('#picker:not([hidden])')));
    await page.click('#pkClose');
    await page.fill('#folder', MOCK); await page.keyboard.press('Enter'); await page.waitForSelector('.pills', {timeout: 40000}); await sleep(600);
    const st1 = await state(); ok('주소 칸에서 Enter로 읽기', st1.files.length > 30, `읽음 ${st1.files.length}`);
    ok('최근 폴더에 들어감·목록 상자 표시', (st1.recent || [])[0] === MOCK && !!(await page.$('#recent')), JSON.stringify(st1.recent));
    // ② 인계 일자(1-가와 같은 값)
    ok('② 초안 만들기에 인계 일자 칸', !!(await page.$('#hDate2')));
    await setVal('#hDate2', '2026-03-02'); await sleep(600);
    ok('② 일자가 저장되고 기준일이 됨', (await state()).handover_date === '2026-03-02' && ((await state()).plan || {}).base_date === '2026-03-02', JSON.stringify(((await state()).plan || {}).base_date));
    // 업무 키워드 보기
    await page.click('summary:has-text("업무 키워드")'); await sleep(200);
    ok('「다른 기관 보기」 단추 3개', (await page.$$('[data-preset]')).length === 3);
    await page.click('[data-preset="일반 행정(공통)"]'); await sleep(900);
    const at = (await state()).areas_text || ''; ok('보기를 고르면 업무 키워드가 바뀌고 다시 나눔', at.includes('정보화·보안') && !at.includes('요금후납'), at.split('\n')[0]);
    await page.click('#btnAreasDefault'); await sleep(900); ok('「기본값으로」 되돌림', ((await state()).areas_text || '').includes('요금후납'));
    // 초안(규칙만) → 1-가가 비었으니 1-가로, 초안 완료 띠
    await page.click('#btnDraft'); await waitDone(); await sleep(400);
    ok('초안이 끝나면 1-가(인계자 비어 있음)로 가고 「초안 완료」 띠', (await cur()) === 's1a' && !!(await page.$('#doneBand')) && (await page.textContent('#doneBand')).includes('규칙만'), await cur());
    ok('1-가 일자가 ②와 같음', await page.$eval('#hDate', e => e.value) === '2026-03-02');
    await page.click('#doneClose'); await sleep(200); ok('띠 닫기', !(await page.$('#doneBand')));
    await setVal('#hFrom', '갑돌'); await sleep(150); await setVal('#hTo', '을순'); await sleep(150); await setVal('#hWit', '병수'); await sleep(900);
    ok('1-가 이름 저장(차례로 보냄)', (await state()).handover_from === '갑돌' && (await state()).handover_to === '을순' && (await state()).witness === '병수');
    // 다음 절 단추
    ok('절 아래 「다음」 단추', !!(await page.$('[data-step="s1b"]')));
    await page.click('[data-step="s1b"]'); await sleep(300); ok('「다음」으로 1-나', (await cur()) === 's1b');
    await nav('s4'); ok('마지막 절은 「다음」 대신 「인계·인수서 내려받기」', !!(await page.$('#stepExport')) && !(await page.$('.stepbar button.btn[data-step]')) && !!(await page.$('.stepbar [data-step="s3"]')));
    // 넣기·버리기 토글
    await nav('s1c');
    ok('업무 머리에 넣음·확인 전 건수', /넣음 \d+/.test(await page.textContent('#main')) && /확인 전 \d+/.test(await page.textContent('#main')));
    const rowId = await page.$eval('#main tr.sugrow[data-id]', r => r.dataset.id);
    const rowFile = ((await items()).find(i => i.id === +rowId) || {}).file;
    await page.click(`#main tr[data-id="${rowId}"] button[data-act="in"]`); await sleep(800);
    const r1 = await page.$eval(`#main tr[data-id="${rowId}"]`, r => ({y: r.querySelector('button.y.on') ? r.querySelector('button.y.on').textContent : '', n: !!r.querySelector('button.n'), sel: !!r.querySelector('.mv select')}));
    ok('넣기를 누르면 줄이 남고 「✓ 넣음」으로 채워지며 「버리기」도 그대로', r1.y.includes('넣음') && r1.n && r1.sel, JSON.stringify(r1));
    await page.click(`#main tr[data-id="${rowId}"] button[data-act="out"]`); await sleep(800);
    const r2 = await page.$eval(`#main tr[data-id="${rowId}"]`, r => ({n: r.querySelector('button.n.on') ? r.querySelector('button.n.on').textContent : '', y: !!r.querySelector('button.y')}));
    const it2 = (await items()).find(i => i.id === +rowId);
    ok('버리기로 바꾸면 「✓ 버림」, 항목 keep=false', r2.n.includes('버림') && r2.y && it2 && it2.keep === false && it2.decided === true, JSON.stringify(r2));
    await page.click(`#main tr[data-id="${rowId}"] button[data-act="in"]`); await sleep(800);
    ok('다시 넣기', ((await items()).find(i => i.id === +rowId) || {}).keep === true);
    await page.click('#viewSeg button[data-v="card"]'); await sleep(400);
    ok('카드 보기에도 토글', !!(await page.$(`#main .sug[data-id="${rowId}"] button.y.on`)) && !!(await page.$(`#main .sug[data-id="${rowId}"] button.n`)));
    await page.click('#viewSeg button[data-v="table"]'); await sleep(300);
    // 낡은 초안 띠: 초안 뒤 기준일을 바꾸면 띠 → 다시 만들기 → 사라짐
    await nav('prep'); await setVal('#hDate2', '2026-06-01'); await sleep(900); await nav('s1c');
    ok('초안 뒤 일자를 바꾸면 「기준일이 바뀌었습니다」 띠', !!(await page.$('#staleBand')) && (await page.textContent('#staleBand')).includes('2026-03-02'));
    await page.click('#btnRedraft'); await waitDone(); await sleep(500); await nav('s1c');
    const kept = (await items()).find(i => i.file === rowFile && !i.rkey) || {};   // 다시 만들면 번호가 바뀌니 파일로 찾는다. 기준일이 석 달 뒤로 가 기간 밖이 되어도 사람이 정한 항목은 남아야 한다
    ok('초안 다시 만들기 뒤 띠 사라짐·넣기 결정 유지(기간 밖이 되어도)', !(await page.$('#staleBand')) && kept.decided === true && kept.keep === true, JSON.stringify({decided: kept.decided, keep: kept.keep, carried: kept.carried}));
    // 모델 주소 허용: 기본 서버는 이 PC 밖 주소 거부, 옵션을 준 서버는 받고 키 칸·/v1/models 목록
    const remoteUrl = `http://127.0.0.2:${OAI}/v1/chat/completions`;
    ok('기본: 이 PC 밖 모델 주소 거부(400)·안내에 --allow-model-host', (await post('/api/settings', {url: remoteUrl})).status === 400 && !(await state()).remote_ok);
    const st2 = await state(PORT2); ok('--allow-model-host 서버: remote_ok·허용 목록', st2.remote_ok === true && (st2.allowed_hosts || []).includes('127.0.0.2'), JSON.stringify(st2.allowed_hosts));
    ok('옵션 서버는 그 주소를 받음(200)', (await post('/api/settings', {url: remoteUrl, key: 'k-test'}, PORT2)).status === 200);
    const models = await api('/api/models', PORT2); ok('Ollama가 아니면 /v1/models로 목록', (models.models || []).includes('fake-openai:test'), JSON.stringify(models));
    ok('검은 창에 「이 PC 밖 주소」 경고', srv2.out.join('').includes('모델 서버 허용') && srv2.out.join('').includes('이 PC 밖'));
    const page2 = await browser.newPage({viewport: {width: 1500, height: 950}}); page2.on('dialog', d => d.accept());
    await page2.goto(`http://127.0.0.1:${PORT2}/`); await sleep(700); await page2.fill('#folder', MOCK); await page2.click('#btnExtract'); await page2.waitForSelector('.pills', {timeout: 40000}); await sleep(500);
    await page2.click('#engineSeg button[data-e="model"]'); await sleep(500);
    ok('허용했을 때만 키 칸이 보임', !!(await page2.$('#key')) && !(await page.$('#key')));
    // 키는 화면에 되돌려 주지 않고(key_set만), 세션 파일에도 남지 않는다. 빈 칸으로 저장해도 지워지지 않고 「키 지우기」로만 지운다
    const stK = await state(PORT2); const sessTxt = fs.existsSync(path.join(WORK, 'b', '세션.json')) ? fs.readFileSync(path.join(WORK, 'b', '세션.json'), 'utf8') : '';
    ok('키 값은 /api/state에 없고 key_set만, 세션.json에도 없음', !('key' in stK) && stK.key_set === true && !sessTxt.includes('k-test'), JSON.stringify({key: stK.key, key_set: stK.key_set, inFile: sessTxt.includes('k-test')}));
    ok('키 칸은 비어 있고 「저장됨」 안내·「키 지우기」 단추', (await page2.$eval('#key', e => e.value)) === '' && (await page2.$eval('#key', e => e.placeholder)).includes('저장됨') && !!(await page2.$('#btnKeyClear')));
    await page2.fill('#hDate2', '2026-03-02'); await page2.$eval('#hDate2', e => e.dispatchEvent(new Event('change'))); await sleep(800);
    ok('다른 설정을 저장해도 키는 남음', (await state(PORT2)).key_set === true);
    await page2.click('#btnKeyClear'); await sleep(800);
    ok('「키 지우기」로 지움', (await state(PORT2)).key_set === false && !(await page2.$('#btnKeyClear')));
    await page2.close();
    // 4절 연락처: 줄마다 「빼기」, 「휴대전화 모두 빼기」, 「되살리기」(개인정보 최소화)
    await nav('s4'); await sleep(300);
    const n0 = (await page.$$('#main .person')).length, mob0 = (await state()).contacts.filter(c => c.mobile).length;
    const firstPh = await page.$eval('#main .person [data-excl]', b => b.dataset.excl);
    await page.click('#main .person [data-excl]'); await sleep(900);
    ok('「빼기」를 누르면 그 번호가 목록·상태에서 빠지고 「뺀 번호」에 보임', (await page.$$('#main .person')).length === n0 - 1 && ((await state()).contact_excl || [])[0] === firstPh && !!(await page.$(`[data-restore="${firstPh}"]`)), JSON.stringify((await state()).contact_excl));
    await page.click(`[data-restore="${firstPh}"]`); await sleep(900);
    ok('「되살리기」로 되돌림', (await page.$$('#main .person')).length === n0 && ((await state()).contact_excl || []).length === 0);
    if (mob0) { await page.click('#btnExclMobile'); await sleep(900); ok('「휴대전화 모두 빼기」', (await state()).contacts.filter(c => c.mobile).length === 0 && ((await state()).contact_excl || []).length === mob0, JSON.stringify((await state()).contact_excl)); }
    else ok('「휴대전화 모두 빼기」(모의 폴더에 휴대전화 없음: 건너뜀)', true);
    ok('페이지 오류 없음', errors.length === 0, errors.join(' / '));
  } catch (e) { ok('예외 없음', false, String(e && e.stack || e)); }
  finally {
    console.log(`\n통과 ${pass} · 실패 ${fail}`);
    await browser.close().catch(() => {}); srv.kill(); srv2.kill(); oai.close();
    setTimeout(() => process.exit(fail ? 1 : 0), 300);
  }
})();
