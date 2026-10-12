---
status: accepted
date: 2026-10-11
---

# The detector is tested prospectively from a frozen tag

Every number the scorecard gives is a backtest: twenty years of the
Archive replayed through a detector whose rules were fitted on half of
them and read on the other half, the held-out half read more than once by
the eleventh and twelfth phases. A backtest cannot show what the detector
does on days nobody had seen when its rules were chosen. On 2026-10-11 the
owner approved a prospective test, run as a scheduled job: the detector
`confirmed-v10` is frozen, and every alert it raises on the catalogue's
sets from then on is logged where its time of logging cannot be changed.

## The decision

- **The frozen detector is a tag, run from its own worktree.** The tag
  `frozen-confirmed-v10` is the commit the detector `confirmed-v10` was
  scored at (`8729987`). A worktree beside the repository,
  `../breakups-frozen`, is checked out at it with the runtime dependencies
  at the versions the test began with (`@orbinauts/engine` 0.1.2,
  `satellite.js` 7.1.0, `astronomy-engine` 2.1.19), committed on main as
  the `frozenDetector` pins of `pins.json`, apart from main's scoring pins,
  so that moving those never moves these (no lockfile is committed), and
  the daily job runs the replay only there, refusing to run when the
  worktree is not the tag or has a change. Work on main never changes
  what is being tested; the test's
  detector, its truth (whose notices it reads as of each run) and its
  scorecard code are the tag's.
- **The data are main's.** The job runs `npm run prospective` on main.
  Main's scripts pull the current year from the catalogue's history class
  (the days not yet kept, and again each day kept before it settled, two
  to four requests a day, throttled and written to the ledger
  `requests.log`), fetch the satellite catalogue and the space weather at
  most once a day, and annotate the year's body table with that day's
  satellite catalogue and the payload catalogue the Archive holds. The
  Archive's format is shared, so a change to it on main must stay
  readable by the tag. (Corrected 2026-10-12: this record said "the latest
  satellite and payload catalogues". GCAT's payload catalogue, which gives
  the end-of-transmission dates, is not fetched by the daily run, nor by
  the weekly maintenance; it is the snapshot in the Archive's side files,
  which changes only when a person runs `npm run archive:gcat` and uploads
  the side files. The run's inputs were left as they were, so the test
  keeps reading what it has read since it began.)
- **The frozen replay reads a view of the Archive with an index of its
  own.** The scorecard reads every year's catalogue through the catalogue
  index and refuses a stale one or one built for another truth, and the
  daily pull rebuilds the current year. The job keeps
  `<archive>/prospective/view`, a link to every entry of the Archive but
  its index, with an index the frozen code builds from the frozen truth
  each day (half a minute), so the index main builds and the one the test
  reads never displace each other. This is the one departure from "the
  same Archive": every year, column and snapshot is the same file, and only
  the index is the test's own.
- **The year is replayed whole each day from the frozen states.** The
  replay of the current year starts from the states the frozen detector
  ended the previous year with, kept under `<archive>/prospective/states/`
  (2025's from the full sequential replay that made the tag's committed
  scorecard), and writes into a scratch directory under the Archive, never
  into `kpi/`. In the first days of a year the previous year is pulled and
  replayed too until its last days have settled; its end states then
  become the new year's start.
- **The alerts are logged on an orphan branch, and the commit is the
  proof.** Every verdict in the states `suspected`, `scoped` and
  `confirmed`, and every cloud verdict (the review rows), raised after
  2026-10-11T00:00Z, is appended with its whole evidence to `alerts.jsonl`
  on the branch `prospective`, once by its key (its kind, parent and
  launch, its step bracket or, with no step, the run it was raised at, and
  its state), with a line per run in `runs.jsonl`. The branch is committed
  and pushed each day, a day with no alert included, and never rewritten.
  An alert's lead over a reported event is measured from the commit that
  logged it, not from the replay's clock: the daily re-replay may raise an
  alert dated days back (a set published late, a status that changed), and
  it was known only when it was committed. This holds on both lines: the
  Confirmed line from the start, and the early warning since 2026-10-12,
  which until then was called flagged where the replay's clock raised it
  before the first sign of the fragments, so a warning raised dated back
  and committed after the pieces appeared would have counted as flagged.
  It is now flagged only where its commit came first, and its lead is
  counted from the commit.
- **The branch is the lasting record.** The Actions run each line of
  `runs.jsonl` names is a second timestamp, but GitHub keeps a run's log
  for ninety days. The commit times on `prospective` last because the
  branch cannot be rewritten: a ruleset of the repository refuses a
  force-push or a deletion of `prospective`, by anyone, the owner
  included (the ninth decision record lists it). No signing or
  timestamping service is added: the bot's commits are unsigned, and the
  ruleset is what keeps their times.
- **The score waits for the truth.** `npm run prospective:score` lands
  each confirmed alert on the truth as it then stands, as the Confirmed
  line does, and prints the headline for the events after the freeze, the
  lead from the commit, the false confirmations and the reported events
  with pieces that no alert confirmed. The truth is built from the
  agencies' reports, which come months after an event, so the score says
  when the truth last changed and that the last three months or so are not
  final.

## What it costs

The test is slower than the product would be: the job runs once a day
where the product runs every few hours, and a day is pulled a few hours
into it, so an alert is known up to a day after the replay's clock raised
it, and the lead measured from the commit is the lead of a daily run. The
frozen truth's notices are the ones known at the freeze, so a notice
published after it confirms nothing in the test; the Confirmed line
excludes confirmations by a notice alone in any case. The satellite
catalogue is read as it stands each day, which is what a live detector
would read, but the year is replayed whole each day against that day's
status: a satellite that died in a breakup and gained an end date weeks
later is read as dead at its breakup on the next day's replay, so the
hindsight the backtest's fifth decision record states does arise for the
days already replayed, and a step can be raised dated back. That is why
both lines are scored from the commit, which no later replay moves. The scratch directories hold a year's file
and its end states, a couple of hundred megabytes a day, and the last
seven are kept.

## Stopping it

The job is the scheduled workflow `.github/workflows/prospective.yml`
("Prospective"), at 02:37 UTC each day. It pauses with
`gh workflow disable prospective.yml` and resumes with
`gh workflow enable prospective.yml`; `gh workflow run prospective.yml`
runs it at once. Stopping it ends the record; a gap in `runs.jsonl` shows
when it was not running, and a run after a gap logs the alerts of the gap
with the commit time of that run.

Since 2026-10-12 a stop is never silent. A failed run opens an issue
labelled `maintenance` with the end of its log, one a failing day (a run
made again that day comments on it, `scripts/maintenance/failure-issue.ts`).
GitHub disables a public repository's scheduled workflows after sixty days
with no activity in it; each scheduled run of this workflow, of the weekly
maintenance and of the weekly KPI replay enables again any of them GitHub
disabled for that reason, and never one a person disabled
(`scripts/maintenance/keep-alive.ts`). Three disabled at once cannot
enable each other: `gh workflow list --all` shows it.

## As built

On 2026-10-11, the day it began, the job moved from a launchd agent of the
owner's account (`com.orbinauts.breakups.prospective`, at 04:37 local time,
over the Archive and the worktrees beside the repository) to the scheduled
GitHub Actions workflow `prospective.yml`, with the owner's approval; the
agent was removed once the workflow had run and pushed its first line. Two
reasons. The test no longer depends on one machine being awake, online and
unchanged every day for years. And each run's line in `runs.jsonl` names
the Actions run that made it (`runUrl`), whose log GitHub keeps with its
own timestamps, a second record of when each alert was known held by
another party than the branch.

The decision stands; what changed is where its parts live.

- **The runner starts empty each day.** The catalogue's login is kept as
  the repository's secrets `SPACETRACK_IDENTITY` and `SPACETRACK_PASSWORD`,
  given only to the run's step. The test's own data are kept as assets of
  the release `prospective-data` (`npm run prospective:data`,
  `scripts/prospective/data.ts`): the frozen states at the end of each
  closed year with their provenance (`states-2025.json.gz`, the starting
  states above, its hash the one its provenance names), the day slices
  pulled from the history class for each year replayed
  (`history-2026.tar`, the days with their modification times, which say
  which were kept for good), and a manifest of hashes. The run downloads
  them and the Archive's released years before the year it replays,
  verifying every hash, and afterwards uploads the year's slices again, and
  a closed year's end states with their provenance once it settles. The
  ledger `requests.log` is printed in the run's log and kept as its
  artifact, which keeps it for ninety days.
- **The frozen detector is a checkout of the tag**, not a worktree: the
  workflow checks out main, the tag beside it and the `prospective` branch
  in a third directory, and refuses to run where the tag no longer names
  `8729987`, as `npm run prospective` itself now does wherever it runs
  (`FROZEN_COMMIT`). No lockfile is committed, so the tag's runtime
  dependencies are installed at the versions the local runs used
  (`@orbinauts/engine` 0.1.2, `satellite.js` 7.1.0,
  `astronomy-engine` 2.1.19) and checked. From 2026-10-12 those versions
  are the `frozenDetector` pins of `pins.json` on main, installed and
  checked by `npm run pins -- install frozenDetector`, and each line of
  `runs.jsonl` records the versions the frozen detector ran on
  (`RunLine.versions`), read from its installed tree.
- **The commit is the Actions bot's** (`github-actions[bot]`), pushed with
  the run's token, so the branch says which commits a run made; the first
  two lines of `runs.jsonl`, made by the launchd agent on the test's first
  day, carry the owner's identity and no run URL.
- **The view and its own index are as above**, built on the runner each
  day over the whole Archive: every released year before the one replayed,
  and the year rebuilt from the slices. The decoded-column cache is off.
- **Each alert opens an issue, and the score is kept weekly.** Since the
  ninth decision record, the daily run opens an issue labelled
  `prospective-alert` for every alert of `alerts.jsonl` that has none, with
  the parent, the state, the evidence, the run and the line of the log,
  once per alert key; and the weekly maintenance workflow scores the log
  against the truth on main, commits the score to the branch as `score.md`
  and summarises it on the results page, `docs/results.md`. Neither
  touches `alerts.jsonl` or
  `runs.jsonl`, whose commit times stay the test's evidence.
