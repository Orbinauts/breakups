# The eighth phase: the truth audit

The seventh phase found no scope that reaches nine breakups in ten detected at under one false alarm in ten (`d7-scope.md`). One hypothesis was left before the final report: that the truth is incomplete, and that some of the false alarms are breakups the truth misses. The owner's definition of a positive event, in the owner's words, is a breakup "reported, so we are sure it happened; reported can also mean tle data for the fragments were published". The truth adds an event from the catalogue alone only for a burst of five or more new debris objects of one launch within thirty days (`scripts/truth/parse-catalogue.ts`), a sharpening the owner accepted. A breakup whose fragments the catalogue published one to four at a time is therefore a false alarm on the scorecard, whatever happened. This note counts how many of the false alarms are such events.

The answer, in short: almost none. Of the 82 false alarms of the scoped line, none is followed by fresh pieces in its parent's plane that no reported event explains. Of 600 sampled false alarms of the whole catalogue, one is (a single piece under a 1985 Atlas stage's debris), and a hand review of the cases the plane test cannot judge adds one more (Intelsat 29E, April 2019). Counted as positives, they move the whole catalogue's false-alarm rate from 99.6% to about 99% on the held-out years and leave the scoped line's 95% where it is. Truth incompleteness does not explain a material part of the gap to one in ten.

## What was audited

- **Every false alarm of the scoped line** of the committed replay (`scoped-v6`, the year files under `kpi/years/`): 26 on the training years, the even years 2006 to 2026, and 56 on the held-out ones, the odd years 2005 to 2025, as `kpi/latest.md` counts them.
- **A random sample of 300 of the whole catalogue's false alarms per split**, out of 2,965 on the training years and 3,155 on the held-out ones, drawn without replacement by a seeded shuffle (mulberry32, seed 8, the training split drawn first). The shares found in a sample are carried to the split's false alarms with their Wilson 95% intervals.
- **Two control sets**, read by the same rules: the 47 alerts the scorecard landed on a reported event's step (detections and late alerts, 30 training, 17 held out), which say how often a real breakup looks like each class; and the 21 false alarms the detector's own confirmation rules confirmed from the pieces (12 training, 9 held out), which are the false alarms most likely to be real events, since pieces came.

`node --experimental-strip-types scripts/kpi/audit.ts kpi [--seed 8] [--sample 300] [--out kpi/work/d8]` reads the year files and the Archive (about a minute), writes every audited alert with its pieces, statements and class to `kpi/work/d8/audit.json`, and prints the counts and the re-score below.

## How each false alarm was read

**The pieces.** From the Archive's body tables and columns over every year: each body's launch, class, name and re-entry day; when it was first published, by the replay's clock in the catalogue's publication order (as the matcher reads it, so a piece's back-filled epochs do not date it early); and its earliest set's orbit. The high-water mark at an instant is the highest designated number published by then. For each false alarm, the new bodies under the parent's launch are those numbered above the mark at the step (taken the regime's match margin before it, and never below the parent's own number, as the matcher does), first published from the step to 365 days after it; returning old bodies are below the mark and so excluded, and a body with a set more than a day before the step is marked as seen before. Each new body's earliest orbit is tested against the parent's last set before the step by the detector's own plane test (`planeDistance` in `src/fragments.ts`: the inclination difference over 0.2 degrees and the node difference, each node carried at its own J2 rate from the step, over 1.5 degrees, within 3), with the limit on the days since the step raised from 180 to 365; its change of semi-major axis from the parent is read as a tangential impulse (`deltaVOfAxisChange`), and the pieces' median impulse is the cloud's velocity and their spread in semi-major axis the Gabbard spread. The same reading over the year before the step gives the launch's background.

**The statements.** GCAT's debris-cloud table (`data/truth/sources/gcat-debriscat.html`, through `parse-gcat.ts`) and the hand file, for any statement naming the parent or its launch within 180 days of the step; and the truth itself, for any row on the parent or its launch from three years before the step (the truth build's own span for a cloud's late cataloguing) to a year after, and any release the truth exempts on the launch at any time (the station's jettisoned objects).

**The parent's signals**, from the verdict's evidence and the alert's row in the log: the drag term's ratio across the step (folded above one), the kick (the chi-squared of the eccentricity change one tangential impulse cannot explain), the damage ratio (the one-step-ahead scatter in the second to fourth week over the scatter before), whether the step still held at three days and the share of the first jump the later sets kept there, and the parent's class, its status at the step as the detector read it, its record class and its manoeuvre explanations. Where drag does not move the semi-major axis, the share of the step the orbit kept twenty to sixty days later is read from its sets.

## The classes

Each false alarm takes the first class that applies, in this order (`classOf` in `scripts/kpi/audit.ts`):

- **(A) A real event the truth misses.** At least one fresh piece (debris or unclassed, above the mark, first published after the step, no set before it) in the parent's plane at a metre a second or more, which none of these explains: a reported event of the parent or its launch (from three years before to a year after the step), whose pieces they are; a launch under 90 days old at the step or at the piece (the truth's own rule: a launch's first months are its own cataloguing); or an old cloud's late cataloguing, where the launch gained more than two fragment-class bodies in the year before and the in-plane share after does not stand out of the share before (binomial tail over 0.01).
- **(D) A data artefact**, first part: the later sets kept under half the jump at three days (the detector's own share for a bad set), or the parent re-entered within 60 days of the step.
- **(B) No pieces, a breakup's signatures**: the drag term changed five-fold or more and a kick of chi-squared 100 or more, on an object that was not a payload working at the step.
- **(C) Manoeuvre-like**: a payload that could have burned (working, or of unknown status, at the step), a payload whose record or a manoeuvre explanation reads the step as a burn, or a rocket body under a month old.
- **(D) A data artefact**, second part: in medium, geosynchronous or highly elliptical orbit with a perigee above 1,000 kilometres, where drag does not act, the orbit was back within a third of the step twenty to sixty days later.
- **(U) None of these**: a lone step that lasted, on a body that cannot burn (debris, a rocket body, a payload dead at the step), with no strong signature.

The pieces in plane that the three explanations account for are counted beside the classes, and those alerts are classed by the rest of the order. A loose reading was run beside the strict one for the plane test's blind spots (a node that means little in geosynchronous orbit, pieces under a metre a second): any fresh fragment-class piece in any plane, with the same three explanations and a Poisson test on the counts in place of the plane share. Its cases were reviewed by hand.

**The control sets say what the rules can tell.** Of the 47 alerts on reported events, 38 had fresh pieces in the parent's plane by this reading, and 40 had fresh pieces at all; the two the plane test missed were BLITS (one piece at 0.2 m/s, under the metre a second) and Intelsat 33E (36 pieces, all out of plane by the geosynchronous node). The A test would have found 95% of the real events that had pieces. None of the 47 falls in D, so the artefact tests do not take real breakups; 8 fall in B, 12 in C and 27 in U, so B, C and U are not separations, only descriptions.

## The counts

| Set | Audited | A | B | C | D | U | Pieces in plane, explained: a reported event / a young launch / an old cloud | Loose reading |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Scoped line, training | 26 (all) | 0 | 6 | 10 | 2 | 8 | 1 / 0 / 0 | 0 |
| Scoped line, held out | 56 (all) | 0 | 19 | 23 | 4 | 10 | 4 / 0 / 0 | 0 |
| Whole catalogue, training | 300 of 2,965 | 0 | 5 | 90 | 101 | 104 | 8 / 10 / 4 | 6, none real on review |
| Whole catalogue, held out | 300 of 3,155 | 1 | 5 | 69 | 110 | 115 | 2 / 5 / 0 | 4, one real on review (Intelsat 29E) |
| Control: alerts on reported events | 47 | 0 | 8 | 12 | 0 | 27 | 38 / 0 / 0 | 0 |
| Control: confirmed false alarms, training | 12 | 3 | 0 | 5 | 2 | 2 | 8 / 1 / 0 | 3 |
| Control: confirmed false alarms, held out | 9 | 2 | 1 | 3 | 1 | 2 | 6 / 1 / 0 | 2 |

As shares, with Wilson 95% intervals, the class A false alarms are 0 of 82 on the scoped line (0% to 4.5%); 0 of 300 on the whole catalogue's training years (0% to 1.3%); and 1 of 300 on its held-out years by the strict test (0.06% to 1.9%), 2 of 300 with the review (0.2% to 2.4%).

What each class holds:

- **The scoped line's false alarms are steps after which nothing came.** Only 7 of the 82 were followed by any new body under the launch within a year, and 5 of those are the pieces of a reported event: Cosmos 2456 to 2458's ullage motor stepping a month after its December 2019 breakup; CBERS 1 a day after its breakup of 18 February 2007, on a later step than the one the truth's minute brackets; and debris of Fengyun 1C, Cosmos 2251 and Iridium 33 stepping two to four years after those clouds formed, while their late pieces were still being catalogued. The other two (CZ-4B debris of the CBERS 1 launch in 2005, an Atlas 5 Centaur fragment of 2014-055 in 2021) had five and three new bodies, none in their plane.
- **B, 25 of the 82 scoped false alarms**: the old dead low-orbit payloads the seventh phase noted (OXP 1, Landsat 4, Cosmos 773, Cosmos 1125, Cosmos 2279, Meteor 2-15, QuikSCAT), with drag terms changed nine to six hundred times over and kicks far beyond one burn; low-orbit payloads of unknown status at the step (Iridium 40, SJ-7, Shijian-6 04A, Yaogan-17 01B); debris of the Fengyun 1C, Cosmos 2251, Cosmos 1818 and CRRES clouds; old stages and highly elliptical debris. None was followed by a fresh piece that no reported event explains, and no source names any of them. They are where an unreported event could hide, but by the owner's definition they are not reported events: nothing was published. The control set shows the signature is not one: 8 of the 47 real alerts carry it too.
- **C, 33**: geosynchronous payloads relocating (Intelsat 6B, Eutelsat W2 and W75, Palapa C2, Afristar, Superbird-B2, DirecTV 3, EchoStar 8, AsiaSat 3S, Eutelsat 10A, JCSAT 2A and 4A, XTAR-EUR, Skynet 4C and 4E), navigation payloads, Globalstar payloads lowering, all of them working or of unknown status at the step or with a record of burns.
- **D, 6**: a Breeze-M tank and Iridium 86 re-entering within two months, ChubuSat-1's step taken back at three days, and a dead geosynchronous payload (USA 11) and two highly elliptical fragments back at their old orbit weeks later (Satcom 3 debris stepped by −47 kilometres and by +46 two weeks on).
- **U, 18**: lone lasting steps on dead geosynchronous payloads (Zhongxing-5B, Arabsat-1A, Yamal 101), old stages in medium, geosynchronous and highly elliptical orbits (Atlas Agena, SL-12, Titan 3C Transtage, Atlas 5 Centaur, IABS, H-2A), and debris in every regime (Westford Needles, Cosmos 1409, Satcom 3, SL-12, Titan 3C Transtage and Atlas 5 Centaur debris, and two low-orbit fragments).
- **The whole catalogue's false alarms are mostly artefacts and burns.** A third of them (80 of 300 training, 97 held out) are objects that re-entered within 60 days of the step, half of them within five days, three in four with a perigee under 250 kilometres: a decaying object's last sets. Another 14 and 6 were taken back at three days, 7 and 7 were back at their orbit weeks later. Payloads that could burn or whose record reads a burn, and stages under a month old, make 90 and 69. The 104 and 115 left (U) are lone steps of a kilometre or two on debris, old stages and dead payloads across every regime, with no piece after them.

## The class A cases, and those near it

| Set | Object | Step | Pieces after | Reading |
| --- | --- | --- | --- | --- |
| Whole catalogue, held out | 15614 Atlas 41E debris (1985-021), low orbit | 2011-01-13, +3.3 km, drag term ×5.5 | one debris piece, 37358, published 14 days later, plane distance 0.12, 20 m/s; the launch had gained nothing in the year before | **A.** A single-piece event no source reports. The alert came before the piece was published, so counted as a positive it would be a detection. The fifth phase's confirmation rules refused it as a single piece. |
| Whole catalogue, held out (loose reading) | 41308 Intelsat 29E (2016-004), geosynchronous | 2019-04-12, +28.7 km | one debris piece, 45488 INTELSAT 29E DEB, published about a year later, plane distance 6.4 by a node that means little at this inclination | **A by review.** The satellite failed on 7 April 2019 with a propellant leak; telescope operators saw it shed pieces from 10 April, as the press reported it. It is in no source of the truth, the catalogue published one piece, and the alert (classed C here, a payload working until the event) came long before that piece. A hand-file entry, not a rule, is what it needs. The same object's later step, 2019-11-17, is the dead satellite drifting and stays C. |
| Confirmed false alarms (both splits) | Cosmos 2445 (2008-058, 2009), Ziyuan 3-01 (2012-001, 2012), Yaogan-6 (2009-021, 2014), Yaogan-26 (2014-088, 2015), Cosmos 2528 (2018-082, 2020) | parent steps | two to four pieces in plane at 2 to 50 m/s, published 4 to 31 days after the step, quiet launches | **A**, and all five **late**: the detector raised the step only after the first piece was published, which is why its rules confirmed them at once. Counted as events they would leave the false alarms and add no detection. Several may be deliberate releases (Cosmos 2445 was a film-return reconnaissance satellite); none is in a source. |

Near A but explained, all in the whole catalogue's samples: launches in their first three months (the stages and platforms of Proton and Soyuz launches, Dragon and Falcon 9 debris, Foton capsules, Shijian-19), which the truth's rule leaves out by design; the station's jettisoned objects, exempt as releases; the pieces of reported events stepping later (the Cosmos 2022 to 2024 ullage motor two months after its June 2006 breakup, H-2A debris before the reported H-IIA F21 event of late 2012, GOSAT 2's rocket-body debris, an Atlas 5 Centaur fragment of 2014-055 two years after the USA 257 stage broke up); and Fengyun 1C, Iridium 33 and SL-16 debris whose in-plane pieces do not stand out of their clouds' steady cataloguing. The loose reading's other cases were pieces tens of tolerances out of plane at hundreds of metres a second (Titan 3C Transtage and SL-12 debris in highly elliptical orbits, Breeze-M debris, a CZ-6A cloud's late batch three years on, a Proton stage's piece under a GLONASS launch), none an event of the stepping object.

**The two notes this audit was asked to check.** The fifth phase's "1989 rocket body with thirty-eight new pieces at 24 m/s in 2006" is the Cosmos 2022 to 2024 ullage motor, 20081, whose breakup of 10 June 2006 is in the truth at confidence A from NASA and GCAT: the confirmed alert is on a later step of 11 August, and its pieces are that cloud's, so it is the right object with the step late, not an unreported event. Of the fifth phase's first four, the 2006 payload with eighteen pieces is Cosmos 2423, whose breakup of 17 November 2006 is also in the truth (the alert's step came two weeks before it); the two with two pieces at 34 and 50 m/s are Cosmos 2427, a launch in its first three months, and Ziyuan 3-01, class A above but late. The seventh phase's twelve old low-orbit payloads with the drag term up nine to six hundred times are class B here: none had a fresh piece within a year, and nothing reports them.

## The re-score with class A as events

Each class A false alarm is counted as a reported event: it leaves the false alarms, joins the targets, and counts as a detection where it was raised before the launch's first new body was published (else as late). On the whole catalogue the sample's shares are carried to the split's false alarms; the headline recall is shown with the added events among its targets, as the audit asked, though they would enter the truth at confidence D, off the headline line.

| Line, split | As committed: detected/targets; false alarms; FA rate | Class A among its false alarms | Re-scored: false alarms; FA rate | Headline recall with the A events as targets |
| --- | --- | --- | --- | --- |
| Scoped, training | 4/25; 26; 84% | 0 of 26 | 26; 84% | 4/25, 16% |
| Scoped, held out | 3/24; 56; 95% | 0 of 56 | 56; 95% | 3/24, 13% |
| Whole catalogue, training | 18/43; 2,965; 99.2% | 0 of 300 (at most 1.3%, 38 alerts) | 2,965; 99.2% (at best 2,928; 98.0%) | 42% (at most 69%) |
| Whole catalogue, held out, strict | 11/32; 3,155; 99.6% | 1 of 300, early (0.06% to 1.9%) | about 3,144; 99.3% (at best 3,096; 97.7%) | about 51% (38% to 77%) |
| Whole catalogue, held out, with the review | 11/32; 3,155; 99.6% | 2 of 300, early (0.2% to 2.4%) | about 3,134; 98.9% (at best 3,079; 97.2%) | about 60% (44% to 80%) |

The false-alarm rates barely move: at the far end of the intervals the whole catalogue goes from 99.6% to 97%, and the scoped line not at all. The recall column moves more than the rates, and it should not be read as a gain: every added event is by construction an alert, so it can only raise the recall, while the same rule applied to the truth would also add every few-piece event no alert touched. Those are what decide the recall, and the next section counts them.

## The truth rule for few pieces: not built

The audit's brief was to propose a truth rule for one to four pieces, behind a switch, if class A turned out material. It did not, and a rule would move the scorecard away from the target:

- It would turn about 0.2% of the false alarms into events (with the confirmed ones, of the order of ten to twenty of the 6,120 over both splits), most of them late, since a few pieces are often published before the parent's step is raised.
- It would add far more targets than that. Counted from the Archive with the truth's own first-set reading (`firstSets` in `parse-catalogue.ts`), launches older than 90 days and quiet for a year gained a group of one to four new debris objects within thirty days 656 times from 2005 to 2026: 446 single pieces, 111 pairs, 63 threes and 36 fours. That count has no plane test, so it is an upper bound, but even a fraction of it, set beside the 88 headline events, would be mostly events whose parent's step the detector never raised. The recall would fall by more than the false-alarm rate.
- Single pieces are what NASA files as anomalous events (a piece shed at low velocity, the parent intact), which the owner's sharpened definition already scores on a line of their own. And a rule that needed the parent's step to accept a single piece would tie the truth to what the detector can see, so the recall it measured would no longer be independent of the detector.

What the audit does support is two hand entries, the reviewer's to decide: Intelsat 29E's failure of 7 April 2019, reported in the press with fragments seen from 10 April and one piece catalogued, as a hand-file statement; and Atlas 41E debris 15614 in January 2011, one piece at 20 m/s and no other source, as a review-list item rather than a truth row. Neither moves a rate by a point.

## A finding beside the question

A third of the whole catalogue's false alarms are objects in their last weeks: the parent re-entered within 60 days of the step, half of them within five days, mostly with a perigee under 250 kilometres. The seventh phase found that a perigee under 400 kilometres never yields a detection; this audit adds that those objects' steps are a large part of what the whole catalogue raises. The re-entry day is hindsight in a replay, but the live catalogue's decay predictions are public before the fact, and a scope or gate on them would be a cheap test on the training years. It does not touch the scoped line, which has one such alert in 82.

## Plainly

The truth is not what stands between the parent-step channel and nine in ten at under one in ten. By the owner's own definition of a reported event, counting fragments the catalogue published even one at a time, the scoped line's false alarms hold no missed event at all, and the whole catalogue's hold about one in three hundred. Counting them as events moves the whole catalogue's false-alarm rate by under a point and the scoped line's by nothing. What the false alarms are is what the earlier phases said: steps on objects that re-enter, burns of payloads that could burn, and lasting lone steps on debris, stages and dead satellites after which the catalogue published nothing. The committed truth and scorecard are unchanged by this phase.

## Every scoped false alarm

The step's instant, the parent, its class, regime and status at the step (payloads only), the step in the semi-major axis in kilometres, the drag term's ratio, the kick's chi-squared, the damage ratio, the new bodies under the launch in the year after (all, debris among them, in plane, the in-plane velocity, and what explains them), the class and the reason.

### Training, the even years

| Step | Parent | Class, regime, status | Δa (km) | Drag term ×| Kick χ² | Damage ratio | New bodies in the year after | Class | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2006-09-07 | 23403 SL-12 R/B(AUX MOTOR) | rocket body, HEO, – | -8.20 | 5874.0 | 7036 | 90.94 | none | B | drag term ×5874.0, kick χ² 7036 |
| 2008-03-07 | 25585 INTELSAT 6B (IS-6B) | payload, GEO, unknown | 87.82 | – | 718 | – | none | C | a payload unknown at the step |
| 2008-11-20 | 32970 COSMOS 1409 DEB | debris, HEO, – | -3.16 | – | 10280000 | – | none | U | drag term ×?, kick χ² 10280000 |
| 2010-02-26 | 25491 EUTELSAT W2 | payload, GEO, unknown | 84.99 | – | 955 | – | none | C | a payload unknown at the step |
| 2012-12-21 | 2997 WESTFORD NEEDLES | debris, MEO, – | -0.58 | – | 223 | 2.06 | none | U | drag term ×?, kick χ² 223 |
| 2014-07-25 | 25943 GLOBALSTAR M057 | payload, LEO, unknown | -0.62 | 3.2 | 1668 | – | none | C | a payload unknown at the step |
| 2016-11-10 | 23864 PALAPA C2 | payload, GEO, unknown | -21.53 | – | 1080 | 1.75 | none | C | a payload unknown at the step |
| 2018-01-02 | 25515 AFRISTAR | payload, GEO, unknown | 22.68 | – | 5794 | – | none | C | a payload unknown at the step |
| 2018-06-07 | 26095 SUPERBIRD-B2 | payload, GEO, unknown | 15.56 | – | 438 | 1.08 | none | C | a payload unknown at the step |
| 2018-08-22 | 25528 IRIDIUM 86 | payload, LEO, unknown | -10.47 | 27430.0 | 172400 | – | none | D | re-entered 44 days after |
| 2018-09-12 | 25789 QUIKSCAT | payload, LEO, nonoperational | -28.31 | 11.8 | 202000 | – | none | B | drag term ×11.8, kick χ² 202000 |
| 2020-01-23 | 36116 SL-12 R/B(AUX MOTOR) | rocket body, HEO, – | 12.66 | 11.4 | 111 | 0.90 | 6 new (3 debris), 3 in plane, 28.8 m/s; of a reported event | B | drag term ×11.4, kick χ² 111 |
| 2020-03-16 | 20776 SKYNET 4C | payload, GEO, unknown | -1.92 | – | 378 | 8.58 | none | C | a payload unknown at the step |
| 2020-03-18 | 27441 EXPRESS-A4 | payload, GEO, unknown | 7.61 | – | 113 | – | none | C | a payload unknown at the step |
| 2020-05-20 | 12854 SL-12 DEB | debris, MEO, – | -38.21 | – | 1636 | 0.66 | none | U | drag term ×?, kick χ² 1636 |
| 2020-08-04 | 25407 SL-16 R/B | rocket body, LEO, – | -0.08 | 199.7 | 118 | 1.05 | none | B | drag term ×199.7, kick χ² 118 |
| 2020-08-25 | 22916 IABS R/B | rocket body, GEO, – | -2.90 | – | 156 | 1.23 | none | U | drag term ×?, kick χ² 156 |
| 2020-09-13 | 40300 CHUBUSAT-1 | payload, LEO, nonoperational | 0.06 | 3.7 | 1661 | 0.96 | none | D | the later sets kept 29% of the jump at three days |
| 2020-12-09 | 8748 SOLRAD 11A | payload, MEO, nonoperational | -16.30 | – | 4607 | – | none | C | the record reads campaign |
| 2020-12-09 | 25404 ZHONGXING-5B | payload, GEO, nonoperational | -2.91 | – | 2421 | 0.37 | none | U | drag term ×?, kick χ² 2421 |
| 2022-04-08 | 39240 YAOGAN-17 01B | payload, LEO, unknown | 0.07 | 235.8 | 128 | 0.93 | none | B | drag term ×235.8, kick χ² 128 |
| 2021-10-22 | 29445 CZ-3 DEB | debris, HEO, – | -102.15 | 87.6 | 130 | 8.10 | none | B | drag term ×87.6, kick χ² 130 |
| 2022-09-27 | 15560 ARABSAT-1A | payload, GEO, nonoperational | 14.65 | – | 60670 | 1.92 | none | U | drag term ×?, kick χ² 60670 |
| 2023-12-17 | 53518 ATLAS 5 CENTAUR DEB | debris, HEO, – | -88.55 | – | 1244 | 1.10 | none | U | drag term ×?, kick χ² 1244 |
| 2024-10-04 | 25896 YAMAL 101 | payload, GEO, nonoperational | 1.59 | – | 265 | 0.81 | none | U | drag term ×?, kick χ² 265 |
| 2024-12-16 | 37237 HYLAS 1 | payload, GEO, nonoperational | -31.00 | – | 416500 | – | none | C | the record reads occasional |

### Held out, the odd years

| Step | Parent | Class, regime, status | Δa (km) | Drag term ×| Kick χ² | Damage ratio | New bodies in the year after | Class | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2005-06-14 | 23948 ARABSAT-2A | payload, GEO, unknown | 32.10 | – | 502 | – | none | C | a payload unknown at the step |
| 2005-07-07 | 26756 CZ-4B DEB | debris, LEO, – | 0.09 | 3.0 | 7772000 | 5.57 | 5 new (5 debris), 0 in plane | U | drag term ×3.0, kick χ² 7772000 |
| 2005-08-23 | 25163 GLOBALSTAR M004 | payload, LEO, unknown | -3.30 | – | 101 | 0.40 | none | C | a payload unknown at the step |
| 2005-09-15 | 22489 OXP 1 | payload, LEO, nonoperational | 0.09 | 75.9 | 490 | 0.22 | none | B | drag term ×75.9, kick χ² 490 |
| 2007-02-19 | 25940 CBERS 1 (ZY 1A) | payload, LEO, nonoperational | 0.16 | 515.4 | 202900 | 1.51 | 65 new (65 debris), 52 in plane, 4.8 m/s; of a reported event | B | drag term ×515.4, kick χ² 202900 |
| 2007-11-28 | 13367 LANDSAT 4 | payload, LEO, nonoperational | -0.07 | 15.6 | 608 | 1.08 | none | B | drag term ×15.6, kick χ² 608 |
| 2009-02-23 | 8343 COSMOS 773 | payload, LEO, nonoperational | 0.07 | 71.7 | 1524 | 1.49 | none | B | drag term ×71.7, kick χ² 1524 |
| 2009-04-16 | 31419 FENGYUN 1C DEB | debris, LEO, – | -0.52 | 8.2 | 175 | – | 312 new (312 debris), 14 in plane, 20.8 m/s; of a reported event | B | drag term ×8.2, kick χ² 175 |
| 2009-05-25 | 28243 H-2A DEB | debris, HEO, – | 5.59 | 67.4 | 589 | 2.33 | none | B | drag term ×67.4, kick χ² 589 |
| 2009-06-01 | 23598 DIRECTV 3 (DBS 3) | payload, GEO, unknown | 36.36 | – | 118 | – | none | C | a payload unknown at the step |
| 2009-06-02 | 21637 CRRES DEB [CANISTER] | debris, HEO, – | -1.62 | 77.6 | 10760 | – | none | B | drag term ×77.6, kick χ² 10760 |
| 2009-11-02 | 27819 SL-8 R/B | rocket body, LEO, – | -0.68 | 1488.0 | 540700 | 1.38 | none | B | drag term ×1488.0, kick χ² 540700 |
| 2010-12-03 | 27976 SL-12 DEB | debris, HEO, – | -21.04 | 6004.0 | 1663 | – | none | B | drag term ×6004.0, kick χ² 1663 |
| 2011-03-30 | 36632 COSMOS 2251 DEB | debris, LEO, – | 2.02 | 5.7 | 270 | 3.58 | 136 new (136 debris), 8 in plane, 5.1 m/s; of a reported event | B | drag term ×5.7, kick χ² 270 |
| 2011-07-11 | 11510 COSMOS 1125 | payload, LEO, nonoperational | -0.45 | 640.3 | 188 | 0.60 | none | B | drag term ×640.3, kick χ² 188 |
| 2011-07-18 | 24931 EUTELSAT W75 | payload, GEO, unknown | 60.07 | – | 2300000 | 12.65 | none | C | a payload unknown at the step |
| 2011-07-02 | 36933 COSMOS 1818 COOLANT | debris, LEO, – | -0.15 | 7.6 | 376 | – | none | B | drag term ×7.6, kick χ² 376 |
| 2011-08-15 | 23092 COSMOS 2279 | payload, LEO, nonoperational | -0.58 | 432.4 | 110 | 2.13 | none | B | drag term ×432.4, kick χ² 110 |
| 2011-08-20 | 35618 IRIDIUM 33 DEB | debris, LEO, – | -78.73 | 2.5 | 5951 | – | 51 new (51 debris), 12 in plane, 4.8 m/s; of a reported event | U | drag term ×2.5, kick χ² 5951 |
| 2011-11-30 | 24320 NAVSTAR 39 (USA 128) | payload, MEO, unknown | 3.17 | – | 1515 | – | none | C | a payload unknown at the step |
| 2013-03-10 | 39103 ARIANE 1 DEB | debris, LEO, – | -103.48 | 5.7 | 18760 | – | none | B | drag term ×5.7, kick χ² 18760 |
| 2013-11-04 | 31115 BEIDOU-2 M1 | payload, MEO, nonoperational | 3.45 | – | 4167 | 0.63 | none | C | the record reads station-keeping |
| 2015-03-19 | 36088 SJ-11-01 | payload, LEO, unknown | 0.08 | – | 1361 | 0.90 | none | C | a payload unknown at the step |
| 2015-06-23 | 32991 SATCOM 3 DEB | debris, HEO, – | -46.77 | – | 551 | – | none | D | the orbit kept 0% of the step twenty to sixty days later |
| 2015-07-07 | 32991 SATCOM 3 DEB | debris, HEO, – | 46.47 | – | 925 | – | none | U | drag term ×?, kick χ² 925 |
| 2015-08-16 | 28737 SJ-7 | payload, LEO, unknown | 0.15 | 10.3 | 170 | 1.09 | none | B | drag term ×10.3, kick χ² 170 |
| 2015-08-23 | 17290 METEOR 2-15 | payload, LEO, nonoperational | -0.13 | 9.0 | 217 | 2.57 | none | B | drag term ×9.0, kick χ² 217 |
| 2017-01-03 | 38220 COSMOS 2251 DEB | debris, LEO, – | -3.61 | 25.7 | 37150000 | – | none | B | drag term ×25.7, kick χ² 37150000 |
| 2017-04-11 | 25041 IRIDIUM 40 | payload, LEO, unknown | 60.92 | 12.1 | 1728000 | 20.30 | none | B | drag term ×12.1, kick χ² 1728000 |
| 2017-04-20 | 27501 ECHOSTAR 8 | payload, GEO, unknown | 23.28 | – | 359 | – | none | C | a payload unknown at the step |
| 2017-12-15 | 25404 ZHONGXING-5B | payload, GEO, nonoperational | -2.13 | – | 3081 | 1.41 | none | C | the record reads unique |
| 2017-12-19 | 28082 ZHONGXING-20 | payload, GEO, unknown | 27.42 | – | 162 | – | none | C | a payload unknown at the step |
| 2019-03-21 | 17181 FLTSATCOM 7 (USA 20) | payload, GEO, unknown | -6.69 | – | 128200 | – | none | C | a payload unknown at the step |
| 2019-04-22 | 7964 ATLAS AGENA R/B | rocket body, MEO, – | 0.88 | – | 3718 | 5.65 | none | U | drag term ×?, kick χ² 3718 |
| 2019-07-18 | 22517 SL-12 R/B(2) | rocket body, MEO, – | -0.90 | – | 136 | 2.76 | none | U | drag term ×?, kick χ² 136 |
| 2021-01-04 | 27369 H-2A R/B | rocket body, HEO, – | 0.40 | – | 4592 | 0.99 | none | U | drag term ×?, kick χ² 4592 |
| 2021-01-18 | 27399 JCSAT-2A | payload, GEO, unknown | 16.87 | – | 2106000 | – | none | C | a payload unknown at the step |
| 2021-02-09 | 8918 TITAN 3C TRANSTAGE R/B | rocket body, GEO, – | 1.61 | – | 133 | 0.36 | none | U | drag term ×?, kick χ² 133 |
| 2021-04-10 | 39167 ATLAS 5 CENTAUR R/B | rocket body, MEO, – | 4.75 | – | 2477 | 0.54 | none | U | drag term ×?, kick χ² 2477 |
| 2021-05-28 | 37179 SHIJIAN-6 04A (SJ-6 04A) | payload, LEO, unknown | -0.19 | 11.4 | 244 | 2.70 | none | B | drag term ×11.4, kick χ² 244 |
| 2021-07-15 | 46645 ATLAS 5 CENTAUR DEB | debris, HEO, – | 302.33 | – | 430 | – | 3 new (3 debris), 0 in plane | D | the orbit kept 5% of the step twenty to sixty days later |
| 2021-10-04 | 38995 MERIDIAN 6 | payload, HEO, unknown | -2.02 | – | 202 | – | none | C | a payload unknown at the step |
| 2021-10-01 | 39299 TITAN 3C TRANSTAGE DEB | debris, GEO, – | -11.27 | – | 72470 | 0.57 | none | U | drag term ×?, kick χ² 72470 |
| 2021-11-05 | 33597 BREEZE-M DEB [TANK] | debris, HEO, – | -159.34 | 5.5 | 1412 | – | none | D | re-entered 9 days after |
| 2021-11-16 | 25630 JCSAT-4A | payload, GEO, unknown | -1.33 | – | 693 | – | none | C | a payload unknown at the step |
| 2021-11-22 | 25657 ASIASAT 3S | payload, GEO, unknown | -66.45 | – | 788 | – | none | C | a payload unknown at the step |
| 2021-12-08 | 24957 NSS-5 | payload, GEO, unknown | 3.03 | – | 206 | 4.40 | none | C | a payload unknown at the step |
| 2023-03-04 | 22694 HGS-4 (GALAXY 4) | payload, GEO, nonoperational | 2.11 | – | 1083 | – | none | C | the record reads occasional |
| 2023-07-29 | 37372 COSMOS 2471 [GLONASS-K] | payload, MEO, nonoperational | 1.16 | – | 7858 | 0.76 | none | C | the record reads occasional |
| 2023-09-11 | 37158 QZS-1 (MICHIBIKI-1) | payload, MEO, unknown | -4.98 | – | 188 | – | none | C | a payload unknown at the step |
| 2023-11-28 | 34710 EUTELSAT 10A | payload, GEO, unknown | -102.58 | – | 294 | 4.24 | none | C | a payload unknown at the step |
| 2024-07-25 | 2367 WESTFORD NEEDLES | debris, HEO, – | 68.93 | – | 904 | 1.32 | none | U | drag term ×?, kick χ² 904 |
| 2025-03-10 | 16116 USA 11 | payload, GEO, nonoperational | -3.01 | – | 191 | 2.83 | none | D | the orbit kept -1% of the step twenty to sixty days later |
| 2025-07-29 | 32252 OPTUS D2 | payload, GEO, unknown | 2.61 | – | 2642 | – | none | C | a payload unknown at the step |
| 2025-08-15 | 28542 XTAR-EUR | payload, GEO, unknown | 13.53 | – | 1525 | – | none | C | a payload unknown at the step |
| 2025-11-29 | 25639 SKYNET 4E | payload, GEO, unknown | 1.06 | – | 1870 | – | none | C | a payload unknown at the step |
