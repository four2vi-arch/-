// OpenAI 호환 모의 서버: 주소 문장에서 조각을 "뽑은 척" 한다(고정 답). 요청 본문을 기록한다.
const http=require('http'); const fs=require('fs');
const srv=http.createServer((req,res)=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{
  fs.appendFileSync('mockai.log', JSON.stringify({url:req.url,headers:req.headers,body:b})+'\n');
  res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Headers','*');
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  let text=''; try{text=JSON.parse(b).messages.slice(-1)[0].content}catch(e){}
  let j={sido:"",sigungu:"",eupmyeondong:"",ri:"",road:"",buildingNo:"",jibun:"",buildingName:"",detail:""};
  if(/도청/.test(text)) j={...j,sido:"전북특별자치도",sigungu:"전주시 완산구",road:"효자로",buildingNo:"225"};
  if(/충정로/.test(text)) j={...j,sido:"전북특별자치도",sigungu:"정읍시",road:"충정로",buildingNo:"234",buildingName:"정읍시청"};
  const content=process.env.FENCE?('```json\n'+JSON.stringify(j)+'\n```'):JSON.stringify(j);
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({choices:[{message:{role:'assistant',content}}]}));
});});
srv.listen(Number(process.env.PORT||11434),'127.0.0.1',()=>console.log('mockai on',process.env.PORT||11434));
