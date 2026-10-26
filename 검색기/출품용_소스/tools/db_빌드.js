#!/usr/bin/env node
// 우편번호 DB 다시 만들기(운영·이관용)
// 매월 바뀌는 우편번호 고시 <별표 5>(국가법령정보센터) 또는 인터넷우체국 범위주소 DB(areacd_rangeaddr_DB.zip)로
// data/zipdb.b64를 새로 만든다. 이어서 `python build.py`를 실행하면 내장 DB가 바뀐 출품본 꼴 HTML이 나온다.
// (PC마다 「DB 최신화」로 바꾸던 것을 담당자 한 사람이 파일 하나로 배포하는 길)
//
// 실행: node tools/db_빌드.js <도로명범위.txt> <지번범위.txt> [사서함.txt] [--date 20261101] [--out data/zipdb.b64]
//       node tools/db_빌드.js <areacd_rangeaddr_DB.zip> [--date ...]        (zip 안의 txt를 머리글로 가려 씀)
// 파일 가리기는 화면의 「DB 최신화」와 같다: 머리글에 「범위종류」가 있으면 도로명 범위, 「시작주번지」면 지번 범위, 「사서함명」이면 사서함.
// 글자 인코딩은 UTF-8(BOM 허용)이며, UTF-8로 읽히지 않으면 EUC-KR로 다시 읽는다. 기준일(--date)을 주지 않으면 파일 이름의 8자리 날짜를 쓴다.
// data/zipextra.b64(행정동·배달우체국·건물명 보조 자료, 인터넷우체국 오프라인 프로그램 자료)는 바꾸지 않는다. 바뀌는 일이 드물고 없어도 판정은 된다.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const ZipDbBuild = require(path.join(ROOT, 'src', 'dbbuild.js'));
const ZipEngine = require(path.join(ROOT, 'src', 'engine.js'));

function decode(buf) {   // UTF-8이 아니면(옛 자료) EUC-KR
  let s = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if ((s.slice(0, 2000).match(/�/g) || []).length > 3) { try { s = new TextDecoder('euc-kr').decode(buf); } catch (e) { } }
  return s;
}
function classify(name, buf) {   // ui.js buildDbFromFiles와 같은 기준
  const head = decode(buf.subarray(0, 600)).split('\n')[0];
  if (head.indexOf('범위종류') >= 0) return 'road';
  if (head.indexOf('시작주번지') >= 0) return 'jibun';
  if (head.indexOf('사서함명') >= 0) return 'pobox';
  if (head.indexOf('이동사유코드') >= 0) throw new Error(name + ': 변경분(변동분) DB입니다. 전체 구간 자료(별표 5)를 넣어 주세요.');
  if (head.indexOf('건물관리번호') >= 0) throw new Error(name + ': 지역별 주소 DB(별표 1~4)입니다. 구간 자료(별표 5)를 넣어 주세요.');
  return '';
}
function main() {
  const args = process.argv.slice(2);
  let date = '', out = path.join(ROOT, 'data', 'zipdb.b64');
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date') date = args[++i];
    else if (args[i] === '--out') out = path.resolve(args[++i]);
    else files.push(args[i]);
  }
  if (!files.length) { console.error('사용: node tools/db_빌드.js <도로명범위.txt> <지번범위.txt> [사서함.txt] [--date YYYYMMDD] [--out data/zipdb.b64]\n      node tools/db_빌드.js <areacd_rangeaddr_DB.zip>'); process.exit(2); }
  const src = { road: '', jibun: '', pobox: '', date: '' };
  const take = (name, buf) => {
    const k = classify(name, buf);
    if (!k) { console.log('건너뜀(범위 자료 아님): ' + name); return; }
    src[k] = decode(buf);
    const m = name.match(/(20\d{6})/); if (m && (k === 'road' || !src.date)) src.date = m[1];
    console.log('%s: %s (%s바이트)', k === 'road' ? '도로명 범위' : k === 'jibun' ? '지번 범위' : '사서함', name, buf.length.toLocaleString());
  };
  for (const f of files) {
    const buf = fs.readFileSync(f);
    if (buf[0] === 0x50 && buf[1] === 0x4b) {   // zip: 안의 txt를 모두 가려 본다
      const fflate = require(path.join(ROOT, 'vendor', 'fflate.js'));
      const entries = fflate.unzipSync(new Uint8Array(buf), { filter: e => /\.txt$/i.test(e.name) });
      for (const n of Object.keys(entries)) take(n, Buffer.from(entries[n]));
    } else take(path.basename(f), buf);
  }
  if (!src.road || !src.jibun) throw new Error('도로명 범위와 지번 범위 파일이 모두 있어야 합니다(사서함은 선택).');
  src.date = date || src.date;
  if (!/^20\d{6}$/.test(src.date)) throw new Error('기준일을 알 수 없습니다. --date 20261101 처럼 적어 주세요.');
  const t0 = Date.now();
  const db = ZipDbBuild.build(src);
  console.log('만듦: 기준일 %s · 도로명 구간 %s · 지번 구간 %s · 사서함 %s · 시도 %d · 시군구 %d · %d초',
    db.date, db.stats.road.toLocaleString(), db.stats.jibun.toLocaleString(), db.stats.pobox.toLocaleString(), db.sido.length, db.sgg.length, Math.round((Date.now() - t0) / 1000));
  if (db.stats.road < 1000 || db.stats.jibun < 1000) console.log('주의: 구간 수가 적습니다. 전국 자료가 맞는지 확인하세요(시험용 작은 파일이면 정상).');
  // 되읽기 확인: 만든 DB로 엔진을 띄워 첫 도로명 구간의 주소 하나를 찾아 본다
  let extra = null;
  try { extra = JSON.parse(zlib.gunzipSync(Buffer.from(fs.readFileSync(path.join(ROOT, 'data', 'zipextra.b64'), 'utf8').trim(), 'base64')).toString('utf8')); } catch (e) { }
  const E = new ZipEngine(db, extra);
  outer: for (let g = 0; g < db.sgg.length; g++) {
    for (const r in db.road[g]) {
      const x = db.road[g][r]; if (!x.length || x[1] !== 0) continue;
      const [si, sgg] = db.sgg[g];
      const addr = db.sido[si] + ' ' + sgg + ' ' + r + ' ' + x[3] + (x[4] ? '-' + x[4] : '');
      const res = E.lookup(addr, {});
      console.log('되읽기 확인: 「%s」 → %s %s', addr, res && res.grade || '?', res && res.zip || '');
      break outer;
    }
  }
  const b64 = zlib.gzipSync(Buffer.from(JSON.stringify(db), 'utf8'), { level: 9 }).toString('base64');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, b64);
  console.log('저장: %s (%s바이트) SHA-256 %s', out, fs.statSync(out).size.toLocaleString(), crypto.createHash('sha256').update(b64).digest('hex').slice(0, 16) + '…');
  console.log('다음: 이 폴더에서 `python build.py`를 실행하면 내장 DB가 바뀐 HTML이 dist/에 생깁니다(파일 SHA-256은 바뀜). 화면 위 「우편번호 DB 기준일」이 %s인지 확인하세요.', db.date);
}
try { main(); } catch (e) { console.error('실패: ' + e.message); process.exit(1); }
