# @orbinauts/breakups

Detects satellites and rocket stages that break up in orbit, from public orbital data alone, in TypeScript.

## What it does

When a satellite or a spent rocket stage breaks up in orbit, its fragments appear in the public catalogue of tracked objects over the following days and weeks. This library reads that catalogue and the orbits it publishes. It names the object that broke up and works out when it happened, typically weeks before the first official report. It is for satellite operators, researchers, journalists and anyone curious about the space around Earth. It also ships the list of every reported breakup since 1961, which it is scored against. It is the detector behind [Orbinauts](https://orbinauts.com), a live satellite map.

## How well it works

The detector's settings were tuned on the even years from 2006 to 2026. They were tested on the odd years from 2007 to 2025, which were held back for that. On those held-back years, the current version, `confirmed-v10`, scores:

<!-- kpi:summary:begin -->

| Held-out years (the odd years, 2007 to 2025) | Result | Target |
| --- | --- | --- |
| Reported breakups confirmed | 74% (17 of 23) | 90% or more |
| Confirmations that were false | 21% (6 of 29) | under 10% |
| Median lead over the first official report | 42 days (17 of 17 confirmed before it) |  |
| Median error in the time of the breakup | 41 minutes |  |

<!-- kpi:summary:end -->

A false confirmation is an alert for a breakup that no one reported. The lead counts the days from the detector's alert to the first report by NASA, ESA or the U.S. Space Force. The target is to confirm nine reported breakups in ten, with fewer than one confirmation in ten false. <!-- kpi:target:begin -->**It does not reach that target yet.**<!-- kpi:target:end --> The held-out years were also looked at during development, so the cleanest measure is the [live test](https://github.com/Orbinauts/breakups#live-test), which runs every day on new data.

The [full results](https://github.com/Orbinauts/breakups/blob/main/docs/results.md) give every table, the training years and how each number is defined.

## How it works

It reads only public data: the orbits the catalogue publishes for every tracked object, the catalogue's list of objects and launches, the dates satellites stopped transmitting, and daily space-weather indices. A breakup is confirmed in five steps.

1. **New fragments appear.** The catalogue lists new objects under a launch that flew months or years ago.
2. **They share one object's orbit.** The fragments fly in the same orbital plane as one satellite or stage of that launch.
3. **They were kicked, not released.** They drift apart at metres per second, faster than a satellite dispenser would push anything.
4. **Look-alikes are left out.** Space stations and their visiting craft, objects that already fell back, and routine late cataloguing confirm nothing.
5. **The parent is named and the moment found.** The fragments' orbits are traced back to the instant they met their parent.

A second layer watches each object's own orbit for a sudden, lasting jump, and logs it as an early "suspected" alert. These alerts are not scored against the target, because on their own they were wrong more than 99% of the time. [How the detector works](https://github.com/Orbinauts/breakups/blob/main/docs/detector/README.md) describes every rule and where each threshold comes from.

## Install

```sh
npm install @orbinauts/breakups
```

It needs Node 22 or later, and also runs in browsers through a bundler and in Cloudflare Workers. The package is ESM only, ships TypeScript types, and imports no Node built-in.

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

## Learn more

- [Results in full](https://github.com/Orbinauts/breakups/blob/main/docs/results.md): every table, on the held-out and the training years, with the definitions.
- [How the detector works](https://github.com/Orbinauts/breakups/blob/main/docs/detector/README.md): every rule, where each threshold was fitted, and how it got here.
- [The ground truth](https://github.com/Orbinauts/breakups/blob/main/docs/ground-truth.md): what counts as a breakup, its sources and how they are reconciled.
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
