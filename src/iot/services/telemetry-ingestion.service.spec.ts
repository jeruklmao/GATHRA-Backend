import { Logger } from '@nestjs/common';
import type { IngestTelemetryBatchDto } from '../dto/ingest-telemetry.dto';
import type { IotIngestionRepository } from '../repositories/iot-ingestion.repository';
import type { SensorDeploymentService } from '../../flood/sensors/sensor-deployment.service';
import { TelemetryIngestionService } from './telemetry-ingestion.service';

describe('TelemetryIngestionService derived-state isolation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns INSERTED after raw commit even when derived recomputation fails', async () => {
    const repository = {
      persistBatch: jest.fn().mockResolvedValue([
        {
          index: 0,
          inserted: true,
          telemetryId: 42,
          nodeId: 'N1',
        },
      ]),
    } as unknown as IotIngestionRepository;
    const sensorDeployments = {
      recomputeNode: jest.fn().mockRejectedValue(new Error('classifier failed')),
    } as unknown as SensorDeploymentService;
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const service = new TelemetryIngestionService(
      repository,
      sensorDeployments,
    );

    const response = await service.ingest(batch());

    expect(response.results).toEqual([
      {
        index: 0,
        nodeId: 'N1',
        bootSessionId: 0x0102_0304,
        sequence: 0xa0b0_c0d0,
        status: 'INSERTED',
      },
    ]);
    expect(repository.persistBatch).toHaveBeenCalledTimes(1);
    expect(sensorDeployments.recomputeNode).toHaveBeenCalledWith('N1');
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'sensor_state_recompute_failed',
        nodeId: 'N1',
      }),
    );
  });
});

function batch(): IngestTelemetryBatchDto {
  const packet = Buffer.from([
    0x47, 0x54, 0x03, 0x01, 0x02, 0x4e, 0x31,
    0x01, 0x02, 0x03, 0x04, 0xa0, 0xb0, 0xc0, 0xd0,
    0x00, 0x00, 0x12, 0x34, 0x00, 0x00, 0x02, 0xe4,
    0x00, 0x00, 0x02, 0xe3, 0x00, 0x03, 0xfb, 0x2e,
    0x11, 0xd7, 0x0e, 0x74, 0x07, 0x07, 0x00, 0x00,
    0x03, 0x02, 0x02, 0x00, 0x00, 0x69, 0xab, 0xcd,
    0xef, 0x0a, 0x01, 0x69, 0xab, 0xf0, 0x00, 0x01,
    0x02, 0x03, 0x05, 0x03, 0x00, 0x00, 0x00, 0x05,
    0xdc,
  ]);
  return {
    schemaVersion: 1,
    gateway: {
      gatewayId: 'GTH-GW-AABBCCDDEEFF',
      hardwareMac: 'AA:BB:CC:DD:EE:FF',
      firmwareVersion: '3.0.0',
      bootSessionId: 1,
    },
    readings: [
      {
        gatewayReceivedAt: '2026-08-26T12:00:00.000Z',
        gatewayTimeTrusted: true,
        gatewayUptimeMs: 1,
        gatewayBootSessionId: 1,
        rssiDbm: -50,
        snrDb: 10,
        frequencyErrorHz: 0,
        packetLength: packet.length,
        rawPayloadBase64: packet.toString('base64'),
      },
    ],
  };
}
