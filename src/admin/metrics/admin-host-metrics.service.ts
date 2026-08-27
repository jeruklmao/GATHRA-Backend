import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { readConfiguration } from '../../configuration';
import { DatabaseService } from '../../database/database.service';
import { AdminObserverService } from '../observer/admin-observer.service';

@Injectable()
export class AdminHostMetricsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AdminHostMetricsService.name);
  private readonly retentionDays = readConfiguration().adminMetricsRetentionDays;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly database: DatabaseService,
    private readonly observer: AdminObserverService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.sample(), 60_000);
    this.timer.unref();
    void this.sample();
  }

  onApplicationShutdown(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  async history(range: string) {
    const configuration = rangeConfiguration(range);
    const result = await this.database.query<{
      bucket_at: Date;
      observed_at: Date;
      observer_status: string;
      cpu_percent: number | null;
      load_1: number | null;
      load_5: number | null;
      load_15: number | null;
      memory_total_bytes: string | null;
      memory_available_bytes: string | null;
      swap_total_bytes: string | null;
      swap_used_bytes: string | null;
      disk_used_bytes: string | null;
      disk_total_bytes: string | null;
      containers: Record<string, unknown>;
    }>(
      `SELECT bucket_at, observed_at, observer_status,
              cpu_percent, load_1, load_5, load_15, memory_total_bytes,
              memory_available_bytes, swap_total_bytes, swap_used_bytes, disk_used_bytes,
              disk_total_bytes, containers
       FROM admin_host_metrics_minute
       WHERE bucket_at >= now() - $1::interval
       ORDER BY bucket_at ASC`,
      [configuration.interval],
    );
    const step = Math.max(1, Math.ceil(result.rows.length / 500));
    return {
      range: configuration.name,
      points: result.rows.filter((_, index) => index % step === 0).map((row) => ({
        at: row.bucket_at.toISOString(),
        observedAt: row.observed_at.toISOString(),
        observerAvailable: row.observer_status === 'AVAILABLE' || row.observer_status === 'PARTIAL',
        observerStale: row.observer_status === 'STALE',
        cpuPercent: row.cpu_percent,
        load1: row.load_1,
        load5: row.load_5,
        load15: row.load_15,
        memoryUsedBytes: difference(row.memory_total_bytes, row.memory_available_bytes),
        memoryAvailableBytes: nullableNumber(row.memory_available_bytes),
        swapTotalBytes: nullableNumber(row.swap_total_bytes),
        swapUsedBytes: nullableNumber(row.swap_used_bytes),
        diskUsedBytes: nullableNumber(row.disk_used_bytes),
        diskTotalBytes: nullableNumber(row.disk_total_bytes),
        containers: row.containers,
        ...flattenContainers(row.containers),
      })),
    };
  }

  private async sample(): Promise<void> {
    try {
      const observer = await this.observer.snapshot();
      const host = observer.snapshot?.host ?? {};
      const memory = object(host.memory);
      const swap = object(host.swap);
      const disk = object(host.disk);
      const load = object(host.load);
      await this.database.query(
        `INSERT INTO admin_host_metrics_minute (
           bucket_at, observed_at, observer_status,
           cpu_percent, load_1, load_5, load_15, memory_total_bytes,
           memory_available_bytes, swap_total_bytes, swap_used_bytes,
           disk_total_bytes, disk_used_bytes, containers
         ) VALUES (
           date_trunc('minute', now()), now(), $1, $2, $3, $4, $5,
           $6, $7, $8, $9, $10, $11, $12::jsonb
         ) ON CONFLICT (bucket_at) DO UPDATE SET
           observed_at = EXCLUDED.observed_at,
           observer_status = EXCLUDED.observer_status,
           cpu_percent = EXCLUDED.cpu_percent,
           load_1 = EXCLUDED.load_1,
           load_5 = EXCLUDED.load_5,
           load_15 = EXCLUDED.load_15,
           memory_total_bytes = EXCLUDED.memory_total_bytes,
           memory_available_bytes = EXCLUDED.memory_available_bytes,
           swap_total_bytes = EXCLUDED.swap_total_bytes,
           swap_used_bytes = EXCLUDED.swap_used_bytes,
           disk_used_bytes = EXCLUDED.disk_used_bytes,
           disk_total_bytes = EXCLUDED.disk_total_bytes,
           containers = EXCLUDED.containers`,
        [
          !observer.available
            ? 'UNAVAILABLE'
            : observer.stale
              ? 'STALE'
              : (observer.snapshot?.errors?.length ?? 0) > 0
                ? 'PARTIAL'
                : 'AVAILABLE',
          finite(host.cpuPercent),
          finite(load.one),
          finite(load.five),
          finite(load.fifteen),
          finite(memory.totalBytes),
          finite(memory.availableBytes),
          finite(swap.totalBytes),
          finite(swap.usedBytes),
          finite(disk.totalBytes),
          finite(disk.usedBytes),
          JSON.stringify(observer.snapshot?.containers ?? {}),
        ],
      );
      if (new Date().getUTCMinutes() === 7) {
        await this.database.query(
          `DELETE FROM admin_host_metrics_minute
           WHERE bucket_at < now() - ($1::text || ' days')::interval`,
          [this.retentionDays],
        );
      }
    } catch {
      this.logger.warn('admin_host_metric_sample_failed');
    }
  }
}

function rangeConfiguration(value: string) {
  const values = {
    '1h': { name: '1h', interval: '1 hour' },
    '24h': { name: '24h', interval: '24 hours' },
    '7d': { name: '7d', interval: '7 days' },
    '30d': { name: '30d', interval: '30 days' },
  } as const;
  return values[value as keyof typeof values] ?? values['24h'];
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function difference(total: string | null, available: string | null): number | null {
  return total === null || available === null ? null : Number(total) - Number(available);
}

function flattenContainers(containers: Record<string, unknown>): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const [service, prefix] of [
    ['backend', 'backend'],
    ['postgres', 'postgres'],
    ['routing-engine', 'routingEngine'],
    ['photon', 'photon'],
  ] as const) {
    const value = object(containers[service]);
    result[`${prefix}CpuPercent`] = finite(value.cpuPercent);
    result[`${prefix}MemoryUsedBytes`] = finite(value.memoryUsedBytes);
  }
  return result;
}
