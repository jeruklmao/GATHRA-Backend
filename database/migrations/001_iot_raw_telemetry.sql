CREATE TABLE iot_gateways (
  id BIGSERIAL PRIMARY KEY,
  hardware_mac VARCHAR(17) NOT NULL UNIQUE,
  logical_gateway_id VARCHAR(48) NOT NULL,
  firmware_version VARCHAR(32) NOT NULL,
  first_seen_at TIMESTAMPTZ(3) NOT NULL,
  last_seen_at TIMESTAMPTZ(3) NOT NULL
);

CREATE TABLE iot_nodes (
  node_id VARCHAR(24) PRIMARY KEY,
  first_seen_at TIMESTAMPTZ(3) NOT NULL,
  last_seen_at TIMESTAMPTZ(3) NOT NULL,
  last_gateway_id BIGINT REFERENCES iot_gateways(id) ON DELETE SET NULL
);

CREATE TABLE iot_telemetry (
  id BIGSERIAL PRIMARY KEY,
  gateway_id BIGINT NOT NULL REFERENCES iot_gateways(id),
  gateway_logical_id_snapshot VARCHAR(48) NOT NULL,
  node_id VARCHAR(24) NOT NULL REFERENCES iot_nodes(node_id),
  node_boot_session_id BIGINT NOT NULL CHECK (node_boot_session_id BETWEEN 0 AND 4294967295),
  node_sequence BIGINT NOT NULL CHECK (node_sequence BETWEEN 0 AND 4294967295),
  gateway_received_at TIMESTAMPTZ(3),
  gateway_time_trusted BOOLEAN NOT NULL,
  gateway_uptime_ms BIGINT NOT NULL CHECK (gateway_uptime_ms >= 0),
  gateway_boot_session_id BIGINT NOT NULL CHECK (gateway_boot_session_id BETWEEN 0 AND 4294967295),
  server_received_at TIMESTAMPTZ(3) NOT NULL,
  median_echo_us BIGINT NOT NULL CHECK (median_echo_us BETWEEN 0 AND 4294967295),
  raw_distance_mm BIGINT CHECK (raw_distance_mm BETWEEN 0 AND 4294967294),
  accepted_distance_mm BIGINT CHECK (accepted_distance_mm BETWEEN 0 AND 4294967294),
  mad_mm INTEGER NOT NULL CHECK (mad_mm BETWEEN 0 AND 65535),
  temperature_centi_c SMALLINT CHECK (temperature_centi_c BETWEEN -32767 AND 32767),
  humidity_centi_percent INTEGER CHECK (humidity_centi_percent BETWEEN 0 AND 65534),
  battery_mv INTEGER NOT NULL CHECK (battery_mv BETWEEN 0 AND 65535),
  valid_samples SMALLINT NOT NULL CHECK (valid_samples BETWEEN 0 AND 255),
  total_samples SMALLINT NOT NULL CHECK (total_samples BETWEEN 0 AND 255),
  filter_state SMALLINT NOT NULL CHECK (filter_state BETWEEN 0 AND 7),
  quality_flags INTEGER NOT NULL CHECK (quality_flags BETWEEN 0 AND 65535),
  health_flags INTEGER NOT NULL CHECK (health_flags BETWEEN 0 AND 65535),
  rssi_dbm REAL NOT NULL,
  snr_db REAL NOT NULL,
  frequency_error_hz INTEGER NOT NULL,
  packet_length SMALLINT NOT NULL CHECK (packet_length BETWEEN 1 AND 96),
  protocol_version SMALLINT NOT NULL CHECK (protocol_version = 1),
  raw_payload BYTEA NOT NULL,
  CONSTRAINT iot_telemetry_identity_unique
    UNIQUE (node_id, node_boot_session_id, node_sequence),
  CONSTRAINT iot_gateway_time_consistency CHECK (
    (gateway_time_trusted AND gateway_received_at IS NOT NULL) OR
    (NOT gateway_time_trusted AND gateway_received_at IS NULL)
  ),
  CONSTRAINT iot_packet_length_matches_raw CHECK (
    packet_length = OCTET_LENGTH(raw_payload)
  )
);

CREATE INDEX iot_telemetry_node_server_time_idx
  ON iot_telemetry (node_id, server_received_at DESC, id DESC);
CREATE INDEX iot_telemetry_node_id_desc_idx
  ON iot_telemetry (node_id, id DESC);
CREATE INDEX iot_telemetry_gateway_server_time_idx
  ON iot_telemetry (gateway_id, server_received_at DESC);
CREATE INDEX iot_nodes_last_seen_idx
  ON iot_nodes (last_seen_at DESC, node_id ASC);
