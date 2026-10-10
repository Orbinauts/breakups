# Fitting the fifth phase of the detector

The fifth phase, `fusion-v4`, keeps the detection rules of the first three phases (`d1-fitting.md` to `d3-fitting.md`) and makes the Confirmed line precise: the rules by which the pieces the catalogue lists under a launch confirm an open alert, swept on the training split; the Confirmed line as its own block of the scorecard; the per-event dissection (`events.md`); and the freeze (`src/params.ts`, `PARAMETER_PROVENANCE`; `README.md` in this folder). This note records what the third phase's confirmations were, what was swept, what was chosen, what it cost, and two faults of the scorecard found on the way. The validation split (the odd years) was not looked at while choosing; its numbers are in `kpi/latest.md` and the README.

## The discipline

- The training split is the even years, 2006 to 2026; the validation split the odd years, 2005 to 2025.
- The whole Archive was replayed once with the five rules off (`npm run kpi -- --all --out kpi/work/d5-off --param cloudMemoryDays=0 --param freshPieceDays=0 --param confirmDeltaVMinMps=0 --param debrisParentNeedsNearerThanCloud=false --param singlePieceNeedsQuietLaunch=false`), which confirms exactly as the third phase did and reproduces its numbers to the alert, while every alert's row logs the reading the rules would have made (the pieces and their velocity, the parent's age under its launch and its class, the launch's background, its remembered cloud, the parent's and the pieces' plane distances to that cloud). The rules were then swept offline over those rows with `npm run kpi:sweep -- --confirmations`, on the even years alone, and the Archive replayed once more with the values chosen: that replay is the committed result.
- The sweep composes the per-piece rules by counts (the pieces one rule leaves out are taken as the same the next would), so its totals are an approximation; the replay with the rules on is the record, and the two differ by a few confirmations where an alert the rules refused on one batch of pieces was confirmed by a later batch.

## What the third phase's confirmations were

The third phase counted 33 confirmed alerts over the twenty-two years, 13 on reported events. That count missed a kind: a step the object's record read as a manoeuvre and the pieces then promoted lands as a confirmed verdict of its own, which the matcher had not marked as confirmed (fixed in this phase, so the counts below are larger than the third phase's). With every confirmation counted and the scorecard's two faults below fixed, the line before this phase's rules read, on the validation split, 43 confirmed alerts: 5 on a reported event's step, 6 on the parent of a reported event whose window ended within the month before the step (the right object, the step late: Fengyun 1C a month after its breakup, Cosmos 2392's ullage motor, CBERS 1 the day after), 29 on nothing and 3 inside exempt windows (the station's jettisons); a precision of 12% on the step and 26% on the object. On the training split 41: 11, 2, 24 and 4, a precision of 27% and 32%.

The wrong ones were of the kinds the owner named, and of two more the listing showed. Clouds still being catalogued from a recent event: Fengyun 1C's remnant and its fragments confirmed by the cloud's batches through 2007 and 2016, Cosmos 2421's fragments in 2008 by its own pieces, Iridium 33's in 2011, the ullage motors' siblings under the Cosmos navigation launches. The parent a fragment itself, days old, its settling fit "confirmed" by its siblings (the station's jettisoned items, Cosmos 2421's and Cosmos 2139's pieces). Single pieces under old launches (eleven of the forty-three). And two kinds beyond the owner's list: bodies in the parent's own orbit at a tenth of a metre a second, the catalogue's re-designations or a release (twelve Fengyun 1C pieces at 0.1 m/s in 2016, a pair at 0.0 m/s under a 2019 launch, the station's jettisons at under a metre a second); and the station itself, whose record is its reboosts and whose launch sheds a few items a year in its own plane.

## The rules swept on the training split

Each rule alone, the others off, over the forty confirmation readings of the even years; then all together at the detector's values. "On nothing" is a false alarm by the step and by the object; "the right object" is a false alarm by the step on the parent of a reported event within the month before.

years 2006, 2008, 2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024, 2026: 40 confirmation readings on the alert rows
| rule | kept | on a reported event's step | on the right object, the step late | on nothing | exempt or duplicate |
| --- | --- | --- | --- | --- | --- |
| as the third phase confirmed (the rules off) | 40 | 10 | 2 | 24 | 4 |
| the pieces move at least 0.5 m/s (confirmDeltaVMinMps) | 36 | 10 | 2 | 20 | 4 |
| the pieces move at least 1 m/s (confirmDeltaVMinMps) | 34 | 10 | 2 | 18 | 4 |
| the pieces move at least 2 m/s (confirmDeltaVMinMps) | 25 | 8 | 2 | 12 | 3 |
| a debris-classed parent first seen under 30 days before its step confirms nothing (freshPieceDays) | 38 | 10 | 2 | 24 | 2 |
| a debris-classed parent first seen under 90 days before its step confirms nothing (freshPieceDays) | 38 | 10 | 2 | 24 | 2 |
| a debris-classed parent first seen under 180 days before its step confirms nothing (freshPieceDays) | 38 | 10 | 2 | 24 | 2 |
| a launch with a cloud in the last 180 days: pieces out of its plane, the parent not in it (cloudMemoryDays) | 30 | 9 | 2 | 18 | 1 |
| a launch with a cloud in the last 365 days: pieces out of its plane, the parent not in it (cloudMemoryDays) | 27 | 9 | 2 | 15 | 1 |
| a launch with a cloud in the last 730 days: pieces out of its plane, the parent not in it (cloudMemoryDays) | 26 | 9 | 2 | 14 | 1 |
| a debris-classed parent under an active cloud: pieces nearer than the cloud (debrisParentNeedsNearerThanCloud) | 39 | 10 | 2 | 24 | 3 |
| a single piece: the parent not debris, the launch quiet (singlePieceNeedsQuietLaunch) | 27 | 9 | 2 | 14 | 2 |
| every rule at the detector's values | 18 | 9 | 2 | 7 | 0 |

What the table says:

- The velocity floor (`confirmDeltaVMinMps`), the review list's metre a second applied to the confirmation, cuts six wrong confirmations for no right one; two metres a second would cut two right ones (Hitomi's pieces move 1.4 m/s from it, NOAA 14's 1.4), so one is kept.
- The fresh-piece rule (`freshPieceDays`) acts on the exempt ones on the training split (Cosmos 2421's fragments, confirmed by their siblings inside the event's own window) and on the validation split's station items and Cosmos 2139 pieces; thirty, ninety and a hundred and eighty days read the same, and ninety is kept, the age under which the detector holds an object's record to be unknown.
- The cloud memory (`cloudMemoryDays`) is the rule that bites: a year cuts nine wrong confirmations and costs one right one, Cosmos 2535's second step in January 2020, confirmed by a single piece under a launch whose cloud of October 2019 lay in its own plane. Six months cuts fewer; two years cuts no more wrong ones and a further right-object one on the validation split. The truth's own same-cloud rule is a year, and a year is kept.
- The debris-parent rule (`debrisParentNeedsNearerThanCloud`) alone cuts one; its cases on both splits are mostly the fresh-piece rule's too, and it stands behind that rule for a fragment old enough to have a record of its own.
- The single-piece rule (`singlePieceNeedsQuietLaunch`) cuts ten wrong confirmations and one right (Cosmos 2535 again, a single piece under a launch that had gained fourteen bodies in the year before); NOAA 14's single piece, under a launch that gained nothing in eighteen years, stays.
- All together: 18 kept of 40, 9 on a reported event's step, 2 on the right object, 7 on nothing, none exempt. The replay with the rules on confirms 23 on the training split (an alert refused on one batch is confirmed by a later one): 10 on the step, 2 on the right object, 10 on nothing, 1 exempt.

The same table on the validation split, read once after the values were fixed:

years 2005, 2007, 2009, 2011, 2013, 2015, 2017, 2019, 2021, 2023, 2025: 43 confirmation readings on the alert rows
| rule | kept | on a reported event's step | on the right object, the step late | on nothing | exempt or duplicate |
| --- | --- | --- | --- | --- | --- |
| as the third phase confirmed (the rules off) | 43 | 5 | 6 | 29 | 3 |
| the pieces move at least 0.5 m/s (confirmDeltaVMinMps) | 39 | 5 | 6 | 25 | 3 |
| the pieces move at least 1 m/s (confirmDeltaVMinMps) | 34 | 5 | 6 | 20 | 3 |
| the pieces move at least 2 m/s (confirmDeltaVMinMps) | 29 | 5 | 6 | 15 | 3 |
| a debris-classed parent first seen under 30 days before its step confirms nothing (freshPieceDays) | 42 | 5 | 6 | 29 | 2 |
| a debris-classed parent first seen under 90 days before its step confirms nothing (freshPieceDays) | 40 | 5 | 6 | 29 | 0 |
| a debris-classed parent first seen under 180 days before its step confirms nothing (freshPieceDays) | 39 | 5 | 5 | 29 | 0 |
| a launch with a cloud in the last 180 days: pieces out of its plane, the parent not in it (cloudMemoryDays) | 27 | 5 | 4 | 18 | 0 |
| a launch with a cloud in the last 365 days: pieces out of its plane, the parent not in it (cloudMemoryDays) | 25 | 5 | 4 | 16 | 0 |
| a launch with a cloud in the last 730 days: pieces out of its plane, the parent not in it (cloudMemoryDays) | 23 | 5 | 3 | 15 | 0 |
| a debris-classed parent under an active cloud: pieces nearer than the cloud (debrisParentNeedsNearerThanCloud) | 40 | 5 | 6 | 28 | 1 |
| a single piece: the parent not debris, the launch quiet (singlePieceNeedsQuietLaunch) | 27 | 5 | 5 | 15 | 2 |
| every rule at the detector's values | 13 | 5 | 3 | 5 | 0 |

The ten training confirmations the committed replay leaves on nothing are worth the owner's eye rather than a sixth rule: a 1989 rocket body with thirty-eight new pieces at 24 m/s in 2006, a 2006 payload with eighteen pieces at 26 m/s, another with two at 34 m/s, a 2012 payload with two at 50 m/s, a 2009 payload with four at 1.4 m/s, a 2012 payload with one at 18 m/s, a 2018 payload with one at 4 m/s, and the station three times (its reboosts promoted by jettisoned items at 1 to 8 m/s, in 2006, 2008 and 2010). The first four have a breakup's velocity and spread and are in no source of the truth; the review list exists for these, and `overrides.json` and `hand.json` are where a reviewer adds them.

## What was chosen

| Parameter | Value | Kind | Why |
| --- | --- | --- | --- |
| `confirmDeltaVMinMps` | 1 | fitted | the review list's floor; six wrong training confirmations cut, none right; two would lose Hitomi and NOAA 14 |
| `freshPieceDays` | 90 | policy, with the training evidence | the age under which an object's record is unknown; thirty to a hundred and eighty read the same |
| `cloudMemoryDays` | 365 | policy, with the training evidence | the truth's same-cloud rule; nine wrong cut for one right (Cosmos 2535's second step) |
| `debrisParentNeedsNearerThanCloud` | on | fitted | one wrong cut, none right; stands behind the fresh-piece rule for an old fragment |
| `singlePieceNeedsQuietLaunch` | on | fitted | ten wrong cut for one right (Cosmos 2535); NOAA 14 kept |

## The Confirmed line, before and after

On the validation split the confirmed alerts fall from 43 to 14: 5 on a reported event's step (unchanged: Cosmos 2251, Iridium 33 and Cosmos 192 as detections, the Cosmos 2464 ullage motor and Microsat-R late), 3 on the right object with the step late (DMSP 5B F5's rocket body, CBERS 1 and GOSAT 2's debris), 6 on nothing (the station in 2009 and 2013, a 2007, a 2009 and a 2015 payload with pieces at 16 to 33 m/s, and Cosmos 2535's October 2019 step with two pieces, which no source dates) and none exempt: a precision of 36% on the step and 57% on the object, from 12% and 26%. Of the 36 validation targets the catalogue itself reported (new bodies under the launch within ninety days), 15 were alerted on the parent and 5 confirmed, a median of 4.0 days after the alert (ninetieth percentile 10.5) and 21.9 days after the event (49.1): the deep-space events' pieces are catalogued weeks after.

On the training split the confirmed alerts fall from 41 to 23: 10 on the step (Cosmos 1703's rocket body, NOAA 11, Hitomi, Yaogan 19's rocket body and USA 32 by its notice as detections; Cosmos 2421, Yaogan 1, NOAA 14, Telkom 3's Briz-M and WorldView 2 late), 2 on the right object (DMSP 5D-2 F9 and the ARGOS rocket body), 10 on nothing and 1 exempt: a precision of 43% and 52%, from 27% and 32%. Of the 54 training targets the catalogue reported, 20 were alerted and 9 confirmed (10 before the rules: Cosmos 2535 is the cost). Over every year: 37 confirmed alerts from 84, precision 41% and 54% from 19% and 29%; 14 of the 90 reported targets confirmed. The one target with an agency's statement dated in the truth, USA 32, was confirmed by that statement, not before it; the agencies' publication dates are not otherwise in the truth.

Every confirmation before the rules, with the rule that refused it (the replay with the rules off, the even and odd years marked):

| Split | Year | Object | Launch | Class | Pieces | m/s | Landed as | Event | Kept by the rules | Rule that refused it |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| validation | 2005 | 7219 | 1974-015 | rocket body | 3 | 8.1 | false alarm, the right object | DMSP 5B F5 R/B | yes (3) |  |
| validation | 2005 | 25544 | 1998-067 | payload | 1 | 6.8 | false alarm |  | no | single piece |
| validation | 2005 | 27474 | 2002-037 | rocket body | 20 | 29.4 | false alarm, the right object | COSMOS 2392 ULLAGE MOTOR | no | cloud memory |
| validation | 2005 | 25544 | 1998-067 | payload | 1 | 4.3 | false alarm |  | no | cloud memory |
| training | 2006 | 16263 | 1985-108 | rocket body | 22 | 5.4 | detection | COSMOS 1703 R/B | yes (22) |  |
| training | 2006 | 29111 | 2006-017 | payload | 1 | 16.7 | false alarm |  | no | single piece |
| training | 2006 | 20081 | 1989-039 | rocket body | 38 | 24.0 | false alarm |  | yes (38) |  |
| training | 2006 | 29402 | 2006-039 | payload | 18 | 26.5 | false alarm |  | yes (18) |  |
| training | 2006 | 25544 | 1998-067 | payload | 2 | 8.3 | false alarm |  | yes (2) |  |
| training | 2006 | 25544 | 1998-067 | payload | 1 | 1.8 | exempt or duplicate | A:1998-067:2006-12-11 | no | cloud memory |
| validation | 2007 | 25730 | 1999-025 | payload | 437 | 22.0 | false alarm, the right object | FENGYUN 1C | no | cloud memory |
| validation | 2007 | 30426 | 1998-067 | debris | 2 | 2.0 | exempt or duplicate | A:1998-067:2006-12-11 | no | fresh piece |
| validation | 2007 | 25940 | 1999-057 | payload | 14 | 10.2 | false alarm, the right object | CBERS 1 | yes (14) |  |
| validation | 2007 | 25544 | 1998-067 | payload | 3 | 4.9 | false alarm |  | no | cloud memory |
| validation | 2007 | 25544 | 1998-067 | payload | 2 | 0.8 | false alarm |  | no | velocity |
| validation | 2007 | 31595 | 2007-022 | payload | 2 | 32.5 | false alarm |  | yes (2) |  |
| validation | 2007 | 25544 | 1998-067 | payload | 1 | 0.6 | false alarm |  | no | velocity |
| training | 2008 | 29247 | 2006-026 | payload | 15 | 10.2 | late | COSMOS 2421 | yes (15) |  |
| training | 2008 | 32715 | 2006-026 | debris | 2 | 2.4 | exempt or duplicate | COSMOS 2421 | no | fresh piece |
| training | 2008 | 29247 | 2006-026 | payload | 2 | 60.1 | false alarm |  | no | cloud memory |
| training | 2008 | 32798 | 2006-026 | debris | 20 | 6.2 | exempt or duplicate | COSMOS 2421 | no | fresh piece |
| training | 2008 | 25544 | 1998-067 | payload | 2 | 1.6 | false alarm |  | no | cloud memory |
| training | 2008 | 25544 | 1998-067 | payload | 1 | 0.7 | false alarm |  | no | velocity |
| training | 2008 | 29640 | 2006-053 | payload | 1 | 0.1 | false alarm |  | no | velocity |
| validation | 2009 | 22675 | 1993-036 | payload | 14 | 2.9 | detection | COSMOS 2251 | yes (14) |  |
| validation | 2009 | 24946 | 1997-051 | payload | 3 | 3.5 | detection | IRIDIUM 33 | yes (3) |  |
| validation | 2009 | 33439 | 2008-058 | payload | 2 | 15.9 | false alarm |  | yes (2) |  |
| validation | 2009 | 26957 | 2001-049 | payload | 1 | 22.3 | false alarm |  | no | single piece |
| validation | 2009 | 34799 | 1991-025 | debris | 5 | 36.4 | exempt or duplicate | COSMOS 2139-41 ULLAGE MOTOR | no | fresh piece |
| validation | 2009 | 34801 | 1991-025 | debris | 1 | 20.9 | exempt or duplicate | COSMOS 2139-41 ULLAGE MOTOR | no | fresh piece |
| validation | 2009 | 33331 | 2008-042 | payload | 1 | 5.1 | false alarm |  | no | single piece |
| validation | 2009 | 25544 | 1998-067 | payload | 4 | 2.1 | false alarm |  | no | cloud memory |
| validation | 2009 | 3047 | 1967-116 | payload | 3 | 19.5 | detection | COSMOS 192 | yes (3) |  |
| training | 2010 | 25544 | 1998-067 | payload | 2 | 1.2 | false alarm |  | no | cloud memory |
| training | 2010 | 29092 |  |  | 3 | 9.5 | late | YAOGAN 1 | yes (3) |  |
| training | 2010 | 25544 | 1998-067 | payload | 3 | 1.1 | false alarm |  | no | cloud memory |
| training | 2010 | 25544 | 1998-067 | payload | 1 | 0.8 | false alarm |  | no | velocity |
| training | 2010 | 19531 | 1988-089 | payload | 2 | 4.7 | detection | NOAA 11 | yes (2) |  |
| validation | 2011 | 25544 |  |  | 2 | 1.0 | false alarm |  | no | velocity |
| validation | 2011 | 15614 | 1985-021 | debris | 1 | 21.7 | false alarm |  | no | single piece |
| validation | 2011 | 25544 | 1998-067 | payload | 1 | 1.3 | false alarm |  | no | cloud memory |
| validation | 2011 | 25544 | 1998-067 | payload | 1 | 0.7 | false alarm |  | no | velocity |
| validation | 2011 | 35852 | 1997-051 | debris | 3 | 17.7 | false alarm |  | no | cloud memory |
| training | 2012 | 25544 | 1998-067 | payload | 1 | 39.1 | false alarm |  | no | cloud memory |
| training | 2012 | 38046 | 2012-001 | payload | 2 | 50.5 | false alarm |  | yes (2) |  |
| training | 2012 | 23455 | 1994-089 | payload | 1 | 1.4 | late | NOAA 14 | yes (1) |  |
| training | 2012 | 38746 | 2012-044 | rocket body | 12 | 38.9 | late | TELKOM 3 / EXPRESS MD2 BRIZ-M R/B | yes (12) |  |
| training | 2012 | 38977 | 2012-061 | payload | 1 | 1.6 | false alarm |  | no | single piece |
| training | 2012 | 18822 | 1988-006 | payload | 6 | 14.1 | false alarm, the right object | DMSP 5D-2 F9 (USA 29) | yes (6) |  |
| validation | 2013 | 25544 | 1998-067 | payload | 4 | 2.0 | false alarm |  | yes (4) |  |
| validation | 2013 | 25544 | 1998-067 | payload | 1 | 1.3 | false alarm |  | no | cloud memory |
| validation | 2013 | 25260 | 1998-017 | payload | 1 | 0.2 | false alarm |  | no | velocity |
| validation | 2013 | 25544 | 1998-067 | payload | 1 | 7.0 | false alarm |  | no | cloud memory |
| validation | 2013 | 39208 | 2013-037 | payload | 1 | 0.0 | false alarm |  | no | velocity |
| validation | 2013 | 25544 |  |  | 2 | 1.6 | false alarm |  | no | cloud memory |
| training | 2014 | 25637 | 1999-008 | rocket body | 7 | 76.3 | false alarm, the right object | ARGOS/ORSTED/SUNSAT R/B | yes (7) |  |
| training | 2014 | 25544 | 1998-067 | payload | 1 | 1.2 | false alarm |  | no | cloud memory |
| training | 2014 | 34839 | 2009-021 | payload | 4 | 1.4 | false alarm |  | yes (4) |  |
| training | 2014 | 25544 | 1998-067 | payload | 1 | 25.0 | false alarm |  | no | cloud memory |
| validation | 2015 | 40362 | 2014-088 | payload | 4 | 31.6 | false alarm |  | yes (4) |  |
| validation | 2015 | 25544 | 1998-067 | payload | 1 | 2.0 | false alarm |  | no | single piece |
| validation | 2015 | 33463 | 2008-066 | payload | 1 | 0.3 | false alarm |  | no | velocity |
| training | 2016 | 41337 | 2016-012 | payload | 9 | 1.4 | detection | ASTRO H (HITOMI) | yes (9) |  |
| training | 2016 | 35946 | 2009-055 | payload | 9 | 2.2 | late | WORLDVIEW 2 | yes (9) |  |
| training | 2016 | 38248 | 2012-017 | payload | 1 | 17.6 | false alarm |  | yes (1) |  |
| training | 2016 | 29957 | 1999-025 | debris | 12 | 0.1 | false alarm |  | no | velocity |
| validation | 2017 | 37143 | 2010-041 | rocket body | 9 | 36.3 | detection | COSMOS 2464-2466 ULLAGE MOTOR | yes (9) |  |
| training | 2018 | 25544 | 1998-067 | payload | 1 | 0.3 | false alarm |  | no | velocity |
| training | 2018 | 43080 | 2017-084 | payload | 1 | 6.7 | false alarm |  | no | single piece |
| training | 2018 | 39411 | 2013-065 | rocket body | 3 | 61.7 | detection | YAOGAN 19 R/B | yes (3) |  |
| validation | 2019 | 43675 | 2018-084 | debris | 2 | 15.7 | false alarm, the right object | GOSAT 2 R/B DEBRIS | yes (2) |  |
| validation | 2019 | 43947 | 2019-006 | payload | 42 | 58.8 | late | MICROSAT-R | yes (6) |  |
| validation | 2019 | 25544 | 1998-067 | payload | 4 | 0.6 | false alarm |  | no | velocity |
| validation | 2019 | 18025 | 1987-043 | payload | 1 | 125.2 | false alarm |  | no | single piece |
| validation | 2019 | 37144 | 2010-041 | rocket body | 1 | 2.2 | false alarm, the right object | COSMOS 2464-2466 ULLAGE MOTOR | no | single piece |
| validation | 2019 | 44421 | 2019-039 | payload | 2 | 3.8 | false alarm |  | yes (2) |  |
| validation | 2019 | 25544 | 1998-067 | payload | 2 | 0.5 | false alarm |  | no | velocity |
| validation | 2019 | 37144 | 2010-041 | rocket body | 1 | 66.7 | false alarm |  | no | cloud memory |
| training | 2020 | 39497 | 2013-076 | payload | 1 | 14.7 | exempt or duplicate | 39497:2019-12-23 | no | single piece |
| training | 2020 | 44421 | 2019-039 | payload | 1 | 32.4 | detection | COSMOS 2535 | no | cloud memory |
| training | 2020 | 43657 | 2018-082 | payload | 1 | 3.8 | false alarm |  | yes (1) |  |
| training | 2020 | 44904 | 2019-095 | rocket body | 2 | 0.0 | false alarm |  | no | velocity |
| training | 2026 | 66174 | 2025-241 | payload | 1 | 42.3 | false alarm |  | no | single piece |

Every confirmation after the rules (the committed replay):

| Split | Year | Object | Launch | Class | Alert | Confirmed | Days after the alert | Pieces | m/s | Landed as | Event |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| validation | 2005 | 7219 | 1974-015 | rocket body | 2005-02-17 | 2005-02-17 | 0.0 | 3 | 8.1 | false alarm, the right object | DMSP 5B F5 R/B |
| training | 2006 | 16263 | 1985-108 | rocket body | 2006-05-08 | 2006-05-10 | 2.3 | 22 | 5.4 | detection | COSMOS 1703 R/B |
| training | 2006 | 29111 | 2006-017 | payload | 2006-07-21 | 2006-07-21 | 0.0 | 2 | 34.3 | false alarm |  |
| training | 2006 | 20081 | 1989-039 | rocket body | 2006-08-19 | 2006-08-19 | 0.0 | 38 | 24.0 | false alarm |  |
| training | 2006 | 29402 | 2006-039 | payload | 2006-11-19 | 2006-11-19 | 0.0 | 18 | 26.5 | false alarm |  |
| training | 2006 | 25544 | 1998-067 | payload | 2006-12-01 | 2006-12-01 | 0.0 | 2 | 8.3 | false alarm |  |
| validation | 2007 | 25940 | 1999-057 | payload | 2007-02-20 | 2007-03-11 | 19.3 | 14 | 10.2 | false alarm, the right object | CBERS 1 |
| validation | 2007 | 31595 | 2007-022 | payload | 2007-08-24 | 2007-08-24 | 0.0 | 2 | 32.5 | false alarm |  |
| training | 2008 | 29247 | 2006-026 | payload | 2008-03-20 | 2008-03-20 | 0.0 | 15 | 10.2 | late | COSMOS 2421 |
| training | 2008 | 25544 | 1998-067 | payload | 2008-07-13 | 2008-07-13 | 0.0 | 2 | 1.6 | false alarm |  |
| validation | 2009 | 22675 | 1993-036 | payload | 2009-02-14 | 2009-02-18 | 4.0 | 14 | 2.9 | detection | COSMOS 2251 |
| validation | 2009 | 24946 | 1997-051 | payload | 2009-02-14 | 2009-02-18 | 4.0 | 3 | 3.5 | detection | IRIDIUM 33 |
| validation | 2009 | 33439 | 2008-058 | payload | 2009-02-24 | 2009-02-24 | 0.0 | 2 | 15.9 | false alarm |  |
| validation | 2009 | 25544 | 1998-067 | payload | 2009-07-23 | 2009-07-23 | 0.0 | 4 | 2.1 | false alarm |  |
| validation | 2009 | 3047 | 1967-116 | payload | 2009-09-11 | 2009-09-21 | 10.5 | 3 | 19.5 | detection | COSMOS 192 |
| training | 2010 | 29092 | 2006-015 | payload | 2010-02-05 | 2010-02-05 | 0.0 | 3 | 9.5 | late | YAOGAN 1 |
| training | 2010 | 25544 | 1998-067 | payload | 2010-07-30 | 2010-07-30 | 0.0 | 3 | 1.1 | false alarm |  |
| training | 2010 | 19531 | 1988-089 | payload | 2010-11-26 | 2010-12-03 | 7.3 | 2 | 4.7 | detection | NOAA 11 |
| training | 2012 | 38046 | 2012-001 | payload | 2012-05-18 | 2012-05-18 | 0.0 | 2 | 50.5 | false alarm |  |
| training | 2012 | 23455 | 1994-089 | payload | 2012-07-30 | 2012-07-30 | 0.0 | 0 |  | late | NOAA 14 |
| training | 2012 | 38746 | 2012-044 | rocket body | 2012-10-28 | 2012-10-28 | 0.0 | 0 |  | late | TELKOM 3 / EXPRESS MD2 BRIZ-M R/B |
| training | 2012 | 18822 | 1988-006 | payload | 2012-12-31 | 2012-12-31 | 0.0 | 6 | 14.1 | false alarm, the right object | DMSP 5D-2 F9 (USA 29) |
| validation | 2013 | 25544 | 1998-067 | payload | 2013-04-23 | 2013-04-23 | 0.0 | 4 | 2.0 | false alarm |  |
| training | 2014 | 25637 | 1999-008 | rocket body | 2014-05-16 | 2014-05-16 | 0.0 | 7 | 76.3 | false alarm, the right object | ARGOS/ORSTED/SUNSAT R/B |
| training | 2014 | 34839 | 2009-021 | payload | 2014-07-11 | 2014-07-12 | 0.8 | 4 | 1.4 | false alarm |  |
| validation | 2015 | 40362 | 2014-088 | payload | 2015-04-27 | 2015-04-27 | 0.0 | 4 | 31.6 | false alarm |  |
| training | 2016 | 41337 | 2016-012 | payload | 2016-03-31 | 2016-04-04 | 4.0 | 9 | 1.4 | detection | ASTRO H (HITOMI) |
| training | 2016 | 35946 | 2009-055 | payload | 2016-08-22 | 2016-08-22 | 0.0 | 9 | 2.2 | late | WORLDVIEW 2 |
| training | 2016 | 38248 | 2012-017 | payload | 2016-10-11 | 2016-10-11 | 0.0 | 1 | 17.6 | false alarm |  |
| validation | 2017 | 37143 | 2010-041 | rocket body | 2017-10-21 | 2017-10-22 | 1.0 | 9 | 36.3 | detection | COSMOS 2464-2466 ULLAGE MOTOR |
| training | 2018 | 39411 | 2013-065 | rocket body | 2018-08-26 | 2018-09-25 | 30.0 | 3 | 61.7 | detection | YAOGAN 19 R/B |
| validation | 2019 | 43675 | 2018-084 | debris | 2019-03-01 | 2019-03-01 | 0.0 | 2 | 15.7 | false alarm, the right object | GOSAT 2 R/B DEBRIS |
| validation | 2019 | 43947 | 2019-006 | payload | 2019-04-13 | 2019-04-21 | 8.7 | 6 | 58.8 | late | MICROSAT-R |
| validation | 2019 | 44421 | 2019-039 | payload | 2019-10-14 | 2019-10-18 | 4.3 | 2 | 3.8 | false alarm |  |
| training | 2020 | 39497 | 2013-076 | payload | 2020-01-13 | 2020-01-13 | 0.0 | 5 | 14.7 | exempt | 39497:2019-12-23 |
| training | 2020 | 43657 | 2018-082 | payload | 2020-01-23 | 2020-01-23 | 0.0 | 0 |  | false alarm |  |
| training | 2026 | 19460 | 1988-078 | payload | 2026-09-15 | 2026-09-17 | 1.5 | 0 | notice | detection | USA 32 |

## Two faults of the scorecard

Both were found by the dissection and fixed before the sweep; both move the first three phases' numbers, and the fourth decision record carries them.

- The catalogue's high-water mark, by which a body is new, followed a body's earliest set epoch. A yearly bundle lists old debris catalogued in August with set epochs from January, so the mark at an event sat above the breakup's real pieces for months and the catalogue's time landed late: Cosmos 2392's ullage motor's pieces read as ninety-seven days after the event instead of thirty-two, Cosmos 2251's and Iridium 33's as 3 March 2009 instead of 17 February, Cosmos 1408's as 9 December 2021 instead of 17 November. A fragment's first set was dated by its epoch too, which a newly catalogued piece back-fills from before it appeared. Both now follow the catalogue's publication order by the replay's clock, as the detector reads it. The headline line reads the same on the validation split (11 detected, 2 late, 19 missed of 32) and one fewer on the training split (18, 4, 21 of 43, from 19, 3, 21: Cosmos 1408's alert came after its pieces), with 84 fewer validation false alarms (alerts on fragments, now recognised as such). The leads over the catalogue the earlier phases reported were overstated by the fault; the lead now reads a median of 479 hours (tenth percentile 94) on the validation split.
- A promoted manoeuvre (a step the record explained, confirmed by the pieces) landed as an alert of its own and was never marked as confirmed, so the third phase's Confirmed line undercounted the confirmations by more than half. It is marked as it lands.

## What this phase gives, and what it costs

The detection rules are untouched, so the headline line is the third phase's under the corrected scorecard: on the validation split 11 detected, 2 late and 19 missed of 32 (34%), 15,546 false alarms; on the training split 18, 4 and 21 of 43 (42%), 21,950. The per-event dissection (`events.md`) gives the causes over the headline line's 75 targets of every year: 29 raised; 6 late (5 reached persistence only after the catalogue's first fragment, 1 had no post set before it); 24 whose parent did not measurably move; 4 whose candidate lapsed with no further set; 3 the record gate; 3 a step the later sets took back; 3 that faded under the persistence gates; 2 ramping fits; 1 with no set between the event and the catalogue; and 13 undetectable. On every line (140 targets and 35 undetectable) the parent did not move for 68.

The whole Archive replays in 1,315 seconds of detector time, about twenty-three minutes with the states and the year files written, against twenty-two for the third phase: the confirmation rules cost nothing measurable, the matcher's publication clock a little.
