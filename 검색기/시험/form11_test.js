// 물어물어 양식1(등기용)·양식2(소포용) 열 구성 시험(2026-11-02 사용자 지정 양식)
//   등기용: 연번·수취인·우편번호·주소·상세주소·연락처1(핸드폰, 선택)·연락처2(일반전화, 선택)
//   소포용: 연번·수취인·우편번호·주소·상세주소·연락처1(핸드폰, 필수)·연락처2(일반전화, 선택)
// 주소·상세주소 나누기(11.2. 사용자 지정: 주소는 시·도~시·군·구까지, 나머지는 상세주소), 핸드폰·일반전화 자리, 소포용 핸드폰 빈 행 안내와 주황 칸, 유사 주소 노란 칸.
// 11.2. 최종 점검 추가: 사서함·한 칸에 번호 두 개·수취인 빔·창구 확인 비고·못 찾은 주소·「지하1층」·xls 안내·CSV 첫 줄·기관 양식 연락처1·2.
// 사용: node form11_test.js <출품본.html> <결과 폴더>   (가상 이름·가상 번호(010-0000-…, 063-000-…)·공개 기관 주소만)
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const [HTML, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (n, c, x) => { (c ? pass++ : fail++); console.log((c ? '통과  ' : '실패  ') + n + (x ? ' · ' + x : '')); };
const CSV = '﻿받는분,주소,상세주소,휴대전화,전화\r\n' + [
  ['가상일', '전북특별자치도 정읍시 충정로 234-1', '101-1004호', '010-0000-1111', '063-000-1111'],
  ['가상이', '정읍시 수성동 689-3 102동 304호', '', '', '063-000-2222'],
  ['가상삼', '서울 종로 세종데로 209', '2층', '010-0000-3333', ''],
  ['가상사', '부산 기장군 기장읍 시랑리 400-1', '', '', ''],
  ['가상오', '전주시 완산구 효자로 225', '302호', '01000004444', ''],
].map(r => r.join(',')).join('\r\n') + '\r\n';
(async () => {
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const ctx = await browser.newContext({ acceptDownloads: true, locale: 'ko-KR', viewport: { width: 1360, height: 950 } });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('file://' + path.resolve(HTML));
  await page.waitForFunction(() => /구간/.test(document.querySelector('#dbInfo').textContent), null, { timeout: 60000 });
  if (await page.isVisible('#btnPrivacyOk')) await page.click('#btnPrivacyOk');
  await page.evaluate((csv) => { const f = new File([csv], '양식시험.csv', { type: 'text/csv' }); const dt = new DataTransfer(); dt.items.add(f); const el = document.querySelector('#fileInput'); el.files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true })); }, CSV);
  await page.waitForFunction(() => !document.querySelector('#step2').hidden, null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 60000 });
  await page.click('#btnRun');
  await page.waitForFunction(() => !document.querySelector('#step3').hidden && document.querySelectorAll('#resultTable tbody tr').length > 0, null, { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 120000 });
  const pick = async (name) => { const i = await page.$$eval('#presets .preset b', (bs, n) => bs.findIndex(b => b.textContent === n), name); await page.click('#presets .preset:nth-child(' + (i + 1) + ')'); await page.waitForTimeout(250); };
  const download = async (name) => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#btnDownload')]);
    const p = path.join(OUT, name + '__' + dl.suggestedFilename()); await dl.saveAs(p); return p;
  };
  // 내려받은 xlsx를 화면의 XLSX(xlsx-js-style)로 다시 읽어 값과 칸 색을 본다
  const readBack = (p) => page.evaluate((b64) => {
    const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const wb = XLSX.read(u, { type: 'array', cellStyles: true }); const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true, raw: false });
    const fills = {}; Object.keys(ws).filter(k => k[0] !== '!').forEach(k => { const c = ws[k]; const rgb = c.s && (c.s.fgColor && c.s.fgColor.rgb || c.s.fill && c.s.fill.fgColor && c.s.fill.fgColor.rgb); if (rgb) fills[k] = rgb; });
    return { aoa, fills };
  }, fs.readFileSync(p).toString('base64'));
  const rowsOf = (aoa) => { const h = aoa.findIndex(r => r[0] === '연번'); return { head: aoa[h], h, rows: aoa.slice(h + 1).filter(r => r.some(Boolean)) }; };
  const by = (rows, name) => rows.find(r => r[1] === name) || [];

  // 양식1 · 등기용
  await pick('양식1 · 등기용');
  const f1 = await download('양식1'); const x1 = await readBack(f1); const t1 = rowsOf(x1.aoa);
  ok('등기용 제목 줄(위 2줄 비움): 연번·수취인·우편번호·주소·상세주소·연락처1·연락처2', t1.h === 2 && t1.head.join(',') === '연번,수취인,우편번호,주소,상세주소,연락처1,연락처2', t1.h + ' | ' + (t1.head || []).join(','));
  ok('등기용 5행 모두 나옴', t1.rows.length === 5, String(t1.rows.length));
  const r1 = by(t1.rows, '가상일');
  ok('도로명: 주소는 시·도~시·군·구, 상세주소는 도로명·건물번호·동·호수', r1[3] === '전북특별자치도 정읍시' && r1[4] === '충정로 234-1, 101-1004호' && r1[2] === '56180', JSON.stringify(r1));
  ok('연락처1 = 핸드폰, 연락처2 = 일반전화', r1[5] === '010-0000-1111' && r1[6] === '063-000-1111', r1.slice(5).join(' / '));
  const r2 = by(t1.rows, '가상이');
  ok('지번: 주소는 시·군까지, 상세주소는 동·번지·동·호수', r2[3] === '전북특별자치도 정읍시' && r2[4] === '수성동 689-3, 102동 304호', JSON.stringify(r2));
  ok('일반전화만 있으면 연락처1은 비우고 연락처2에', r2[5] === '' && r2[6] === '063-000-2222', r2.slice(5).join(' / '));
  const r4 = by(t1.rows, '가상사');
  ok('지번(군·읍·리): 주소 「부산광역시 기장군」, 상세 「기장읍 시랑리 400-1」', r4[3] === '부산광역시 기장군' && r4[4] === '기장읍 시랑리 400-1', JSON.stringify(r4));
  const r5 = by(t1.rows, '가상오');
  ok('행정구: 주소 「전북특별자치도 전주시 완산구」(구까지), 상세 「효자로 225, 302호」, 핸드폰 010-0000-4444', r5[5] === '010-0000-4444' && r5[3] === '전북특별자치도 전주시 완산구' && r5[4] === '효자로 225, 302호', JSON.stringify(r5));
  ok('연번은 1부터 숫자', t1.rows.map(r => r[0]).join(',') === '1,2,3,4,5', t1.rows.map(r => r[0]).join(','));
  const msg1 = (await page.textContent('#dlMsg')).trim();
  ok('등기용은 핸드폰이 없어도 안내하지 않음(선택)', !/연락처1\(핸드폰\)이 빈 행/.test(msg1), msg1.slice(0, 120));
  const simRow = t1.rows.findIndex(r => r[1] === '가상삼');
  ok('유사(추정) 주소 행은 우편번호 칸 노란색 + 안내', x1.fills['C' + (t1.h + 2 + simRow)] === 'FFF3D1' && /유사.*우편번호 칸 노란색/.test(msg1), JSON.stringify(x1.fills) + ' | ' + msg1.slice(0, 80));
  ok('등기용에는 주황 칸 없음', !Object.values(x1.fills).includes('FFE0C2'), JSON.stringify(x1.fills));

  // 양식2 · 소포용
  await pick('양식2 · 소포용');
  const f2 = await download('양식2'); const x2 = await readBack(f2); const t2 = rowsOf(x2.aoa);
  ok('소포용 제목 줄: 등기용과 같은 7열', t2.head.join(',') === '연번,수취인,우편번호,주소,상세주소,연락처1,연락처2', (t2.head || []).join(','));
  const msg2 = (await page.textContent('#dlMsg')).trim();
  ok('소포용: 핸드폰이 빈 2행을 알림(필수)', /연락처1\(핸드폰\)이 빈 행 2건\(원본 3·5행\)/.test(msg2), msg2.slice(0, 200));
  const iA = t2.rows.findIndex(r => r[1] === '가상이'), iB = t2.rows.findIndex(r => r[1] === '가상사');
  ok('소포용: 핸드폰이 빈 칸은 주황색(연락처1 열 F)', x2.fills['F' + (t2.h + 2 + iA)] === 'FFE0C2' && x2.fills['F' + (t2.h + 2 + iB)] === 'FFE0C2', JSON.stringify(x2.fills));
  ok('소포용: 핸드폰이 있는 행은 칠하지 않음', !x2.fills['F' + (t2.h + 2 + t2.rows.findIndex(r => r[1] === '가상일'))]);
  // CSV로 받으면 색은 없고 안내만
  await page.selectOption('#selFormat', 'csv');
  const f3 = await download('양식2csv'); const csv = fs.readFileSync(f3, 'utf8');
  ok('CSV: 같은 열, 핸드폰 빈 행 안내에 「엑셀 칸 주황색」 대신 마침', /연번,수취인,우편번호,주소,상세주소,연락처1,연락처2/.test(csv) && /연락처1\(핸드폰\)이 빈 행 2건[^]*받으세요\./.test((await page.textContent('#dlMsg')).trim()), (await page.textContent('#dlMsg')).trim().slice(0, 160));
  await page.selectOption('#selFormat', 'xlsx');
  // ---- 11.2. 최종 점검에서 재현한 것: 사서함·번호 두 개·수취인 빔·창구 확인 비고·못 찾은 주소·「지하1층」
  const CSV2 = '﻿받는분,주소,상세주소,휴대전화,전화,비고\r\n' + [
    ['가상육', '정읍우체국 사서함 1호', '', '"010-0000-6666, 063-000-6666"', '', '창구 확인 필요(받는 분 성함 창구 확인)'],
    ['', '전북특별자치도 정읍시 충정로 234-1', '', '', '063-000-7777 / 010-0000-7777', ''],
    ['가상팔', '가나다라 마바사', '', '010-0000-8888', '', ''],
    ['가상구', '서울 마포구 양화로 45 지하1층', '', '010-0000-9999', '', ''],
  ].map(r => r.join(',')).join('\r\n') + '\r\n';
  await page.evaluate((csv) => { const f = new File([csv], '양식시험2.csv', { type: 'text/csv' }); const dt = new DataTransfer(); dt.items.add(f); const el = document.querySelector('#fileInput'); el.files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true })); }, CSV2);
  await page.waitForFunction(() => /양식시험2/.test(document.querySelector('#fileLabel').textContent), null, { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 60000 });
  if (await page.isVisible('#btnRun')) { await page.click('#btnRun'); }
  await page.waitForFunction(() => !document.querySelector('#step3').hidden && document.querySelector('#busy').hidden && document.querySelectorAll('#resultTable tbody tr').length === 4, null, { timeout: 120000 });
  await pick('양식2 · 소포용');
  const f4 = await download('양식2b'); const x4 = await readBack(f4); const t4 = rowsOf(x4.aoa); const m4 = (await page.textContent('#dlMsg')).trim();
  const q1 = by(t4.rows, '가상육');
  ok('사서함: 주소 「전북특별자치도 정읍시」, 상세 「정읍우체국 사서함 1호」', q1[3] === '전북특별자치도 정읍시' && q1[4] === '정읍우체국 사서함 1호', JSON.stringify(q1));
  ok('한 칸의 번호 두 개를 나눔(핸드폰 → 연락처1, 일반전화 → 연락처2)', q1[5] === '010-0000-6666' && q1[6] === '063-000-6666', q1.slice(5).join(' / '));
  const q2 = t4.rows.find(r => r[4] === '충정로 234-1') || [];
  ok('「063-… / 010-…」도 나눔', q2[5] === '010-0000-7777' && q2[6] === '063-000-7777', q2.slice(5).join(' / '));
  const q4 = by(t4.rows, '가상구');
  ok('「양화로 45 지하1층」은 지상 건물(04036), 주소 「서울특별시 마포구」, 상세 「양화로 45, 지하1층」', q4[2] === '04036' && q4[3] === '서울특별시 마포구' && q4[4] === '양화로 45, 지하1층', JSON.stringify(q4));
  ok('수취인이 빈 행 안내(원본 3행)', /수취인이 빈 행 1건\(원본 3행\)/.test(m4), m4.slice(0, 260));
  ok('비고의 「창구 확인 필요」를 안내(원본 2행)', /창구에서 확인할 행 1건\(원본 2행\)/.test(m4));
  ok('못 찾은 주소 행 번호 안내(원본 4행)', /우편번호를 못 찾은 행 1건\(원본 4행\)/.test(m4));
  const w1 = t4.h + 2 + t4.rows.indexOf(q1), w2 = t4.h + 2 + t4.rows.indexOf(q2), w3 = t4.h + 2 + t4.rows.findIndex(r => r[1] === '가상팔');
  ok('칸 색: 창구 확인 행 주소 노랑, 수취인 빔 주황, 못 찾은 우편번호 빨강', x4.fills['D' + w1] === 'FFF3D1' && x4.fills['B' + w2] === 'FFE0C2' && x4.fills['C' + w3] === 'FDDCD9', JSON.stringify(x4.fills));
  // xls는 색이 없다고 안내, CSV는 맨 위 빈 줄 없이
  await page.selectOption('#selFormat', 'xls'); await download('양식2xls');
  { const mx = (await page.textContent('#dlMsg')).trim(); ok('xls: 색 이름(주황·노랑·빨강)을 말하지 않음(xls는 칸 색을 담지 못함)', !/주황색|노란색|빨간색/.test(mx) && /수취인이 빈 행/.test(mx), mx.slice(0, 160)); }
  await page.selectOption('#selFormat', 'csv'); const fc = await download('양식2csv2');
  ok('CSV 첫 줄이 제목 줄(위 빈 줄 없음)', /^﻿?연번,수취인,/.test(fs.readFileSync(fc, 'utf8')), fs.readFileSync(fc, 'utf8').slice(0, 30));
  await page.selectOption('#selFormat', 'xlsx');
  // 기관 양식 파일(연락처1·연락처2) 불러오기: 양식1을 고른 채여도 사용자 지정으로, 연락처1 = 핸드폰, 주소는 번지까지
  await pick('양식1 · 등기용');
  await page.evaluate(() => { const ws = XLSX.utils.aoa_to_sheet([['연번', '수취인', '우편번호', '주소', '상세주소', '연락처1', '연락처2']]); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1'); const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }); const f = new File([buf], '창구양식.xlsx'); const dt = new DataTransfer(); dt.items.add(f); const el = document.querySelector('#cFile'); el.files = dt.files; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(800);
  const cc = await page.evaluate(() => ({ on: (document.querySelector('#presets .preset.on b') || {}).textContent, cols: (window.__zip.S.customCols || []).map(c => c.h + '=' + c.src).join(',') }));
  ok('양식1을 고른 채 양식 파일을 불러오면 「사용자 지정 양식」으로 바뀜', cc.on === '사용자 지정 양식', cc.on);
  ok('기관 양식 연락처1 → 휴대전화, 연락처2 → 일반전화, 주소 → 번지까지(시·도 포함), 상세주소 → 상세', /연락처1=mobile/.test(cc.cols) && /연락처2=tel/.test(cc.cols) && /주소=addrMainFull/.test(cc.cols) && /상세주소=addrDetail/.test(cc.cols), cc.cols);
  ok('콘솔 오류 없음', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`\n통과 ${pass} · 실패 ${fail}`); await browser.close(); process.exit(fail ? 1 : 0);
})();
