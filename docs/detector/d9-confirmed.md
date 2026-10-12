# The ninth phase: the Confirmed channel

The owner moved the target on 2026-10-10 (`docs/decisions/0007-the-target-is-on-confirmed-alerts.md`): nine reported breakups in ten confirmed, and fewer than one confirmation in ten matching no reported event, where a Confirmed alert is a breakup the detector attributes to a parent from fresh fragments in the parent's plane, with or without a step seen first on the parent. This note records what was built for it (the first statements in the truth, the attribution of a cloud to a parent with no step, the event's time from the pieces, the Confirmed line of the scorecard), the faults found on the way, every iteration's numbers on the training years, the validation read once at the end, and the answer, plainly: the target is not reached, and why.

## The discipline

- The training split is the even years 2006 to 2026; the validation split the odd years 2005 to 2025, read once with the values chosen. The chronological halves are reported beside them in `kpi/latest.md`.
- The thresholds were swept offline over a replay with the rules off (`npm run kpi -- --all --out kpi/work/<name> --param confirmDeltaVMinMps=0 --param freshPieceDays=0 --param cloudMemoryDays=0 --param debrisParentNeedsNearerThanCloud=false --param singlePieceNeedsQuietLaunch=false --param confirmBackgroundMax=1e9 --param youngLaunchDays=0 --param attributionYoungLaunch=true --param attributionMinPieces=1 --param attributionMissKmMax=1e9 --param attributionAmbiguityRatio=0 --param attributionCentreRatio=0 --param analystAttributes=true`), whose every judgement of pieces logs an attribution row (phase 5) with the readings each rule needs; `KPI_DIR=kpi/work/<name> npm run kpi:sweep -- --attributions [--set name=value] [--show]` re-applies the rules from those rows, lands the confirmations they would raise against the truth as the matcher does, and scores the Confirmed line on the even years. The sweep is an approximation: the logging replay remembered every cloud it attributed, so the cloud memory's readings are those of a detector that attributed everything, and the alert path's confirmations close alerts the rules would have left open. Each point chosen was then replayed whole, and the replay is the record.
- A target is a scoreable reported event whose launch gained at least one fresh piece in the parent's plane within 180 days (`fragmentsOf` in `scripts/kpi/catalogue.ts`, read from the Archive over every year); a detection the first confirmed verdict by pieces on the parent within 180 days after the event's window, in whichever year's file it lies; a false alarm a confirmed verdict matching no reported event (`landConfirmed` in `scripts/kpi/match.ts`); the false-alarm rate is over the events confirmed on every line.

## What was built

- **The first statements.** Every statement in the truth carries when it can first have been public (`statedOn`), and every event its first statement (`firstStatement`); `firstAgencyStatement` reads the first by an agency. NASA's history is dated by the quarterly news issues its spreads' reference documents cite (the first day of the issue's month, or the event's own day where the issue is of the event's month; an issue before the event is not its statement); the hand-typed quarterly news by its issue; the U.S. Space Forces-Space notice by the day it was seen; ESA's report by its date; the analyst's and LeoLabs' posts by their days, marked by their source and not counted as an agency's. Of the 175 scoreable events from 2005, 106 have a dated first statement and 102 an agency's; of the 88 breakups of confidence A and B, 83 (`docs/truth.md`).
- **The attribution** (`attributeCloud` in `src/attribution.ts`). After the open alerts of a launch are confirmed by their pieces as before, the run's consistent pieces in the plane of a body with no open alert are grouped by that body; the body named is, of those whose plane the pieces share, the one their semi-major axes centre on. The confirmation rules of the fifth phase apply as they do to an alert, and the attribution's own: the launch older than a month, the launch's background in the year before at most two bodies a fortnight, at least two pieces kept, the run bringing new bodies to at most two launches older than a year, and, where the pieces share the plane of other bodies, the body named told from them by the centre of the pieces' axes, by their convergence on it, or by a persistent step it alone made. A launch with at most thirty debris-classed bodies tries its older ones as parents for pieces in no other body's plane (a fairing, a tank). The verdict is `confirmed` with no step, its evidence the pieces, their plane distances, the cloud velocity, the centre and the convergence; the launch then remembers the cloud as named, so its later batches attribute nothing more.
- **The event's time from the pieces** (`eventFromPieces` in `src/event-time.ts`): the crossing the pieces share of the parent's orbit, propagated back up to 180 days, refined to the minute by their least distance from the parent, with the sigma the miss over the relative speed or the pieces' scatter, whichever is larger.
- **The scorecard's Confirmed line**: the README's first table, the cells per line and split with Wilson intervals, the lead over the first agency statement, the lag after the first fresh piece and the timing error; the confirmed verdicts' landings; the per-event dissection with each event's Confirmed outcome and cause.

## Faults found

- **The catalogue's mark in the detector, from 2020.** The detector's high-water mark took every designated number, and a body designated under a launch but numbered in the analyst ranges lifted it in 2020 above every piece catalogued after: from mid-2020 to 2026 no new body was ever above the mark (the cloud rows logged 0 pieces above it in 2021 to 2025 against thousands of new bodies), so no confirmation and no attribution could happen. The mark now reads numbers below the analyst floor, as the scorecard's always did. This also changes the step alerts' confirmations from 2020.
- **The cloud memory blocked its own cloud.** A burst nobody was named for (a young launch's first batch, an ambiguous one) was remembered as a cloud, and the parent lying in its plane then refused every later batch of the same breakup. The memory now records whether a cloud was named; a burst nobody was named for within the half year before does not keep its own cloud from being attributed.
- **A cloud's own earlier batches.** The pieces of the fortnight's window were re-judged every run, so a cloud already attributed was attributed again on its next batch: the pieces first seen by the time a cloud was remembered are now that cloud's, told apart from the new ones and not judged again.
- **Propagations that fail silently.** SGP4 run backwards over months returned positions beyond the Moon for a few high-drag first sets; a position outside the Earth's radius and four hundred thousand kilometres is now no position, and the search window falls back to sixty and twenty days where the pieces cannot be propagated over the whole one.

## The iterations, on the training years

| Iteration | What changed | Headline targets | Confirmed | Recall | False confirmations | False-alarm rate |
| --- | --- | --- | --- | --- | --- | --- |
| 0, swept on the first logging replay | the channel as first written, the fifth phase's rules, one piece enough | 35 | 16 | 46% | 55 | 64% |
| 0, every rule off | the ceiling of that replay | 35 | 21 | 60% | 376 | 90% |
| 1, swept on the second logging replay | the mark fixed, debris-classed parents tried, the cataloguing batch read | 35 | 21 | 60% | 63 | 62% |
| 1, every rule off | the ceiling after the fix | 35 | 28 | 80% | 553 | 91% |
| 2, replayed (`d9-a`) | the body named by the centre of the pieces' axes, a step breaking a tie, at most three old launches in the run | 35 | 21 | 60% (44% to 74%) | 21 | 40% (28% to 53%) |
| 3, replayed, committed (`confirmed-v7`) | at most two old launches in the run, at least two pieces, the grace for unnamed bursts, the search's fallbacks | 35 | 22 | 63% (46% to 77%) | 18 | 35% (24% to 49%) |

Iterations 2 and 3 are full replays; 0 and 1 are the sweep's estimates at the then values. The third logging replay (with the centre and the tie-break read) gives the sweep at the committed values, each rule varied in turn (the sweep, as said, under-reads the false confirmations against the replay: 7 here, 18 replayed):

| rule | targets | confirmed | recall | events confirmed, every line | false confirmations | false-alarm rate | duplicates | exempt |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| the detector's values | 35 | 19 | 54% | 30 | 7 | 19% | 1 | 7 |
| the pieces move at least 0 m/s (confirmDeltaVMinMps) | 35 | 19 | 54% | 32 | 9 | 22% | 2 | 7 |
| the pieces move at least 0.5 m/s (confirmDeltaVMinMps) | 35 | 19 | 54% | 31 | 8 | 21% | 1 | 7 |
| the pieces move at least 2 m/s (confirmDeltaVMinMps) | 35 | 19 | 54% | 28 | 5 | 15% | 1 | 7 |
| the pieces move at least 5 m/s (confirmDeltaVMinMps) | 35 | 18 | 51% | 24 | 4 | 14% | 0 | 5 |
| a debris parent first seen under 0 days confirms nothing (freshPieceDays) | 35 | 20 | 57% | 31 | 7 | 18% | 1 | 7 |
| a debris parent first seen under 30 days confirms nothing (freshPieceDays) | 35 | 20 | 57% | 31 | 7 | 18% | 1 | 7 |
| a debris parent first seen under 180 days confirms nothing (freshPieceDays) | 35 | 19 | 54% | 30 | 7 | 19% | 1 | 7 |
| the cloud memory, 0 days (cloudMemoryDays) | 35 | 22 | 63% | 33 | 16 | 33% | 37 | 10 |
| the cloud memory, 90 days (cloudMemoryDays) | 35 | 20 | 57% | 31 | 11 | 26% | 2 | 8 |
| the cloud memory, 180 days (cloudMemoryDays) | 35 | 20 | 57% | 31 | 9 | 23% | 2 | 8 |
| the cloud memory, 730 days (cloudMemoryDays) | 35 | 19 | 54% | 30 | 7 | 19% | 1 | 6 |
| a debris parent's pieces nearer than the cloud (debrisParentNeedsNearerThanCloud) false | 35 | 19 | 54% | 30 | 7 | 19% | 1 | 7 |
| a single piece needs a quiet launch (singlePieceNeedsQuietLaunch) false | 35 | 19 | 54% | 30 | 14 | 32% | 1 | 8 |
| the launch's background at most 0.5 a window (confirmBackgroundMax) | 35 | 19 | 54% | 30 | 7 | 19% | 1 | 7 |
| the launch's background at most 5 a window (confirmBackgroundMax) | 35 | 19 | 54% | 30 | 7 | 19% | 1 | 7 |
| the launch's background at most 20 a window (confirmBackgroundMax) | 35 | 19 | 54% | 30 | 7 | 19% | 1 | 7 |
| the launch's background at most 1000000000 a window (confirmBackgroundMax) | 35 | 19 | 54% | 30 | 7 | 19% | 1 | 7 |
| a step on one body breaks a tie (attributionStepBreaksTies) false | 35 | 17 | 49% | 28 | 7 | 20% | 1 | 7 |
| a young launch attributes (attributionYoungLaunch) true | 35 | 19 | 54% | 32 | 12 | 27% | 1 | 8 |
| a launch is young under 0 days (youngLaunchDays) | 35 | 20 | 57% | 33 | 50 | 60% | 1 | 11 |
| a launch is young under 7 days (youngLaunchDays) | 35 | 20 | 57% | 31 | 11 | 26% | 1 | 8 |
| a launch is young under 90 days (youngLaunchDays) | 35 | 17 | 49% | 28 | 7 | 20% | 1 | 7 |
| at least 1 pieces (attributionMinPieces) | 35 | 19 | 54% | 30 | 10 | 25% | 1 | 7 |
| at least 2 pieces (attributionMinPieces) | 35 | 19 | 54% | 30 | 7 | 19% | 1 | 7 |
| at least 3 pieces (attributionMinPieces) | 35 | 18 | 51% | 28 | 6 | 18% | 0 | 4 |
| at least 5 pieces (attributionMinPieces) | 35 | 17 | 49% | 24 | 5 | 17% | 0 | 4 |
| at most 1 old launches gaining bodies in the run (attributionBatchLaunchesMax) | 35 | 15 | 43% | 25 | 6 | 19% | 1 | 6 |
| at most 2 old launches gaining bodies in the run (attributionBatchLaunchesMax) | 35 | 19 | 54% | 30 | 7 | 19% | 1 | 7 |
| at most 3 old launches gaining bodies in the run (attributionBatchLaunchesMax) | 35 | 19 | 54% | 30 | 9 | 23% | 2 | 7 |
| at most 5 old launches gaining bodies in the run (attributionBatchLaunchesMax) | 35 | 19 | 54% | 34 | 19 | 36% | 3 | 7 |
| at most 10 old launches gaining bodies in the run (attributionBatchLaunchesMax) | 35 | 19 | 54% | 36 | 25 | 41% | 3 | 7 |
| at most 1000000000 old launches gaining bodies in the run (attributionBatchLaunchesMax) | 35 | 19 | 54% | 36 | 31 | 46% | 4 | 13 |
| the pieces miss the parent by at most 20 km (attributionMissKmMax) | 35 | 9 | 26% | 14 | 5 | 26% | 1 | 2 |
| the pieces miss the parent by at most 50 km (attributionMissKmMax) | 35 | 11 | 31% | 16 | 5 | 24% | 1 | 2 |
| the pieces miss the parent by at most 100 km (attributionMissKmMax) | 35 | 11 | 31% | 16 | 5 | 24% | 1 | 2 |
| the pieces miss the parent by at most 300 km (attributionMissKmMax) | 35 | 12 | 34% | 17 | 6 | 26% | 1 | 2 |
| the pieces miss the parent by at most 1000 km (attributionMissKmMax) | 35 | 12 | 34% | 18 | 6 | 25% | 1 | 5 |
| the pieces miss the parent by at most 1000000000 km (attributionMissKmMax) | 35 | 19 | 54% | 30 | 7 | 19% | 1 | 7 |
| a rival must be missed 0 times worse (attributionAmbiguityRatio) | 35 | 19 | 54% | 30 | 14 | 32% | 1 | 9 |
| a rival must be missed 1.5 times worse (attributionAmbiguityRatio) | 35 | 19 | 54% | 30 | 7 | 19% | 1 | 7 |
| a rival must be missed 3 times worse (attributionAmbiguityRatio) | 35 | 19 | 54% | 30 | 7 | 19% | 1 | 7 |
| a rival must be missed 10 times worse (attributionAmbiguityRatio) | 35 | 19 | 54% | 30 | 7 | 19% | 1 | 7 |
| a rival's centre must be 0 times further (attributionCentreRatio) | 35 | 19 | 54% | 30 | 14 | 32% | 1 | 9 |
| a rival's centre must be 1.5 times further (attributionCentreRatio) | 35 | 19 | 54% | 30 | 11 | 27% | 1 | 7 |
| a rival's centre must be 3 times further (attributionCentreRatio) | 35 | 19 | 54% | 30 | 7 | 19% | 1 | 7 |
| a rival's centre must be 10 times further (attributionCentreRatio) | 35 | 19 | 54% | 30 | 7 | 19% | 1 | 7 |
| a rival's centre must be 1000000000 times further (attributionCentreRatio) | 35 | 19 | 54% | 30 | 6 | 17% | 1 | 7 |
| an analyst range confirms an alert (analystAttributes) true | 35 | 19 | 54% | 30 | 9 | 23% | 1 | 7 |
| debris parents tried (attributionDebrisParentsMax) 0 | 35 | 19 | 54% | 29 | 7 | 19% | 1 | 6 |
| every rule off | 35 | 27 | 77% | 54 | 532 | 91% | 278 | 104 |

What the table says: the cataloguing batch is the rule that bites (at no limit 31 false confirmations, at two 7, for no confirmation lost), then the single piece (7 to 14 off) and the fewest pieces (10 at one); the cloud memory off gains three confirmations for nine more false ones and thirty-six duplicates; the young launch off gains one for forty-three. A bound on the pieces' miss of the parent costs half the confirmations for two false ones fewer: SGP4 run backwards weeks from a low cloud's first sets misses the true parent by thousands of kilometres as often as a wrong one, so the convergence is kept to time the event and to tell bodies apart, never as a gate. Iteration 3 is the last: no rule on the training years trades a confirmation for fewer than several false ones, and every rule off reaches 80%.

## The validation, read once

| Split | Targets | Confirmed | Recall (95%) | False confirmations | False-alarm rate (95%) | Lead over the first agency statement, days: median (10th percentile) | Before it | Lag after the first fragment, days: median (90th) | Timing error, minutes: median (90th) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Training (even years) | 35 | 22 | 63% (46% to 77%) | 18 | 35% (24% to 49%) | 35.7 (−32.2) | 14 of 21 | 0.1 (4.1) | 1,249 (119,134) |
| Validation (odd years) | 25 | 18 | 72% (52% to 86%) | 31 | 55% (42% to 68%) | 41.7 (9.2) | 18 of 18 | 0.1 (4.5) | 114 (21,342) |
| To 2017 | 31 | 25 | 81% (64% to 91%) | 37 | 52% (41% to 63%) | 37.2 (−15.2) | 19 of 24 | 0.1 (0.1) | 1,205 (119,134) |
| From 2018 | 29 | 15 | 52% (34% to 69%) | 12 | 33% (20% to 50%) | 40.2 (−24.5) | 13 of 15 | 0.1 (39.3) | 59 (40,265) |

Every agency statement the headline confirmations are measured against is a quarterly news issue dated to its month (none to the day), so each lead is the least it can have been. The lag after the first fresh piece's publication is a median of three hours: the Confirmed alert is the catalogue's first fragment read back, named and timed, one run after it. The timing error is minutes where the first sets come days after the event (Cosmos 2251, Nimiq 6's Briz-M, Iridium 91, the Titan IIIC transtage) and days where they come weeks after.

The false confirmations by kind: on the training years 13 on payloads, 4 on rocket bodies, 1 on debris, 11 of them attributed with no step and 7 confirmations of a step alert by the fifth phase's rules (the station's jettisoned items in its plane confirmed its reboosts twice, and were attributed to it once more); on the validation years 25 on payloads and 6 on rocket bodies, 23 attributed and 8 on a step, and 12 of the 31 in 2005, the detector's first year, when every launch was new to it and no background had been read (a rule refusing attributions before the detector has watched a year was not fitted, since only the held-out cold start shows the need). The rest are pieces of old launches the catalogue lists one or two at a time, some of them perhaps unreported events, as the eighth phase found of a few.

The misses by cause (`docs/detector/events.md`), training and validation: the pieces attributed to another body of the launch or never judged for the parent because another of the same plane and orbit was named (an ullage motor and its twin, Beidou G5's stage and its payload, GOSAT 2's fairing pieces, Cosmos 2499 and its sibling, SSLV's stage and its payload): 6 and 3; the cloud memory (a launch with a cloud within the year): 2 and 1; a single piece or one under the velocity floor: 1 and 3; the young launch (CZ-6A's stage, a day old): 1; a fresh debris-classed parent (the Fregat tank): 1; an ambiguous parent the convergence could not name: 1; no piece in a plane the detector read: 1. And on the lines apart: 9 and 9 headline events with no fresh piece in the parent's plane within 180 days, 6 and 4 with no orbit of the parent before the event.

## The answer

The target is not reached: on the held-out years the Confirmed line confirms 72% of the headline breakups whose fragments were catalogued in the parent's plane (52% to 86%) at a false-alarm rate of 55% (42% to 68%), and on the training years 63% at 35%. The intervals are wide (25 and 35 targets), but neither split's interval reaches nine in ten or one in ten.

What limits it, in the evidence:

- **Recall.** Even with every rule off the training years reach 28 of 35 (80%). The ceiling's misses are bodies of one launch in one plane and one orbit, which the plane, the centre of the pieces' periods and their convergence cannot tell apart (twin ullage motors; a fairing and its siblings; a stage and its payload in the days after launch), and single pieces. The rules then cost a further six: the cloud memory, the young launch and the backlog read a breakup's own early batches as an old cloud, and single pieces are refused because one piece under a launch most often means nothing.
- **Precision.** The false confirmations are pieces of old launches catalogued one or two at a time in a body's plane, cataloguing batches that list old objects under several launches at once, the station's jettisoned items, and the cold start; the rules that remove them (the batch, the fewest pieces) are the ones already taken, and each further one trades the confirmations it removes one for one.
- **The definition itself.** Fresh pieces are the confirmation by construction: the Confirmed alert follows the catalogue's first fragment by hours. Its value is the attribution (which body), the timing, and the lead over the agencies, about six weeks over NASA's quarterly news.

The replay of the whole Archive takes 1,111 seconds of detector time, about twenty-six minutes with the catalogue read once for the targets and the year files written, against about twenty-one before this phase.
