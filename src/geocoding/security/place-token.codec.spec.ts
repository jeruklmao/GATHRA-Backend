import { PlaceTokenCodec } from './place-token.codec';

describe('PlaceTokenCodec', () => {
  it('round-trips a safe provider ID as an opaque token', () => {
    const codec = new PlaceTokenCodec();
    const token = codec.encode('pelias', 'openstreetmap:venue:node/123');

    expect(token).not.toContain('openstreetmap');
    expect(codec.decode(token)).toEqual({
      provider: 'pelias',
      id: 'openstreetmap:venue:node/123',
    });
  });

  it('rejects tampered, untrusted URL-like, traversal and oversized values', () => {
    const codec = new PlaceTokenCodec();
    const token = codec.encode('fake', 'fake:venue:jakarta-pusat');
    expect(codec.decode(`${token.slice(0, -1)}x`)).toBeNull();
    expect(codec.decode('not-a-token')).toBeNull();
    expect(() =>
      codec.encode('pelias', 'http:venue://internal/path'),
    ).toThrow();
    expect(() =>
      codec.encode('pelias', 'openstreetmap:venue:../secret'),
    ).toThrow();
  });
});
