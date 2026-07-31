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
- add a verified quality-corpus case when the fixture is used for testing.

Never place confidential shelter details, private home addresses, credentials,
or unverified emergency information in this fixture.

The lightweight Photon deployment does not import this CSV. It remains a
versioned schema/sample only; adding a real custom-POI import pipeline is
outside the current milestone.
