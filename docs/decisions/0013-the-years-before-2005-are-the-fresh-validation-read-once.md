---
status: accepted
date: 2026-10-21
---

# The years before 2005 are the fresh validation, read once and never fitted on

Every number the scorecard gives is read on years the detector was fitted
beside. The even years are the training split, the odd years the held-out
one; the held-out years have been read across twelve phases, and each
reading shaped the next phase's rules even where no threshold was fitted
on them, so they no longer validate the detector cleanly
([0008](0008-the-detector-is-tested-prospectively-from-a-frozen-tag.md)
started the live test for that reason, and it needs a year to say
anything). The truth reaches back to 1961 and the public catalogue's
element histories do too, but the Archive starts in 2005. The years before
2005 are the only data nobody has tuned on, and they hold more reported
breakups than the scored years do: of the scoreable events before 2005,
184 are breakups of confidence A or B with a catalogued parent, against
88 headline breakups in the scored years (issue #44, from the assessment
of 2026-10-13 that more untouched positives is the one lever left).

## The decision

- **The years 1995 to 2004 are a third split, the fresh validation**
  (`GLOSSARY.md`): read by the detector exactly once per truth, never
  joined to the even and odd scheme, never part of a fit. 1994 is their
  warm-up year, by the rule that makes 2005 the warm-up of 2006: the
  detector meets every object new in its first year with no record, so
  the first year is replayed and never scored. The decades before are out
  of this decision; a later slab is read by the same rule only if this one
  reads cleanly, and is decided then.
- **The rule is written before the replay, here.** The split is read with
  main's detector, pinned as the scorecard pins the engine and the
  propagators (`pins.json`), on the two lines every split carries: the
  Confirmed headline and the early warning. The first reading stays on
  the results page. A later detector's number on these years is marked
  as read after fitting, beside the first reading, never in its place:
  once the years have been read, no reading of them is fresh again.
- **The truth is read as built.** No curation pass before the reading: the
  rows of 1995 to 2004 are NASA's history's, GCAT's and ESA's as the build
  joins them, with few hand statements. A fix found after the reading
  comes from a source through the normal path
  ([0011](0011-reports-reach-the-truth-through-issues-the-owner-accepts.md))
  and is replayed like any change of the truth, never on the detector's
  own reading of the years
  ([0002](0002-the-ground-truth-is-generated-with-provenance.md)).
- **The scope lists reach back to the earliest replayed year, as scope, not
  as a rule change.** The detector ignores the launches of the crewed
  stations and of the visiting craft (`stationLaunches`,
  `visitingLaunches`), both read from the satellite catalogue's names for
  the craft in orbit since the Archive's first year. Mir was in orbit until
  2001, so the station list gains Mir and its modules (`src/stations.ts`:
  Mir, Kvant 1, Kvant 2, Kristall, Spektr, Priroda) and the visiting-craft
  list is generated from 1994 (`IN_ORBIT_FROM`), which adds Soyuz TM,
  the Shuttle flights STS 60 to 113 and the Progress M craft of those
  years; a station's own launch, where a Shuttle carried a module up
  (Unity, Destiny), stays the station rule's. Without them the detector
  would read every docking at Mir as a breakup of Mir and the reading
  would measure a gap in the lists, not the detector. No other parameter
  or rule changes, and none of the launches added has a body in orbit from
  2005 on, which the replay proves: every cell of `kpi/latest.json` for
  2005 to 2026 is unchanged by the pull request that adds them.
- **The years come from the catalogue's history class, on the epoch
  clock, within the owner's budget.** The catalogue's public folder of
  yearly bundles starts at 2005 (the owner checked on 2026-10-21), so the
  years are pulled a day of epochs at a time as the daily run pulls the
  current year, by a scheduled workflow (`backfill.yml`,
  `scripts/archive/backfill.ts`) that keeps its slices on a release of
  its own between runs and never asks for a day twice. The account also
  serves the site's Worker and the daily run, so the backfill makes at
  most a hundred requests an hour (`BACKFILL_SPACING_SECONDS`, one every
  thirty-six seconds), a third of the three hundred the catalogue allows,
  and at most the client's four hundred a run; it runs over as many days
  as that takes and is never sped up. The creation times the history
  class gives for sets of the 1990s are the catalogue's loads, not their
  publication, so the years are built with no creation column
  (`HistorySource.clock`), ordered and timed by their epoch as the bundle
  years are, which the scorecard already states where it reports latency.
  Each closed year is pulled once and kept, the catalogue's own guideline
  for the class. Nothing of the pull runs on the owner's machine.
- **The built years go to the Archive's release together, and the
  scorecard reads them only by this rule.** The daily run downloads every
  released year before the one it replays and refuses a gap between them,
  and the released catalogue index must describe every released year; so
  the backfill uploads the eleven years, the side files rebuilt from 1994
  and the index in one upload once every year is built, and until the
  scorecard carries the split, every script that chooses years leaves
  those below the scorecard's first out (`scoredYears`,
  `scripts/archive/years.ts`, the one place the years are named). The
  years enter the scorecard in a second pull request, with the split, its
  table on the results page and the first reading; the README's headline
  does not change with it. The backfill workflow and its release go with
  that pull request.

## Considered options

- Join the years to the even and odd scheme: it would spend the only
  untouched data on the next fit.
- A curation pass over the rows of 1995 to 2004 before the reading, with
  the detector's output at hand: the self-grading
  [0002](0002-the-ground-truth-is-generated-with-provenance.md) rules out.
- Every decade back to the 1960s at once: each decade back adds
  cataloguing lag, sparser sets and fewer drag terms, and the detector's
  rules were fitted on a catalogue that publishes sets daily; one decade
  first, read on a catalogue close to the one the rules know, and the
  rest only if it reads cleanly.
- Download the bundles by hand, as [0003](0003-the-archive-is-a-release-asset-never-in-git.md)
  has it: there are none before 2005.
- Pull the years on the owner's machine: the pull takes days at the budget,
  and the machine cannot stay on for them.
- Upload each year to the Archive's release as it is built: the daily run
  would fail on the gap between 1994 and 2005 the next morning.
- Keep the creation times as the clock: the catalogue loaded the old sets
  long after their epochs, in no order a replay could run on.
- A third split read once, kept apart, from the history class on the epoch
  clock, within the budget, uploaded together (chosen).

## Consequences

- The scorecard's cells, the results page and the README carry nothing new
  until the second pull request; the first changes the scope lists and the
  recorded parameters of `kpi/latest.json` alone, every cell the same.
- The years are named in one place, and a year the Archive holds below the
  scorecard's first is never scored by mistake; the truth's report, the
  pages, the regimes derivation and the visiting-craft generator read the
  same numbers.
- The backfill workflow runs twice a day in the daily run's concurrency
  group, at hours away from it, and a failed run opens an issue as the
  other workflows do; the ledger on its release says what the account was
  asked, and when.
- Once the years are in the Archive's release, the daily run and the KPI
  workflow download eleven small years more, and the weekly replay grows
  by about half once the split is scored.
