import { DatabaseSync } from 'node:sqlite';
export function openStore(path, generateKeys) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, subscription TEXT NOT NULL, rule TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sent (device TEXT NOT NULL, train TEXT NOT NULL, time INTEGER NOT NULL, PRIMARY KEY(device,train));
    CREATE TABLE IF NOT EXISTS rate_events (device TEXT NOT NULL, time INTEGER NOT NULL);`);
  // Additive migration for the earlier password-protected release.
  if (!db.prepare('PRAGMA table_info(devices)').all().some(c => c.name === 'owner')) db.exec('ALTER TABLE devices ADD COLUMN owner TEXT');
  const getConfig = key => { const row = db.prepare('SELECT value FROM config WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; };
  const setConfig = (key, value) => db.prepare('INSERT OR REPLACE INTO config VALUES (?,?)').run(key, JSON.stringify(value));
  let vapid = getConfig('vapid');
  if (!vapid) { vapid = generateKeys(); setConfig('vapid', vapid); }
  return {
    db, vapid, getConfig, setConfig,
    devices: () => db.prepare('SELECT * FROM devices ORDER BY created').all().map(d => ({ ...d, subscription: JSON.parse(d.subscription), rule: JSON.parse(d.rule) })),
    get: id => { const row = db.prepare('SELECT * FROM devices WHERE id=?').get(id); return row ? { ...row, rule: JSON.parse(row.rule), subscription: JSON.parse(row.subscription) } : null; },
    save(device) {
      if (!this.get(device.id) && this.devices().length >= 10) throw Object.assign(Error('The server notification capacity is full. The map remains available.'), { status: 409 });
      db.prepare('INSERT INTO devices (id,subscription,rule,created,owner) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription, rule=excluded.rule, owner=excluded.owner').run(device.id, JSON.stringify(device.subscription), JSON.stringify(device.rule), Date.now(), device.owner || null);
    },
    remove(id) { db.prepare('DELETE FROM devices WHERE id=?').run(id); db.prepare('DELETE FROM sent WHERE device=?').run(id); },
    eligible(id, train, now) {
      const last = db.prepare('SELECT time FROM sent WHERE device=? AND train=?').get(id, train);
      const count = db.prepare('SELECT count(*) AS n FROM rate_events WHERE device=? AND time>?').get(id, now - 3600000).n;
      return (!last || now - last.time >= 7200000) && count < 30;
    },
    mark(id, train, now) { db.prepare('INSERT OR REPLACE INTO sent VALUES (?,?,?)').run(id, train, now); db.prepare('INSERT INTO rate_events VALUES (?,?)').run(id, now); },
    unmark(id, train) { db.prepare('DELETE FROM sent WHERE device=? AND train=?').run(id, train); },
    prune(now) { db.prepare('DELETE FROM rate_events WHERE time<?').run(now - 3600000); db.prepare('DELETE FROM sent WHERE time<?').run(now - 7200000); }
  };
}
