import { createHash } from 'node:crypto';
import { distance } from '../tracker/data.mjs';
import { trainStyle } from '../tracker/map-helpers.mjs';
export function validateAlert(input) {
  const s = input?.subscription, rule = input?.rule;
  let url;
  try { url = new URL(s.endpoint); } catch { throw Error('Invalid push subscription.'); }
  // Browser push vendors only. Never allow arbitrary/private HTTP destinations.
  const allowed = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com'];
  if (url.protocol !== 'https:' || !allowed.includes(url.hostname) || url.port || url.username || url.password || url.hash || url.href.length > 2048) throw Error('Unsupported push service. Use Safari, Chrome, or Firefox.');
  for (const [key, size] of [['p256dh', 65], ['auth', 16]]) {
    const value = s.keys?.[key];
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value) || Buffer.from(value, 'base64url').length !== size) throw Error('Invalid subscription keys.');
  }
  if (![rule?.lat, rule?.lng, rule?.radius].every(v => typeof v === 'number' && Number.isFinite(v)) || rule.lat < 50 || rule.lat > 54 || rule.lng < 3 || rule.lng > 8 || rule.radius < 1000 || rule.radius > 5000) throw Error('Choose a Netherlands location and a radius of 1–5 km.');
  if (!['all', 'intercity', 'sprinter', 'international', 'regional'].includes(rule.kind)) throw Error('Invalid train filter.');
  if (typeof rule.label !== 'string' || !rule.label.trim() || rule.label.length > 80) throw Error('Location name must be 1–80 characters.');
  return { id: createHash('sha256').update(url.href).digest('hex'), subscription: { endpoint: url.href, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, rule: { lat: rule.lat, lng: rule.lng, radius: rule.radius, kind: rule.kind, label: rule.label.trim() } };
}
export function approaching(train, previous, rule, now, maxAge) {
  if (!previous || now - previous.time > maxAge || now <= previous.time) return false;
  if (rule.kind !== 'all' && trainStyle(train.type).key !== rule.kind) return false;
  const current = distance([rule.lat, rule.lng], train.pos);
  const before = distance([rule.lat, rule.lng], previous.pos);
  const movement = distance(previous.pos, train.pos);
  // Require meaningful motion, reject jumps >400 km/h and stationary reports.
  return current <= rule.radius && before - current >= 30 && movement >= 30 && movement / ((now - previous.time) / 1000) < 112 && train.speed !== 0;
}
