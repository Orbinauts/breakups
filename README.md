# @orbinauts/breakups

On-orbit breakup detection from public orbital-element histories, in TypeScript, scored against every reported fragmentation since 2005.

The detector behind [Orbinauts](https://orbinauts.com), the live satellite map.

A satellite, a rocket body or a piece of debris that breaks up in orbit leaves two traces in public data: its own orbit jumps, by metres to kilometres, in the element sets the catalogue publishes for it; and days to weeks later new objects appear under its launch. This library reads the first trace to raise an alert before the second is published, and uses the second to confirm it. Every alert carries the numbers it was judged by.

What this repository holds: the **ground truth**, one row per breakup an authority reported since 1961, built from its sources by a script and checked by the tests; the **Archive** of every object's element sets since 2005, published as release assets; the **scorecard** that replays the detector over the Archive and scores it against the truth; and the **detector**, in its fifth phase: the parent's own step, measured against the object's own noise and the day's drag, on every object in every orbit, read against the object's own record of steps and the impulse the step implies, so that a working satellite's manoeuvres are named as such and not raised; then confirmed, or not, by the bodies the catalogue goes on to list under the parent's launch, under rules that keep a cloud still being catalogued from confirming anything else, and timed from the two sets either side of the step. [docs/detector/README.md](docs/detector/README.md) is the design as built.

- Ground truth: every reported breakup and anomalous event, with each source's statement verbatim, the resolved time, orbit, cause and piece count, which source each came from, and every disagreement between sources.
- Detector: each object's sets are kept in a ring and modelled by a robust local polynomial; a set that leaves the model by more than the object's own scatter and the band's live scale opens a candidate, and the candidate is a persistent step when it holds across the next sets and is not a drift drag could produce. The step is then read against the object's own record over two years and the impulse it implies by Gauss's equations: the first step in two years, or one unlike the object's own in size, direction or geometry, is raised as suspected; a station-keeping step, a campaign's or a disposal's is a manoeuvre. Every verdict carries the numbers it was judged by.
- Fragments: every launch the catalogue lists new bodies under is read for a burst over the launch's own background, for pieces that are new by numbering and share a parent's plane once each node's own precession is taken off, and for the cloud's velocity and spread. Such pieces, first published after a suspected step, confirm it; a notice naming the object confirms it; nothing in thirty days expires it; and a burst with pieces in the plane of a parent that did not move is listed for review, never counted as a detection. Once raised, an alert keeps reading the parent's sets so the scorecard can say what waiting longer would have cost.
- Scorecard: the detector replayed over twenty-two years in the catalogue's publication order, the states carried from year to year, and scored on held-out years, with the tables below read from its committed result: the detection rate, the false alarms, the precision per persistence tier, and the confirmed line; and every reported event dissected, with its cause, in [docs/detector/events.md](docs/detector/events.md).

[Changelog](CHANGELOG.md) · [Design record](docs/decisions/0001-a-standalone-truth-driven-package.md) · [How the truth was built](docs/truth.md)

## Install

```sh
npm install @orbinauts/breakups
```

The package is ESM only, ships TypeScript declarations and source maps, and depends on `@orbinauts/engine`.

## Quick start

Read the ground truth and print the three most recent events it carries:

```js
import { readBreakups, yearOf } from "@orbinauts/breakups";
import file from "@orbinauts/breakups/breakups.json" with { type: "json" };

// Every row checked: a malformed row throws, naming it.
const breakups = readBreakups(file);

// The events the scorecard counts: breakups and anomalous events of a catalogued object, since 2005.
const scoreable = breakups.filter((breakup) => breakup.scoreable && yearOf(breakup) >= 2005);

for (const breakup of scoreable.slice(-3)) {
  const when = breakup.event.at ?? `by ${breakup.event.to}`;
  console.log(`${when} ${breakup.parent.name} (${breakup.parent.catalogueNumber}), ${breakup.kind}, confidence ${breakup.confidence}, ${breakup.orbit.regime}`);
}
```

It prints:

```text
by 2026-09-04T00:00Z Yaogan-50 02 (68196), breakup, confidence D, LEO
2026-09-13T21:13Z USA 32 (19460), breakup, confidence A, LEO
2026-10-05T09:45Z Meteor 2-7 (second event) (12456), breakup, confidence C, LEO
```

## How well it does

The scorecard replays the detector over the Archive, every element set of every object in the order the catalogue published them, in runs of four hours as the product runs, and matches what it raises against the ground truth. A target is a reported event whose parent had at least five public element sets in the sixty days before it; one with fewer is undetectable from public elements and listed apart. A detection is an alert on the parent's own orbit, raised before the first fragment's element set was published and before any notice; the same alert after that is late; an alert matching no reported event is a false alarm. The headline line is breakups reported to the day or better, scored on the odd years, held out from the even years the thresholds are fitted on; the other lines are shown so nothing is mixed into it. The targets are nine in ten detected and fewer than one false alarm in ten. [kpi/latest.md](kpi/latest.md) carries every split, and [docs/decisions/0004](docs/decisions/0004-the-scorecard-replays-the-detector-and-ci-must-reproduce-its-number.md) the rule. The per-year files under `kpi/years/` (every verdict and every logged candidate, tens of megabytes a run) are artifacts of the KPI workflow, made again by `npm run kpi -- --all`, and are not committed; the aggregate is.

**This is the fifth phase of the detector**, the parent-step channel read against the object's own record, confirmed or not by what the catalogue goes on to list under the parent's launch, and timed from the two sets either side of the step. A suspected step stays open for thirty days: pieces new by numbering, in the parent's plane and first published after it confirm it, a public notice confirms it, nothing expires it. The detection rate and the false alarms are the parent-step channel's: the fragments confirm, they do not detect, and the owner's definition scores the alert before them. The tier table reads every alert's later sets, so the trade between waiting longer and false alarms is shown with the numbers in hand: the false alarms that remain are persistent steps that hold for a week as a breakup's does, so waiting buys little. The confirmed table is the product's second line: of the events the catalogue itself reported (new bodies under the launch within ninety days), how many the fragments or a notice confirmed and how long after; and of every alert confirmed, how many were on a reported event's step, how many on the right object with the step late, and how many on nothing. The fifth phase's rules (a cloud velocity of a metre a second, no fresh piece of a cloud as a parent, a launch's cloud remembered for a year, a debris parent's pieces nearer than the cloud, a single piece only under a quiet launch) are what make that line one the product can show; [docs/detector/d5-fitting.md](docs/detector/d5-fitting.md) lists every confirmation before and after them on both splits, and [docs/detector/events.md](docs/detector/events.md) every reported event with the cause of its outcome. The odd years below were not looked at while choosing the thresholds.

| Validation: the odd years (2005 to 2025, 11 years) | Targets | Undetectable | Detected | Late | Missed | Detection rate |
| --- | --- | --- | --- | --- | --- | --- |
| Breakups, confidence A and B (the target is 90%) | 32 | 6 | 11 | 2 | 19 | 34% |
| Breakups, confidence C | 8 | 9 | 2 | 0 | 6 | 25% |
| Breakups, confidence D | 8 | 1 | 0 | 0 | 8 | 0% |
| Anomalous events, confidence A and B | 9 | 1 | 1 | 2 | 6 | 11% |
| Anomalous events, confidence C and D | 4 | 0 | 3 | 0 | 1 | 75% |

| Alerts, validation: the odd years (2005 to 2025, 11 years) | Count |
| --- | --- |
| Alerts (object verdicts, suspected or confirmed) | 15739 |
| Duplicates | 156 |
| Exempt | 16 |
| False alarms | 15546 |
| False-alarm rate (the target is under 10%) | 100% |
| False alarms per 10,000 body-years | 837.8 |
| Lead over the catalogue, hours: median (10th percentile) | 479.0 (94.0) |
| Latency from the event, hours: median (90th percentile) | 140.1 (1153.4) |
| Confirmed share of the detections | 24% |
| Days to confirmation, median | 4.0 |
| Timing error, minutes, median | 44.2 |
| Cloud verdicts, for review (a burst with no parent step) | 89 |

| Precision per persistence tier, validation: the odd years (2005 to 2025, 11 years) | Raised | Detections still before the catalogue | False alarms | Precision | Share of the detections kept | Lead over the catalogue, hours: median (10th percentile) |
| --- | --- | --- | --- | --- | --- | --- |
| 2 post sets over 18 h, or 3 (as raised) | 15567 | 17 | 15546 | 0% | 100% | 479.0 (94.0) |
| 3 post sets | 14940 | 17 | 14919 | 0% | 100% | 479.0 (94.0) |
| 5 post sets | 12275 | 14 | 12257 | 0% | 82% | 576.1 (94.0) |
| 1 day of post sets | 13574 | 14 | 13556 | 0% | 82% | 576.1 (94.0) |
| 3 days of post sets | 10388 | 14 | 10370 | 0% | 82% | 564.1 (54.0) |
| 5 days of post sets | 8953 | 12 | 8935 | 0% | 71% | 557.0 (156.0) |
| 7 days of post sets | 7737 | 10 | 7723 | 0% | 59% | 529.0 (88.0) |

| The confirmed line, validation: the odd years (2005 to 2025, 11 years) | Count |
| --- | --- |
| Events the catalogue reported (new bodies under the launch within 90 days) | 36 |
| Of which alerted on the parent (detected or late) | 15 |
| Of which confirmed | 5 |
| Confirmed share of the reported events | 14% |
| Days from the event to the confirmation, median (90th percentile) | 21.9 (49.1) |
| Days from the alert to the confirmation, median (90th percentile) | 4.0 (10.5) |
| Confirmed alerts (by the fragments or a notice) | 14 |
| Of which on a reported event's step (a detection or a late alert) | 5 |
| Of which inside an exempt window or a duplicate | 0 |
| Of which matching no reported event's step | 9 |
| Of those, on the parent of a reported event within the month before (the right object, the step late) | 3 |
| Precision of the confirmed alerts, on the step | 36% |
| Precision of the confirmed alerts, on the object | 57% |
| Targets with an agency's statement dated in the truth (the notices) | 0 |
| Of which confirmed before that statement | 0 |

## Ground truth

A positive event is a breakup that was reported, so we are sure it happened: by NASA, by ESA, by U.S. Space Forces-Space, by a named analyst, or by the public catalogue itself listing a burst of new debris under the parent's launch (at least five objects within thirty days, more than ninety days after the launch, and at least a fifth of the debris the launch already had). `data/breakups.json` holds every one found, 1961 to today, each with the statements of every source that reported it and the values resolved from them. The scorecard runs over the events from 2005, where the yearly element bundles begin, and scores NASA's two kinds apart: the detection target is for breakups, the destructive kind; anomalous events, where a body sheds a piece or two at low speed and stays intact, barely move the parent and are reported on a second line. Events whose parent has no public element sets at all are listed apart and left out of the denominator, and the headline is over events reported to the day or better.

| Events from 2005 | Count |
| --- | --- |
| All | 246 |
| Scoreable (breakups and anomalous events of a catalogued object) | 175 |
| Breakups | 188 |
| Anomalous events (low-velocity shedding) | 28 |
| Aerodynamic breakups at reentry (kept out) | 23 |
| Objects released on purpose (kept out) | 2 |
| Reports naming no object (kept out) | 5 |
| Confidence A (an authority states the minute) | 74 |
| Confidence B (an authority states the day, or a window of three days at most) | 31 |
| Confidence C (GCAT alone, an authority's month, or an analyst's dating) | 43 |
| Confidence D (pieces in the catalogue, or news with no time) | 27 |

The sources, and what each gives:

- **NASA, History of On-Orbit Satellite Fragmentations, 16th edition** (NASA/TP-20220019160, December 2022): every breakup and anomalous event to 1 May 2022, each with its date, time, altitude, assessed cause and the parent's pre-event element set. Read from the text of the PDF.
- **NASA, Orbital Debris Quarterly News**: each breakup since the cut-off, in prose. Typed by hand with issue and page.
- **GCAT, Space Debris Clouds** (Jonathan McDowell, planet4589.org, CC-BY-4.0): 402 debris clouds with the parent, the event date and the orbit. Read from its table.
- **ESA, Space Environment Report 2025**, Table 3.7: the fragmentations of 2024, the object unnamed.
- **U.S. Space Forces-Space notices**, named analysts, LeoLabs' notifications and news reports for 2025 to 2026, and the public catalogue where fragments were published with no report.

Where sources disagree, the time comes from the source that states it most finely, an authority first; the orbit from NASA's spread, then the quarterly news, then GCAT; the cause from NASA, then ESA, then GCAT; the piece count from the latest statement. Every disagreement is kept on the row. A reviewer who disagrees with a row edits the hand file or the overrides, never the built file; `npm run truth` rebuilds it and the tests fail until the committed file matches. [docs/truth.md](docs/truth.md) lists what was built from what.

## The Archive

The detector is backtested over the Archive: every catalogued object's element sets from 2005 to today, stripped to the fields the detector reads (the six mean elements, the drag terms, the element set number, the publication order) and stored one year at a time as compressed columns beside a table of the objects, joined to a snapshot of the satellite catalogue (CelesTrak) and to the space-weather indices of each day (GFZ Potsdam's Kp, ap and F10.7, CC BY 4.0; NASA OMNI2's Dst). It is built on a maintainer's machine from the public catalogue's yearly bundles of two-line sets and from its history class for the current year, by the scripts under `scripts/archive/`, and published as assets of this repository's `archive-v1` release with a manifest of hashes; `npm run archive:download -- 2024 2025` fetches years into `../breakups-archive`, verifying each. Neither the bundles nor the Archive are ever committed. [docs/decisions/0003](docs/decisions/0003-the-archive-is-a-release-asset-never-in-git.md) says why.

## Runtimes

- **Node** 22 or later. CI runs on Node 22 and 24.
- **Browsers**, through a bundler: the library is ES2022 modules and imports no Node built-in, a rule its own tests enforce.
- **Cloudflare Workers**: nothing to configure.

## Contributing and security

Patches are welcome; [CONTRIBUTING.md](CONTRIBUTING.md) says how they land. Report a vulnerability privately, as [SECURITY.md](SECURITY.md) describes.

## Licence

[MIT](LICENSE), © Orbinauts contributors. The ground truth cites its sources; GCAT's data is CC-BY-4.0, Jonathan McDowell, planet4589.org; NASA's publications are US Government works.
