---
status: accepted
date: 2026-10-12
---

# Reports of breakups reach the truth through issues the owner accepts

A suspected breakup is published only once an outside report of it, a news
article or a named analyst's statement, is in the ground truth, and a
confirmation by notice only once an agency's notice is
([0010](0010-the-breakups-fit-to-show-are-published-as-static-json.md)).
Those statements are typed by hand into `data/truth/hand.json`
([0002](0002-the-ground-truth-is-generated-with-provenance.md)), and until
now they were checked once a quarter, when the maintenance run's reminder
asked a person to read the sources
([0009](0009-the-project-keeps-itself-up-to-date.md)). Most suspected
breakups would have reached the published list weeks after the news, or
never. The goal (issue #9) is that a report of a breakup lands in the
truth within a day or two of its publication. This record says how, and
why a person still reads every report.

## The decision

Both a quick hand path and a watcher, and the watcher only opens issues.

- **One command adds a statement: `npm run truth:add`**
  (`scripts/truth/add.ts`). It takes a statement as JSON, or a filled
  breakup-report form (`--form`), checks it against the hand file's
  schema (`readStatement`), appends it after the last statement in the
  file's own layout (every line before it left as it was; the layout is
  tested to be the committed file's, byte for byte) and rebuilds the
  truth. It refuses, saying why: a statement of a source the build reads
  by itself (GCAT, NASA's history); a report with no day it was published,
  which would count for nothing; a report published before the event it
  reports; and a statement the file already holds (the same source and
  reference, or the same source, link and parent). A statement the build
  cannot take leaves the hand file as it was. It prints the event the
  statement landed in.
- **A report is filed with an issue form**,
  `.github/ISSUE_TEMPLATE/breakup-report.yml`, labelled `breakup-report`:
  the source, the day it was published, the reference, the link, the
  kind, the parent, the time as stated with its precision and window, the
  orbit, the cause, the pieces and a note, each a field of the hand file
  (`scripts/truth/report-form.ts` reads it back from the issue's body).
- **The owner accepts it with a label, and only the owner.** When an
  issue is labelled `breakup-report-accepted`, the workflow
  `.github/workflows/breakup-report.yml` asks GitHub for the permission of
  whoever applied the label and goes on only for admin permission
  (`scripts/truth/report-issue.ts`): anyone with triage permission can
  apply a label, so the label alone proves nothing. A label applied by
  anyone else is taken off with a comment. The workflow runs
  `npm run truth:add -- --form` on the issue's body; a refusal takes the
  label off and quotes the refusal, so the issue can be edited and
  labelled again. An accepted statement is committed by the Actions bot,
  with the rebuilt truth, to a branch `report/issue-<number>`, named by the
  number alone, and the maintenance workflow is run on it
  (`-f from=<branch>`), which replays the scorecard, runs every check and
  merges into main. The issue is closed with a link to the runs. The
  issue's text is read only by the scripts, from the event's file, never
  pasted into a shell command.
- **The maintenance run folds an accepted report in by its statements,
  not by merging its branch.** Two reports' branches cut from one main
  both append at the hand file's end, so the second never merges; and
  GitHub keeps one waiting run per concurrency group, so a report
  accepted while a run waits replaces that run, and the first report's
  run never happens. So every maintenance run, whatever started it, reads
  the hand file of every `report/` branch and appends the statements main
  lacks (`npm run truth:add -- --missing-from`), before it rebuilds the
  truth; a statement main holds in other words is passed over. A branch
  whose statements main holds already is deleted at once, the others once
  their pull request is merged. A branch folded in with `from=` that is not
  a report's is merged as before.
- **A daily watcher opens a prefilled issue for each new notice, and
  never writes the truth.** `.github/workflows/watch.yml` runs
  `npm run maintenance:watch` (`scripts/maintenance/watch.ts`) at 07:41 UTC.
  It reads only pages anyone can read without an account, each page's
  shape checked as it was served on 2026-10-12 (the fixtures under
  `test/fixtures/watch/`):
  - NASA's Orbital Debris Quarterly News, its list of issues: each issue
    after volume 30, issue 3, the last the truth was read from;
  - ESA's Space Environment Report, the yearly edition's page: each
    edition after 2025's (the 2026 edition, issue 10.1 of 8 September 2026,
    was not read, and is its first notice);
  - Jonathan's Space Report, the back issues: each section of an issue
    after number 860 whose text says a body broke up, quoted;
  - the RSS feeds of EarthSky, Space.com, SpaceNews and Ars Technica's
    space desk: each article of the last three days whose title says a
    body in orbit broke up or apart (a breakup, a fragmentation, shattered;
    never an explosion alone, which a launch's failure shares).

  Each notice opens one `breakup-report` issue, prefilled with the source,
  the day, a reference in the hand file's style and the link, and carries
  its key in a hidden line; the issues of the label are read in every
  state first, so a notice opens one issue however many runs see it. A
  day's news articles are one issue, since several publishers report one
  breakup at once. At most five issues a run. A page that cannot be read,
  or whose shape changed, fails the run after the other pages are read,
  with an issue labelled `maintenance`. A person completes the issue (the
  kind, the parent, the time) and the owner accepts it, or closes it when
  it reports no breakup.

## Not watched, and why

- **The U.S. Space Forces-Space notices.** They are posted on the public
  catalogue's login page, a site whose terms keep its data from being
  passed on, which the project's scripts read only for the catalogue
  itself; their copies on X need an account. They stay in the quarterly
  reminder.
- **LeoLabs' notifications.** They are posted on X. Its newsroom
  (`leolabs.space/news/`) carries press coverage, not the notifications;
  the press that reports them is watched instead.
- **U.S. Space Command's press releases.** Its server answered a script
  with 403 on 2026-10-12.
- **A news search.** Google News answers a search as an RSS feed, and it
  named Meteor 2-7, USA 32, Yaogan-50 02, Luch and both Starlinks of the
  hand file in its first hundred results on 2026-10-12, but the feed's
  terms allow it only in a personal feed reader. The publishers' own feeds are read
  instead, which miss the stories of the publishers not watched.
- **Other publishers** (Gizmodo, KeepTrack's briefs, The Register): not
  verified; a feed is one line of `FEEDS` and a fixture.

## Considered options

- **The watcher writes the rows, or opens pull requests with them.** A
  notice states the parent, the time and its precision in prose; a script
  that reads them reads some wrong, and the truth keeps only statements a
  person read (the second decision record). The title filter alone will
  also let through some stories that are not breakups. Refused: the
  watcher only finds and prefills; a person reads.
- **The quick hand path alone.** It needs someone to notice the news;
  the watcher does the noticing.
- **The watcher alone.** A report from a source it does not read (a
  Space Forces notice, an analyst's post) would still wait for the
  quarter.
- **Any collaborator's label accepts.** Simpler, but a triage collaborator
  could then add statements to the truth.
- **Branches merged as they are.** Two reports accepted on one day
  conflict, and a replaced waiting run loses a report: shown in a scratch
  repository before the fold by statements was chosen.

## Consequences

- A report reaches main on the day the owner accepts it: the maintenance
  run replays the scorecard (the truth's hash changed), about an hour,
  after any run of the prospective test that holds the concurrency group. The next daily publishing reads it from main, so a suspected
  breakup is published the next morning at the latest.
- The owner's one action per report is the label, by design.
- The watcher's start (the issue and the edition after which it reads)
  is fixed in `WATCHED_AFTER`; the issues before it were the quarterly
  reminder's to read, and still are where they were not.
- A notice the watcher reads wrong opens one issue a person closes; a
  page that changed its shape opens a maintenance issue until the reader
  is fixed.
