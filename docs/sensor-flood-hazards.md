# Sensor-backed flood hazards

## Public current sensor detail

`GET /api/v1/sensors/:nodeId` is an unauthenticated, read-only, non-cacheable
Android contract for an enabled sensor deployment. It returns only:

- `nodeId` and deployment `position` (`latitude`, `longitude`);
- authoritative `flood.waterHeightMm`, `effectiveLevel`, `freshness`, and
  nullable `observedAt` from the same persisted classifier state used by flood
  hazards and routing;
- `measurement.acceptedDistanceMm`, normalized nullable `temperatureC`, and
  nullable `humidityPercent` from the exact telemetry row backing that state;
- a nullable `gateway` summary with Backend-derived heartbeat `status`,
  nullable `lastHeartbeatAt`, `radioReceptionStatus`, RSSI/SNR measurements,
  and sanitized `backendDeliveryStatus`.

Gateway `status` is `ONLINE`, `STALE`, or `OFFLINE` using the existing
Backend heartbeat 2x/5x interval policy. It is `UNAVAILABLE` when the
associated Gateway has no Firmware 2.2 heartbeat. `radioReceptionStatus` is
`RECENT` only when the authoritative sensor observation is `FRESH`, `STALE`
when that observation has crossed the deployment `staleAfterMinutes` policy,
and otherwise `UNAVAILABLE`. RSSI and SNR never affect that status and are not
classified as good or bad. Backend delivery maps `HEALTHY` to `NORMAL`,
`DEGRADED`/`OFFLINE` to `DEGRADED`, and missing/unknown state to `UNAVAILABLE`.

The response deliberately excludes raw distance, battery, filter/quality/
health flags, payload/session/sequence data, Gateway identity/network/runtime
internals, commands, errors, credentials, and reference override configuration.
No public sensor history endpoint is provided for Android.

## Backend reference-distance override

Each deployment has nullable `referenceDistanceOverrideMm`:

- `NULL` uses the latest Node-reported Protocol 3 `referenceDistanceMm`;
- a value from 1 through 4294967295 mm is the Backend-authoritative reference.

The classifier selects the effective reference once, then derives water height,
hysteresis/classified level, effective risk, and routing multiplier through the
existing state pipeline. A configuration PUT increments the material version
and atomically reclassifies the latest applicable telemetry, so flood hazards,
routing, admin status, and public sensor detail change immediately. Clearing
the field to `NULL` immediately delegates back to the Node reference. If no
usable accepted distance/effective reference exists, the result remains
`UNKNOWN`.

This override is Backend-only. It does not write Node NVS, send a LoRa command,
or change Protocol 3, Node firmware, or Gateway firmware. The Admin Dashboard
shows Node-reported, Backend override, and effective references and provides
save/clear controls.

## Data flow and persistence

Production uses `FLOOD_PROVIDER=sensor` (also the default when
`NODE_ENV=production`):

```text
Protocol 3 packet -> immutable iot_telemetry -> interpreted iot_sensor_state
                                             -> iot_sensor_deployments policy
                                             -> FloodHazard snapshot
                                             -> Android + GraphHopper
```

Migration `004_sensor_flood_hazards.sql` adds:

- `iot_sensor_deployments`: durable runtime configuration keyed by `node_id`.
  It deliberately has no foreign key to `iot_nodes`, so a deployment may be
  configured before its first packet and survives telemetry cleanup.
- `iot_sensor_state`: the latest interpreted state. It references the
  deployment and, while retained, the source telemetry row. This is derived
  data; `iot_telemetry` remains immutable historical truth.

All distances and water heights are millimetres. Timestamps are UTC
`TIMESTAMPTZ(3)` and are serialized as ISO-8601. GeoJSON positions always use
`[longitude, latitude]` order.

## Measurement and health policy

For usable Protocol 3 telemetry:

```text
waterHeightMm = max(0, referenceDistanceMm - acceptedDistanceMm)
```

`acceptedDistanceMm`, not `rawDistanceMm`, is authoritative because it has
already passed the Node temporal filter. A missing reference or accepted value
produces `UNKNOWN`; it is never coerced to zero/LOW.

The Backend follows the Node's actual filter and bit definitions. `STABLE` (0),
`ACCEPTED` (1), `TRANSIENT_REJECTED` (4), and `CHANGE_CONFIRMED` (5) can use a
valid accepted value. `TRANSIENT_REJECTED` intentionally retains the stable
accepted distance while rejecting a raw obstruction. Verification-pending,
`UNCERTAIN`, and `INVALID` states produce `UNKNOWN`.

The accepted-distance-valid quality bit (`0x0004`) must agree with a present
accepted value. Sonar-invalid (`0x0001`), filter-uncertain (`0x0100`), or
calibration-missing (`0x0200`) health produces `UNKNOWN`. DHT/environment,
battery, radio, and acknowledgement flags do not by themselves invalidate an
otherwise accepted sonar distance.

Bounded reason codes explain non-valid states:

```text
NO_TELEMETRY
STALE
REFERENCE_DISTANCE_MISSING
ACCEPTED_DISTANCE_MISSING
FILTER_INVALID
SENSOR_UNHEALTHY
DEPLOYMENT_DISABLED
```

## Classification and hysteresis

Each deployment stores three ordered upward thresholds. With the initial
configuration:

| Water height | Level |
| --- | --- |
| `< 20 mm` | LOW |
| `20 <= height < 300 mm` | MEDIUM |
| `300 <= height < 750 mm` | HIGH |
| `>= 750 mm` | BLOCKED |

Hysteresis is a deterministic four-state transition loop. Upward boundaries
stay at 20, 300, and 750 mm. With `hysteresisMm=10`, downward transitions use
strict boundaries `< 10`, `< 290`, and `< 740` mm. The loop traverses as many
boundaries as the reading requires, so LOW can jump directly to BLOCKED and
BLOCKED can fall directly to LOW.

Hysteresis is used only when the prior classification was valid, is still
fresh, and used the same configuration version. First telemetry, recovery from
UNKNOWN/stale/disabled state, or any material configuration update classifies
directly against the current thresholds. This prevents old configuration or a
stale UNKNOWN overlay from trapping the new result.

## Observation time and freshness

`gatewayReceivedAt` is selected only when `gatewayTimeTrusted=true` and the
timestamp is valid. Otherwise `serverReceivedAt` is selected. The selected
source (`GATEWAY` or `SERVER`) is persisted and visible in the admin response.
An untrusted Gateway epoch is never authoritative.

```text
validUntil = observedAt + staleAfterMinutes
now <= validUntil  -> fresh
now >  validUntil  -> stale / effective UNKNOWN
```

Freshness is evaluated on every flood/admin/route read. The persisted base
classification need not be rewritten when time passes. A stale deployment
keeps its polygon and uses its configured UNKNOWN multiplier; stale never
means the monitored road is known safe.

## Runtime configuration and administration

The existing flood-administrator Bearer credential protects:

```text
GET /api/v1/admin/iot/sensor-deployments
GET /api/v1/admin/iot/sensor-deployments/:nodeId
PUT /api/v1/admin/iot/sensor-deployments/:nodeId
```

The PUT is a complete atomic upsert. It validates geometry and every field,
persists the deployment, increments `configVersion` only for a material
change, finds the latest stored Protocol 3 telemetry, and writes recomputed
state in one transaction. It rejects malformed/unclosed/self-intersecting
polygons and a coverage polygon that does not contain the sensor point.

Configuration rules include:

- `expectedPollIntervalMinutes >= 1`;
- `staleAfterMinutes >= expectedPollIntervalMinutes`;
- `0 <= mediumThresholdMm < highThresholdMm < blockedThresholdMm`;
- non-negative hysteresis no larger than the first threshold or either gap;
- every multiplier is finite and from `0.0` through `1.0`.

`referenceDistanceMm` is intentionally absent from deployment configuration;
it always comes from Protocol 3 telemetry.

## Telemetry recomputation and ordering

Creating, enabling, or updating a deployment immediately recomputes from
stored telemetry, so disconnected hardware is not required. New ingestion
commits the raw batch transaction first, then recomputes each affected
configured Node. A classifier failure is logged as
`sensor_state_recompute_failed` but cannot roll back or reject already-valid
raw telemetry. Repeating PUT or receiving later telemetry recovers derived
state.

For each persistent Node session, the greatest Protocol sequence is the
candidate. Across sessions, candidates are ordered by selected observation
time, then server receipt time and telemetry ID. Thus a delayed lower sequence
from the same session cannot overwrite a newer current state merely because it
uploaded later.

## Public snapshots and Android contract

`GET /api/v1/flood-hazards` retains its unauthenticated GeoJSON
`FeatureCollection` contract. Production returns `source=SENSOR`. Every enabled
deployment contributes its configured polygon at LOW, MEDIUM, HIGH, BLOCKED,
or UNKNOWN, including stale/no-telemetry UNKNOWN. Sensor Node IDs remain in
`sourceNodeIds`. `routingMultiplier`, `reasonCodes`, and `freshness` are
additive properties.

Snapshot identity is a stable SHA-256 fingerprint over deployments sorted by
Node ID and each deployment's Node ID, configuration version, current telemetry
ID, effective level, and freshness state. It excludes `now`. Consequently:

- repeated unchanged GETs have the same `snapshotId`;
- new current telemetry or a material config update changes it;
- crossing `validUntil` changes it once from fresh to stale;
- remaining stale does not keep changing it.

## Routing semantics

Each effective hazard carries the multiplier read from its deployment:

| Initial level | Multiplier | Meaning |
| --- | ---: | --- |
| LOW | 1.00 | no routing penalty |
| MEDIUM | 0.35 | penalty |
| HIGH | 0.05 | strong penalty |
| BLOCKED | 0.00 | hard exclusion |
| UNKNOWN | 1.00 | no routing penalty by owner policy |

GraphHopper custom-model areas omit multiplier-1 hazards. Values strictly
between zero and one become runtime `multiply_by` priority rules. Exactly zero
means hard exclusion regardless of the level name. NestJS independently
intersects returned route geometry and rejects all multiplier-zero crossings,
so it does not rely solely on GraphHopper. Conversely, changing BLOCKED to 0.2
makes it a penalty rather than a hidden level-based rejection, and changing
MEDIUM to zero makes MEDIUM a hard exclusion.

Risk metadata may still report intersection with a LOW or UNKNOWN monitored
area, but multiplier 1 yields zero cost and does not affect ranking. A route is
only a route with lower modeled flood risk based on currently available data;
it is never guaranteed flood-safe.

Set `FLOOD_PROVIDER=in-memory` for explicit local simulation. Production does
not use simulated hazards.
