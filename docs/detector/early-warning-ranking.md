# The early warning ranked: is a short watch list useful?

The early warning, a suspected verdict on the parent's own orbit jump, flags about a third of the reported breakups before their first fragment is catalogued, weeks ahead and to within the hour when right, but as a yes-or-no list it is noise: on the held-out odd years 2007 to 2025 it raises about 245 false alarms a year, more than ninety-nine early warnings in a hundred. The owner endorsed testing whether ranking the early warnings makes them a useful short watch list: "of the top 5 or 10 each month, how many are real, and how many of the real ones make the list." This note records the method, the rules written before the held-out years were read, the ranker chosen on the training years and frozen, both splits' numbers, examples, and the answer.

## Written before any ranker was fitted (2026-10-11T17:33:21Z)

**The data.** One row per early warning the scorecard counts: a suspected verdict that the matcher landed as a detection, a late alert or a false alarm, on every line (a duplicate and an alert inside an exempt window are neither, as on the scorecard). The label is one for a detection or a late alert (on a reported event's step) and zero for a false alarm. The scoped and confirmed outcomes are marked on each row. The features are read from the verdict's evidence alone, which is what the detector knew when it raised the alert: nothing after the raising enters the ranking (the damage ratio of the second to fourth week, the persistence tiers and the pieces come later). The ranking changes nothing the detector decides and nothing in `src/`; it is computed afterwards from what each early warning records. `npm run kpi:rank` (`scripts/kpi/rank.ts`) builds the rows from the year files under `kpi/years/`.

**The rankers**, both fitted on the even years alone:

- A hand-built score: the mean, over a few features, of the alert's percentile among the training early warnings on each (turned over where a low value is the breakup's side). The features are chosen by their separation on the training rows (the area under the curve, the chance a real alert reads higher than a false one): the farthest from a half first, each at least 0.1 from it and correlated under 0.7 (Spearman) with every feature already taken, at most six.
- A small logistic regression with an L2 penalty on standardised features, every feature of the list below, fitted by Newton's method, tried at penalties 1, 3, 10, 30 and 100.

**The choice.** The ranker frozen is the candidate with the higher cross-validated training criterion: the mean of the pooled precision of the monthly top five and the monthly top ten, each training year's scores coming from a ranker fitted on the other training years (the hand-built one's features chosen afresh in each fold). A tie goes to the hand-built score. The frozen ranker is then refitted on every training year and its coefficients written into `FROZEN_RANKER` with the time it was frozen; the held-out years are read once with it.

**The measurement**, on the held-out years and on the training years for comparison: the precision of the monthly top k (k = 1, 3, 5, 10), ranked at each month's end among the early warnings raised in it, and of the yearly top k (k = 10, 20, 50), each pooled over the months or years with its Wilson 95% interval; the headline targets (reported breakups of confidence A and B whose parent had public sets) whose detection made the list, and those the list named before the first fragment's set or any notice, with their lead and timing error; the precision against the list's size; the same against the base rate and an unranked list (the first k raised in each month); and the live list a daily product would keep, an alert listed when raised if its score reaches a threshold set from the scores of the twelve months before so that k a month would have passed it.

**The bar.** The ranked list is useful if, on the held-out years, a monthly list of five or fewer reaches a precision of 20% or more (the point estimate). Only then is the ranking added to the scorecard and the live test.

The bar is stated with what is already known of its reach. The held-out years hold 2,463 early warnings counted as real or false over ten years, 19 of them real (the results page's life of an alert); that is 1.6 real early warnings a year. A monthly list of one already has 120 entries over the ten years, so even a ranking that put every real early warning first in its month would be right at most 19 times in 120, 16%, and a list of five at most 3%. On the training years (28 real over eleven years, 130 months, the last year to October) the same ceilings are 21% and 4%. No ranking of these alerts can reach the bar with a list of a fixed size a month; it is kept because it is the owner's, and the note reports beside it how much of the ceiling the ranker reaches and how many of the real ones its lists hold, so the owner can judge a list by those.

## The training years, and the ranker frozen (2026-10-11T17:34:50Z)

`npm run kpi:rank -- --fit` reads the even years' files alone. They hold 2,929 early warnings over 130 months (2006 to 2026, the last year to October), 28 of them on a reported event's step (0.96%): 24 detections and 4 late alerts. An alert the replay of a year raised in the first days after it (its last run reaches past the year's end) is its year's, as the scorecard counts it, and is listed with its December.

Each feature's separation on the training rows, the chance a real early warning reads higher than a false one (AUC; 0.5 is no separation), sorted by its distance from a half, with the frozen ranker's weight on it:

| Feature | What it reads | Training AUC | Median, real | Median, false | Weight (per standard deviation) | Training mean | Training deviation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `rho` | the later sets' median over the first jump (clamped to 0 to 3) | 0.234 | 0.995 | 1.393 | -0.7211 | 1.609 | 0.7409 |
| `logBstarFold` | the drag term's change across the step, folded above one (log10; 0 where not read) | 0.750 | 0.320 | 0.000 | 0.2945 | 0.2496 | 0.5556 |
| `logStepOverNoise` | the step over the object's own scatter (log10) | 0.657 | 2.083 | 1.565 | 0.6221 | 1.933 | 0.9638 |
| `logStepMetres` | the step in semi-major axis, metres (log10) | 0.365 | 2.809 | 3.486 | -0.7851 | 3.52 | 1.244 |
| `bstarRead` | whether the drag term's change was read (1) | 0.631 | 1.000 | 1.000 | 0.4934 | 0.5968 | 0.4906 |
| `rocketBody` | a rocket body (1) | 0.626 | 0.000 | 0.000 | 0.5873 | 0.2513 | 0.4338 |
| `logZ` | the step's size in its own sigma at the raising (log10) | 0.620 | 1.545 | 1.265 | -0.2227 | 1.61 | 0.7934 |
| `logGapHours` | the gap from the last pre set to the first post set, hours (log10) | 0.620 | 1.532 | 1.316 | 0.25 | 1.322 | 0.8354 |
| `signatures` | how many breakup signatures fired | 0.616 | 1.000 | 1.000 | 0.6466 | 0.6576 | 0.6055 |
| `logDeltaV` | the along-track impulse, m/s (log10 of it plus 0.001) | 0.389 | -0.810 | -0.056 | -0.2482 | -0.215 | 1.242 |
| `logInclinationStep` | the inclination step, degrees (log10 of it plus 1e-4) | 0.611 | -2.282 | -2.640 | 0.461 | -2.493 | 0.9878 |
| `scopeIn` | the parent in the scoped line's scope at the step (1) | 0.604 | 1.000 | 1.000 | 0.1527 | 0.6156 | 0.4865 |
| `logDeltaVNormal` | the cross-track impulse, m/s (log10 of it plus 0.001) | 0.591 | -3.000 | -3.000 | 0.4829 | -2.034 | 1.719 |
| `logEvidence` | the evidence for a step against a drift (log10 of one plus it) | 0.584 | 2.887 | 2.470 | 0.2171 | 3.073 | 1.666 |
| `debris` | debris (1) | 0.420 | 0.000 | 0.000 | -0.4282 | 0.1946 | 0.396 |
| `heo` | highly elliptical orbit (1) | 0.573 | 0.000 | 0.000 | 0.07673 | 0.1765 | 0.3813 |
| `logRecordDays` | the days since the object's first set (log10, at least one) | 0.566 | 3.422 | 3.239 | 0.235 | 2.679 | 1.318 |
| `geo` | geosynchronous orbit (1) | 0.437 | 0.000 | 0.000 | 0.1498 | 0.2322 | 0.4223 |
| `perigeeThousandKm` | the perigee height, thousands of kilometres | 0.558 | 0.702 | 0.625 | -0.204 | 10.01 | 15.4 |
| `logKick` | the chi-squared of the eccentricity change one tangential impulse cannot explain (log10 of one plus it) | 0.555 | 0.714 | 0.000 | -0.03302 | 0.9827 | 1.488 |
| `logAgeYears` | the years since launch (log10, at least a day) | 0.550 | 0.982 | 1.098 | 0.1337 | 0.4125 | 1.412 |
| `logBandScale` | the band's live scale at the first post set (log10) | 0.452 | 0.000 | 0.000 | -0.3161 | 0.01453 | 0.08028 |
| `logZMean` | the fitted step at the post sets' centroid in sigma (log10) | 0.541 | 1.760 | 1.565 | -0.281 | 1.858 | 0.8052 |
| `payload` | a payload (1) | 0.461 | 0.000 | 1.000 | -0.03541 | 0.5418 | 0.4983 |
| `logRunStress` | the candidates the catalogue opened in the last day (log10 of one plus them) | 0.464 | 1.301 | 1.477 | 0.04902 | 1.462 | 0.5942 |
| `quiet` | no persistent step in the two years before (1) | 0.466 | 1.000 | 1.000 | -0.1219 | 0.7108 | 0.4535 |
| `logCadenceRatio` | the sets a day after the step over before, at the raising (log10) | 0.467 | 0.319 | 0.313 | -0.1534 | 0.573 | 0.8042 |
| `explanations` | how many manoeuvre explanations applied | 0.532 | 0.000 | 0.000 | 0.1279 | 0.3291 | 0.4707 |
| `logDeltaVRadial` | the least radial impulse, m/s (log10 of it plus 0.001) | 0.527 | -1.730 | -3.000 | -0.4837 | -1.719 | 1.61 |
| `logSteps` | the persistent steps in the two years before (log10 of one plus them) | 0.514 | 0.000 | 0.000 | -0.4474 | 0.2222 | 0.4155 |
| `logCadence` | the sets a day before the step (log10 of it plus 0.01) | 0.514 | 0.083 | 0.071 | 0.4621 | -0.187 | 0.7641 |
| `leo` | low orbit (1) | 0.513 | 1.000 | 1.000 | 0.1036 | 0.509 | 0.5 |
| `dead` | a payload dead at the step by its dated status (1) | 0.508 | 0.000 | 0.000 | -0.1053 | 0.2704 | 0.4442 |
| `logBstar` | the drag term before the step (log10 of its size plus 1e-6) | 0.505 | -4.139 | -4.188 | -0.001082 | -4.529 | 1.304 |
| `working` | a payload working at the step by its dated status (1) | 0.500 | 0.000 | 0.000 | constant on the training rows: left out | – | – |
| `logSiblings` | the like steps of launch-mates and shell-mates in the fortnight before (log10 of one plus them) | 0.500 | 0.000 | 0.000 | 0.03071 | 0.04931 | 0.132 |

No single feature separates much. The best, the later sets' ratio to the first jump (a breakup's step stays at its size where a manoeuvre's grows as the catalogue's fit converges on it) and the drag term's change, reach 0.77 and 0.75 (the first read turned over); the step over the object's own scatter 0.66, and the step in metres, its size, runs the other way (0.37): a real step is small for its object, a manoeuvre large. A rocket body, a long gap before the first post set and a breakup signature each lean towards the real. The dated status, the quiet record, the age and the siblings barely separate at all on what the detector raises, since the manoeuvre explanations have already removed the steps they would.

The candidates, each training year scored by a ranker fitted on the other ten (the hand-built one's features chosen afresh in each fold). The criterion is the mean of the pooled precision of the monthly top five and top ten; each cell gives the pooled precision with its Wilson 95% interval and the real of the entries.

| Ranker | Criterion, cross-validated | Criterion, in sample | Top 1 a month | Top 3 | Top 5 | Top 10 |
| --- | --- | --- | --- | --- | --- | --- |
| Hand-built: the mean percentile of the later sets' ratio (turned over), the drag term's change, the step over the scatter, the step in metres (turned over), a rocket body, the gap | 2.36% | 3.06% | 2.3% (0.8% to 6.6%), 3 of 130 | 3.6% (2.2% to 5.9%), 14 of 390 | 2.9% (1.9% to 4.5%), 19 of 650 | 1.8% (1.2% to 2.7%), 23 of 1279 |
| Logistic, penalty 1 | 2.71% | 3.25% | 6.2% (3.2% to 11.7%), 8 of 130 | 4.4% (2.7% to 6.9%), 17 of 390 | 3.4% (2.2% to 5.1%), 22 of 650 | 2.0% (1.4% to 3.0%), 26 of 1279 |
| **Logistic, penalty 3 (chosen)** | **2.79%** | 3.17% | 6.9% (3.7% to 12.6%), 9 of 130 | 4.6% (2.9% to 7.2%), 18 of 390 | 3.5% (2.4% to 5.3%), 23 of 650 | 2.0% (1.4% to 3.0%), 26 of 1279 |
| Logistic, penalty 10 | 2.63% | 3.09% | 6.9% (3.7% to 12.6%), 9 of 130 | 4.9% (3.1% to 7.5%), 19 of 390 | 3.2% (2.1% to 4.9%), 21 of 650 | 2.0% (1.4% to 3.0%), 26 of 1279 |
| Logistic, penalty 30 | 2.48% | 3.02% | 6.9% (3.7% to 12.6%), 9 of 130 | 4.1% (2.5% to 6.6%), 16 of 390 | 2.9% (1.9% to 4.5%), 19 of 650 | 2.0% (1.4% to 3.0%), 26 of 1279 |
| Logistic, penalty 100 | 2.48% | 2.67% | 6.9% (3.7% to 12.6%), 9 of 130 | 3.3% (2.0% to 5.6%), 13 of 390 | 2.9% (1.9% to 4.5%), 19 of 650 | 2.0% (1.4% to 3.0%), 26 of 1279 |

By the rule the logistic regression at the penalty 3 is frozen, refitted on every training year: the intercept −6.188, and the weights of the table above on each feature standardised by the training mean and deviation beside it (a missing value reads as the mean; the working status, constant on the training rows, is left out). Its score is the logistic of the sum, a number between 0 and 1. It is `FROZEN_RANKER` in `scripts/kpi/rank.ts`, frozen at 2026-10-11T17:34:50Z (`FROZEN_AT`), before any held-out year's early warnings were scored.

Read on the training years, cross-validated, the chosen ranker's monthly top one is right 6.9% of the time against the 1.0% base rate, seven times it, and its top five 3.5%. The ceilings a perfect ranking would reach there are 21% and 4%: the training years already say that no ranked monthly list of these alerts comes near the bar.

## The held-out years, read once

`npm run kpi:rank` scores every year with the frozen ranker and writes the rows to `kpi/work/early-warnings.json.gz`. The odd years 2007 to 2025 hold 2,463 early warnings over 120 months, 19 of them real: a base rate of 0.77% (0.49% to 1.20%), the rate a list in no particular order is right at. Of the 28 headline targets, the early warning flags 10 before the first fragment and 2 after it, as the scorecard says. Each precision is pooled over the months (or years) with its Wilson 95% interval. A monthly or yearly list names its alerts when it is drawn up, at the period's end, so an alert it holds flagged its event only if the period ended before the first fragment's set or any notice; the live list names each alert when it is raised.

| List | Entries a month | Precision (95% interval), real of entries | Real early warnings in the list, of 19 | Headline targets in the list / named before the first fragment, of 28 | Lead over the first fragment from the naming, days, median | Timing error, minutes, median |
| --- | --- | --- | --- | --- | --- | --- |
| Every early warning (no list) | 20.5 | 0.77% (0.49% to 1.2%), 19 of 2463 | 19 | 10 / 10 | 10.3 | 34.6 |
| Ranked, top 1 a month | 1.0 | 3.3% (1.3% to 8.3%), 4 of 120 | 4 | 1 / 0 | – | – |
| Ranked, top 3 a month | 3.0 | 1.9% (0.9% to 4.0%), 7 of 360 | 7 | 4 / 2 | 20.7 | 6.1 |
| Ranked, top 5 a month | 5.0 | 1.8% (1.0% to 3.3%), 11 of 600 | 11 | 5 / 2 | 20.7 | 6.1 |
| Ranked, top 10 a month | 9.8 | 1.3% (0.8% to 2.1%), 15 of 1179 | 15 | 9 / 5 | 20.7 | 6.1 |
| Unranked, the first 1 raised each month | 1.0 | 0.0% (0.0% to 3.1%), 0 of 120 | 0 | 0 / 0 | – | – |
| Unranked, the first 5 raised each month | 5.0 | 0.3% (0.1% to 1.2%), 2 of 600 | 2 | 0 / 0 | – | – |
| Ranked, top 10 a year | 0.8 | 2.0% (0.6% to 7.0%), 2 of 100 | 2 | 0 / 0 | – | – |
| Ranked, top 20 a year | 1.7 | 2.5% (1.1% to 5.7%), 5 of 200 | 5 | 3 / 0 | – | – |
| Ranked, top 50 a year | 4.2 | 2.2% (1.2% to 3.9%), 11 of 500 | 11 | 5 / 0 | – | – |
| Live: a running threshold for 1 a month | 0.9 | 2.7% (0.9% to 7.7%), 3 of 110 | 3 | 1 / 1 | 10.3 | 30.5 |
| Live: a running threshold for 3 a month | 3.0 | 2.2% (1.1% to 4.3%), 8 of 358 | 8 | 4 / 4 | 10.3 | 30.5 |
| Live: a running threshold for 5 a month | 4.9 | 2.1% (1.2% to 3.6%), 12 of 584 | 12 | 6 / 6 | 10.3 | 30.5 |
| Live: a running threshold for 10 a month | 9.0 | 1.5% (0.9% to 2.4%), 16 of 1082 | 16 | 9 / 9 | 10.3 | 30.5 |

The precision against the monthly list's size, held out:

| Top k a month | 1 | 2 | 3 | 4 | 5 | 7 | 10 | 15 | 20 | 30 | all |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Entries | 120 | 240 | 360 | 480 | 600 | 836 | 1179 | 1655 | 1996 | 2331 | 2463 |
| Real | 4 | 5 | 7 | 10 | 11 | 13 | 15 | 17 | 18 | 19 | 19 |
| Precision | 3.3% | 2.1% | 1.9% | 2.1% | 1.8% | 1.6% | 1.3% | 1.0% | 0.9% | 0.8% | 0.77% |
| Headline targets named before the first fragment, of 28 | 0 | 1 | 2 | 2 | 2 | 4 | 5 | 6 | 6 | 6 | 10 |

What it says:

- **The ranking concentrates the real alerts, a little.** The monthly top one is right 3.3% of the time, four times the base rate, and its interval (1.3% to 8.3%) clears the base rate; the top five, 1.8%, two and a half times it. The lists ordered by nothing (the first raised each month) are no better than the base rate. Half the real early warnings (11 of 19) are in their month's top five, a quarter of the list.
- **The bar is not reached, nor approached.** The best monthly list of five or fewer is right 3.3% of the time against the bar of 20%, a fifth of the 16% even a perfect ranking could reach with one a month. The yearly lists are no better (2% to 2.5%).
- **A list drawn up at the month's end loses the early warning's point.** The early warning is worth having because it comes before the first fragment, a median of ten days ahead on the held-out headline targets; a month-end list names an alert about two weeks after it was raised, by which time the first fragment is often catalogued. The monthly top five holds five of the 28 headline targets and names two of them in time. The live list, which names an alert when it is raised if it passes a threshold the year before set, keeps the timing: at five a month it names 6 of the 10 headline targets the early warning flags, every one before its first fragment, a median of ten days ahead and to half an hour, at 2.1% precision (1.2% to 3.6%), against 0.77% for the whole list of twenty a month.
- **The training years overstated it.** Read on the training years by the frozen ranker, which was fitted on them, the monthly top one is right 11.5% of the time (15 of 130) and the top five 4.2%; cross-validated, 6.9% and 3.5%; held out, 3.3% and 1.8%. Seven of the fifteen training top-one hits are deep-space ullage motors and a Briz-M stage, steps of 0.4 to 36 kilometres in highly elliptical orbit, most with the drag term moved ten- to a thousand-fold: a family that makes eight of the training years' 28 real early warnings and one of the held-out years' 19. Fifteen of the held-out 19 are payloads in low orbit, eight of them dead (NOAA 12 and 17, Cosmos 192, 1408 and 2251, Meteor, CBERS 1, BLITS), whose steps look like the dead payloads' and old stages' false alarms.

The training years, read with the frozen ranker (in sample, so better than the held-out reading can be), for comparison:

| List | Precision (95% interval), real of entries | Real early warnings in the list, of 28 | Headline targets in the list / named before the first fragment, of 43 |
| --- | --- | --- | --- |
| Every early warning (no list) | 0.96% (0.66% to 1.4%), 28 of 2929 | 28 | 18 / 18 |
| Ranked, top 1 a month | 11.5% (7.1% to 18.2%), 15 of 130 | 15 | 11 / 7 |
| Ranked, top 3 a month | 5.6% (3.8% to 8.4%), 22 of 390 | 22 | 13 / 7 |
| Ranked, top 5 a month | 4.2% (2.9% to 6.0%), 27 of 650 | 27 | 17 / 11 |
| Ranked, top 10 a month | 2.2% (1.5% to 3.1%), 28 of 1279 | 28 | 18 / 12 |
| Ranked, top 10 a year | 12.7% (7.7% to 20.2%), 14 of 110 | 14 | 9 / 2 |
| Ranked, top 20 a year | 9.5% (6.3% to 14.2%), 21 of 220 | 21 | 12 / 3 |
| Ranked, top 50 a year | 4.9% (3.4% to 7.0%), 27 of 550 | 27 | 17 / 4 |
| Live: a running threshold for 1 a month | 12.1% (7.7% to 18.6%), 17 of 140 | 17 | 11 / 11 |
| Live: a running threshold for 5 a month | 3.6% (2.5% to 5.2%), 27 of 752 | 27 | 17 / 17 |

## Examples, held out

The real early warnings the ranker put first in their month: Cosmos 192 (a payload of 1967, dead, a step of 1.3 kilometres at 151 sigma with the drag term moved six-fold, first of 19 in September 2009; confirmed by its fragments; the live list named it ten days before the first fragment, the month-end list after it); the Meteor of 1970 (first of 13 in October 2023, not a headline event); and two late alerts, NOAA 12 (first of 23 in October 2011, its drag term moved 43-fold) and Microsat-R (first of 32 in April 2019, the anti-satellite test's target, a 435-kilometre step).

The real ones it ranked low: Intelsat 29e (22nd of 32; a geosynchronous payload, where no drag term is read), Kosmos-2528 (16th of 24; a young payload whose record held a step), the LES 8 and 9 stage near the geostationary ring (14th of 30), Orbcomm FM5 (12th of 40), CBERS 1 (10th of 20; a 14-metre step at 11 sigma) and Iridium 33 (8th of 26; a collision, a 5.8-kilometre step with the drag term moved two-fold).

The false alarms it ranked highest are the steps the scope study found physically like the breakups': a rocket body of 1988 in highly elliptical orbit whose drag term moved nearly seven-thousand-fold (the held-out years' highest score, 0.49), a rocket body of 1981 in low orbit with a 19-metre step and the drag term moved 77-fold, a dead payload of 1979 with a 446-metre step and the drag term moved 640-fold, an old payload in medium orbit with a 1,200-kilometre step, and dead payloads of 2012 and 2014 whose small steps came with a hundred- to two-hundred-and-fifty-fold change in the drag term. Each was first in its month.

## Plainly

A ranked watch list of the early warnings is not useful by the bar written before the held-out years were read: no monthly list of five or fewer reaches 20% precision, or comes near it. The frozen ranker's best, the monthly top one, is right 3.3% of the time (1.3% to 8.3%) on the held-out years, four times the 0.77% base rate, and its top five 1.8% (1.0% to 3.3%), while holding half the real early warnings in a quarter of the list. Drawn up at the month's end, the list names only two of the 28 reported breakups before their first fragment, since a month's wait spends the early warning's lead; kept live, with a threshold the year before sets, five a month name six of them (of the ten the early warning flags at all), each a median of ten days before the first fragment and to half an hour, at 2.1% precision.

The bar was out of any ranker's reach: with 1.6 real early warnings a year, a list of one a month can be right at most one time in six. What the ranking can do is shorten the list about four-fold while keeping more than half of what the early warning catches, at a precision still under one in forty. That is a measurement for the owner to weigh, not a list the scorecard or the live test now carries: by the rule, the ranking is not added to `kpi/latest.json`, the results page's tables, the README or the live test's alerts.
