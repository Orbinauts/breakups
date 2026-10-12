# The thirteenth phase: a candidate opened on the perigee radius or the inclination

The parent-step layer opened a candidate only where the semi-major axis's residual reached six sigma. The perigee radius's and the inclination's residuals were read only once a candidate stood: the step estimator measures them against the frozen pre fits for the impulse the step implies. A breakup whose recoil on the parent is mostly radial or normal changes the orbit's shape or its plane at constant period, and leaves the semi-major axis alone (`impulse.ts`). Such a breakup was invisible to the early warning, by construction. This note records the experiment that lets the other two residuals open a candidate, the criterion for keeping it written before any replay was read, and the reading.

## The change (`openOnThreeAxes`)

With the parameter on, a set whose semi-major-axis residual stays under the candidate threshold (`zCand`, six sigma) still opens a candidate where the perigee radius's or the inclination's normalised residual reaches it, on the larger of the two. So a candidate opens where the largest of the three residuals reaches the threshold. Where the semi-major axis's residual reaches it, the candidate opens there as before, whatever the other two read, so every candidate the detector opens today opens and is judged as before.

- **The residuals**: each quantity against its trailing fit at the set before, the fit a candidate freezes as its pre fit (`fitOf(state, "rp" | "inc", params, previousEpoch)`). They are normalised as the step estimator already reads them (`axisReading` in `step.ts`): the perigee radius by the larger of its fit's scale, the semi-major axis's own scatter and a metre, with the drag term's rate over the gap; the inclination by the larger of its fit's scale and the format's last digit, with no drag; both by the band's live scale, with no common mode. No new number is fitted.
- **Persistence**: a candidate the perigee radius or the inclination opened is judged on that quantity (`persistenceEstimate`): the same two-segment level and slope against the frozen fit, the later sets' ratio to the first jump, the evidence against a drift, the same thresholds (ten sigma, half the jump kept, evidence ten, the same post sets and span). A bad set on that quantity is dismissed as a bad set and dropped from the ring. The open alert's persistence tiers read the same quantity.
- **Everything after** is unchanged. The verdict's step, the impulse, the record, the held altitudes, the siblings, the status and the scope read the semi-major axis's estimate, which already carries the perigee's and the inclination's steps. The verdict's reasons say which quantity opened the candidate.
- **Off** (the default), nothing changes: the trigger is not read, and a candidate carries no axis.

Tested on synthetic series (`src/detector.test.ts`, the three-axis trigger): a quiet rocket body whose perigee drops half a kilometre at constant semi-major axis, or whose inclination moves a fiftieth of a degree, raises nothing off and one suspected verdict on the step's bracket on; a single bad set in the perigee radius is dismissed as a bad set.

## The criterion, written before the replay

Written and committed before the first replay with the parameter on was run, as the coordinator decided under the owner's delegation. Every number is read on the training split (the even years, 2006 to 2026) of the approximate parallel replay (`--parallel 4 --from-states kpi/work/states`, the same chunks and states as the shared baseline replay of the integration branch it is compared with), from `latest.json`'s `splits.train`:

1. **Early-warning detections rise by at least 2 events**: `lines["breakups A-B"].detected`, the reported breakups of confidence A and B flagged before their first fragment (the headline early-warning line), at least the baseline's plus two.
2. **Early-warning false alarms rise by at most 10%**: `falseAlarms`, at most the baseline's times 1.10.
3. **The Confirmed line's training recall does not fall**: `confirmedLine.lines["breakups A-B"].detected` at least the baseline's.
4. **The Confirmed line's false share does not rise by more than 1 point**: `confirmedLine.falseAlarmRate` at most the baseline's plus 0.01.

All four must hold for the parameter to be turned on; otherwise it stays off. The held-out years (the odd years) are read once, after the decision, and recorded; they do not move it. A replay with the parameter on is read on the training split alone, through a reader that prints nothing of the odd years, and its console log is not opened.

## The reading

Pending: the replay runs after this criterion is committed.
