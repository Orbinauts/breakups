# The eleventh phase: the crewed and cargo craft, the truth's tight-origin candidates, and three physical rules

The tenth phase left the Confirmed line at 22 of 35 headline breakups confirmed on the training years (63%) with 9 false confirmations (22%), and 17 of 23 on the held-out years (74%) with 12 (38%). The owner delegated two calls, decided before this phase fitted anything (the plan's item 13): the crewed spacecraft and the stations' cargo craft are exempt as the stations are, and the false confirmations whose pieces share a tight common origin enter the truth only with an independent source. This phase implemented both, then three physical rules the coordinator named (pieces after the parent's reentry, the stage preferred over its payload, a tight common origin for small batches) and one more tried under the fourth (the convergence over the centre), fitted on the even years, froze the choice with a timestamp, and read the odd years once. This note records it all.

## The discipline

- The training split is the even years 2006 to 2026, the validation split the odd years 2007 to 2025, 2005 the warm-up year scored on no split. Every number below up to the freeze is a training number. The replays' consoles print every year and the held-out headline, so they were written to logs and never read; the training split was read with a scratch reader that prints the even years' cells alone (`kpi/work/train11.ts`), and the per-confirmation analyses below with scripts that refuse an odd year or read, from an odd year's file, only the confirmations landing on an even year's event (a December event confirmed in January is its year's, as the scorecard counts it).
- What was read of the odd years before the freeze, all of it the tenth phase's published results or the truth: the tenth phase's note, the plan, the seventh decision record and the detector's README, which state the tenth phase's held-out reading (its numbers and its twelve held-out false confirmations and six misses, by name); the truth's rows under the crewed and cargo craft's launches, among them Progress M-27M's stage (2015), a headline breakup of a held-out year (the truth's content, not the detector's); and the web search for the tenth phase's false confirmations of both splits, which the tenth phase's note lists. No number of an eleventh-phase replay on an odd year was printed, opened or computed before the freeze.

## The crewed and cargo craft's launches (the owner's call a)

`npm run archive:visiting` (`scripts/archive/visiting.ts`) reads the satellite catalogue's snapshot in the Archive (`satcat/2026-10-09.csv`) and writes `src/visiting.ts`: every payload whose name is one of the vehicles below and that was in orbit at some time since 2005-01-01 (no decay date, or one on or after it), one entry per launch. 295 launches:

| Vehicle | Kind | The catalogue's names | Launches |
| --- | --- | --- | --- |
| Soyuz | crewed | `SOYUZ-TMA …`, `SOYUZ-MS …` | 66 |
| Shenzhou | crewed | `SHENZHOU-6` to `-23` | 18 |
| Space Shuttle | crewed | `STS 114` to `STS 135` | 22 |
| Crew Dragon | crewed | `CREW DRAGON …`, `AXIOM-1` to `-4`, `INSPIRATION4`, `POLARIS DAWN`, `FRAM2` | 22 |
| Starliner | crewed | `STARLINER OFT-1`, `OFT-2`, `CFT-1` | 3 |
| Progress | cargo | `PROGRESS-M …`, `PROGRESS-M1 …`, `PROGRESS-MS …`, `PROGRESS-M UM` (Prichal's carrier) | 80 |
| Tianzhou | cargo | `TIANZHOU-1` to `-10` | 10 |
| Dragon | cargo | `DRAGON & FALCON 9 R/B`, `DRAGON C1`, `C2+`, `CRS-1` to `-34` | 36 |
| Cygnus | cargo | `CYGNUS …` | 23 |
| HTV | cargo | `HTV-1` to `-9`, `HTV-X1` | 10 |
| ATV | cargo | `ATV-1` to `-5` | 5 |

Left out on purpose: names that only contain the words (DRAGONSAT, MICRODRAGON, DRAGRACER, STSAT, STSS, the Cygnus mass simulator of Antares' test flight) and Orion, which flew alone beyond low orbit. The detector refuses to confirm or attribute under these launches (`visitingLaunches`, the refusal `visiting`) and the scorecard lands any confirmed verdict under one as exempt (`VISITING_LAUNCHES` in `scripts/kpi/match.ts`), as for the stations, with one difference: a verdict naming the launch's rocket body is judged and scored as any stage's. What a crewed or cargo craft leaves in orbit (an orbital module and its covers, a trunk, lost tools, jettisoned items) is released on purpose; the stage that launched it is an ordinary stage, and stages of these launches do break up (the truth holds Progress M-27M's third stage, 2015, as a breakup NASA reports). In the truth, the catalogue's bursts under Shenzhou-12's and Shenzhou-14's launches (the only catalogue-only rows under these launches) are exempt as releases, as the station's are (`data/truth/overrides.json`); NASA's own report of Shenzhou-13's orbital module (an anomalous event, 2022) stays scoreable, and the detector can no longer confirm it.

## The tight-origin candidates (the owner's call b)

Each of the tenth phase's false confirmations whose pieces share a tight common origin was searched for an independent statement (NASA's history and quarterly news, ESA, GCAT's debris-cloud pages and satellite catalogue, Jonathan's Space Report, the web), never the detector's output:

| Candidate | Source found | Decision |
| --- | --- | --- |
| Yaogan-6 (34839, 2009-021A), July 2014: pieces at a metre a second crossing it within a quarter of an hour | GCAT's satellite catalogue (J. McDowell, read 2026-10-10): its four pieces 40065 to 40068 typed `D J` (anomalous debris: insulation, soft material), parent `S34839`, separated `2014 Jul?`. No narrative report: NASA's history, the quarterly news of 2012 to 2015 and Jonathan's Space Report are silent. | **Entered** as a hand row: source `analyst`, kind anomalous, June to August 2014 (GCAT's vague month), confidence C. |
| Breeze-M DEB (37198, 2008-011C), May 2012: three pieces crossing it within minutes | None. NASA's history and GCAT both give the three pieces (38575, 38576, 38583) to the Briz-M stage's own breakup of 13 October 2010 (GCAT: parent `S32709`, `2010 Oct 13 0553`; NASA: 116 fragments catalogued up to 3.6 years after the event). | **Unconfirmed, kept as a false confirmation.** |
| SL-8 stage of Cosmos 2251 (22676, 1993-036B), 2009: four pieces crossing it within half an hour | None, and against: NASA's history lists 22676 among the objects of the launch not associated with the collision, and GCAT gives every 1993-036 piece to Cosmos 2251. | **Unconfirmed, kept as a false confirmation.** |

Found while searching the rest of the tenth phase's false confirmations, outside the tight-origin rule:

- **Luch (Olymp-K 1)** (40258, 2014-058A), whose single-piece confirmation of January 2026 was a training false confirmation: a breakup in the geosynchronous graveyard on 2026-01-30 from 06:09 UTC, observed by s2a systems (as quoted by Universe Magazine, 2026-02-02), reported in Jonathan's Space Report No. 853 and studied by DLR (an IAC-26 paper). A named breakup with an instant, the kind of row the truth's 2025 to 2026 news entries are: **entered** as two hand rows (`news`, `analyst`), confidence D.
- Kosmos-2427 (2007) and Kosmos-2420 (2006): GCAT types their pieces as components, solar panels separated before recovery (the reentry rule below). LKW-4's pieces (2018): GCAT types them as the CZ-2D stage's retro covers, released at launch. Yaogan-26 (2015): launch debris. None entered.
- GCAT's satellite catalogue alone gives dated debris to Kosmos-2528 (`2019 Dec?`), Meteor 1-5 (`2023 Nov?`), Nimbus 2 (`2011 Apr?`, none in 2015) and Kosmos-1461 (`2009 Jan?`). These were not tight-origin candidates, and the eighth phase decided against entering the catalogue's few-piece attributions wholesale (`d8-audit.md`); they are listed here for the owner and were not entered.

The truth now has 599 events, 177 scoreable from 2005 (`docs/truth.md`).

## The rules

Each is a parameter, refusing on the attribution row with its own bit, logged so the sweep re-applies it, and tested (`src/detector.test.ts`, "the eleventh phase's rules"; `test/kpi.test.ts`).

- **Pieces after the parent's reentry** (`reentryRefuses`, `reentryAfterPiecesDays`, refusal `reentry`): the replay hands the detector every body's decay day from the catalogue (`DetectorInput.decays`), and the detector reads one only from that day on, so the rule needs nothing a live run would not have. Pieces whose earliest first set is on or after the parent's decay day (plus the days allowed) are the reentry's: a capsule, a solar panel, an aerodynamic breakup's debris. The tenth phase's Kobalt-M case (Cosmos 2420, decayed 2006-07-19, two pieces first seen the next day, which GCAT calls its solar panels) is the training case.
- **The stage preferred over its payload** (`attributionPrefersStage`, `attributionPreferCentreRatio`): where the pieces of an attribution share the plane of a body of a better rank than the one their centre named (0 a rocket body, 1 a body not operating at the time, 2 a payload operating at it, by the dated status) and its offset from their centre is within the factor of the named body's, the better-ranked body is named, unless the named one alone made a persistent step; and the same rank breaks a tie between twins no step tells apart. The base rates that justify the prior, from the truth since 2005 and the satellite catalogue: 38 breakups on rocket bodies against 79 on payloads (29 against 32 on the headline line), from 3,602 rocket bodies and 25,268 payloads in orbit at some time since 2005, so about 1.1% of rocket bodies against 0.3% of payloads (0.7% without the megaconstellations' 13,829), a rocket body three to six times as likely; and of the 75 payload breakups, 5 were on a payload operating at the time by the dated status, 43 on one dead and 27 unknown.
- **Small batches** (`smallBatchMinPieces` 3, `smallBatchMaxPieces` 4, `smallBatchOriginShare`, `smallBatchOriginHours`, `smallBatchStepsToo`, refusal `smallBatch`): three or four pieces must share a tight common origin, at least two of them crossing the parent in the window and the share asked within the bound of their median crossing.
- **The convergence over the centre** (`attributionConvergenceNames`), tried under the fourth item: where the pieces, propagated back, converge on another body of their plane better by the ambiguity ratio than on the one their centre named, that body is named (the tenth phase's ullage motor 33384, named for its twin 33385's pieces).

A fault found on the way: the log kept every signal to four significant digits, the refusal bits too, so a refusal of 16,384 (the common-origin test) or more was written as another set of bits (16,380). The bits are now kept whole (`WHOLE` in `src/log.ts`); the per-event dissection, which names a miss's cause from them, reads them right from this phase.

## The iterations, on the training years

| Iteration | What changed | Confirmed of 35 | Recall (95%) | False confirmations | False-alarm rate (95%) |
| --- | --- | --- | --- | --- | --- |
| 0, the tenth phase as committed (`confirmed-v8`) | | 22 | 63% (46% to 77%) | 9 | 22% (12% to 37%) |
| 1, the tenth phase's verdicts matched again (`kpi/work/d11-rematch`) | the crewed and cargo craft exempt in the scorecard; Yaogan-6 and Luch in the truth; Shenzhou-12's and -14's bursts exempt | 22 | 63% (46% to 77%) | 5 | 13% (6% to 27%) |
| 2, replayed (`kpi/work/d11-a`) | the detector refuses under the crewed and cargo craft; the reentry rule at zero days | 22 | 63% (46% to 77%) | 4 | 11% (4% to 25%) |
| trial, replayed (`kpi/work/d11-b`) | 2 with the small batches below and the convergence over the centre | 22 | 63% (46% to 77%) | 4 | 11% (4% to 24%) |
| 3, replayed, frozen (`kpi/work/d11-c`) | 2 with the small batches: attributions of three or four pieces need three quarters of them crossing within 48 hours | 22 | 63% (46% to 77%) | 3 | 8% (3% to 22%) |

The replays are the parallel exploration mode's (approximate at the chunks' first years). Iteration 1 removed the two Yaogan-6 verdicts (now a detection of a confidence-C anomalous event), Luch's (a detection of a confidence-D breakup) and Shenzhou-14's (exempt); iteration 2 removed Cosmos 2420's, two pieces first seen the day after its reentry; iteration 3 LKW-4's, three covers its stage released at launch whose crossings spread over three days.

### What the sweeps said

The offline sweep (`KPI_DIR=… npm run kpi:sweep -- --origin --grid name=v1,v2`, the `--grid` option new) simulates the rules from the logging replay's rows (`kpi/work/d11-off`, every rule off), but it models the cloud memory too roughly to fit on here: at the tenth phase's rules it reads 23 confirmed at 11 false on the logging replay, and 23 at 15 on iteration 2's own rows, against the replay's 22 at 4. The rules were therefore read first-order on a replay's own confirmations (`kpi/work/rules11.ts`: each rule removes or renames a verdict the replay raised; what the replay would have raised after it is not modelled, and a replay checks the point chosen), on iteration 2:

| Rule | Confirmed of 35 | False | Events confirmed, every line | Headline lost |
| --- | --- | --- | --- | --- |
| as replayed (iteration 2) | 22 | 4 | 33 | |
| the reentry rule up to 1, 2, 3, 5, 10 or 30 days after the pieces' first set | 22 | 4 | 33 | none: no parent's decay was published by its pieces' run within those days |
| small batches, steps' confirmations too, half within 0.25 to 48 hours | 17 to 21 | 3 to 4 | 27 to 32 | DMSP 5D-2 F8 at every bound (its three pieces, a step confirmed, cross it 180 hours apart) |
| small batches, steps' confirmations too, three quarters within 0.25 to 48 hours | 16 to 21 | 3 | 25 to 32 | DMSP 5D-2 F8 at every bound |
| small batches, attributions only, half within 0.25 to 6 hours | 19 to 21 | 3 | 29 to 31 | COBE's stage, the Titan transtage, an ullage motor |
| small batches, attributions only, half within 8 or 9 hours | 22 | 3 | 32 | none on the headline, an event off it |
| small batches, attributions only, three quarters within 0.25 to 12 hours | 19 to 21 | 3 | 29 to 31 | COBE's stage and others |
| small batches, attributions only, three quarters within 24 or 48 hours | 22 | 3 | 33 | none |
| small batches, attributions only, three quarters within 96 hours | 22 | 4 | 33 | none, and LKW-4 (76.5 hours) passes |
| the launch margin (the tenth phase's rule) at 1 day | 22 | 4 | 33 | |
| the launch margin at 2 to 30 days | 21 | 3 | 32 | Cosmos 2423 (2006), a breakup two months after launch |
| the stage preferred, within a factor of 1.5 to any | 22 | 5 | 33 | none; no confirmation renamed, and one tie broken onto Iridium 28 (1997-051, the launch of Iridium 33's collision cloud), with no event |

The small-batch rule separates where it reads attributions alone: a step seen on the parent dates an event of its own, and the step's confirmations of three or four pieces include a true one whose pieces' crossings are a week apart (DMSP 5D-2 F8's, catalogued five months after the event, through drag SGP4 mispredicts). Three quarters within 24 to 48 hours keeps every training confirmation and removes LKW-4's; 48 hours was chosen, inside the plateau, half way in ratio between the loosest true small attribution (under 24 hours) and LKW-4's 76.5. The stage preference renamed nothing on the training years and broke one tie the wrong way, so it is off; the factor stays at 3 for the record. The trial replay with the convergence over the centre confirmed the ullage motor 33385 its twin had been named for and removed that false confirmation, but lost Cosmos 2447-2449's ullage motor (33472, March 2016) and Cosmos 2424-2426's (29680, July 2016) and named two bodies with no event (29682 of 2006-062 in 2016, 39484 of 2013-076 in 2020): net, one confirmation fewer and one false more, so it is off.

## Every training false confirmation and miss, at the frozen values

The false confirmations (`kpi/work/d11-c`, the even years):

| Raised | Object | Launch | Class, path | Pieces | m/s | Crossings timed / tried; half / three quarters within, at the pieces' age | Parent's decay | Why it passed, and what it is |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2012-07-10 | 37198 BREEZE-M DEB | 2008-011 | debris, attribution | 3 | 5.8 | 3 / 3; 0.01 / 0.13 h at 37.5 d | – | NASA and GCAT give the three pieces to the stage's own breakup of 2010, which the detector confirmed then; they cross this fragment within minutes of one instant in May 2012, so the common origin lifts the launch's history and the small-batch rule passes them. A catalogue reason exists (the pieces are a reported cloud's) but no public rule the detector could read without the truth: unconfirmed, kept. |
| 2014-06-09 | 33384 SL-12 R/B(AUX MOTOR) | 2008-046 | rocket body, attribution | 7 | 7.4 | 7 / 7; 214 / 352 h at 22.9 d | – | Its twin 33385's pieces of 20 May 2014 (a headline target, missed), named by their centre while they converge on 33385 five times better. Two rocket bodies, so the rank cannot break the tie; the convergence over the centre fixes this one and costs two others. |
| 2020-01-23 | 43657 COSMOS 2528 | 2018-082 | payload, step alert | 1 | 3.8 | 1 / 1 | – | A single piece under a quiet launch confirming a step: the fifth phase's single-piece rule lets it. GCAT gives two pieces of Kosmos-2528 a separation in December 2019; no other source. |

The misses, the 13 training headline targets of 35, are the tenth phase's, unchanged by any rule of this phase (`docs/detector/d10-confirmed.md` gives each one's cause): BEIDOU G5 R/B (one piece, judged for the payload), COSMOS 2442-44 ULLAGE MOTOR 33385 (its pieces named on its twin), COSMOS 2513 R/B (one piece in no plane the detector held), COSMOS 2447-2449 ULLAGE MOTOR 33473 (its twin named first by a step; confirmed at the launch on the second row), FREGAT DEB (TANK) (a fresh piece), COSMOS 2417-2419 ULLAGE MOTOR (one piece, judged for its twin), ORBCOMM FM16 (one piece at half a metre a second), COSMOS 2535 (one piece under a remembered cloud), GOSAT 2 DEBRIS and the H-IIA PES fairing cover (their pieces judged for the launch's payloads), COSMOS 2434-36 ULLAGE MOTOR (one piece, judged for its twin), the CZ-6A stage of Yunhai 3 (a stage breaking up a day after launch, the young launch's rule) and the H-IIA lower fairing panel of GCOM-W1 (twins no step tells apart). None of their parents had reentered by their pieces; none is a small batch the new rule refused; the stage preference would rename none.

## The frozen choice

Frozen at **2026-10-10T23:02Z**, before any odd year of an eleventh-phase replay was read: iteration 3, `confirmed-v9`, with the crewed and cargo craft's 295 launches (`visitingLaunches`, the rocket bodies judged), the truth as above, `reentryRefuses` on at `reentryAfterPiecesDays` 0, the small batches (`smallBatchMinPieces` 3, `smallBatchMaxPieces` 4, `smallBatchOriginShare` 0.75, `smallBatchOriginHours` 48, `smallBatchStepsToo` off), `attributionPrefersStage` off (`attributionPreferCentreRatio` 3), `attributionConvergenceNames` off, and every other value as the tenth phase left it. The committed replay is the sequential one of these defaults.

## The validation, read once

Read on 2026-10-10 at 23:28Z, after the committed replay (`npm run kpi -- --all`, `confirmed-v9`), whose training numbers are iteration 3's to the last confirmation. Nothing was changed after this reading.

| Split | Targets | Confirmed | Recall (95%) | False confirmations | False-alarm rate (95%) | Lead over the first agency statement, days: median (10th percentile) | Before it | Lag after the first fragment, days: median (90th) | Timing error, minutes: median (90th) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Training (even years 2006 to 2026) | 35 | 22 | 63% (46% to 77%) | 3 | 8% (3% to 22%) | 35.7 (−32.2) | 14 of 21 | 0.1 (5.9) | 1,126 (173,292) |
| Validation (odd years 2007 to 2025) | 23 | 17 | 74% (54% to 87%) | 9 | 31% (17% to 49%) | 41.7 (9.8) | 17 of 17 | 0.1 (4.0) | 41 (21,342) |
| To 2017 (from 2006) | 29 | 23 | 79% (62% to 90%) | 8 | 21% (11% to 36%) | 37.2 (−15.2) | 17 of 22 | 0.1 (0.1) | 583 (118,847) |
| From 2018 | 29 | 16 | 55% (38% to 72%) | 4 | 15% (6% to 32%) | 40.2 (−24.5) | 14 of 16 | 0.1 (17.2) | 73 (40,265) |

With the twins matched at the launch every split reads the same. Every agency statement the lead is measured against is dated to its month (NASA's quarterly news, its issue's first day), so the lead is the least it can have been.

The held-out false confirmations, nine (the tenth phase's twelve less three, all three removed by the reentry rule: Cosmos 2427, a Kobalt-M whose two solar panels were catalogued after its recovery, and the two attributions to Arabsat-4A, which had reentered in March 2006, of its Briz-M stage's pieces of 2007). By kind:

- three confirmations of a step alert by two to four pieces: Yaogan-26 in 2015 (four pieces GCAT calls the launch's own debris), Cosmos 2535 in October 2019 (two pieces, the event GCAT dates in August 2019 and the truth merges into NASA's of January 2020) and Meteor 1-5 in 2023 (four pieces GCAT dates to November 2023 as anomalous debris, not in the truth);
- one attribution of a small batch with a tight origin: the SL-8 stage of Cosmos 2251 in 2009, four pieces crossing it within half an hour (NASA's history lists the stage as not associated with the collision, GCAT gives every piece of the launch to the payload; no source for an event of the stage);
- five attributions of larger batches: the H-2A stage of IGS 3A in 2007 (nine pieces), Cosmos 1461 in 2009 (five pieces whose crossings spread over three weeks; GCAT gives them a separation in January 2009), Nimbus 2 twice, in 2011 and 2015 (five pieces each, crossings days apart; GCAT dates Nimbus 2 debris to April 2011, none to 2015), and the SL-12 auxiliary motor 37143 of 2010-041 in 2019, its twin 37144's pieces of 12 August 2019 named on it.

By class six on payloads and three on rocket bodies; six attributed with no step, three on a step.

The held-out misses, six, the tenth phase's: Arabsat 4's Briz-M (its pieces were judged for the payload, now refused as reentered, never for the stage), Cosmos 2139-41's ullage motor (a single piece), Cosmos 2464-66's ullage motor (one piece, under a remembered cloud; its twin was named, the false confirmation above), Cosmos 2424-26's ullage motor (one piece under the velocity floor, in a cataloguing batch), Cosmos 2499 (its pieces judged for its sibling 39764) and SSLV's third stage (its pieces judged for its payload). On the lines apart: 7 headline events with no fresh piece in the parent's plane within 180 days, 4 with no orbit of the parent before the event.

## The answer

**The target is not reached.** On the held-out years the Confirmed line confirms 74% of the headline breakups whose fragments were catalogued in the parent's plane (54% to 87%) at a false-alarm rate of 31% (17% to 49%); on the training years 63% at 8% (3% to 22%). The training split is under one false confirmation in ten for the first time, and the held-out one is not: neither recall interval reaches nine in ten, and the held-out false-alarm interval does not reach one in ten.

Against the tenth phase the held-out false confirmations fell from twelve to nine, all three by the reentry rule; the recall is unchanged (17 of 23), as on the training years (22 of 35). The truth's changes moved no held-out headline number: Yaogan-6 and Luch are training years' events, Cosmos 2251's stage (held-out) and the Breeze-M fragment (training) found no source, and the one held-out row they touch is Shenzhou-12's burst of 2021, a confidence-D row now exempt as a release. The crewed and cargo craft's exemption removed Shenzhou-14's training false confirmation and no held-out one. The small-batch rule removed LKW-4's on the training years and none on the held-out years, where the small batches left share a tight origin (Cosmos 2251's stage) or confirm a step.

What this phase's evidence says:

- **What is left is not separable by the rules tried.** The training split's three false confirmations and the held-out split's nine are a reported cloud's late pieces converging on one of its own fragments, twins the centre of the pieces named wrongly, single pieces and small batches confirming a step, and batches of five to nine pieces under old launches whose crossings spread over days; the misses are single pieces and twins. The rules that would reach them (the convergence over the centre, the small batches on the steps' confirmations, a launch margin of days, the stage preferred over its payload) each cost a training confirmation or added a false one.
- **The held-out false confirmations are half events the truth may miss.** GCAT's satellite catalogue gives a dated separation of debris to the parents of four of the nine held-out false confirmations, in the weeks to months before the verdict (Cosmos 1461 in January 2009, Nimbus 2 in April 2011, Meteor 1-5 in November 2023, Cosmos 2535 in August 2019, the last merged by the truth into NASA's later event), the kind of few-piece attribution the eighth phase chose not to enter. Entered as events, they would turn up to four of the nine into detections off the headline line, and the held-out rate would read about 17% (five false confirmations against twenty-four events confirmed); that is the owner's call on the truth's definition, not this phase's to make after reading the odd years, and nothing was entered.
