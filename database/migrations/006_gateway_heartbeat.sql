CREATE UNIQUE INDEX iot_gateways_logical_gateway_id_unique
  ON iot_gateways (logical_gateway_id);

CREATE TABLE iot_gateway_status (
  gateway_id BIGINT PRIMARY KEY REFERENCES iot_gateways(id) ON DELETE CASCADE,
  last_heartbeat_at TIMESTAMPTZ(3) NOT NULL,
  heartbeat_schema_version SMALLINT NOT NULL CHECK (heartbeat_schema_version = 1),
  heartbeat_interval_seconds INTEGER NOT NULL CHECK (heartbeat_interval_seconds BETWEEN 15 AND 3600),
  firmware_version VARCHAR(32) NOT NULL,
  protocol_version SMALLINT NOT NULL CHECK (protocol_version = 3),
  build_flavor VARCHAR(23) NOT NULL,
  uptime_seconds BIGINT NOT NULL CHECK (uptime_seconds >= 0),
  reset_reason VARCHAR(31) NOT NULL,
  boot_count BIGINT NOT NULL CHECK (boot_count BETWEEN 0 AND 4294967295),
  free_heap_bytes BIGINT NOT NULL CHECK (free_heap_bytes >= 0),
  min_free_heap_bytes BIGINT NOT NULL CHECK (min_free_heap_bytes >= 0),
  largest_free_heap_block_bytes BIGINT NOT NULL CHECK (largest_free_heap_block_bytes >= 0),
  sketch_size_bytes BIGINT NOT NULL CHECK (sketch_size_bytes >= 0),
  free_sketch_space_bytes BIGINT NOT NULL CHECK (free_sketch_space_bytes >= 0),
  flash_size_bytes BIGINT NOT NULL CHECK (flash_size_bytes >= 0),
  wifi_connected BOOLEAN NOT NULL,
  ssid VARCHAR(32) NOT NULL,
  wifi_rssi_dbm REAL,
  local_ip INET,
  backend_connectivity_state VARCHAR(10) NOT NULL CHECK (backend_connectivity_state IN ('UNKNOWN','HEALTHY','DEGRADED','OFFLINE')),
  last_backend_success_at TIMESTAMPTZ(3),
  last_backend_error_at TIMESTAMPTZ(3),
  consecutive_backend_failures BIGINT NOT NULL CHECK (consecutive_backend_failures >= 0),
  time_valid BOOLEAN NOT NULL,
  gateway_current_utc TIMESTAMPTZ(3),
  last_ntp_sync_at TIMESTAMPTZ(3),
  ntp_age_seconds BIGINT CHECK (ntp_age_seconds >= 0),
  paired_node_id VARCHAR(24),
  last_lora_rx_at TIMESTAMPTZ(3),
  latest_rssi_dbm REAL,
  latest_snr_db REAL,
  latest_frequency_error_hz INTEGER,
  received_packet_count BIGINT NOT NULL CHECK (received_packet_count >= 0),
  valid_telemetry_count BIGINT NOT NULL CHECK (valid_telemetry_count >= 0),
  invalid_packet_count BIGINT NOT NULL CHECK (invalid_packet_count >= 0),
  crc_error_count BIGINT NOT NULL CHECK (crc_error_count >= 0),
  protocol_rejected_packet_count BIGINT NOT NULL CHECK (protocol_rejected_packet_count >= 0),
  unpaired_rejected_packet_count BIGINT NOT NULL CHECK (unpaired_rejected_packet_count >= 0),
  ack_count BIGINT NOT NULL CHECK (ack_count >= 0),
  ack_success_count BIGINT NOT NULL CHECK (ack_success_count >= 0),
  ack_failure_count BIGINT NOT NULL CHECK (ack_failure_count >= 0),
  ack_latency_sample_count BIGINT NOT NULL CHECK (ack_latency_sample_count >= 0),
  latest_rx_to_ack_start_ms DOUBLE PRECISION,
  latest_rx_to_ack_complete_ms DOUBLE PRECISION,
  latest_ack_tx_duration_ms DOUBLE PRECISION,
  min_rx_to_ack_start_ms DOUBLE PRECISION,
  max_rx_to_ack_start_ms DOUBLE PRECISION,
  avg_rx_to_ack_start_ms DOUBLE PRECISION,
  min_rx_to_ack_complete_ms DOUBLE PRECISION,
  max_rx_to_ack_complete_ms DOUBLE PRECISION,
  avg_rx_to_ack_complete_ms DOUBLE PRECISION,
  min_ack_tx_duration_ms DOUBLE PRECISION,
  max_ack_tx_duration_ms DOUBLE PRECISION,
  avg_ack_tx_duration_ms DOUBLE PRECISION,
  queue_depth INTEGER NOT NULL CHECK (queue_depth >= 0),
  queue_capacity INTEGER NOT NULL CHECK (queue_capacity BETWEEN 0 AND 4096),
  oldest_record_age_seconds BIGINT CHECK (oldest_record_age_seconds >= 0),
  telemetry_upload_success_count BIGINT NOT NULL CHECK (telemetry_upload_success_count >= 0),
  telemetry_upload_failure_count BIGINT NOT NULL CHECK (telemetry_upload_failure_count >= 0),
  pending_command_id BIGINT CHECK (pending_command_id BETWEEN 0 AND 4294967295),
  pending_command_type VARCHAR(39),
  pending_command_state VARCHAR(7),
  last_command_id BIGINT CHECK (last_command_id BETWEEN 0 AND 4294967295),
  last_command_result VARCHAR(31),
  commands_sent_count BIGINT NOT NULL CHECK (commands_sent_count >= 0),
  command_results_received_count BIGINT NOT NULL CHECK (command_results_received_count >= 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT iot_gateway_status_wifi_check CHECK (
    (wifi_connected AND wifi_rssi_dbm IS NOT NULL AND local_ip IS NOT NULL) OR
    (NOT wifi_connected AND wifi_rssi_dbm IS NULL AND local_ip IS NULL)
  ),
  CONSTRAINT iot_gateway_status_time_check CHECK (
    (time_valid AND gateway_current_utc IS NOT NULL) OR
    (NOT time_valid AND gateway_current_utc IS NULL AND last_ntp_sync_at IS NULL AND ntp_age_seconds IS NULL)
  ),
  CONSTRAINT iot_gateway_status_queue_check CHECK (queue_depth <= queue_capacity),
  CONSTRAINT iot_gateway_status_ack_totals_check CHECK (ack_count = ack_success_count + ack_failure_count)
);

CREATE INDEX iot_gateway_status_last_heartbeat_idx
  ON iot_gateway_status (last_heartbeat_at DESC);

CREATE TABLE iot_gateway_metrics (
  id BIGSERIAL PRIMARY KEY,
  gateway_id BIGINT NOT NULL REFERENCES iot_gateways(id) ON DELETE CASCADE,
  sampled_at TIMESTAMPTZ(3) NOT NULL,
  uptime_seconds BIGINT NOT NULL CHECK (uptime_seconds >= 0),
  boot_count BIGINT NOT NULL CHECK (boot_count BETWEEN 0 AND 4294967295),
  free_heap_bytes BIGINT NOT NULL CHECK (free_heap_bytes >= 0),
  min_free_heap_bytes BIGINT NOT NULL CHECK (min_free_heap_bytes >= 0),
  largest_free_heap_block_bytes BIGINT NOT NULL CHECK (largest_free_heap_block_bytes >= 0),
  wifi_rssi_dbm REAL,
  ntp_age_seconds BIGINT CHECK (ntp_age_seconds >= 0),
  latest_rssi_dbm REAL,
  latest_snr_db REAL,
  latest_frequency_error_hz INTEGER,
  latest_rx_to_ack_start_ms DOUBLE PRECISION,
  latest_rx_to_ack_complete_ms DOUBLE PRECISION,
  latest_ack_tx_duration_ms DOUBLE PRECISION,
  queue_depth INTEGER NOT NULL CHECK (queue_depth >= 0),
  queue_capacity INTEGER NOT NULL CHECK (queue_capacity BETWEEN 0 AND 4096),
  oldest_record_age_seconds BIGINT CHECK (oldest_record_age_seconds >= 0),
  consecutive_backend_failures BIGINT NOT NULL CHECK (consecutive_backend_failures >= 0),
  telemetry_upload_success_count BIGINT NOT NULL CHECK (telemetry_upload_success_count >= 0),
  telemetry_upload_failure_count BIGINT NOT NULL CHECK (telemetry_upload_failure_count >= 0),
  received_packet_count BIGINT NOT NULL CHECK (received_packet_count >= 0),
  valid_telemetry_count BIGINT NOT NULL CHECK (valid_telemetry_count >= 0),
  invalid_packet_count BIGINT NOT NULL CHECK (invalid_packet_count >= 0),
  ack_success_count BIGINT NOT NULL CHECK (ack_success_count >= 0),
  ack_failure_count BIGINT NOT NULL CHECK (ack_failure_count >= 0),
  commands_sent_count BIGINT NOT NULL CHECK (commands_sent_count >= 0),
  command_results_received_count BIGINT NOT NULL CHECK (command_results_received_count >= 0),
  CONSTRAINT iot_gateway_metrics_queue_check CHECK (queue_depth <= queue_capacity)
);

CREATE INDEX iot_gateway_metrics_gateway_sample_idx
  ON iot_gateway_metrics (gateway_id, sampled_at DESC, id DESC);
CREATE INDEX iot_gateway_metrics_sample_idx
  ON iot_gateway_metrics (sampled_at);

COMMENT ON TABLE iot_gateway_status IS
  'Latest authenticated Firmware 2.2 operational heartbeat per stable Gateway MAC identity';
COMMENT ON TABLE iot_gateway_metrics IS
  'Compact per-heartbeat Gateway metrics retained for 30 days; sampled_at is authoritative Backend reception time';
