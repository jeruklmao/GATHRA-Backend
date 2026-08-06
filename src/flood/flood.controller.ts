import { Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiException } from '../common/api-error';
import { FLOOD_HAZARD_PROVIDER, type FloodHazardProvider } from './flood-hazard.provider';
import { FloodHazardsQueryDto } from './dto/flood-hazards-query.dto';
import type { FloodHazardsResponseDto } from './dto/flood-hazards-response.dto';
import type { FloodHazard } from './models/flood-hazard';

@ApiTags('flood-hazards')
@Controller({ path: 'flood-hazards', version: '1' })
export class FloodController {
  constructor(
    @Inject(FLOOD_HAZARD_PROVIDER)
    private readonly provider: FloodHazardProvider,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Get active flood hazard polygons (Read-Only)',
    description:
      'Returns active, non-expired flood hazard polygons in GeoJSON FeatureCollection format with snapshot metadata.',
  })
  async getActiveHazards(
    @Query() query: FloodHazardsQueryDto,
  ): Promise<FloodHazardsResponseDto> {
    const bboxParams = [query.minLat, query.minLon, query.maxLat, query.maxLon];
    const suppliedCount = bboxParams.filter((val) => val !== undefined).length;

    if (suppliedCount > 0 && suppliedCount < 4) {
      throw ApiException.validation([
        {
          field: 'bbox',
          reason:
            'Must supply all four bounding box parameters (minLat, minLon, maxLat, maxLon) or omit all of them.',
        },
      ]);
    }

    let bboxFilter: { minLat: number; minLon: number; maxLat: number; maxLon: number } | null = null;
    if (suppliedCount === 4) {
      const minLat = Number(query.minLat);
      const minLon = Number(query.minLon);
      const maxLat = Number(query.maxLat);
      const maxLon = Number(query.maxLon);

      if (
        !Number.isFinite(minLat) ||
        !Number.isFinite(minLon) ||
        !Number.isFinite(maxLat) ||
        !Number.isFinite(maxLon)
      ) {
        throw ApiException.validation([
          { field: 'bbox', reason: 'Bounding box coordinates must be finite numbers.' },
        ]);
      }

      if (minLat >= maxLat) {
        throw ApiException.validation([
          { field: 'minLat', reason: 'minLat must be strictly less than maxLat.' },
        ]);
      }

      if (minLon >= maxLon) {
        throw ApiException.validation([
          { field: 'minLon', reason: 'minLon must be strictly less than maxLon.' },
        ]);
      }

      bboxFilter = { minLat, minLon, maxLat, maxLon };
    }

    const snapshot = await this.provider.getActiveSnapshot({});

    let hazards = snapshot.hazards;
    if (bboxFilter) {
      hazards = hazards.filter((hazard) =>
        hazardIntersectsBbox(hazard, bboxFilter!),
      );
    }

    const features = hazards.map((h) => ({
      type: 'Feature' as const,
      id: h.id,
      properties: {
        riskLevel: h.level,
        confidence: h.confidence,
        description: h.description ?? null,
        observedAt: h.observedAt.toISOString(),
        validUntil: h.validUntil ? h.validUntil.toISOString() : null,
        source: snapshot.source,
        sourceNodeIds: h.sourceNodeIds ? [...h.sourceNodeIds] : [],
      },
      geometry: h.geometry,
    }));

    return {
      type: 'FeatureCollection',
      snapshotId: snapshot.snapshotId,
      generatedAt: snapshot.generatedAt.toISOString(),
      validUntil: snapshot.validUntil ? snapshot.validUntil.toISOString() : null,
      source: snapshot.source,
      features,
    };
  }
}

function hazardIntersectsBbox(
  hazard: FloodHazard,
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number },
): boolean {
  for (const ring of hazard.geometry.coordinates) {
    for (const [lon, lat] of ring) {
      if (
        lat >= bbox.minLat &&
        lat <= bbox.maxLat &&
        lon >= bbox.minLon &&
        lon <= bbox.maxLon
      ) {
        return true;
      }
    }
  }

  // Also check polygon envelope overlap
  let polyMinLat = Infinity;
  let polyMaxLat = -Infinity;
  let polyMinLon = Infinity;
  let polyMaxLon = -Infinity;

  for (const ring of hazard.geometry.coordinates) {
    for (const [lon, lat] of ring) {
      if (lat < polyMinLat) polyMinLat = lat;
      if (lat > polyMaxLat) polyMaxLat = lat;
      if (lon < polyMinLon) polyMinLon = lon;
      if (lon > polyMaxLon) polyMaxLon = lon;
    }
  }

  return (
    polyMinLat <= bbox.maxLat &&
    polyMaxLat >= bbox.minLat &&
    polyMinLon <= bbox.maxLon &&
    polyMaxLon >= bbox.minLon
  );
}
