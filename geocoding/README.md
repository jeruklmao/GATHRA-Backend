# GATHRA self-hosted Photon geocoding

GATHRA uses a private Photon service behind the normalized NestJS geocoding
contract:

```text
Android -> NestJS :3000 -> Photon :2322
```

Only NestJS publishes a host port. Photon is attached only to the internal
`geocoding-private` Compose network. Android must never use the Photon hostname
or port directly.

## Dataset and coverage

The current pilot uses the pinned Indonesia Photon dump:

```text
https://download1.graphhopper.com/public/extracts/by-country-code/id/photon-db-id-250720.tar.bz2
MD5 0e027552ff841b12a2c703cf290daad2
```

The dump is broader than GATHRA's supported service area. NestJS applies the
versioned buffered bounds in `region/region-config.json`, marks normalized
results with `insideSupportedRegion`, and rejects reverse requests outside
coverage. Photon 0.5.0 does not support the newer `countrycode` query
parameter; the buffered bounding box is therefore the provider-side filter,
while Indonesia remains the context of the pinned country extract.

The pinned dump exposes Photon `default`, `en`, `de`, and `fr` analyzers. A
public `language=id` request therefore omits Photon's `lang` parameter and uses
the database's local/default labels; sending `lang=id` would be rejected by
Photon 0.5.0.

The supported pilot regions remain Jakarta Pusat, Jakarta Selatan, Kota
Tangerang, and Kota Tangerang Selatan plus the configured border buffer.

## Initial data installation

The download is explicit and never runs during normal Compose startup:

```bash
backend/geocoding/scripts/download-photon-data.sh
```

The script:

- refuses to overwrite a non-empty volume;
- downloads over HTTPS into a temporary directory;
- verifies the pinned official checksum;
- rejects unsafe archive paths;
- validates the expected index directory before copying it;
- installs into `gathra-routing_photon-data` by default.

Compose treats this database volume as external. It therefore fails clearly
when installation has not been completed and cannot remove the index through
`docker compose down -v`.

Override `PHOTON_DATA_URL`, `PHOTON_DATA_MD5`, and `PHOTON_DATA_VOLUME`
together only after verifying compatibility with the pinned Photon JAR.

## Runtime

Start GraphHopper, Photon, and NestJS:

```bash
docker compose --project-directory backend -f backend/compose.yaml \
  up --build --wait
backend/geocoding/scripts/health-check.sh
```

Use deterministic fake geocoding without Photon:

```bash
GEOCODING_PROVIDER=fake \
docker compose --project-directory backend -f backend/compose.yaml \
  up --build --wait
```

The Photon container still starts in this command so the Compose topology stays
predictable. It is not queried when fake mode is selected.

## API compatibility

NestJS preserves the existing endpoints and normalized response models:

- `GET /api/v1/geocoding/autocomplete`
- `GET /api/v1/geocoding/search`
- `GET /api/v1/geocoding/places/:id`
- `GET /api/v1/geocoding/reverse`

Photon has no public lookup-by-OSM-ID endpoint. When NestJS issues an opaque
suggestion token, it stores the corresponding normalized place details in its
bounded TTL cache. The normal Android search-to-selection flow therefore keeps
using `/places/:id` without provider-specific behavior. Tokens may expire or
become invalid after a backend restart; clients already handle
`PLACE_NOT_FOUND` as recoverable and can repeat the search.

Reverse geocoding always returns the exact requested coordinate. Provider
coordinates are display metadata only and never replace a map-selected routing
point.

## Quality checks

With the stack running, test the normalized contract:

```bash
backend/geocoding/scripts/run-quality-tests.sh
```

To inspect raw Photon ranking without exposing its port:

```bash
backend/geocoding/scripts/run-quality-tests.sh --raw-photon
```

The committed corpus is source-derived smoke data, not an independently
verified address register. See `quality/README.md`.

## Safe update and rollback

Never unpack a replacement over the active database.

1. Choose a new candidate volume name.
2. Download and verify the candidate into that empty volume:

   ```bash
   PHOTON_DATA_VOLUME=gathra-routing-photon-candidate \
   PHOTON_DATA_URL=<verified-dump-url> \
   PHOTON_DATA_MD5=<verified-checksum> \
   backend/geocoding/scripts/download-photon-data.sh
   ```

3. Start Compose with the same `PHOTON_DATA_VOLUME`.
4. Run health checks and both quality modes.
5. Keep the previous volume unchanged until the candidate is accepted.
6. Roll back by restoring the previous volume name and restarting Compose.

Deletion of an old volume is intentionally manual. Resolve its exact name with
`docker volume inspect` before removal.

## Resource and operational notes

The existing Indonesia pilot volume occupies about 903 MiB. The earlier local
smoke run observed approximately 258–300 MiB of Photon memory, compared with a
much heavier multi-service geocoder stack. Compose caps Photon at 512 MiB by
default; tune `PHOTON_JAVA_OPTS` and `PHOTON_MEMORY_LIMIT` together after
measurement.

Photon data remains an OpenStreetMap-derived database. Preserve attribution and
comply with the ODbL when distributing derived data.

There is no custom-POI import path in this lightweight deployment. Adding
project-specific POIs would require a separately designed and verified import
pipeline rather than modifying the active database in place.
