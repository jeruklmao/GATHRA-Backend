import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { mapDeployment } from '../../flood/admin/sensor-deployment-admin.controller';
import { SensorDeploymentService } from '../../flood/sensors/sensor-deployment.service';
import { IotMonitoringService } from '../../iot/services/iot-monitoring.service';
import {
  NODE_HEALTH_FLAG,
  NODE_QUALITY_FLAG,
} from '../../iot/protocol/node-protocol-v3';
import { AdminTrafficService, type DashboardRange } from '../metrics/admin-traffic.service';
import { AdminObserverService } from '../observer/admin-observer.service';

@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly database: DatabaseService,
    private readonly monitoring: IotMonitoringService,
    private readonly deployments: SensorDeploymentService,
    private readonly observer: AdminObserverService,
    private readonly traffic: AdminTrafficService,
  ) {}

  async overview() {
    const [observer, counts, flood, traffic] = await Promise.all([
      this.observer.snapshot(),
      this.database.query<{
        node_count: string;
        gateway_count: string;
        telemetry_count: string;
        deployment_count: string;
        database_size_bytes: string;
      }>(`SELECT
          (SELECT count(*) FROM iot_nodes)::text AS node_count,
          (SELECT count(*) FROM iot_gateways)::text AS gateway_count,
          (SELECT count(*) FROM iot_telemetry)::text AS telemetry_count,
          (SELECT count(*) FROM iot_sensor_deployments WHERE enabled)::text AS deployment_count,
          pg_database_size(current_database())::text AS database_size_bytes`),
      this.deployments.listEffective(),
      this.traffic.overview(),
    ]);
    const row = counts.rows[0];
    return {
      generatedAt: new Date().toISOString(),
      observer,
      database: {
        healthy: true,
        sizeBytes: Number(row.database_size_bytes),
      },
      counts: {
        nodes: Number(row.node_count),
        gateways: Number(row.gateway_count),
        telemetry: Number(row.telemetry_count),
        activeSensorDeployments: Number(row.deployment_count),
      },
      flood: flood.map(mapDeployment),
      traffic,
    };
  }

  async nodes() {
    const [nodes, deployments] = await Promise.all([
      this.monitoring.listNodes({ limit: 1_000 }),
      this.deployments.listEffective(),
    ]);
    const byNode = new Map(deployments.map((item) => [item.deployment.nodeId, item]));
    const now = Date.now();
    return {
      generatedAt: new Date(now).toISOString(),
      nodes: nodes.map((node) => {
        const state = byNode.get(node.nodeId);
        const telemetry = node.latestTelemetry;
        const observedAt = state?.observedAt?.toISOString() ??
          telemetry?.reception.serverReceivedAt ?? null;
        return {
          ...node,
          protocolVersion: telemetry === null ? null : 3,
          waterHeightMm: waterHeight(telemetry?.measurement),
          quality: telemetry === null ? null : decodeFlags(telemetry.measurement.qualityFlags, NODE_QUALITY_FLAG),
          health: telemetry === null ? null : decodeFlags(telemetry.measurement.healthFlags, NODE_HEALTH_FLAG),
          deployment: state === undefined ? null : mapDeployment(state),
          activity: activityStatus(
            observedAt,
            state?.deployment.expectedPollIntervalMinutes,
            state?.deployment.staleAfterMinutes,
            now,
          ),
        };
      }),
    };
  }

  async node(nodeId: string) {
    validateNodeId(nodeId);
    const [node, deployment] = await Promise.all([
      this.monitoring.getNode(nodeId),
      this.deployments.getEffective(nodeId),
    ]);
    const telemetry = node.latestTelemetry;
    return {
      ...node,
      protocolVersion: telemetry === null ? null : 3,
      waterHeightMm: waterHeight(telemetry?.measurement),
      quality: telemetry === null ? null : decodeFlags(telemetry.measurement.qualityFlags, NODE_QUALITY_FLAG),
      health: telemetry === null ? null : decodeFlags(telemetry.measurement.healthFlags, NODE_HEALTH_FLAG),
      deployment: deployment === null ? null : mapDeployment(deployment),
      activity: activityStatus(
        deployment?.observedAt?.toISOString() ?? telemetry?.reception.serverReceivedAt ?? null,
        deployment?.deployment.expectedPollIntervalMinutes,
        deployment?.deployment.staleAfterMinutes,
        Date.now(),
      ),
    };
  }

  async history(nodeId: string, query: Record<string, string | undefined>) {
    validateNodeId(nodeId);
    const limit = boundedInteger(query.limit, 100, 1, 500);
    return this.monitoring.history(nodeId, {
      limit,
      ...(query.beforeId === undefined
        ? {}
        : { beforeId: boundedInteger(query.beforeId, 0, 1, Number.MAX_SAFE_INTEGER) }),
      ...(query.from === undefined ? {} : { from: validIso(query.from, 'from') }),
      ...(query.to === undefined ? {} : { to: validIso(query.to, 'to') }),
      includeRaw: query.includeRaw === 'true',
    });
  }

  async charts(nodeId: string, range: string) {
    validateNodeId(nodeId);
    const definition = chartRange(range);
    const result = await this.database.query<{
      at: Date;
      reference_distance_mm: number | null;
      accepted_distance_mm: number | null;
      raw_distance_mm: number | null;
      temperature_c: number | null;
      humidity_percent: number | null;
      battery_mv: number | null;
      valid_samples: number | null;
      total_samples: number | null;
      filter_state: number | null;
      quality_flags: number | null;
      health_flags: number | null;
      rssi_dbm: number | null;
      snr_db: number | null;
      frequency_error_hz: number | null;
    }>(
      `WITH ranked AS (
         SELECT t.*,
           row_number() OVER (
             PARTITION BY date_bin($3::interval, server_received_at, TIMESTAMPTZ '1970-01-01')
             ORDER BY server_received_at DESC, id DESC
           ) AS rank
         FROM iot_telemetry t
         WHERE node_id = $1 AND server_received_at >= now() - $2::interval
       ) SELECT server_received_at AS at, reference_distance_mm, accepted_distance_mm,
                raw_distance_mm, temperature_centi_c / 100.0 AS temperature_c,
                humidity_centi_percent / 100.0 AS humidity_percent, battery_mv,
                valid_samples, total_samples, filter_state, quality_flags,
                health_flags, rssi_dbm, snr_db, frequency_error_hz
         FROM ranked WHERE rank = 1 ORDER BY server_received_at`,
      [nodeId, definition.interval, definition.bucket],
    );
    const deployment = await this.deployments.getEffective(nodeId);
    return {
      range: definition.name,
      thresholds: deployment === null ? null : {
        mediumMm: deployment.deployment.mediumThresholdMm,
        highMm: deployment.deployment.highThresholdMm,
        blockedMm: deployment.deployment.blockedThresholdMm,
      },
      points: result.rows.map((row) => ({
        ...camelTelemetryRow(row),
        at: row.at.toISOString(),
        waterHeightMm:
          row.reference_distance_mm === null || row.accepted_distance_mm === null
            ? null
            : Math.max(0, row.reference_distance_mm - row.accepted_distance_mm),
      })),
    };
  }

  async gateways() {
    const result = await this.database.query<{
      gateway_id: string;
      hardware_mac: string;
      first_seen_at: Date;
      last_seen_at: Date;
      latest_node_id: string | null;
      latest_reception_at: Date | null;
      telemetry_count: string;
    }>(`SELECT g.logical_gateway_id AS gateway_id, g.hardware_mac, g.first_seen_at,
               g.last_seen_at, latest.node_id AS latest_node_id,
               latest.server_received_at AS latest_reception_at,
               count(t.id)::text AS telemetry_count
        FROM iot_gateways g
        LEFT JOIN iot_telemetry t ON t.gateway_id = g.id
        LEFT JOIN LATERAL (
          SELECT node_id, server_received_at FROM iot_telemetry x
          WHERE x.gateway_id = g.id ORDER BY server_received_at DESC, id DESC LIMIT 1
        ) latest ON true
        GROUP BY g.id, latest.node_id, latest.server_received_at
        ORDER BY g.last_seen_at DESC`);
    return { gateways: result.rows.map((row) => ({
      gatewayId: row.gateway_id,
      hardwareMac: row.hardware_mac,
      firstSeenAt: row.first_seen_at.toISOString(),
      lastSeenAt: row.last_seen_at.toISOString(),
      latestNodeId: row.latest_node_id,
      latestReceptionAt: row.latest_reception_at?.toISOString() ?? null,
      telemetryCount: Number(row.telemetry_count),
      statusBasis: 'activity-derived; no continuous Gateway heartbeat',
    })) };
  }

  trafficMetrics(range: DashboardRange) {
    return this.traffic.query(range);
  }
}

export function activityStatus(
  observedAt: string | null,
  pollMinutes: number | undefined,
  staleMinutes: number | undefined,
  now: number,
) {
  if (observedAt === null || pollMinutes === undefined || staleMinutes === undefined) {
    return { status: 'UNCONFIGURED', ageMinutes: observedAt === null ? null : Math.max(0, (now - Date.parse(observedAt)) / 60_000) };
  }
  const ageMinutes = Math.max(0, (now - Date.parse(observedAt)) / 60_000);
  return {
    status: ageMinutes <= pollMinutes ? 'ONLINE' : ageMinutes <= staleMinutes ? 'STALE' : 'OFFLINE',
    ageMinutes,
  };
}

function decodeFlags(value: number, definition: Record<string, number>) {
  return { raw: value, hex: `0x${value.toString(16).padStart(4, '0')}`, labels: Object.entries(definition).filter(([, bit]) => (value & bit) !== 0).map(([name]) => name) };
}

function waterHeight(measurement: { referenceDistanceMm: number | null; acceptedDistanceMm: number | null } | undefined) {
  return measurement === undefined || measurement.referenceDistanceMm === null || measurement.acceptedDistanceMm === null
    ? null
    : Math.max(0, measurement.referenceDistanceMm - measurement.acceptedDistanceMm);
}

function validateNodeId(nodeId: string): void {
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(nodeId)) throw new BadRequestException('Invalid Node ID');
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new BadRequestException('Expected an integer query value');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new BadRequestException('Query value is outside the supported range');
  return parsed;
}

function validIso(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new BadRequestException(`${field} must be an ISO-8601 timestamp`);
  return value;
}

function chartRange(value: string) {
  const values = {
    '1h': { name: '1h', interval: '1 hour', bucket: '10 seconds' },
    '24h': { name: '24h', interval: '24 hours', bucket: '2 minutes' },
    '7d': { name: '7d', interval: '7 days', bucket: '15 minutes' },
    '30d': { name: '30d', interval: '30 days', bucket: '1 hour' },
  } as const;
  return values[value as keyof typeof values] ?? values['24h'];
}

function camelTelemetryRow(row: Record<string, unknown>) {
  return {
    referenceDistanceMm: row.reference_distance_mm,
    acceptedDistanceMm: row.accepted_distance_mm,
    rawDistanceMm: row.raw_distance_mm,
    temperatureC: row.temperature_c,
    humidityPercent: row.humidity_percent,
    batteryMv: row.battery_mv,
    validSamples: row.valid_samples,
    totalSamples: row.total_samples,
    filterState: row.filter_state,
    qualityFlags: row.quality_flags,
    healthFlags: row.health_flags,
    rssiDbm: row.rssi_dbm,
    snrDb: row.snr_db,
    frequencyErrorHz: row.frequency_error_hz,
  };
}
