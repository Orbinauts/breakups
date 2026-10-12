# The plane test at near-zero inclination

The detector's plane test compared a piece's inclination and node with the parent's separately: a distance in units of the tolerances, 0.2 degrees of inclination and 1.5 of node, within three. At near-zero inclination the node is undefined. A geosynchronous parent's pieces scatter over the whole circle of nodes and none passes, so the detector could not confirm such a breakup from its pieces at all: not in the cloud judgement, not in the attribution, and not in the refusals that read the plane (the parent in a remembered cloud's plane, the pieces out of it, the launch's older debris as parents). Measured on the Archive's catalogue index, Intelsat 33e (41748, 2024-10-19, inclination 0.02 degrees) had 18 fresh pieces under its launch within 180 days, none passing and 16 with their orbit normal within half a degree of the parent's; Cosmos 2513's rocket body (41122, 2016-01-16, 0.17 degrees) had 6, one passing, 5 within half a degree and 6 within one.

The scorecard's own target test had the same fault and was given its own test first, so that each change's effect on the score is seen apart: a piece is in the parent's plane by the plane test with its tolerances frozen, or with its orbit normal within a degree of the parent's (`FRAGMENTS_PLANE` in `scripts/kpi/catalogue.ts`, the seventh decision record's note of 2026-10-12). This note records the detector's side.

## The form

The form was decided before any replay: the detector's test is today's test or the angle between the orbit normals, as the scorecard's is. `planeTestDistance` (`src/fragments.ts`) is the lesser of today's distance and the normal angle scaled so its bound falls at `planeDistanceMax`: the angle over `planeNormalAngleMaxDeg`, times three. A piece is therefore in the plane by today's tolerances or by the normals, and every place that compared a distance with `planeDistanceMax` reads the same test unchanged: the cloud judgement (`judgeCloud`), the parent-in-cloud and pieces-in-cloud refusals and the nearer-than-the-cloud rule (`nearestCloudDistance`), the attribution's older debris parents (`attribution.ts`), and the false-alarm audit (`scripts/kpi/audit.ts`). The parent's node is carried to the piece's epoch for J2 as before, the days since the event are limited as before, and with the angle at zero the test is today's alone.

The normals bound is not only a fix at low inclination. At high inclination the angle between two normals is about the hypotenuse of the inclination difference and the node difference times the sine of the inclination, so a bound of a degree lets in a piece up to a degree off in inclination, where today's tolerances stop at 0.6; and it lets in less node than today's at high inclination (today's bound allows up to 4.5 degrees of node). Taking the lesser of the two keeps everything today's test passed.

## The choice, on the training years

The candidates were half a degree and one degree. The criterion, written before either replay was read (2026-10-12 22:42): on the training years (the even years, 2006 to 2026), each candidate scores the Confirmed-line detections it gains on every line less the false confirmations it gains, against the same branch with the angle off; the higher score is taken, the tighter on a tie, and the test stays off if both score below zero.

Three exploration replays, all approximate (`--parallel 4` from the carried states of 2015, 2021 and 2024), on the integration branch with the scorecard's own plane test, over the release-faithful Archive with the truth whose SHA-256 begins `500fe7ed`. The baseline with the angle off is the shared replay of the same detector rematched with this branch's scorecard (`npm run kpi -- --rematch`): the detector is the same at zero, and the scorecard's plane test does not read the detector's parameters.

| Training years | Off | Half a degree | One degree |
| --- | --- | --- | --- |
| Headline (breakups A and B) confirmed, of the targets | 23 of 38 (61%, 45% to 74%) | 24 of 38 (63%, 47% to 77%) | 24 of 38 (63%, 47% to 77%) |
| Confirmed-line detections, every line | 36 | 37 | 37 |
| False confirmations | 2 (5%, 1% to 18%) | 2 (5%, 1% to 17%) | 1 (3%, 0% to 14%) |
| Score: detections gained less false confirmations gained | | +1 | +2 |

One degree is taken. Both candidates confirm Intelsat 33e (2024-10-19): its step alert, raised on the parent's own orbit, is confirmed by its pieces on 2024-11-21, where with the angle off its pieces were never in its plane. One degree also removes one training false confirmation: the 2014 attribution to 33384, an ullage motor of Cosmos 2442-44's launch (2008-046), is no longer made at one degree (the reported breakup of the launch's other ullage motor, 33385 on 2014-05-20, stays a miss, its judgement refused as a single piece where it was refused as an old cloud); and it confirms the Titan IIIC Transtage (2018-02-28) 17 days sooner, on the day of its first fragment's publication. No other training detection or false confirmation moved; the other lines' targets and detections are the same, and the early warning is untouched (29 reported breakups flagged on the training years and 2,903 false alarms, in all three).

A second verdict under Intelsat 33e's launch, the attribution to its sibling payload 41747, lands as exempt in the window of an unnamed burst under the launch (`U:11:2024-05-27`), neither a detection nor a false confirmation. Cosmos 2513's rocket body (2016) now has 6 pieces in its plane where it had 1, but the attribution is refused as a cataloguing batch: the fault there is no longer the plane.

## The held-out years, read once

After the choice, the held-out years (the odd years, 2007 to 2025) were read for one degree against the angle off:

| Held-out years | Off | One degree |
| --- | --- | --- |
| Headline (breakups A and B) confirmed, of the targets | 18 of 26 (69%, 50% to 83%) | 19 of 26 (73%, 54% to 86%) |
| Confirmed-line detections, every line | 23 | 24 |
| False confirmations | 4 (14%, 6% to 31%) | 5 (17%, 7% to 34%) |
| Duplicates | 2 | 4 |

The detection gained is Cosmos 2464-66's ullage motor (37144, 2019-08-12), whose step alert its pieces confirm 51 days after the event and about 29 days before the first agency statement. The false confirmation gained is an attribution in 2015 to 40172, a debris-classed body of launch 2010-057, from three pieces whose normals lie within a degree of its own; their semi-major axes centre 15,342 km from its, their cloud moves 5,100 m/s from it, and their convergence misses it by 26,355 km, yet the origin override lets them through because the three cross it within minutes of one instant. That is a weakness of the origin override on a far miss more than of the plane: no rule bounds the miss when the override applies. It is recorded here, not tuned on the held-out years. The two duplicates are second confirmations of events already detected (Fengyun-1C in 2007 and Cosmos 1408 in 2021).

Before the choice, the console's diff of the two candidates' per-event dissections, run to explain the training difference, also printed held-out rows (Cosmos 2464-66's confirmation among them). The criterion had been written before, and reads the training numbers only, so the choice did not depend on it; it is stated here because the held-out years were not unseen at the moment of choosing. Half a degree's held-out numbers, printed beside one degree's after the choice, are the same as the angle off.

## The tests

`src/fragments.test.ts`: a geosynchronous parent at 0.02 degrees whose six pieces scatter over the circle of nodes is the parent of no consistent piece with the angle off and of all six at half a degree and, as fitted, at one; a stage at 0.17 degrees keeps the one piece today's tolerances pass, gains the four within half a degree and the sixth only at one degree; a geosynchronous parent lies in the plane of its launch's earlier cloud, whose nodes are all round the circle; at high inclination, a piece five degrees off in node is out at every angle, and one 0.8 degrees off in inclination is in at one degree only; and the normals are not read beyond the days the node can be carried.
