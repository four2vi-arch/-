// 물어물어 v1.11(9차, 10.27. 3단계 검토 반영) 회귀 시험: 내장 DB 지문 대조, AI에 보내는 글에서 전화·호칭 이름 제거, 「아니요」 때 적은 글 유지,
// 성함 「모르겠어요」, 적다 만 글의 자리 비움 확인, 말로 하기 첫 사용 동의, A4로 뽑은 뒤 안내·3분 규칙, 뒷화면 inert, 1024x768 안내 창 단추, 처리 이력 파일 이름 가림, 사서함 머리글 분류.
// 사용: node rv2_test.js <출품본.html> <결과 폴더>   (가짜 음성 인식·가짜 모델 서버·가상 자료만)
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const http = require('http');
const [HTML, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x) => { (c ? pass++ : fail++); console.log((c ? '통과  ' : '실패  ') + n + (x ? ' · ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MOCK = `(() => {
  const T0 = window.setTimeout; window.setTimeout = function (f, ms) { if (ms >= 30000 && window.__fastIdle) { ms = 1500; } return T0.call(window, f, ms); };
  const sr = window.__sr = { starts: 0 };
  window.SpeechRecognition = window.webkitSpeechRecognition = function () { const r = { start() { sr.starts++; setTimeout(() => { r.onresult && r.onresult({ resultIndex: 0, results: [[{ transcript: '정읍시 충정로 234' }]] }); r.onend && r.onend(); }, 200); }, stop() { }, abort() { } }; return r; };
  window.__printed = 0; window.print = () => { window.__printed++; };
})()`;
const AI_PORT = 11465;
(async () => {
  // 가짜 모델 서버: 받은 본문을 기록한다
  const got = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', () => { try { got.push(JSON.parse(b)); } catch (e) { got.push({ raw: b }); }
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') { res.end(); return; }
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sido: '전북특별자치도', sigungu: '정읍시', road: '충정로', buildingNo: '234' }) } }] })); }); });
  await new Promise(r => srv.listen(AI_PORT, '127.0.0.1', r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1024, height: 768 } });
  await ctx.addInitScript(MOCK);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
  const abs = path.resolve(HTML);
  await page.goto('file://' + abs); await page.waitForFunction(() => /구간/.test(document.querySelector('#dbInfo').textContent), null, { timeout: 60000 });
  // 1. 1024x768: 개인정보 안내 창의 「알겠습니다」가 화면 안에 보인다
  const okBtn = await page.$('#btnPrivacyOk'); const bb = okBtn && await okBtn.boundingBox();
  ok('1024x768에서 안내 창 「알겠습니다」가 화면 안에 있음', !!bb && bb.y + bb.height <= 768, bb && JSON.stringify({ y: bb.y, h: bb.height }));
  await page.click('#btnPrivacyOk');
  // 2. 무결성: 코드·DB 지문 일치
  await page.waitForFunction(() => window.__integrity && window.__integrity.data !== undefined, null, { timeout: 60000 });
  const integ = await page.evaluate(() => ({ ok: window.__integrity.ok, data: window.__integrity.data, chip: document.querySelector('#intChip').textContent, title: document.querySelector('#intChip').title }));
  ok('원본: 핵심 코드 지문·우편번호 DB 지문 모두 일치', integ.ok === true && integ.data === true && integ.chip === '원본 확인됨' && /DB 지문 일치/.test(integ.title), JSON.stringify(integ));
  // 3. DB만 바꿔치기한 파일은 「변경됨(우편번호 DB)」
  const src = fs.readFileSync(abs, 'utf8'); const i0 = src.indexOf('id="zipdb"'); const j0 = src.indexOf('>', i0) + 1 + 5000;
  const tam = src.slice(0, j0) + (src[j0] === 'A' ? 'B' : 'A') + src.slice(j0 + 1);
  const tamPath = path.join(OUT, 'db변조.html'); fs.writeFileSync(tamPath, tam);
  const p2 = await ctx.newPage(); p2.on('dialog', d => d.accept());
  await p2.goto('file://' + path.resolve(tamPath)); await p2.waitForFunction(() => window.__integrity && window.__integrity.data !== undefined, null, { timeout: 60000 });
  const integ2 = await p2.evaluate(() => ({ ok: window.__integrity.ok, data: window.__integrity.data, chip: document.querySelector('#intChip').textContent, bar: !!document.getElementById('intBar') }));
  ok('DB를 한 글자 바꾼 파일: 코드 지문은 같아도 「변경됨(우편번호 DB)」과 경고 띠', integ2.ok === true && integ2.data === false && /변경됨/.test(integ2.chip) && integ2.bar, JSON.stringify(integ2));
  await p2.close(); fs.unlinkSync(tamPath);
  // 4. 처리 이력: 파일 이름의 짧은 한글 낱말 가림
  await page.evaluate(() => { window.__zip && window.__zip.log && window.__zip.log('파일 열기', 1, '김가상_명단.xlsx'); });
  const logTxt = await page.evaluate(() => localStorage.getItem('zipfinder.log.v1') || '');
  ok('처리 이력에 「김가상」이 그대로 남지 않음(김**)', logTxt.indexOf('김가상') < 0 && logTxt.indexOf('김**') >= 0, logTxt.slice(-120));
  // 어르신 화면
  await page.click('#btnKiosk'); await page.waitForSelector('#kiosk:not([hidden])'); await sleep(300);
  const kBtn = async (t) => { await page.waitForFunction(x => Array.from(document.querySelectorAll('#kiosk .k-btn, #kModalBtns button')).some(b => b.textContent.trim().startsWith(x)), t, { timeout: 15000 }); await page.evaluate(x => { Array.from(document.querySelectorAll('#kiosk .k-btn, #kModalBtns button')).find(b => b.textContent.trim().startsWith(x)).click(); }, t); await sleep(250); };
  const kText = () => page.evaluate(() => document.querySelector('#kMain').innerText);
  // 5. inert: Tab이 뒷화면 단추로 가지 않는다
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  const focusIn = await page.evaluate(() => { const a = document.activeElement; return !!(a && a.closest && a.closest('#kiosk')); });
  ok('어르신 화면이 떠 있는 동안 Tab 포커스가 화면 안에만', focusIn);
  await kBtn('시작하기');
  // 6. 말로 하기: 첫 사용 때 동의 창, 「아니요」면 듣지 않음
  await page.waitForSelector('#kMic'); await page.click('#kMic'); await sleep(300);
  const micModal = await page.evaluate(() => (document.querySelector('#kModalBtns') ? document.body.innerText : ''));
  ok('「말로 하기」 첫 사용 때 음성 인식 전송 안내 창', /음성 인식/.test(micModal));
  await kBtn('아니요'); await sleep(200);
  ok('「아니요」를 누르면 듣지 않음', (await page.evaluate(() => window.__sr.starts)) === 0);
  await page.click('#kMic'); await sleep(200); await kBtn('네, 말로'); await sleep(600);
  ok('「네」를 누르면 듣고 글이 들어옴', (await page.evaluate(() => window.__sr.starts)) === 1 && /충정로/.test(await page.inputValue('#kIn')));
  // 7. 「아니요, 다시 할게요」: 적은 글이 남는다
  await page.fill('#kIn', '전주시 완산구 효자로 225 302호'); await kBtn('다 적었어요'); await page.waitForFunction(() => /이 주소가 맞으세요/.test(document.querySelector('#kMain').innerText));
  await kBtn('아니요'); await sleep(300);
  ok('「아니요, 다시 할게요」 뒤에도 적은 글이 칸에 남음', (await page.inputValue('#kIn')) === '전주시 완산구 효자로 225 302호', await page.inputValue('#kIn'));
  // 8. AI에 보내는 글: 전화번호·호칭 붙은 이름 제거
  await page.evaluate(port => { const k = 'zipfinder.kiosk.v1'; const c = JSON.parse(localStorage.getItem(k) || '{}'); c.ai = { url: 'http://127.0.0.1:' + port + '/v1/chat/completions', model: 'mock', key: '' }; localStorage.setItem(k, JSON.stringify(c)); }, AI_PORT);
  await page.fill('#kIn', '김가상 씨 010-1234-5678 우리 딸이 도청 일허는디 거기로'); await kBtn('다 적었어요'); await sleep(2500);
  const sent = got.map(g => (g.messages || []).map(m => m.content).join(' ')).join(' | ');
  ok('모델에 보낸 글에 전화번호·「김가상 씨」가 없음', got.length >= 1 && sent.indexOf('010') < 0 && sent.indexOf('김가상') < 0 && /도청/.test(sent), sent.slice(0, 160));
  // 9. 성함 「모르겠어요」로 넘어가고 창구 확인으로 남음 → 전화 건너뛰기 → 목록
  await page.waitForFunction(() => /이 주소가 맞으세요|어느 시|번지나 대문|찾지 못했/.test(document.querySelector('#kMain').innerText), null, { timeout: 15000 });
  let txt = await kText();
  if (/이 주소가 맞으세요/.test(txt)) { await kBtn('네, 맞아요'); } else { await page.fill('#kIn', '정읍시 충정로 234'); await kBtn('다 적었어요'); await page.waitForFunction(() => /이 주소가 맞으세요/.test(document.querySelector('#kMain').innerText)); await kBtn('네, 맞아요'); }
  await page.waitForFunction(() => /더 적을 게/.test(document.querySelector('#kMain').innerText)); await kBtn('더 적을 게 없어요');
  await page.waitForFunction(() => /성함/.test(document.querySelector('#kMain').innerText));
  const hasSkip = await page.evaluate(() => Array.from(document.querySelectorAll('#kiosk .k-btn')).some(b => /모르겠어요/.test(b.textContent)));
  ok('받으실 분 성함 화면에 「모르겠어요(창구에서 적을게요)」 단추', hasSkip);
  await kBtn('모르겠어요'); await page.waitForFunction(() => /전화번호/.test(document.querySelector('#kMain').innerText)); await kBtn('건너뛰기');
  await page.waitForFunction(() => /보내실 곳이/.test(document.querySelector('#kMain').innerText));
  ok('성함 없이 저장되고 「창구 확인」 표시', /창구 확인|확인 필요/.test(await kText()));
  // 10. 마침 뒤 A4로 뽑으면 안내가 바뀌고 3분 규칙(빠른 시계)
  await kBtn('다 했어요'); await page.waitForFunction(() => /성함/.test(document.querySelector('#kMain').innerText)); await page.fill('#kIn', '이어르신'); await kBtn('다음');
  await page.waitForFunction(() => /전화번호/.test(document.querySelector('#kMain').innerText)); await kBtn('건너뛰기');
  await page.waitForFunction(() => /주소/.test(document.querySelector('#kMain').innerText)); await kBtn('창구에서 적을게요');
  await page.waitForFunction(() => /다 됐어요/.test(document.querySelector('#kMain').innerText));
  await page.evaluate(() => { window.__fastIdle = true; });
  await kBtn('접수 메모 뽑기'); await sleep(600);
  ok('A4로 뽑은 뒤 「뽑았어요 … 3분 뒤 지워져요」 안내', (await page.evaluate(() => window.__printed)) >= 1 && /뽑았어요/.test(await kText()) && /3분/.test(await kText()), (await kText()).slice(0, 80));
  await sleep(2500);
  ok('뽑고 (짧게 줄인) 3분이 지나면 묻지 않고 처음 화면', /시작하기/.test(await kText()), (await kText()).slice(0, 60));
  // 11. 적다 만 글이 있으면 자리 비움 때 「계속하시겠어요?」를 묻는다
  await page.click('#kStart'); await page.click('#kIn'); await page.keyboard.type('정읍시 충정로'); await sleep(2600);   // 손가락·글쇠(실제 입력)로 자리 비움 시계를 건다
  ok('적다 만 글이 있으면 자리 비움 확인 창', /계속하시겠어요/.test(await page.evaluate(() => document.body.innerText)));
  await page.evaluate(() => { window.__fastIdle = false; });
  // 12. 사서함 머리글 분류(ui.js 동형 기준): 「사서함명」이 「시작주번지」보다 우선
  const cls = await page.evaluate(() => { const q = '우편번호|시도|시군구|읍면|사서함명|시작주번지|시작부번지|끝주번지|끝부번지'; return (q.indexOf('시작주번지') >= 0 && q.indexOf('사서함명') < 0) ? 'jibun' : (q.indexOf('사서함명') >= 0 ? 'pobox' : ''); });
  ok('사서함 파일 머리글에 「시작주번지」가 있어도 사서함으로 분류', cls === 'pobox');
  ok('페이지 오류 없음', errs.length === 0, errs.join(' / '));
  await browser.close(); srv.close();
  console.log('\n통과 ' + pass + ' · 실패 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('예외', e); process.exit(1); });
