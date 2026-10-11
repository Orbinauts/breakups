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

The job runs `npm run prospective` on `main` at 04:37 local time every day.
It pulls the days of the current year the Archive does not yet hold from
the catalogue's history class (about two requests a day, throttled and
ledgered), refreshes the satellite catalogue and the space weather, and
replays the year through the detector in a worktree checked out at the
frozen tag, from the states the same detector ended the previous year with.
The replay writes into a scratch directory under the Archive, never into
the repository. See `scripts/prospective/run.ts` on `main`, and the
decision record `docs/decisions/0008-the-detector-is-tested-prospectively-from-a-frozen-tag.md`.

The scoring is `npm run prospective:score` on `main`: it reads this
branch's `alerts.jsonl` and the commit that added each line, and the truth
as it then stands, and prints the Confirmed headline for the events after
the freeze. The truth catches up with the agencies' reports months after an
event, so the score of the last three months or so is not yet final.

## Stopping the job

The job is a launchd agent of the owner's account. To stop it:

```sh
launchctl bootout gui/$(id -u)/com.orbinauts.breakups.prospective
```

and, to keep it from loading at the next login, remove
`~/Library/LaunchAgents/com.orbinauts.breakups.prospective.plist`. To start
it again:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.orbinauts.breakups.prospective.plist
```

Each run writes a line to `prospective/prospective.log` under the Archive,
`ok` or `FAILED` with the reason, and the job's output goes to
`prospective/launchd.log` beside it.
