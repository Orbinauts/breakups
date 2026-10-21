---
status: accepted; the years before 2005 pulled from the history class by a scheduled workflow, within a budget, amended on 2026-10-21 (issue #44)
date: 2026-10-09
---

# The backtest Archive is derived locally and published as release assets, never committed

The detector is backtested over the Archive: every catalogued object's
past element sets from 2005 to today, stripped to the fields the detector
reads (the six mean elements, the drag terms, the element set number, the
publication rank) and stored one year at a time as compressed typed-array
columns beside a table of the bodies. It is built on the owner's machine
from the public catalogue's yearly bundles of two-line sets, downloaded by
hand, and from the catalogue's history class for the current year; the
side data (space-weather indices, the satellite catalogue, GCAT's masses
and end dates) is fetched by scripts. The yearly files are published as
assets of a release of this repository, each under the two-gigabyte limit,
with a manifest of their hashes, and CI downloads the years it scores.
Neither the raw bundles nor the Archive ever enter git; the Archive's home
is a sibling directory of the checkout.

The reason is reproducibility against size. Ten years of stripped columns
are gigabytes, far past what a repository should carry, but a reader who
cannot run the scorecard over the same data cannot check the README's
number, and a CI that cannot either cannot keep it honest. Release assets
need no second account and no secret for a public repository; the download
step reads a base address and an optional authorisation header, so a
private store can replace the release without a code change if the owner
later prefers one.

The catalogue's operator grants blanket approval to redistribute basic
space-situational-awareness data with citation, and its user agreement
binds an account holder not to pass data to other entities without
approval. The stripped columns are the owner's derivative for the
project's own analysis; publishing them as assets with the citation the
grant asks for is the owner's call, recorded here, and the private-store
switch is the way back.

## Considered options

- Commit the Archive, or a sample of it, to the repository: a sample
  proves nothing about ten years, and the whole does not fit.
- A private bucket with a secret: the same mechanism, one more account to
  keep, and forks cannot run the score.
- Rebuild the Archive in CI from the bundles: the bundles are served by a
  browser application, not a URL, and take hours; a manual, cached build
  published once is the honest shape.
- Release assets with a manifest (chosen).

## Consequences

- The Archive's layout, columns and manifest are one module's, which the
  strip, the pull, the download and the scorecard all read through.
- Every request the tooling makes to the catalogue is ledgered and
  throttled, and a day once pulled is never pulled again.
- A year built from a bundle has publication order but no publication
  time; the scorecard says so where it reports latency.

## Amended on 2026-10-21: the years before 2005 come from the history class, pulled by a workflow

The fresh validation ([0013](0013-the-years-before-2005-are-the-fresh-validation-read-once.md))
wants the years 1994 to 2004, and the catalogue's public folder of yearly
bundles starts at 2005. Those years are pulled from the history class a
day of epochs at a time, as the current year is, by the scheduled workflow
`backfill.yml` (`scripts/archive/backfill.ts`), never on the owner's
machine: a run keeps its day slices on the release `backfill-data` and
goes on from them, so no day is asked for twice; it pulls at one request
every thirty-six seconds, a hundred an hour, a third of what the catalogue
allows, since the account also serves the site's Worker and the daily
run, and at most four hundred a run. A year is built once every day of it
is kept, on the epoch clock, since the creation times of 1990s sets are the
catalogue's loads; and the built years, the side files rebuilt from 1994
and the catalogue index are uploaded to the Archive's release together,
once every year is built, because the daily run refuses a gap between the
released years. The bundles stay the source for 2005 on, downloaded by
hand as above.
