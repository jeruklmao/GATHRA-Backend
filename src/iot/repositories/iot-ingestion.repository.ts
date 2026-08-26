import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type { GatewayDescriptorDto } from '../dto/ingest-telemetry.dto';
import type { ValidatedIngestReading } from '../models/ingestion.models';

export interface PersistedIngestionResult {
  readonly index: number;
  readonly inserted: boolean;
}

@Injectable()
export class IotIngestionRepository {
  constructor(private readonly database: DatabaseService) {}

  async persistBatch(
    gateway: GatewayDescriptorDto,
    readings: readonly ValidatedIngestReading[],
    serverReceivedAt: Date,
  ): Promise<PersistedIngestionResult[]> {
    if (readings.length === 0) return [];
    return this.database.transaction(async (client) => {
      const gatewayId = await this.upsertGateway(
        client,
        gateway,
        serverReceivedAt,
      );
      const results: PersistedIngestionResult[] = [];
      for (const reading of readings) {
        await this.upsertNode(
          client,
          reading.decoded.nodeId,
          gatewayId,
          serverReceivedAt,
        );
        const reception = reading.reception;
        const decoded = reading.decoded;
        const inserted = await client.query<{ id: string }>(
          `
            INSERT INTO iot_telemetry (
              gateway_id,
              gateway_logical_id_snapshot,
              node_id,
              node_boot_session_id,
              node_sequence,
              gateway_received_at,
              gateway_time_trusted,
              gateway_uptime_ms,
              gateway_boot_session_id,
              server_received_at,
              median_echo_us,
              raw_distance_mm,
              accepted_distance_mm,
              reference_distance_mm,
              mad_mm,
              temperature_centi_c,
              humidity_centi_percent,
              battery_mv,
              valid_samples,
              total_samples,
              filter_state,
              quality_flags,
              health_flags,
              rssi_dbm,
              snr_db,
              frequency_error_hz,
              packet_length,
              protocol_version,
              raw_payload
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
              $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
              $21, $22, $23, $24, $25, $26, $27, $28, $29
            )
            ON CONFLICT (node_id, node_boot_session_id, node_sequence)
              DO NOTHING
            RETURNING id
          `,
          [
            gatewayId,
            gateway.gatewayId,
            decoded.nodeId,
            // Legacy SQL column name; Protocol v3 stores persistentSessionId.
            decoded.persistentSessionId,
            decoded.sequence,
            reception.gatewayTimeTrusted
              ? new Date(reception.gatewayReceivedAt as string)
              : null,
            reception.gatewayTimeTrusted,
            reception.gatewayUptimeMs,
            reception.gatewayBootSessionId,
            serverReceivedAt,
            decoded.medianEchoUs,
            decoded.rawDistanceMm,
            decoded.acceptedDistanceMm,
            decoded.referenceDistanceMm,
            decoded.madMm,
            decoded.temperatureCentiC,
            decoded.humidityCentiPercent,
            decoded.batteryMv,
            decoded.validSamples,
            decoded.totalSamples,
            decoded.filterState,
            decoded.qualityFlags,
            decoded.healthFlags,
            reception.rssiDbm,
            reception.snrDb,
            reception.frequencyErrorHz,
            reception.packetLength,
            decoded.protocolVersion,
            decoded.rawPayload,
          ],
        );
        results.push({ index: reading.index, inserted: inserted.rowCount === 1 });
      }
      return results;
    });
  }

  private async upsertGateway(
    client: PoolClient,
    gateway: GatewayDescriptorDto,
    serverReceivedAt: Date,
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `
        INSERT INTO iot_gateways (
          hardware_mac, logical_gateway_id, firmware_version,
          first_seen_at, last_seen_at
        ) VALUES ($1, $2, $3, $4, $4)
        ON CONFLICT (hardware_mac) DO UPDATE SET
          logical_gateway_id = EXCLUDED.logical_gateway_id,
          firmware_version = EXCLUDED.firmware_version,
          last_seen_at = EXCLUDED.last_seen_at
        RETURNING id
      `,
      [
        gateway.hardwareMac.toUpperCase(),
        gateway.gatewayId,
        gateway.firmwareVersion,
        serverReceivedAt,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('Gateway upsert returned no row');
    return row.id;
  }

  private async upsertNode(
    client: PoolClient,
    nodeId: string,
    gatewayId: string,
    serverReceivedAt: Date,
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO iot_nodes (
          node_id, first_seen_at, last_seen_at, last_gateway_id
        ) VALUES ($1, $2, $2, $3)
        ON CONFLICT (node_id) DO UPDATE SET
          last_seen_at = EXCLUDED.last_seen_at,
          last_gateway_id = EXCLUDED.last_gateway_id
      `,
      [nodeId, serverReceivedAt, gatewayId],
    );
  }
}
