import {
  decodeNodeTelemetryV3,
  decodeNodeTelemetryV3Base64,
  INT16_MIN,
  NODE_REFERENCE_DISTANCE_PAYLOAD_OFFSET,
  NODE_TELEMETRY_FIXED_BYTES,
  NODE_TELEMETRY_PAYLOAD_BYTES,
  NodeProtocolDecodeError,
  UINT16_MAX,
  UINT32_MAX,
} from './node-protocol-v3';

// Copied byte-for-byte from GATHRA-Node/test/test_main.cpp.
const NODE_GOLDEN = Buffer.from([
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

describe('Node Protocol v3 telemetry decoder', () => {
  it('decodes the exact GATHRA-Node golden telemetry vector', () => {
    const decoded = decodeNodeTelemetryV3(NODE_GOLDEN);
    expect(decoded).toMatchObject({
      protocolVersion: 3,
      nodeId: 'N1',
      persistentSessionId: 0x0102_0304,
      sequence: 0xa0b0_c0d0,
      medianEchoUs: 0x1234,
      rawDistanceMm: 740,
      acceptedDistanceMm: 739,
      referenceDistanceMm: 1500,
      madMm: 3,
      temperatureCentiC: -1234,
      humidityCentiPercent: 4567,
      batteryMv: 3700,
      validSamples: 7,
      totalSamples: 7,
      filterState: 0,
      qualityFlags: 3,
      healthFlags: 0x0202,
      bootReason: 0,
      rtcState: 0,
      rtcUnixTime: 0x69ab_cdef,
      pollIntervalMinutes: 10,
      scheduleState: 1,
      scheduledMaintenanceUnix: 0x69ab_f000,
      lastCommandId: 0x0102_0305,
      lastCommandType: 3,
      lastCommandResult: 0,
    });
    expect(NODE_REFERENCE_DISTANCE_PAYLOAD_OFFSET).toBe(53);
    expect(NODE_TELEMETRY_PAYLOAD_BYTES).toBe(57);
    expect(NODE_GOLDEN).toHaveLength(NODE_TELEMETRY_FIXED_BYTES + 2);
    expect(NODE_GOLDEN.subarray(-4)).toEqual(
      Buffer.from([0x00, 0x00, 0x05, 0xdc]),
    );
    expect(decoded.rawPayload).toEqual(NODE_GOLDEN);
  });

  it.each(['A', 'Z'.repeat(24)])('accepts boundary Node ID %s', (nodeId) => {
    const decoded = decodeNodeTelemetryV3(
      manualPacket({ nodeId, persistentSessionId: UINT32_MAX }),
    );
    expect(decoded.nodeId).toBe(nodeId);
    expect(decoded.persistentSessionId).toBe(UINT32_MAX);
  });

  it('normalizes sensor and invalid-RTC sentinels to null', () => {
    const decoded = decodeNodeTelemetryV3(
      manualPacket({
        rawDistanceMm: UINT32_MAX,
        acceptedDistanceMm: UINT32_MAX,
        temperatureCentiC: INT16_MIN,
        humidityCentiPercent: UINT16_MAX,
        rtcState: 1,
        rtcUnixTime: 0,
        referenceDistanceMm: 0,
      }),
    );
    expect(decoded.rawDistanceMm).toBeNull();
    expect(decoded.acceptedDistanceMm).toBeNull();
    expect(decoded.temperatureCentiC).toBeNull();
    expect(decoded.humidityCentiPercent).toBeNull();
    expect(decoded.rtcUnixTime).toBeNull();
    expect(decoded.referenceDistanceMm).toBeNull();
  });

  it('preserves unsigned big-endian values above INT32_MAX', () => {
    const decoded = decodeNodeTelemetryV3(
      manualPacket({
        persistentSessionId: 0xffff_fffe,
        sequence: 0x8000_0001,
        medianEchoUs: 0xf000_0001,
        rawDistanceMm: 0xefff_ffff,
        referenceDistanceMm: UINT32_MAX,
      }),
    );
    expect(decoded.persistentSessionId).toBe(4_294_967_294);
    expect(decoded.sequence).toBe(2_147_483_649);
    expect(decoded.medianEchoUs).toBe(4_026_531_841);
    expect(decoded.rawDistanceMm).toBe(4_026_531_839);
    expect(decoded.referenceDistanceMm).toBe(UINT32_MAX);
  });

  it('rejects v1/v2, wrong type, malformed length, invalid IDs, enums, and state flags', () => {
    expectCode(withByte(NODE_GOLDEN, 0, 0), 'BAD_MAGIC');
    expectCode(withByte(NODE_GOLDEN, 2, 1), 'UNSUPPORTED_VERSION');
    const protocol2 = Buffer.from(NODE_GOLDEN.subarray(0, -4));
    protocol2[2] = 2;
    expectCode(protocol2, 'UNSUPPORTED_VERSION');
    expectCode(withByte(NODE_GOLDEN, 3, 2), 'WRONG_TYPE');
    expectCode(NODE_GOLDEN.subarray(0, -1), 'TRUNCATED');
    expectCode(Buffer.concat([NODE_GOLDEN, Buffer.from([0])]), 'TRAILING_DATA');
    expectCode(manualPacket({ nodeId: 'bad!' }), 'INVALID_NODE_ID');
    expectCode(manualPacket({ filterState: 8 }), 'INVALID_FILTER_STATE');
    expectCode(manualPacket({ bootReason: 6 }), 'INVALID_ENUM');
    expectCode(manualPacket({ rtcState: 1, rtcUnixTime: 1 }), 'INVALID_FLAGS');
    expectCode(manualPacket({ pollIntervalMinutes: 0 }), 'INVALID_FLAGS');
  });

  it('requires canonical Base64 and enforces the radio capacity', () => {
    expect(decodeNodeTelemetryV3Base64(NODE_GOLDEN.toString('base64')).nodeId)
      .toBe('N1');
    expect(() => decodeNodeTelemetryV3Base64('not base64')).toThrow(
      NodeProtocolDecodeError,
    );
    expectCode(Buffer.alloc(97), 'PACKET_TOO_LARGE');
  });
});

function expectCode(packet: Buffer, code: NodeProtocolDecodeError['code']): void {
  expect(() => decodeNodeTelemetryV3(packet)).toThrow(
    expect.objectContaining({ code }),
  );
}

function withByte(source: Buffer, offset: number, value: number): Buffer {
  const copy = Buffer.from(source);
  copy[offset] = value;
  return copy;
}

function manualPacket(
  values: Partial<{
    nodeId: string;
    persistentSessionId: number;
    sequence: number;
    medianEchoUs: number;
    rawDistanceMm: number;
    acceptedDistanceMm: number;
    temperatureCentiC: number;
    humidityCentiPercent: number;
    filterState: number;
    bootReason: number;
    rtcState: number;
    rtcUnixTime: number;
    pollIntervalMinutes: number;
    referenceDistanceMm: number;
  }>,
): Buffer {
  const node = Buffer.from(values.nodeId ?? 'N1', 'ascii');
  const packet = Buffer.alloc(NODE_TELEMETRY_FIXED_BYTES + node.length);
  packet.set([0x47, 0x54, 3, 1, node.length], 0);
  node.copy(packet, 5);
  const offset = 5 + node.length;
  packet.writeUInt32BE(values.persistentSessionId ?? 1, offset);
  packet.writeUInt32BE(values.sequence ?? 2, offset + 4);
  packet.writeUInt32BE(values.medianEchoUs ?? 4321, offset + 8);
  packet.writeUInt32BE(values.rawDistanceMm ?? 742, offset + 12);
  packet.writeUInt32BE(values.acceptedDistanceMm ?? 741, offset + 16);
  packet.writeUInt16BE(3, offset + 20);
  packet.writeInt16BE(values.temperatureCentiC ?? 2941, offset + 22);
  packet.writeUInt16BE(values.humidityCentiPercent ?? 8213, offset + 24);
  packet.writeUInt16BE(4012, offset + 26);
  packet.set([7, 7, values.filterState ?? 4], offset + 28);
  packet.writeUInt16BE(7, offset + 31);
  packet.writeUInt16BE(128, offset + 33);
  packet[offset + 35] = values.bootReason ?? 0;
  packet[offset + 36] = values.rtcState ?? 0;
  packet.writeUInt32BE(values.rtcUnixTime ?? 1_787_600_000, offset + 37);
  packet[offset + 41] = values.pollIntervalMinutes ?? 10;
  packet[offset + 42] = 0;
  packet.writeUInt32BE(0, offset + 43);
  packet.writeUInt32BE(0, offset + 47);
  packet[offset + 51] = 0;
  packet[offset + 52] = 0xff;
  packet.writeUInt32BE(
    values.referenceDistanceMm ?? 1500,
    offset + NODE_REFERENCE_DISTANCE_PAYLOAD_OFFSET,
  );
  return packet;
}
