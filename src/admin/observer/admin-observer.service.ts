import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readConfiguration } from '../../configuration';

export const ADMIN_LOG_SOURCES = [
  'backend',
  'postgres',
  'routing-engine',
  'photon',
  'gathra-service',
  'cloudflared',
] as const;

export type AdminLogSource = (typeof ADMIN_LOG_SOURCES)[number];

export interface ObserverSnapshot {
  readonly schemaVersion: 1;
  readonly observedAt: string;
  readonly host: Record<string, unknown>;
  readonly containers: Record<string, unknown>;
  readonly services: Record<string, unknown>;
  readonly release: Record<string, unknown>;
  readonly backup: Record<string, unknown> | null;
  readonly errors?: readonly string[];
}

@Injectable()
export class AdminObserverService {
  private readonly directory = readConfiguration().adminObserverDirectory;

  async snapshot(): Promise<{
    available: boolean;
    stale: boolean;
    ageSeconds: number | null;
    snapshot: ObserverSnapshot | null;
    reason?: string;
  }> {
    try {
      const file = path.join(this.directory, 'status.json');
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 512 * 1024) {
        return this.unavailable('observer snapshot is not a bounded regular file');
      }
      const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!isSnapshot(parsed)) {
        return this.unavailable('observer snapshot is malformed');
      }
      const ageSeconds = Math.max(
        0,
        (Date.now() - Date.parse(parsed.observedAt)) / 1_000,
      );
      return {
        available: true,
        stale: ageSeconds > 15,
        ageSeconds,
        snapshot: parsed,
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return this.unavailable(
        code === 'ENOENT' ? 'observer unavailable' : 'observer snapshot unreadable',
      );
    }
  }

  async logs(input: {
    source: string;
    lines: number;
    search?: string;
    severity?: string;
  }): Promise<{
    source: AdminLogSource;
    observedAt: string | null;
    lines: string[];
  }> {
    if (!ADMIN_LOG_SOURCES.includes(input.source as AdminLogSource)) {
      throw new Error('INVALID_LOG_SOURCE');
    }
    const source = input.source as AdminLogSource;
    const limit = [100, 300, 500].includes(input.lines) ? input.lines : 100;
    const file = path.join(this.directory, 'logs', `${source}.log`);
    let contents: string;
    let observedAt: string | null = null;
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 4 * 1024 * 1024) {
        throw new Error('INVALID_LOG_FILE');
      }
      contents = await fs.readFile(file, 'utf8');
      observedAt = stat.mtime.toISOString();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { source, observedAt, lines: [] };
      }
      throw error;
    }
    const search = sanitizeQuery(input.search, 100).toLocaleLowerCase();
    const severity = sanitizeQuery(input.severity, 16).toUpperCase();
    const filtered = contents
      .split(/\r?\n/)
      .map(sanitizeLogLine)
      .filter((line) => line.length > 0)
      .filter((line) => search.length === 0 || line.toLocaleLowerCase().includes(search))
      .filter((line) => severity.length === 0 || detectSeverity(line) === severity);
    return { source, observedAt, lines: filtered.slice(-limit) };
  }

  private unavailable(reason: string) {
    return {
      available: false,
      stale: true,
      ageSeconds: null,
      snapshot: null,
      reason,
    } as const;
  }
}

export function sanitizeLogLine(value: string): string {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, 4_096);
}

function sanitizeQuery(value: string | undefined, max: number): string {
  return (value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
}

function detectSeverity(line: string): string {
  const match = line.match(/\b(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|CRITICAL)\b/i);
  if (match === null) return 'OTHER';
  const value = match[1].toUpperCase();
  return value === 'WARNING' ? 'WARN' : value === 'CRITICAL' ? 'FATAL' : value;
}

function isSnapshot(value: unknown): value is ObserverSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  return (
    object.schemaVersion === 1 &&
    typeof object.observedAt === 'string' &&
    Number.isFinite(Date.parse(object.observedAt)) &&
    isObject(object.host) &&
    isObject(object.containers) &&
    isObject(object.services) &&
    isObject(object.release) &&
    (object.backup === null || isObject(object.backup)) &&
    (object.errors === undefined ||
      (Array.isArray(object.errors) && object.errors.every((item) => typeof item === 'string')))
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
