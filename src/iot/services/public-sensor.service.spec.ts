import { NotFoundException } from '@nestjs/common';
import type { DatabaseService } from '../../database/database.service';
import type { SensorDeploymentService } from '../../flood/sensors/sensor-deployment.service';
import { PublicSensorService } from './public-sensor.service';

describe('PublicSensorService', () => {
  const now = new Date('2026-08-29T00:10:00.000Z');
  const query = jest.fn();
  const getEffective = jest.fn();
  const service = new PublicSensorService(
    { query } as unknown as DatabaseService,
    { getEffective } as unknown as SensorDeploymentService,
    () => now,
  );

  beforeEach(() => {
    query.mockReset();
    getEffective.mockReset();
    getEffective.mockResolvedValue(state());
    query.mockResolvedValue({ rows: [telemetry()] });
  });

  it('returns only the sanitized authoritative current contract', async () => {
    const result = await service.current('GTH-10003BD4BCFC', now);
    expect(result).toEqual({
      nodeId: 'GTH-10003BD4BCFC',
      position: { latitude: -6.235149, longitude: 106.720401 },
      flood: {
        waterHeightMm: 125,
        effectiveLevel: 'MEDIUM',
        freshness: 'FRESH',
        observedAt: '2026-08-29T00:05:00.000Z',
      },
      measurement: {
        acceptedDistanceMm: 1600,
        temperatureC: 31.2,
        humidityPercent: 72.4,
      },
      gateway: {
        status: 'ONLINE',
        lastHeartbeatAt: '2026-08-29T00:09:30.000Z',
        radioReceptionStatus: 'RECENT',
        latestRssiDbm: -120,
        latestSnrDb: -7.5,
        backendDeliveryStatus: 'NORMAL',
      },
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      'ssid', 'localIp', 'hardwareMac', 'heap', 'flash', 'token', 'command',
      'rawDistance', 'battery', 'qualityFlags', 'healthFlags', 'rawPayload',
    ]) expect(serialized).not.toContain(forbidden);
  });

  it('marks radio reception stale independently of RSSI magnitude', async () => {
    getEffective.mockResolvedValue(state({ freshness: 'STALE', effectiveLevel: 'UNKNOWN' }));
    query.mockResolvedValue({ rows: [telemetry({ rssi_dbm: -20 })] });
    const result = await service.current('GTH-10003BD4BCFC', now);
    expect(result.gateway).toMatchObject({
      radioReceptionStatus: 'STALE',
      latestRssiDbm: -20,
    });
  });

  it('returns nullable measurements and Gateway safely without telemetry', async () => {
    getEffective.mockResolvedValue(state({
      telemetryId: null,
      waterHeightMm: null,
      acceptedDistanceMm: null,
      observedAt: null,
      freshness: 'NO_TELEMETRY',
      effectiveLevel: 'UNKNOWN',
    }));
    const result = await service.current('GTH-10003BD4BCFC', now);
    expect(result.measurement).toEqual({
      acceptedDistanceMm: null,
      temperatureC: null,
      humidityPercent: null,
    });
    expect(result.gateway).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('derives stale/offline heartbeat and sanitizes delivery failures', async () => {
    query.mockResolvedValue({ rows: [telemetry({
      last_heartbeat_at: new Date('2026-08-29T00:00:00.000Z'),
      backend_connectivity_state: 'OFFLINE',
    })] });
    const result = await service.current('GTH-10003BD4BCFC', now);
    expect(result.gateway).toMatchObject({
      status: 'OFFLINE',
      backendDeliveryStatus: 'DEGRADED',
    });
  });

  it('reports heartbeat support unavailable without claiming offline', async () => {
    query.mockResolvedValue({ rows: [telemetry({
      last_heartbeat_at: null,
      heartbeat_interval_seconds: null,
      backend_connectivity_state: null,
    })] });
    const result = await service.current('GTH-10003BD4BCFC', now);
    expect(result.gateway).toMatchObject({
      status: 'UNAVAILABLE',
      lastHeartbeatAt: null,
      backendDeliveryStatus: 'UNAVAILABLE',
    });
  });

  it('does not publish absent or disabled deployments', async () => {
    getEffective.mockResolvedValue(null);
    await expect(service.current('missing', now)).rejects.toBeInstanceOf(NotFoundException);
  });
});

function state(overrides: Record<string, unknown> = {}) {
  return {
    deployment: {
      nodeId: 'GTH-10003BD4BCFC', enabled: true,
      latitude: -6.235149, longitude: 106.720401,
    },
    telemetryId: 42,
    waterHeightMm: 125,
    acceptedDistanceMm: 1600,
    effectiveLevel: 'MEDIUM',
    freshness: 'FRESH',
    observedAt: new Date('2026-08-29T00:05:00.000Z'),
    ...overrides,
  };
}

function telemetry(overrides: Record<string, unknown> = {}) {
  return {
    temperature_centi_c: 3120,
    humidity_centi_percent: 7240,
    rssi_dbm: -120,
    snr_db: -7.5,
    gateway_id: 'gateway-1',
    last_heartbeat_at: new Date('2026-08-29T00:09:30.000Z'),
    heartbeat_interval_seconds: 60,
    backend_connectivity_state: 'HEALTHY',
    ...overrides,
  };
}
