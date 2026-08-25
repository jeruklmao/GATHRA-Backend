-- Keep historical Protocol v1 rows while allowing only the deployed v2 value
-- for new ingestion. The application decoder accepts Protocol v2 only.
ALTER TABLE iot_telemetry
  DROP CONSTRAINT iot_telemetry_protocol_version_check;

ALTER TABLE iot_telemetry
  ADD CONSTRAINT iot_telemetry_protocol_version_check
  CHECK (protocol_version IN (1, 2));

COMMENT ON COLUMN iot_telemetry.node_boot_session_id IS
  'Protocol v1 boot session ID; Protocol v2 persistent session ID (legacy column name retained to preserve telemetry and indexes)';
