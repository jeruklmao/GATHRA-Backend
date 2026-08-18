import {
  decodeNodeTelemetryV1,
  decodeNodeTelemetryV1Base64,
  INT16_MIN,
  NodeProtocolDecodeError,
  UINT16_MAX,
  UINT32_MAX,
} from './node-protocol-v1';

// Copied byte-for-byte from GATHRA-Node/test/test_main.cpp. This vector is
// produced by the deployed Node codec, not by the TypeScript decoder.
const NODE_GOLDEN = Buffer.from([
  0x47, 0x54, 0x01, 0x01, 0x02, 0x4e, 0x31, 0x01, 0x02, 0x03, 0x04, 0xa0,
  0xb0, 0xc0, 0xd0, 0x00, 0x00, 0x12, 0x34, 0x00, 0x00, 0x02, 0xe4, 0x00,
  0x00, 0x02, 0xe3, 0x00, 0x03, 0xfb, 0x2e, 0x11, 0xd7, 0x0e, 0x74, 0x07,
  0x07, 0x00, 0x00, 0x03, 0x02, 0x02,
]);

describe('Node Protocol v1 decoder', () => {
  it('decodes the exact GATHRA-Node golden telemetry vector', () => {
    const decoded = decodeNodeTelemetryV1(NODE_GOLDEN);

    expect(decoded).toMatchObject({
      protocolVersion: 1,
      nodeId: 'N1',
      bootSessionId: 0x0102_0304,
      sequence: 0xa0b0_c0d0,
      medianEchoUs: 0x1234,
      rawDistanceMm: 740,
      acceptedDistanceMm: 739,
      madMm: 3,
      temperatureCentiC: -1234,
      humidityCentiPercent: 4567,
      batteryMv: 3700,
      validSamples: 7,
      totalSamples: 7,
      filterState: 0,
      qualityFlags: 3,
      healthFlags: 0x0202,
    });
    expect(decoded.rawPayload).toEqual(NODE_GOLDEN);
  });

  it.each(['A', 'Z'.repeat(24)])(
    'accepts boundary Node ID %s',
    (nodeId) => {
      const decoded = decodeNodeTelemetryV1(
        manualPacket({ nodeId, bootSessionId: UINT32_MAX }),
      );
      expect(decoded.nodeId).toBe(nodeId);
      expect(decoded.bootSessionId).toBe(UINT32_MAX);
    },
  );

  it('normalizes every unavailable sentinel to null', () => {
    const decoded = decodeNodeTelemetryV1(
      manualPacket({
        rawDistanceMm: UINT32_MAX,
        acceptedDistanceMm: UINT32_MAX,
        temperatureCentiC: INT16_MIN,
        humidityCentiPercent: UINT16_MAX,
      }),
    );

    expect(decoded.rawDistanceMm).toBeNull();
    expect(decoded.acceptedDistanceMm).toBeNull();
    expect(decoded.temperatureCentiC).toBeNull();
    expect(decoded.humidityCentiPercent).toBeNull();
  });

  it('preserves unsigned 32-bit values above PostgreSQL INT32_MAX', () => {
    const decoded = decodeNodeTelemetryV1(
      manualPacket({
        bootSessionId: 0xffff_fffe,
        sequence: 0x8000_0001,
        medianEchoUs: 0xf000_0001,
        rawDistanceMm: 0xefff_ffff,
      }),
    );

    expect(decoded.bootSessionId).toBe(4_294_967_294);
    expect(decoded.sequence).toBe(2_147_483_649);
    expect(decoded.medianEchoUs).toBe(4_026_531_841);
    expect(decoded.rawDistanceMm).toBe(4_026_531_839);
  });

  it('rejects bad magic, version, ACK type, truncation, trailing data, invalid ID, and filter state', () => {
    expectCode(withByte(NODE_GOLDEN, 0, 0), 'BAD_MAGIC');
    expectCode(withByte(NODE_GOLDEN, 2, 2), 'UNSUPPORTED_VERSION');
    expectCode(withByte(NODE_GOLDEN, 3, 2), 'WRONG_TYPE');
    expectCode(NODE_GOLDEN.subarray(0, -1), 'TRUNCATED');
    expectCode(Buffer.concat([NODE_GOLDEN, Buffer.from([0])]), 'TRAILING_DATA');
    expectCode(manualPacket({ nodeId: 'bad!' }), 'INVALID_NODE_ID');
    const highBitNodeId = Buffer.from(NODE_GOLDEN);
    highBitNodeId[5] = 0xc1; // Node.js ASCII decoding would otherwise alias this to 'A'.
    expectCode(highBitNodeId, 'INVALID_NODE_ID');
    expectCode(manualPacket({ filterState: 8 }), 'INVALID_FILTER_STATE');
  });

  it('requires canonical Base64 and enforces the radio capacity', () => {
    expect(decodeNodeTelemetryV1Base64(NODE_GOLDEN.toString('base64')).nodeId)
      .toBe('N1');
    expect(() => decodeNodeTelemetryV1Base64('not base64')).toThrow(
      NodeProtocolDecodeError,
    );
    expectCode(Buffer.alloc(97), 'PACKET_TOO_LARGE');
  });
});

function expectCode(
  packet: Buffer,
  code: NodeProtocolDecodeError['code'],
): void {
  expect(() => decodeNodeTelemetryV1(packet)).toThrow(
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
    bootSessionId: number;
    sequence: number;
    medianEchoUs: number;
    rawDistanceMm: number;
    acceptedDistanceMm: number;
    temperatureCentiC: number;
    humidityCentiPercent: number;
    filterState: number;
  }>,
): Buffer {
  const node = Buffer.from(values.nodeId ?? 'N1', 'ascii');
  const packet = Buffer.alloc(40 + node.length);
  packet.set([0x47, 0x54, 1, 1, node.length], 0);
  node.copy(packet, 5);
  const offset = 5 + node.length;
  packet.writeUInt32BE(values.bootSessionId ?? 1, offset);
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
  return packet;
}
