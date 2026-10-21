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

## The years before 2005

The catalogue's public folder of yearly bundles starts at 2005. The years 1994 to 2004, the fresh validation's ([docs/decisions/0013](decisions/0013-the-years-before-2005-are-the-fresh-validation-read-once.md)), are pulled from the catalogue's history class a day of epochs at a time by the scheduled workflow `.github/workflows/backfill.yml` (`npm run archive:backfill`, `scripts/archive/backfill.ts`), a slab a run: at one request every thirty-six seconds, a hundred an hour, since the account also serves the site and the daily run, and at most four hundred a run. Between runs the day slices live on the release `backfill-data` (`history-<year>.tar`, with `empty.json`, how many times each day that answered no set was asked, two at most), with the ledger of every request (`ledger.log`); a year is built once every day of it is kept (`archive-v1-<year>.tar`, on the epoch clock, with no creation column, since the catalogue's creation times for those sets are its loads, not their publication: `HistorySource.clock`). Once every year is built, a run finishes instead of pulling: the whole Archive is downloaded, the built years put in, the space weather fetched from 1994, the catalogue index rebuilt, and the years, the side files and the manifest uploaded to the `archive-v1` release together, since the daily run refuses a gap between the released years and the index must describe every one. Until the scorecard carries the fresh validation, every script that chooses years leaves those below 2005 out (`scoredYears` in `scripts/archive/years.ts`, where the years are named once).
