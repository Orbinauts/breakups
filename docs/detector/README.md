# The detector, as built

This is the detector `confirmed-v10`, the twelfth phase of its build, as `src/` runs it today. The first half describes it as it works now: what it reads, the Confirmed channel step by step, the parent-step layer beside it, the states an alert passes through, and the parameters with where each was fitted. The second half says how it got here, phase by phase, and where its ceiling lies. Every threshold is in `src/params.ts`, tagged physical, policy or fitted, with the sweep that chose it (`PARAMETER_PROVENANCE`). The fitting notes beside this file record each phase's sweeps on the training split, `kpi/latest.md` carries the scorecard as last run, and `events.md` dissects every reported event.

## Two traces

A breakup leaves two traces in public data. The parent's own orbit jumps, by metres to kilometres, in the element sets the catalogue publishes for it. Days to weeks later, new objects appear under the parent's launch. The detector reads both for what each gives.

- **The pieces** are the target. Fresh pieces in the plane of one body of a launch name that body as the parent, confirm the breakup and time it by their convergence on it. A Confirmed alert is such a breakup, with or without a step seen first on the parent ([the seventh decision record](../decisions/0007-the-target-is-on-confirmed-alerts.md)).
- **The parent's step** is early. It is raised as a suspected alert, the early warning, weeks before the first fragment when it is right and precise in time, but most early warnings are manoeuvres it cannot tell apart, so it is measured beside the target rather than targeted ([its accuracy](#the-early-warnings-accuracy)). It helps name the parent where the pieces cannot, and it times the event where the pieces confirm it.

## What it reads

`runDetector` takes the states the last run returned (per object and per launch), the sets published since, and the run's instant; it returns the new states, the verdicts it raised and a log row per candidate, alert and launch judgement. Its inputs:

- **The element sets** (`elements.ts`), in the order the catalogue published them. Each is a light row: the six mean elements, the drag terms, the element set number, the publication time where the catalogue gives it, and the catalogue's class of the body. The semi-major axis, the apsides and the regime (low, medium, highly elliptical or geosynchronous orbit) are derived from it with the engine's constants.
- **The satellite catalogue**, joined onto each row by the caller: the class (payload, rocket body, debris, unknown), the launch day (`launchedMs`), and the operational status (`opsStatus`), the catalogue's `OPS_STATUS_CODE` folded to working (`+`, `P`, `B`, `S`, `X`), nonoperational (`-`), decayed (`D`, read as nothing) or unknown. The decay days come separately (`DetectorInput.decays`), and the detector reads each only from its day on, so a backtest's catalogue gives it nothing a live run would not have had. The launches of the crewed spacecraft and the stations' cargo craft (`visiting.ts`, 295 since 2005) are generated from the catalogue's names by `npm run archive:visiting`.
- **GCAT's payload catalogue**: the window in which each payload fell silent, its end of transmission (`endedByMs` and `endedFromMs` on the row), so the status is read as of the step.
- **The space-weather indices** of each day (`DetectorInput.space`): Kp, ap and F10.7 from GFZ Potsdam, Dst from NASA's OMNI2.
- **Public notices** naming an object, where the caller has them. A notice confirms an open alert on its object, but a confirmation by a notice alone is not on the Confirmed line.

In the backtest the Archive supplies all of this ([docs/archive.md](../archive.md)). In the prospective test, main's scripts pull the same data each day.

## The Confirmed channel, step by step

### 1. New pieces under a launch (`fragments.ts`)

Every launch keeps the bodies seen under it, with their first set's orbit, when each was first seen, its new bodies by month, and its cloud memory. The catalogue keeps the high-water mark of designated numbers against time, over the numbers below the analyst ranges. Analyst objects (numbered from 80,000, and from 270,000) have no designator, so they go to a pseudo-launch per range. Their numbers are reused, so neither the mark nor the first set says anything of them. They confirm an open alert only where the parameters let them and the plane test names that alert's parent alone, which is off as fitted (`analystAttributes`).

On a run that brings a launch new bodies, the channel reads the burst over the launch's own background: a Poisson tail of the fortnight's count above the mark, against the rate read off the year before, floored at half a body. A big old cloud whose late pieces trickle in at tens a month is not a new event when a batch arrives; five new pieces under a launch that gained none in a year are.

### 2. New by numbering

A body numbered at or under the mark at the event existed before it, and a body with any set before the event is not a piece. Either is a returning old body, an object catalogued late.

### 3. In the plane of one body

Each piece's inclination and node are compared with each candidate parent's. The node is adjusted for each orbit's own J2 precession from the event to the piece's first set, and the difference is a distance in units of the tolerances: 0.2 degrees of inclination, 1.5 of node, within three. Each piece carries every candidate parent whose plane it lies within the bound of, so the attribution sees where the plane test alone cannot name the parent.

### 4. A kick, not a release

The cloud's velocity is the median change of the pieces' semi-major axes from the parent's, read as a tangential impulse. Its Gabbard spread is the range of their semi-major axes. A rideshare's satellites leave their dispenser at under a metre a second and are classed payloads; fragments are classed debris or unknown and spread over tens of metres a second. A rideshare's deployments and a young launch's own objects are excluded: a launch under thirty days old needs five metres a second before its new bodies count as fragments, whatever their class.

### 5. Two paths

Pieces in the plane of a body with an **open alert**, first published after its step, confirm that alert. Pieces in the plane of a body with **no open alert** are attributed to it (`attributeCloud`): the verdict is `confirmed` with no step, its event the pieces' convergence. The candidate parents are every body of the launch not classed as a fragment and seen before the run, a day-old stage included. A launch with at most thirty debris-classed bodies also offers its older ones as parents, for pieces in no other body's plane (a fairing cover or a tank breaking up; `attributionDebrisParentsMax`).

### 6. The rules

The same rules judge both paths (`judgePieces` in `run.ts`). Each is a parameter that can be turned off, and the reading of every signal is kept on the alert and on the attribution row, so the rules are re-thresholded offline (`npm run kpi:sweep -- --confirmations` and `--attributions`).

- The launch is older than a month, and quiet in the year before: at most two new bodies a fortnight, else the pieces are an old cloud's backlog.
- Nothing under a crewed station's launch (`stationLaunches`). Nothing under the launch of a crewed spacecraft or a station's cargo craft but on its rocket body (`visitingLaunches`). What these shed is released on purpose.
- Nothing from pieces first seen on or after their parent's reentry day, as the catalogue publishes it (`reentryRefuses`): a capsule's or an aerodynamic breakup's debris.
- A cloud velocity of at least a metre a second, else the pieces are the catalogue's re-designations or a release in the parent's own orbit.
- Not on a debris-classed parent first catalogued under ninety days before its step: that is a fresh piece of the launch's own cloud, whose settling fit its siblings "confirm".
- Where the launch remembers a cloud within a year, only pieces out of that cloud's plane, and only where the parent is not in it. A cloud is catalogued in batches for months, and each batch would otherwise confirm the next step on any body of the launch.
- On a debris-classed parent under an active cloud, only pieces nearer its plane than the cloud's nearest body.
- A single piece only on a parent that is not debris, under a launch that gained nothing in the year before and nothing else in the window.

The attribution adds its own:

- At least three pieces kept (`attributionMinPieces`).
- The run brings new bodies to at most two launches older than a year (`attributionBatchLaunchesMax`); more is the catalogue listing a batch of old objects.
- A batch of three or four pieces needs three quarters of them crossing the parent within 48 hours of their median (`smallBatchOriginHours`). On a step's confirmation this rule cost a headline confirmation at every bound, so it applies to attributions only.
- Pieces whose common instant is at or before the launch's first sighting are the launch's own objects (`originLaunchMarginDays`).
- A burst nobody was named for in the half year before does not keep its own cloud from being attributed (`attributionUnnamedGraceDays`).

One override applies to both paths. Three pieces or more crossing the parent within an hour of one instant, not the remembered cloud's own, were made at once (`originOverrideHours`). They lift the rules that read the launch's history as an old cloud: the remembered cloud, the backlog and the cataloguing batch.

### 7. Naming the parent

Of the bodies whose plane the pieces share, the parent is the one their semi-major axes centre on: a cloud's periods straddle its parent's. It is told from the others by that centre (three times nearer, floored at two kilometres), by the pieces' convergence on it (three times smaller a miss), or by a persistent step it alone made. Where the pieces cannot tell a launch's rocket body from a payload operating at the time, by its dated status, the rocket body is named (`attributionPrefersStageOverWorking`), unless the payload alone made a step.

Where a step or that preference picks the parent among bodies the pieces cannot tell apart, the others are named beside it as the verdict's candidates (twins, `Verdict.candidates`). The launch's own debris of its first season counts as a twin where the launch left at most thirty. Twins nothing tells apart are refused, and the cloud stays for review (`attributionTwinsUnresolved`, off as fitted). The pieces' convergence preferred over their centre (`attributionConvergenceNames`) and every stage preferred over its payload (`attributionPrefersStage`) were built and left off.

### 8. Timing (`event-time.ts`)

Where no step was seen, the event's instant comes from the pieces (`eventFromPieces`). Every piece was where the parent was at the breakup, so the pieces' first sets and the parent's last set before them, propagated back, converge there. The angle of each piece from the parent about the parent's orbit normal passes through zero once a lap. The crossing the pieces share is found on a coarse grid of up to 180 days and refined on a minute grid, by the least root-mean-square distance of the pieces from the parent (the miss). The sigma is the miss over the pieces' relative speed, or their crossings' scatter, whichever is larger. A single piece's laps cannot be told apart, and the count of crossings within twice the least miss says so.

Each piece's own crossing nearest the agreed instant is kept too, with its lap about the parent, and read as the common origin (`originOf`). It gives the median crossing, the half-widths within which half and three quarters of the pieces crossed, in hours and in laps, and the pieces' age at it. The median crossing is the event's instant where its sigma is the finer, and the origin drives the override, the launch margin and the small-batch rule above. As a gate on its own it is off: on the training years it costs half the confirmations at every bound (`d10-confirmed.md`).

Where the first sets are days after the event, the pieces converge to a few kilometres and the instant to minutes (Cosmos 2251, Nimiq 6's Briz-M, Iridium 91). Where they are weeks after, SGP4 run backwards over a low cloud's drag misses by thousands of kilometres, and the sigma, the pieces' scatter, says so.

Where a step was seen and the pieces confirm it, the event is the step's. The two sets either side of it are propagated with the engine on a minute grid, from six hours before the pre set's epoch to the post set's. The along-track separation is fitted as a line whose root is the event and whose scatter over the drift is its sigma. The closest approaches per revolution are listed, so the revolution ambiguity is stated rather than hidden.

### 9. Notices, the review list, and the end of an alert

A public notice naming the object confirms an open alert on it after the step. A burst with consistent pieces at a metre a second or more and no alert on any parent, which no body could be named for, is listed as `cloud-only` for review, once a month per launch, and is never a detection. An alert nothing confirms expires after thirty days, or is dismissed where bodies came under the launch and every one was old.

## The parent-step layer

Every object's own orbit is watched for a sudden lasting jump its manoeuvres do not explain.

### Measuring

- **The ring** (`series.ts`): the last thirty-two sets of each object, sorted by epoch, each with the one-step-ahead residual it left on arrival. Re-published epochs replace their earlier values, and older epochs slot in without a residual, since the catalogue re-issues a third of its sets in some years. A set that leaves the orbit by more than fifty kilometres of semi-major axis, half a degree of inclination or five degrees of node off its J2 precession is held in quarantine until the next set says whether the orbit moved there: a cross-tagged set does that, and no breakup does. The two-sided CUSUM, the object's accepted steps over two years and the day bins of its tracking cadence live here too.
- **The object's own scatter**: a robust short scatter of the ring's residuals, floored by a long memory with a half-year half-life, so a calm week cannot make an object look quieter than it is. Before it has eight residuals, a regime prior scaled by the drag term and the day's flux and Ap stands in, which is how a day-old stage is caught.
- **The trailing fit** (`model.ts`): a Huber-weighted local polynomial of the semi-major axis, the perigee radius and the inclination over the window. The window is sixteen sets in low and medium orbits, and the whole ring in highly elliptical ones, where the mean elements wander with the Moon and the Sun. The fit is quadratic in time where six sets over three days allow it, linear with fewer, and the single set's own drag rate with fewer than three. The prediction's sigma is the object's scatter times the extrapolation's leverage, plus a drag term that grows with the drag term and the gap, so a high-drag object's next set may miss by what drag can do.
- **The day's environment** (`environment.ts`): each run's residuals are read by band (fifty kilometres of perigee height in low orbit, one band per other regime). The band gives the day's common-mode drag, the median residual per unit of drag term and gap, which a storm moves for every object at once. It also gives the live scale, the robust scatter of the normalised residuals floored at one. So a storm raises the bar for everyone, while an intact low-drag body hundreds of times above its own scatter still stands out. The space-weather indices scale the prior, enter the drag prediction and set a storm hold at Kp 6; the catalogue-wide normaliser still runs when they are missing.

### The step and the impulse

The step is estimated over the post sets against the frozen pre-step fit (`step.ts`). The model has two segments and a free settling slope, since the catalogue's fit converges on a new orbit over several sets. It gives the step's size in units of its own sigma at the first post set and at the post sets' centroid; the median ratio of the later sets' residuals to the first jump (a bad set is undone by the next, a real step is kept); and the evidence for a step against a drift drag could produce. That evidence is the drift model's weighted squares less the step model's, each slope held by a prior of what noise and drag do in a day. The same runs on the perigee and the inclination, with the CUSUM as a side channel for a slow move no single set shows.

The impulse (`impulse.ts`) reads a measured step by Gauss's variational equations. The tangential component comes from the step in the semi-major axis, at the point on the orbit the apsides place it. The normal component comes from the inclination step, where it is at least a hundredth of a degree. The radial component is the least one the eccentricity change needs beyond a single tangential impulse's reach, and that excess is kept as a chi-squared.

### The gates

- **Candidate**: a set that leaves the object's model by six sigma (the object's own scatter, the extrapolation's leverage, the drag term, the band's common mode and live scale). It opens on the bracket from the last set before it to itself.
- **Watch**: the first post set on a quiet object (its scatter measured, nothing closed on it in a month, no step raised in a year, the jump alone past the persistence size). It is shown and counted by nothing.
- **Persistent**: the step holds at ten sigma over two post sets spanning eighteen hours in low and medium orbits (six above, where sets are sparse and drag cannot mimic a step), or over three post sets whatever they span, or three under a storm hold or run stress. The later sets keep at least half the first jump, and the evidence against a drift is at least ten. A candidate whose later sets keep under half the jump is a bad set. One with no post set in five days (ten in medium orbit, twenty in highly elliptical, fifteen in geosynchronous) lapses, and its set is dropped so the step is measured again. One not persistent after eight post sets fades.
- **Raised** (`suspected`): a persistent step no manoeuvre explains, or one a breakup signature overrides (below). A step older than the time to live when it is raised, such as a yearly bundle's batch of decades-old sets, opens no alert.
- **Scoped**: the scoped line's alert, below.

### Explaining the step

A persistent step is read against everything the detector knows of the object, and `judgeStep` (`fusion.ts`) weighs the manoeuvre explanations against the breakup signatures.

- **The object's record** (`manoeuvre.ts`). Every persistent step joins the object's accepted steps over two years, whatever verdict it got, and a new step is classed by them alone: station-keeping (four or more steps in the year, regular or alternating); campaign (four in five with the step's sign, or a young payload's first raise); disposal (the perigee dropped twenty kilometres with the apogee kept, or a raise of fifty kilometres in low orbit or two hundred at geosynchronous altitude); occasional (a past step on no pattern); or unique (no step in two years). Any class but unique explains the step. The record's tests are its breakup signatures: ten times the record's median; opposite to every one of at least two past steps; an eccentricity change one tangential burn cannot explain (chi-squared over a hundred), where the radial component reaches the fitted kick (zero); and the drag term's change, built and left off.
- **A return to a held altitude** (`maintenance.ts`). Every object keeps the lowest and highest semi-major axis it showed in each of the last twelve calendar months, frozen when a candidate opens so a jump is never judged against itself. A step whose post-step level lands inside a month's range, or within a tolerance of it (three times the object's scatter, or a kilometre), is a return to a held altitude. That is what a drag make-up raise or a seasonal lowering looks like, and what a breakup kick, which lands anywhere, rarely does. Lowerings are read too.
- **Siblings** (`siblings.ts`). The catalogue-wide ledger keeps every persistent step of the last four weeks with the orbit it was made on. A new step counts the other objects of its launch, and of other launches in its shell (the same inclination within a tenth of a degree, the semi-major axis within fifty kilometres), that made a step of the same sign and a size within a factor of two in the fortnight before. Two or more make the step a coordinated campaign, since a breakup is one object alone.
- **A deployment climb**. For an object under half a year old, the median altitude of its launch's other payloads: a step that carries the object at least half its length towards it is a deployment, since an insertion orbit lies below the working one.
- **A working status**, read as of the step (`operationalAt`). Where GCAT dates the payload's end of transmission, a step more than thirty days before it is a commanded satellite's, which could have burned. One more than thirty days after it is a dead one's, and one within the month either side reads nothing, since the end of a satellite that broke up is often the breakup itself. With no date, only a working status today is read. [The sixth decision record](../decisions/0006-the-scoped-line-is-the-point-nearest-the-target-and-the-status-is-read-as-of-the-step.md) says why, and `d7-scope.md` gives the scorecard with the dated status, today's and none.

The last four explanations are independent of the record. They apply to every class as fitted (`explanationsForNonPayloads`), although the catalogue's class still decides a young payload's first raise. Two more signatures sit outside the record: a lowering on a record of nothing but raises that is not disposal-shaped, built and off as fitted (`againstDragMinRaises`); and a nonoperational status on a unique step.

The weighing: the record's own explanation is beaten by any signature. The record's signatures are outweighed by one independent explanation, since they say a step is unlike the object's past and nothing against evidence from outside it. The nonoperational signature is never outweighed. A step is raised where no explanation applies or a signature overrides; otherwise it is a `manoeuvre`, a terminal verdict the scorecard counts as nothing. The reasons say which applied, and the explanation and signature bits are logged, so a sweep can re-apply the whole decision.

### What an open alert keeps

A persistent step, raised or not, joins the record and the ledger and opens an alert, `suspected` or `manoeuvre`, that waits thirty days for the pieces or a notice. A suspected step is timed from the two sets either side of it. While open, the alert keeps reading the object's sets against the frozen pre-step model. It records whether the step still held after three and five post sets and after one, three, five and seven days; the tracking cadence after the step; the damage ratio, the one-step-ahead residual scatter in the second to fourth week against the scatter before (a tumbling object or a changed shape scatters more); the pieces it saw; and the confirmation rules' reading. Its row in the log is what the scorecard's tier table, the separation report and the confirmation sweep read.

### The scoped line (`scope.ts`)

The scoped line is the point nearest the target the step layer reached. It is a predicate on the parent at the time of the step: its class, its status as of the step, its regime, perigee and drag term, its age from launch (`launchedMs`), and the days since its last persistent step. It adds gates on a raised step: its size in sigma and in metres, its along-track impulse, the kick one tangential impulse cannot explain, the drag term's change, and whether a manoeuvre explanation applied, with the persistence tier it must hold to. As chosen in `d7-scope.md` (`DETECTOR_PARAMETERS.scope`), it keeps parents launched five years or more before the step, with a step of twenty sigma or more, an along-track impulse of at least three centimetres a second, an eccentricity change one tangential impulse cannot explain (chi-squared a hundred), and the drag term changed at least two-fold where read, once it has held seven days.

Every persistent step's row and verdict carry whether its parent was in the scope (`scopeIn`) and whether the step also passed the gates (`scoped`). An open alert that is both raises one `scoped` verdict when its step reaches the tier still holding. The scorecard scores the scoped line on the reported events whose parent was in the scope at the event, beside the whole catalogue's lines, with the headline events it leaves out counted.

### The early warning's accuracy

The suspected verdict is the early warning, and its accuracy is measured on every split, with the Confirmed line's, on the [results page](../results.md#early-warning-suspected): the reported breakups it flags before the first fragment is catalogued and those it flags only after, the false alarms (a year, per ten thousand object-years, and as a share of all early warnings, each rate with its Wilson 95% interval), the lead over the first fragment and the timing error. On the held-out years it flags about a third of the reported breakups before their first fragment, typically weeks ahead and to within the hour when right, and more than ninety-nine early warnings in a hundred are something else, mostly manoeuvres. [The life of an alert](../results.md#the-life-of-an-alert) follows every step that held to its end (confirmed, dismissed, expired, or cleared as a manoeuvre) with the probability at each end that it was a reported breakup's.

Regression tests on real orbit histories (`test/early-warning.test.ts`, fixtures cut from the Archive by `npm run kpi:fixtures`, `scripts/kpi/early-warning-fixtures.ts`) hold the layer to its record case by case. Eight reported breakups the full replay flags (USA 32, Meteor 2-7, Cosmos 2491, NOAA 17, Cosmos 2499, DMSP 5D-2 F8, and near the geostationary ring a Titan IIIC Transtage and the rocket body of LES 8 and 9) must each raise a suspected verdict on the same step bracket and instant as the full replay, before the first fragment and any notice, the instant within three times the held-out median timing error (at least two hours; a day and a half near the ring). A station's reboost, a constellation satellite's orbit raise and a geosynchronous satellite's station-keeping must raise none, each still seen and cleared as a manoeuvre, and a quiet rocket body nothing at all. Each fixture is one object's sets alone, a hundred days before the instant to ten after: every positive case was raised in the full replay with its band's live scale at its floor, which is what a run with no band-mates reads, and a window of sixty days made three old payloads young to the detector, whose first raise is then read as a campaign.

## One run (`run.ts`)

A run makes three passes over the sets, then one over the launches.

1. **Measure**: each set is screened against its ring, predicted from the object's trailing model (or, for a post set of a live candidate, from the candidate's frozen pre-step model), pushed with its residual, and its body noted under its launch.
2. **Environment**: the run's residuals by band, and the weather.
3. **Decide**: a set past six sigma opens a candidate (a watch verdict shows it on a quiet object); each later set re-estimates the step; the candidate closes as a persistent step, a bad set, a lapse or a fade. A persistent step is read against the record, the held altitudes, the ledger, the launch-mates and the status, fused by `judgeStep`, timed, noted in the ledger, and opens an alert.
4. **Launches** (`judgeLaunches`): every launch the run brought bodies to is judged. Open alerts on its parents are confirmed by pieces under the rules. The pieces in the plane of a body with no open alert are attributed to it. A launch with few debris-classed bodies tries its older ones as parents. Notices are applied, a burst nobody was named for is listed as `cloud-only`, and alerts past the time to live close.

`params.ts` holds every threshold with its provenance, `log.ts` one row per candidate, alert and launch judgement with every signal (so the sweeps re-threshold offline), and `detector.ts` the shapes the scorecard scores.

## The states

`candidate` (judged, unlogged until it closes) → `watch` (shown) → `suspected` or `manoeuvre` (terminal, counted as nothing) → `scoped` where the scoped line raises it → `confirmed` by pieces or a notice, or `dismissed`, or `expired`. A `manoeuvre` the pieces confirm is promoted and says so. A `confirmed` verdict with no step is the Confirmed channel's attribution: no alert was open on the parent, and the pieces named it. `cloud-only` is a burst nobody could be named for, listed for review.

## The parameters, and where each was fitted

Fitted values were read off the training split, the even years, and never touched while looking at the held-out odd years. Policy values are the owner's choices about the product; physical ones are constants of the orbit or the format.

| What | Values | Kind | Where |
| --- | --- | --- | --- |
| The ring and the fit | 32 sets; a window of 16 sets (the whole ring in highly elliptical orbit), 30 days (60 in highly elliptical and geosynchronous); quadratic from 6 sets over 3 days, linear from 3; Huber constant 1.345 | policy, physical | `params.ts` |
| The object's noise | the prior scatter by regime, its knee in the drag term, the drag scale `kappa` 100 | fitted | `d1-fitting.md` |
| Candidate and persistence | 6 sigma to open, 10 to persist; the later sets keep 0.5 to 100 times the first jump; evidence 10; two post sets over 18 hours (6 in highly elliptical and geosynchronous); the CUSUM at 12 | fitted | `d1-fitting.md` |
| The clock | one set never raises; 3 post sets alone or under stress; 8 post sets to fade; lapse after 5, 10, 20 and 15 days by regime; storm hold at Kp 6 | policy | `params.ts` |
| The record | two years, 64 steps; the class rules (4 steps a year, a 20 km perigee drop, a 50 or 200 km raise); a young object is 90 days | policy | `d2-fitting.md` |
| The record's tests | 10 times the median; opposite to 2 past steps; chi-squared 100; the drag-term test off | fitted | `d2-fitting.md` |
| Two step options, tried beside the parent-side signals | an occasional raise on a non-payload, persistence on the mean step: both off | fitted | `d3-fitting.md` |
| Manoeuvre discrimination | held altitudes within 3 sigma or 1 km over 12 months, lowerings too; 2 siblings within 14 days, a factor of 2, 0.1 degrees and 50 km; a deployment under 180 days; one independent explanation outweighs the record; explanations on every class; nonoperational overrides; the against-drag signature off; no floor on the kick | fitted, policy | `d6-fitting.md` |
| The status | read as evidence, dated by GCAT, 30 days either side read as nothing | policy | `d6-fitting.md`, `d7-scope.md` |
| The scope | 5 years old, 20 sigma, 3 cm/s, chi-squared 100, the drag term twofold, held 7 days | fitted | `d7-scope.md` |
| The launch channel | a fortnight against the year before, floor 0.5, tail 0.001; the plane 0.2 and 1.5 degrees within 3; 1 m/s for a deployment; 30 days and 5 m/s for a young launch; 1 m/s for the review list | fitted, physical, policy | `d3-fitting.md` |
| The confirmation rules | at most 2 new bodies a window in the year before; 1 m/s; a debris parent under 90 days; a cloud remembered a year; a debris parent's pieces nearer than the cloud; a single piece on a quiet launch | fitted, policy | `d3-fitting.md`, `d5-fitting.md` |
| The attribution | on, by the seventh decision record; 2 old launches a run; 30 debris parents; the centre 3 times nearer, floor 2 km; the convergence 3 times; a step breaks ties; 180 days' grace for an unnamed burst; a young launch refused; analyst ranges never attribute | fitted, policy | `d9-confirmed.md` |
| Pieces and origin | 3 pieces; twins named with their candidates, unresolved twins refused; the origin gate off; the override at 3 pieces within an hour; the launch margin at zero days | fitted, policy | `d10-confirmed.md` |
| Exemptions and reentry | 11 station launches; 295 visiting launches; the reentry refuses from its day; 3 or 4 pieces need 3 quarters within 48 hours; the stage preference and the convergence over the centre off | policy, physical, fitted | `d11-confirmed.md` |
| The stage over a working payload | on, within 3 times the centre | fitted | `d12-confirmed.md` |
| The timing | a minute grid, 6 hours before the pre set, 1 km per set | physical, policy | `params.ts` |

## The KPIs

The current numbers are on the results page, read from `kpi/latest.json` and checked by its test cell by cell: the headline in [The headline](../results.md#the-headline), and every table of the held-out years under [The Confirmed line](../results.md#the-confirmed-line-the-target) and [Early warning (suspected)](../results.md#early-warning-suspected), with [the life of an alert](../results.md#the-life-of-an-alert) on both splits. The README carries a summary of the held-out years. `kpi/latest.md` carries every split, and `events.md` the outcome and cause of every reported event.

## How it got here

The headline line is breakups reported to the day or better. The training split is the even years, where every fitted value was chosen, and the validation split the odd years, held out. Until the tenth phase the validation years ran from 2005; from it they run from 2007, since 2005 became the warm-up year. The first three phases' numbers are as their notes reported them. The fifth phase corrected the scorecard's catalogue clock (the mark and a fragment's first set by the catalogue's publication order, not by back-dated epochs; `d5-fitting.md`); under it the third phase's validation line reads the same, its false alarms read 15,561, and its leads over the catalogue were overstated.

The owner's first target was on the parent's step: an alert on it before the first fragment's set was published. Phases one to eight built and measured that channel. The ninth moved the target to the pieces, on the seventh decision record.

**D1 `step-v1`, the parent-step channel on every object** ([d1-fitting.md](d1-fitting.md)). Validation: 12 detected, 2 late, 18 missed of 32 (38%), at 74,489 false alarms. Every mover was caught, day-old stages and sparse regimes included, and 96% of the false alarms were payload manoeuvres.

**D2 `step-v2`, the object's record and the impulse** ([d2-fitting.md](d2-fitting.md)). 11, 2 and 19 of 32 (34%), at 15,623 false alarms: 58,049 manoeuvre verdicts silenced. The gate cost Cosmos 2499's second event, whose one past step was its first. The five-day margin in deep space gained the ullage motors on the training split.

**D3 `fusion-v3`, the fragments and the event's time** ([d3-fitting.md](d3-fitting.md)). 11, 2 and 19 of 32, at 15,645 false alarms. It built the Confirmed line (5 right and 14 wrong on validation), the review list, and timing to a median of 35 minutes from 18 hours. The tier table showed that a week of waiting halves the false alarms and loses a third of the detections. The fourth phase of the design (`event-time`, the tuning in geosynchronous and highly elliptical orbit) was folded into this one: the event's time is here, and the highly elliptical line was dissected and found to be a limit of the data rather than of the thresholds.

**D5 `fusion-v4`, the confirmation rules, the Confirmed block, the dissection and the freeze** ([d5-fitting.md](d5-fitting.md)). 11, 2 and 19 of 32, at 15,546 false alarms. It made the Confirmed line the product can show: on validation 14 confirmed alerts from 43, a precision of 36% on the step and 57% on the object, from 12% and 26%. Of the 36 targets the catalogue reported, 5 were confirmed, a median of 4 days after the alert. `d5-fitting.md` lists every confirmation before and after, and `events.md` every event with its cause.

**D6 `fusion-v5`, manoeuvre discrimination** ([d6-fitting.md](d6-fitting.md)): the held altitudes, the siblings, the deployment climb and the operational status, weighed against the record's signatures. 11, 2 and 19 of 32, at 4,764 false alarms (8,278 with the status off). Seven false alarms in ten closed as manoeuvres: by the working status (8,891), the record, the siblings (6,086), maintenance (1,020) and deployment (971), the record's signatures outweighed by one explanation from outside it. One non-headline detection was lost, GOSAT 2's rocket-body debris, read as stepping with its siblings. The damage ratio does not separate; the drag term's ratio does on what is left, but costs a quarter of the hits as a gate. The false-alarm rate stayed at 99.7%.

**D7 `scoped-v6`, the status read as of the step, and the scope study** ([d7-scope.md](d7-scope.md)). The status was dated by GCAT's end of transmission, a month either side read as nothing. 11, 2 and 19 of 32 at 3,155 false alarms: the dated status removes today's hindsight and a third of the false alarms, with the headline line unchanged. Thirty scopes, with every strict gate swept on the training years: none reaches nine in ten at under one in ten, and none comes near. The scoped line is the point nearest the target, a fifty-fold cut in false alarms for three of the eleven headline detections: 3 of 24 in its scope (13%) at 56 false alarms (95%), with 14 of 38 headline events left out.

**D8, the truth audit**, with no change to the detector ([d8-audit.md](d8-audit.md)). The false alarms are not hidden real events: none of the scoped line's 82, and about one in three hundred of the whole catalogue's, which moves the rates by under a point.

**D9 `confirmed-v7`, the target moved to Confirmed alerts** ([d9-confirmed.md](d9-confirmed.md)). It built the attribution of fresh pieces to a body with no step, named by the centre of their periods among the bodies of their plane; the event's time from the pieces' convergence; and the first statements in the truth. It also fixed the catalogue's mark: a body designated under a launch but numbered in the analyst ranges had lifted it in 2020 above every piece catalogued after. With every rule off, the attribution confirms 28 of the 35 training headline breakups at 553 false confirmations. The rules that make it usable (the cataloguing batch, the fewest pieces, the fifth phase's rules against old clouds) leave 22 at 18. On the held-out years: 18 of 25 (72%, 52% to 86%) at 31 false (55%, 42% to 68%), twelve of those in 2005, the detector's first year. On the training years 22 of 35 (63%) at 35% false. Every held-out confirmation with an agency's statement came a median of six weeks before it and three hours after the catalogue's first fresh piece. The parent-step line stayed as D7's, at 3,158 false alarms.

**D10 `confirmed-v8`, method fixes, twins and the common origin** ([d10-confirmed.md](d10-confirmed.md)). 2005 became the warm-up year, scored on no split, and the crewed stations were exempted. Twins a step picks are named with their candidates, read on the body named and at the launch. The pieces' common origin became an override, a launch margin and the event's instant. Held out: 17 of 23 (74%, 54% to 87%), the same with the twins at the launch, at 12 false (38%, 23% to 55%), from 55%. Most of that fall was method (2005's twelve and the station's), the rest the launch margin and three pieces. Training: 22 of 35 at 22%. The common-origin test does not separate well enough to gate, and the twins at the launch move one training event. The parent-step line from 2007: 10 detected, 2 late, 16 missed of 28.

**D11 `confirmed-v9`, the crewed and cargo craft, reentry and small batches** ([d11-confirmed.md](d11-confirmed.md)). The crewed spacecraft and the stations' cargo craft were exempted as the stations are, 295 launches from the satellite catalogue's names, their rocket bodies still judged. Yaogan-6's anomalous debris of 2014 and Luch's breakup of 2026 entered the truth; two tight-origin candidates without a source stayed false. Pieces after the parent's reentry were refused, and small batches of attributed pieces were asked for a tight common origin. The stage preference and the convergence over the centre were tried and left off. Held out: 17 of 23 (74%), the same with the twins at the launch, at 9 false (31%, 17% to 49%), from 38%, all three by the reentry rule (a Kobalt-M's panels after its recovery, a payload's stage's pieces a year after the payload fell). Training: 22 of 35 at 8%, under one in ten for the first time. Recall was unchanged on both.

**D12 `confirmed-v10`, GCAT's satellite catalogue in the truth, and the stage over a working payload** ([d12-confirmed.md](d12-confirmed.md)). GCAT's satellite catalogue was read into the truth uniformly, every piece with a parent and a separation date in every year, by a rule written before any re-scoring: 2,433 events from 599; from 2005, 363 scoreable from 175; the headline's 88 unchanged. The stage is preferred over a payload operating at the time where the pieces cannot tell them apart. It renamed thirty training attribution rows, every one refused by another rule, and changed no confirmation on either split; it was kept on its prior. Held out: 17 of 23 (74%, 54% to 87%), the same with the twins at the launch, at 6 false (21%, 10% to 38%), from 31%. All three by the truth: Cosmos 1461, Nimbus 2 in 2011 and Meteor 1-5 are separations GCAT dates. Training: 22 of 35 at 6%. The held-out years had been read in D11, so this is a measurement under the extended truth, not a fresh blind validation. On 2026-10-11 the detector was frozen at the tag `frozen-confirmed-v10` for the prospective test ([the eighth decision record](../decisions/0008-the-detector-is-tested-prospectively-from-a-frozen-tag.md)).

## The ceiling

### The Confirmed line

Nine in ten at one in ten is not reached on either split, and the training sweeps show no rule that trades a confirmation for fewer than several false ones.

The misses the rules cannot reach are bodies of one launch in one plane and one orbit, which nothing public tells apart (twin ullage motors, a fairing and its siblings, a stage and its payload), and single pieces. The six held-out misses of D11 and D12 are Arabsat 4's Briz-M, Cosmos 2139-41's ullage motor, Cosmos 2464-66's ullage motor, Cosmos 2424-26's ullage motor, Cosmos 2499 and SSLV's third stage; `d12-confirmed.md` says why each was missed.

The false confirmations left look like a small cloud in every number the catalogue gives. In D9 they were pieces of old launches catalogued one or two at a time and the station's jettisoned items; the station and the visiting craft are now exempt. What is left on both splits is a reported cloud's late pieces, twins named wrongly, single pieces and small batches confirming a step, and larger batches under old launches. The six held-out false confirmations of D12 are two stages with no source dating a separation, a twin named wrongly, the launch's own debris confirming a step, a second Nimbus 2 batch, and Cosmos 2535's pieces, which GCAT dates before NASA's date of the event.

The common origin separates true clouds from false ones by their medians, not by their distributions, so it overrides and times rather than gates.

### The parent-step channel

The parent-step channel cannot reach the target (nine in ten detected, under one false alarm in ten) from the parent's data alone. The evidence is in the numbers:

- Half the headline misses are parents that did not measurably move (`events.md`, the totals by cause): the parent had sets between the event and the catalogue, and none left its model by six sigma. A third of all reported breakups never move their parent measurably. Low-velocity events, anomalous events, and the ullage motors whose perigee rides at two hundred kilometres with the drag term wandering, leave no step a set stands out from. Only the fragments can see these.
- A quarter are the clock: the parent had no set between the event and the catalogue's first fragment, or one set, and one set cannot raise an alert. The deep-space events' sets come days to weeks apart.
- The rest are the record gate (a breakup step the parent's record explains, as Cosmos 2421's twenty-one lowerings explained its breakup step), ramping fits (the catalogue converging on the new orbit over several sets, under-reading the first post set), and the margin (the catalogue's step days from the stated time in deep space, where the stated time is itself inferred).
- The false alarms that remain hold for a week, as a breakup's step does: lone manoeuvres on satellites that seldom move, a young satellite's second step the other way from its first, and burns whose eccentricity change one tangential impulse cannot explain. The tier table shows that waiting does not separate them: precision stays under a percent at every tier. The two parent-side signals the owner asked about, the drag term's ratio across the step and the tracking cadence after it, sit inside the false alarms' distribution (`d3-fitting.md`).

D6 tested everything else public about the object and its company: where it flew, what its launch-mates and shell-mates did, whether it works today. It separates a great deal, the validation false alarms falling from 15,546 to 4,764 with the status read (8,278 without) for one non-headline detection. It is not enough: with sixteen detections over eleven years the target allows one or two false alarms, and 1,464 of those left were steps alone on rocket bodies and debris, which no manoeuvre explanation reaches since they do not manoeuvre.

D7 tested the last lever, the population: whether restricting to dead satellites, to low orbit, to old or quiet objects or to low drag, with every strict gate the log allows, reaches the target on what remains. It does not, on either split. A perigee under 400 kilometres is never caught and can be excluded for nothing, but every population keeps false alarms whose steps are as large, as kicked and as lasting as the breakups'. With three to five headline detections a split, the target allows none.

What separates a breakup from a manoeuvre at the first sets is the pieces. So the parent's step is not the target but the early warning, measured beside it: it catches about a third to a half of the headline events before the catalogue, at a precision the data do not allow to rise. On 2026-10-10 the owner put the target on the Confirmed line, which the pieces make precise enough to show.
