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

The bar is stated with what is already known of its reach. The held-out years hold 2,463 early warnings counted as real or false over ten years, 19 of them real (the results page's life of an alert); that is 1.6 real early warnings a year. A monthly list of one already has 120 entries over the ten years, so even a ranking that put every real early warning first in its month would be right at most 19 times in 120, 16%, and a list of five at most 3%. On the training years (28 real over eleven years, 132 months) the same ceilings are 21% and 4%. No ranking of these alerts can reach the bar with a list of a fixed size a month; it is kept because it is the owner's, and the note reports beside it how much of the ceiling the ranker reaches and how many of the real ones its lists hold, so the owner can judge a list by those.

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
