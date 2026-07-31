# Geocoding quality corpus

`geocoding-quality-corpus.json` is a **source-derived smoke corpus**, not an
independently verified address register. Its 124 blocking/smoke cases comprise:

- 88 canonical `CORE` searches: 20 roads, 20 schools, 16 hospitals/clinics,
  16 landmarks/public buildings, and 16 neighbourhoods;
- 16 abbreviation, alias, and common-typo variants (including `Tanggerang`);
- 12 `CORE` reverse-geocode assertions;
- 4 `BUFFER` searches that are inside the configured service buffer but outside
  all four core administrative polygons;
- 4 `OUTSIDE` policy sentinels beyond the buffered coverage.

Every source-derived coordinate and name was mechanically read from the local
OSM snapshot recorded in corpus provenance. Core membership was calculated
with point-in-polygon against the actual OSM relations in
`../region/administrative-boundaries.geojson`; rectangular city-envelope
assignment is deliberately rejected by the runner.

`SOURCE_DERIVED` proves traceability to that OSM snapshot. It does **not** mean
an institution, municipal dataset, or field survey verified that a feature is
current, correctly named, or open to the public. The report therefore always
prints the independently verified count. This pilot has `0/100 VERIFIED` cases
and must not be described as acceptance-grade.

## Gates and metrics

The runner performs a preflight before making requests:

- schema/config version consistency;
- unique case IDs and explicit verification status;
- provenance and required category quotas;
- exact `CORE`, `BUFFER`, and `OUTSIDE` classification;
- meaningful reverse name, address, category, expected-context, and coordinate
  assertions.

Blocking smoke thresholds are versioned in the corpus:

- canonical top-3 success at least 85%;
- outside-region false-positive rate exactly 0%;
- normalized reverse coordinate preservation exactly 100%;
- reverse name/readable-address/category success at least the threshold shown
  in the corpus.

Exact expected administrative-context text is reported separately and remains
informational. Photon commonly returns valid local context such as
`DKI Jakarta` or `Jakarta` where an earlier provider returned
`Jakarta Pusat`; the blocking gate must not encode one provider's hierarchy
wording. The report still exposes this difference for data-quality follow-up.

Median and p95 response time are reported but are informational because
developer host load is not controlled. Variant ranking is also informational
until the corpus has independent verification.

## Run

Against the normalized NestJS API:

```bash
backend/geocoding/scripts/run-quality-tests.sh
```

Against the private raw Photon service:

```bash
backend/geocoding/scripts/run-quality-tests.sh --raw-photon
```

Raw Photon mode skips the four NestJS outside-policy sentinels and cannot assert
that reverse responses preserve the user's original coordinate. Always run the
normalized mode before accepting a replacement data volume.

To make independent verification a hard prerequisite in a future acceptance
pipeline, set:

```bash
GEOCODING_QUALITY_REQUIRE_VERIFIED=true \
  backend/geocoding/scripts/run-quality-tests.sh
```

That mode intentionally fails until at least 100 cases have been promoted to
`VERIFIED` with a documented authoritative source and review record.
