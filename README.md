# RailRadar NL

A self-hosted Netherlands train tracker with live NS positions, route details, station departure boards, railway infrastructure overlays, and proximity push notifications. Train markers use directional, isometric railcar sprites; they represent service categories rather than exact rolling stock. International station markers show departure boards, not live train positions. Freight tracking is not available.

The interface is available in English and Dutch (the **NL/EN** button; defaults to the browser language) and has light, dark and automatic themes (the sun/moon button). Select a train and tap **Follow train** to keep the map centred on it; dragging the map stops following. Markers glide between position reports, show estimated direction in 16 views, shrink when zoomed out, and show train numbers when zoomed in.

## Architecture

One Node 24 service serves the React frontend and API and runs the background alert monitor. SQLite stores subscriptions, alert settings, VAPID keys, and duplicate-alert history in a persistent Docker volume. Run one application replica. A reverse proxy supplies public HTTPS.

The map is public. Browser-specific cookies protect alert management; each browser can only manage its own subscriptions. NS credentials stay on the server.

## Setup

Requirements: Git, Docker Engine with Compose v2, an NS API subscription key, and a public HTTPS origin. The included Compose configuration targets Linux AMD64.

Clone this repository and enter its checkout directory. For a new installation, run:

```bash
docker run --rm -it --user "$(id -u):$(id -g)" \
  -v "$PWD:/app" -w /app node:24-bookworm-slim \
  node scripts/setup.mjs
docker compose up -d --build
docker compose ps
```

Setup asks for the public HTTPS origin, host bind IPv4, and NS subscription key. It generates a session secret and writes a protected `.env`, refusing to overwrite an existing file. `.env.example` documents the variables; its values are placeholders.

| Variable | Purpose |
| --- | --- |
| `APP_ORIGIN` | Required public HTTPS origin, without a trailing slash or path. |
| `BIND_IP` | Host interface for the published app port; defaults to `127.0.0.1`. Use the VM's Tailscale/private IP when the proxy runs on another machine. |
| `HOST_PORT` | Host port the app is published on; defaults to `3000`. The container always listens on 3000 internally. |
| `NS_API_SUBSCRIPTION_KEY` | NS API credential. |
| `SESSION_SECRET` | Stable, random 64-character lowercase hexadecimal secret. |
| `POLL_SECONDS` | Monitor interval, 15–300 seconds; default 30. |

Configure HTTPS with your preferred reverse proxy. `Caddyfile.example` illustrates a proxy running directly on the same host. Use your own hostname and a reachable private upstream for other layouts. Restrict access to the app port to the proxy; only the HTTPS endpoint should be public. Do not cache API responses, HTML, the service worker, or the web manifest.

Check the process with `curl --fail http://127.0.0.1:3000/healthz` when using the default bind address. Expect `{"ok":true}`; this does not verify NS or push delivery.

## Existing installations

Before deploying this configuration cleanup, add `APP_ORIGIN` with your existing public HTTPS origin to your private `.env`. Set `BIND_IP` to the host address your proxy currently reaches; the new default is loopback. Replace any older bind-address variable with `BIND_IP`. Custom Compose files must pass `APP_ORIGIN` into the container and preserve their existing port and volume mappings.

Keep `.env`, `SESSION_SECRET`, the data volume, and the Compose project name stable. Do not rerun setup on an existing installation. Local `compose.*.yaml` / `compose.*.yml` overrides and the active `Caddyfile` are ignored by Git and Docker's build context. Continue using your usual `-f` options when updating a custom Compose deployment.

For upgrades from an older password-protected release, `ADMIN_PASSWORD_HASH` is no longer used. Enable alerts once again on each existing phone to claim its subscription for browser-specific management; this does not duplicate the subscription.

## Enable iPhone notifications

1. Open your configured HTTPS URL in Safari on iOS 16.4 or newer. Confirm the certificate is valid.
2. Share → **Add to Home Screen**. Leave **Open as Web App** enabled if that option appears.
3. Open the new RailRadar icon. The map opens directly, without signing in.
4. Pick a station, use My location, or move the map and tap **Search this map area**.
5. Open **Phone alerts**, tap **Use current map search area**, name the saved location and choose a radius/type filter.
6. Tap **Enable alerts on this phone**, then **Allow**. This explicit action is necessary; the app never prompts automatically.
7. Tap **Send test**. Close RailRadar and verify the notification arrives. Check Focus modes and Settings → Notifications → RailRadar if it is silenced. Test acceptance from the push service is not proof of display.

Each device gets one saved location/rule, with up to ten devices total across this small deployment. **This browser's saved alerts** only lists that browser's subscriptions. **Disable this phone** removes the server record and browser subscription. Disable before lending the phone to someone else or clearing browser data. There is no public administrator dashboard.

The anonymous cookie lasts up to one year. If it expires or is cleared, enable alerts again to recover the subscription using the endpoint and encryption secrets still held by that browser. A different visitor knowing only a device ID cannot recover it. If all browser data is erased, block notifications in the phone's settings; expired push subscriptions are removed after push-service rejection. Clearing cookies alone does not stop existing alerts. Keep subscription endpoints and keys private.

Public map traffic and notifications all share your NS quota. The ten-device notification cap remains intentional for a small installation; anonymous visitors can use available slots. The map remains public when notification capacity is full. Use your reverse-proxy traffic controls if you expect substantial public traffic.

The saved location is fixed: the app does not follow your iPhone in the background. Names/locations appear in notifications and may be visible on the lock screen. Use a generic label if preferred and adjust notification previews in iOS settings.

## Alert behaviour and limits

Passing-train notifications show the latest reported speed in km/h (or **Speed unavailable**), plus the train name/number and final destination from its NS journey, for example **IC 1234 → Amsterdam Centraal**. Only alert-eligible trains trigger a journey lookup; lookups are shared across devices within a cycle and use the API cache. Station names are resolved from the station catalogue when necessary. This adds journey requests to your NS quota. Missing, cancelled, incomplete or unavailable terminal information is shown as **destination unavailable**; the alert is still sent. Destination enrichment waits at most five seconds per distinct eligible train. No phone resubscription is needed after updating.

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

For future updates, run these commands from the same checkout on your host:

```bash
git pull --ff-only
docker compose up -d --build
docker compose ps
docker compose logs --tail=80 railradar
```

Do not rerun setup: preserve `.env` and the Docker volume. Keep the checkout directory name stable, as Compose uses it to name the project's volume. If Git reports local changes or diverging history, review them rather than force-resetting the checkout. Never use `git clean -x` here: it could remove your ignored `.env` and backups.

For base-image security updates use `docker compose build --pull` followed by `docker compose up -d`. The lockfile pins JS dependencies; the Node 24 Docker tag receives upstream patches. Audit and update dependencies periodically.

Keep `SESSION_SECRET` stable across rebuilds. Rotating it invalidates browser management cookies; phones will need to enable alerts again to recover control of existing subscriptions. It does not stop existing push delivery. Avoid pasting credentials into shell history.

## Development checks

With Node 24:

```bash
npm ci
npm run build
npm test
```

Automated push tests use mocks. Verify actual notification delivery and reverse-proxy connectivity in your own environment.
