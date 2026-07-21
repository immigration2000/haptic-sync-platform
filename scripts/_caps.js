const { io } = require('socket.io-client');
const URL='http://localhost:5502';
function pc(r){const s=r.headers.getSetCookie?r.headers.getSetCookie():[r.headers.get('set-cookie')].filter(Boolean);return s.map(c=>c.split(';')[0]);}
async function login(e,p){const g=await fetch(URL+'/auth/login',{redirect:'manual'});const c=pc(g);const h=await g.text();const m=h.match(/name="csrf-token" content="([^"]+)"/);const t=m?m[1]:'';const r=await fetch(URL+'/auth/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Cookie':c.join('; '),'x-csrf-token':t},body:new URLSearchParams({email:e,password:p}),redirect:'manual'});const mp={};for(const x of c.concat(pc(r)))mp[x.split('=')[0]]=x;return Object.values(mp).join('; ');}
const conn=(c)=>io(URL,{extraHeaders:{Cookie:c}});const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function run(tier){
  const bjC=await login('sophia@pulse.dev','1234'); const uC=await login('test@pulse.dev','1234');
  const bj=conn(bjC); await new Promise(r=>bj.on('connect',r)); bj.emit('bj-online'); await wait(300);
  const u=conn(uC); await new Promise(r=>u.on('connect',r)); u.emit('user-enter'); await wait(200);
  u.emit('user-call',{bjUserIdTarget:3,kind:'call',context:{tier}}); await wait(500);
  const info=await fetch(URL+'/bj/session/info/3',{headers:{Cookie:uC}}).then(r=>r.json());
  bj.disconnect(); u.disconnect(); await wait(300);
  return {tier, rate:info.ratePerMin, cost:info.cost};
}
(async()=>{
  console.log('통화 :', JSON.stringify(await run('call')));
  console.log('모니터:', JSON.stringify(await run('video')));
  console.log('캠   :', JSON.stringify(await run('cam')));
  process.exit(0);
})();
