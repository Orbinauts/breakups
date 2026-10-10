import { WGS84_EQUATORIAL_KM } from "@orbinauts/engine";
import type { DetectorInput, DetectorOutput, EventEstimate, LogRow, Notice, Step, Verdict } from "./detector.ts";
import { OPS_STATUSES, isWorkingStatus, operationalAt, regimeOf, semiMajorAxisOf, type ElementSet, type OpsStatus } from "./elements.ts";
import { bandOf, environmentOf, statsFor, weatherOf, type BandStats, type Measurement, type Weather } from "./environment.ts";
import { eventFromPieces, eventTimeOf, originTested, overridesHistory, passesOrigin, type PiecesEventTime } from "./event-time.ts";
import { catalogueFor, cloudBodies, isAnalystLaunch, isFragmentClass, judgeCloud, launchCodeOf, launchFor, launchKeyOf, ledgerOf, nearestCloudDistance, noteBody, noteCloud, piecesWithin, planeDistance, planeOrbitOf, type CatalogueRecord, type CloudVerdict, type LaunchRecord, type ParentCandidate, type PieceReading, type PlaneOrbit } from "./fragments.ts";
import { alertSignals, cadenceAfter, closingOutcome, daysAfterStep, judgeStep, noteDamage, openAlert, persistent, trackAlert, type ConfirmationReading, type OpenAlert, type StepJudgement } from "./fusion.ts";
import { impulseOf, type Impulse } from "./impulse.ts";
import { ATTRIBUTION_PATHS, HISTORY_REFUSALS, ORIGINS, OUTCOMES, PHASES, REFUSALS, logRow, regimeIndex, round5, type SignalName } from "./log.ts";
import { heldLevel, noteLevel, returnMissKm, type HeldLevel } from "./maintenance.ts";
import { MANOEUVRE_CLASSES, atypicalReasons, atypicalTests, classify, featuresOf, recordStep, type CurrentStep, type HistoryFeatures, type ManoeuvreClass } from "./manoeuvre.ts";
import { median, predictAt, predictionSigma, type Fit, type Prediction } from "./model.ts";
import { parametersWith, type DetectorParameters } from "./params.ts";
import { cadenceBefore, envelopeOf, fitOf, firstAfter, frozenEnvelope, indexOfEpoch, newState, ownNoise, priorSigma, pushSet, removeAt, rememberResidual, ringSetAt, screenSet, windowBstar, type Candidate, type OwnNoise, type SeriesState } from "./series.ts";
import { matesOf, noteLedgerStep, siblingsOf, towardsMates, type LedgerStep, type Mates, type Siblings } from "./siblings.ts";
import { inScope, passesGates, type ScopeSubject, type ScopeTier } from "./scope.ts";
import { advanceCusum, estimateStep, resetCusum, type Environment, type StepEstimate } from "./step.ts";
import { BODY_CLASSES, launchOf, type BodyClass, type Regime } from "./truth.ts";

/**
 * One run of the detector over the sets published since the last, in
 * passes. Measure: each set is screened against its object's ring,
 * predicted from the object's trailing model (or, for a post set of a
 * live candidate, from the candidate's frozen pre-step model), and pushed
 * into the ring with the residual it left; a set of a body the detector
 * had not seen notes the body under its launch. Environment: the
 * residuals of the run are read by band for the day's common-mode drag
 * and live scale, and the space-weather indices for the storm hold and
 * the prior. Decide: each residual is normalised with its band's values;
 * a first set past the candidate threshold opens a candidate on a bracket
 * from the last set before it to itself, and a watch verdict shows it on
 * a quiet object; each later set re-estimates the step, and the candidate
 * is closed as a persistent step when the step holds across enough sets
 * over enough hours, dismissed when the next sets undo it, or closed
 * after the last gap it was allowed. Candidates that saw no set for too
 * long lapse at the end of the run, their unconfirmed set dropped so the
 * step is measured afresh when the next set comes.
 *
 * A persistent step is then read against everything the detector knows
 * of the object: the impulse it implies and the object's accepted steps
 * over the last two years class it (`manoeuvre.ts`); its post-step level
 * is read against the altitudes the object held in the last year
 * (`maintenance.ts`); the steps of its launch-mates and shell-mates in
 * the weeks before, and where its launch's other payloads fly, say
 * whether it moved alone (`siblings.ts`); and the catalogue's class and
 * operational status say whether it could have burned. The fusion
 * (`judgeStep` in `fusion.ts`) raises it as suspected where no manoeuvre
 * explanation applies or a breakup signature overrides them; otherwise
 * the verdict is a manoeuvre, a terminal verdict the scorecard counts as
 * nothing. Either way the step joins the object's record and the
 * catalogue's ledger of recent steps, and opens an alert (`fusion.ts`)
 * that stays for the policy's time to live, reading the object's later
 * sets for the persistence tiers the scorecard sweeps and for the damage
 * after the step. A suspected step is also timed (`event-time.ts`) from
 * the two sets either side of it.
 *
 * Launches: every launch the run brought new bodies to is judged
 * (`fragments.ts`) for a burst over its own background and for pieces
 * that are new by numbering and share a parent's plane. Such pieces
 * first published after an open alert's step confirm it, under the rules
 * of `judgeConfirmation` below, which keep a cloud still being catalogued
 * from confirming the next step on any body of its launch; a notice
 * naming the object confirms it too; a burst with consistent pieces and
 * no alert on any parent is listed for review as a cloud, never a
 * detection. An alert nothing confirmed expires at the time to live, or
 * is dismissed where bodies came under the launch and every one was old.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** How long after a candidate closed, in days, and after a step was raised, in days, an object counts as quiet for a watch verdict. Policy: a month and a year. */
export const QUIET_AFTER_CLOSE_DAYS = 30;
export const QUIET_AFTER_RAISE_DAYS = 365;

/** What the scorecard names this detector. */
export const DETECTOR_NAME = "confirmed-v9";

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
  /** The alerts tracked in this run, each once. */
  tracked: Set<OpenAlert>;
  states: Map<number, SeriesState>;
  launches: Map<string, unknown>;
  catalogue: CatalogueRecord;
  /** The launches the run brought new bodies to, with how many. */
  newBodies: Map<string, number>;
  notices: Notice[];
  /** The reentries the caller passed, by catalogue number (`DetectorInput.decays`). */
  decays: ReadonlyMap<number, number>;
}

const regimeKey = (regime: Regime): Exclude<Regime, "unknown"> => (regime === "unknown" ? "LEO" : regime);

/** The measure pass for one set: screened, predicted, pushed, and the body noted under its launch. */
function measure(state: SeriesState, set: ElementSet, context: RunContext, pending: Pending[]): void {
  const { params, weather } = context;
  const firstEpochBefore = state.firstEpoch;
  // What the set says of the object's status, kept so it can be read as of an instant when the object is not the one being judged.
  [state.opsStatus, state.endedByMs, state.endedFromMs] = [set.opsStatus, set.endedByMs, set.endedFromMs];
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
  // The body under its launch, on the first set of it the detector sees; an older set of a known body only lowers its earliest epoch.
  if (!state.noted || set.epochMs < firstEpochBefore) {
    const record = noteBody(context.launches, set, context.now);
    state.noted = true;
    if (record !== null) {
      const key = launchKeyOf(set)!;
      context.newBodies.set(key, (context.newBodies.get(key) ?? 0) + 1);
    }
  }
}

/** The signals every row of a candidate carries. */
function baseSignals(state: SeriesState, candidate: Candidate, item: Pending, context: RunContext): Partial<Record<SignalName, number>> {
  return {
    origin: ORIGINS[candidate.origin],
    regime: regimeIndex(state.regime),
    bodyClass: BODY_CLASSES.indexOf(item.set.bodyClass),
    beforeEpoch: candidate.beforeEpoch,
    afterEpoch: candidate.afterEpoch,
    delta1: candidate.delta1,
    z1: candidate.z1,
    sigmaOwn: candidate.sigmaOwn,
    sigmaShort: candidate.sigmaShort,
    sigmaLong: candidate.sigmaLong,
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
    cadenceBefore: candidate.cadenceBefore,
  };
}

/** What a persistent step was read as: the impulse it implies, the object's history at it, its class and the atypical tests it passed; the sixth phase's readings (the held altitudes, the siblings, the mates, the status); and the fusion's judgement of them all. */
interface Reading {
  impulse: Impulse;
  step: CurrentStep;
  features: HistoryFeatures;
  manoeuvreClass: ManoeuvreClass;
  atypical: string[];
  held: HeldLevel;
  siblings: Siblings;
  mates: Mates;
  towards: boolean;
  opsStatus: OpsStatus;
  judgement: StepJudgement;
  /** The parent at the step as the scope reads it, whether it is in the scope, and whether the step also passes the scope's gates. */
  subject: ScopeSubject;
  scopeIn: boolean;
  scoped: boolean;
  /** The step as the catalogue's ledger will keep it, where it is persistent. */
  ledgerStep: LedgerStep;
}

/** The altitude an object's state gives, its ring's last set; null where it has none. */
function altitudeOf(states: Map<number, SeriesState>, number: number): number | null {
  const state = states.get(number);
  if (state === undefined || state.epochs.length === 0) return null;
  return state.a[state.epochs.length - 1]!;
}

/** The step's impulse, the object's history at it, its class, the sixth phase's readings and the fusion's judgement, from the estimate so far. */
function readStep(state: SeriesState, candidate: Candidate, estimate: StepEstimate, item: Pending, context: RunContext): Reading {
  const { params } = context;
  const eccentricity = Math.max(0, 1 - candidate.rpKm / candidate.aKm);
  const impulse = impulseOf({ aKm: candidate.aKm, eccentricity }, { deltaKm: estimate.delta, sigmaKm: estimate.sigmaDelta, deltaPerigeeKm: estimate.deltaPerigee, sigmaPerigeeKm: estimate.zPerigee === 0 ? estimate.sigmaDelta : Math.abs(estimate.deltaPerigee / estimate.zPerigee), deltaInclinationDeg: estimate.deltaInclination }, params);
  const apogeeAfterKm = 2 * (candidate.aKm + estimate.delta) - (candidate.rpKm + estimate.deltaPerigee);
  const step: CurrentStep = {
    epochMs: candidate.afterEpoch,
    deltaKm: estimate.delta,
    deltaPerigeeKm: estimate.deltaPerigee,
    tangentialMps: impulse.tangentialMps,
    normalMps: impulse.normalMps,
    consistency: impulse.consistency,
    bstarRatio: candidate.bstarRatio,
    regime: state.regime,
    bodyClass: item.set.bodyClass,
    apogeeHeightAfterKm: apogeeAfterKm - WGS84_EQUATORIAL_KM,
  };
  const features = featuresOf(state.steps, step, state.firstEpoch, params);
  const manoeuvreClass = classify(features, step, params);
  const tests = atypicalTests(features, step, params);
  const postAKm = candidate.aKm + estimate.delta;
  const held = heldLevel(candidate.envelope ?? envelopeOf(state), candidate.aKm, candidate.afterEpoch, params.maintenanceMonths);
  const launchKey = launchKeyOf(item.set);
  const ledgerStep = ledgerStepOf(state, candidate, estimate, launchKey);
  const siblings = siblingsOf(ledgerOf(context.catalogue), ledgerStep, params);
  const launch = launchKey === null ? undefined : (context.launches.get(launchKey) as LaunchRecord | undefined);
  const mates = launch === undefined || isAnalystLaunch(launchKey!) ? { count: 0, medianAKm: Number.NaN } : matesOf(launch.bodies, state.number, (number) => altitudeOf(context.states, number));
  const towards = towardsMates(candidate.aKm, postAKm, mates, Math.abs(estimate.delta) / 2);
  const opsStatus = operationalAt(item.set, candidate.afterEpoch, params);
  const judgement = judgeStep({ manoeuvreClass, tests, bodyClass: item.set.bodyClass, opsStatus, deltaKm: estimate.delta, radialMps: impulse.radialMps, n730: features.n730, pastRaises: features.pastRaises, disposalLike: features.disposalLike, ageDays: features.ageDays, sigmaOwnKm: candidate.sigmaOwn, held, siblings, mates, towardsMates: towards }, params);
  // The scope reads the status as of the step whether or not the fusion reads it, and the parent's orbit as the step was judged on.
  const launched = item.set.launchedMs;
  const subject: ScopeSubject = { bodyClass: item.set.bodyClass, status: operationalAt(item.set, candidate.afterEpoch, { ...params, opsStatusDated: true }), regime: state.regime, perigeeKm: item.perigeeHeightKm, bstar: candidate.bstar, ageDays: launched === null || launched === undefined ? Number.NaN : (candidate.afterEpoch - launched) / DAY_MS, daysSinceStep: features.n730 === 0 ? Number.POSITIVE_INFINITY : features.daysSinceStep };
  const scopeIn = inScope(subject, params.scope.policy);
  const scoped = scopeIn && passesGates({ zk: estimate.z, deltaKm: estimate.delta, deltaVMps: impulse.tangentialMps, bstarRatio: candidate.bstarRatio, impulseConsistency: impulse.consistency, explanations: judgement.explanations.length }, params.scope.gates);
  return { impulse, step, features, manoeuvreClass, atypical: atypicalReasons(features, step, params), held, siblings, mates, towards, opsStatus, judgement, ledgerStep, subject, scopeIn, scoped };
}

/** The step as the ledger keeps it: on the orbit at the bracket's first edge, under the launch's code (zero with no launch). */
function ledgerStepOf(state: SeriesState, candidate: Candidate, estimate: StepEstimate, launchKey: string | null): LedgerStep {
  return { number: state.number, launchCode: launchKey === null || isAnalystLaunch(launchKey) ? 0 : launchCodeOf(launchKey), epochMs: candidate.afterEpoch, aKm: candidate.aKm, inclinationDeg: candidate.incDeg, deltaKm: estimate.delta };
}

function readingSignals(reading: Reading): Partial<Record<SignalName, number>> {
  const { impulse, features } = reading;
  return {
    deltaVMps: impulse.tangentialMps,
    deltaVNormalMps: impulse.normalMps,
    deltaVRadialMps: impulse.radialMps,
    apsisLocation: impulse.apsisLocation,
    impulseConsistency: impulse.consistency,
    ageDays: features.ageDays,
    n365: features.n365,
    n730: features.n730,
    daysSinceStep: features.daysSinceStep,
    regularity: features.regularity,
    typicality: features.typicality,
    sameSignShare: features.sameSignShare,
    alternation: features.alternation,
    normalShare: features.normalShare,
    disposalLike: features.disposalLike ? 1 : 0,
    pastRaises: features.pastRaises,
    manoeuvreClass: MANOEUVRE_CLASSES.indexOf(reading.manoeuvreClass),
    atypical: reading.atypical.length,
    envelopeTopKm: reading.held.topKm,
    envelopeBottomKm: reading.held.bottomKm,
    envelopeMissKm: reading.held.months === 0 ? Number.NaN : returnMissKm(reading.held, reading.step.deltaKm),
    envelopeMonths: reading.held.months,
    siblingsLaunch: reading.siblings.launch,
    siblingsOrbit: reading.siblings.orbit,
    mates: reading.mates.count,
    matesMedianAKm: reading.mates.medianAKm,
    towardsMates: reading.towards ? 1 : 0,
    opsStatus: OPS_STATUSES.indexOf(reading.opsStatus),
    againstDrag: features.n730 === features.pastRaises && reading.step.deltaKm < 0 && !features.disposalLike ? 1 : 0,
    explanations: reading.judgement.explanations.length,
    signatures: reading.judgement.signatures.length,
    explanationBits: reading.judgement.explanationBits,
    signatureBits: reading.judgement.signatureBits,
    ageFromLaunchDays: reading.subject.ageDays,
    scopeIn: reading.scopeIn ? 1 : 0,
    scoped: reading.scoped ? 1 : 0,
  };
}

function estimateSignals(candidate: Candidate, estimate: StepEstimate): Partial<Record<SignalName, number>> {
  return {
    deltaKm: estimate.delta,
    zk: estimate.z,
    zMean: estimate.zMean,
    k: estimate.k,
    spanHours: estimate.spanHours,
    rhoMedian: estimate.rhoMedian,
    slope: estimate.slope,
    stepEvidence: estimate.evidence,
    deltaPerigeeKm: estimate.deltaPerigee,
    zPerigee: estimate.zPerigee,
    deltaInclinationDeg: estimate.deltaInclination,
    zInclination: estimate.zInclination,
    cadenceAfter: estimate.k / Math.max(estimate.spanHours / 24, 1 / 6),
    cusumPos: candidate.cusumAtOpen,
    z2: candidate.z2,
    rho2: candidate.rho2,
    evidence2: candidate.evidence2,
    span2: candidate.span2,
    zMean2: candidate.zMean2,
    z3: candidate.z3,
    rho3: candidate.rho3,
    evidence3: candidate.evidence3,
    span3: candidate.span3,
    zMean3: candidate.zMean3,
  };
}

/** The signals a verdict carries as its evidence: the numbers it was judged by, by the log's names. */
const EVIDENCE: readonly SignalName[] = ["regime", "bodyClass", "delta1", "z1", "deltaKm", "zk", "zMean", "k", "spanHours", "rhoMedian", "slope", "stepEvidence", "deltaPerigeeKm", "deltaInclinationDeg", "sigmaOwn", "sigmaPred", "bandScale1", "gapHours", "bstar", "bstarRatio", "perigeeKm", "kpMax", "stormHold", "recentCandidates", "deltaVMps", "deltaVNormalMps", "deltaVRadialMps", "impulseConsistency", "ageDays", "n365", "n730", "daysSinceStep", "typicality", "sameSignShare", "pastRaises", "manoeuvreClass", "atypical", "envelopeTopKm", "envelopeBottomKm", "envelopeMissKm", "envelopeMonths", "siblingsLaunch", "siblingsOrbit", "mates", "matesMedianAKm", "towardsMates", "opsStatus", "againstDrag", "explanations", "signatures", "explanationBits", "signatureBits", "cadenceBefore", "cadenceAfter", "ageFromLaunchDays", "scopeIn", "scoped"];

function evidenceOf(signals: Partial<Record<SignalName, number>>, params: DetectorParameters): Record<string, number> {
  const evidence: Record<string, number> = {};
  for (const name of EVIDENCE) {
    const value = signals[name];
    if (value !== undefined && Number.isFinite(value)) evidence[name] = round5(value);
  }
  evidence.zPersist = params.zPersist;
  evidence.typicalityMax = params.typicalityMax;
  evidence.consistencyMin = params.consistencyMin;
  return evidence;
}

function stepOf(candidate: Candidate, estimate: StepEstimate | null): Step {
  return estimate === null
    ? { beforeEpoch: candidate.beforeEpoch, afterEpoch: candidate.afterEpoch, deltaKm: candidate.delta1, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 1, z: candidate.z1 }
    : { beforeEpoch: candidate.beforeEpoch, afterEpoch: candidate.afterEpoch, deltaKm: estimate.delta, deltaPerigeeKm: estimate.deltaPerigee, deltaApogeeKm: 2 * estimate.delta - estimate.deltaPerigee, deltaInclinationDeg: estimate.deltaInclination, postSets: estimate.k, z: estimate.z };
}

function verdictOf(state: SeriesState, candidate: Candidate, item: Pending, verdictState: Verdict["state"], estimate: StepEstimate | null, evidence: Record<string, number>, reasons: string[], now: number, event: EventEstimate | null = { at: candidate.tStep, from: candidate.beforeEpoch, to: candidate.afterEpoch }): Verdict {
  return {
    kind: "object",
    state: verdictState,
    number: state.number,
    launch: launchOf(item.set.designator),
    raisedAt: now,
    step: stepOf(candidate, estimate),
    event,
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
    sigmaShort: noise.short,
    sigmaLong: noise.long,
    bstar,
    aKm: predictAt(pre, beforeEpoch).value,
    rpKm: predictAt(preRp, beforeEpoch).value,
    incDeg: predictAt(preInc, beforeEpoch).value,
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
    cadenceBefore: cadenceBefore(state, afterEpoch, context.params.cadenceBeforeDays),
    z2: Number.NaN,
    rho2: Number.NaN,
    evidence2: Number.NaN,
    span2: Number.NaN,
    zMean2: Number.NaN,
    z3: Number.NaN,
    rho3: Number.NaN,
    evidence3: Number.NaN,
    span3: Number.NaN,
    zMean3: Number.NaN,
    envelope: frozenEnvelope(state),
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
 * sets; a persistent step, raised or read as a manoeuvre, joins the
 * object's history; and the object remembers when it closed and what was
 * raised.
 */
function closeCandidate(state: SeriesState, candidate: Candidate, outcome: number, estimate: StepEstimate | null, reading: Reading | null, context: RunContext): void {
  const persistent = outcome === OUTCOMES.suspected || outcome === OUTCOMES.manoeuvre;
  const dropFirst = outcome === OUTCOMES.reverted || (outcome === OUTCOMES.lapsed && candidate.postSets <= 1);
  if (dropFirst) {
    const first = indexOfEpoch(state, candidate.afterEpoch);
    if (first !== -1) removeAt(state, first);
  } else if (persistent || outcome === OUTCOMES.lapsed || (estimate !== null && Math.abs(estimate.rhoMedian) >= context.params.rhoRevert)) {
    state.windowFrom = candidate.afterEpoch;
  }
  if (persistent && reading !== null) {
    recordStep(state.steps, { epochMs: candidate.afterEpoch, deltaKm: reading.step.deltaKm, deltaPerigeeKm: reading.step.deltaPerigeeKm, deltaInclinationDeg: estimate?.deltaInclination ?? 0, tangentialMps: reading.impulse.tangentialMps, normalMps: reading.impulse.normalMps }, context.params);
    // The catalogue's ledger of recent steps, by which the next object's step finds its siblings.
    noteLedgerStep(ledgerOf(context.catalogue), reading.ledgerStep);
  }
  if (outcome === OUTCOMES.suspected) {
    state.stepsRaised++;
    state.lastRaisedAt = context.now;
  }
  state.closedAt = context.now;
  state.candidate = null;
}

/** The gates a live candidate is judged by on a post set: the outcome and the reasons. The outcome `suspected` here means the step is persistent; the fusion below says whether it is raised. */
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
  if (enoughSets && persistent(estimate, params)) {
    const size = params.persistOnMeanStep ? `${estimate.zMean.toFixed(1)} sigma at the post sets' centroid` : `${estimate.z.toFixed(1)} sigma`;
    reasons.push(`a step of ${estimate.delta.toFixed(3)} km holds over ${estimate.k} post sets spanning ${estimate.spanHours.toFixed(1)} h: ${size}, the later sets keep ${estimate.rhoMedian.toFixed(2)} of the first jump, evidence ${estimate.evidence.toFixed(1)} against a drift`);
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
  if (estimate.k >= 2 && Number.isNaN(candidate.z2)) [candidate.z2, candidate.rho2, candidate.evidence2, candidate.span2, candidate.zMean2] = [estimate.z, estimate.rhoMedian, estimate.evidence, estimate.spanHours, estimate.zMean];
  if (estimate.k >= 3 && Number.isNaN(candidate.z3)) [candidate.z3, candidate.rho3, candidate.evidence3, candidate.span3, candidate.zMean3] = [estimate.z, estimate.rhoMedian, estimate.evidence, estimate.spanHours, estimate.zMean];
}

/** The parent's orbit after the step, for the plane test: the ring's set at the bracket's second edge, or the ring's last set. */
function orbitAfterStep(state: SeriesState, candidate: Candidate): PlaneOrbit {
  let i = indexOfEpoch(state, candidate.afterEpoch);
  if (i === -1) i = state.epochs.length - 1;
  return { epochMs: state.epochs[i]!, aKm: state.a[i]!, eccentricity: Math.max(0, 1 - state.rp[i]! / state.a[i]!), inclinationDeg: state.inc[i]!, raanDeg: state.raan[i]!, meanMotion: state.meanMotion[i]! };
}

/** The event's time from the sets either side of the bracket, where both are still in the ring and the engine propagates them; else the bracket itself. */
function eventOf(state: SeriesState, candidate: Candidate, designator: string | null, params: DetectorParameters): { event: EventEstimate; reasons: string[] } {
  const before = indexOfEpoch(state, candidate.beforeEpoch);
  const after = indexOfEpoch(state, candidate.afterEpoch);
  const fallback = { event: { at: candidate.tStep, from: candidate.beforeEpoch, to: candidate.afterEpoch }, reasons: [`the event's time is the middle of the bracket: the sets either side could not be propagated`] };
  if (before === -1 || after === -1) return fallback;
  const timed = eventTimeOf(ringSetAt(state, before, designator), ringSetAt(state, after, designator), params);
  if (timed === null) return fallback;
  const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  const reasons = [timed.fromMinimum ? `the event's time is the closest approach of the two orbits, ${iso(timed.at)}, within half a revolution: the step left the period alone, so the along-track drift cannot place it` : `the two orbits' along-track separation crosses zero at ${iso(timed.at)}, sigma ${timed.sigmaMinutes.toFixed(0)} min (drift ${timed.slopeKmPerHour.toFixed(2)} km/h over a position error of ${Math.max(params.eventSigmaPositionKm, timed.residualKm).toFixed(1)} km)${timed.ambiguousRevolutions > 1 ? `; ${timed.ambiguousRevolutions} revolutions' closest approaches lie within two sigmas` : ""}`];
  return { event: { at: timed.at, from: timed.from, to: timed.to }, reasons };
}

/** Opens the alert on a persistent step, suspected or manoeuvre, with the event's time where suspected. */
function raiseAlert(state: SeriesState, candidate: Candidate, item: Pending, origin: OpenAlert["origin"], estimate: StepEstimate, evidence: Record<string, number>, reasons: string[], context: RunContext): Verdict | null {
  const { params, now } = context;
  // A step older than the time to live when it is raised (a bundle's batch of decades-old sets) could be confirmed by any body ever catalogued after it: no alert is opened, and the verdict stands on its own.
  if (now - candidate.afterEpoch > params.alertTtlDays * DAY_MS) {
    return origin === "suspected" ? verdictOf(state, candidate, item, "suspected", estimate, evidence, [...reasons, `the step is ${((now - candidate.afterEpoch) / DAY_MS).toFixed(0)} days old at its raising: no alert is kept for the fragments`], now) : null;
  }
  if (state.alert !== null) {
    // A second persistent step while the first's alert is open: the first closes as it stands, and the new one is tracked.
    closeAlert(state, state.alert, closingOutcome(state.alert), context, state.alert.origin === "suspected");
  }
  const timed = origin === "suspected" ? eventOf(state, candidate, item.set.designator, params) : null;
  const alert = openAlert(state, { origin, now, candidate, step: stepOf(candidate, estimate), event: timed?.event ?? { at: candidate.tStep, from: candidate.beforeEpoch, to: candidate.afterEpoch }, launch: launchKeyOf(item.set), orbit: orbitAfterStep(state, candidate), regime: state.regime, bodyClass: item.set.bodyClass, evidence, reasons: timed === null ? reasons : [...reasons, ...timed.reasons], estimate, cadenceBefore: candidate.cadenceBefore }, params);
  if (!context.catalogue.alerted.includes(state.number)) context.catalogue.alerted.push(state.number);
  if (origin !== "suspected") return null;
  return verdictOf(state, candidate, item, "suspected", estimate, evidence, alert.reasons, now, alert.event);
}

const TIER_WORDS: Record<ScopeTier, string> = { raised: "as raised", "3": "three post sets", "5": "five post sets", D1: "a day of post sets", D3: "three days of post sets", D5: "five days of post sets", D7: "seven days of post sets" };

/**
 * The scoped line's verdict on an open alert: once, where the alert was
 * raised as suspected on a parent in the scope with a step through the
 * scope's gates (the evidence says so), and its step has reached the
 * scope's tier still holding. The verdict carries the alert's step, event
 * and evidence, so it reads as the suspected verdict it narrows.
 */
function raiseScoped(state: SeriesState, alert: OpenAlert, context: RunContext): void {
  const { params } = context;
  if (alert.scopedRaised === true || alert.origin !== "suspected" || alert.evidence.scoped !== 1) return;
  const tier = params.scope.tier;
  if (tier !== "raised" && alert.tiers[tier]?.held !== true) return;
  alert.scopedRaised = true;
  context.verdicts.push({ kind: "object", state: "scoped", number: state.number, launch: alert.launch !== null && !isAnalystLaunch(alert.launch) ? alert.launch : null, raisedAt: context.now, step: alert.step, event: alert.event, evidence: alert.evidence, reasons: [...alert.reasons, `the parent is in the scoped line's population and the step passed its gates and held ${TIER_WORDS[tier]}: raised on the scoped line`] });
}

/** Closes an alert: its log row, the verdict where it was a suspected one and `withVerdict`, and the object's slot cleared. */
function closeAlert(state: SeriesState, alert: OpenAlert, outcome: number, context: RunContext, withVerdict: boolean, extra: { reasons?: string[]; evidence?: Record<string, number>; bodies?: number[] } = {}): void {
  const { now, params } = context;
  const signals: Partial<Record<SignalName, number>> = { phase: PHASES.alert, outcome, origin: alert.candidate.origin === "step" ? ORIGINS.step : ORIGINS.cusum, regime: regimeIndex(alert.regime), bodyClass: BODY_CLASSES.indexOf(alert.bodyClass), beforeEpoch: alert.candidate.beforeEpoch, afterEpoch: alert.candidate.afterEpoch, delta1: alert.candidate.delta1, z1: alert.candidate.z1, sigmaOwn: alert.candidate.sigmaOwn, bstar: alert.candidate.bstar, bstarRatio: alert.candidate.bstarRatio, ...alertSignals(alert, now, params) };
  context.log.push(logRow(now, state.number, signals));
  if (withVerdict && alert.origin === "suspected" && outcome !== OUTCOMES.confirmed) {
    const days = daysAfterStep(alert, now);
    const reasons = outcome === OUTCOMES.dismissed
      ? [`${alert.pieces.new} new bod${alert.pieces.new === 1 ? "y" : "ies"} came under the launch in the ${params.alertTtlDays} days after the step and every one was old by numbering, had a set before the step, or lay out of the parent's plane: not this step's pieces`, ...(extra.reasons ?? [])]
      : [`no new body under the launch and no notice in the ${params.alertTtlDays} days after the step (${days.toFixed(0)} days)`, ...(extra.reasons ?? [])];
    context.verdicts.push({ kind: "object", state: outcome === OUTCOMES.dismissed ? "dismissed" : "expired", number: state.number, launch: alert.launch !== null && !isAnalystLaunch(alert.launch) ? alert.launch : null, raisedAt: now, step: alert.step, event: alert.event, evidence: { ...alert.evidence, ...(extra.evidence ?? {}), alertDays: round5(days), piecesNew: alert.pieces.new, piecesInPlane: alert.pieces.inPlane }, reasons, bodies: extra.bodies });
  }
  state.alert = null;
  const alerted = context.catalogue.alerted;
  const at = alerted.indexOf(state.number);
  if (at !== -1) alerted.splice(at, 1);
}

/** Confirms an open alert by pieces or a notice: the verdict and the close. */
function confirmAlert(state: SeriesState, alert: OpenAlert, context: RunContext, reasons: string[], evidence: Record<string, number>, bodies: number[]): void {
  const days = daysAfterStep(alert, context.now);
  const promoted = alert.origin === "manoeuvre" ? [`the step was read as a manoeuvre from the object's own record; the catalogue says otherwise`] : [];
  context.verdicts.push({ kind: "object", state: "confirmed", number: state.number, launch: alert.launch !== null && !isAnalystLaunch(alert.launch) ? alert.launch : null, raisedAt: context.now, step: alert.step, event: alert.event, evidence: { ...alert.evidence, ...evidence, daysToConfirmation: round5(days) }, reasons: [...reasons, ...promoted, `confirmed ${days.toFixed(1)} days after the step`], bodies });
  closeAlert(state, alert, OUTCOMES.confirmed, context, false);
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
    context.log.push(logRow(context.now, state.number, { ...baseSignals(state, candidate, item, context), k: candidate.postSets, phase: PHASES.close, outcome: OUTCOMES.faded }));
    closeCandidate(state, candidate, OUTCOMES.faded, null, null, context);
    return;
  }
  candidate.postSets = estimate.k;
  candidate.lastPostEpoch = estimate.lastEpoch;
  recordTrajectory(candidate, estimate);
  const judged = judge(candidate, estimate, state.regime, context);
  if (judged.outcome === OUTCOMES.open) return;
  // Every closed candidate is read against the object's record, so the sweeps can re-threshold the persistence gates and class what they raise.
  const reading = readStep(state, candidate, estimate, item, context);
  const { outcome, reasons } = fuse(judged, reading);
  const signals = { ...baseSignals(state, candidate, item, context), ...estimateSignals(candidate, estimate), ...readingSignals(reading), phase: PHASES.close, outcome };
  context.log.push(logRow(context.now, state.number, signals));
  const evidence = evidenceOf(signals, context.params);
  if (outcome === OUTCOMES.suspected) {
    candidate.suspected = true;
    const verdict = raiseAlert(state, candidate, item, "suspected", estimate, evidence, reasons, context);
    if (verdict !== null) context.verdicts.push(verdict);
    // The scoped line's verdict follows the suspected one in the same run where its tier is reached at the raising.
    if (state.alert !== null && state.alert.candidate === candidate) raiseScoped(state, state.alert, context);
  } else if (outcome === OUTCOMES.manoeuvre) {
    context.verdicts.push(verdictOf(state, candidate, item, "manoeuvre", estimate, evidence, reasons, context.now));
    raiseAlert(state, candidate, item, "manoeuvre", estimate, evidence, reasons, context);
  } else if (candidate.watched) {
    context.verdicts.push(verdictOf(state, candidate, item, "dismissed", estimate, evidence, reasons, context.now));
  }
  closeCandidate(state, candidate, outcome, estimate, reading, context);
}

/**
 * The fusion of a persistent step with everything read of it: raised as
 * suspected where no manoeuvre explanation applies or a breakup signature
 * overrides them (`judgeStep`), a manoeuvre otherwise, with the reasons
 * saying which explanations and signatures applied. A step that was not
 * persistent keeps its outcome.
 */
function fuse(judged: { outcome: number; reasons: string[] }, reading: Reading): { outcome: number; reasons: string[] } {
  if (judged.outcome !== OUTCOMES.suspected) return judged;
  const { features, manoeuvreClass, impulse, judgement } = reading;
  const record = features.n730 === 0 ? (features.young ? `no accepted step on an object ${features.ageDays.toFixed(0)} days old` : `no accepted step in ${Math.min(features.ageDays, 730).toFixed(0)} days`) : `${features.n730} accepted step${features.n730 > 1 ? "s" : ""} in two years, ${features.n365} in the year, the last ${features.daysSinceStep.toFixed(0)} days before`;
  const summary = `the impulse is ${impulse.tangentialMps.toFixed(2)} m/s along the track${impulse.normalMps > 0 ? `, ${impulse.normalMps.toFixed(2)} m/s across it` : ""}${impulse.radialMps > 0 ? `, at least ${impulse.radialMps.toFixed(2)} m/s radial` : ""}; the object's record: ${record}; the step is classed ${manoeuvreClass}`;
  if (judgement.raised) {
    const why = judgement.explanations.length === 0 ? [`no manoeuvre explains the step: ${judgement.signatures.length === 0 ? "a step alone on an object with no record of moving itself" : "and the breakup signatures below"}`] : [`the manoeuvre explanations (${judgement.explanations.join("; ")}) are overridden by a breakup signature`];
    const occasional = judgement.explanations.length > 0 && judgement.signatures.length === 0 ? [`an occasional step on an object the catalogue does not class as a payload: a stage or a fragment does not manoeuvre`] : [];
    return { outcome: OUTCOMES.suspected, reasons: [...judged.reasons, summary, ...why, ...judgement.signatures, ...occasional] };
  }
  return { outcome: OUTCOMES.manoeuvre, reasons: [...judged.reasons, summary, ...judgement.explanations, `a persistent step a manoeuvre explains, with no breakup signature against it: not a breakup`] };
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
  if (candidate === null) {
    // The set's level joins the object's envelope of held altitudes: a set that opens a candidate does not, so a jump is never judged against itself, and a bad set never widens the envelope; the sets after a step that stays join it once the candidate has closed.
    noteLevel(envelopeOf(state), item.aKm, item.set.epochMs);
    return;
  }
  if (candidate.origin === "step" && isQuiet(state, noise, candidate.z1, context)) {
    candidate.watched = true;
    const signals = { ...baseSignals(state, candidate, item, context), phase: PHASES.open, outcome: OUTCOMES.open, k: 1 };
    const reasons = [`one set moved the semi-major axis ${candidate.delta1.toFixed(3)} km from the object's own model, ${candidate.z1.toFixed(1)} sigma, on a quiet object: to be judged by the next`];
    context.verdicts.push(verdictOf(state, candidate, item, "watch", null, evidenceOf(signals, context.params), reasons, context.now));
  }
  // A CUSUM candidate already has its post sets in the ring: judge it now.
  if (candidate.origin === "cusum") advance(item, stats, context);
}

/** The alert pass for a set of an object with an open alert: the step read once more against the frozen pre fits, once per run. */
function track(item: Pending, stats: BandStats, context: RunContext): void {
  const state = item.state;
  const alert = state.alert;
  if (alert === null || item.set.epochMs <= alert.candidate.beforeEpoch) return;
  if (context.tracked.has(alert)) {
    if (item.set.epochMs > alert.candidate.afterEpoch && alert.postEpochs.length < context.params.alertMaxPostSets && !alert.postEpochs.includes(item.set.epochMs)) alert.postEpochs.push(item.set.epochMs);
    return;
  }
  context.tracked.add(alert);
  const environment: Environment = { commonMode: stats.commonMode, scale: stats.scale, weather: context.weather.dragFactor };
  trackAlert(state, alert, item.set.epochMs, environment, context.now, context.params);
  noteDamage(alert, state, context.params);
  raiseScoped(state, alert, context);
}

/** Candidates that saw no post set in too long for their regime lapse, at the end of the run. */
function lapse(states: Map<number, SeriesState>, context: RunContext): void {
  for (const state of states.values()) {
    const candidate = state.candidate;
    if (candidate === null) continue;
    const days = context.params.lapseDays[regimeKey(state.regime)];
    if (context.now - candidate.lastPostAt <= days * DAY_MS) continue;
    context.log.push(logRow(context.now, state.number, { phase: PHASES.close, outcome: OUTCOMES.lapsed, origin: ORIGINS[candidate.origin], regime: regimeIndex(state.regime), beforeEpoch: candidate.beforeEpoch, afterEpoch: candidate.afterEpoch, delta1: candidate.delta1, z1: candidate.z1, k: candidate.postSets, bstar: candidate.bstar, sigmaOwn: candidate.sigmaOwn, residuals: candidate.residuals, z2: candidate.z2, rho2: candidate.rho2, evidence2: candidate.evidence2, span2: candidate.span2, zMean2: candidate.zMean2 }));
    if (candidate.watched) {
      context.verdicts.push({ kind: "object", state: "dismissed", number: state.number, launch: null, raisedAt: context.now, step: { beforeEpoch: candidate.beforeEpoch, afterEpoch: candidate.afterEpoch, deltaKm: candidate.delta1, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: candidate.postSets, z: candidate.z1 }, event: null, evidence: { delta1: round5(candidate.delta1), z1: round5(candidate.z1), k: candidate.postSets, lapseDays: days }, reasons: [`no further set followed within ${days} days; the step will be measured again when one comes`] });
    }
    closeCandidate(state, candidate, OUTCOMES.lapsed, null, null, context);
  }
}

/** How many candidates opened across the catalogue in the last day, as the states remember them. */
function recentCandidatesOf(states: Map<number, SeriesState>, now: number): number {
  let count = 0;
  const since = now - DAY_MS;
  for (const state of states.values()) if (state.candidate !== null && state.candidate.openedAt >= since) count++;
  return count;
}

/** The objects with an open alert, by number, as the catalogue state lists them. */
function alertedStates(context: RunContext): SeriesState[] {
  const states: SeriesState[] = [];
  for (const number of context.catalogue.alerted) {
    const state = context.states.get(number);
    if (state?.alert) states.push(state);
  }
  return states;
}

/** The orbit a candidate parent is tested at: its ring's last set where it has a state with sets, else the launch's record of its first set. */
function parentOrbit(context: RunContext, number: number, fallback: PlaneOrbit): PlaneOrbit {
  const state = context.states.get(number);
  if (state === undefined || state.epochs.length === 0) return fallback;
  const i = state.epochs.length - 1;
  return { epochMs: state.epochs[i]!, aKm: state.a[i]!, eccentricity: Math.max(0, 1 - state.rp[i]! / state.a[i]!), inclinationDeg: state.inc[i]!, raanDeg: state.raan[i]!, meanMotion: state.meanMotion[i]! };
}

/** The cloud row's signals. */
function cloudSignals(launch: LaunchRecord, verdict: CloudVerdict, openAlert: boolean, decision: number): Partial<Record<SignalName, number>> {
  return {
    phase: PHASES.cloud,
    launch: launchCodeOf(launch.key),
    launchAgeDays: verdict.launchAgeDays,
    newBodies: verdict.newBodies,
    windowBodies: verdict.windowBodies,
    lambda: verdict.lambda,
    lambdaRate: verdict.rate,
    pBurst: verdict.p,
    parents: verdict.parents.length,
    aboveMark: verdict.pieces.filter((p) => p.aboveMark).length,
    inPlane1: piecesWithin(verdict, 1),
    inPlane3: piecesWithin(verdict, 3),
    inPlane5: piecesWithin(verdict, 5),
    inPlane10: piecesWithin(verdict, 10),
    debrisPieces: verdict.pieces.filter((p) => p.aboveMark && p.bodyClass === "debris").length,
    payloadPieces: verdict.pieces.filter((p) => p.aboveMark && p.bodyClass === "payload").length,
    cloudDeltaVMps: verdict.cloudDeltaVMps,
    gabbardSpreadKm: verdict.gabbardSpreadKm,
    openAlert: openAlert ? 1 : 0,
    cloudDecision: decision,
  };
}

/** The decisions a cloud row records. */
const CLOUD_DECISIONS = { nothing: 0, confirmed: 1, listed: 2, burstNoPiece: 3, deployment: 4, oldCloud: 5, attributed: 6 } as const;

/**
 * What the confirmation rules judge pieces against: the parent, its orbit
 * (after the step for an alert, its last set for a body with none), its
 * class, the instant its standing under the launch is read at (the step's
 * second edge, or the cloud's event), and the instant a remembered cloud's
 * nodes are carried from where the launch kept none.
 */
interface PieceSubject {
  number: number;
  orbit: PlaneOrbit;
  bodyClass: BodyClass;
  atMs: number;
  eventMs: number;
}

interface PieceJudgement {
  pieces: PieceReading[];
  reading: ConfirmationReading;
  reasons: string[];
  /** The rules that refused, as `REFUSALS` bits; zero where some pieces were kept. */
  refused: number;
}

/**
 * The confirmation rules: whether pieces in a parent's plane, new by
 * numbering and first published after its step or its cloud's event,
 * confirm it, and which of them. The third phase's confirmation by any
 * such piece was wrong more often than right, and the wrong ones were of a
 * few kinds, each with a rule here:
 *
 * - the pieces lie in the parent's own orbit at under the review list's
 *   velocity floor: the catalogue's re-designations or a release, not
 *   fragments;
 * - the parent is a debris-classed body first catalogued weeks before its
 *   step: a fresh piece of the launch's own cloud, whose settling fit is
 *   "confirmed" by its siblings;
 * - the launch remembers a cloud (a burst with consistent pieces, or a
 *   confirmation or an attribution, within the memory): a cloud is
 *   catalogued in batches for months, and every batch would confirm the
 *   next step on any body of the launch, so the pieces must lie out of
 *   that cloud's plane and the parent must not lie in it;
 * - the parent is debris-classed under a launch with an active cloud: its
 *   pieces must lie nearer its plane than the cloud's nearest body does;
 * - a single piece confirms only a parent that is not debris, under a
 *   launch that gained nothing in the year before and nothing else in the
 *   window.
 *
 * Each rule is a parameter and can be turned off; the reading of every
 * signal is kept, on the alert and on the attribution row, so the rules
 * are re-thresholded offline (`npm run kpi:sweep -- --confirmations` and
 * `--attributions`). The same rules judge the confirmation of an open
 * alert and the attribution of a cloud to a body with none.
 */
function judgePieces(subject: PieceSubject, launch: LaunchRecord, verdict: CloudVerdict, judged: PieceReading[], memory: { at: number; eventMs: number }, context: RunContext, rememberedUpTo = Number.NEGATIVE_INFINITY): PieceJudgement {
  const { params, now } = context;
  const reasons: string[] = [];
  let refused = 0;
  const own = launch.bodies.find((b) => b.number === subject.number);
  const parentAgeDays = own === undefined ? Number.POSITIVE_INFINITY : (subject.atMs - own.firstEpoch) / DAY_MS;
  const parentFragment = isFragmentClass(subject.bodyClass);
  // The pieces judged are told apart from the launch's earlier cloud; a piece first seen by the time the launch remembered a cloud is that cloud's, whether or not it is judged again.
  const exclude = new Set<number>([subject.number, ...judged.filter((p) => p.firstSeenAt > rememberedUpTo).map((p) => p.number)]);
  const cloud = cloudBodies(launch, now - (params.burstWindowDays + params.burstBackgroundDays) * DAY_MS, now, exclude);
  const daysSinceCloud = (now - memory.at) / DAY_MS;
  const cloudEventMs = Number.isFinite(memory.eventMs) ? memory.eventMs : cloud.length > 0 ? Math.min(...cloud.map((b) => b.firstEpoch)) : subject.eventMs;
  const parentCloudDistance = nearestCloudDistance(subject.orbit, cloud, cloudEventMs, params);
  const orbitOf = (piece: PieceReading): PlaneOrbit => planeOrbitOf(launch.bodies.find((b) => b.number === piece.number)!);
  const outOfCloud = cloud.length === 0 ? judged : judged.filter((piece) => nearestCloudDistance(orbitOf(piece), cloud, cloudEventMs, params) > params.planeDistanceMax);
  const nearerThanCloud = judged.filter((piece) => piece.distance < parentCloudDistance);
  const deltaVMps = median(judged.map((p) => p.deltaVMps));
  // The parent's reentry, where the catalogue had published it by the run, against the pieces' earliest first set.
  const decayed = context.decays.get(subject.number);
  const firstEpoch = judged.length === 0 ? Number.NaN : Math.min(...judged.map((p) => p.firstEpoch));
  const decayDays = decayed !== undefined && decayed <= now ? (decayed - firstEpoch) / DAY_MS : Number.NaN;
  let kept = judged;
  const refuse = (bit: number, why: string): void => {
    reasons.push(why);
    refused |= bit;
    kept = [];
  };
  if (params.reentryRefuses && decayDays <= params.reentryAfterPiecesDays) refuse(REFUSALS.reentry, `the parent reentered on ${new Date(decayed!).toISOString().slice(0, 10)}, ${Math.abs(decayDays).toFixed(1)} days ${decayDays < 0 ? "before" : "after"} its pieces' first set: they are the reentry's debris, a capsule or an aerodynamic breakup's, not a breakup in orbit`);
  if (params.confirmDeltaVMinMps > 0 && !(deltaVMps >= params.confirmDeltaVMinMps)) refuse(REFUSALS.velocity, `the pieces move ${deltaVMps.toFixed(2)} m/s from the parent, under the floor of ${params.confirmDeltaVMinMps}: bodies in the parent's own orbit, not fragments of it`);
  if (params.freshPieceDays > 0 && parentFragment && parentAgeDays < params.freshPieceDays) refuse(REFUSALS.freshPiece, `the parent is classed debris and was first catalogued ${parentAgeDays.toFixed(0)} days before its step: a fresh piece of the launch's own cloud, not a parent`);
  if (params.cloudMemoryDays > 0 && daysSinceCloud <= params.cloudMemoryDays && cloud.length > 0) {
    if (parentCloudDistance <= params.planeDistanceMax) refuse(REFUSALS.parentInCloud, `the launch had a cloud ${daysSinceCloud.toFixed(0)} days ago and the parent lies in its plane (distance ${parentCloudDistance.toFixed(1)} to the nearest of its ${cloud.length} bodies): the new pieces cannot be told from that cloud's`);
    else if (kept.length > 0) {
      const left = kept.length - outOfCloud.length;
      kept = kept.filter((piece) => outOfCloud.includes(piece));
      if (kept.length === 0) refused |= REFUSALS.piecesInCloud;
      reasons.push(left > 0 ? `the launch had a cloud ${daysSinceCloud.toFixed(0)} days ago: ${left} of the pieces lie in its plane and are left out, ${kept.length} lie out of it` : `the launch had a cloud ${daysSinceCloud.toFixed(0)} days ago on another plane (the parent is ${parentCloudDistance.toFixed(1)} from its nearest body), and every piece lies out of it`);
    }
  }
  if (params.debrisParentNeedsNearerThanCloud && parentFragment && cloud.length > 0 && kept.length > 0) {
    const before = kept.length;
    kept = kept.filter((piece) => nearerThanCloud.includes(piece));
    if (kept.length === 0) refused |= REFUSALS.nearerThanCloud;
    if (kept.length < before) reasons.push(`the parent is classed debris under a launch with an active cloud (${cloud.length} fragment-classed bodies in the year before, the nearest ${parentCloudDistance.toFixed(1)} from the parent's plane): ${before - kept.length} of the pieces lie no nearer the parent's plane than the cloud does and are left out`);
  }
  if (params.singlePieceNeedsQuietLaunch && kept.length === 1) {
    if (parentFragment) refuse(REFUSALS.singlePiece, `a single piece under a debris-classed parent confirms nothing`);
    else if (verdict.backgroundBodies > 0) refuse(REFUSALS.singlePiece, `a single piece under a launch that gained ${verdict.backgroundBodies} new bod${verdict.backgroundBodies === 1 ? "y" : "ies"} in the year before confirms nothing`);
    else if (verdict.windowBodies > 1) refuse(REFUSALS.singlePiece, `a single piece in the parent's plane among ${verdict.windowBodies} new bodies under the launch in the window confirms nothing: the stray of a cloud the plane test attached elsewhere`);
  }
  const reading: ConfirmationReading = { pieces: judged.length, deltaVMps, parentAgeDays, parentFragment, backgroundBodies: verdict.backgroundBodies, cloudPieces: cloud.length, windowBodies: verdict.windowBodies, daysSinceCloud, parentCloudDistance, piecesOutOfCloud: outOfCloud.length, piecesNearerThanCloud: nearerThanCloud.length, decayDays, refused: kept.length === 0 };
  return { pieces: kept, reading, reasons, refused };
}

/** The parent's set the pieces are timed against: its ring's latest set no later than the instant, else its earliest; null where it has no state. */
function parentSetFor(context: RunContext, number: number, atMost: number): ElementSet | null {
  const state = context.states.get(number);
  if (state === undefined || state.epochs.length === 0) return null;
  let i = state.epochs.length - 1;
  while (i > 0 && state.epochs[i]! > atMost) i--;
  return ringSetAt(state, i, null);
}

/** The pieces' first sets as their rings hold them, the earliest first, at most the parameter's count. */
function pieceSetsFor(context: RunContext, pieces: readonly PieceReading[]): ElementSet[] {
  const sets: ElementSet[] = [];
  for (const piece of [...pieces].sort((a, b) => a.firstEpoch - b.firstEpoch || a.number - b.number)) {
    if (sets.length >= context.params.attributionMaxPieces) break;
    const state = context.states.get(piece.number);
    if (state !== undefined && state.epochs.length > 0) sets.push(ringSetAt(state, 0, null));
  }
  return sets;
}

/** The pieces timed back against a parent (`eventFromPieces`): null where either cannot be propagated or no piece crosses it in the search window. */
/** The shorter search windows tried, in days, where the pieces cannot be propagated over the whole one: a high-drag piece's set fails far from its epoch. Policy. */
const FALLBACK_SEARCH_DAYS = [60, 20] as const;

function timePieces(context: RunContext, parent: number, pieces: readonly PieceReading[]): PiecesEventTime | null {
  const sets = pieceSetsFor(context, pieces);
  if (sets.length === 0) return null;
  const to = Math.min(...sets.map((s) => s.epochMs));
  const parentSet = parentSetFor(context, parent, to);
  if (parentSet === null) return null;
  for (const days of [context.params.attributionSearchDays, ...FALLBACK_SEARCH_DAYS.filter((d) => d < context.params.attributionSearchDays)]) {
    const timed = eventFromPieces(parentSet, sets, to - days * DAY_MS, to, context.params);
    if (timed !== null) return timed;
  }
  return null;
}

/** The miss of each other body the pieces lie in the plane of, timed against the same pieces, the nearest planes first, as many as the parameter allows; a body not timed is left out. */
function rivalMisses(context: RunContext, rivals: readonly number[], pieces: readonly PieceReading[]): Map<number, number> {
  const misses = new Map<number, number>();
  for (const rival of rivals.slice(0, Math.max(0, context.params.attributionMaxCandidates - 1))) {
    const timed = timePieces(context, rival, pieces);
    if (timed !== null) misses.set(rival, timed.missKm);
  }
  return misses;
}

/** How long after a launch was first seen its debris-classed bodies are its own launch-era objects (covers, fairings, tanks, adapters) rather than a later cloud's, in days. Policy: a season, the time the catalogue takes to list a launch's own objects. */
export const LAUNCH_ERA_DAYS = 90;

/**
 * The debris-classed bodies a launch left at its start (first seen within
 * the launch era, before the window, with no open alert), where it left
 * few of them, whose plane any of the pieces lies within the bound of,
 * each with the orbit it is tested at (its ring's last set), recorded in
 * `orbits`; none where the launch left more than the parameter's count.
 * A later cloud's pieces are not candidates: they are what is being judged.
 */
function debrisSharing(context: RunContext, launch: LaunchRecord, pieces: readonly PieceReading[], eventMs: number, alerted: ReadonlySet<number>, orbits: Map<number, PlaneOrbit>): number[] {
  const { params, now } = context;
  const windowStart = now - params.burstWindowDays * DAY_MS;
  const debris = launch.bodies.filter((b) => isFragmentClass(b.bodyClass) && b.firstSeenAt <= windowStart && b.firstSeenAt <= launch.firstSeenAt + LAUNCH_ERA_DAYS * DAY_MS && !alerted.has(b.number) && !pieces.some((p) => p.number === b.number));
  if (debris.length === 0 || debris.length > params.attributionDebrisParentsMax) return [];
  const sharing: number[] = [];
  for (const body of debris) {
    const orbit = parentOrbit(context, body.number, planeOrbitOf(body));
    if (!pieces.some((piece) => planeDistance(orbit, planeOrbitOf(launch.bodies.find((b) => b.number === piece.number)!), eventMs, params).distance <= params.planeDistanceMax)) continue;
    orbits.set(body.number, orbit);
    sharing.push(body.number);
  }
  return sharing;
}

/** Whether the pieces' common instant is the remembered cloud's own event (within a day, or the override's hours if longer): a later batch of that cloud shares its origin, and is that cloud's, not a new one. */
function sameInstant(at: number, eventMs: number, params: DetectorParameters): boolean {
  return Number.isFinite(eventMs) && Math.abs(at - eventMs) <= Math.max(DAY_MS, params.originOverrideHours * HOUR_MS);
}

/** Whether the body made a persistent step, whatever verdict it got, with its first post set between the two instants. */
function steppedWithin(context: RunContext, number: number, from: number, to: number): boolean {
  const state = context.states.get(number);
  return state !== undefined && state.steps.some((step) => step.epochMs >= from && step.epochMs <= to);
}

const iso16 = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

/** The words for a back-propagated timing. */
function timingReason(timed: PiecesEventTime, parent: number): string {
  const o = timed.origin;
  const origin = o.timed >= 2 ? `; each piece's closest approach to ${parent}: ${o.timed} of ${o.tried} cross it in the window, their median at ${iso16(o.medianAt)}, half of them within ${o.dev50Hours.toFixed(1)} h of it and three quarters within ${o.dev75Hours.toFixed(1)} h (robust spread ${o.spreadHours.toFixed(1)} h), the pieces ${o.ageDays.toFixed(1)} days old at it` : `; ${o.timed} of ${o.tried} pieces cross ${parent} in the window`;
  return `propagated back, ${timed.pieces} piece${timed.pieces === 1 ? "" : "s"} converge on ${parent} at ${iso16(timed.at)}, sigma ${timed.sigmaMinutes.toFixed(0)} min, missing it by ${timed.missKm.toFixed(1)} km${timed.crossings > 1 ? `; ${timed.crossings} laps' crossings lie within twice that miss` : ""}${origin}`;
}

/** The common-origin test's readings for a row: the pieces tried and timed, the median crossing, the deviations, the spread, the sigma, the age and the miss; the pieces tried alone where the timing gave nothing. */
function originSignals(timed: PiecesEventTime | null, tried: number): Partial<Record<SignalName, number>> {
  if (timed === null) return { originTried: tried, originTimed: 0 };
  const o = timed.origin;
  return { originTried: o.tried, originTimed: o.timed, originMedianAt: o.medianAt, originDev50Hours: o.dev50Hours, originDev75Hours: o.dev75Hours, originPhase50: o.phase50, originPhase75: o.phase75, originSpreadHours: o.spreadHours, originSigmaMinutes: o.sigmaMinutes, originAgeDays: o.ageDays, originMissKm: o.missKm };
}

/** Whether the common-origin test is on: a base within reach. */
const originOn = (params: DetectorParameters): boolean => originTested(params);

/** The event the pieces give: the convergence's instant, or the median of the pieces' own closest approaches where the parameter asks and its sigma is the finer. */
function piecesEvent(timed: PiecesEventTime, params: DetectorParameters): { at: number; from: number; to: number; sigmaMinutes: number; byOrigin: boolean } {
  const o = timed.origin;
  if (params.originEventTime && Number.isFinite(o.sigmaMinutes) && o.sigmaMinutes < timed.sigmaMinutes) {
    const sigmaMs = Math.max(o.sigmaMinutes, params.eventGridSeconds / 60 / 2) * 60_000;
    return { at: o.medianAt, from: o.medianAt - 2 * sigmaMs, to: o.medianAt + 2 * sigmaMs, sigmaMinutes: sigmaMs / 60_000, byOrigin: true };
  }
  return { at: timed.at, from: timed.from, to: timed.to, sigmaMinutes: timed.sigmaMinutes, byOrigin: false };
}

/** Whether a launch is a crewed spacecraft's or a station's cargo craft's and the parent is not its rocket body: what such a craft leaves in orbit is released on purpose (`visitingLaunches`). */
const visitingRelease = (key: string, bodyClass: BodyClass, params: DetectorParameters): boolean => params.visitingLaunches.includes(key) && bodyClass !== "rocket body";

/** Whether a batch of pieces passes the small-batch rule (`smallBatchOriginHours`): a batch outside the rule's sizes, or the rule off, passes; a small one needs at least two pieces crossing the parent in the window, the share asked of them within the bound of their median crossing. */
export function passesSmallBatch(pieces: number, timed: Pick<PiecesEventTime, "origin"> | null, params: Pick<DetectorParameters, "smallBatchMinPieces" | "smallBatchMaxPieces" | "smallBatchOriginShare" | "smallBatchOriginHours">): boolean {
  if (!(params.smallBatchOriginHours < 1e8) || pieces < params.smallBatchMinPieces || pieces > params.smallBatchMaxPieces) return true;
  if (timed === null || !(timed.origin.timed >= 2)) return false;
  const deviation = params.smallBatchOriginShare <= 0.5 ? timed.origin.dev50Hours : timed.origin.dev75Hours;
  return deviation <= params.smallBatchOriginHours;
}

/** The words for a small batch the rule refused. */
const smallBatchReason = (pieces: number, timed: PiecesEventTime | null, parent: number, params: DetectorParameters): string => `a small batch of ${pieces} pieces needs them to share a tight common origin, ${params.smallBatchOriginShare <= 0.5 ? "half" : "three quarters"} of them crossing ${parent} within ${params.smallBatchOriginHours} h of their median, and ${timed === null || !(timed.origin.timed >= 2) ? "too few of them cross it in the window" : `they cross it within ${(params.smallBatchOriginShare <= 0.5 ? timed.origin.dev50Hours : timed.origin.dev75Hours).toFixed(1)} h`}: an old cloud's cataloguing as likely as a new event`;

/**
 * The rank the stage preference reads a body by (`attributionPrefersStage`):
 * 0 for a rocket body, 2 for a payload operating at the instant (its dated
 * status as its latest set gave it), 1 for any other body. A rocket body
 * in orbit since 2005 has had a reported breakup three to six times as
 * often as a payload, and a payload breaks up dead far more often than
 * working, so where the pieces cannot tell two bodies apart the lower rank
 * is the likelier parent.
 */
function rankOf(context: RunContext, launch: LaunchRecord, number: number): number {
  const body = launch.bodies.find((b) => b.number === number);
  if (body?.bodyClass === "rocket body") return 0;
  if (body?.bodyClass !== "payload") return 1;
  const state = context.states.get(number);
  const status = operationalAt({ opsStatus: state?.opsStatus, endedByMs: state?.endedByMs ?? null, endedFromMs: state?.endedFromMs ?? null }, context.now, { ...context.params, opsStatusDated: true });
  return isWorkingStatus(status) ? 2 : 1;
}

const RANK_WORDS = ["a rocket body", "a body not operating at the time", "a payload operating at the time"] as const;

/** The attribution row's signals. */
function attributionSignals(launch: LaunchRecord, verdict: CloudVerdict, path: number, parentClass: BodyClass, judged: readonly PieceReading[], judgement: PieceJudgement | null, rivals: number, timed: PiecesEventTime | null, rival: number, refused: number, raised: boolean): Partial<Record<SignalName, number>> {
  const reading = judgement?.reading;
  return {
    phase: PHASES.attribution,
    launch: launchCodeOf(launch.key),
    launchAgeDays: verdict.launchAgeDays,
    lambdaRate: verdict.rate,
    pBurst: verdict.p,
    windowBodies: verdict.windowBodies,
    backgroundBodies: verdict.backgroundBodies,
    bodyClass: BODY_CLASSES.indexOf(parentClass),
    attributionPath: path,
    attributionPieces: judged.length,
    attributionKept: judgement?.pieces.length ?? 0,
    attributionRivals: rivals,
    attributionDistance: judged.length === 0 ? Number.NaN : median(judged.map((p) => p.distance)),
    cloudDeltaVMps: reading?.deltaVMps ?? median(judged.map((p) => p.deltaVMps)),
    parentAgeDays: reading?.parentAgeDays,
    parentFragment: reading === undefined ? undefined : reading.parentFragment ? 1 : 0,
    cloudPieces: reading?.cloudPieces,
    daysSinceCloud: reading?.daysSinceCloud,
    parentCloudDistance: reading?.parentCloudDistance,
    piecesOutOfCloud: reading?.piecesOutOfCloud,
    piecesNearerThanCloud: reading?.piecesNearerThanCloud,
    parentDecayDays: reading?.decayDays,
    piecesFirstAt: judged.length === 0 ? undefined : Math.min(...judged.map((p) => p.firstEpoch)),
    attributionMissKm: timed?.missKm,
    attributionRivalMissKm: rival,
    attributionSigmaMinutes: timed?.sigmaMinutes,
    attributionSpreadMinutes: timed?.spreadMinutes,
    attributionCrossings: timed?.crossings,
    attributionEventAt: timed?.at,
    attributionRefused: refused,
    attributionRaised: raised ? 1 : 0,
  };
}

/**
 * The Confirmed channel's attribution: the run's consistent pieces under a
 * launch whose nearest plane is a body with no open alert, grouped by that
 * body, each group judged for it as a breakup with no step seen on it. A
 * group is attributed where the confirmation rules keep at least the
 * parameter's count of its pieces, the launch is old enough and quiet
 * enough as for a confirmation, the pieces propagated back converge on the
 * body (their miss at the crossing within the bound), and, where they lie
 * in the plane of other bodies of the launch too, they converge on this
 * one by the ambiguity ratio better than on any of those. The verdict is
 * `confirmed`, on the body, with no step, its event the back-propagated
 * crossing; the launch remembers the cloud, so its later batches attribute
 * nothing more. Returns how many were raised.
 */
function attributeCloud(launch: LaunchRecord, verdict: CloudVerdict, parents: readonly ParentCandidate[], alerted: ReadonlySet<number>, memory: { at: number; eventMs: number }, context: RunContext, launchesInRun: number, path: number = ATTRIBUTION_PATHS.cloud): number {
  const { params, now } = context;
  const groups = new Map<number, PieceReading[]>();
  // The pieces first seen by the time the launch last remembered a cloud are that cloud's: under the memory they are not judged again, and either way they are told apart from the new ones as the cloud.
  const remembered = params.cloudMemoryDays > 0 && now - memory.at <= params.cloudMemoryDays * DAY_MS;
  for (const piece of verdict.consistent) {
    if (piece.parent === null || alerted.has(piece.parent) || (remembered && piece.firstSeenAt <= memory.at)) continue;
    groups.set(piece.parent, [...(groups.get(piece.parent) ?? []), piece]);
  }
  let raised = 0;
  const named = new Set<number>();
  for (const [nearest, judged] of [...groups].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])) {
    // The body named is, of the bodies whose plane the pieces share, the one their semi-major axes centre on: a cloud's periods straddle its parent's, and a body of the same plane at another altitude is off their centre by the difference.
    const axisOf = (piece: PieceReading): number => launch.bodies.find((b) => b.number === piece.number)!.aKm;
    const debrisOrbits = new Map<number, PlaneOrbit>();
    const centreOf = (n: number): number => {
      const orbit = parents.find((p) => p.number === n)?.orbit ?? debrisOrbits.get(n);
      return orbit === undefined ? Number.POSITIVE_INFINITY : Math.abs(median(judged.map((piece) => axisOf(piece) - orbit.aKm)));
    };
    const sharing = [nearest, ...new Set(judged.flatMap((p) => p.within))].filter((n, i, all) => all.indexOf(n) === i && !alerted.has(n) && parents.some((p) => p.number === n));
    const centred = sharing.reduce((best, n) => (centreOf(n) < centreOf(best) ? n : best), nearest);
    // The convergence over the centre: where the pieces, propagated back, converge on another body of their plane better than on the one their centre names by the ambiguity ratio, that body is their parent.
    let converged: { number: number; ratio: number } | null = null;
    if (params.attributionConvergenceNames && sharing.length > 1) {
      const misses = new Map<number, number>();
      for (const n of sharing.slice(0, params.attributionMaxCandidates)) {
        const timed = timePieces(context, n, judged);
        if (timed !== null) misses.set(n, timed.missKm);
      }
      const best = [...misses].reduce<[number, number] | null>((least, entry) => (least === null || entry[1] < least[1] ? entry : least), null);
      const own = misses.get(centred);
      if (best !== null && own !== undefined && best[0] !== centred) converged = { number: best[0], ratio: own / Math.max(best[1], 1e-9) };
    }
    const byCentre = converged !== null && converged.ratio > params.attributionAmbiguityRatio ? converged.number : centred;
    // The stage preference: a body of a better rank in the pieces' plane whose offset from their centre the pieces cannot tell from the named body's is named instead, unless the named body alone made a persistent step in the window.
    const rank = (n: number): number => rankOf(context, launch, n);
    const alternative = sharing.filter((n) => n !== byCentre && rank(n) < rank(byCentre)).reduce<number | null>((best, n) => (best === null || centreOf(n) < centreOf(best) ? n : best), null);
    const preferRatio = alternative === null ? Number.NaN : centreOf(alternative) / Math.max(centreOf(byCentre), params.attributionCentreFloorKm);
    const searchFrom = now - params.attributionSearchDays * DAY_MS;
    const namedStepped = alternative !== null && steppedWithin(context, byCentre, searchFrom, now) && !steppedWithin(context, alternative, searchFrom, now);
    const preferred = params.attributionPrefersStage && alternative !== null && preferRatio <= params.attributionPreferCentreRatio && !namedStepped;
    const number = preferred ? alternative : byCentre;
    if (named.has(number)) continue;
    const centre = centreOf(number);
    const candidate = parents.find((p) => p.number === number);
    const own = launch.bodies.find((b) => b.number === number);
    if (candidate === undefined || own === undefined) continue;
    const subject: PieceSubject = { number, orbit: candidate.orbit, bodyClass: own.bodyClass, atMs: verdict.eventMs, eventMs: verdict.eventMs };
    let refused = 0;
    const reasons: string[] = [];
    if (verdict.launchAgeDays < params.youngLaunchDays && !params.attributionYoungLaunch) {
      refused |= REFUSALS.youngLaunch;
      reasons.push(`the launch is ${verdict.launchAgeDays.toFixed(0)} days old: its new bodies may be its own objects`);
    }
    if (verdict.rate > params.confirmBackgroundMax) {
      refused |= REFUSALS.background;
      reasons.push(`the launch gained ${verdict.backgroundBodies} new bodies in the year before (${verdict.rate.toFixed(1)} a window): an old cloud's backlog`);
    }
    if (launchesInRun > params.attributionBatchLaunchesMax) {
      refused |= REFUSALS.batch;
      reasons.push(`the run brought new bodies to ${launchesInRun} launches older than a year: the catalogue listing a batch of old objects`);
    }
    if (params.stationLaunches.includes(launch.key)) {
      refused |= REFUSALS.station;
      reasons.push(`launch ${launch.key} is a crewed station's: what it sheds is released on purpose`);
    }
    if (visitingRelease(launch.key, own.bodyClass, params)) {
      refused |= REFUSALS.visiting;
      reasons.push(`launch ${launch.key} is a crewed spacecraft's or a station's cargo craft's, and ${number} is not its rocket body: what the craft leaves in orbit is released on purpose`);
    }
    if (byCentre !== centred) reasons.push(`the pieces' axes centre on ${centred}, but propagated back they converge on ${byCentre} ${converged!.ratio.toFixed(1)} times better: it is their parent`);
    if (preferred) reasons.push(`the pieces' axes centre ${centreOf(byCentre).toFixed(1)} km from ${byCentre}'s and ${centreOf(number).toFixed(1)} km from ${number}'s, which their plane and period cannot tell apart, and ${number} is ${RANK_WORDS[rank(number)]} where ${byCentre} is ${RANK_WORDS[rank(byCentre)]}: the likelier parent is named`);
    const judgement = judgePieces(subject, launch, verdict, judged, memory, context, memory.at);
    refused |= judgement.refused;
    reasons.push(...judgement.reasons);
    let kept = judgement.pieces;
    // Pieces made at one instant are not an old cloud's: where they share an origin closely enough, the rules that read the launch's history as one do not refuse them.
    let overridden: PiecesEventTime | null = null;
    if (refused !== 0 && (refused & ~HISTORY_REFUSALS) === 0 && params.originOverrideHours < 1e8) {
      const strict = timePieces(context, number, judged);
      if (strict !== null && overridesHistory(strict.origin, params) && !sameInstant(strict.origin.medianAt, memory.eventMs, params)) {
        reasons.push(`but ${strict.origin.timed} of the ${strict.origin.tried} pieces cross ${number} within ${strict.origin.dev75Hours.toFixed(1)} h of one instant, three quarters of them: made at once, not an old cloud's, so the launch's history does not refuse them`);
        [refused, kept, overridden] = [0, judged, strict];
      }
    }
    if (kept.length < params.attributionMinPieces && judgement.refused === 0) {
      refused |= REFUSALS.minPieces;
      reasons.push(`${kept.length} piece${kept.length === 1 ? "" : "s"} kept, under the ${params.attributionMinPieces} an attribution needs`);
    }
    const rivals = sharing.filter((n) => n !== number);
    const rivalCentre = rivals.reduce((least, n) => Math.min(least, centreOf(n)), Number.POSITIVE_INFINITY);
    const centreBound = params.attributionCentreRatio * Math.max(centre, params.attributionCentreFloorKm);
    let timed: PiecesEventTime | null = null;
    let rival = Number.NaN;
    let stepped = 0;
    let twins: number[] = [];
    let priorBreaks = 0;
    // The pieces are timed, and the common-origin test read, where the other rules refused nothing: a refused group costs no propagation.
    if (refused === 0) timed = overridden ?? timePieces(context, number, kept);
    if (refused === 0) {
      if (timed === null) {
        refused |= REFUSALS.untimed;
        reasons.push(`the pieces could not be propagated back against the parent`);
      } else {
        if (timed.missKm > params.attributionMissKmMax) {
          refused |= REFUSALS.miss;
          reasons.push(`propagated back, the pieces miss the parent by ${timed.missKm.toFixed(0)} km at best, beyond ${params.attributionMissKmMax}: not its pieces`);
        }
        const sinceLaunchDays = verdict.launchAgeDays - timed.origin.ageDays;
        if (timed.origin.timed >= 2 && sinceLaunchDays < params.originLaunchMarginDays) {
          refused |= REFUSALS.origin;
          reasons.push(`the pieces cross ${number} ${sinceLaunchDays.toFixed(0)} days after the launch was first seen, under ${params.originLaunchMarginDays}: the launch's own objects catalogued late, not a breakup`);
        }
        if (!passesOrigin(timed.origin, params)) {
          refused |= REFUSALS.origin;
          reasons.push(`the pieces' own closest approaches to ${number} do not share an instant: half of them cross it within ${timed.origin.dev50Hours.toFixed(1)} h of their median, three quarters within ${timed.origin.dev75Hours.toFixed(1)} h, ${timed.origin.timed} of ${timed.origin.tried} in the window, at ${timed.origin.ageDays.toFixed(1)} days' age: the late pieces of an old cloud, not a breakup`);
        }
        if (!passesSmallBatch(kept.length, timed, params)) {
          refused |= REFUSALS.smallBatch;
          reasons.push(smallBatchReason(kept.length, timed, number, params));
        }
        // With the twins on, a launch with few debris-classed bodies offers its older ones as twins too: a fairing cover and its siblings, a tank beside its stage, share the pieces' plane and orbit as a payload's stage does.
        const debrisTwins = path === ATTRIBUTION_PATHS.cloud && params.attributionTwins ? debrisSharing(context, launch, kept, verdict.eventMs, alerted, debrisOrbits) : [];
        if (rivals.length + debrisTwins.length > 0) {
          const misses = rivalMisses(context, [...rivals, ...debrisTwins], kept);
          rival = Math.min(Number.POSITIVE_INFINITY, ...misses.values());
          // A body that made a persistent step in the search window, where none of the others did, is the parent the pieces cannot otherwise name.
          const to = timed.at + 2 * timed.sigmaMinutes * 60_000;
          stepped = (steppedWithin(context, number, to - params.attributionSearchDays * DAY_MS, Math.max(to, now)) ? 1 : 0) | (rivals.some((r) => steppedWithin(context, r, to - params.attributionSearchDays * DAY_MS, Math.max(to, now))) ? 2 : 0);
          // A twin: another body the pieces are not told from, neither by the centre of their axes nor by their convergence; a body not timed is told from it as before.
          twins = [...rivals, ...debrisTwins].filter((r) => centreOf(r) < centreBound && misses.has(r) && misses.get(r)! < params.attributionAmbiguityRatio * timed!.missKm);
          if (twins.length > 0) {
            const stepNames = params.attributionStepBreaksTies && stepped === 1;
            // The rank breaks a tie no step does: a rocket body among payloads, a dead payload among working ones.
            priorBreaks = twins.every((t) => rank(number) < rank(t)) ? 1 : 0;
            const priorNames = !stepNames && params.attributionPrefersStage && priorBreaks === 1;
            const why = stepNames ? `, which alone made a persistent step in the window` : priorNames ? `, ${RANK_WORDS[rank(number)]}, the likelier parent of the ${twins.length + 1}` : ", on the centre";
            if (params.attributionTwins && (stepNames || priorNames || params.attributionTwinsUnresolved)) reasons.push(`the pieces cannot be told from ${twins.length} other bod${twins.length === 1 ? "y" : "ies"} of the launch (${twins.join(", ")}): their axes centre ${centre.toFixed(1)} km from ${number}'s and ${twins.map((r) => centreOf(r).toFixed(1)).join(", ")} km from theirs, and they converge on them within ${params.attributionAmbiguityRatio} times their miss of ${number} (${twins.map((r) => misses.get(r)!.toFixed(1)).join(", ")} km against ${timed.missKm.toFixed(1)}): the launch is named with its candidates, ${number} first${why}`);
            else if (stepNames || priorNames) reasons.push(`the pieces converge on ${number} and on another body of the launch alike, and ${number}${why}: it is named`);
            else {
              refused |= REFUSALS.ambiguous;
              reasons.push(`the pieces lie in the plane of ${rivals.length} other bod${rivals.length === 1 ? "y" : "ies"} of the launch too, and converge on one of them within ${params.attributionAmbiguityRatio} times their miss of ${number} (${rival.toFixed(1)} km against ${timed.missKm.toFixed(1)}): the parent cannot be named, the cloud stays for review`);
            }
            if (!params.attributionTwins || (refused & REFUSALS.ambiguous) !== 0) twins = [];
          } else if (rival < params.attributionAmbiguityRatio * timed.missKm) reasons.push(`the pieces' semi-major axes centre ${centre.toFixed(1)} km from ${number}'s and ${rivalCentre.toFixed(1)} km at best from the other bodies' in their plane: it is named`);
        }
      }
    }
    const ok = refused === 0 && timed !== null;
    const twinSignals: Partial<Record<SignalName, number>> = { attributionTwins: twins.length, candidate1: twins[0], candidate2: twins[1], candidate3: twins[2], attributionPriorBreaks: priorBreaks };
    const preferSignals: Partial<Record<SignalName, number>> = { preferNamedRank: rank(byCentre), ...(alternative === null ? {} : { preferAlternative: alternative, preferAlternativeRank: rank(alternative), preferCentreRatio: preferRatio, preferNamedStepped: namedStepped ? 1 : 0 }), ...(preferred ? { preferredFrom: byCentre } : {}), ...(converged === null ? {} : { convergedAlternative: converged.number, convergedRatio: converged.ratio }), ...(byCentre !== centred ? { convergedFrom: centred } : {}) };
    context.log.push(logRow(now, number, { ...attributionSignals(launch, verdict, path, own.bodyClass, judged, judgement, rivals.length, timed, rival, refused, ok), ...originSignals(timed, Math.min(kept.length, params.attributionMaxPieces)), ...twinSignals, ...preferSignals, launchesInRun, attributionStepped: stepped, attributionCentreKm: centre, attributionRivalCentreKm: rivalCentre }));
    if (!ok) continue;
    raised++;
    named.add(number);
    const evidence: Record<string, number> = { attributed: 1, piecesInPlane: kept.length, piecesJudged: judged.length, piecesNew: verdict.pieces.length, windowBodies: verdict.windowBodies, backgroundBodies: verdict.backgroundBodies, lambda: round5(verdict.lambda), pBurst: round5(verdict.p), cloudDeltaVMps: round5(judgement.reading.deltaVMps), gabbardSpreadKm: round5(verdict.gabbardSpreadKm), planeDistanceMax: params.planeDistanceMax, planeDistanceMedian: round5(median(kept.map((p) => p.distance))), parentAgeDays: round5(judgement.reading.parentAgeDays), cloudPieces: judgement.reading.cloudPieces, daysSinceCloud: round5(judgement.reading.daysSinceCloud), parentCloudDistance: round5(judgement.reading.parentCloudDistance), launchAgeDays: round5(verdict.launchAgeDays), missKm: round5(timed!.missKm), sigmaMinutes: round5(timed!.sigmaMinutes), crossings: timed!.crossings, rivals: rivals.length, bodyClass: BODY_CLASSES.indexOf(own.bodyClass) };
    if (Number.isFinite(timed!.spreadMinutes)) evidence.spreadMinutes = round5(timed!.spreadMinutes);
    if (Number.isFinite(rival)) evidence.rivalMissKm = round5(rival);
    const event = piecesEvent(timed!, params);
    const o = timed!.origin;
    for (const [name, value] of [["originTried", o.tried], ["originTimed", o.timed], ["originDev50Hours", o.dev50Hours], ["originDev75Hours", o.dev75Hours], ["originSpreadHours", o.spreadHours], ["originAgeDays", o.ageDays]] as const) if (Number.isFinite(value)) evidence[name] = round5(value);
    if (event.byOrigin) [evidence.sigmaMinutes, evidence.eventByOrigin] = [round5(event.sigmaMinutes), 1];
    if (twins.length > 0) evidence.twins = twins.length;
    if (preferred) evidence.preferredFrom = byCentre;
    if (byCentre !== centred) evidence.convergedFrom = centred;
    const words = [
      `${kept.length} fresh piece${kept.length === 1 ? "" : "s"} under launch ${launch.key} (${kept.map((p) => p.number).join(", ")}), numbered above the catalogue's mark and first published after the cloud's first set, in the plane of ${number} (distance ${kept.map((p) => p.distance.toFixed(1)).join(", ")} to the nearest plane of the launch's bodies), their semi-major axes centred ${centre.toFixed(1)} km from its, moving ${judgement.reading.deltaVMps.toFixed(1)} m/s from it: a breakup of ${number}, attributed from the pieces with no step seen on it`,
      timingReason(timed!, number),
      ...(rivals.length > 0 ? [`the pieces lie in the plane of ${rivals.length} other bod${rivals.length === 1 ? "y" : "ies"} of the launch too, and miss the nearest of them by ${rival.toFixed(1)} km`] : []),
      ...reasons,
      ...verdict.reasons,
    ];
    context.verdicts.push({ kind: "object", state: "confirmed", number, launch: launch.key, raisedAt: now, step: null, event: { at: event.at, from: event.from, to: event.to }, evidence, reasons: words, bodies: kept.map((p) => p.number), ...(twins.length > 0 ? { candidates: [number, ...twins] } : {}) });
    noteCloud(launch, now, event.at, true);
    for (const twin of twins) named.add(twin);
    launch.lastCloudAt = now;
  }
  return raised;
}

/**
 * The launch pass: every launch the run brought new bodies to is judged
 * for a burst and for pieces; open alerts on its parents are confirmed by
 * pieces in their plane first published after the step; the pieces in the
 * plane of a body with no open alert are attributed to it where the rules
 * allow (`attributeCloud`); and a burst with consistent pieces nobody was
 * named for is listed for review. An analyst range's burst confirms an
 * open alert only where the parameters let it and the plane test names
 * that alert's parent alone.
 */
function judgeLaunches(context: RunContext): void {
  const { params, now } = context;
  // Every body the detector meets in its first window is new to it: no launch is judged until the window has passed since the first run.
  if (now - context.catalogue.startedAt < params.burstWindowDays * DAY_MS) return;
  // How many launches older than a year the run brought new bodies to: many at once is the catalogue listing a batch of old objects.
  const launchesInRun = [...context.newBodies.keys()].filter((key) => !isAnalystLaunch(key) && now - launchFor(context.launches, key).firstSeenAt > 365 * DAY_MS).length;
  for (const [key, newBodies] of context.newBodies) {
    const launch = launchFor(context.launches, key);
    const analyst = isAnalystLaunch(key);
    // Read afresh per launch: a confirmation closes an alert.
    const alerted = alertedStates(context);
    const alertsHere = analyst ? alerted.filter((s) => s.alert!.origin === "suspected") : alerted.filter((s) => s.alert!.launch === key);
    const parents: ParentCandidate[] = alertsHere.map((s) => ({ number: s.number, orbit: s.alert!.orbit, eventMs: s.alert!.candidate.tStep }));
    if (!analyst) {
      // Every other body of the launch not classed debris and seen before this run is a candidate parent (a day-old stage included), its event the first window body's first epoch.
      const window = now - params.burstWindowDays * DAY_MS;
      const firstEpoch = Math.min(...launch.bodies.filter((b) => b.firstSeenAt > window).map((b) => b.firstEpoch));
      for (const body of launch.bodies) {
        if (isFragmentClass(body.bodyClass) || parents.some((p) => p.number === body.number) || body.firstSeenAt >= now) continue;
        parents.push({ number: body.number, orbit: parentOrbit(context, body.number, { epochMs: body.firstEpoch, aKm: body.aKm, eccentricity: body.eccentricity, inclinationDeg: body.inclinationDeg, raanDeg: body.raanDeg, meanMotion: body.meanMotion }), eventMs: firstEpoch });
      }
    }
    const verdict = judgeCloud(launch, context.catalogue, parents, now, newBodies, params);
    let decision: number = CLOUD_DECISIONS.nothing;
    // The launch's cloud memory as it stood before this run, read once, so the order the alerts are judged in does not matter.
    const memory = { at: launch.lastCloudBurstAt, eventMs: launch.lastCloudEventMs };
    let confirmedHere = false;
    // Open alerts first: the pieces nearest each alerted parent, new by numbering, in its plane and first published after its step.
    for (const state of alertsHere) {
      const alert = state.alert!;
      const mine = verdict.pieces.filter((piece) => piece.parent === state.number || (verdict.parents.length === 1 && piece.parent === null));
      const afterStep = mine.filter((piece) => piece.firstSeenAt >= alert.candidate.beforeEpoch && piece.firstEpoch >= alert.candidate.beforeEpoch - DAY_MS);
      alert.pieces.new += mine.length;
      alert.pieces.aboveMark += afterStep.filter((piece) => piece.aboveMark).length;
      const confirming = verdict.consistent.filter((piece) => piece.parent === state.number && piece.firstSeenAt >= alert.candidate.beforeEpoch && piece.firstEpoch >= alert.candidate.beforeEpoch - DAY_MS);
      alert.pieces.inPlane += confirming.length;
      alert.pieces.afterStep += afterStep.length;
      if (confirming.length === 0) continue;
      const path = analyst ? ATTRIBUTION_PATHS.analyst : ATTRIBUTION_PATHS.alert;
      let refused = 0;
      const extra: string[] = [];
      let timed: PiecesEventTime | null = null;
      if (analyst) {
        // An analyst range's numbers are reused and say nothing of a launch: its pieces confirm an alert only where the plane test names that parent alone among the open alerts and they converge on it.
        if (!params.analystAttributes) refused |= REFUSALS.analyst;
        else if (confirming.some((piece) => piece.within.length !== 1)) refused |= REFUSALS.ambiguous;
      } else {
        // The launch must be old enough for its new bodies not to be its own, and quiet enough in the year before for them not to be an old cloud's backlog.
        if (verdict.launchAgeDays < params.youngLaunchDays) refused |= REFUSALS.youngLaunch;
        if (verdict.rate > params.confirmBackgroundMax) refused |= REFUSALS.background;
        // A crewed station's pieces are released on purpose: they confirm nothing, its reboosts least of all; and so are a crewed or cargo craft's, but for its rocket body's.
        if (params.stationLaunches.includes(key)) refused |= REFUSALS.station;
        if (visitingRelease(key, alert.bodyClass, params)) refused |= REFUSALS.visiting;
      }
      // On an analyst range, the pieces that lie within the plane bound of another open alert's parent too: the plane test does not name this one alone.
      const shared = analyst ? confirming.filter((piece) => piece.within.length > 1).length : 0;
      const overridable = (bits: number): boolean => !analyst && bits !== 0 && (bits & ~HISTORY_REFUSALS) === 0 && params.originOverrideHours < 1e8;
      if (refused !== 0 && !overridable(refused)) {
        context.log.push(logRow(now, state.number, attributionSignals(launch, verdict, path, alert.bodyClass, confirming, null, shared, null, Number.NaN, refused, false)));
        continue;
      }
      const judged = judgePieces({ number: state.number, orbit: alert.orbit, bodyClass: alert.bodyClass, atMs: alert.candidate.afterEpoch, eventMs: alert.candidate.tStep }, launch, verdict, confirming, memory, context);
      alert.confirmation = judged.reading;
      refused |= judged.refused;
      let pieces = judged.pieces;
      // Pieces made at one instant are not an old cloud's: where they share an origin closely enough, the rules that read the launch's history as one do not refuse them.
      if (overridable(refused)) {
        const strict = timePieces(context, state.number, confirming);
        if (strict !== null && overridesHistory(strict.origin, params) && !sameInstant(strict.origin.medianAt, memory.eventMs, params)) {
          extra.push(`${strict.origin.timed} of the ${strict.origin.tried} pieces cross ${state.number} within ${strict.origin.dev75Hours.toFixed(1)} h of one instant, three quarters of them: made at once, not an old cloud's, so the launch's history does not refuse them`);
          [refused, pieces, timed] = [0, confirming, strict];
        }
      }
      if (refused === 0 && pieces.length > 0) {
        // The pieces timed back against the parent, for the common-origin test and the record: an analyst range's must also converge on it.
        timed = timed ?? timePieces(context, state.number, pieces);
        if (analyst && timed === null) refused |= REFUSALS.untimed;
        else if (analyst && timed!.missKm > params.attributionMissKmMax) refused |= REFUSALS.miss;
        if (originOn(params) && Math.min(pieces.length, params.attributionMaxPieces) >= params.originMinPieces && (timed === null || !passesOrigin(timed.origin, params))) {
          refused |= REFUSALS.origin;
          extra.push(`the pieces' crossings of ${state.number} do not share an instant: the late pieces of an old cloud, not this step's`);
        }
        if (!analyst && params.smallBatchStepsToo && !passesSmallBatch(pieces.length, timed, params)) {
          refused |= REFUSALS.smallBatch;
          extra.push(smallBatchReason(pieces.length, timed, state.number, params));
        }
        if (timed !== null && timed.origin.timed >= 2 && (verdict.launchAgeDays - timed.origin.ageDays < params.originLaunchMarginDays || Math.abs(timed.origin.medianAt - alert.candidate.tStep) / HOUR_MS > params.originStepHoursMax)) {
          refused |= REFUSALS.origin;
          extra.push(`the pieces cross ${state.number} ${((timed.origin.medianAt - alert.candidate.tStep) / HOUR_MS).toFixed(0)} h from its step, ${(verdict.launchAgeDays - timed.origin.ageDays).toFixed(0)} days after the launch was first seen: not the step's pieces`);
        }
        if (timed !== null) extra.push(timingReason(timed, state.number));
      }
      const stepSignals: Partial<Record<SignalName, number>> = timed === null || !Number.isFinite(timed.origin.medianAt) ? {} : { originStepHours: (timed.origin.medianAt - alert.candidate.tStep) / HOUR_MS };
      context.log.push(logRow(now, state.number, { ...attributionSignals(launch, verdict, path, alert.bodyClass, confirming, judged, shared, timed, Number.NaN, refused, refused === 0 && pieces.length > 0), ...(refused === 0 || timed !== null ? originSignals(timed, Math.min(pieces.length, params.attributionMaxPieces)) : {}), ...stepSignals }));
      if (refused !== 0 || pieces.length === 0) continue;
      decision = CLOUD_DECISIONS.confirmed;
      confirmedHere = true;
      const evidence: Record<string, number> = { piecesInPlane: pieces.length, piecesJudged: confirming.length, piecesNew: verdict.pieces.length, windowBodies: verdict.windowBodies, backgroundBodies: verdict.backgroundBodies, lambda: round5(verdict.lambda), pBurst: round5(verdict.p), cloudDeltaVMps: round5(judged.reading.deltaVMps), gabbardSpreadKm: round5(verdict.gabbardSpreadKm), planeDistanceMax: params.planeDistanceMax, parentAgeDays: round5(judged.reading.parentAgeDays), cloudPieces: judged.reading.cloudPieces, daysSinceCloud: round5(judged.reading.daysSinceCloud), parentCloudDistance: round5(judged.reading.parentCloudDistance) };
      // An analyst range's confirmation is timed by its pieces; an alert's event stays its step's, the pieces' timing kept beside it.
      if (timed !== null && analyst) [evidence.missKm, evidence.sigmaMinutes] = [round5(timed.missKm), round5(timed.sigmaMinutes)];
      else if (timed !== null) [evidence.piecesMissKm, evidence.piecesSigmaMinutes] = [round5(timed.missKm), round5(timed.sigmaMinutes)];
      if (timed !== null) for (const [name, value] of [["originTried", timed.origin.tried], ["originTimed", timed.origin.timed], ["originDev50Hours", timed.origin.dev50Hours], ["originDev75Hours", timed.origin.dev75Hours], ["originAgeDays", timed.origin.ageDays]] as const) if (Number.isFinite(value)) evidence[name] = round5(value);
      const reasons = [`${pieces.length} new bod${pieces.length === 1 ? "y" : "ies"} under ${analyst ? `the analyst range ${key}` : `launch ${key}`} (${pieces.map((p) => p.number).join(", ")}) numbered above the catalogue's mark at the step, first published after it, in the parent's plane (distance ${pieces.map((p) => p.distance.toFixed(1)).join(", ")}), moving ${judged.reading.deltaVMps.toFixed(1)} m/s from it`, ...extra, ...judged.reasons, ...verdict.reasons];
      confirmAlert(state, alert, context, reasons, evidence, pieces.map((p) => p.number));
    }
    // The Confirmed channel: the pieces in the plane of a body with no open alert, attributed to it where the rules allow.
    const alertedNumbers = new Set(alertsHere.map((s) => s.number));
    // A burst nobody was named for, within the grace, does not keep its own cloud from being attributed: the memory the attribution reads is the last named one.
    const named = { at: launch.lastNamedAt ?? Number.NEGATIVE_INFINITY, eventMs: launch.lastNamedEventMs ?? Number.NaN };
    const attributionMemory = memory.at > named.at && now - memory.at <= params.attributionUnnamedGraceDays * DAY_MS ? named : memory;
    let attributed = !analyst && params.attributionEnabled ? attributeCloud(launch, verdict, parents, alertedNumbers, attributionMemory, context, launchesInRun) : 0;
    // A launch with few fragment-classed bodies: its older ones are candidate parents too, for the pieces in the plane of no other body (a fairing cover or a tank breaking up).
    if (!analyst && params.attributionEnabled && params.attributionDebrisParentsMax > 0) {
      const windowStart = now - params.burstWindowDays * DAY_MS;
      const debris = launch.bodies.filter((b) => isFragmentClass(b.bodyClass) && b.firstSeenAt <= windowStart && !alertedNumbers.has(b.number));
      const orphans = new Set(verdict.pieces.filter((piece) => piece.aboveMark && isFragmentClass(piece.bodyClass) && piece.within.length === 0).map((piece) => piece.number));
      if (debris.length > 0 && debris.length <= params.attributionDebrisParentsMax && orphans.size > 0) {
        const firstEpoch = Math.min(...launch.bodies.filter((b) => b.firstSeenAt > windowStart).map((b) => b.firstEpoch));
        const debrisParents: ParentCandidate[] = debris.map((body) => ({ number: body.number, orbit: parentOrbit(context, body.number, planeOrbitOf(body)), eventMs: firstEpoch }));
        const byDebris = judgeCloud(launch, context.catalogue, debrisParents, now, newBodies, params);
        attributed += attributeCloud(launch, { ...byDebris, consistent: byDebris.consistent.filter((piece) => orphans.has(piece.number)) }, debrisParents, alertedNumbers, attributionMemory, context, launchesInRun, ATTRIBUTION_PATHS.debris);
      }
    }
    if (attributed > 0) decision = CLOUD_DECISIONS.attributed;
    // The launch remembers its cloud: a burst with consistent pieces under a launch old enough for them not to be its own, or a confirmation by pieces.
    if (!analyst && confirmedHere) noteCloud(launch, now, attributed > 0 ? launch.lastCloudEventMs : verdict.eventMs, true);
    else if (!analyst && attributed === 0 && verdict.burst && verdict.consistent.length > 0 && verdict.launchAgeDays >= params.youngLaunchDays) noteCloud(launch, now, verdict.eventMs);
    if (decision === CLOUD_DECISIONS.nothing) {
      const consistent = verdict.consistent;
      const anyAlert = alertsHere.length > 0 && !analyst;
      if (verdict.burst && consistent.length > 0 && verdict.cloudDeltaVMps >= params.cloudOnlyDeltaVMinMps && !anyAlert && now - launch.lastCloudAt > params.cloudRepeatDays * DAY_MS) {
        decision = CLOUD_DECISIONS.listed;
        launch.lastCloudAt = now;
        const byParent = new Map<number | null, number>();
        for (const piece of consistent) byParent.set(piece.parent, (byParent.get(piece.parent) ?? 0) + 1);
        const parent = [...byParent.entries()].sort((a, b) => b[1] - a[1])[0]![0];
        context.verdicts.push({ kind: "cloud", state: "cloud-only", number: parent, launch: analyst ? null : key, raisedAt: now, step: null, event: null, evidence: { windowBodies: verdict.windowBodies, piecesInPlane: consistent.length, lambda: round5(verdict.lambda), pBurst: round5(verdict.p), cloudDeltaVMps: round5(verdict.cloudDeltaVMps), gabbardSpreadKm: round5(verdict.gabbardSpreadKm), launchAgeDays: round5(verdict.launchAgeDays) }, reasons: [`a burst of new bodies under ${analyst ? `the analyst range ${key}` : `launch ${key}`} in the plane of ${parent ?? "no catalogued parent"} that no body could be named for: listed for review, not a detection`, ...verdict.reasons], bodies: consistent.map((p) => p.number) });
      } else if (verdict.burst && consistent.length === 0) decision = verdict.deployments > 0 || verdict.reasons.some((r) => r.includes("deployment")) ? CLOUD_DECISIONS.deployment : CLOUD_DECISIONS.burstNoPiece;
      else if (verdict.oldCloud) decision = CLOUD_DECISIONS.oldCloud;
    }
    context.log.push(logRow(now, verdict.parents[0]?.number ?? 0, { ...cloudSignals(launch, verdict, alertsHere.length > 0, decision), launchesInRun }));
  }
}

/** The notices published by the run's instant and not yet applied: each confirms the open alerts naming its object or its launch, after their step. */
function applyNotices(context: RunContext): void {
  const applied = context.catalogue.noticesApplied;
  for (const notice of context.notices) {
    if (notice.at > context.now) continue;
    const key = `${notice.number ?? notice.launch ?? "?"}:${notice.at}`;
    if (applied.includes(key)) continue;
    applied.push(key);
    for (const state of alertedStates(context)) {
      const alert = state.alert!;
      const named = (notice.number !== null && notice.number === state.number) || (notice.number === null && notice.launch !== null && notice.launch === alert.launch);
      if (!named || notice.at < alert.candidate.beforeEpoch) continue;
      alert.noticed = true;
      confirmAlert(state, alert, context, [`a public notice names the object: ${notice.text}`], { noticed: 1 }, []);
    }
  }
  if (applied.length > 256) applied.splice(0, applied.length - 256);
}

/** Alerts past the time to live close: dismissed where bodies came under the launch and every one was old, expired otherwise. */
function expire(context: RunContext): void {
  for (const state of alertedStates(context)) {
    const alert = state.alert!;
    if (context.now - alert.raisedAt < context.params.alertTtlDays * DAY_MS) continue;
    const outcome = closingOutcome(alert);
    closeAlert(state, alert, outcome === OUTCOMES.confirmed ? OUTCOMES.expired : outcome, context, true, { evidence: { cadenceAfter: round5(cadenceAfter(alert, context.now, context.params)) } });
  }
}

/**
 * One run of the detector: the sets published since the last run, the
 * states the last run returned, the run's instant and the day's weather
 * in; the states, the verdicts and the log out.
 */
export function runDetector(input: DetectorInput): DetectorOutput {
  const params = parametersWith(input.parameters);
  const states = input.states as Map<number, SeriesState>;
  const launches = input.launches as Map<string, unknown>;
  const context: RunContext = { now: input.now, params, weather: weatherOf(input.space, params), verdicts: [], log: [], recentCandidates: 0, judged: new Set(), tracked: new Set(), states, launches, catalogue: catalogueFor(launches), newBodies: new Map(), notices: input.notices ?? [], decays: input.decays ?? new Map() };
  if (!(context.catalogue.startedAt <= input.now)) context.catalogue.startedAt = input.now;
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
  for (const item of pending) if (item.state.alert !== null) track(item, statsFor(stats, item.band, item.regime), context);
  lapse(states, context);
  judgeLaunches(context);
  applyNotices(context);
  expire(context);
  return { states, launches: input.launches, verdicts: context.verdicts, log: context.log };
}
