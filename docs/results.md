# Results

How well the detector finds the breakups that were reported, measured over every year since 2005. This page carries every table of the scorecard; the [README](../README.md) gives the summary.

The detector is `confirmed-v10`, the twelfth phase of its build. Its target is to confirm 90% of reported breakups, with fewer than 10% of its confirmations false. <!-- kpi:splits:begin -->The target is not reached on either split.<!-- kpi:splits:end --> The held-out years have also been read during development, so they are no longer a blind test: the clean test is the [live test](#the-live-test), run every day by a version frozen before it started.

## Contents

- [The headline](#the-headline)
- [How the numbers are made](#how-the-numbers-are-made)
- [The Confirmed line, the target](#the-confirmed-line-the-target)
- [The parent's step, a secondary measurement](#the-parents-step-a-secondary-measurement)
- [The live test](#the-live-test)

## The headline

<!-- kpi:current:begin -->

| Headline: breakups reported to the day | Held-out years (odd, 2007 to 2025) | Training years (even, 2006 to 2026) | Target |
| --- | --- | --- | --- |
| Confirmed, of the targets | 17 of 23 | 22 of 35 |  |
| Recall (95% interval) | 74% (54% to 87%) | 63% (46% to 77%) | 90% or more |
| False confirmations, of all events confirmed | 6 of 29 | 2 of 36 |  |
| False-alarm rate (95% interval) | 21% (10% to 38%) | 6% (2% to 18%) | under 10% |
| Median lead over the first agency statement | 42 days, 17 of 17 before it | 36 days, 14 of 21 before it |  |
| Median timing error | 41 minutes | 19 hours |  |

<!-- kpi:current:end -->

A target is a breakup an authority reported to the day or better, whose launch then gained fresh pieces in the parent's orbital plane. The thresholds are fitted on the even years and checked on the odd ones, the held-out years. The lead counts the days from the detector's confirmation to the first statement by an agency: NASA, ESA or U.S. Space Forces-Space. The timing error compares the detector's instant of the breakup with the one the ground truth gives. The scorecard regenerates these numbers: `npm run kpi` writes `kpi/latest.json`, `npm run kpi:readme` writes this page's tables and the README's summary from it, and a test fails if any cell here differs from that file.

## How the numbers are made

The scorecard replays the detector over the [Archive](archive.md). It feeds the detector every element set of every object in the order the catalogue published them, in runs of four hours as the product runs, and matches what it raises against the [ground truth](ground-truth.md). [docs/decisions/0004](decisions/0004-the-scorecard-replays-the-detector-and-ci-must-reproduce-its-number.md) gives the scorecard's rules. **The target is on Confirmed alerts**, the owner's decision of 2026-10-10 ([docs/decisions/0007](decisions/0007-the-target-is-on-confirmed-alerts.md)).

- A **target** is a reported breakup whose launch gained at least one fresh piece in the parent's plane within 180 days. Events with no such piece, or no orbit of the parent before the event, are counted apart and left out of the denominator.
- A **detection** is the first confirmed verdict on the event's parent within 180 days after it. A confirmed verdict that matches no reported event is a **false confirmation**, and the false-alarm rate is over all the events confirmed, on every line.
- The **lead** is the days from the confirmation to the first agency statement the truth dates: NASA's quarterly news, dated to the first day of its month, a U.S. Space Forces-Space notice, or ESA's report. The **lag** is the days after the first fresh piece was published. The **timing error** compares the detector's instant of the event with the truth's.
- The headline is breakups reported to the day or better, confidence A and B. The thresholds are fitted on the even years and the odd years are held out: those are the two **splits**. Every split scores from 2006, since 2005, the Archive's first year, is the detector's warm-up. A crewed station's launch is exempt.
- A verdict that names a launch and its candidate bodies (twins) is matched on the body it names first. The rows "twins matched at the launch" count it as a detection where a reported event's parent is among the candidates.

[kpi/latest.md](../kpi/latest.md) carries every split. The per-year files under `kpi/years/`, every verdict and logged candidate, are tens of megabytes a run; they are artifacts of the KPI workflow, made again by `npm run kpi -- --all`, and only the aggregate is committed.

## The Confirmed line, the target

The held-out years were read while earlier phases were fitted, so their numbers are a measurement, not a blind validation. Three of the previous phase's nine held-out false confirmations are now confirmations of separations that GCAT's satellite catalogue dates. <!-- kpi:medians:begin -->Every held-out confirmation with an agency's statement came before that statement, and the median one by six weeks. The median confirmation came three hours after the catalogue published the first fresh piece.<!-- kpi:medians:end --> What is left on both splits is single pieces, small and large batches under old launches, and twins the pieces cannot tell apart. [docs/detector/events.md](detector/events.md) lists every reported event with its outcome and cause, and [docs/detector/README.md](detector/README.md) what each phase changed.

<!-- kpi:confirmed:begin -->

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

<!-- kpi:confirmed:end -->

## The parent's step, a secondary measurement

The tables below measure the second layer, the step on the parent's own orbit, as the scorecard measured it before the target moved. They are kept as secondary measurements. A target there is an event whose parent had at least five public sets in the sixty days before it. Detected means an alert on the parent's step before the first fragment's set was published, and late means after it. The scoped line keeps only old objects with large, kicked steps that change the drag term and hold for a week ([docs/detector/d7-scope.md](detector/d7-scope.md)). The tier table shows that waiting longer before raising a step does not make it precise.

<!-- kpi:parent-step:begin -->

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

<!-- kpi:parent-step:end -->

## The live test

The results above are a backtest. Since 2026-10-11 the detector `confirmed-v10` is frozen at the tag `frozen-confirmed-v10` and run once a day by a scheduled GitHub Actions workflow, `.github/workflows/prospective.yml`. Every alert it raises is appended to the [`prospective` branch](https://github.com/Orbinauts/breakups/tree/prospective), whose commit time proves when the alert was known. Each run's line in `runs.jsonl` also links the Actions run, a second timestamp kept by GitHub, and each new confirmed alert opens an issue labelled [`prospective-alert`](https://github.com/Orbinauts/breakups/issues?q=label%3Aprospective-alert). Once the agencies' reports have caught up, `npm run prospective:score` scores the log against the truth. `gh workflow disable prospective.yml` pauses the test, and [docs/decisions/0008](decisions/0008-the-detector-is-tested-prospectively-from-a-frozen-tag.md) says how and why it runs.

<!-- prospective:score:begin -->So far: 0 alerts logged since the freeze; 0 confirmed alerts match a reported event after the freeze, of 0 reported events with pieces; 0 false confirmations of 0 confirmed alerts. The truth last changed on 2026-10-11. The agencies report an event months after it, so the events of the last 90 days or so may not be in the truth yet, and the score is not final for them. The maintenance workflow scores the log every week and writes the whole score to `score.md` on the `prospective` branch.<!-- prospective:score:end -->
