import type { GatewayTelemetryReadingDto } from '../dto/ingest-telemetry.dto';
import type { DecodedNodeTelemetryV1 } from '../protocol/node-protocol-v1';

export interface ValidatedIngestReading {
  readonly index: number;
  readonly decoded: DecodedNodeTelemetryV1;
  readonly reception: GatewayTelemetryReadingDto;
}

export type IngestionRecordStatus =
  | 'INSERTED'
  | 'DUPLICATE'
  | 'REJECTED_INVALID';

export interface IngestionRecordResult {
  readonly index: number;
  readonly nodeId?: string;
  readonly bootSessionId?: number;
  readonly sequence?: number;
  readonly status: IngestionRecordStatus;
  readonly reason?: string;
}

export interface IngestionBatchResponse {
  readonly receivedAt: string;
  readonly results: IngestionRecordResult[];
}
