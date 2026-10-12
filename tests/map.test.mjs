import test from 'node:test';
import assert from 'node:assert/strict';
import { journeyGeometry, trainStyle } from '../tracker/map-helpers.mjs';
test('routes preserve stop order, use station fallback, and break across missing coordinates', () => {
 const stops=[{stop:{lat:52,lng:4,name:'A'}},{stop:{uicCode:'B'},status:'PASSING'},{stop:{}},{stop:{lat:53,lng:5}},{stop:{lat:53.1,lng:5.1}}];
 const route=journeyGeometry(stops,[{UICCode:'B',lat:52.1,lng:4.1}]);
 assert.deepEqual(route.segments,[[[52,4],[52.1,4.1]],[[53,5],[53.1,5.1]]]);assert.equal(route.points[1].passing,true);
 assert.equal(journeyGeometry([{stop:{lat:null,lng:null}}]).points.length,0);
});
test('train families have distinct icons and ICE is international',()=>{
 assert.equal(trainStyle('IC').key,'intercity');assert.equal(trainStyle('SPR').key,'sprinter');assert.equal(trainStyle('ICE').key,'international');assert.equal(trainStyle('unknown').key,'regional');
});
