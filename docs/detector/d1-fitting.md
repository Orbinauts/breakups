# Fitting the first phase of the detector

The detector's thresholds are of three kinds, and `src/params.ts` tags
each: physical constants that are not tuned, policy choices the owner
makes about the product, and fitted values read off the training split.
This note records how the fitted ones were chosen for `step-v1`, the
parent-step channel: what was swept, over which years, what was seen and
what was chosen. The validation split (the odd years) was not looked at
while choosing; its numbers are in `kpi/latest.md` and the README.

## The discipline

- The training split is the even years, 2006 to 2026; the validation split
  the odd years, 2005 to 2025. A chronological split (to 2017, from 2018)
  is reported beside them in `kpi/latest.md`.
- Every candidate the detector opens is logged with the signals the
  decision read and the step's trajectory at the second and third post
  set (`src/log.ts`), so the persistence gates can be re-thresholded
  offline with `npm run kpi:sweep` over the training years' files without
  replaying them. The sweep is an approximation of the scorecard (its
  matching is by the parent and the bracket, and a candidate raised at the
  second or third set is timed by that set's epoch); the chosen values were
  then confirmed by replaying.
- The gates that act before the log (the candidate threshold `zCand`, the
  drag term `kappa`, the prior) were swept by replaying a few training
  years, since the log cannot see what was never a candidate.
- In this phase every persistent step is raised, so the false alarms are
  dominated by working payloads' manoeuvres, which the next phase classes
  by the object's own step history. The sweeps therefore read two false
  alarm counts: every class, and the non-payload classes (rocket bodies,
  debris, unknown), the latter being what this phase's noise model is
  responsible for.

## What the training split showed before any sweep

Replaying the even years with the initial values exposed several things
that are not thresholds and were fixed in the code before the sweeps,
each on the evidence of a reported event:

- The catalogue's fit absorbs a breakup into the drag term: DMSP F8's first
  post-event set carried B* seventy times its window's. The prediction's
  drag term and the common-mode correction now use the window's median B*,
  never the new set's, and the ratio is logged (`bstarRatio`).
- The catalogue's fit converges on the new orbit over a few sets: COBE
  R/B's first post set carried 24 m of a 296 m step, Cosmos 2424's ullage
  motor ramped to 10 km over five days. A drift is therefore told from a
  step by whether drag could have produced it: the drift model's slope is
  held by a prior of what noise and drag do in a day, the step model's
  slope by that plus the first jump's size a day, and the persistence
  ratio's band is read off the training split below rather than fixed at
  the earlier attempt's 0.75 to 1.5.
- Sparse regimes: the Centaur stage of GOES-17 had its next set seventeen
  days after the step, Intelsat 33e ten days. A lapsed candidate drops its
  unconfirmed set so the step is measured again when a set comes, the
  lapse follows the regime's cadence, and two post sets six hours apart
  suffice above low orbit, where drag cannot mimic a step.
- A geosynchronous set's node is undefined and swung every set through
  the foreign-set quarantine; the node is not tested under a degree of
  inclination.
- A burst of sets in one run (Hitomi: thirty-five sets in four days,
  delivered together by a bundle year's clock) could evict a candidate's
  opener from the ring before it was judged and leave the candidate open
  for ever; such a candidate now closes.

## The sweeps

All over the even years' logs, 2006 to 2026, with the code above. The
counts are the sweep's: targets hit on the headline line (breakups of
confidence A and B, 43 targets) and on every line (79), and the
non-payload false alarms (rocket bodies, debris, unknown). The payload
false alarms, about 96,000 over the eleven years, move with the same
gates in the same proportion and are the next phase's.

The persistence size `zPersist`, at `rhoMin` 0.5, `rhoMax` open,
`evidenceMin` 10, span 18 h:

| zPersist | headline hits | hits | non-payload false alarms |
| --- | --- | --- | --- |
| 6 | 15 of 43 | 22 of 79 | 4,083 |
| 8 | 15 of 43 | 22 of 79 | 3,327 |
| 10 | 15 of 43 | 22 of 79 | 2,662 |
| 12 | 14 of 43 | 20 of 79 | 1,977 |
| 15 | 14 of 43 | 19 of 79 | 1,559 |
| 20 | 13 of 43 | 16 of 79 | 1,227 |

The hits are flat to 10 and fall from 12: 10 is the knee.

The ratio's lower bound `rhoMin` (0.5, 0.6, 0.75): 0.5 hits 15, the others
14, the lost event being Yaogan 1 (2010), whose first post set overshot
the step by half (the later sets kept 0.53 of it); the false alarms differ
by under 3%. The revert bound stays at 0.5, so the lower bound coincides
with it.

The ratio's upper bound `rhoMax` (1.5, 2, 3, open) at `zPersist` 10: 1.5
hits 14 and leaves 1,509 alarms; 2 hits 15 and leaves 1,937; 3 hits 15 and
2,323; open hits 15 and 2,662. The sweep's lists of hits at 2 and open
are the same twenty-two events, but the replay with the bound at 2 loses
COBE R/B (2006): its first post set carried 24 m of a 296 m step, the
ratio at the close is 12.9, and the sweep had credited it through its
close row's instant. The bound is left open, the quarter of the alarms
being the price of the convergence ramps; the drift test guards the top.

The evidence against a drift `evidenceMin` (0, 5, 10, 20): hits unchanged
at every value; the alarms fall 7% from 0 to 10 and a further 4% to 20. 10
is taken; the gate is a second line behind the drag term in the
prediction's sigma, which already keeps a drag-sized drift from opening a
candidate.

The span two post sets must cover (6, 12, 18 h, in low orbit): hits
unchanged; the alarms fall 18% from 6 to 18 h. 18 h is kept, the design's
value; above low orbit the six hours stand, since drag cannot mimic a step
there and the sets are sparse (the Centaur stage of GOES-17 is raised on
two sets 12.7 h apart).

The drag term `kappa`, re-scaled offline from the logged prediction sigma
(0, 30, 50, 100, 200, 400): the headline hits are 14 from 0 to 200 and 11
at 400; the hits on every line are 21 to 100 and 19 at 200; the
non-payload alarms are 2,725 at 0, 2,468 at 100, 2,023 at 200. 100 is the
last value that loses nothing, in every regime (one value for all four,
since the log showed no regime where a different one would have changed a
hit).

The candidate threshold `zCand` was not swept by replaying: the smallest
first-set size among the candidates that hit a training event is 6.3
sigma, so 6 stands, and lowering it would admit more candidates without a
known event to gain.

The CUSUM's threshold `hCusum` stays at 12 with a drift allowance of 0.5.
About a tenth of the candidates a year open from the CUSUM rather than
from a single set's jump (a slow station-keeping drift, or a decay the
model followed late); the log carries each candidate's origin, and the
section below says what the final replay found the CUSUM candidates to
have hit. It is kept as the design's side channel and not lowered.

The prior scatter and its knee in B* were set by eye from the measured
scatter of objects on the training years (a low-orbit intact body sits at
a few metres, a high-drag fragment at tens to hundreds, a deep-space stage
at tens to hundreds of metres) and not swept: they act only on objects
with fewer than eight residuals, and the one such event on the training
split (Yaogan 1 is not one; the day-old stage of CZ-6A is in 2022's
undetectable rows) gave nothing to fit on.

## What was chosen

| Parameter | Value | Why |
| --- | --- | --- |
| `zCand` | 6 | the smallest first set that hit a training event is 6.3 sigma |
| `zPersist` | 10 | the knee: hits flat to 10, falling from 12 |
| `rhoMin` | 0.5 | keeps Yaogan 1; coincides with the revert bound |
| `rhoMax` | 100, open in effect | a bound of 2 loses COBE R/B's ramp in the replay |
| `evidenceMin` | 10 | no hit lost, 7% fewer alarms |
| `persistMinSpanHours` | 18 (LEO, MEO), 6 (HEO, GEO) | no hit lost, 18% fewer alarms in low orbit; sparse sets above |
| `kappa` | 100 in every regime | the last value losing nothing |
| `hCusum`, `cusumDrift` | 12, 0.5 | no training hit came from it; not lowered |
| `sigmaPrior`, `sigmaPriorBstar` | 0.03, 0.05, 0.5, 0.2 km; 1e-4 | set by eye from the measured scatter; nothing to fit on |

With these values the replay, not the sweep, detects 15 of the 43
headline targets of the training split (3 late, 25 missed) and 12 of the
32 of the validation split (2 late, 18 missed), which was replayed once,
after the values were fixed; the full tables are in `kpi/latest.md`. The
whole Archive, 2005 to 2026, replays in about seventeen minutes on the
machine the fit was made on. Of the 92 suspected verdicts raised from a
CUSUM candidate over the twenty-two years, none hit a target and 17 were
counted as false alarms, the rest being duplicates of a step a jump
candidate had already raised.

## What the training split's misses are

Of the twenty-nine headline targets of the even years not detected, read
from the parents' own sets:

- Parents that did not move measurably (a few metres, within their
  scatter): ALOS-1 R/B, IGS 3A R/B, Cosmos 2428, Sentinel 1A, the Fregat
  tank, GOSAT 2's debris and fairing cover, GCOM-W1's fairing panel, and
  the anomalous events (Cosmos 1818, Iridium 47, Haiyang 2A). The parent
  channel cannot see these; the fragments can.
- Parents silent until after the fragments were catalogued, raised late:
  Yaogan 1 (now within the ratio's band), Telkom 3's Briz-M, Meteor 3-5
  R/B, SL-23 DEB, Cosmos 2447's second ullage motor, NOAA 14; and
  Resurs-P1, whose next set came twelve days after the event.
- SOZ ullage motors whose step in the catalogue precedes the stated time
  by two to four days (Cosmos 2022 in 2006, Cosmos 2447 in 2016, Cosmos
  2459 in 2018) or follows it by thirty-three hours (Cosmos 2459 in 2014),
  outside the matcher's one-day margin; and Beidou G2, whose sets move
  before and after its day. Either the stated times are late for these
  deep-space objects or their sets' epochs lead the fit; the owner's call,
  since the margin is the scorecard's.
- Day-old stages with under five sets (Beidou G4 and G5 R/B), noisy
  deep-space series with no clean step (AMC 14's Briz-M, Cosmos 2434's
  ullage motor, Cosmos 2513 R/B), and Cosmos 2423, whose fragments were
  catalogued seven hours after the event.
