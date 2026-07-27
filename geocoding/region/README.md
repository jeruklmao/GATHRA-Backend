# GATHRA geocoding coverage

`region-config.json` is the machine-readable source of truth for backend
coverage classification and Pelias query boundaries.
`supported-region.geojson` is the rectangular, buffered import boundary.
`administrative-boundaries.geojson` contains the four actual OSM relation
polygons used to classify quality-corpus points as `CORE`; city bounding boxes
must never be used as a substitute for those polygons.

The four administrative envelopes come from these OpenStreetMap boundary
relations:

| Area | OSM relation |
| --- | ---: |
| Jakarta Pusat | 7625977 |
| Jakarta Selatan | 5802438 |
| Kota Tangerang | 7641583 |
| Kota Tangerang Selatan | 7641582 |

The committed pilot uses an 8 km outward buffer around their combined
administrative envelope. The result is intentionally larger than the exact
boundaries so roads, POIs, and reverse-geocode labels remain available near
borders. The rectangular envelope is a reproducible MVP choice; it is not a
claim that every point in the buffer belongs to a supported city.

The relation geometries were extracted from the pinned local PBF with:

```bash
osmium getid -r -t regional-source.osm.pbf \
  r7625977 r5802438 r7641583 r7641582 \
  -o administrative-boundaries.osm.pbf
osmium export administrative-boundaries.osm.pbf -f geojsonseq
```

The relation bounds were queried from OpenStreetMap in June/July 2026 and
recorded in `region-config.json`. When boundaries or buffer policy changes:

1. increment `regionConfigVersion`;
2. update the recorded relation snapshot, actual polygons, and bounds;
3. regenerate `supported-region.geojson`;
4. regenerate both the raw Pelias PBF and GraphHopper's routing-filtered PBF;
5. rebuild into a candidate index and rerun quality checks.

The raw OSM input is ODbL-licensed. Preserve OpenStreetMap attribution and the
source/dataset metadata when distributing derived data.
