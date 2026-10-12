import { normalizeVehicles, distance, HAGUE } from './data.mjs';
import { INTERNATIONAL_HUBS } from './international-hubs.mjs';
const NS_BASE = 'https://gateway.apiportal.ns.nl';
const WINDOW = 30 * 60 * 1000;
export function createHandler({ key, fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map(), pending = new Map();
  let observations = [];
  const startedAt = now();
  function area(url, defaultRadius = 12000) {
    const lat = Number(url.searchParams.get('lat') ?? HAGUE[0]);
    const lng = Number(url.searchParams.get('lng') ?? HAGUE[1]);
    const radius = Number(url.searchParams.get('radius') ?? defaultRadius);
    if (![lat, lng, radius].every(Number.isFinite) || lat < 50 || lat > 54 || lng < 3 || lng > 8 || radius < 1000 || radius > 30000) {
      throw Object.assign(new Error('Use coordinates in the Netherlands and a radius of 1–30 km.'), { status: 400 });
    }
    return { lat, lng, radius };
  }
  async function request(upstream, ttl, kind) {
    const cacheKey = upstream.toString(), hit = cache.get(cacheKey);
    if (hit && now() - hit.time < ttl) return hit.data;
    if (pending.has(cacheKey)) return pending.get(cacheKey);
    if (pending.size >= 25) throw Object.assign(new Error('Too many requests. Please try again shortly.'), { status: 429 });
    const task = (async () => {
      const response = await fetcher(upstream, { headers: { 'Ocp-Apim-Subscription-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw Object.assign(new Error(response.status === 401 || response.status === 403 ? 'NS rejected access. Check the key and its product subscription.' : response.status === 429 ? 'NS request limit reached. Please wait before retrying.' : `NS API returned HTTP ${response.status}.`), { status: response.status >= 400 && response.status < 600 ? response.status : 502 });
      const data = await response.json();
      if (kind === 'vehicles') {
        const trains = normalizeVehicles(data), time = now();
        observations = observations.filter(o => time - o.time <= WINDOW);
        observations.push(...trains.map(train => ({ ...train, time })));
        observations = observations.slice(-20000);
        data.observedAt = new Date(time).toISOString();
      }
      if (cache.size >= 200) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, { time: now(), data });
      return data;
    })();
    pending.set(cacheKey, task);
    try { return await task; } finally { pending.delete(cacheKey); }
  }
  return async function handle(req) {
    const send = (status, body) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    try {
      if (req.method !== 'GET') { return send(405, { error: 'Method not allowed' }); }
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/health') return send(200, { ok: true, configured: Boolean(key), startedAt: new Date(startedAt).toISOString() });
      if (url.pathname === '/api/history') {
        const { lat, lng, radius } = area(url, 3000), time = now();
        observations = observations.filter(o => time - o.time <= WINDOW);
        const grouped = new Map();
        for (const o of observations) {
          const meters = distance([lat, lng], o.pos);
          if (meters > radius) continue;
          const entry = grouped.get(o.id);
          grouped.set(o.id, { ...o, firstSeen: entry?.firstSeen ?? o.time, lastSeen: o.time, closestMeters: Math.min(entry?.closestMeters ?? Infinity, Math.round(meters)) });
        }
        return send(200, { sightings: [...grouped.values()].sort((a, b) => b.lastSeen - a.lastSeen), windowMinutes: 30, recordingSince: new Date(startedAt).toISOString(), radius, limited: observations.length >= 20000 });
      }
      let upstream, ttl, kind;
      if (url.pathname === '/api/vehicles') {
        const { lat, lng, radius } = area(url);
        upstream = new URL('/virtual-train-api/vehicle', NS_BASE);
        for (const [k, v] of Object.entries({ lat, lng, radius, limit: 300 })) upstream.searchParams.set(k, String(v));
        ttl = 8000; kind = 'vehicles';
      } else if (url.pathname === '/api/journey') {
        const train = url.searchParams.get('train');
        if (!/^\d{1,8}$/.test(train ?? '')) return send(400, { error: 'Invalid train number' });
        upstream = new URL('/reisinformatie-api/api/v2/journey', NS_BASE);
        upstream.searchParams.set('train', train); upstream.searchParams.set('omitCrowdForecast', 'true');
        ttl = 60000;
      } else if (url.pathname === '/api/departures') {
        const station = url.searchParams.get('station');
        if (!INTERNATIONAL_HUBS.includes(station)) return send(400, { error: 'Choose a supported international hub.' });
        upstream = new URL('/reisinformatie-api/api/v2/departures', NS_BASE);
        upstream.searchParams.set('station', station); upstream.searchParams.set('maxJourneys', '100');
        ttl = 60000;
      } else if (url.pathname === '/api/stations') {
        upstream = new URL('/reisinformatie-api/api/v2/stations', NS_BASE); ttl = 3600000;
      } else return send(404, { error: 'Not found' });
      if (!key) return send(503, { error: 'Set NS_API_SUBSCRIPTION_KEY on the server to enable live trains.' });
      return send(200, await request(upstream, ttl, kind));
    } catch (error) {
      return send(error.status || 502, { error: error.status ? error.message : 'Could not reach NS or read its response. Retrying automatically.' });
    }
  };
}
