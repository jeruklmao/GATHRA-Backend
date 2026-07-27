import type {
  FloodHazardQueryInput,
  FloodHazardSnapshot,
} from './models/flood-hazard';

export const FLOOD_HAZARD_PROVIDER = Symbol('FLOOD_HAZARD_PROVIDER');

export interface FloodHazardProvider {
  getActiveSnapshot(
    input: FloodHazardQueryInput,
  ): Promise<FloodHazardSnapshot>;
}
