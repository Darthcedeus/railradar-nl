import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { isIPv4 } from 'node:net';
import { randomBytes } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';
try { await access('.env'); console.error('.env already exists. Edit it directly; setup will not overwrite credentials.'); process.exit(1); } catch {}
let muted = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk); callback(); } });
const rl = createInterface({ input: process.stdin, output, terminal: true });
async function ask(prompt, secret = false) { process.stdout.write(prompt); muted = secret; const result = await rl.question(''); muted = false; if (secret) process.stdout.write('\n'); return result.trim(); }
try {
  const origin = await ask('Public HTTPS origin (for example https://railradar.example.com): ');
  let url;
  try { url = new URL(origin); } catch { throw Error('Enter a valid HTTPS origin.'); }
  if (url.protocol !== 'https:' || url.origin !== origin) throw Error('Use an HTTPS origin without a path or trailing slash.');
  const ip = await ask('Host bind IPv4 [127.0.0.1]: ') || '127.0.0.1';
  if (!isIPv4(ip)) throw Error('Enter a valid host IPv4 address.');
  const key = await ask('NS subscription key (hidden): ', true);
  if (!/^[a-f0-9]{32}$/i.test(key)) throw Error('Expected a 32-character NS subscription key.');
  await writeFile('.env', `APP_ORIGIN=${origin}\nBIND_IP=${ip}\nNS_API_SUBSCRIPTION_KEY=${key}\nSESSION_SECRET=${randomBytes(32).toString('hex')}\nPOLL_SECONDS=30\n`, { mode: 0o600, flag: 'wx' });
  console.log('Created protected .env. Keep it private. Run docker compose up -d --build next.');
} catch (error) { console.error(error.message); process.exitCode = 1; } finally { rl.close(); }
