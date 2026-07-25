const DEFAULT_PORT = 3000;
const DEFAULT_ROUTING_ENGINE_URL = 'http://routing-engine:8989';
const DEFAULT_ROUTING_TIMEOUT_MS = 8_000;

export interface AppConfiguration {
  readonly port: number;
  readonly routingEngineBaseUrl: string;
  readonly routingEngineTimeoutMs: number;
}

export function readConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfiguration {
  return {
    port: parsePositiveInteger(environment.PORT, DEFAULT_PORT),
    routingEngineBaseUrl: normalizeBaseUrl(
      environment.ROUTING_ENGINE_BASE_URL ?? DEFAULT_ROUTING_ENGINE_URL,
    ),
    routingEngineTimeoutMs: parsePositiveInteger(
      environment.ROUTING_ENGINE_TIMEOUT_MS,
      DEFAULT_ROUTING_TIMEOUT_MS,
    ),
  };
}

function parsePositiveInteger(
  rawValue: string | undefined,
  fallback: number,
): number {
  if (rawValue === undefined) {
    return fallback;
  }
  const parsed = Number(rawValue);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}
