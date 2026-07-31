import { PlaceTokenCodec } from './place-token.codec';

describe('PlaceTokenCodec', () => {
  it('round-trips a safe provider ID as an opaque token', () => {
    const codec = new PlaceTokenCodec();
    const token = codec.encode('photon', 'N:123');

    expect(token).not.toContain('N:123');
    expect(codec.decode(token)).toEqual({
      provider: 'photon',
      id: 'N:123',
    });
  });

  it('rejects tampered, untrusted URL-like, traversal and oversized values', () => {
    const codec = new PlaceTokenCodec();
    const token = codec.encode('fake', 'fake:venue:jakarta-pusat');
    expect(codec.decode(`${token.slice(0, -1)}x`)).toBeNull();
    expect(codec.decode('not-a-token')).toBeNull();
    expect(() =>
      codec.encode('photon', 'http:venue://internal/path'),
    ).toThrow();
    expect(() =>
      codec.encode('photon', 'N:../secret'),
    ).toThrow();
  });
});
