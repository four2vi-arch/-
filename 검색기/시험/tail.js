const { chromium } = require('/opt/node22/lib/node_modules/playwright'); const path=require('path');
(async()=>{const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});const ctx=await b.newContext({locale:'ko-KR',viewport:{width:1280,height:900}});const p=await ctx.newPage();
const errs=[];p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});p.on('pageerror',e=>errs.push('pageerror '+e.message));
await p.goto('file://'+process.argv[2]);await p.waitForFunction(()=>/구간/.test(document.querySelector('#dbInfo').textContent));
if(await p.isVisible('#btnPrivacyOk'))await p.click('#btnPrivacyOk');
await p.click('#btnKiosk');await p.waitForSelector('#kiosk:not([hidden])');
const sb=await p.$('#kStaff');const box=await sb.boundingBox();await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();await p.waitForTimeout(2400);await p.mouse.up();
await p.waitForSelector('#kfUrl',{timeout:5000}).catch(()=>{});
console.log('직원 설정 열림:',await p.isVisible('#kfUrl'));
if(await p.isVisible('#kfUrl')){
  await p.fill('#kfUrl','http://127.0.0.1:11434/v1/chat/completions');await p.fill('#kfModel','mock-exaone');
  await p.evaluate(()=>{Array.from(document.querySelectorAll('#kModalBtns button')).find(b=>/AI 연결 시험/.test(b.textContent)).click();});
  await p.waitForFunction(()=>/연결|않았/.test(document.querySelector('#kfMsg').textContent),null,{timeout:30000});
  console.log('AI 연결 시험:',await p.textContent('#kfMsg'));
  // 잘못된 주소(외부)로 시험
  await p.fill('#kfUrl','https://api.openai.com/v1/chat/completions');
  await p.evaluate(()=>{Array.from(document.querySelectorAll('#kModalBtns button')).find(b=>/AI 연결 시험/.test(b.textContent)).click();});
  await p.waitForFunction(()=>/연결|않았/.test(document.querySelector('#kfMsg').textContent)&&!/시험 중/.test(document.querySelector('#kfMsg').textContent),null,{timeout:30000});
  console.log('외부 주소 AI 시험:',await p.textContent('#kfMsg'));
  await p.screenshot({path:'out/07_staff.png'});
  await p.evaluate(()=>{Array.from(document.querySelectorAll('#kModalBtns button')).find(b=>/^닫기/.test(b.textContent.trim())).click();});
}
// 자리 비움 타이머: idle 30초로 설정 후 대기
await p.evaluate(()=>localStorage.setItem('zipfinder.kiosk.v1',JSON.stringify({idle:30})));
await p.evaluate(()=>window.__kiosk.close());await p.click('#btnKiosk');await p.waitForSelector('#kiosk:not([hidden])');
await p.evaluate(()=>{Array.from(document.querySelectorAll('#kiosk .k-btn')).find(b=>/시작하기/.test(b.textContent)).click();});
await p.fill('#kIn','전주시 완산구 효자로 225');await p.click('#kGo');await p.waitForTimeout(31500);
console.log('30초 뒤 화면:',(await p.textContent('#kiosk')).replace(/\s+/g,' ').slice(0,120));
await p.waitForTimeout(21000);console.log('51초 뒤 화면:',(await p.textContent('#kMain')).replace(/\s+/g,' ').slice(0,80));
await p.evaluate(()=>window.__kiosk.close());
console.log('외부 fetch:',await p.evaluate(()=>fetch('http://example.com/x',{method:'POST',body:'{}'}).then(()=>'allowed').catch(e=>'blocked: '+e.message)));
await p.click('#btnLog');await p.waitForSelector('#logDlg[open]');console.log('처리 이력:',(await p.textContent('#logCount')).trim(),'|',(await p.textContent('#logBody')).replace(/\s+/g,' ').slice(0,200));
await p.click('#logDlg [data-close]');
// 직접 입력 탭: 주소 5줄 붙여넣기(제목줄 포함)
await p.click('.tab[data-tab="paste"]');await p.fill('#pasteBox','주소\n정읍시 수성동 610-2\n전북 정읍시 내장상동 123\n서울 강남구 역삼1동 736-1\n세종시 조치원읍 신흥리 100\n인천 중구 운서동 2851');await p.click('#btnPaste');
await p.waitForSelector('#btnRun',{state:'visible'});await p.click('#btnRun');await p.waitForFunction(()=>document.querySelectorAll('#resultTable tbody tr').length>0);
console.log('직접입력 결과:');(await p.evaluate(()=>Array.from(document.querySelectorAll('#resultTable tbody tr')).map(tr=>Array.from(tr.querySelectorAll('td')).map(td=>(td.querySelector('input')?td.querySelector('input').value:td.textContent).replace(/\s+/g,' ').trim()).slice(1,5).join(' | ')))).forEach(r=>console.log('  ',r));
console.log('콘솔 오류:',errs.length,errs.slice(0,3));
await b.close();})();
