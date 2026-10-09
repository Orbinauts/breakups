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
  widened by a day, overlap: a window a month wide can hold a step of a
  day, and an epoch is not an instant.
- The catalogue's time is the first published set of the first body under
  the parent's launch numbered above the highest designated number a day
  before the window, read from the event's own year. A year stripped from
  a bundle has no publication times: its order is the bundle's, which is
  the catalogue's, and its clock is the latest epoch seen so far, a lower
  bound, leaping at most a day on any one set; the result says so.
- The states are warmed up from the previous year's last sixty days, the
  same whether a year is replayed alone or every year in a row, so a
  year's score never depends on how it was run.
- The false-alarm rate divides by false alarms plus detections on every
  line, and a second alert on the same object whose bracket overlaps an
  earlier alert's is the same step raised again, a duplicate, since the
  unit the owner counts is the step.
- A year's file is written gzipped. The first phase of the detector
  raises every persistent step on every object, a working payload's
  manoeuvres included, so a year holds tens of thousands of verdicts and
  log rows: tens of megabytes as plain text, a few compressed, and the
  files are committed with the aggregate. The log keeps one row per
  candidate, written when it closes, with the step's trajectory over the
  first post sets, which is what the offline sweeps re-threshold.
