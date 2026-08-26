CREATE TABLE iot_sensor_deployments (
  node_id VARCHAR(24) PRIMARY KEY,
  enabled BOOLEAN NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  coverage_polygon JSONB NOT NULL,
  expected_poll_interval_minutes INTEGER NOT NULL,
  stale_after_minutes INTEGER NOT NULL,
  hysteresis_mm BIGINT NOT NULL,
  medium_threshold_mm BIGINT NOT NULL,
  high_threshold_mm BIGINT NOT NULL,
  blocked_threshold_mm BIGINT NOT NULL,
  low_multiplier DOUBLE PRECISION NOT NULL,
  medium_multiplier DOUBLE PRECISION NOT NULL,
  high_multiplier DOUBLE PRECISION NOT NULL,
  blocked_multiplier DOUBLE PRECISION NOT NULL,
  unknown_multiplier DOUBLE PRECISION NOT NULL,
  config_version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT iot_sensor_deployment_latitude_check
    CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT iot_sensor_deployment_longitude_check
    CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT iot_sensor_deployment_polygon_check
    CHECK (
      jsonb_typeof(coverage_polygon) = 'object' AND
      coverage_polygon ->> 'type' = 'Polygon' AND
      jsonb_typeof(coverage_polygon -> 'coordinates') = 'array'
    ),
  CONSTRAINT iot_sensor_deployment_poll_check
    CHECK (expected_poll_interval_minutes >= 1),
  CONSTRAINT iot_sensor_deployment_stale_check
    CHECK (stale_after_minutes >= expected_poll_interval_minutes),
  CONSTRAINT iot_sensor_deployment_thresholds_check
    CHECK (
      hysteresis_mm >= 0 AND
      medium_threshold_mm >= 0 AND
      medium_threshold_mm < high_threshold_mm AND
      high_threshold_mm < blocked_threshold_mm AND
      hysteresis_mm <= medium_threshold_mm AND
      hysteresis_mm <= high_threshold_mm - medium_threshold_mm AND
      hysteresis_mm <= blocked_threshold_mm - high_threshold_mm
    ),
  CONSTRAINT iot_sensor_deployment_multipliers_check
    CHECK (
      low_multiplier BETWEEN 0 AND 1 AND
      medium_multiplier BETWEEN 0 AND 1 AND
      high_multiplier BETWEEN 0 AND 1 AND
      blocked_multiplier BETWEEN 0 AND 1 AND
      unknown_multiplier BETWEEN 0 AND 1
    ),
  CONSTRAINT iot_sensor_deployment_config_version_check
    CHECK (config_version >= 1)
);

CREATE INDEX iot_sensor_deployments_enabled_idx
  ON iot_sensor_deployments (enabled, node_id);

CREATE TABLE iot_sensor_state (
  node_id VARCHAR(24) PRIMARY KEY
    REFERENCES iot_sensor_deployments(node_id) ON DELETE CASCADE,
  telemetry_id BIGINT REFERENCES iot_telemetry(id) ON DELETE SET NULL,
  observed_at TIMESTAMPTZ(3),
  observation_source TEXT,
  valid_until TIMESTAMPTZ(3),
  reference_distance_mm BIGINT,
  accepted_distance_mm BIGINT,
  water_height_mm BIGINT,
  classified_level TEXT NOT NULL,
  classification_status TEXT NOT NULL,
  effective_multiplier DOUBLE PRECISION NOT NULL,
  reason_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  classification_config_version BIGINT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT iot_sensor_state_observation_source_check
    CHECK (observation_source IS NULL OR observation_source IN ('GATEWAY', 'SERVER')),
  CONSTRAINT iot_sensor_state_validity_check
    CHECK (
      (observed_at IS NULL AND valid_until IS NULL AND observation_source IS NULL) OR
      (observed_at IS NOT NULL AND valid_until IS NOT NULL AND
       observation_source IS NOT NULL AND valid_until > observed_at)
    ),
  CONSTRAINT iot_sensor_state_distances_check
    CHECK (
      (reference_distance_mm IS NULL OR reference_distance_mm >= 1) AND
      (accepted_distance_mm IS NULL OR accepted_distance_mm >= 0) AND
      (water_height_mm IS NULL OR water_height_mm >= 0)
    ),
  CONSTRAINT iot_sensor_state_level_check
    CHECK (classified_level IN ('LOW', 'MEDIUM', 'HIGH', 'BLOCKED', 'UNKNOWN')),
  CONSTRAINT iot_sensor_state_status_check
    CHECK (classification_status IN ('VALID', 'UNKNOWN', 'DISABLED')),
  CONSTRAINT iot_sensor_state_multiplier_check
    CHECK (effective_multiplier BETWEEN 0 AND 1),
  CONSTRAINT iot_sensor_state_reason_codes_check
    CHECK (
      reason_codes <@ ARRAY[
        'NO_TELEMETRY',
        'STALE',
        'REFERENCE_DISTANCE_MISSING',
        'ACCEPTED_DISTANCE_MISSING',
        'FILTER_INVALID',
        'SENSOR_UNHEALTHY',
        'DEPLOYMENT_DISABLED'
      ]::TEXT[]
    ),
  CONSTRAINT iot_sensor_state_config_version_check
    CHECK (classification_config_version >= 1)
);

CREATE INDEX iot_sensor_state_telemetry_idx
  ON iot_sensor_state (telemetry_id);
CREATE INDEX iot_sensor_state_valid_until_idx
  ON iot_sensor_state (valid_until);

COMMENT ON TABLE iot_sensor_deployments IS
  'Runtime flood-classification, freshness, geometry, and routing policy per Node; independent of telemetry retention';
COMMENT ON COLUMN iot_sensor_deployments.coverage_polygon IS
  'Validated GeoJSON Polygon whose positions use [longitude, latitude] order';
COMMENT ON COLUMN iot_sensor_deployments.hysteresis_mm IS
  'Millimetres subtracted from each upward threshold to form its strict downward release boundary';
COMMENT ON TABLE iot_sensor_state IS
  'Latest interpreted state derived from immutable iot_telemetry; effective staleness is overlaid against current time at read time';
COMMENT ON COLUMN iot_sensor_state.observation_source IS
  'GATEWAY only for a trusted valid Gateway receive timestamp; otherwise SERVER';
