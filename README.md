# The prospective test's alerts

This branch holds no code. It is the live record of the breakup detector
frozen for the prospective test: every alert the detector `confirmed-v10`,
frozen at the tag `frozen-confirmed-v10`, raised after the freeze on
2026-10-11T00:00Z, appended once a day by a scheduled job. The backtest on
`main` scores the detector on twenty years it was tuned against; this
branch scores it on days that had not happened when it was frozen.

**The commit time is the proof of when each alert was known.** A line is
added to `alerts.jsonl` by the commit of the day's run that first found it,
the commits are pushed as they are made, and nothing here is ever
rewritten: no line is edited or removed, and the branch is never forced.
An alert's lead over a reported breakup is measured from the commit that
added it, not from the detector's own clock.

## The files

- `alerts.jsonl`: one line per alert, in the order found. Each holds the
  verdict whole (its state, parent, launch, step bracket, event estimate,
  every number of its evidence, its reasons in words and the bodies it rests
  on), when the detector raised it (`raisedAt`, the replay's clock), the
  year replayed, the day of the run that found it (`loggedOn`), the frozen
  commit and the detector's name. The logged states are `suspected`,
  `scoped` and `confirmed`, and every cloud verdict (the scorecard's review
  rows). An alert is logged once by its key: its kind, parent and launch,
  its step bracket (or, for a verdict with no step, the run it was raised
  at), and its state. A step that goes from suspected to confirmed is
  therefore two lines, one for each state, each with its own commit.
- `runs.jsonl`: one line per daily run, with or without new alerts: the
  day, the frozen commit, the years replayed and through which day, the
  element sets replayed, the alerts found since the freeze and how many were
  new, the requests made to the catalogue, and how long the run took.

## How it runs

The job is the scheduled GitHub Actions workflow
`.github/workflows/prospective.yml` on `main` ("Prospective"), at 02:37 UTC
every day, on a fresh runner. It runs `npm run prospective` from `main`: it
pulls the days of the current year not yet kept for good from the
catalogue's history class (about two requests a day, throttled, every one
written to a ledger the run prints and keeps as an artifact), onto the day
slices kept in the release `prospective-data`, refreshes the satellite
catalogue and the space weather, and replays the year through the detector
in a checkout of the frozen tag, from the states the same detector ended the
previous year with. It refuses to run if the tag no longer names the frozen
commit `8729987`. The alerts and the run's line are committed here by
`github-actions[bot]`, and each line of `runs.jsonl` names the run that made
it (`runUrl`), whose log GitHub keeps: a second timestamp, held by another
party than this branch. The first two lines, of 2026-10-11, were made by a
launchd agent on the maintainer's machine before the job moved to the
workflow the same day, and carry no run URL. See `scripts/prospective/run.ts`
on `main`, and the decision record
`docs/decisions/0008-the-detector-is-tested-prospectively-from-a-frozen-tag.md`.

The scoring is `npm run prospective:score` on `main`: it reads this
branch's `alerts.jsonl` and the commit that added each line, and the truth
as it then stands, and prints the Confirmed headline for the events after
the freeze. The truth catches up with the agencies' reports months after an
event, so the score of the last three months or so is not yet final.

## Stopping the job

To pause it, disable the workflow:

```sh
gh workflow disable prospective.yml --repo Orbinauts/breakups
```

To resume it, `gh workflow enable prospective.yml --repo Orbinauts/breakups`;
to run it at once, `gh workflow run prospective.yml --repo Orbinauts/breakups`.
Each run's log, with its ledger of requests, is on the repository's Actions
page. A gap in `runs.jsonl` shows when the job was not running, and a run
after a gap logs the alerts of the gap with its own commit time.
