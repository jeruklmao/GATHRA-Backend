import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { GatewayHeartbeatDto } from './gateway-heartbeat.dto';

export function heartbeatFixture() {
  return {
    schemaVersion: 1,
    heartbeatIntervalSeconds: 60,
    gateway: { gatewayId: 'GTH-GW-AABBCCDDEEFF', mac: 'AA:BB:CC:DD:EE:FF', firmwareVersion: '2.2.0', protocolVersion: 3, buildFlavor: 'production' },
    runtime: { uptimeSeconds: 12345, resetReason: 'POWER_ON', bootCount: 12, freeHeapBytes: 123456, minFreeHeapBytes: 100000, largestFreeHeapBlockBytes: 80000, sketchSizeBytes: 1200000, freeSketchSpaceBytes: 200000, flashSizeBytes: 4194304 },
    network: { wifiConnected: true, ssid: 'Lab "A"', wifiRssiDbm: -55, localIp: '192.168.1.20', backendConnectivityState: 'HEALTHY', lastBackendSuccessAt: '2026-08-24T22:13:20.000Z', lastBackendErrorAt: null, consecutiveBackendFailures: 0 },
    time: { timeValid: true, currentUtc: '2026-08-24T22:15:23.000Z', lastNtpSyncAt: '2026-08-24T22:13:20.000Z', ntpAgeSeconds: 123 },
    lora: { pairedNodeId: 'N1', lastLoRaRxAt: '2026-08-24T22:15:00.000Z', latestRssiDbm: -45.5, latestSnrDb: 10.25, latestFrequencyErrorHz: 1050, receivedPacketCount: 20, validTelemetryCount: 18, invalidPacketCount: 2, crcErrorCount: 1, protocolRejectedPacketCount: 1, unpairedRejectedPacketCount: 0 },
    ack: { ackCount: 3, ackSuccessCount: 2, ackFailureCount: 1, latencySampleCount: 2, latestRxToAckStartMs: 30.2, latestRxToAckCompleteMs: 642.1, latestAckTxDurationMs: 611.9, minRxToAckStartMs: 30, maxRxToAckStartMs: 40, avgRxToAckStartMs: 35, minRxToAckCompleteMs: 640, maxRxToAckCompleteMs: 660, avgRxToAckCompleteMs: 650, minAckTxDurationMs: 610, maxAckTxDurationMs: 620, avgAckTxDurationMs: 615 },
    queue: { depth: 3, capacity: 128, oldestRecordAgeSeconds: 90, telemetryUploadSuccessCount: 7, telemetryUploadFailureCount: 2 },
    commands: { pendingCommandId: 44, pendingCommandType: 'SET_POLL_INTERVAL_MINUTES', pendingCommandState: 'SENT', lastCommandId: 44, lastCommandResult: 'NONE', commandsSentCount: 5, commandResultsReceivedCount: 4 },
  };
}

function errors(value: unknown) {
  return validateSync(plainToInstance(GatewayHeartbeatDto, value), { whitelist: true, forbidNonWhitelisted: true });
}

describe('GatewayHeartbeatDto Firmware 2.2 contract', () => {
  it('accepts the exact populated firmware fixture', () => expect(errors(heartbeatFixture())).toEqual([]));

  it('accepts disconnected, unsynchronized, unpaired, empty ACK and queue nulls', () => {
    const value = heartbeatFixture();
    Object.assign(value.network, { wifiConnected: false, wifiRssiDbm: null, localIp: null });
    Object.assign(value.time, { timeValid: false, currentUtc: null, lastNtpSyncAt: null, ntpAgeSeconds: null });
    Object.assign(value.lora, { pairedNodeId: null, lastLoRaRxAt: null, latestRssiDbm: null, latestSnrDb: null, latestFrequencyErrorHz: null });
    for (const key of Object.keys(value.ack)) if (key.toLowerCase().includes('ms')) (value.ack as Record<string, unknown>)[key] = null;
    Object.assign(value.ack, { ackCount: 0, ackSuccessCount: 0, ackFailureCount: 0, latencySampleCount: 0 });
    Object.assign(value.queue, { depth: 0, oldestRecordAgeSeconds: null });
    Object.assign(value.commands, { pendingCommandId: null, pendingCommandType: null, pendingCommandState: null, lastCommandId: null, lastCommandResult: null });
    expect(errors(value)).toEqual([]);
  });

  it.each([
    ['schemaVersion', 2],
    ['heartbeatIntervalSeconds', 14],
  ])('rejects invalid %s', (field, value) => {
    expect(errors({ ...heartbeatFixture(), [field]: value })).not.toEqual([]);
  });

  it.each([
    ['gateway', 'mac', 'not-a-mac'],
    ['gateway', 'protocolVersion', 2],
    ['runtime', 'uptimeSeconds', -1],
    ['runtime', 'freeHeapBytes', -1],
    ['network', 'localIp', '999.1.1.1'],
    ['lora', 'latestRssiDbm', Number.NaN],
    ['queue', 'depth', -1],
    ['ack', 'ackCount', -1],
  ])('rejects invalid %s.%s', (group, field, value) => {
    const fixture = heartbeatFixture() as unknown as Record<string, Record<string, unknown>>;
    fixture[group][field] = value;
    expect(errors(fixture)).not.toEqual([]);
  });

  it('rejects unknown and missing fields', () => {
    const unknown = { ...heartbeatFixture(), surprise: true };
    const missing = heartbeatFixture() as Record<string, unknown>;
    delete missing.runtime;
    expect(errors(unknown)).not.toEqual([]);
    expect(errors(missing)).not.toEqual([]);
  });
});
