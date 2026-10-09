# Fitting the second phase of the detector

The second phase, `step-v2`, adds the object's own record and the impulse
a step implies to the parent-step channel of the first (`d1-fitting.md`),
and raises a persistent step as suspected only where the record does not
explain it. This note records what was swept on the training split for
the manoeuvre gate, what was seen, what was chosen and what it cost. The
validation split (the odd years) was not looked at while choosing; its
numbers are in `kpi/latest.md` and the README. The persistence gates of
the first phase were not re-fitted.

## The discipline

- The training split is the even years, 2006 to 2026; the validation
  split the odd years, 2005 to 2025; the chronological split (to 2017,
  from 2018) is reported beside them.
- From this phase the years are replayed in order and the states carried
  from each year into the next, since the verdict depends on the object's
  record over two years. A year replayed cold with sixty days of warm-up
  reads every object's first step of the year as unique: 2013 replayed
  alone that way raised 767 false alarms against 509 in the sequence.
  2005, the first year, has no record to start from, so its false alarms
  are those of a cold start, and it is a validation year.
- Every closed candidate's log row carries, beside the first phase's
  trajectory, the impulse the step implies and the object's history at
  it (`src/log.ts`), so the manoeuvre gate's thresholds are re-swept
  offline with `npm run kpi:sweep` without replaying. The history a row
  carries does not depend on the gate's thresholds, since every
  persistent step joins the record whatever verdict it got, so the
  re-classing is exact; the sweep's matching is the first phase's
  approximation of the scorecard.
- The gates were swept one at a time, the others at the detector's
  values, since the grid over all at once is too large to read.

## What the first phase's record showed before any sweep

Read from the first phase's year files with the full two-year record
each object would have had:

- Of its 174,098 false alarms, 168,805 were on payloads. 144,451 were on
  objects with another persistent step in the two years before; 29,647
  were the first step in two years, and of those 15,844 were on payloads
  under ninety days old (13,306 of them raises in low orbit: the first
  step of an orbit-raising campaign), 9,526 on payloads older than that
  (a lone manoeuvre on a satellite that seldom moves: 5,836 lowerings
  and 3,690 raises, 7,746 in low orbit and 1,332 geosynchronous), 3,761
  on rocket bodies, debris and unknown objects (2,254 of them under a
  month old: fresh stages venting and fragments whose fits were still
  settling).
- Of the fifty reported events the first phase detected or raised late,
  thirty-four were the parent's first step in two years. Of the sixteen
  with a record, Intelsat 33e had three fortnightly raises of 1.1 km
  before a 26.7 km lowering (23 times its past, opposite to every past
  step, the eccentricity change needing a radial kick), Hitomi two
  launch-day raises before a 2 km lowering, Cosmos 2499's second event
  the first event as its only past step and opposite in sign, the ullage
  motors and Orbcomm FM16 a lone small step before a step ten to
  twenty-four times larger. Cosmos 2421, an inspector satellite with
  twenty-one regular lowerings in the year before, broke up with a step
  of the same size and sign as its own; Cosmos 2535, with eight steps of
  both signs, moved by a third of its past median, the eccentricity
  change alone setting it apart; Starlink-34343, with the raises of its
  orbit-raising campaign and two smaller steps on its record, rose 13 km
  with a tangential impulse a campaign step would give, only its drag
  term (tenfold across the step) and a normal component of 2.7 m/s
  saying otherwise.

## The sweeps

Over the even years, the sequence replayed once with the initial values
(typicality 10, opposite from two past steps, consistency 25, no drag
term test, ninety days of youth). The columns are the sweep's: targets
hit on the headline line (43) and on every line (79), the false alarms
in all, and the false alarms by the test that raised them. The replay's
own counts differ from the sweep's by a few percent, as in the first
phase.

The size test `typicalityMax`, the step over the median of the object's
past steps:

| typicalityMax | headline hits | hits | false alarms | of which by size |
| --- | --- | --- | --- | --- |
| 3 | 18 | 23 | 31,549 | 9,233 |
| 5 | 18 | 23 | 27,981 | 5,281 |
| 10 | 18 | 23 | 25,531 | 2,598 |
| 20 | 16 | 21 | 24,427 | 1,385 |
| 50 | 16 | 21 | 23,830 | 721 |
| off | 16 | 21 | 23,225 | 0 |

10 is the knee: 20 loses Orbcomm FM16 (14 times its one past step) and
the Cosmos 2424 ullage motor (24 times). The test buys four hits for
2,600 false alarms.

The direction test `oppositeMinSteps`, the fewest past steps for a step
opposite to every one of them to be atypical:

| oppositeMinSteps | headline hits | hits | false alarms | of which by direction |
| --- | --- | --- | --- | --- |
| 1 | 18 | 23 | 29,719 | 9,567 |
| 2 | 18 | 23 | 25,531 | 4,649 |
| 3 | 17 | 22 | 23,054 | 1,750 |
| off | 17 | 22 | 21,651 | 0 |

With one past step the test reads an alternating pattern's second step
as its opposite and doubles its false alarms for no hit; with three it
loses Hitomi, whose two past steps were its launch day's raises. 2 is
taken. On the validation split the same choice keeps Cosmos 2499's
second event, whose one past step is its first event: that one is lost
to the direction test and caught by the next.

The geometry test `consistencyMin`, the chi-squared of the eccentricity
change beyond a single tangential impulse's reach:

| consistencyMin | headline hits | hits | false alarms | of which by geometry |
| --- | --- | --- | --- | --- |
| 4 | 18 | 23 | 30,466 | 14,527 |
| 9 | 18 | 23 | 28,340 | 12,461 |
| 25 | 18 | 23 | 25,531 | 9,713 |
| 100 | 18 | 23 | 22,080 | 6,350 |
| 400 | 16 | 21 | 19,292 | 3,641 |
| off | 15 | 20 | 15,479 | 0 |

100 is the last value losing nothing: 400 loses Cosmos 2535 (143) and
the Cosmos 2459 ullage motor of 2018 (168), and off loses the one of
2014 too (668). The test is the dearest: three headline hits for 6,600
false alarms, most of them on payloads whose eccentricity moved more
than one tangential burn allows, which a pair of burns half an orbit
apart or a low-thrust arc does without any radial kick. It is kept at
its knee because the target is recall and the three are headline
events; the owner may prefer it off, at the price of three events in
eleven training years.

The drag-term test `bstarRatioMax`, the factor by which the drag term may
change across a step on a manoeuvring object before the change is read
as evidence:

| bstarRatioMax | headline hits | hits | false alarms | of which by the drag term |
| --- | --- | --- | --- | --- |
| 2 | 20 | 26 | 50,806 | 25,275 |
| 3 | 19 | 25 | 45,859 | 20,328 |
| 5 | 19 | 25 | 41,257 | 15,726 |
| 10 | 18 | 23 | 36,696 | 11,165 |
| 20 | 18 | 23 | 33,180 | 7,649 |
| off | 18 | 23 | 25,531 | 0 |

The data say no. At 5 the test recovers Cosmos 2421 (8.1-fold) and
Starlink-34343 (9.8-fold, not a headline event) for 15,700 false alarms:
the catalogue's fit absorbs a manoeuvre into the drag term as readily as
a breakup, and on a satellite under continuous low thrust the term is
not a drag term at all. The test is left off (the bound beyond reach,
finite so the record keeps it); the override the two events would need
is not justified by what it costs, and neither is special-cased.

The age bound `newObjectDays`, under which a payload's first raise starts
a campaign rather than counting as unique:

| newObjectDays | headline hits | hits | false alarms | of which unique |
| --- | --- | --- | --- | --- |
| 0 (no rule) | 18 | 23 | 28,774 | 11,814 |
| 30 | 18 | 23 | 26,007 | 9,047 |
| 60 | 18 | 23 | 25,711 | 8,751 |
| 90 | 18 | 23 | 25,531 | 8,571 |
| 180 | 18 | 23 | 25,378 | 8,418 |
| 365 | 18 | 23 | 25,291 | 8,331 |

No hit changes: no reported breakup of a young payload was a raise a
tangential burn explains. Ninety days, the design's value, takes most of
what the rule gives; it stays a policy, not a fit.

Raising occasional steps (a past step within two years, on no pattern)
as well as unique ones: 27,769 more false alarms for one hit on a
non-headline line. The design stands.

## What was chosen

| Parameter | Value | Why |
| --- | --- | --- |
| `typicalityMax` | 10 | the knee: 20 loses Orbcomm FM16 and a Cosmos 2424 ullage motor |
| `oppositeMinSteps` | 2 | one doubles the test's false alarms for no hit; three loses Hitomi |
| `consistencyMin` | 100 | the last value losing nothing; 400 loses Cosmos 2535 and a Cosmos 2459 ullage motor |
| `bstarRatioMax` | off (a million) | two events for 15,700 false alarms |
| `newObjectDays` | 90 | policy; no hit moves with it |
| `historyDays`, `historyMaxSteps` | 730, 64 | policy |
| `stationKeepingMinSteps`, `regularityMax`, `alternationMin`, `monotoneShareMin` | 4, 0.75, 0.5, 0.8 | policy: the class names describe the record, the verdict is the same for the three manoeuvre classes |
| `disposalPerigeeDropKm`, `disposalRaiseLeoKm`, `disposalRaiseGeoKm` | 20, 50, 200 | policy, the sizes operators use |

## What the gate costs and what it keeps

With these values the sequence was replayed once more; the full tables
are in `kpi/latest.md`. On the training split the headline line reads 18
detected, 2 late and 23 missed of 43 (42%; the first phase read 15, 3
and 25), with 22,059 false alarms against 99,609: the record and the
margin together gained five events (the Cosmos 2022, 2447 and two Cosmos
2459 ullage motors and Beidou G2, every one by the five-day margin, two
of them also through the geometry and size tests) and the gate lost two.
On the validation split, replayed once after the values were fixed, the
headline line reads 11 detected, 2 late and 19 missed of 32 (34%; the
first phase read 12, 2 and 18), with 15,623 false alarms against 74,489:
842 per ten thousand body-years against 4,014. The false-alarm rate is
unchanged at 100% on every split, and the detection rate is a third
against the target's nine in ten.

What the gate cost, every one on a parent whose step its own record
explained:

- Cosmos 2421 (2008, training): twenty-one lowerings of about half a
  kilometre in the year before, every three weeks, and a breakup step of
  0.41 km the same way; its drag term rose 8.1-fold, the one signal that
  would have saved it, at the price shown above.
- Yaogan 1 (2010, training): one past step of 0.10 km twenty months
  before and a breakup step of 0.29 km the same way, three times its
  past, under the size bound.
- Cosmos 2499's second event (2023, validation): its one past step is
  its first breakup, two years before and opposite in sign; the
  direction test from two past steps, chosen on the training split,
  does not read it, and its geometry (83) sits under the bound.
- Meteor 3-5 R/B (2020, training): the first phase raised it late; its
  step, the perigee down 21 km with the apogee kept, has the shape of a
  disposal and is now a manoeuvre.
- On the other lines: WorldView 2 and Aqua (anomalous events on
  manoeuvring payloads, steps smaller than their own), Orbcomm FM 36
  (9.9 times its one past step, under the bound of 10), and
  Starlink-34343 (a 13 km raise on a satellite whose record is its
  orbit-raising campaign, read as one more campaign step; only its drag
  term, 9.8-fold, and a normal component of 2.7 m/s where its past
  raises had none say otherwise).

What the gate kept, on parents with a record: Hitomi (opposite to its
two launch-day raises), Intelsat 33e (23 times its three fortnightly
raises, opposite to them, and needing a radial kick), Orbcomm FM16 and
the Cosmos 2424 and 2447 ullage motors (fourteen, twenty-four and ten
times their one past step), Cosmos 2535 and the Cosmos 2459 ullage
motors (the eccentricity change beyond one tangential burn's reach),
Microsat-R (late, as before, ninety-two times its past). Every event the
first phase detected on a parent with no record is still detected: the
unique class raised thirty-four of the fifty events the first phase
raised, on time or late.

What the false alarms are now, on the validation split: 6,053 unique
steps (a first step in two years: 2,851 on payloads older than ninety
days, a lone manoeuvre on a satellite that seldom moves; 1,374 on
younger payloads, a lowering or a step with a radial kick on a satellite
being commissioned; 841 on rocket bodies and 952 on debris, most of them
under a month old, fresh stages and fragments whose fits were still
settling), 4,349 by the geometry test, 3,016 by the direction test and
2,204 by the size test; 13,548 of the 15,623 are on payloads, 973 on
rocket bodies, 1,062 on debris. The manoeuvre verdicts, which
the scorecard counts as nothing, number 58,049 on the validation split:
21,051 occasional, 18,537 campaign, 11,839 station-keeping and 6,622
disposal.

The whole Archive, 2005 to 2026, replays in 911 seconds of detector
time, about sixteen minutes with the states written, on the machine the
fit was made on, against about seventeen minutes for the first phase:
the record costs nothing measurable, and the sequence saves the warm-up.

## What is not read

- The node's precession is not read, so the normal component of the
  impulse is a lower bound from the inclination step alone: a normal
  burn away from the node moves the node more than the inclination. The
  node is kept wrapped in the ring and not fitted; a fourth fitted
  series would read it.
- The inclination and perigee series open no candidate of their own: a
  north-south station-keeping step that leaves the semi-major axis alone
  is not a step the detector sees, and so not one the record holds. The
  normal share of the record is therefore of the steps that also moved
  the axis.
- Nothing from hindsight: no end-of-life date, no operator's notice. The
  catalogue's class of the object is read in one place, a young
  payload's first raise, as the sweep of `newObjectDays` shows.
