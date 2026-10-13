# The published breakups

The breakups this project considers fit to show, as static JSON on its GitHub Pages: a free, read-only API with no server, refreshed once a day. [Orbinauts](https://orbinauts.com) reads it to show breakups instead of detecting them itself, and anyone else may read it too. Every rule about what is shown lives here, in this repository; a reader only fetches the files, compares them with what it already holds to find what is new, and displays them. [docs/decisions/0010](decisions/0010-the-breakups-fit-to-show-are-published-as-static-json.md) says why it is built this way.

## Where to read it

```text
https://orbinauts.github.io/breakups/v2/breakups.json          every published breakup
https://orbinauts.github.io/breakups/v2/breakups/<id>.json     one breakup, with its whole evidence
https://orbinauts.github.io/breakups/v2/status.json            the last run
```

The library's reference sits at the root of the same site, `https://orbinauts.github.io/breakups/`. The `v2` in the path is the version of the files' shape (`PUBLISHED_VERSION`), and every file also carries it as `version`, so a reader can refuse a shape it does not know.

The package exports a type for each file, so a reader in TypeScript can check what it fetched:

```ts
import { PUBLISHED_VERSION, type PublishedBreakupsFile } from "@orbinauts/breakups";

const list = (await (await fetch("https://orbinauts.github.io/breakups/v2/breakups.json")).json()) as PublishedBreakupsFile;
if (list.version !== PUBLISHED_VERSION) throw new Error(`published files in version ${list.version}`);
for (const breakup of list.breakups) console.log(breakup.id, breakup.state, breakup.parent.name);
```

## The files

Every instant is an ISO string in UTC (`2026-09-17T00:00:00.000Z`) and every day is `YYYY-MM-DD`.

**`v2/breakups.json`** (`PublishedBreakupsFile`): `version` and `breakups`, the list, earliest raised first. Each entry (`PublishedBreakupEntry`) has:

| Field | What it holds |
| --- | --- |
| `id` | `<catalogue number>-<UTC day>`, such as `40258-2026-01-30`. The day is the one the best dating known at first publication gives: the row's (`rowEvent`) where the row dates the event to the second, minute, hour or day (its instant, else its start); otherwise the detector's estimate's (`event`); otherwise `raisedAt`'s. Fixed the first time the breakup is published: a later estimate, or a later and finer row, that moves the day keeps the id. Build addresses from it, never from `event`, which can move. |
| `state` | `confirmed`, `unreported` or `suspected` (see below). |
| `raisedAt` | When the detector first raised it: the earliest of its verdicts. |
| `confirmedAt` | The earlier of the detector's first confirmation and the first agency notice's day (at midnight UTC); `null` while suspected. An unreported breakup keeps it. |
| `unreportedAt` | The instant it turned unreported: the instant the 90 days after `confirmedAt` ran out, not the day of the run that relabelled it; `null` unless `state` is `unreported`. |
| `parent` | The object that broke up: `catalogueNumber`, `designator`, `name` and `launchedOn`, from the ground-truth row it landed on, what the row leaves out filled from the satellite catalogue. |
| `event` | The detector's estimate of when it happened: `at`, and the window `from` to `to`; `null` where it made none. A geosynchronous object's sets are days apart, so its estimate is coarse: compare `rowEvent`. |
| `rowEvent` | The event as the ground-truth row it landed on dates it: `at` (the instant the row states, or `null`), `from` and `to` (the window, either `null` where the row gives no bound), `precision` (`second`, `minute`, `hour`, `day`, `month`, `year` or `none`), `source` (the source the row's date was resolved from) and `row` (the row's id); `null` where it landed on no row. It follows the truth as it stands at the last run that found the breakup. The source may be GCAT or the catalogue, which never count as reports, so read it before calling the time reported: for Luch (Olymp-K 1) it is s2a systems' minute, quoted by the news (`news`), for DMSP F-14 U.S. Space Forces-Space's (`s4s-notice`). |
| `step` | The change in the parent's orbit the detector measured (its epochs before and after, the change in semi-major axis, perigee, apogee and inclination, the sets after it and its z-score); `null` for a breakup confirmed from its fragments alone. |
| `reasons` | The detector's reasons, one sentence per line. |
| `reports` | The reports that count (see below), earliest first, each with `source`, `date`, `precision` (how much of the date the source gives) and `url` (`null` where the report has no page). |

**`v2/breakups/<id>.json`** (`PublishedBreakupFile`): one breakup, with `version`, every field of its entry, and its whole evidence: `evidence` (the detector's numbers, by name), `bodies` (the catalogue numbers of the pieces it rests on), `candidates` (the objects the pieces cannot tell apart), `row` (the id of the ground-truth row it landed on, such as `40258:2026-01-30`, or `null`; `rowEvent.row` repeats it in the list) and `verdicts`, every suspected and confirmed verdict merged into it, in the order raised. `evidence`, `bodies`, `candidates`, `step`, `event` and `reasons` are the latest verdict's.

**`v2/status.json`** (`PublishedStatusFile`): `version`, `ranAt` (when the job last ran), `setsThrough` (the last day of element sets the replay read), `detector` (the frozen detector's name, `confirmed-v10`) and `truthSha256` (the sha256 of the ground truth's file the verdicts were landed on). A reader can tell from `ranAt` whether the job has stopped running, and from `truthSha256` whether the truth changed since it last read.

## What is shown, in plain words

The verdicts are the frozen detector's, the one the [live test](../README.md#live-test) runs (`confirmed-v10`), on the current year's public data. They are checked against the [ground truth](ground-truth.md) as it stands on main that day, so a notice added to the truth after the detector was frozen still confirms a breakup here. A daily watcher opens an issue for each new public report of a fragmentation it reads, and a report the owner accepts reaches the truth on main the next morning, when the watcher starts the maintenance run and the live test's runs leave room (else on Monday's run), so a suspected breakup is published the day after that at the latest ([docs/decisions/0011](decisions/0011-reports-reach-the-truth-through-issues-the-owner-accepts.md)).

- **A verdict lands on a reported breakup** the way the scorecard lands it: only on a ground-truth row whose parent is the verdict's object and whose kind is a breakup or an anomalous event, never a release, an aerodynamic breakup or an unnamed one. An early warning lands when its step falls within the row's event window, widened by a day in low and medium orbits (five in high and geosynchronous ones). A confirmation lands when it was raised between the start of that window, less the same margin, and 180 days after its end; where two rows of the object qualify, it lands on the one nearest the detector's instant of the event (else its raising), so a later breakup's confirmation never lands on an earlier one. A row that names the object but whose window the verdict misses says nothing about it.
- **The reports that count** are an agency's notice (a U.S. Space Forces-Space notice, NASA's Orbital Debris Quarterly News, ESA's Space Environment Report or NASA's History of On-Orbit Satellite Fragmentations) dated no earlier than the event, or an outside report (news or an analyst). An undated statement never counts. GCAT and the catalogue's own listing of new objects never count: GCAT's dates are often only a year, and the catalogue's new objects are the detector's own input.
- **A breakup is confirmed** when the detector confirmed it, or when it raised an early warning that lands on a row with an agency notice on its object. An ESA row that names no object, placed on the row by the truth build's own rule, is listed among the reports but confirms nothing. A breakup the detector confirmed is shown even with no report yet, on no row of the ground truth (`reports` empty, `row` null): the detector's own news, often hours after the first fragment is catalogued. The scorecard and the live test's score read such a confirmation the same way: pending, neither true nor false, while it was raised less than 90 days before the truth's date (the latest day the ground truth knows of), and a false confirmation once 90 days pass with no report. The list reads it alike: `confirmed` while pending.
- **A breakup is unreported** once the detector confirmed it and it is still on no row of the ground truth 90 days after its confirmation (`confirmedAt`), at the truth's date, where the scorecard lands that confirmation on no reported event: the scorecard counts it a false confirmation by then. It stays in the list with the state `unreported` and `unreportedAt`, the instant the 90 days ran out (`confirmedAt` plus 90 days), rather than leaving, since the site may already show it. A confirmation on no row that the scorecard never counts false stays `confirmed`: one inside a report naming no object (whether that report names the launch, the regime or nothing), on a fragment of a reported event, or inside an exempt row's window.
- **An unreported breakup is confirmed again** if a report lands on it later: its `state` is `confirmed`, `unreportedAt` is `null`, and `row`, `rowEvent` and `reports` are the row's, its id and `raisedAt` unchanged (`confirmedAt` too, unless the row's agency notice is dated earlier). The file keeps no trace that it was unreported; the `published` branch's history does. A breakup the daily run no longer replays (an earlier year's) is landed again on each day's truth the same way, so it turns unreported, or confirmed again once a report typed in after its year gives it a row.
- **A breakup is suspected** when the detector raised an early warning that lands on a row with an outside report.
- **Nothing else is shown**: early warnings no report names, manoeuvres, alerts that expired or were dismissed, and confirmations that land on a crewed station's launch, a crewed or cargo craft's launch other than its rocket body, or the window of a release on purpose.
- **One breakup, many verdicts.** Verdicts on one object whose steps overlap are one breakup, and a verdict with no step joins the breakup of the row it lands on. Two verdicts whose steps do not overlap are two breakups, even on one row.
- **The list grows.** Each day's run merges into the list already published, so it does not empty on 1 January. A confirmed or unreported breakup stays for good. A suspected one leaves when its early warning expires or is dismissed.

[docs/decisions/0010](decisions/0010-the-breakups-fit-to-show-are-published-as-static-json.md) states each rule in full, and `scripts/published/` holds the code, with a test for each.

## How it is kept

The files live on the orphan branch [`published`](https://github.com/Orbinauts/breakups/tree/published), under `v2/`. It is never rewritten: its history records what was public when.

### From v1 to v2

Version 2 (issue #41) adds the state `unreported` and the field `unreportedAt` to every entry; nothing else changed, and every id carries over. A reader of version 1 that switches on `state` may not know the new value, so the files moved to `v2/` rather than changing under `v1/`. The first run of version 2 reads the list from `v1/` and writes `v2/`; from then on `v1/` is no longer written, but stays on the branch and on Pages as that run found it, its `status.json` showing the last run that wrote it. To move a reader over:

- fetch `v2/` instead of `v1/`, and check `version` against 2 (`PUBLISHED_VERSION` in the package from this release on);
- read `unreported` as a breakup the detector confirmed that no report has named 90 days on, which the project's score counts as a false confirmation: show it apart from, or below, the confirmed ones, or hide it, but expect it to stay in the list and to come back as `confirmed` if a report lands;
- read `unreportedAt` beside `confirmedAt`; it is `null` on every breakup that is not unreported.

The ids were re-keyed once, on the first run after `rowEvent` was added (issue #11), before anything read the files: each breakup took the id the rule above gives it with the truth of that day, so Luch (Olymp-K 1) moved from `40258-2026-01-31` to `40258-2026-01-30` and DMSP F-14 from `24753-2024-10-07` to `24753-2024-12-19`, and the files of the old ids were removed. The run's commit on `published` names each move.

The list starts with 2025. The frozen tag `frozen-confirmed-v10` replayed 2025 once, from the states at the end of 2024, under the same rules, and that seed was the branch's first commit: DMSP F-14 (24753), confirmed, with no report in the truth of that day (U.S. Space Forces-Space's post of 2024-12-19 was typed in later, issue #16). Years before 2025 are not published; the [results page](results.md) scores them instead.

Each day, the scheduled job of the live test (`.github/workflows/prospective.yml`) replays the current year with the frozen detector, as it always has. It then runs `npm run published` on that replay's year file, with main's ground truth, over a checkout of `published`, commits the new `v2/` there and pushes it, and finally calls the Pages workflow (`.github/workflows/docs.yml`). The live test's own log and score are untouched by this. The Pages workflow builds the reference from main, copies `v2/` (and the frozen `v1/`) from `published` beside it and deploys both at once, so neither wipes out the other; it also runs on every push to main.

To publish by hand from a replay already on disk:

```sh
npm run published -- --year-file <archive>/prospective/<day>/years/2026.json.gz \
  --truth data/breakups.json --out <checkout of published> --archive <archive>
```

It refuses year files from two detectors, or one not carried from the end of the year before, prints a line saying what it published, and commits nothing.
