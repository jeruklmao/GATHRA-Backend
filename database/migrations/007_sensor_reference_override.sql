ALTER TABLE iot_sensor_deployments
  ADD COLUMN reference_distance_override_mm BIGINT;

ALTER TABLE iot_sensor_deployments
  ADD CONSTRAINT iot_sensor_deployment_reference_override_check
  CHECK (
    reference_distance_override_mm IS NULL OR
    reference_distance_override_mm BETWEEN 1 AND 4294967295
  );

ALTER TABLE iot_sensor_state
  ADD COLUMN node_reference_distance_mm BIGINT;

UPDATE iot_sensor_state state
   SET node_reference_distance_mm = telemetry.reference_distance_mm
  FROM iot_telemetry telemetry
 WHERE telemetry.id = state.telemetry_id;

ALTER TABLE iot_sensor_state
  ADD CONSTRAINT iot_sensor_state_node_reference_distance_check
  CHECK (
    node_reference_distance_mm IS NULL OR
    node_reference_distance_mm BETWEEN 1 AND 4294967295
  );

COMMENT ON COLUMN iot_sensor_deployments.reference_distance_override_mm IS
  'Nullable Backend-only authoritative reference; NULL delegates to the latest Node-reported Protocol 3 reference';
COMMENT ON COLUMN iot_sensor_state.node_reference_distance_mm IS
  'Node-reported Protocol 3 reference retained separately from the effective reference_distance_mm';
