import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { FloodHazardProvider } from '../flood-hazard.provider';
import {
  validateFloodHazard,
  MAX_ACTIVE_FLOOD_HAZARDS,
  MAX_FLOOD_POLYGON_VERTICES,
  FloodGeometryValidationError,
} from '../geometry/flood-geometry.validator';
import type {
  FloodHazard,
  FloodHazardQueryInput,
  FloodHazardSnapshot,
} from '../models/flood-hazard';

export const NOW_FN = Symbol('NOW_FN');
export const FLOOD_HAZARD_LIMITS = Symbol('FLOOD_HAZARD_LIMITS');
export const FLOOD_SNAPSHOT_INSTANCE_ID = Symbol(
  'FLOOD_SNAPSHOT_INSTANCE_ID',
);

export interface FloodHazardLimits {
  readonly maxActiveHazards: number;
  readonly maxPolygonVertices: number;
}

const DEFAULT_LIMITS: FloodHazardLimits = {
  maxActiveHazards: MAX_ACTIVE_FLOOD_HAZARDS,
  maxPolygonVertices: MAX_FLOOD_POLYGON_VERTICES,
};

@Injectable()
export class InMemoryFloodHazardProvider implements FloodHazardProvider {
  private hazardsMap = new Map<string, FloodHazard>();
  private version = 0;
  private readonly snapshotInstanceId: string;

  constructor(
    @Optional()
    @Inject(NOW_FN)
    private readonly customNowFn?: () => Date,
    @Optional()
    @Inject(FLOOD_HAZARD_LIMITS)
    private readonly configuredLimits?: FloodHazardLimits,
    @Optional()
    @Inject(FLOOD_SNAPSHOT_INSTANCE_ID)
    configuredSnapshotInstanceId?: string,
  ) {
    const instanceId =
      configuredSnapshotInstanceId ?? randomBytes(16).toString('hex');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(instanceId)) {
      throw new Error('Flood snapshot instance ID is invalid');
    }
    this.snapshotInstanceId = instanceId;
  }

  private get now(): Date {
    return this.customNowFn ? this.customNowFn() : new Date();
  }

  async getActiveSnapshot(
    _input: FloodHazardQueryInput,
  ): Promise<FloodHazardSnapshot> {
    const currentNow = this.now;
    const activeHazards: FloodHazard[] = [];

    for (const hazard of this.hazardsMap.values()) {
      if (hazard.validUntil.getTime() > currentNow.getTime()) {
        activeHazards.push(hazard);
      }
    }

    return this.createSnapshot(activeHazards, currentNow);
  }

  addHazard(hazardData: unknown): FloodHazard {
    const limits = this.configuredLimits ?? DEFAULT_LIMITS;
    const hazard = validateFloodHazard(hazardData, {
      maxPolygonVertices: limits.maxPolygonVertices,
    });
    const activeHazardIds = new Set(
      this.listHazards().map((activeHazard) => activeHazard.id),
    );
    if (
      hazard.validUntil.getTime() > this.now.getTime() &&
      !activeHazardIds.has(hazard.id) &&
      activeHazardIds.size >= limits.maxActiveHazards
    ) {
      throw new FloodGeometryValidationError(
        `Cannot exceed maximum active hazard limit of ${limits.maxActiveHazards}`,
      );
    }
    this.hazardsMap.set(hazard.id, hazard);
    this.version++;
    return hazard;
  }

  removeHazard(id: string): boolean {
    const removed = this.hazardsMap.delete(id);
    if (removed) {
      this.version++;
    }
    return removed;
  }

  clearHazards(): void {
    if (this.hazardsMap.size > 0) {
      this.hazardsMap.clear();
      this.version++;
    }
  }

  listHazards(): readonly FloodHazard[] {
    const currentNow = this.now;
    return Array.from(this.hazardsMap.values()).filter(
      (h) => h.validUntil.getTime() > currentNow.getTime(),
    );
  }

  activateCentralCorridorPreset(level: 'HIGH' | 'BLOCKED'): FloodHazardSnapshot {
    const limits = this.configuredLimits ?? DEFAULT_LIMITS;
    const currentNow = this.now;
    const validUntil = new Date(currentNow.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    const centralCorridorPolygon = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [106.817, -6.201],
          [106.821, -6.201],
          [106.821, -6.193],
          [106.817, -6.193],
          [106.817, -6.201],
        ] as [number, number][],
      ],
    };

    const userCustomPolygon = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [106.81694487382944, -6.203061448721073],
          [106.81489279253424, -6.203244130378491],
          [106.81620979047918, -6.207232917350129],
          [106.81841502206832, -6.206974105601998],
          [106.81694487382944, -6.203061448721073],
        ] as [number, number][],
      ],
    };

    const hazard = validateFloodHazard(
      {
        id: `preset_central_corridor_${level.toLowerCase()}`,
        level,
        geometry: centralCorridorPolygon,
        confidence: 0.95,
        observedAt: currentNow,
        validUntil,
        sourceNodeIds: ['node_central_01', 'node_central_02'],
        description:
          level === 'BLOCKED'
            ? 'Simulasi area banjir yang tidak dapat dilalui di koridor pusat'
            : 'Simulasi area dengan indikasi risiko banjir tinggi di koridor pusat',
      },
      {
        maxPolygonVertices: limits.maxPolygonVertices,
      },
    );

    const userHazard = validateFloodHazard(
      {
        id: `preset_user_custom_${level.toLowerCase()}`,
        level,
        geometry: userCustomPolygon,
        confidence: 0.95,
        observedAt: currentNow,
        validUntil,
        sourceNodeIds: ['node_user_01', 'node_user_02'],
        description:
          level === 'BLOCKED'
            ? 'Simulasi area banjir yang tidak dapat dilalui pada poligon uji'
            : 'Simulasi area dengan indikasi risiko banjir tinggi pada poligon uji',
      },
      {
        maxPolygonVertices: limits.maxPolygonVertices,
      },
    );

    const projectedActiveHazardIds = new Set(
      this.listHazards().map((activeHazard) => activeHazard.id),
    );
    projectedActiveHazardIds.add(hazard.id);
    projectedActiveHazardIds.add(userHazard.id);
    if (projectedActiveHazardIds.size > limits.maxActiveHazards) {
      throw new FloodGeometryValidationError(
        `Cannot exceed maximum active hazard limit of ${limits.maxActiveHazards}`,
      );
    }

    this.hazardsMap.set(hazard.id, hazard);
    this.hazardsMap.set(userHazard.id, userHazard);
    this.version++;

    const activeHazards = this.listHazards();
    return this.createSnapshot(activeHazards, currentNow);
  }

  private createSnapshot(
    activeHazards: readonly FloodHazard[],
    generatedAt: Date,
  ): FloodHazardSnapshot {
    return {
      snapshotId: `snapshot_${this.snapshotInstanceId}_v${this.version}_${activeHazards.length}`,
      generatedAt,
      validUntil: earliestValidUntil(activeHazards),
      hazards: activeHazards,
      source: 'SIMULATED',
    };
  }
}

function earliestValidUntil(hazards: readonly FloodHazard[]): Date | null {
  if (hazards.length === 0) return null;
  let earliest: Date | null = null;
  for (const hazard of hazards) {
    if (earliest === null || hazard.validUntil.getTime() < earliest.getTime()) {
      earliest = hazard.validUntil;
    }
  }
  return earliest;
}
