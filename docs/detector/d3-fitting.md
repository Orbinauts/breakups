# Fitting the third phase of the detector

The third phase, `fusion-v3`, adds the per-launch channel (`src/fragments.ts`), the fusion of a parent's step with what the catalogue lists under its launch (`src/fusion.ts`, `src/run.ts`), and the event's time from the two sets either side of the step (`src/event-time.ts`) to the parent-step channel of the first two phases (`d1-fitting.md`, `d2-fitting.md`). This note records what was swept on the training split for the fragments' thresholds and for the confirmation, what the two parent-side signals the owner asked about showed, what the persistence tiers cost, what was found of the highly elliptical line, what was chosen and what it cost. The validation split (the odd years) was not looked at while choosing; its numbers are in `kpi/latest.md` and the README.

## The discipline

- The training split is the even years, 2006 to 2026; the validation split the odd years, 2005 to 2025; the chronological split (to 2017, from 2018) is reported beside them.
- The years are replayed in order and the states carried from each into the next, as the second phase did. The whole Archive was replayed twice: once with the initial values, logging on every run the rows the sweeps read; once with the values chosen.
- The log gained two kinds of row. Every alert writes a row when it closes (`phase` 3) with the persistence tiers (whether the step still held after three and five post sets and after one, three, five and seven days, and when each tier was reached), the tracking cadence after the step against the month before, and the pieces it saw. Every launch writes a row in a run that brought it new bodies (`phase` 4) with the window's count, the background rate as read off the year before (unfloored), the Poisson tail, the pieces within plane distance one, three, five and ten of some parent, their classes, the cloud velocity and the Gabbard spread. So the burst's probability and floor, the plane bound, the velocity bound and the young-launch rule are re-thresholded offline with `npm run kpi:sweep -- --clouds`, and the tiers are read with `--tiers`, without replaying.
- The gates were swept one at a time, the others at the detector's values.

## The per-launch channel on the training split

The sweep lists a cloud where the window's count of new bodies above the catalogue's mark is at least two and its Poisson tail against the launch's own background (floored) is at or under the bound, at least one piece lies within the plane bound of some parent, and the cloud velocity reaches the bound; one listing per launch and thirty days. A listing is a hit where a scoreable reported event of the launch (any kind, any confidence, undetectable ones included) lies in the ninety days before it, and a false cloud otherwise; the training split has 97 such events with a launch. The false clouds are not all noise: the review list exists to hold unreported events, and the catalogue-derived rows of the truth (confidence D) are themselves bursts of this kind.

| gate | value | clouds listed | events hit (of 97) | false clouds |
| --- | --- | --- | --- | --- |
| `pBurst` | 1e-2 | 125 | 36 | 84 |
| `pBurst` | 1e-3 | 109 | 35 | 70 |
| `pBurst` | 1e-4 | 96 | 33 | 59 |
| `pBurst` | 1e-6 | 71 | 27 | 40 |
| `pBurst` | 1e-9 | 52 | 18 | 33 |
| `lambdaFloor` | 0.1 | 157 | 42 | 110 |
| `lambdaFloor` | 0.25 | 133 | 38 | 91 |
| `lambdaFloor` | 0.5 | 109 | 35 | 70 |
| `lambdaFloor` | 1 | 97 | 33 | 60 |
| `lambdaFloor` | 2 | 62 | 19 | 41 |
| `planeDistanceMax` | 1 | 88 | 30 | 55 |
| `planeDistanceMax` | 3 | 109 | 35 | 70 |
| `planeDistanceMax` | 5, 10 | 109 | 35 | 70 |
| `cloudOnlyDeltaVMinMps` | 0 | 138 | 37 | 97 |
| `cloudOnlyDeltaVMinMps` | 1 | 109 | 35 | 70 |
| `cloudOnlyDeltaVMinMps` | 2 | 101 | 31 | 66 |
| `cloudOnlyDeltaVMinMps` | 5 | 82 | 27 | 52 |
| young launch (under 30 days) needs 5 m/s whatever the class | off | 109 | 35 | 70 |
| young launch needs 5 m/s whatever the class | on | 104 | 35 | 65 |

The design's initial values sit at the knee of each: a tail of a thousandth, a floor of half a body per fortnight, a plane bound of three (five and ten add nothing, so the plane test is binding at three and the tolerances of 0.2 degrees in inclination and 1.5 degrees in node are not loosened), a velocity bound of a metre a second (zero admits deployments, two loses four events whose pieces move slowly: Meteor 2-5, Meteor 2-7 and Satcom 3 shedding at a metre or two a second, and Hitomi, whose pieces moved 1.5 metres a second from it). The young-launch rule as first written (a velocity of five metres a second *or* debris-classed pieces) let a launch's own platforms and covers, which the catalogue classes as debris, list clouds in its first weeks; requiring the velocity whatever the class drops five false clouds and no event, and is taken.

## The confirmation on the training split

The first replay confirmed alerts by any plane-consistent piece new by numbering and first published after the step. On the training split that confirmed 110 alerts, 8 of them on reported events and 102 false alarms (a further 113 wrong confirmations on the validation year 2005 came from a batch of thirty-three-year-old sets the 2005 bundle carries: a step between two 1972 epochs raised in April 2005 is "confirmed" by every body ever catalogued after 1972, so an alert is no longer opened on a step older than the time to live when it is raised). The wrong confirmations were of two kinds: launches under a month old whose own objects, classed as debris, came in the parent's plane (130 of 199 over every year); and old clouds still being catalogued (Fengyun 1C's launch gained pieces in its plane for years, and any later step on a body of that launch was confirmed by them). Rules tried on the training split's 110 confirmations:

| rule | kept | right (of 8) | wrong |
| --- | --- | --- | --- |
| as run | 110 | 8 | 102 |
| a young launch (under 30 days) needs 5 m/s whatever the class | 86 | 8 | 78 |
| a young launch never confirms | 35 | 8 | 27 |
| a burst is required (at least two above the mark, tail at or under a thousandth) | 56 | 4 | 52 |
| a burst, or no background (at most half a body per fortnight) and not young | 61 | 7 | 54 |
| no background and not young | 8 | 6 | 2 |
| background at most two bodies per fortnight, and not young | 12 | 7 | 5 |

The last is taken: `confirmBackgroundMax` 2, and no confirmation by pieces under a launch younger than `youngLaunchDays`. It loses one training confirmation, on the Briz-M tank of 2010 whose shedding the truth lists as aerodynamic (an exempt window, not a breakup) under a launch that had been shedding pieces at three a fortnight, and leaves five wrong confirmations in eleven training years. Requiring a burst would lose four: NOAA 11, NOAA 14 and Yaogan 19 R/B were confirmed by one to three pieces under launches that had gained nothing in a year, which is exactly where a single piece means something.

## The two parent-side signals

The owner asked whether the drag term's ratio across the step (`bstarRatio`, logged since the first phase) and the tracking cadence after the step (sets a day in the three days after against the month before, logged on every alert's row from this phase) separate breakups from the rest. On the training split's alerts (22 detections, 17,513 false alarms with a closed alert row):

- cadence ratio: the detections' median is 0.89 (tenth to ninetieth percentile 0.28 to 1.43; 3 of 22 at or above 1.5), the false alarms' median 0.97 (0.33 to 2.29; 23% at or above 1.5). A breakup is not re-observed more often in the catalogue's public sets: the detections sit inside the false alarms' distribution, and the signal is not used.
- drag-term ratio: the detections' median is 8.1 (63% beyond threefold either way), the false alarms' 6.1 (61%). The catalogue's fit absorbs a manoeuvre into the drag term as readily as a breakup, as the second phase's sweep found; not used.

The two gates the highly elliptical dissection suggested were swept on the training split's candidate rows (`npm run kpi:sweep`, default axes):

| gate | value | headline hits (of 43) | hits (of 79) | false alarms |
| --- | --- | --- | --- | --- |
| `occasionalRaisesNonPayload` | off | 18 | 23 | 22,081 |
| `occasionalRaisesNonPayload` | on | 18 | 23 | 22,583 |
| `persistOnMeanStep` | off | 18 | 23 | 22,081 |
| `persistOnMeanStep` | on | 18 | 23 | 26,923 |

Neither buys a training hit: raising occasional steps on the classes the catalogue does not call payloads costs 502 false alarms for nothing, and judging the persistence on the mean step at the post sets' centroid rather than the level at the first post set costs 4,800. Both stay off; the parameters are kept so the choice is recorded and can be re-swept.

## The persistence tiers

Every alert keeps reading the object's sets against the frozen pre-step model after it is raised, and the scorecard reads off its row whether the step still held at each tier and when the tier was reached. On the validation split (the odd years), with the detector raising as the second phase does (two post sets over eighteen hours, or three):

| tier | raised | detections still before the catalogue | false alarms | share of the detections kept | lead, hours: median (10th percentile) |
| --- | --- | --- | --- | --- | --- |
| as raised | 15,666 | 18 | 15,645 | 100% | 403 (141) |
| 3 post sets | 15,035 | 18 | 15,014 | 100% | 403 (141) |
| 5 post sets | 12,353 | 16 | 12,335 | 89% | 403 (141) |
| 1 day | 13,664 | 16 | 13,646 | 89% | 403 (141) |
| 3 days | 10,462 | 16 | 10,444 | 89% | 363 (115) |
| 5 days | 9,013 | 16 | 8,995 | 89% | 307 (69) |
| 7 days | 7,792 | 12 | 7,778 | 67% | 370 (17) |

The training split reads the same way (22,081 false alarms as raised, 8,771 after seven days, 24 detections falling to 8). The precision stays under a percent at every tier: a week of waiting halves the false alarms and loses a third of the detections, and the lead that the owner's clock allows (a median of seventeen days over the catalogue, a tenth percentile of six) is not what limits the trade. The false alarms that remain are persistent steps that hold for a week as a breakup's does: lone manoeuvres on satellites that seldom move, the second step of a young satellite the other way from its first, and manoeuvres whose eccentricity change one burn cannot explain, as the second phase counted them (on the validation split: 6,038 unique steps, 4,348 by the geometry test, 3,011 by the direction test, 2,192 by the size test). Waiting does not separate them from a breakup; only the pieces do, and the owner's definition scores the alert before the pieces.

## The highly elliptical line

The validation split's highly elliptical line read nought of thirteen in the second phase. Every target was read from its parent's own sets in the Archive, and the first replay of this phase logged the noise split of each candidate (the short scatter and the long memory):

- The parent did not move measurably: Cosmos 2224's ullage motor (2005; perigee at 200 kilometres, decaying a kilometre a day with the drag term wandering between 5e-4 and 1e-3, no step in the trend), the Kupon ullage motor (2007; the decay rate rises slightly over a week, nothing a set stands out from), Cosmos 2079's (2011; the decay rate doubled for five days with the drag term, a drift the drag prior allows, the first post set under two sigma), Cosmos 2456's (2019; a few tens of metres), Nimiq 6's Briz-M (2015; the first post set carried a 21.7 kilometre jump and was re-published at the same epoch with none, after which the stage sat 13 metres from where it was), and Cosmos 2424's (2019; the next set came ten days after the event, half a kilometre lower, within what drag could do in ten days). Six of the twelve; a limit of the data, which the fragments alone can see.
- No post sets: USA 288's Centaur (2019) had no set for five weeks after the event, the Cosmos 2464 ullage motor of 2017 none for three weeks after its one post set at 52 sigma, and Arabsat 4's Briz-M (2007) had its sets eight to seventeen days apart with the fit converging over them. The design's rule that one set cannot raise an alert is the owner's; these three are a limit of the data under it.
- Ramping fits: the Cosmos 2139 ullage motor (2009) stepped half a kilometre over six days with the drag term swinging between −1.2e-2 and 6.9e-3, the first post set carrying a tenth of the step; the Cosmos 2464 motor of 2019 the same (the first post set carried 74 metres of a kilometre, the perigee dropping 22 kilometres over ten days). The level at the first post set under-reads both (7.7 and 7.9 sigma against the gate's 10); the mean step at the centroid reads 11.3 for the first. That is what `persistOnMeanStep` was for, and the training split does not justify it (above). The scatter of the first, 62 metres against a long memory of 49, was its own ring's, not the memory's: an earlier drag-term episode had left large residuals in it.
- The object's record: Cosmos 2434's motor (2011) stepped 1.2 kilometres on 1 August (raised, eighteen days before the stated date, so a false alarm by the margin) and 3.9 kilometres on 16 August, which its record then classed as occasional, a manoeuvre; Cosmos 2139 (2009) had two such past steps, and Cosmos 2456 (2019) five. Ullage motors do not manoeuvre; their past "steps" are the catalogue's fit absorbing drag-term excursions. `occasionalRaisesNonPayload` was the remedy, and the training split does not justify it either (502 false alarms for no training hit).

So no bug was found on the line and no parameter could be changed on the training split's evidence; the line is a limit of the data for half its events and of the owner's two-set rule for a quarter, and the remaining quarter are ramping fits and the record gate, which the training split does not let this phase re-tune. The five-day margin of the second phase stands.

## What was chosen

| Parameter | Value | Why |
| --- | --- | --- |
| `pBurst` | 1e-3 | the knee of the cloud sweep |
| `lambdaFloor` | 0.5 | the knee; 0.25 lists 24 more clouds for 3 events |
| `planeInclinationToleranceDeg`, `planeNodeToleranceDeg`, `planeDistanceMax` | 0.2, 1.5, 3 | binding at three; five and ten add nothing |
| `cloudOnlyDeltaVMinMps` | 1 | zero admits deployments; two loses four slow clouds |
| `youngLaunchDays`, `youngLaunchDeltaVMps` | 30, 5, whatever the class | five false clouds for no event; the class alone let the launch's own objects through |
| `confirmBackgroundMax` | 2 bodies per fortnight | 7 of 8 training confirmations kept, 102 wrong ones cut to 5 |
| no confirmation under a young launch | policy from the sweep | 130 of 199 wrong confirmations were a launch's own objects |
| no alert on a step older than the time to live at its raising | policy from the evidence | 113 wrong confirmations in 2005 from a batch of 1972 epochs |
| `occasionalRaisesNonPayload`, `persistOnMeanStep` | off | no training hit gained |
| `alertTtlDays`, `cloudRepeatDays`, `burstWindowDays`, `burstBackgroundDays`, `planeMaxDays` | 30, 30, 14, 365, 180 | policy |
| `eventGridSeconds`, `eventLeadHours`, `eventSigmaPositionKm`, `eventMaxPoints` | 60, 6, 1, 4000 | physical and policy |

## What this phase gives, and what it costs

With the values chosen the sequence was replayed once more; the full tables are in `kpi/latest.md`, the README carries the validation ones. The parent-step channel's lines are the second phase's almost to the alert, as they must be: the fragments confirm, they do not detect. On the validation split the headline line reads 11 detected, 2 late and 19 missed of 32 (34%), with 15,645 false alarms (15,623 in the second phase; the difference is twenty-two manoeuvre verdicts the pieces promoted and the scorecard then counted, every one matching no reported event); on the training split 19 detected, 3 late and 21 missed of 43 (44%; 18, 2 and 23 before: one training event gained by the day-old candidate parents and the alert's longer reading), with 22,081 false alarms (22,059); the chronological split reads 16 of 44 to 2017 and 14 of 31 from 2018. The false-alarm rate is 100% on every split against the target of under 10%, and the detection rate a third against nine in ten.

What the fragments add:

- Confirmations. Over the twenty-two years 33 alerts were confirmed, 13 of them on reported events: Cosmos 1703 R/B (2006, 2.3 days after the alert, 22 pieces), Cosmos 2251 and Iridium 33 (2009, 4.0 days, 14 and 3 pieces), Cosmos 192 (2009, 10.5 days), NOAA 11 (2010, 7.3 days, an anomalous event), NOAA 14 (2012, late, 1 piece), Telkom 3's Briz-M (2012, late, 12 pieces), Hitomi (2016, 4.0 days, 9 pieces), the Cosmos 2464 ullage motor (2017, late), Yaogan 19 R/B (2018, 30 days), Microsat-R (2019, late, 42 pieces), Cosmos 2535 (2020, 3.5 days) and USA 32 (2026, 1.5 days, by its notice). On the validation split 5 of the 20 alerts on events (3 detections, 2 late) were confirmed, a median of 4.0 days after the alert; on the training split 8 of 27. The other alerts on events were not: their pieces came after the thirty days (the deep-space events' pieces are catalogued months later), or under a launch the rules now refuse (a cloud still being catalogued), or never (the Cosmos navigation launches' ullage motors, whose pieces the catalogue rarely lists).
- Wrongly confirmed: 20 alerts over the twenty-two years (14 on the validation split, 6 on the training), against 313 before the rules of this phase and 65 in the earlier attempt. They are alerts on bodies of a launch whose cloud began within the year (Fengyun 1C's launch in 2007 and 2016, Cosmos 2421's in 2008, Iridium 33's in 2011, the ISS's jettisoned objects in 2011, 2013 and 2019), where the background read off the year before had not yet risen, and single pieces under old quiet launches. A background read off the last two months as well would take the first kind; it was not fitted here.
- The review list: 90 clouds on the validation split and 73 on the training, 28 of them in 2005, the cold start (every launch is new to a detector that has just started; the first fortnight is held back, the first year's background is still empty); from 2013 on, a handful a year, nought in 2023 to 2025. Among them, the catalogue-derived events of the truth (Meteor 2-5, Meteor 2-7, Meteor 2-17, Resurs O1, Satcom 3, Cosmos 1275 and the rest of the Cosmos and Meteor clouds of the confidence D line), the Fengyun 1C cloud's batches of 2007, Cosmos 2251's and Iridium 33's of 2009 and 2011, Microsat-R's of 2019, and the analyst range's bursts of 2019 to 2026.
- The event's time: the median timing error of the validation detections falls from 1,086 minutes (the middle of the bracket) to 35 minutes, the tenth to ninetieth percentile 1 to 760; the three worst are the deep-space ullage motors, whose two sets are days apart and whose along-track drift is slow.

The whole Archive replays in 1,205 seconds of detector time, about twenty-two minutes with the states written, against 911 seconds and sixteen minutes for the second phase: the event timing (two propagations a minute of grid on every suspected step) and the alerts' longer reading cost a third more.
