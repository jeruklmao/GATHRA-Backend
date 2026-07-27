# Optional GATHRA POIs

`gathra-poi.csv` is a safe schema fixture built from public OpenStreetMap
objects in the pinned local snapshot. Its rows demonstrate stable IDs,
Indonesian aliases, category, coordinates, source, and dataset-version
metadata. They are not an authoritative GATHRA production POI dataset.

Before adding a record:

- verify the coordinate and public name against a documented source;
- choose a stable project-owned ID;
- keep `source=gathra` and `layer=venue`;
- put aliases in `name_json`;
- put `formattedAddress`, source, `updatedAt`, and `datasetVersion` in
  `addendum_json_gathra`;
- confirm redistribution and attribution terms;
- run the candidate import and quality corpus before switching indexes.

Never place confidential shelter details, private home addresses, credentials,
or unverified emergency information in this fixture.
