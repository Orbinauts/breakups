# @orbinauts/breakups

On-orbit breakup detection from public orbital-element histories, in TypeScript, scored against every reported fragmentation since 2005.

The detector behind [Orbinauts](https://orbinauts.com), the live satellite map.

A satellite, a rocket body or a piece of debris that breaks up in orbit leaves two traces in public data: its own orbit jumps, by metres to kilometres, in the element sets the catalogue publishes for it; and days to weeks later new objects appear under its launch. This library reads the first trace to raise an alert before the second is published, and uses the second to confirm it. Every alert carries the numbers it was judged by.

What this repository holds: the **ground truth**, one row per breakup an authority reported since 1961, built from its sources by a script and checked by the tests; the **Archive** of every object's element sets since 2005, published as release assets; the **scorecard** that replays the detector over the Archive and scores it against the truth; and the **detector**, in its first phase: the parent's own step, measured against the object's own noise and the day's drag, on every object in every orbit.

- Ground truth: every reported breakup and anomalous event, with each source's statement verbatim, the resolved time, orbit, cause and piece count, which source each came from, and every disagreement between sources.
- Detector: each object's sets are kept in a ring and modelled by a robust local polynomial; a set that leaves the model by more than the object's own scatter and the band's live scale opens a candidate, and the candidate is suspected when the step persists across the next sets and is not a drift drag could produce. Every verdict carries the numbers it was judged by.
- Scorecard: the detector replayed over twenty-one years in the catalogue's publication order and scored on held-out years, with the table below read from its committed result.
- Next: classing manoeuvres by the object's own history, and confirming steps by the fragments the catalogue goes on to publish.

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

The scorecard replays the detector over the Archive, every element set of every object in the order the catalogue published them, in runs of four hours as the product runs, and matches what it raises against the ground truth. A target is a reported event whose parent had at least five public element sets in the sixty days before it; one with fewer is undetectable from public elements and listed apart. A detection is an alert on the parent's own orbit, raised before the first fragment's element set was published and before any notice; the same alert after that is late; an alert matching no reported event is a false alarm. The headline line is breakups reported to the day or better, scored on the odd years, held out from the even years the thresholds are fitted on; the other lines are shown so nothing is mixed into it. The targets are nine in ten detected and fewer than one false alarm in ten. [kpi/latest.md](kpi/latest.md) carries every split, and [docs/decisions/0004](docs/decisions/0004-the-scorecard-replays-the-detector-and-ci-must-reproduce-its-number.md) the rule.

**This is the first phase of the detector**, the parent-step channel alone. It classes no manoeuvres yet, so every persistent step on a working payload (a station-keeping burn, an orbit raise, a collision-avoidance move) is raised as suspected and scored as a false alarm; the false-alarm rate below is dominated by them, and the next phase takes them by the object's own step history. The detection rate is the number to read: of the reported breakups whose parent had public elements, how many the parent's own step caught before the fragments were catalogued. The thresholds were fitted on the even years; the odd years below were not looked at while choosing them. [docs/detector/d1-fitting.md](docs/detector/d1-fitting.md) records the sweeps.

| Validation: the odd years (2005 to 2025, 11 years) | Targets | Undetectable | Detected | Late | Missed | Detection rate |
| --- | --- | --- | --- | --- | --- | --- |
| Breakups, confidence A and B (the target is 90%) | 32 | 6 | 12 | 2 | 18 | 38% |
| Breakups, confidence C | 8 | 9 | 3 | 0 | 5 | 38% |
| Breakups, confidence D | 8 | 1 | 0 | 0 | 8 | 0% |
| Anomalous events, confidence A and B | 9 | 1 | 2 | 1 | 6 | 22% |
| Anomalous events, confidence C and D | 4 | 0 | 3 | 0 | 1 | 75% |

| Alerts, validation: the odd years (2005 to 2025, 11 years) | Count |
| --- | --- |
| Alerts (object verdicts, suspected or confirmed) | 74605 |
| Duplicates | 85 |
| Exempt | 8 |
| False alarms | 74489 |
| False-alarm rate (the target is under 10%) | 100% |
| False alarms per 10,000 body-years | 4014.3 |
| Lead over the catalogue, hours: median (10th percentile) | 516.3 (207.1) |
| Latency from the event, hours: median (90th percentile) | 129.5 (274.2) |
| Confirmed share of the detections | 0% |
| Days to confirmation, median | – |
| Timing error, minutes, median | 1029.1 |
| Cloud verdicts, for review | 0 |

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
