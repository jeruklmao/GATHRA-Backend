# Production admin dashboard

The Backend serves a self-contained dashboard at `/admin`. Its dependency-light
HTML/CSS/JavaScript and local Canvas charts are bundled into the Backend image;
there is no CDN, map provider, or separate process. Hashed assets are immutable
while the SPA HTML is not cached. Direct `/admin/*` navigation returns the SPA.

Pages cover Overview, Nodes, Node history/charts, Gateways, Flood Config,
Server, Traffic, and Logs. APIs retain UTC ISO-8601 timestamps; the UI displays
Asia/Jakarta. Distances and thresholds are millimetres. Operational Node status
uses inclusive boundaries: `ONLINE` when age is at most the expected poll
interval, `STALE` above poll but at most `staleAfterMinutes`, and `OFFLINE`
above stale. This does not change flood-classifier semantics. Gateway state is
activity-derived only for legacy Gateways. Firmware 2.2 heartbeat monitoring
provides dynamic ONLINE/STALE/OFFLINE state, detailed runtime/network/NTP/LoRa/
ACK/queue/command diagnostics, and 1h/24h/7d/30d charts. The heartbeat interval
is displayed read-only because it remains configured on the Gateway itself.

## Authentication

Enable `ADMIN_DASHBOARD_ENABLED` only after running:

```bash
sudo /opt/gathra-deploy/scripts/configure-admin-password.sh
```

The fixed username is `admin`. The TTY-only helper hides both prompts, requires
at least 12 characters, and atomically writes mode-0600 configuration to
`/opt/gathra-deploy/admin-auth.env`. It stores a salted scrypt verifier
(`N=32768`, `r=8`, `p=1`) and a random 256-bit session secret, never a password.

The browser receives a random 256-bit opaque cookie (`HttpOnly`, `Secure`,
`SameSite=Strict`, `Path=/`). PostgreSQL stores only a keyed token hash and CSRF
verifier. Sessions default to 30 minutes idle and 12 hours absolute; logout and
expiration delete server-side state. State changes require a session-bound
`X-CSRF-Token`. Nothing is kept in browser storage or URLs.

Login responses are generic. Five client failures block for 15 minutes; 20
global failures block for 30 minutes. `CF-Connecting-IP` is trusted only from a
loopback peer. Admin pages use restrictive CSP/frame/nosniff/referrer/permission
headers. Server text and logs render with `textContent`, not HTML. The separate
flood-admin Bearer API remains available and its token never enters the browser.

## Telemetry and configuration

Node views read immutable `iot_telemetry` and derived sensor state. Protocol 3
flags use shared wire definitions and retain numeric/hex forms. Bounded raw
payloads are base64. Chart APIs support 1h, 24h, 7d, and 30d using server-side
time buckets with at most roughly 500 points; raw history is unchanged.

Flood Config edits deployment enablement, coordinates, Polygon GeoJSON,
poll/stale durations, hysteresis, thresholds, and all multipliers. GeoJSON is
`[longitude, latitude]`. Saving is explicit and transactional. The shared
Backend validator remains authoritative for geometry/containment, ordering,
hysteresis, freshness, and multiplier bounds. Updates increment config version
and recompute from stored telemetry; recompute never mutates raw telemetry.

## Host observer and logs

`gathra-admin-observer.service` is a fixed Python standard-library collector.
It opens no listener and accepts no Backend/user commands. Every three seconds
it atomically writes bounded, sanitized files under
`/run/gathra-admin-observer`, mounted read-only into Backend. Docker/journal
sockets and the host root are never mounted.

It observes host uptime/CPU/load/RAM/swap/disk; Backend, PostgreSQL,
GraphHopper, and Photon health/resources/image/restarts; gathra/cloudflared
units; release SHA; and latest backup metadata. Backend persists one host row
per minute for 30 days. Missing, stale, partial, or malformed snapshots report
unavailable without affecting public APIs.

Six allowlisted log files contain at most 500 recent lines each. ANSI/control
characters are stripped and credential-like fields redacted. Source, line
limit (100/300/500), search, and severity are validated and filtered in
application code, never interpolated into shell/Docker/journal commands. Logs
are not persisted in PostgreSQL.

## Traffic, retention, and operations

HTTP metrics aggregate in memory and flush minute buckets every 15 seconds by
normalized route template. Stored fields are counts/status classes, byte totals,
latency sum, and a fixed ten-bucket histogram for approximate p50/p95/p99. Raw
URLs/query values, bodies, credentials, headers, cookies, tokens, and IPs are
not stored. Retention defaults to 30 days and is bounded to 7–90 days.

Normal low-cardinality traffic should consume tens of MiB per month; even the
500-key/minute safety ceiling remains in the low hundreds of MiB. Host history
is 43,200 rows/month and generally under tens of MiB. Observe actual table sizes
after normal production traffic accumulates.

Authenticated SSE emits five-second dashboard snapshots with EventSource
reconnect behavior; bounded logs refresh every three seconds with pause/resume.
Observability write failures do not fail routing or IoT ingestion.

Migration `005_admin_dashboard.sql` creates `admin_sessions`,
`admin_http_metrics_minute`, and `admin_host_metrics_minute`; no audit table.
Use the normal `/opt/gathra-deploy/scripts/update.sh` deployment. The Backend
remains unprivileged/read-only with only auth and observer read-only mounts.

The dashboard deliberately has no shell, arbitrary SQL/commands, restart,
reboot, delete, secret/environment editor, or host-control endpoints. Host
administration remains SSH-only.
