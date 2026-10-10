# The seventh phase: the scope study

The owner's order for this phase, verbatim: "FA rate must be below 10%. After the result you shall find a way to get the 90-10 percentage as requested. Analyze if some orbits are always a miss to propose exclusions, what happens if we restrict to only dead satellites, LEO, ... make hypothesis and test." This note records what was tested and how, the status read as of the step that the test needed first, which orbits and objects the parent's step never catches, every hypothesis on both splits with its intervals, the frontier the owner can choose along, the point the scorecard now carries as its scoped line, and the answer, plainly.

The definitions are the scorecard's: a detection is an alert on the parent's own orbit step raised before the first fragment's element set is published and before any notice; the false-alarm rate is false alarms over false alarms plus detections on every line; the headline line is breakups of confidence A and B. One false alarm in ten means at most one false alarm for every nine detections: with the three to five headline detections a split holds in any scope tested here, that is no false alarm at all in eleven years.

## The discipline

- Every operating point was chosen on the training split, the even years 2006 to 2026; the validation split, the odd years 2005 to 2025, was read once at the point chosen; the chronological halves (to 2017, from 2018) are read at the same point beside them. Nothing was tuned on the odd years.
- A scope is a predicate on the parent at the time of the step (`inScope` in `src/scope.ts`), applied alike to the reported events, which are the targets, and to the alerts, so the detection rate and the false-alarm rate are measured on one population. The share of all headline events each scope keeps is given beside it.
- Each rate carries its Wilson 95% interval. A scope with fewer than eight headline targets on either split is reported and not proposed.
- The study reads the replay's year files offline (`node --experimental-strip-types scripts/kpi/scope.ts <kpi dir> [--status dated|today|none] [--frontier] [--misses] [--show <scope>]`). An event's parent is read at the event's lower edge: its orbit from its last set before the event in the Archive (regime, perigee height, drag term), its class, launch and dated status from the body tables, its record from the replay's own persistent steps. An alert's parent is read at the step from the verdict's evidence, the same tables and the same record. The gates (`passesGates`) and the persistence tier only take alerts away, so reading the replay's alerts is exact for them; the committed replay with the chosen scope reproduces the study's reading of it to the alert.
- The gates swept, every combination (44,100 points a scope): the step's size at the raising in its own sigma (0, 15, 20, 30, 50, 100, 300), in metres of semi-major axis (0, 30, 100, 300, 1,000, 3,000), the along-track impulse (0, 0.03, 0.1, 0.3, 1 m/s), the drag term's change across the step folded above one (none, 1.5, 2, 3, 5; a step with no drag term read passes untested), the eccentricity change one tangential impulse cannot explain (chi-squared 0, 9, 100), whether only a step no manoeuvre explanation applied to is kept, and the persistence tier at which the scoped alert is raised (as raised, three or five post sets, one, three, five or seven days of post sets with the step still holding).
- The rule for the operating point, fixed before any reading: the most headline detections at a training false-alarm rate within one in ten, then the most detections on every line, the fewest false alarms, the loosest gates. Where no point reaches one in ten, the point nearest the target: the larger of the two shortfalls (recall under nine in ten, the false-alarm rate over one in ten) the smallest, then the most headline detections, then the loosest gates.

## The status as of the step

The sixth phase read the satellite catalogue's operational status of today, and the fifth decision record stated the hindsight: a satellite that broke up is usually nonoperational today because it broke up. Restricting to dead satellites with that status would have written the answer in, so the status had to be dated first.

GCAT's payload catalogue (Jonathan McDowell, planet4589.org, CC-BY-4.0, `psatcat.tsv`) gives each payload three end-of-life dates in its vague-date form: the last time it was known active, the end of its regular operations (`TOp`) and the end of transmission (`TDate`, "the date after which the satellite became completely silent and unresponsive, or when no further contact was made by its owners"). `npm run archive:gcat` fetches it into the Archive's `gcat/`; `npm run archive:annotate` carries the window the end of transmission falls in onto every year's body table as `endedFrom` and `endedOn` (`1994 Aug?` spans July to September, `1998?` spans 1997 to 1999, quarters and decades included); the element row carries them as `endedFromMs` and `endedByMs` with the launch day as `launchedMs`. `operationalAt` reads a payload at a step as working where the step comes more than thirty days before that window, dead where it comes more than thirty days after it, and unknown within the month either side; a payload with no dated end reads working only where the satellite catalogue says it works today, and unknown otherwise.

Two things this needed that the first trial showed:

- **The margin is either side of the end.** The first trial read the end of operations, dead only after it and unknown only in the thirty days after. It lost three training detections: Hitomi, whose end GCAT dates to the day of its breakup and whose post set came hours before the end of that day, so it read as working; Orbcomm FM16, whose end GCAT dates `2018 Dec?` (December give or take a month) after a breakup on 22 December; and Cosmos 2535, whose end is `2021?`, a window that spans its 2020 breakup. The end of a satellite that broke up is set by the breakup, so the margin is now a month either side of the end's whole window.
- **The end of transmission, not of operations.** A satellite past its regular operations is still commanded while its owners lower it, raise it to a graveyard or passivate it. Globalstar M044 ended its operations in September 2009 and raised itself twenty-nine kilometres on 10 November 2012, nine days before its end of transmission; the Starlink satellites retired in 2025 lowered themselves between the two dates. Read from the end of operations, those burns are a dead satellite's lone steps: the held-out years kept 331 more false alarms (3,486 against 3,155), 166 of them steps of payloads between their end of operations and their end of transmission, with no headline detection gained.

Reading GCAT's `*` (still transmitting) as working at every step was measured offline and not taken: it would remove 65 validation false alarms of 3,155 and cost Cosmos 2499's first breakup, a headline detection, and Orbcomm FM5's.

The whole catalogue's scorecard with each reading, every other parameter the sixth phase's:

| Status read | Validation headline: detected, late, missed of 32 | Validation false alarms | Validation FA rate | Training headline of 43 | Training false alarms | To 2017: headline of 44, false alarms | From 2018: headline of 31, false alarms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| As of the step, end of transmission, a month either side (this phase, committed) | 11, 2, 19 | 3,155 | 99.6% | 18, 4, 21 | 2,965 | 16, 4, 24; 3,191 | 13, 2, 16; 2,929 |
| As of the step, end of operations, a month either side (trial) | 11, 2, 19 | 3,486 | 99.6% | 18, 4, 21 | 3,263 | 16, 4, 24; 3,392 | 13, 2, 16; 3,357 |
| As of the step, end of operations, the month after only (first trial) | 11, 2, 19 | 2,969 | 99.5% | 15, 5, 23 | 2,832 | 15, 5, 24; 2,977 | 11, 2, 18; 2,824 |
| Today's (the sixth phase) | 11, 2, 19 | 4,764 | 99.7% | 18, 4, 21 | 4,455 | 16, 4, 24; 5,001 | 13, 2, 16; 4,218 |
| None | 11, 2, 19 | 8,278 | 99.8% | 17, 4, 22 | 8,170 | 16, 4, 24; 6,432 | 12, 2, 17; 10,016 |

The dated reading removes the hindsight and lowers the false alarms by a third against today's status, with the headline line unchanged on every split: today's "nonoperational" had raised as dead the steps of satellites that were working when they made them. Three detections off the headline line are lost to it, each a satellite that was working at its event and was read so: MUBLCOM, struck by DART in April 2005; AMC-9's anomaly of June 2017; Telkom 1's of August 2017. A working satellite's breakup is raised only where a breakup signature overrides the working status, which theirs did not. The live product reads the dated status for today's steps, which is today's status: the backtest and the product now read the status the same way.

## Which orbits and objects are always missed

Every headline event of every year (88, of which 75 had public sets to be judged on), by what the parent was at the event and how the event came out, from `--misses`; the cause is the dissection's (`events.md`). The last column is the detection rate among the events with public sets, with its interval.

| regime | events | detected | late | missed | undetectable | detected of detectable |
| --- | --- | --- | --- | --- | --- | --- |
| LEO | 50 | 17 | 4 | 19 | 10 | 43% (29%–58%) |
| HEO | 31 | 7 | 2 | 19 | 3 | 25% (13%–43%) |
| GEO | 5 | 4 | 0 | 1 | 0 | 80% (38%–96%) |
| MEO | 2 | 1 | 0 | 1 | 0 | 50% (9%–91%) |

| class | events | detected | late | missed | undetectable | detected of detectable |
| --- | --- | --- | --- | --- | --- | --- |
| rocket body | 50 | 14 | 2 | 25 | 9 | 34% (22%–49%) |
| payload | 31 | 14 | 4 | 11 | 2 | 48% (31%–66%) |
| debris | 5 | 1 | 0 | 4 | 0 | 20% (4%–62%) |
| unknown | 2 | 0 | 0 | 0 | 2 | – |

| perigee band | events | detected | late | missed | undetectable | detected of detectable |
| --- | --- | --- | --- | --- | --- | --- |
| highly elliptical | 31 | 7 | 2 | 19 | 3 | 25% (13%–43%) |
| 600 to 800 km | 18 | 12 | 1 | 4 | 1 | 71% (47%–87%) |
| 300 to 500 km | 9 | 1 | 2 | 2 | 4 | 20% (4%–62%) |
| 800 to 1,000 km | 8 | 2 | 0 | 4 | 2 | 33% (10%–70%) |
| under 300 km | 6 | 0 | 1 | 3 | 2 | 0% (0%–49%) |
| 1,000 to 2,000 km | 6 | 2 | 0 | 4 | 0 | 33% (10%–70%) |
| 500 to 600 km | 5 | 1 | 0 | 3 | 1 | 25% (5%–70%) |
| geosynchronous | 5 | 4 | 0 | 1 | 0 | 80% (38%–96%) |

| age from launch | events | detected | late | missed | undetectable | detected of detectable |
| --- | --- | --- | --- | --- | --- | --- |
| 5 to 15 years | 26 | 11 | 1 | 14 | 0 | 42% (26%–61%) |
| over 15 years | 24 | 13 | 1 | 9 | 1 | 57% (37%–74%) |
| under a year | 21 | 2 | 2 | 9 | 8 | 15% (4%–42%) |
| 1 to 5 years | 15 | 3 | 2 | 8 | 2 | 23% (8%–50%) |
| unknown | 2 | 0 | 0 | 0 | 2 | – |

| status at the event (dated) | events | detected | late | missed | undetectable | detected of detectable |
| --- | --- | --- | --- | --- | --- | --- |
| not a payload | 57 | 15 | 2 | 29 | 11 | 33% (21%–47%) |
| payload dead at the event | 14 | 7 | 1 | 5 | 1 | 54% (29%–77%) |
| payload, status unknown at the event | 14 | 7 | 3 | 3 | 1 | 54% (29%–77%) |
| payload working at the event | 3 | 0 | 0 | 3 | 0 | 0% (0%–56%) |

| record | events | detected | late | missed | undetectable | detected of detectable |
| --- | --- | --- | --- | --- | --- | --- |
| no step in two years | 60 | 20 | 2 | 25 | 13 | 43% (30%–57%) |
| a persistent step in the year before | 20 | 7 | 3 | 10 | 0 | 35% (18%–57%) |
| a step one to two years before | 8 | 2 | 1 | 5 | 0 | 25% (7%–59%) |

| cause | events | detected | late | missed | undetectable | detected of detectable |
| --- | --- | --- | --- | --- | --- | --- |
| raised | 29 | 29 | 0 | 0 | 0 | 100% (88%–100%) |
| parent did not move | 24 | 0 | 0 | 24 | 0 | 0% (0%–14%) |
| no public sets | 13 | 0 | 0 | 0 | 13 | – |
| persistence after the catalogue | 5 | 0 | 5 | 0 | 0 | 0% (0%–43%) |
| no further set | 4 | 0 | 0 | 4 | 0 | 0% (0%–49%) |
| below persistence | 3 | 0 | 0 | 3 | 0 | 0% (0%–56%) |
| record gate | 3 | 0 | 0 | 3 | 0 | 0% (0%–56%) |
| step taken back | 3 | 0 | 0 | 3 | 0 | 0% (0%–56%) |
| ramping fit | 2 | 0 | 0 | 2 | 0 | 0% (0%–66%) |
| no post set before the catalogue | 1 | 0 | 1 | 0 | 0 | 0% (0%–79%) |
| no sets before the catalogue | 1 | 0 | 0 | 1 | 0 | 0% (0%–79%) |

What the tables say, and the exclusions they support:

- **The parent did not move: 24 events, none caught.** Nine are highly elliptical stages and ullage motors, the rest low and medium orbits at every height. These are the events the parent's step structurally cannot see; they are spread over every regime and class, so no scope removes them without removing caught events with them.
- **A perigee under 400 kilometres: none caught, in any regime.** Twenty-one headline events had a parent whose perigee was under 400 kilometres at the event: ten highly elliptical stages and ullage motors whose perigee rides in the atmosphere, and eleven low- and medium-orbit objects. Thirteen had public sets; none was detected (ten missed, three late), since the drag at such a perigee moves the orbit by more than a breakup's step between sets. The highly elliptical parents with a higher perigee are caught a third of the time (seven of twenty). Excluding perigees under 400 kilometres drops 21 of the 88 headline events (24%) and no detection.
- **Parents under a year old: two caught of thirteen with public sets**, and eight of the thirteen events with no public sets are such parents; the young objects are also where most false alarms are (fresh stages venting, deployments). Not an "always a miss", but a poor population on both counts.
- **The parent had no public sets: 13 events (15%)**, already out of the denominator.
- **The best band is low orbit from 600 to 800 kilometres:** twelve of seventeen events with public sets detected, 71% (47% to 87%).
- **A payload working at its event: none of three caught**, by design: a working satellite's step is read as a burn unless a breakup signature overrides it.

The exclusion the data support as structural is the perigee under 400 kilometres; it is scope (k) below, alone and with the age bound.

## The hypotheses

Each scope as raised (the whole-catalogue gates) and at the operating point the rule chose on the training years, read on both splits and the chronological halves. "Kick χ²" is the chi-squared of the eccentricity change one tangential impulse cannot explain; "unexplained only" keeps only a step no manoeuvre explanation applied to. The training and validation cells give detected over targets and the false alarms, then the recall and the false-alarm rate with their Wilson 95% intervals. No scope reaches nine in ten at under one in ten at any point of the grid: every point in this table is the nearest one.

| Scope | Headline events with public sets kept, every year | As raised, training: detected/targets, recall; FA rate | As raised, validation: the same | The point nearest 90/10, chosen on training | Training at it: detected/targets, false alarms; recall (95%); FA rate (95%) | Validation at it: the same | ≤ 2017 at it | ≥ 2018 at it |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| the whole catalogue | 75 of 75 (100%) | 18/43: 42%; 99% | 11/32: 34%; 100% | held at 7 d, z ≥ 20, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5, kick χ² ≥ 100 | 4/43, FA 61; 9% (4%–22%); 92% (83%–97%) | 3/32, FA 93; 9% (3%–24%); 97% (91%–99%) | 4/44, FA 71 | 3/31, FA 83 |
| (a) payloads dead at the step (under 8 targets on a split: reported, not proposed) | 13 of 75 (17%) | 3/5: 60%; 99% | 4/8: 50%; 99% | z ≥ 30, ΔV ≥ 0.03 m/s, B* ratio ≥ 1.5, kick χ² ≥ 100, unexplained only | 1/5, FA 4; 20% (4%–62%); 80% (38%–96%) | 2/8, FA 8; 25% (7%–59%); 73% (43%–90%) | 3/6, FA 7 | 0/7, FA 5 |
| (b) rocket bodies | 41 of 75 (55%) | 11/25: 44%; 98% | 3/16: 19%; 100% | held at 3 d, z ≥ 15, Δa ≥ 300 m, B* ratio ≥ 5, kick χ² ≥ 100 | 4/25, FA 33; 16% (6%–35%); 87% (73%–94%) | 1/16, FA 41; 6% (1%–28%); 98% (88%–100%) | 2/29, FA 38 | 3/12, FA 36 |
| (c) non-payloads | 46 of 75 (61%) | 11/29: 38%; 99% | 4/17: 24%; 100% | held at 7 d, z ≥ 20, ΔV ≥ 0.1 m/s, B* ratio ≥ 5, kick χ² ≥ 100 | 3/29, FA 37; 10% (4%–26%); 90% (77%–96%) | 1/17, FA 43; 6% (1%–27%); 98% (88%–100%) | 2/30, FA 41 | 2/16, FA 39 |
| (d) dead payloads and rocket bodies | 54 of 75 (72%) | 14/30: 47%; 99% | 7/24: 29%; 99% | held at 7 d, z ≥ 20, ΔV ≥ 0.03 m/s, B* ratio ≥ 1.5, kick χ² ≥ 100 | 4/30, FA 32; 13% (5%–30%); 86% (72%–94%) | 2/24, FA 45; 8% (2%–26%); 94% (83%–98%) | 4/35, FA 36 | 2/19, FA 41 |
| (d') dead payloads and non-payloads | 59 of 75 (79%) | 14/34: 41%; 99% | 8/25: 32%; 100% | held at 7 d, z ≥ 20, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5, kick χ² ≥ 100 | 4/34, FA 43; 12% (5%–27%); 90% (78%–95%) | 2/25, FA 61; 8% (2%–25%); 97% (89%–99%) | 4/36, FA 50 | 2/23, FA 54 |
| (d'') payloads not known working, and non-payloads | 72 of 75 (96%) | 18/41: 44%; 99% | 11/31: 35%; 100% | held at 7 d, z ≥ 20, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5, kick χ² ≥ 100 | 4/41, FA 61; 10% (4%–23%); 92% (83%–97%) | 3/31, FA 93; 10% (3%–25%); 97% (91%–99%) | 4/42, FA 71 | 3/30, FA 83 |
| (e) LEO | 40 of 75 (53%) | 9/22: 41%; 99% | 8/18: 44%; 99% | held at 7 d, z ≥ 50, Δa ≥ 100 m, B* ratio ≥ 3, unexplained only | 1/22, FA 47; 5% (1%–22%); 98% (89%–100%) | 2/18, FA 56; 11% (3%–33%); 97% (88%–99%) | 1/20, FA 50 | 2/20, FA 53 |
| (e) LEO, perigee 600 to 2,000 km | 29 of 75 (39%) | 8/14: 57%; 97% | 8/15: 53%; 98% | held at 5 sets, z ≥ 20, B* ratio ≥ 3, kick χ² ≥ 9, unexplained only | 1/14, FA 14; 7% (1%–31%); 93% (70%–99%) | 4/15, FA 23; 27% (11%–52%); 82% (64%–92%) | 4/14, FA 24 | 1/15, FA 13 |
| (e) perigee above 500 km | 52 of 75 (69%) | 17/31: 55%; 99% | 10/21: 48%; 99% | z ≥ 20, ΔV ≥ 0.03 m/s, B* ratio ≥ 3, kick χ² ≥ 100, unexplained only | 3/31, FA 36; 10% (3%–25%); 90% (77%–96%) | 4/21, FA 81; 19% (8%–40%); 94% (87%–97%) | 4/28, FA 64 | 3/24, FA 53 |
| (f) older than a year | 62 of 75 (83%) | 16/33: 48%; 99% | 11/29: 38%; 99% | held at 7 d, z ≥ 15, ΔV ≥ 0.03 m/s, B* ratio ≥ 2, kick χ² ≥ 100 | 4/33, FA 35; 12% (5%–27%); 88% (74%–95%) | 3/29, FA 73; 10% (4%–26%); 95% (87%–98%) | 4/35, FA 53 | 3/27, FA 55 |
| (f) older than five years | 49 of 75 (65%) | 14/25: 56%; 99% | 10/24: 42%; 99% | held at 7 d, z ≥ 20, ΔV ≥ 0.03 m/s, B* ratio ≥ 2, kick χ² ≥ 100 | 4/25, FA 26; 16% (6%–35%); 84% (67%–93%) | 3/24, FA 56; 13% (4%–31%); 95% (86%–98%) | 4/26, FA 39 | 3/23, FA 43 |
| (g) no persistent step in the year before | 55 of 75 (73%) | 11/30: 37%; 99% | 11/25: 44%; 99% | held at 7 d, z ≥ 20, ΔV ≥ 0.03 m/s, B* ratio ≥ 1.5, kick χ² ≥ 100, unexplained only | 2/30, FA 42; 7% (2%–21%); 93% (82%–98%) | 3/25, FA 55; 12% (4%–30%); 93% (84%–97%) | 2/33, FA 48 | 3/22, FA 49 |
| (g) no persistent step in the two years before | 47 of 75 (63%) | 9/24: 38%; 99% | 11/23: 48%; 99% | held at 7 d, z ≥ 20, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5, kick χ² ≥ 100, unexplained only | 2/24, FA 34; 8% (2%–26%); 92% (79%–97%) | 3/23, FA 48; 13% (5%–32%); 94% (84%–98%) | 2/28, FA 38 | 3/19, FA 44 |
| (h) drag term under 1e-4 | 39 of 75 (52%) | 11/22: 50%; 99% | 8/17: 47%; 100% | held at 7 d, z ≥ 20, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 3, kick χ² ≥ 100, unexplained only | 2/22, FA 33; 9% (3%–28%); 92% (78%–97%) | 2/17, FA 43; 12% (3%–34%); 96% (85%–99%) | 2/20, FA 34 | 2/19, FA 42 |
| (h) drag term under 3e-5 | 20 of 75 (27%) | 6/12: 50%; 99% | 3/8: 38%; 100% | held at 5 d, z ≥ 50, kick χ² ≥ 100, unexplained only | 1/12, FA 19; 8% (1%–35%); 90% (71%–97%) | 2/8, late 1, FA 24; 25% (7%–59%); 92% (76%–98%) | 2/12, FA 19 | 1/8, FA 24 |
| (i) not highly elliptical | 47 of 75 (63%) | 12/27: 44%; 99% | 10/20: 50%; 100% | held at 7 d, z ≥ 50, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 3, unexplained only | 3/27, FA 77; 11% (4%–28%); 96% (90%–99%) | 3/20, FA 95; 15% (5%–36%); 97% (91%–99%) | 2/23, FA 83 | 4/24, FA 89 |
| (j) non-payloads in LEO (under 8 targets on a split: reported, not proposed) | 13 of 75 (17%) | 4/10: 40%; 99% | 1/3: 33%; 100% | held at 7 d, z ≥ 50, Δa ≥ 100 m, B* ratio ≥ 3, unexplained only | 1/10, FA 33; 10% (2%–40%); 97% (85%–99%) | 0/3, FA 42; 0% (0%–56%); 100% (92%–100%) | 0/7, FA 39 | 1/6, FA 36 |
| (j) dead payloads and non-payloads in LEO | 25 of 75 (33%) | 6/14: 43%; 99% | 5/11: 45%; 99% | held at 7 d, z ≥ 50, Δa ≥ 100 m, B* ratio ≥ 3, unexplained only | 1/14, FA 40; 7% (1%–31%); 98% (87%–100%) | 1/11, FA 50; 9% (2%–38%); 98% (90%–100%) | 1/12, FA 45 | 1/13, FA 45 |
| (j) dead payloads and non-payloads, perigee above 500 km | 39 of 75 (52%) | 13/24: 54%; 99% | 7/15: 47%; 99% | held at 3 sets, z ≥ 20, ΔV ≥ 0.03 m/s, B* ratio ≥ 3, kick χ² ≥ 100, unexplained only | 3/24, FA 28; 13% (4%–31%); 88% (72%–95%) | 3/15, FA 43; 20% (7%–45%); 91% (80%–97%) | 4/22, FA 33 | 2/17, FA 38 |
| (j) dead payloads and non-payloads in LEO, older than a year | 23 of 75 (31%) | 6/12: 50%; 98% | 5/11: 45%; 99% | held at 3 sets, z ≥ 50, Δa ≥ 100 m, B* ratio ≥ 3, unexplained only | 2/12, FA 18; 17% (5%–45%); 90% (70%–97%) | 2/11, FA 21; 18% (5%–48%); 91% (73%–98%) | 3/10, FA 18 | 1/13, FA 21 |
| (j) dead payloads and non-payloads in LEO, quiet a year | 23 of 75 (31%) | 6/12: 50%; 99% | 5/11: 45%; 99% | held at 7 d, z ≥ 50, Δa ≥ 100 m, B* ratio ≥ 3, unexplained only | 1/12, FA 40; 8% (1%–35%); 98% (87%–100%) | 1/11, FA 50; 9% (2%–38%); 98% (90%–100%) | 1/11, FA 45 | 1/12, FA 45 |
| (j) dead payloads and non-payloads in LEO above 500 km, older than a year | 20 of 75 (27%) | 6/11: 55%; 96% | 5/9: 56%; 98% | held at 3 sets, z ≥ 15, Δa ≥ 100 m, B* ratio ≥ 3, unexplained only | 2/11, FA 19; 18% (5%–48%); 86% (67%–95%) | 2/9, FA 30; 22% (6%–55%); 94% (80%–98%) | 3/9, FA 27 | 1/11, FA 22 |
| (j) dead payloads and non-payloads in LEO above 500 km, older than a year, quiet a year | 20 of 75 (27%) | 6/11: 55%; 96% | 5/9: 56%; 98% | held at 3 sets, z ≥ 15, Δa ≥ 100 m, B* ratio ≥ 3 | 3/11, FA 21; 27% (10%–57%); 84% (65%–94%) | 2/9, FA 31; 22% (6%–55%); 94% (80%–98%) | 3/9, FA 29 | 2/11, FA 23 |
| (j) dead payloads and rocket bodies in LEO above 500 km, older than a year | 17 of 75 (23%) | 6/8: 75%; 94% | 5/9: 56%; 96% | z ≥ 15, Δa ≥ 100 m, B* ratio ≥ 3, unexplained only | 2/8, FA 16; 25% (7%–59%); 84% (62%–94%) | 2/9, FA 18; 22% (6%–55%); 90% (70%–97%) | 3/9, FA 15 | 1/8, FA 19 |
| (j) payloads not known working and non-payloads in LEO above 500 km, older than a year | 27 of 75 (36%) | 7/13: 54%; 97% | 8/14: 57%; 98% | held at 3 sets, z ≥ 15, Δa ≥ 100 m, B* ratio ≥ 3, unexplained only | 2/13, FA 27; 15% (4%–42%); 90% (74%–97%) | 3/14, FA 50; 21% (8%–48%); 94% (85%–98%) | 3/12, FA 37 | 2/15, FA 40 |
| (j) rocket bodies in LEO above 500 km, older than a year (under 8 targets on a split: reported, not proposed) | 7 of 75 (9%) | 4/5: 80%; 91% | 1/2: 50%; 96% | z ≥ 15, Δa ≥ 100 m, B* ratio ≥ 3, unexplained only | 2/5, FA 3; 40% (12%–77%); 60% (23%–88%) | 0/2, FA 6; 0% (0%–66%); 100% (61%–100%) | 1/4, FA 3 | 1/3, FA 6 |
| (j) not highly elliptical, older than a year, quiet a year | 35 of 75 (47%) | 9/17: 53%; 99% | 10/18: 56%; 99% | held at 7 d, z ≥ 50, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 3, unexplained only | 3/17, FA 26; 18% (6%–41%); 90% (74%–96%) | 3/18, FA 38; 17% (6%–39%); 93% (81%–97%) | 2/17, FA 30 | 4/18, FA 34 |
| (k) the exclusions the misses support: perigee 400 km or more | 61 of 75 (81%) | 18/34: 53%; 99% | 11/27: 41%; 99% | held at 7 d, z ≥ 20, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5, kick χ² ≥ 100 | 4/34, FA 43; 12% (5%–27%); 90% (78%–95%) | 3/27, FA 80; 11% (4%–28%); 96% (90%–99%) | 4/35, FA 53 | 3/26, FA 70 |
| (k) the exclusions the misses support: perigee 400 km or more, older than a year | 54 of 75 (72%) | 16/29: 55%; 99% | 11/25: 44%; 99% | held at 7 d, z ≥ 15, ΔV ≥ 0.03 m/s, B* ratio ≥ 2, kick χ² ≥ 100 | 4/29, FA 31; 14% (5%–31%); 86% (71%–94%) | 3/25, FA 69; 12% (4%–30%); 95% (87%–98%) | 4/30, FA 50 | 3/24, FA 50 |

What the table says:

- **No scope reaches the target, and none comes near.** At every operating point of every scope that keeps one headline detection, the training false-alarm rate is at least one in two, and three in five among the scopes with enough targets to propose; every point that keeps a third of a scope's as-raised detections is above four in five. The nearest points keep one to four headline detections a split, a tenth to a quarter of the scope's targets.
- **Restricting the population, as raised, barely moves the rate.** Every scope as raised is at 91% false alarms or more on both splits, every proposed one at 94% or more. The best as raised is dead payloads and rocket bodies in low orbit above 500 kilometres and older than a year, 75% (41% to 93%) of its training targets detected at 94% false alarms and 56% (27% to 81%) of its validation targets at 96%: under a quarter of the headline events, more than half of them caught, and still some sixteen false alarms for every detection.
- **Dead satellites alone (a)** hold 13 of the 75 events with public sets; as raised they are caught at 60% and 50%, but too few to propose, and the nearest point keeps one and two of them.
- **Low orbit (e)** is the regime the step sees best and the one with the most false alarms: 41% and 44% caught at 99% false alarms, the debris and the payloads of the constellation shells stepping as breakups do.
- **The gates do the work, the scope little.** The nearest points all ask for the same thing in every scope: a step held for three to seven days, a kick one tangential burn cannot explain, a drag term that changed with the step and twenty sigma or more. Those gates bring the whole catalogue from 3,155 validation false alarms to 93; the scopes then remove a few dozen more and a few detections with them.
- **The held-out years confirm the training fit, at the level of noise.** For every proposed scope the validation recall lies inside the training interval, and the validation false-alarm rate lies inside it or one to four points above its top, the fit's own optimism: the nearest points were chosen on a handful of events, and the validation reading improves on none of them.

### The hindsight in the scopes that read the status

The same nearest points with the status read as of today (the sixth phase's committed replay) and with none (its status-off replay), for the scopes that read it, beside the dated reading. With no status there are no dead payloads, so (a) is empty and (d) is the rocket bodies.

| Scope | Status read | Headline events kept | Training at the nearest point: detected/targets, false alarms, FA rate | Validation at it |
| --- | --- | --- | --- | --- |
| (a) payloads dead at the step | as of the step | 13 of 75 | 1/5, 4, 80% | 2/8, 8, 73% |
| (a) payloads dead at the step | today's | 13 of 75 | 1/6, 5, 83% | 1/7, 16, 89% |
| (a) payloads dead at the step | none | 0 of 75 | – | – |
| (d) dead payloads and rocket bodies | as of the step | 54 of 75 | 4/30, 32, 86% | 2/24, 45, 94% |
| (d) dead payloads and rocket bodies | today's | 54 of 75 | 3/31, 35, 90% | 2/23, 47, 92% |
| (d) dead payloads and rocket bodies | none | 41 of 75 | 4/25, 34, 87% | 1/16, 41, 98% |
| (f) older than five years (the scoped line) | as of the step | 49 of 75 | 4/25, 26, 84% | 3/24, 56, 95% |
| (f) older than five years | today's | 49 of 75 | 3/25, 29, 88% | 4/24, 67, 92% |
| (f) older than five years | none | 49 of 75 | 3/25, 25, 86% | 4/24, 58, 91% |
| the whole catalogue | as of the step | 75 of 75 | 4/43, 61, 92% | 3/32, 93, 97% |
| the whole catalogue | today's | 75 of 75 | 3/43, 51, 93% | 3/32, 73, 94% |
| the whole catalogue | none | 75 of 75 | 3/43, 88, 96% | 3/32, 106, 96% |

At the strict end of the frontier the status reading matters little: the gates leave steps no reading of the status explains.

## The frontier

For the whole catalogue, the scoped line's scope and three others, every point on the training frontier (the fewest false alarms any point of the grid reached with that many headline detections) and its validation reading. The other scopes' frontiers are printed by `scope.ts --frontier`.

| Scope | Operating point (chosen on training) | Training: recall (95%) | Training: FA rate (95%), false alarms | Validation: recall (95%) | Validation: FA rate (95%), false alarms |
| --- | --- | --- | --- | --- | --- |
| the whole catalogue | as raised | 18/43: 42% (28%–57%) | 99% (99%–99%), 2965 | 11/32: 34% (20%–52%) | 100% (99%–100%), 3155 |
| the whole catalogue | held at 7 d, z ≥ 50, ΔV ≥ 0.03 m/s, B* ratio ≥ 3, kick χ² ≥ 100, unexplained only | 1/43: 2% (0%–12%) | 90% (71%–97%), 19 | 3/32: 9% (3%–24%) | 88% (70%–96%), 22 |
| the whole catalogue | held at 7 d, z ≥ 30, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5, kick χ² ≥ 100, unexplained only | 2/43: 5% (1%–15%) | 90% (75%–97%), 28 | 3/32: 9% (3%–24%) | 91% (78%–97%), 32 |
| the whole catalogue | held at 7 d, z ≥ 20, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5, kick χ² ≥ 100, unexplained only | 3/43: 7% (2%–19%) | 89% (76%–96%), 34 | 3/32: 9% (3%–24%) | 94% (84%–98%), 48 |
| the whole catalogue | held at 7 d, z ≥ 20, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5, kick χ² ≥ 100 | 4/43: 9% (4%–22%) | 92% (83%–97%), 61 | 3/32: 9% (3%–24%) | 97% (91%–99%), 93 |
| the whole catalogue | held at 7 d, Δa ≥ 300 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5, kick χ² ≥ 100 | 5/43: 12% (5%–24%) | 95% (89%–97%), 105 | 3/32: 9% (3%–24%) | 98% (93%–99%), 125 |
| the whole catalogue | held at 3 d, Δa ≥ 300 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5, kick χ² ≥ 100 | 7/43: 16% (8%–30%) | 95% (90%–97%), 152 | 4/32: 13% (5%–28%) | 98% (94%–99%), 176 |
| the whole catalogue | held at 3 d, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, kick χ² ≥ 100 | 8/43: 19% (10%–33%) | 96% (94%–98%), 273 | 5/32: 16% (7%–32%) | 98% (96%–99%), 287 |
| the whole catalogue | held at 3 d, z ≥ 15, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5 | 9/43: 21% (11%–35%) | 98% (97%–99%), 571 | 4/32: 13% (5%–28%) | 99% (98%–100%), 609 |
| the whole catalogue | held at 3 d, z ≥ 15, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 3 | 10/43: 23% (13%–38%) | 98% (97%–99%), 604 | 4/32: 13% (5%–28%) | 99% (98%–100%), 640 |
| the whole catalogue | held at 3 d, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5 | 11/43: 26% (15%–40%) | 98% (97%–99%), 766 | 4/32: 13% (5%–28%) | 100% (99%–100%), 814 |
| the whole catalogue | held at 3 d, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 3 | 12/43: 28% (17%–43%) | 98% (97%–99%), 830 | 4/32: 13% (5%–28%) | 100% (99%–100%), 879 |
| the whole catalogue | held at 5 sets, z ≥ 15, Δa ≥ 100 m, ΔV ≥ 0.03 m/s | 13/43: 30% (19%–45%) | 99% (98%–99%), 1120 | 8/32: 25% (13%–42%) | 99% (98%–100%), 1067 |
| the whole catalogue | held at 5 sets, z ≥ 15 | 14/43: 33% (20%–47%) | 99% (98%–99%), 1303 | 9/32: 28% (16%–45%) | 99% (98%–99%), 1158 |
| the whole catalogue | held at 1 d, z ≥ 15 | 15/43: 35% (22%–50%) | 99% (98%–99%), 1471 | 9/32: 28% (16%–45%) | 99% (99%–100%), 1334 |
| the whole catalogue | held at 3 sets, z ≥ 15 | 16/43: 37% (24%–52%) | 99% (98%–99%), 1696 | 10/32: 31% (18%–49%) | 99% (99%–100%), 1538 |
| the whole catalogue | held at 1 d | 17/43: 40% (26%–54%) | 99% (99%–99%), 2467 | 9/32: 28% (16%–45%) | 100% (99%–100%), 2286 |
| the whole catalogue | held at 3 sets | 18/43: 42% (28%–57%) | 99% (99%–99%), 2883 | 11/32: 34% (20%–52%) | 100% (99%–100%), 2661 |
| (f) older than five years | as raised | 14/25: 56% (37%–73%) | 99% (98%–99%), 1819 | 10/24: 42% (24%–61%) | 99% (99%–100%), 1708 |
| (f) older than five years | held at 5 d, z ≥ 50, ΔV ≥ 0.03 m/s, B* ratio ≥ 2, kick χ² ≥ 100, unexplained only | 1/25: 4% (1%–20%) | 60% (23%–88%), 3 | 3/24: 13% (4%–31%) | 81% (57%–93%), 13 |
| (f) older than five years | held at 7 d, z ≥ 30, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 2, kick χ² ≥ 100, unexplained only | 2/25: 8% (2%–25%) | 67% (35%–88%), 6 | 3/24: 13% (4%–31%) | 81% (57%–93%), 13 |
| (f) older than five years | held at 7 d, z ≥ 20, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 2, kick χ² ≥ 100, unexplained only | 3/25: 12% (4%–30%) | 69% (42%–87%), 9 | 3/24: 13% (4%–31%) | 88% (71%–96%), 23 |
| (f) older than five years | held at 7 d, z ≥ 20, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5, kick χ² ≥ 100 | 4/25: 16% (6%–35%) | 81% (63%–92%), 22 | 3/24: 13% (4%–31%) | 94% (85%–98%), 50 |
| (f) older than five years | held at 3 d, z ≥ 15, Δa ≥ 300 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5, kick χ² ≥ 100 | 5/25: 20% (9%–39%) | 88% (77%–94%), 45 | 4/24: 17% (7%–36%) | 95% (87%–98%), 72 |
| (f) older than five years | held at 3 d, Δa ≥ 300 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5, kick χ² ≥ 100 | 6/25: 24% (11%–43%) | 91% (82%–95%), 69 | 4/24: 17% (7%–36%) | 96% (90%–98%), 95 |
| (f) older than five years | held at 3 d, z ≥ 20, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5 | 7/25: 28% (14%–48%) | 97% (93%–98%), 222 | 4/24: 17% (7%–36%) | 98% (96%–99%), 245 |
| (f) older than five years | held at 3 d, z ≥ 15, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5 | 8/25: 32% (17%–52%) | 96% (93%–98%), 257 | 4/24: 17% (7%–36%) | 99% (96%–99%), 280 |
| (f) older than five years | held at 3 d, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5 | 9/25: 36% (20%–55%) | 97% (95%–98%), 371 | 4/24: 17% (7%–36%) | 99% (98%–100%), 417 |
| (f) older than five years | held at 3 sets, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5 | 10/25: 40% (23%–59%) | 98% (96%–99%), 515 | 5/24: 21% (9%–40%) | 99% (98%–100%), 534 |
| (f) older than five years | held at 1 d, z ≥ 20 | 11/25: 44% (27%–63%) | 98% (97%–99%), 722 | 8/24: 33% (18%–53%) | 99% (97%–99%), 611 |
| (f) older than five years | held at 3 sets, z ≥ 20 | 12/25: 48% (30%–67%) | 98% (97%–99%), 769 | 9/24: 38% (21%–57%) | 98% (97%–99%), 653 |
| (f) older than five years | held at 3 sets, z ≥ 15 | 13/25: 52% (33%–70%) | 98% (97%–99%), 977 | 9/24: 38% (21%–57%) | 99% (98%–99%), 813 |
| (f) older than five years | held at 3 sets | 14/25: 56% (37%–73%) | 99% (98%–99%), 1755 | 10/24: 42% (24%–61%) | 99% (99%–100%), 1587 |
| (j) dead payloads and rocket bodies in LEO above 500 km, older than a year | as raised | 6/8: 75% (41%–93%) | 94% (90%–97%), 163 | 5/9: 56% (27%–81%) | 96% (91%–98%), 141 |
| (j) dead payloads and rocket bodies in LEO above 500 km, older than a year | held at 5 sets, z ≥ 20, B* ratio ≥ 3, kick χ² ≥ 9, unexplained only | 1/8: 13% (2%–47%) | 80% (38%–96%), 4 | 3/9: 33% (12%–65%) | 60% (31%–83%), 6 |
| (j) dead payloads and rocket bodies in LEO above 500 km, older than a year | z ≥ 50, Δa ≥ 100 m, B* ratio ≥ 3, unexplained only | 2/8: 25% (7%–59%) | 85% (58%–96%), 11 | 2/9: 22% (6%–55%) | 85% (58%–96%), 11 |
| (j) dead payloads and rocket bodies in LEO above 500 km, older than a year | z ≥ 30, Δa ≥ 100 m, B* ratio ≥ 3 | 3/8: 38% (14%–69%) | 86% (65%–95%), 18 | 2/9: 22% (6%–55%) | 89% (69%–97%), 17 |
| (j) dead payloads and rocket bodies in LEO above 500 km, older than a year | z ≥ 20, B* ratio ≥ 3 | 4/8: 50% (22%–78%) | 87% (70%–95%), 26 | 3/9: 33% (12%–65%) | 88% (72%–95%), 28 |
| (j) dead payloads and rocket bodies in LEO above 500 km, older than a year | z ≥ 20, unexplained only | 5/8: 63% (31%–86%) | 92% (84%–96%), 69 | 4/9: 44% (19%–73%) | 89% (77%–95%), 42 |
| (j) dead payloads and rocket bodies in LEO above 500 km, older than a year | z ≥ 20 | 6/8: 75% (41%–93%) | 93% (87%–97%), 96 | 4/9: 44% (19%–73%) | 92% (83%–97%), 59 |
| (k) the exclusions the misses support: perigee 400 km or more, older than a year | as raised | 16/29: 55% (38%–72%) | 99% (98%–99%), 1498 | 11/25: 44% (27%–63%) | 99% (99%–99%), 1475 |
| (k) the exclusions the misses support: perigee 400 km or more, older than a year | held at 5 d, z ≥ 50, ΔV ≥ 0.03 m/s, B* ratio ≥ 2, kick χ² ≥ 100, unexplained only | 1/29: 3% (1%–17%) | 60% (23%–88%), 3 | 3/25: 12% (4%–30%) | 83% (61%–94%), 15 |
| (k) the exclusions the misses support: perigee 400 km or more, older than a year | held at 7 d, z ≥ 30, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 2, kick χ² ≥ 100, unexplained only | 2/29: 7% (2%–22%) | 67% (35%–88%), 6 | 3/25: 12% (4%–30%) | 82% (59%–94%), 14 |
| (k) the exclusions the misses support: perigee 400 km or more, older than a year | held at 7 d, z ≥ 20, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 2, kick χ² ≥ 100, unexplained only | 3/29: 10% (4%–26%) | 67% (39%–86%), 8 | 3/25: 12% (4%–30%) | 90% (74%–96%), 26 |
| (k) the exclusions the misses support: perigee 400 km or more, older than a year | held at 7 d, z ≥ 20, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5, kick χ² ≥ 100 | 4/29: 14% (5%–31%) | 83% (65%–92%), 24 | 3/25: 12% (4%–30%) | 95% (85%–98%), 53 |
| (k) the exclusions the misses support: perigee 400 km or more, older than a year | held at 3 d, z ≥ 15, Δa ≥ 300 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5, kick χ² ≥ 100 | 5/29: 17% (8%–35%) | 89% (77%–95%), 47 | 4/25: 16% (6%–35%) | 95% (88%–98%), 78 |
| (k) the exclusions the misses support: perigee 400 km or more, older than a year | held at 3 d, Δa ≥ 300 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5, kick χ² ≥ 100 | 7/29: 24% (12%–42%) | 90% (81%–95%), 72 | 4/25: 16% (6%–35%) | 96% (91%–99%), 106 |
| (k) the exclusions the misses support: perigee 400 km or more, older than a year | held at 3 d, z ≥ 20, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 3 | 8/29: 28% (15%–46%) | 96% (93%–98%), 231 | 4/25: 16% (6%–35%) | 98% (96%–99%), 255 |
| (k) the exclusions the misses support: perigee 400 km or more, older than a year | held at 3 d, z ≥ 15, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 3 | 9/29: 31% (17%–49%) | 96% (93%–98%), 264 | 4/25: 16% (6%–35%) | 99% (97%–99%), 295 |
| (k) the exclusions the misses support: perigee 400 km or more, older than a year | held at 3 d, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 5 | 10/29: 34% (20%–53%) | 97% (95%–98%), 369 | 4/25: 16% (6%–35%) | 99% (98%–100%), 422 |
| (k) the exclusions the misses support: perigee 400 km or more, older than a year | held at 3 d, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 3 | 11/29: 38% (23%–56%) | 97% (94%–98%), 385 | 4/25: 16% (6%–35%) | 99% (98%–100%), 444 |
| (k) the exclusions the misses support: perigee 400 km or more, older than a year | held at 3 sets, Δa ≥ 100 m, ΔV ≥ 0.03 m/s, B* ratio ≥ 3 | 12/29: 41% (26%–59%) | 97% (96%–98%), 525 | 5/25: 20% (9%–39%) | 99% (98%–100%), 571 |
| (k) the exclusions the misses support: perigee 400 km or more, older than a year | held at 3 sets, z ≥ 20 | 13/29: 45% (28%–62%) | 98% (97%–99%), 673 | 9/25: 36% (20%–55%) | 98% (97%–99%), 608 |
| (k) the exclusions the misses support: perigee 400 km or more, older than a year | held at 3 sets, z ≥ 15 | 14/29: 48% (31%–66%) | 98% (97%–99%), 841 | 10/25: 40% (23%–59%) | 98% (97%–99%), 734 |
| (k) the exclusions the misses support: perigee 400 km or more, older than a year | held at 3 sets, Δa ≥ 30 m | 15/29: 52% (34%–69%) | 99% (98%–99%), 1359 | 10/25: 40% (23%–59%) | 99% (98%–99%), 1282 |
| (k) the exclusions the misses support: perigee 400 km or more, older than a year | held at 3 sets | 16/29: 55% (38%–72%) | 99% (98%–99%), 1446 | 11/25: 44% (27%–63%) | 99% (98%–99%), 1370 |

## The scoped line

No scope reaches the target, so by the rule the scorecard carries the point nearest it among the scopes with at least eight headline targets on each split. The nearest shortfall, 0.74 on the training years, is shared by objects older than five years (four of twenty-five detected, 84% false alarms) and by dead payloads and non-payloads in low orbit above 500 kilometres, older than a year and quiet for a year (three of eleven, 84%); the tie goes to the first, with more detections, and within it to the loosest of the points at that shortfall. `DETECTOR_PARAMETERS.scope`:

| Part | Value |
| --- | --- |
| Population | every class, every orbit, the parent launched at least 1,825 days (five years) before the step |
| Size | 20 sigma or more at the raising |
| Impulse | at least 0.03 m/s along the track |
| Kick | the eccentricity change beyond one tangential impulse at chi-squared 100 or more |
| Drag term | changed at least two-fold across the step, where it was read |
| Tier | raised once the step has held seven days of post sets |

The committed replay (`scoped-v6`, `kpi/latest.md`), the scoped line beside the whole catalogue's headline line:

| Split | Whole catalogue: detected of targets; false alarms; FA rate | Scoped: detected, late, missed of targets (headline events left out) | Scoped recall (95%) | Scoped false alarms | Scoped FA rate (95%) |
| --- | --- | --- | --- | --- | --- |
| Validation, the odd years | 11 of 32; 3,155; 99.6% | 3, 0, 21 of 24 (14 of 38) | 13% (4% to 31%) | 56 | 95% (86% to 98%) |
| Training, the even years | 18 of 43; 2,965; 99.2% | 4, 0, 21 of 25 (25 of 50) | 16% (6% to 35%) | 26 | 84% (67% to 93%) |
| To 2017 | 16 of 44; 3,191; 99.4% | 4, 0, 22 of 26 (25 of 51) | 15% (6% to 34%) | 39 | 91% (78% to 96%) |
| From 2018 | 13 of 31; 2,929; 99.4% | 3, 0, 20 of 23 (14 of 37) | 13% (5% to 32%) | 43 | 91% (80% to 97%) |

The scoped line raises three to six alerts a year where the whole catalogue raises close to three hundred, and is right one time in six on the training years and one in twenty on the held-out ones: a fifty- to a hundred-fold cut in the false alarms, for keeping four of the eighteen headline detections on the training years and three of the eleven on the held-out ones. Its detections are the steps the parent's data make unmistakable: three deep-space ullage motors and Beidou G2 on the training years, Cosmos 192, the LES 8 and 9 stage and Cosmos 2491 on the held-out ones. Its false alarms on the held-out years are old geosynchronous payloads moving (17 of 56), old low-orbit payloads whose step came with a drag term changed nine to six hundred times over where it was read (12), highly elliptical and low-orbit debris (15), rocket bodies (6), medium-orbit payloads (4) and two others: steps of the same size, kick and persistence as the breakups', and no number the parent's data or its catalogue entry give tells them apart.

It is a point on the frontier, not a recommendation to stop there: a point keeping half its scope's headline detections (low orbit from 600 to 2,000 kilometres, held three post sets, twenty sigma: 57% and 47% caught) costs over two hundred false alarms a split instead of thirty to sixty, at 97% and 96%.

## Plainly

The parent-step channel cannot reach nine breakups in ten detected with under one false alarm in ten, in any population this study could define from what is known of the parent at the step, and the held-out years agree. The reasons are measured, not argued: a quarter of the breakups never move their parent measurably; the steps that remain after the strictest gates are physically like the breakups' (geosynchronous relocations, dead satellites whose drag term jumps, deep-space objects with poor sets); and with a handful of detections a split, one in ten allows no false alarm in eleven years. Restricting to dead satellites, to low orbit or to old objects moves the false-alarm rate by a few points; the gates move it from above 99% to near 90%, at the cost of most detections. The scoped line is that compromise, carried beside the whole-catalogue line so the owner sees both.

What could still move it is outside the parent's own step, as the earlier phases found: the pieces, which confirm after the catalogue rather than before it (the Confirmed line, 36% precise on the step on the held-out years), and sources the Archive does not hold (radar operators' notices, conjunction messages naming the object). The owner's choice is between the definition as it stands, with this study as its measured answer; the scoped line as a watch list at about one alert in fifteen right; and targets set on the Confirmed line instead.
