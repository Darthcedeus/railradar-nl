import { normalizeVehicles, distance } from '../tracker/data.mjs';
import { approaching } from './alerts.mjs';
import { destinationResolver } from './destinations.mjs';
export function createMonitor({ store, ns, sendPush, interval = 30000, now = Date.now }) {
  const snapshots = new Map(); let running = false, timer, stopped = true;
  let status = { checkedAt: null, successAt: null, error: null, intervalSeconds: interval / 1000 };
  async function tick() {
    if (running) return;
    running = true;
    try {
      const devices = store.devices(); const at = now(); const active = new Set(devices.map(d => d.id));
      const resolveDestination = destinationResolver(ns);
      for (const id of snapshots.keys()) if (!active.has(id)) snapshots.delete(id);
      const groups = new Map();
      for (const device of devices) {
        const key = `${device.rule.lat},${device.rule.lng}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(device);
      }
      let error = null;
      for (const group of groups.values()) {
        const { lat, lng } = group[0].rule;
        let trains;
        try {
          const response = await ns(new Request(`https://internal/api/vehicles?lat=${lat}&lng=${lng}&radius=12000`));
          if (!response.ok) throw Error('NS position feed unavailable.');
          trains = normalizeVehicles(await response.json());
        } catch { error = 'NS position feed unavailable; affected locations skipped.'; for (const d of group) snapshots.delete(d.id); continue; }
        const sampledAt = now();
        for (const device of group) {
          const previous = snapshots.get(device.id), ruleKey = JSON.stringify(device.rule);
          for (const train of trains) {
            if (JSON.stringify(store.get(device.id)?.rule) !== ruleKey) break;
            if (previous?.ruleKey !== ruleKey || !approaching(train, previous.trains.get(train.id), device.rule, sampledAt, interval * 2 + 30000) || !store.eligible(device.id, train.id, sampledAt)) continue;
            const destination = await resolveDestination(train.number);
            if (JSON.stringify(store.get(device.id)?.rule) !== ruleKey) break;
            store.mark(device.id, train.id, sampledAt);
            const km = (distance([device.rule.lat, device.rule.lng], train.pos) / 1000).toFixed(1);
            const speed = Number.isFinite(train.speed) && train.speed >= 0 ? `${Math.round(train.speed)} km/h` : 'Speed unavailable';
            try {
              await sendPush(device.subscription, { title: destination ? `${train.name} → ${destination}` : `${train.name} · destination unavailable`, body: `${speed} · Approaching your area · about ${km} km from ${device.rule.label}. Reported movement is toward your area; exact passage is not guaranteed.`, tag: `train-${train.id}` });
            } catch (err) {
              if ([404, 410].includes(err.statusCode)) { store.remove(device.id); break; }
              store.unmark(device.id, train.id); error = 'A push delivery failed; monitoring will retry when eligible.';
            }
          }
          snapshots.set(device.id, { ruleKey, trains: new Map(trains.map(t => [t.id, { pos: t.pos, time: sampledAt }])) });
        }
      }
      store.prune(at);
      status = { ...status, checkedAt: now(), successAt: !error && devices.length ? now() : status.successAt, error };
    } catch { status = { ...status, checkedAt: now(), error: 'Monitor error; retrying on the next cycle.' }; }
    finally { running = false; }
  }
  async function loop() { await tick(); if (!stopped) timer = setTimeout(loop, interval); }
  return { tick, status: () => status, start() { if (stopped) { stopped = false; void loop(); } }, stop() { stopped = true; clearTimeout(timer); } };
}
