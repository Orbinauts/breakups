---
status: accepted; its ESA tables and quarterly-news coverage (issue #20), its same-event rule (issue #18), its confidence (issue #19) and the shape of a window (issue #21) amended on 2026-10-12, and its confidence's authorities on 2026-10-13 (issues #19 and #20)
date: 2026-10-09
---

# The ground truth is generated from its sources, with provenance per field

The truth file, `data/breakups.json`, is built by a script from committed
snapshots of the machine-readable sources (the text of NASA's History of
On-Orbit Satellite Fragmentations, GCAT's Space Debris Clouds table) and
from a hand file of statements typed from the sources that have no
machine-readable form (NASA's quarterly news, a Space Forces notice, ESA's
annual report, named analysts, news reports, the catalogue itself). Each
event keeps every source's statement verbatim, resolves each field by a
fixed order of sources, records which source each field came from, lists
every disagreement, and names the reviewer's overrides it was built under.
The full history is kept; the scorecard runs from 2005, where the yearly
element bundles begin.

The reason is reviewability. A hand-typed list of three hundred rows is
reviewed once, by its typist; a generated one is reviewed on every
rebuild, as a diff of the file and of its report, and a parser that
misreads a form fails loudly on the snapshot rather than silently on one
row. Keeping every statement verbatim means a reader can check any number
against where it was read, and a disagreement between sources is a fact of
the file rather than a choice hidden in it.

What an event is follows the owner's definition: a breakup that was
reported, so we are sure it happened, where "reported" includes the public
catalogue listing new objects under the parent's launch even when no
agency wrote the event up.

## Considered options

- A hand-typed list, as the first attempt had: quick, and wrong in ways no
  one sees.
- Generated from the machine-readable sources alone: reproducible, but
  blind after NASA's 2022 cut-off and to everything only the news reports.
- Generated from snapshots plus a cited hand file plus named overrides
  (chosen).

## Consequences

- `data/breakups.json` and `docs/truth.md` are never edited by hand; a
  test rebuilds both from the inputs and fails on any difference.
- A new edition of a source is a new snapshot, fetched by one script,
  whose hash the sources record keeps, so the change is visible.
- Every date and time form the sources use is listed in the parser; a
  form not listed throws, so a new edition cannot slip a date past the
  build unread.

## As built

The sources the build reads, as of the twelfth phase: NASA's history from
its text, GCAT's Space Debris Clouds from its table, GCAT's satellite
catalogue from its tab-separated file, the hand file, and the catalogue's
own bursts read from the Archive (`data/truth/catalogue.json`).

GCAT's satellite catalogue was added in the twelfth phase
(`docs/detector/d12-confirmed.md`) by the coordinator's decision under the
owner's delegation: the eleventh phase had found it dating debris for
parents of the detector's false confirmations, and entering those rows one
by one, after the held-out years had been read, would have chosen the
truth by the detector's errors. It is read instead uniformly, every
catalogued fragment and component with a parent and a separation date, in
every year, by a rule written in the parser and in `docs/truth.md` before
any re-scoring: pieces of one parent separated within three days of each
other are one separation, its kind the pieces' GCAT type (fragmentation
debris a breakup, anomalous debris an anomalous event, an aerodynamic
breakup aerodynamic, components and the rest a release), a release at
launch left out as the launch's own staging. Its statements join the other
sources' events by the build's thirty-day rule and stand only where no
other source states the event; an event it alone states is of confidence C,
or D where GCAT dates it to a year. The whole file is some twenty megabytes,
so the committed snapshot keeps the rows and columns read, every kept cell
verbatim, and the sources record holds the whole file's hash beside the
snapshot's, as it holds the PDF's beside the text of NASA's history. GCAT's
pages documenting the columns and codes are kept beside it.

It took the truth from 599 events to 2,433 (from 2005, 248 to 623, of them
363 scoreable). The events reported to the day or better by an authority,
the headline's, are unchanged; the hand row the eleventh phase had typed
from the same catalogue (Yaogan-6, 2014) is now the parser's and was
removed.

## Amended on 2026-10-12: ESA's tables by a rule, and the quarterly news checked whole

Issue #20 found the truth thin in its recent years: only the 2025 edition
of ESA's Space Environment Report was read, as five unnamed hand rows,
and nothing showed whether a quarter with no quarterly-news row had been
read. Both are now inputs of their own.

ESA's tables of every edition from 2017 to 2026 (the fragmentations of
2016 to 2025, 75 rows) are typed as printed into
`data/truth/esa-ser.json`, each edition with its address and hash. ESA
names no object, and placing a row by hand would choose it one reading
at a time, so the build places every row by one rule, written before any
re-scoring (`scripts/truth/parse-esa-ser.ts`): a row joins the one event
the other sources date within a day of its epoch, in a regime its orbit
class allows and of a class its object type allows, an event one row
alone can be being taken from the others' candidates; a row with no
candidate is an unnamed event; a row with several is placed nowhere and
listed in `docs/truth.md`. A nearer day breaks no tie: ESA's epoch and
another source's day differ by one in several rows the sources agree on
otherwise. A row whose object a cited report names carries that parent
(two of 2024, named by s2a systems' observations as SpaceNews quoted
them). An unknown cause in ESA's table states none, so it never outranks
a cause another source names. A row the rule places names no object, so
it is ESA's word on a day and an orbit class, not on the event's object:
it dates and corroborates the event it joins, but it is no authority for
the event's confidence and no first agency notice for the lead (see the
amendment on the confidence below). The truth went from 2,433 events to 2,444
(from 2005, 623 to 634, of them 365 scoreable); 48 rows joined an
event, 14 are unnamed events and 11 are placed nowhere.

Every issue of NASA's Orbital Debris Quarterly News since 26(3) is listed
in `data/truth/odqn-coverage.json` as cited by the hand file, read with no
breakup items, never published or unread, and a test fails on a hole in
the list or a disagreement with the hand file's citations.

## Amended on 2026-10-12: one source's two instants are two events

The thirty-day rule merged any two statements of one parent within a month
into one event, even where one source stated two distinct instants: NASA's
history lists ALOS-1's stage twice (8 August 2006, 14:07, "Event 1 of 2",
and 27 August, 16:18, "Event 2 of 2"), and the truth held one event dated
to the first, the detector's confirmation of the big second cloud scored
against it with a nineteen-day timing error. Issue #18.

The rule now reads (`groupStatements`, `distinctInstants` in
`scripts/truth/build-truth.ts`): statements of one parent within thirty
days are one event, except that two instants one listing source states
more than a day apart, both to the day or finer, are two events. The
listing sources are those that list each event once: NASA's history,
GCAT's cloud table and its satellite catalogue (each apart), the quarterly
news, the notices and ESA's report. Every other statement joins the
nearest instant (by the gap between the windows, then between their
middles), so the order the sources are read in does not decide it. The
news and the analysts gather many outlets under one name and the
catalogue's bursts are windows, so neither splits an event; nor do
aerodynamic breakups and releases, out of the denominator either way
(NASA's aerodynamic table is read twice where its cells wrap, and a
station's releases come weeks apart). A reviewer's merge is not split.

The review proposed also merging across sources only where one states no
instant finer than the month. That was not taken: two sources that both
state the day disagree on one event by days in the sources, not on two
events (NASA's 12 August 2019 at 13:58 and GCAT's 19 August at 13:58 for
Cosmos 2464-2466's ullage motor, the same minute a week apart), and
splitting them would add events no one reported. They stay one event, the
disagreement a conflict, as before.

From 2005 the rule adds two scoreable events (ALOS-1's stage on
27 August 2006, confidence A; Cosmos 2392's ullage motor's second
separation of 30 June 2005, 55 pieces, confidence C) and one exempt
release (the station's of 22 July 2009); before 2005 it splits Cosmos 1355
(1984), Cosmos 2227's stage (1992), Cosmos 1261 (1981) and Cosmos 2399
(2003).

## Amended on 2026-10-12: the confidence is read from the best statement

The confidence was read from whichever statement won the event's time, so
where GCAT's cloud table stated the minute and NASA or the quarterly news
the day, the event took GCAT's grade, C, and an agency's report left the
headline (the Atlas V Centaur of GOES-17, 2024, and Orbcomm FM 36, 2023,
both dated to the day by the quarterly news). Issue #19.

The time still comes from the statement that states it most finely, an
authority first on a tie; the confidence now comes from the event's best
statement (`gradeOf`, `confidenceOf` in `scripts/truth/build-truth.ts`):
an authority's minute A, its day or a window of three days at most B, any
coarser time it states C; a named analyst's dating C; a company's measured
instant a report quotes to the minute C, as an analyst's (s2a systems'
optical timing of Luch, which was D for being a news report, ranks with
Jim Shell's dating of Meteor 2-7); GCAT's date to the month or finer C;
anything else D. A company's instant ranks below an agency's because it
is not an agency's word (the seventh decision record's lead is read
against agencies only), and with an analyst's because both are a
measurement from outside the agencies, cited.

An authority counts as one only where its statement names the event's
object (`isAgencyWord` in `src/truth.ts`): an ESA row naming no object,
which the build placed on the event by its own rule (above), is the
build's inference, not ESA's word on the object. It still dates the event
and stands beside the other statements, but it grades as an unnamed
statement does (D), the lead readers (`firstAgencyStatement`,
`firstAgencyNotice`) leave it out, and the published files list it among
a breakup's reports but are never confirmed by it.
A row a cited report names, and a row ESA left unnamed (an event of its
own), are ESA's word. From 2005 this moves 2 scoreable breakups from B to
C, each then graded by GCAT's day: the Centaur AV-018 of 25 March 2019
(`35816:2019-03-25`) and Intelsat IS-29e of 7 April 2019
(`41308:2019-04-07`).

From 2005 it moves 14 scoreable events from C to B, the 7 breakups the
review named (DMSP 5D-3 F17's stage, Beidou 1D's, USA 197's, SL-23
debris in 2020, Orbcomm FM5, Orbcomm FM 36 and GOES-17's Centaur) and 7
anomalous events (BLITS, Iridium 91, WorldView-2, RISAT-1, USA 106,
AMC-9, GOSAT-2's stage debris), 3 exempt aerodynamic events with them,
and 2 from D to C: Luch, and Starlink-34343, which LeoLabs dated to the
day and GCAT's satellite catalogue dates too.

## Amended on 2026-10-12: the shape of a window

Some rows were kept in or out of the denominator by the shape of their
window rather than by a rule (issue #21). The build now reads a window so
(`clampedToLaunch`, `windowReasonOf` and `idOf` in
`scripts/truth/build-truth.ts`, `yearOf` in `src/truth.ts`):

- A window a coarse date opened before the parent's launch (a day of
  GCAT's widened by a day either side, a month) starts at the launch day.
  From 2005 that moves seven windows' lower edges by a day, and their ids
  with them.
- A breakup or anomalous event of a catalogued parent whose window is
  wider than 93 days, or has no lower edge, is kept out of every line with
  that reason: GCAT's "2023?" widens to three years, and a confirmation
  anywhere in three and a half years would count. Ninety-three days keeps a
  stated month widened a month either side. From 2005 twelve scoreable rows
  leave the denominator (three Meteor-2 rows of 2023 among them); the
  results page lists them.
- An event's id and the year it is counted in are its instant's day where
  it states one, else its window's lower edge: PSLV-C37's stage, which GCAT
  dates "2018 Jan 1 0000?", was a 2017 event by the minute before midnight
  and is now `42052:2018-01-01`.
- A reviewer may set the lower edge of a merged event whose statements
  give none, with its reason (`from` on an override). Yaogan-50 02's row
  had none, so the scorecard read it as no window; it now opens where the
  catalogue's own burst rule opens the same pieces' window, sixty days
  before the first piece's first set (`yaogan-50-02-lower-edge`), and its
  id is `68196:2026-07-01`. The edge is the catalogue's, not the
  detector's estimate.

The same issue's last item, the regimes: GCAT's satellite catalogue and the
catalogue's bursts state no orbit, so most of their rows had the regime
"unknown" (202 of the 353 scoreable rows from 2005 before this change).
A row whose statements give no orbit now takes its parent's regime at the
event, the detector's filing of the parent's last set before the window,
from a file derived from the Archive and committed beside the sources
(`data/truth/regimes.json`, `npm run truth:regimes`, `scripts/truth/regimes.ts`):
for each such parent, the runs of one regime over every set the Archive
holds of it, so a moved window is read again without the Archive. The
build reads the file, never the Archive, and stays reproducible from the
repository alone; a parent the truth gains keeps "unknown" until the file
is derived again. From 2005, 180 scoreable rows take a regime so, and 22
stay unknown (parents with no set before the event).
