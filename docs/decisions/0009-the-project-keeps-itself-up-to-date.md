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

- **The README's numbers are generated.** Every table and count of the
  README that states a number of the scorecard or of the truth sits
  between two markers, `<!-- <name>:begin -->` and `<!-- <name>:end -->`,
  and `npm run kpi:readme` (`scripts/kpi/readme.ts`) writes them from
  `kpi/latest.json`, `data/breakups.json` and the GCAT snapshot: the
  current results (`kpi:current`), the Confirmed tables and the
  parent-step tables of "How well it does" (`kpi:confirmed`,
  `kpi:parent-step`), the truth's counts (`truth:counts`), the count of
  GCAT's clouds (`truth:gcat-clouds`) and what the quick start prints
  (`truth:quick-start`, the README's own code run against the truth). The
  two sentences that say whether the target is met follow the numbers
  (`kpi:target`, `kpi:splits`): "It does not reach that target on the
  held-out years" stands while the target is unmet and is replaced by a
  sentence saying it is met once it is. The prose around them is never
  touched, and the command run on the files the README was written from
  changes nothing. `test/readme.test.ts` still checks every cell against
  the files, independently of the generator.
- **The prospective test opens an issue per alert.** The daily workflow
  `prospective.yml`, after it has logged the day's alerts and kept the day
  slices, opens one issue, labelled `prospective-alert`, for every alert of
  `alerts.jsonl` that has none: the parent's name, catalogue number and
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
  aggregate no longer describes the truth or the Archive's release (the
  truth's hash, the years, each year's build time), it downloads the
  whole Archive, rebuilds the catalogue index and replays every year in
  order, a year a process as the KPI workflow does, which writes
  `kpi/latest.json`, `kpi/latest.md` and `docs/detector/events.md`. It
  always writes the README's generated parts and scores the prospective
  test: `score.md` on the `prospective` branch, and a summary in the
  README (`prospective:score`) of the alerts so far, the confirmed alerts
  matching reported events, the false confirmations, the truth's last
  change and the caveat that recent events are not in the truth yet. It
  then runs every check, the typecheck, the tests and the documentation
  build. Where anything changed, the Actions bot commits it to a branch
  `maintenance/<date>`, opens a pull request saying what moved and why
  (each source refreshed with its hashes, each event added, removed or
  changed by id, each cell of the aggregate with its old and new value,
  the prospective score), uploads the release's side files, squashes the
  pull request into main, runs CI, the KPI workflow and the docs on main,
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
- **A person is reminded of what no script reads.** In the week of the
  first Monday of January, April, July and October the weekly run opens
  an issue, labelled `maintenance`, listing what to check by hand since
  the last reminder: NASA's latest Orbital Debris Quarterly News, the
  U.S. Space Forces-Space notices, the news reports of fragmentations and
  ESA's yearly report, with the hand file's latest entries and how to add
  a row. It is opened once a quarter, by its title.

## What still needs a person, and why

- **The hand-typed sources.** The quarterly news reports breakups in
  prose, the Space Forces notices are posted on a login page, and the news
  reports are scattered; none has a form a script can read without
  reading it wrong, which is why the truth keeps them as statements typed
  with their citation (the second decision record). A row is added on a
  branch and folded in by `gh workflow run maintenance.yml -f
  from=<branch>`, which rescores and merges it.
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
- **The repository's settings and secrets.** The workflow's token may
  open pull requests only while the repository lets GitHub Actions create
  them (Settings, Actions, General: "Allow GitHub Actions to create and
  approve pull requests"), and the prospective test's catalogue login is
  a secret only the owner can renew.

## The bot, and why the merge is safe

Every commit and merge the workflows make is the Actions bot's,
`github-actions[bot]`, with messages in the project's style and no
trailer, so the history says which changes a person made and which a run
made, and each pull request links the run that made it.

The merge is automatic because the owner asked for no action, and it is
safe for three reasons. Every check that guards a person's change runs on
the tree before the merge: the typecheck, the whole test suite (which
rebuilds the truth from its snapshots and fails on any difference, and
checks every README cell against the files) and the documentation build;
a failure stops the run with an issue and nothing is merged. The tree is
merged only onto the main it was checked against: a main that moved
during the run is left alone and the next run starts again. And CI and
the KPI workflow run again on main after the merge, the KPI workflow
replaying the Archive from the release to make the committed aggregate
again and failing where it cannot, so a merged change that only the
release could expose is seen within the hour. What the workflow changes
is generated: snapshots, the truth built from them, the aggregate, the
README's marked parts and the score. It never edits code, a rule or the
hand file.

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
