// 물어물어 v1.6 양식·오타·끌어 옮기기 시험 — 헤드리스 크로미움
// 사용: node form_test.js <출품본.html> <주소록.xlsx> <결과 폴더> [infer]
// 주소록은 「이름·우편번호·주소·상세」 꼴. 결과 파일은 결과 폴더에만 두고 저장소에는 넣지 않는다(개인정보).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'); const path = require('path');
const [HTML, INPUT, OUT, FLAG] = process.argv.slice(2);   // FLAG=infer: 시·군·구 없는 행이 앞뒤 행 지역으로 찾아져야 함
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x) => { (c ? pass++ : fail++); console.log((c ? '통과  ' : '실패  ') + n + (x ? ' · ' + x : '')); };
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--allow-file-access-from-files'] });
  const ctx = await browser.newContext({ acceptDownloads: true, locale: 'ko-KR', viewport: { width: 1360, height: 950 } });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + HTML);
  await page.waitForFunction(() => /구간/.test(document.querySelector('#dbInfo').textContent), null, { timeout: 60000 });
  await page.waitForFunction(() => !/확인 중/.test(document.querySelector('#intChip').textContent), null, { timeout: 30000 });
  ok('무결성', /원본/.test(await page.textContent('#intChip')), (await page.textContent('#intChip')).trim());
  if (await page.isVisible('#btnPrivacyOk')) await page.click('#btnPrivacyOk');
  const b64 = fs.readFileSync(INPUT).toString('base64');
  await page.evaluate(([b64, name]) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const f = new File([u], name); const dt = new DataTransfer(); dt.items.add(f); const el = document.querySelector('#fileInput'); el.files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true })); }, [b64, 'addr.xlsx']);
  await page.waitForFunction(() => !document.querySelector('#step2').hidden, null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 60000 });
  await page.click('#btnRun');
  await page.waitForFunction(() => !document.querySelector('#step3').hidden && document.querySelectorAll('#resultTable tbody tr').length > 0, null, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 120000 });
  const tiles = (await page.textContent('#tiles')).replace(/\s+/g, ' ').trim(); console.log('   ', tiles);
  const st = await page.evaluate(() => { const S = window.__mm_state || null; return null; });
  // 결과 표에서 오타·추정 행
  const notes = await page.$$eval('#resultTable tbody tr', trs => trs.map(t => t.textContent.replace(/\s+/g, ' ')));
  ok('실패 0건', !/실패\s*0/.test('') && !notes.some(n => /실패/.test(n) && !/유사|정확/.test(n)), notes.filter(n => /실패/.test(n)).length + '건');
  ok('시군구 오타 보정 행 있음(정음시→정읍시)', notes.some(n => /오타 보정\(정음시→정읍시\)/.test(n)));
  if (FLAG === 'infer') ok('시·군·구 없는 행을 앞뒤 행 지역으로 추정', notes.some(n => /앞뒤 행 지역\(정읍시\)으로 추정/.test(n)));
  // 기본 양식: 처음엔 양식1(등기용)
  const on = await page.$eval('#presets .preset.on b', b => b.textContent);
  ok('처음 양식은 「양식1 · 등기용」', on === '양식1 · 등기용', on);
  const cols1 = await page.$$eval('#cList .crow .ch', xs => xs.map(x => x.value));
  ok('양식1 열: 순번·이름·우편번호·주소·비고', cols1.join(',') === '순번,이름,우편번호,주소,비고', cols1.join(','));
  async function download(name) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#btnDownload')]);
    const p = path.join(OUT, name + '__' + dl.suggestedFilename()); await dl.saveAs(p); return p;
  }
  const f1 = await download('양식1'); ok('양식1 내려받기', fs.existsSync(f1), path.basename(f1));
  // 양식2
  await page.click('#presets .preset:nth-child(' + (await page.$$eval('#presets .preset b', bs => bs.findIndex(b => b.textContent === '양식2 · 소포용') + 1)) + ')');
  await page.waitForTimeout(300);
  const cols2 = await page.$$eval('#cList .crow .ch', xs => xs.map(x => x.value));
  ok('양식2 열: 순번·이름·우편번호·주소·일반전화·핸드폰번호·비고', cols2.join(',') === '순번,이름,우편번호,주소,일반전화,핸드폰번호,비고', cols2.join(','));
  // 끌어 옮기기: 「핸드폰번호」(5번째)를 「이름」(2번째) 위로
  const rows = await page.$$('#cList .crow');
  const src = await rows[5].$('.grip'); const dst = rows[1];
  const sb = await src.boundingBox(); const db = await dst.boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await page.mouse.down();
  await page.mouse.move(db.x + 40, db.y + 4, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(400);
  let cols3 = await page.$$eval('#cList .crow .ch', xs => xs.map(x => x.value));
  if (cols3.join(',') === cols2.join(',')) {   // 헤드리스에서 마우스 끌기가 안 될 때는 끌기 사건을 직접 보낸다
    await page.evaluate(() => { const rs = document.querySelectorAll('#cList .crow'); const from = rs[5], to = rs[1]; from.querySelector('.grip').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const dt = new DataTransfer(); from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); const r = to.getBoundingClientRect();
      to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r.top + 2 })); to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: r.top + 2 })); from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt })); });
    await page.waitForTimeout(300); cols3 = await page.$$eval('#cList .crow .ch', xs => xs.map(x => x.value));
  }
  ok('끌어 옮기기(핸드폰번호 → 이름 위)', cols3.join(',') === '순번,핸드폰번호,이름,우편번호,주소,일반전화,비고', cols3.join(','));
  // 키보드: 손잡이에서 ↓
  await page.focus('#cList .crow:nth-child(2) .grip'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200);
  const cols4 = await page.$$eval('#cList .crow .ch', xs => xs.map(x => x.value));
  ok('키보드 ↓로 한 칸 내리기', cols4.join(',') === '순번,이름,핸드폰번호,우편번호,주소,일반전화,비고', cols4.join(','));
  await page.screenshot({ path: path.join(OUT, '양식편집.png') });
  // 원래 순서로 돌리고 내려받기
  await page.focus('#cList .crow:nth-child(3) .grip'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  ok('원래 순서로 복귀', (await page.$$eval('#cList .crow .ch', xs => xs.map(x => x.value))).join(',') === '순번,이름,우편번호,주소,일반전화,핸드폰번호,비고');
  const f2 = await download('양식2'); ok('양식2 내려받기', fs.existsSync(f2), path.basename(f2));
  // 양식1로 돌아가도 양식1 열은 그대로, 양식2 편집은 기억
  await page.click('#presets .preset:nth-child(' + (await page.$$eval('#presets .preset b', bs => bs.findIndex(b => b.textContent === '양식1 · 등기용') + 1)) + ')'); await page.waitForTimeout(200);
  ok('양식1로 돌아가면 양식1 열', (await page.$$eval('#cList .crow .ch', xs => xs.map(x => x.value))).join(',') === '순번,이름,우편번호,주소,비고');
  ok('콘솔 오류 없음', errs.length === 0, errs.slice(0, 2).join(' | '));
  fs.writeFileSync(path.join(OUT, 'files.json'), JSON.stringify({ f1, f2 }));
  console.log(`\n통과 ${pass} · 실패 ${fail}`); await browser.close(); process.exit(fail ? 1 : 0);
})();
