export const NODE_PROTOCOL_V2 = 2;
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

export interface DecodedNodeTelemetryV2 {
  readonly protocolVersion: 2;
  readonly nodeId: string;
  readonly persistentSessionId: number;
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
  readonly bootReason: number;
  readonly rtcState: number;
  readonly rtcUnixTime: number | null;
  readonly pollIntervalMinutes: number;
  readonly scheduleState: number;
  readonly scheduledMaintenanceUnix: number | null;
  readonly lastCommandId: number | null;
  readonly lastCommandType: number;
  readonly lastCommandResult: number;
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
      | 'INVALID_FILTER_STATE'
      | 'INVALID_ENUM'
      | 'INVALID_FLAGS',
    message: string,
  ) {
    super(message);
    this.name = 'NodeProtocolDecodeError';
  }
}

export function decodeNodeTelemetryV2Base64(
  encoded: string,
): DecodedNodeTelemetryV2 {
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
  return decodeNodeTelemetryV2(rawPayload);
}

export function decodeNodeTelemetryV2(
  rawPayload: Buffer,
): DecodedNodeTelemetryV2 {
  if (rawPayload.length > NODE_MAX_RADIO_PACKET_BYTES) {
    throw new NodeProtocolDecodeError(
      'PACKET_TOO_LARGE',
      `decoded payload exceeds ${NODE_MAX_RADIO_PACKET_BYTES} bytes`,
    );
  }
  if (rawPayload.length < 59) {
    throw new NodeProtocolDecodeError(
      'TRUNCATED',
      'telemetry packet is shorter than the Protocol v2 minimum',
    );
  }
  if (rawPayload[0] !== 0x47 || rawPayload[1] !== 0x54) {
    throw new NodeProtocolDecodeError('BAD_MAGIC', 'packet magic is not GT');
  }
  if (rawPayload[2] !== NODE_PROTOCOL_V2) {
    throw new NodeProtocolDecodeError(
      'UNSUPPORTED_VERSION',
      'packet version is not Protocol v2',
    );
  }
  if (rawPayload[3] !== NODE_TELEMETRY_TYPE) {
    throw new NodeProtocolDecodeError(
      'WRONG_TYPE',
      'ingestion accepts TELEMETRY packets only',
    );
  }
  const nodeIdLength = rawPayload[4];
  if (nodeIdLength < 1 || nodeIdLength > NODE_MAX_ID_LENGTH) {
    throw new NodeProtocolDecodeError(
      'INVALID_NODE_ID',
      'Node ID length must be from 1 to 24 bytes',
    );
  }
  const expectedLength = 58 + nodeIdLength;
  if (rawPayload.length < expectedLength) {
    throw new NodeProtocolDecodeError(
      'TRUNCATED',
      'telemetry packet ended before all Protocol v2 fields were present',
    );
  }
  if (rawPayload.length > expectedLength) {
    throw new NodeProtocolDecodeError(
      'TRAILING_DATA',
      'telemetry packet contains trailing bytes',
    );
  }
  const nodeIdBytes = rawPayload.subarray(5, 5 + nodeIdLength);
  if (
    ![...nodeIdBytes].every(
      (value) =>
        (value >= 0x41 && value <= 0x5a) ||
        (value >= 0x61 && value <= 0x7a) ||
        (value >= 0x30 && value <= 0x39) ||
        value === 0x5f ||
        value === 0x2d,
    )
  ) {
    throw new NodeProtocolDecodeError(
      'INVALID_NODE_ID',
      'Node ID contains characters outside the Protocol v2 alphabet',
    );
  }

  const nodeId = nodeIdBytes.toString('ascii');
  const offset = 5 + nodeIdLength;
  const filterState = rawPayload[offset + 30];
  if (filterState >= FILTER_STATE_NAMES.length) {
    throw new NodeProtocolDecodeError(
      'INVALID_FILTER_STATE',
      'filter state code is outside the Protocol v2 range',
    );
  }
  const bootReason = rawPayload[offset + 35];
  const rtcState = rawPayload[offset + 36];
  const scheduleState = rawPayload[offset + 42];
  const lastCommandType = rawPayload[offset + 51];
  const lastCommandResult = rawPayload[offset + 52];
  if (
    bootReason > 5 ||
    rtcState > 3 ||
    scheduleState > 3 ||
    lastCommandType > 3 ||
    (lastCommandResult > 7 && lastCommandResult !== 0xff)
  ) {
    throw new NodeProtocolDecodeError(
      'INVALID_ENUM',
      'Protocol v2 diagnostic enum is outside its documented range',
    );
  }
  const rtcUnix = rawPayload.readUInt32BE(offset + 37);
  const pollIntervalMinutes = rawPayload[offset + 41];
  const scheduledMaintenanceUnix = rawPayload.readUInt32BE(offset + 43);
  const lastCommandId = rawPayload.readUInt32BE(offset + 47);
  if (
    pollIntervalMinutes === 0 ||
    (rtcState !== 0 && rtcUnix !== 0) ||
    (scheduleState === 0 && scheduledMaintenanceUnix !== 0) ||
    (lastCommandType === 0 && lastCommandId !== 0)
  ) {
    throw new NodeProtocolDecodeError(
      'INVALID_FLAGS',
      'Protocol v2 validity/state fields are inconsistent',
    );
  }

  const rawDistance = rawPayload.readUInt32BE(offset + 12);
  const acceptedDistance = rawPayload.readUInt32BE(offset + 16);
  const temperature = rawPayload.readInt16BE(offset + 22);
  const humidity = rawPayload.readUInt16BE(offset + 24);
  return {
    protocolVersion: 2,
    nodeId,
    persistentSessionId: rawPayload.readUInt32BE(offset),
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
    bootReason,
    rtcState,
    rtcUnixTime: rtcState === 0 ? rtcUnix : null,
    pollIntervalMinutes,
    scheduleState,
    scheduledMaintenanceUnix:
      scheduledMaintenanceUnix === 0 ? null : scheduledMaintenanceUnix,
    lastCommandId: lastCommandId === 0 ? null : lastCommandId,
    lastCommandType,
    lastCommandResult,
    rawPayload: Buffer.from(rawPayload),
  };
}
