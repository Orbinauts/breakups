import type { LogRow } from "./detector.ts";
import { REGIMES, type Regime } from "./truth.ts";

/**
 * The sweep log: one row per candidate, written when it closes, with
 * every signal the decision read and the trajectory of the step over the
 * first post sets, so the thresholds can be swept offline from a year's
 * rows without replaying the year. Every value is a number (the regime by
 * its index in `REGIMES`, the phase and the outcome by the codes below),
 * rounded to four significant digits so a year's rows stay small on disk.
 * A candidate still open when the caller stops has no row.
 */

/** Where in a candidate's life the row was written: its opening on the first post set, a later post set, or its close; `alert` is the row an alert writes when it closes, with the persistence tiers and the cadence it read after the step; `cloud` is the row a launch writes in a run that brought it new bodies, with the burst and plane tests. */
export const PHASES = { open: 0, post: 1, close: 2, alert: 3, cloud: 4, attribution: 5 } as const;

/**
 * Why an attribution, or a confirmation of an open alert by pieces, was
 * refused, as bits on its row: the pieces under the velocity floor; a
 * debris-classed parent that is itself a fresh piece; the parent lying in
 * the plane of a cloud the launch remembers, or every piece lying in it; no
 * piece nearer a debris-classed parent's plane than the remembered cloud;
 * a single piece where one means nothing; a launch under a month old; a
 * launch still cataloguing an old cloud's backlog; another body of the
 * launch the pieces cannot be told from; pieces that do not converge on
 * the parent when propagated back; fewer pieces than the attribution needs;
 * an analyst range's burst the parameters do not let attribute; pieces
 * the timing could not propagate; and a run in which the catalogue listed
 * new bodies under many old launches at once, a cataloguing campaign
 * rather than a breakup; pieces whose closest approaches to the parent,
 * propagated back, do not share an instant (the common-origin test); a
 * crewed station's launch, whose pieces are released on purpose; the
 * launch of a crewed spacecraft or a station's cargo craft, whose pieces
 * are released on purpose too, unless the parent is the launch's rocket
 * body; a parent that had reentered by the time its pieces were first
 * seen, whose pieces are reentry debris; and a small batch of pieces that
 * do not share a tight common origin.
 */
export const REFUSALS = { velocity: 1, freshPiece: 2, parentInCloud: 4, piecesInCloud: 8, nearerThanCloud: 16, singlePiece: 32, youngLaunch: 64, background: 128, ambiguous: 256, miss: 512, minPieces: 1024, analyst: 2048, untimed: 4096, batch: 8192, origin: 16384, station: 32768, visiting: 65536, reentry: 131072, smallBatch: 262144 } as const;

/** The path an attribution row was written on: the confirmation of an open alert on the parent's step, an attribution to a body with no open alert, an analyst range's burst against the open alerts, or an attribution to a debris-classed body of a launch with few of them, for pieces in the plane of no other body. */
/** The refusals a common origin overrides (`originOverrideHours`): the rules that read a launch's history as an old cloud. Not the young launch: a launch's own objects leave it at one instant too, its separations. */
export const HISTORY_REFUSALS = REFUSALS.parentInCloud | REFUSALS.piecesInCloud | REFUSALS.nearerThanCloud | REFUSALS.background | REFUSALS.batch;

export const ATTRIBUTION_PATHS = { alert: 0, cloud: 1, analyst: 2, debris: 3 } as const;

/** How a candidate ended: still open, raised as suspected, dismissed as a bad set, lapsed with no post set, closed unraised after the last gap, or a persistent step the object's own history explains, closed as a manoeuvre; and how an alert ended: confirmed by pieces or a notice, expired with nothing under the launch, or dismissed because every piece was old. */
export const OUTCOMES = { open: 0, suspected: 1, reverted: 2, lapsed: 3, faded: 4, manoeuvre: 5, confirmed: 6, expired: 7, dismissed: 8 } as const;

/** The origin of a candidate: a single set's jump, or the CUSUM's slow drift. */
export const ORIGINS = { step: 0, cusum: 1 } as const;

/** The signals a row carries, by name, each with its unit. */
export const SIGNALS = {
  /** `PHASES`. */
  phase: "code",
  /** `OUTCOMES`. */
  outcome: "code",
  /** `ORIGINS`. */
  origin: "code",
  /** The index of the regime in `REGIMES`. */
  regime: "index",
  /** The bracket's edges, in milliseconds since 1970. */
  beforeEpoch: "ms",
  afterEpoch: "ms",
  /** The first post set's jump, in kilometres, and its normalised size. */
  delta1: "km",
  z1: "sigma",
  /** The fitted step over the post sets so far, in kilometres, its normalised size, the post sets read and the hours they span. */
  deltaKm: "km",
  zk: "sigma",
  k: "count",
  spanHours: "h",
  /** The median of the later sets' plain residuals over the first set's jump. */
  rhoMedian: "ratio",
  /** The fitted post slope, in kilometres a day. */
  slope: "km/day",
  /** The evidence for a step against a drift: the slope-only fit's weighted squares less the step-and-slope fit's. */
  stepEvidence: "chi2",
  /** The perigee radius and inclination steps with their normalised sizes. */
  deltaPerigeeKm: "km",
  zPerigee: "sigma",
  deltaInclinationDeg: "deg",
  zInclination: "sigma",
  /** The object's own scatter when the candidate opened, in kilometres, how many residuals it rested on, and the first set's prediction sigma. */
  sigmaOwn: "km",
  residuals: "count",
  sigmaPred: "km",
  /** The band's scale and common-mode term at the first post set. */
  bandScale1: "ratio",
  commonMode1: "km/day/bstar",
  /** The gap from the last pre set to the first post set, in hours. */
  gapHours: "h",
  /** The drag term of the pre window, in inverse Earth radii, the first post set's over it, and the perigee height in kilometres. */
  bstar: "1/Re",
  bstarRatio: "ratio",
  perigeeKm: "km",
  /** The trajectory: the normalised step, the later sets' ratio, the evidence and the span when the second and the third post set were first read. */
  z2: "sigma",
  rho2: "ratio",
  evidence2: "chi2",
  span2: "h",
  z3: "sigma",
  rho3: "ratio",
  evidence3: "chi2",
  span3: "h",
  /** The run's weather: the highest Kp over the days given, the flux; whether a storm hold was on; and how many candidates the catalogue opened in the last day. */
  kpMax: "Kp",
  f107: "sfu",
  stormHold: "flag",
  recentCandidates: "count",
  /** The larger side of the CUSUM when the candidate opened. */
  cusumPos: "sigma",
  /** How many sets the pre fit read. */
  preSets: "count",
  /** The object's class as the catalogue says it, by its index in `BODY_CLASSES`. */
  bodyClass: "index",
  /** The impulse the step implies: the tangential, normal and least radial components in metres a second, where on the orbit the apsides place a tangential one (0 perigee to 1 apogee), and the chi-squared of the eccentricity change beyond a single tangential impulse's reach. */
  deltaVMps: "m/s",
  deltaVNormalMps: "m/s",
  deltaVRadialMps: "m/s",
  apsisLocation: "ratio",
  impulseConsistency: "chi2",
  /** The object's history at the step: days from its first set; accepted steps in the year and the two years before; days from the last; the coefficient of variation of the intervals; the step over the median past step; the share of past steps with its sign; the share of sign changes between consecutive steps; the share of past steps with a dominant normal component; whether the step is disposal-shaped; and the class by its index in `MANOEUVRE_CLASSES`. */
  ageDays: "days",
  n365: "count",
  n730: "count",
  daysSinceStep: "days",
  regularity: "ratio",
  typicality: "ratio",
  sameSignShare: "ratio",
  alternation: "ratio",
  normalShare: "ratio",
  disposalLike: "flag",
  /** How many of the past steps raised the orbit. */
  pastRaises: "count",
  manoeuvreClass: "index",
  /** How many of the atypical tests the step passed, by which the step on a manoeuvring object is still raised. */
  atypical: "count",
  /** The sixth phase's discriminators, as read at the close. The envelope: how far the pre-step level had drifted below the highest altitude the object held in the last year and above the lowest, in kilometres, how far the post-step level misses the extreme the step went towards, and how many months of the window had sets. The siblings: how many other objects of the launch, and of other launches in the same shell, made a like step in the window before. The mates: how many other payloads of the launch have a known altitude, the median of their semi-major axes in kilometres, and whether the step carries the object towards it (1). The operational status by its index in `OPS_STATUSES`. The direction against drag: a lowering on a record of nothing but raises, not disposal-shaped (1). Then what the fusion made of it: how many manoeuvre explanations applied and how many breakup signatures, and the explanation and signature bits (1 the record, 2 maintenance, 4 siblings, 8 deployment, 16 the working status; 1 the size, 2 the direction, 4 the geometry, 8 the drag term, 16 against drag, 32 nonoperational). */
  envelopeTopKm: "km",
  envelopeBottomKm: "km",
  envelopeMissKm: "km",
  envelopeMonths: "count",
  siblingsLaunch: "count",
  siblingsOrbit: "count",
  mates: "count",
  matesMedianAKm: "km",
  towardsMates: "flag",
  opsStatus: "index",
  againstDrag: "flag",
  explanations: "count",
  signatures: "count",
  explanationBits: "code",
  signatureBits: "code",
  /** The scoped line, on a close row of a persistent step: the parent's age from its launch in days (NaN where the launch is not known), whether the parent was in the scope at the step (1) and whether the step also passed the scope's gates (1), by `DETECTOR_PARAMETERS.scope`. */
  ageFromLaunchDays: "days",
  scopeIn: "flag",
  scoped: "flag",
  /** The fitted line's value at the centroid of the post sets in units of its sigma (the weighted mean step), at the second and third post set and at the close; the level at the first post set under-reads a step the catalogue's fit converged on over several sets. */
  zMean: "sigma",
  zMean2: "sigma",
  zMean3: "sigma",
  /** The object's short scatter and its long memory when the candidate opened, in kilometres: which of the two set `sigmaOwn`. */
  sigmaShort: "km",
  sigmaLong: "km",
  /** The tracking cadence: sets a day in the days before the step, and in the post sets read so far (on a candidate row) or in the days after the step (on an alert row), with the ratio. */
  cadenceBefore: "sets/day",
  cadenceAfter: "sets/day",
  cadenceRatio: "ratio",
  /** The alert row's damage reading: the robust scatter of the object's one-step-ahead residuals in the second to fourth week after the step, in kilometres, how many residuals it rests on, and the ratio to the object's short scatter before the step. A ratio well above one is a tumbling object or a changed shape. */
  damageSigma: "km",
  damageResiduals: "count",
  damageRatio: "ratio",
  /** The alert row: the verdict the alert opened with (1 suspected, 5 manoeuvre), how many post sets it read in all and the hours they spanned, the days from the step to its close, and the last estimate's step, size and ratio. */
  alertState: "code",
  alertSets: "count",
  alertSpanHours: "h",
  alertDays: "days",
  /** The persistence tiers: at the third and fifth post set, and at one, three, five and seven days of span, whether the step still held (1), had failed (0), or was not reached (absent), the normalised step then (level and mean), the ratio, and the run's instant when the tier was reached, in milliseconds since 1970. */
  tier3Held: "flag",
  tier3Z: "sigma",
  tier3ZMean: "sigma",
  tier3Rho: "ratio",
  tier3At: "ms",
  tier5Held: "flag",
  tier5Z: "sigma",
  tier5ZMean: "sigma",
  tier5Rho: "ratio",
  tier5At: "ms",
  tierD1Held: "flag",
  tierD1Z: "sigma",
  tierD1ZMean: "sigma",
  tierD1Rho: "ratio",
  tierD1At: "ms",
  tierD3Held: "flag",
  tierD3Z: "sigma",
  tierD3ZMean: "sigma",
  tierD3Rho: "ratio",
  tierD3At: "ms",
  tierD5Held: "flag",
  tierD5Z: "sigma",
  tierD5ZMean: "sigma",
  tierD5Rho: "ratio",
  tierD5At: "ms",
  tierD7Held: "flag",
  tierD7Z: "sigma",
  tierD7ZMean: "sigma",
  tierD7Rho: "ratio",
  tierD7At: "ms",
  /** The fragments an alert was judged by at its close: new bodies under the launch after the step, those numbered above the high-water mark and with no set before the step, those in the parent's plane, those first published after the step, and whether a notice named the object. */
  piecesNew: "count",
  piecesAboveMark: "count",
  piecesInPlane: "count",
  piecesAfterStep: "count",
  noticed: "flag",
  /** The alert row's confirmation reading, written when pieces in the parent's plane were judged for the confirmation (whether they confirmed or the rules refused them): how many pieces, their cloud velocity in metres a second, the parent's age in days from its first set under the launch and whether it is classed as a fragment is, the launch's new bodies in the year before the window, the bodies of the launch's earlier cloud the pieces were told apart from, the days since the launch's last remembered cloud, the parent's nearest plane distance to that cloud, how many of the pieces lie out of the cloud's plane and how many nearer the parent's plane than the cloud is, and whether the rules refused the confirmation (1) or it stood (0). */
  confirmPieces: "count",
  confirmDeltaVMps: "m/s",
  parentAgeDays: "days",
  parentFragment: "flag",
  backgroundBodies: "count",
  cloudPieces: "count",
  daysSinceCloud: "days",
  parentCloudDistance: "ratio",
  piecesOutOfCloud: "count",
  piecesNearerThanCloud: "count",
  confirmRefused: "flag",
  /** The cloud row: the launch as a number (the year times a thousand plus the launch number; 80000 or 270000 for the analyst ranges), its age in days from its first body's first set, the new bodies the run brought, the window's count of new bodies, the background rate per window, the Poisson tail probability, how many candidate parents the launch has, the pieces numbered above the mark, those within plane distance one, three, five and ten of some parent, those classed debris, those classed payload, the cloud velocity in metres a second, the Gabbard spread (the range of the consistent pieces' semi-major axes) in kilometres, whether an alert was open on a parent, and what the launch pass decided (0 nothing, 1 confirmed an alert, 2 listed for review, 3 a burst with no consistent piece, 4 a deployment, 5 an old cloud's background). */
  launch: "code",
  launchAgeDays: "days",
  newBodies: "count",
  windowBodies: "count",
  lambda: "count",
  lambdaRate: "count",
  pBurst: "probability",
  parents: "count",
  aboveMark: "count",
  inPlane1: "count",
  inPlane3: "count",
  inPlane5: "count",
  inPlane10: "count",
  debrisPieces: "count",
  payloadPieces: "count",
  cloudDeltaVMps: "m/s",
  gabbardSpreadKm: "km",
  openAlert: "flag",
  cloudDecision: "code",
  /** The attribution row (phase 5), one per parent the pieces of a run were judged for, on either path: the path (`ATTRIBUTION_PATHS`), the pieces judged in the parent's plane and those the rules kept, how many other bodies of the launch the pieces lie within the plane bound of, the pieces' median plane distance, the back-propagated timing (the pieces' miss of the parent in kilometres, the least miss of the other bodies timed, the instant's sigma and the pieces' spread about it in minutes, the crossings it could be on, the instant itself), the refusals as `REFUSALS` bits, and whether a confirmed verdict was raised. The launch, its age, its background rate and counts, the cloud memory's readings, the parent's class and age and the cloud velocity use the names above. */
  attributionPath: "code",
  attributionPieces: "count",
  attributionKept: "count",
  attributionRivals: "count",
  attributionDistance: "ratio",
  attributionMissKm: "km",
  attributionRivalMissKm: "km",
  attributionSigmaMinutes: "min",
  attributionSpreadMinutes: "min",
  attributionCrossings: "count",
  attributionEventAt: "ms",
  attributionRefused: "code",
  attributionRaised: "flag",
  /** How many launches older than a year the run brought new bodies to: the catalogue publishing a batch of old objects lists them under many launches at once. */
  launchesInRun: "count",
  /** On an attribution whose pieces lie in the plane of other bodies too: 1 where the body made a persistent step in the search window, 2 where another did, 3 where both did. */
  attributionStepped: "code",
  /** On an attribution row: how far the pieces' median semi-major axis lies from the named body's, and from the nearest of the other bodies whose plane they share, in kilometres. */
  attributionCentreKm: "km",
  attributionRivalCentreKm: "km",
  /** On an attribution row whose pieces cannot be told from other bodies of the launch (the tenth phase's twins): how many such bodies, and the first three of them by catalogue number, kept whole. */
  attributionTwins: "count",
  candidate1: "number",
  candidate2: "number",
  candidate3: "number",
  /** The common-origin test on the pieces judged (`originOf` in `event-time.ts`): the pieces tried and those that crossed the parent in the window, their median crossing, the half-widths around it within which half and three quarters of the pieces tried crossed and the robust spread, in hours, the same half-widths as a share of each piece's lap, the median crossing's sigma in minutes, the pieces' median age at it in days and their median distance from the parent at their own closest approach in kilometres. */
  originTried: "count",
  originTimed: "count",
  originMedianAt: "ms",
  originDev50Hours: "h",
  originDev75Hours: "h",
  originPhase50: "ratio",
  originPhase75: "ratio",
  originSpreadHours: "h",
  originSigmaMinutes: "min",
  originAgeDays: "days",
  originMissKm: "km",
  /** On the confirmation of an alert on the parent's step: the pieces' median closest approach less the step's instant, in hours. */
  originStepHours: "h",
  /** On an attribution row: the days from the earliest first set of the pieces judged to the parent's reentry, where the catalogue had published the reentry by the run (negative where the parent reentered before its pieces were first seen); absent where it had not. */
  parentDecayDays: "days",
  /** On an attribution row: the earliest first set's epoch of the pieces judged, in milliseconds since 1970. */
  piecesFirstAt: "ms",
  /** On an attribution row of the cloud path, the stage preference (`attributionPrefersStage`): the rank of the body the centre of the pieces named (0 a rocket body, 1 a body not operating at the time, 2 a payload operating at it), the body of a better rank whose plane the pieces share and whose offset from their centre is the least, its rank, that offset over the named body's (floored), whether the named body alone made a persistent step in the search window, the body named before the preference where it changed the name, and whether the named body's rank is better than every twin's, so the prior breaks a tie the pieces cannot. */
  preferNamedRank: "code",
  preferAlternative: "number",
  preferAlternativeRank: "code",
  preferCentreRatio: "ratio",
  preferNamedStepped: "flag",
  preferredFrom: "number",
  attributionPriorBreaks: "flag",
  /** On an attribution row where the convergence was read over the bodies of the pieces' plane (`attributionConvergenceNames`): the body the pieces converge on best other than the one their centre named, the named body's miss over that body's, and the body the centre named where the convergence changed the name. */
  convergedAlternative: "number",
  convergedRatio: "ratio",
  convergedFrom: "number",
} as const;

export type SignalName = keyof typeof SIGNALS;

/** Four significant digits; NaN and infinities become null-like NaN, which JSON writes as null. */
export function round4(value: number): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const digits = 4 - Math.ceil(Math.log10(Math.abs(value)));
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function regimeIndex(regime: Regime): number {
  return REGIMES.indexOf(regime);
}

/** The signals kept whole rather than to four digits: catalogue numbers, and the refusals' bits, which rounding would turn into other bits (16384 to 16380). */
const WHOLE = new Set<string>(["preferAlternative", "preferredFrom", "attributionRefused", "convergedAlternative", "convergedFrom"]);

/** A row of the log, the signals rounded; a missing signal is left out. */
export function logRow(at: number, number: number, signals: Partial<Record<SignalName, number>>): LogRow {
  const rounded: Record<string, number> = {};
  for (const [name, value] of Object.entries(signals)) {
    if (value === undefined) continue;
    rounded[name] = name === "beforeEpoch" || name === "afterEpoch" || name === "launch" || name.endsWith("At") || name.startsWith("candidate") || WHOLE.has(name) ? Math.round(value) : round4(value);
  }
  return { at, number, signals: rounded };
}
