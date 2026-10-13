import { WGS84_EQUATORIAL_KM } from "@orbinauts/engine";
import { regimeOf, semiMajorAxisOf, type ElementSet, type OpsStatus } from "./elements.ts";
import type { OpenAlert } from "./fusion.ts";
import { newEnvelope, snapshotEnvelope, type AltitudeEnvelope } from "./maintenance.ts";
import type { StepRecord } from "./manoeuvre.ts";
import { dragRateKmPerDay, fitWindow, median, robustScale, type Fit } from "./model.ts";
import type { DetectorParameters } from "./params.ts";
import type { Regime } from "./truth.ts";
import { DAY_MS, wrapDegrees } from "./units.ts";

/**
 * What the detector keeps of one object between runs: a ring of its last
 * sets, sorted by epoch, with the one-step-ahead residual each set left
 * when it arrived; the long memory of its scatter; the two-sided CUSUM;
 * a set held in quarantine as possibly another object's; and the live
 * candidate, if a step is being judged. Everything is flat numbers and
 * arrays, about two kilobytes an object; the infinities and NaN in it
 * ("not yet", "never", "not measured") do not survive plain JSON, so a
 * caller stores it as `serialiseStates` writes it (`states.ts`).
 *
 * The ring is what makes the detector incremental: a set is judged
 * against the sets before it, never against the year, and the work per
 * set is bounded by the ring's size. Re-published epochs replace their
 * earlier values rather than add a set, since the catalogue re-issues a
 * third of its sets in some years; a set with an epoch older than the
 * ring's last is slotted into place without a residual, since it was not
 * a prediction's target when it arrived.
 */

/** Two epochs this close are the same set re-published, in milliseconds: the catalogue re-issues a set at its epoch, and no two fits of one object are made a second apart. */
const SAME_EPOCH_MS = 1000;
/** Earth's second zonal harmonic (EGM96), which precesses the node: the test for a foreign set compares the node against this precession. Physical. */
export const J2 = 1.08262668e-3;
/** The least scatter an object is given, in kilometres of semi-major axis: the semi-major axis a mean motion printed to a hundred-millionth of a revolution a day resolves at a low orbit is three millimetres; a metre keeps a run of identical re-published values from making an object look noiseless. Physical. */
export const SIGMA_FLOOR_KM = 0.001;
/** The least scatter of the inclination, in degrees: the format prints four decimals. Physical. */
export const SIGMA_FLOOR_DEG = 1e-4;

/** The quantities the detector fits: the semi-major axis and the perigee radius in kilometres, the inclination in degrees. */
export type Series = "a" | "rp" | "inc";

/** A set held back as possibly foreign, until the next set says whether the orbit really moved there. */
export interface Held {
  set: ElementSet;
  aKm: number;
}

/** The step the detector is judging on an object, frozen at its opening so every later set is measured against the same pre-step model. */
export interface Candidate {
  /** The run that opened it, in milliseconds since 1970. */
  openedAt: number;
  /** Whether a single set's jump or the CUSUM's slow drift opened it. */
  origin: "step" | "cusum";
  /** The bracket: the last set before the step and the first after, and the instant the step is placed at between them. */
  beforeEpoch: number;
  afterEpoch: number;
  tStep: number;
  /** The pre-step fits of the three quantities, frozen. */
  pre: Fit;
  preRp: Fit;
  preInc: Fit;
  /** The object's own scatter of the semi-major axis when the candidate opened, in kilometres, with the short scatter and the long memory it was the larger of, and the drag term of its window. */
  sigmaOwn: number;
  sigmaShort: number;
  sigmaLong: number;
  bstar: number;
  /** The orbit at the bracket's first edge, from the pre fits: the semi-major axis and perigee radius in kilometres and the inclination in degrees, for the impulse the step implies. */
  aKm: number;
  rpKm: number;
  incDeg: number;
  /** The first post set's jump, in kilometres, its normalised size, and its prediction sigma. */
  delta1: number;
  z1: number;
  sigma1: number;
  /** The band's scale and common-mode term the first set was normalised with. */
  bandScale1: number;
  commonMode1: number;
  /** How many post sets have been judged, and the epoch of the last. */
  postSets: number;
  lastPostEpoch: number;
  /** The drag term of the first post set over the window's: a fit that absorbed an event moves it by orders of magnitude. */
  bstarRatio: number;
  /** How many residuals the object's scatter rested on when the candidate opened, and where the CUSUM stood. */
  residuals: number;
  cusumAtOpen: number;
  /** Whether a watch verdict was raised for it, so a dismissal can be shown too. */
  watched: boolean;
  /** Whether it was raised as suspected. */
  suspected: boolean;
  /** When the last post set was seen, the run's instant. */
  lastPostAt: number;
  /** The sets a day the object had in the month before the step. */
  cadenceBefore: number;
  /** The trajectory: the normalised step (the level and the mean), the later sets' ratio, the evidence and the span when the second and the third post set were first read, for sweeps of the gates offline. NaN until reached. */
  z2: number;
  rho2: number;
  evidence2: number;
  span2: number;
  zMean2: number;
  z3: number;
  rho3: number;
  evidence3: number;
  span3: number;
  zMean3: number;
  /** The object's envelope of held altitudes as it stood when the candidate opened, before the first post set was noted, so the post-step level is judged against where the object flew and never against itself. */
  envelope: AltitudeEnvelope;
  /** The quantity whose residual opened the candidate and on which its persistence is judged, where the three-axis trigger opened it on the perigee radius or the inclination (`openOnThreeAxes`); absent for the semi-major axis. With it, the first post set's jump on that quantity, in its units (kilometres, degrees), and its normalised size. */
  axis?: "rp" | "inc";
  axisDelta1?: number;
  axisZ1?: number;
}

export interface SeriesState {
  number: number;
  regime: Regime;
  /** The ring, oldest first: epochs in milliseconds since 1970, and per set the semi-major axis and perigee radius in kilometres, the inclination, node, argument of perigee and mean anomaly in degrees, the drag term, the mean motion and its printed half-derivative. The two angles of position are kept so the sets either side of a step can be propagated for the event's time. */
  epochs: number[];
  a: number[];
  rp: number[];
  inc: number[];
  raan: number[];
  argp: number[];
  ma: number[];
  bstar: number[];
  meanMotion: number[];
  meanMotionDot: number[];
  /** The one-step-ahead residual of the semi-major axis each set left on arrival, in kilometres; NaN where it was not predicted. */
  resid: number[];
  /** Sets with an epoch before this are not fitted: the window restarts after a step. */
  windowFrom: number;
  /** The short robust scatter of the ring's residuals and how many it rests on, kept up to date as residuals are recorded so a prediction does not recompute them. */
  shortSigma: number;
  residualCount: number;
  /** The long memory of the scatter, in kilometres, and when it was last updated. */
  longSigma: number;
  longAt: number;
  /** The two-sided CUSUM of the normalised residuals, and the epoch of the last set at which both sides were at zero. */
  cusumPos: number;
  cusumNeg: number;
  cusumFrom: number;
  held: Held | null;
  candidate: Candidate | null;
  /** How many steps were raised as suspected on the object, and when the last was. */
  stepsRaised: number;
  lastRaisedAt: number;
  /** When the last candidate closed, whatever its end. */
  closedAt: number;
  /** The epoch of the object's first set, in milliseconds since 1970: its age is read from here. */
  firstEpoch: number;
  /** The object's accepted steps over the history's reach, oldest first, whatever verdict each got: what a new step is classed by. */
  steps: StepRecord[];
  /** How many sets arrived with an epoch on each of the last thirty days, by the day's number modulo thirty, with the day each bin stands for: the tracking cadence before a step is read from here, since the ring holds too few sets for a month of a low orbit. */
  dayCounts: number[];
  dayOf: number[];
  /** The alert raised on the object and still open for the fragments or a notice to confirm; null where none is. */
  alert: OpenAlert | null;
  /** Whether the object has been noted under its launch, so the launch's record is not searched on every set. */
  noted: boolean;
  /** The lowest and highest semi-major axis seen in each of the last twelve calendar months, for the maintenance test: a step back to a held altitude. */
  envelope: AltitudeEnvelope;
  /** What the caller's latest set said of the object's operational status and its dated end of contact, so the status of a body that is not the one being judged can be read as of an instant (the stage preference); absent until a set says it. */
  opsStatus?: OpsStatus;
  endedByMs?: number | null;
  endedFromMs?: number | null;
}

/** How many days of set counts the state keeps for the cadence. */
export const CADENCE_DAYS = 30;

export function newState(number: number): SeriesState {
  return {
    number,
    regime: "unknown",
    epochs: [],
    a: [],
    rp: [],
    inc: [],
    raan: [],
    argp: [],
    ma: [],
    bstar: [],
    meanMotion: [],
    meanMotionDot: [],
    resid: [],
    windowFrom: Number.NEGATIVE_INFINITY,
    shortSigma: 0,
    residualCount: 0,
    longSigma: 0,
    longAt: Number.NEGATIVE_INFINITY,
    cusumPos: 0,
    cusumNeg: 0,
    cusumFrom: Number.NEGATIVE_INFINITY,
    held: null,
    candidate: null,
    stepsRaised: 0,
    lastRaisedAt: Number.NEGATIVE_INFINITY,
    closedAt: Number.NEGATIVE_INFINITY,
    firstEpoch: Number.POSITIVE_INFINITY,
    steps: [],
    dayCounts: new Array<number>(CADENCE_DAYS).fill(0),
    dayOf: new Array<number>(CADENCE_DAYS).fill(Number.NEGATIVE_INFINITY),
    alert: null,
    noted: false,
    envelope: newEnvelope(),
  };
}

/** The state's envelope, made where the state was written before the envelope existed. */
export function envelopeOf(state: SeriesState): AltitudeEnvelope {
  if (state.envelope === undefined) state.envelope = newEnvelope();
  return state.envelope;
}

/** A copy of the state's envelope for a candidate to freeze. */
export const frozenEnvelope = (state: SeriesState): AltitudeEnvelope => snapshotEnvelope(envelopeOf(state));

/** Counts a set's epoch into the day bins. */
export function countDay(state: SeriesState, epochMs: number): void {
  const day = Math.floor(epochMs / DAY_MS);
  const bin = ((day % CADENCE_DAYS) + CADENCE_DAYS) % CADENCE_DAYS;
  if (state.dayOf[bin] !== day) {
    state.dayOf[bin] = day;
    state.dayCounts[bin] = 0;
  }
  state.dayCounts[bin]!++;
}

/** The sets a day the object had over the `days` whole days before the epoch's day, from the day bins, over the days the object has been seen at all where that is fewer; zero where the bins hold none of those days. */
export function cadenceBefore(state: SeriesState, epochMs: number, days: number): number {
  const day = Math.floor(epochMs / DAY_MS);
  const seen = Number.isFinite(state.firstEpoch) ? Math.max(1, Math.ceil((epochMs - state.firstEpoch) / DAY_MS)) : days;
  const span = Math.min(days, CADENCE_DAYS, seen);
  let sets = 0;
  for (let i = 0; i < CADENCE_DAYS; i++) if (state.dayOf[i]! < day && state.dayOf[i]! >= day - span) sets += state.dayCounts[i]!;
  return sets / span;
}

/** Whether the set's numbers can be read at all: finite, a positive mean motion, a bound orbit, and a drag derivative no faster than any orbit can rise. */
export function isReadable(set: ElementSet, params: DetectorParameters): boolean {
  const values = [set.epochMs, set.meanMotion, set.eccentricity, set.inclinationDeg, set.raanDeg, set.bstar, set.meanMotionDot];
  if (!values.every(Number.isFinite)) return false;
  if (set.meanMotion <= 0 || set.eccentricity < 0 || set.eccentricity >= 1) return false;
  return set.meanMotionDot >= params.junkMeanMotionDot;
}

/** The node's precession under J2, in degrees per day: `-1.5 J2 (Re/p)² n cos i`, the mean motion in revolutions a day. */
export function nodePrecessionDegPerDay(aKm: number, eccentricity: number, inclinationDeg: number, meanMotion: number): number {
  const p = aKm * (1 - eccentricity * eccentricity);
  const ratio = WGS84_EQUATORIAL_KM / p;
  return -1.5 * J2 * ratio * ratio * meanMotion * 360 * Math.cos((inclinationDeg * Math.PI) / 180);
}

/** What a foreign-set test reads of a reference set. */
interface Reference {
  epochMs: number;
  aKm: number;
  inclinationDeg: number;
  raanDeg: number;
  eccentricity: number;
  meanMotion: number;
  meanMotionDot: number;
}

/** Below this inclination, in degrees, the node is not defined well enough to test: a geostationary set's node swings freely. Physical. */
export const NODE_TEST_MIN_INCLINATION_DEG = 1;

/**
 * Whether a set is too far from a reference set to be the same object's:
 * the semi-major axis off the drag the two sets say the object is under
 * (the mean of their own drag rates over the gap between them), the
 * inclination, or the node off its J2 precession, by more than the bounds;
 * the node is not tested on a near-equatorial orbit, where it is
 * undefined. The drag is what keeps a sparse object decaying fast (sets
 * weeks apart, tens of kilometres lower each time) from being held as
 * foreign set after set.
 */
export function isForeign(reference: Reference, set: ElementSet, aKm: number, params: DetectorParameters): boolean {
  const days = (set.epochMs - reference.epochMs) / DAY_MS;
  const drag = (dragRateKmPerDay(reference.aKm, reference.meanMotion, reference.meanMotionDot) + dragRateKmPerDay(aKm, set.meanMotion, set.meanMotionDot)) / 2;
  if (Math.abs(aKm - (reference.aKm + drag * days)) > params.foreignDeltaAKm) return true;
  if (Math.abs(set.inclinationDeg - reference.inclinationDeg) > params.foreignDeltaIncDeg) return true;
  if (reference.inclinationDeg < NODE_TEST_MIN_INCLINATION_DEG || set.inclinationDeg < NODE_TEST_MIN_INCLINATION_DEG) return false;
  const expected = reference.raanDeg + nodePrecessionDegPerDay(reference.aKm, reference.eccentricity, reference.inclinationDeg, reference.meanMotion) * days;
  return Math.abs(wrapDegrees(set.raanDeg - expected)) > params.foreignRaanDeg;
}

function referenceAt(state: SeriesState, i: number): Reference {
  return { epochMs: state.epochs[i]!, aKm: state.a[i]!, inclinationDeg: state.inc[i]!, raanDeg: state.raan[i]!, eccentricity: 1 - state.rp[i]! / state.a[i]!, meanMotion: state.meanMotion[i]!, meanMotionDot: state.meanMotionDot[i]! };
}

const referenceOf = (held: Held): Reference => ({ epochMs: held.set.epochMs, aKm: held.aKm, inclinationDeg: held.set.inclinationDeg, raanDeg: held.set.raanDeg, eccentricity: held.set.eccentricity, meanMotion: held.set.meanMotion, meanMotionDot: held.set.meanMotionDot });

/** The index of the ring set at the epoch, or -1. */
export function indexOfEpoch(state: SeriesState, epochMs: number): number {
  for (let i = state.epochs.length - 1; i >= 0; i--) {
    const d = state.epochs[i]! - epochMs;
    if (Math.abs(d) <= SAME_EPOCH_MS) return i;
    if (d < 0) return -1;
  }
  return -1;
}

function writeAt(state: SeriesState, i: number, set: ElementSet, aKm: number): void {
  state.a[i] = aKm;
  state.rp[i] = aKm * (1 - set.eccentricity);
  state.inc[i] = set.inclinationDeg;
  state.raan[i] = set.raanDeg;
  state.argp[i] = set.argpDeg;
  state.ma[i] = set.meanAnomalyDeg;
  state.bstar[i] = set.bstar;
  state.meanMotion[i] = set.meanMotion;
  state.meanMotionDot[i] = set.meanMotionDot;
}

function spliceAt(state: SeriesState, i: number, set: ElementSet, aKm: number, residual: number): void {
  if (i === state.epochs.length) {
    state.epochs.push(set.epochMs);
    state.a.push(aKm);
    state.rp.push(aKm * (1 - set.eccentricity));
    state.inc.push(set.inclinationDeg);
    state.raan.push(set.raanDeg);
    state.argp.push(set.argpDeg);
    state.ma.push(set.meanAnomalyDeg);
    state.bstar.push(set.bstar);
    state.meanMotion.push(set.meanMotion);
    state.meanMotionDot.push(set.meanMotionDot);
    state.resid.push(residual);
    return;
  }
  state.epochs.splice(i, 0, set.epochMs);
  state.a.splice(i, 0, 0);
  state.rp.splice(i, 0, 0);
  state.inc.splice(i, 0, 0);
  state.raan.splice(i, 0, 0);
  state.argp.splice(i, 0, 0);
  state.ma.splice(i, 0, 0);
  state.bstar.splice(i, 0, 0);
  state.meanMotion.splice(i, 0, 0);
  state.meanMotionDot.splice(i, 0, 0);
  state.resid.splice(i, 0, residual);
  writeAt(state, i, set, aKm);
}

const columnsOf = (state: SeriesState): number[][] => [state.epochs, state.a, state.rp, state.inc, state.raan, state.argp, state.ma, state.bstar, state.meanMotion, state.meanMotionDot, state.resid];

/** Drops the ring's oldest set. */
function evictOldest(state: SeriesState): void {
  for (const column of columnsOf(state)) column.shift();
}

/** Removes the set at an index from the ring. */
export function removeAt(state: SeriesState, i: number): void {
  for (const column of columnsOf(state)) column.splice(i, 1);
  refreshScatter(state);
}

/** The ring's set at an index as the light row, for propagation: the publication time is not kept, the class is unknown, and the element set number and the second derivative are not kept either, which the propagation does not read. */
export function ringSetAt(state: SeriesState, i: number, designator: string | null): ElementSet {
  const aKm = state.a[i]!;
  return {
    number: state.number,
    designator,
    epochMs: state.epochs[i]!,
    createdMs: null,
    meanMotion: state.meanMotion[i]!,
    eccentricity: Math.max(0, 1 - state.rp[i]! / aKm),
    inclinationDeg: state.inc[i]!,
    raanDeg: state.raan[i]!,
    argpDeg: state.argp[i]!,
    meanAnomalyDeg: state.ma[i]!,
    bstar: state.bstar[i]!,
    meanMotionDot: state.meanMotionDot[i]!,
    meanMotionDdot: 0,
    elementSetNumber: 0,
    bodyClass: "unknown",
  };
}

/**
 * Screens a published set against the object's ring and says which sets
 * now need a prediction and a place in the ring: none for a set that is
 * unreadable, a re-publication (its values replace the earlier ones), an
 * older epoch (slotted in without a residual) or a set held as foreign;
 * the set itself in the plain case; and the held set then this one when
 * this one agrees with the held one, since the orbit really moved there.
 * The caller predicts each returned set against the ring as it stands,
 * then pushes it with `pushSet`, in order.
 */
export function screenSet(state: SeriesState, set: ElementSet, params: DetectorParameters): ElementSet[] {
  if (!isReadable(set, params)) return [];
  const aKm = semiMajorAxisOf(set);
  if (!Number.isFinite(aKm)) return [];
  const at = indexOfEpoch(state, set.epochMs);
  if (at !== -1) {
    writeAt(state, at, set, aKm);
    return [];
  }
  const n = state.epochs.length;
  if (n === 0) return [set];
  const last = n - 1;
  if (set.epochMs < state.epochs[last]!) {
    // An older epoch: slotted in where it belongs, unless the ring is full and it is older than all of it, or it is foreign to its neighbour.
    let i = n;
    while (i > 0 && state.epochs[i - 1]! > set.epochMs) i--;
    if (n >= params.ringSize && i === 0) return [];
    if (isForeign(referenceAt(state, i === 0 ? 0 : i - 1), set, aKm, params)) return [];
    countDay(state, set.epochMs);
    spliceAt(state, i, set, aKm, Number.NaN);
    if (state.epochs.length > params.ringSize) evictOldest(state);
    return [];
  }
  if (state.held !== null) {
    const held = state.held;
    if (Math.abs(held.set.epochMs - set.epochMs) <= SAME_EPOCH_MS) {
      state.held = { set, aKm };
      return [];
    }
    if (!isForeign(referenceOf(held), set, aKm, params)) {
      state.held = null;
      return [held.set, set];
    }
    if (!isForeign(referenceAt(state, last), set, aKm, params)) {
      state.held = null;
      return [set];
    }
    state.held = { set, aKm };
    return [];
  }
  if (isForeign(referenceAt(state, last), set, aKm, params)) {
    state.held = { set, aKm };
    return [];
  }
  return [set];
}

/** Appends a screened set as the ring's newest, with the residual its prediction left (NaN where there was none), evicting the oldest past the ring's size. */
export function pushSet(state: SeriesState, set: ElementSet, residual: number, params: DetectorParameters): void {
  const aKm = semiMajorAxisOf(set);
  if (set.epochMs < state.firstEpoch) state.firstEpoch = set.epochMs;
  countDay(state, set.epochMs);
  spliceAt(state, state.epochs.length, set, aKm, residual);
  const evicted = state.epochs.length > params.ringSize;
  if (evicted) evictOldest(state);
  state.regime = regimeOf(set);
  if (Number.isFinite(residual) || evicted) refreshScatter(state);
}

/** Recomputes the short scatter from the ring's residuals, after the ring changed. */
export function refreshScatter(state: SeriesState): void {
  const residuals = residualsOf(state);
  state.residualCount = residuals.length;
  state.shortSigma = residuals.length >= 3 ? robustScale(residuals) : 0;
}

/**
 * Forgets the residuals of a step that stayed: the set at the epoch and the
 * sets after it whose trailing window could hold it (`windowSets`), each
 * predicted across the step, so measuring the step and not the object's
 * noise. The sets further on were predicted from windows past it, as a
 * bundle of history brings them, and keep theirs.
 */
export function forgetResidualsAcross(state: SeriesState, epochMs: number, params: DetectorParameters): void {
  const first = state.epochs.findIndex((epoch) => epoch >= epochMs);
  if (first === -1) return;
  const last = Math.min(state.epochs.length - 1, first + params.windowSets[regimeKey(state.regime)]);
  let changed = false;
  for (let i = first; i <= last; i++) {
    if (!Number.isFinite(state.resid[i]!)) continue;
    state.resid[i] = Number.NaN;
    changed = true;
  }
  if (changed) refreshScatter(state);
}

/** The ring's values of a quantity. */
export function valuesOf(state: SeriesState, series: Series): number[] {
  return series === "a" ? state.a : series === "rp" ? state.rp : state.inc;
}

/** The regime the window parameters are read for: an object not yet filed is treated as low. */
export const regimeKey = (regime: Regime): Exclude<Regime, "unknown"> => (regime === "unknown" ? "LEO" : regime);

/**
 * The trailing window as `[from, to)` over the ring: the sets with an
 * epoch at or before `before`, the last `windowSets` of them that are no
 * older than `windowMaxDays` before the window's last set and no older
 * than the object's `windowFrom`.
 */
export function windowOf(state: SeriesState, params: DetectorParameters, before = Number.POSITIVE_INFINITY): [number, number] {
  let to = state.epochs.length;
  while (to > 0 && state.epochs[to - 1]! > before) to--;
  if (to === 0) return [0, 0];
  const key = regimeKey(state.regime);
  const oldest = Math.max(state.windowFrom, state.epochs[to - 1]! - params.windowMaxDays[key] * DAY_MS);
  let from = Math.max(0, to - params.windowSets[key]);
  while (from < to && state.epochs[from]! < oldest) from++;
  return [from, to];
}

/** The robust fit of a quantity over the trailing window, the fallback rate the last set's drag rate for the axis and the perigee radius and zero for the inclination; the residuals' scale is computed for the perigee radius and the inclination, and for the axis only where `withScale` asks (its hot path reads the coefficients alone). */
export function fitOf(state: SeriesState, series: Series, params: DetectorParameters, before = Number.POSITIVE_INFINITY, withScale = series !== "a"): Fit | null {
  const [from, to] = windowOf(state, params, before);
  if (to === from) return null;
  const last = to - 1;
  const rate = series === "inc" ? 0 : dragRateKmPerDay(state.a[last]!, state.meanMotion[last]!, state.meanMotionDot[last]!) * (series === "rp" ? state.rp[last]! / state.a[last]! : 1);
  return fitWindow(state.epochs, valuesOf(state, series), from, to, params, rate, withScale);
}

/** The drag term the object's window agrees on, in inverse Earth radii: the median of the window's values, so one set whose fit absorbed an event into its B* (a breakup can move it seventyfold) does not set the drag term the prediction is judged by. */
export function windowBstar(state: SeriesState, params: DetectorParameters, before = Number.POSITIVE_INFINITY): number {
  const [from, to] = windowOf(state, params, before);
  if (to === from) return 0;
  return median(state.bstar.slice(from, to));
}

/** The prior scatter of a new object, in kilometres: the regime's, grown with the drag term past the knee, and with the day's Sun and geomagnetic activity. */
export function priorSigma(regime: Regime, bstar: number, weatherFactor: number, params: DetectorParameters): number {
  return params.sigmaPrior[regimeKey(regime)] * Math.max(1, Math.abs(bstar) / params.sigmaPriorBstar) * weatherFactor;
}

/** The residuals the ring holds, those with a value. */
export function residualsOf(state: SeriesState): number[] {
  return state.resid.filter(Number.isFinite);
}

export interface OwnNoise {
  /** The scatter the prediction is judged by, in kilometres. */
  sigma: number;
  /** How many one-step-ahead residuals it rests on; below the parameter, the prior stands in. */
  residuals: number;
  /** The short robust scatter and the long memory it is floored by. */
  short: number;
  long: number;
  prior: number;
}

/**
 * The object's own scatter of the semi-major axis: the robust scatter of
 * its last residuals, floored by the long memory, once it has enough of
 * them; until then the prior, or the larger of the prior and the short
 * scatter once there are a few. Never below the format's own floor.
 */
export function ownNoise(state: SeriesState, prior: number, params: DetectorParameters): OwnNoise {
  const short = state.shortSigma;
  let sigma: number;
  if (state.residualCount >= params.residualsForScatter) sigma = Math.max(short, state.longSigma);
  else sigma = Math.max(prior, short);
  return { sigma: Math.max(SIGMA_FLOOR_KM, sigma), residuals: state.residualCount, short, long: state.longSigma, prior };
}

/**
 * Folds a residual into the long memory: an exponential average of the
 * residual's size, clipped at `longMemoryClipSigmas` times the current scatter so
 * one step does not become the object's noise, scaled to a Gaussian sigma
 * (the mean absolute deviation is 0.798 of it), decaying with the
 * half-life in days.
 */
export function rememberResidual(state: SeriesState, residual: number, sigma: number, epochMs: number, params: DetectorParameters): void {
  const size = Math.min(Math.abs(residual), params.longMemoryClipSigmas * sigma) * 1.2533;
  if (!Number.isFinite(state.longAt)) {
    state.longSigma = size;
    state.longAt = epochMs;
    return;
  }
  const days = Math.max(0, epochMs - state.longAt) / DAY_MS;
  const keep = Math.pow(0.5, days / params.longHalfLifeDays);
  // A new object's few residuals weigh more, so the memory settles in a handful of sets rather than a season.
  const weight = Math.max(1 - keep, 1 / Math.max(2, state.residualCount));
  state.longSigma = (1 - weight) * state.longSigma + weight * size;
  state.longAt = epochMs;
}

/** The index of the first set after the step, or -1. */
export function firstAfter(state: SeriesState, epochMs: number): number {
  for (let i = 0; i < state.epochs.length; i++) if (state.epochs[i]! > epochMs) return i;
  return -1;
}
