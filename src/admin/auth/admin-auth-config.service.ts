import { Injectable } from '@nestjs/common';
import { readFileSync, statSync } from 'node:fs';
import { readConfiguration } from '../../configuration';

export interface AdminPasswordVerifier {
  readonly cost: number;
  readonly blockSize: number;
  readonly parallelization: number;
  readonly salt: Buffer;
  readonly digest: Buffer;
}

@Injectable()
export class AdminAuthConfigService {
  readonly enabled: boolean;
  readonly username: 'admin' = 'admin';
  readonly passwordVerifier: AdminPasswordVerifier | null;
  readonly sessionSecret: Buffer | null;
  readonly idleMinutes: number;
  readonly absoluteMinutes: number;

  constructor() {
    const configuration = readConfiguration();
    this.enabled = configuration.adminDashboardEnabled;
    this.idleMinutes = configuration.adminSessionIdleMinutes;
    this.absoluteMinutes = configuration.adminSessionAbsoluteMinutes;
    if (!this.enabled) {
      this.passwordVerifier = null;
      this.sessionSecret = null;
      return;
    }

    const file = configuration.adminAuthFile;
    const stat = statSync(file);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 4_096) {
      throw new Error(
        'ADMIN_AUTH_FILE must be a private regular file no larger than 4096 bytes',
      );
    }
    const values = parseEnvironmentFile(readFileSync(file, 'utf8'));
    if (values.ADMIN_USERNAME !== 'admin') {
      throw new Error('ADMIN_AUTH_FILE must configure the fixed username admin');
    }
    this.passwordVerifier = parsePasswordVerifier(
      required(values, 'ADMIN_PASSWORD_VERIFIER'),
    );
    const secret = decodeBase64Url(
      required(values, 'ADMIN_SESSION_SECRET'),
      'ADMIN_SESSION_SECRET',
    );
    if (secret.length !== 32) {
      throw new Error('ADMIN_SESSION_SECRET must decode to exactly 32 bytes');
    }
    this.sessionSecret = secret;
  }
}

function parseEnvironmentFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) throw new Error('ADMIN_AUTH_FILE contains a malformed line');
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!/^ADMIN_[A-Z_]+$/.test(key) || value.length === 0 || key in result) {
      throw new Error('ADMIN_AUTH_FILE contains invalid or duplicate configuration');
    }
    result[key] = value;
  }
  const allowed = new Set([
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD_VERIFIER',
    'ADMIN_SESSION_SECRET',
  ]);
  if (Object.keys(result).some((key) => !allowed.has(key))) {
    throw new Error('ADMIN_AUTH_FILE contains an unsupported setting');
  }
  return result;
}

function required(values: Record<string, string>, key: string): string {
  const value = values[key];
  if (value === undefined) throw new Error(`ADMIN_AUTH_FILE is missing ${key}`);
  return value;
}

function parsePasswordVerifier(value: string): AdminPasswordVerifier {
  const fields = value.split('$');
  if (fields.length !== 6 || fields[0] !== 'scrypt') {
    throw new Error('ADMIN_PASSWORD_VERIFIER has an unsupported format');
  }
  const [cost, blockSize, parallelization] = fields.slice(1, 4).map(Number);
  if (cost !== 32_768 || blockSize !== 8 || parallelization !== 1) {
    throw new Error('ADMIN_PASSWORD_VERIFIER uses unsupported scrypt parameters');
  }
  const salt = decodeBase64Url(fields[4], 'password verifier salt');
  const digest = decodeBase64Url(fields[5], 'password verifier digest');
  if (salt.length !== 16 || digest.length !== 32) {
    throw new Error('ADMIN_PASSWORD_VERIFIER has invalid component lengths');
  }
  return { cost, blockSize, parallelization, salt, digest };
}

function decodeBase64Url(value: string, label: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} is not canonical base64url`);
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) {
    throw new Error(`${label} is not canonical base64url`);
  }
  return decoded;
}
