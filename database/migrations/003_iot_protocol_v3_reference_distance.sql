-- Protocol v3 appends the Node's calibration reference to TELEMETRY. Historical
-- rows remain nullable; production packet decoding accepts Protocol v3 only.
ALTER TABLE iot_telemetry
  ADD COLUMN reference_distance_mm BIGINT;

ALTER TABLE iot_telemetry
  ADD CONSTRAINT iot_telemetry_reference_distance_mm_check
  CHECK (reference_distance_mm BETWEEN 1 AND 4294967295);

ALTER TABLE iot_telemetry
  DROP CONSTRAINT iot_telemetry_protocol_version_check;

ALTER TABLE iot_telemetry
  ADD CONSTRAINT iot_telemetry_protocol_version_check
  CHECK (protocol_version IN (1, 2, 3));

COMMENT ON COLUMN iot_telemetry.reference_distance_mm IS
  'Protocol v3 calibration reference in millimetres; NULL represents wire value 0 (calibration missing) or a historical row';

COMMENT ON COLUMN iot_telemetry.node_boot_session_id IS
  'Protocol v1 boot session ID; Protocol v2/v3 persistent session ID (legacy column name retained to preserve telemetry and indexes)';
