import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../../database/database.service';
import {
  SENSOR_NOW_FN,
  type SensorNowFn,
  SensorDeploymentService,
} from '../../flood/sensors/sensor-deployment.service';
import { gatewayFreshness } from '../models/gateway-heartbeat.models';

interface SensorPublicTelemetryRow extends QueryResultRow {
  temperature_centi_c: number | null;
  humidity_centi_percent: number | null;
  rssi_dbm: number;
  snr_db: number;
  gateway_id: string;
  last_heartbeat_at: Date | null;
  heartbeat_interval_seconds: number | null;
  backend_connectivity_state: 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'OFFLINE' | null;
}

@Injectable()
export class PublicSensorService {
  constructor(
    private readonly database: DatabaseService,
    private readonly deployments: SensorDeploymentService,
    @Inject(SENSOR_NOW_FN) private readonly nowFn: SensorNowFn,
  ) {}

  async current(nodeId: string, now = this.nowFn()) {
    if (!/^[A-Za-z0-9_-]{1,24}$/.test(nodeId)) {
      throw new NotFoundException('Sensor was not found');
    }
    const state = await this.deployments.getEffective(nodeId, now);
    if (state === null || !state.deployment.enabled) {
      throw new NotFoundException('Sensor was not found');
    }
    const telemetry =
      state.telemetryId === null
        ? null
        : (
            await this.database.query<SensorPublicTelemetryRow>(
              `SELECT t.temperature_centi_c, t.humidity_centi_percent,
                      t.rssi_dbm, t.snr_db, g.logical_gateway_id AS gateway_id,
                      s.last_heartbeat_at, s.heartbeat_interval_seconds,
                      s.backend_connectivity_state
                 FROM iot_telemetry t
                 JOIN iot_gateways g ON g.id = t.gateway_id
                 LEFT JOIN iot_gateway_status s ON s.gateway_id = g.id
                WHERE t.id = $1 AND t.node_id = $2`,
              [state.telemetryId, nodeId],
            )
          ).rows[0] ?? null;

    const heartbeat = gatewayFreshness(
      telemetry?.last_heartbeat_at ?? null,
      telemetry?.heartbeat_interval_seconds ?? null,
      now,
    );
    return {
      nodeId: state.deployment.nodeId,
      position: {
        latitude: state.deployment.latitude,
        longitude: state.deployment.longitude,
      },
      flood: {
        waterHeightMm: state.waterHeightMm,
        effectiveLevel: state.effectiveLevel,
        freshness: state.freshness,
        observedAt: state.observedAt?.toISOString() ?? null,
      },
      measurement: {
        acceptedDistanceMm: state.acceptedDistanceMm,
        temperatureC:
          telemetry?.temperature_centi_c == null
            ? null
            : telemetry.temperature_centi_c / 100,
        humidityPercent:
          telemetry?.humidity_centi_percent == null
            ? null
            : telemetry.humidity_centi_percent / 100,
      },
      gateway:
        telemetry === null
          ? null
          : {
              status:
                heartbeat.state === 'HEARTBEAT_UNAVAILABLE'
                  ? 'UNAVAILABLE'
                  : heartbeat.state,
              lastHeartbeatAt:
                telemetry.last_heartbeat_at?.toISOString() ?? null,
              radioReceptionStatus:
                state.freshness === 'FRESH'
                  ? 'RECENT'
                  : state.freshness === 'STALE'
                    ? 'STALE'
                    : 'UNAVAILABLE',
              latestRssiDbm: telemetry.rssi_dbm,
              latestSnrDb: telemetry.snr_db,
              backendDeliveryStatus: deliveryStatus(
                telemetry.backend_connectivity_state,
              ),
            },
    };
  }
}

function deliveryStatus(
  value: SensorPublicTelemetryRow['backend_connectivity_state'],
): 'NORMAL' | 'DEGRADED' | 'UNAVAILABLE' {
  if (value === 'HEALTHY') return 'NORMAL';
  if (value === 'DEGRADED' || value === 'OFFLINE') return 'DEGRADED';
  return 'UNAVAILABLE';
}
