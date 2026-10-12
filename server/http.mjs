import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { issueSession, sessionOwner } from './auth.mjs';
import { validateAlert } from './alerts.mjs';
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(Error('Use JSON.'), { status: 415 });
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 16384) throw Object.assign(Error('Request too large.'), { status: 413 }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw Object.assign(Error('Invalid JSON.'), { status: 400 }); }
}
export function createApp({ config, store, ns, monitor, sendPush, staticDir = resolve('dist') }) {
  let testTimes = new Map();
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://service.pdok.nl; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const url = new URL(req.url, config.origin);
      if (url.pathname === '/healthz' && req.method === 'GET') return json(res, 200, { ok: true });
      const write = !['GET', 'HEAD'].includes(req.method);
      if (write && req.headers.origin !== config.origin) return json(res, 403, { error: 'Origin rejected.' });
      const owner = sessionOwner(req.headers.cookie, config.sessionSecret);
      if (url.pathname === '/api/device/session' && req.method === 'POST') {
        if (!owner) res.setHeader('Set-Cookie', `rr_session=${issueSession(config.sessionSecret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`);
        return json(res, 200, { ok: true });
      }
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname.startsWith('/api/push') && !owner) return json(res, 401, { error: 'Device session unavailable. Allow cookies and reload the app.' });
        if (url.pathname === '/api/push' && req.method === 'GET') return json(res, 200, {
          publicKey: store.vapid.publicKey, monitor: monitor.status(), devices: store.devices().filter(d => d.owner === owner).map(d => ({ id: d.id, rule: d.rule, created: d.created }))
        });
        if (url.pathname === '/api/push' && req.method === 'POST') {
          const device = validateAlert(await body(req)), existing = store.get(device.id);
          // The endpoint and both browser-held encryption secrets prove possession after cookie loss.
          if (existing && existing.owner !== owner && JSON.stringify(existing.subscription) !== JSON.stringify(device.subscription)) return json(res, 403, { error: 'Subscription ownership could not be verified.' });
          store.save({ ...device, owner }); return json(res, 200, { id: device.id });
        }
        if (url.pathname === '/api/push' && req.method === 'DELETE') {
          const { id } = await body(req); if (!/^[a-f0-9]{64}$/.test(id || '')) return json(res, 400, { error: 'Invalid device.' });
          if (store.get(id)?.owner !== owner) return json(res, 404, { error: 'Device not found.' });
          store.remove(id); return json(res, 200, { ok: true });
        }
        if (url.pathname === '/api/push/test' && req.method === 'POST') {
          const { id } = await body(req), device = typeof id === 'string' ? store.get(id) : null;
          if (!device || device.owner !== owner) return json(res, 404, { error: 'Enable alerts on this device first.' });
          const at = Date.now(); testTimes = new Map([...testTimes].filter(([, t]) => t > at - 60000));
          if (testTimes.has(id)) return json(res, 429, { error: 'Wait one minute before another test.' });
          testTimes.set(id, at);
          try { await sendPush(device.subscription, { title: 'RailRadar test notification', body: 'Push delivery works. Train alerts use your saved location.', tag: 'railradar-test' }); }
          catch (e) { if ([404,410].includes(e.statusCode)) store.remove(id); return json(res, 502, { error: 'Push delivery failed. Disable and re-enable this device, then retry.' }); }
          return json(res, 200, { ok: true });
        }
        if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
        const response = await ns(new Request(`${config.origin}${url.pathname}${url.search}`));
        res.writeHead(response.status, Object.fromEntries(response.headers)); return res.end(await response.text());
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
      const path = decodeURIComponent(url.pathname), relative = path === '/' ? '/index.html' : path;
      const file = resolve(staticDir, '.' + relative);
      if (!file.startsWith(resolve(staticDir) + sep) || relative.includes('\\')) return json(res, 404, { error: 'Not found.' });
      const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };
      try {
        const bytes = await readFile(file);
        res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
        res.end(req.method === 'HEAD' ? undefined : bytes);
      } catch { json(res, 404, { error: 'Not found.' }); }
    } catch (error) { json(res, error.status || 400, { error: error.status ? error.message : 'Invalid request or operation unavailable.' }); }
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000;
  return server;
}
