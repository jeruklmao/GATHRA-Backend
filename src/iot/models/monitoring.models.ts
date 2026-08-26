import type { FilterStateName } from '../protocol/node-protocol-v3';

export interface MonitoringTelemetry {
  readonly id: number;
  readonly nodeId: string;
  readonly bootSessionId: number;
  readonly sequence: number;
  readonly measurement: {
    readonly medianEchoUs: number;
    readonly rawDistanceMm: number | null;
    readonly acceptedDistanceMm: number | null;
    readonly referenceDistanceMm: number | null;
    readonly madMm: number;
    readonly temperatureC: number | null;
    readonly humidityPercent: number | null;
    readonly batteryMv: number;
    readonly validSamples: number;
    readonly totalSamples: number;
    readonly filterState: {
      readonly code: number;
      readonly name: FilterStateName;
    };
    readonly qualityFlags: number;
    readonly healthFlags: number;
  };
  readonly reception: {
    readonly gatewayId: string;
    readonly hardwareMac: string;
    readonly gatewayBootSessionId: number;
    readonly gatewayReceivedAt: string | null;
    readonly gatewayTimeTrusted: boolean;
    readonly gatewayUptimeMs: number;
    readonly serverReceivedAt: string;
    readonly rssiDbm: number;
    readonly snrDb: number;
    readonly frequencyErrorHz: number;
    readonly packetLength: number;
  };
  readonly rawPayloadBase64?: string;
}

export interface MonitoringNodeSummary {
  readonly nodeId: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly lastGateway: {
    readonly gatewayId: string;
    readonly hardwareMac: string;
  } | null;
  readonly latestTelemetry: MonitoringTelemetry | null;
}
