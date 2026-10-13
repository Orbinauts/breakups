# Results

How well the detector finds the breakups that were reported, measured over every year since 2005. This page carries every table of the scorecard; the [README](../README.md) gives the summary.

The detector is `confirmed-v10`, the twelfth phase of its build. It raises two kinds of alert: a **confirmed** breakup, once fragments in the parent's plane are catalogued, and an **early warning** (a suspected breakup), raised on the parent's own orbit jump before any fragment is. Its target is to confirm 90% of reported breakups, with fewer than 10% of its confirmations false; the early warning is measured and reported beside it, as prominently, with no target of its own. <!-- kpi:splits:begin -->The target is not reached on either split.<!-- kpi:splits:end --> The held-out years have also been read during development, so they are no longer a blind test: the clean test is the [live test](#the-live-test), run every day by a version frozen before it started.

## Contents

- [The headline](#the-headline)
- [How the numbers are made](#how-the-numbers-are-made)
- [The Confirmed line, the target](#the-confirmed-line-the-target)
- [Early warning (suspected)](#early-warning-suspected)
- [The life of an alert](#the-life-of-an-alert)
- [Rows kept out by the shape of their window](#rows-kept-out-by-the-shape-of-their-window)
- [The live test](#the-live-test)

## The headline

<!-- kpi:current:begin -->

| Headline: breakups reported to the day | Held-out years (odd, 2007 to 2025) | Training years (even, 2006 to 2026) | Target |
| --- | --- | --- | --- |
| Confirmed, of the targets | 17 of 23 | 22 of 36 |  |
| Recall (95% interval) | 74% (54% to 87%) | 61% (45% to 75%) | 90% or more |
| False confirmations, of all events confirmed | 6 of 29 | 2 of 36 |  |
| False-alarm rate (95% interval) | 21% (10% to 38%) | 6% (2% to 18%) | under 10% |
| Median lead over the first agency notice dated to the day | – | – |  |
| Median lead over NASA's quarterly news, dated to its month | – | – |  |
| First agency statements dated to the day / to the month | 0 / 17 | 0 / 21 |  |
| Median timing error | 41 minutes | 19 hours |  |

<!-- kpi:current:end -->

<!-- kpi:current-early-warning:begin -->

| Early warning (suspected): breakups reported to the day | Held-out years (odd, 2007 to 2025) | Training years (even, 2006 to 2026) |
| --- | --- | --- |
| Flagged before the first fragment, of the targets | 10 of 28 | 18 of 43 |
| Detection rate (95% interval) | 36% (21% to 54%) | 42% (28% to 57%) |
| Flagged only after the first fragment (late) | 2 of 28 | 5 of 43 |
| False alarms, of all early warnings | 2448 of 2464 | 2906 of 2930 |
| False-alarm rate (95% interval) | 99% (99% to 100%) | 99% (99% to 99%) |
| False alarms a year | 245 | 264 |
| Median lead over the first catalogued fragment | 20 days | 12 days |
| Median timing error | 35 minutes | 9 hours |

<!-- kpi:current-early-warning:end -->

A target is a breakup an authority reported to the day or better, whose launch then gained fresh pieces in the parent's orbital plane. The thresholds are fitted on the even years and checked on the odd ones, the held-out years. The lead is read two ways side by side: the days from the detector's confirmation to the first agency notice dated to the day (a U.S. Space Forces-Space notice, ESA's report), and to NASA's quarterly news, dated to the first day of its issue's month; the last row says how the first agency statements were dated. The timing error compares the detector's instant of the breakup with the one the ground truth gives. An early warning's target is a reported breakup whose parent had public orbits to be judged on; it is flagged when the warning came before the first fragment was catalogued, and late when it came after; its lead is over that first fragment. The scorecard regenerates these numbers: `npm run kpi` writes `kpi/latest.json`, `npm run kpi:readme` writes this page's tables and the README's summary from it, and a test fails if any cell here differs from that file.

**How much of the fit rests on single events.** The gap between the training years' false confirmations and the held-out years' is what rules fitted to a few training clouds would leave, and the [parameter audit](detector/parameter-audit.md) measures it on the training years alone. Removing the Confirmed channel's rules one at a time, 4 of 27 cost confirmations, 11 cost only false confirmations, and 11 change nothing on the training years. Read again with one training event left out, most fitted values hold, but five of the Confirmed channel's move with a single event (the cloud memory and the one-hour origin override on Hitomi, the young launch's 30 days, the refusal of unresolved twins, and the grace for an unnamed burst), each trading one training confirmation for one to five false ones; on the early warning, the candidate and persistence thresholds and the evidence bound all rest on one ullage motor's breakup. With 35 or so training targets, rules set by one event each are what the held-out years can move most, which is consistent with the held-out drop; the audit changes no value, since any change chosen now would be read against held-out years already seen.

## How the numbers are made

The scorecard replays the detector over the [Archive](archive.md). It feeds the detector every element set of every object in the order the catalogue published them, in runs of four hours as the product runs, and matches what it raises against the [ground truth](ground-truth.md). [docs/decisions/0004](decisions/0004-the-scorecard-replays-the-detector-and-ci-must-reproduce-its-number.md) gives the scorecard's rules. **The target is on Confirmed alerts**, the owner's decision of 2026-10-10 ([docs/decisions/0007](decisions/0007-the-target-is-on-confirmed-alerts.md)).

- A **target** is a reported breakup whose launch gained at least one fresh piece in the parent's plane within 180 days. Events with no such piece, or no orbit of the parent before the event, are counted apart and left out of the denominator.
- A **detection** is the first confirmed verdict on the event's parent within 180 days after it, assigned to the parent's reported event nearest the detector's instant of the event (else its raising), so a later event's confirmation never counts for an earlier one. A confirmed verdict that matches no reported event is **unreported**: **pending** while it was raised under 90 days before the truth's date (the latest day the truth knows of), in neither count, and a **false confirmation** after that. The false-alarm rate is over all the events confirmed, on every line.
- A report naming no catalogued object exempts a confirmation inside its window only where it names the verdict's launch or the regime its object is in; one naming neither is counted in a cell of its own, neither exempt nor false.
- The **lead** is read two ways: over the first agency notice dated to the day (a U.S. Space Forces-Space notice, ESA's report, any agency's statement dated to the day), and over NASA's quarterly news, dated to the first day of its issue's month, the earliest it can have been public, so that lead is the least it can have been. The **lag** is the days after the first fresh piece was published. The **timing error** compares the detector's instant of the event with the truth's.
- The headline is breakups reported to the day or better, confidence A and B. The thresholds are fitted on the even years and the odd years are held out: those are the two **splits**. Every split scores from 2006, since 2005, the Archive's first year, is the detector's warm-up. A crewed station's launch is exempt.
- A verdict that names a launch and its candidate bodies (twins) is matched on the body it names first. The rows "twins matched at the launch" count it as a detection where a reported event's parent is among the candidates.

[kpi/latest.md](../kpi/latest.md) carries every split. The per-year files under `kpi/years/`, every verdict and logged candidate, are tens of megabytes a run; they are artifacts of the KPI workflow, made again by `npm run kpi -- --all`, and only the aggregate is committed.

## The Confirmed line, the target

The held-out years were read while earlier phases were fitted, so their numbers are a measurement, not a blind validation. Three of the previous phase's nine held-out false confirmations are now confirmations of separations that GCAT's satellite catalogue dates. <!-- kpi:medians:begin -->No held-out confirmation has an agency notice dated to the day yet, so the lead over the first public notice is not measured on them. The median confirmation came three hours after the catalogue published the first fresh piece.<!-- kpi:medians:end --> What is left on both splits is single pieces, small and large batches under old launches, and twins the pieces cannot tell apart. [docs/detector/events.md](detector/events.md) lists every reported event with its outcome and cause, and [docs/detector/README.md](detector/README.md) what each phase changed.

<!-- kpi:confirmed:begin -->

| Confirmed: the target, breakups A and B | Targets (fragments catalogued) | No fragments catalogued | Confirmed | Missed | Recall (95% interval) | False confirmations | False-alarm rate (95% interval) | Lead over the first agency notice dated to the day, days: median (10th percentile) | Confirmed before it | Lead over NASA's quarterly news, days: median (10th percentile) | Confirmed before it | Lag after the first fragment, days: median (90th percentile) | Timing error, minutes: median (90th percentile) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Validation: the odd years (2007 to 2025, 10 years) | 23 | 11 | 17 | 6 | 74% (54% to 87%) | 6 | 21% (10% to 38%) | – | – | – | – | 0.1 (4.0) | 40.6 (21342.4) |
| Validation: the odd years, twins matched at the launch | 23 | 11 | 17 | 6 | 74% (54% to 87%) | 6 | 21% (10% to 38%) | – | – | – | – | 0.1 (4.0) | 40.6 (21342.4) |
| Training: the even years (2006 to 2026, 11 years) | 36 | 14 | 22 | 14 | 61% (45% to 75%) | 2 | 6% (2% to 18%) | – | – | – | – | 0.1 (5.9) | 1125.9 (173291.7) |
| Training: the even years, twins matched at the launch | 36 | 14 | 22 | 14 | 61% (45% to 75%) | 2 | 6% (2% to 18%) | – | – | – | – | 0.1 (5.9) | 1125.9 (173291.7) |
| Fitted on the years to 2017 (2006 to 2017, 12 years) | 29 | 18 | 23 | 6 | 79% (62% to 90%) | 6 | 16% (7% to 30%) | – | – | – | – | 0.1 (0.1) | 583.0 (118847.1) |
| Fitted on the years to 2017, twins matched at the launch | 29 | 18 | 23 | 6 | 79% (62% to 90%) | 6 | 16% (7% to 30%) | – | – | – | – | 0.1 (0.1) | 583.0 (89663.5) |
| Validated on the years from 2018 (2018 to 2026, 9 years) | 30 | 7 | 16 | 14 | 53% (36% to 70%) | 2 | 7% (2% to 23%) | – | – | – | – | 0.1 (17.2) | 72.8 (40265.4) |
| Validated on the years from 2018, twins matched at the launch | 30 | 7 | 16 | 14 | 53% (36% to 70%) | 2 | 7% (2% to 23%) | – | – | – | – | 0.1 (17.2) | 72.8 (40265.4) |

| Confirmed, every line, validation: the odd years (2007 to 2025, 10 years) | Targets (fragments catalogued) | No fragments catalogued | No parent orbit before the event | Confirmed | Missed | Recall (95% interval) |
| --- | --- | --- | --- | --- | --- | --- |
| Breakups, confidence A and B (the target is 90%) | 23 | 7 | 4 | 17 | 6 | 74% (54% to 87%) |
| Breakups, confidence C | 20 | 16 | 12 | 3 | 17 | 15% (5% to 36%) |
| Breakups, confidence D | 6 | 6 | 0 | 0 | 6 | 0% (0% to 39%) |
| Anomalous events, confidence A and B | 5 | 4 | 0 | 0 | 5 | 0% (0% to 43%) |
| Anomalous events, confidence C and D | 47 | 21 | 2 | 3 | 44 | 6% (2% to 17%) |

| Confirmed verdicts, validation: the odd years (2007 to 2025, 10 years) | Count |
| --- | --- |
| Confirmed verdicts by pieces | 31 |
| Of which attributed from the pieces with no step seen on the parent | 18 |
| Detections (the first confirmation of a reported event) | 22 |
| Duplicates (a later confirmation of an event, or one on its fragment) | 2 |
| Exempt (inside an exempt window) | 1 |
| False confirmations (matching no reported event) | 6 |
| Unreported and pending (no reported event yet, raised under 90 days before the truth's date; in neither count) | 0 |
| Inside a report naming no object, no launch and no regime (in neither count) | 0 |
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
| Lead over the first agency notice dated to the day, days: median (10th percentile); confirmed before it | –; – |
| Lead over NASA's quarterly news, days: median (10th percentile); confirmed before it | –; – |
| Lag after the first fragment's publication, days: median (90th percentile) | 0.1 (4.0) |
| Timing error against the truth's instant, minutes: median (90th percentile) | 40.6 (21342.4) |

<!-- kpi:confirmed:end -->

## Early warning (suspected)

The early warning is the detector's second layer: an alert on the parent's own orbit, raised when a step in it holds over the sets after it and nothing the object is known to do explains it ([how the detector works](detector/README.md#the-parent-step-layer)). It comes before any fragment is catalogued, and when it is right it is precise in time, but most early warnings are other orbit changes, chiefly manoeuvres the detector cannot tell apart, so it is a watch list, not a confirmation. The target is set on the Confirmed line ([docs/decisions/0007](decisions/0007-the-target-is-on-confirmed-alerts.md)); the early warning is measured here, on every split, and [regression tests on real orbit histories](../test/early-warning.test.ts) check case by case that it still flags known breakups before their first fragment and stays quiet on a station's reboost, a constellation satellite's orbit raise, a geosynchronous satellite's station-keeping and a quiet rocket body.

- A **target** is a scoreable reported event whose parent had at least five public element sets in the sixty days before it; an event with fewer is **undetectable** and out of the denominator.
- **Flagged** (detected): a suspected verdict on the parent whose step bracket covers the event's window, each widened by a day (five near the geostationary ring), raised before the first fragment's set was published and before any notice. **Late**: the same after that. Late and missed both count against the detection rate.
- A **false alarm** is a suspected step that matches no reported event; a second alert on the same step, or one inside an exempt window, is neither. The false-alarm rate is false alarms over false alarms plus the detections on every line, with its Wilson 95% interval. False alarms are also counted a year and per ten thousand object-years (the sum over the objects of the span their orbits cover).
- The **lead** is the time from the alert to the first fragment's set; the **timing error** compares the detector's instant with the truth's where it states the minute. Both are over the detections on every line.
- The **scoped** line keeps only old objects with large, kicked steps that change the drag term and hold for a week ([docs/detector/d7-scope.md](detector/d7-scope.md)). The tier table shows that waiting longer before raising a step does not make it precise.

<!-- kpi:early-warning-tables:begin -->

| Early warning (suspected): breakups A and B | Targets | Undetectable | Flagged before the first fragment | Late | Missed | Detection rate (95% interval) | False alarms | False-alarm rate (95% interval) | False alarms a year | False alarms per 10,000 object-years | Lead over the first catalogued fragment, days: median (10th percentile) | Timing error, minutes, median |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Validation: the odd years (2007 to 2025, 10 years) | 28 | 6 | 10 | 2 | 16 | 36% (21% to 54%) | 2448 | 99% (99% to 100%) | 244.8 | 138.3 | 20.0 (3.9) | 34.6 |
| Training: the even years (2006 to 2026, 11 years) | 43 | 7 | 18 | 5 | 20 | 42% (28% to 57%) | 2906 | 99% (99% to 99%) | 264.2 | 152.2 | 12.4 (3.4) | 511.1 |
| Every year (2006 to 2026, 21 years) | 71 | 13 | 28 | 7 | 36 | 39% (29% to 51%) | 5354 | 99% (99% to 99%) | 255.0 | 145.5 | 20.0 (3.4) | 114.4 |
| The last 3 years (2024 to 2026, 3 years) | 4 | 2 | 3 | 0 | 1 | 75% (30% to 95%) | 927 | 99% (99% to 100%) | 309.0 | 119.5 | 4.3 (4.3) | 59.0 |
| Fitted on the years to 2017 (2006 to 2017, 12 years) | 40 | 7 | 15 | 4 | 21 | 38% (24% to 53%) | 2463 | 99% (99% to 99%) | 205.3 | 148.8 | 10.3 (2.2) | 583.0 |
| Validated on the years from 2018 (2018 to 2026, 9 years) | 31 | 6 | 13 | 3 | 15 | 42% (26% to 59%) | 2891 | 99% (99% to 100%) | 321.2 | 142.9 | 29.9 (4.3) | 72.8 |

| Early warning, every line, validation: the odd years (2007 to 2025, 10 years) | Targets | Undetectable | Detected | Late | Missed | Detection rate (95% interval) |
| --- | --- | --- | --- | --- | --- | --- |
| Breakups, confidence A and B (the headline line) | 28 | 6 | 10 | 2 | 16 | 36% (21% to 54%) |
| Breakups, confidence C | 33 | 15 | 3 | 0 | 30 | 9% (3% to 24%) |
| Breakups, confidence D | 12 | 0 | 0 | 0 | 12 | 0% (0% to 24%) |
| Anomalous events, confidence A and B | 8 | 1 | 0 | 1 | 7 | 0% (0% to 32%) |
| Anomalous events, confidence C and D | 68 | 2 | 3 | 0 | 65 | 4% (2% to 12%) |

| Early warning on breakups A and B, scoped, validation: the odd years (2007 to 2025, 10 years) | Targets | Undetectable | Detected | Late | Missed | Detection rate (95% interval) | False alarms | False-alarm rate (95% interval) | Headline events left out |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| The whole catalogue | 28 | 6 | 10 | 2 | 16 | 36% (21% to 54%) | 2448 | 99% (99% to 100%) | 0 |
| Scoped | 21 | 0 | 3 | 0 | 18 | 14% (5% to 35%) | 52 | 95% (85% to 98%) | 13 of 34 |

| Early warnings, validation: the odd years (2007 to 2025, 10 years) | Count |
| --- | --- |
| Alerts (object verdicts, suspected or confirmed) | 2638 |
| Duplicates | 121 |
| Exempt | 50 |
| False alarms | 2448 |
| False-alarm rate | 99% |
| False alarms per 10,000 object-years | 138.3 |
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

| The early warnings confirmed, validation: the odd years (2007 to 2025, 10 years) | Count |
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

<!-- kpi:early-warning-tables:end -->

**Ranked as a watch list, it is not useful.** Ordering the early warnings by what each recorded at its raising, with a ranker fitted on the training years and frozen before the held-out years were read, was tested against a bar written down first: a monthly list of five or fewer right at least one time in five. On the held-out years the best such list, the top one of each month, is right 3.3% of the time (1.3% to 8.3%), four times the 0.77% base rate, and the top five 1.8% (1.0% to 3.3%); with 1.6 real early warnings a year, no ranking could reach the bar. A live list of about five a month, named as each alert is raised, holds 6 of the 28 reported breakups before their first fragment (of the 10 the whole list flags) at 2.1% precision. The scorecard does not carry the ranking; [docs/detector/early-warning-ranking.md](detector/early-warning-ranking.md) gives the method, the frozen ranker and every number.

## The life of an alert

Every step that holds in an object's orbit is judged once: raised as an early warning, or cleared as a manoeuvre that the object's record, its working status, a return to an altitude it held or its neighbours' like moves explain. An early warning then ends confirmed (fragments in the parent's plane, or a notice), dismissed (the new bodies under its launch were all old pieces), or expired (nothing confirmed it within the alert's thirty days); a few are still open where the Archive ends. A cleared step is watched as long, and fragments can still confirm it; and a breakup can be confirmed from its fragments with no step seen at all. The tables give, on the held-out and the training years, how many steps reached each end, the probability that an alert at that end was on a reported breakup's step (detections and late alerts over those and the false alarms; duplicates and exempt alerts in neither count), how long each end took, and from the other side, the reported breakups of confidence A and B whose fragments were catalogued, by the path they took. Every share and probability carries its Wilson 95% interval. A cleared or an expired alert is no guarantee that nothing happened: some were on reported breakups, as the tables say.

<!-- kpi:lifecycle-full:begin -->

| The life of an alert | Validation: the odd years (2007 to 2025, 10 years) | Training: the even years (2006 to 2026, 11 years) |
| --- | --- | --- |
| Steps that held, cleared as manoeuvres | 69179 | 95629 |
| Of those, on a reported breakup's step (95% interval) | 0.04% (0.03% to 0.06%), 28 of 69179 | 0.02% (0.02% to 0.04%), 23 of 95629 |
| Of those, confirmed later by fragments (of which on a reported breakup) | 5 (1) | 11 (6) |
| Steps that held, raised as early warnings (suspected alerts) | 2633 | 3146 |
| Of those, on a reported breakup's step (95% interval) | 0.77% (0.49% to 1.2%), 19 of 2463 | 0.96% (0.66% to 1.4%), 28 of 2929 |
| Of those, duplicates or inside an exempt window (in neither count) | 170 | 217 |
| Ended confirmed (fragments in the parent's plane, or a notice), share of the early warnings (95% interval) | 0.30% (0.15% to 0.60%), 8 of 2633 | 0.32% (0.17% to 0.58%), 10 of 3146 |
| Ended confirmed: on a reported breakup's step (95% interval) | 75% (41% to 93%), 6 of 8 | 100% (68% to 100%), 8 of 8 |
| Ended confirmed: days after the early warning, median (90th percentile) | 4.0 (24.2) | 2.3 (19.3) |
| Ended dismissed (the new bodies under its launch were all old pieces), share of the early warnings (95% interval) | 4.2% (3.5% to 5.0%), 110 of 2633 | 4.8% (4.1% to 5.6%), 152 of 3146 |
| Ended dismissed: on a reported breakup's step (95% interval) | 1.0% (0.18% to 5.7%), 1 of 96 | 0.75% (0.13% to 4.1%), 1 of 134 |
| Ended dismissed: days after the early warning, median (90th percentile) | 30.0 (30.0) | 30.0 (30.0) |
| Ended expired (nothing confirmed it in 30 days), share of the early warnings (95% interval) | 94% (94% to 95%), 2488 of 2633 | 92% (91% to 93%), 2905 of 3146 |
| Ended expired: on a reported breakup's step (95% interval) | 0.47% (0.26% to 0.84%), 11 of 2335 | 0.66% (0.42% to 1.0%), 18 of 2719 |
| Ended expired: days after the early warning, median (90th percentile) | 30.0 (30.0) | 30.0 (30.0) |
| Still open where the Archive ends, share of the early warnings (95% interval) | 1.0% (0.71% to 1.5%), 27 of 2633 | 2.5% (2.0% to 3.1%), 79 of 3146 |
| Still open: on a reported breakup's step (95% interval) | 4.2% (0.74% to 20%), 1 of 24 | 1.5% (0.26% to 7.9%), 1 of 68 |

| The reported breakups' paths | Validation: the odd years (2007 to 2025, 10 years) | Training: the even years (2006 to 2026, 11 years) |
| --- | --- | --- |
| Reported breakups A and B with fragments catalogued (the Confirmed line's targets) | 23 | 36 |
| Of those, flagged by an early warning before the first fragment | 8 of 23 | 15 of 36 |
| An early warning, then confirmed (95% interval) | 39% (22% to 59%), 9 of 23 | 42% (27% to 58%), 15 of 36 |
| An early warning, never confirmed (95% interval) | 4.3% (0.77% to 21%), 1 of 23 | 14% (6.1% to 29%), 5 of 36 |
| Confirmed with no early warning first (from the fragments, or a cleared step the fragments confirmed) (95% interval) | 35% (19% to 55%), 8 of 23 | 19% (9.8% to 35%), 7 of 36 |
| Never flagged (95% interval) | 22% (9.7% to 42%), 5 of 23 | 25% (14% to 41%), 9 of 36 |

<!-- kpi:lifecycle-full:end -->

## Rows kept out by the shape of their window

A reported event whose window is wider than 93 days, or has no lower edge, is no target in a useful sense: GCAT's "2023?" widens to three years, and a confirmation anywhere in three years and a half would count. Such rows are kept out of every line, the Confirmed line's and the early warning's, and a confirmed verdict on the parent inside the window and the 180 days after it is exempt rather than false. A window that a coarse date opened before the parent's launch starts at the launch. The rows from 2005:

<!-- truth:kept-out-by-window:begin -->

| Event | Kind | Confidence | Window | Why it is kept out |
| --- | --- | --- | --- | --- |
| 23342:2006-01-01 RESURS O1 No. 3 | anomalous | C | 2006-01-01 to 2006-05-01 | the window is wider than 93 days |
| 13618:2009-01-01 COSMOS 1417 R/B | anomalous | C | 2009-01-01 to 2009-05-01 | the window is wider than 93 days |
| 13923:2011-01-01 NOAA 8 | anomalous | D | 2011-01-01 to 2014-01-01 | the window is wider than 93 days |
| 12446:2014-01-01 Agena D | breakup | D | 2014-01-01 to 2017-01-01 | the window is wider than 93 days |
| 36105:2017-01-01 H-2A F16 Stage 2 | anomalous | D | 2017-01-01 to 2020-01-01 | the window is wider than 93 days |
| 29050:2019-01-01 COSMIC 1-3 | breakup | D | 2019-01-01 to 2022-01-01 | the window is wider than 93 days |
| 23847:2020-01-01 Ariane H10-3 V85 | breakup | D | 2020-01-01 to 2023-01-01 | the window is wider than 93 days |
| 23950:2020-01-01 Ariane H10-3 V89 | breakup | D | 2020-01-01 to 2023-01-01 | the window is wider than 93 days |
| 32254:2020-01-01 Ariane 5 L526 EPS | breakup | D | 2020-01-01 to 2023-01-01 | the window is wider than 93 days |
| 12456:2023-01-01 Meteor-2 | breakup | D | 2023-01-01 to 2026-01-01 | the window is wider than 93 days |
| 15516:2023-01-01 Meteor-2 | breakup | D | 2023-01-01 to 2026-01-01 | the window is wider than 93 days |
| 20826:2023-01-01 Meteor-2 | breakup | D | 2023-01-01 to 2026-01-01 | the window is wider than 93 days |

<!-- truth:kept-out-by-window:end -->

## The live test

The results above are a backtest. Since 2026-10-11 the detector `confirmed-v10` is frozen at the tag `frozen-confirmed-v10` and run once a day by a scheduled GitHub Actions workflow, `.github/workflows/prospective.yml`. Every alert it raises is appended to the [`prospective` branch](https://github.com/Orbinauts/breakups/tree/prospective), whose commit time proves when the alert was known. Each run's line in `runs.jsonl` also links the Actions run, a second timestamp kept by GitHub, and each new confirmed alert opens an issue labelled [`prospective-alert`](https://github.com/Orbinauts/breakups/issues?q=label%3Aprospective-alert). Once the agencies' reports have caught up, `npm run prospective:score` scores the log against the truth, on the Confirmed line and on the early warning, both from the commit that logged each alert, not from the replay's clock: the year is replayed whole each day against that day's catalogue status, so a step can be raised dated back after the fragments were public, and only its commit says when it was known. An early warning is flagged where its commit came before the first sign of the fragments, and its lead is counted from the commit. `gh workflow disable prospective.yml` pauses the test, and [docs/decisions/0008](decisions/0008-the-detector-is-tested-prospectively-from-a-frozen-tag.md) says how and why it runs.

<!-- prospective:score:begin -->So far: 1 alert logged since the freeze (1 suspected); 0 confirmed alerts match a reported event after the freeze, of 0 reported events with pieces; 0 false confirmations of 0 confirmed alerts. Early warning: 0 suspected alerts flag a reported event after the freeze before the first sign of its fragments, and 0 after it, of 0 reported events with pieces; 1 false early warning of 1 suspected alert. The truth last changed on 2026-10-12. The agencies report an event months after it, so the events of the last 90 days or so may not be in the truth yet, and the score is not final for them. The maintenance workflow scores the log every week and writes the whole score to `score.md` on the `prospective` branch.<!-- prospective:score:end -->
