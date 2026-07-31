import { readFile } from 'node:fs/promises';

const mode = process.env.GEOCODING_QUALITY_MODE ?? 'backend';
const baseUrl = (process.env.GEOCODING_QUALITY_BASE_URL ??
  'http://backend:3000/api/v1/geocoding').replace(/\/+$/, '');
const corpusPath = process.env.GEOCODING_QUALITY_CORPUS ??
  '/quality/geocoding-quality-corpus.json';
const regionConfigPath = process.env.GEOCODING_QUALITY_REGION_CONFIG ??
  '/region/region-config.json';
const administrativeBoundariesPath =
  process.env.GEOCODING_QUALITY_ADMIN_BOUNDARIES ??
  '/region/administrative-boundaries.geojson';
const concurrency = Math.max(
  1,
  Math.min(8, Number(process.env.GEOCODING_QUALITY_CONCURRENCY ?? 4)),
);
const timeoutMs = Math.max(
  500,
  Number(process.env.GEOCODING_QUALITY_TIMEOUT_MS ?? 4000),
);
const requireVerifiedAcceptance =
  process.env.GEOCODING_QUALITY_REQUIRE_VERIFIED === 'true';

if (!['backend', 'photon'].includes(mode)) {
  throw new Error(`Unsupported GEOCODING_QUALITY_MODE: ${mode}`);
}

const [corpus, regionConfig, administrativeBoundaries] = await Promise.all(
  [
    corpusPath,
    regionConfigPath,
    administrativeBoundariesPath,
  ].map(async (path) => JSON.parse(await readFile(path, 'utf8'))),
);

const thresholds = corpus.blockingThresholds;
const informationalTargets = corpus.informationalTargets;
const regionBounds = readBounds(regionConfig);
const coreBoundaries = administrativeBoundaries.features ?? [];

const normalize = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('id-ID')
    .replace(/\s+/g, ' ')
    .trim();

const pointForCase = (testCase) => testCase.focus ?? testCase.point ?? null;

const insideBounds = (point) =>
  point != null &&
  point.longitude >= regionBounds.west &&
  point.longitude <= regionBounds.east &&
  point.latitude >= regionBounds.south &&
  point.latitude <= regionBounds.north;

const toRadians = (degrees) => degrees * Math.PI / 180;
const distanceMeters = (a, b) => {
  const earthRadiusMeters = 6_371_008.8;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(h)));
};

const boundaryContaining = (point) =>
  coreBoundaries.find((feature) =>
    geometryContains(feature.geometry, [point.longitude, point.latitude]),
  );

const preflightErrors = validateCorpus();
if (preflightErrors.length > 0) {
  console.error('GATHRA geocoding quality preflight failed:');
  for (const error of preflightErrors.slice(0, 50)) {
    console.error(`- ${error}`);
  }
  if (preflightErrors.length > 50) {
    console.error(`- ...and ${preflightErrors.length - 50} more`);
  }
  process.exit(2);
}
if (process.env.GEOCODING_QUALITY_PREFLIGHT_ONLY === 'true') {
  const verifiedCount = corpus.cases.filter(
    (testCase) => testCase.verificationStatus === 'VERIFIED',
  ).length;
  console.log(
    `QUALITY PREFLIGHT PASS: ${corpus.cases.length} cases, ${verifiedCount}/${corpus.qualityGate.requiredVerifiedCasesForAcceptance} independently VERIFIED`,
  );
  process.exit(0);
}

const readErrorCode = (payload) =>
  payload?.error?.code ?? payload?.code ?? payload?.errorCode ?? null;

const positionFromFeature = (feature) => {
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  return {
    latitude: Number(coordinates[1]),
    longitude: Number(coordinates[0]),
  };
};

const normalizeEvaluationCategory = (value, fallbackText = '') => {
  const category = normalize(value).replaceAll(' ', '_').toUpperCase();
  if (['SCHOOL', 'COLLEGE', 'UNIVERSITY', 'EDUCATION'].includes(category)) {
    return 'SCHOOL';
  }
  if (
    ['HOSPITAL', 'CLINIC', 'DOCTOR', 'DOCTORS', 'HEALTH', 'HEALTHCARE'].includes(
      category,
    )
  ) {
    return 'HEALTH';
  }
  if (['ROAD', 'STREET', 'ADDRESS'].includes(category)) return 'ROAD';
  if (
    [
      'LANDMARK',
      'GOVERNMENT',
      'TRANSIT',
      'VENUE',
      'STATION',
      'MUSEUM',
    ].includes(category)
  ) {
    const text = normalize(fallbackText);
    if (/(school|sekolah|sma |sman |universitas|university)/u.test(text)) {
      return 'SCHOOL';
    }
    if (/(hospital|rumah sakit|rsud|rsup|klinik|clinic)/u.test(text)) {
      return 'HEALTH';
    }
    return 'LANDMARK';
  }
  if (
    [
      'AREA',
      'NEIGHBOURHOOD',
      'NEIGHBORHOOD',
      'LOCALITY',
      'LOCALADMIN',
      'BOROUGH',
      'COUNTY',
      'REGION',
    ].includes(category)
  ) {
    return 'AREA';
  }
  const text = normalize(`${value ?? ''} ${fallbackText}`);
  if (/(school|sekolah|sma |sman |universitas|university)/u.test(text)) {
    return 'SCHOOL';
  }
  if (/(hospital|rumah sakit|rsud|rsup|klinik|clinic)/u.test(text)) {
    return 'HEALTH';
  }
  return category || null;
};

const normalizePhotonFeatures = (payload) =>
  Array.isArray(payload?.features)
    ? payload.features.map((feature) => {
        const position = positionFromFeature(feature);
        const primaryText =
          feature?.properties?.name ??
          feature?.properties?.street ??
          feature?.properties?.city ??
          '';
        const secondaryText = [
          feature?.properties?.street,
          feature?.properties?.housenumber,
          feature?.properties?.district ?? feature?.properties?.locality,
          feature?.properties?.city ?? feature?.properties?.county,
          feature?.properties?.state,
          feature?.properties?.country,
        ]
          .filter(Boolean)
          .filter((value) => value !== primaryText)
          .join(', ');
        const rawCategories = [
          feature?.properties?.osm_value,
          feature?.properties?.osm_key,
          feature?.properties?.type,
        ].filter(Boolean);
        const category = rawCategories
          .map((value) =>
            normalizeEvaluationCategory(
              value,
              `${primaryText} ${secondaryText}`,
            ),
          )
          .find((value) =>
            ['ROAD', 'SCHOOL', 'HEALTH', 'LANDMARK', 'AREA'].includes(value),
          );
        return {
          primaryText,
          secondaryText,
          position,
          category,
          insideSupportedRegion: insideBounds(position),
        };
      })
    : [];

const normalizeBackendSuggestions = (payload) => {
  const values = payload?.suggestions ?? payload?.results ?? [];
  return Array.isArray(values)
    ? values.map((value) => ({
        primaryText: value?.primaryText ?? value?.name ?? '',
        secondaryText: value?.secondaryText ?? value?.formattedAddress ?? '',
        position: value?.position ?? null,
        category: normalizeEvaluationCategory(
          value?.category,
          `${value?.primaryText ?? value?.name ?? ''} ${
            value?.secondaryText ?? value?.formattedAddress ?? ''
          }`,
        ),
        insideSupportedRegion: value?.insideSupportedRegion,
      }))
    : [];
};

const normalizeBackendDetails = (payload) => {
  const value = payload?.place ?? payload;
  const primaryText = value?.name ?? '';
  const secondaryText = value?.formattedAddress ?? '';
  return {
    primaryText,
    secondaryText,
    position: value?.position ?? null,
    category: normalizeEvaluationCategory(
      value?.category,
      `${primaryText} ${secondaryText}`,
    ),
    insideSupportedRegion: value?.insideSupportedRegion,
  };
};

const buildUrl = (testCase) => {
  const endpoint =
    mode === 'photon'
      ? testCase.kind === 'REVERSE'
        ? 'reverse'
        : 'api'
      : testCase.kind.toLowerCase();
  const url = new URL(`${baseUrl}/${endpoint}`);

  if (testCase.kind === 'REVERSE') {
    if (mode === 'photon') {
      url.searchParams.set('lat', testCase.point.latitude);
      url.searchParams.set('lon', testCase.point.longitude);
      url.searchParams.set('limit', '1');
    } else {
      url.searchParams.set('lat', testCase.point.latitude);
      url.searchParams.set('lon', testCase.point.longitude);
    }
    return url;
  }

  if (mode === 'photon') {
    url.searchParams.set('q', testCase.query);
    url.searchParams.set('lat', testCase.focus.latitude);
    url.searchParams.set('lon', testCase.focus.longitude);
    url.searchParams.set(
      'bbox',
      [
        regionBounds.west,
        regionBounds.south,
        regionBounds.east,
        regionBounds.north,
      ].join(','),
    );
    url.searchParams.set('limit', '8');
  } else {
    url.searchParams.set('q', testCase.query);
    url.searchParams.set('lat', testCase.focus.latitude);
    url.searchParams.set('lon', testCase.focus.longitude);
    url.searchParams.set('limit', '8');
    url.searchParams.set('language', 'id');
  }
  return url;
};

const evaluateCase = async (testCase) => {
  if (
    mode === 'photon' &&
    testCase.kind === 'REVERSE' &&
    testCase.coverageClass === 'OUTSIDE'
  ) {
    return { testCase, skipped: true, elapsedMs: 0 };
  }

  const startedAt = performance.now();
  let response;
  let payload = null;
  try {
    response = await fetch(buildUrl(testCase), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
    payload = await response.json().catch(() => null);
  } catch (error) {
    return {
      testCase,
      elapsedMs: performance.now() - startedAt,
      requestError: error instanceof Error ? error.message : String(error),
      noResult: testCase.kind !== 'REVERSE',
    };
  }

  const elapsedMs = performance.now() - startedAt;
  if (testCase.kind === 'REVERSE') {
    if (testCase.coverageClass === 'OUTSIDE') {
      const normalized = normalizeBackendDetails(payload);
      const rejected =
        !response.ok ||
        readErrorCode(payload) === 'OUTSIDE_SUPPORTED_REGION' ||
        normalized.insideSupportedRegion === false;
      return {
        testCase,
        elapsedMs,
        outsideFalsePositive: !rejected,
        responseStatus: response.status,
      };
    }

    const details = mode === 'photon'
      ? normalizePhotonFeatures(payload)[0]
      : normalizeBackendDetails(payload);
    const combinedLabel =
      `${details?.primaryText ?? ''} ${details?.secondaryText ?? ''}`.trim();
    const nameMatches = normalize(combinedLabel).includes(
      normalize(testCase.expected.nameContains),
    );
    const contextMatches = normalize(combinedLabel).includes(
      normalize(testCase.expected.contextContains),
    );
    const addressPresent =
      normalize(details?.secondaryText ?? '').length > 0;
    const categoryMatches =
      details?.category === testCase.expected.category;
    const coordinatePreserved =
      mode === 'backend' &&
      details?.position != null &&
      distanceMeters(testCase.point, details.position) <=
        testCase.expected.maxCoordinateDeltaMeters;
    return {
      testCase,
      elapsedMs,
      reverseAssertionSuccess:
        response.ok &&
        details?.insideSupportedRegion !== false &&
        nameMatches &&
        addressPresent &&
        categoryMatches,
      coordinatePreserved,
      nameMatches,
      addressPresent,
      contextMatches,
      categoryMatches,
      responseStatus: response.status,
    };
  }

  const suggestions = mode === 'photon'
    ? normalizePhotonFeatures(payload)
    : normalizeBackendSuggestions(payload);
  const expectedName = normalize(testCase.expected.nameContains);
  const matchIndex = suggestions.findIndex((suggestion) =>
    normalize(
      `${suggestion.primaryText} ${suggestion.secondaryText}`,
    ).includes(expectedName),
  );
  const match = matchIndex >= 0 ? suggestions[matchIndex] : null;
  const withinDistance =
    match?.position == null ||
    distanceMeters(testCase.focus, match.position) <=
      testCase.expected.maxDistanceMeters;
  const supported = match?.insideSupportedRegion !== false;

  return {
    testCase,
    elapsedMs,
    noResult: !response.ok || suggestions.length === 0,
    rank: matchIndex >= 0 && withinDistance && supported ? matchIndex + 1 : null,
    responseStatus: response.status,
  };
};

const mapConcurrent = async (values, workerCount, operation) => {
  const results = new Array(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= values.length) return;
        results[index] = await operation(values[index]);
      }
    }),
  );
  return results;
};

const results = await mapConcurrent(corpus.cases, concurrency, evaluateCase);
const measured = results.filter((result) => !result.skipped);
const canonicalResults = measured.filter(
  (result) =>
    result.testCase.queryClass === 'CANONICAL' &&
    ['AUTOCOMPLETE', 'SEARCH'].includes(result.testCase.kind),
);
const variantResults = measured.filter(
  (result) =>
    result.testCase.queryClass === 'VARIANT' &&
    ['AUTOCOMPLETE', 'SEARCH'].includes(result.testCase.kind),
);
const bufferResults = measured.filter(
  (result) =>
    result.testCase.coverageClass === 'BUFFER' &&
    ['AUTOCOMPLETE', 'SEARCH'].includes(result.testCase.kind),
);
const reverseResults = measured.filter(
  (result) =>
    result.testCase.kind === 'REVERSE' &&
    result.testCase.coverageClass === 'CORE',
);
const outsideResults = measured.filter(
  (result) =>
    result.testCase.kind === 'REVERSE' &&
    result.testCase.coverageClass === 'OUTSIDE',
);

const ratio = (count, total) => (total === 0 ? 0 : count / total);
const rankedRate = (values, maxRank) =>
  ratio(
    values.filter(
      (result) => result.rank != null && result.rank <= maxRank,
    ).length,
    values.length,
  );
const canonicalTop1SuccessRate = rankedRate(canonicalResults, 1);
const canonicalTop3SuccessRate = rankedRate(canonicalResults, 3);
const variantTop3SuccessRate = rankedRate(variantResults, 3);
const bufferTop3SuccessRate = rankedRate(bufferResults, 3);
const canonicalNoResultRate = ratio(
  canonicalResults.filter((result) => result.noResult).length,
  canonicalResults.length,
);
const reverseAssertionSuccessRate = ratio(
  reverseResults.filter((result) => result.reverseAssertionSuccess).length,
  reverseResults.length,
);
const reverseExpectedContextMatchRate = ratio(
  reverseResults.filter((result) => result.contextMatches).length,
  reverseResults.length,
);
const reverseCoordinatePreservationRate = ratio(
  reverseResults.filter((result) => result.coordinatePreserved).length,
  reverseResults.length,
);
const outsideRegionFalsePositiveRate = ratio(
  outsideResults.filter((result) => result.outsideFalsePositive).length,
  outsideResults.length,
);
const sortedLatencies = measured
  .map((result) => result.elapsedMs)
  .sort((a, b) => a - b);
const percentile = (values, p) =>
  values.length === 0
    ? 0
    : values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
const medianResponseTimeMs = percentile(sortedLatencies, 0.5);
const p95ResponseTimeMs = percentile(sortedLatencies, 0.95);

const failures = [];
if (
  canonicalTop1SuccessRate <
  thresholds.minCanonicalTop1SuccessRate
) {
  failures.push(
    `canonical top-1 ${canonicalTop1SuccessRate.toFixed(3)} < ${
      thresholds.minCanonicalTop1SuccessRate
    }`,
  );
}
if (
  canonicalTop3SuccessRate <
  thresholds.minCanonicalTop3SuccessRate
) {
  failures.push(
    `canonical top-3 ${canonicalTop3SuccessRate.toFixed(3)} < ${
      thresholds.minCanonicalTop3SuccessRate
    }`,
  );
}
if (
  canonicalNoResultRate >
  thresholds.maxCanonicalNoResultRate
) {
  failures.push(
    `canonical no-result ${canonicalNoResultRate.toFixed(3)} > ${
      thresholds.maxCanonicalNoResultRate
    }`,
  );
}
if (
  reverseAssertionSuccessRate <
  thresholds.minReverseLabelAddressCategorySuccessRate
) {
  failures.push(
    `reverse name/address/category ${reverseAssertionSuccessRate.toFixed(3)} < ${
      thresholds.minReverseLabelAddressCategorySuccessRate
    }`,
  );
}
if (
  mode === 'backend' &&
  reverseCoordinatePreservationRate <
    thresholds.minReverseCoordinatePreservationRate
) {
  failures.push(
    `reverse coordinate preservation ${reverseCoordinatePreservationRate.toFixed(
      3,
    )} < ${thresholds.minReverseCoordinatePreservationRate}`,
  );
}
if (
  mode === 'backend' &&
  outsideRegionFalsePositiveRate >
    thresholds.maxOutsideRegionFalsePositiveRate
) {
  failures.push(
    `outside false-positive ${outsideRegionFalsePositiveRate.toFixed(3)} > ${
      thresholds.maxOutsideRegionFalsePositiveRate
    }`,
  );
}

const percent = (value) => `${(value * 100).toFixed(1)}%`;
const verifiedCount = corpus.cases.filter(
  (testCase) => testCase.verificationStatus === 'VERIFIED',
).length;
const requiredVerified =
  corpus.qualityGate.requiredVerifiedCasesForAcceptance;

console.log('GATHRA geocoding quality report');
console.log(`Corpus: ${corpus.corpusVersion} (${corpus.corpusType})`);
console.log(`Mode/base: ${mode} ${baseUrl}`);
console.log(
  `Cases: ${measured.length} measured, ${results.length - measured.length} skipped`,
);
console.log(`Canonical top-1 success: ${percent(canonicalTop1SuccessRate)}`);
console.log(`Canonical top-3 success: ${percent(canonicalTop3SuccessRate)}`);
console.log(`Canonical no-result rate: ${percent(canonicalNoResultRate)}`);
console.log(`Variant top-3 success: ${percent(variantTop3SuccessRate)}`);
console.log(`Buffer top-3 success: ${percent(bufferTop3SuccessRate)}`);
console.log(
  `Reverse name/address/category success: ${percent(
    reverseAssertionSuccessRate,
  )}`,
);
console.log(
  `Reverse expected administrative-context match (informational): ${percent(
    reverseExpectedContextMatchRate,
  )}`,
);
console.log(
  `Reverse coordinate preservation: ${
    mode === 'backend'
      ? percent(reverseCoordinatePreservationRate)
      : 'n/a for raw Photon'
  }`,
);
console.log(
  `Outside-region false-positive: ${
    mode === 'backend'
      ? percent(outsideRegionFalsePositiveRate)
      : 'n/a for raw Photon'
  }`,
);
console.log(
  `Latency (informational): median ${medianResponseTimeMs.toFixed(
    0,
  )}ms, p95 ${p95ResponseTimeMs.toFixed(0)}ms; target p95 <= ${
    informationalTargets.maxP95ResponseTimeMs
  }ms`,
);
console.log(
  `Independent verification: ${verifiedCount}/${requiredVerified} VERIFIED cases`,
);
if (verifiedCount < requiredVerified) {
  console.log(
    'Acceptance readiness: INSUFFICIENT — this is a SOURCE_DERIVED smoke gate, not an independently verified acceptance corpus.',
  );
}

const caseIssues = measured.filter(
  (result) =>
    result.requestError ||
    result.noResult ||
    (['AUTOCOMPLETE', 'SEARCH'].includes(result.testCase.kind) &&
      result.rank == null) ||
    (result.testCase.kind === 'REVERSE' &&
      result.testCase.coverageClass === 'CORE' &&
      (!result.reverseAssertionSuccess ||
        (mode === 'backend' && !result.coordinatePreserved))) ||
    result.outsideFalsePositive,
);
if (caseIssues.length > 0) {
  console.log(`Case issues (${caseIssues.length}; first 20):`);
  for (const result of caseIssues.slice(0, 20)) {
    const reverseDetails =
      result.testCase.kind === 'REVERSE'
        ? `name=${Boolean(result.nameMatches)} address=${Boolean(
            result.addressPresent,
          )} context=${Boolean(
            result.contextMatches,
          )} category=${Boolean(result.categoryMatches)} coordinate=${Boolean(
            result.coordinatePreserved,
          )}`
        : 'expected rank/policy not satisfied';
    console.log(
      `- ${result.testCase.id}: ${
        result.requestError ??
        (result.noResult ? 'no result' : reverseDetails)
      }`,
    );
  }
}

if (
  p95ResponseTimeMs > informationalTargets.maxP95ResponseTimeMs
) {
  console.log(
    'Informational note: the p95 latency target was missed; latency is intentionally not a blocking gate on arbitrary developer hosts.',
  );
}
if (
  variantTop3SuccessRate < informationalTargets.minVariantTop3SuccessRate
) {
  console.log(
    'Informational note: the variant top-3 target was missed; review typo/alias coverage before promotion.',
  );
}
if (requireVerifiedAcceptance && verifiedCount < requiredVerified) {
  failures.push(
    `verified acceptance cases ${verifiedCount} < ${requiredVerified}`,
  );
}

if (failures.length > 0) {
  console.error(`QUALITY FAIL: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('SOURCE-DERIVED SMOKE QUALITY PASS');

function readBounds(config) {
  if (config?.bounds != null) {
    return {
      west: Number(config.bounds.west),
      south: Number(config.bounds.south),
      east: Number(config.bounds.east),
      north: Number(config.bounds.north),
    };
  }
  const bounds = config?.bufferedBoundingBox;
  return {
    west: Number(bounds?.minLongitude),
    south: Number(bounds?.minLatitude),
    east: Number(bounds?.maxLongitude),
    north: Number(bounds?.maxLatitude),
  };
}

function geometryContains(geometry, point) {
  if (geometry?.type === 'Polygon') {
    return polygonContains(geometry.coordinates, point);
  }
  if (geometry?.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) =>
      polygonContains(polygon, point),
    );
  }
  return false;
}

function polygonContains(polygon, point) {
  if (!ringContains(polygon[0], point)) return false;
  return !polygon.slice(1).some((hole) => ringContains(hole, point));
}

function ringContains(ring, [x, y]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index++) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[previous];
    if (
      (y1 > y) !== (y2 > y) &&
      x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function validateCorpus() {
  const errors = [];
  if (corpus.schemaVersion !== 2) {
    errors.push(`unsupported schemaVersion ${corpus.schemaVersion}`);
  }
  const configVersion =
    regionConfig.version ?? regionConfig.regionConfigVersion;
  if (corpus.regionConfigVersion !== configVersion) {
    errors.push(
      `region version mismatch: corpus=${corpus.regionConfigVersion} config=${configVersion}`,
    );
  }
  if (
    ![
      regionBounds.west,
      regionBounds.south,
      regionBounds.east,
      regionBounds.north,
    ].every(Number.isFinite)
  ) {
    errors.push('region configuration has invalid bounds');
  }
  if (!Array.isArray(corpus.cases) || corpus.cases.length < 100) {
    errors.push('corpus must contain at least 100 cases');
    return errors;
  }

  const ids = new Set();
  for (const testCase of corpus.cases) {
    if (ids.has(testCase.id)) {
      errors.push(`duplicate case id ${testCase.id}`);
    }
    ids.add(testCase.id);
    if (testCase.verificationStatus !== testCase.provenance?.verificationStatus) {
      errors.push(`${testCase.id}: verification status/provenance mismatch`);
    }
    const point = pointForCase(testCase);
    if (
      point == null ||
      !Number.isFinite(point.latitude) ||
      !Number.isFinite(point.longitude)
    ) {
      errors.push(`${testCase.id}: missing or invalid coordinate`);
      continue;
    }
    const coreBoundary = boundaryContaining(point);
    if (testCase.coverageClass === 'CORE') {
      const actualRegion = coreBoundary?.properties?.gathraCode;
      if (actualRegion !== testCase.region) {
        errors.push(
          `${testCase.id}: core polygon says ${actualRegion ?? 'none'}, case says ${
            testCase.region
          }`,
        );
      }
      const provenanceRelation =
        testCase.provenance?.administrativeClassification?.osmRelationId;
      if (
        provenanceRelation !== coreBoundary?.properties?.osmRelationId
      ) {
        errors.push(`${testCase.id}: administrative relation provenance mismatch`);
      }
    } else if (testCase.coverageClass === 'BUFFER') {
      if (!insideBounds(point) || coreBoundary != null) {
        errors.push(`${testCase.id}: BUFFER point is not buffer-only`);
      }
      if (testCase.region !== 'BUFFER') {
        errors.push(`${testCase.id}: BUFFER case must use region BUFFER`);
      }
    } else if (testCase.coverageClass === 'OUTSIDE') {
      if (insideBounds(point)) {
        errors.push(`${testCase.id}: OUTSIDE point is inside configured bounds`);
      }
      if (testCase.region !== 'OUTSIDE') {
        errors.push(`${testCase.id}: OUTSIDE case must use region OUTSIDE`);
      }
    } else {
      errors.push(`${testCase.id}: unknown coverage class`);
    }

    if (testCase.kind === 'REVERSE') {
      if (testCase.point == null) {
        errors.push(`${testCase.id}: reverse case requires point`);
      }
      if (
        testCase.coverageClass === 'CORE' &&
        (!testCase.expected?.nameContains ||
          !testCase.expected?.contextContains ||
          !testCase.expected?.category ||
          testCase.expected?.maxCoordinateDeltaMeters == null)
      ) {
        errors.push(
          `${testCase.id}: core reverse case requires name/address/context/category/coordinate assertions`,
        );
      }
    } else if (!testCase.query || testCase.focus == null) {
      errors.push(`${testCase.id}: search case requires query and focus`);
    }
  }

  const actualVerified = corpus.cases.filter(
    (testCase) => testCase.verificationStatus === 'VERIFIED',
  ).length;
  if (actualVerified !== corpus.qualityGate.committedVerifiedCases) {
    errors.push(
      `verified case count mismatch: metadata=${corpus.qualityGate.committedVerifiedCases} actual=${actualVerified}`,
    );
  }
  if (
    corpus.qualityGate.acceptanceReady !==
    (actualVerified >= corpus.qualityGate.requiredVerifiedCasesForAcceptance)
  ) {
    errors.push('qualityGate.acceptanceReady does not match verified case count');
  }

  const canonicalCore = corpus.cases.filter(
    (testCase) =>
      testCase.coverageClass === 'CORE' &&
      testCase.queryClass === 'CANONICAL',
  );
  for (const [category, minimum] of Object.entries(
    corpus.quotaRequirements.coreCanonical,
  )) {
    const count = canonicalCore.filter(
      (testCase) => testCase.category === category,
    ).length;
    if (count < minimum) {
      errors.push(`core ${category} quota ${count} < ${minimum}`);
    }
  }
  const quotaChecks = [
    [
      'variants',
      corpus.cases.filter((testCase) => testCase.queryClass === 'VARIANT')
        .length,
    ],
    [
      'reverseCore',
      corpus.cases.filter(
        (testCase) =>
          testCase.kind === 'REVERSE' &&
          testCase.coverageClass === 'CORE',
      ).length,
    ],
    [
      'buffer',
      corpus.cases.filter(
        (testCase) => testCase.coverageClass === 'BUFFER',
      ).length,
    ],
    [
      'outsidePolicy',
      corpus.cases.filter(
        (testCase) => testCase.coverageClass === 'OUTSIDE',
      ).length,
    ],
  ];
  for (const [name, count] of quotaChecks) {
    if (count < corpus.quotaRequirements[name]) {
      errors.push(`${name} quota ${count} < ${corpus.quotaRequirements[name]}`);
    }
  }
  return errors;
}
