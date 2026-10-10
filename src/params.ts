import type { Regime } from "./truth.ts";

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
 *   The sweep that chose each is recorded in `docs/detector/d1-fitting.md`, `d2-fitting.md` and `d3-fitting.md`.
 *
 * The regimes are the four the ground truth uses; a value per regime is
 * given for all four even where only one differs, so a reader sees the
 * whole table at once.
 */
export type PerRegime = Record<Exclude<Regime, "unknown">, number>;

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
  /** The scatter a new object is given before it has residuals of its own, per regime, in kilometres of semi-major axis, at a quiet Sun and a low drag term. Fitted on the training split from the measured scatter of objects by regime. */
  sigmaPrior: PerRegime;
  /** The drag term, in inverse Earth radii, above which the prior grows in proportion: an object at B* twice this has twice the prior. Fitted on the training split from the measured scatter against B*. */
  sigmaPriorBstar: number;
  /** How much the drag prediction may miss over a gap, per regime, in kilometres per day per unit of B*: the term `(kappa * |B*| * gap)²` added to the prediction variance. Fitted on the training split so that the normalised residuals of high-drag objects have unit scale. */
  kappa: PerRegime;
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
  /** A candidate with no post set in this many days lapses, per regime: five in low orbit, longer where the catalogue's cadence is days to weeks. The unconfirmed set is dropped from the ring, so the step is measured again when the next set comes. Policy. */
  lapseDays: PerRegime;
  /** Kp, on the run's day or the two before, from which a storm hold is on. Policy, from the earlier attempt's evidence: a hold at Kp 6 cost no true event. */
  stormKp: number;
  /** How many candidates opened across the catalogue in the last day put a run under stress. Policy: ten, where a quiet day opens a few. */
  stressCandidatesPerDay: number;
  /** The two-sided CUSUM's drift allowance, in units of scatter, and the decision threshold; the side channel for a slow, low-energy move the step test cannot see in one set. Fitted on the training split; a threshold the sweep found only costs false alarms is set high. */
  cusumDrift: number;
  hCusum: number;
  /** A set that moves the semi-major axis by more kilometres than this, or the inclination by more degrees, or whose node is further from the J2 precession of the last set than this many degrees, is foreign until the next set agrees with it. Physical: no breakup and few manoeuvres move an orbit that far in one gap; a cross-tagged set does. */
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
  /** The factor by which the drag term may change across a step before the change is read as evidence of a breakup (the area over the mass changed) on a manoeuvring object; its inverse bounds a fall. Fitted on the training split; set beyond reach where the sweep found it only costs false alarms. */
  bstarRatioMax: number;
  /** The inclination step below which no normal component is read, in degrees: the format prints four decimals, and the fits scatter by tens of them. Physical. */
  inclinationStepMinDeg: number;
  /** Whether a persistent step on an object the catalogue does not class as a payload (a rocket body, a piece of debris, an unknown) is raised when its record classes it `occasional`, a past step within two years on no pattern: a stage does not manoeuvre, so its past "step" was the catalogue's fit absorbing something, not a burn. Fitted on the training split. */
  occasionalRaisesNonPayload: boolean;
  /** Whether the persistence size is judged on the fitted line's value at the centroid of the post sets (the weighted mean step, `zMean`) rather than on its level at the first post set (`z`): the catalogue's fit converges on a new orbit over several sets, so the first post set can carry a tenth of the step and the level under-reads it while the mean does not; the evidence against a drift still guards a ramp drag could produce. Fitted on the training split. */
  persistOnMeanStep: boolean;
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
  /** How long a launch's cloud, once listed for review, is not listed again as its pieces keep coming, in days. Policy: the alert's time to live. */
  cloudRepeatDays: number;
  /** The event-time search: the grid step in seconds, how many hours before the pre set's epoch the grid starts, and the position error of a published set, in kilometres, that divides the along-track slope for the time's sigma. Physical: a minute resolves an event to its revolution; a mean element set places an object to about a kilometre in low orbit. */
  eventGridSeconds: number;
  eventLeadHours: number;
  eventSigmaPositionKm: number;
  /** The most grid points the event-time search spends on one alert, beyond which the grid step is widened: a highly elliptical object with sets seventeen days apart would otherwise cost fifty thousand propagations. Policy. */
  eventMaxPoints: number;
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
  sigmaPrior: { LEO: 0.03, MEO: 0.05, HEO: 0.5, GEO: 0.2 },
  sigmaPriorBstar: 1e-4,
  kappa: { LEO: 100, MEO: 100, HEO: 100, GEO: 100 },
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
  disposalPerigeeDropKm: 20,
  disposalRaiseLeoKm: 50,
  disposalRaiseGeoKm: 200,
  typicalityMax: 10,
  oppositeMinSteps: 2,
  consistencyMin: 100,
  bstarRatioMax: 1e6,
  inclinationStepMinDeg: 0.01,
  occasionalRaisesNonPayload: false,
  persistOnMeanStep: false,
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
  planeMaxDays: 180,
  deploymentDeltaVMps: 1,
  youngLaunchDays: 30,
  youngLaunchDeltaVMps: 5,
  cloudOnlyDeltaVMinMps: 1,
  confirmBackgroundMax: 2,
  cloudRepeatDays: 30,
  eventGridSeconds: 60,
  eventLeadHours: 6,
  eventSigmaPositionKm: 1,
  eventMaxPoints: 4000,
};

/** The parameters with a caller's overrides laid over the defaults, one level deep so a per-regime table can be overridden whole. */
export function parametersWith(overrides: Partial<DetectorParameters> | undefined): DetectorParameters {
  return overrides === undefined ? DETECTOR_PARAMETERS : { ...DETECTOR_PARAMETERS, ...overrides };
}
