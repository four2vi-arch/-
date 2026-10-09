// 물어물어(우편번호 자동검색기) v1.4 출품본 구동 시험 — 헤드리스 크로미움
// 사용: node run.js <출품본.html 절대경로> [AI포트]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'); const path = require('path');
const HTML = process.argv[2]; const AIPORT = process.argv[3] || '11434';
const OUT = path.resolve('out'); fs.mkdirSync(OUT, { recursive: true });
const report = []; const consoleMsgs = [];
function log(k, v) { report.push([k, v]); console.log(k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v))); }
function parseCsv(p) { const t = fs.readFileSync(p, 'utf8').replace(/^﻿/, ''); return t.split(/\r?\n/).filter(Boolean).map(l => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'))); }

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--allow-file-access-from-files'] });
  const ctx = await browser.newContext({ acceptDownloads: true, locale: 'ko-KR', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => consoleMsgs.push('pageerror: ' + e.message));
  const t0 = Date.now();
  await page.goto('file://' + HTML);
  await page.waitForFunction(() => /구간/.test(document.querySelector('#dbInfo').textContent), null, { timeout: 60000 });
  log('첫 열기(DB 준비까지, 초)', ((Date.now() - t0) / 1000).toFixed(2));
  log('dbInfo', await page.textContent('#dbInfo'));
  await page.waitForFunction(() => !/확인 중/.test(document.querySelector('#intChip').textContent), null, { timeout: 30000 });
  log('무결성', (await page.textContent('#intChip')).trim());
  if (await page.isVisible('#btnPrivacyOk')) { await page.click('#btnPrivacyOk'); }
  log('제목', await page.title());

  async function runAndSummarize(label) {
    await page.waitForSelector('#btnRun', { state: 'visible' });
    const colmap = await page.evaluate(() => Array.from(document.querySelectorAll('#colMap .field')).map(f => (f.querySelector('label') || {}).textContent + '=' + ((f.querySelector('select') || {}).value || '')).join(' | '));
    log(label + ' 열 인식', colmap);
    const t = Date.now();
    await page.click('#btnRun');
    await page.waitForFunction(() => document.querySelector('#step3') && !document.querySelector('#step3').hidden && document.querySelectorAll('#resultTable tbody tr').length > 0, null, { timeout: 120000 });
    await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 120000 });
    log(label + ' 판정 소요(초, 화면 포함)', ((Date.now() - t) / 1000).toFixed(2));
    log(label + ' runInfo', (await page.textContent('#runInfo')).trim());
    log(label + ' tiles', (await page.textContent('#tiles')).replace(/\s+/g, ' ').trim());
  }
  async function download(btnSel, name) {
    try {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click(btnSel)]);
      const p = path.join(OUT, name + '__' + dl.suggestedFilename()); await dl.saveAs(p); return p;
    } catch (e) { log(name + ' 내려받기 실패', e.message.split('\n')[0] + ' / dlMsg=' + (await page.textContent('#dlMsg')).trim()); return ''; }
  }
  async function setFile(sel, p) {
    const b64 = fs.readFileSync(p).toString('base64');
    await page.evaluate(([sel, b64, name]) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const f = new File([u], name); const dt = new DataTransfer(); dt.items.add(f); const inp = document.querySelector(sel); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, b64, path.basename(p)]);
  }
  async function loadFile(p) {
    const before = await page.textContent('#fileLabel');
    await setFile('#fileInput', p);
    await page.waitForFunction(b => document.querySelector('#fileLabel').textContent !== b && !document.querySelector('#step2').hidden, before, { timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 60000 });
    log('파일 읽기', (await page.textContent('#fileLabel')).trim() + ' / ' + (await page.textContent('#fileMsg')).trim());
  }

  // 1) 예시로 해 보기
  await page.click('#btnSample');
  await runAndSummarize('예시10건');
  await page.screenshot({ path: path.join(OUT, '01_sample.png'), fullPage: false });

  // 2) 공공기관 20건 CSV
  await loadFile(path.resolve('공공기관20.csv'));
  await runAndSummarize('공공기관20');
  const rows20 = await page.evaluate(() => Array.from(document.querySelectorAll('#resultTable tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => (td.querySelector('input') ? td.querySelector('input').value : td.textContent).replace(/\s+/g, ' ').trim())));
  fs.writeFileSync(path.join(OUT, '공공기관20_결과.json'), JSON.stringify(rows20, null, 1));
  rows20.forEach(r => console.log('   ', r.slice(0, 5).join(' | ')));
  const rep = await download('#btnReport', '점검표'); log('점검표 파일', path.basename(rep));
  log('점검표 dlMsg', (await page.textContent('#dlMsg')).trim());
  await page.screenshot({ path: path.join(OUT, '02_public20.png') });

  // 3) 발송명단 1,000건 → 정답 대조, 원본+우편번호 내려받기, 사용자 지정 양식
  await loadFile(path.resolve('발송명단.csv'));
  await runAndSummarize('발송명단1000');
  const orig = await download('#btnDownload', '원본우편번호'); log('원본+우편번호 파일', path.basename(orig));
  // 사용자 지정 양식: 프리셋 버튼 중 「사용자」가 든 것
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('#presets .preset')).find(x => /사용자 지정/.test(x.textContent)); b && b.click(); });
  await page.waitForSelector('#cImport', { state: 'visible' });
  await setFile('#cFile', path.resolve('기관발송양식.xlsx'));
  await page.waitForSelector('#cList .crow', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  const custom = await page.evaluate(() => Array.from(document.querySelectorAll('#cList .crow')).map(r => r.querySelector('.ch').value + '←' + r.querySelector('.cs').value).join(' | '));
  log('사용자 양식 열 매핑', custom);
  log('dlMsg', (await page.textContent('#dlMsg')).trim());
  const cus = await download('#btnDownload', '사용자양식'); log('사용자 양식 파일', path.basename(cus));
  await page.screenshot({ path: path.join(OUT, '03_custom.png') });
  // 라벨 미리보기
  await page.click('#btnLabel'); await page.waitForSelector('#labelDlg[open]');
  log('라벨 규격 수', await page.evaluate(() => document.querySelectorAll('#lbKind option').length));
  log('라벨 info', (await page.textContent('#lbInfo')).trim());
  await page.click('#labelDlg [data-close]');
  // 결과 요약 복사(클립보드)
  await page.click('#btnSummary'); await page.waitForTimeout(300);

  // 4) 어르신 직접 입력(키오스크)
  async function kBtn(text) { await page.waitForFunction(t => Array.from(document.querySelectorAll('#kiosk .k-btn')).some(b => b.textContent.trim().startsWith(t)), text, { timeout: 15000 }); await page.evaluate(t => { Array.from(document.querySelectorAll('#kiosk .k-btn')).find(b => b.textContent.trim().startsWith(t)).click(); }, text); }
  async function kText() { return (await page.textContent('#kMain')).replace(/\s+/g, ' ').trim(); }
  async function kiosk(sentence, label) {
    await page.click('#btnKiosk'); await page.waitForSelector('#kiosk:not([hidden])');
    await kBtn('시작하기');
    await page.fill('#kIn', sentence); await page.click('#kGo');
    await page.waitForFunction(() => /맞으세요|고르|어느|확인|없어요|정리/.test(document.querySelector('#kMain').textContent), null, { timeout: 30000 });
    await page.waitForTimeout(500);
    const t = await kText(); log(label + ' 응답', t.slice(0, 220));
    return t;
  }
  const s1 = await kiosk('우리 딸네 집인디 전주시 완산구 효자로 이백이십오 삼백이호여', '키오스크 문장1');
  if (/맞으세요/.test(s1)) {
    await kBtn('네, 맞아요'); await kBtn('더 적을 게 없어요');
    await page.fill('#kIn', '오시연'); await kBtn('다음');
    await kBtn('건너뛰기');
    log('키오스크 목록 화면', (await kText()).slice(0, 160));
    await kBtn('다 했어요'); await page.fill('#kIn', '이어르신'); await kBtn('다음'); await kBtn('건너뛰기');
    await kBtn('창구에서 적을게요');
    log('키오스크 마침 화면', (await kText()).slice(0, 200));
    await page.screenshot({ path: path.join(OUT, '04_kiosk_finish.png') });
    await kBtn('직원 확인');
    await page.waitForTimeout(800);
    log('넘기기 뒤 키오스크 닫힘', await page.evaluate(() => document.querySelector('#kiosk').hidden));
    log('넘기기 뒤 step2 보임', await page.evaluate(() => !document.querySelector('#step2').hidden));
    log('넘기기 뒤 fileLabel', (await page.textContent('#fileLabel')).trim());
    if (await page.isVisible('#btnRun')) { await runAndSummarize('넘겨받은 주소록'); }
  }
  // 규칙으로 못 푸는 문장(AI 없이)
  const s2 = await kiosk('우리 딸이 도청에서 일허는디 거기로 보낼라고', '키오스크 문장8(AI 없이)');
  await page.screenshot({ path: path.join(OUT, '05_kiosk_noai.png') });
  await page.evaluate(() => window.__kiosk.close());

  // 5) AI 연결(모의 서버) — 직원 설정 저장 → 같은 문장
  await page.evaluate(p => { localStorage.setItem('zipfinder.kiosk.v1', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('zipfinder.kiosk.v1') || '{}'), { ai: { url: 'http://127.0.0.1:' + p + '/v1/chat/completions', model: 'mock-exaone', key: '' } }))); }, AIPORT);
  const s3 = await kiosk('우리 딸이 도청에서 일허는디 거기로 보낼라고', '키오스크 문장8(AI 연결)');
  await page.screenshot({ path: path.join(OUT, '06_kiosk_ai.png') });
  await page.evaluate(() => window.__kiosk.close());
  // 직원 설정 → AI 연결 시험
  await page.click('#btnKiosk'); await page.waitForSelector('#kiosk:not([hidden])');
  await page.dispatchEvent('#kStaff', 'pointerdown'); await page.waitForTimeout(2300); await page.dispatchEvent('#kStaff', 'pointerup');
  await page.waitForSelector('#kfUrl', { timeout: 5000 }).catch(() => {});
  if (await page.isVisible('#kfUrl')) {
    await kBtn('AI 연결 시험'); await page.waitForFunction(() => /연결|않았/.test(document.querySelector('#kfMsg').textContent), null, { timeout: 30000 });
    log('AI 연결 시험', await page.textContent('#kfMsg'));
  } else { log('직원 설정', '2초 누르기로 열리지 않음(dispatchEvent 방식 한계일 수 있음)'); }
  await page.evaluate(() => window.__kiosk.close());
  // 외부 주소 차단 확인(CSP)
  const blocked = await page.evaluate(() => fetch('http://example.com/v1/chat/completions', { method: 'POST', body: '{}' }).then(() => 'allowed').catch(e => 'blocked: ' + e.message));
  log('외부 주소 fetch', blocked);

  // 6) 처리 이력·끝내고 지우기
  await page.click('#btnLog'); await page.waitForSelector('#logDlg[open]');
  log('처리 이력', (await page.textContent('#logCount')).trim());
  await page.click('#logDlg [data-close]');
  fs.writeFileSync(path.join(OUT, 'console.txt'), consoleMsgs.join('\n'));
  log('콘솔 오류·경고 수', consoleMsgs.length);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  await browser.close();
})().catch(e => { console.error('FAIL', e); fs.writeFileSync(path.join(OUT, 'console.txt'), consoleMsgs.join('\n')); process.exit(1); });
