# @orbinauts/breakups

On-orbit breakup detection from public orbital-element histories, in TypeScript, scored against every reported fragmentation since 2005.

The detector behind [Orbinauts](https://orbinauts.com), the live satellite map.

## Current results

The detector is `confirmed-v10`, the twelfth phase of its build. Its target is to confirm 90% of reported breakups, with fewer than 10% of its confirmations false. **It does not reach that target on the held-out years.** Those years have also been read during development, so they are no longer a blind test: the clean test is the [prospective one](#prospective-test).

| Headline: breakups reported to the day | Held-out years (odd, 2007 to 2025) | Training years (even, 2006 to 2026) | Target |
| --- | --- | --- | --- |
| Confirmed, of the targets | 17 of 23 | 22 of 35 |  |
| Recall (95% interval) | 74% (54% to 87%) | 63% (46% to 77%) | 90% or more |
| False confirmations, of all events confirmed | 6 of 29 | 2 of 36 |  |
| False-alarm rate (95% interval) | 21% (10% to 38%) | 6% (2% to 18%) | under 10% |
| Median lead over the first agency statement | 42 days, 17 of 17 before it | 36 days, 14 of 21 before it |  |
| Median timing error | 41 minutes | 19 hours |  |

A target is a breakup an authority reported to the day or better, whose launch then gained fresh pieces in the parent's orbital plane. The thresholds are fitted on the even years and checked on the odd ones, the held-out years. The lead counts the days from the detector's confirmation to the first statement by an agency: NASA, ESA or U.S. Space Forces-Space. The timing error compares the detector's instant of the breakup with the one the ground truth gives. The scorecard regenerates these numbers: `npm run kpi` writes `kpi/latest.json`, and a test fails if any cell here differs from that file. The full tables are under [How well it does](#how-well-it-does).

## How it works

When a satellite or rocket body breaks up, the public catalogue lists new objects under its launch days to weeks later. Those pieces fly in the parent's orbit. The detector reads them to name the parent, confirm the breakup and time it.

What it reads:

- the element sets the public catalogue publishes for every tracked object, in the order it publishes them (once a day in the prospective test);
- the satellite catalogue: each object's name, class (payload, rocket body or debris), launch date, reentry date and operational status;
- GCAT's payload catalogue: the date each payload stopped transmitting;
- the daily space-weather indices: Kp, ap and F10.7 from GFZ Potsdam, and Dst from NASA's OMNI2.

A caller may also pass public notices that name an object. They confirm an alert, but never count toward the target.

A breakup is confirmed in five steps:

1. **New pieces appear under a launch.** Each run, the detector notes every body the catalogue lists for the first time under each launch. A body is a fresh piece only if it is new by its number: numbered above every object that existed at the event, with no earlier set. An old object catalogued late is not one.
2. **They fly in the orbital plane of one body of that launch.** Each piece's inclination and node are compared with those of the launch's payloads and rocket bodies. Every plane turns slowly under the Earth's flattening, so each node is carried to the same day before the comparison. Pieces within 0.2 degrees of inclination and 1.5 degrees of node share a plane.
3. **Their spread looks like a kick, not a release.** Fragments leave a breakup at metres to tens of metres a second, spread in period around the parent's. A dispenser releases satellites at under a metre a second. Pieces moving slower than 1 m/s from the parent confirm nothing.
4. **Some cases are excluded.** Stations and the crewed and cargo craft that visit them shed things on purpose, so their launches confirm nothing; a visiting craft's rocket body still can. Pieces first seen after their parent reentered belong to the reentry. Without a step on the parent, it takes three pieces at least, and a batch of three or four needs a common origin: three quarters of them must trace back to the parent within 48 hours of each other. A launch still cataloguing an older cloud, a launch under a month old, and a run that lists new bodies under many old launches at once are cataloguing, not a breakup.
5. **The parent is named and the event timed.** Among the bodies whose plane the pieces share, the parent is the one their orbital periods centre on. Where two bodies cannot be told apart, a step only one of them made, or a rocket body over a working payload, picks the parent, and the other is listed beside it. The pieces and the parent's last set before them are propagated back, and the instant they cross the parent's position is the breakup's time. A cloud no parent can be named for is listed for review, never counted.

A second layer watches every object's own orbit. Each new element set is compared with a robust fit of the object's recent sets, allowing for its own noise and the day's drag. A jump that lasts, and that the object's own manoeuvres, its usual altitudes, its launch-mates or its working status do not explain, is a suspected step. Such a step helps name the parent in step 5, and when pieces confirm it, the event is timed from the sets either side of it. Steps are logged as early "suspected" alerts but not scored on the target: on their own they were wrong more than 99% of the time (the parent-step tables under [How well it does](#how-well-it-does)). [docs/detector/README.md](docs/detector/README.md) describes every rule and where each threshold was fitted.

## Prospective test

The results above are a backtest. Since 2026-10-11 the detector `confirmed-v10` is frozen at the tag `frozen-confirmed-v10` and run once a day by a scheduled GitHub Actions workflow, `.github/workflows/prospective.yml`. Every alert it raises is appended to the [`prospective` branch](https://github.com/Orbinauts/breakups/tree/prospective), whose commit time proves when the alert was known. Each run's line in `runs.jsonl` also links the Actions run, a second timestamp kept by GitHub. Once the agencies' reports have caught up, `npm run prospective:score` scores the log against the truth. `gh workflow disable prospective.yml` pauses the test, and [docs/decisions/0008](docs/decisions/0008-the-detector-is-tested-prospectively-from-a-frozen-tag.md) says how and why it runs.

## What this repository holds

- The **ground truth**, `data/breakups.json`: one row per breakup an authority reported since 1961, with every source's statement, built from its sources by a script and checked by the tests.
- The **Archive**: every object's element sets since 2005, with the catalogue data the detector reads, published as release assets.
- The **scorecard**: the detector replayed over the Archive and scored against the truth, with every reported event dissected in [docs/detector/events.md](docs/detector/events.md).
- The **detector**, under `src/`, described in [docs/detector/README.md](docs/detector/README.md).

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

The scorecard replays the detector over the Archive. It feeds the detector every element set of every object in the order the catalogue published them, in runs of four hours as the product runs, and matches what it raises against the ground truth. [docs/decisions/0004](docs/decisions/0004-the-scorecard-replays-the-detector-and-ci-must-reproduce-its-number.md) gives the scorecard's rules. **The target is on Confirmed alerts**, the owner's decision of 2026-10-10 ([docs/decisions/0007](docs/decisions/0007-the-target-is-on-confirmed-alerts.md)).

- A **target** is a reported breakup whose launch gained at least one fresh piece in the parent's plane within 180 days. Events with no such piece, or no orbit of the parent before the event, are counted apart and left out of the denominator.
- A **detection** is the first confirmed verdict on the event's parent within 180 days after it. A confirmed verdict that matches no reported event is a **false confirmation**, and the false-alarm rate is over all the events confirmed, on every line.
- The **lead** is the days from the confirmation to the first agency statement the truth dates: NASA's quarterly news, dated to the first day of its month, a U.S. Space Forces-Space notice, or ESA's report. The **lag** is the days after the first fresh piece was published. The **timing error** compares the detector's instant of the event with the truth's.
- The headline is breakups reported to the day or better, confidence A and B. The thresholds are fitted on the even years and the odd years are held out. Every split scores from 2006, since 2005, the Archive's first year, is the detector's warm-up. A crewed station's launch is exempt.
- A verdict that names a launch and its candidate bodies (twins) is matched on the body it names first. The rows "twins matched at the launch" count it as a detection where a reported event's parent is among the candidates.

[kpi/latest.md](kpi/latest.md) carries every split. The per-year files under `kpi/years/`, every verdict and logged candidate, are tens of megabytes a run; they are artifacts of the KPI workflow, made again by `npm run kpi -- --all`, and only the aggregate is committed.

The target is not reached on either split. The held-out years were read while earlier phases were fitted, so their numbers are a measurement, not a blind validation. Three of the previous phase's nine held-out false confirmations are now confirmations of separations that GCAT's satellite catalogue dates. Every held-out confirmation with an agency's statement came before that statement, by a median of six weeks. It came a median of three hours after the catalogue published the first fresh piece. What is left on both splits is single pieces, small and large batches under old launches, and twins the pieces cannot tell apart. [docs/detector/events.md](docs/detector/events.md) lists every reported event with its outcome and cause, and [docs/detector/README.md](docs/detector/README.md) what each phase changed.

| Confirmed: the target, breakups A and B | Targets (fragments catalogued) | No fragments catalogued | Confirmed | Missed | Recall (95% interval) | False confirmations | False-alarm rate (95% interval) | Lead over the first agency statement, days: median (10th percentile) | Confirmed before it | Lag after the first fragment, days: median (90th percentile) | Timing error, minutes: median (90th percentile) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Validation: the odd years (2007 to 2025, 10 years) | 23 | 11 | 17 | 6 | 74% (54% to 87%) | 6 | 21% (10% to 38%) | 41.7 (9.8) | 17 of 17 | 0.1 (4.0) | 40.6 (21342.4) |
| Validation: the odd years, twins matched at the launch | 23 | 11 | 17 | 6 | 74% (54% to 87%) | 6 | 21% (10% to 38%) | 41.7 (9.8) | 17 of 17 | 0.1 (4.0) | 40.6 (21342.4) |
| Training: the even years (2006 to 2026, 11 years) | 35 | 15 | 22 | 13 | 63% (46% to 77%) | 2 | 6% (2% to 18%) | 35.7 (-32.2) | 14 of 21 | 0.1 (5.9) | 1125.9 (173291.7) |
| Training: the even years, twins matched at the launch | 35 | 15 | 22 | 13 | 63% (46% to 77%) | 2 | 6% (2% to 18%) | 35.7 (-24.5) | 14 of 21 | 0.1 (5.9) | 1125.9 (173291.7) |
| Fitted on the years to 2017 (2006 to 2017, 12 years) | 29 | 18 | 23 | 6 | 79% (62% to 90%) | 6 | 16% (7% to 30%) | 37.2 (-15.2) | 17 of 22 | 0.1 (0.1) | 583.0 (118847.1) |
| Fitted on the years to 2017, twins matched at the launch | 29 | 18 | 23 | 6 | 79% (62% to 90%) | 6 | 16% (7% to 30%) | 37.2 (-12.3) | 17 of 22 | 0.1 (0.1) | 583.0 (89663.5) |
| Validated on the years from 2018 (2018 to 2026, 9 years) | 29 | 8 | 16 | 13 | 55% (38% to 72%) | 2 | 7% (2% to 23%) | 40.2 (-24.5) | 14 of 16 | 0.1 (17.2) | 72.8 (40265.4) |
| Validated on the years from 2018, twins matched at the launch | 29 | 8 | 16 | 13 | 55% (38% to 72%) | 2 | 7% (2% to 23%) | 40.2 (-24.5) | 14 of 16 | 0.1 (17.2) | 72.8 (40265.4) |

| Confirmed, every line, validation: the odd years (2007 to 2025, 10 years) | Targets (fragments catalogued) | No fragments catalogued | No parent orbit before the event | Confirmed | Missed | Recall (95% interval) |
| --- | --- | --- | --- | --- | --- | --- |
| Breakups, confidence A and B (the target is 90%) | 23 | 7 | 4 | 17 | 6 | 74% (54% to 87%) |
| Breakups, confidence C | 18 | 18 | 12 | 3 | 15 | 17% (6% to 39%) |
| Breakups, confidence D | 6 | 6 | 0 | 0 | 6 | 0% (0% to 39%) |
| Anomalous events, confidence A and B | 5 | 4 | 0 | 0 | 5 | 0% (0% to 43%) |
| Anomalous events, confidence C and D | 46 | 22 | 2 | 3 | 43 | 7% (2% to 18%) |

| Confirmed verdicts, validation: the odd years (2007 to 2025, 10 years) | Count |
| --- | --- |
| Confirmed verdicts by pieces | 31 |
| Of which attributed from the pieces with no step seen on the parent | 18 |
| Detections (the first confirmation of a reported event) | 22 |
| Duplicates (a later confirmation of an event, or one on its fragment) | 2 |
| Exempt (inside an exempt window) | 1 |
| False confirmations (matching no reported event) | 6 |
| Of those, attributed with no step | 4 |
| Verdicts naming the launch and its candidate bodies (twins), matched on the body named first | 1 |
| Of those, on a payload / a rocket body / debris / an unknown body | 3 / 3 / 0 / 0 |
| Events confirmed on every line (the precision's numerator) | 23 |
| Of which with no fragment the scorecard reads in the plane | 0 |
| False-alarm rate (the target is under 10%) | 21% (10% to 38%) |
| Headline confirmations with an agency's statement dated | 17 |
| Of which the statement dated to the day / to the month | 0 / 17 |
| Of which confirmed before the statement | 17 |
| Lead over the first agency statement, days: median (10th percentile) | 41.7 (9.8) |
| Lag after the first fragment's publication, days: median (90th percentile) | 0.1 (4.0) |
| Timing error against the truth's instant, minutes: median (90th percentile) | 40.6 (21342.4) |

The tables below measure the second layer, the step on the parent's own orbit, as the scorecard measured it before the target moved. They are kept as secondary measurements. A target there is an event whose parent had at least five public sets in the sixty days before it. Detected means an alert on the parent's step before the first fragment's set was published, and late means after it. The scoped line keeps only old objects with large, kicked steps that change the drag term and hold for a week ([docs/detector/d7-scope.md](docs/detector/d7-scope.md)). The tier table shows that waiting longer before raising a step does not make it precise.

| Parent step: validation: the odd years (2007 to 2025, 10 years) | Targets | Undetectable | Detected | Late | Missed | Detection rate |
| --- | --- | --- | --- | --- | --- | --- |
| Breakups, confidence A and B (the headline line) | 28 | 6 | 10 | 2 | 16 | 36% |
| Breakups, confidence C | 33 | 15 | 3 | 0 | 30 | 9% |
| Breakups, confidence D | 12 | 0 | 0 | 0 | 12 | 0% |
| Anomalous events, confidence A and B | 8 | 1 | 0 | 1 | 7 | 0% |
| Anomalous events, confidence C and D | 68 | 2 | 3 | 0 | 65 | 4% |

| Breakups A and B, scoped, validation: the odd years (2007 to 2025, 10 years) | Targets | Undetectable | Detected | Late | Missed | Detection rate (95% interval) | False alarms | False-alarm rate (95% interval) | Headline events left out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| The whole catalogue | 28 | 6 | 10 | 2 | 16 | 36% (21% to 54%) | 2448 | 99% (99% to 100%) | 0 |
| Scoped | 21 | 0 | 3 | 0 | 18 | 14% (5% to 35%) | 52 | 95% (85% to 98%) | 13 of 34 |

| Alerts, validation: the odd years (2007 to 2025, 10 years) | Count |
| --- | --- |
| Alerts (object verdicts, suspected or confirmed) | 2638 |
| Duplicates | 121 |
| Exempt | 50 |
| False alarms | 2448 |
| False-alarm rate | 99% |
| False alarms per 10,000 body-years | 138.3 |
| Lead over the catalogue, hours: median (10th percentile) | 479.0 (94.0) |
| Latency from the event, hours: median (90th percentile) | 140.1 (1384.0) |
| Confirmed share of the detections | 38% |
| Days to confirmation, median | 4.0 |
| Timing error, minutes, median | 34.6 |
| Cloud verdicts, for review (a burst with no parent step) | 73 |

| Precision per persistence tier, validation: the odd years (2007 to 2025, 10 years) | Raised | Detections still before the catalogue | False alarms | Precision | Share of the detections kept | Lead over the catalogue, hours: median (10th percentile) |
| --- | --- | --- | --- | --- | --- | --- |
| 2 post sets over 18 h, or 3 (as raised) | 2467 | 16 | 2448 | 1% | 100% | 479.0 (94.0) |
| 3 post sets | 2417 | 16 | 2398 | 1% | 100% | 479.0 (94.0) |
| 5 post sets | 1822 | 14 | 1805 | 1% | 88% | 576.1 (94.0) |
| 1 day of post sets | 2079 | 14 | 2062 | 1% | 88% | 576.1 (94.0) |
| 3 days of post sets | 1648 | 12 | 1633 | 1% | 75% | 564.1 (54.0) |
| 5 days of post sets | 1432 | 10 | 1417 | 1% | 63% | 575.4 (156.0) |
| 7 days of post sets | 1291 | 7 | 1281 | 1% | 44% | 404.1 (88.0) |

| The step alerts confirmed, validation: the odd years (2007 to 2025, 10 years) | Count |
| --- | --- |
| Events the catalogue reported (new bodies under the launch within 90 days) | 87 |
| Of which alerted on the parent (detected or late) | 14 |
| Of which confirmed | 7 |
| Confirmed share of the reported events | 8% |
| Days from the event to the confirmation, median (90th percentile) | 25.6 (54.0) |
| Days from the alert to the confirmation, median (90th percentile) | 8.7 (27.2) |
| Confirmed alerts (by the fragments or a notice) | 13 |
| Of which on a reported event's step (a detection or a late alert) | 6 |
| Of which inside an exempt window or a duplicate | 1 |
| Of which matching no reported event's step | 6 |
| Of those, on the parent of a reported event within the month before (the right object, the step late) | 4 |
| Precision of the confirmed alerts, on the step | 46% |
| Precision of the confirmed alerts, on the object | 77% |
| Targets with an agency's statement dated in the truth (the notices) | 0 |
| Of which confirmed before that statement | 0 |

## Ground truth

A positive event is a breakup that was reported, so we are sure it happened: by NASA, by ESA, by U.S. Space Forces-Space, by a named analyst, by GCAT's satellite catalogue dating the separation of pieces from their parent, or by the public catalogue itself listing a burst of new debris under the parent's launch (at least five objects within thirty days, more than ninety days after the launch, and at least a fifth of the debris the launch already had). `data/breakups.json` holds every one found, 1961 to today, each with the statements of every source that reported it and the values resolved from them. The scorecard runs over the events from 2005, where the yearly element bundles begin, and scores NASA's two kinds apart: the detection target is for breakups, the destructive kind; anomalous events, where a body sheds a piece or two at low speed and stays intact, barely move the parent and are reported on a second line. Events whose parent has no public element sets at all are listed apart and left out of the denominator, and the headline is over events reported to the day or better.

| Events from 2005 | Count |
| --- | --- |
| All | 623 |
| Scoreable (breakups and anomalous events of a catalogued object) | 363 |
| Breakups | 258 |
| Anomalous events (low-velocity shedding) | 146 |
| Aerodynamic breakups at reentry (kept out) | 31 |
| Objects released on purpose (kept out) | 183 |
| Reports naming no object (kept out) | 5 |
| Confidence A (an authority states the minute) | 74 |
| Confidence B (an authority states the day, or a window of three days at most) | 31 |
| Confidence C (GCAT alone, an authority's month, or an analyst's dating) | 225 |
| Confidence D (pieces in the catalogue, or news with no time) | 33 |

The sources, and what each gives:

- **NASA, History of On-Orbit Satellite Fragmentations, 16th edition** (NASA/TP-20220019160, December 2022): every breakup and anomalous event to 1 May 2022, each with its date, time, altitude, assessed cause and the parent's pre-event element set. Read from the text of the PDF.
- **NASA, Orbital Debris Quarterly News**: each breakup since the cut-off, in prose. Typed by hand with issue and page.
- **GCAT, Space Debris Clouds** (Jonathan McDowell, planet4589.org, CC-BY-4.0): 402 debris clouds with the parent, the event date and the orbit. Read from its table.
- **GCAT, the satellite catalogue** (Jonathan McDowell, planet4589.org, CC-BY-4.0): every catalogued fragment and component with its parent, its separation date and its type (fragmentation debris by cause, anomalous debris, aerodynamic breakup, or a component released on purpose). Read uniformly for every object and every year: the pieces of one parent separated within three days of each other are one separation, its kind the pieces' type (a release at launch is the launch's own staging and is left out); a separation no other source reports is an event of confidence C (D where GCAT dates it to a year only), one another source reports joins its event. Kept as a snapshot reduced to the rows and columns read, with the whole file's hash.
- **ESA, Space Environment Report 2025**, Table 3.7: the fragmentations of 2024, the object unnamed.
- **U.S. Space Forces-Space notices**, named analysts, LeoLabs' notifications and news reports for 2025 to 2026, and the public catalogue where fragments were published with no report.

Every statement also records when it can first have been public (a quarterly news issue by its month, from NASA's history's reference documents or the hand file; a notice by the day it was seen; ESA's report by its date; an analyst's or a company's post by its day), and every event its first statement, from which the scorecard reads the Confirmed line's lead over the agencies; `docs/truth.md` counts them by source. Where sources disagree, the time comes from the source that states it most finely, an authority first; the orbit from NASA's spread, then the quarterly news, then GCAT; the cause from NASA, then ESA, then GCAT; the piece count from the latest statement. GCAT's satellite catalogue decides a field only where no other source states the event. Every disagreement is kept on the row. A reviewer who disagrees with a row edits the hand file or the overrides, never the built file; `npm run truth` rebuilds it and the tests fail until the committed file matches. [docs/truth.md](docs/truth.md) lists what was built from what.

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
