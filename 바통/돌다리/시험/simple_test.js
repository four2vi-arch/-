// 돌다리 v3.8 간편 기능 시험(11.2.): 물어보기 자동 검색어, 1-가 업무 설명 자동 초안(고쳐 쓰면 표시 풀림·결과물 「(자동 초안)」),
// 표 보기 고르기·한꺼번에 넣기·버리기(「일괄 넣음」 표시 없음), 1024 화면 넘침, 네 파일 한 번에 받기(.zip), 받는 사람 화면, 좁은 화면에서 목차가 물어보기 칸을 덮지 않음,
// 업무 키워드 자동 추출(「기타」로 남은 문서의 자주 나온 말로 새 업무 줄).
// 독립 검토 반영(11.2.): 고르기는 보이는 칸만·절을 옮기면 풀림, 2절은 문서 줄만, 「모두 고르기」로 넣으면 [일괄 넣음], 버리기는 묻고 해마다 오는 현안은 반복으로,
// 자동 초안은 「완료」로 세지 않음, 이미 넘긴 업무는 자동 초안을 비움, 검색어에서 이름·부서명·조사·겹치는 말 빼기, 받침에 맞는 조사,
// 물어보기 결과 「이 문서 줄로 가기」, 완성도 누르면 덜 된 업무로, 내려받은 뒤 고치면 zip이 예전 파일을 주지 않음(409), 키워드 적용 때 본문까지 보고 업무를 다시 나눔.
// 실행: node 시험/simple_test.js [작업폴더]   (web_test와 같이 모의데이터/가온우체국_모의업무폴더가 있어야 함)
const { chromium } = require('/opt/node22/lib/node_modules/playwright'); const { spawn } = require('child_process'); const fs = require('fs'), path = require('path');
const R = path.resolve(__dirname, '..'), PORT = 8805, MOCK = path.join(R, '모의데이터', '가온우체국_모의업무폴더');
const sleep = ms => new Promise(r => setTimeout(r, ms)); let pass = 0, fail = 0; const ok = (n, c, x) => { (c ? pass++ : fail++); console.log((c ? '통과  ' : '실패  ') + n + (x ? ' · ' + x : '')); };
const WORK0 = process.argv[2] || '/tmp/돌다리_simple시험'; fs.rmSync(WORK0, { recursive: true, force: true }); fs.mkdirSync(WORK0, { recursive: true }); const OUT = path.join(WORK0, 'out'); fs.mkdirSync(OUT, { recursive: true });
(async () => {
  try { await fetch(`http://127.0.0.1:${PORT}/api/state`); console.log(`실패  ${PORT} 포트에 다른 서버가 떠 있음(앞 시험이 남긴 것일 수 있음). 끄고 다시 돌리세요`); process.exit(1); } catch (e) { }
  const work = path.join(WORK0, 'w'); fs.mkdirSync(work, { recursive: true }); const srv = spawn('python3', ['-B', R + '/server.py', '--port', String(PORT), '--work', work, '--no-browser'], { stdio: 'ignore' });
  process.on('unhandledRejection', e => { console.log('실패  시험 중 오류: ' + String(e && e.message || e).split('\n')[0]); fail++; console.log(`\n통과 ${pass} · 실패 ${fail}`); try { srv.kill(); } catch (_) { } process.exit(1); });   // 시험이 중간에 멈춰도 서버를 남기지 않게
  const api = async (p, b) => (await fetch(`http://127.0.0.1:${PORT}${p}`, b ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) } : {})).json();
  for (let i = 0; i < 80; i++) { try { await api('/api/state'); break; } catch (e) { await sleep(250); } }
  await api('/api/settings', { org: '가온우체국 영업과 우편영업실', handover_from: '김전임(가상)', handover_to: '이신규(가상)', witness: '과장', handover_date: '2026-03-02' });
  await api('/api/extract', { folder: MOCK }); for (let i = 0; i < 100; i++) { const s = await api('/api/state'); if ((s.files || []).length && !s.extracting) break; await sleep(300); }
  await api('/api/draft', { model: '' }); for (let i = 0; i < 100; i++) { const s = await api('/api/state'); if (!s.running && s.n_items) break; await sleep(300); }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }); const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); const dialogs = []; p.on('dialog', d => { dialogs.push(d.message()); d.type() === 'prompt' ? d.accept('2026. 5. 1. 가상인 주무관에게 인계') : d.accept(); });
  await p.goto(`http://127.0.0.1:${PORT}/`); await sleep(1200);
  const go = async s => { await p.evaluate(x => document.querySelector(`#nav a[data-s="${x}"]`).click(), s); await sleep(600); const c = await p.$('#doneClose'); if (c) { await c.click(); await sleep(150); } };
  // 자동 검색어 말 고르기(같은 함수를 업무 설명 초안에도 씀)
  const kw = await p.evaluate(() => keywordsOf([{ title: '홍길동 과장 회의 결과 보고' }, { title: '홍길동 과장 재고를 점검' }, { title: '우편매출액 집계' }, { title: '우편매출 목표 점검' }, { title: '영업과 재고 점검' }, { title: '기한을 넘긴 재고 정리' }, { title: '우편영업실 기한 관리' }], 10));
  ok('자동 검색어: 이름·부서명은 빼고 조사는 떼고 겹치는 말은 하나만', !kw.some(w => /홍길동|영업과|우편영업실/.test(w)) && !kw.some(w => /[을를]$/.test(w)) && kw.includes('재고') && kw.includes('기한') && !(kw.includes('우편매출액') && kw.includes('우편매출')), kw.join(', '));
  const kw2 = await p.evaluate(() => keywordsOf(['매대', '재고', '후납', '소포', '회의', '실적', '점검', '교육'].map(w => ({ title: '우편물 ' + w })), 10, 0.5));
  ok('자동 검색어: 절반 넘는 문서에 나오는 말(우편물)은 단추로 내지 않음', !kw2.includes('우편물') && kw2.length >= 5, kw2.join(', '));
  ok('조사: 받침 있으면 「이」, 없으면 「가」', await p.evaluate(() => josa('요금후납', '이', '가') === '이' && josa('매대', '이', '가') === '가' && josa('EMS', '이', '가') === '가'));
  // 자동 검색어
  const chips = await p.$$eval('#qchips [data-q]', x => x.map(b => b.textContent));
  console.log('   자동 검색어:', chips.join(', '));
  ok('물어보기 아래 자동 검색어 단추(10개 안팎)', chips.length >= 5);
  await p.click('#qchips [data-q]'); await sleep(1200);
  ok('자동 검색어를 누르면 바로 찾음', (await p.inputValue('#q')) === chips[0] && /든 파일/.test(await p.innerText('#answers')), (await p.innerText('#answers')).slice(0, 60));
  await p.fill('#q', '요금후납'); await p.evaluate(() => $('#q').oninput()); await sleep(1200);
  ok('찾기 결과 머리말 조사: 「요금후납」이 든 파일', /「요금후납」이 든 파일/.test(await p.innerText('#answers')), (await p.innerText('#answers')).slice(0, 30));
  { const gb = await p.$('#answers [data-goto]'); ok('찾기 결과마다 「이 문서 줄로 가기」', !!gb);
    if (gb) { const gid = await gb.getAttribute('data-goto'); await gb.click(); await sleep(700);
      const r = await p.evaluate(id => { const el = document.querySelector(`#main [data-id="${id}"]`); const fl = document.querySelector('#main .flash'); const rc = el && el.getBoundingClientRect(); return { sec, found: !!el, flash: !!fl && (fl.dataset.id === id || !!fl.querySelector(`[data-id="${id}"]`)), inView: !!rc && rc.top >= 0 && rc.bottom <= innerHeight + 2 }; }, gid);
      ok('「이 문서 줄로 가기」를 누르면 그 줄이 있는 절로 가서 줄을 화면 가운데에 표시', r.found && r.flash && r.inView, JSON.stringify(r)); } }
  await p.setViewportSize({ width: 1280, height: 800 }); await sleep(300);
  const hit = await p.evaluate(() => { const q = document.querySelector('#q'); q.scrollIntoView({ block: 'center' }); const a = q.getBoundingClientRect(); const el = document.elementFromPoint(a.left + 8, a.top + a.height / 2); return el && el.id; });
  ok('1280 화면: 본문 아래 물어보기 칸을 왼쪽 목차가 덮지 않음', hit === 'q', hit);
  // 1-가 자동 초안
  await go('s1a'); const btn = await p.$('#btnAutoDesc'); ok('1-가 「빈 설명 n개 자동으로 채우기」 단추', !!btn, btn ? await btn.innerText() : '');
  if (btn) { await btn.click(); await sleep(900); }
  const descs = await p.$$eval('input[data-ov="desc"]', x => x.map(i => i.dataset.a + ' → ' + i.value)); descs.forEach(d => console.log('   ' + d));
  ok('업무 설명이 모두 채워지고 「자동 초안」 표시', descs.every(d => / → .+/.test(d)) && (await p.$$('.chip.st')).length >= descs.length, String((await p.$$('.chip.st')).length));
  { const bt = await p.$('#btnAutoDesc'); ok('다 채운 뒤 단추는 「빈 설명 없음」(누를 수 없음)', !!bt && await bt.isDisabled() && /빈 설명 없음/.test(await bt.innerText()), bt ? await bt.innerText() : '없음'); }
  { const nb = await p.innerText('#nav a[data-s="s1a"]'); const as = await p.innerText('aside');
    ok('자동 초안 그대로는 「작성」으로 세지 않음(목차 0/n, 오른쪽 「자동 초안 확인」)', /0\/\d/.test(nb) && /자동 초안/.test(as) && !/완료/.test(as.split('\n').filter(l => /자동 초안/.test(l)).join('')), nb.replace(/\s+/g, ' ')); }
  { await go('s2'); await p.click('#prog'); await sleep(700);
    const r = await p.evaluate(() => ({ sec, flash: !!document.querySelector('#main .q.flash'), focus: document.activeElement && document.activeElement.dataset.ov }));
    ok('위의 완성도를 누르면 1-가의 덜 된 첫 업무로 가서 설명 칸에 커서', r.sec === 's1a' && r.flash && r.focus === 'desc', JSON.stringify(r)); }
  { await go('s2'); await p.click('#fsup'); await p.click('#fsdn'); await sleep(300); await p.click('#btnPreview'); await sleep(1500);
    ok('완성도 옆 단추(글자 크기·미리보기)를 눌러도 1-가로 튀지 않음', (await p.evaluate(() => sec)) === 'preview' && (await p.$$('#main table.f')).length >= 3); await go('s1a'); }
  const first = await p.$('input[data-ov="desc"]'); const nChip0 = (await p.$$('.autochip')).length;
  await first.fill('우편매출 목표 관리와 진도점검'); await first.press('Tab'); await sleep(900);
  ok('고치면 그 칸의 「자동 초안」 표시가 바로 사라짐', (await p.$$('.autochip')).length === nChip0 - 1, `${nChip0} → ${(await p.$$('.autochip')).length}`);
  const ov = (await api('/api/state')).overview; const a0 = await first.getAttribute('data-a');
  ok('고쳐 쓰면 자동 초안 표시가 사라짐', ov[a0] && !ov[a0].desc_auto && ov[a0].desc === '우편매출 목표 관리와 진도점검', JSON.stringify(ov[a0]));
  // 이미 넘긴 업무: 자동 초안을 비우고 「인계 완료」만
  { const gs = await p.$$('[data-gone]'); const g = gs[gs.length - 1]; const ga = await g.getAttribute('data-gone'); await g.click(); await sleep(1000);
    const o = (await api('/api/state')).overview[ga] || {};
    ok('「이미 넘김」으로 표시한 업무는 자동 초안을 비움', !!o.gone && !o.desc && !o.desc_auto, ga + ' ' + JSON.stringify(o)); }
  // 표 보기 일괄 선택(1-다)
  await go('s1c'); const tv = await p.$('#viewSeg button[data-v="table"]'); if (tv) { await tv.click(); await sleep(400); }
  { const ob = await p.$('#main table.tri .doc-open'); if (ob) { await ob.click(); await sleep(800); }
    const tw = await p.evaluate(() => { const t = document.querySelector('#main table.tri'); const box = t.querySelector('td[colspan]'); return { ratio: t.offsetWidth / t.parentElement.clientWidth, span: box ? +box.getAttribute('colspan') : -1, cols: t.rows[0].cells.length }; });
    ok('표 보기에서 「원문 ▸」을 펼쳐도 표가 본문 폭을 다 쓰고 펼친 줄은 표의 칸 수만큼', tw.ratio > 0.95 && tw.span === tw.cols, JSON.stringify(tw));
    if (ob) { await ob.click(); await sleep(400); } }
  ok('표의 할 일·다음 칸에 마우스를 올리면 글 전체(잘린 글)', await p.$$eval('#main table.tri input[data-k="todo"]', x => x.length > 0 && x.every(i => (i.title || '').length > 0)));
  const picks = await p.$$('#main input.pick'); ok('표 보기 확인 전 줄마다 고르기 칸', picks.length >= 5, String(picks.length));
  // 고른 채 절을 옮기면 풀림(보이지 않는 줄이 바뀌던 것), 초안을 다시 만들어 번호가 바뀐 줄은 고르지 않음
  await picks[0].check(); await sleep(200); await go('s2');
  ok('고른 채 다른 절로 가면 고르기가 풀리고 띠가 사라짐', await p.evaluate(() => SEL.size === 0 && $('#selBar').hidden));
  await go('s1c');
  { const r = await p.evaluate(() => { const c = document.querySelector('#main input.pick'); SEL.set(+c.dataset.id, { title: '다른 제목(번호가 바뀐 줄)', all: false }); selBar(); return { n: SEL.size, hidden: $('#selBar').hidden }; });
    ok('번호는 같아도 제목이 다른 줄(초안을 다시 만든 뒤)은 고른 것으로 치지 않음', r.n === 0 && r.hidden, JSON.stringify(r)); }
  { const its0 = (await api('/api/items')).items; const y = its0.find(i => i.kind3 === '현안' && i.recur && i.recur.years && i.decided !== true && i.src !== '직접 입력');
    const pk = y && await p.$(`#main input.pick[data-id="${y.id}"]`);
    if (pk) { dialogs.length = 0; await pk.check(); await sleep(200); await p.click('#selBar [data-sa="out"]'); await sleep(1200); const y1 = (await api('/api/items')).items.find(i => i.id === y.id);
      ok('띠의 「버리기」는 먼저 묻고, 해마다 오는 현안은 버리지 않고 반복 업무로', dialogs.some(m => /버릴까요/.test(m) && /반복 업무로 옮깁니다/.test(m)) && y1.kind3 === '반복' && y1.keep === true, y.title.slice(0, 30)); }
    else { const c = await p.$('#main input.pick'); const id = +(await c.getAttribute('data-id')); dialogs.length = 0; await c.check(); await sleep(200); await p.click('#selBar [data-sa="out"]'); await sleep(1200);
      ok('띠의 「버리기」는 먼저 묻고 버림', dialogs.some(m => /버릴까요/.test(m)) && (await api('/api/items')).items.find(i => i.id === id).keep === false); } }
  await (await p.$$('#main input.pick'))[0].check(); await (await p.$$('#main input.pick'))[1].check(); await sleep(300);
  ok('두 줄 고르면 아래 「고른 줄 2건 넣기·버리기」 띠', /고른 줄 2건/.test(await p.innerText('#selBar')), (await p.innerText('#selBar')).slice(0, 40));
  const before = (await api('/api/items')).items.filter(i => i.decided === true).length;
  await p.click('#selBar [data-sa="in"]'); await sleep(1200);
  const its = (await api('/api/items')).items; const nIn = its.filter(i => i.decided === true).length - before;
  ok('「넣기」로 두 줄이 넣음(일괄 넣음 표시 없음)', nIn === 2 && its.filter(i => i.bulk).length === 0, `+${nIn}`);
  ok('넣은 뒤 띠가 사라짐', await p.$eval('#selBar', e => e.hidden));
  await p.click('#main input.pickall'); await sleep(300); const nAll = await p.$$eval('#main input.pick:checked', x => x.length);
  ok('「모두 고르기」는 그 표의 확인 전 줄을 모두 고름', nAll >= 1 && /고른 줄 \d+건/.test(await p.innerText('#selBar')), String(nAll));
  await p.click('#selBar [data-sa="none"]'); await sleep(400); ok('「고르기 풀기」', await p.$eval('#selBar', e => e.hidden) && (await p.$$('#main input.pick:checked')).length === 0);
  // 2절: 문서 줄만 고르기, 「모두 고르기」로 넣으면 [일괄 넣음]
  await go('s2');
  ok('2절 고르기 칸은 문서 줄에만(현안·반복은 그 절에서)', await p.evaluate(() => { const c = [...document.querySelectorAll('#main input.pick')]; return c.length > 0 && c.every(x => (ITEMS.find(i => i.id === +x.dataset.id) || {}).kind3 === '문서'); }));
  { const b0 = (await api('/api/items')).items.filter(i => i.bulk).length; await p.click('#main input.pickall'); await sleep(300); const nA = await p.$$eval('#main input.pick:checked', x => x.length);
    await p.click('#selBar [data-sa="in"]'); await sleep(1200); const b1 = (await api('/api/items')).items.filter(i => i.bulk).length;
    ok('「모두 고르기」로 넣은 줄은 하나씩 보지 않았으니 [일괄 넣음]', nA > 0 && b1 - b0 === nA, `${nA}건 → 일괄 ${b1 - b0}`); }
  await go('s1c');
  // 1024 넘침
  await p.setViewportSize({ width: 1024, height: 768 }); await sleep(500); await go('s1c');
  ok('1024 표 보기(고르기 칸 포함) 가로 넘침 없음', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 1024, String(await p.evaluate(() => document.documentElement.scrollWidth)));
  await go('s2'); ok('1024 2절 표 보기 가로 넘침 없음', (await p.evaluate(() => document.documentElement.scrollWidth)) <= 1024);
  await p.setViewportSize({ width: 1280, height: 800 });
  // 내려받기: 확인 창의 자동 초안 줄, zip 한 번에 받기
  dialogs.length = 0; await p.click('#btnExport'); await sleep(2500);
  ok('내보내기 확인 창에 「자동 초안 그대로」 수', dialogs.some(m => /업무 설명 \d+개가 자동 초안 그대로/.test(m)), (dialogs[0] || '').split('\n').find(l => /자동 초안/.test(l)));
  const md = fs.readFileSync(path.join(work, (await api('/api/state')).exports.find(n => n.endsWith('.md'))), 'utf8');
  ok('결과물 1-가: 고친 칸은 그대로, 넘긴 업무는 「인계 완료」만, 나머지는 「(자동 초안)」', md.includes('우편매출 목표 관리와 진도점검') && md.includes('[인계 완료] 2026. 5. 1. 가상인 주무관에게 인계') && (md.match(/\(자동 초안\)/g) || []).length === descs.length - 2, String((md.match(/\(자동 초안\)/g) || []).length));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dlAll')]); const zp = path.join(OUT, 'all.zip'); await dl.saveAs(zp);
  const zl = require('child_process').execSync(`python3 -c "import zipfile,sys;print('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))" ${zp}`).toString().trim().split('\n');
  ok('「네 파일 한 번에 받기(.zip)」에 .docx·.md·온나라·원본지문 4개', zl.length === 4 && ['.docx', '.md', '_온나라.txt', '_원본지문.csv'].every(s => zl.some(n => n.endsWith(s))), zl.join(', '));
  // 내려받은 뒤 고치면: 같은 화면의 상자가 바로 「다시 내려받으세요」로 바뀌고, zip 주소도 예전 파일을 주지 않음
  { await go('s1a'); await p.evaluate(() => { const old = document.querySelector('#exportBox'); if (!old) showExports(); }); const d = (await p.$$('input[data-ov="desc"]'))[1]; await d.fill('창구 매대 재고 확인과 공급업체 연락'); await d.press('Tab'); await sleep(900);
    ok('내려받은 뒤 고치면 그 화면의 결과물 상자가 바로 「고친 내용이 있습니다」(예전 zip·.docx 단추 숨김)', /내려받은 뒤 고친 내용/.test(await p.innerText('#exportBox')) && !(await p.$('#dlAll')));
    const r1 = await fetch(`http://127.0.0.1:${PORT}/api/download_all`); const r2 = await fetch(`http://127.0.0.1:${PORT}/api/download_all`, { headers: { Accept: 'text/html' } }); const t2 = await r2.text();
    ok('그때 zip 주소는 409(예전 파일을 묶어 주지 않음), 주소창으로 열면 읽을 수 있는 안내 쪽', r1.status === 409 && r2.status === 409 && /text\/html/.test(r2.headers.get('content-type')) && /다시 눌러/.test(t2) && /href="\/"/.test(t2), `${r1.status}/${r2.status}`);
    dialogs.length = 0; await p.click('#btnExport'); await sleep(2500); const r3 = await fetch(`http://127.0.0.1:${PORT}/api/download_all`);
    ok('다시 내려받으면 zip이 다시 됨', r3.status === 200 && /zip/.test(r3.headers.get('content-type'))); }
  // 받는 사람 화면: 자동 검색어는 보이고, 고르기 칸·띠는 없음
  await p.evaluate(() => [...document.querySelectorAll('#modeSeg button')].find(x => /받는 사람/.test(x.textContent)).click()); await sleep(600); await go('s1c');
  ok('받는 사람 화면: 고르기 칸 없음, 자동 검색어는 있음', (await p.$$('#main input.pick')).length === 0 && (await p.$$('#qchips [data-q]')).length >= 5);
  await go('s1a'); { const t = await p.innerText('#main'); ok('받는 사람 화면: 자동 초안은 「전임자 확인 전」으로(「고쳐 쓰세요」가 아님)', /자동 초안\(전임자 확인 전\)/.test(t) && !/고쳐 쓰세요/.test(t)); }
  await p.screenshot({ path: path.join(OUT, 'take.png') });
  // 업무 키워드 자동 추출: 키워드를 하나만 남겨 「기타」가 많을 때, 기타 문서의 자주 나온 말로 새 업무 줄을 더하면 기타가 줄어듦
  await p.evaluate(() => [...document.querySelectorAll('#modeSeg button')].find(x => /넘기는 사람/.test(x.textContent)).click()); await sleep(400);
  await api('/api/settings', { areas_text: '매출·실적: 매출, 실적, 목표' }); await api('/api/draft', { model: '' }); for (let i = 0; i < 100; i++) { const s = await api('/api/state'); if (!s.running) break; await sleep(300); }
  const n기타 = it => it.filter(i => (i.area || '기타') === '기타').length; const k0 = n기타((await api('/api/items')).items);
  await p.reload(); await sleep(1200); await go('prep'); await p.evaluate(() => { const d = [...document.querySelectorAll('details')].find(x => /업무 키워드/.test(x.textContent)); if (d) d.open = true; }); await sleep(200);
  ok('업무 키워드: 「기타」로 남은 문서의 자주 나온 말과 「이 말로 새 업무 줄 더하기」', !!(await p.$('#btnKwAdd')), '기타 ' + k0);
  if (await p.$('#btnKwAdd')) { await p.click('#btnKwAdd'); await sleep(300); const ta = await p.inputValue('#areas');
    ok('업무 키워드 맨 아래에 「새 업무: …」 줄', /\n새 업무: \S+/.test(ta), ta.split('\n').pop());
    await p.fill('#areas', ta.replace('새 업무:', '창구 운영:')); await p.click('#btnAreas'); await sleep(1500); await api('/api/draft', { model: '' }); for (let i = 0; i < 100; i++) { const s = await api('/api/state'); if (!s.running) break; await sleep(300); }
    const k1 = n기타((await api('/api/items')).items); ok('새 업무 줄을 적용하고 초안을 다시 만들면 「기타」가 줄어듦', k1 < k0, `${k0} → ${k1}`); }
  // 업무 키워드 「적용」만 눌렀을 때(초안을 다시 만들기 전)의 업무 = 초안을 다시 만든 업무(본문까지 봄. 제목만 보면 본문에만 키워드가 있는 문서가 「기타」로 갔다)
  { const AT = '창구전시판매: 매대, 재고, 공급업체\n요금후납·계약: 후납, 계약\n매출·실적: 매출, 실적, 목표';
    await api('/api/settings', { areas_text: AT }); const A1 = new Map((await api('/api/items')).items.filter(i => i.file).map(i => [(i.rkey || i.file), i.area]));
    await api('/api/draft', { model: '' }); for (let i = 0; i < 100; i++) { const s = await api('/api/state'); if (!s.running) break; await sleep(300); }
    const A2 = (await api('/api/items')).items.filter(i => i.file); const diff = A2.filter(i => A1.has(i.rkey || i.file) && A1.get(i.rkey || i.file) !== i.area);
    ok('업무 키워드 「적용」 직후의 업무가 초안을 다시 만든 업무와 같음(본문까지 봄)', A2.length > 10 && diff.length === 0, `${A2.length}줄 중 다름 ${diff.length}` + (diff[0] ? ` 예) ${diff[0].title.slice(0, 20)}: ${A1.get(diff[0].rkey || diff[0].file)} → ${diff[0].area}` : '')); }
  ok('화면 오류 없음', errs.length === 0, errs.join(' | '));
  await b.close(); srv.kill(); console.log(`\n통과 ${pass} · 실패 ${fail}`); setTimeout(() => process.exit(fail ? 1 : 0), 300);
})();
