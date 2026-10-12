import { randomBytes, timingSafeEqual, createHmac, createHash } from 'node:crypto';
const sign = (value, secret) => createHmac('sha256', secret).update(value).digest('base64url');
export function issueSession(secret, now = Date.now()) {
  const value = `${now + 365 * 86400000}.${randomBytes(16).toString('hex')}`;
  return `${value}.${sign(value, secret)}`;
}
export function validSession(cookie = '', secret, now = Date.now()) {
  const token = cookie.split(';').map(v => v.trim()).find(v => v.startsWith('rr_session='))?.slice(11);
  if (!token || token.length > 200) return false;
  const [expires, nonce, signature] = token.split('.');
  if (!/^\d+$/.test(expires) || Number(expires) <= now || Number(expires) > now + 366 * 86400000 || !/^[a-f0-9]{32}$/.test(nonce || '')) return false;
  const expected = Buffer.from(sign(`${expires}.${nonce}`, secret));
  const actual = Buffer.from(signature || '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function sessionOwner(cookie, secret) {
  if (!validSession(cookie, secret)) return null;
  const token = cookie.split(';').map(v => v.trim()).find(v => v.startsWith('rr_session=')).slice(11);
  return createHash('sha256').update(token).digest('hex');
}
