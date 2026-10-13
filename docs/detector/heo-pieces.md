# Pieces from highly elliptical orbits and the plane test

Issue #38 asked two questions about the fresh pieces of breakups in highly elliptical orbits (HEO), the ullage motors among them, whose pieces spread far beyond the plane test's tolerance:

1. How many fresh pieces fall outside the plane test, and are they the event's pieces or another body's?
2. Would a bound stated as an impulse keep them without admitting other bodies' pieces, in LEO and GEO too? The impulse bound is the tilt that a given normal speed change gives at the parent's apogee, its slowest point.

This note is a measurement only. **Nothing was changed**: not the score, the scorecard, the detector, its parameters, the truth or `kpi/`. It ends with a recommendation and what adopting it would change.

## Method

`scripts/kpi/heo-pieces.ts` (tests in `heo-pieces.test.ts`) reads the Archive's catalogue index, read-only. The run used the index built 2026-10-11T00:55Z, which is stale against 2026's later rebuild, and the truth of the integration branch on 2026-10-12 (commit 5329c1d), after the truth rules of #18, #19 and #21 were merged. The truth gained the Space Forces' notices after that run. Of the scoreable rows the script reads, only five LEO rows changed: the DMSP F12 and F14 events, Orbcomm FM 36 and two Starlinks. So the HEO, GEO and MEO numbers below stand as they are, and the LEO numbers may move by those rows' pieces. The rerun on the newer truth waited behind other replays for the lock and was not made. The script takes every scoreable event of that truth from 2006 with a catalogued parent. It read 293 events and skipped 51:

- 41 had no parent set before the event;
- 10 had a parent instant the index was not built for, because #21 moved their windows. One of them is HEO: ChinaSat 6A's stage, 37151, 2010-09-04. The other nine are listed in the script's report. Measuring them needs the index rebuilt for this truth.

For each event, the script chooses the fresh pieces under the parent's launch exactly as the scorecard's `fragmentsOf` does, apart from the plane test. That means the same catalogue mark, analyst floor, fragment classes, 180-day window and parent set. A check in the run confirms that today's test keeps the same number of pieces for every event as the scorecard's own count does.

For each piece the script records:

- whether today's plane test keeps it (0.2° inclination, 1.5° node, distance 3);
- the angle between its orbit normal and the parent's, with the parent's node carried for J2 as the plane test carries it;
- the normal speed change at the parent's apogee that this angle needs, `v_apogee · tan(angle)`, and the same for the inclination difference alone;
- whose piece GCAT's satellite catalogue says it is, from the committed snapshot `data/truth/sources/gcat-satcat.tsv`:
  - **the event's**: GCAT names the event's parent, with a separation date within 3 days of the event's window;
  - **the parent's at another separation**: GCAT names the parent but dates the separation elsewhere;
  - **another body's**: GCAT names a different parent;
  - **unattributed**: GCAT names no parent.

The script also measures **strangers**: fresh pieces of every *other* launch first published in the same window. They show how loose a bound is, meaning how often an unrelated orbit falls inside it by chance. Neither the scorecard nor the detector compares pieces across launches today, so strangers are a measure of looseness and not a count of false admissions.

The regime is the parent's own, read from its last set before the event. The bound was chosen on the training years (even). The held-out years (odd) were read once, after the choice.

Reproduce it with:

```
BREAKUPS_ARCHIVE=<archive> node --experimental-strip-types scripts/kpi/heo-pieces.ts [--json <path>] > report.md
```

Run it through the replay lock if replays are running.

## 1. How many HEO pieces the plane test drops, and whose they are

There are 43 HEO events from 2006, and 31 of them have fresh pieces under the launch: 447 pieces in all. GCAT says 367 are the event's, 59 the parent's at another separation, 21 another body's and 0 unattributed.

| HEO, every year from 2006 | Pieces kept | The event's (of 367) | Parent, other separation | Another body's | Strangers admitted (of 21,722) |
| --- | --- | --- | --- | --- | --- |
| Today's test | 303 | 267 (73%) | 18 | 18 | 7 |
| Normal angle within 1° | 284 | 248 | 18 | 18 | 2 |
| Today's or normal within 1° (#15's form) | 330 | 292 (80%) | 19 | 19 | 7 |
| Inclination alone, within a 100 m/s tilt | 436 | 357 | 58 | 21 | 750 |

The dropped pieces are mostly the event's own. Today's test drops 100 of the event's 367. The other bodies' pieces it keeps are almost all **twins**: pieces of a sibling under the same launch, in the same plane. Today's test keeps 12 of 14 pieces of Cosmos 2447-2449's ullage motor 33472 (March 2016) as pieces of its twin 33473's event (June 2016), and 6 of 6 of 36115's as 36116's (Cosmos 2456-2458, 2019). No plane bound can separate twin ullage motors, because they share a plane. Only the dates and the catalogue's attribution can.

The spread is not where the issue expected it. The event's own pieces have small inclination differences: a median of 0.20° to 0.34° and a 90th percentile of 0.46° to 1.07°. At HEO apogee speeds (1.4 to 5.1 km/s, 2.5 to 2.7 km/s for the GLONASS ullage motors), that is a median impulse of 15 to 23 m/s and a 90th percentile under 50 m/s. The large angles come from the **node**, and they grow with the days between the event and the piece's first set:

| HEO, the event's own pieces, by first set after the event | Pieces | Normal angle: median, 90th percentile | \|Δi\|: median, 90th percentile | Needed Δv for the normal angle: median, 90th percentile | Needed Δv for the inclination alone: median, 90th percentile |
| --- | --- | --- | --- | --- | --- |
| Within 7 days | 4 | 8.14°, 26.45° | 0.33°, 0.46° | 726, 1,326 m/s | 23, 28 m/s |
| 8 to 30 days | 131 | 0.30°, 1.37° | 0.20°, 0.47° | 26, 93 m/s | 16, 39 m/s |
| 31 to 90 days | 110 | 0.67°, 6.12° | 0.33°, 1.07° | 31, 282 m/s | 15, 49 m/s |
| Over 90 days | 122 | 1.00°, 5.45° | 0.34°, 0.97° | 47, 251 m/s | 15, 46 m/s |

Cosmos 2447-2449's 33472 event (2016-03-26) shows the pattern. Eleven of its 14 pieces were first set on day 104. All 11 are 4° to 7° off in node (normal angle 3.8° to 6.2°) and under 0.5° off in inclination. This note read that common offset as a node carried wrongly over 104 days. Issue #42 measured it, and it is not: all 11 lie in the plane of the twin 33473's event of 2016-06-01, first set 37 days after it (the section on issue #42 below).

Cosmos 2139-41's ullage motor (21220, 2009-03-08), named in the issue, has 31 pieces, and GCAT dates all 31 to the parent on that day. Today's test keeps 3, the normal angle within 1° keeps 5, and the inclination alone within a 100 m/s tilt keeps 23. Seven pieces are more than 5° off in inclination, up to 19.3°. That would need over 230 m/s, and up to about 920 m/s, at an apogee speed of 2.63 km/s, which is not a plausible breakup impulse for most of them. Two more are 77° and 90° off in node. All nine were first set 40 to 101 days after the event. The index holds only each piece's earliest set, so this measurement cannot tell a poor first orbit from a real one.

## 2. The impulse bound, and what it admits

A normal impulse `Δv` at the parent's apogee tilts the plane by at most `atan(Δv / v_apogee)`. For 100 m/s that is:

| Regime | Tilt for 100 m/s |
| --- | --- |
| LEO | 0.73° to 0.82° |
| MEO | 0.98° to 1.57° |
| GEO | 1.86° to 1.91° |
| The HEO parents measured | 1.13° to 4.06° |

The bound was measured alone and in union with today's test and #15's form.

**Training years (even), chosen on these:**

| Bound | HEO: the event's (of 288) | HEO: other body / parent, other separation | HEO: strangers (of 9,315) | LEO: the event's (of 1,809) | LEO: other body | LEO: strangers (of 62,650) | GEO: the event's (of 44) | GEO: strangers (of 1,740) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Today's test | 224 | 12 / 4 | 5 | 1,553 | 49 | 131 | 10 | 1 |
| #15's form | 245 | 12 / 5 | 5 | 1,568 | 49 | 143 | 38 | 4 |
| Impulse 50 m/s alone | 204 | 11 / 4 | 0 | 803 | 30 | 6 | 38 | 4 |
| Impulse 100 m/s alone | 258 | 11 / 6 | 2 | 1,162 | 45 | 27 | 44 | 7 |
| #15's or impulse 50 m/s | 255 | 12 / 5 | 5 | 1,568 | 49 | 143 | 38 | 4 |
| **#15's or impulse 100 m/s** | **267** | **12 / 6** | **6** | **1,568** | **49** | **143** | **44** | **7** |
| #15's or impulse 150 m/s | 268 | 12 / 8 | 13 | 1,569 | 49 | 148 | 44 | 7 |
| #15's or impulse 200 m/s | 271 | 12 / 8 | 21 | 1,569 | 49 | 191 | 44 | 7 |
| Inclination alone, 100 m/s | 286 | 14 / 31 | 541 | 1,787 | 57 | 7,079 | 44 | 10 |

What the training years show:

- **The bound alone is the wrong shape in LEO.** In LEO, 100 m/s is a tighter bound than today's test, so it would keep 391 fewer of the event's pieces than today's test does. As a union with #15's form it changes nothing in LEO up to 100 m/s: it is identical on both splits, because 1° there already exceeds a 100 m/s tilt. In HEO and GEO the union widens the bound where it should.
- **Admissions of other bodies within the launch do not rise.** Up to 100 m/s the union admits no piece of another body that #15's form does not already admit: 12 in HEO and 49 in LEO, the twins included. It admits one more piece that GCAT dates to the parent at another separation.
- **Past 100 m/s, more strangers come in than pieces.** 100 m/s keeps 22 more of the event's HEO pieces than #15's form, at the cost of 1 stranger and 1 piece of another separation. 150 m/s adds 1 more piece for 7 more strangers and 2 more pieces of another separation, and 200 m/s adds 3 for 8 more strangers. 100 m/s was chosen.
- **The inclination alone is not a usable test.** It keeps almost every HEO piece (286 of 288), but admits 541 strangers in HEO and 7,079 in LEO, because the node is what tells planes apart.

**Held-out years (odd), read once after the choice:**

| Bound | HEO: the event's (of 79) | HEO: other body / parent, other separation | HEO: strangers (of 12,407) | LEO: the event's (of 5,814) | LEO: other body | LEO: strangers (of 79,491) | GEO: the event's (of 2) | GEO: strangers (of 2,688) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Today's test | 43 | 6 / 14 | 2 | 5,113 | 5 | 150 | 2 | 0 |
| #15's form | 47 | 7 / 14 | 2 | 5,290 | 5 | 168 | 2 | 0 |
| **#15's or impulse 100 m/s** | **56** | **7 / 16** | **9** | **5,290** | **5** | **168** | **2** | **3** |

The held-out years agree with the choice:

- HEO: 9 more of the event's pieces than #15's form, no more pieces of other bodies, 2 more of the parent's other separations, and 7 more strangers.
- LEO: unchanged.
- GEO: no piece to gain (both of its 2 pieces are kept by every form), and 3 strangers.

MEO is unchanged on both splits: 222 and 2 of the event's pieces, no strangers.

The bound still leaves pieces outside, and they are the node's doing. Of the event's HEO pieces it still drops, 21 on the training years and 23 on the held-out, 19 and 15 fall within 100 m/s on the inclination alone, and 15 and 21 were first set more than 30 days after the event.

## Recommendation

For the plane test, keep a piece when **today's test passes, or its orbit normal is within the larger of 1° and the tilt a 100 m/s normal impulse gives at the parent's apogee**. The normal angle is measured with today's J2 carry of the node. This is #15's form, widened only where the parent is slow at apogee. In LEO, where a 100 m/s tilt is under 1°, it is #15's form exactly. Use it for the scorecard's target count and, through #37, for the detector. 100 m/s is a constant chosen on the training years, where the strangers it admits start to outnumber the pieces it gains. It should be stated as such (a fitted value in `PARAMETER_PROVENANCE` when it reaches `src/params.ts`).

Two things it does not fix:

- **Twin ullage motors.** Their pieces share a plane. Telling them apart takes the event dates and the catalogue's attribution, which the detector already reads as twins at the launch.
- **The node carried over months for decaying HEO pieces.** This note took it for what leaves the rest outside. Issue #42 measured it (below): the carry was already each piece's own rate, and bounding drag's effect on that rate admits more strangers than pieces in HEO.

## What adopting it would change, and what did not change

Nothing in this branch changes a score. The script reads the index and writes a report.

Adopting the bound on top of #15's form would change three things:

- **The scorecard's targets.** One event becomes a target that #15's form does not make a target: SATCOM 3 (11635, 2021-09-30, held-out, confidence D, so outside the headline's A and B). Its two pieces kept are ones GCAT dates to another separation of the same parent.

  #15's form already adds Intelsat 33e (A, GEO, training), Ariane 5 L540 and L583 ESC-A (C, HEO, held-out) and Delta 229 (C, LEO, held-out) as targets over today's test. On the other HEO and GEO events the counts kept rise: 22 more of the event's HEO pieces on the training years and 9 more on the held-out, and 6 more GEO pieces on the training years (4 of Titan IIIC Transtage's, 2 of Intelsat 33e's). Each event's first fresh piece, and with it the lag to the catalogue, may move earlier.
- **The detector**, if #37 adopts it. More HEO and GEO pieces would enter the cloud judgement, the parent-in-cloud refusal, the attribution and the nearest-cloud distance. Confirmations of HEO events could come earlier or more often, and a cloud could be refused differently. None of this was replayed. Measuring it needs a replay under the lock, on the training years first.
- **Anything already published.** The frozen prospective test runs its tag's own code and is untouched, whatever is adopted.

## Issue #42: the node carried at each body's own rate

Issue #42 put forward a hypothesis: the plane test carries the parent's node to the piece's first set at the **parent's** J2 rate, so a piece on another orbit, first seen weeks late, misses the plane in node. The owner decided on 2026-10-13 to fix the carry before widening any bound, and to measure first. The measurement compares each piece with the parent **at the event's instant**. The piece's node is carried back from its first set at its own J2 rate (from that set's a, e and i), and the parent's is carried forward from its last set before the event at the parent's rate. The measurement also bounds drag's effect on the piece's rate over the gap.

The run used the release's catalogue index (built 2026-10-13T07:19Z) and the truth of the integration branch `spec-41-42` (commit 289426e). It read 296 events and skipped 48 with no parent set before the event. The index held every parent instant this truth asks for. The script's report section "The nodes carried to the event's instant, and drag bounded" holds the tables below in full.

### The carry asked for is the carry already made

Today's carry (`carriedNodeDifferenceDeg` in `src/fragments.ts`) takes the parent's node to the piece's epoch at the parent's rate. It then takes off the difference of the two rates times the days since the event:

    ΔΩ = Ω_piece − [Ω_parent + ρ_parent·(t_piece − t_parent)] − (ρ_piece − ρ_parent)·(t_piece − t_event)
       = [Ω_piece − ρ_piece·(t_piece − t_event)] − [Ω_parent + ρ_parent·(t_event − t_parent)]

The second line is the piece's node carried back to the event at its own rate, less the parent's node carried forward to the event. That is exactly the carry the issue asked for. The run confirms it. Over all 180,658 pieces and strangers, the two node differences agree within 2·10⁻¹²°. The scorecard's test keeps the same pieces under both, in every regime and on both splits. The detector's test (`planeTestDistance`) reads the same function.

**Applying it would change nothing**, so it was not applied: not the scorecard's `FRAGMENTS_PLANE` test, not the detector's, not the score. No replay was needed, and the published lists do not move.

### Cosmos 2447-2449's batch is its twin's

The batch this note read as a wrong carry (11 pieces of 33472's event of 2016-03-26, first set on day 104, all 4° to 7° off in node) does not miss the plane by carry. The script tests each piece the scorecard's test drops against every other event of the same launch whose instant precedes the piece's first set (`twinEventOf`). All 11 lie in the plane of the twin 33473's event of 2016-06-01, within 1.1° in node and 0.41° in inclination, first set 37 days after that event. The three pieces first set on day 97 (41560 to 41562) lie in 33472's plane, within 1.6° in node; two of them are 5.3° and 5.7° off 33473's in node. So the plane separates the two batches. GCAT gives all 14 to 33472 on 2016-03-26.

| Regime | The event's pieces the scorecard's test drops: training | A twin event's plane keeps | Held-out | A twin's plane keeps |
| --- | --- | --- | --- | --- |
| HEO | 43 | 11 (Cosmos 2447-2449's batch) | 32 | 0 |
| LEO | 241 | 19 (18 of Soyuz-2-1b No. 013 Blok-I's, 39187 of 2024-06-25, in the plane of 39186's event a day later; 1 of Zenit-2M 1-2005's stage) | 524 | 0 |
| GEO | 6 | 0 | 0 | 0 |
| MEO | 91 | 0 | 0 | 0 |

This is the catalogue's attribution against the planes. It is a question for the truth's review and is not changed here: the truth is never edited from the detector's or the scorecard's own readings.

### Drag, bounded

The carry uses the rate of the piece's first set for the whole gap. Drag lowers a piece's orbit after the event, and its J2 rate changes with it, so the first set's rate is the rate at the end of the gap and not its mean. The index holds each piece's earliest set only, with no drag term, so the drag cannot be stated per piece. It can be bounded. A piece thrown off at a modest speed started on about the parent's orbit, so its mean rate over the gap lies between the parent's rate and its own. `dragBandOf` gives the node difference at both ends of that band and the least any rate between them gives. Two forms were measured under the scorecard's test:

- **drag bounded**: the band read for every piece;
- **below the parent**: the band read only where the piece's first set sits below the parent's semi-major axis, as drag leaves a piece. Drag cannot have raised a piece, so a piece above the parent is read at its own rate.

No tolerance was chosen: both forms are the scorecard's test with its frozen tolerances. So the held-out years were read in the same run, with no choice to keep them blind for.

| Regime, split | The event's pieces kept: today's / drag bounded / below the parent (of) | Strangers admitted: today's / drag bounded / below the parent (of) |
| --- | --- | --- |
| HEO, training | 245 / 257 / 251 (288) | 5 / 40 / 40 (9,315) |
| HEO, held-out | 47 / 56 / 54 (79) | 2 / 19 / 18 (12,407) |
| LEO, training | 1,585 / 1,744 / 1,723 (1,826) | 143 / 325 / 182 (64,140) |
| LEO, held-out | 5,290 / 5,429 / 5,373 (5,814) | 168 / 393 / 229 (79,491) |
| GEO, training | 38 / 38 / 38 (44) | 4 / 4 / 4 (1,740) |
| GEO, held-out | 2 / 2 / 2 (2) | 0 / 1 / 1 (2,688) |
| MEO, training | 222 / 302 / 272 (313) | 0 / 1 / 1 (657) |
| MEO, held-out | 2 / 2 / 2 (2) | 0 / 1 / 0 (1,317) |

Neither form keeps the event's pieces without admitting strangers:

- **HEO.** Drag bounded keeps 12 more of the event's pieces on the training years and admits 35 more strangers. Below the parent keeps 6 more for the same 35. Strangers grow eight to nine times on both splits.
- **LEO.** Drag bounded keeps 159 more and admits 182 more strangers on the training years. Below the parent keeps 138 more for 39 more strangers on the training years, and 83 more for 61 more strangers on the held-out years.
- **GEO.** No drag, nothing to gain, and one more stranger on the held-out years.
- **MEO.** Here drag does matter, on one event. The MEO gain is all SL-23 DEB's (37756, 2020-05-08, a Fregat tank on a low-perigee orbit of e 0.19). Drag bounded keeps 80 of its 92 dropped pieces for 1 stranger. It is one event, already a target.

By the owner's criterion (rescue the event's pieces without admitting strangers), **neither form is adopted**, and nothing was applied to the scorecard or the detector. The score, the targets and the detector's confirmations are unchanged.

### What is left

- The HEO pieces the scorecard's test still drops are 43 of the event's on the training years and 32 on the held-out. The twin explains 11 of the training ones. The rest are neither a carry fault nor drag that the band can separate from strangers.
- The owner set #38's impulse bound (today's test or the normal within max(1°, the tilt a 100 m/s normal impulse gives at the parent's apogee)) to be reconsidered only if pieces still fall outside after this fix. They do, and this fix changes nothing, so that decision is the owner's again. The measurement above (section 2) stands as it was.
- Stating drag per piece, not bounding it, needs each piece's drag term or its later sets. The catalogue index holds neither. It would mean extending the index and uploading the side files again.
- GCAT's attribution of Cosmos 2447-2449's day-104 batch, and of Soyuz-2-1b No. 013 Blok-I's 18 pieces, disagrees with the planes. That is for the truth's review.
