import type { GatewayTelemetryReadingDto } from '../dto/ingest-telemetry.dto';
import type { DecodedNodeTelemetryV2 } from '../protocol/node-protocol-v2';

export interface ValidatedIngestReading {
  readonly index: number;
  readonly decoded: DecodedNodeTelemetryV2;
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
