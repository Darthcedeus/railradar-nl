# RailRadar NL — Docker / AMD64

Standalone deployment for **https://trein.humza.xyz**. This package does not require Sites, a Cloudflare Worker, or an Apple developer account. It preserves the existing tracker, approximate route lines, next-stop/platform panel, ProRail/PDOK layer and international departure boards (including Schiphol).

Train markers now use shaded isometric vector sprites: yellow/blue double-deck Intercity, white/blue Sprinter, silver/red international, and green regional trains. Eight separately projected views keep the roof upright while facing the last estimated movement direction. Direction needs two fresh positions; tiny movement retains the previous estimate, and stale samples or implausible jumps clear it. Until direction is known a default southeast view is used; the popup explicitly reports that direction is unknown. These are lightweight 3D-looking 2D sprites, not live 3D models or exact rolling-stock identification. Red INT badges remain departure-station markers, not positioned trains.

## Architecture

- Your existing **Caddy VM** terminates public HTTPS and proxies through Tailscale to the **Ubuntu app VM**, port 3000.
- One Node 24 container serves the public React frontend and train API, plus a background monitoring loop. The monitor runs even when every browser is closed; it is not a browser timer or ChatGPT task.
- A persistent Docker volume holds SQLite data: device subscriptions, saved locations, VAPID keys and duplicate-alert history. No additional database container is needed. Run exactly one application replica.
- The map and train API are public, with no password or account. A secure, automatically created browser cookie protects that browser's alert settings. Visitors cannot list, change, test or delete other browsers' subscriptions. Push endpoints and encryption secrets are never returned in the management API. The NS key stays server-side.

## Updating from the password-protected package

Replace the source files with this version, preserve `.env` and the Docker volume, then run `docker compose up -d --build`. `ADMIN_PASSWORD_HASH` is no longer used and can be removed from `.env`; preserve `SESSION_SECRET`. The database migration is additive. Existing phones continue receiving their saved alerts, but must tap **Enable alerts** once again on the same phone to claim their existing subscription for private browser management. This does not create a duplicate subscription. The old Sites publication is not changed by this package.

## 1. Prepare the app VM

Requirements: Ubuntu AMD64, Docker Engine with the Compose v2 plugin, and Tailscale already connected. The commands below assume your user can run Docker. No Node installation is required on the VM.

Clone the repository directly on your app VM (install Git first if needed):

```bash
git clone https://github.com/Darthcedeus/railradar-nl.git
cd railradar-nl
tailscale ip -4
```

Run interactive setup. It asks for the **app VM's Tailscale IPv4 address** and your NS subscription key. Secret input is hidden. It generates a random secret for anonymous device cookies in a protected `.env` file, and refuses to overwrite an existing one. No app password is needed.

```bash
docker run --rm -it --user "$(id -u):$(id -g)" \
  -v "$PWD:/app" -w /app node:24-bookworm-slim \
  node scripts/setup.mjs
docker compose up -d --build
docker compose ps
docker compose logs --tail=80 railradar
```

The image builds for `linux/amd64`. The app port binds to the supplied Tailscale address, not `0.0.0.0`. Start Tailscale before starting the container; if Docker fails to bind after a VM reboot, restore Tailscale connectivity and rerun `docker compose up -d`.

The NS key is **not embedded in this repository**. Enter it at setup on your VM. Never upload `.env`, database backups or device subscription endpoints publicly. Anyone with Docker/root access can read runtime secrets.

## 2. Network and Caddy (on your other VM)

Allow the **Caddy VM → app VM TCP 3000** in your Tailscale grants/ACL policy. Restrict other tailnet peers as appropriate; the default Tailscale policy may allow every peer. Do not replace your full policy with a fragment or lock out your SSH access.

From the Caddy VM, replace the placeholder and check reachability:

```bash
curl http://APP_VM_TAILSCALE_IP:3000/healthz
```

Expected: `{"ok":true}`. This checks the process, not NS or push delivery.

Add the following block to your **existing** Caddyfile, replacing the placeholder with the app VM address:

```caddyfile
trein.humza.xyz {
    encode zstd gzip
    reverse_proxy http://APP_VM_TAILSCALE_IP:3000
    header Strict-Transport-Security "max-age=31536000"
}
```

For a standard systemd Caddy installation:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
```

If Caddy itself is containerized, validate/reload within that deployment instead and verify its network namespace can reach the app VM's Tailscale IP. Do not add a second competing Caddy instance.

Point Cloudflare DNS for `trein.humza.xyz` to the **public address serving Caddy**, NOT the Tailscale address. Begin with DNS-only (grey cloud) for simpler diagnosis. Public TCP 80/443 must reach Caddy for ordinary automatic certificate issuance; use your existing DNS-challenge configuration if inbound validation is unavailable. Do not open public port 3000. Avoid a stale AAAA record pointing elsewhere.

If enabling Cloudflare proxying later, use Full (strict) TLS, do not cache `/api/*`, HTML, `/sw.js` or the manifest, and avoid interactive challenges that block service-worker setup. No Cloudflare API token is required by RailRadar.

Do not rely solely on UFW for Docker-published port isolation. Keep port 3000 unforwarded at the router/cloud firewall, restrict tailnet access and validate reachability from an unauthorized host. Docker forwarding rules and host routing can affect isolation even with a specific bind address.

## 3. Enable iPhone notifications

1. Open **https://trein.humza.xyz** in Safari on iOS 16.4 or newer. Confirm the certificate is valid.
2. Share → **Add to Home Screen**. Leave **Open as Web App** enabled if that option appears.
3. Open the new RailRadar icon. The map opens directly, without signing in.
4. Pick a station, use My location, or move the map and tap **Search this map area**.
5. Open **Phone alerts**, tap **Use current map search area**, name the saved location and choose a radius/type filter.
6. Tap **Enable alerts on this phone**, then **Allow**. This explicit action is necessary; the app never prompts automatically.
7. Tap **Send test**. Close RailRadar and verify the notification arrives. Check Focus modes and Settings → Notifications → RailRadar if it is silenced. Test acceptance from the push service is not proof of display.

Each device gets one saved location/rule, with up to ten devices total across this small deployment. **This browser's saved alerts** only lists that browser's subscriptions. **Disable this phone** removes the server record and browser subscription. Disable before lending the phone to someone else or clearing browser data. There is no public administrator dashboard.

The anonymous cookie lasts up to one year. If it expires or is cleared, enable alerts again to recover the subscription using the endpoint and encryption secrets still held by that browser. A different visitor knowing only a device ID cannot recover it. If all browser data is erased, block notifications in the phone's settings; expired push subscriptions are removed after push-service rejection. Clearing cookies alone does not stop existing alerts. Keep subscription endpoints and keys private.

Public map traffic and notifications all share your NS quota. The ten-device notification cap remains intentional for a small VM deployment; anonymous visitors can use available slots. The map remains public when notification capacity is full. Use your existing Caddy/Cloudflare traffic controls if you expect substantial public traffic.

The saved location is fixed: the app does not follow your iPhone in the background. Names/locations appear in notifications and may be visible on the lock screen. Use a generic label if preferred and adjust notification previews in iOS settings.

## Alert behaviour and limits

- Default polling: **30 seconds after each cycle completes** while at least one device is enabled. Change `POLL_SECONDS` in `.env` to 15–300 and recreate the container. This is best-effort, not real-time or a delivery guarantee.
- Per distinct saved coordinate pair, one NS request per polling cycle (plus interactive map/route/departure traffic). Start with one location. At 30 seconds, continuous monitoring is roughly 2,880 requests/day/location before caching and cycle duration; confirm your NS subscription allowance and adjust polling as needed. Requests for identical saved coordinates share a fetch.
- Needs two fresh successful samples. A train must be within the selected 1–5 km radius and move at least 30 metres toward the saved point. Stationary trains, stale sample gaps, implausible jumps and receding trains are skipped. After a feed failure or restart, it waits for a new baseline.
- This uses changing straight-line distance, not track topology or a confirmed crossing prediction. A train may be on a nearby branch, miss the radius between polls, or stop/divert. NS coordinates themselves may be delayed. Do not use for railway operations, crossing decisions or safety.
- One alert per device/train number per two hours; at most 30 attempts per device/hour. Different trips reusing a number inside that window can be suppressed. Duplicate state persists across restart. Rare process crashes during delivery can cause an alert to be missed; there is no exactly-once delivery guarantee.
- Push messages expire after 60 seconds at the push service so an offline phone is not flooded with old passing alerts. Network/OS delivery delays may still occur.
- Only trains with reported coordinates can alert. International **INT station markers** are departure boards, not moving positions. They do not trigger proximity alerts. Freight data remains unavailable.
- Subscriptions returning HTTP 404/410 are automatically removed. Other failures are retried when the train remains eligible, within rate limits. The alert panel reports last monitor check and errors.
- Temporary sightings history is in memory and resets on restart. Alert settings, keys and duplicate suppression are persisted.

## Maintenance and backup

Keep the Docker volume and `.env` private and backed up. **Do not run `docker compose down -v`**: that deletes subscriptions and VAPID keys, requiring all phones to resubscribe.

Stop the app briefly before backing up the SQLite files; do not copy just the main SQLite file while the app is running in WAL mode:

```bash
mkdir -m 700 backups
docker compose stop railradar
docker compose cp railradar:/data ./backups/data
docker compose start railradar
```

Use a new empty, private backup destination each time; back up `.env` separately to an encrypted location. Backups contain saved locations and push credentials. Restore into an empty volume with ownership matching container user `node` (UID/GID 1000), preserve the original VAPID keys and `.env`, then restart. Never expose backup archives via Caddy.

For future updates, run these commands from the same checkout on your app VM:

```bash
git pull --ff-only
docker compose up -d --build
docker compose ps
docker compose logs --tail=80 railradar
```

Do not rerun setup: preserve `.env` and the Docker volume. Keep the checkout directory name stable, as Compose uses it to name the project's volume. If Git reports local changes or diverging history, review them rather than force-resetting the checkout. Never use `git clean -x` here: it could remove your ignored `.env` and backups.

For base-image security updates use `docker compose build --pull` followed by `docker compose up -d`. The lockfile pins JS dependencies; the Node 24 Docker tag receives upstream patches. Audit and update dependencies periodically.

Keep `SESSION_SECRET` stable across rebuilds. Rotating it invalidates browser management cookies; phones will need to enable alerts again to recover control of existing subscriptions. It does not stop existing push delivery. Avoid pasting credentials into shell history.

## Validation completed / still required

Completed in the build workspace: frontend production build; automated route, next-stop, platform, international-board, public access, anonymous device isolation/recovery, CSRF, path handling, subscription validation, persistent storage, monitor approach/dedup/failure/restart, and API lifecycle tests. Push delivery tests use an injected mock: no notification was sent to your phone.

Not yet verified: Docker image execution (Docker is unavailable in the build workspace), Caddy/Tailscale/DNS connectivity on your VMs, rendered mobile/desktop browser behaviour, or real iPhone subscription and lock-screen delivery. Complete the steps above before relying on alerts. There is no VM deployment or DNS change included in this download. Your existing Sites publication is unchanged.

Run local checks with Node 24:

```bash
npm ci
npm run build
npm test
```

## Reference documentation

- Apple Web Push: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
- Caddy reverse proxy: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- Docker Compose services: https://docs.docker.com/reference/compose-file/services/
- Docker port-publishing cautions: https://docs.docker.com/engine/network/port-publishing/
- Tailscale access control: https://tailscale.com/docs/features/access-control/acls
- Web Push library: https://github.com/web-push-libs/web-push

This package contains no NS subscription key, login password, session secret or generated push private key.
