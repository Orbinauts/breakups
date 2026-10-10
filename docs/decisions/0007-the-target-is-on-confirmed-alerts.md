---
status: accepted
date: 2026-10-10
---

# The target is on Confirmed alerts

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
  the detector's bound of the parent's last set before the event. Events
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
