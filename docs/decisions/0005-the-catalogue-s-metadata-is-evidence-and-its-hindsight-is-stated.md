---
status: accepted
date: 2026-10-10
---

# The catalogue's metadata is evidence the fusion weighs, and its hindsight is stated and measured

The parent-step channel could not tell a breakup from a manoeuvre at the
first sets from the element sets alone: after five phases every alert it
raised on the held-out years was a false alarm, and most of them were
lone manoeuvres on working satellites. The sixth phase adds what else is
public about the object and its company: where it flew in the last year
(a return to a held altitude is orbit maintenance), what its launch-mates
and shell-mates did the same fortnight (a campaign is many objects
stepping alike, a breakup is one alone), where its launch's other
payloads fly (a young object climbing towards them is deploying), and
what the satellite catalogue says the object is and whether it works
(a working satellite can burn, a nonoperational one owes no manoeuvre
explanation). The fusion weighs these as evidence, with the breakup
signatures (a step unlike the record, a radial kick, a lowering on a
record of nothing but raises, a dead object) overriding the manoeuvre
explanations, rather than as a stack of gates; every threshold is a
named parameter fitted on the training years and logged on every
candidate so the sweep re-applies the whole decision offline.

One of those inputs carries hindsight. The operational status is
CelesTrak's `OPS_STATUS_CODE` of the snapshot the Archive was annotated
from, which is the status today: a satellite nonoperational today may
have been working in 2010, and a satellite decayed today says nothing of
whether it worked then. A backtest that reads it is therefore not what a
live run of 2010 would have had. The status is read anyway, because the
live product has today's status for today's steps and that is what the
product will use; but the hindsight is stated in the fitting note and
here, the status is read only where it says the object works today (a
satellite working today was working at its step, which is the direction
hindsight cannot fake) or is nonoperational today and has no record of
moving itself (where the record, which is contemporaneous, says nothing
to contradict it), a decayed status is read as nothing, and the scorecard
is run both ways, with the status on and off, so the owner sees what it
buys and what the detector does without it. The class of the object
(payload, rocket body, debris) is the same snapshot's and changes little;
it was already read in one place and is now read in a second, to say
whether the maintenance, siblings and deployment explanations apply at
all, since a stage or a fragment does not maintain its orbit.

## Considered options

- Element sets alone, as the first five phases: the parent's data cannot
  separate a breakup from a manoeuvre at the first sets, measured.
- The metadata as hard gates (no alert on a working payload): simpler,
  but a working payload's breakup (Hitomi, Intelsat 33e) must still be
  raised, so the signatures must override.
- The metadata as evidence with the hindsight stated and the scorecard
  run both ways (chosen).
- A dated status history (when each satellite stopped working), which
  would remove the hindsight: not public in one place; GCAT's payload
  end dates are the nearest and are a later input.

## Consequences

- `ArchivedBody.opsStatus` carries the snapshot's code; `annotate.ts`
  rewrites every year's body table from the latest snapshot without
  rebuilding the columns, and the status rides on the element row as
  `opsStatus`.
- The Archive's release assets were built before the status was carried, so their body tables have no `opsStatus` and a replay of them reads every status as unknown, which is the status-off result. Until the years are annotated (`npm run archive:annotate`) and uploaded again (`npm run archive:upload`), the KPI workflow cannot reproduce the committed aggregate; a maintainer does both by hand.
- `kpi/latest.md` is the status-on result; the status-off replay is
  reported beside it in the sixth phase's fitting note and must be
  re-run with `--param opsStatusEvidence=false --out <dir>` when the
  detector changes.
- The hindsight bounds what the validation split proves: the false
  alarms removed by the working status are removed by a fact a live run
  of that year would have had for the satellites that still work and
  not for those that have since died, so the live rate will lie between
  the status-on and the status-off results.
