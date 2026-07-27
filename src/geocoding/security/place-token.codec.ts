import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { readConfiguration } from '../../configuration';

const TOKEN_VERSION = 'v1';
const MAX_TOKEN_LENGTH = 1_024;
const SAFE_PROVIDER_ID =
  /^[a-z][a-z0-9_-]{0,31}:[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;

interface PlaceTokenPayload {
  readonly provider: 'fake' | 'pelias';
  readonly id: string;
}

@Injectable()
export class PlaceTokenCodec {
  private readonly secret = createSecret();

  encode(provider: PlaceTokenPayload['provider'], id: string): string {
    assertSafeProviderId(id);
    const payload = Buffer.from(
      JSON.stringify({ provider, id } satisfies PlaceTokenPayload),
      'utf8',
    ).toString('base64url');
    return `${TOKEN_VERSION}.${payload}.${this.sign(payload)}`;
  }

  decode(token: string): PlaceTokenPayload | null {
    if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
      return null;
    }
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
      return null;
    }
    const [, payload, signature] = parts;
    const expected = this.sign(payload);
    const suppliedBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      return null;
    }

    try {
      const decoded = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as unknown;
      if (
        !isRecord(decoded) ||
        (decoded.provider !== 'fake' && decoded.provider !== 'pelias') ||
        typeof decoded.id !== 'string'
      ) {
        return null;
      }
      assertSafeProviderId(decoded.id);
      return { provider: decoded.provider, id: decoded.id };
    } catch {
      return null;
    }
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret)
      .update(`${TOKEN_VERSION}.${payload}`)
      .digest('base64url');
  }
}

function createSecret(): Buffer {
  const configured = readConfiguration().geocodingTokenSecret;
  if (configured === undefined) {
    return randomBytes(32);
  }
  if (Buffer.byteLength(configured, 'utf8') < 32) {
    throw new Error('GEOCODING_TOKEN_SECRET must contain at least 32 bytes');
  }
  return Buffer.from(configured, 'utf8');
}

function assertSafeProviderId(id: string): void {
  if (
    id.length > 512 ||
    id.includes('://') ||
    id.includes('..') ||
    !SAFE_PROVIDER_ID.test(id)
  ) {
    throw new Error('Unsafe provider place identifier');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
