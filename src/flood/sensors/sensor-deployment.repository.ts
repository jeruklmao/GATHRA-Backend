import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type { FloodRiskLevel, GeoJsonPolygon } from '../models/flood-hazard';
import type {
  SensorClassificationStatus,
  SensorDeploymentConfiguration,
  SensorDeploymentWithState,
  SensorObservationSource,
  SensorReasonCode,
  SensorStateRecord,
  SensorStateWrite,
  SensorTelemetryRecord,
} from './sensor-deployment.models';

interface DeploymentRow extends QueryResultRow {
  node_id: string;
  enabled: boolean;
  latitude: number;
  longitude: number;
  coverage_polygon: GeoJsonPolygon;
  expected_poll_interval_minutes: number;
  stale_after_minutes: number;
  hysteresis_mm: string;
  medium_threshold_mm: string;
  high_threshold_mm: string;
  blocked_threshold_mm: string;
  low_multiplier: number;
  medium_multiplier: number;
  high_multiplier: number;
  blocked_multiplier: number;
  unknown_multiplier: number;
  config_version: string;
  created_at: Date;
  updated_at: Date;
}

interface StateRow extends QueryResultRow {
  state_node_id: string | null;
  telemetry_id: string | null;
  observed_at: Date | null;
  observation_source: SensorObservationSource | null;
  valid_until: Date | null;
  state_reference_distance_mm: string | null;
  state_accepted_distance_mm: string | null;
  water_height_mm: string | null;
  classified_level: FloodRiskLevel | null;
  classification_status: SensorClassificationStatus | null;
  effective_multiplier: number | null;
  reason_codes: SensorReasonCode[] | null;
  classification_config_version: string | null;
  state_created_at: Date | null;
  state_updated_at: Date | null;
}

type DeploymentWithStateRow = DeploymentRow & StateRow;

interface TelemetryRow extends QueryResultRow {
  id: string;
  node_id: string;
  node_boot_session_id: string;
  node_sequence: string;
  gateway_received_at: Date | null;
  gateway_time_trusted: boolean;
  server_received_at: Date;
  reference_distance_mm: string | null;
  accepted_distance_mm: string | null;
  filter_state: number;
  quality_flags: number;
  health_flags: number;
}

const DEPLOYMENT_COLUMNS = `
  d.node_id,
  d.enabled,
  d.latitude,
  d.longitude,
  d.coverage_polygon,
  d.expected_poll_interval_minutes,
  d.stale_after_minutes,
  d.hysteresis_mm,
  d.medium_threshold_mm,
  d.high_threshold_mm,
  d.blocked_threshold_mm,
  d.low_multiplier,
  d.medium_multiplier,
  d.high_multiplier,
  d.blocked_multiplier,
  d.unknown_multiplier,
  d.config_version,
  d.created_at,
  d.updated_at
`;

const STATE_COLUMNS = `
  s.node_id AS state_node_id,
  s.telemetry_id,
  s.observed_at,
  s.observation_source,
  s.valid_until,
  s.reference_distance_mm AS state_reference_distance_mm,
  s.accepted_distance_mm AS state_accepted_distance_mm,
  s.water_height_mm,
  s.classified_level,
  s.classification_status,
  s.effective_multiplier,
  s.reason_codes,
  s.classification_config_version,
  s.created_at AS state_created_at,
  s.updated_at AS state_updated_at
`;

@Injectable()
export class SensorDeploymentRepository {
  constructor(private readonly database: DatabaseService) {}

  async listWithState(): Promise<readonly SensorDeploymentWithState[]> {
    const result = await this.database.query<DeploymentWithStateRow>(
      `
        SELECT ${DEPLOYMENT_COLUMNS}, ${STATE_COLUMNS}
        FROM iot_sensor_deployments d
        LEFT JOIN iot_sensor_state s ON s.node_id = d.node_id
        ORDER BY d.node_id ASC
      `,
    );
    return result.rows.map(mapDeploymentWithState);
  }

  async findWithState(
    nodeId: string,
  ): Promise<SensorDeploymentWithState | null> {
    const result = await this.database.query<DeploymentWithStateRow>(
      `
        SELECT ${DEPLOYMENT_COLUMNS}, ${STATE_COLUMNS}
        FROM iot_sensor_deployments d
        LEFT JOIN iot_sensor_state s ON s.node_id = d.node_id
        WHERE d.node_id = $1
      `,
      [nodeId],
    );
    return result.rows[0] === undefined
      ? null
      : mapDeploymentWithState(result.rows[0]);
  }

  async upsertDeployment(
    client: PoolClient,
    deployment: Omit<
      SensorDeploymentConfiguration,
      'configVersion' | 'createdAt' | 'updatedAt'
    >,
  ): Promise<SensorDeploymentConfiguration> {
    const changed = `ROW(
      existing.enabled,
      existing.latitude,
      existing.longitude,
      existing.coverage_polygon,
      existing.expected_poll_interval_minutes,
      existing.stale_after_minutes,
      existing.hysteresis_mm,
      existing.medium_threshold_mm,
      existing.high_threshold_mm,
      existing.blocked_threshold_mm,
      existing.low_multiplier,
      existing.medium_multiplier,
      existing.high_multiplier,
      existing.blocked_multiplier,
      existing.unknown_multiplier
    ) IS DISTINCT FROM ROW(
      EXCLUDED.enabled,
      EXCLUDED.latitude,
      EXCLUDED.longitude,
      EXCLUDED.coverage_polygon,
      EXCLUDED.expected_poll_interval_minutes,
      EXCLUDED.stale_after_minutes,
      EXCLUDED.hysteresis_mm,
      EXCLUDED.medium_threshold_mm,
      EXCLUDED.high_threshold_mm,
      EXCLUDED.blocked_threshold_mm,
      EXCLUDED.low_multiplier,
      EXCLUDED.medium_multiplier,
      EXCLUDED.high_multiplier,
      EXCLUDED.blocked_multiplier,
      EXCLUDED.unknown_multiplier
    )`;
    const result = await client.query<DeploymentRow>(
      `
        INSERT INTO iot_sensor_deployments AS existing (
          node_id,
          enabled,
          latitude,
          longitude,
          coverage_polygon,
          expected_poll_interval_minutes,
          stale_after_minutes,
          hysteresis_mm,
          medium_threshold_mm,
          high_threshold_mm,
          blocked_threshold_mm,
          low_multiplier,
          medium_multiplier,
          high_multiplier,
          blocked_multiplier,
          unknown_multiplier
        ) VALUES (
          $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15, $16
        )
        ON CONFLICT (node_id) DO UPDATE SET
          enabled = EXCLUDED.enabled,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          coverage_polygon = EXCLUDED.coverage_polygon,
          expected_poll_interval_minutes = EXCLUDED.expected_poll_interval_minutes,
          stale_after_minutes = EXCLUDED.stale_after_minutes,
          hysteresis_mm = EXCLUDED.hysteresis_mm,
          medium_threshold_mm = EXCLUDED.medium_threshold_mm,
          high_threshold_mm = EXCLUDED.high_threshold_mm,
          blocked_threshold_mm = EXCLUDED.blocked_threshold_mm,
          low_multiplier = EXCLUDED.low_multiplier,
          medium_multiplier = EXCLUDED.medium_multiplier,
          high_multiplier = EXCLUDED.high_multiplier,
          blocked_multiplier = EXCLUDED.blocked_multiplier,
          unknown_multiplier = EXCLUDED.unknown_multiplier,
          config_version = existing.config_version + CASE WHEN ${changed} THEN 1 ELSE 0 END,
          updated_at = CASE WHEN ${changed} THEN clock_timestamp() ELSE existing.updated_at END
        RETURNING
          node_id,
          enabled,
          latitude,
          longitude,
          coverage_polygon,
          expected_poll_interval_minutes,
          stale_after_minutes,
          hysteresis_mm,
          medium_threshold_mm,
          high_threshold_mm,
          blocked_threshold_mm,
          low_multiplier,
          medium_multiplier,
          high_multiplier,
          blocked_multiplier,
          unknown_multiplier,
          config_version,
          created_at,
          updated_at
      `,
      [
        deployment.nodeId,
        deployment.enabled,
        deployment.latitude,
        deployment.longitude,
        JSON.stringify(deployment.coveragePolygon),
        deployment.expectedPollIntervalMinutes,
        deployment.staleAfterMinutes,
        deployment.hysteresisMm,
        deployment.mediumThresholdMm,
        deployment.highThresholdMm,
        deployment.blockedThresholdMm,
        deployment.lowMultiplier,
        deployment.mediumMultiplier,
        deployment.highMultiplier,
        deployment.blockedMultiplier,
        deployment.unknownMultiplier,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('Sensor deployment upsert returned no row');
    }
    return mapDeployment(row);
  }

  async findDeploymentForUpdate(
    client: PoolClient,
    nodeId: string,
  ): Promise<SensorDeploymentConfiguration | null> {
    const result = await client.query<DeploymentRow>(
      `
        SELECT ${DEPLOYMENT_COLUMNS}
        FROM iot_sensor_deployments d
        WHERE d.node_id = $1
        FOR UPDATE
      `,
      [nodeId],
    );
    return result.rows[0] === undefined
      ? null
      : mapDeployment(result.rows[0]);
  }

  async findStateForUpdate(
    client: PoolClient,
    nodeId: string,
  ): Promise<SensorStateRecord | null> {
    const result = await client.query<StateRow>(
      `
        SELECT ${STATE_COLUMNS}
        FROM iot_sensor_state s
        WHERE s.node_id = $1
        FOR UPDATE
      `,
      [nodeId],
    );
    return result.rows[0] === undefined
      ? null
      : mapState(result.rows[0]);
  }

  async findLatestTelemetry(
    client: PoolClient,
    nodeId: string,
  ): Promise<SensorTelemetryRecord | null> {
    const result = await client.query<TelemetryRow>(
      `
        WITH latest_per_session AS (
          SELECT DISTINCT ON (node_boot_session_id)
            id,
            node_id,
            node_boot_session_id,
            node_sequence,
            gateway_received_at,
            gateway_time_trusted,
            server_received_at,
            reference_distance_mm,
            accepted_distance_mm,
            filter_state,
            quality_flags,
            health_flags
          FROM iot_telemetry
          WHERE node_id = $1
          ORDER BY node_boot_session_id, node_sequence DESC, id DESC
        )
        SELECT *
        FROM latest_per_session
        ORDER BY
          CASE
            WHEN gateway_time_trusted AND gateway_received_at IS NOT NULL
              THEN gateway_received_at
            ELSE server_received_at
          END DESC,
          server_received_at DESC,
          id DESC
        LIMIT 1
      `,
      [nodeId],
    );
    return result.rows[0] === undefined
      ? null
      : mapTelemetry(result.rows[0]);
  }

  async upsertState(
    client: PoolClient,
    state: SensorStateWrite,
  ): Promise<SensorStateRecord> {
    const result = await client.query<StateRow>(
      `
        INSERT INTO iot_sensor_state (
          node_id,
          telemetry_id,
          observed_at,
          observation_source,
          valid_until,
          reference_distance_mm,
          accepted_distance_mm,
          water_height_mm,
          classified_level,
          classification_status,
          effective_multiplier,
          reason_codes,
          classification_config_version
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )
        ON CONFLICT (node_id) DO UPDATE SET
          telemetry_id = EXCLUDED.telemetry_id,
          observed_at = EXCLUDED.observed_at,
          observation_source = EXCLUDED.observation_source,
          valid_until = EXCLUDED.valid_until,
          reference_distance_mm = EXCLUDED.reference_distance_mm,
          accepted_distance_mm = EXCLUDED.accepted_distance_mm,
          water_height_mm = EXCLUDED.water_height_mm,
          classified_level = EXCLUDED.classified_level,
          classification_status = EXCLUDED.classification_status,
          effective_multiplier = EXCLUDED.effective_multiplier,
          reason_codes = EXCLUDED.reason_codes,
          classification_config_version = EXCLUDED.classification_config_version,
          updated_at = clock_timestamp()
        RETURNING
          node_id AS state_node_id,
          telemetry_id,
          observed_at,
          observation_source,
          valid_until,
          reference_distance_mm AS state_reference_distance_mm,
          accepted_distance_mm AS state_accepted_distance_mm,
          water_height_mm,
          classified_level,
          classification_status,
          effective_multiplier,
          reason_codes,
          classification_config_version,
          created_at AS state_created_at,
          updated_at AS state_updated_at
      `,
      [
        state.nodeId,
        state.telemetryId,
        state.observedAt,
        state.observationSource,
        state.validUntil,
        state.referenceDistanceMm,
        state.acceptedDistanceMm,
        state.waterHeightMm,
        state.classifiedLevel,
        state.classificationStatus,
        state.effectiveMultiplier,
        [...state.reasonCodes],
        state.classificationConfigVersion,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('Sensor state upsert returned no row');
    return mapState(row);
  }
}

function mapDeploymentWithState(
  row: DeploymentWithStateRow,
): SensorDeploymentWithState {
  return {
    deployment: mapDeployment(row),
    state: row.state_node_id === null ? null : mapState(row),
  };
}

function mapDeployment(row: DeploymentRow): SensorDeploymentConfiguration {
  return {
    nodeId: row.node_id,
    enabled: row.enabled,
    latitude: row.latitude,
    longitude: row.longitude,
    coveragePolygon: row.coverage_polygon,
    expectedPollIntervalMinutes: row.expected_poll_interval_minutes,
    staleAfterMinutes: row.stale_after_minutes,
    hysteresisMm: safeInteger(row.hysteresis_mm, 'hysteresis_mm'),
    mediumThresholdMm: safeInteger(
      row.medium_threshold_mm,
      'medium_threshold_mm',
    ),
    highThresholdMm: safeInteger(row.high_threshold_mm, 'high_threshold_mm'),
    blockedThresholdMm: safeInteger(
      row.blocked_threshold_mm,
      'blocked_threshold_mm',
    ),
    lowMultiplier: row.low_multiplier,
    mediumMultiplier: row.medium_multiplier,
    highMultiplier: row.high_multiplier,
    blockedMultiplier: row.blocked_multiplier,
    unknownMultiplier: row.unknown_multiplier,
    configVersion: safeInteger(row.config_version, 'config_version'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapState(row: StateRow): SensorStateRecord {
  if (
    row.state_node_id === null ||
    row.classified_level === null ||
    row.classification_status === null ||
    row.effective_multiplier === null ||
    row.reason_codes === null ||
    row.classification_config_version === null ||
    row.state_created_at === null ||
    row.state_updated_at === null
  ) {
    throw new Error('Sensor state row is incomplete');
  }
  return {
    nodeId: row.state_node_id,
    telemetryId:
      row.telemetry_id === null
        ? null
        : safeInteger(row.telemetry_id, 'telemetry_id'),
    observedAt: row.observed_at,
    observationSource: row.observation_source,
    validUntil: row.valid_until,
    referenceDistanceMm:
      row.state_reference_distance_mm === null
        ? null
        : safeInteger(
            row.state_reference_distance_mm,
            'reference_distance_mm',
          ),
    acceptedDistanceMm:
      row.state_accepted_distance_mm === null
        ? null
        : safeInteger(
            row.state_accepted_distance_mm,
            'accepted_distance_mm',
          ),
    waterHeightMm:
      row.water_height_mm === null
        ? null
        : safeInteger(row.water_height_mm, 'water_height_mm'),
    classifiedLevel: row.classified_level,
    classificationStatus: row.classification_status,
    effectiveMultiplier: row.effective_multiplier,
    reasonCodes: row.reason_codes,
    classificationConfigVersion: safeInteger(
      row.classification_config_version,
      'classification_config_version',
    ),
    createdAt: row.state_created_at,
    updatedAt: row.state_updated_at,
  };
}

function mapTelemetry(row: TelemetryRow): SensorTelemetryRecord {
  return {
    id: safeInteger(row.id, 'telemetry.id'),
    nodeId: row.node_id,
    persistentSessionId: safeInteger(
      row.node_boot_session_id,
      'node_boot_session_id',
    ),
    sequence: safeInteger(row.node_sequence, 'node_sequence'),
    gatewayReceivedAt: row.gateway_received_at,
    gatewayTimeTrusted: row.gateway_time_trusted,
    serverReceivedAt: row.server_received_at,
    referenceDistanceMm:
      row.reference_distance_mm === null
        ? null
        : safeInteger(row.reference_distance_mm, 'reference_distance_mm'),
    acceptedDistanceMm:
      row.accepted_distance_mm === null
        ? null
        : safeInteger(row.accepted_distance_mm, 'accepted_distance_mm'),
    filterState: row.filter_state,
    qualityFlags: row.quality_flags,
    healthFlags: row.health_flags,
  };
}

function safeInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${field} is outside the JavaScript safe integer range`);
  }
  return parsed;
}
