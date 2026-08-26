import { Inject, Injectable } from '@nestjs/common';
import { readConfiguration } from '../../configuration';
import { DatabaseService } from '../../database/database.service';
import {
  deriveSensorState,
  evaluateEffectiveSensorState,
} from './sensor-classifier';
import type {
  EffectiveSensorState,
  SensorDeploymentWithState,
} from './sensor-deployment.models';
import { SensorDeploymentRepository } from './sensor-deployment.repository';
import { validateSensorDeployment } from './sensor-deployment.validator';

export const SENSOR_NOW_FN = Symbol('SENSOR_NOW_FN');
export type SensorNowFn = () => Date;

@Injectable()
export class SensorDeploymentService {
  private readonly maxPolygonVertices =
    readConfiguration().maxFloodPolygonVertices;

  constructor(
    private readonly database: DatabaseService,
    private readonly repository: SensorDeploymentRepository,
    @Inject(SENSOR_NOW_FN) private readonly nowFn: SensorNowFn,
  ) {}

  async listEffective(
    now: Date = this.nowFn(),
  ): Promise<readonly EffectiveSensorState[]> {
    const records = await this.repository.listWithState();
    return records.map((record) => evaluateEffectiveSensorState(record, now));
  }

  async getEffective(
    nodeId: string,
    now: Date = this.nowFn(),
  ): Promise<EffectiveSensorState | null> {
    const record = await this.repository.findWithState(nodeId);
    return record === null
      ? null
      : evaluateEffectiveSensorState(record, now);
  }

  async upsert(
    nodeId: string,
    body: unknown,
  ): Promise<EffectiveSensorState> {
    const validated = validateSensorDeployment(
      isRecord(body) ? { ...body, nodeId } : body,
      this.maxPolygonVertices,
    );
    const now = this.nowFn();
    const record = await this.database.transaction(async (client) => {
      const deployment = await this.repository.upsertDeployment(
        client,
        validated,
      );
      const previousState = await this.repository.findStateForUpdate(
        client,
        nodeId,
      );
      const telemetry = await this.repository.findLatestTelemetry(client, nodeId);
      const state = await this.repository.upsertState(
        client,
        deriveSensorState({ deployment, telemetry, previousState, now }),
      );
      return { deployment, state } satisfies SensorDeploymentWithState;
    });
    return evaluateEffectiveSensorState(record, now);
  }

  async recomputeNode(nodeId: string): Promise<EffectiveSensorState | null> {
    const now = this.nowFn();
    const record = await this.database.transaction(async (client) => {
      const deployment = await this.repository.findDeploymentForUpdate(
        client,
        nodeId,
      );
      if (deployment === null) return null;
      const previousState = await this.repository.findStateForUpdate(
        client,
        nodeId,
      );
      const telemetry = await this.repository.findLatestTelemetry(client, nodeId);
      const state = await this.repository.upsertState(
        client,
        deriveSensorState({ deployment, telemetry, previousState, now }),
      );
      return { deployment, state } satisfies SensorDeploymentWithState;
    });
    return record === null ? null : evaluateEffectiveSensorState(record, now);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
