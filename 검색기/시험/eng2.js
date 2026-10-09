const fs=require('fs'),path=require('path'),zlib=require('zlib');const ROOT=process.argv[2];
const load=n=>JSON.parse(zlib.gunzipSync(Buffer.from(fs.readFileSync(path.join(ROOT,'data',n+'.b64'),'utf8').trim(),'base64')).toString('utf8'));
const E=new (require(path.join(ROOT,'src','engine.js')))(load('zipdb'),load('zipextra'));
function csv(p){return fs.readFileSync(p,'utf8').replace(/^﻿/,'').split(/\r?\n/).filter(Boolean).map(l=>l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map(c=>c.replace(/,$/,'').replace(/^"|"$/g,'')));}
const ans=csv(process.argv[3]).slice(1);let bad=0;for(const r of ans){const z=E.lookup(r[1]);if(z.zip!==r[2]||z.grade!=='정확'){bad++;if(bad<6)console.log('불일치',r[1],z.zip,z.grade,r[2]);}}
console.log('1000건 엔진 직접 대조 불일치:',bad);
for(const c of ['서울 종로구 인동길 25-1','서울 종로구 인사동6길 1','전북 정읍시 충정로 146 3.2층','대전 서구 둔산동 920. 1동','전북 정읍시 수성동 689-3 (현대아파트) 102동 304호.']){const r=E.lookup(c);console.log(c.padEnd(40),'|',r.zip||'-',r.grade,r.conf||'',(r.note||'').slice(0,50));}
const s=E.search('전북 정읍시 충정로 146',3);console.log('search 결과 필드:',s.length?Object.keys(s[0]).join(','):'없음', s[0]);
