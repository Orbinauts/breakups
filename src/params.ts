import { OPEN_GATES, WHOLE_CATALOGUE, type ScopeParameters } from "./scope.ts";
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
 *   The sweep that chose each is named in `PARAMETER_PROVENANCE` below,
 *   by the fitting note and the table in it, and recorded in
 *   `docs/detector/d1-fitting.md` to `d5-fitting.md`.
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
  /** The fewest past raises for a lowering on an object whose record holds nothing but raises, and whose step is not disposal-shaped, to be the breakup pattern (a move against drag that no make-up burn makes): zero reads a lowering with no record as the pattern too; a value beyond reach turns the test off. Fitted on the training split. */
  againstDragMinRaises: number;
  /** The least radial component, in metres a second, for the geometry test (the eccentricity change beyond a tangential impulse's reach) to override a manoeuvre explanation: a small radial residue is what two burns half an orbit apart or a low-thrust arc leaves, a large one is a kick. Fitted on the training split. */
  geometryKickMinMps: number;
  /** How many explanations independent of the object's record (maintenance, siblings, deployment, the working status) outweigh the record's own breakup signatures (the size, the direction, the geometry, the drag term, the move against drag); the nonoperational signature is never outweighed. A value beyond reach lets any signature override every explanation. Fitted on the training split. */
  independentOutweighs: number;
  /** Whether the manoeuvre explanations that are not the record (maintenance, siblings, deployment, the working status) apply to objects the catalogue does not class as payloads: a stage or a fragment does not maintain its orbit. Fitted on the training split. */
  explanationsForNonPayloads: boolean;
  /** The days after the step over which the object's one-step-ahead residual scatter is read for damage (tumbling or a changed shape), against its scatter before the step: from this many days to this many. Policy: the second to fourth week, once the post-step fit has settled and before the alert's time to live. */
  damageFromDays: number;
  damageToDays: number;
  /** The scoped line (`scope.ts`): the population of parents it speaks for, as a predicate on the parent at the step, the gates a raised step on one must pass beyond the whole-catalogue line's, and the persistence tier the step must still hold at before the scoped line raises it. Every raised step carries whether its parent was in the scope and whether it passed the gates, and the scorecard scores the scoped line on the reported events in the scope and the alerts in it, the excluded share stated. Fitted on the training split: `d7-scope.md` records the hypotheses, the frontier and the choice. */
  scope: ScopeParameters;
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
  confirmDeltaVMinMps: 1,
  cloudMemoryDays: 365,
  freshPieceDays: 90,
  debrisParentNeedsNearerThanCloud: true,
  singlePieceNeedsQuietLaunch: true,
  cloudRepeatDays: 30,
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
  againstDragMinRaises: 1e6,
  geometryKickMinMps: 0,
  independentOutweighs: 1,
  explanationsForNonPayloads: true,
  damageFromDays: 14,
  damageToDays: 28,
  scope: { policy: { ...WHOLE_CATALOGUE, minAgeDays: 1825 }, gates: { ...OPEN_GATES, zMin: 20, deltaVMinMps: 0.03, bstarRatioMin: 2, consistencyMin: 100 }, tier: "D7" },
  eventGridSeconds: 60,
  eventLeadHours: 6,
  eventSigmaPositionKm: 1,
  eventMaxPoints: 4000,
};

/** The parameters with a caller's overrides laid over the defaults, one level deep so a per-regime table can be overridden whole. */
export function parametersWith(overrides: Partial<DetectorParameters> | undefined): DetectorParameters {
  return overrides === undefined ? DETECTOR_PARAMETERS : { ...DETECTOR_PARAMETERS, ...overrides };
}

/** Where a parameter's value comes from: a constant of the orbit or the format, a choice about the product, or a fit on the training split. */
export type ParameterKind = "physical" | "policy" | "fitted";

export interface Provenance {
  kind: ParameterKind;
  /** The fitting note that records the choice and the table or section in it; for a physical constant, what it is a constant of; for a policy, the decision it rests on. */
  source: string;
}

/**
 * Every parameter's kind and the sweep or decision that chose it, one
 * entry per key of `DetectorParameters` (the type enforces it), so the
 * freeze is a table a reader can check and a test can hold: a fitted
 * value names the note and the table it was read off, a policy names
 * what it rests on, a physical constant what it is.
 */
export const PARAMETER_PROVENANCE: Record<keyof DetectorParameters, Provenance> = {
  ringSize: { kind: "policy", source: "the window plus the post gaps with room for re-published sets, about two kilobytes an object" },
  windowSets: { kind: "policy", source: "a week to a month of sets in low orbit; the whole ring in highly elliptical orbit for the lunisolar baseline" },
  windowMaxDays: { kind: "policy", source: "an object silent for a season is fitted on its recent sets" },
  quadraticMinSets: { kind: "policy", source: "six sets over three days is the least that resolves a curvature from noise" },
  quadraticMinDays: { kind: "policy", source: "as quadraticMinSets" },
  linearMinSets: { kind: "policy", source: "under three sets the single set's own drag rate is extrapolated" },
  huberConstant: { kind: "physical", source: "the textbook constant for 95% efficiency at the Gaussian" },
  residualsForScatter: { kind: "policy", source: "a median absolute deviation needs eight residuals to be robust with" },
  longHalfLifeDays: { kind: "policy", source: "half a year spans a storm season" },
  sigmaPrior: { kind: "fitted", source: "d1-fitting.md, the prior scatter: set from the measured scatter by regime on the training years, nothing to sweep against" },
  sigmaPriorBstar: { kind: "fitted", source: "d1-fitting.md, the prior scatter: its knee in the drag term" },
  kappa: { kind: "fitted", source: "d1-fitting.md, the drag term kappa table: the last value losing nothing" },
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
  disposalPerigeeDropKm: { kind: "policy", source: "d2-fitting.md, what was chosen: the sizes operators use" },
  disposalRaiseLeoKm: { kind: "policy", source: "as disposalPerigeeDropKm" },
  disposalRaiseGeoKm: { kind: "policy", source: "as disposalPerigeeDropKm" },
  typicalityMax: { kind: "fitted", source: "d2-fitting.md, the size test table: the knee at 10" },
  oppositeMinSteps: { kind: "fitted", source: "d2-fitting.md, the direction test table: one doubles the false alarms, three loses Hitomi" },
  consistencyMin: { kind: "fitted", source: "d2-fitting.md, the geometry test table: the last value losing nothing" },
  bstarRatioMax: { kind: "fitted", source: "d2-fitting.md, the drag-term test table: two events for 15,700 false alarms, left off" },
  inclinationStepMinDeg: { kind: "physical", source: "the format prints four decimals and the fits scatter by tens of them" },
  occasionalRaisesNonPayload: { kind: "fitted", source: "d3-fitting.md, the two parent-side signals table: no training hit gained, off" },
  persistOnMeanStep: { kind: "fitted", source: "d3-fitting.md, the two parent-side signals table: no training hit gained, off" },
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
  againstDragMinRaises: { kind: "fitted", source: "d6-fitting.md, the sweeps on the training split: from two raises the direction test reads it, from fewer it only costs" },
  geometryKickMinMps: { kind: "fitted", source: "d6-fitting.md, the sweeps on the training split: any floor loses two headline hits" },
  independentOutweighs: { kind: "fitted", source: "d6-fitting.md, the sweeps on the training split: from 21,068 false alarms to 4,985, no hit lost" },
  explanationsForNonPayloads: { kind: "fitted", source: "d6-fitting.md, the sweeps on the training split: 265 fewer, no training hit lost" },
  damageFromDays: { kind: "policy", source: "the second to fourth week after the step, once the post-step fit has settled" },
  damageToDays: { kind: "policy", source: "as damageFromDays" },
  scope: { kind: "fitted", source: "d7-scope.md, the hypotheses on the training split: no scope reaches nine in ten at under one in ten; the point nearest the target, objects launched five years or more before the step, a step of 20 sigma with a kick (0.03 m/s along the track, chi-squared 100), the drag term changed two-fold, held seven days" },
  eventGridSeconds: { kind: "physical", source: "a minute resolves an event to its revolution" },
  eventLeadHours: { kind: "policy", source: "six hours before the pre set's epoch" },
  eventSigmaPositionKm: { kind: "physical", source: "a mean element set places an object to about a kilometre in low orbit" },
  eventMaxPoints: { kind: "policy", source: "the most grid points one alert may cost" },
};
