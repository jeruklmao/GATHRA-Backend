import { Inject, Injectable, Optional } from '@nestjs/common';
import type { FloodHazardProvider } from '../flood-hazard.provider';
import {
  validateFloodHazard,
  MAX_ACTIVE_FLOOD_HAZARDS,
  FloodGeometryValidationError,
} from '../geometry/flood-geometry.validator';
import type {
  FloodHazard,
  FloodHazardQueryInput,
  FloodHazardSnapshot,
} from '../models/flood-hazard';

export const NOW_FN = Symbol('NOW_FN');

@Injectable()
export class InMemoryFloodHazardProvider implements FloodHazardProvider {
  private hazardsMap = new Map<string, FloodHazard>();
  private version = 0;

  constructor(
    @Optional()
    @Inject(NOW_FN)
    private readonly customNowFn?: () => Date,
  ) {}

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

    const snapshotId = `snapshot_v${this.version}_${activeHazards.length}`;

    return {
      snapshotId,
      generatedAt: currentNow,
      validUntil: earliestValidUntil(activeHazards),
      hazards: activeHazards,
      source: 'SIMULATED',
    };
  }

  addHazard(hazardData: unknown): FloodHazard {
    const hazard = validateFloodHazard(hazardData);
    if (
      this.hazardsMap.size >= MAX_ACTIVE_FLOOD_HAZARDS &&
      !this.hazardsMap.has(hazard.id)
    ) {
      throw new FloodGeometryValidationError(
        `Cannot exceed maximum active hazard limit of ${MAX_ACTIVE_FLOOD_HAZARDS}`,
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

    const hazard: FloodHazard = {
      id: `preset_central_corridor_${level.toLowerCase()}`,
      level,
      geometry: centralCorridorPolygon,
      confidence: 0.95,
      observedAt: currentNow,
      validUntil,
      sourceNodeIds: ['node_central_01', 'node_central_02'],
      description: `Simulated ${level} flood hazard blocking/penalizing central corridor`,
    };

    const userHazard: FloodHazard = {
      id: `preset_user_custom_${level.toLowerCase()}`,
      level,
      geometry: userCustomPolygon,
      confidence: 0.95,
      observedAt: currentNow,
      validUntil,
      sourceNodeIds: ['node_user_01', 'node_user_02'],
      description: `Simulated ${level} flood hazard requested polygon`,
    };

    this.hazardsMap.set(hazard.id, hazard);
    this.hazardsMap.set(userHazard.id, userHazard);
    this.version++;

    const activeHazards = Array.from(this.hazardsMap.values());
    return {
      snapshotId: `snapshot_v${this.version}_${activeHazards.length}`,
      generatedAt: currentNow,
      validUntil,
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
