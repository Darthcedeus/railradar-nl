import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';
try { await access('.env'); console.error('.env already exists. Edit it directly; setup will not overwrite credentials.'); process.exit(1); } catch {}
let muted = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk); callback(); } });
const rl = createInterface({ input: process.stdin, output, terminal: true });
async function ask(prompt, secret = false) { process.stdout.write(prompt); muted = secret; const result = await rl.question(''); muted = false; if (secret) process.stdout.write('\n'); return result.trim(); }
try {
  const ip = await ask('Ubuntu app VM Tailscale IPv4 (100.x.y.z): ');
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255) || parts[0] !== 100 || parts[1] < 64 || parts[1] > 127) throw Error('Use your actual Tailscale IPv4 address (100.64.0.0/10).');
  const key = await ask('NS subscription key (hidden): ', true);
  if (!/^[a-f0-9]{32}$/i.test(key)) throw Error('Expected a 32-character NS subscription key.');
  await writeFile('.env', `TAILSCALE_BIND_IP=${ip}\nNS_API_SUBSCRIPTION_KEY=${key}\nSESSION_SECRET=${randomBytes(32).toString('hex')}\nPOLL_SECONDS=30\n`, { mode: 0o600, flag: 'wx' });
  console.log('Created protected .env. Keep it private. Run docker compose up -d --build next.');
} catch (error) { console.error(error.message); process.exitCode = 1; } finally { rl.close(); }
