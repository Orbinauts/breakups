# The tenth phase: the methodology fixed, twins at the launch, the common origin

The ninth phase put the target on the Confirmed line and missed it: on the training years 22 of 35 headline breakups confirmed (63%) at 35% false confirmations, on the held-out years 18 of 25 (72%) at 55%. The tenth phase fixed two faults of method the coordinator named (the warm-up year and the crewed stations), built the owner's call on twins (a verdict naming the launch and its candidate bodies, scored both ways), built the common-origin test the coordinator proposed as the discriminator (every piece's crossing of the parent, propagated back, and how closely they share an instant), fitted on the even years, analysed every training false confirmation and miss one by one, froze the choice with a timestamp, and read the odd years once. This note records it all; the answer is at the end.

## The discipline

- The training split is the even years 2006 to 2026; the validation split the odd years from 2007 (2005 is now the warm-up year, scored on no split). Every number in the iterations below is a training number. The tools that print every split were filtered to the even years (a scratch reader of a replay's year files that refuses an odd year, and the sweep, which scores the training split unless the odd years are asked).
- One exposure is stated: at the start of the phase, reading the format of the ninth phase's per-event dissection (`events.md`, committed with the ninth phase), its first rows were displayed, three of them odd years' (2005, 2007, 2009). They are the ninth phase's outcomes, already reported to the owner; no odd-year number of any tenth-phase replay was read before the freeze below.
- The sweep re-applies the rules offline from a replay with the rules off (`kpi/work/d10-off`: `npm run kpi -- --all --out kpi/work/d10-off --param confirmDeltaVMinMps=0 --param freshPieceDays=0 --param cloudMemoryDays=0 --param debrisParentNeedsNearerThanCloud=false --param singlePieceNeedsQuietLaunch=false --param confirmBackgroundMax=1e9 --param youngLaunchDays=0 --param attributionYoungLaunch=true --param attributionMinPieces=1 --param attributionMissKmMax=1e9 --param analystAttributes=true --param attributionBatchLaunchesMax=1e9 --param 'stationLaunches=[]'`), as in the ninth phase, with two changes: the logging replay keeps the attribution's ambiguity and centre ratios at their fitted values, so every twin is logged with its candidates (`attributionTwins`, `candidate1` to `candidate3`), and times every judgement of pieces, the step alerts' confirmations included, so every row carries the common-origin readings; and the sweep keeps the cloud memory as the simulation itself would (an attribution reads a remembered cloud only where the simulation named one under the launch within the memory, `decide` in `scripts/kpi/attributions.ts`), since the logging replay named every cloud and so remembered every one. `KPI_DIR=kpi/work/d10-off npm run kpi:sweep -- --origin [--twins-grid] [--relax] [--detail --show] [--set name=value]` sweeps the common-origin rules and the twins (`originGrid`, `originSeparation`, `originDetail`). Each point chosen was then replayed whole, and the replay is the record.

## What was built

- **The warm-up year and the stations** (the seventh decision record's "As built" section): every split scores from 2006 (`SCORED_FROM_YEAR`), and a crewed station's launch confirms and attributes nothing (`stationLaunches`, a refusal of its own) and is exempt on the Confirmed line (`STATION_LAUNCHES`). The station list is the eleven launches of the bodies the satellite catalogue names ISS, TIANGONG and CSS (the decision record lists them).
- **Twins at the launch** (`attributionTwins`, `attributionTwinsUnresolved`, `Verdict.candidates`): another body of the launch the pieces are not told from, neither by the centre of their axes (`attributionCentreRatio`) nor by their convergence (`attributionAmbiguityRatio`), is the named body's twin; a launch that left at most thirty debris-classed bodies in its first season offers those as twins too (a fairing cover and its siblings, `debrisSharing` in `src/run.ts`). The verdict names the launch and every twin, the body the centre or a persistent step it alone made picks first. The scorecard reads it on the body named first in the headline and at the launch on the second row (`landConfirmed`, `readingOf`, `confirmedLineTwins`).
- **The common-origin test** (`eventFromPieces`, `originOf`, `passesOrigin`, `overridesHistory` in `src/event-time.ts`): every piece judged is propagated back with its first set against the parent's last set before the cloud, and its crossing of the parent (its angle from the parent about the parent's orbit normal through zero) nearest the instant the pieces' angles agree on best is kept, with its distance from the parent there and its lap (the synodic period of the two mean motions). The reading: the pieces tried and timed, the median crossing, the half-widths around it within which half and three quarters of the pieces tried crossed (in hours, and as a share of each piece's lap, whose chance level is a quarter), the robust spread, the median crossing's sigma, the pieces' age at it and their distance from the parent. Every attribution row and every step alert's confirmation row carries it (`originTried` to `originMissKm`, `originStepHours`), and so does every confirmed verdict's evidence. The first form of the test kept each piece's closest approach in three dimensions over every crossing in the window; on the first logging replay it put true clouds' pieces a median 177 hours apart (false ones 340), since a change of the axis alone leaves a piece about as far from the parent radially at every lap and the nearest lap is a toss-up; the crossing nearest the agreed instant replaced it.
- **What the test is used for**, each a parameter: a gate (`originHoursBase`, `originHoursPerDay`, `originShareMin`, `originMinPieces`, `originPhaseMax`, `originStepHoursMax`), off as fitted; an override (`originOverrideHours`, `originOverrideMinPieces`): pieces made at one instant are not an old cloud's, so the rules that read the launch's history as one (the remembered cloud, the backlog, the cataloguing batch: `HISTORY_REFUSALS`) do not refuse them, a young launch's rule standing since its own objects leave it at one instant too; a launch margin (`originLaunchMarginDays`): pieces whose median crossing is at or before the launch's first sighting are the launch's own objects catalogued late; and the event's instant (`originEventTime`): the median crossing where its sigma is finer than the convergence's.
- **The tools**: the scorecard's Confirmed cells read both ways (`confirmedLineTwins`), the per-event dissection's causes `confirmed at the launch`, `no common origin` and `a crewed station`, the training reader used below (a scratch script over a replay's year files that refuses an odd year), and the sweep's `--origin` mode.

## The iterations, on the training years

| Iteration | What changed | Headline targets | Confirmed | Recall (95%) | False confirmations | False-alarm rate (95%) | With the twins at the launch: confirmed, false |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0, the ninth phase as committed (`confirmed-v7`) | | 35 | 22 | 63% (46% to 77%) | 18 | 35% (24% to 49%) | – |
| 1, replayed (`kpi/work/d10-a`) | the warm-up year, the stations, twins raised wherever the pieces cannot tell bodies apart, the override at an hour with three pieces, the launch margin at zero | 35 | 23 | 66% (49% to 79%) | 23 | 40% (29% to 53%) | 23, 21 (38%) |
| 2, replayed (`kpi/work/d10-b`) | twins raised only where a persistent step picks one (`attributionTwinsUnresolved` off) | 35 | 22 | 63% (46% to 77%) | 12 | 27% (16% to 41%) | 22, 12 (27%) |
| 3, replayed, frozen (`kpi/work/d10-c`) | at least three pieces for an attribution (`attributionMinPieces`) | 35 | 22 | 63% (46% to 77%) | 9 | 22% (12% to 37%) | 22, 9 (22%) |

The warm-up year changes nothing on the training split (2005 is odd); the stations removed the three training false confirmations the station's jettisoned items made in the ninth phase (two confirmations of its reboosts and one attribution). Iteration 1 showed what raising unresolved twins costs: of nineteen verdicts naming candidates, two landed on a reported event with the twins at the launch (Iridium 95's launch-mate, Meteor 3-5's rocket body named with its payload) and the rest were false either way, pieces of old launches whose bodies share one plane (Iridium planes, an SL-18 stage and its debris, the H-IIA launch of SDS-4, LKW-4's stage debris, GOSAT 2's cubesats, Rodnik-S satellites, Fengyun 1C's stage). The ninth phase refused them for that reason, and the second iteration went back to it: a twin is named beside the body a step picks, never raised on its own.

### What the sweeps said

On the logging replay, the sweep of iteration 2's values each varied in turn (`kpi/work/d10-sweep2.log`) found one rule that trades nothing on the headline: at least three pieces for an attribution, 21 confirmed at 10 false to 21 at 7 (the ninth phase's sweep had it cost one, which the stations and the launch margin no longer need). The pieces' velocity floor at two metres a second removes two more false confirmations (Yaogan-6's two, below) for one headline confirmation, and was not taken. The common-origin rules, swept together (`kpi/work/d10-origin5.log`, 96 points; `d10-twins1.log` for the twins):

| rules (the ninth phase's otherwise, twins raised unresolved) | confirmed | false | false-alarm rate |
| --- | --- | --- | --- |
| none of the common-origin rules | 21 | 20 | 38% |
| the launch margin at zero days | 21 | 18 | 36% |
| the launch margin at thirty days | 20 | 17 | 35% |
| the override at an hour, three pieces | 22 | 19 | 37% |
| the override at an hour and the launch margin at zero | 22 | 17 | 34% |
| the override at twenty-four hours and the launch margin at zero | 23 | 25 | 41% |
| the gate: three quarters of the pieces within 24 hours | 10 | 10 | 36% |
| the gate: three quarters within 24 hours plus an hour a day of age | 11 | 13 | 41% |
| the gate in laps: three quarters of the pieces within a twentieth of a lap | 11 | 10 | 34% |
| the step's confirmation: the median crossing within 48 hours of the step | 20 | 18 | 38% |

The gate costs half the confirmations for half the false ones at every bound tried (an hour to two days, flat or growing by up to two hours a day of the pieces' age, at half or three quarters of the pieces, in hours or in laps): it is not kept. The override earns one confirmation where it is strict (an hour), and lets the launches' own objects in where it is loose; the launch margin removes two false confirmations for none.

### The separation

The common-origin readings of the confirmations the ninth phase's rules raise on the logging replay (`kpi/work/d10-origin2.log`), quartiles over the training years:

| reading | true confirmations (n: quartiles) | false confirmations (n: quartiles) |
| --- | --- | --- |
| pieces tried | 29: 3 / 7 / 8 | 14: 2 / 3 / 7 |
| half of the pieces within, hours | 22: 0.39 / 0.92 / 14.3 | 12: 0.17 / 6.1 / 21.8 |
| three quarters within, hours | 16: 0.88 / 8.4 / 56.2 | 10: 0.28 / 12.4 / 31.9 |
| half within, share of a lap | 22: 0.0002 / 0.003 / 0.013 | 12: 0.0006 / 0.020 / 0.040 |
| robust spread, hours | 25: 0.31 / 0.86 / 9.8 | 12: 0.25 / 2.1 / 18.5 |
| the pieces' age at the median crossing, days | 29: 9.4 / 38 / 149 | 14: 12 / 66 / 107 |
| half within, hours per day of age | 22: 0.016 / 0.035 / 0.26 | 12: 0.019 / 0.046 / 0.32 |
| the convergence's miss, km | 29: 38 / 794 / 3,730 | 14: 194 / 1,250 / 4,620 |

The medians separate (half the pieces within under an hour of each other for the true clouds, six hours for the false ones), the distributions do not: a quarter of the false clouds are tighter than the median true one, and a quarter of the true ones looser than the median false one. Three things blur it. The true clouds' first confirming batches are often of pieces weeks to months old, propagated back through drag SGP4 mispredicts, so their crossings spread by tens of hours; where the pieces cannot be propagated over the whole search window the fallback windows leave some of them uncrossed. And the tightest false clouds are pieces that did share an origin: a low-velocity shedding of Yaogan-6 in 2014, a burst of a Breeze-M's own debris in 2012, that no report names (the eighth phase found the same of a few). The frozen iteration's training confirmations read, for the 26 timed at two pieces or more, a median of 2.6 hours for half the pieces; its nine false ones, of the five so timed, a median of 0.17 hours.

## Every training false confirmation and miss, at the frozen values

The false confirmations (`kpi/work/d10-c`, the even years):

| Raised | Object | Launch | Class, path | Pieces | m/s | Crossings timed / tried; half / three quarters within, at the pieces' age | Why it passed, and what it is |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2006-07-21 | 29111 COSMOS 2420 | 2006-017 | payload, step alert | 2 | 34.3 | 1 / 2 | Two pieces under a quiet launch confirm a step under the fifth phase's rules. A Kobalt-M film-return satellite two days after its reentry: its capsules and its own end, released or reentering, not a breakup. No rule here names it, and none was added for one case. |
| 2012-07-10 | 37198 BREEZE-M DEB | 2008-011 | debris, attribution | 3 | 5.8 | 3 / 3; 0.01 / 0.13 h at 37 d | Three pieces crossing a piece of AMC-14's Breeze-M within minutes of one instant, two years after the stage's own breakup: a fragment's own breakup, as far as the elements say, that no report names. Every rule passes it; the test says it is real. |
| 2014-06-09 | 33384 SL-12 AUX MOTOR | 2008-046 | rocket body, attribution | 7 | 7.4 | 7 / 7; 214 / 352 h at 23 d | The pieces of its twin 33385's breakup of 20 May 2014 (a headline target, missed), named on 33384 by the centre of their axes while they converge on 33385 five times better. A twin the centre resolved wrongly; the common-origin gate would refuse it (their crossings of 33384 are days apart) and costs half the true confirmations to do so. |
| 2014-07-10 | 34839 YAOGAN-6 | 2009-021 | payload, attribution | 3 | 1.3 | 3 / 3; 0.17 / 0.28 h at 4 d | Pieces shed at a metre a second, crossing the satellite within a quarter of an hour of one instant four days before their first sets: a low-velocity event of Yaogan-6 no report names. The two-metre velocity floor would refuse it and costs a headline confirmation. |
| 2014-07-12 | 34839 YAOGAN-6 | 2009-021 | payload, step alert | 4 | 1.4 | 4 / 4; 0.14 / 0.31 h at 4 d | The same event, confirming the step alert raised on the satellite the day after. |
| 2018-06-18 | 43236 LKW-4 | 2018-025 | payload, attribution | 3 | 10.9 | 3 / 3; 9.2 / 77 h at 88 d | Named with its twin, the stage's debris 43237, picked by a step on the payload; no event on either. Three pieces three months old whose crossings spread over three days: the gate at a day would refuse it, at the cost above. |
| 2020-01-23 | 43657 COSMOS 2528 | 2018-082 | payload, step alert | 1 | 3.8 | 1 / 1 | A single piece under a quiet launch confirming a step: the fifth phase's single-piece rule lets it. Cosmos 2528 is a Russian military satellite; the piece may be a release. |
| 2022-12-16 | 52797 SHENZHOU-14 | 2022-060 | payload, attribution | 7 | 29.9 | 3 / 7 | Pieces under a crewed spacecraft's launch the day before its return capsule landed: what the spacecraft sheds at its end (the orbital module, covers), released on purpose. The station list holds the stations, not their visiting craft; extending it is the owner's call, and it was not made here. |
| 2026-02-27 | 40258 LUCH (OLYMP-K 1) | 2014-058 | payload, step alert | 1 | 11.4 | 1 / 1 | A single piece in geosynchronous orbit under a quiet launch confirming a step of the inspector satellite: perhaps a release, perhaps an unreported event; the single-piece rule lets it. |

The misses (the training headline targets, 13 of 35):

| Event | Launch | Pieces in the plane | Why missed |
| --- | --- | --- | --- |
| BEIDOU G5 R/B (38092), 2012-02-26 | 2012-008 | 1 | One piece, judged for the payload of its launch, never for the stage: a single piece in geosynchronous orbit. |
| COSMOS 2442-44 ULLAGE MOTOR (33385), 2014-05-20 | 2008-046 | 8 | Its pieces went to its twin 33384 (the false confirmation above); its own judgement was one piece in a cataloguing batch under a remembered cloud. |
| COSMOS 2513 R/B (41122), 2016-01-16 | 2015-075 | 1 | The one piece lay in no plane the detector held for the launch's bodies. |
| COSMOS 2447-2449 ULLAGE MOTOR (33473), 2016-06-01 | 2008-067 | 12 | Its twin 33472, which broke up in March, made a persistent step in the search window and was named first; 33473 is the verdict's second candidate, so the second row confirms it. |
| FREGAT DEB (TANK) (43089), 2018-02-12 | 2017-086 | 4 | A debris-classed parent first catalogued under ninety days before: the fresh-piece rule. |
| COSMOS 2417-2419 ULLAGE MOTOR (28920), 2018-08-24 | 2005-050 | 1 | One piece, judged for its twin 28919. |
| ORBCOMM FM16 (25417), 2018-12-22 | 1998-046 | 12 | One piece at half a metre a second: the velocity floor and the single-piece rule. |
| COSMOS 2535 (44421), 2020-01-09 | 2019-039 | 2 | One piece, under a cloud the launch remembered. |
| GOSAT 2 DEBRIS (43673), 2020-07-12 | 2018-084 | 83 | Its pieces were judged for the launch's payloads (cubesats in the same plane); the launch's own debris (the fairing covers) are twins only on a launch that left at most thirty in its first season. |
| COSMOS 2434-36 ULLAGE MOTOR (32398), 2022-04-15 | 2007-065 | 1 | One piece, judged for its twin 32399. |
| H-IIA PES fairing cover (43674), 2022-07-03 | 2018-084 | 35 | As GOSAT 2's debris above. |
| CZ-6A R/B (Yunhai 3) (54236), 2022-11-12 | 2022-151 | 665 | A stage breaking up a day after launch: the young launch's rule, which the override does not lift (a launch's own objects share an origin too). |
| H-IIA lower fairing panel (38345), 2022-11-17 | 2012-025 | 30 | Pieces that converge on two bodies of the launch alike and that no step tells apart: a twin unresolved, refused. |

## The frozen choice

Frozen at **2026-10-10T18:25Z**, before any odd year of a tenth-phase replay was read: iteration 3, `confirmed-v8`, with `attributionTwins` on, `attributionTwinsUnresolved` off, `attributionMinPieces` 3, `originOverrideHours` 1 with `originOverrideMinPieces` 3, `originLaunchMarginDays` 0, the common-origin gate off (`originHoursBase` and `originPhaseMax` beyond reach, `originStepHoursMax` beyond reach), `originEventTime` on, the station list as above, and every other value as the ninth phase left it. The committed replay is that of these defaults.

One amendment, at **2026-10-10T18:28Z**, still before any odd year was read: the detector's tests found that the override let a later batch of a remembered cloud's own event through again (its pieces share that event's origin, so they are that cloud's, and the verdict a duplicate). The override now applies only where the pieces' common instant is not the remembered cloud's own event, within a day (`sameInstant` in `src/run.ts`). It can only remove verdicts that would have been duplicates or, where the remembered event was another body's, the confirmations the memory refused before; the committed replay below is of the code with it, and its training numbers are reported beside the validation's.

## The validation, read once

Read on 2026-10-10 after the committed replay (`npm run kpi -- --all`, `confirmed-v8`), whose training numbers are iteration 3's to the last confirmation: 22 of 35 confirmed (63%, 46% to 77%), 9 false (22%, 12% to 37%). Nothing was changed after this reading.

| Split | Targets | Confirmed | Recall (95%) | False confirmations | False-alarm rate (95%) | Lead over the first agency statement, days: median (10th percentile) | Before it | Lag after the first fragment, days: median (90th) | Timing error, minutes: median (90th) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Training (even years 2006 to 2026) | 35 | 22 | 63% (46% to 77%) | 9 | 22% (12% to 37%) | 35.7 (−32.2) | 14 of 21 | 0.1 (5.9) | 1,126 (173,292) |
| Validation (odd years 2007 to 2025) | 23 | 17 | 74% (54% to 87%) | 12 | 38% (23% to 55%) | 41.7 (9.8) | 17 of 17 | 0.1 (4.0) | 41 (21,342) |
| To 2017 (from 2006) | 29 | 23 | 79% (62% to 90%) | 14 | 33% (20% to 47%) | 37.2 (−15.2) | 17 of 22 | 0.1 (0.1) | 583 (118,847) |
| From 2018 | 29 | 16 | 55% (38% to 72%) | 7 | 23% (12% to 41%) | 40.2 (−24.5) | 14 of 16 | 0.1 (17.2) | 73 (40,265) |

With the twins matched at the launch the held-out reading is the same, 17 of 23 at 12 false: the one held-out verdict naming candidates landed the same way both ways, and no held-out miss was a twin a step had picked (the twins left are unresolved ones, refused). On the training years the reading is the same too, 22 at 9: Cosmos 2447-2449's second ullage motor (33473) is confirmed at the launch, and the verdict that names it lands on the nearer event, so its twin's March event loses the same confirmation.

The held-out false confirmations, twelve, by kind: four confirmations of a step alert by two to four pieces (Cosmos 2427 in 2007, a Kobalt-M two days after its reentry, as Cosmos 2420 on the training years; Yaogan-26 in 2015; Cosmos 2535 in October 2019, three months before the breakup NASA dates and two after the one GCAT dates, a real event the truth merges into the later one; Meteor 1-5 in 2023); two attributions of a stage's pieces to its payload (Arabsat-4A, twice, for its Breeze-M's breakup of 2007, which is the held-out miss "attributed to another body"); and six attributions of small batches under old launches (H-2A's stage of IGS 3A in 2007, one of eight pieces crossing it in the window; Cosmos 1461 in 2009, pieces at two metres a second whose crossings spread over three weeks; Cosmos 2251's stage in 2009, four pieces of the collision's cloud crossing it within half an hour of one instant; Nimbus 2 twice, in 2011 and 2015, two to three metres a second, crossings days apart; an SL-12 auxiliary motor of 2010-041 in 2019). By class, nine on payloads and three on rocket bodies; eight attributed with no step, four on a step.

The held-out misses, six: Arabsat 4's Breeze-M (its pieces named on the payload by the centre of their axes); Cosmos 2139-41's ullage motor (a single piece); Cosmos 2464-66's ullage motor (one piece, under a remembered cloud); Cosmos 2424-26's ullage motor (one piece under the velocity floor, in a cataloguing batch); Cosmos 2499 (its pieces judged for its sibling 39764, never for it); SSLV's third stage (its pieces judged for its payload). Every one is a single piece, a stage told from its payload or sibling wrongly, or both. On the lines apart: 7 headline events with no fresh piece in the parent's plane within 180 days, 4 with no orbit of the parent before the event.

Every held-out confirmation with an agency's statement came before it, a median of six weeks (a quarterly news issue dated to its month, so the least it can have been), and a median of three hours after the catalogue published the first fresh piece. The timing error fell from the ninth phase's median of 114 minutes to 41 on the held-out years; the median crossing of the pieces times the event where its sigma is the finer.

## The answer

**The target is not reached.** On the held-out years the Confirmed line confirms 74% of the headline breakups whose fragments were catalogued in the parent's plane (54% to 87%) at a false-alarm rate of 38% (23% to 55%); on the training years 63% at 22%. Neither interval reaches nine in ten, and neither reaches one in ten.

Against the ninth phase the held-out false-alarm rate fell from 55% to 38%, of which most is method: the warm-up year (2005's twelve false confirmations) and the stations; the rest the launch margin and the three pieces. The recall is about where it was (72% then over 25 targets with 2005, 74% now over 23 without).

What the tenth phase's evidence says:

- **The common-origin test does not separate on this data.** The medians differ (half a true cloud's pieces cross the parent within under an hour of each other, a false cloud's within six), but the distributions overlap by a quarter each way, and as a gate it costs half the training confirmations at every bound tried. The pieces' first sets are weeks to months old, and SGP4 run back through the drag it mispredicts spreads a real breakup's crossings by tens of hours; and the tightest false clouds did share an origin (Yaogan-6's shedding in 2014, a Breeze-M fragment's own burst in 2012, Cosmos 2251's cloud crossing its stage in 2009), events or coincidences no report names. It is kept where it is physical and costs nothing: pieces made at one instant override the history rules, pieces whose instant is the launch itself are the launch's own objects, and the median crossing times the event.
- **Twins at the launch add nothing either way.** Raising unresolved twins added eleven false confirmations for one; where a step picks one, matching at the launch moves one event on the training years and none on the held-out ones. Every twin miss left (Cosmos 2499's sibling, the ullage motors' pairs, a stage and its payload) is a pair the pieces, their centre, their convergence and their crossings cannot tell apart, and no public reading tried here does.
- **What is left is the catalogue's single pieces and small batches.** Nine of the twelve held-out false confirmations and five of the six misses involve one to four pieces: a single piece can be a breakup's first or a release's only, and four pieces under a sixty-year-old launch can be a new event or the cataloguing of an old one. The rules can trade one for the other (three pieces, the velocity floor, the single-piece rule), not separate them.

The replay of the whole Archive takes 1,192 seconds of detector time, twenty-two minutes of wall time with the catalogue read for the targets and the year files written, against 1,111 seconds before this phase: the timing of every confirmation of a step alert, for the record, is the difference.
