import { WGS84_EQUATORIAL_KM } from "@orbinauts/engine";
import type { DetectorInput, DetectorOutput, LogRow, Verdict } from "./detector.ts";
import { regimeOf, semiMajorAxisOf, type ElementSet } from "./elements.ts";
import { bandOf, environmentOf, statsFor, weatherOf, type BandStats, type Measurement, type Weather } from "./environment.ts";
import { ORIGINS, OUTCOMES, PHASES, logRow, regimeIndex, round5, type SignalName } from "./log.ts";
import { predictAt, predictionSigma, type Fit, type Prediction } from "./model.ts";
import { parametersWith, type DetectorParameters } from "./params.ts";
import { fitOf, firstAfter, indexOfEpoch, newState, ownNoise, priorSigma, pushSet, removeAt, rememberResidual, screenSet, windowBstar, type Candidate, type OwnNoise, type SeriesState } from "./series.ts";
import { advanceCusum, estimateStep, resetCusum, type Environment, type StepEstimate } from "./step.ts";
import { BODY_CLASSES, launchOf, type Regime } from "./truth.ts";

/**
 * One run of the detector over the sets published since the last, in
 * three passes. Measure: each set is screened against its object's ring,
 * predicted from the object's trailing model (or, for a post set of a
 * live candidate, from the candidate's frozen pre-step model), and pushed
 * into the ring with the residual it left. Environment: the residuals of
 * the run are read by band for the day's common-mode drag and live
 * scale, and the space-weather indices for the storm hold and the prior.
 * Decide: each residual is normalised with its band's values; a first set
 * past the candidate threshold opens a candidate on a bracket from the
 * last set before it to itself, and a watch verdict shows it on a quiet
 * object; each later set re-estimates the step, and the candidate is
 * raised as suspected when the step persists across enough sets over
 * enough hours, dismissed when the next sets undo it, or closed after
 * the last gap it was allowed. Candidates that saw no set for too long
 * lapse at the end of the run, their unconfirmed set dropped so the step
 * is measured afresh when the next set comes.
 *
 * In this phase every persistent step is suspected, whatever the object:
 * the manoeuvre classing and the fragment confirmation of later phases
 * are what turn a working payload's station-keeping into a manoeuvre
 * verdict and a suspected step into a confirmed one.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** How long after a candidate closed, in days, and after a step was raised, in days, an object counts as quiet for a watch verdict. Policy: a month and a year. */
export const QUIET_AFTER_CLOSE_DAYS = 30;
export const QUIET_AFTER_RAISE_DAYS = 365;

/** What the scorecard names this detector. */
export const DETECTOR_NAME = "step-v1";

/** A set accepted in the measure pass, with what was predicted for it, carried to the decide pass. */
interface Pending {
  state: SeriesState;
  set: ElementSet;
  aKm: number;
  regime: Regime;
  band: string;
  perigeeHeightKm: number;
  /** The epoch of the ring's last set before this one, the bracket's first edge if this set opens a candidate; -Infinity for the object's first set. */
  previousEpoch: number;
  /** The drag term of the window the set was predicted from. */
  windowBstar: number;
  /** Whether the set is a post set of a live candidate. */
  post: boolean;
  fit: Fit | null;
  noise: OwnNoise | null;
  prediction: Prediction | null;
  measurement: Measurement | null;
}

interface RunContext {
  now: number;
  params: DetectorParameters;
  weather: Weather;
  verdicts: Verdict[];
  log: LogRow[];
  recentCandidates: number;
  /** The candidates judged in this run, each once, on the ring as it stands after the measure pass. */
  judged: Set<Candidate>;
}

const regimeKey = (regime: Regime): Exclude<Regime, "unknown"> => (regime === "unknown" ? "LEO" : regime);

/** The measure pass for one set: screened, predicted, pushed. */
function measure(state: SeriesState, set: ElementSet, context: RunContext, pending: Pending[]): void {
  const { params, weather } = context;
  for (const accepted of screenSet(state, set, params)) {
    const aKm = semiMajorAxisOf(accepted);
    const regime = state.epochs.length === 0 ? regimeOf(accepted) : state.regime;
    const perigeeHeightKm = aKm * (1 - accepted.eccentricity) - WGS84_EQUATORIAL_KM;
    const band = bandOf(regime, perigeeHeightKm);
    const previousEpoch = state.epochs.length === 0 ? Number.NEGATIVE_INFINITY : state.epochs[state.epochs.length - 1]!;
    const kappa = params.kappa[regimeKey(regime)];
    const item: Pending = { state, set: accepted, aKm, regime, band, perigeeHeightKm, previousEpoch, windowBstar: accepted.bstar, post: false, fit: null, noise: null, prediction: null, measurement: null };
    const candidate = state.candidate;
    if (candidate !== null && accepted.epochMs > candidate.beforeEpoch) {
      item.post = true;
      item.windowBstar = candidate.bstar;
      const prediction = predictAt(candidate.pre, accepted.epochMs);
      const sigmaPred = predictionSigma(candidate.sigmaOwn, prediction.leverage, prediction.gapDays, candidate.bstar, kappa, weather.dragFactor);
      item.prediction = prediction;
      item.measurement = { band, regime, residual: aKm - prediction.value, sigmaPred, gapDays: prediction.gapDays, bstar: candidate.bstar };
      pushSet(state, accepted, Number.NaN, params);
    } else {
      const fit = fitOf(state, "a", params);
      if (fit === null) {
        pushSet(state, accepted, Number.NaN, params);
      } else {
        const bstar = windowBstar(state, params);
        const noise = ownNoise(state, priorSigma(regime, bstar, weather.priorFactor, params), params);
        const prediction = predictAt(fit, accepted.epochMs);
        const residual = aKm - prediction.value;
        const sigmaPred = predictionSigma(noise.sigma, prediction.leverage, prediction.gapDays, bstar, kappa, weather.dragFactor);
        item.windowBstar = bstar;
        item.fit = fit;
        item.noise = noise;
        item.prediction = prediction;
        item.measurement = { band, regime, residual, sigmaPred, gapDays: prediction.gapDays, bstar };
        pushSet(state, accepted, residual, params);
        rememberResidual(state, residual, noise.sigma, accepted.epochMs, params);
      }
    }
    pending.push(item);
  }
}

/** The signals every row of a candidate carries. */
function baseSignals(state: SeriesState, candidate: Candidate, item: Pending, stats: BandStats, context: RunContext): Partial<Record<SignalName, number>> {
  return {
    origin: ORIGINS[candidate.origin],
    regime: regimeIndex(state.regime),
    bodyClass: BODY_CLASSES.indexOf(item.set.bodyClass),
    beforeEpoch: candidate.beforeEpoch,
    afterEpoch: candidate.afterEpoch,
    delta1: candidate.delta1,
    z1: candidate.z1,
    sigmaOwn: candidate.sigmaOwn,
    sigmaPred: candidate.sigma1,
    bandScale1: candidate.bandScale1,
    commonMode1: candidate.commonMode1,
    gapHours: (candidate.afterEpoch - candidate.beforeEpoch) / HOUR_MS,
    bstar: candidate.bstar,
    bstarRatio: candidate.bstarRatio,
    perigeeKm: item.perigeeHeightKm,
    kpMax: context.weather.kpMax,
    f107: context.weather.f107,
    stormHold: context.weather.stormHold ? 1 : 0,
    recentCandidates: context.recentCandidates,
    preSets: candidate.pre.n,
    residuals: candidate.residuals,
  };
}

function estimateSignals(candidate: Candidate, estimate: StepEstimate): Partial<Record<SignalName, number>> {
  return {
    deltaKm: estimate.delta,
    zk: estimate.z,
    k: estimate.k,
    spanHours: estimate.spanHours,
    rhoMedian: estimate.rhoMedian,
    slope: estimate.slope,
    stepEvidence: estimate.evidence,
    deltaPerigeeKm: estimate.deltaPerigee,
    zPerigee: estimate.zPerigee,
    deltaInclinationDeg: estimate.deltaInclination,
    zInclination: estimate.zInclination,
    cusumPos: candidate.cusumAtOpen,
    z2: candidate.z2,
    rho2: candidate.rho2,
    evidence2: candidate.evidence2,
    span2: candidate.span2,
    z3: candidate.z3,
    rho3: candidate.rho3,
    evidence3: candidate.evidence3,
    span3: candidate.span3,
  };
}

/** The signals a verdict carries as its evidence: the numbers it was judged by, by the log's names. */
const EVIDENCE: readonly SignalName[] = ["regime", "bodyClass", "delta1", "z1", "deltaKm", "zk", "k", "spanHours", "rhoMedian", "slope", "stepEvidence", "deltaPerigeeKm", "deltaInclinationDeg", "sigmaOwn", "sigmaPred", "bandScale1", "gapHours", "bstar", "bstarRatio", "perigeeKm", "kpMax", "stormHold", "recentCandidates"];

function evidenceOf(signals: Partial<Record<SignalName, number>>, params: DetectorParameters): Record<string, number> {
  const evidence: Record<string, number> = {};
  for (const name of EVIDENCE) {
    const value = signals[name];
    if (value !== undefined && Number.isFinite(value)) evidence[name] = round5(value);
  }
  evidence.zPersist = params.zPersist;
  return evidence;
}

function verdictOf(state: SeriesState, candidate: Candidate, item: Pending, verdictState: Verdict["state"], estimate: StepEstimate | null, evidence: Record<string, number>, reasons: string[], now: number): Verdict {
  const step = estimate === null
    ? { beforeEpoch: candidate.beforeEpoch, afterEpoch: candidate.afterEpoch, deltaKm: candidate.delta1, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 1, z: candidate.z1 }
    : { beforeEpoch: candidate.beforeEpoch, afterEpoch: candidate.afterEpoch, deltaKm: estimate.delta, deltaPerigeeKm: estimate.deltaPerigee, deltaApogeeKm: 2 * estimate.delta - estimate.deltaPerigee, deltaInclinationDeg: estimate.deltaInclination, postSets: estimate.k, z: estimate.z };
  return {
    kind: "object",
    state: verdictState,
    number: state.number,
    launch: launchOf(item.set.designator),
    raisedAt: now,
    step,
    event: { at: candidate.tStep, from: candidate.beforeEpoch, to: candidate.afterEpoch },
    evidence,
    reasons,
  };
}

/** Whether the object is quiet enough for a watch verdict to show its first post set: its own scatter is measured, nothing closed on it lately, no step was raised on it this year, and the jump alone would pass the persistence size. */
function isQuiet(state: SeriesState, noise: OwnNoise, z1: number, context: RunContext): boolean {
  const { params, now } = context;
  return noise.residuals >= params.residualsForScatter && now - state.closedAt > QUIET_AFTER_CLOSE_DAYS * DAY_MS && now - state.lastRaisedAt > QUIET_AFTER_RAISE_DAYS * DAY_MS && Math.abs(z1) >= params.zPersist;
}

/** Opens a candidate on a bracket and freezes the pre fits at the bracket's first edge. */
function openCandidate(state: SeriesState, origin: Candidate["origin"], beforeEpoch: number, afterEpoch: number, pre: Fit, noise: OwnNoise, bstar: number, stats: BandStats, context: RunContext): Candidate | null {
  const cusumAtOpen = Math.max(state.cusumPos, state.cusumNeg);
  const preRp = fitOf(state, "rp", context.params, beforeEpoch);
  const preInc = fitOf(state, "inc", context.params, beforeEpoch);
  if (preRp === null || preInc === null) return null;
  const kappa = context.params.kappa[regimeKey(state.regime)];
  const prediction = predictAt(pre, afterEpoch);
  const first = indexOfEpoch(state, afterEpoch);
  if (first === -1) return null;
  const sigma1 = predictionSigma(noise.sigma, prediction.leverage, prediction.gapDays, bstar, kappa, context.weather.dragFactor) * stats.scale;
  const delta1 = state.a[first]! - prediction.value - stats.commonMode * bstar * prediction.gapDays;
  const candidate: Candidate = {
    openedAt: context.now,
    origin,
    beforeEpoch,
    afterEpoch,
    tStep: (beforeEpoch + afterEpoch) / 2,
    pre,
    preRp,
    preInc,
    sigmaOwn: noise.sigma,
    bstar,
    delta1,
    z1: delta1 / sigma1,
    sigma1,
    bandScale1: stats.scale,
    commonMode1: stats.commonMode,
    postSets: 1,
    lastPostEpoch: afterEpoch,
    bstarRatio: bstar === 0 ? Number.NaN : Math.abs(state.bstar[first]! / bstar),
    residuals: noise.residuals,
    cusumAtOpen,
    watched: false,
    suspected: false,
    lastPostAt: context.now,
    z2: Number.NaN,
    rho2: Number.NaN,
    evidence2: Number.NaN,
    span2: Number.NaN,
    z3: Number.NaN,
    rho3: Number.NaN,
    evidence3: Number.NaN,
    span3: Number.NaN,
  };
  state.candidate = candidate;
  context.recentCandidates++;
  resetCusum(state, afterEpoch);
  return candidate;
}

/**
 * Closes the candidate. A bad set, or a lapsed one no later set
 * confirmed, leaves the ring so it neither bends the model nor counts as
 * noise; where the orbit stayed moved, the window restarts on the post
 * sets; and the object remembers when it closed and what was raised.
 */
function closeCandidate(state: SeriesState, candidate: Candidate, outcome: number, estimate: StepEstimate | null, context: RunContext): void {
  const dropFirst = outcome === OUTCOMES.reverted || (outcome === OUTCOMES.lapsed && candidate.postSets <= 1);
  if (dropFirst) {
    const first = indexOfEpoch(state, candidate.afterEpoch);
    if (first !== -1) removeAt(state, first);
  } else if (outcome === OUTCOMES.suspected || outcome === OUTCOMES.lapsed || (estimate !== null && Math.abs(estimate.rhoMedian) >= context.params.rhoRevert)) {
    state.windowFrom = candidate.afterEpoch;
  }
  if (outcome === OUTCOMES.suspected) {
    state.stepsRaised++;
    state.lastRaisedAt = context.now;
  }
  state.closedAt = context.now;
  state.candidate = null;
}

/** The gates a live candidate is judged by on a post set: the outcome and the reasons. */
function judge(candidate: Candidate, estimate: StepEstimate, regime: Regime, context: RunContext): { outcome: number; reasons: string[] } {
  const { params, weather } = context;
  const reasons: string[] = [];
  if (estimate.k >= 2 && Number.isFinite(estimate.rhoMedian) && Math.abs(estimate.rhoMedian) < params.rhoRevert) {
    reasons.push(`the ${estimate.k - 1} set${estimate.k > 2 ? "s" : ""} after the first kept ${estimate.rhoMedian.toFixed(2)} of its jump: a bad set`);
    return { outcome: OUTCOMES.reverted, reasons };
  }
  const stressed = context.recentCandidates >= params.stressCandidatesPerDay || weather.stormHold;
  const minSets = stressed ? params.persistMinSetsUnderStress : params.persistMinSets;
  const enoughSets = estimate.k >= params.persistMinSetsAlone || (estimate.k >= minSets && estimate.spanHours >= params.persistMinSpanHours[regimeKey(regime)]);
  const inBand = Number.isFinite(estimate.rhoMedian) && estimate.rhoMedian >= params.rhoMin && estimate.rhoMedian <= params.rhoMax;
  const persistent = Math.abs(estimate.z) >= params.zPersist && inBand && estimate.evidence >= params.evidenceMin;
  if (enoughSets && persistent) {
    reasons.push(`a step of ${estimate.delta.toFixed(3)} km holds over ${estimate.k} post sets spanning ${estimate.spanHours.toFixed(1)} h: ${estimate.z.toFixed(1)} sigma, the later sets keep ${estimate.rhoMedian.toFixed(2)} of the first jump, evidence ${estimate.evidence.toFixed(1)} against a drift`);
    if (stressed) reasons.push(weather.stormHold ? `three post sets were required under a storm hold (Kp ${weather.kpMax})` : `three post sets were required under run stress (${context.recentCandidates} candidates in a day)`);
    return { outcome: OUTCOMES.suspected, reasons };
  }
  if (estimate.k >= params.maxPostSets) {
    reasons.push(`after ${estimate.k} post sets: ${estimate.z.toFixed(1)} sigma, the later sets keep ${estimate.rhoMedian.toFixed(2)} of the first jump, evidence ${estimate.evidence.toFixed(1)}: not a persistent step`);
    return { outcome: OUTCOMES.faded, reasons };
  }
  return { outcome: OUTCOMES.open, reasons };
}

/** Records the trajectory's second and third points on the candidate, for the sweeps. */
function recordTrajectory(candidate: Candidate, estimate: StepEstimate): void {
  if (estimate.k >= 2 && Number.isNaN(candidate.z2)) [candidate.z2, candidate.rho2, candidate.evidence2, candidate.span2] = [estimate.z, estimate.rhoMedian, estimate.evidence, estimate.spanHours];
  if (estimate.k >= 3 && Number.isNaN(candidate.z3)) [candidate.z3, candidate.rho3, candidate.evidence3, candidate.span3] = [estimate.z, estimate.rhoMedian, estimate.evidence, estimate.spanHours];
}

/** The decide pass for a post set of a live candidate: the candidate judged once in the run, on every post set the ring holds. */
function advance(item: Pending, stats: BandStats, context: RunContext): void {
  const state = item.state;
  const candidate = state.candidate;
  if (candidate === null || context.judged.has(candidate)) return;
  context.judged.add(candidate);
  candidate.lastPostAt = context.now;
  const environment: Environment = { commonMode: stats.commonMode, scale: stats.scale, weather: context.weather.dragFactor };
  const estimate = estimateStep(state, candidate, environment, context.params);
  if (estimate === null) {
    // The post sets left the ring before they were judged (a burst of sets in one run, more than the ring holds past the window): the candidate is closed unjudged rather than left open to silence the object.
    context.log.push(logRow(context.now, state.number, { ...baseSignals(state, candidate, item, stats, context), k: candidate.postSets, phase: PHASES.close, outcome: OUTCOMES.faded }));
    closeCandidate(state, candidate, OUTCOMES.faded, null, context);
    return;
  }
  candidate.postSets = estimate.k;
  candidate.lastPostEpoch = estimate.lastEpoch;
  recordTrajectory(candidate, estimate);
  const { outcome, reasons } = judge(candidate, estimate, state.regime, context);
  if (outcome === OUTCOMES.open) return;
  const signals = { ...baseSignals(state, candidate, item, stats, context), ...estimateSignals(candidate, estimate), phase: PHASES.close, outcome };
  context.log.push(logRow(context.now, state.number, signals));
  if (outcome === OUTCOMES.suspected) {
    candidate.suspected = true;
    context.verdicts.push(verdictOf(state, candidate, item, "suspected", estimate, evidenceOf(signals, context.params), reasons, context.now));
  } else if (candidate.watched) {
    context.verdicts.push(verdictOf(state, candidate, item, "dismissed", estimate, evidenceOf(signals, context.params), reasons, context.now));
  }
  closeCandidate(state, candidate, outcome, estimate, context);
}

/** The decide pass for a set predicted from the object's own trailing model: the step and CUSUM tests, and a candidate opened where either fires. */
function decide(item: Pending, stats: BandStats, context: RunContext): void {
  const { params } = context;
  const state = item.state;
  const measurement = item.measurement!;
  const residual = measurement.residual - stats.commonMode * measurement.bstar * measurement.gapDays;
  const z = residual / (measurement.sigmaPred * stats.scale);
  if (state.candidate !== null) {
    // A candidate opened earlier in this run on the same object: this set is its post set, judged as one.
    if (item.set.epochMs > state.candidate.beforeEpoch) advance(item, stats, context);
    return;
  }
  const alarm = Number.isFinite(item.previousEpoch) && advanceCusum(state, z, item.previousEpoch, params);
  const noise = item.noise!;
  let candidate: Candidate | null = null;
  if (Math.abs(z) >= params.zCand) {
    candidate = openCandidate(state, "step", item.previousEpoch, item.set.epochMs, item.fit!, noise, item.windowBstar, stats, context);
  } else if (alarm) {
    const first = firstAfter(state, state.cusumFrom);
    const pre = fitOf(state, "a", params, state.cusumFrom);
    if (first !== -1 && pre !== null && state.epochs[first]! < item.set.epochMs) candidate = openCandidate(state, "cusum", state.cusumFrom, state.epochs[first]!, pre, noise, windowBstar(state, params, state.cusumFrom), stats, context);
    if (candidate === null) resetCusum(state, item.set.epochMs);
  }
  if (candidate === null) return;
  if (candidate.origin === "step" && isQuiet(state, noise, candidate.z1, context)) {
    candidate.watched = true;
    const signals = { ...baseSignals(state, candidate, item, stats, context), phase: PHASES.open, outcome: OUTCOMES.open, k: 1 };
    const reasons = [`one set moved the semi-major axis ${candidate.delta1.toFixed(3)} km from the object's own model, ${candidate.z1.toFixed(1)} sigma, on a quiet object: to be judged by the next`];
    context.verdicts.push(verdictOf(state, candidate, item, "watch", null, evidenceOf(signals, context.params), reasons, context.now));
  }
  // A CUSUM candidate already has its post sets in the ring: judge it now.
  if (candidate.origin === "cusum") advance(item, stats, context);
}

/** Candidates that saw no post set in too long for their regime lapse, at the end of the run. */
function lapse(states: Map<number, SeriesState>, context: RunContext): void {
  for (const state of states.values()) {
    const candidate = state.candidate;
    if (candidate === null) continue;
    const days = context.params.lapseDays[regimeKey(state.regime)];
    if (context.now - candidate.lastPostAt <= days * DAY_MS) continue;
    context.log.push(logRow(context.now, state.number, { phase: PHASES.close, outcome: OUTCOMES.lapsed, origin: ORIGINS[candidate.origin], regime: regimeIndex(state.regime), beforeEpoch: candidate.beforeEpoch, afterEpoch: candidate.afterEpoch, delta1: candidate.delta1, z1: candidate.z1, k: candidate.postSets, bstar: candidate.bstar, sigmaOwn: candidate.sigmaOwn, residuals: candidate.residuals, z2: candidate.z2, rho2: candidate.rho2, evidence2: candidate.evidence2, span2: candidate.span2 }));
    if (candidate.watched) {
      context.verdicts.push({ kind: "object", state: "dismissed", number: state.number, launch: null, raisedAt: context.now, step: { beforeEpoch: candidate.beforeEpoch, afterEpoch: candidate.afterEpoch, deltaKm: candidate.delta1, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: candidate.postSets, z: candidate.z1 }, event: null, evidence: { delta1: round5(candidate.delta1), z1: round5(candidate.z1), k: candidate.postSets, lapseDays: days }, reasons: [`no further set followed within ${days} days; the step will be measured again when one comes`] });
    }
    closeCandidate(state, candidate, OUTCOMES.lapsed, null, context);
  }
}

/** How many candidates opened across the catalogue in the last day, as the states remember them. */
function recentCandidatesOf(states: Map<number, SeriesState>, now: number): number {
  let count = 0;
  const since = now - DAY_MS;
  for (const state of states.values()) if (state.candidate !== null && state.candidate.openedAt >= since) count++;
  return count;
}

/**
 * One run of the detector: the sets published since the last run, the
 * states the last run returned, the run's instant and the day's weather
 * in; the states, the verdicts and the log out.
 */
export function runDetector(input: DetectorInput): DetectorOutput {
  const params = parametersWith(input.parameters);
  const states = input.states as Map<number, SeriesState>;
  const context: RunContext = { now: input.now, params, weather: weatherOf(input.space, params), verdicts: [], log: [], recentCandidates: 0, judged: new Set() };
  const pending: Pending[] = [];
  for (const set of input.sets) {
    let state = states.get(set.number);
    if (state === undefined) {
      state = newState(set.number);
      states.set(set.number, state);
    }
    measure(state, set, context, pending);
  }
  const measurements: Measurement[] = [];
  for (const item of pending) if (item.measurement !== null) measurements.push(item.measurement);
  const stats = environmentOf(measurements, params);
  context.recentCandidates = recentCandidatesOf(states, input.now);
  for (const item of pending) {
    if (item.measurement === null) continue;
    const band = statsFor(stats, item.band, item.regime);
    if (item.post) advance(item, band, context);
    else decide(item, band, context);
  }
  lapse(states, context);
  return { states, launches: input.launches, verdicts: context.verdicts, log: context.log };
}
