# @orbinauts/breakups

On-orbit breakup detection from public orbital-element histories, in TypeScript, scored against every reported fragmentation since 2005.

The detector behind [Orbinauts](https://orbinauts.com), the live satellite map.

A satellite, a rocket body or a piece of debris that breaks up in orbit leaves two traces in public data: its own orbit jumps, by metres to kilometres, in the element sets the catalogue publishes for it; and days to weeks later new objects appear under its launch. This library reads the first trace to raise an early alert, and the second to name the parent of the pieces, confirm the breakup and time it, with or without a step seen first: the Confirmed alert, which the owner's targets are set on. Every alert carries the numbers it was judged by.

What this repository holds: the **ground truth**, one row per breakup an authority reported since 1961, built from its sources by a script and checked by the tests; the **Archive** of every object's element sets since 2005, published as release assets; the **scorecard** that replays the detector over the Archive and scores it against the truth; and the **detector**, in its ninth phase: the fragments under a launch attributed to the body whose plane they share and on whose orbit they centre, the breakup timed by their convergence on it; and the parent's own step, measured against the object's own noise and the day's drag, on every object in every orbit, read against the object's own record of steps and the impulse the step implies, so that a working satellite's manoeuvres are named as such and not raised; then confirmed, or not, by the bodies the catalogue goes on to list under the parent's launch, under rules that keep a cloud still being catalogued from confirming anything else, and timed from the two sets either side of the step. [docs/detector/README.md](docs/detector/README.md) is the design as built.

- Ground truth: every reported breakup and anomalous event, with each source's statement verbatim, the resolved time, orbit, cause and piece count, which source each came from, and every disagreement between sources.
- Detector: each object's sets are kept in a ring and modelled by a robust local polynomial; a set that leaves the model by more than the object's own scatter and the band's live scale opens a candidate, and the candidate is a persistent step when it holds across the next sets and is not a drift drag could produce. The step is then read against the object's own record over two years and the impulse it implies by Gauss's equations: the first step in two years, or one unlike the object's own in size, direction or geometry, is raised as suspected; a station-keeping step, a campaign's or a disposal's is a manoeuvre. Every verdict carries the numbers it was judged by.
- Fragments: every launch the catalogue lists new bodies under is read for a burst over the launch's own background, for pieces that are new by numbering and share a parent's plane once each node's own precession is taken off, and for the cloud's velocity and spread. Such pieces, first published after a suspected step, confirm it; pieces in the plane of a body with no step seen on it are attributed to it, where the plane, the centre of their periods, their convergence or a step it alone made names it among the launch's bodies, and the rules against old clouds, young launches, single pieces and cataloguing batches allow; a notice naming the object confirms it; nothing in thirty days expires a step's alert; and a burst nobody can be named for is listed for review. Once raised, an alert keeps reading the parent's sets so the scorecard can say what waiting longer would have cost.
- Scorecard: the detector replayed over twenty-two years in the catalogue's publication order, the states carried from year to year, and scored on held-out years, with the tables below read from its committed result: the Confirmed line first, with its recall, false alarms, lead over the agencies' first statements, lag after the catalogue and timing error; then the parent-step line's detection rate and false alarms, the precision per persistence tier, and the step alerts confirmed; and every reported event dissected, with its cause, in [docs/detector/events.md](docs/detector/events.md).

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

The scorecard replays the detector over the Archive, every element set of every object in the order the catalogue published them, in runs of four hours as the product runs, and matches what it raises against the ground truth. **The target is on Confirmed alerts** ([docs/decisions/0007](docs/decisions/0007-the-target-is-on-confirmed-alerts.md), the owner's decision of 2026-10-10): a breakup the detector attributes to a parent from fresh fragments in the parent's plane, with or without a step seen first on the parent. A target is a reported breakup whose launch gained at least one fresh piece in the parent's plane within 180 days in the Archive; events with no such piece are listed apart and out of the denominator. A detection is the first confirmed verdict by pieces on the event's parent within 180 days after it; a confirmed verdict matching no reported event is a false alarm, and the false-alarm rate is over the confirmed events on every line. The lead is the days from the confirmation to the first statement by an agency the truth dates (NASA's quarterly news issue, dated to the first day of its month, or a U.S. Space Forces-Space notice), the lag the days after the first fresh piece's publication, the timing error the detector's instant of the event against the truth's. The targets are nine in ten confirmed and fewer than one false confirmation in ten, on the breakups reported to the day or better; the thresholds are fitted on the even years and the odd years are held out. [kpi/latest.md](kpi/latest.md) carries every split, and [docs/decisions/0004](docs/decisions/0004-the-scorecard-replays-the-detector-and-ci-must-reproduce-its-number.md) the scorecard's rules. The per-year files under `kpi/years/` (every verdict and every logged candidate, tens of megabytes a run) are artifacts of the KPI workflow, made again by `npm run kpi -- --all`, and are not committed; the aggregate is.

**This is the ninth phase of the detector, and the target is not reached.** The Confirmed channel attributes fresh pieces to the body of their launch whose plane they share and on whose orbit their periods centre, times the event by the pieces' convergence on it, and keeps the fifth phase's rules against old clouds still being catalogued ([docs/detector/d9-confirmed.md](docs/detector/d9-confirmed.md)). On the training years it confirms 22 of 35 headline targets (63%) at a false-alarm rate of 35%; on the held-out years 18 of 25 (72%, 52% to 86%) at 55% (42% to 68%), twelve of whose 31 false confirmations fall in 2005, the detector's first year, before it had a year of any launch's background to read. Every held-out confirmation with an agency's statement came before it, a median of six weeks, and a median of three hours after the catalogue published the first fresh piece. What limits it: launches where two bodies share the pieces' plane and orbit (an ullage motor and its twin, a payload and its stage, a fairing and its siblings), single pieces where one means nothing, the backlog and the young launch where a breakup's own cloud looks like an old one, and false confirmations from single pieces and cataloguing batches the rules do not catch. [docs/detector/events.md](docs/detector/events.md) lists every reported event with its Confirmed outcome and cause.

| Confirmed: the target, breakups A and B | Targets (fragments catalogued) | No fragments catalogued | Confirmed | Missed | Recall (95% interval) | False confirmations | False-alarm rate (95% interval) | Lead over the first agency statement, days: median (10th percentile) | Confirmed before it | Lag after the first fragment, days: median (90th percentile) | Timing error, minutes: median (90th percentile) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Validation: the odd years (2005 to 2025, 11 years) | 25 | 13 | 18 | 7 | 72% (52% to 86%) | 31 | 55% (42% to 68%) | 41.7 (9.2) | 18 of 18 | 0.1 (4.5) | 114.4 (21342.4) |
| Training: the even years (2006 to 2026, 11 years) | 35 | 15 | 22 | 13 | 63% (46% to 77%) | 18 | 35% (24% to 49%) | 35.7 (-32.2) | 14 of 21 | 0.1 (4.1) | 1248.6 (119134.1) |
| Fitted on the years to 2017 (2005 to 2017, 13 years) | 31 | 20 | 25 | 6 | 81% (64% to 91%) | 37 | 52% (41% to 63%) | 37.2 (-15.2) | 19 of 24 | 0.1 (0.1) | 1204.7 (119134.1) |
| Validated on the years from 2018 (2018 to 2026, 9 years) | 29 | 8 | 15 | 14 | 52% (34% to 69%) | 12 | 33% (20% to 50%) | 40.2 (-24.5) | 13 of 15 | 0.1 (39.3) | 59.2 (40265.4) |

| Confirmed, every line, validation: the odd years (2005 to 2025, 11 years) | Targets (fragments catalogued) | No fragments catalogued | No parent orbit before the event | Confirmed | Missed | Recall (95% interval) |
| --- | --- | --- | --- | --- | --- | --- |
| Breakups, confidence A and B (the target is 90%) | 25 | 9 | 4 | 18 | 7 | 72% (52% to 86%) |
| Breakups, confidence C | 5 | 5 | 7 | 3 | 2 | 60% (23% to 88%) |
| Breakups, confidence D | 5 | 3 | 1 | 0 | 5 | 0% (0% to 43%) |
| Anomalous events, confidence A and B | 6 | 4 | 0 | 2 | 4 | 33% (10% to 70%) |
| Anomalous events, confidence C and D | 2 | 2 | 0 | 1 | 1 | 50% (9% to 91%) |

| Confirmed verdicts, validation: the odd years (2005 to 2025, 11 years) | Count |
| --- | --- |
| Confirmed verdicts by pieces | 60 |
| Of which attributed from the pieces with no step seen on the parent | 43 |
| Detections (the first confirmation of a reported event) | 26 |
| Duplicates (a later confirmation of an event, or one on its fragment) | 1 |
| Exempt (inside an exempt window) | 2 |
| False confirmations (matching no reported event) | 31 |
| Of those, attributed with no step | 23 |
| Of those, on a payload / a rocket body / debris / an unknown body | 25 / 6 / 0 / 0 |
| Events confirmed on every line (the precision's numerator) | 25 |
| Of which with no fragment the scorecard reads in the plane | 1 |
| False-alarm rate (the target is under 10%) | 55% (42% to 68%) |
| Headline confirmations with an agency's statement dated | 18 |
| Of which the statement dated to the day / to the month | 0 / 18 |
| Of which confirmed before the statement | 18 |
| Lead over the first agency statement, days: median (10th percentile) | 41.7 (9.2) |
| Lag after the first fragment's publication, days: median (90th percentile) | 0.1 (4.5) |
| Timing error against the truth's instant, minutes: median (90th percentile) | 114.4 (21342.4) |

The parent-step lines follow as secondary measurements, as the scorecard measured them before the seventh decision record: an alert on the parent's own orbit raised before the first fragment's element set was published and before any notice, on events whose parent had at least five public element sets in the sixty days before (fewer is undetectable, listed apart). The whole catalogue's line detects about a third of the headline breakups at a false-alarm rate above 99%; the scoped line ([docs/detector/d7-scope.md](docs/detector/d7-scope.md)) is the point nearest the old target on the parent's data, a fifty-fold cut in false alarms for about one in eight of the headline breakups in its scope. The tier table reads every alert's later sets, so the trade between waiting and false alarms is shown with the numbers in hand; the last table is the step alerts the fragments or a notice confirmed ([docs/detector/d5-fitting.md](docs/detector/d5-fitting.md)).

| Parent step: validation: the odd years (2005 to 2025, 11 years) | Targets | Undetectable | Detected | Late | Missed | Detection rate |
| --- | --- | --- | --- | --- | --- | --- |
| Breakups, confidence A and B (the headline line) | 32 | 6 | 11 | 2 | 19 | 34% |
| Breakups, confidence C | 8 | 9 | 1 | 0 | 7 | 13% |
| Breakups, confidence D | 8 | 1 | 0 | 0 | 8 | 0% |
| Anomalous events, confidence A and B | 9 | 1 | 0 | 2 | 7 | 0% |
| Anomalous events, confidence C and D | 4 | 0 | 1 | 0 | 3 | 25% |

| Breakups A and B, scoped, validation: the odd years (2005 to 2025, 11 years) | Targets | Undetectable | Detected | Late | Missed | Detection rate (95% interval) | False alarms | False-alarm rate (95% interval) | Headline events left out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| The whole catalogue | 32 | 6 | 11 | 2 | 19 | 34% (20% to 52%) | 3158 | 100% (99% to 100%) | 0 |
| Scoped | 24 | 0 | 3 | 0 | 21 | 13% (4% to 31%) | 56 | 95% (86% to 98%) | 14 of 38 |

| Alerts, validation: the odd years (2005 to 2025, 11 years) | Count |
| --- | --- |
| Alerts (object verdicts, suspected or confirmed) | 3299 |
| Duplicates | 111 |
| Exempt | 13 |
| False alarms | 3158 |
| False-alarm rate | 100% |
| False alarms per 10,000 body-years | 170.2 |
| Lead over the catalogue, hours: median (10th percentile) | 479.0 (23.2) |
| Latency from the event, hours: median (90th percentile) | 129.5 (1153.4) |
| Confirmed share of the detections | 38% |
| Days to confirmation, median | 4.0 |
| Timing error, minutes, median | 34.6 |
| Cloud verdicts, for review (a burst with no parent step) | 86 |

| Precision per persistence tier, validation: the odd years (2005 to 2025, 11 years) | Raised | Detections still before the catalogue | False alarms | Precision | Share of the detections kept | Lead over the catalogue, hours: median (10th percentile) |
| --- | --- | --- | --- | --- | --- | --- |
| 2 post sets over 18 h, or 3 (as raised) | 3175 | 13 | 3158 | 0% | 100% | 479.0 (23.2) |
| 3 post sets | 2681 | 13 | 2664 | 0% | 100% | 479.0 (23.2) |
| 5 post sets | 2045 | 11 | 2030 | 1% | 85% | 576.1 (94.0) |
| 1 day of post sets | 2304 | 11 | 2289 | 0% | 85% | 576.1 (94.0) |
| 3 days of post sets | 1838 | 11 | 1823 | 1% | 85% | 564.1 (54.0) |
| 5 days of post sets | 1600 | 9 | 1585 | 1% | 69% | 557.0 (156.0) |
| 7 days of post sets | 1436 | 8 | 1424 | 1% | 62% | 529.0 (88.0) |

| The step alerts confirmed, validation: the odd years (2005 to 2025, 11 years) | Count |
| --- | --- |
| Events the catalogue reported (new bodies under the launch within 90 days) | 36 |
| Of which alerted on the parent (detected or late) | 14 |
| Of which confirmed | 5 |
| Confirmed share of the reported events | 14% |
| Days from the event to the confirmation, median (90th percentile) | 21.9 (49.1) |
| Days from the alert to the confirmation, median (90th percentile) | 4.0 (24.2) |
| Confirmed alerts (by the fragments or a notice) | 17 |
| Of which on a reported event's step (a detection or a late alert) | 5 |
| Of which inside an exempt window or a duplicate | 0 |
| Of which matching no reported event's step | 12 |
| Of those, on the parent of a reported event within the month before (the right object, the step late) | 4 |
| Precision of the confirmed alerts, on the step | 29% |
| Precision of the confirmed alerts, on the object | 53% |
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

Every statement also records when it can first have been public (a quarterly news issue by its month, from NASA's history's reference documents or the hand file; a notice by the day it was seen; ESA's report by its date; an analyst's or a company's post by its day), and every event its first statement, from which the scorecard reads the Confirmed line's lead over the agencies; `docs/truth.md` counts them by source. Where sources disagree, the time comes from the source that states it most finely, an authority first; the orbit from NASA's spread, then the quarterly news, then GCAT; the cause from NASA, then ESA, then GCAT; the piece count from the latest statement. Every disagreement is kept on the row. A reviewer who disagrees with a row edits the hand file or the overrides, never the built file; `npm run truth` rebuilds it and the tests fail until the committed file matches. [docs/truth.md](docs/truth.md) lists what was built from what.

## The Archive

The detector is backtested over the Archive: every catalogued object's element sets from 2005 to today, stripped to the fields the detector reads (the six mean elements, the drag terms, the element set number, the publication order) and stored one year at a time as compressed columns beside a table of the objects, joined to a snapshot of the satellite catalogue (CelesTrak), to the dates GCAT's payload catalogue gives for each payload's end of transmission (J. McDowell, planet4589.org, CC-BY-4.0), and to the space-weather indices of each day (GFZ Potsdam's Kp, ap and F10.7, CC BY 4.0; NASA OMNI2's Dst). It is built on a maintainer's machine from the public catalogue's yearly bundles of two-line sets and from its history class for the current year, by the scripts under `scripts/archive/`, and published as assets of this repository's `archive-v1` release with a manifest of hashes; `npm run archive:download -- 2024 2025` fetches years into `../breakups-archive`, verifying each. Neither the bundles nor the Archive are ever committed. [docs/decisions/0003](docs/decisions/0003-the-archive-is-a-release-asset-never-in-git.md) says why.

## Runtimes

- **Node** 22 or later. CI runs on Node 22 and 24.
- **Browsers**, through a bundler: the library is ES2022 modules and imports no Node built-in, a rule its own tests enforce.
- **Cloudflare Workers**: nothing to configure.

## Contributing and security

Patches are welcome; [CONTRIBUTING.md](CONTRIBUTING.md) says how they land. Report a vulnerability privately, as [SECURITY.md](SECURITY.md) describes.

## Licence

[MIT](LICENSE), © Orbinauts contributors. The ground truth cites its sources; GCAT's data is CC-BY-4.0, Jonathan McDowell, planet4589.org; NASA's publications are US Government works.
