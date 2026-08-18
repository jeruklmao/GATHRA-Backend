import { BadRequestException, Injectable } from '@nestjs/common';
import { readConfiguration } from '../../configuration';
import type { IngestTelemetryBatchDto } from '../dto/ingest-telemetry.dto';
import type {
  IngestionBatchResponse,
  IngestionRecordResult,
  ValidatedIngestReading,
} from '../models/ingestion.models';
import {
  decodeNodeTelemetryV1Base64,
  NodeProtocolDecodeError,
} from '../protocol/node-protocol-v1';
import { IotIngestionRepository } from '../repositories/iot-ingestion.repository';

@Injectable()
export class TelemetryIngestionService {
  private readonly maximumBatchSize = readConfiguration().iotMaxBatchSize;

  constructor(private readonly repository: IotIngestionRepository) {}

  async ingest(
    request: IngestTelemetryBatchDto,
  ): Promise<IngestionBatchResponse> {
    if (request.readings.length > this.maximumBatchSize) {
      throw new BadRequestException(
        `readings exceeds configured maximum of ${this.maximumBatchSize}`,
      );
    }
    const serverReceivedAt = new Date();
    const valid: ValidatedIngestReading[] = [];
    const results = new Map<number, IngestionRecordResult>();
    request.readings.forEach((reading, index) => {
      try {
        if (
          reading.gatewayTimeTrusted !==
          (reading.gatewayReceivedAt !== null)
        ) {
          throw new NodeProtocolDecodeError(
            'TRUNCATED',
            'gatewayTimeTrusted must exactly match timestamp availability',
          );
        }
        const decoded = decodeNodeTelemetryV1Base64(
          reading.rawPayloadBase64,
        );
        if (reading.packetLength !== decoded.rawPayload.length) {
          throw new NodeProtocolDecodeError(
            'TRAILING_DATA',
            'packetLength does not match decoded raw payload length',
          );
        }
        valid.push({ index, decoded, reception: reading });
      } catch (error) {
        const reason =
          error instanceof NodeProtocolDecodeError
            ? `${error.code}: ${error.message}`
            : 'INVALID_PACKET: raw telemetry validation failed';
        results.set(index, {
          index,
          status: 'REJECTED_INVALID',
          reason,
        });
      }
    });

    const persistence = await this.repository.persistBatch(
      {
        ...request.gateway,
        hardwareMac: request.gateway.hardwareMac.toUpperCase(),
      },
      valid,
      serverReceivedAt,
    );
    const validByIndex = new Map(valid.map((reading) => [reading.index, reading]));
    for (const persisted of persistence) {
      const reading = validByIndex.get(persisted.index);
      if (reading === undefined) {
        throw new Error('Persistence returned an unknown batch index');
      }
      results.set(persisted.index, {
        index: persisted.index,
        nodeId: reading.decoded.nodeId,
        bootSessionId: reading.decoded.bootSessionId,
        sequence: reading.decoded.sequence,
        status: persisted.inserted ? 'INSERTED' : 'DUPLICATE',
      });
    }
    return {
      receivedAt: serverReceivedAt.toISOString(),
      results: request.readings.map((_reading, index) => {
        const result = results.get(index);
        if (result === undefined) {
          throw new Error('Batch result was not produced for every reading');
        }
        return result;
      }),
    };
  }
}
