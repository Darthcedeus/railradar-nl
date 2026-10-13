import test from 'node:test';
import assert from 'node:assert/strict';
import { destinationStop, destinationName, destinationResolver } from '../server/destinations.mjs';
const terminal = { stop: { uicCode: '8400058' }, arrivals: [{ cancelled: false }], departures: [] };
test('destination is the final passenger stop, not a next stop or passing point', () => {
  assert.equal(destinationStop({payload:{stops:[{stop:{name:'Next stop'},arrivals:[{}],departures:[{}]},terminal,{status:'PASSING',stop:{name:'Depot'}}]}}),terminal.stop);
  for(const stops of [[], [{...terminal,arrivals:[{cancelled:true}]}], [{...terminal,departures:[{}]}]]) assert.equal(destinationStop({payload:{stops}}),null);
  assert.equal(destinationStop({}),null);
  assert.equal(destinationName(terminal.stop,[{UICCode:8400058,namen:{lang:'Amsterdam Centraal'}}]),'Amsterdam Centraal');
  assert.equal(destinationName({name:'  Berlin\nHbf  '}),'Berlin Hbf');
  assert.equal(destinationName({uicCode:'unknown'}),null);
});
test('destination lookups share journey and station requests across devices',async()=>{
  const calls=[];
  const resolve=destinationResolver(async req=>{calls.push(new URL(req.url).pathname);return Response.json(req.url.includes('/journey?')?{payload:{stops:[terminal]}}:{payload:[{UICCode:8400058,namen:{lang:'Amsterdam Centraal'}}]});});
  assert.deepEqual(await Promise.all([resolve('100'),resolve('100'),resolve('200')]),Array(3).fill('Amsterdam Centraal'));
  assert.equal(calls.filter(p=>p==='/api/journey').length,2);
  assert.equal(calls.filter(p=>p==='/api/stations').length,1);
});
test('missing, failed and slow destination data safely falls back',async()=>{
  for(const ns of [async()=>Response.json({}, {status:503}),async()=>{throw Error('offline');},async()=>Response.json({payload:{stops:[]}}),async()=>new Promise(()=>{})]) {
    assert.equal(await destinationResolver(ns,10)('100'),null);
  }
});
