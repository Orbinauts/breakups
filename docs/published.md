# The published breakups

The breakups this project considers fit to show, as static JSON on its GitHub Pages: a free, read-only API with no server, refreshed once a day. [Orbinauts](https://orbinauts.com) reads it to show breakups instead of detecting them itself, and anyone else may read it too. Every rule about what is shown lives here, in this repository; a reader only fetches the files, compares them with what it already holds to find what is new, and displays them. [docs/decisions/0010](decisions/0010-the-breakups-fit-to-show-are-published-as-static-json.md) says why it is built this way.

## Where to read it

```text
https://orbinauts.github.io/breakups/v1/breakups.json          every published breakup
https://orbinauts.github.io/breakups/v1/breakups/<id>.json     one breakup, with its whole evidence
https://orbinauts.github.io/breakups/v1/status.json            the last run
```

The library's reference sits at the root of the same site, `https://orbinauts.github.io/breakups/`. The `v1` in the path is the version of the files' shape (`PUBLISHED_VERSION`), and every file also carries it as `version`, so a reader can refuse a shape it does not know.

The package exports a type for each file, so a reader in TypeScript can check what it fetched:

```ts
import { PUBLISHED_VERSION, type PublishedBreakupsFile } from "@orbinauts/breakups";

const list = (await (await fetch("https://orbinauts.github.io/breakups/v1/breakups.json")).json()) as PublishedBreakupsFile;
if (list.version !== PUBLISHED_VERSION) throw new Error(`published files in version ${list.version}`);
for (const breakup of list.breakups) console.log(breakup.id, breakup.state, breakup.parent.name);
```

## The files

Every instant is an ISO string in UTC (`2026-09-17T00:00:00.000Z`) and every day is `YYYY-MM-DD`.

**`v1/breakups.json`** (`PublishedBreakupsFile`): `version` and `breakups`, the list, earliest raised first. Each entry (`PublishedBreakupEntry`) has:

| Field | What it holds |
| --- | --- |
| `id` | `<catalogue number>-<UTC day of the event estimate>`, such as `19460-2026-09-13`, or the day of `raisedAt` where the detector made no estimate. Fixed the first time the breakup is published: a later estimate that moves the day keeps the id. |
| `state` | `confirmed` or `suspected` (see below). |
| `raisedAt` | When the detector first raised it: the earliest of its verdicts. |
| `confirmedAt` | The earlier of the detector's first confirmation and the first agency notice's day (at midnight UTC); `null` while suspected. |
| `parent` | The object that broke up: `catalogueNumber`, `designator`, `name` and `launchedOn`, from the ground-truth row it landed on, what the row leaves out filled from the satellite catalogue. |
| `event` | The detector's estimate of when it happened: `at`, and the window `from` to `to`; `null` where it made none. |
| `step` | The change in the parent's orbit the detector measured (its epochs before and after, the change in semi-major axis, perigee, apogee and inclination, the sets after it and its z-score); `null` for a breakup confirmed from its fragments alone. |
| `reasons` | The detector's reasons, one sentence per line. |
| `reports` | The reports that count (see below), earliest first, each with `source`, `date`, `precision` (how much of the date the source gives) and `url` (`null` where the report has no page). |

**`v1/breakups/<id>.json`** (`PublishedBreakupFile`): one breakup, with `version`, every field of its entry, and its whole evidence: `evidence` (the detector's numbers, by name), `bodies` (the catalogue numbers of the pieces it rests on), `candidates` (the objects the pieces cannot tell apart), `row` (the id of the ground-truth row it landed on, such as `40258:2026-01-30`, or `null`) and `verdicts`, every suspected and confirmed verdict merged into it, in the order raised. `evidence`, `bodies`, `candidates`, `step`, `event` and `reasons` are the latest verdict's.

**`v1/status.json`** (`PublishedStatusFile`): `version`, `ranAt` (when the job last ran), `setsThrough` (the last day of element sets the replay read), `detector` (the frozen detector's name, `confirmed-v10`) and `truthSha256` (the sha256 of the ground truth's file the verdicts were landed on). A reader can tell from `ranAt` whether the job has stopped running, and from `truthSha256` whether the truth changed since it last read.

## What is shown, in plain words

The verdicts are the frozen detector's, the one the [live test](../README.md#live-test) runs (`confirmed-v10`), on the current year's public data. They are checked against the [ground truth](ground-truth.md) as it stands on main that day, so a notice added to the truth after the detector was frozen still confirms a breakup here.

- **A verdict lands on a reported breakup** the way the scorecard lands it: only on a ground-truth row whose parent is the verdict's object and whose kind is a breakup or an anomalous event, never a release, an aerodynamic breakup or an unnamed one. An early warning lands when its step falls within the row's event window, widened by a day in low and medium orbits (five in high and geosynchronous ones). A confirmation lands when it was raised between the start of that window, less the same margin, and 180 days after its end. A row that names the object but whose window the verdict misses says nothing about it.
- **The reports that count** are an agency's notice (a U.S. Space Forces-Space notice, NASA's Orbital Debris Quarterly News, ESA's Space Environment Report or NASA's History of On-Orbit Satellite Fragmentations) dated no earlier than the event, or an outside report (news or an analyst). An undated statement never counts. GCAT and the catalogue's own listing of new objects never count: GCAT's dates are often only a year, and the catalogue's new objects are the detector's own input.
- **A breakup is confirmed** when the detector confirmed it, or when it raised an early warning that lands on a row with an agency notice. A breakup the detector confirmed is shown even with no report yet: that is the detector's own news, typically weeks before the first official report.
- **A breakup is suspected** when the detector raised an early warning that lands on a row with an outside report.
- **Nothing else is shown**: early warnings no report names, manoeuvres, alerts that expired or were dismissed, and confirmations that land on a crewed station's launch, a crewed or cargo craft's launch other than its rocket body, or the window of a release on purpose.
- **One breakup, many verdicts.** Verdicts on one object whose steps overlap are one breakup, and a verdict with no step joins the breakup of the row it lands on.
- **The list grows.** Each day's run merges into the list already published, so it does not empty on 1 January. A confirmed breakup stays for good. A suspected one leaves when its early warning expires or is dismissed.

[docs/decisions/0010](decisions/0010-the-breakups-fit-to-show-are-published-as-static-json.md) states each rule in full, and `scripts/published/` holds the code, with a test for each.

## How it is kept

The files live on the orphan branch [`published`](https://github.com/Orbinauts/breakups/tree/published), under `v1/`. It is never rewritten: its history records what was public when.

The list starts with 2025. The frozen tag `frozen-confirmed-v10` replayed 2025 once, from the states at the end of 2024, under the same rules, and that seed was the branch's first commit: DMSP F-14 (24753), confirmed, with no report. Years before 2025 are not published; the [results page](results.md) scores them instead.

Each day, the scheduled job of the live test (`.github/workflows/prospective.yml`) replays the current year with the frozen detector, as it always has. It then runs `npm run published` on that replay's year file, with main's ground truth, over a checkout of `published`, commits the new `v1/` there and pushes it, and finally calls the Pages workflow (`.github/workflows/docs.yml`). The live test's own log and score are untouched by this. The Pages workflow builds the reference from main, copies `v1/` from `published` beside it and deploys both at once, so neither wipes out the other; it also runs on every push to main.

To publish by hand from a replay already on disk:

```sh
npm run published -- --year-file <archive>/prospective/<day>/years/2026.json.gz \
  --truth data/breakups.json --out <checkout of published> --archive <archive>
```

It refuses year files from two detectors, or one not carried from the end of the year before, prints a line saying what it published, and commits nothing.
