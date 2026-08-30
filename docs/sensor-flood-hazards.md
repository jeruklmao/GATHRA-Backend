# Sensor-backed flood hazards

## Data flow

```text
GATHRA Node Protocol 3
  -> immutable PostgreSQL telemetry
  -> sensor deployment policy
  -> authoritative current sensor state
  -> public flood polygons, routing, admin, and Android detail
```

Every enabled deployment contributes its configured coverage polygon, including
LOW and UNKNOWN states and STALE or NO_TELEMETRY freshness. GeoJSON coordinates
are `[longitude, latitude]`.

## Effective reference and water height

Each deployment stores nullable `referenceDistanceOverrideMm`:

- `null` uses the Node-reported Protocol 3 reference distance;
- a value from 1 through 4294967295 mm is the authoritative Backend reference;
- clearing the value returns to the Node-reported reference.

Saving or clearing an override atomically recomputes current state from the
latest applicable telemetry. It does not change Node NVS, radio commands, or
Gateway configuration.

When both effective reference and accepted distance are usable:

```text
waterHeightMm = max(0, effectiveReferenceDistanceMm - acceptedDistanceMm)
```

The accepted distance is authoritative; raw distance is diagnostic only.

## Usable measurements

Filter states `STABLE` (0), `ACCEPTED` (1), `TRANSIENT_REJECTED` (4), and
`CHANGE_CONFIRMED` (5) can use an accepted value. `TRANSIENT_REJECTED` keeps the
stable accepted distance while rejecting the current raw obstruction.

Verification-pending, `UNCERTAIN`, and `INVALID` filter states produce UNKNOWN.
The accepted-distance-valid quality bit must agree with a present value.
Sonar-invalid, filter-uncertain, or calibration-missing health produces UNKNOWN,
except that a configured Backend reference override makes the Node calibration
flag irrelevant to reference availability. Environmental, battery, radio, and
ACK flags do not by themselves invalidate accepted ultrasonic distance.

Current reason codes are:

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

Each deployment stores ordered upward thresholds:

- LOW: below `mediumThresholdMm`
- MEDIUM: at or above `mediumThresholdMm`
- HIGH: at or above `highThresholdMm`
- BLOCKED: at or above `blockedThresholdMm`

Thresholds are runtime configuration and must satisfy:

```text
0 <= mediumThresholdMm < highThresholdMm < blockedThresholdMm
```

Upward transitions use those boundaries. A downward transition requires water
height to be strictly below the relevant threshold minus `hysteresisMm`.
Hysteresis applies only when the prior classification is valid, still fresh,
and uses the same configuration version. Otherwise classification is direct.

## Observation time and freshness

When the Gateway trusted its timestamp, `gatewayReceivedAt` is the observation
time. Otherwise the Backend uses `serverReceivedAt`.

```text
validUntil = observedAt + staleAfterMinutes
now <= validUntil -> FRESH
now > validUntil  -> STALE
no telemetry      -> NO_TELEMETRY
```

FRESH can hold LOW, MEDIUM, HIGH, BLOCKED, or UNKNOWN. STALE and NO_TELEMETRY
force effective UNKNOWN and use the configured UNKNOWN multiplier. UNKNOWN is
not evidence of safety.

## Routing multipliers

Each level has a deployment-specific multiplier from 0 through 1:

- 1: no local flood penalty;
- greater than 0 and less than 1: route priority penalty;
- 0: hard exclusion, regardless of level name.

NestJS sends relevant multipliers to GraphHopper and independently checks the
returned route geometry. A route is a modeled recommendation, not a guarantee.

## Administration

The flood-administrator bearer credential protects:

```text
GET /api/v1/admin/iot/sensor-deployments
GET /api/v1/admin/iot/sensor-deployments/:nodeId
PUT /api/v1/admin/iot/sensor-deployments/:nodeId
```

PUT is a complete atomic upsert. It validates Node ID, enabled state, position,
closed/non-self-intersecting polygon containing the sensor, poll/freshness
policy, ordered thresholds, non-overlapping hysteresis, reference override, and
all multipliers. A material change increments `configVersion` and recomputes
state from stored telemetry.

## Public contracts

`GET /api/v1/flood-hazards` returns a non-cacheable GeoJSON FeatureCollection.
Each feature includes risk level, routing multiplier, freshness, reason codes,
Node provenance, observation/validity times, and sensor source.

`GET /api/v1/sensors/:nodeId` returns sanitized current information for one
enabled deployment:

- Node ID and deployment position;
- water height, effective level, freshness, and observation time;
- accepted distance, temperature, and humidity;
- nullable Gateway heartbeat state, radio recency, RSSI/SNR, and sanitized
  delivery status.

The public sensor contract excludes raw distance, battery, flags, payload and
session data, reference configuration, Gateway identity/network/runtime
internals, commands, and history.

Gateway heartbeat state is `ONLINE` through two reported intervals, `STALE`
through five, `OFFLINE` after five, and `UNAVAILABLE` when no heartbeat is
available. Radio recency follows sensor freshness and does not classify RSSI or
SNR quality.
