# @orbinauts/breakups

Detects satellites and rocket stages that break up in orbit, from public orbital data alone, in TypeScript.

## What it does

When a satellite or a spent rocket stage breaks up in orbit, its fragments appear in the public catalogue of tracked objects over the following days and weeks. This library reads that catalogue and the orbits it publishes. It names the object that broke up and works out when it happened, typically within hours of the catalogue publishing the first fragment. It is for satellite operators, researchers, journalists and anyone curious about the space around Earth. It also ships the list of every reported breakup since 1961, which it is scored against. It is the detector behind [Orbinauts](https://orbinauts.com), a live satellite map.

## How well it works

The detector raises two kinds of alert. A **confirmed** breakup is named once its fragments are catalogued. An **early warning** (a "suspected" breakup) comes before that, from the satellite's or stage's own orbit alone.

The detector's settings were tuned on the even years from 2006 to 2026. They were tested on the odd years from 2007 to 2025, which were held back for that. On those held-back years, the current version, `confirmed-v10`, scores:

<!-- kpi:summary:begin -->

| Held-out years (the odd years, 2007 to 2025) | Result | Target |
| --- | --- | --- |
| Reported breakups confirmed | 74% (17 of 23) | 90% or more |
| Confirmations that were false | 21% (6 of 29) | under 10% |
| Median lead over the first agency notice dated to the day | – |  |
| Median lead over NASA's quarterly news, dated to its month | – |  |
| First agency statements dated to the day, to the month | 0 to the day, 17 to the month |  |
| Median error in the time of the breakup | 41 minutes |  |

<!-- kpi:summary:end -->

<!-- kpi:early-warning:begin -->

| Early warning (suspected), the same years | Result |
| --- | --- |
| Reported breakups flagged before the first fragment was catalogued | 36% (10 of 28) |
| Flagged only after the first fragment (late) | 2 of 28 |
| False alarms | 245 a year, 99% of all early warnings (2448 of 2464) |
| Median lead over the first catalogued fragment | 20 days |
| Median error in the time of the breakup | 35 minutes |

<!-- kpi:early-warning:end -->

A false confirmation is an alert for a breakup that no one reported; one with no report yet is pending for 90 days, counted neither way, since the agencies report months after an event. The lead of a confirmation is read two ways: the days from the detector's alert to the first agency notice dated to the day (a U.S. Space Force notice, ESA's report), and to NASA's quarterly news, which is dated only to its month, so that lead is the least it can have been. The U.S. Space Force often posts a notice within a day or two of a breakup; so the first lead is the one that says whether a confirmation was news. The target is to confirm nine reported breakups in ten, with fewer than one confirmation in ten false. <!-- kpi:target:begin -->**It does not reach that target yet.**<!-- kpi:target:end -->

An early warning is raised when a satellite or a rocket stage jumps to a new orbit and stays there, and nothing it is known to do explains the jump. When it is right, it comes weeks before the first fragment is catalogued, and it typically places the moment of the breakup to within the hour. But most early warnings are other orbit changes, mostly satellites firing their own engines (manoeuvres) in ways the detector cannot tell apart from a breakup. So an early warning is a watch list, not a confirmation. The target is set on confirmed breakups; the early warning is measured and reported beside it, and [tests on real orbit histories](https://github.com/Orbinauts/breakups/blob/main/test/early-warning.test.ts) check that it still flags known breakups and stays quiet on known manoeuvres.

The held-out years were also looked at during development, so the cleanest measure is the [live test](https://github.com/Orbinauts/breakups#live-test), which runs every day on new data.

The [full results](https://github.com/Orbinauts/breakups/blob/main/docs/results.md) give every table, the training years and how each number is defined.

## How it works

It reads only public data: the orbits the catalogue publishes for every tracked object, the catalogue's list of objects and launches, the dates satellites stopped transmitting, and daily space-weather indices. A breakup is confirmed in five steps.

1. **New fragments appear.** The catalogue lists new objects under a launch that flew months or years ago.
2. **They share one object's orbit.** The fragments fly in the same orbital plane as one satellite or stage of that launch.
3. **They were kicked, not released.** They drift apart at metres per second, faster than a satellite dispenser would push anything.
4. **Look-alikes are left out.** Space stations and their visiting craft, objects that already fell back, and routine late cataloguing confirm nothing.
5. **The parent is named and the moment found.** The fragments' orbits are traced back to the instant they met their parent.

A second layer watches each object's own orbit for a sudden, lasting jump, and raises it as an early warning, a "suspected" breakup, before any fragment is catalogued. [How the detector works](https://github.com/Orbinauts/breakups/blob/main/docs/detector/README.md) describes every rule and where each threshold comes from.

## The life of an alert

Every alert goes through the same stages.

1. **A jump.** One new orbit of an object lands far from where its own past orbits said it would be. The detector notes it and waits for the next ones. A jump that the next orbits undo was a bad measurement, and is dropped.
2. **The jump holds.** If the next orbits stay where the jump put them, the detector judges it once. It is cleared as a manoeuvre where the object's past, its being in working order, or its neighbours making the same move explain it. Otherwise it is raised as an early warning.
3. **The early warning ends** in one of four ways. It is confirmed when fragments appear in the object's orbital plane, or an agency announces the breakup. It is dismissed when the new objects catalogued under its launch all turn out to be old pieces. It expires when nothing confirms it within 30 days. Or it is still open when the data ends.
4. **A breakup can also be confirmed with no early warning first**, straight from its fragments, a few hours after the first one is catalogued, and even from a jump that was cleared as a manoeuvre.

On the held-out years, this is how often each stage came, and how likely each was to be a real breakup:

<!-- kpi:lifecycle:begin -->

| What became of each orbit jump that held, on the held-out years | How many | Chance it was a reported breakup |
| --- | --- | --- |
| Cleared as a manoeuvre | 69179 | 0.04% (28 of 69179) |
| Raised as an early warning, a median of six days after the breakup and three weeks before the first fragment | 2633 | 0.77% (19 of 2463) |
| ... then confirmed by fragments or a notice, a median of four days later | 8 (0.30%) | 75% (6 of 8) |
| ... then dismissed: the new pieces under its launch were all old | 110 (4.2%) | 1.0% (1 of 96) |
| ... then expired: nothing confirmed it within 30 days | 2488 (94%) | 0.47% (11 of 2335) |
| ... still open where the data ends | 27 (1.0%) | 4.2% (1 of 24) |

| What happened to the 23 reported breakups whose fragments were catalogued, on the held-out years | Share |
| --- | --- |
| An early warning first, then confirmed | 39% (9 of 23) |
| An early warning, never confirmed | 4% (1 of 23) |
| Confirmed from the fragments, with no early warning first | 35% (8 of 23) |
| Never flagged | 22% (5 of 23) |

<!-- kpi:lifecycle:end -->

<!-- kpi:lifecycle-caveat:begin -->A cleared or an expired alert is no guarantee that nothing happened: on the held-out years, 0.47% of the expired early warnings (11) and 0.04% of the jumps cleared as manoeuvres (28) were on a reported breakup.<!-- kpi:lifecycle-caveat:end --> The [full results](https://github.com/Orbinauts/breakups/blob/main/docs/results.md#the-life-of-an-alert) give the same on the training years, with the uncertainty of each number.

## Install

```sh
npm install @orbinauts/breakups
```

It needs Node 22 or later, and also runs in browsers through a bundler and in Cloudflare Workers. The package is ESM only, ships TypeScript types, and imports no Node built-in.

A caller that runs the detector hands each run the states the last one returned. To keep them between runs in a key-value store or a file, write them with `serialiseStates` and read them back with `reviveStates`: plain `JSON.stringify` loses them, since they are kept in maps and hold the infinities and NaN, which JSON writes as `null`.

## Quick start

Read the list of reported breakups the package ships, and print the three most recent ones:

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

<!-- truth:quick-start:begin -->

```text
by 2026-09-04T00:00Z Yaogan-50 02 (68196), breakup, confidence D, LEO
2026-09-13T21:13Z USA 32 (19460), breakup, confidence A, LEO
2026-10-05T09:45Z Meteor 2-7 (second event) (12456), breakup, confidence C, LEO
```

<!-- truth:quick-start:end -->

Each row also carries the parent's orbit, every source's statement and the date of the first official report.

## Live test

Since 11 October 2026, a frozen copy of the detector runs once a day on GitHub Actions, on that day's public data. Every alert it raises is logged with a timestamp on the [`prospective` branch](https://github.com/Orbinauts/breakups/tree/prospective), and each confirmed breakup opens an [issue labelled `prospective-alert`](https://github.com/Orbinauts/breakups/issues?q=label%3Aprospective-alert). Each week the log is scored against the official reports, and the score is on the [results page](https://github.com/Orbinauts/breakups/blob/main/docs/results.md#the-live-test).

The same run publishes the breakups fit to show, those the detector confirmed or a report names, as JSON on this project's GitHub Pages, at [orbinauts.github.io/breakups/v1/breakups.json](https://orbinauts.github.io/breakups/v1/breakups.json): the [published breakups page](https://github.com/Orbinauts/breakups/blob/main/docs/published.md) gives the files, their fields and the rules.

## Learn more

- [Results in full](https://github.com/Orbinauts/breakups/blob/main/docs/results.md): every table, on the held-out and the training years, with the definitions.
- [How the detector works](https://github.com/Orbinauts/breakups/blob/main/docs/detector/README.md): every rule, where each threshold was fitted, and how it got here.
- [The ground truth](https://github.com/Orbinauts/breakups/blob/main/docs/ground-truth.md): what counts as a breakup, its sources and how they are reconciled.
- [The published breakups](https://github.com/Orbinauts/breakups/blob/main/docs/published.md): the JSON files the daily run publishes, what is shown and why.
- [The backtest Archive](https://github.com/Orbinauts/breakups/blob/main/docs/archive.md): every tracked object's orbits since 2005, and how to download them.
- [Design decisions](https://github.com/Orbinauts/breakups/tree/main/docs/decisions): why the project is built the way it is.
- [Contributing](https://github.com/Orbinauts/breakups/blob/main/CONTRIBUTING.md): how changes land, and how the project keeps itself up to date every week.
- [Changelog](https://github.com/Orbinauts/breakups/blob/main/CHANGELOG.md): what changed in each version.
- [Security](https://github.com/Orbinauts/breakups/blob/main/SECURITY.md): how to report a vulnerability privately.

## Licence and data credits

The code is under the [MIT licence](https://github.com/Orbinauts/breakups/blob/main/LICENSE), © Orbinauts contributors. The data comes from public sources, each cited where it is used:

- **NASA**: the History of On-Orbit Satellite Fragmentations and the Orbital Debris Quarterly News, US Government works; and the OMNI2 Dst index.
- **GCAT**, by Jonathan McDowell, planet4589.org, under CC-BY-4.0: the debris clouds, the satellite catalogue and the payload catalogue.
- **ESA**: the Space Environment Report.
- **CelesTrak**: the snapshot of the satellite catalogue.
- **GFZ Potsdam**: the Kp, ap and F10.7 space-weather indices, under CC BY 4.0.
- **U.S. Space Forces-Space** notices, named analysts and news reports, each cited on its row of the ground truth.
