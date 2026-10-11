# The twelfth phase: GCAT's satellite catalogue as a source of the truth, and the stage preferred over a working payload

The eleventh phase left the Confirmed line at 22 of 35 headline breakups confirmed on the training years (63%) with 3 false confirmations (8%), and 17 of 23 on the held-out years (74%) with 9 (31%). It also found that GCAT's satellite catalogue dates a separation of debris from the parents of four of the nine held-out false confirmations. Entering those four one by one, after the held-out years had been read, would grade the detector by choosing the truth for its own false alarms. The coordinator decided instead, under the owner's delegation (the plan's item 15), to read GCAT's satellite catalogue as a source of the truth uniformly: every debris object with a parent and a separation date, every year, by one rule written before any re-scoring and with no regard to the detector. The same decision named one detector change to try on the training years alone: the stage preferred over a payload that was operating at the time. This note records both, the choice frozen with its time, and the one reading of both splits after it.

## The discipline, and what this re-score is

The held-out years were read in the eleventh phase. This phase's re-score of them is therefore not a fresh blind validation: it is a measurement of the frozen detector under a truth extended uniformly, by a rule that does not look at the detector. Everything up to the freeze below was designed and fitted without any odd-year outcome of this phase: the truth's rule was written from GCAT's documentation and its data before any replay or rematch was scored, and the stage rule was read on the training split alone, with the training-only reader (`kpi/work/train11.ts`), the replays' consoles written to logs that were not opened.

## Part 1: GCAT's satellite catalogue

### The source

GCAT's satellite catalogue, `satcat.tsv` (Jonathan McDowell, planet4589.org, CC-BY-4.0), fetched on 2026-10-10 by `npm run truth:fetch -- --only gcat-satcat,…` (the file headed "Updated 2026 Oct 9 1800:46"; 19,296,210 bytes, SHA-256 `7c242e30…`). The whole file has some 70,000 rows and 42 columns; the committed snapshot, `data/truth/sources/gcat-satcat.tsv` (4.3 MB), keeps the rows typed as a component or fragmentation debris and the rows they name as parent, in the eleven columns read, every kept cell verbatim (`reduceSatcat`; reducing the snapshot again changes nothing, which a test checks). `data/truth/sources.json` records both hashes. GCAT's pages documenting the columns (`web/cat/cols.html`), the SatType codes (`web/intro/type.html`), the phases and status codes (`web/intro/phases.html`) and the vague-date form (`web/intro/vague.html`) are kept beside it as served.

The fields read: `JCAT` (the object's identifier), `Satcat` (its catalogue number), `Launch_Tag` and `Piece` (its launch and designator), `Type` (the SatType string: its first byte the coarse type, `P` payload, `R` stage, `C` component, `D` fragmentation debris; its fourth the subtype), `Name`, `LDate` (launch day), `Parent` (the object it separated from, an extended JCAT identifier, `S` for the standard catalogue and `A` for the auxiliary one, an asterisk marking a launch the designator does not give), and `SDate` (the separation date, GCAT's vague date). `DDate` and `Status` (the end of the piece's phase: reentered, in orbit and so on) are kept and not read: they say how the piece's phase ended, not how it began.

### The rule (`scripts/truth/parse-gcat-satcat.ts`)

1. A piece is a row typed as a component (`C`) or fragmentation debris (`D`), whose parent is a standard-catalogue object (`S` and its number) or an auxiliary-catalogue object (`A`, an object the US catalogue does not list apart, such as a stage that stayed attached), and whose separation date is stated.
2. Its kind is its type's. Fragmentation debris is a breakup, with the cause its subtype names: `P` propulsion, `B` battery, `I` an accidental collision, `W` a weapons test, `Z` a destruct device; `G`, `X` and none name no cause. Anomalous debris (`J`, insulation, soft or ablated material, on debris or a component) is an anomalous event. An aerodynamic breakup at low perigee (`Q`) is aerodynamic, kept out of scoring. Solid-motor slag (`K`), reactor coolant (`N`), debris released at orbit insertion (`O`) and every other component (fairings, adapters, jettisoned motors and tanks, despin weights, ejection mechanisms, a station's jettisoned items) are a release of objects, kept out of scoring.
3. A release separated by the end of the day after its launch day (`AT_LAUNCH_DAYS`, 1) is the launch's own staging and deployment, not an event in orbit, and makes no statement: 5,011 rows. A breakup or an anomalous event at launch is kept, since stages do break up within hours of launch. A separation dated wholly before its parent's launch is a slip in the catalogue and makes no statement (2 rows, ESSA 9's despin weights).
4. The pieces of one parent (a standard-catalogue parent by its number, an auxiliary-catalogue one by its launch, as the truth keys a parent it cannot number) whose separation windows overlap or lie within `SAME_SEPARATION_DAYS` (3) of each other, chained in the order of their lower edges, are one separation. Three days is the width GCAT's own `?` gives a date stated to the day (the day and one either side), so two pieces GCAT dates a day or two apart are one event, and pieces a week apart are two.
5. A separation makes one statement: source `gcat`, its reference naming the snapshot, the parent and the pieces' numbers; its date the separation date GCAT states for most of its pieces (a tie to the finer, then the earlier), read with `parseVagueDate`; its kind the first of breakup, anomalous, aerodynamic and release among its pieces; its cause the one its pieces' subtypes name, where they name one only; its count its pieces. The parent's GCAT type and launch day are written into the note so the truth reads the parent's class and launch from them.

The statements then join the other sources' events by the build's own rule (`build-truth.ts`: the same parent, windows within thirty days). Where another source states the event, that source's instant, kind, orbit, cause and count stand, and the satellite catalogue's statement is kept beside them with its disagreements listed as conflicts: the catalogue dates every piece, often to a month, and is a statement of the pieces rather than a write-up of the event. It ranks after the news and before the catalogue's own bursts, so it dates and names a burst no one else reported. An event it alone states is of confidence C where GCAT dates it to the month or finer, D where to a year only. An exempt launch's events (the station's, Shenzhou-12's and -14's) that only the catalogues state stay exempt.

### What it adds

2,387 statements over every year (3,345 parent rows read to name the parents; 29 pieces whose parent is a body name or another catalogue's left out). The truth goes from 599 events to 2,433, and from 2005 from 248 to 623, of them 363 scoreable (175 before). The events from 2005 the satellite catalogue alone states (with at most a catalogue burst beside it), by year and kind, and the events of other sources it joined:

| Year | Breakup | Anomalous | Aerodynamic | Release | Scoreable | Joined |
| --- | --- | --- | --- | --- | --- | --- |
| 2005 | 2 | 1 | 0 | 7 | 3 | 5 |
| 2006 | 5 | 8 | 0 | 17 | 13 | 11 |
| 2007 | 2 | 8 | 0 | 9 | 10 | 9 |
| 2008 | 1 | 5 | 1 | 5 | 6 | 4 |
| 2009 | 9 | 19 | 2 | 12 | 27 | 5 |
| 2010 | 4 | 5 | 0 | 6 | 9 | 8 |
| 2011 | 3 | 6 | 1 | 7 | 9 | 5 |
| 2012 | 1 | 9 | 0 | 6 | 10 | 5 |
| 2013 | 1 | 3 | 0 | 6 | 4 | 3 |
| 2014 | 5 | 6 | 0 | 8 | 11 | 12 |
| 2015 | 1 | 3 | 0 | 3 | 4 | 9 |
| 2016 | 2 | 1 | 0 | 4 | 3 | 8 |
| 2017 | 4 | 15 | 0 | 5 | 19 | 1 |
| 2018 | 3 | 3 | 1 | 6 | 6 | 7 |
| 2019 | 8 | 9 | 1 | 9 | 17 | 9 |
| 2020 | 7 | 9 | 1 | 3 | 16 | 5 |
| 2021 | 3 | 2 | 1 | 9 | 4 | 8 |
| 2022 | 3 | 0 | 0 | 17 | 3 | 5 |
| 2023 | 6 | 2 | 0 | 17 | 7 | 6 |
| 2024 | 6 | 4 | 0 | 16 | 6 | 4 |
| 2025 | 3 | 0 | 0 | 6 | 2 | 0 |
| 2026 | 3 | 0 | 0 | 5 | 3 | 3 |
| All | 82 | 118 | 8 | 183 | 192 | 132 |

The scoreable ones are of confidence C (182) or D (10, dated to a year); none is on the headline line, which reads breakups reported to the day or better by an authority. Of the 199 kept out, 183 are releases (35 of them the station's, 4 a crewed spacecraft's), 8 aerodynamic breakups, and 8 breakups and anomalous events of an auxiliary-catalogue parent, which has no catalogue number.

**Merges.** The satellite catalogue joined 132 events of other sources from 2005 (389 over every year): NASA's, GCAT's clouds, the quarterly news and the hand rows, where it adds a statement and changes no resolved value but, on 11 events, the parent's class (GCAT's type for a name the build had guessed: nine H-IIA, Delta and Long March stages and Artemis I's ICPS read as payloads before, VESPA now debris) and, on 8, a cause where no other source stated one (52 classes and 30 causes over every year). It also dated fifteen events the catalogue's bursts alone had reported, which take GCAT's date and kind and its confidence C instead of D: among them Meteor 2-7's 2010 burst (GCAT: battery debris, `2010 Aug?`), Resurs O1's of 2010 and 2012 (anomalous debris), ERS 1's of 2009 (anomalous), and four launch-only bursts of Long March and Delta stages (GCAT: components, so releases, now exempt). Yaogan-6's anomalous event of about July 2014, which the eleventh phase entered by hand from this catalogue, is now the parser's (S34839, pieces 40065 to 40068, `2014 Jul?`, anomalous, confidence C), and the hand row is removed; its reference named the same rows of the same catalogue.

**Conflicts.** Of the events it joined from 2005, 66 disagree with it, every one listed in `docs/truth.md`. On the 88 headline breakups: 14 instants more than ten minutes apart, 18 different days, 37 different causes (GCAT's subtype against NASA's assessed cause) and one parent (an event an override merges over two bodies); on the rest, 2 instants, 5 days, 9 causes, 2 parents. In every one the other source stands.

**The headline is unchanged.** The 88 scoreable breakups of confidence A and B from 2005 are the same events with the same windows as in the eleventh phase; the satellite catalogue adds targets on the lines apart (breakups C and D, anomalous events) and, by the matcher's rule, turns a confirmed verdict on a parent within 180 days after one of its new events from a false confirmation into a detection of that event, or into an exempt one inside a release. One headline event has a later event of its own parent within the 180 days a confirmation may follow it: Cosmos 2417-2419's ullage motor (28920), breakup of 24 August 2018, and a second separation GCAT dates to November 2018; a confirmation after the second lands on it, as the matcher lands a verdict on a parent's latest event.

The package's truth file grows from 1.6 MB to 5.9 MB.

## Part 2: the stage preferred over a working payload

The eleventh phase built the stage preference (`attributionPrefersStage`): where an attribution's pieces share the plane of a body of a better rank than the one their centre named (a rocket body before any other body, a body not operating at the time before a payload operating at it) and the pieces' centre cannot tell the two apart within a factor of three, the better-ranked body is named. On the training years it renamed no confirmation and broke one tie the wrong way: twins of the Iridium 33 collision cloud's launch, where it preferred a dead payload (Iridium 28) over a working one, with no event. It was left off.

The narrower form tried here (`attributionPrefersStageOverWorking`), decided by the coordinator before any odd year of this phase was looked at: the preference applies only between a launch's rocket body and a payload that was operating at the time by its dated status (`operationalAt`), and names the rocket body; among twins no step tells apart, a rocket body is named before payloads that were all operating. Every other tie (a dead payload against a working one, a stage against a dead payload, two stages) is left as the tenth and eleventh phases resolve it. The factor is the eleventh phase's, 3. The prior behind it is the eleventh phase's base rates: a rocket body in orbit since 2005 has had a reported breakup three to six times as often as a payload, and of the 75 payload breakups from 2005 only five were on a payload operating at the time. A test in `src/detector.test.ts` ("in its narrower form …") builds the case: a payload and its stage ten kilometres apart in one plane, pieces centred on the payload; the stage is named where the payload was operating, the payload where it was not.

### On the training years

Two replays in the parallel exploration mode from the same starting states (`kpi/work/states`, the eleventh phase's committed sequential replay), both scored against the extended truth: the defaults (`kpi/work/d12-base`) and the narrower rule on (`kpi/work/d12-stage`). Read with the training-only reader (`kpi/work/train11.ts`) and a training-only diff of the Confirmed landings (`kpi/work/train12.ts`, which never opens an odd year's file):

| Replay | Confirmed of 35 | Recall (95%) | False confirmations | False-alarm rate (95%) | Events confirmed, every line |
| --- | --- | --- | --- | --- | --- |
| The eleventh phase's iteration 3 (`kpi/work/d11-c`), its own truth | 22 | 63% (46% to 77%) | 3 | 8% (3% to 22%) | 33 |
| Defaults, the extended truth (`d12-base`) | 22 | 63% (46% to 77%) | 2 | 6% (2% to 18%) | 34 |
| The stage over a working payload (`d12-stage`) | 22 | 63% (46% to 77%) | 2 | 6% (2% to 18%) | 34 |

The extended truth alone removes one training false confirmation: Cosmos 2528's single piece of January 2020 now lands on the separation GCAT's satellite catalogue dates `2019 Dec?` (two pieces, a breakup of confidence C). The two left are the eleventh phase's Breeze-M fragment (2012, three pieces of the stage's own 2010 cloud) and the ullage motor 33384 named for its twin's pieces (2014). The other lines' targets grow with the truth (training: breakups C 20, D 8, anomalous A and B 4, anomalous C and D 31).

The narrower rule leaves every training landing identical. It acted: on 30 attribution rows of the even years it renamed the body from a working payload to the launch's rocket body (14 bodies, among them CZ-6A's stage of the Qianfan launch in August 2024, a headline breakup, on rows refused because its launch was three weeks old), but every one of those rows was refused by another rule, most by the young launch's (the launch's own objects in its first weeks), the cataloguing batch and the fewest pieces, so nothing was raised that was not raised before. Training does not get worse, so by the criterion decided before the look the rule is kept. It is kept on its prior alone: the even years neither support nor contradict it, and it was named as a lever on two of the eleventh phase's held-out misses (pieces judged for a payload rather than its stage), which is why it was tried; that the held-out years motivated the choice of what to try is stated here as part of the record.

## The frozen choice

Frozen at **2026-10-11T00:13Z**, before any odd year of a twelfth-phase replay or rematch was read: the truth as built above (GCAT's satellite catalogue read by the stated rule, `SAME_SEPARATION_DAYS` 3, `AT_LAUNCH_DAYS` 1; 2,433 events); the detector `confirmed-v10`, the eleventh phase's `confirmed-v9` with `attributionPrefersStageOverWorking` on (`attributionPreferCentreRatio` 3, `attributionPrefersStage` off) and every other value unchanged. The committed replay is the sequential one of these defaults, `npm run kpi -- --all`.

## The re-score, read once

The committed replay (`npm run kpi -- --all`, `confirmed-v10`, sequential) wrote every year; the process then ran out of its default heap while folding them, holding the last year's states beside the twenty-two year files and the larger truth, and the aggregate was folded again alone (`npm run kpi -- --aggregate`, which fits the default heap at about 3.2 GB, as CI runs it). The `kpi` script now gives Node 8 GB. Read on 2026-10-11 at 00:40Z; nothing was changed after this reading. The training numbers are the trial replay's to the last confirmation.

| Split | Targets | Confirmed | Recall (95%) | False confirmations | False-alarm rate (95%) | Lead over the first agency statement, days: median (10th percentile) | Before it | Lag after the first fragment, days: median (90th) | Timing error, minutes: median (90th) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Training (even years 2006 to 2026) | 35 | 22 | 63% (46% to 77%) | 2 | 6% (2% to 18%) | 35.7 (−32.2) | 14 of 21 | 0.1 (5.9) | 1,126 (173,292) |
| Validation (odd years 2007 to 2025) | 23 | 17 | 74% (54% to 87%) | 6 | 21% (10% to 38%) | 41.7 (9.8) | 17 of 17 | 0.1 (4.0) | 41 (21,342) |
| To 2017 (from 2006) | 29 | 23 | 79% (62% to 90%) | 6 | 16% (7% to 30%) | 37.2 (−15.2) | 17 of 22 | 0.1 (0.1) | 583 (118,847) |
| From 2018 | 29 | 16 | 55% (38% to 72%) | 2 | 7% (2% to 23%) | 40.2 (−24.5) | 14 of 16 | 0.1 (17.2) | 73 (40,265) |

With the twins matched at the launch every split reads the same. The false-alarm rate is over the events confirmed on every line, which the extended truth raises (validation 23 from 20, training 34 from 33). The scorecard counts an event in the year its window begins, so a vague date can carry a verdict's event across the splits: Cosmos 2528's training-year verdict of January 2020 confirms an event of 2019 (`2019 Dec?` begins in November), counted on the held-out split's lines apart, and Cosmos 1461's held-out-year verdict of January 2009 an event of 2008, counted on the training split's.

The other lines, which the extended truth fills: on the held-out years breakups of confidence C 3 of 18 confirmed, D 0 of 6, anomalous events A and B 0 of 5, C and D 3 of 46; on the training years 4 of 20, 1 of 8, 2 of 4 and 4 of 31. The parent-step line is as before on the headline (held-out 10 detected, 2 late, 16 missed of 28; training 18, 5, 20 of 43) at 2,448 and 2,906 false alarms (the eleventh phase's 2,502 on the held-out years: the new events' windows make some exempt or detections); the scoped line 3 of 21 at 52 false (95%) held out, 4 of 25 at 26 (84%) in training.

### The held-out false confirmations, six

Three of the eleventh phase's nine are now confirmations of events GCAT's satellite catalogue dates, on the lines apart: Cosmos 1461 (14064, five pieces attributed on 2009-01-16; GCAT's separation `2009 Jan?`, a window from December 2008 that the scorecard counts in 2008, a training year, as it counts every event by its window's lower edge), Nimbus 2 (2173, five pieces attributed on 2011-11-21; `2011 Apr?`, anomalous) and Meteor 1-5 (4419, four pieces confirming a step on 2023-11-24; `2023 Nov?`, anomalous). The six left:

| Raised | Object | Launch | Class, path | Pieces | What it is |
| --- | --- | --- | --- | --- | --- |
| 2007-08-14 | 29394, the H-2A stage of IGS 3A | 2006-037 | rocket body, attribution | 9 | no source dates a separation from the stage; the eleventh phase's |
| 2009-07-15 | 22676, the SL-8 stage of Cosmos 2251 | 1993-036 | rocket body, attribution | 4 | a tight common origin; NASA lists the stage as not associated with the collision and GCAT gives every piece of the launch to the payload |
| 2015-04-27 | 40362, Yaogan-26 | 2014-088 | payload, step | 4 | pieces GCAT calls the launch's own debris (released at launch, so no statement by the rule) |
| 2015-05-15 | 2173, Nimbus 2 | 1966-040 | payload, attribution | 5 | GCAT dates Nimbus 2's separations to 2011, none to 2015; the 2011 event is now confirmed by the 2011 verdict |
| 2019-10-02 | 37143, the SL-12 auxiliary motor of 2010-041 | 2010-041 | rocket body, attribution | 9 | its twin 37144's pieces of 12 August 2019 named on it |
| 2019-10-18 | 44421, Cosmos 2535 | 2019-039 | payload, step | 2 | GCAT dates its pieces to about 3 August 2019 and NASA the breakup to 9 January 2020; the build merges the two into NASA's event (an override of the first phase), whose window begins after the verdict |

Four are attributions with no step, two confirm a step; three on payloads, three on rocket bodies.

### The held-out misses, six, the eleventh phase's

Arabsat 4's Briz-M (28944, 2007; its pieces judged for the payload 28943, which had reentered in 2006 and is refused as such; the stage rule does not apply, the payload not operating), Cosmos 2139-41's ullage motor (2009, a single piece), Cosmos 2464-66's ullage motor (37144, 2019; one piece in its plane under a remembered cloud, its twin named, the false confirmation above), Cosmos 2424-26's ullage motor (2019, one piece under the velocity floor in a cataloguing batch), Cosmos 2499 (2021, its pieces judged for its sibling 39764) and SSLV's third stage (2023, its pieces judged on the alert path for the payload 55563 and refused as a launch nineteen days old; the stage rule reads the attribution path, so it never weighed them). The stage rule was tried as the lever on the first and the last; it moved neither. On the lines apart, 7 headline events with no fresh piece in the parent's plane within 180 days, 4 with no orbit of the parent before the event.

## The answer

**The target is not reached on either split.** On the held-out years the Confirmed line confirms 74% of the headline breakups whose fragments were catalogued in the parent's plane (54% to 87%) at a false-alarm rate of 21% (10% to 38%); on the training years 63% (46% to 77%) at 6% (2% to 18%). The training false-alarm rate is under one in ten, and its interval's upper end is not; no split's recall interval reaches nine in ten.

The held-out years were seen in the eleventh phase. This re-score is a measurement of the frozen detector under a uniformly extended truth, not a fresh blind validation. Against the eleventh phase the held-out false confirmations fell from nine to six, and all three by the truth: GCAT's satellite catalogue, read for every piece and every year, dates the separations those verdicts found. The rule was written before any re-score and with no regard to the detector, and it adds 192 scoreable events, of which the detector confirms a handful; but it was chosen as a source because the eleventh phase had seen it date four held-out false parents, and that is stated here. One of the four, Cosmos 2535, stays false by the build's merge of GCAT's August 2019 date into NASA's January 2020 event. The detector change, the stage preferred over a working payload, changed no confirmation on either split.
