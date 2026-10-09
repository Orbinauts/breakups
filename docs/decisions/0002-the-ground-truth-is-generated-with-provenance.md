---
status: accepted
date: 2026-10-09
---

# The ground truth is generated from its sources, with provenance per field

The truth file, `data/breakups.json`, is built by a script from committed
snapshots of the machine-readable sources (the text of NASA's History of
On-Orbit Satellite Fragmentations, GCAT's Space Debris Clouds table) and
from a hand file of statements typed from the sources that have no
machine-readable form (NASA's quarterly news, a Space Forces notice, ESA's
annual report, named analysts, news reports, the catalogue itself). Each
event keeps every source's statement verbatim, resolves each field by a
fixed order of sources, records which source each field came from, lists
every disagreement, and names the reviewer's overrides it was built under.
The full history is kept; the scorecard runs from 2005, where the yearly
element bundles begin.

The reason is reviewability. A hand-typed list of three hundred rows is
reviewed once, by its typist; a generated one is reviewed on every
rebuild, as a diff of the file and of its report, and a parser that
misreads a form fails loudly on the snapshot rather than silently on one
row. Keeping every statement verbatim means a reader can check any number
against where it was read, and a disagreement between sources is a fact of
the file rather than a choice hidden in it.

What an event is follows the owner's definition: a breakup that was
reported, so we are sure it happened, where "reported" includes the public
catalogue listing new objects under the parent's launch even when no
agency wrote the event up.

## Considered options

- A hand-typed list, as the first attempt had: quick, and wrong in ways no
  one sees.
- Generated from the machine-readable sources alone: reproducible, but
  blind after NASA's 2022 cut-off and to everything only the news reports.
- Generated from snapshots plus a cited hand file plus named overrides
  (chosen).

## Consequences

- `data/breakups.json` and `docs/truth.md` are never edited by hand; a
  test rebuilds both from the inputs and fails on any difference.
- A new edition of a source is a new snapshot, fetched by one script,
  whose hash the sources record keeps, so the change is visible.
- Every date and time form the sources use is listed in the parser; a
  form not listed throws, so a new edition cannot slip a date past the
  build unread.
