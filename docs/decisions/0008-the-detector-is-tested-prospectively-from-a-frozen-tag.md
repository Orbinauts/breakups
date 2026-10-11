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
  `../breakups-frozen`, is checked out at it with the dependencies main's
  lockfile pinned when the test began, and the daily job runs the replay
  only there, refusing to run when the worktree is not the tag or has a
  change. Work on main never changes what is being tested; the test's
  detector, its truth (whose notices it reads as of each run) and its
  scorecard code are the tag's.
- **The data are main's.** The job runs `npm run prospective` on main.
  Main's scripts pull the current year from the catalogue's history class
  (the days not yet kept, and again each day kept before it settled, two
  to four requests a day, throttled and written to the ledger
  `requests.log`), fetch the satellite catalogue and the space weather at
  most once a day, and annotate the year's body table with the latest
  satellite and payload catalogues, as the product would see them that
  day. The Archive's format is shared, so a change to it on main must
  stay readable by the tag.
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
  it was known only when it was committed.
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
excludes confirmations by a notice alone in any case. The satellite and
payload catalogues are read as they stand each day, which is what a live
detector would read, so the hindsight the backtest's fifth decision record
states does not arise here. The scratch directories hold a year's file
and its end states, a couple of hundred megabytes a day, and the last
seven are kept.

## Stopping it

The job is the launchd agent `com.orbinauts.breakups.prospective` of the
owner's account, at 04:37 local time each day. It stops with
`launchctl bootout gui/$(id -u)/com.orbinauts.breakups.prospective`, and
stays stopped once its plist is removed from `~/Library/LaunchAgents/`.
Stopping it ends the record; a gap in `runs.jsonl` shows when it was not
running, and a run after a gap logs the alerts of the gap with the
commit time of that run.
