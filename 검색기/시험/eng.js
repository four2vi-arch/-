const fs=require('fs'),path=require('path'),zlib=require('zlib');const ROOT=process.argv[2];
const load=n=>JSON.parse(zlib.gunzipSync(Buffer.from(fs.readFileSync(path.join(ROOT,'data',n+'.b64'),'utf8').trim(),'base64')).toString('utf8'));
const ZipEngine=require(path.join(ROOT,'src','engine.js'));const E=new ZipEngine(load('zipdb'),load('zipextra'));
const cases=['전북 정읍시 충정로 146','전북 정읍시 충정로 146.','전북 정읍시 충정로 146/3층','전북 정읍시 충정로 146-','전북 정읍시 충정로 146호','서울 종로구 종로 55.','정읍시 수성동 689-3.','전북 정읍시 충정로 146. 3층','전북 정읍시 충정로 146, 3층','서울 종로구 인동길 25.1','전북 정읍시 충정로 146 (수성동)','전북 정읍시 충정로146','전북 정읍시 충정로 146 정읍우체국 3층'];
for(const c of cases){const r=E.lookup(c);console.log(c.padEnd(32),'|',r.zip||'-',r.grade,r.conf||'',(r.note||'').slice(0,60));}
