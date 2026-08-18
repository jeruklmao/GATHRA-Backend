export const NODE_PROTOCOL_V1 = 1;
export const NODE_TELEMETRY_TYPE = 1;
export const NODE_MAX_RADIO_PACKET_BYTES = 96;
export const NODE_MAX_ID_LENGTH = 24;
export const UINT32_MAX = 0xffff_ffff;
export const INT16_MIN = -0x8000;
export const UINT16_MAX = 0xffff;

export const FILTER_STATE_NAMES = [
  'STABLE',
  'ACCEPTED',
  'VERIFY_RISE',
  'VERIFY_FALL',
  'TRANSIENT_REJECTED',
  'CHANGE_CONFIRMED',
  'UNCERTAIN',
  'INVALID',
] as const;

export type FilterStateName = (typeof FILTER_STATE_NAMES)[number];

export interface DecodedNodeTelemetryV1 {
  readonly protocolVersion: 1;
  readonly nodeId: string;
  readonly bootSessionId: number;
  readonly sequence: number;
  readonly medianEchoUs: number;
  readonly rawDistanceMm: number | null;
  readonly acceptedDistanceMm: number | null;
  readonly madMm: number;
  readonly temperatureCentiC: number | null;
  readonly humidityCentiPercent: number | null;
  readonly batteryMv: number;
  readonly validSamples: number;
  readonly totalSamples: number;
  readonly filterState: number;
  readonly qualityFlags: number;
  readonly healthFlags: number;
  readonly rawPayload: Buffer;
}

export class NodeProtocolDecodeError extends Error {
  constructor(
    readonly code:
      | 'INVALID_BASE64'
      | 'PACKET_TOO_LARGE'
      | 'TRUNCATED'
      | 'BAD_MAGIC'
      | 'UNSUPPORTED_VERSION'
      | 'WRONG_TYPE'
      | 'INVALID_NODE_ID'
      | 'TRAILING_DATA'
      | 'INVALID_FILTER_STATE',
    message: string,
  ) {
    super(message);
    this.name = 'NodeProtocolDecodeError';
  }
}

export function decodeNodeTelemetryV1Base64(
  encoded: string,
): DecodedNodeTelemetryV1 {
  if (
    encoded.length === 0 ||
    encoded.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  ) {
    throw new NodeProtocolDecodeError(
      'INVALID_BASE64',
      'rawPayloadBase64 is not canonical Base64',
    );
  }
  const rawPayload = Buffer.from(encoded, 'base64');
  if (rawPayload.toString('base64') !== encoded) {
    throw new NodeProtocolDecodeError(
      'INVALID_BASE64',
      'rawPayloadBase64 is not canonical Base64',
    );
  }
  return decodeNodeTelemetryV1(rawPayload);
}

export function decodeNodeTelemetryV1(
  rawPayload: Buffer,
): DecodedNodeTelemetryV1 {
  if (rawPayload.length > NODE_MAX_RADIO_PACKET_BYTES) {
    throw new NodeProtocolDecodeError(
      'PACKET_TOO_LARGE',
      `decoded payload exceeds ${NODE_MAX_RADIO_PACKET_BYTES} bytes`,
    );
  }
  if (rawPayload.length < 41) {
    throw new NodeProtocolDecodeError(
      'TRUNCATED',
      'telemetry packet is shorter than the Protocol v1 minimum',
    );
  }
  if (rawPayload[0] !== 0x47 || rawPayload[1] !== 0x54) {
    throw new NodeProtocolDecodeError('BAD_MAGIC', 'packet magic is not GT');
  }
  if (rawPayload[2] !== NODE_PROTOCOL_V1) {
    throw new NodeProtocolDecodeError(
      'UNSUPPORTED_VERSION',
      'packet version is not Protocol v1',
    );
  }
  if (rawPayload[3] !== NODE_TELEMETRY_TYPE) {
    throw new NodeProtocolDecodeError(
      'WRONG_TYPE',
      'ingestion accepts telemetry packets only',
    );
  }
  const nodeIdLength = rawPayload[4];
  if (nodeIdLength < 1 || nodeIdLength > NODE_MAX_ID_LENGTH) {
    throw new NodeProtocolDecodeError(
      'INVALID_NODE_ID',
      'Node ID length must be from 1 to 24 bytes',
    );
  }
  const expectedLength = 40 + nodeIdLength;
  if (rawPayload.length < expectedLength) {
    throw new NodeProtocolDecodeError(
      'TRUNCATED',
      'telemetry packet ended before all fields were present',
    );
  }
  if (rawPayload.length > expectedLength) {
    throw new NodeProtocolDecodeError(
      'TRAILING_DATA',
      'telemetry packet contains trailing bytes',
    );
  }
  const nodeIdBytes = rawPayload.subarray(5, 5 + nodeIdLength);
  const nodeIdBytesValid = [...nodeIdBytes].every(
    (value) =>
      (value >= 0x41 && value <= 0x5a) ||
      (value >= 0x61 && value <= 0x7a) ||
      (value >= 0x30 && value <= 0x39) ||
      value === 0x5f ||
      value === 0x2d,
  );
  if (!nodeIdBytesValid) {
    throw new NodeProtocolDecodeError(
      'INVALID_NODE_ID',
      'Node ID contains characters outside the Protocol v1 alphabet',
    );
  }
  const nodeId = nodeIdBytes.toString('ascii');
  const offset = 5 + nodeIdLength;
  const filterState = rawPayload[offset + 30];
  if (filterState >= FILTER_STATE_NAMES.length) {
    throw new NodeProtocolDecodeError(
      'INVALID_FILTER_STATE',
      'filter state code is outside the Protocol v1 range',
    );
  }
  const rawDistance = rawPayload.readUInt32BE(offset + 12);
  const acceptedDistance = rawPayload.readUInt32BE(offset + 16);
  const temperature = rawPayload.readInt16BE(offset + 22);
  const humidity = rawPayload.readUInt16BE(offset + 24);
  return {
    protocolVersion: 1,
    nodeId,
    bootSessionId: rawPayload.readUInt32BE(offset),
    sequence: rawPayload.readUInt32BE(offset + 4),
    medianEchoUs: rawPayload.readUInt32BE(offset + 8),
    rawDistanceMm: rawDistance === UINT32_MAX ? null : rawDistance,
    acceptedDistanceMm:
      acceptedDistance === UINT32_MAX ? null : acceptedDistance,
    madMm: rawPayload.readUInt16BE(offset + 20),
    temperatureCentiC: temperature === INT16_MIN ? null : temperature,
    humidityCentiPercent: humidity === UINT16_MAX ? null : humidity,
    batteryMv: rawPayload.readUInt16BE(offset + 26),
    validSamples: rawPayload[offset + 28],
    totalSamples: rawPayload[offset + 29],
    filterState,
    qualityFlags: rawPayload.readUInt16BE(offset + 31),
    healthFlags: rawPayload.readUInt16BE(offset + 33),
    rawPayload: Buffer.from(rawPayload),
  };
}
