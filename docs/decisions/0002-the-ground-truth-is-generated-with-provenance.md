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

## As built

The sources the build reads, as of the twelfth phase: NASA's history from
its text, GCAT's Space Debris Clouds from its table, GCAT's satellite
catalogue from its tab-separated file, the hand file, and the catalogue's
own bursts read from the Archive (`data/truth/catalogue.json`).

GCAT's satellite catalogue was added in the twelfth phase
(`docs/detector/d12-confirmed.md`) by the coordinator's decision under the
owner's delegation: the eleventh phase had found it dating debris for
parents of the detector's false confirmations, and entering those rows one
by one, after the held-out years had been read, would have chosen the
truth by the detector's errors. It is read instead uniformly, every
catalogued fragment and component with a parent and a separation date, in
every year, by a rule written in the parser and in `docs/truth.md` before
any re-scoring: pieces of one parent separated within three days of each
other are one separation, its kind the pieces' GCAT type (fragmentation
debris a breakup, anomalous debris an anomalous event, an aerodynamic
breakup aerodynamic, components and the rest a release), a release at
launch left out as the launch's own staging. Its statements join the other
sources' events by the build's thirty-day rule and stand only where no
other source states the event; an event it alone states is of confidence C,
or D where GCAT dates it to a year. The whole file is some twenty megabytes,
so the committed snapshot keeps the rows and columns read, every kept cell
verbatim, and the sources record holds the whole file's hash beside the
snapshot's, as it holds the PDF's beside the text of NASA's history. GCAT's
pages documenting the columns and codes are kept beside it.

It took the truth from 599 events to 2,433 (from 2005, 248 to 623, of them
363 scoreable). The events reported to the day or better by an authority,
the headline's, are unchanged; the hand row the eleventh phase had typed
from the same catalogue (Yaogan-6, 2014) is now the parser's and was
removed.
