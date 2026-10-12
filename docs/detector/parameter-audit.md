# The parameter audit

The review of 2026-10-12 counted about 170 knobs against 35 training positives, and read the held-out precision drop (training 6% false confirmations, held-out 21%) as the mark of rules tuned to the training clouds' particulars (issue #30). This note measures it: each knob removed in turn on the training years, to find the ones that bind; each fitted knee read again with one training event left out, to find the ones that rest on a single event; and the knobs not measured, with the reason. It changes no value. The parameters were then reorganised so the count reflects what is on (the last section).

The answer, in short. Of the 27 rules of the Confirmed channel swept offline, removing one at a time, 4 cost training confirmations, 11 cost false confirmations only, and 11 change nothing on the training years (the last, an option left off, would cost one confirmation if turned on). On the early warning, two signatures cost detections when removed and every explanation binds on false alarms only. Most fitted values hold when one training event is left out, but eleven move with one event: on the early warning the candidate threshold, the persistence threshold and the evidence bound (all three on one Cosmos 2459-2461 ullage motor, July 2014), the ratio's upper bound (COBE's stage), the siblings' count and the deployment age (both on Cosmos 2535); on the Confirmed line the cloud memory and the origin override (both on Hitomi), the young launch's 30 days (Yunhai 3's CZ-6A stage) and the refusal of unresolved twins (an H-IIA fairing panel); and, read by replay, the grace for an unnamed burst (Resurs O1 No. 3). On the Confirmed line each of those four trades one training confirmation for one to five false ones, which fits the held-out drop being a few rules each set by one or two training clouds rather than a broad overfit; 35 to 37 training targets are too few to say more.

## The discipline

- Training years only: the even years 2006 to 2026. Every number below is a training number; the scripts that made them never opened an odd year's file except where the Confirmed simulation reads the next year's file for a training event's confirmation, as `kpi:sweep --attributions` always has.
- **The Confirmed channel offline.** One logging replay with the rules off (`kpi/work/p30-off`: `npm run kpi -- --all --parallel 4 --from-states <states> --param confirmDeltaVMinMps=0 --param freshPieceDays=0 --param cloudMemoryDays=0 --param debrisParentNeedsNearerThanCloud=false --param singlePieceNeedsQuietLaunch=false --param confirmBackgroundMax=1e9 --param youngLaunchDays=0 --param attributionYoungLaunch=true --param attributionMinPieces=1 --param attributionMissKmMax=1e9 --param analystAttributes=true --param attributionBatchLaunchesMax=1e9 --param 'stationLaunches=[]' --param 'visitingLaunches=[]' --param reentryRefuses=false --param attributionTwinsUnresolved=true --param originOverrideHours=1e9 --param originLaunchMarginDays=-1e9 --param smallBatchOriginHours=1e9`, the ambiguity and centre ratios kept, as the tenth phase's logging replay kept them), then the attribution rows re-decided with each rule's values (`simulate` and `scoreOf` in `scripts/kpi/attributions.ts`, the functions behind `kpi:sweep --attributions`). At the detector's values the simulation reads 22 of 37 headline targets confirmed with 1 false confirmation; the replay of the same code with the rules on (the shared baseline) reads 23 with 2. The simulation is the yardstick within this note; a replay is the record.
- **The early warning offline.** The persistence gates and the fusion re-applied to the logged candidates of the shared baseline replay (`tally` in `scripts/kpi/sweep.ts`, the default `kpi:sweep`). Its count is the sweep's: 15 of 47 headline targets hit before the catalogue and any notice, 2,888 false alarms; the replay reads 11 flagged before the first fragment and 14 late, 2,909 false alarms.
- **Upstream knobs by replay**: two parallel exploration replays from the committed states, each compared with the shared baseline replay of the same code.
- **The rule for leave-one-event-out**: of a knob's grid values, those keeping the most headline detections, then the fewest false alarms, then the committed value or the nearest to it. Read on all training events, then with each training event dropped in turn; an event whose removal moves the choice is the event the knee rests on. The rule is one lens, uniform across knobs; several committed values traded a detection for false alarms on purpose, and the rule then picks another value on all events (it is said where).

The scratch scripts (`audit.ts`, `train.ts`) are not committed; they import the library and the sweep's functions and print the tables below.

## The Confirmed channel

### Ablation: each rule removed, the others as the detector has them

| Rule | Removed as | Confirmed (of 37) | Δ | False | Δ | Targets lost | Gained |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The detector's values | | 22 | | 1 | | | |
| The attribution itself (`attributionEnabled`) | off | 10 | −12 | 0 | −1 | 12, among them COBE's stage, the Cosmos ullage motors of 2016 and 2018, Titan's transtage | |
| A step breaks a tie (`attributionStepBreaksTies`) | false | 20 | −2 | 1 | 0 | the Cosmos 2447-2449 and 2424-2426 ullage motors (2016) | |
| The origin override (`originOverrideHours`) | OFF | 21 | −1 | 2 | +1 | Meteor 3-5's stage (2020) | |
| Debris parents (`attributionDebrisParentsMax`) | 0 | 21 | −1 | 2 | +1 | an SL-23 piece (2020) | |
| The young launch (`youngLaunchDays`) | 0 | 23 | +1 | 20 | +19 | | Yunhai 3's CZ-6A stage (2022) |
| At least three pieces (`attributionMinPieces`) | 1 | 22 | 0 | 6 | +5 | | |
| The cataloguing batch (`attributionBatchLaunchesMax`) | OFF | 22 | 0 | 5 | +4 | | |
| Unresolved twins refused (`attributionTwinsUnresolved`) | true | 23 | +1 | 4 | +3 | | an H-IIA fairing panel (2022) |
| A young launch never attributes (`attributionYoungLaunch`) | true | 22 | 0 | 4 | +3 | | |
| The launch's background (`confirmBackgroundMax`) | OFF | 22 | 0 | 3 | +2 | | |
| The cloud memory (`cloudMemoryDays`) | 0 | 23 | +1 | 2 | +1 | | Hitomi (2016) |
| The launch margin (`originLaunchMarginDays`) | −OFF | 22 | 0 | 2 | +1 | | |
| The small batch (`smallBatchOriginHours`) | OFF | 22 | 0 | 2 | +1 | | |
| The velocity floor (`confirmDeltaVMinMps`) | 0 | 22 | 0 | 2 | +1 | | |
| A single piece needs a quiet launch | false | 22 | 0 | 2 | +1 | | |
| The stations, the visiting craft, the reentry | none, off | 22 | 0 | 1 | 0 | | |
| A fresh debris parent, a debris parent nearer than the cloud | 0, false | 22 | 0 | 1 | 0 | | |
| The ambiguity and centre ratios, twins at all | 0, 0, false | 22 | 0 | 1 | 0 | | |
| The young launch's velocity (`youngLaunchDeltaVMps`) | 0 | 22 | 0 | 1 | 0 | | |
| The analyst ranges, the broad stage preference (off by default) | on | 22 | 0 | 1 | 0 | | |
| The small batch on steps (off by default) | on | 21 | −1 | 1 | 0 | DMSP 5D-2 F8 (2024) | |

What binds: the attribution carries 12 of the 22 confirmations (two of them only through the step's tie-break); the override and the debris parents one each. The young launch's 30 days is the rule that matters most for precision (19 false confirmations), then the three pieces, the batch, the twins and the young launch's own refusal. Eleven rules change nothing on the training years: the stations', the visiting craft's and the reentry's exemptions, the fresh debris parent, the debris parent nearer than the cloud, both ratios, twins named at all, the young launch's velocity, and two of the options left off (the analyst ranges, the broad stage preference). They may act on the held-out years or live, so nothing is removed for it; but they are not where the training fit lies.

### Leave one event out

| Fitted rule | Committed | Chosen by the rule on all events | Dropping one event moves it | Grid (value: confirmed/false) |
| --- | --- | --- | --- | --- |
| `cloudMemoryDays` | 365 | 0 | Hitomi (41337, 2016-03-26) → 365 | 0: 23/2; 90: 22/1; 180: 22/1; 365: 22/1; 730: 22/1 |
| `youngLaunchDays` | 30 | 7 | Yunhai 3's CZ-6A stage (54236, 2022-11-12) → 30 | 0: 23/20; 7: 23/6; 30: 22/1; 90: 20/1 |
| `originOverrideHours` | 1 | 24 | Hitomi → 1 | OFF: 21/2; 1: 22/1; 6: 22/2; 24: 23/6 |
| `attributionTwinsUnresolved` | false | true | the H-IIA fairing panel (38345, 2022-11-17) → false | false: 22/1; true: 23/4 |
| `confirmDeltaVMinMps` | 1 | 1 | stable | 0: 22/2; 0.5: 22/1; 1: 22/1; 2: 21/1; 5: 20/1 |
| `freshPieceDays` | 90 | 90 | stable (flat) | 22/1 at 0 to 180 |
| `confirmBackgroundMax` | 2 | 2 | stable | 0.5: 21/1; 1: 21/1; 2: 22/1; 5: 22/2; 20: 22/3; OFF: 22/3 |
| `youngLaunchDeltaVMps` | 5 | 5 | stable (flat) | 22/1 at 0 to 10 |
| `attributionMinPieces` | 3 | 3 | stable | 1: 22/6; 2: 22/2; 3: 22/1; 4: 21/2; 5: 20/2 |
| `attributionBatchLaunchesMax` | 2 | 2 | stable | 1: 18/1; 2: 22/1; 3: 22/1; 5: 22/2; 10: 22/5; OFF: 22/5 |
| `attributionAmbiguityRatio`, `attributionCentreRatio` | 3, 3 | 3, 3 | stable (flat) | 22/1 at every value |
| `attributionDebrisParentsMax` | 30 | 30 | stable | 0: 21/2; 10: 22/1; 30: 22/1; 100: 22/1 |
| `originOverrideMinPieces` | 3 | 3 | stable | 2: 22/1; 3: 22/1; 5: 22/2 |
| `originLaunchMarginDays` | 0 | 0 | stable | −OFF: 22/2; 0: 22/1; 30: 21/1 |
| `smallBatchOriginHours`, `smallBatchOriginShare` | 48, 0.75 | 48, 0.75 | stable | 12: 21/1; 24: 22/1; 48: 22/1; 96: 22/2; OFF: 22/2; a half: 22/2 |
| `reentryAfterPiecesDays`, `attributionPreferCentreRatio` | 0, 3 | 0, 3 | stable (flat) | 22/1 at every value |
| `debrisParentNeedsNearerThanCloud`, `singlePieceNeedsQuietLaunch`, `attributionStepBreaksTies` | true | true | stable | |
| `attributionYoungLaunch`, `analystAttributes`, `smallBatchStepsToo` | false | false | stable | |
| `attributionMissKmMax` | OFF | OFF | stable | 20 to 100: 10/0; 300 and 1,000: 12/0; OFF: 22/1 |

Four knees rest on one event each. In each, the committed value gives up one training confirmation to keep one to five false confirmations away, and that confirmation is the whole difference: Hitomi is what the cloud memory and the one-hour override cost, Yunhai 3's stage what the young launch's thirty days costs, the H-IIA fairing panel what refusing unresolved twins costs. With that event left out, the rule picks the committed value. These are the knees the held-out years can move most: one held-out event of the same shape on either side changes the choice.

## The early warning

### Ablation

| Gate | Removed as | Headline hits (sweep, of 47) | Δ | False alarms | Δ | Events lost | Gained |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The detector's values | | 15 | | 2,888 | | | |
| The size signature (`typicalityMax`) | off | 13 | −2 | 2,525 | −363 | Telkom 3's Breeze-M (2012), a Cosmos 2447-2449 ullage motor (2016) | |
| The geometry signature (`consistencyMin`) | off | 12 | −3 | 2,602 | −286 | two Cosmos 2459-2461 ullage motors (2014, 2018), Cosmos 2535 (2020) | |
| No floor on the kick (`geometryKickMinMps` at 0) | a floor beyond reach | 12 | −3 | 2,609 | −279 | the same three | |
| The persistence threshold (`zPersist`) | at the candidate's 6 | 15 | 0 | 3,963 | +1,075 | | |
| The evidence against a drift (`evidenceMin`) | 0 | 15 | 0 | 2,996 | +108 | | |
| The span (`persistMinSpanHours`, low orbit) | 0 | 15 | 0 | 2,919 | +31 | | |
| The ratio's bounds (`rhoMin`, `rhoMax`) | 0, open | 15 | 0 | 2,888, 2,902 | 0, +14 | | |
| A young object's unknown record (`newObjectDays`) | 0 | 15 | 0 | 2,906 | +18 | | |
| The direction signature (`oppositeMinSteps`) | off | 15 | 0 | 2,778 | −110 | | |
| Maintenance (`maintenanceToleranceKm`) | off | 15 | 0 | 2,990 | +102 | | |
| Lowerings too, the tolerance in sigmas | false, 0 | 15 | 0 | 2,945, 2,904 | +57, +16 | | |
| Siblings (`siblingsMin`) | off | 15 | 0 | 3,186 | +298 | | |
| Deployment (`deployAgeDays`) | off | 15 | 0 | 3,051 | +163 | | |
| The status as evidence (`opsStatusEvidence`) | false | 15 | 0 | 8,146 | +5,258 | | |
| A dead object needs no explanation (`nonoperationalOverrides`) | false | 15 | 0 | 2,793 | −95 | | |
| One independent explanation outweighs the record (`independentOutweighs`) | off | 15 | 0 | 17,544 | +14,656 | | |
| Explanations on every class (`explanationsForNonPayloads`) | false | 15 | 0 | 3,208 | +320 | | |
| The drag-term test (off by default, at a million) | on at 2 | 17 | +2 | 3,427 | +539 | | Cosmos 2421 (2008), Yaogan 1 (2010) |
| The occasional raise, persistence on the mean step, the against-drag signature (off by default) | on | 15 | 0 | 3,398, 3,982, 2,888 | +510, +1,094, 0 | | |

What binds: the size and the geometry signatures (the geometry with no floor on the kick) are the only gates whose removal loses a detection; every explanation, and the status read as evidence above all, binds on false alarms only. Two gates cost false alarms and buy nothing on the training years as the truth now stands: the direction signature (110 false alarms; its provenance says three past steps lose Hitomi, which no longer holds under the current truth and gates) and the nonoperational override (95; its provenance says one headline hit). They are left as they are: removing them is a choice to make with the held-out years closed, and this note only measures.

### Leave one event out

| Fitted gate | Committed | Chosen by the rule on all events | Dropping one event moves it | Grid (value: headline hits/false alarms) |
| --- | --- | --- | --- | --- |
| `zCand` (the candidates under it dropped from the log) | 6 | 6 | a Cosmos 2459-2461 ullage motor (36406, 2014-07-09) → 15 | 6: 15/2,882; 7: 14/2,709; 8: 14/2,482; 10: 14/2,068; 12: 14/1,763; 15: 14/1,494; 20: 12/1,235 |
| `zPersist` | 10 | 10 | the same event → 15 | 6: 15/3,963; 8: 15/3,460; 10: 15/2,888; 12: 14/2,130; 15: 14/1,690; 20: 13/1,373 |
| `evidenceMin` | 10 | 20 | the same event → 50 | 0: 15/2,996; 5: 15/2,932; 10: 15/2,888; 20: 15/2,760; 50: 14/2,539 |
| `rhoMax` | 100 | 100 | COBE's stage (20323, 2006-12-03) → 3 | 1.5: 13/1,666; 2: 13/2,142; 3: 14/2,520; 100: 15/2,888 |
| `siblingsMin` | 2 | 2 | Cosmos 2535 (44421, 2020-01-09) → 1 | 1: 14/2,611; 2: 15/2,888; 3: 15/2,993; 5: 15/3,083; off: 15/3,186 |
| `deployAgeDays` | 180 | 180 | Cosmos 2535 → 365 | 0: 15/3,051; 30: 15/2,917; 90: 15/2,905; 180: 15/2,888; 365: 14/2,878 |
| `bstarRatioMax` | 10⁶ | 2 | Yaogan 1 (29092, 2010-02-04) → 5 | 2: 17/3,427; 3: 16/3,294; 5: 16/3,163; 10: 15/3,067; 20: 15/3,018; 10⁶: 15/2,888 |
| `typicalityMax`, `consistencyMin`, `geometryKickMinMps` | 10, 100, 0 | the same | stable | |
| `rhoMin`, `persistMinSpanHours`, `maintenanceToleranceKm`, `maintenanceToleranceSigmas`, `newObjectDays`, `oppositeMinSteps`, `nonoperationalOverrides` | 0.5, 18, 1, 3, 90, 2, true | 0.75, 24, 0.5, 5, 365, off, false | stable | each a few to a hundred false alarms fewer at no detection lost |
| `independentOutweighs`, `explanationsForNonPayloads`, `maintenanceLoweringsToo`, `againstDragMinRaises`, `occasionalRaisesNonPayload`, `persistOnMeanStep` | | the same | stable | |

The candidate threshold, the persistence threshold and the evidence bound all rest on one event, the July 2014 breakup of a Cosmos 2459-2461 ullage motor, whose hitting candidate opened at 6.3 sigma, the smallest first set of any hit: without it the candidate and the persistence thresholds would sit at 15, with about half the false alarms (the candidate threshold's grid is approximate: dropping a candidate from the log does not replay its effect on the object's window). The ratio's open upper bound rests on COBE's stage, as its provenance says, and the siblings' count and the deployment age on Cosmos 2535. The drag-term test, left off at a million, would gain two detections at 539 false alarms; at a million it is not quite off (four logged steps over the Archive exceed it, none of them on the training years' count), which is why it stays a live threshold rather than `OFF`. Where the rule picks another value with no detection lost (`rhoMin`, the span, the maintenance tolerances, `newObjectDays`, the direction signature, the nonoperational override), the committed value was chosen on earlier truth and earlier gates; the difference is tens of false alarms in 2,888, under 4%.

## Upstream, by replay

Two parallel exploration replays, each against the shared baseline replay of the same code and the same starting states, read on the training years:

| Replay | Confirmed (of 37) | False | Early warning: flagged, late (of 47) | False alarms |
| --- | --- | --- | --- | --- |
| Shared baseline | 23 | 2 | 11, 14 | 2,909 |
| The plane's distance at 5, not 3 (`planeDistanceMax`) | 21 | 2 | 11, 14 | 2,909 |
| No grace for an unnamed burst (`attributionUnnamedGraceDays` 0) | 22 | 2 | 11, 14 | 2,909 |

A wider plane loses Cosmos 2423 (2006) and Cosmos 2428 (2014), whose pieces then share the plane of more bodies of their launch, and swaps one false confirmation for another: the plane bound of three binds, and loosening it costs. Without the grace for a burst nobody was named for, Resurs O1 No. 3 (2020) is not confirmed and no false confirmation is saved: the 180 days, fitted by replay in the ninth phase, rest on that one training event, as the four knees above rest on theirs. Neither replay moved the early warning, as it should not.

## Not ablated, and why

- **The noise model** (`sigmaPrior`, `sigmaPriorBstar`, `kappa`, the environment's scatter tables `fluxScatter` and `apScatter`, `slopePriorSigmas`, `longHalfLifeDays`): they set every residual's scale, so a change moves every candidate, and no log row carries what a candidate would have been under another scale; each needs its own replay, and they were judged less likely to bind than the plane and the grace (their fits were "nothing to sweep against" or "the last value losing nothing", `d1-fitting.md`). The environment's tables were measured by the earlier attempt, not on this project's training split, and say so in their provenance.
- **The candidate threshold downwards**: the log holds no candidate under 6 sigma.
- **The clock and the ring** (`ringSize`, `windowSets`, `windowMaxDays`, the fit's set counts, `persistMinSets`, `persistMinSetsAlone`, `persistMinSetsUnderStress`, `maxPostSets`, `lapseDays`, `stormKp`, `stressCandidatesPerDay`, the CUSUM): policy choices about the product and the guards that act before the log; a replay each.
- **The record's class rules** (`stationKeepingMinSteps`, `regularityMax`, `alternationMin`, `monotoneShareMin`, the disposal sizes, `historyDays`): policy, read through `classify`, which the sweep re-applies, but the sweep's gates do not vary them; they decide only which explanation silences a step, and every explanation binds on false alarms only.
- **The burst channel** (`pBurst`, `lambdaFloor`, `burstMinBodies`, `cloudOnlyDeltaVMinMps`): they decide the review list, which no line scores; the cloud sweep (`kpi:sweep --clouds`) on the baseline's training years shows a smooth trade with no knee on one event (149 clouds listed, 57 reported events hit, 84 false at the detector's values; `planeDistanceMax` 3, 5 and 10 list the same clouds).
- **The scope** (`scope`, `d7-scope.md`): the scoped line is reported beside the early warning, not a target; its own note swept it.
- **The plane's tolerances** (`planeInclinationToleranceDeg`, `planeNodeToleranceDeg`): the replay of the distance bound stands for the plane test.
- **The timing and the search** (`eventGridSeconds`, `eventLeadHours`, `attributionSearchDays`, `attributionGridMinutes`, `attributionMaxPieces`, `attributionMaxCandidates`, the refinement's counts): they set how finely an instant is found and what an attribution costs; the attribution's 180 days is the Confirmed line's own window.
- **The exemptions** (stations, visiting craft): policy decisions; the ablation above shows they change nothing on the training years.

## The parameters reorganised

`DetectorParameters` had 146 keys when this change was made (68 fitted, 67 policy, 11 physical; 145 when the review counted them, before the plane-normal bound of #37). After this change:

- **A legacy block.** The 16 options a phase built and left off by default (the occasional raise on a non-payload, persistence on the mean step, the against-drag signature, the analyst ranges, a young launch's attribution, the convergence's miss bound, unresolved twins, the common-origin gate's five settings and its step bound, the broad stage preference, the convergence naming the parent, the small batch on steps) moved to `params.legacy`, each with its provenance. `--param legacy.name=value` or the bare name turns one on; a record of the parameters written before the block reads the same (`parametersWith`).
- **The stray constants and the environment's tables** became parameters with provenance: `leoBandKm`, `fluxScatter`, `apScatter`, `longMemoryClipSigmas`, `quietAfterCloseDays`, `quietAfterRaiseDays`, `stationKeepingWindowDays`, `attributionFallbackSearchDays`, `launchEraDays`, `damageMaxResiduals`, `damageMinResiduals`, `eventRefinedCrossings`, `eventRefineReachMinutes`. The bounds that size the states carried between runs (a launch's months of counts, the mark's and the sibling ledger's reach, the envelope's months) stay beside the states, since changing one changes the states' shape; the physical and format constants (the Earth's rotation, the analyst ranges' floors, the median's efficiency) stay where they are used.
- **One sentinel.** A threshold turned off is at `OFF` (10⁹, or −`OFF` for a lower bound), read by `isOn`, in place of the scattered `< 1e8` comparisons. The against-drag signature's 10⁶ became `OFF` (no record holds a million raises). The drag-term test's 10⁶ stays: four logged steps over the Archive pass it.

The live parameters are now 143 keys (54 fitted, 78 policy, 11 physical), the legacy block 16. No verdict changed: the unit suite passes unchanged in what it asserts, and a parallel exploration replay of the reorganised code (`kpi/work/p30-refactor`) equals one of the code just before it (the plane-normal bound's replay at its fitted degree, from the same states and the same Archive) in every verdict, log row and score of all 22 years, and in the aggregate's splits; only the record of the parameters differs, by its new shape.
