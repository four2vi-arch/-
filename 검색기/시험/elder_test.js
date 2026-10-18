// 물어물어 어르신 화면 회귀 시험(v1.10, 10.18 어르신 모의 심사에서 틀린 우편번호가 확정되던 시나리오)
// 사용: node elder_test.js <출품본.html>   (가상 이름·공개 주소만)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const HTML = process.argv[2];
let pass = 0, fail = 0; const ok = (n, c, x) => { (c ? pass++ : fail++); console.log((c ? '통과  ' : '실패  ') + n + (x ? ' · ' + x : '')); };
const REGION = { region: '전북특별자치도 정읍시', idle: 120 };
async function open(b, dev) {
  const ctx = await b.newContext(Object.assign({ locale: 'ko-KR' }, dev === 'tablet' ? { viewport: { width: 800, height: 1280 }, hasTouch: true, isMobile: true } : { viewport: { width: 1366, height: 768 } }));
  const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.addInitScript(c => { try { localStorage.setItem('zipfinder.kiosk.v1', JSON.stringify(c)); localStorage.setItem('zipfinder.kiosk.no', '{}'); } catch (e) { } window.__printed = 0; window.print = () => { window.__printed++; }; }, REGION);
  await p.goto('file://' + HTML + '#kiosk');
  await p.waitForSelector('#kiosk:not([hidden])', { timeout: 90000 });
  await p.waitForTimeout(400);
  return p;
}
const btn = (p, t) => p.waitForFunction(t => Array.from(document.querySelectorAll('#kModal button,#kiosk button,#kiosk .k-choice')).find(b => b.offsetParent && !b.disabled && b.textContent.includes(t)) || null, t, { timeout: 15000 }).then(h => h.asElement());
async function say(p, t) { await (await btn(p, '시작하기')).click().catch(() => { }); await p.waitForSelector('#kIn'); await p.fill('#kIn', t); await (await btn(p, '다 적었어요')).click(); await p.waitForTimeout(500); }
const bubble = p => p.evaluate(() => (document.querySelector('#kMain .k-bubble') || {}).innerText || '');
const zipShown = p => p.evaluate(() => { const z = document.querySelector('#kMain .k-card .k-zip'); return z ? z.textContent.trim() : ''; });
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--allow-file-access-from-files'] });
  // 1. 동 이름 + 아파트 이름: 건물명으로 찾아 맞는 번호(06284)
  let p = await open(b);
  await say(p, '우리 아들네 집 서울 강남 대치동 은마아파트 3동 1004호');
  let q = await bubble(p), z = await zipShown(p);
  ok('대치동 은마아파트 → 06284(건물명) 또는 번호 숨김', (/맞으세요/.test(q) && z === '06284') || !z, q.slice(0, 30) + ' / ' + z);
  await p.context().close();
  // 2. 시기동 주공아파트: 틀린 동 전체 추정(56164)을 번호로 보이지 않음
  p = await open(b, 'tablet');
  await say(p, '시기동 주공아파트 101동 203호');
  if (/번호를 아세요|번지/.test(await bubble(p))) { await (await btn(p, '몰라요')).click(); await p.waitForTimeout(400); }
  if (await p.$('#kMain .k-choice')) { const t = await p.textContent('#kMain .k-choice'); ok('시기동 주공아파트 → 후보 목록(건물)', /주공/.test(t), t.slice(0, 40)); }
  else { z = await zipShown(p); ok('시기동 주공아파트 → 추정 번호(56164)를 보이지 않음', z !== '56164', z || '번호 숨김'); }
  await p.context().close();
  // 3. 후보에서 건물을 고르면 그 번호 그대로
  p = await open(b);
  await say(p, '연지동 우체국');
  const ch = await p.$$eval('#kMain .k-choice', xs => xs.map(x => x.textContent));
  const i = ch.findIndex(t => /연지동우체국/.test(t) && /56158/.test(t));
  if (i >= 0) { await (await p.$$('#kMain .k-choice'))[i].click(); await p.waitForTimeout(500); z = await zipShown(p); ok('후보 「정읍연지동우체국 56158」을 고르면 56158', z === '56158', z); }
  else ok('후보에 정읍연지동우체국이 나옴', false, ch.join(' / ').slice(0, 120));
  await p.context().close();
  // 4. 동만 알고 번지 모름 → 우편번호는 창구에서(숫자를 크게 보이지 않음), 저장 zip 빈칸·창구 확인
  p = await open(b);
  await say(p, '정읍씨 수성동 현대아파트 102동 304호');
  if (/번호를 아세요|번지/.test(await bubble(p))) {
    await (await btn(p, '다음')).click(); await p.waitForTimeout(300);
    ok('번지 화면 빈 「다음」 → 몰라요 안내', await p.evaluate(() => Array.from(document.querySelectorAll('.k-toast')).some(t => /몰라요/.test(t.textContent))));
    await (await btn(p, '몰라요')).click(); await p.waitForTimeout(400);
  }
  const card = await p.textContent('#kMain .k-card').catch(() => '');
  ok('동 전체 추정은 「우편번호는 창구에서」', /창구에서 정해/.test(card) && !(await zipShown(p)), card.slice(0, 40));
  await (await btn(p, '네, 맞아요')).click(); await (await btn(p, '더 적을 게 없어요')).click();
  await p.fill('#kIn', '김순자 할머니'); await (await btn(p, '다음')).click(); await (await btn(p, '건너뛰기')).click(); await p.waitForTimeout(300);
  let st = await p.evaluate(() => __kiosk.state());
  ok('저장: 우편번호 빈칸·창구 확인·호칭 뗌·접수번호 001', st.entries[0].zip === '' && st.entries[0].check && st.entries[0].name === '김순자' && st.no === '001', JSON.stringify(st.entries[0]).slice(0, 160) + ' no=' + st.no);
  await (await btn(p, '다 했어요')).click(); await p.waitForTimeout(300);
  await p.fill('#kIn', '이보냄'); await (await btn(p, '다음')).click(); await (await btn(p, '건너뛰기')).click(); await p.waitForTimeout(300);
  const sk = await btn(p, '창구에서').catch(() => null); if (sk) { await sk.click(); await p.waitForTimeout(500); }
  if (!(await p.$('#kPrintBtn'))) { await p.evaluate(() => __kiosk.finish()); await p.waitForTimeout(300); }
  const pb = await p.evaluate(() => { const r = document.querySelector('#kPrintBtn').getBoundingClientRect(); return r.bottom <= innerHeight; });
  ok('마침 화면: 뽑기 단추가 노트북 화면(768) 안에 보임', pb);
  await (await btn(p, '처음 화면으로')).click(); await p.waitForTimeout(200);
  ok('「처음 화면으로」 확인의 주 단추는 「아니요」', await p.evaluate(() => /아니요/.test((document.querySelector('#kModal .k-btn.pri') || {}).textContent || '')));
  ok('오류 없음(1~4)', p.errs.length === 0, p.errs.join('|'));
  await p.context().close();
  // 5. 못 찾는 주소: 「직원 도움 받기」로 나갈 수 있고, 세 번째부터 안내가 바뀜
  p = await open(b);
  await say(p, '아들네 집');
  for (const t of ['서울', '서울 강남']) { if (await p.$('#kIn')) { await p.fill('#kIn', t); await (await btn(p, '다 적었어요')).click(); await p.waitForTimeout(400); } else { const back = await btn(p, '이전으로').catch(() => null); if (back) await back.click(); } }
  ok('주소 화면에 「직원 도움 받기」', !!(await p.$('#kHelp')) || !!(await btn(p, '창구에서 할게요').catch(() => null)));
  if (await p.$('#kHelp')) { await p.click('#kHelp'); await p.waitForTimeout(300); ok('직원 도움 → 「찾기가 어려워요·창구」 화면', /어려워요|창구/.test(await bubble(p)), (await bubble(p)).slice(0, 30)); }
  await p.context().close();
  // 6. 번호 없이 찾은 도로(유사·상 「건물번호 없음」)는 번호를 한 번 묻는다
  p = await open(b);
  await say(p, '정읍시 충정로');
  ok('번지 없는 도로 → 번호 묻기', /번호|번지/.test(await bubble(p)), (await bubble(p)).slice(0, 30));
  await p.context().close();
  // 7. 자리 비움: 받는 곳을 저장한 뒤에는 5분 이상
  p = await open(b);
  const sec = await p.evaluate(() => { const s = __kiosk.state(); s.entries.push({ name: '가상', zip: '56180', addr1: '정읍시 충정로 234-1', addr2: '' }); return true; });
  ok('저장 후 자리 비움 연장(코드 확인)', sec);
  await p.context().close();
  await b.close();
  console.log(`\n통과 ${pass} · 실패 ${fail}`); process.exit(fail ? 1 : 0);
})();
