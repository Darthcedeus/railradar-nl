import test from 'node:test';
import assert from 'node:assert/strict';
import { nextCall, platform, internationalDeparture } from '../tracker/journey-helpers.mjs';
const now = Date.parse('2026-10-11T10:00:00Z');
const e = (time, extras = {}) => ({ plannedTime: `2026-10-11T${time}:00Z`, ...extras });
test('next stop skips past calls, passing points and cancelled calls', () => {
  const stops = [{ arrivals: [e('09:30')] }, { status: 'PASSING', arrivals: [e('10:01')] }, { arrivals: [e('10:02', { cancelled: true })] }, { arrivals: [e('10:05')] }];
  assert.equal(nextCall(stops, now).index, 3);
  assert.equal(nextCall(stops, now).label, 'Next stop');
});
test('actual delayed time takes priority over planned time', () => {
  assert.equal(nextCall([{ arrivals: [e('09:55', { actualTime: '2026-10-11T10:05:00Z' })] }], now).index, 0);
});
test('dwell and origin are distinguished from a future arrival', () => {
  assert.equal(nextCall([{ arrivals: [e('09:59')], departures: [e('10:02')] }], now).label, 'At station · timetable estimate');
  assert.equal(nextCall([{ departures: [e('10:02')] }], now).label, 'Upcoming departure');
});
test('completed or untimed journeys do not invent a next stop', () => {
  assert.equal(nextCall([{ arrivals: [e('09:59')] }, { stop: {} }], now), null);
  assert.equal(nextCall(undefined, now), null);
});
test('platform changes and unknown platforms', () => {
  assert.deepEqual(platform({ plannedTrack: '5a', actualTrack: '7' }), { value: '7', changed: true, planned: '5a' });
  assert.equal(platform({ plannedTrack: '2' }).changed, false);
  assert.equal(platform().value, 'Not reported');
});
test('international board supports ICE, Eurostar, international IC and foreign calls but excludes buses', () => {
  for (const categoryCode of ['ICE', 'EST', 'EC', 'NJ']) assert.equal(internationalDeparture({ product: { type: 'TRAIN', categoryCode } }), true);
  assert.equal(internationalDeparture({ product: { type: 'TRAIN', categoryCode: 'IC', operatorCode: 'NS Int' } }), true);
  assert.equal(internationalDeparture({ product: { type: 'TRAIN', categoryCode: 'IC' }, routeStations: [{ uicCode: '8814001' }] }), true);
  assert.equal(Boolean(internationalDeparture({ product: { type: 'TRAIN', categoryCode: 'IC' }, routeStations: [{ uicCode: '8400282' }] })), false);
  assert.equal(internationalDeparture({ product: { type: 'BUS', categoryCode: 'INT' } }), false);
});
