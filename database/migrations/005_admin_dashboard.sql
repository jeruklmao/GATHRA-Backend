CREATE TABLE admin_sessions (
  session_token_hash BYTEA PRIMARY KEY,
  csrf_token_hash BYTEA NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  last_seen_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT admin_sessions_token_hash_length_check
    CHECK (OCTET_LENGTH(session_token_hash) = 32),
  CONSTRAINT admin_sessions_csrf_hash_length_check
    CHECK (OCTET_LENGTH(csrf_token_hash) = 32),
  CONSTRAINT admin_sessions_time_order_check
    CHECK (created_at <= last_seen_at AND last_seen_at <= expires_at)
);

CREATE INDEX admin_sessions_expires_at_idx
  ON admin_sessions (expires_at);
CREATE INDEX admin_sessions_last_seen_at_idx
  ON admin_sessions (last_seen_at);

CREATE TABLE admin_http_metrics_minute (
  bucket_at TIMESTAMPTZ(0) NOT NULL,
  method VARCHAR(8) NOT NULL,
  route VARCHAR(160) NOT NULL,
  request_count BIGINT NOT NULL DEFAULT 0,
  status_2xx BIGINT NOT NULL DEFAULT 0,
  status_3xx BIGINT NOT NULL DEFAULT 0,
  status_4xx BIGINT NOT NULL DEFAULT 0,
  status_5xx BIGINT NOT NULL DEFAULT 0,
  latency_histogram BIGINT[] NOT NULL,
  latency_sum_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
  request_bytes BIGINT NOT NULL DEFAULT 0,
  response_bytes BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_at, method, route),
  CONSTRAINT admin_http_metrics_method_check
    CHECK (method IN ('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS')),
  CONSTRAINT admin_http_metrics_route_check
    CHECK (route = '/' OR route ~ '^/[A-Za-z0-9_./:-]{1,159}$'),
  CONSTRAINT admin_http_metrics_counts_check
    CHECK (
      request_count >= 0 AND status_2xx >= 0 AND status_3xx >= 0 AND
      status_4xx >= 0 AND status_5xx >= 0 AND
      request_count = status_2xx + status_3xx + status_4xx + status_5xx AND
      request_bytes >= 0 AND response_bytes >= 0 AND latency_sum_ms >= 0
    ),
  CONSTRAINT admin_http_metrics_histogram_check
    CHECK (
      CARDINALITY(latency_histogram) = 10 AND
      0 <= ALL(latency_histogram)
    )
);

CREATE INDEX admin_http_metrics_route_time_idx
  ON admin_http_metrics_minute (route, bucket_at DESC);

CREATE TABLE admin_host_metrics_minute (
  bucket_at TIMESTAMPTZ(0) PRIMARY KEY,
  observed_at TIMESTAMPTZ(3) NOT NULL,
  observer_status TEXT NOT NULL,
  cpu_percent DOUBLE PRECISION,
  load_1 DOUBLE PRECISION,
  load_5 DOUBLE PRECISION,
  load_15 DOUBLE PRECISION,
  memory_total_bytes BIGINT,
  memory_available_bytes BIGINT,
  swap_total_bytes BIGINT,
  swap_used_bytes BIGINT,
  disk_total_bytes BIGINT,
  disk_used_bytes BIGINT,
  containers JSONB NOT NULL DEFAULT '{}'::JSONB,
  CONSTRAINT admin_host_metrics_status_check
    CHECK (observer_status IN ('AVAILABLE', 'STALE', 'UNAVAILABLE', 'PARTIAL')),
  CONSTRAINT admin_host_metrics_percent_check
    CHECK (cpu_percent IS NULL OR cpu_percent BETWEEN 0 AND 100),
  CONSTRAINT admin_host_metrics_load_check
    CHECK (
      (load_1 IS NULL OR load_1 >= 0) AND
      (load_5 IS NULL OR load_5 >= 0) AND
      (load_15 IS NULL OR load_15 >= 0)
    ),
  CONSTRAINT admin_host_metrics_bytes_check
    CHECK (
      (memory_total_bytes IS NULL OR memory_total_bytes >= 0) AND
      (memory_available_bytes IS NULL OR memory_available_bytes >= 0) AND
      (swap_total_bytes IS NULL OR swap_total_bytes >= 0) AND
      (swap_used_bytes IS NULL OR swap_used_bytes >= 0) AND
      (disk_total_bytes IS NULL OR disk_total_bytes >= 0) AND
      (disk_used_bytes IS NULL OR disk_used_bytes >= 0)
    ),
  CONSTRAINT admin_host_metrics_containers_check
    CHECK (JSONB_TYPEOF(containers) = 'object')
);

COMMENT ON TABLE admin_sessions IS
  'Opaque browser administration sessions; only keyed token and CSRF hashes are stored';
COMMENT ON TABLE admin_http_metrics_minute IS
  'Bounded minute aggregates by normalized route; never stores raw URLs, bodies, credentials, cookies, or client IPs';
COMMENT ON COLUMN admin_http_metrics_minute.latency_histogram IS
  'Cumulative-independent counts for <=25, <=50, <=100, <=250, <=500, <=1000, <=2500, <=5000, <=10000, and >10000 milliseconds';
COMMENT ON TABLE admin_host_metrics_minute IS
  'Once-per-minute sanitized host and container resource samples from the read-only host observer';
