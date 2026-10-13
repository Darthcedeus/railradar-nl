import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/http.mjs';
import { openStore } from '../server/store.mjs';
import { issueSession, validSession } from '../server/auth.mjs';
const secret='a'.repeat(64);
test('anonymous device sessions expire and reject tampering',()=>{
 const session=issueSession(secret,1000);assert.ok(validSession('rr_session='+session,secret,2000));assert.equal(validSession('rr_session='+session,secret,400*86400000),false);assert.equal(validSession('rr_session='+session+'tamper',secret,2000),false);
});
test('public map, CSRF, device isolation, recovery and push lifecycle',async t=>{
 const store=openStore(':memory:',()=>({publicKey:'public-fixture',privateKey:'private-fixture'}));let pushes=0;
 const origin='https://trein.humza.xyz';
 const server=createApp({config:{origin,sessionSecret:secret},store,ns:async()=>Response.json({payload:[]}),monitor:{status:()=>({checkedAt:null})},sendPush:async()=>{pushes++;}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>{server.closeAllConnections();server.close();store.db.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,method='GET',data,cookie,requestOrigin=origin)=>fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:requestOrigin,...(cookie?{Cookie:cookie}:{})},body:data?JSON.stringify(data):undefined});
 assert.equal((await call('/api/push')).status,401);
 assert.equal((await call('/api/vehicles')).status,200);
 assert.equal((await call('/api/stations')).status,200);
 assert.equal((await call('/api/device/session','POST',{},null,'https://evil.test')).status,403);
 const signed=await call('/api/device/session','POST',{});assert.equal(signed.status,200);
 const setCookie=signed.headers.get('set-cookie');assert.match(setCookie,/HttpOnly; Secure; SameSite=Strict/);const cookie=setCookie.split(';')[0];
 const state=await (await call('/api/push','GET',null,cookie)).text();assert.ok(!state.includes('private-fixture'));
 const subscription={endpoint:'https://web.push.apple.com/fixture',keys:{p256dh:Buffer.alloc(65,4).toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}};
 const created=await call('/api/push','POST',{subscription,rule:{lat:52,lng:5,radius:3000,kind:'all',label:'Saved'}},cookie);assert.equal(created.status,200);const {id}=await created.json();
 // Legacy rows have no owner and must stay hidden until the original browser reclaims them.
 store.db.prepare('UPDATE devices SET owner=NULL WHERE id=?').run(id);
 assert.equal((await (await call('/api/push','GET',null,cookie)).json()).devices.length,0);
 assert.equal((await call('/api/push','POST',{subscription,rule:{lat:52,lng:5,radius:3000,kind:'all',label:'Saved'}},cookie)).status,200);
 const other=(await call('/api/device/session','POST',{})).headers.get('set-cookie').split(';')[0];
 assert.equal((await (await call('/api/push','GET',null,other)).json()).devices.length,0);
 assert.equal((await call('/api/push','DELETE',{id},other)).status,404);
 assert.equal((await call('/api/push/test','POST',{id},other)).status,404);
 const stolen={...subscription,keys:{...subscription.keys,auth:Buffer.alloc(16,2).toString('base64url')}};
 assert.equal((await call('/api/push','POST',{subscription:stolen,rule:{lat:52,lng:5,radius:3000,kind:'all',label:'Tampered'}},other)).status,403);
 assert.equal((await call('/api/device/session','POST',{},cookie)).headers.get('set-cookie'),null);
 assert.equal((await call('/api/push/test','POST',{id},cookie)).status,200);assert.equal(pushes,1);
 assert.equal((await call('/api/push/test','POST',{id},cookie)).status,429);
 // After cookie loss, only the browser possessing the entire subscription can recover it.
 assert.equal((await call('/api/push','POST',{subscription,rule:{lat:52,lng:5,radius:3000,kind:'all',label:'Recovered'}},other)).status,200);
 assert.equal((await (await call('/api/push','GET',null,cookie)).json()).devices.length,0);
 assert.equal((await call('/api/push','DELETE',{id},cookie)).status,404);
 assert.equal((await call('/api/push','DELETE',{id},other)).status,200);assert.equal(store.devices().length,0);
 assert.equal((await call('/%2e%2e%2f.env')).status,404);
 assert.equal((await call('/sw.js')).status,200);assert.equal((await call('/manifest.webmanifest')).status,200);
 const shell=await call('/');assert.equal(shell.status,200);assert.match(shell.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 // OSM requires a real website Referer; cross-origin tiles receive the origin only.
 assert.equal(shell.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
 assert.ok(shell.headers.get('content-security-policy').split(';').find(d=>d.trim().startsWith('img-src ')).split(/\s+/).includes('https://tile.openstreetmap.org'));
});
