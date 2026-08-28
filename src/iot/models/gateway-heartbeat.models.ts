export type GatewayHeartbeatState =
  | 'ONLINE'
  | 'STALE'
  | 'OFFLINE'
  | 'HEARTBEAT_UNAVAILABLE';

export interface GatewayFreshness {
  readonly state: GatewayHeartbeatState;
  readonly ageSeconds: number | null;
  readonly onlineUntil: string | null;
  readonly staleUntil: string | null;
}

export function gatewayFreshness(
  lastHeartbeatAt: Date | null,
  heartbeatIntervalSeconds: number | null,
  now: Date,
): GatewayFreshness {
  if (lastHeartbeatAt === null || heartbeatIntervalSeconds === null) {
    return {
      state: 'HEARTBEAT_UNAVAILABLE',
      ageSeconds: null,
      onlineUntil: null,
      staleUntil: null,
    };
  }
  const ageSeconds = Math.max(0, (now.getTime() - lastHeartbeatAt.getTime()) / 1_000);
  const onlineUntil = new Date(
    lastHeartbeatAt.getTime() + heartbeatIntervalSeconds * 2_000,
  );
  const staleUntil = new Date(
    lastHeartbeatAt.getTime() + heartbeatIntervalSeconds * 5_000,
  );
  return {
    state:
      ageSeconds <= heartbeatIntervalSeconds * 2
        ? 'ONLINE'
        : ageSeconds <= heartbeatIntervalSeconds * 5
          ? 'STALE'
          : 'OFFLINE',
    ageSeconds,
    onlineUntil: onlineUntil.toISOString(),
    staleUntil: staleUntil.toISOString(),
  };
}
