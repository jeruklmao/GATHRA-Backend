import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { readConfiguration } from '../../configuration';
import { DatabaseService } from '../../database/database.service';

export const LATENCY_BUCKET_LIMITS_MS = [
  25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000,
] as const;
const HISTOGRAM_SIZE = LATENCY_BUCKET_LIMITS_MS.length + 1;
const MAX_ACTIVE_KEYS = 500;

interface MetricAccumulator {
  readonly bucketAt: Date;
  readonly method: string;
  readonly route: string;
  requestCount: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  latencyHistogram: number[];
  latencySumMs: number;
  requestBytes: number;
  responseBytes: number;
}

interface TrafficRow {
  readonly bucket_at: Date;
  readonly request_count: string;
  readonly status_2xx: string;
  readonly status_3xx: string;
  readonly status_4xx: string;
  readonly status_5xx: string;
  readonly latency_histogram: string[];
  readonly latency_sum_ms: number;
  readonly request_bytes: string;
  readonly response_bytes: string;
}

interface RouteRow extends Omit<TrafficRow, 'bucket_at'> {
  readonly method: string;
  readonly route: string;
}

export type DashboardRange = '1h' | '24h' | '7d' | '30d';

@Injectable()
export class AdminTrafficService implements OnApplicationShutdown {
  private readonly logger = new Logger(AdminTrafficService.name);
  private active = new Map<string, MetricAccumulator>();
  private readonly flushTimer: NodeJS.Timeout;
  private readonly retentionTimer: NodeJS.Timeout;
  private readonly retentionDays = readConfiguration().adminMetricsRetentionDays;

  constructor(private readonly database: DatabaseService) {
    this.flushTimer = setInterval(() => void this.flush(), 15_000);
    this.flushTimer.unref();
    this.retentionTimer = setInterval(
      () => void this.cleanupRetention().catch(() => undefined),
      60 * 60_000,
    );
    this.retentionTimer.unref();
  }

  record(input: {
    readonly at: Date;
    readonly method: string;
    readonly route: string;
    readonly statusCode: number;
    readonly latencyMs: number;
    readonly requestBytes: number;
    readonly responseBytes: number;
  }): void {
    const bucketAt = minuteBucket(input.at);
    const key = `${bucketAt.toISOString()}\0${input.method}\0${input.route}`;
    let metric = this.active.get(key);
    if (metric === undefined) {
      if (this.active.size >= MAX_ACTIVE_KEYS) {
        return;
      }
      metric = {
        bucketAt,
        method: input.method,
        route: input.route,
        requestCount: 0,
        status2xx: 0,
        status3xx: 0,
        status4xx: 0,
        status5xx: 0,
        latencyHistogram: Array<number>(HISTOGRAM_SIZE).fill(0),
        latencySumMs: 0,
        requestBytes: 0,
        responseBytes: 0,
      };
      this.active.set(key, metric);
    }
    metric.requestCount += 1;
    if (input.statusCode < 300) metric.status2xx += 1;
    else if (input.statusCode < 400) metric.status3xx += 1;
    else if (input.statusCode < 500) metric.status4xx += 1;
    else metric.status5xx += 1;
    const latency = Math.max(0, Math.min(input.latencyMs, 60_000));
    metric.latencyHistogram[latencyBucketIndex(latency)] += 1;
    metric.latencySumMs += latency;
    metric.requestBytes += boundedBytes(input.requestBytes);
    metric.responseBytes += boundedBytes(input.responseBytes);
  }

  async flush(): Promise<void> {
    if (this.active.size === 0) return;
    const pending = this.active;
    this.active = new Map();
    try {
      await this.database.transaction(async (client) => {
        for (const metric of pending.values()) {
          await client.query(
            `
              INSERT INTO admin_http_metrics_minute (
                bucket_at, method, route, request_count,
                status_2xx, status_3xx, status_4xx, status_5xx,
                latency_histogram, latency_sum_ms, request_bytes, response_bytes
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
              ON CONFLICT (bucket_at, method, route) DO UPDATE SET
                request_count = admin_http_metrics_minute.request_count + EXCLUDED.request_count,
                status_2xx = admin_http_metrics_minute.status_2xx + EXCLUDED.status_2xx,
                status_3xx = admin_http_metrics_minute.status_3xx + EXCLUDED.status_3xx,
                status_4xx = admin_http_metrics_minute.status_4xx + EXCLUDED.status_4xx,
                status_5xx = admin_http_metrics_minute.status_5xx + EXCLUDED.status_5xx,
                latency_histogram = ARRAY[
                  admin_http_metrics_minute.latency_histogram[1] + EXCLUDED.latency_histogram[1],
                  admin_http_metrics_minute.latency_histogram[2] + EXCLUDED.latency_histogram[2],
                  admin_http_metrics_minute.latency_histogram[3] + EXCLUDED.latency_histogram[3],
                  admin_http_metrics_minute.latency_histogram[4] + EXCLUDED.latency_histogram[4],
                  admin_http_metrics_minute.latency_histogram[5] + EXCLUDED.latency_histogram[5],
                  admin_http_metrics_minute.latency_histogram[6] + EXCLUDED.latency_histogram[6],
                  admin_http_metrics_minute.latency_histogram[7] + EXCLUDED.latency_histogram[7],
                  admin_http_metrics_minute.latency_histogram[8] + EXCLUDED.latency_histogram[8],
                  admin_http_metrics_minute.latency_histogram[9] + EXCLUDED.latency_histogram[9],
                  admin_http_metrics_minute.latency_histogram[10] + EXCLUDED.latency_histogram[10]
                ],
                latency_sum_ms = admin_http_metrics_minute.latency_sum_ms + EXCLUDED.latency_sum_ms,
                request_bytes = admin_http_metrics_minute.request_bytes + EXCLUDED.request_bytes,
                response_bytes = admin_http_metrics_minute.response_bytes + EXCLUDED.response_bytes
            `,
            [
              metric.bucketAt,
              metric.method,
              metric.route,
              metric.requestCount,
              metric.status2xx,
              metric.status3xx,
              metric.status4xx,
              metric.status5xx,
              metric.latencyHistogram,
              metric.latencySumMs,
              metric.requestBytes,
              metric.responseBytes,
            ],
          );
        }
      });
    } catch (error) {
      this.mergeBack(pending);
      this.logger.error({ event: 'admin_http_metrics_flush_failed' });
    }
  }

  async query(range: DashboardRange) {
    const definition = rangeDefinition(range);
    const since = new Date(Date.now() - definition.durationMs);
    const histogramColumns = histogramSumColumns();
    const timeline = await this.database.query<TrafficRow>(
      `
        SELECT
          date_bin($2::interval, bucket_at, TIMESTAMPTZ '1970-01-01') AS bucket_at,
          SUM(request_count)::text AS request_count,
          SUM(status_2xx)::text AS status_2xx,
          SUM(status_3xx)::text AS status_3xx,
          SUM(status_4xx)::text AS status_4xx,
          SUM(status_5xx)::text AS status_5xx,
          ARRAY[${histogramColumns}] AS latency_histogram,
          SUM(latency_sum_ms) AS latency_sum_ms,
          SUM(request_bytes)::text AS request_bytes,
          SUM(response_bytes)::text AS response_bytes
        FROM admin_http_metrics_minute
        WHERE bucket_at >= $1
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      [since, definition.binInterval],
    );
    const routes = await this.database.query<RouteRow>(
      `
        SELECT method, route,
          SUM(request_count)::text AS request_count,
          SUM(status_2xx)::text AS status_2xx,
          SUM(status_3xx)::text AS status_3xx,
          SUM(status_4xx)::text AS status_4xx,
          SUM(status_5xx)::text AS status_5xx,
          ARRAY[${histogramColumns}] AS latency_histogram,
          SUM(latency_sum_ms) AS latency_sum_ms,
          SUM(request_bytes)::text AS request_bytes,
          SUM(response_bytes)::text AS response_bytes
        FROM admin_http_metrics_minute
        WHERE bucket_at >= $1
        GROUP BY method, route
        ORDER BY SUM(request_count) DESC, method, route
        LIMIT 50
      `,
      [since],
    );
    const totals = mergeRows(timeline.rows);
    return {
      range,
      approximatePercentiles: true,
      latencyBucketLimitsMs: [...LATENCY_BUCKET_LIMITS_MS],
      totals: summarize(totals),
      timeline: timeline.rows.map((row) => ({
        bucketAt: row.bucket_at.toISOString(),
        ...summarize(parseRow(row)),
      })),
      routes: routes.rows.map((row) => ({
        method: row.method,
        route: row.route,
        ...summarize(parseRow(row)),
      })),
      retentionDays: this.retentionDays,
    };
  }

  async overview() {
    const result = await this.query('1h');
    const recent = result.timeline.slice(-5);
    const requestCount = recent.reduce((sum, item) => sum + item.requestCount, 0);
    return {
      requestsPerMinute: Number((requestCount / Math.max(1, recent.length)).toFixed(2)),
      recent4xx: recent.reduce((sum, item) => sum + item.status4xx, 0),
      recent5xx: recent.reduce((sum, item) => sum + item.status5xx, 0),
      p95LatencyMs: result.totals.p95LatencyMs,
    };
  }

  async cleanupRetention(now = new Date()): Promise<void> {
    await this.database.query(
      `DELETE FROM admin_http_metrics_minute
       WHERE bucket_at < $1 - ($2::text || ' days')::interval`,
      [now, this.retentionDays],
    );
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.flushTimer);
    clearInterval(this.retentionTimer);
    await this.flush();
  }

  private mergeBack(pending: Map<string, MetricAccumulator>): void {
    for (const [key, old] of pending) {
      const current = this.active.get(key);
      if (current === undefined) {
        if (this.active.size < MAX_ACTIVE_KEYS) this.active.set(key, old);
        continue;
      }
      current.requestCount += old.requestCount;
      current.status2xx += old.status2xx;
      current.status3xx += old.status3xx;
      current.status4xx += old.status4xx;
      current.status5xx += old.status5xx;
      current.latencySumMs += old.latencySumMs;
      current.requestBytes += old.requestBytes;
      current.responseBytes += old.responseBytes;
      for (let index = 0; index < HISTOGRAM_SIZE; index += 1) {
        current.latencyHistogram[index] += old.latencyHistogram[index];
      }
    }
  }
}

export function normalizeHttpRoute(path: string): string {
  const withoutQuery = path.split('?', 1)[0].slice(0, 512);
  const segments = withoutQuery.split('/').map((segment, index, all) => {
    if (segment === '') return segment;
    const previous = all[index - 1];
    if (
      previous === 'nodes' ||
      previous === 'sensor-deployments' ||
      previous === 'deployments'
    ) {
      return ':nodeId';
    }
    if (/^\d+$/.test(segment)) return ':id';
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ':id';
    if (!/^[A-Za-z0-9_.:-]+$/.test(segment)) return ':value';
    return segment;
  });
  const normalized = segments.join('/').slice(0, 160);
  return normalized.startsWith('/') && normalized.length > 1
    ? normalized
    : '/';
}

export function percentileFromHistogram(
  histogram: readonly number[],
  percentile: number,
): number | null {
  const total = histogram.reduce((sum, value) => sum + value, 0);
  if (total === 0) return null;
  const target = Math.ceil(total * percentile);
  let cumulative = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    cumulative += histogram[index] ?? 0;
    if (cumulative >= target) {
      return index < LATENCY_BUCKET_LIMITS_MS.length
        ? LATENCY_BUCKET_LIMITS_MS[index]
        : 10_000;
    }
  }
  return 10_000;
}

function latencyBucketIndex(latencyMs: number): number {
  const index = LATENCY_BUCKET_LIMITS_MS.findIndex((limit) => latencyMs <= limit);
  return index === -1 ? HISTOGRAM_SIZE - 1 : index;
}

function minuteBucket(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000);
}

function boundedBytes(value: number): number {
  return Number.isFinite(value) && value > 0
    ? Math.min(Math.round(value), 100 * 1024 * 1024)
    : 0;
}

function histogramSumColumns(): string {
  return Array.from(
    { length: HISTOGRAM_SIZE },
    (_, index) => `SUM(latency_histogram[${index + 1}])::text`,
  ).join(',');
}

function parseRow(row: Omit<TrafficRow, 'bucket_at'>) {
  return {
    requestCount: Number(row.request_count),
    status2xx: Number(row.status_2xx),
    status3xx: Number(row.status_3xx),
    status4xx: Number(row.status_4xx),
    status5xx: Number(row.status_5xx),
    latencyHistogram: row.latency_histogram.map(Number),
    latencySumMs: row.latency_sum_ms,
    requestBytes: Number(row.request_bytes),
    responseBytes: Number(row.response_bytes),
  };
}

function mergeRows(rows: readonly TrafficRow[]) {
  const merged = {
    requestCount: 0,
    status2xx: 0,
    status3xx: 0,
    status4xx: 0,
    status5xx: 0,
    latencyHistogram: Array<number>(HISTOGRAM_SIZE).fill(0),
    latencySumMs: 0,
    requestBytes: 0,
    responseBytes: 0,
  };
  for (const row of rows) {
    const parsed = parseRow(row);
    merged.requestCount += parsed.requestCount;
    merged.status2xx += parsed.status2xx;
    merged.status3xx += parsed.status3xx;
    merged.status4xx += parsed.status4xx;
    merged.status5xx += parsed.status5xx;
    merged.latencySumMs += parsed.latencySumMs;
    merged.requestBytes += parsed.requestBytes;
    merged.responseBytes += parsed.responseBytes;
    for (let index = 0; index < HISTOGRAM_SIZE; index += 1) {
      merged.latencyHistogram[index] += parsed.latencyHistogram[index];
    }
  }
  return merged;
}

function summarize(metric: ReturnType<typeof parseRow>) {
  return {
    requestCount: metric.requestCount,
    status2xx: metric.status2xx,
    status3xx: metric.status3xx,
    status4xx: metric.status4xx,
    status5xx: metric.status5xx,
    errorRate:
      metric.requestCount === 0
        ? 0
        : Number(
            ((metric.status4xx + metric.status5xx) / metric.requestCount).toFixed(4),
          ),
    errorRatePercent:
      metric.requestCount === 0
        ? 0
        : Number(
            (((metric.status4xx + metric.status5xx) / metric.requestCount) * 100).toFixed(2),
          ),
    averageLatencyMs:
      metric.requestCount === 0
        ? null
        : Number((metric.latencySumMs / metric.requestCount).toFixed(2)),
    p50LatencyMs: percentileFromHistogram(metric.latencyHistogram, 0.5),
    p95LatencyMs: percentileFromHistogram(metric.latencyHistogram, 0.95),
    p99LatencyMs: percentileFromHistogram(metric.latencyHistogram, 0.99),
    requestBytes: metric.requestBytes,
    responseBytes: metric.responseBytes,
  };
}

function rangeDefinition(range: DashboardRange) {
  switch (range) {
    case '1h': return { durationMs: 60 * 60_000, binInterval: '1 minute' };
    case '24h': return { durationMs: 24 * 60 * 60_000, binInterval: '5 minutes' };
    case '7d': return { durationMs: 7 * 24 * 60 * 60_000, binInterval: '30 minutes' };
    case '30d': return { durationMs: 30 * 24 * 60 * 60_000, binInterval: '2 hours' };
  }
}
