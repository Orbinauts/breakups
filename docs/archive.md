# The Archive

The data the detector is backtested over: every tracked object's orbits since 2005, with the catalogue data and the space weather the detector reads. It is published as assets of the [`archive-v1` release](https://github.com/Orbinauts/breakups/releases/tag/archive-v1), never committed to git.

## What it holds

The detector is backtested over the Archive: every catalogued object's element sets from 2005 to today, stripped to the fields the detector reads (the six mean elements, the drag terms, the element set number, the publication order) and stored one year at a time as compressed columns beside a table of the objects, joined to a snapshot of the satellite catalogue (CelesTrak), to the dates GCAT's payload catalogue gives for each payload's end of transmission (J. McDowell, planet4589.org, CC-BY-4.0), and to the space-weather indices of each day (GFZ Potsdam's Kp, ap and F10.7, CC BY 4.0; NASA OMNI2's Dst). It is built on a maintainer's machine from the public catalogue's yearly bundles of two-line sets and from its history class for the current year, by the scripts under `scripts/archive/`, and published as assets of this repository's `archive-v1` release with a manifest of hashes; `npm run archive:download -- 2024 2025` fetches years into `../breakups-archive`, verifying each. Neither the bundles nor the Archive are ever committed. [docs/decisions/0003](decisions/0003-the-archive-is-a-release-asset-never-in-git.md) says why.

## How to download it

The Archive lives in a folder beside the repository, `../breakups-archive`, or wherever the environment variable `BREAKUPS_ARCHIVE` points. Each command checks every file against the SHA-256 the release's manifest gives.

```sh
# Two years, with the side files (the space weather, the satellite catalogue snapshot, GCAT's payload catalogue and the catalogue index).
npm run archive:download -- 2024 2025

# The same, with the year before each, which the detector warms up on.
npm run archive:download -- 2024 2025 --warmup

# The side files alone.
npm run archive:download
```

The whole Archive is some seven gigabytes. With it in place, `npm run kpi -- --all` replays the scorecard over every year, as [CONTRIBUTING.md](../CONTRIBUTING.md) describes, and the [results page](results.md) shows what it found.
