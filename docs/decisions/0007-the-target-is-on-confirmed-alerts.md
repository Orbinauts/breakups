---
status: accepted; its target test amended on 2026-10-12 (issue #15)
date: 2026-10-10
---

# The target is on Confirmed alerts

Status note, 2026-10-12: the target test's plane is the scorecard's own,
no longer the detector's (issue #15). Read through the detector's plane
test, the denominator had two faults. At near-zero inclination the node is
undefined and pieces in the parent's plane scatter over the whole circle
of nodes, so none passed: Intelsat 33e (2024), at 0.02 degrees, had 18
fresh pieces, 16 of them with their orbit normal within half a degree of
the parent's, and was listed as "no fragments catalogued". And any tuning
of the detector's plane parameters moved the denominator the detector is
scored against. A piece is now in the parent's plane when it passes the
detector's test with the tolerances it had on 2026-10-12 (0.2 degrees of
inclination, 1.5 of node, distance 3), frozen as scorecard constants
(`FRAGMENTS_PLANE` in `scripts/kpi/catalogue.ts`), or when its orbit
normal lies within a degree of the parent's, the parent's node carried to
the piece's epoch for J2 as the plane test carries it. The test can only
add targets, and the replay on the scoring pins confirms that no event
stopped being one. Four became targets, all of them misses: Intelsat 33e
(2024, headline, training), Ariane 5 L540's ESC-A (2017) and L583's
(2019) on the C line, and Delta 229 (2007) on the anomalous C-D line. No
detection or false confirmation moved; the training headline reads 22 of
36 where it read 22 of 35, and the held-out headline is unchanged at 17
of 23.

The owner's targets were set on the parent's own orbit: nine reported
breakups in ten raised as an alert on the parent's step before the first
fragment's element set is published, and fewer than one alert in ten
matching no reported event. Four phases of work measured how near the
parent's data can come, and on 2026-10-10 the owner moved the target to
the Confirmed line. This record states the choice, the evidence it rests
on, the reading of it the scorecard implements, and what stays measured
beside it.

## The evidence

The fifth to eighth phases kept the parent-step channel's detection rules
and attacked its precision from every side the public data allow. On the
held-out years (the odd ones, breakups reported to the day) the channel
detects 11 of 32 headline breakups before the catalogue, with 2 late and
19 missed, a third; about a third of the reported breakups never move
their parent measurably, and a quarter have no parent set between the
event and the catalogue's first fragment. The fifth phase made the
confirmations precise (14 confirmed alerts from 43, precision 36% on the
step and 57% on the object) and froze the rules; the sixth weighed every
manoeuvre explanation the catalogue's metadata allows (held altitudes,
launch-mates and shell-mates, deployment climbs, the operational status)
and cut the held-out false alarms from 15,546 to 4,764 with no headline
detection lost, the seventh dated the status as of the step (3,155), but
the false-alarm rate stayed above 99% on every split.

The seventh phase swept thirty scopes, every combination of the strict
gates the log allows (44,100 points a scope) on the even years: no scope
reaches nine in ten at under one in ten, and every point that keeps one
headline detection is at least one in two false; the point nearest the
target detects 3 of 24 in its scope at 95% false alarms on the held-out
years. The eighth phase audited the false alarms against the owner's own
definition of a report (fragments published): none of the scoped line's
82 and about 1 in 300 of the whole catalogue's are events the truth
misses, which moves the rates by under a point. The remaining false
alarms are steps as large, as kicked and as lasting as the breakups' on
objects that never shed a catalogued piece. The parent's orbit before the
pieces cannot carry the owner's target (`docs/detector/d5-fitting.md` to
`d8-audit.md`).

## The decision

The nine in ten and one in ten move to Confirmed alerts. As stated to the
owner, who may correct it:

- A Confirmed alert is a breakup the detector attributes to a parent from
  fresh fragments in the parent's orbital plane, with or without a step
  seen first on the parent: the confirmation of an alert on the parent's
  step by its pieces, or the attribution of a cloud of fresh pieces to the
  one body of the launch whose plane they share and on which, propagated
  back, they converge. A confirmation by a notice alone is not one: the
  agency had said it.
- Recall is over the reported breakups whose launch gained fresh pieces in
  the parent's plane in the Archive: at least one body under the launch,
  numbered above the catalogue's mark at the event, classed as a fragment
  is, first published within 180 days after the event, its plane within
  the scorecard's own bound of the parent's last set before the event
  (amended on 2026-10-12, issue #15; the note above). Events
  with no such piece are listed apart, out of the denominator, with their
  count stated per line. A detection is the first confirmed verdict on the
  event's parent within 180 days after its window, wherever its year file
  is.
- Precision is over the confirmed verdicts: one matching no reported
  event is a false alarm, inside the same exempt windows as before; the
  false-alarm rate is over the confirmed events on every line. Both rates
  carry their Wilson 95% intervals, on both parity splits and on the
  chronological one, fitted on the even years and read once on the odd.
- The lead is measured against the first statement by an agency where the
  truth dates one: NASA's quarterly news (an issue dated to the first day
  of its month, the earliest it can have been public, from the reference
  documents of NASA's history or from the hand file), a U.S. Space
  Forces-Space notice (the day it was seen), ESA's report (its date). An
  analyst's dating and a company's or a newspaper's post are recorded in
  the truth with their source and not counted as an agency's. The lag after
  the first fresh piece's publication and the error of the detector's
  instant against the truth's are reported beside it.

The headline stays on breakups reported to the day or better; breakups to
the month, those known from the pieces alone and anomalous events are
scored on their own lines, as before.

## What stays measured

The parent-step lines (the whole catalogue's and the scoped one), the
precision per persistence tier and the step alerts' confirmations stay in
the scorecard and the README as secondary measurements, below the
Confirmed line: they say how early a breakup can be suspected from the
parent's orbit, at what precision, and they are what a Confirmed alert's
lead over the catalogue rests on where a step was seen first. The rules of
the fourth decision record (the replay, the parity split, the committed
number CI must make again) apply to the Confirmed line as they do to the
others.

## Consequences

- The detector gains the Confirmed channel (`judgeLaunches` and
  `attributeCloud` in `src/run.ts`): fresh pieces in the plane of a body
  with no open alert are attributed to it under the fifth phase's
  confirmation rules and the attribution's own (the launch's age, its
  backlog, the fewest pieces, the pieces' convergence on the parent and
  against the other bodies whose plane they share), and the verdict is
  `confirmed` with no step, its event the back-propagated crossing
  (`eventFromPieces` in `src/event-time.ts`) with its sigma.
- The truth carries, for every statement, when it can first have been
  public, and for every event its first statement (`docs/truth.md` counts
  them by source).
- The README's first table is the Confirmed line; `docs/detector/events.md`
  says, per event, whether it was confirmed and why not.
- The fitting of the channel's thresholds is recorded in
  `docs/detector/d9-confirmed.md`, every iteration's training numbers
  with it.

## As built in the tenth phase

The ninth phase's held-out reading carried two faults of method rather
than of the detector, and the coordinator decided both before the tenth
phase fitted anything:

- **2005 is the warm-up year.** The Archive starts in 2005, and in its
  first year the detector meets every object and every launch new: no
  record of steps, no background of new bodies, no cloud remembered.
  Twelve of the ninth phase's thirty-one held-out false confirmations
  were in 2005. In use the detector would have that history, so the
  replay runs 2005 and every line and split scores from 2006
  (`SCORED_FROM_YEAR` in `scripts/kpi/kpi.ts`); the per-event dissection
  still lists 2005's events, marked as the warm-up's, and leaves them out
  of its totals.
- **A crewed station's launch is exempt from confirmation and from false
  confirmations.** What a station sheds (tools, covers, tanks, bags) is
  released on purpose and catalogued as debris under its launch, and the
  truth already exempts the station's bursts as releases. The detector
  confirms and attributes nothing under a station's launch
  (`stationLaunches` in `src/params.ts`, a refusal of its own on the
  attribution row), and the scorecard lands any confirmed verdict under
  one as exempt (`STATION_LAUNCHES` in `scripts/kpi/match.ts`, read from
  the detector's default list so a trial replay cannot change the
  scoring). The list is the stations in orbit since 2005 the satellite
  catalogue names: the International Space Station by the launches of its
  own designators (Zarya 1998-067, Unity 1998-069, Zvezda 2000-037,
  Destiny 2001-006, Poisk 2009-060, Nauka 2021-066), Tiangong-1
  (2011-053), Tiangong-2 (2016-057) and the Chinese station's Tianhe
  (2021-035), Wentian (2022-085) and Mengtian (2022-143). Mir and the
  Salyuts reentered before 2005.

And the owner called a third: **twins at the launch's level, reported
separately.** Where the pieces cannot tell two bodies of one launch
apart (a body of the same plane whose offset from the pieces' centre and
whose miss when propagated back are both within the attribution's ratios
of the named body's), the detector names the launch and every such body
as the verdict's candidates (`attributionTwins`, `Verdict.candidates`),
the body a persistent step picks first. Twins nothing tells apart are
still refused and left for review (`attributionTwinsUnresolved`, off as
fitted): on the training years, raising them named the launch of a
reported event twice in nineteen verdicts. The scorecard
reads such a verdict two ways (`matchTwinsAtLaunch` in
`scripts/kpi/match.ts`): off, it is matched on the body it names first,
as any verdict; on, it is a detection where a reported event's parent is
among the candidates, and a false confirmation where none has one. The
headline is read off; the reading on is the second row of the README's
first table, so the owner chooses.

The tenth phase also built the common-origin test the coordinator
proposed (`docs/detector/d10-confirmed.md`): each piece's crossing of
the parent, propagated back, and how closely the pieces share an instant.
As a gate it costs half the training confirmations at every bound tried,
so it is off; it is used as an override (pieces made at one instant are
not an old cloud's, so the launch's remembered cloud, backlog and
cataloguing batch do not refuse them), as a launch margin (pieces whose
common instant is the launch itself are its own objects catalogued late)
and for the event's instant.

## As built in the eleventh phase

The owner delegated two calls before the eleventh phase fitted anything, and both were taken as decided (`docs/detector/d11-confirmed.md`):

- **The crewed spacecraft and the stations' cargo craft are exempt as the stations are.** What such a craft leaves in orbit (an orbital module and its covers, a trunk, lost tools, jettisoned items) is released on purpose. The list is generated from the satellite catalogue's names (`npm run archive:visiting`, `src/visiting.ts`): 295 launches of Soyuz, Shenzhou, the Space Shuttle, the crewed Dragons, Starliner, Progress, Tianzhou, the cargo Dragons, Cygnus, HTV and the ATV in orbit since 2005. The detector confirms and attributes nothing under them (`visitingLaunches`) and the scorecard lands a confirmed verdict under one as exempt (`VISITING_LAUNCHES` in `scripts/kpi/match.ts`), except on the launch's rocket body, an ordinary stage whose breakups the truth holds (Progress M-27M's, 2015). The truth exempts the catalogue's bursts under these launches as releases, as it does the station's; an agency's own report of a craft's debris stays scoreable.
- **A false confirmation whose pieces share a tight common origin enters the truth only with an independent source**, never on the detector's own evidence. Of the three named, Yaogan-6's (2014) has one, GCAT's satellite catalogue, and entered as an anomalous event of confidence C; the Breeze-M fragment's (2012) and Cosmos 2251's stage's (2009) have none, the sources giving their pieces to other events, and stay false. Luch (Olymp-K 1)'s breakup of 2026, reported with an instant, entered beside them.

The phase also added two physical rules to the Confirmed channel, fitted on the even years: pieces first seen after their parent reentered confirm nothing (`reentryRefuses`; the caller passes the catalogue's decay days, read only from their day on), and an attribution of three or four pieces needs three quarters of them crossing the parent within two days of their median (`smallBatchOriginHours`). The stage preferred over its payload and the pieces' convergence preferred over their centre were built, tried and left off as fitted. On the held-out years, read once after the freeze, the line confirms 17 of 23 headline breakups (74%) at 9 false confirmations (31%); on the training years 22 of 35 at 3 (8%).

## As built in the twelfth phase

The eleventh phase found GCAT's satellite catalogue dating a separation of debris from the parents of four of its nine held-out false confirmations. The coordinator decided, under the owner's delegation, not to enter those one by one, since choosing the truth's rows by the detector's held-out errors grades it by selection, and to read the catalogue as a source of the truth uniformly instead: every catalogued fragment and component with a parent and a separation date, in every year, by a rule written before any re-scoring (`docs/detector/d12-confirmed.md`, the second decision record's "As built"). The headline's events are unchanged; the lines apart gain 192 scoreable events from 2005.

The same decision named one detector change to try on the training years alone: a launch's rocket body named over a payload operating at the time, where the pieces cannot tell them apart (`attributionPrefersStageOverWorking`). It changed no training confirmation and was kept by the criterion set before the look (training not worse), on its prior; it changed no held-out confirmation either.

The held-out years were read in the eleventh phase, so the twelfth phase's reading of them is a measurement under the extended truth and not a fresh blind validation. On them the line confirms 17 of 23 headline breakups (74%) at 6 false confirmations (21%, 10% to 38%), three fewer than the eleventh phase, all three now confirmations of separations GCAT dates; on the training years 22 of 35 (63%) at 2 (6%, 2% to 18%). Neither split reaches nine in ten at under one in ten.
