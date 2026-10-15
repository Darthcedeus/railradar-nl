import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../tracker/api.mjs';
import { INTERNATIONAL_HUBS } from '../tracker/international-hubs.mjs';
test('Schiphol is included in shared map coverage and accepted by the departures proxy', async () => {
 assert.ok(INTERNATIONAL_HUBS.includes('shl'));
 let called=false;
 const handle=createHandler({key:'fixture',fetcher:async url=>{
  called=true;assert.equal(url.searchParams.get('station'),'shl');
  return Response.json({payload:{departures:[]}});
 }});
 const response=await handle(new Request('https://example.test/api/departures?station=shl'));
 assert.equal(response.status,200);assert.equal(called,true);
});
test('Worker adapter returns real Responses for API success and failures',async()=>{
 let calls=0,now=1000000;
 const handle=createHandler({key:'fixture',now:()=>now,fetcher:async()=>{calls++;return Response.json({payload:{treinen:[{treinNummer:524,lat:52.0705,lng:4.3007,snelheid:0}]}});}});
 const get=path=>handle(new Request('https://example.test'+path));
 assert.equal((await get('/api/vehicles')).status,200);
 assert.equal((await get('/api/vehicles')).status,200);assert.equal(calls,1);
 assert.equal((await(await get('/api/history')).json()).sightings.length,1);
 now+=1800001;assert.equal((await(await get('/api/history')).json()).sightings.length,0);
 assert.equal((await get('/api/vehicles?radius=NaN')).status,400);
 assert.equal((await get('/api/journey?train=oops')).status,400);
 assert.equal((await get('/api/nope')).status,404);
 const broken=createHandler({key:'fixture',fetcher:async()=>{throw Error('secret')}});
 const failed=await broken(new Request('https://example.test/api/vehicles'));assert.equal(failed.status,502);assert.ok(!(await failed.text()).includes('secret'));
});
test('international boards constrain stations, cache requests and keep the key server-side', async () => {
 let calls=0;
 const handle=createHandler({key:'fixture-secret',fetcher:async(url,options)=>{
  calls++;assert.equal(url.pathname,'/reisinformatie-api/api/v2/departures');
  assert.equal(url.searchParams.get('station'),'asd');assert.equal(url.searchParams.get('maxJourneys'),'100');
  assert.equal(options.headers['Ocp-Apim-Subscription-Key'],'fixture-secret');
  return Response.json({payload:{departures:[]}});
 }});
 const get=station=>handle(new Request('https://example.test/api/departures?station='+station));
 assert.equal((await get('asd')).status,200);assert.equal((await get('asd')).status,200);assert.equal(calls,1);
 assert.equal((await get('bad')).status,400);assert.equal(calls,1);
 assert.ok(!(await (await get('asd')).text()).includes('fixture-secret'));
});
test('nearby map searches share one snapped, widened NS vehicle request', async () => {
 const urls=[];
 const handle=createHandler({key:'fixture',fetcher:async url=>{urls.push(url);return Response.json({payload:{treinen:[]}});}});
 assert.equal((await handle(new Request('https://example.test/api/vehicles?lat=52.0812&lng=4.3123&radius=3000'))).status,200);
 assert.equal((await handle(new Request('https://example.test/api/vehicles?lat=52.0789&lng=4.3141&radius=3000'))).status,200);
 assert.equal(urls.length,1);
 assert.equal(urls[0].searchParams.get('lat'),'52.08');assert.equal(urls[0].searchParams.get('lng'),'4.31');assert.equal(urls[0].searchParams.get('radius'),'4000');
 await handle(new Request('https://example.test/api/vehicles?lat=52&lng=5&radius=30000'));
 assert.equal(urls[1].searchParams.get('radius'),'30000');
});
