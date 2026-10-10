---
status: accepted
date: 2026-10-10
---

# The scoped line is the point nearest the target, and the status is read as of the step

The owner's order for the seventh phase was that the false-alarm rate must
be under one in ten, and that the way to nine in ten detected and one in
ten false should be found by scoping: which orbits and objects are always
missed, what restricting to dead satellites, to low orbit or to anything
else does, each hypothesis tested. The study (`docs/detector/d7-scope.md`)
tested thirty scopes, each a predicate on the parent at the time of the
step applied alike to the reported events and to the alerts, and for each
swept the strict gates the log allows (the step's size in sigma and in
metres, the impulse along the track, the kick one tangential impulse
cannot explain, the drag term's change, whether a manoeuvre explanation
applied, and how long the step must hold) on the even years, read the odd
years once at the point chosen, and gave both with Wilson intervals.

No scope reaches the target on the training years at any point of the
grid, and none comes near: at every operating point that keeps a single
headline detection the false-alarm rate is at least one in two (three in
five among the scopes with enough targets to propose), and every point
that keeps a third of a scope's detections is above four in five. The reason is
in the arithmetic and the evidence: with two to five headline detections
a split in a scope, one in ten allows no false alarm at all, and the steps
left after the strictest gates are steps of the same size, the same kick
and the same persistence as the breakups' (geosynchronous relocations,
dead satellites whose drag term jumped a hundredfold, deep-space debris
with poor sets), which nothing in the parent's own data or its catalogue
entry separates.

So the scorecard carries a scoped line beside the whole-catalogue lines,
and the detector raises it as its own verdict (`scoped`), at the point the
study's pre-declared rule chose where the target is out of reach: the
point nearest the target on the training years, the larger of the two
shortfalls (recall under nine in ten, the false-alarm rate over one in
ten) the smallest, among scopes with at least eight headline targets on
each split, ties to the most training detections. That is the parents
launched five years or more before the step, a step of twenty sigma or
more whose along-track impulse is at least three centimetres a second,
whose eccentricity change one tangential impulse cannot explain
(chi-squared a hundred), whose drag term changed at least two-fold where
it was read, raised once it has held seven days. It cuts the false alarms
fifty-fold on the held-out years and detects about one in eight of the
headline breakups in its scope; its false-alarm rate is 84% on the
training years and 95% on the held-out ones. It is the owner's to keep,
to move along the frontier the study tabulates, or to drop.

The status the scope and the fusion read is now as of the step. The fifth
decision record read the satellite catalogue's status of today, with its
hindsight stated; this phase reads the date the payload fell silent from
GCAT's payload catalogue (its end of transmission, after which the owners
could not command it) and calls a payload dead at a step only where that
date lies more than thirty days before it, working only where it lies more
than thirty days after, and unknown in between, since the end of a
satellite that broke up is often the breakup itself. It is GCAT's end of
transmission rather than its end of operations, because a satellite past
its operations is still commanded while its owners dispose of it, and
the end of operations made those burns false alarms.

## Considered options

- Keep the whole catalogue alone and state that the target is out of
  reach: honest, but leaves the owner no operating point to take.
- A scope that excludes the events the parent cannot see (highly
  elliptical parents with a perigee under four hundred kilometres, low
  orbits under three hundred, the undetectable parents) and nothing else:
  measured, it moves the detection rate up a few points and the
  false-alarm rate not at all.
- The point with the lowest false-alarm rate that keeps one detection:
  overfitted to one event, and the held-out years do not confirm it.
- The point nearest the target by the larger shortfall, implemented as a
  parameter and scored beside the whole catalogue (chosen).
- Today's status kept, or the end of operations: the first carries the
  hindsight the fifth decision record states, the second turns disposal
  burns into false alarms; both are reported beside the chosen reading.

## Consequences

- `src/scope.ts` holds the predicate and the gates; `DETECTOR_PARAMETERS.scope`
  holds the policy, the gates and the tier, fitted, with the study as its
  provenance. Every persistent step's log row and verdict carry
  `scopeIn`, `scoped` and the parent's age from launch; a `scoped` verdict
  is raised once per step when its tier is reached.
- The element row carries `launchedMs`, `endedByMs` and `endedFromMs`;
  the Archive's body tables carry `launch` (as before), `endedOn` and
  `endedFrom`, written by `npm run archive:annotate` from the GCAT snapshot
  `npm run archive:gcat` fetches into the Archive's `gcat/`, which the
  side tarball now carries. The release assets lack these fields until the
  years are annotated and uploaded again, so the KPI workflow cannot
  reproduce the committed aggregate until a maintainer does both.
- The scorecard's scoped table states the headline events the scope leaves
  out, so the scoped line can never reach its rate by leaving events out
  unseen, and gives both rates with their Wilson intervals.
- The live product reads the status as of the step for a step today, which
  is the same as today's status: the backtest and the product now read the
  status the same way.
