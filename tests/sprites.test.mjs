import test from 'node:test';
import assert from 'node:assert/strict';
import { withHeadings, directionIndex, trainSprite, viewIndex, paceBand, VIEWS } from '../tracker/train-sprites.mjs';
const train = pos => ({ id:'1', type:'IC', pos });
test('headings follow map bearings and reject stale samples and jumps', () => {
  const previous = [train([52,5])];
  for (const [pos, sector] of [[[52.005,5],0],[[52,5.005],2],[[51.995,5],4],[[52,4.995],6]]) assert.equal(directionIndex(withHeadings([train(pos)],previous,15000)[0].heading),sector);
  assert.equal(withHeadings([train([52.005,5])],previous,100000)[0].heading,null);
  assert.equal(withHeadings([train([53,5])],previous,15000)[0].heading,null);
  assert.equal(withHeadings([train([52,5])],[{...previous[0],heading:90}],15000)[0].heading,90);
  assert.equal(withHeadings([train([52,5])],[],15000)[0].heading,null);
});
test('all eight projected views and all four train families are distinct and valid',()=>{
  for(const type of ['IC','SPR','ICE','ARR']) {
    const views=Array.from({length:8},(_,i)=>trainSprite(type,i*45));
    assert.equal(new Set(views).size,8);
    for(const svg of views) {assert.ok(!/NaN|undefined|Infinity/.test(svg));assert.ok(svg.startsWith('<svg'));assert.ok(svg.endsWith('</svg>'));}
  }
  assert.equal(new Set(['IC','SPR','ICE','ARR'].map(type=>trainSprite(type,135))).size,4);
  assert.notEqual(trainSprite('IC',135,true),trainSprite('IC',135,false));
});
test('sixteen sprite views, motion streaks only for moving trains with a known direction',()=>{
  assert.equal(VIEWS,16);
  const views=Array.from({length:16},(_,i)=>trainSprite('IC',i*22.5));
  assert.equal(new Set(views).size,16);
  for(const svg of views) assert.ok(!/NaN|undefined|Infinity/.test(svg));
  assert.equal(viewIndex(0),0);assert.equal(viewIndex(22.5),1);assert.equal(viewIndex(350),0);assert.equal(viewIndex(-90),12);
  assert.equal(paceBand(null,90),0);assert.equal(paceBand(120,null),0);assert.equal(paceBand(5,90),0);assert.equal(paceBand(60,90),1);assert.equal(paceBand(130,90),2);
  assert.ok(trainSprite('SPR',90,false,2).includes('streak'));assert.ok(!trainSprite('SPR',90,false,0).includes('streak'));
  assert.ok(trainSprite('SPR',90,true).includes('class="halo"'));
});
