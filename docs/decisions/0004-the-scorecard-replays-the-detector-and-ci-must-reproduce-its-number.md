---
status: accepted; its headline target amended on 2026-10-10 by docs/decisions/0007-the-target-is-on-confirmed-alerts.md
date: 2026-10-09
---

# The scorecard replays the detector over the Archive and CI must reproduce its committed number

Status note, 2026-10-10: the owner moved the nine-in-ten and one-in-ten
targets from the alert on the parent's step to the Confirmed line, a
breakup the detector attributes to a parent from fresh fragments in its
plane, with or without a step seen first
(`docs/decisions/0007-the-target-is-on-confirmed-alerts.md`). The rules
below (the replay, the matching, the parity split, the committed number
CI must make again) stand; the parent-step lines they define stay in the
scorecard as secondary measurements, below the Confirmed line.

Status note, 2026-10-12: the KPI workflow replays a pull request only
where it touches a file the replay or its reproducibility step reads (the
detector, the scorecard, Archive, pins and truth scripts, the truth, the
manifest, the pins, the committed aggregate and the workflow itself). A
pull request that changes only the docs, the tests, Markdown other than
`kpi/latest.md` or another workflow cannot move the score, and no longer
waits an hour for a replay that would make it again. The filter lists what
it skips, so a file nobody listed is still replayed. Main's run, on every
push, every Monday and by hand, stays the record.

The scorecard feeds the detector every element set of every object in the
order the catalogue published them, in runs of four hours as the product
will, and matches what the detector raises against the ground truth. A
detection is an alert on the parent whose measured step brackets the
reported event and that was raised before the first fragment's element set
was published and before any notice; an alert after that is late; an alert
matching no reported event is a false alarm; an alert on an aerodynamic
breakup, a release or an unnamed report is exempt. Parents with no public
elements are listed apart and left out of the denominator. The headline
cells are the detection rate (the target is nine in ten) and the
false-alarm rate (the target is under one in ten), on years held out from
the ones the thresholds were fitted on: the odd years against the even,
then the reverse, both shown.

The aggregate is committed as a file the README's table is read from, and
CI recomputes it over the Archive and fails when a fresh run differs. That
is the engine's pattern (its Oracle fixtures) turned on a number: the
committed score is the record, and the proof is that anyone, CI first, can
make it again.

Making it again needs the same code as well as the same inputs, so the
score is made on exact versions of the runtime packages (since
2026-10-12): the engine, `@orbinauts/engine`, and the propagators it
reads, `satellite.js` and `astronomy-engine`, pinned as `scoring` in the
committed `pins.json`. The KPI and maintenance workflows install those and
fail, naming the package, the version found and the pin, where one
resolves to another version; the aggregate records the versions it was
made with (`Latest.versions`), and a pin that moves from them is a stated
reason to replay it. CI alone installs from the manifest's ranges, with no
lockfile, to test what a consumer gets. The pins are not a lockfile, and
live in their own file rather than in `package.json`, which every
consumer's install reads; a bump is a deliberate commit, and the score
replayed on it says what it moved.

The reason for scoring the parent's step alone, and before the fragments
appear, is the owner's: the value of the tool is to say that something
broke up before the catalogue says so by listing the pieces. Confirmation
by pieces is scored separately, as how many detections were confirmed and
how many days later. The reason for held-out years is the size of the
truth: some hundred and fifty events over twenty-one years, forty or so
with a visible parent step, so every threshold fitted on all of them would
describe them rather than predict.

## Considered options

- Score either signal, the parent's step or a fragment burst: more events
  detected, but a burst of catalogued fragments is the catalogue's report,
  not a detection.
- Score only confirmed alerts: cleaner, but it hides what the product
  would show first.
- Score the parent's step, before the fragments, with confirmation apart
  (chosen).

## Consequences

- The library logs every candidate with every signal it computed, so the
  scorecard can sweep thresholds offline without replaying twenty years.
- The scorecard reads the first fragment's publication time from the
  Archive for each event, so "before the fragments" is measured, not
  assumed.
- A detector change lands with the regenerated score, or CI refuses it.

## As built

The scorecard as written keeps the rule above and fixes what it left
open:

- The targets are scored on five lines, never mixed: breakups reported to
  the day or better (confidence A and B), the headline; breakups reported
  to a month (C); breakups known only from their pieces (D); and anomalous
  events by the same two groups. A parent has public elements when it has
  at least five sets in the sixty days before the window.
- A step brackets an event when the bracket and the truth's window, each
  widened by a margin, overlap: a window a month wide can hold a step of
  a day, and an epoch is not an instant. The margin is per regime: a day
  in low and medium orbits, where sets come hours apart and an
  authority's instant is measured; five days in highly elliptical and
  geosynchronous orbits, where sets are days apart, the catalogue's fit
  settles on the new orbit over several of them, and the stated instant
  is itself inferred. The first phase of the detector raised the right
  object for the ullage motors of the Cosmos navigation launches and for
  Beidou G2, but the catalogue's step sat two to four days before the
  time NASA states (once thirty-three hours after), so the one-day
  margin scored every one of them as a miss and the whole highly
  elliptical line read nought. The owner may prefer the strict margin,
  or a look at those stated times; the margin is the scorecard's and
  changes no verdict.
- The catalogue's time is the first published set of the first body under
  the parent's launch numbered above the highest designated number a day
  before the window, read from the event's own year. A year stripped from
  a bundle has no publication times: its order is the bundle's, which is
  the catalogue's, and its clock is the latest epoch seen so far, a lower
  bound, leaping at most a day on any one set; the result says so.
- The years are replayed in order and the states carried from each into
  the next, since from the second phase the detector's verdict depends
  on the object's own record of steps over two years: a year replayed
  cold would raise every object's first step of the year as unique.
  `npm run kpi -- --all` replays the sequence and leaves each year's end
  states as a working file under `kpi/work/states/`; a year replayed
  alone starts from the file its predecessor's replay left, which gives
  the same result as the sequence, and where there is none from the
  previous year's last sixty days, in which case its file says so and
  its score is a check, not the record. The KPI workflow replays the
  years in order in one job for the same reason.
- The false-alarm rate divides by false alarms plus detections on every
  line, and a second alert on the same object whose bracket overlaps an
  earlier alert's is the same step raised again, a duplicate, since the
  unit the owner counts is the step.
- A year's file is written gzipped and is not committed. The detector
  raises every persistent step on every object as a verdict, a working
  payload's manoeuvres included (as `manoeuvre`, which the scorecard
  counts as nothing), so a year holds tens of thousands of verdicts and
  log rows: tens of megabytes as plain text, a few compressed, and
  eighty megabytes a run over the years, which the first phase committed
  once and which from the second phase stays out of git (`kpi/years/` is
  ignored): the KPI workflow carries the year files as artifacts of the
  run, and `npm run kpi -- --all` makes them again. Only the aggregate,
  `kpi/latest.json` and `kpi/latest.md`, is committed. The log keeps one
  row per candidate, written when it closes, with the step's trajectory
  over the first post sets, the impulse it implies and the object's
  history at it, which is what the offline sweeps re-threshold.
- A verdict of `manoeuvre` is terminal and counted as nothing: not an
  alert, not a false alarm. A reported breakup whose parent's step was
  read as a manoeuvre is a miss, which is what the detection rate must
  show.
- A confirmed verdict on a step already alerted is the fragments' or a
  notice's confirmation of that alert, not a second alert: the matcher
  lands it as a confirmation, records on the alert when it came, and the
  cells count how many alerts were confirmed, how many of those had
  matched a reported event, how many an exempt window, and how many
  nothing (a wrongly confirmed false alarm), with the median days from
  the alert. A cloud verdict (a burst of new bodies under a launch with
  no step on any parent) goes to the review list with its launch, the
  parent its pieces attach to and their count; it is never a detection.
- The precision per persistence tier is read off the alert rows of the
  log: once raised, an alert keeps reading the object's sets against the
  frozen pre-step model and records whether the step still held after
  three and five post sets and after one, three, five and seven days,
  and when each tier was reached. For each tier the cells give the
  alerts that held, the detections that would still have beaten the
  catalogue had the alert waited for the tier, the false alarms left, and
  the lead; so the owner can trade timeliness against false alarms with
  the numbers in hand, without a replay per tier.
- The catalogue's mark follows the catalogue's publication order, by the
  replay's clock, not a body's earliest set epoch: a yearly bundle lists
  old debris catalogued in August with set epochs from January, and a mark
  read off those epochs sat above a breakup's real pieces for months
  (Cosmos 2392's ullage motor in 2005: the catalogue's time read ninety-
  seven days after the event instead of thirty-two), and a fragment's
  first set is dated by the same clock, since a newly catalogued piece's
  first sets carry back-filled epochs from before it appeared (the same
  motor's pieces, catalogued on 3 July with epochs from early June). The
  clock is the latest publication bound seen so far in publication order,
  a lower bound of the true time where the year has no publication times,
  and it is what the detector saw. `npm run kpi -- --rematch` scores the
  year files present again from their verdicts without a replay, so a
  change to the matching rule never needs one.
- The confirmed line is its own block: of the targets the catalogue itself
  reported (new bodies under the launch within ninety days of the event),
  how many were alerted and how many confirmed, and the days from the
  event and from the alert; of every alert confirmed, how many were on a
  reported event's step, how many on the parent of a reported event whose
  window ended within the month before the step (the right object named
  late, which the product would show as that object's breakup, noted on
  the alert but counted as a false alarm by the step), and how many on
  nothing; and how many confirmations came before an agency's statement
  where the truth dates one, which it does for the notices alone, since
  the agencies' publication dates are not otherwise in the truth.
- The per-event dissection (`docs/detector/events.md`) is written with the
  aggregate: one row per scoreable event with the matcher's outcome and
  the cause read off the detector's own log for the parent around the
  window, by the rules the first three phases' dissections established by
  hand, so a change to the detector shows, event by event, what it moved.
- The replay's speed is the tooling's, never the record's. A year's
  columns are kept unpacked after their first read
  (`<archive>/.decoded/<year>/`, each keyed by the year's build time and
  the column's hash, so a rebuilt year is unpacked afresh), which changes
  no byte a replay reads: the sequential replay made `kpi/latest.json`,
  `kpi/latest.md` and the dissection again to the byte with the cache, in
  twenty-one minutes against twenty-two and a half without. The parallel
  exploration mode (`npm run kpi -- --all --parallel N --out <dir>`)
  splits the years into contiguous chunks replayed at once, each after the
  first starting from the states a full sequential replay left at its
  boundary (`kpi/work/states/`, or `--from-states <dir>`). That is the
  rule above for a year replayed alone, applied to files an earlier run
  wrote: with the detector that wrote them it makes the sequential
  aggregate again to the cell (measured in four, six and eight chunks),
  but with a changed detector it is exact only where the change leaves the
  states at the boundaries untouched. A change that moves them (an
  object's record of steps, a launch's remembered cloud) reaches each
  chunk's first years through the old detector's states, much as a
  warm-up does: with the persistence threshold raised
  (`--param zPersist=12`), four chunks against the sequence with the same
  change left every detection and the Confirmed line as they were, but
  138 cells of the step alerts' counts off, the validation split's false
  alarms 2076 against the sequence's 2086 where the change itself had
  moved them from 2503. The mode therefore marks its aggregate
  `exact: false` with where its states came from, refuses to write to
  `kpi/`, and the committed results and the KPI workflow keep the
  sequential replay: a change found by exploring is replayed in order
  before it is committed.
- The scorecard reads every year's catalogue from an index built from
  the whole Archive, never from the years on disk. From the ninth phase
  the matcher read the catalogue over every year (which reported events
  gained fresh pieces in their parent's plane, the parent's last set
  before the event, when the first piece was published, the high-water
  mark), and from the eleventh the detector was given its reentries from
  it. The KPI workflow keeps a year and the one before it on disk, so it
  scored each year against the catalogue of those two and failed on every
  commit from the ninth phase: on the eleventh's it read the held-out
  Confirmed headline as 19 targets, 11 with no fragments catalogued and
  14 confirmed, where the committed file says 23, 7 and 17, and the
  detector's own verdicts moved with the reentries it was given. `npm run
  kpi:index` reads the
  whole Archive once, in half a minute, into
  `<archive>/index/catalogue-index.json.gz` (1.9 MB gzipped): one row per
  body, 58,674 of them (its number, launch, name and class, its decay and
  launch days, its first publication by the replay's clock, its earliest
  set's epoch and the orbit the plane test reads), from which the
  launches' bodies and the mark are made as the whole read makes them.
  The parent's last set before an event may lie in any year, in a later
  year's back-filled sets or years back, and answering it for any body at
  any time would want every set of every year, so the index answers it at
  the instants the truth asks: one row per truth row with a parent (2,289),
  the parent's last set before the row's window opens. Its builder reads
  every row back through the JSON before writing it and refuses a fact
  that does not come back to the bit. The index records each year's build
  time, and a reader refuses it where a year on disk is missing from it
  or was built at another time, where a year not on disk was released at
  another time than the release's manifest the last download fetched
  says, and where the truth has a row with a parent the index was not
  built for; without it the scorecard refuses, rather than read a part of
  the Archive as the whole. It is rebuilt whenever a year of the Archive
  is built again or added, or the truth gains a row with a parent or
  moves one's window, and travels with the side files of the release:
  `npm run archive:upload -- --side-only` refreshes them and the manifest
  without the years, and the download verifies that the index it fetched
  describes the released years. The offline sweeps read the same index;
  the truth audit, which wants every set of the bodies it asks for, still
  reads the whole Archive. Read from the index, the sequential replay made
  `kpi/latest.json`, `kpi/latest.md` and the dissection again to the
  byte, and a scratch Archive holding only a year and its predecessor
  with the side files, replayed by the workflow's own commands, made the
  same year files as the whole Archive did.
