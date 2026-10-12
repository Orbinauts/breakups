# Pieces from highly elliptical orbits and the plane test

Issue #38 asked two questions about the fresh pieces of breakups in highly elliptical orbits (HEO), the ullage motors among them, whose pieces spread far beyond the plane test's tolerance:

1. How many fresh pieces fall outside the plane test, and are they the event's pieces or another body's?
2. Would a bound stated as an impulse keep them without admitting other bodies' pieces, in LEO and GEO too? The impulse bound is the tilt that a given normal speed change gives at the parent's apogee, its slowest point.

This note is a measurement only. **Nothing was changed**: not the score, the scorecard, the detector, its parameters, the truth or `kpi/`. It ends with a recommendation and what adopting it would change.

## Method

`scripts/kpi/heo-pieces.ts` (tests in `heo-pieces.test.ts`) reads the Archive's catalogue index, read-only. The run used the index built 2026-10-11T00:55Z, which is stale against 2026's later rebuild, and the truth of the integration branch on 2026-10-12, after the truth rules of #18, #19 and #21 were merged. The script takes every scoreable event of that truth from 2006 with a catalogued parent. It read 293 events and skipped 51:

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

Cosmos 2447-2449's 33472 event (2016-03-26) shows the pattern. Eleven of its 14 pieces were first set on day 104. All 11 are 4° to 7° off in node (normal angle 3.8° to 6.2°) and under 0.5° off in inclination. One common offset across a whole batch is a node carried wrongly over 104 days, not eleven separate impulses. The carry uses each piece's first-set orbit for its whole J2 rate since the event. A piece of a low-perigee HEO orbit decays, and its rate changes over those months.

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
- **The node carried over months for decaying HEO pieces.** This is what leaves the rest outside. A follow-up could carry the node with the piece's rate averaged over the interval, or read it from the piece's set nearest the event rather than its earliest. That would need each piece's later sets, which the index does not hold. It is not measured here.

## What adopting it would change, and what did not change

Nothing in this branch changes a score. The script reads the index and writes a report.

Adopting the bound on top of #15's form would change three things:

- **The scorecard's targets.** One event becomes a target that #15's form does not make a target: SATCOM 3 (11635, 2021-09-30, held-out, confidence D, so outside the headline's A and B). Its two pieces kept are ones GCAT dates to another separation of the same parent.

  #15's form already adds Intelsat 33e (A, GEO, training), Ariane 5 L540 and L583 ESC-A (C, HEO, held-out) and Delta 229 (C, LEO, held-out) as targets over today's test. On the other HEO and GEO events the counts kept rise: 22 more of the event's HEO pieces on the training years and 9 more on the held-out, and 6 more GEO pieces on the training years (4 of Titan IIIC Transtage's, 2 of Intelsat 33e's). Each event's first fresh piece, and with it the lag to the catalogue, may move earlier.
- **The detector**, if #37 adopts it. More HEO and GEO pieces would enter the cloud judgement, the parent-in-cloud refusal, the attribution and the nearest-cloud distance. Confirmations of HEO events could come earlier or more often, and a cloud could be refused differently. None of this was replayed. Measuring it needs a replay under the lock, on the training years first.
- **Anything already published.** The frozen prospective test runs its tag's own code and is untouched, whatever is adopted.
