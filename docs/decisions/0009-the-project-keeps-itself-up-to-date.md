---
status: accepted
date: 2026-10-11
---

# The project keeps itself up to date

The owner wants the truth, the scorecard, the README and the prospective
test's score to stay current with no action from him. Until now each of
them moved only when someone ran a command on a machine with the Archive:
`npm run truth:fetch` for a new edition of a source, `npm run truth`, the
twenty-minute sequential replay, then the README's tables pasted by hand
from `kpi/latest.md`. The sources do not wait for that. GCAT's satellite
catalogue is updated most days, its debris clouds and NASA's history less
often, and the prospective test's year closes on 31 December whether
anyone promotes it into the Archive or not. This record states what now
runs by itself, what still needs a person and why, and why the automatic
merge is safe.

## The decision

- **The README's numbers are generated, and so are the documentation
  pages'.** Every table and count of the README, `docs/results.md` and
  `docs/ground-truth.md` that states a number of the scorecard or of the
  truth sits between two markers, `<!-- <name>:begin -->` and
  `<!-- <name>:end -->`, and `npm run kpi:readme` (`scripts/kpi/pages.ts`)
  writes them from `kpi/latest.json`, `data/breakups.json` and the GCAT
  snapshot. The README carries the summary of the held-out years
  (`kpi:summary`) and what the quick start prints (`truth:quick-start`,
  the README's own code run against the truth). The results page carries
  the headline of both splits (`kpi:current`), the sentences on the
  medians of the lead and the lag (`kpi:medians`), the Confirmed tables
  and the parent-step tables (`kpi:confirmed`, `kpi:parent-step`). The
  ground-truth page carries the truth's counts (`truth:counts`) and the
  count of GCAT's clouds (`truth:gcat-clouds`). The two sentences that
  say whether the target is met follow the numbers (`kpi:target` in the
  README, `kpi:splits` on the results page): "It does not reach that
  target yet" stands while the target is unmet and is replaced by a
  sentence saying it is met once it is. The prose around them is never
  touched, and the command run on the files the pages were written from
  changes nothing. `test/readme.test.ts` and `test/results.test.ts` still
  check every cell against the files, independently of the generator.
- **The prospective test opens an issue per confirmed alert.** The daily
  workflow `prospective.yml`, after it has logged the day's alerts and kept
  the day slices, opens one issue, labelled `prospective-alert`, for every
  confirmed alert on a named parent in `alerts.jsonl` that has none. The
  suspected steps, the scoped line's alerts and the clouds stay in the log
  only: the backtest found the parent's step alone wrong more than
  ninety-nine times in a hundred, which would be hundreds of emails a
  year. Each issue carries the parent's name, catalogue number and
  state in the title; the evidence, the run that logged it and the line of
  the log in the body; and the alert's key in a hidden line. The issues of
  the label are read in every state first, so an alert never gets two,
  and a day whose issues could not be opened is made good the next day
  (`scripts/maintenance/alert-issues.ts`).
- **A weekly workflow keeps the rest.** `maintenance.yml` runs every Monday
  at 04:17 UTC, in the same concurrency group as the prospective test, so
  the two never run at once. It fetches the machine-readable sources
  (GCAT's debris clouds and satellite catalogue, NASA's history, whose PDF
  is turned into text only when its hash changed), rebuilds the truth,
  and plans the run (`scripts/maintenance/plan.ts`). Where the committed
  aggregate no longer describes the truth, the Archive's release or the
  scoring pins (the truth's hash, the years, each year's build time, the
  versions of the engine and the propagators in `pins.json`), it
  downloads the whole Archive, rebuilds the catalogue index and replays
  every year in order, a year a process as the KPI workflow does, which writes
  `kpi/latest.json`, `kpi/latest.md` and `docs/detector/events.md`. It
  always writes the generated parts and scores the prospective test:
  `score.md` on the `prospective` branch, and a summary on the results
  page (`prospective:score`) of the alerts so far, the confirmed alerts
  matching reported events, the false confirmations, the truth's last
  change and the caveat that recent events are not in the truth yet. It
  then runs every check, the typecheck, the tests and the documentation
  build. Since 2026-10-12 the typecheck and the tests also run once
  before any download or replay, on the folded tree with the refreshed
  sources and the rebuilt truth, the generated parts written from the
  aggregate as committed, so a test bound to a source's edition or a
  folded branch that breaks the build fails in minutes, not after the
  replay's hour; the one test the replay makes good, that the aggregate
  was scored against the truth the package ships, is left out of that
  first run where a replay is due (`BREAKUPS_SCORECARD_PENDING`). Where anything changed, the Actions bot commits it to a branch
  `maintenance/<date>`, opens a pull request saying what moved and why
  (each source refreshed with its hashes, each event added, removed or
  changed by id, each cell of the aggregate with its old and new value,
  the prospective score), waits for CI to pass on the pull request,
  uploads the release's side files, squashes the pull request into main, runs CI, the KPI workflow and the docs on main,
  and links their runs on the pull request. A week with nothing new opens
  no pull request.
- **The closed year is promoted once a year.** On the first weekly run
  from 5 January, once the prospective test has settled the year (its
  history in the release `prospective-data` through 31 December, and the
  frozen detector's end states of the year kept beside it), the year is
  built from the test's day slices as the pull builds it
  (`buildFromHistory`), its bodies annotated, and put in the Archive in
  place of the part uploaded by hand; the index is rebuilt, the scorecard
  replayed over every year, and the year uploaded as
  `archive-v1-<year>.tar` with the side files and the manifest
  (`scripts/maintenance/promote.ts`). The release's manifest now records
  the last day each year holds, so a year held through 31 December is
  never promoted again. A tarball over GitHub's 2 GiB limit on an asset is
  refused before anything is touched, with an issue saying so.
- **Nothing ends green or silent.** Since 2026-10-12: the KPI workflow
  fails where the Archive's release cannot be reached (a release deleted
  or renamed, an outage), on main, on its schedule, by hand and on the
  repository's own pull requests, and skips the replay with a notice only
  on a pull request from a fork; a failed run of the prospective test opens
  an issue labelled `maintenance` with the end of its log, one a failing
  day; and each scheduled run (the daily test, the weekly maintenance, the
  weekly KPI replay) enables again any scheduled workflow GitHub disabled
  after sixty days without activity in the repository, never one a person
  disabled (`scripts/maintenance/keep-alive.ts`). The KPI workflow's
  Monday run moved from 06:00 to 12:23 UTC, after the maintenance run's
  longest window (04:17, or 05:37 where it waited for the daily test, and
  its 330 minutes), and joins the maintenance run's concurrency group, so
  it never downloads the release while the maintenance run replaces its
  files. Its other runs keep a group of their own: GitHub keeps one pending
  run per group and a newer one displaces it, so a push's run waiting in
  the shared group could displace a daily run of the test.
- **A person is reminded of what no script reads.** In the week of the
  first Monday of January, April, July and October the weekly run opens
  an issue, labelled `maintenance`, listing what to check by hand since
  the last reminder: NASA's latest Orbital Debris Quarterly News, the
  U.S. Space Forces-Space notices, the news reports of fragmentations and
  ESA's yearly report, with the hand file's latest entries and how to add
  a row. It is opened once a quarter, by its title. Since 2026-10-12 a
  daily watcher also opens a prefilled issue for each new notice it can
  read, and a report the owner accepts reaches main the next morning, when
  the watcher starts the maintenance run and the prospective test's runs
  leave room, or on Monday's run
  ([0011](0011-reports-reach-the-truth-through-issues-the-owner-accepts.md));
  the reminder remains for what the watcher does not read.

## What still needs a person, and why

- **The hand-typed sources.** The quarterly news reports breakups in
  prose, the Space Forces notices are posted on a login page, and the news
  reports are scattered; none has a form a script can read without
  reading it wrong, which is why the truth keeps them as statements typed
  with their citation (the second decision record). Since 2026-10-12
  ([0011](0011-reports-reach-the-truth-through-issues-the-owner-accepts.md))
  a script finds what it can and a person still reads it: the daily
  watcher opens an issue for each new issue of the quarterly news and
  edition of ESA's report (to read and record), and a prefilled
  `breakup-report` issue for each section of Jonathan's Space Report and
  news article it reads; a person completes the parent and the time, and the owner labels it `breakup-report-accepted`, the one
  action left, after which a workflow checks the statement
  (`npm run truth:add`) and the maintenance run reads it again from the
  issue, folds it in, rescores and merges it. The Space Forces notices, LeoLabs' posts and
  any source the watcher does not read still wait for a person to notice
  them: the quarterly reminder lists them, and the same form or
  `npm run truth:add` on a branch (folded in by `gh workflow run
  maintenance.yml -f from=<branch>`) adds them.
- **A new form or a new edition.** A source that changes its form makes
  the parser throw, by design (the second decision record); the weekly
  run then fails, opens an issue with the log, and merges nothing. A new
  edition of NASA's history is a new document at a new address, with a
  parser to extend.
- **The detector and its scorecard rules.** The automation replays the
  committed detector; it never changes a rule, a threshold or the frozen
  tag, and never bumps the version or publishes the package.
- **The issues.** An alert issue is a prompt to look at an alert; a
  failure or refusal issue is a prompt to fix what the run could not.
- **The prospective test's history past 2 GiB.** The day slices of a year
  are kept in one release asset, and GitHub refuses an asset over 2 GiB:
  2026's is on course for some 1.93 GB by 31 December, and the catalogue
  grows each year. The weekly plan projects the current year's history to
  31 December and, past nine tenths of the limit, opens an issue once a
  year; splitting the history across assets is a change to
  `scripts/prospective/data.ts` and the promotion, for a person to make
  before the daily upload fails.
- **The repository's settings and secrets.** The workflow's token may
  open pull requests only while the repository lets GitHub Actions create
  them (Settings, Actions, General: "Allow GitHub Actions to create and
  approve pull requests"), and the prospective test's catalogue login is
  a secret only the owner can renew.
- **The repository's rulesets.** Three rulesets hold what the runs rely
  on, whatever token pushes (Settings, Rules, Rulesets). Main takes a
  change only through a pull request on which CI's `check (Node 22)` and
  `check (Node 24)` have passed, and is never force-pushed or deleted;
  the owner, as the repository's admin, may push to it directly. The
  `prospective` and `published` branches, the prospective test's
  evidence, are never force-pushed or deleted, by anyone. The
  `frozen-*` tags are never moved or deleted, by anyone; a new freeze
  creates a new tag. The KPI workflow is not a required check: on the
  bot's pull requests it runs on main after the merge (below), and a
  person's pull request shows its result without being held for an hour's
  replay. Since 2026-10-12 a pull request that touches no file the replay
  reads (only the docs, the tests or another workflow) starts no KPI run
  at all (`.github/workflows/kpi.yml`, docs/decisions/0004).

## The bot, and why the merge is safe

Every commit and merge the workflows make is the Actions bot's,
`github-actions[bot]`, with messages in the project's style and no
trailer, so the history says which changes a person made and which a run
made, and each pull request links the run that made it.

The merge is automatic because the owner asked for no action, and it is
safe for three reasons. Every check that guards a person's change runs on
the tree before the merge: the typecheck, the whole test suite (which
rebuilds the truth from its snapshots and fails on any difference, and
checks every generated cell of the README and the documentation pages
against the files) and the documentation build;
a failure stops the run with an issue and nothing is merged. CI then runs
on the pull request itself, with the configuration a person's pull request
meets, on Node 22 and 24, and the merge waits for it to pass: the bot
counts as a first-time contributor, so its pull request's runs are held for
approval, and the run approves CI's (the KPI workflow's held run is
deleted, never having run a job, since it runs on main after the merge).
A CI run that cannot be found or approved stops the run with an issue, as
a failed one does, and main's ruleset would refuse the merge regardless.
The tree is merged only onto the main it was checked against. A main that
moved during the run, which an hour's run makes likely, is followed only
where the move touched nothing the run generated or was made from: no file
under `data/` or `kpi/`, no page with generated parts (the README,
`docs/results.md`, `docs/ground-truth.md`, `docs/detector/events.md`,
`docs/truth.md`), no dependency manifest or pin (`package.json`,
`package-lock.json`, `pins.json`), and no file the run itself changed, a
folded branch's included (`scripts/maintenance/moved.ts`). The run's
change is then put on the new main as one commit, which applies cleanly
since none of its files moved, and the typecheck and the whole test suite
run again on that tree before the pull request is opened and CI runs on
it; main moving again is followed the same way, three times at most.
Where the move touched any of those files, the pull request is left
unmerged with the files named, and the next run starts again from main.
A moved main that changed the detector's code but not the aggregate is
followed: such a change reached main past the KPI workflow's check that
the committed aggregate is reproducible, and the KPI run on main after
the merge checks it again. And CI and
the KPI workflow run again on main after the merge, the KPI workflow
replaying the Archive from the release to make the committed aggregate
again and failing where it cannot, so a merged change that only the
release could expose is seen within the hour. What the workflow changes
is generated: snapshots, the truth built from them, the aggregate, the
marked parts of the README and the documentation pages, and the score. It never edits code, a rule or the
hand file; those reach main from a person, directly or in a branch the
person asks it to fold in (`-f from=<branch>`), which meets the same checks.
The one exception is a statement the owner accepted from a breakup-report
issue, which the run reads again from the issue and appends to the hand
file as the owner accepted it ([0011](0011-reports-reach-the-truth-through-issues-the-owner-accepts.md)).

## Considered options

- Pull requests left open for the owner to merge: safe, but the owner
  asked for no action, and the checks a person would rely on are the ones
  the run already passed. `-f merge=false` keeps the option for a run
  made by hand.
- Pushing to main directly: no record of what moved and why, and no
  place to link the runs that checked it.
- A personal token, so the merge itself triggers CI and the KPI workflow:
  a long-lived secret to rotate. The workflow's own token, with leave to
  run workflows (`actions: write`), starts them instead.

## Pausing

- The weekly upkeep: `gh workflow disable maintenance.yml`; resume with
  `gh workflow enable maintenance.yml`; run it at once with
  `gh workflow run maintenance.yml`.
- The prospective test and its alert issues:
  `gh workflow disable prospective.yml` (the eighth decision record).
- The KPI workflow's weekly replay: `gh workflow disable kpi.yml`, which
  also stops it on pushes and pull requests.
- A workflow disabled by hand stays disabled: the keep-alive enables again
  only a workflow GitHub disabled for the repository's inactivity.
