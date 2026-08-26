import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { FloodHazardProvider } from '../flood-hazard.provider';
import type {
  FloodHazard,
  FloodHazardQueryInput,
  FloodHazardSnapshot,
} from '../models/flood-hazard';
import type { EffectiveSensorState } from '../sensors/sensor-deployment.models';
import {
  SENSOR_NOW_FN,
  type SensorNowFn,
  SensorDeploymentService,
} from '../sensors/sensor-deployment.service';

@Injectable()
export class SensorFloodHazardProvider implements FloodHazardProvider {
  constructor(
    private readonly deployments: SensorDeploymentService,
    @Inject(SENSOR_NOW_FN) private readonly nowFn: SensorNowFn,
  ) {}

  async getActiveSnapshot(
    input: FloodHazardQueryInput,
  ): Promise<FloodHazardSnapshot> {
    const now = input.observedAt ?? this.nowFn();
    const states = [...(await this.deployments.listEffective(now))].sort(
      (first, second) =>
        first.deployment.nodeId.localeCompare(second.deployment.nodeId),
    );
    const hazards = states
      .filter((state) => state.deployment.enabled)
      .map(mapHazard);
    return {
      snapshotId: deterministicSnapshotId(states),
      generatedAt: now,
      validUntil: earliestFutureValidity(states, now),
      hazards,
      source: 'SENSOR',
    };
  }
}

function mapHazard(state: EffectiveSensorState): FloodHazard {
  return {
    id: `sensor_${state.deployment.nodeId}`,
    level: state.effectiveLevel,
    geometry: state.deployment.coveragePolygon,
    confidence:
      state.fresh && state.classificationStatus === 'VALID' ? 1 : 0,
    observedAt: state.observedAt,
    validUntil: state.validUntil,
    sourceNodeIds: [state.deployment.nodeId],
    routingMultiplier: state.effectiveMultiplier,
    reasonCodes: state.reasonCodes,
    freshness:
      state.freshness === 'DISABLED' ? 'NO_TELEMETRY' : state.freshness,
    description: `Flood monitoring coverage for sensor ${state.deployment.nodeId}`,
  };
}

function deterministicSnapshotId(
  states: readonly EffectiveSensorState[],
): string {
  const canonical = states
    .map(
      (state) =>
        [
          state.deployment.nodeId,
          state.deployment.configVersion,
          state.telemetryId ?? 'none',
          state.effectiveLevel,
          state.freshness,
        ].join('|'),
    )
    .join('\n');
  const digest = createHash('sha256')
    .update(`gathra-sensor-flood-v1\n${canonical}`)
    .digest('hex')
    .slice(0, 24);
  return `sensor_snapshot_${digest}`;
}

function earliestFutureValidity(
  states: readonly EffectiveSensorState[],
  now: Date,
): Date | null {
  let earliest: Date | null = null;
  for (const state of states) {
    if (
      !state.deployment.enabled ||
      state.validUntil === null ||
      state.validUntil.getTime() < now.getTime()
    ) {
      continue;
    }
    if (earliest === null || state.validUntil.getTime() < earliest.getTime()) {
      earliest = state.validUntil;
    }
  }
  return earliest;
}
