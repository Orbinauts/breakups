---
status: accepted
date: 2026-10-09
---

# A standalone package that owns its truth, its backtest and its score

`@orbinauts/breakups` is a library of its own, not a package inside the
product's monorepo: it detects on-orbit breakups from public element
histories, and the repository that ships it also holds the ground truth it
is scored against, the tooling that builds the backtest Archive, the
scorecard that computes the KPIs, and the CI that runs them. The product
imports the package afterwards, as it imports the engine.

The reason is what the package promises. Its value is a number, detect at
least nine reported breakups in ten and raise fewer than one false alarm in
ten, and a number is only worth stating where the thing that measures it
lives beside the thing measured, is run by the same CI, and is open to
whoever reads the README. A detector tuned inside a product, against truth
and data the product keeps to itself, has no such number to show.

A first rule lived inside the product. Backtested over ten years it caught
seven of seventy-one reported events and raised fourteen hundred false
alarms. This project starts again from scratch; that attempt's analysis of
its false alarms is kept as evidence of what noise looks like, and nothing
of its design carries over.

## Considered options

- A package inside the product's monorepo, scored by scripts there: the
  product's data and conventions at hand, but the score private and the
  package never standalone, so every release would be a copy.
- A standalone library with the truth and the score kept elsewhere: the
  library is portable but its number is not reproducible by a reader.
- A standalone package that owns the truth, the Archive tooling, the
  scorecard and the CI (chosen).

## Consequences

- The library stays pure, as the engine is: it takes element sets and the
  public side data the caller hands it and answers verdicts; it never
  fetches, stores or reads the environment. A test walks every import.
- The repository carries tooling that does fetch, under `scripts/`, held
  to its own folder by the same test.
- Everything needed to reproduce the KPI is public or published: the
  truth is in the repository, the Archive is a release asset, the
  scorecard is a script.
