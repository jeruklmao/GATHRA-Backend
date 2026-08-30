# Admin dashboard

The Backend serves a self-contained operator dashboard at `/admin` when
`ADMIN_DASHBOARD_ENABLED=true`. HTML, CSS, JavaScript, and Canvas charts are
bundled into the Backend image; there is no CDN or separate frontend service.

Current pages cover Overview, Nodes, Node history/charts, Gateways, Flood
Config, Server, Traffic, and Logs. API timestamps are UTC; the UI displays
Asia/Jakarta. Distance and threshold values use millimetres.

## Authentication

Authentication configuration is read from `ADMIN_AUTH_FILE`, which must remain
outside Git with restricted permissions. The fixed username is `admin`; the
file contains a salted scrypt verifier and a random session secret, not the
plain password.

The browser receives a random opaque cookie with `HttpOnly`, `Secure`,
`SameSite=Strict`, and root path. PostgreSQL stores only keyed session and CSRF
verifiers. Sessions default to 30 minutes idle and 12 hours absolute. State
changes require the session-bound `X-CSRF-Token`.

Login responses are generic and rate-limited. Admin routes use restrictive
content-security, framing, MIME-sniffing, referrer, and permissions headers.
Nothing is stored in browser local/session storage or URLs.

## Nodes and flood configuration

Node views read immutable Protocol 3 telemetry and derived sensor state.
History is bounded and newest-first. Chart ranges are 1h, 24h, 7d, and 30d and
use server-side bucketing to at most about 500 points.

Flood Config edits deployment enablement, position, coverage GeoJSON,
reference-distance override, poll/freshness policy, hysteresis, thresholds, and
level multipliers. Saving is explicit and transactional. The shared Backend
validator remains authoritative. A material update increments configuration
version and recomputes from stored telemetry without changing the raw row.

## Gateways

Gateway views use firmware heartbeat data for ONLINE/STALE/OFFLINE freshness,
runtime/network/NTP/LoRa/ACK/queue/command diagnostics, and bounded 1h/24h/7d/
30d charts. The heartbeat interval is read-only because it is configured on the
Gateway dashboard.

ACK timings are Gateway-observed radio timing, not proof that the Node received
the ACK. Since-boot counters and uptime may reset at Gateway reboot.

## Server, traffic, and logs

The optional host observer writes bounded sanitized snapshots and allowlisted
log files into `ADMIN_OBSERVER_DIRECTORY`, mounted read-only by the Backend. It
opens no listener and accepts no dashboard commands. Missing or malformed
observer data is reported unavailable without affecting public APIs.

Traffic metrics store normalized route templates, counts, status classes, byte
totals, latency sums, and fixed histogram buckets. Raw URLs and query values,
bodies, credentials, headers, cookies, tokens, and IP addresses are not stored.
Retention defaults to 30 days and is configurable from 7–90 days.

Logs are bounded to 100, 300, or 500 lines, sanitize control characters and
credential-like fields, and render as text. They are not persisted in
PostgreSQL.

The dashboard has no shell, arbitrary SQL, restart, reboot, delete,
secret/environment editor, Gateway configuration, OTA, or host-control
endpoint.
