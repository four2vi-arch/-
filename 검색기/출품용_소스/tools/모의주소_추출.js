#!/usr/bin/env node
// 우편번호 자동검색기 v1.4 · 모의 발송 명단 만들기
// 내장 우편번호 DB(data/zipdb.b64)에서 도로명·지번 구간을 임의로 골라 구간 안 번호로 합성 주소를 만든다.
// 원형 주소는 같은 엔진으로 찾아 「정확」이고 우편번호가 구간과 같은 것만 쓰고, 약 3분의 1에는 흔한 표기 변형을 입힌다.
// 이름(가상수신자0001~)·전화(010-0000-1000~)는 가상이며, 실제 건물·거주 여부와 무관하다.
// 실행: node tools/모의주소_추출.js  →  tools/out/발송명단.csv, tools/out/정답.csv (난수 씨앗 20261005, 같은 DB면 같은 결과)
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const load = n => JSON.parse(zlib.gunzipSync(Buffer.from(fs.readFileSync(path.join(ROOT, 'data', n + '.b64'), 'utf8').trim(), 'base64')).toString('utf8'));
const ZipEngine = require(path.join(ROOT, 'src', 'engine.js'));
const db = load('zipdb');
const ex = load('zipextra');
const E = new ZipEngine(db, ex);
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20261005);
const pick = a => a[Math.floor(rnd() * a.length)];
const pad5 = z => String(z).padStart(5, '0');
const cmp = (a, b, c, d) => a !== c ? a - c : b - d;
// 시도별 후보
const bySido = db.sido.map(() => ({ road: [], jibun: [] }));
db.sgg.forEach(([si, name], g) => {
  for (const r in db.road[g]) { if (/고속도로|고속국도|자동차전용/.test(r)) continue; const x = db.road[g][r]; for (let i = 0; i < x.length; i += 8) if (x[i + 1] === 0) bySido[si].road.push([g, r, i]); }
  for (const k in db.jibun[g]) { const x = db.jibun[g][k]; for (let i = 0; i < x.length; i += 6) if (x[i] === 0) bySido[si].jibun.push([g, k, i]); }
});
const sggCount = {}; db.sgg.forEach(([si, n]) => { sggCount[n] = (sggCount[n] || 0) + 1; });
function numIn(sM, sS, eM, eS, kind) {
  for (let t = 0; t < 30; t++) {
    let m = sM + Math.floor(rnd() * (eM - sM + 1));
    if (kind === 1 && m % 2 === 0) m += (m + 1 <= eM ? 1 : -1);
    if (kind === 2 && m % 2 === 1) m += (m + 1 <= eM ? 1 : -1);
    let s = 0;
    if (cmp(m, s, sM, sS) < 0) s = sS;
    if (cmp(sM, sS, m, s) <= 0 && cmp(m, s, eM, eS) <= 0 && m > 0) return [m, s];
  }
  return null;
}
function makeRoad(c) {
  const [g, r, i] = c, x = db.road[g][r];
  const kind = x[i + 2]; let ms;
  if (kind === 0) ms = [x[i + 3], x[i + 4]]; else ms = numIn(x[i + 3], x[i + 4], x[i + 5], x[i + 6], kind);
  if (!ms) return null;
  const [si, sg] = db.sgg[g]; const emd = db.emd[x[i]] || '';
  const parts = [db.sido[si], sg].filter(Boolean); if (/[읍면]$/.test(emd)) parts.push(emd);
  parts.push(r + ' ' + ms[0] + (ms[1] ? '-' + ms[1] : ''));
  return { type: '도로명', si, sgg: sg, addr: parts.join(' '), zip: pad5(x[i + 7]), unit: r, num: ms };
}
function makeJibun(c) {
  const [g, k, i] = c, x = db.jibun[g][k];
  const ms = numIn(x[i + 1], x[i + 2], x[i + 3], x[i + 4], 3);
  if (!ms) return null;
  const [si, sg] = db.sgg[g]; const [emd, ri] = k.split('|');
  const parts = [db.sido[si], sg, emd].filter(Boolean); if (ri) parts.push(ri);
  parts.push(ms[0] + (ms[1] ? '-' + ms[1] : ''));
  return { type: '지번', si, sgg: sg, addr: parts.join(' '), zip: pad5(x[i + 5]), unit: ri ? emd + ' ' + ri : emd, num: ms };
}
const SHORT = { '서울특별시': '서울', '경기도': '경기', '인천광역시': '인천', '강원특별자치도': '강원', '충청북도': '충북', '세종특별자치시': '세종', '충청남도': '충남', '대전광역시': '대전', '경상북도': '경북', '대구광역시': '대구', '울산광역시': '울산', '부산광역시': '부산', '경상남도': '경남', '전북특별자치도': '전북', '전남광주통합특별시': null, '제주특별자치도': '제주' };
const GWANGJU = ['동구', '서구', '남구', '북구', '광산구'];
function oldName(rec) {
  const s = db.sido[rec.si];
  if (s === '강원특별자치도') return '강원도';
  if (s === '전북특별자치도') return '전라북도';
  if (s === '제주특별자치도') return '제주도';
  if (s === '전남광주통합특별시') return GWANGJU.includes(rec.sgg) ? '광주광역시' : '전라남도';
  return null;
}
function variant(rec) {
  const s = db.sido[rec.si]; const opts = [];
  if (SHORT[s]) opts.push(['시도 약칭', rec.addr.replace(s, SHORT[s])]);
  const o = oldName(rec); if (o) opts.push(['옛 시도명', rec.addr.replace(s, o)]);
  if (rec.sgg && sggCount[rec.sgg] === 1 && s !== '세종특별자치시') opts.push(['시도 생략', rec.addr.replace(s + ' ', '')]);
  const n = rec.num[0] + (rec.num[1] ? '-' + rec.num[1] : '');
  opts.push(['띄어쓰기 없음', rec.addr.replace(new RegExp(' ' + n + '$'), n)]);
  return pick(opts);
}
const N = 1000, perSido = Math.floor(N / 2 / db.sido.length);
const out = []; const seen = new Set(); let tried = 0, rejected = 0; const rej = [];
function draw(kind, si) {
  for (let t = 0; t < 200; t++) {
    tried++;
    const list = bySido[si][kind]; if (!list.length) return null;
    const rec = kind === 'road' ? makeRoad(pick(list)) : makeJibun(pick(list));
    if (!rec) { rejected++; rej.push(['번호 생성 실패', kind]); continue; } if (seen.has(rec.addr)) { rejected++; rej.push(['중복', rec.addr]); continue; }
    const r = E.lookup(rec.addr);
    if (r.grade !== '정확' || r.zip !== rec.zip) { rejected++; rej.push(['판정 불일치', rec.addr, rec.zip, r.grade, r.zip, r.note]); continue; }
    seen.add(rec.addr); return rec;
  }
  return null;
}
for (const kind of ['road', 'jibun']) for (let si = 0; si < db.sido.length; si++) for (let j = 0; j < perSido; j++) { const r = draw(kind, si); if (r) out.push(r); }
while (out.length < N) { const r = draw(rnd() < 0.5 ? 'road' : 'jibun', Math.floor(rnd() * db.sido.length)); if (r) out.push(r); }
// 섞고 30%에 표기 변형
for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
out.forEach((r, i) => { r.canon = r.addr; if (rnd() < 0.3) { const [vt, va] = variant(r); r.form = vt; r.addr = va; } else r.form = '원형'; r.no = i + 1; r.name = '가상수신자' + String(i + 1).padStart(4, '0'); r.tel = '010-0000-' + String(1000 + i).padStart(4, '0'); });
// 엔진 판정(같은 엔진, 입력 문자열 그대로)
const tally = {}; out.forEach(r => { const x = E.lookup(r.addr); r.eg = x.grade; r.ez = x.zip; const k = r.type + '/' + r.form; tally[k] = tally[k] || { n: 0, ok: 0, sim: 0, fail: 0, zipOk: 0 }; const t = tally[k]; t.n++; if (x.grade === '정확') t.ok++; else if (x.grade === '유사') t.sim++; else t.fail++; if (x.zip === r.zip) t.zipOk++; });
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const q = v => '"' + String(v).replace(/"/g, '""') + '"';
fs.writeFileSync(path.join(OUT, '발송명단.csv'), '\ufeff' + ['순번,수신자,주소,연락처'].concat(out.map(r => [r.no, r.name, r.addr, r.tel].map(q).join(','))).join('\r\n'));
fs.writeFileSync(path.join(OUT, '정답.csv'), '\ufeff' + ['순번,주소(명단에 적힌 그대로),정답 우편번호,주소 유형,표기,원형 주소,시·도'].concat(out.map(r => [r.no, r.addr, r.zip, r.type, r.form, r.canon, db.sido[r.si]].map(q).join(','))).join('\r\n'));
fs.writeFileSync(path.join(OUT, '제외.json'), JSON.stringify(rej, null, 1));
console.log('만든 건수', out.length, '· 뽑은 횟수', tried, '· 제외', rejected);
console.log('엔진 대조', JSON.stringify(tally));
