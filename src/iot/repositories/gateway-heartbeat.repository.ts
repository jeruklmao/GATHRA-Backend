import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type { GatewayHeartbeatDto } from '../dto/gateway-heartbeat.dto';
import { gatewayFreshness } from '../models/gateway-heartbeat.models';

@Injectable()
export class GatewayHeartbeatRepository {
  constructor(private readonly database: DatabaseService) {}

  async persist(dto: GatewayHeartbeatDto, receivedAt: Date): Promise<void> {
    await this.database.transaction(async (client) => {
      const gatewayId = await this.resolveGateway(client, dto, receivedAt);
      await client.query(statusUpsertSql, statusValues(gatewayId, dto, receivedAt));
      await client.query(metricsInsertSql, metricsValues(gatewayId, dto, receivedAt));
    });
  }

  async list(now = new Date()): Promise<Record<string, unknown>[]> {
    const result = await this.database.query<Record<string, unknown>>(`
      SELECT g.id::text AS internal_id, g.logical_gateway_id, g.hardware_mac,
             g.firmware_version AS registry_firmware_version,
             g.first_seen_at, g.last_seen_at,
             to_jsonb(s) AS heartbeat,
             latest.node_id AS latest_node_id,
             latest.server_received_at AS latest_reception_at,
             (SELECT count(*)::text FROM iot_telemetry t WHERE t.gateway_id = g.id) AS telemetry_count,
             (SELECT count(*)::text FROM iot_gateway_metrics m WHERE m.gateway_id = g.id) AS heartbeat_sample_count
        FROM iot_gateways g
        LEFT JOIN iot_gateway_status s ON s.gateway_id = g.id
        LEFT JOIN LATERAL (
          SELECT node_id, server_received_at FROM iot_telemetry t
           WHERE t.gateway_id = g.id ORDER BY server_received_at DESC, id DESC LIMIT 1
        ) latest ON true
       ORDER BY COALESCE(s.last_heartbeat_at, g.last_seen_at) DESC`);
    return result.rows.map((row) => mapGateway(row, now));
  }

  async detail(gatewayId: string, now = new Date()): Promise<Record<string, unknown>> {
    validateGatewayId(gatewayId);
    const rows = await this.list(now);
    const row = rows.find((item) => item.gatewayId === gatewayId);
    if (row === undefined) throw new NotFoundException('Gateway was not found');
    return row;
  }

  async metrics(gatewayId: string, range: string): Promise<Record<string, unknown>> {
    validateGatewayId(gatewayId);
    const definition = metricRange(range);
    const result = await this.database.query<Record<string, unknown>>(`
      WITH selected_gateway AS (
        SELECT id FROM iot_gateways WHERE logical_gateway_id = $1
      ), ranked AS (
        SELECT m.*, row_number() OVER (
          PARTITION BY date_bin($3::interval, sampled_at, TIMESTAMPTZ '1970-01-01')
          ORDER BY m.sampled_at DESC, m.id DESC
        ) AS rank
        FROM iot_gateway_metrics m JOIN selected_gateway g ON g.id = m.gateway_id
        WHERE sampled_at >= now() - $2::interval
      )
      SELECT * FROM ranked WHERE rank = 1 ORDER BY sampled_at`,
      [gatewayId, definition.interval, definition.bucket],
    );
    return {
      range: definition.name,
      maximumPoints: 1_000,
      points: result.rows.map(mapMetric),
    };
  }

  async cleanup(retentionDays = 30): Promise<number> {
    const result = await this.database.query(
      `DELETE FROM iot_gateway_metrics WHERE sampled_at < now() - ($1 * interval '1 day')`,
      [retentionDays],
    );
    return result.rowCount ?? 0;
  }

  private async resolveGateway(
    client: PoolClient,
    dto: GatewayHeartbeatDto,
    receivedAt: Date,
  ): Promise<string> {
    const mac = dto.gateway.mac.toUpperCase();
    const identity = await client.query<{ id: string; hardware_mac: string; logical_gateway_id: string }>(
      `SELECT id::text, hardware_mac, logical_gateway_id FROM iot_gateways
        WHERE hardware_mac = $1 OR logical_gateway_id = $2 FOR UPDATE`,
      [mac, dto.gateway.gatewayId],
    );
    const byLogical = identity.rows.find((row) => row.logical_gateway_id === dto.gateway.gatewayId);
    if (byLogical !== undefined && byLogical.hardware_mac !== mac) {
      throw new BadRequestException('gatewayId is already registered to another MAC');
    }
    const byMac = identity.rows.find((row) => row.hardware_mac === mac);
    if (byMac !== undefined) {
      await client.query(
        `UPDATE iot_gateways SET logical_gateway_id=$2, firmware_version=$3, last_seen_at=$4 WHERE id=$1`,
        [byMac.id, dto.gateway.gatewayId, dto.gateway.firmwareVersion, receivedAt],
      );
      return byMac.id;
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO iot_gateways (hardware_mac, logical_gateway_id, firmware_version, first_seen_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$4) RETURNING id::text`,
      [mac, dto.gateway.gatewayId, dto.gateway.firmwareVersion, receivedAt],
    );
    return inserted.rows[0].id;
  }
}

function mapGateway(row: Record<string, unknown>, now: Date): Record<string, unknown> {
  const raw = row.heartbeat as Record<string, unknown> | null;
  const heartbeat = raw === null ? null : camelObject(raw);
  if (heartbeat !== null) delete heartbeat.gatewayId;
  const last = raw?.last_heartbeat_at instanceof Date
    ? raw.last_heartbeat_at
    : raw?.last_heartbeat_at === undefined ? null : new Date(String(raw.last_heartbeat_at));
  const interval = raw === null ? null : Number(raw.heartbeat_interval_seconds);
  return {
    gatewayId: row.logical_gateway_id,
    hardwareMac: row.hardware_mac,
    firstSeenAt: iso(row.first_seen_at),
    lastSeenAt: iso(row.last_seen_at),
    registryFirmwareVersion: row.registry_firmware_version,
    latestNodeId: row.latest_node_id,
    latestReceptionAt: iso(row.latest_reception_at),
    telemetryCount: Number(row.telemetry_count),
    heartbeatSampleCount: Number(row.heartbeat_sample_count),
    heartbeat,
    freshness: gatewayFreshness(last, interval, now),
    statusBasis: raw === null
      ? 'LEGACY_ACTIVITY_ONLY: no Firmware 2.2 heartbeat received'
      : 'authoritative Backend heartbeat reception time',
  };
}

function mapMetric(row: Record<string, unknown>): Record<string, unknown> {
  const ignored = new Set(['id', 'gateway_id', 'rank']);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!ignored.has(key)) result[camel(key)] = value instanceof Date ? value.toISOString() : numeric(value);
  }
  return result;
}

function camelObject(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [camel(key), value instanceof Date ? value.toISOString() : numeric(value)]));
}

function camel(value: string): string {
  return value.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function numeric(value: unknown): unknown {
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function validateGatewayId(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(value)) throw new BadRequestException('Invalid Gateway ID');
}

function metricRange(value: string) {
  const values = {
    '1h': { name: '1h', interval: '1 hour', bucket: '5 seconds' },
    '24h': { name: '24h', interval: '24 hours', bucket: '2 minutes' },
    '7d': { name: '7d', interval: '7 days', bucket: '15 minutes' },
    '30d': { name: '30d', interval: '30 days', bucket: '1 hour' },
  } as const;
  const selected = values[value as keyof typeof values];
  if (selected === undefined) throw new BadRequestException('range must be 1h, 24h, 7d, or 30d');
  return selected;
}

const statusUpsertSql = `
INSERT INTO iot_gateway_status VALUES (
 $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
 $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
 $41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60,
 $61,$62,$63,$64,$65,$66,$67,clock_timestamp(),clock_timestamp()
) ON CONFLICT (gateway_id) DO UPDATE SET
 last_heartbeat_at=EXCLUDED.last_heartbeat_at, heartbeat_schema_version=EXCLUDED.heartbeat_schema_version,
 heartbeat_interval_seconds=EXCLUDED.heartbeat_interval_seconds, firmware_version=EXCLUDED.firmware_version,
 protocol_version=EXCLUDED.protocol_version, build_flavor=EXCLUDED.build_flavor, uptime_seconds=EXCLUDED.uptime_seconds,
 reset_reason=EXCLUDED.reset_reason, boot_count=EXCLUDED.boot_count, free_heap_bytes=EXCLUDED.free_heap_bytes,
 min_free_heap_bytes=EXCLUDED.min_free_heap_bytes, largest_free_heap_block_bytes=EXCLUDED.largest_free_heap_block_bytes,
 sketch_size_bytes=EXCLUDED.sketch_size_bytes, free_sketch_space_bytes=EXCLUDED.free_sketch_space_bytes,
 flash_size_bytes=EXCLUDED.flash_size_bytes, wifi_connected=EXCLUDED.wifi_connected, ssid=EXCLUDED.ssid,
 wifi_rssi_dbm=EXCLUDED.wifi_rssi_dbm, local_ip=EXCLUDED.local_ip,
 backend_connectivity_state=EXCLUDED.backend_connectivity_state, last_backend_success_at=EXCLUDED.last_backend_success_at,
 last_backend_error_at=EXCLUDED.last_backend_error_at, consecutive_backend_failures=EXCLUDED.consecutive_backend_failures,
 time_valid=EXCLUDED.time_valid, gateway_current_utc=EXCLUDED.gateway_current_utc, last_ntp_sync_at=EXCLUDED.last_ntp_sync_at,
 ntp_age_seconds=EXCLUDED.ntp_age_seconds, paired_node_id=EXCLUDED.paired_node_id, last_lora_rx_at=EXCLUDED.last_lora_rx_at,
 latest_rssi_dbm=EXCLUDED.latest_rssi_dbm, latest_snr_db=EXCLUDED.latest_snr_db,
 latest_frequency_error_hz=EXCLUDED.latest_frequency_error_hz, received_packet_count=EXCLUDED.received_packet_count,
 valid_telemetry_count=EXCLUDED.valid_telemetry_count, invalid_packet_count=EXCLUDED.invalid_packet_count,
 crc_error_count=EXCLUDED.crc_error_count, protocol_rejected_packet_count=EXCLUDED.protocol_rejected_packet_count,
 unpaired_rejected_packet_count=EXCLUDED.unpaired_rejected_packet_count, ack_count=EXCLUDED.ack_count,
 ack_success_count=EXCLUDED.ack_success_count, ack_failure_count=EXCLUDED.ack_failure_count,
 ack_latency_sample_count=EXCLUDED.ack_latency_sample_count, latest_rx_to_ack_start_ms=EXCLUDED.latest_rx_to_ack_start_ms,
 latest_rx_to_ack_complete_ms=EXCLUDED.latest_rx_to_ack_complete_ms, latest_ack_tx_duration_ms=EXCLUDED.latest_ack_tx_duration_ms,
 min_rx_to_ack_start_ms=EXCLUDED.min_rx_to_ack_start_ms, max_rx_to_ack_start_ms=EXCLUDED.max_rx_to_ack_start_ms,
 avg_rx_to_ack_start_ms=EXCLUDED.avg_rx_to_ack_start_ms, min_rx_to_ack_complete_ms=EXCLUDED.min_rx_to_ack_complete_ms,
 max_rx_to_ack_complete_ms=EXCLUDED.max_rx_to_ack_complete_ms, avg_rx_to_ack_complete_ms=EXCLUDED.avg_rx_to_ack_complete_ms,
 min_ack_tx_duration_ms=EXCLUDED.min_ack_tx_duration_ms, max_ack_tx_duration_ms=EXCLUDED.max_ack_tx_duration_ms,
 avg_ack_tx_duration_ms=EXCLUDED.avg_ack_tx_duration_ms, queue_depth=EXCLUDED.queue_depth,
 queue_capacity=EXCLUDED.queue_capacity, oldest_record_age_seconds=EXCLUDED.oldest_record_age_seconds,
 telemetry_upload_success_count=EXCLUDED.telemetry_upload_success_count, telemetry_upload_failure_count=EXCLUDED.telemetry_upload_failure_count,
 pending_command_id=EXCLUDED.pending_command_id, pending_command_type=EXCLUDED.pending_command_type,
 pending_command_state=EXCLUDED.pending_command_state, last_command_id=EXCLUDED.last_command_id,
 last_command_result=EXCLUDED.last_command_result, commands_sent_count=EXCLUDED.commands_sent_count,
 command_results_received_count=EXCLUDED.command_results_received_count, updated_at=clock_timestamp()`;

function statusValues(id: string, d: GatewayHeartbeatDto, at: Date): unknown[] {
  return [id,at,d.schemaVersion,d.heartbeatIntervalSeconds,d.gateway.firmwareVersion,d.gateway.protocolVersion,d.gateway.buildFlavor,
    d.runtime.uptimeSeconds,d.runtime.resetReason,d.runtime.bootCount,d.runtime.freeHeapBytes,d.runtime.minFreeHeapBytes,d.runtime.largestFreeHeapBlockBytes,d.runtime.sketchSizeBytes,d.runtime.freeSketchSpaceBytes,d.runtime.flashSizeBytes,
    d.network.wifiConnected,d.network.ssid,d.network.wifiRssiDbm,d.network.localIp,d.network.backendConnectivityState,d.network.lastBackendSuccessAt,d.network.lastBackendErrorAt,d.network.consecutiveBackendFailures,
    d.time.timeValid,d.time.currentUtc,d.time.lastNtpSyncAt,d.time.ntpAgeSeconds,d.lora.pairedNodeId,d.lora.lastLoRaRxAt,d.lora.latestRssiDbm,d.lora.latestSnrDb,d.lora.latestFrequencyErrorHz,d.lora.receivedPacketCount,d.lora.validTelemetryCount,d.lora.invalidPacketCount,d.lora.crcErrorCount,d.lora.protocolRejectedPacketCount,d.lora.unpairedRejectedPacketCount,
    d.ack.ackCount,d.ack.ackSuccessCount,d.ack.ackFailureCount,d.ack.latencySampleCount,d.ack.latestRxToAckStartMs,d.ack.latestRxToAckCompleteMs,d.ack.latestAckTxDurationMs,d.ack.minRxToAckStartMs,d.ack.maxRxToAckStartMs,d.ack.avgRxToAckStartMs,d.ack.minRxToAckCompleteMs,d.ack.maxRxToAckCompleteMs,d.ack.avgRxToAckCompleteMs,d.ack.minAckTxDurationMs,d.ack.maxAckTxDurationMs,d.ack.avgAckTxDurationMs,
    d.queue.depth,d.queue.capacity,d.queue.oldestRecordAgeSeconds,d.queue.telemetryUploadSuccessCount,d.queue.telemetryUploadFailureCount,d.commands.pendingCommandId,d.commands.pendingCommandType,d.commands.pendingCommandState,d.commands.lastCommandId,d.commands.lastCommandResult,d.commands.commandsSentCount,d.commands.commandResultsReceivedCount];
}

const metricsInsertSql = `INSERT INTO iot_gateway_metrics (
 gateway_id,sampled_at,uptime_seconds,boot_count,free_heap_bytes,min_free_heap_bytes,largest_free_heap_block_bytes,
 wifi_rssi_dbm,ntp_age_seconds,latest_rssi_dbm,latest_snr_db,latest_frequency_error_hz,
 latest_rx_to_ack_start_ms,latest_rx_to_ack_complete_ms,latest_ack_tx_duration_ms,queue_depth,queue_capacity,
 oldest_record_age_seconds,consecutive_backend_failures,telemetry_upload_success_count,telemetry_upload_failure_count,
 received_packet_count,valid_telemetry_count,invalid_packet_count,ack_success_count,ack_failure_count,
 commands_sent_count,command_results_received_count) VALUES (${Array.from({length: 28}, (_, i) => `$${i + 1}`).join(',')})`;

function metricsValues(id: string, d: GatewayHeartbeatDto, at: Date): unknown[] {
  return [id,at,d.runtime.uptimeSeconds,d.runtime.bootCount,d.runtime.freeHeapBytes,d.runtime.minFreeHeapBytes,d.runtime.largestFreeHeapBlockBytes,d.network.wifiRssiDbm,d.time.ntpAgeSeconds,d.lora.latestRssiDbm,d.lora.latestSnrDb,d.lora.latestFrequencyErrorHz,d.ack.latestRxToAckStartMs,d.ack.latestRxToAckCompleteMs,d.ack.latestAckTxDurationMs,d.queue.depth,d.queue.capacity,d.queue.oldestRecordAgeSeconds,d.network.consecutiveBackendFailures,d.queue.telemetryUploadSuccessCount,d.queue.telemetryUploadFailureCount,d.lora.receivedPacketCount,d.lora.validTelemetryCount,d.lora.invalidPacketCount,d.ack.ackSuccessCount,d.ack.ackFailureCount,d.commands.commandsSentCount,d.commands.commandResultsReceivedCount];
}
