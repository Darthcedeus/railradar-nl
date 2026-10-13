import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateAlert, approaching } from '../server/alerts.mjs';
import { openStore } from '../server/store.mjs';
import { createMonitor } from '../server/monitor.mjs';
const subscription={endpoint:'https://web.push.apple.com/test',keys:{p256dh:Buffer.alloc(65,4).toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}};
const rule={lat:52,lng:5,radius:3000,kind:'all',label:'Test point'};
const device=()=>validateAlert({subscription,rule});
const keys=()=>({publicKey:'fixture',privateKey:'secret-fixture'});
test('validates location, key sizes, filters and push-vendor allowlist',()=>{
 assert.equal(device().id.length,64);
 for(const endpoint of ['http://web.push.apple.com/test','https://127.0.0.1/test','https://web.push.apple.com.evil.test/test','https://user@web.push.apple.com/test','https://web.push.apple.com:444/test']) assert.throws(()=>validateAlert({subscription:{...subscription,endpoint},rule}));
 assert.throws(()=>validateAlert({subscription,rule:{...rule,lat:'52'}}));
 assert.throws(()=>validateAlert({subscription,rule:{...rule,radius:50}}));
 assert.throws(()=>validateAlert({subscription:{...subscription,keys:{auth:'x',p256dh:'x'}},rule}));
});
test('approach requires two fresh moving samples, correct type, no teleport or receding train',()=>{
 const train={type:'IC',pos:[52.01,5],speed:100};const prior={pos:[52.02,5],time:1000};
 assert.equal(approaching(train,prior,rule,31000,90000),true);
 assert.equal(approaching(train,undefined,rule,31000,90000),false);
 assert.equal(approaching(train,prior,rule,100000,90000),false);
 assert.equal(approaching(train,{pos:[52.005,5],time:1000},rule,31000,90000),false);
 assert.equal(approaching({...train,speed:0},prior,rule,31000,90000),false);
 assert.equal(approaching(train,prior,{...rule,kind:'sprinter'},31000,90000),false);
 assert.equal(approaching(train,{pos:[53,5],time:1000},rule,31000,90000),false);
});
test('subscriptions, VAPID keys and dedup survive reopening SQLite',()=>{
 const dir=mkdtempSync(join(tmpdir(),'railradar-test-'));const path=join(dir,'test.db');
 try {
  let s=openStore(path,keys);s.save(device());s.mark(device().id,'100',1000);s.db.close();
  s=openStore(path,()=>{throw Error('Must not regenerate keys');});assert.equal(s.devices().length,1);assert.equal(s.vapid.privateKey,'secret-fixture');assert.equal(s.eligible(device().id,'100',2000),false);s.remove(device().id);assert.equal(s.devices().length,0);s.db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('monitor skips baseline, sends on approach, suppresses repeat, survives failed feeds and restart',async()=>{
 const store=openStore(':memory:',keys);store.save(device());let at=1000000,lat=52.03,sent=0,broken=false;
 const ns=async()=>broken?Response.json({}, {status:502}):Response.json({payload:{treinen:[{treinNummer:100,type:'IC',lat,lng:5,snelheid:100}]}});
 const monitor=createMonitor({store,ns,sendPush:async()=>{sent++;},now:()=>at});
 await monitor.tick();assert.equal(sent,0);at+=30000;lat=52.02;await monitor.tick();assert.equal(sent,1);
 at+=30000;lat=52.01;await monitor.tick();assert.equal(sent,1);
 broken=true;at+=30000;await monitor.tick();assert.ok(monitor.status().error);
 broken=false;at+=30000;lat=52.005;await monitor.tick();assert.equal(sent,1);
 const restarted=createMonitor({store,ns,sendPush:async()=>{sent++;},now:()=>at});await restarted.tick();at+=30000;lat=52.001;await restarted.tick();assert.equal(sent,1);store.db.close();
});
test('expired push subscriptions are removed; transient failures remain retryable',async()=>{
 for(const statusCode of [410,503]) {
  const store=openStore(':memory:',keys);store.save(device());let at=1000000,lat=52.03;
  const monitor=createMonitor({store,now:()=>at,ns:async()=>Response.json({payload:{treinen:[{treinNummer:100,type:'IC',lat,lng:5,snelheid:100}]}}),sendPush:async()=>{throw Object.assign(Error(),{statusCode});}});
  await monitor.tick();at+=30000;lat=52.02;await monitor.tick();assert.equal(store.devices().length,statusCode===410?0:1);
  if(statusCode===503) assert.equal(store.eligible(device().id,'100',at),true);store.db.close();
 }
});
test('per-device hourly limit bounds notification volume',()=>{
 const store=openStore(':memory:',keys);store.save(device());for(let n=0;n<30;n++)store.mark(device().id,String(n),1000000);
 assert.equal(store.eligible(device().id,'new',1001000),false);assert.equal(store.eligible(device().id,'new',5000000),true);store.db.close();
});
test('approach notification includes final destination and falls back without losing the alert',async()=>{
 for(const destination of ['Amsterdam Centraal',null]) {
  const store=openStore(':memory:',keys);store.save(device());let at=1000000,lat=52.03;const sent=[];let lookups=0;
  const ns=async req=>{
   if(new URL(req.url).pathname==='/api/journey') {lookups++;return destination?Response.json({payload:{stops:[{stop:{name:destination},arrivals:[{}],departures:[]}]}}):Response.json({}, {status:503});}
   return Response.json({payload:{treinen:[{treinNummer:100,type:'IC',lat,lng:5,snelheid:100}]}});
  };
  const monitor=createMonitor({store,ns,now:()=>at,sendPush:async(_,payload)=>sent.push(payload)});
  await monitor.tick();assert.equal(lookups,0);
  at+=30000;lat=52.02;await monitor.tick();assert.equal(sent.length,1);
  assert.equal(sent[0].title,destination?'IC 100 → Amsterdam Centraal':'IC 100 · destination unavailable');
  assert.match(sent[0].body,/Approaching your area/);assert.equal(sent[0].tag,'train-100');
  at+=30000;lat=52.01;await monitor.tick();assert.equal(sent.length,1);assert.equal(lookups,1);
  store.db.close();
 }
});
