# Fitting the sixth phase of the detector

The sixth phase, `fusion-v5`, takes up what the fifth left: on the held-out odd years every alert the parent-step channel raised was a false alarm (15,546 of 15,739), and most of them were manoeuvres on working satellites that the object's own record could not explain. This phase adds manoeuvre discrimination from outside the record, as evidence the fusion weighs (`judgeStep` in `src/fusion.ts`), each piece a named parameter logged on every candidate: a return to an altitude the object held (`src/maintenance.ts`), like steps by launch-mates and shell-mates, and a young object climbing towards its launch-mates (`src/siblings.ts`), the satellite catalogue's operational status (`opsStatus`), a lowering against a record of raises, and, read after the raising, the damage ratio. This note records what the first trial showed, what was swept on the training split, what was chosen, what each discriminator removed and cost, the result with the status switched off beside the result with it on, the separation of the signals the fusion does not use, and how far all of it gets against the owner's target. The validation split (the odd years) was not looked at while choosing; its numbers are read once below, after the values were fixed.

## The discipline

- The training split is the even years, 2006 to 2026; the validation split the odd years, 2005 to 2025; the chronological split (to 2017, from 2018) is reported beside them.
- Every close row of a persistent step carries the readings the fusion decides by: the envelope (how far the pre-step level had drifted below the highest altitude the object held in the last twelve months and above the lowest, and how many months had sets), the siblings (other objects of the launch, and of other launches in the shell, with a like step in the fortnight before), the mates (how many of the launch's other payloads have a known altitude, their median, and whether the step carries the object towards it), the status, how many of the past steps were raises, and the fusion's explanation and signature bits. None of these depends on the fusion's thresholds: every persistent step joins the record and the ledger whatever its verdict, and the envelope takes every set that opens no candidate. So `npm run kpi:sweep` re-applies `judgeStep` from the rows exactly, and the replay with the chosen values is the record.
- The whole Archive was replayed twice with every reading logged (`kpi/work/d6-trial`, `kpi/work/d6-trial2`, with `npm run kpi -- --all --out <dir>`), the sweeps read off the second, and the Archive replayed once more with the values chosen (the committed `kpi/`), and once with the status off (`npm run kpi -- --all --param opsStatusEvidence=false --out kpi/work/d6-status-off`).
- The operational status was carried into the Archive's body tables with `npm run archive:annotate`, from the satellite-catalogue snapshot of 2026-10-09, without rebuilding the columns.

## The status is today's: the hindsight, stated

CelesTrak's `OPS_STATUS_CODE` is the status of the snapshot, which is today's. A satellite nonoperational today may have been working in 2010; a satellite that broke up is very likely nonoperational today, because it broke up. Read off the fifth phase's year files, the validation split's detections and late alerts were on parents whose status today is nonoperational (9), decayed (3) or blank (7, every one a rocket body or debris), and none on a parent working today; its false alarms were on payloads working today (8,412), decayed (2,593), nonoperational (1,910), partially working (354), backup (95), spare (25) and extended (8), and on rocket bodies and debris (1,992). A test that reads "working today" as "could have burned" therefore separates the two with the answer partly written in: it costs no breakup because the broken satellites are the ones that stopped working. The detector reads it only in the two directions hindsight cannot fake most: a satellite working today was working at its step, and a satellite nonoperational today with no record of moving itself owes no manoeuvre explanation; a decayed status is read as nothing. The fifth decision record says the same, and the scorecard is reported both ways below. The live product reads today's status for today's steps, so the live false-alarm rate should lie between the two results, nearer the status-on one for recent years.

## What the first trial showed

The first design let any breakup signature override every manoeuvre explanation, and read maintenance as "the post-step level lands within a tolerance of some month's held range". Its trial (`kpi/work/d6-trial`) read 15,678 validation false alarms against 15,546 before: the explanations worked, the fusion did not. Two faults, both read off the training rows:

- The record's own signatures (the size, the direction, the geometry of the second phase) fired on 15,000 training steps of working payloads that the new explanations also explained, and overrode them. The training hits with an explanation beyond the record were all on parents nonoperational today or not payloads (Hitomi, Intelsat 33e, Orbcomm FM16, Cosmos 2535, the DMSP and NOAA satellites, the ullage motors), none on a working payload with siblings or a return to a held altitude. The record's signatures say a step is unlike the object's own past; they say nothing against evidence from outside it. The fusion now weighs them: the record's explanation is beaten by any signature, as before, but as many independent explanations as `independentOutweighs` says outweigh the record's signatures; the nonoperational signature is never outweighed.
- Maintenance as "lands inside a held range" explained a breakup's small step on any object that flew where it always flew, since a fifty-metre step stays inside its own month's range: the synthetic real-step and storm cases of the detector's tests failed on it. Maintenance is now a return to the extreme: the object had drifted below the highest altitude it held over the window by more than the tolerance, and the raise brings it back to within the tolerance of it (a lowering back to the lowest, likewise). A step that closed no gap is not maintenance, whatever it lands on.
- Deployment was read both ways; Hitomi's breakup lowering, forty days after launch, ran towards its launch-mates. An insertion orbit lies below the working one, so a deployment now climbs (policy).

## The sweeps on the training split

Over the even years, each gate swept with the others at the detector's values (the first sweep's defaults, before the last two choices below). The columns are the sweep's: targets hit on the headline line (43) and on every line (79), and the false alarms in all; the sweep's matching is the earlier phases' approximation of the scorecard.

| gate | value | headline hits | hits | false alarms |
| --- | --- | --- | --- | --- |
| `maintenanceToleranceSigmas` | 0, 1, 2, 3, 5, 10 | 19 | 25 | 4,993, 4,993, 4,991, 4,985, 4,972, 4,971 |
| `maintenanceToleranceKm` | off | 19 | 25 | 5,181 |
| `maintenanceToleranceKm` | 0 | 19 | 25 | 5,115 |
| `maintenanceToleranceKm` | 0.25 | 19 | 24 | 5,013 |
| `maintenanceToleranceKm` | 0.5 | 19 | 25 | 4,996 |
| `maintenanceToleranceKm` | 1 | 19 | 25 | 4,985 |
| `maintenanceToleranceKm` | 2 | 19 | 25 | 5,000 |
| `maintenanceToleranceKm` | 5 | 19 | 25 | 5,058 |
| `maintenanceLoweringsToo` | off, on | 19 | 25 | 5,078, 4,985 |
| `siblingsMin` | 1 | 17 | 23 | 4,478 |
| `siblingsMin` | 2 | 19 | 25 | 4,985 |
| `siblingsMin` | 3 | 19 | 25 | 5,268 |
| `siblingsMin` | 5 | 19 | 25 | 5,568 |
| `siblingsMin` | off | 19 | 25 | 6,615 |
| `deployAgeDays` | 0, 30, 90, 180 | 19 | 25 | 5,033, 5,016, 4,998, 4,985 |
| `deployAgeDays` | 365 | 18 | 24 | 4,976 |
| `opsStatusEvidence` | off | 18 | 24 | 9,208 |
| `opsStatusEvidence` | on | 19 | 25 | 4,985 |
| `nonoperationalOverrides` | off | 18 | 24 | 4,842 |
| `nonoperationalOverrides` | on | 19 | 25 | 4,985 |
| `againstDragMinRaises` | 0, 1 | 19 | 25 | 4,985, 4,985 |
| `againstDragMinRaises` | 2, off | 19 | 25 | 4,672 |
| `geometryKickMinMps` | 0 | 19 | 25 | 4,985 |
| `geometryKickMinMps` | 0.5, 1, 2 | 17 | 23 | 4,581, 4,503, 4,436 |
| `geometryKickMinMps` | 5, off | 16 | 22 | 4,367, 4,244 |
| `independentOutweighs` | 1 | 19 | 25 | 4,985 |
| `independentOutweighs` | 2 | 19 | 25 | 10,026 |
| `independentOutweighs` | 3 | 19 | 25 | 20,229 |
| `independentOutweighs` | never | 19 | 25 | 21,068 |
| `explanationsForNonPayloads` | off, on | 19 | 25 | 4,985, 4,720 |

What the table says:

- The maintenance tolerance hardly matters once the gap is required: the sigmas are flat, and the floor's knee is a kilometre, where a few hundred steps of satellites that drifted down for months and came back are explained and nothing is lost; a quarter of a kilometre loses a non-headline hit for nothing, five admits overshoots. Lowerings back to the bottom cost nothing and remove a hundred.
- One sibling is too few (two headline hits lost: a lone neighbour in a busy shell steps alike by chance); two is the knee; requiring more gives back false alarms for nothing.
- The deployment age is flat to half a year, where a year starts to lose a hit.
- The weighing is the decision that matters: with the record's signatures never outweighed the explanations change little (21,068); with one independent explanation outweighing them, 4,985, and no training hit moves. Two explanations already double the false alarms.
- The move against drag from one past raise (or none) costs 300 false alarms for no hit; from two raises the direction test of the second phase already reads it (a step opposite to every one of at least two past steps), which is why the two rows read alike. Off.
- A geometry kick floor cuts 400 to 700 false alarms for two headline hits (the Cosmos 2459 ullage motor and Cosmos 2535, radial components of 0.3 and 0.1 m/s): kept at zero.
- Reading the explanations on rocket bodies and debris too removes 265 training false alarms (fresh stages and pieces stepping with their launch's other bodies, and old stages back at a held altitude) for no training hit. Taken, with the cost on the validation split stated below.

## What was chosen

| Parameter | Value | Kind | Why |
| --- | --- | --- | --- |
| `maintenanceToleranceSigmas` | 3 | fitted | flat from 0 to 10 |
| `maintenanceToleranceKm` | 1 | fitted | the knee; a quarter loses a hit, five admits overshoots |
| `maintenanceMonths` | 12 | policy | the envelope's reach |
| `maintenanceLoweringsToo` | on | fitted | a hundred fewer, nothing lost |
| `siblingWindowDays`, `siblingSizeFactor` | 14, 2 | policy | a campaign's steps come within a fortnight at about one size |
| `siblingsMin` | 2 | fitted | one loses two headline hits |
| `siblingOrbitInclinationDeg`, `siblingOrbitAltitudeKm` | 0.1, 50 | policy | a shell's inclination and spacing |
| `deployAgeDays` | 180 | fitted | flat to half a year; a year loses a hit |
| `opsStatusEvidence` | on | policy | read with the hindsight stated, the scorecard run both ways |
| `nonoperationalOverrides` | on | fitted | one headline hit (DMSP 5D-2 F8) for 143 false alarms |
| `againstDragMinRaises` | off (a million) | fitted | from two raises the direction test reads it; from fewer it only costs |
| `geometryKickMinMps` | 0 | fitted | any floor loses two headline hits |
| `independentOutweighs` | 1 | fitted | from 21,068 to 4,985, no hit lost |
| `explanationsForNonPayloads` | on | fitted | 265 fewer, no training hit lost |
| `damageFromDays`, `damageToDays` | 14, 28 | policy | logged, not used: see the separation |

## What each discriminator removed and what it cost

Added one at a time from the fifth phase's fusion, cumulatively, re-applied from the second trial's rows (the sweep's approximation; the replays below are the record):

| step | training: headline hits of 43 | training: hits of 79 | training: false alarms | validation: headline hits of 32 | validation: hits of 61 | validation: false alarms |
| --- | --- | --- | --- | --- | --- | --- |
| the fifth phase's fusion | 19 | 25 | 22,091 | 12 | 19 | 15,506 |
| + maintenance | 18 | 24 | 21,840 | 12 | 19 | 15,293 |
| + siblings | 18 | 24 | 18,802 | 12 | 19 | 13,909 |
| + deployment | 18 | 24 | 18,786 | 12 | 19 | 13,889 |
| + one independent explanation outweighs the record's signatures | 18 | 24 | 8,443 | 12 | 19 | 8,558 |
| + the explanations read on non-payloads too (the status-off detector) | 18 | 24 | 8,187 | 12 | 18 | 8,241 |
| + the working status as an explanation | 18 | 24 | 4,272 | 12 | 18 | 4,623 |
| + the nonoperational status as a signature (the detector) | 19 | 25 | 4,415 | 12 | 18 | 4,735 |
| (the move against drag from one raise, not taken) | 19 | 25 | 4,720 | 12 | 18 | 5,104 |

The validation false alarms as the committed replay lands them, by the cause the earlier phases' notes used (`node --experimental-strip-types scripts/kpi/causes.ts kpi/work/d5-final kpi odd`): a step alone is one no manoeuvre explanation applied to; a signature is the first that overrode an explanation.

| cause | fifth phase | sixth phase, status on | sixth phase, status off |
| --- | --- | --- | --- |
| alone: payload older than 90 days | 2,851 | 968 | 1,437 |
| alone: payload younger than 90 days | 1,374 | 361 | 822 |
| alone: rocket body | 839 | 697 | 697 |
| alone: debris | 873 | 744 | 744 |
| alone: unknown class | 35 | 23 | 23 |
| size | 2,202 | 707 | 1,401 |
| direction | 3,016 | 322 | 894 |
| geometry | 4,348 | 823 | 2,253 |
| drag term | 8 | 0 | 0 |
| nonoperational | 0 | 112 | 0 |
| occasional on a non-payload | 0 | 7 | 7 |
| in all | 15,546 | 4,764 | 8,278 |

On the training split the same: 21,950 before, 4,455 after (alone: 1,047 older payloads, 224 young ones, 644 rocket bodies, 538 debris, 34 unknown; size 740, direction 298, geometry 776, nonoperational 144, occasional 10).

Of the 15,546 validation false alarms of the fifth phase, the committed replay closes 10,782 as manoeuvres and leaves 4,764 standing (the same steps, joined by object and the epoch of the first post set; none fell out otherwise). The explanations that applied to the ones removed, a step counting under every explanation it had: the working status 8,891, the record 7,715, siblings 6,086, maintenance 1,020, deployment 971. The largest groups: a direction false alarm explained by siblings and the working status (1,710), a geometry one by the working status alone (1,430) or with siblings (1,128), a size one by the working status alone (694), a lone step on an older payload explained by siblings and the working status (592) or by siblings alone (474). With the status off, 7,268 are removed.

What it cost, by the committed replays against the fifth phase's (`causes.ts`, the event rows):

- On the validation split, one target: GOSAT 2's rocket-body debris (anomalous, confidence C or D), detected before and missed now: its step had two like steps by other debris of its launch in the fortnight before, read as siblings because the explanations now apply to non-payloads. The signal that would save it: siblings among debris of one launch are a cloud settling, not a campaign; the siblings explanation could be held to payloads and rocket bodies, or to bodies older than the launch's last cloud. The training split did not show the case, so the parameter was taken.
- On the training split, none with the status on. With the status off, one headline target: DMSP 5D-2 F8 (2024), whose small lowering returned it to the lowest altitude it had held, read as maintenance; with the status on its nonoperational status overrides that. The signal that would save it without hindsight: maintenance is a satellite's habit, so a return to a held altitude could be required to come on a record with past make-up raises (a dead satellite drifting has none). Not swept in this phase.
- No headline detection on the validation split moved in either variant: 11 detected, 2 late, 19 missed of 32, as in the fifth phase.

## The result, the status on and off

| | fifth phase | sixth phase, status on (committed) | sixth phase, status off |
| --- | --- | --- | --- |
| validation headline (detected, late, missed of 32) | 11, 2, 19 | 11, 2, 19 | 11, 2, 19 |
| validation alerts | 15,739 | 4,908 | 8,422 |
| validation false alarms | 15,546 | 4,764 | 8,278 |
| validation false-alarm rate | 99.9% | 99.7% | 99.8% |
| validation false alarms per 10,000 body-years | 837.8 | 256.7 | 446.1 |
| training headline | 18, 4, 21 of 43 | 18, 4, 21 | 17, 4, 22 |
| training false alarms | 21,950 | 4,455 | 8,170 |
| to 2017: headline, false alarms | 16, 4, 24 of 44; 7,756 | 16, 4, 24; 5,001 | 16, 4, 24; 6,432 |
| from 2018: headline, false alarms | 13, 2, 16 of 31; 29,740 | 13, 2, 16; 4,218 | 12, 2, 17; 10,016 |
| every year: headline, false alarms | 29, 6, 40 of 75; 37,496 | 29, 6, 40; 9,219 | 28, 6, 41; 16,448 |

The years from 2018, when the constellations fill the shells at 500 to 600 kilometres, are where the siblings and the working status bite hardest: 29,740 false alarms become 4,218 (10,016 with the status off). The validation false alarms per year with the status on run 263 to 649 (866 in 2005, the cold start with no record), flat across the constellation years; with the status off they rise from about 450 a year before 2017 to 1,000 to 1,400 a year from 2018.

The precision at each persistence tier, validation (the third table of the README, with the status off beside it):

| tier | raised, on | detections before the catalogue, on | false alarms, on | precision, on | false alarms, off | precision, off |
| --- | --- | --- | --- | --- | --- | --- |
| 2 post sets over 18 h, or 3 (as raised) | 4,784 | 16 | 4,764 | 0.33% | 8,278 | 0.19% |
| 3 post sets | 4,248 | 16 | 4,228 | 0.38% | 7,727 | 0.21% |
| 5 post sets | 3,383 | 13 | 3,366 | 0.38% | 6,250 | 0.21% |
| 1 day | 3,789 | 13 | 3,772 | 0.34% | 6,969 | 0.19% |
| 3 days | 3,035 | 13 | 3,018 | 0.43% | 5,392 | 0.24% |
| 5 days | 2,607 | 11 | 2,590 | 0.42% | 4,614 | 0.24% |
| 7 days | 2,288 | 10 | 2,274 | 0.44% | 3,945 | 0.25% |

The confirmed line is unchanged on the validation split (14 confirmed alerts, 5 on a reported event's step, 3 on the right object late, 6 on nothing: precision 36% on the step, 57% on the object): the confirmations come from the pieces, and the manoeuvre verdicts the pieces promote are confirmed as before.

## The damage after the step, and the drag term

The alert reads the object's one-step-ahead residual scatter in the second to fourth week after the step against its short scatter before; the close row carries the drag term's ratio across the step. Their quartiles on the committed replay's detections and late alerts against its false alarms (`npm run kpi:sweep -- --separation`):

| signal | split | detections and late: n, quartiles | false alarms: n, quartiles | false alarms above the detections' median |
| --- | --- | --- | --- | --- |
| damage ratio | training | 8: 0.52, 0.63, 1.30 | 2,029: 0.50, 1.06, 2.62 | 68% |
| damage ratio | validation | 10: 0.69, 0.96, 1.09 | 1,917: 0.45, 1.11, 2.90 | 54% |
| drag-term ratio (folded above one) | training | 25: 1.26, 8.09, 73.3 | 2,790: 1.00, 1.37, 3.69 | 18% |
| drag-term ratio | validation | 17: 1.30, 11.0, 28.3 | 2,743: 1.00, 1.35, 4.63 | 18% |
| tracking cadence ratio | training | 23: 0.40, 0.96, 1.36 | 3,699: 0.56, 0.89, 1.30 | 45% |
| tracking cadence ratio | validation | 16: 0.63, 0.91, 1.07 | 3,539: 0.54, 0.91, 1.36 | 49% |

The damage ratio does not separate: the detections' scatter after the step is the same as before or lower (the parents of breakups are mostly dead satellites and stages, already scattering at their own level), and the false alarms' is wider both ways; it is logged and not used. The tracking cadence does not separate either. The drag term's ratio now does, on what is left: the remaining false alarms are steps whose drag term barely moved, the detections' moved eight to eleven-fold. As a gate it costs too much: requiring a two-fold change keeps 15 of 19 training headline hits and halves the false alarms to 2,871 (validation 8 of 12 and 3,210), and the steps with no drag term at all (geosynchronous objects) pass it untested. The training split does not justify it as a gate; as a signature against an explanation the second phase found it costs more than it buys. It is logged.

## The replay

The whole Archive replays in 1,180 seconds of detector time, twenty-one minutes with the states and the year files written, on the machine the fit was made on, against 1,315 seconds and twenty-three minutes for the fifth phase: the envelope, the ledger and the mates cost nothing measurable, and fewer alerts mean less tracking and event timing.

## How far it gets, plainly

The owner's target is fewer than one false alarm in ten alerts. With the status on, the validation split's false-alarm rate is 99.7% (4,764 false alarms against 16 detections on every line); with the status off, 99.8% (8,278). The discriminators removed seven false alarms in ten with the status on and nearly half with it off, at the cost of one non-headline detection; the false alarms per body-year fell by two thirds. The rate itself barely moves, because it is a ratio against sixteen detections: to reach one false alarm in ten with sixteen detections the validation split may hold at most one or two false alarms in eleven years, three thousand times fewer than now.

What stands, and what could still move it:

- 1,464 validation false alarms are steps alone on rocket bodies and debris (697 and 744, and 23 unknown): fresh stages venting and fragments whose fits are still settling, most under a month old, as the second phase found. No manoeuvre explanation can apply to them, since they do not manoeuvre; they are exactly where breakups happen. What could move them is a youth rule (no alert on a body in its first month, which the truth's events would have to be checked against: Cosmos 1703's rocket body was decades old, the GOSAT 2 debris was not) or the cloud's own confirmation.
- 1,329 are steps alone on payloads no explanation reached (968 older, 361 young): a satellite of no constellation, not back at a held altitude, with no status or an unknown one. The record-with-raises condition on maintenance above, and GCAT's dated payload end dates (contemporaneous, unlike the status), are the next inputs that could reach some of them.
- 1,852 are steps on payloads with an explanation only the record gave, overridden by the record's own signatures (size 707, direction 322, geometry 823), and 112 are dead satellites' lone steps.
- Even with every payload false alarm gone, the rocket bodies and debris alone would leave the rate above 98%.

So the measured answer is the fifth phase's, sharpened: the parent's step, with everything public about the object and its company, separates manoeuvres from breakups far better than the step alone (a third of the false alarms with the status, half without), but not by the three orders of magnitude the target needs. The Confirmed line (36% on the step, 57% on the object, on the validation split) remains the line whose precision can be shown, days after the step.
