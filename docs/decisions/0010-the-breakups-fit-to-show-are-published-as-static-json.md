---
status: accepted
date: 2026-10-11
---

# The breakups fit to show are published as static JSON on Pages

Orbinauts, the live satellite map this package is the detector of, will
stop detecting breakups itself and show the ones this project publishes.
The detector cannot run on the site's side: its state for the whole
catalogue is 137 MB gzipped, and the daily replay of the year takes six to
thirteen minutes. The daily job of the live test already runs that replay
([0008](0008-the-detector-is-tested-prospectively-from-a-frozen-tag.md)),
but kept only the alerts raised since the freeze and threw the year's
verdicts away. Nor can the site show every verdict: on the held-out years
99% of the early warnings are other orbit changes, and some confirmations
have no report for weeks. So every rule about what is fit to show lives
here, beside the truth and the scorecard that justify it, and the site
only reads the result, compares it with what it holds and displays what
is new. Issue #8 is the specification.

## The decision

- **The result is static JSON on this repository's GitHub Pages**, under
  `v1/`: `v1/breakups.json` (the list), `v1/breakups/<id>.json` (one
  breakup with its whole evidence, the ground-truth row it landed on and
  every verdict merged into it) and `v1/status.json` (the last run, the
  last day of sets read, the detector and the truth's sha256). Each file
  carries a `version`, and the package exports a type for each
  (`src/published.ts`), so a reader can check what it fetched. Every
  instant is an ISO string. A free API with no server, refreshed once a
  day. `docs/published.md` documents the files.
- **The verdicts are the frozen detector's** (`confirmed-v10`, the tag the
  live test runs), **checked against the truth on main as it stands that
  day**, not the tag's: a notice published since the freeze must still
  confirm a breakup. When a new detector is frozen, the files follow it.
  The live test's own log, score and checks stay as they were.
- **A verdict lands on a reported breakup as the scorecard lands it**
  (`scripts/kpi/match.ts`), never by a second matcher: only on a row whose
  parent is the verdict's object and whose kind is `breakup` or
  `anomalous`; a suspected verdict by its step bracket against the row's
  window, each widened by `MATCH_MARGIN_DAYS` for the row's regime; a
  confirmed one as `landConfirmed` lands it, raised from the window's
  start less that margin to 180 days after its end.
- **What counts as a report.** An agency notice is a dated statement from
  `AGENCY_SOURCES` no earlier than the event's first day; an outside report
  is a dated `news` or `analyst` statement. `gcat` and `catalogue` never
  count: GCAT's dates are vague, and the catalogue's new objects are the
  detector's own input. An undated statement neither confirms nor appears.
  Statements gain an optional `url`, typed into the truth's hand file,
  never parsed out of `ref`.
- **What is fit to show.** Confirmed: the detector confirmed it, or a
  suspected verdict lands on a row with an agency notice; a detector
  confirmation with no report yet is shown with none, since that is the
  detector's own news. Suspected: a suspected verdict lands on a row with
  an outside report. Nothing else, and not a confirmation `landConfirmed`
  marks exempt as a release on purpose.
- **One breakup, many verdicts.** Verdicts on one object whose steps
  overlap are one breakup; a verdict with no step joins the breakup of the
  row it lands on (the latest raised, where the row holds two whose steps
  do not overlap). `raisedAt` is the earliest verdict's, `confirmedAt` the
  earlier of the first confirmation and the first agency notice, the
  step, estimate, reasons and evidence the latest verdict's, and the `id`
  `<catalogue number>-<UTC day>`, fixed the first time it is published.
- **The row dates the breakup beside the detector** (issue #11). Each
  breakup carries `rowEvent`, the event as its landed row dates it (the
  row's instants, precision, the source its date was resolved from, and
  its id), or null where it landed on no row; `event` stays the
  detector's estimate. The id's day is the row's where the row dates the
  event to the second, minute, hour or day, else the estimate's, else the
  first raising's. A row is often finer than the detector: Luch
  (Olymp-K 1)'s is s2a systems' minute, 2026-01-30T06:09Z, two hours
  before the detector's window opens, since a geosynchronous object's
  sets are days apart. Any source may date the row, GCAT and the
  catalogue too, though neither counts as a report: the precision keeps
  out their vague dates, and `source` lets a reader tell a report from a
  catalogue's dating.
- **The list grows from 2025.** Each run merges into the list already
  published, so it does not empty on 1 January: a confirmed breakup stays
  for good, a suspected one leaves when its step's latest verdict expires
  or is dismissed. The frozen tag's own replay of 2025 from the end-of-2024
  states seeds it once; years before 2025 are out of scope.
- **The files live on an orphan branch, `published`**, never rewritten,
  whose history records what was public when. The daily job replays the
  year as before, runs `npm run published` on that replay with main's
  truth, commits `v1/` to `published`, and then calls the Pages workflow.
- **One Pages workflow, `docs.yml`, deploys the reference and `v1/`
  together**: the TypeDoc reference built from main at the site's root (no
  existing link moves) and `v1/` copied from `published` beside it, so
  neither wipes out the other. It runs on pushes to main and on the daily
  job's call (a push made with the workflow's token starts no workflow).
  Only its deploy job holds a concurrency group, with `pages: write` and
  `id-token: write`: a caller sharing a group with the workflow it calls
  would deadlock, and pushes to main would wait behind the replay.

## Two readings of the specification

- **An exempt confirmation.** `landConfirmed` also says `exempt` for a
  confirmation inside the window of a row naming a launch alone, which
  Intelsat 805's of 2026-08-20 is, yet the specification's expected list
  shows it. The specification defines exempt as a crewed station's launch,
  a crewed or cargo craft's launch other than its rocket body, or inside a
  release row's window, so only those drop a confirmation. Any other
  exempt landing counts as landing on no row: a breakup of its own, with
  no reports.
- **One `url`.** Where a reference cites two links, `url` is the first,
  the article the statement is dated from; the other stays in `ref`.

## Considered options

- **The site runs the detector**: refused for the state's size and the
  replay's time.
- **A server with an API**: a cost and a machine to keep running, for
  files that change once a day.
- **The files on main, or on the `prospective` branch**: main would carry
  a bot commit a day and start CI on each; the `prospective` branch is the
  live test's evidence, whose commits should say only what the test
  logged.
- **Release assets**: no stable address a browser can fetch from another
  site.
- **Every verdict published, the reader to choose**: the rules would then
  live in each reader, and the site would have to hold the truth to apply
  them.
- **Static files on Pages from an orphan branch** (chosen).

## Consequences

- The site needs nothing but an HTTP fetch, and the rules are tested
  where the truth and the scorecard are: `scripts/published/`, with
  regression tests on hand-built fixtures and the real 2025 and 2026
  replays (`test/fixtures/published/`), which must publish exactly the
  lists the specification expects.
- A suspected breakup is rare until the outside reports in the truth are
  kept current (issue #9). Since 2026-10-12 a daily watcher opens an issue
  for each new report it can read and a report the owner accepts reaches
  the truth the next morning, where the live test's runs leave room for
  the maintenance run the watcher starts, else on Monday's run
  ([0011](0011-reports-reach-the-truth-through-issues-the-owner-accepts.md)),
  and it is published by the next daily run after that.
- A change to the files' shape that breaks a reader is a new version, and
  the package's types say which. Adding `rowEvent` broke none, and the
  ids were re-keyed once under the new rule, by the first run that read
  files without it, before any reader existed; the version stayed 1.

## As built

The seed is the first commit of `published`: the tag's own run of 2025,
the year file `kpi/years/2025.json.gz` (detector `confirmed-v10`, carried
from the end-of-2024 states), landed on the truth with the catalogue's
identities from the Archive's 2025 body table. It publishes one breakup,
DMSP F-14 (24753), confirmed from its pieces with no report, as
`24753-2024-10-07`, re-keyed `24753-2024-12-19` once `rowEvent` dated it
by GCAT's row. On the 2026 replay of the same detector the selection
adds Luch/Olymp-K 1 (40258, with a news and an analyst report; first
`40258-2026-01-31`, re-keyed `40258-2026-01-30`), Intelsat
805 (25371, no report), Yaogan-50 02 (68196) and USA 32 (19460, its
suspected and confirmed verdicts one breakup, confirmed by the Space
Force notice), all confirmed, and Meteor 2-7 (12456) suspected on an
analyst's report of 2026-10-07 (Jim Shell's dating, as EarthSky and
LeoLabs reported it); none of the year's other suspected verdicts.

## Amended on 2026-10-12: a row naming a launch alone is a detection

The seventh decision record's amendment of this day scores a row naming
a launch and no catalogued parent on the Confirmed line by its launch
(issue #21), so `landConfirmed` no longer calls a confirmation inside such
a row's window exempt: it is a detection of the row. The first of the two
readings above therefore no longer arises for these rows. Intelsat 805's
confirmation of 2026-08-20 lands on the catalogue's burst under its
launch, `A:1998-037:2026-06-19`, and carries the row's dating; the
published parent stays the body the verdict names (its number,
designator and name from the catalogue), since the row names only the
launch.

## Amended on 2026-10-12: an unreported confirmation, and the nearest row

The seventh decision record's amendment of 2026-10-12 (issue #17) changed two readings the published files share with the scorecard:

- **An unreported confirmation.** A detector confirmation that lands on no row is the detector's own news, as before, and is shown with no report. It now has one name everywhere: unreported. The scorecard and the live test's score count it pending, neither true nor false, while it was raised less than 90 days before the truth's date (the latest day the ground truth knows of), and false once 90 days pass with no report. The published list keeps it after that, since a confirmed breakup stays for good and the site may already show it; its `reports` stay empty and its `row` null, so a reader can apply the same reading from `raisedAt`. The files' shape is unchanged. Dropping a confirmation from the list once it turns false is left to the owner: it would change "a confirmed breakup stays for good".
- **The nearest row.** A confirmation lands as `landConfirmed` lands it, now on the row of its object nearest the detector's instant of the event, else its raising, rather than the latest scoreable row in the window; and a confirmation inside a report naming no object, no launch and no regime lands as `unnamed`, which, like every landing other than a detection or a release on purpose, the selection publishes as a breakup on no row. Inside a report naming a regime, the confirmed object's regime is read by its last set before the raising, from the sets of the Archive the publishing run reads, as the scorecard reads it; exempt by the regime or not, such a confirmation is a breakup on no row.

## Amended on 2026-10-13: an ESA row the truth's build placed confirms nothing

The second decision record's amendment of this day (issues #19 and #20)
reads an ESA row that names no object, placed on an event by the truth
build's own rule, as no agency's word on the object. The published files
follow it: such a row is still listed among a breakup's `reports`, dated as
ESA's edition, but it no longer makes a breakup confirmed by an agency
notice (`isAgencyWord` in `src/truth.ts`, `firstNoticeOn` in
`scripts/published/select.ts`). A breakup with no other notice and no
confirmation by the detector is published suspected on it, as on a dated
outside report. The 2025 seed's list is unchanged: DMSP F-14 is confirmed by
the Space Forces' notice of the event's day.
