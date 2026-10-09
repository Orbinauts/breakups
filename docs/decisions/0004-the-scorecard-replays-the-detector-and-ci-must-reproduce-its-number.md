---
status: accepted
date: 2026-10-09
---

# The scorecard replays the detector over the Archive and CI must reproduce its committed number

The scorecard feeds the detector every element set of every object in the
order the catalogue published them, in runs of four hours as the product
will, and matches what the detector raises against the ground truth. A
detection is an alert on the parent whose measured step brackets the
reported event and that was raised before the first fragment's element set
was published and before any notice; an alert after that is late; an alert
matching no reported event is a false alarm; an alert on an aerodynamic
breakup, a release or an unnamed report is exempt. Parents with no public
elements are listed apart and left out of the denominator. The headline
cells are the detection rate (the target is nine in ten) and the
false-alarm rate (the target is under one in ten), on years held out from
the ones the thresholds were fitted on: the odd years against the even,
then the reverse, both shown.

The aggregate is committed as a file the README's table is read from, and
CI recomputes it over the Archive and fails when a fresh run differs. That
is the engine's pattern (its Oracle fixtures) turned on a number: the
committed score is the record, and the proof is that anyone, CI first, can
make it again.

The reason for scoring the parent's step alone, and before the fragments
appear, is the owner's: the value of the tool is to say that something
broke up before the catalogue says so by listing the pieces. Confirmation
by pieces is scored separately, as how many detections were confirmed and
how many days later. The reason for held-out years is the size of the
truth: some hundred and fifty events over twenty-one years, forty or so
with a visible parent step, so every threshold fitted on all of them would
describe them rather than predict.

## Considered options

- Score either signal, the parent's step or a fragment burst: more events
  detected, but a burst of catalogued fragments is the catalogue's report,
  not a detection.
- Score only confirmed alerts: cleaner, but it hides what the product
  would show first.
- Score the parent's step, before the fragments, with confirmation apart
  (chosen).

## Consequences

- The library logs every candidate with every signal it computed, so the
  scorecard can sweep thresholds offline without replaying twenty years.
- The scorecard reads the first fragment's publication time from the
  Archive for each event, so "before the fragments" is measured, not
  assumed.
- A detector change lands with the regenerated score, or CI refuses it.

## As built

The scorecard as written keeps the rule above and fixes what it left
open:

- The targets are scored on five lines, never mixed: breakups reported to
  the day or better (confidence A and B), the headline; breakups reported
  to a month (C); breakups known only from their pieces (D); and anomalous
  events by the same two groups. A parent has public elements when it has
  at least five sets in the sixty days before the window.
- A step brackets an event when the bracket and the truth's window, each
  widened by a margin, overlap: a window a month wide can hold a step of
  a day, and an epoch is not an instant. The margin is per regime: a day
  in low and medium orbits, where sets come hours apart and an
  authority's instant is measured; five days in highly elliptical and
  geosynchronous orbits, where sets are days apart, the catalogue's fit
  settles on the new orbit over several of them, and the stated instant
  is itself inferred. The first phase of the detector raised the right
  object for the ullage motors of the Cosmos navigation launches and for
  Beidou G2, but the catalogue's step sat two to four days before the
  time NASA states (once thirty-three hours after), so the one-day
  margin scored every one of them as a miss and the whole highly
  elliptical line read nought. The owner may prefer the strict margin,
  or a look at those stated times; the margin is the scorecard's and
  changes no verdict.
- The catalogue's time is the first published set of the first body under
  the parent's launch numbered above the highest designated number a day
  before the window, read from the event's own year. A year stripped from
  a bundle has no publication times: its order is the bundle's, which is
  the catalogue's, and its clock is the latest epoch seen so far, a lower
  bound, leaping at most a day on any one set; the result says so.
- The years are replayed in order and the states carried from each into
  the next, since from the second phase the detector's verdict depends
  on the object's own record of steps over two years: a year replayed
  cold would raise every object's first step of the year as unique.
  `npm run kpi -- --all` replays the sequence and leaves each year's end
  states as a working file under `kpi/work/states/`; a year replayed
  alone starts from the file its predecessor's replay left, which gives
  the same result as the sequence, and where there is none from the
  previous year's last sixty days, in which case its file says so and
  its score is a check, not the record. The KPI workflow replays the
  years in order in one job for the same reason.
- The false-alarm rate divides by false alarms plus detections on every
  line, and a second alert on the same object whose bracket overlaps an
  earlier alert's is the same step raised again, a duplicate, since the
  unit the owner counts is the step.
- A year's file is written gzipped and is not committed. The detector
  raises every persistent step on every object as a verdict, a working
  payload's manoeuvres included (as `manoeuvre`, which the scorecard
  counts as nothing), so a year holds tens of thousands of verdicts and
  log rows: tens of megabytes as plain text, a few compressed, and
  eighty megabytes a run over the years, which the first phase committed
  once and which from the second phase stays out of git (`kpi/years/` is
  ignored): the KPI workflow carries the year files as artifacts of the
  run, and `npm run kpi -- --all` makes them again. Only the aggregate,
  `kpi/latest.json` and `kpi/latest.md`, is committed. The log keeps one
  row per candidate, written when it closes, with the step's trajectory
  over the first post sets, the impulse it implies and the object's
  history at it, which is what the offline sweeps re-threshold.
- A verdict of `manoeuvre` is terminal and counted as nothing: not an
  alert, not a false alarm. A reported breakup whose parent's step was
  read as a manoeuvre is a miss, which is what the detection rate must
  show.
