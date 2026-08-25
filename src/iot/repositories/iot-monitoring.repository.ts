import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type {
  MonitoringNodeSummary,
  MonitoringTelemetry,
} from '../models/monitoring.models';
import { FILTER_STATE_NAMES } from '../protocol/node-protocol-v2';

interface TelemetryRow {
  readonly telemetry_id: string | null;
  readonly telemetry_node_id: string | null;
  readonly node_boot_session_id: string | null;
  readonly node_sequence: string | null;
  readonly gateway_logical_id_snapshot: string | null;
  readonly hardware_mac: string | null;
  readonly gateway_boot_session_id: string | null;
  readonly gateway_received_at: Date | null;
  readonly gateway_time_trusted: boolean | null;
  readonly gateway_uptime_ms: string | null;
  readonly server_received_at: Date | null;
  readonly median_echo_us: string | null;
  readonly raw_distance_mm: string | null;
  readonly accepted_distance_mm: string | null;
  readonly mad_mm: number | null;
  readonly temperature_centi_c: number | null;
  readonly humidity_centi_percent: number | null;
  readonly battery_mv: number | null;
  readonly valid_samples: number | null;
  readonly total_samples: number | null;
  readonly filter_state: number | null;
  readonly quality_flags: number | null;
  readonly health_flags: number | null;
  readonly rssi_dbm: number | null;
  readonly snr_db: number | null;
  readonly frequency_error_hz: number | null;
  readonly packet_length: number | null;
  readonly raw_payload?: Buffer;
}

interface NodeRow extends TelemetryRow {
  readonly node_id: string;
  readonly first_seen_at: Date;
  readonly last_seen_at: Date;
  readonly last_gateway_logical_id: string | null;
  readonly last_gateway_hardware_mac: string | null;
}

export interface HistoryQuery {
  readonly limit: number;
  readonly beforeId?: number;
  readonly from?: Date;
  readonly to?: Date;
  readonly includeRaw: boolean;
}

@Injectable()
export class IotMonitoringRepository {
  constructor(private readonly database: DatabaseService) {}

  async listNodes(limit: number): Promise<MonitoringNodeSummary[]> {
    const result = await this.database.query<NodeRow>(
      `
        SELECT
          n.node_id,
          n.first_seen_at,
          n.last_seen_at,
          last_gateway.logical_gateway_id AS last_gateway_logical_id,
          last_gateway.hardware_mac AS last_gateway_hardware_mac,
          latest.id AS telemetry_id,
          latest.node_id AS telemetry_node_id,
          latest.node_boot_session_id,
          latest.node_sequence,
          latest.gateway_logical_id_snapshot,
          latest_gateway.hardware_mac,
          latest.gateway_boot_session_id,
          latest.gateway_received_at,
          latest.gateway_time_trusted,
          latest.gateway_uptime_ms,
          latest.server_received_at,
          latest.median_echo_us,
          latest.raw_distance_mm,
          latest.accepted_distance_mm,
          latest.mad_mm,
          latest.temperature_centi_c,
          latest.humidity_centi_percent,
          latest.battery_mv,
          latest.valid_samples,
          latest.total_samples,
          latest.filter_state,
          latest.quality_flags,
          latest.health_flags,
          latest.rssi_dbm,
          latest.snr_db,
          latest.frequency_error_hz,
          latest.packet_length
        FROM iot_nodes n
        LEFT JOIN iot_gateways last_gateway ON last_gateway.id = n.last_gateway_id
        LEFT JOIN LATERAL (
          SELECT * FROM iot_telemetry t
          WHERE t.node_id = n.node_id
          ORDER BY t.server_received_at DESC, t.id DESC
          LIMIT 1
        ) latest ON true
        LEFT JOIN iot_gateways latest_gateway ON latest_gateway.id = latest.gateway_id
        ORDER BY n.last_seen_at DESC, n.node_id ASC
        LIMIT $1
      `,
      [limit],
    );
    return result.rows.map((row) => this.mapNode(row));
  }

  async getNode(nodeId: string): Promise<MonitoringNodeSummary | null> {
    const result = await this.database.query<NodeRow>(
      `
        SELECT
          n.node_id,
          n.first_seen_at,
          n.last_seen_at,
          last_gateway.logical_gateway_id AS last_gateway_logical_id,
          last_gateway.hardware_mac AS last_gateway_hardware_mac,
          latest.id AS telemetry_id,
          latest.node_id AS telemetry_node_id,
          latest.node_boot_session_id,
          latest.node_sequence,
          latest.gateway_logical_id_snapshot,
          latest_gateway.hardware_mac,
          latest.gateway_boot_session_id,
          latest.gateway_received_at,
          latest.gateway_time_trusted,
          latest.gateway_uptime_ms,
          latest.server_received_at,
          latest.median_echo_us,
          latest.raw_distance_mm,
          latest.accepted_distance_mm,
          latest.mad_mm,
          latest.temperature_centi_c,
          latest.humidity_centi_percent,
          latest.battery_mv,
          latest.valid_samples,
          latest.total_samples,
          latest.filter_state,
          latest.quality_flags,
          latest.health_flags,
          latest.rssi_dbm,
          latest.snr_db,
          latest.frequency_error_hz,
          latest.packet_length
        FROM iot_nodes n
        LEFT JOIN iot_gateways last_gateway ON last_gateway.id = n.last_gateway_id
        LEFT JOIN LATERAL (
          SELECT * FROM iot_telemetry t
          WHERE t.node_id = n.node_id
          ORDER BY t.server_received_at DESC, t.id DESC
          LIMIT 1
        ) latest ON true
        LEFT JOIN iot_gateways latest_gateway ON latest_gateway.id = latest.gateway_id
        WHERE n.node_id = $1
      `,
      [nodeId],
    );
    const row = result.rows[0];
    return row === undefined ? null : this.mapNode(row);
  }

  async history(
    nodeId: string,
    query: HistoryQuery,
  ): Promise<MonitoringTelemetry[]> {
    const values: unknown[] = [nodeId];
    const conditions = ['t.node_id = $1'];
    if (query.beforeId !== undefined) {
      values.push(query.beforeId);
      conditions.push(`
        (t.server_received_at, t.id) < (
          SELECT cursor.server_received_at, cursor.id
          FROM iot_telemetry cursor
          WHERE cursor.node_id = $1 AND cursor.id = $${values.length}
        )
      `);
    }
    if (query.from !== undefined) {
      values.push(query.from);
      conditions.push(`t.server_received_at >= $${values.length}`);
    }
    if (query.to !== undefined) {
      values.push(query.to);
      conditions.push(`t.server_received_at <= $${values.length}`);
    }
    values.push(query.limit);
    const rawColumn = query.includeRaw ? ', t.raw_payload' : '';
    const result = await this.database.query<TelemetryRow>(
      `
        SELECT
          t.id AS telemetry_id,
          t.node_id AS telemetry_node_id,
          t.node_boot_session_id,
          t.node_sequence,
          t.gateway_logical_id_snapshot,
          g.hardware_mac,
          t.gateway_boot_session_id,
          t.gateway_received_at,
          t.gateway_time_trusted,
          t.gateway_uptime_ms,
          t.server_received_at,
          t.median_echo_us,
          t.raw_distance_mm,
          t.accepted_distance_mm,
          t.mad_mm,
          t.temperature_centi_c,
          t.humidity_centi_percent,
          t.battery_mv,
          t.valid_samples,
          t.total_samples,
          t.filter_state,
          t.quality_flags,
          t.health_flags,
          t.rssi_dbm,
          t.snr_db,
          t.frequency_error_hz,
          t.packet_length
          ${rawColumn}
        FROM iot_telemetry t
        JOIN iot_gateways g ON g.id = t.gateway_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY t.server_received_at DESC, t.id DESC
        LIMIT $${values.length}
      `,
      values,
    );
    return result.rows.map((row) => this.mapTelemetry(row, query.includeRaw));
  }

  private mapNode(row: NodeRow): MonitoringNodeSummary {
    return {
      nodeId: row.node_id,
      firstSeenAt: asIso(row.first_seen_at),
      lastSeenAt: asIso(row.last_seen_at),
      lastGateway:
        row.last_gateway_logical_id === null ||
        row.last_gateway_hardware_mac === null
          ? null
          : {
              gatewayId: row.last_gateway_logical_id,
              hardwareMac: row.last_gateway_hardware_mac,
            },
      latestTelemetry:
        row.telemetry_id === null ? null : this.mapTelemetry(row, false),
    };
  }

  private mapTelemetry(
    row: TelemetryRow,
    includeRaw: boolean,
  ): MonitoringTelemetry {
    if (
      row.telemetry_id === null ||
      row.telemetry_node_id === null ||
      row.node_boot_session_id === null ||
      row.node_sequence === null ||
      row.gateway_logical_id_snapshot === null ||
      row.hardware_mac === null ||
      row.gateway_boot_session_id === null ||
      row.gateway_time_trusted === null ||
      row.gateway_uptime_ms === null ||
      row.server_received_at === null ||
      row.median_echo_us === null ||
      row.mad_mm === null ||
      row.battery_mv === null ||
      row.valid_samples === null ||
      row.total_samples === null ||
      row.filter_state === null ||
      row.quality_flags === null ||
      row.health_flags === null ||
      row.rssi_dbm === null ||
      row.snr_db === null ||
      row.frequency_error_hz === null ||
      row.packet_length === null
    ) {
      throw new Error('Database returned an incomplete telemetry row');
    }
    const telemetry: MonitoringTelemetry = {
      id: safeNumber(row.telemetry_id, 'telemetry id'),
      nodeId: row.telemetry_node_id,
      bootSessionId: safeNumber(row.node_boot_session_id, 'boot session id'),
      sequence: safeNumber(row.node_sequence, 'sequence'),
      measurement: {
        medianEchoUs: safeNumber(row.median_echo_us, 'median echo'),
        rawDistanceMm:
          row.raw_distance_mm === null
            ? null
            : safeNumber(row.raw_distance_mm, 'raw distance'),
        acceptedDistanceMm:
          row.accepted_distance_mm === null
            ? null
            : safeNumber(row.accepted_distance_mm, 'accepted distance'),
        madMm: row.mad_mm,
        temperatureC:
          row.temperature_centi_c === null
            ? null
            : row.temperature_centi_c / 100,
        humidityPercent:
          row.humidity_centi_percent === null
            ? null
            : row.humidity_centi_percent / 100,
        batteryMv: row.battery_mv,
        validSamples: row.valid_samples,
        totalSamples: row.total_samples,
        filterState: {
          code: row.filter_state,
          name: FILTER_STATE_NAMES[row.filter_state],
        },
        qualityFlags: row.quality_flags,
        healthFlags: row.health_flags,
      },
      reception: {
        gatewayId: row.gateway_logical_id_snapshot,
        hardwareMac: row.hardware_mac,
        gatewayBootSessionId: safeNumber(
          row.gateway_boot_session_id,
          'Gateway boot session id',
        ),
        gatewayReceivedAt:
          row.gateway_received_at === null
            ? null
            : asIso(row.gateway_received_at),
        gatewayTimeTrusted: row.gateway_time_trusted,
        gatewayUptimeMs: safeNumber(row.gateway_uptime_ms, 'Gateway uptime'),
        serverReceivedAt: asIso(row.server_received_at),
        rssiDbm: row.rssi_dbm,
        snrDb: row.snr_db,
        frequencyErrorHz: row.frequency_error_hz,
        packetLength: row.packet_length,
      },
      ...(includeRaw && row.raw_payload !== undefined
        ? { rawPayloadBase64: row.raw_payload.toString('base64') }
        : {}),
    };
    return telemetry;
  }
}

function safeNumber(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${field} exceeds the JSON safe-integer range`);
  }
  return parsed;
}

function asIso(value: Date): string {
  return value.toISOString();
}
