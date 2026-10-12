import { OPEN_GATES, WHOLE_CATALOGUE, type ScopeParameters } from "./scope.ts";
import type { Regime } from "./truth.ts";
import { VISITING_LAUNCHES } from "./visiting.ts";

/**
 * Every threshold the detector decides by, in one typed object, so a score
 * is never read without the numbers that produced it: the scorecard writes
 * the object it ran with into its aggregate. Each value is tagged with
 * where it comes from, and the tag is a promise about how it may change:
 *
 * - `physical`: a constant of the orbit or of the format, not to be tuned;
 * - `policy`: a choice the owner made about the product (how long to wait,
 *   how many sets to keep), to be changed by a decision, not by a fit;
 * - `fitted`: read off the training split (the even years) by sweeping the
 *   detector's log, and never touched while looking at the validation split.
 *   The sweep that chose each is named in `PARAMETER_PROVENANCE` below,
 *   by the fitting note and the table in it, and recorded in
 *   `docs/detector/d1-fitting.md` to `d12-confirmed.md` (the environment's
 *   scatter tables, measured by the earlier attempt, say so).
 *
 * The options a phase built and left off by default are in the `legacy`
 * block, so the parameters beside it are the ones the detector runs with;
 * a threshold turned off is at `OFF` (`isOn` reads it). What `docs/detector/parameter-audit.md`
 * found binding on the training split, and what rests on one event, is
 * recorded there. The bounds that size the states the detector carries
 * between runs (a launch's months of counts, the mark's and the sibling
 * ledger's reach, the envelope's months) stay beside the states they size:
 * changing one changes the states' shape, which no replay's override may.
 *
 * The regimes are the four the ground truth uses; a value per regime is
 * given for all four even where only one differs, so a reader sees the
 * whole table at once.
 */
export type PerRegime = Record<Exclude<Regime, "unknown">, number>;

/**
 * The value that turns a threshold's rule off: beyond the reach of any
 * reading (kilometres, hours, days, counts), and finite, so the
 * scorecard's record of the parameters keeps it. A lower bound is turned
 * off at minus `OFF`.
 */
export const OFF = 1e9;

/** Whether a threshold's rule is on: its value is within reach, neither `OFF` nor minus `OFF` (anything a tenth of the way there counts as off). */
export const isOn = (value: number): boolean => Math.abs(value) < OFF / 10;

export interface DetectorParameters {
  /** How many sets of an object the detector keeps, the ring's size. Policy: 32 holds the sixteen-set window and the eight post-step gaps with room for re-published and out-of-order sets, in about two kilobytes an object. */
  ringSize: number;
  /** The most sets the trailing fit reads, per regime. Policy: sixteen in low and medium orbits (a week to a month of sets), the whole ring in highly elliptical ones, where the mean elements wander with the Moon and the Sun and a longer baseline is needed; sixteen in geosynchronous orbit, where sets are sparse. */
  windowSets: PerRegime;
  /** The oldest a set may be and still enter the trailing fit, in days. Policy: thirty days in low and medium orbits, sixty in highly elliptical and geosynchronous ones, so an object that fell silent for a season is fitted on its recent sets alone. */
  windowMaxDays: PerRegime;
  /** The fit is quadratic in time only when the window has at least this many sets and spans at least `quadraticMinDays`; else linear; and with fewer than `linearMinSets` the single set's own drag rate is extrapolated. Policy: six sets over three days is the least that resolves a curvature from noise. */
  quadraticMinSets: number;
  quadraticMinDays: number;
  linearMinSets: number;
  /** Huber's tuning constant for the robust fit, in units of the scale. Physical: 1.345 gives 95% efficiency at the Gaussian and bounds an outlier's pull, the textbook value. */
  huberConstant: number;
  /** How many one-step-ahead residuals the object needs before its own scatter is trusted over the prior. Policy: eight, so a median absolute deviation has something to be robust with. */
  residualsForScatter: number;
  /** The half-life of the long memory of the object's scatter, in days: the floor under the short scatter, so a calm week cannot make an object look quieter than it is. Policy: half a year, long enough to span a storm season. */
  longHalfLifeDays: number;
  /** The most a residual adds to the long memory, in multiples of the current scatter, so one step does not become the object's noise. Policy: three. */
  longMemoryClipSigmas: number;
  /** The scatter a new object is given before it has residuals of its own, per regime, in kilometres of semi-major axis, at a quiet Sun and a low drag term. Fitted on the training split from the measured scatter of objects by regime. */
  sigmaPrior: PerRegime;
  /** The drag term, in inverse Earth radii, above which the prior grows in proportion: an object at B* twice this has twice the prior. Fitted on the training split from the measured scatter against B*. */
  sigmaPriorBstar: number;
  /** How much the drag prediction may miss over a gap, per regime, in kilometres per day per unit of B*: the term `(kappa * |B*| * gap)²` added to the prediction variance. Fitted on the training split so that the normalised residuals of high-drag objects have unit scale. */
  kappa: PerRegime;
  /** The width of a low-orbit band of the environment's common-mode term, in kilometres of perigee height. Policy: fifty, where drag changes by orders of magnitude over a few hundred kilometres. */
  leoBandKm: number;
  /** How an object's scatter scales with the 10.7 cm flux: the normalised monthly scatter by flux band, up to each band's upper flux in solar flux units, one at about a hundred; the last band reaches `OFF`. Fitted, read off the earlier attempt's table over seven hundred and fifty objects (not this project's training split). */
  fluxScatter: [number, number][];
  /** The same for the daily Ap: the factor on the quietest days and on the stormiest, read as a line in the logarithm of Ap between the two days' Ap. Fitted, read off the same table. */
  apScatter: { quiet: number; storm: number; quietAp: number; stormAp: number };
  /** The prior width of a drift's slope, in multiples of the object's own scatter per day, added to the drag term: what noise and drag can do to the orbit in a day. The step model's slope is wider by the first jump's size a day, since a fit settles on a new orbit over a few sets. Policy: three. */
  slopePriorSigmas: number;
  /** The drag term below which an object's residual is not read for the band's common-mode term, in inverse Earth radii: below it drag does not move the orbit measurably over a gap. Physical: 1e-5. */
  commonModeMinBstar: number;
  /** The fewest residuals a band needs in a run for its own common-mode term and scale; with fewer the regime's pooled values stand in, and with fewer still no correction is made. Policy: thirty. */
  bandMinMembers: number;
  /** The least the band's live scale may be: a calm band never makes a step look larger than the object's own scatter says. Policy: 1. */
  bandScaleFloor: number;
  /** The normalised step at which a first post set opens a candidate and is logged. Fitted on the training split: the lowest value whose candidates stay a few a day, so the log stays small and the persistence tests have something to judge. */
  zCand: number;
  /** The persistent step, in units of its own uncertainty, from which a candidate is suspected. Fitted on the training split by sweeping the log. */
  zPersist: number;
  /** The least the post sets after the first may keep of the first set's jump (their median plain residual over it) before the first set is dismissed as a bad set. Policy, from the earlier attempt's evidence: a bad set is undone by the next, a real step is kept. */
  rhoRevert: number;
  /** The band the later post sets' median residual must keep of the first set's jump to be suspected. The earlier attempt's evidence had every true event between 0.82 and 1.28 and a settling stage at 1.7; on the training split a lower bound of 0.5 (the revert bound: a first set that overshot by half still counts) keeps every event hit, and the upper bound is open in effect at 100 (a finite number so the scorecard's record of the parameters keeps it): a bound of 2 would cut a quarter of the non-payload false alarms but loses COBE R/B, whose first post set carried a twelfth of the step the next sets completed, and the drift test guards the top instead. Fitted on the training split. */
  rhoMin: number;
  rhoMax: number;
  /** The least evidence for a step against a drift from the step's instant: the drift model's weighted squares less the step model's, a chi-squared difference. A drag rate the model mispredicted grows from nothing at the step and fits the drift; a step does not. Fitted on the training split. */
  evidenceMin: number;
  /** The fewest post sets, and the least they must span in hours per regime, for a candidate to be suspected; or `persistMinSetsAlone` post sets whatever they span. Policy: two sets over eighteen hours in low orbit, where the span defeats a mispredicted drag rate, six hours above it where sets are sparse; or three sets. The alert must beat the catalogue's first fragment, and a single set cannot raise it. */
  persistMinSets: number;
  persistMinSpanHours: PerRegime;
  persistMinSetsAlone: number;
  /** The fewest post sets under run stress or a storm hold. Policy: three. */
  persistMinSetsUnderStress: number;
  /** After this many post sets a candidate that was not suspected is closed as noise or a slope change and the object's window restarts on them. Policy: eight gaps. */
  maxPostSets: number;
  /** How long after a candidate closed, and after a step was raised, in days, an object counts as quiet, so its first set past the threshold is shown as a watch verdict. Policy: a month and a year. */
  quietAfterCloseDays: number;
  quietAfterRaiseDays: number;
  /** A candidate with no post set in this many days lapses, per regime: five in low orbit, longer where the catalogue's cadence is days to weeks. The unconfirmed set is dropped from the ring, so the step is measured again when the next set comes. Policy. */
  lapseDays: PerRegime;
  /** Kp, on the run's day or the two before, from which a storm hold is on. Policy, from the earlier attempt's evidence: a hold at Kp 6 cost no true event. */
  stormKp: number;
  /** How many candidates opened across the catalogue in the last day put a run under stress. Policy: ten, where a quiet day opens a few. */
  stressCandidatesPerDay: number;
  /** The two-sided CUSUM's drift allowance, in units of scatter, and the decision threshold; the side channel for a slow, low-energy move the step test cannot see in one set. Fitted on the training split; a threshold the sweep found only costs false alarms is set high. */
  cusumDrift: number;
  hCusum: number;
  /** A set whose semi-major axis is more kilometres than this off where the last set and it say drag took the orbit (the mean of their drag rates over the gap), or that moves the inclination by more degrees, or whose node is further from the J2 precession of the last set than this many degrees, is foreign until the next set agrees with it. Physical: no breakup and few manoeuvres move an orbit that far in one gap; a cross-tagged set does. */
  foreignDeltaAKm: number;
  foreignDeltaIncDeg: number;
  foreignRaanDeg: number;
  /** A first derivative of the mean motion below this, in revolutions a day squared as the format prints it (half the derivative), is junk: an orbit cannot rise that fast. Physical. */
  junkMeanMotionDot: number;
  /** How far back the object's own history of accepted steps reaches, in days, and the most steps it keeps. Policy: two years, long enough for a yearly north-south step to recur; sixty-four steps hold two years of fortnightly east-west steps with room. */
  historyDays: number;
  historyMaxSteps: number;
  /** An object younger than this, in days from its first set, has a history that is unknown rather than empty: a payload's first raise in that time is the start of a campaign, not a unique step. Policy: ninety days, which covers the start of an orbit-raising campaign from the insertion orbit. */
  newObjectDays: number;
  /** The fewest accepted steps in the year before a step for the record to be read as station-keeping, and the bounds that call it regular (the coefficient of variation of the intervals at most this) or alternating (the share of sign changes between consecutive steps at least this, as east-west station-keeping alternates). Policy: four steps, 0.75, a half. */
  stationKeepingMinSteps: number;
  regularityMax: number;
  alternationMin: number;
  /** The share of the past steps with the step's sign from which the record is a campaign of one direction. Policy: four in five. */
  monotoneShareMin: number;
  /** The days before a step over which its record's steps are counted for station-keeping (`stationKeepingMinSteps`). Policy: a year. */
  stationKeepingWindowDays: number;
  /** The shape of an end-of-life move: in low orbit a perigee lowered by at least this many kilometres with the apogee kept, or a raise of at least this many; at geosynchronous altitude a raise of at least this many, the graveyard's height above the ring. Policy, from the sizes operators use. */
  disposalPerigeeDropKm: number;
  disposalRaiseLeoKm: number;
  disposalRaiseGeoKm: number;
  /** The step's size over the median of the object's past steps from which it is atypical and raised on a manoeuvring object. Fitted on the training split by sweeping the log. */
  typicalityMax: number;
  /** The fewest past steps for a step opposite in direction to every one of them to be atypical: with one past step the test reads an alternating pattern's second step as its opposite. Fitted on the training split. */
  oppositeMinSteps: number;
  /** The chi-squared of the eccentricity change beyond a single tangential impulse's reach from which the step is raised whatever the record: a thruster burns along the velocity or across it, an explosion in any direction. Fitted on the training split. */
  consistencyMin: number;
  /** The factor by which the drag term may change across a step before the change is read as evidence of a breakup (the area over the mass changed) on a manoeuvring object; its inverse bounds a fall. Fitted on the training split; set at a million where the sweep found it only costs false alarms, which a few steps over the Archive still reach (`parameter-audit.md`), so it is a live threshold, not `OFF`. */
  bstarRatioMax: number;
  /** The inclination step below which no normal component is read, in degrees: the format prints four decimals, and the fits scatter by tens of them. Physical. */
  inclinationStepMinDeg: number;
  /** How many post sets an alert keeps reading after it was raised, so the sweeps can re-threshold the persistence tiers offline: enough sets for a week of a low orbit's cadence. Policy. */
  alertMaxPostSets: number;
  /** The persistence tiers the alert records for the sweeps: after this many post sets, and after these many days of span, whether the step still held. Policy: the tiers the owner asked to see. */
  tierSets: number[];
  tierDays: number[];
  /** The days after the step over which the tracking cadence is counted (a breakup is re-observed: more sets a day) against the days before. Policy: three days against thirty. */
  cadenceAfterDays: number;
  cadenceBeforeDays: number;
  /** How long an alert stays open for the fragments or a notice to confirm it, in days, after which it expires. Policy: thirty days, the window the truth's own burst rule counts pieces in. */
  alertTtlDays: number;
  /** The sliding window over which a launch's new bodies are counted for a burst, in days, and the span before it that gives the launch's own background rate. Policy: fourteen days, long enough for the catalogue to list a cloud's first pieces, against the year before. */
  burstWindowDays: number;
  burstBackgroundDays: number;
  /** The least expected count of new bodies in the window, so a launch that gained nothing in a year is not read as bursting on two bodies by a zero rate. Fitted on the training split. */
  lambdaFloor: number;
  /** The Poisson tail probability at or under which the window's count is a burst over the launch's own background; a burst also needs at least `burstMinBodies` new bodies. Fitted on the training split. */
  pBurst: number;
  burstMinBodies: number;
  /** The plane test's tolerances: the inclination difference and the node difference adjusted for each orbit's own J2 precession, in degrees, that count as one unit of distance, and the distance at or under which a piece shares the parent's plane. Fitted on the training split from the planes of catalogued fragments. */
  planeInclinationToleranceDeg: number;
  planeNodeToleranceDeg: number;
  planeDistanceMax: number;
  /** The angle between a piece's orbit normal and the parent's, in degrees, at or under which the piece shares the parent's plane whatever its distance in the tolerances: the plane test is the distance within `planeDistanceMax` or the normals within this angle. The node is undefined at near-zero inclination, where a parent's pieces scatter over the whole circle of nodes and fail the node tolerance while their normals all lie near the pole. Zero turns it off. Fitted on the training split. */
  planeNormalAngleMaxDeg: number;
  /** How far ahead of its first set a piece's node may be propagated with the J2 rate before the test is not made, in days: a piece catalogued a season after the event has drifted by what drag and the rate's own error allow. Policy: 180 days. */
  planeMaxDays: number;
  /** The cloud velocity (the median of the consistent pieces' change of semi-major axis from the parent's, as a tangential impulse) under which payload-classed new bodies are a deployment, not fragments, in metres a second. Physical: a dispenser pushes a satellite off at under a metre a second. */
  deploymentDeltaVMps: number;
  /** A launch younger than this, in days from its first body's first set, needs a cloud velocity of at least `youngLaunchDeltaVMps` before its new bodies count as fragments, whatever class the catalogue gives them: the first weeks of a launch catalogue its own objects, platforms and covers classed as debris among them. Policy: thirty days; the velocity bound was fitted on the training split, where the class alone let the launch's own objects through. */
  youngLaunchDays: number;
  youngLaunchDeltaVMps: number;
  /** The least cloud velocity, in metres a second, for a cloud with no parent step to be listed for review: below it the new bodies are a deployment or the catalogue's own backlog. Fitted on the training split. */
  cloudOnlyDeltaVMinMps: number;
  /** The most new bodies per window a launch may have gained in the year before for its pieces to confirm a parent's step: an old cloud still being catalogued lists pieces in the parent's plane for years, and any later step on the parent would be confirmed by them. A launch younger than `youngLaunchDays` never confirms by pieces either, its first weeks' debris-classed objects being its own. Fitted on the training split. */
  confirmBackgroundMax: number;
  /** The least cloud velocity of the pieces that confirm an alert, in metres a second, whatever their class: the review list's floor applied to the confirmation, since bodies in the parent's own orbit at a tenth of a metre a second are the catalogue's re-designations or a release, not fragments. Zero turns the rule off. Fitted on the training split. */
  confirmDeltaVMinMps: number;
  /** How long a launch remembers a cloud, in days: after a burst with consistent pieces, or a confirmation by pieces, a later alert under the launch is confirmed only by pieces that lie in the alerted parent's plane and out of the remembered cloud's, and not at all where the parent itself lies in that cloud's plane, since a cloud is catalogued in batches for months and every batch would otherwise confirm the next step on any body of the launch. Policy: a year, the truth's own rule for one cloud catalogued in batches. Zero turns the rule off. */
  cloudMemoryDays: number;
  /** A debris-classed parent first catalogued under its launch less than this many days before its step is a fresh piece of the launch's own cloud, whose siblings would confirm its settling fit: it is confirmed by nothing. Policy, with the training split's evidence: ninety days, the age under which an object's record is unknown. Zero turns the rule off. */
  freshPieceDays: number;
  /** Whether a debris-classed parent under a launch with an active cloud (fragment-classed bodies first seen in the year before) is confirmed only by pieces nearer its plane than the nearest of the cloud's bodies is. Fitted on the training split. */
  debrisParentNeedsNearerThanCloud: boolean;
  /** Whether a single piece confirms only a parent that is not debris-classed, under a launch that gained no new body in the year before and none other in the window: one piece means something only where nothing else is being catalogued. Fitted on the training split. */
  singlePieceNeedsQuietLaunch: boolean;
  /** How long a launch's cloud, once listed for review, is not listed again as its pieces keep coming, in days. Policy: the alert's time to live. */
  cloudRepeatDays: number;
  /**
   * The Confirmed channel's attribution (`judgeLaunches` in `run.ts`): fresh
   * pieces in the plane of a body of their launch with no open alert are
   * attributed to it as a confirmed breakup, whether or not a step was seen
   * on it, under the confirmation rules above and these. Whether it runs at
   * all; off, a burst with no alert on any parent is only listed for review
   * as before. Policy: the owner's decision of 2026-10-10, the seventh decision record.
   */
  attributionEnabled: boolean;
  /** The most fragment-classed bodies a launch may have had before the window for them to be candidate parents of an attribution: a fairing cover or a tank breaks up too, but under a launch with a cloud of its own every old piece would be a candidate. They are tried only for pieces in the plane of no other body of the launch. Zero turns them off. Fitted on the training split. */
  attributionDebrisParentsMax: number;
  /** The most launches older than a year the run may have brought new bodies to for an attribution to stand: on the days the catalogue lists a batch of old objects it lists them under many old launches at once, and a stray among them in a parent's plane is no breakup. A value beyond reach turns the rule off. Fitted on the training split. */
  attributionBatchLaunchesMax: number;
  /** The fewest pieces, after the confirmation rules have left out the ones they refuse, an attribution needs. Fitted on the training split. */
  attributionMinPieces: number;
  /** How long, in days, a burst under the launch that no parent was named for keeps the attribution from reading the launch's cloud memory: within it, the memory the attribution reads is the last cloud named, so a cloud whose first batch could not be attributed (a young launch's, an ambiguous one) can be attributed by its later batches. Fitted on the training split. */
  attributionUnnamedGraceDays: number;
  /** Whether, where the pieces converge on two bodies of the launch alike (an ullage motor and its twin, a stage and its payload), the one that made a persistent step in the search window, the others none, is named: the step seen on the parent breaks the tie. Fitted on the training split. */
  attributionStepBreaksTies: boolean;
  /** How far back before the first piece's first set the event's instant is searched, in days, and the coarse grid's step there, in minutes. Policy: the Confirmed line's 180 days, the longest the catalogue may take to list an event's first piece and still count it; an hour, which the angle's drift and its once-a-revolution wobble allow (the refinement is on the event-time grid). */
  attributionSearchDays: number;
  attributionGridMinutes: number;
  /** The most pieces the timing propagates, the earliest first sets first, and the most candidate parents it times against each other. Policy: the cost of one attribution. */
  attributionMaxPieces: number;
  attributionMaxCandidates: number;
  /** The shorter search windows tried, in days, where the pieces cannot be propagated over the whole one (`attributionSearchDays`): a high-drag piece's set fails far from its epoch. Policy. */
  attributionFallbackSearchDays: number[];
  /** How long after a launch was first seen its debris-classed bodies are its own launch-era objects (covers, fairings, tanks, adapters) rather than a later cloud's, in days, as candidate parents of the debris path. Policy: a season, the time the catalogue takes to list a launch's own objects. */
  launchEraDays: number;
  /** Where the pieces lie within the plane bound of more than one candidate parent, the factor by which the next parent's miss must exceed the best one's for the best to be named; otherwise the cloud stays for review. Fitted on the training split. */
  attributionAmbiguityRatio: number;
  /** The same for the centre of the pieces' semi-major axes: the body named is the one they centre on, and it is told from the others where the nearest other body's offset from that centre is at least this factor times its own, its own floored at `attributionCentreFloorKm` (a cloud's centre is known to a kilometre or two, the spread of its first sets). Fitted on the training split; the floor is policy. */
  attributionCentreRatio: number;
  attributionCentreFloorKm: number;
  /**
   * Whether an attribution whose pieces cannot be told from two bodies of
   * the launch or more (a body of the same plane whose offset from the
   * pieces' centre and whose miss when propagated back are both within the
   * ratios above of the named body's) is raised naming the launch and every
   * such body as its candidates, rather than refused: twin ullage motors, a
   * stage and its payload in the days after launch, a fairing and its
   * siblings leave pieces nothing public assigns to one of them. The body
   * the verdict names first is the one the centre, or a persistent step it
   * alone made, picks. The scorecard reads such a verdict at the launch's
   * level only behind its own switch (`matchTwinsAtLaunch`), the owner's
   * call. Policy: the owner's decision of the tenth phase.
   */
  attributionTwins: boolean;
  /**
   * The common origin as an override: where at least
   * `originOverrideMinPieces` pieces cross the parent and three quarters
   * of them within `originOverrideHours` of their median, the pieces were
   * made at one instant, so the rules that read a launch's history as an
   * old cloud (its remembered cloud, its backlog, a cataloguing batch the
   * run lists it in) do not refuse them: those rules guard against old
   * pieces, and these are not old. A young launch's rule stands: its own
   * objects leave it at one instant too, its separations. A value beyond reach turns
   * the override off. Fitted on the training split (`d10-confirmed.md`).
   */
  originOverrideHours: number;
  originOverrideMinPieces: number;
  /** The fewest days after the launch was first seen the pieces' median crossing may lie: pieces whose common origin is the launch itself (or before it, where the propagation back fails) are its own objects catalogued late, a deployment's debris, not a breakup. Minus a value beyond reach turns the rule off. Fitted on the training split (`d10-confirmed.md`). */
  originLaunchMarginDays: number;
  /** Whether the pieces' median crossing is the confirmed event's instant where its sigma is under the convergence's: the pieces' own closest approaches agree more finely than their common miss does when a cloud's first sets are weeks old. Policy. */
  originEventTime: boolean;
  /** The launches of the crewed stations, by designator: what a station sheds (tools, covers, tanks, bags) is released on purpose and catalogued as debris under its launch, so its pieces confirm nothing and attribute nothing. Policy, from the satellite catalogue's names: the stations in orbit since the Archive's first year, the bodies it names ISS, TIANGONG and CSS, each by the launch of its own designator (the International Space Station's Zarya, Unity, Zvezda, Destiny, Poisk and Nauka; Tiangong-1 and -2; the Chinese station's Tianhe, Wentian and Mengtian). */
  stationLaunches: string[];
  /** The launches of the crewed spacecraft and of the stations' cargo craft in orbit since 2005, by designator (`src/visiting.ts`, generated from the satellite catalogue's names by `npm run archive:visiting`): Soyuz, Shenzhou, the Space Shuttle, the crewed Dragons, Starliner, Progress, Tianzhou, the cargo Dragons, Cygnus, HTV and the ATV. What such a craft leaves in orbit (an orbital module and covers at the end of a mission, a trunk, lost tools, jettisoned items) is released on purpose and catalogued as debris under its launch, so its pieces confirm and attribute nothing, as a station's; the launch's rocket body is an ordinary stage, and its pieces are judged as any stage's. Policy: the owner's decision for the eleventh phase. */
  visitingLaunches: string[];
  /** Whether pieces first seen after their parent reentered (its decay day, as the catalogue publishes it, on or before the pieces' earliest first set plus `reentryAfterPiecesDays`, and already published by the run) confirm and attribute nothing: they are the reentry's debris, a capsule or an aerodynamic breakup's, not a breakup in orbit. The decay is read only once its day has come, so the rule needs nothing a live run would not have. Physical; the days are fitted on the training split (`d11-confirmed.md`). */
  reentryRefuses: boolean;
  reentryAfterPiecesDays: number;
  /** The factor within which a rocket body's offset from the pieces' centre may be of the named body's for the stage to be named instead (`attributionPrefersStageOverWorking`, and the legacy `attributionPrefersStage`), floored at `attributionCentreFloorKm`. Fitted on the training split (`d11-confirmed.md`, `d12-confirmed.md`). */
  attributionPreferCentreRatio: number;
  /**
   * The stage preferred over an operating payload, the narrower form of
   * `attributionPrefersStage`, which leaves every other tie as the centre
   * of the pieces or a step resolves it: where the pieces of an attribution
   * share the plane of a rocket body of the launch and the body their
   * centre named is a payload operating at the time (by its dated status),
   * and the rocket body's offset from their centre is within
   * `attributionPreferCentreRatio` of the payload's, the rocket body is
   * named, unless the payload alone made a persistent step in the search
   * window; and among twins no step tells apart, a rocket body is named
   * before payloads that were all operating. A working payload is
   * commanded and watched by its owner, and of the payload breakups the
   * truth holds since 2005 few were on one operating at the time
   * (`d11-confirmed.md`), so where the pieces cannot tell a launch's stage
   * from its working payload the stage is the likelier parent. Read only
   * where `attributionPrefersStage` is off. Fitted on the training split
   * (`d12-confirmed.md`).
   */
  attributionPrefersStageOverWorking: boolean;
  /** A small batch: an attribution, or a confirmation of an alert on the parent's step, resting on at least `smallBatchMinPieces` and at most `smallBatchMaxPieces` pieces needs them to share a tight common origin: at least two of them crossing the parent in the window, and `smallBatchOriginShare` of them (a half or three quarters) within `smallBatchOriginHours` of their median crossing. A handful of pieces under an old launch is as often the cataloguing of an old cloud as a new event, and a new event's pieces were made at one instant. A value of the hours beyond reach turns the rule off. Fitted on the training split (`d11-confirmed.md`). */
  smallBatchMinPieces: number;
  smallBatchMaxPieces: number;
  smallBatchOriginShare: number;
  smallBatchOriginHours: number;
  /** The tolerance by which a step's post-step level may miss a range the object held in the last year and still be a return to a held altitude (orbit maintenance): the larger of this many times the object's own scatter and this many kilometres; a negative floor turns the test off. Fitted on the training split by sweeping the log. */
  maintenanceToleranceSigmas: number;
  maintenanceToleranceKm: number;
  /** How many calendar months back the envelope of held altitudes is read, at most the twelve it keeps. Policy: a year. */
  maintenanceMonths: number;
  /** Whether a lowering back to a level the object held is read as maintenance too, as a raise back to one is. Fitted on the training split. */
  maintenanceLoweringsToo: boolean;
  /** The window before a step within which other objects' steps count as its siblings, in days; the factor within which two steps' sizes are alike; and the fewest siblings (launch-mates and shell-mates together) for the step to be a coordinated manoeuvre. Policy for the window and the factor (a campaign's steps come within a fortnight at about the same size); the count fitted on the training split. */
  siblingWindowDays: number;
  siblingSizeFactor: number;
  siblingsMin: number;
  /** The shell: another launch's object is in the same shell when its inclination is within this many degrees and its semi-major axis within this many kilometres. Policy: a tenth of a degree, a constellation's shells are tens of kilometres apart. */
  siblingOrbitInclinationDeg: number;
  siblingOrbitAltitudeKm: number;
  /** An object younger than this, in days from its first set, is deploying when it climbs towards the median altitude of its launch's other payloads. Fitted on the training split. */
  deployAgeDays: number;
  /** Whether the catalogue's operational status is read as evidence: a step on an object working today needs a breakup signature to be raised, a step on one nonoperational today needs no manoeuvre explanation. The status is the snapshot's, today's, so a backtest carries hindsight; off, the detector reads none of it. Policy, with the training split's evidence and the scorecard run both ways. */
  opsStatusEvidence: boolean;
  /** Whether the status is read as of the step rather than as of today (`operationalAt` in `elements.ts`): where the caller gives the window the object's end of contact falls in (GCAT's end of transmission: after it the satellite cannot have been commanded), a satellite in contact until more than `endedUnknownDays` after the step could have burned at it, one silent from more than that before it was dead, and one within that margin of its end says nothing; where no end is dated, only a working status today is read (a satellite working today was working at the step), the rest as nothing. Off, today's status is read for every step. Policy: the dated reading removes the hindsight the fifth decision record states, and the seventh phase's scorecard runs it beside today's status and none. */
  opsStatusDated: boolean;
  /** The days either side of a dated end of contact within which a step reads the status as nothing: the end of a satellite that broke up is often set by the breakup itself (GCAT dates Hitomi's to the day of its breakup and Orbcomm FM16's to the month), so an end that close may be the event's consequence rather than a status it had, and a working satellite's last month may hold its disposal. Policy: thirty days, the alert's time to live. */
  endedUnknownDays: number;
  /** Whether a nonoperational status voids the manoeuvre explanations that are not the object's own record (maintenance, siblings, deployment): the record is contemporaneous evidence that the object was moving itself then, the status is today's. Fitted on the training split. */
  nonoperationalOverrides: boolean;
  /** The least radial component, in metres a second, for the geometry test (the eccentricity change beyond a tangential impulse's reach) to override a manoeuvre explanation: a small radial residue is what two burns half an orbit apart or a low-thrust arc leaves, a large one is a kick. Fitted on the training split. */
  geometryKickMinMps: number;
  /** How many explanations independent of the object's record (maintenance, siblings, deployment, the working status) outweigh the record's own breakup signatures (the size, the direction, the geometry, the drag term, the move against drag); the nonoperational signature is never outweighed. A value beyond reach lets any signature override every explanation. Fitted on the training split. */
  independentOutweighs: number;
  /** Whether the manoeuvre explanations that are not the record (maintenance, siblings, deployment, the working status) apply to objects the catalogue does not class as payloads: a stage or a fragment does not maintain its orbit. Fitted on the training split. */
  explanationsForNonPayloads: boolean;
  /** The days after the step over which the object's one-step-ahead residual scatter is read for damage (tumbling or a changed shape), against its scatter before the step: from this many days to this many. Policy: the second to fourth week, once the post-step fit has settled and before the alert's time to live. */
  damageFromDays: number;
  damageToDays: number;
  /** The most residuals the damage reading keeps, and the fewest it rests on. Policy: the ring's size; four, the least a robust scale means anything with. */
  damageMaxResiduals: number;
  damageMinResiduals: number;
  /** The scoped line (`scope.ts`): the population of parents it speaks for, as a predicate on the parent at the step, the gates a raised step on one must pass beyond the whole-catalogue line's, and the persistence tier the step must still hold at before the scoped line raises it. Every raised step carries whether its parent was in the scope and whether it passed the gates, and the scorecard scores the scoped line on the reported events in the scope and the alerts in it, the excluded share stated. Fitted on the training split: `d7-scope.md` records the hypotheses, the frontier and the choice. */
  scope: ScopeParameters;
  /** The event-time search: the grid step in seconds, how many hours before the pre set's epoch the grid starts, and the position error of a published set, in kilometres, that divides the along-track slope for the time's sigma. Physical: a minute resolves an event to its revolution; a mean element set places an object to about a kilometre in low orbit. */
  eventGridSeconds: number;
  eventLeadHours: number;
  eventSigmaPositionKm: number;
  /** The most grid points the event-time search spends on one alert, beyond which the grid step is widened: a highly elliptical object with sets seventeen days apart would otherwise cost fifty thousand propagations. Policy. */
  eventMaxPoints: number;
  /** The most crossings the pieces' event-time search refines on the fine grid (the best few by the coarse cost, or a single piece's last laps), and the least half-width of each refinement, in minutes. Policy: the cost of one attribution; half an hour, at least the coarse grid's step. */
  eventRefinedCrossings: number;
  eventRefineReachMinutes: number;
  /** The options a phase built and left off by default (`LegacyParameters`): kept so a replay can turn one on, apart from the parameters the detector runs with. */
  legacy: LegacyParameters;
}

/**
 * The options a phase built, swept on the training split and left off by
 * default: each switch false, each threshold at `OFF`, the origin gate's
 * settings read only with its base on. None of them acts on a verdict at
 * these values; they are kept so a replay can turn one on
 * (`--param legacy.name=value`, or the bare name), and apart from the
 * parameters the detector runs with, so those count what is on.
 */
export interface LegacyParameters {
  /** Whether a set opens a candidate on the largest of its three normalised residuals (the semi-major axis, the perigee radius and the inclination, each against its trailing fit at the set before, the latter two's scales grown by the semi-major axis's own factor) rather than on the semi-major axis's alone, the candidate then judged for persistence on the quantity that opened it. A breakup whose recoil on the parent is mostly radial or normal changes the orbit's shape or plane at constant period and leaves the semi-major axis alone. Fitted on the training split, by a criterion written before the replay: on, the training years' early warnings gained one headline detection for seventeen times the false alarms. */
  openOnThreeAxes: boolean;
  /** Whether a persistent step on an object the catalogue does not class as a payload (a rocket body, a piece of debris, an unknown) is raised when its record classes it `occasional`, a past step within two years on no pattern: a stage does not manoeuvre, so its past "step" was the catalogue's fit absorbing something, not a burn. Fitted on the training split. */
  occasionalRaisesNonPayload: boolean;
  /** Whether the persistence size is judged on the fitted line's value at the centroid of the post sets (the weighted mean step, `zMean`) rather than on its level at the first post set (`z`): the catalogue's fit converges on a new orbit over several sets, so the first post set can carry a tenth of the step and the level under-reads it while the mean does not; the evidence against a drift still guards a ramp drag could produce. Fitted on the training split. */
  persistOnMeanStep: boolean;
  /** Whether a launch younger than `youngLaunchDays` may attribute its fresh pieces (those `judgeCloud` keeps there, at the young launch's velocity or more): a stage breaking up days after launch leaves pieces among the launch's own objects. Fitted on the training split. */
  attributionYoungLaunch: boolean;
  /** The most the pieces may miss the parent at the instant of their back-propagated crossing, as a root-mean-square distance in kilometres, for the attribution to stand: pieces that do not converge on the parent are not its. A value beyond reach (a finite one, so the scorecard's record of the parameters keeps it) turns the test off. Fitted on the training split. */
  attributionMissKmMax: number;
  /** Whether twins nothing tells apart (none of them made a persistent step in the window) are raised naming them all, or refused as the ninth phase refused them, the cloud left for review; where a step picks one, the verdict names it first and the others beside it either way. Fitted on the training split (`d10-confirmed.md`). */
  attributionTwinsUnresolved: boolean;
  /**
   * The common-origin test (`passesOrigin` in `event-time.ts`): every piece
   * of a cloud judged, propagated back with its first set against the
   * parent's last set before the cloud, crosses the parent closest at one
   * instant; a breakup's pieces at nearly one instant, an old cloud's late
   * pieces at instants months apart or not at all. A cloud of at least
   * `originMinPieces` pieces passes where `originShareMin` of them crossed
   * within `originHoursBase` plus `originHoursPerDay` times the pieces' age
   * of their median crossing. A base beyond reach turns the test off.
   * Fitted on the training split (`d10-confirmed.md`).
   */
  originHoursBase: number;
  originHoursPerDay: number;
  originShareMin: number;
  originMinPieces: number;
  /** The same share of the pieces must have crossed within this share of their own lap about the parent of the median (the chance level of unrelated phases is a quarter); a value beyond reach turns the bound off. Fitted on the training split (`d10-confirmed.md`). */
  originPhaseMax: number;
  /** On the confirmation of an alert on the parent's step, the most hours the pieces' median crossing may lie from the step's instant: a breakup's pieces cross the parent at its step, pieces crossing it elsewhere are not the step's. A value beyond reach turns the rule off. Fitted on the training split (`d10-confirmed.md`). */
  originStepHoursMax: number;
  /**
   * The stage preferred over its payload: where the pieces of an
   * attribution share the plane of a body of the launch of a better rank
   * than the one the centre of their semi-major axes named (a rocket body
   * before any other; a body not operating at the time before a payload
   * operating at it) and its offset from their centre is within this
   * factor of the named body's (floored at `attributionCentreFloorKm`), the
   * pieces' plane and period cannot tell the two apart, and the body of the
   * better rank is named, unless the named body alone made a persistent
   * step in the search window. The same rank breaks a tie between twins
   * no step tells apart, where one has a better rank than every other. A
   * rocket body in orbit since 2005 has had a reported breakup three to six
   * times as often as a payload (`d11-confirmed.md`). Off where
   * `attributionPrefersStage` is false; the factor is fitted on the
   * training split.
   */
  attributionPrefersStage: boolean;
  /** Whether the body an attribution names is the one the pieces converge on, propagated back, where they converge on it better by `attributionAmbiguityRatio` than on the body the centre of their semi-major axes names: a breakup's pieces left their parent's place at one instant, and the centre of their axes is the weaker cue where two bodies of the launch share their plane (a twin ullage motor named for its sibling's pieces). Fitted on the training split (`d11-confirmed.md`). */
  attributionConvergenceNames: boolean;
  /** Whether the small-batch rule reads the confirmations of an alert on the parent's step too, or the attributions alone: a step seen on the parent dates an event of its own, which an attribution, resting on the pieces alone, has not. Fitted on the training split (`d11-confirmed.md`). */
  smallBatchStepsToo: boolean;
  /** Whether a burst in an analyst range (no designator, numbers reused) may confirm an open alert where the plane test names that alert's parent alone among the open alerts and the pieces converge on it. Fitted on the training split. */
  analystAttributes: boolean;
  /** The fewest past raises for a lowering on an object whose record holds nothing but raises, and whose step is not disposal-shaped, to be the breakup pattern (a move against drag that no make-up burn makes): zero reads a lowering with no record as the pattern too; a value beyond reach turns the test off. Fitted on the training split. */
  againstDragMinRaises: number;
}

export const DETECTOR_PARAMETERS: DetectorParameters = {
  ringSize: 32,
  windowSets: { LEO: 16, MEO: 16, HEO: 32, GEO: 16 },
  windowMaxDays: { LEO: 30, MEO: 30, HEO: 60, GEO: 60 },
  quadraticMinSets: 6,
  quadraticMinDays: 3,
  linearMinSets: 3,
  huberConstant: 1.345,
  residualsForScatter: 8,
  longHalfLifeDays: 180,
  longMemoryClipSigmas: 3,
  sigmaPrior: { LEO: 0.03, MEO: 0.05, HEO: 0.5, GEO: 0.2 },
  sigmaPriorBstar: 1e-4,
  kappa: { LEO: 100, MEO: 100, HEO: 100, GEO: 100 },
  leoBandKm: 50,
  fluxScatter: [
    [80, 0.68],
    [100, 0.95],
    [130, 1.21],
    [160, 1.68],
    [200, 2.29],
    [OFF, 3.8],
  ],
  apScatter: { quiet: 0.67, storm: 1.79, quietAp: 5, stormAp: 100 },
  slopePriorSigmas: 3,
  commonModeMinBstar: 1e-5,
  bandMinMembers: 30,
  bandScaleFloor: 1,
  zCand: 6,
  zPersist: 10,
  rhoRevert: 0.5,
  rhoMin: 0.5,
  rhoMax: 100,
  evidenceMin: 10,
  persistMinSets: 2,
  persistMinSpanHours: { LEO: 18, MEO: 18, HEO: 6, GEO: 6 },
  persistMinSetsAlone: 3,
  persistMinSetsUnderStress: 3,
  maxPostSets: 8,
  quietAfterCloseDays: 30,
  quietAfterRaiseDays: 365,
  lapseDays: { LEO: 5, MEO: 10, HEO: 20, GEO: 15 },
  stormKp: 6,
  stressCandidatesPerDay: 10,
  cusumDrift: 0.5,
  hCusum: 12,
  foreignDeltaAKm: 50,
  foreignDeltaIncDeg: 0.5,
  foreignRaanDeg: 5,
  junkMeanMotionDot: -1e-4,
  historyDays: 730,
  historyMaxSteps: 64,
  newObjectDays: 90,
  stationKeepingMinSteps: 4,
  regularityMax: 0.75,
  alternationMin: 0.5,
  monotoneShareMin: 0.8,
  stationKeepingWindowDays: 365,
  disposalPerigeeDropKm: 20,
  disposalRaiseLeoKm: 50,
  disposalRaiseGeoKm: 200,
  typicalityMax: 10,
  oppositeMinSteps: 2,
  consistencyMin: 100,
  bstarRatioMax: 1e6,
  inclinationStepMinDeg: 0.01,
  alertMaxPostSets: 24,
  tierSets: [3, 5],
  tierDays: [1, 3, 5, 7],
  cadenceAfterDays: 3,
  cadenceBeforeDays: 30,
  alertTtlDays: 30,
  burstWindowDays: 14,
  burstBackgroundDays: 365,
  lambdaFloor: 0.5,
  pBurst: 0.001,
  burstMinBodies: 2,
  planeInclinationToleranceDeg: 0.2,
  planeNodeToleranceDeg: 1.5,
  planeDistanceMax: 3,
  planeNormalAngleMaxDeg: 1,
  planeMaxDays: 180,
  deploymentDeltaVMps: 1,
  youngLaunchDays: 30,
  youngLaunchDeltaVMps: 5,
  cloudOnlyDeltaVMinMps: 1,
  confirmBackgroundMax: 2,
  confirmDeltaVMinMps: 1,
  cloudMemoryDays: 365,
  freshPieceDays: 90,
  debrisParentNeedsNearerThanCloud: true,
  singlePieceNeedsQuietLaunch: true,
  cloudRepeatDays: 30,
  attributionEnabled: true,
  attributionDebrisParentsMax: 30,
  attributionBatchLaunchesMax: 2,
  attributionMinPieces: 3,
  attributionStepBreaksTies: true,
  attributionUnnamedGraceDays: 180,
  attributionSearchDays: 180,
  attributionGridMinutes: 60,
  attributionMaxPieces: 8,
  attributionMaxCandidates: 4,
  attributionFallbackSearchDays: [60, 20],
  launchEraDays: 90,
  attributionAmbiguityRatio: 3,
  attributionCentreRatio: 3,
  attributionCentreFloorKm: 2,
  attributionTwins: true,
  originOverrideHours: 1,
  originOverrideMinPieces: 3,
  originLaunchMarginDays: 0,
  originEventTime: true,
  stationLaunches: ["1998-067", "1998-069", "2000-037", "2001-006", "2009-060", "2021-066", "2011-053", "2016-057", "2021-035", "2022-085", "2022-143"],
  visitingLaunches: [...VISITING_LAUNCHES],
  reentryRefuses: true,
  reentryAfterPiecesDays: 0,
  attributionPreferCentreRatio: 3,
  attributionPrefersStageOverWorking: true,
  smallBatchMinPieces: 3,
  smallBatchMaxPieces: 4,
  smallBatchOriginShare: 0.75,
  smallBatchOriginHours: 48,
  maintenanceToleranceSigmas: 3,
  maintenanceToleranceKm: 1,
  maintenanceMonths: 12,
  maintenanceLoweringsToo: true,
  siblingWindowDays: 14,
  siblingSizeFactor: 2,
  siblingsMin: 2,
  siblingOrbitInclinationDeg: 0.1,
  siblingOrbitAltitudeKm: 50,
  deployAgeDays: 180,
  opsStatusEvidence: true,
  opsStatusDated: true,
  endedUnknownDays: 30,
  nonoperationalOverrides: true,
  geometryKickMinMps: 0,
  independentOutweighs: 1,
  explanationsForNonPayloads: true,
  damageFromDays: 14,
  damageToDays: 28,
  damageMaxResiduals: 32,
  damageMinResiduals: 4,
  scope: { policy: { ...WHOLE_CATALOGUE, minAgeDays: 1825 }, gates: { ...OPEN_GATES, zMin: 20, deltaVMinMps: 0.03, bstarRatioMin: 2, consistencyMin: 100 }, tier: "D7" },
  eventGridSeconds: 60,
  eventLeadHours: 6,
  eventSigmaPositionKm: 1,
  eventMaxPoints: 4000,
  eventRefinedCrossings: 8,
  eventRefineReachMinutes: 30,
  legacy: {
    openOnThreeAxes: false,
    occasionalRaisesNonPayload: false,
    persistOnMeanStep: false,
    againstDragMinRaises: OFF,
    analystAttributes: false,
    attributionYoungLaunch: false,
    attributionMissKmMax: OFF,
    attributionTwinsUnresolved: false,
    originHoursBase: OFF,
    originHoursPerDay: 0,
    originShareMin: 0.5,
    originMinPieces: 2,
    originPhaseMax: OFF,
    originStepHoursMax: OFF,
    attributionPrefersStage: false,
    attributionConvergenceNames: false,
    smallBatchStepsToo: false,
  },
};

/** What a caller may override: any parameter, the legacy block's options in the block or by their bare names. */
export type ParameterOverrides = Partial<Omit<DetectorParameters, "legacy">> & Partial<LegacyParameters> & { legacy?: Partial<LegacyParameters> };

/**
 * The parameters with a caller's overrides laid over the defaults, one
 * level deep so a per-regime table can be overridden whole, and the legacy
 * block option by option. An option given by its bare name (a record of
 * the parameters written before the block, or `--param name=value`) lands
 * in the block.
 */
export function parametersWith(overrides: ParameterOverrides | undefined): DetectorParameters {
  if (overrides === undefined) return DETECTOR_PARAMETERS;
  const live: Record<string, unknown> = {};
  const legacy: Record<string, unknown> = { ...DETECTOR_PARAMETERS.legacy, ...overrides.legacy };
  for (const [name, value] of Object.entries(overrides)) {
    if (name === "legacy") continue;
    if (name in DETECTOR_PARAMETERS.legacy) legacy[name] = value;
    else live[name] = value;
  }
  return { ...DETECTOR_PARAMETERS, ...live, legacy: legacy as unknown as LegacyParameters };
}

/** Where a parameter's value comes from: a constant of the orbit or the format, a choice about the product, or a fit on the training split. */
export type ParameterKind = "physical" | "policy" | "fitted";

export interface Provenance {
  kind: ParameterKind;
  /** The fitting note that records the choice and the table or section in it; for a physical constant, what it is a constant of; for a policy, the decision it rests on. */
  source: string;
}

/** One provenance per parameter, the legacy block's options in a block of their own. */
export type ParameterProvenance = Record<Exclude<keyof DetectorParameters, "legacy">, Provenance> & { legacy: Record<keyof LegacyParameters, Provenance> };

/**
 * Every parameter's kind and the sweep or decision that chose it, one
 * entry per key of `DetectorParameters` and of its legacy block (the type
 * enforces it), so the
 * freeze is a table a reader can check and a test can hold: a fitted
 * value names the note and the table it was read off, a policy names
 * what it rests on, a physical constant what it is.
 */
export const PARAMETER_PROVENANCE: ParameterProvenance = {
  ringSize: { kind: "policy", source: "the window plus the post gaps with room for re-published sets, about two kilobytes an object" },
  windowSets: { kind: "policy", source: "a week to a month of sets in low orbit; the whole ring in highly elliptical orbit for the lunisolar baseline" },
  windowMaxDays: { kind: "policy", source: "an object silent for a season is fitted on its recent sets" },
  quadraticMinSets: { kind: "policy", source: "six sets over three days is the least that resolves a curvature from noise" },
  quadraticMinDays: { kind: "policy", source: "as quadraticMinSets" },
  linearMinSets: { kind: "policy", source: "under three sets the single set's own drag rate is extrapolated" },
  huberConstant: { kind: "physical", source: "the textbook constant for 95% efficiency at the Gaussian" },
  residualsForScatter: { kind: "policy", source: "a median absolute deviation needs eight residuals to be robust with" },
  longHalfLifeDays: { kind: "policy", source: "half a year spans a storm season" },
  longMemoryClipSigmas: { kind: "policy", source: "three times the scatter, so one step does not become the object's noise" },
  sigmaPrior: { kind: "fitted", source: "d1-fitting.md, the prior scatter: set from the measured scatter by regime on the training years, nothing to sweep against" },
  sigmaPriorBstar: { kind: "fitted", source: "d1-fitting.md, the prior scatter: its knee in the drag term" },
  kappa: { kind: "fitted", source: "d1-fitting.md, the drag term kappa table: the last value losing nothing" },
  leoBandKm: { kind: "policy", source: "fifty kilometres of perigee height, where drag changes by orders of magnitude over a few hundred" },
  fluxScatter: { kind: "fitted", source: "the earlier attempt's measurement over seven hundred and fifty objects: the normalised monthly scatter by flux band (not fitted on this project's training split)" },
  apScatter: { kind: "fitted", source: "the earlier attempt's measurement, as fluxScatter: 0.67 at Ap 5 to 1.79 at Ap 100 (not fitted on this project's training split)" },
  slopePriorSigmas: { kind: "policy", source: "what noise and drag do to the orbit in a day" },
  commonModeMinBstar: { kind: "physical", source: "below it drag does not move the orbit measurably over a gap" },
  bandMinMembers: { kind: "policy", source: "thirty residuals for a band's own common mode and scale" },
  bandScaleFloor: { kind: "policy", source: "a calm band never makes a step look larger than the object's own scatter says" },
  zCand: { kind: "fitted", source: "d1-fitting.md, the candidate threshold: the smallest first set that hit a training event is 6.3 sigma" },
  zPersist: { kind: "fitted", source: "d1-fitting.md, the zPersist table: hits flat to 10, falling from 12" },
  rhoRevert: { kind: "policy", source: "the earlier attempt's evidence: a bad set is undone by the next, a real step is kept" },
  rhoMin: { kind: "fitted", source: "d1-fitting.md, the ratio's lower bound: 0.5 keeps Yaogan 1" },
  rhoMax: { kind: "fitted", source: "d1-fitting.md, the ratio's upper bound: a bound of 2 loses COBE R/B's ramp" },
  evidenceMin: { kind: "fitted", source: "d1-fitting.md, the evidence against a drift: no hit lost, 7% fewer alarms at 10" },
  persistMinSets: { kind: "policy", source: "the owner's clock: one set cannot raise an alert" },
  persistMinSpanHours: { kind: "fitted", source: "d1-fitting.md, the span two post sets must cover: 18 h loses nothing in low orbit; six hours above it where sets are sparse" },
  persistMinSetsAlone: { kind: "policy", source: "three sets whatever they span" },
  persistMinSetsUnderStress: { kind: "policy", source: "three post sets under a storm hold or run stress" },
  maxPostSets: { kind: "policy", source: "eight gaps, after which an unraised candidate is noise or a slope change" },
  quietAfterCloseDays: { kind: "policy", source: "a month after a candidate closed: the watch verdict is shown, counted by nothing" },
  quietAfterRaiseDays: { kind: "policy", source: "a year after a step was raised, as quietAfterCloseDays" },
  lapseDays: { kind: "policy", source: "the regime's cadence: five days in low orbit, longer where sets are days to weeks apart" },
  stormKp: { kind: "policy", source: "the earlier attempt's evidence: a hold at Kp 6 cost no true event" },
  stressCandidatesPerDay: { kind: "policy", source: "ten candidates a day, where a quiet day opens a few" },
  cusumDrift: { kind: "fitted", source: "d1-fitting.md, the CUSUM: kept as the design's side channel, no training hit came from it" },
  hCusum: { kind: "fitted", source: "d1-fitting.md, the CUSUM: kept at 12, not lowered" },
  foreignDeltaAKm: { kind: "physical", source: "no breakup and few manoeuvres move an orbit fifty kilometres in one gap; a cross-tagged set does" },
  foreignDeltaIncDeg: { kind: "physical", source: "as foreignDeltaAKm, for the inclination" },
  foreignRaanDeg: { kind: "physical", source: "as foreignDeltaAKm, for the node against its J2 precession" },
  junkMeanMotionDot: { kind: "physical", source: "an orbit cannot rise that fast" },
  historyDays: { kind: "policy", source: "two years, long enough for a yearly north-south step to recur" },
  historyMaxSteps: { kind: "policy", source: "sixty-four steps hold two years of fortnightly east-west steps" },
  newObjectDays: { kind: "policy", source: "d2-fitting.md, the age bound table: no hit moves with it; ninety days covers a raising campaign's start" },
  stationKeepingMinSteps: { kind: "policy", source: "d2-fitting.md, what was chosen: the class names describe the record" },
  regularityMax: { kind: "policy", source: "as stationKeepingMinSteps" },
  alternationMin: { kind: "policy", source: "as stationKeepingMinSteps" },
  monotoneShareMin: { kind: "policy", source: "as stationKeepingMinSteps" },
  stationKeepingWindowDays: { kind: "policy", source: "the year before the step, the reach the station-keeping rule counts in" },
  disposalPerigeeDropKm: { kind: "policy", source: "d2-fitting.md, what was chosen: the sizes operators use" },
  disposalRaiseLeoKm: { kind: "policy", source: "as disposalPerigeeDropKm" },
  disposalRaiseGeoKm: { kind: "policy", source: "as disposalPerigeeDropKm" },
  typicalityMax: { kind: "fitted", source: "d2-fitting.md, the size test table: the knee at 10" },
  oppositeMinSteps: { kind: "fitted", source: "d2-fitting.md, the direction test table: one doubles the false alarms, three loses Hitomi" },
  consistencyMin: { kind: "fitted", source: "d2-fitting.md, the geometry test table: the last value losing nothing" },
  bstarRatioMax: { kind: "fitted", source: "d2-fitting.md, the drag-term test table: two events for 15,700 false alarms, left off; at a million it is not beyond reach (parameter-audit.md: four logged steps over the Archive pass it), so it stays a live threshold, not OFF" },
  inclinationStepMinDeg: { kind: "physical", source: "the format prints four decimals and the fits scatter by tens of them" },
  alertMaxPostSets: { kind: "policy", source: "a week of a low orbit's cadence for the tiers" },
  tierSets: { kind: "policy", source: "the tiers the owner asked to see" },
  tierDays: { kind: "policy", source: "the tiers the owner asked to see" },
  cadenceAfterDays: { kind: "policy", source: "three days against thirty" },
  cadenceBeforeDays: { kind: "policy", source: "three days against thirty" },
  alertTtlDays: { kind: "policy", source: "the truth's own burst rule counts pieces in thirty days" },
  burstWindowDays: { kind: "policy", source: "a fortnight for the catalogue to list a cloud's first pieces" },
  burstBackgroundDays: { kind: "policy", source: "the year before the window" },
  lambdaFloor: { kind: "fitted", source: "d3-fitting.md, the per-launch channel table: the knee at 0.5" },
  pBurst: { kind: "fitted", source: "d3-fitting.md, the per-launch channel table: the knee at a thousandth" },
  burstMinBodies: { kind: "policy", source: "two bodies at least, whatever the tail" },
  planeInclinationToleranceDeg: { kind: "fitted", source: "d3-fitting.md, the per-launch channel table: the plane bound is binding at three, so the tolerances are not loosened" },
  planeNodeToleranceDeg: { kind: "fitted", source: "as planeInclinationToleranceDeg" },
  planeDistanceMax: { kind: "fitted", source: "d3-fitting.md, the per-launch channel table: binding at three, five and ten add nothing" },
  planeNormalAngleMaxDeg: { kind: "fitted", source: "d12-fitting.md, the plane test at near-zero inclination: a degree over half, one false confirmation fewer on the training years for the same detections" },
  planeMaxDays: { kind: "policy", source: "a piece catalogued a season after the event has drifted by what drag and the rate's error allow" },
  deploymentDeltaVMps: { kind: "physical", source: "a dispenser pushes a satellite off at under a metre a second" },
  youngLaunchDays: { kind: "policy", source: "d3-fitting.md, the per-launch channel table: the first weeks of a launch catalogue its own objects" },
  youngLaunchDeltaVMps: { kind: "fitted", source: "d3-fitting.md, the per-launch channel table: five false clouds for no event" },
  cloudOnlyDeltaVMinMps: { kind: "fitted", source: "d3-fitting.md, the per-launch channel table: zero admits deployments, two loses four slow clouds" },
  confirmBackgroundMax: { kind: "fitted", source: "d3-fitting.md, the confirmation table: 7 of 8 training confirmations kept, 102 wrong ones cut to 5" },
  confirmDeltaVMinMps: { kind: "fitted", source: "d5-fitting.md, the confirmation rules table: the review list's floor, two wrong training confirmations at under a tenth of a metre a second" },
  cloudMemoryDays: { kind: "policy", source: "d5-fitting.md, the confirmation rules table: the truth's same-cloud rule, a year" },
  freshPieceDays: { kind: "policy", source: "d5-fitting.md, the confirmation rules table: the age under which an object's record is unknown" },
  debrisParentNeedsNearerThanCloud: { kind: "fitted", source: "d5-fitting.md, the confirmation rules table" },
  singlePieceNeedsQuietLaunch: { kind: "fitted", source: "d5-fitting.md, the confirmation rules table: single-piece confirmations on the training split" },
  cloudRepeatDays: { kind: "policy", source: "the alert's time to live" },
  attributionEnabled: { kind: "policy", source: "the seventh decision record: the target is on Confirmed alerts, attributed from fresh in-plane pieces with or without a step" },
  attributionDebrisParentsMax: { kind: "fitted", source: "d9-confirmed.md, the attribution sweep on the training split" },
  attributionBatchLaunchesMax: { kind: "fitted", source: "d9-confirmed.md, the attribution sweep on the training split" },
  attributionMinPieces: { kind: "fitted", source: "d10-confirmed.md, the sweep of the second iteration's values on the training split: three pieces cost no headline confirmation and remove three false ones" },
  attributionUnnamedGraceDays: { kind: "fitted", source: "d9-confirmed.md, the replays of the Confirmed channel on the training split" },
  attributionStepBreaksTies: { kind: "fitted", source: "d9-confirmed.md, the attribution sweep on the training split" },
  attributionSearchDays: { kind: "policy", source: "the Confirmed line's 180 days: a first piece listed that long after its event still counts" },
  attributionGridMinutes: { kind: "policy", source: "an hour: the angle drifts slowly and wobbles once a revolution; the refinement is on the event-time grid" },
  attributionMaxPieces: { kind: "policy", source: "the cost of one attribution's propagations" },
  attributionMaxCandidates: { kind: "policy", source: "the cost of one attribution's propagations" },
  attributionFallbackSearchDays: { kind: "policy", source: "d9-confirmed.md's fault: propagations that fail silently; two and two-thirds of a month, then three weeks" },
  launchEraDays: { kind: "policy", source: "a season, the time the catalogue takes to list a launch's own objects" },
  attributionAmbiguityRatio: { kind: "fitted", source: "d9-confirmed.md, the attribution sweep on the training split" },
  attributionCentreRatio: { kind: "fitted", source: "d9-confirmed.md, the attribution sweep on the training split" },
  attributionCentreFloorKm: { kind: "policy", source: "a cloud's centre is known to a kilometre or two, the spread of its first sets" },
  attributionTwins: { kind: "policy", source: "the owner's decision for the tenth phase: twins named at the launch, scored apart behind the scorecard's switch" },
  originOverrideHours: { kind: "fitted", source: "d10-confirmed.md, the common-origin sweep on the training split" },
  originOverrideMinPieces: { kind: "fitted", source: "d10-confirmed.md, the common-origin sweep on the training split" },
  originLaunchMarginDays: { kind: "fitted", source: "d10-confirmed.md, the common-origin sweep on the training split" },
  originEventTime: { kind: "policy", source: "the median crossing times the event where it is the finer estimate" },
  stationLaunches: { kind: "policy", source: "the tenth phase's methodology: a crewed station's releases are on purpose, as the truth exempts its bursts; the stations the satellite catalogue names" },
  visitingLaunches: { kind: "policy", source: "the owner's decision for the eleventh phase: a crewed spacecraft's and a station's cargo craft's releases are on purpose, as a station's; the craft the satellite catalogue names, generated by npm run archive:visiting" },
  reentryRefuses: { kind: "physical", source: "d11-confirmed.md: pieces first seen after their parent reentered are the reentry's, not a breakup's in orbit" },
  reentryAfterPiecesDays: { kind: "fitted", source: "d11-confirmed.md, the reentry rule on the training split" },
  attributionPreferCentreRatio: { kind: "fitted", source: "d11-confirmed.md, the stage preference on the training split" },
  attributionPrefersStageOverWorking: { kind: "fitted", source: "d12-confirmed.md, the stage preferred over an operating payload on the training split: no training confirmation changed, kept on its prior by the criterion decided before the look" },
  smallBatchMinPieces: { kind: "policy", source: "d11-confirmed.md: the small batches of three and four pieces the coordinator named; one and two pieces are the single-piece rule's" },
  smallBatchMaxPieces: { kind: "policy", source: "as smallBatchMinPieces" },
  smallBatchOriginShare: { kind: "fitted", source: "d11-confirmed.md, the small-batch sweep on the training split" },
  smallBatchOriginHours: { kind: "fitted", source: "d11-confirmed.md, the small-batch sweep on the training split" },
  maintenanceToleranceSigmas: { kind: "fitted", source: "d6-fitting.md, the sweeps on the training split: flat from 0 to 10" },
  maintenanceToleranceKm: { kind: "fitted", source: "d6-fitting.md, the sweeps on the training split: the knee at a kilometre" },
  maintenanceMonths: { kind: "policy", source: "a year of held altitudes, the envelope's reach" },
  maintenanceLoweringsToo: { kind: "fitted", source: "d6-fitting.md, the sweeps on the training split: a hundred fewer, nothing lost" },
  siblingWindowDays: { kind: "policy", source: "a campaign's steps come within a fortnight of each other" },
  siblingSizeFactor: { kind: "policy", source: "a campaign's steps are of about one size" },
  siblingsMin: { kind: "fitted", source: "d6-fitting.md, the sweeps on the training split: one loses two headline hits" },
  siblingOrbitInclinationDeg: { kind: "policy", source: "a constellation's shells share an inclination to a tenth of a degree" },
  siblingOrbitAltitudeKm: { kind: "policy", source: "a constellation's shells are tens of kilometres apart" },
  deployAgeDays: { kind: "fitted", source: "d6-fitting.md, the sweeps on the training split: flat to half a year" },
  opsStatusEvidence: { kind: "policy", source: "d6-fitting.md and the fifth decision record: read as evidence with the hindsight stated, the scorecard run both ways" },
  opsStatusDated: { kind: "policy", source: "d7-scope.md, the status as of the step: GCAT's dated end of transmission removes the hindsight of today's status" },
  endedUnknownDays: { kind: "policy", source: "d7-scope.md: an end of contact within the alert's time to live of a step may be the breakup's own consequence (Hitomi's is the day of it, Orbcomm FM16's the month)" },
  nonoperationalOverrides: { kind: "fitted", source: "d6-fitting.md, the sweeps on the training split: one headline hit for 143 false alarms" },
  geometryKickMinMps: { kind: "fitted", source: "d6-fitting.md, the sweeps on the training split: any floor loses two headline hits" },
  independentOutweighs: { kind: "fitted", source: "d6-fitting.md, the sweeps on the training split: from 21,068 false alarms to 4,985, no hit lost" },
  explanationsForNonPayloads: { kind: "fitted", source: "d6-fitting.md, the sweeps on the training split: 265 fewer, no training hit lost" },
  damageFromDays: { kind: "policy", source: "the second to fourth week after the step, once the post-step fit has settled" },
  damageToDays: { kind: "policy", source: "as damageFromDays" },
  damageMaxResiduals: { kind: "policy", source: "the ring's size" },
  damageMinResiduals: { kind: "policy", source: "four, the least a robust scale means anything with" },
  scope: { kind: "fitted", source: "d7-scope.md, the hypotheses on the training split: no scope reaches nine in ten at under one in ten; the point nearest the target, objects launched five years or more before the step, a step of 20 sigma with a kick (0.03 m/s along the track, chi-squared 100), the drag term changed two-fold, held seven days" },
  eventGridSeconds: { kind: "physical", source: "a minute resolves an event to its revolution" },
  eventLeadHours: { kind: "policy", source: "six hours before the pre set's epoch" },
  eventSigmaPositionKm: { kind: "physical", source: "a mean element set places an object to about a kilometre in low orbit" },
  eventMaxPoints: { kind: "policy", source: "the most grid points one alert may cost" },
  eventRefinedCrossings: { kind: "policy", source: "the cost of one attribution's refinement" },
  eventRefineReachMinutes: { kind: "policy", source: "half an hour either side of a coarse crossing, at least the coarse grid's step" },
  legacy: {
    openOnThreeAxes: { kind: "fitted", source: "d13-three-axis-trigger.md, the criterion written before the replay and its reading on the training years: every one of its four measures failed, off" },
    occasionalRaisesNonPayload: { kind: "fitted", source: "d3-fitting.md, the two parent-side signals table: no training hit gained, off" },
    persistOnMeanStep: { kind: "fitted", source: "d3-fitting.md, the two parent-side signals table: no training hit gained, off" },
    againstDragMinRaises: { kind: "fitted", source: "d6-fitting.md, the sweeps on the training split: from two raises the direction test reads it, from fewer it only costs" },
    analystAttributes: { kind: "fitted", source: "d9-confirmed.md, the attribution sweep on the training split" },
    attributionYoungLaunch: { kind: "fitted", source: "d9-confirmed.md, the attribution sweep on the training split" },
    attributionMissKmMax: { kind: "fitted", source: "d9-confirmed.md, the attribution sweep on the training split" },
    attributionTwinsUnresolved: { kind: "fitted", source: "d10-confirmed.md, the twins on the training split" },
    originHoursBase: { kind: "fitted", source: "d10-confirmed.md, the common-origin sweep on the training split" },
    originHoursPerDay: { kind: "fitted", source: "d10-confirmed.md, the common-origin sweep on the training split" },
    originShareMin: { kind: "fitted", source: "d10-confirmed.md, the common-origin sweep on the training split" },
    originMinPieces: { kind: "fitted", source: "d10-confirmed.md, the common-origin sweep on the training split" },
    originPhaseMax: { kind: "fitted", source: "d10-confirmed.md, the common-origin sweep on the training split" },
    originStepHoursMax: { kind: "fitted", source: "d10-confirmed.md, the common-origin sweep on the training split" },
    attributionPrefersStage: { kind: "fitted", source: "d11-confirmed.md, the stage preference on the training split" },
    attributionConvergenceNames: { kind: "fitted", source: "d11-confirmed.md, the replays of the training split" },
    smallBatchStepsToo: { kind: "fitted", source: "d11-confirmed.md, the small-batch sweep on the training split: on the step's confirmations it costs a headline confirmation at every bound" },
  },
};
