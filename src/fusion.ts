import type { EventEstimate, Step, VerdictState } from "./detector.ts";
import { isWorkingStatus, type OpsStatus } from "./elements.ts";
import type { PlaneOrbit } from "./fragments.ts";
import { OUTCOMES, type SignalName } from "./log.ts";
import { isMaintenance, maintenanceToleranceKm, returnMissKm, type HeldLevel } from "./maintenance.ts";
import type { AtypicalTests, ManoeuvreClass } from "./manoeuvre.ts";
import { robustScale } from "./model.ts";
import type { DetectorParameters } from "./params.ts";
import type { Candidate, SeriesState } from "./series.ts";
import { isDeploying, type Mates, type Siblings } from "./siblings.ts";
import { estimateStep, persistenceEstimate, type Environment, type StepEstimate } from "./step.ts";
import type { BodyClass, Regime } from "./truth.ts";

/**
 * The fusion's states, and what an alert keeps while it is open. A
 * persistent step is raised as `suspected` (the detection) or closed as a
 * `manoeuvre`; either opens an alert on the object that stays for the
 * policy's time to live, during which three things can happen. The
 * catalogue lists new bodies under the parent's launch that are new by
 * numbering, share the parent's plane and were first published after the
 * step: the alert is `confirmed`. A public notice names the object or its
 * launch: `confirmed` too. Nothing of the kind comes before the time runs
 * out: `expired`; or bodies came under the launch and every one was old by
 * numbering or out of the plane: `dismissed`, since the catalogue did list
 * pieces under the launch and they were not this event's. A manoeuvre's
 * alert closes silently unless pieces or a notice promote it: the step the
 * record explained was a breakup after all, and the verdict says so late.
 *
 * While open, the alert keeps reading the object's sets against the frozen
 * pre-step model, past the few the candidate was judged on, and records
 * whether the step still held after three and five post sets and after
 * one, three, five and seven days, and when each tier was reached. The
 * scorecard sweeps those offline for the precision of a later raise
 * against the lead it would cost, which is the owner's trade to make. It
 * also counts the object's sets in the days after the step against the
 * days before: a breakup is re-observed, and the cadence is logged as
 * evidence for the sweeps; and it reads the object's one-step-ahead
 * residuals in the second to fourth week after the step against its
 * scatter before, since a tumbling object or one whose shape changed
 * scatters more, which is logged as the damage ratio.
 *
 * The decision itself, whether a persistent step is raised as suspected
 * or closed as a manoeuvre, is `judgeStep` below: the manoeuvre
 * explanations and the breakup signatures weighed as evidence, each a
 * named parameter, so the scorecard's sweep re-applies it from the log.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** The state an alert opened with: the detection, or a step the record explained. */
export type AlertOrigin = Extract<VerdictState, "suspected" | "manoeuvre">;

/**
 * What the fusion weighs on a persistent step: the record's class and the
 * tests it passed, the catalogue's class and status of the object, the
 * step's sign and the radial component its geometry needs, the record's
 * count and how many of its steps were raises, whether the step is
 * disposal-shaped, the object's age and own scatter, and the sixth phase's
 * readings: where the post-step level lies against the altitudes the
 * object held, how many siblings made a like step, and where the
 * launch-mates fly.
 */
export interface StepEvidence {
  manoeuvreClass: ManoeuvreClass;
  tests: AtypicalTests;
  bodyClass: BodyClass;
  opsStatus: OpsStatus;
  deltaKm: number;
  radialMps: number;
  n730: number;
  pastRaises: number;
  disposalLike: boolean;
  ageDays: number;
  sigmaOwnKm: number;
  held: HeldLevel;
  siblings: Siblings;
  mates: Mates;
  towardsMates: boolean;
}

/** The explanations and the signatures as bits, for the log. */
export const EXPLANATION_BITS = { record: 1, maintenance: 2, siblings: 4, deployment: 8, workingStatus: 16 } as const;
export const SIGNATURE_BITS = { size: 1, direction: 2, geometry: 4, dragTerm: 8, againstDrag: 16, nonoperational: 32 } as const;

export interface StepJudgement {
  raised: boolean;
  /** The manoeuvre explanations that apply, each a sentence, and the same as bits. */
  explanations: string[];
  explanationBits: number;
  /** The breakup signatures that apply, each a sentence, and the same as bits. */
  signatures: string[];
  signatureBits: number;
}

/**
 * The fusion of a persistent step's evidence into a verdict. A step is
 * raised as suspected where no manoeuvre explanation applies, or where a
 * breakup signature overrides the explanations; otherwise it is a
 * manoeuvre. The explanations: the object's own record (any class but
 * unique); a return to an altitude the object held in the last year
 * (maintenance); like steps by enough siblings in the window before
 * (a coordinated campaign); a young object climbing towards where its
 * launch-mates fly (deployment; an insertion orbit lies below the working
 * one, so a deployment climbs); and, where the parameter reads the
 * status, an object working today, which could have burned. The last
 * four are independent of the record and are read on payloads only
 * unless the parameter extends them, since a stage or a fragment does not
 * maintain its orbit. The signatures: the record's own tests (the size,
 * the direction, the geometry where the radial component reaches the
 * parameter's kick, the drag term), and a lowering on a record of nothing
 * but raises, not disposal-shaped (a move against drag that no make-up
 * burn makes); and, where the parameters say so, an object nonoperational
 * today with no record of moving itself, since the record is
 * contemporaneous and the status is today's.
 *
 * The weighing: the record's own explanation is beaten by any signature,
 * as it was before this phase. The record's signatures say a step is
 * unlike the object's own past; they say nothing against evidence from
 * outside the record, so as many independent explanations as the
 * parameter asks outweigh them (a working satellite back at the altitude
 * it holds, with its launch-mates stepping alike, is maintaining its
 * orbit whatever its own few past steps looked like). The nonoperational
 * signature is never outweighed: an object that does not work cannot have
 * burned. An occasional step on a non-payload is raised where that
 * parameter says so, as before.
 */
export function judgeStep(evidence: StepEvidence, params: DetectorParameters): StepJudgement {
  const { manoeuvreClass, tests, bodyClass, opsStatus, deltaKm, held, siblings, mates } = evidence;
  const explanations: string[] = [];
  let explanationBits = 0;
  let independent = 0;
  const explain = (bit: number, why: string): void => {
    explanations.push(why);
    explanationBits |= bit;
    if (bit !== EXPLANATION_BITS.record) independent++;
  };
  if (manoeuvreClass !== "unique") explain(EXPLANATION_BITS.record, `the object's own record explains the step: it is classed ${manoeuvreClass}`);
  const payload = bodyClass === "payload";
  if (payload || params.explanationsForNonPayloads) {
    if (isMaintenance(held, deltaKm, evidence.sigmaOwnKm, params)) {
      const ago = deltaKm >= 0 ? held.topMonthsAgo : held.bottomMonthsAgo;
      explain(EXPLANATION_BITS.maintenance, `the step ${deltaKm >= 0 ? "raises" : "lowers"} the object back to the ${deltaKm >= 0 ? "highest" : "lowest"} altitude it held ${ago === 0 ? "this month" : `${ago} month${ago === 1 ? "" : "s"} ago`}, from ${(deltaKm >= 0 ? held.topKm : held.bottomKm).toFixed(3)} km ${deltaKm >= 0 ? "below" : "above"} it to ${returnMissKm(held, deltaKm).toFixed(3)} km of it (tolerance ${maintenanceToleranceKm(evidence.sigmaOwnKm, params).toFixed(3)} km): orbit maintenance`);
    }
    const alike = siblings.launch + siblings.orbit;
    if (alike >= params.siblingsMin) explain(EXPLANATION_BITS.siblings, `${alike} other object${alike === 1 ? "" : "s"} (${siblings.launch} of the launch, ${siblings.orbit} of the shell) made a like step in the ${params.siblingWindowDays} days before: a coordinated manoeuvre`);
    if (deltaKm > 0 && isDeploying(evidence.ageDays, evidence.towardsMates, mates, params)) explain(EXPLANATION_BITS.deployment, `an object ${evidence.ageDays.toFixed(0)} days old climbing towards the altitude where the launch's ${mates.count} other payload${mates.count === 1 ? " flies" : "s fly"} (a semi-major axis of ${mates.medianAKm.toFixed(1)} km): deploying`);
    if (params.opsStatusEvidence && isWorkingStatus(opsStatus)) explain(EXPLANATION_BITS.workingStatus, params.opsStatusDated ? `the object was ${opsStatus} at the step (its end of contact came after it, or it works today), so it could have burned` : `the catalogue lists the object as ${opsStatus}, so it could have burned; the status is the catalogue's today`);
  }
  const signatures: string[] = [];
  let signatureBits = 0;
  const sign = (bit: number, why: string): void => {
    signatures.push(why);
    signatureBits |= bit;
  };
  if (tests.size !== null) sign(SIGNATURE_BITS.size, tests.size);
  if (tests.direction !== null) sign(SIGNATURE_BITS.direction, tests.direction);
  if (tests.geometry !== null && evidence.radialMps >= params.geometryKickMinMps) sign(SIGNATURE_BITS.geometry, tests.geometry);
  if (tests.dragTerm !== null) sign(SIGNATURE_BITS.dragTerm, tests.dragTerm);
  if (deltaKm < 0 && !evidence.disposalLike && evidence.n730 >= params.againstDragMinRaises && evidence.pastRaises === evidence.n730) sign(SIGNATURE_BITS.againstDrag, evidence.n730 === 0 ? `a lowering on an object with no step in its record: a move against drag` : `a lowering on an object whose ${evidence.n730} past step${evidence.n730 === 1 ? " was a raise" : "s were all raises"}: a move against drag that no make-up burn makes`);
  const recordSignatures = signatures.length;
  if (params.opsStatusEvidence && params.nonoperationalOverrides && opsStatus === "nonoperational" && manoeuvreClass === "unique") sign(SIGNATURE_BITS.nonoperational, params.opsStatusDated ? `the object fell silent more than ${params.endedUnknownDays} days before the step, so no manoeuvre explanation is owed` : `the catalogue lists the object as nonoperational, so no manoeuvre explanation is owed; the status is the catalogue's today`);
  const nonoperational = (signatureBits & SIGNATURE_BITS.nonoperational) !== 0;
  const outweighed = independent >= params.independentOutweighs;
  const occasionalNonPayload = params.occasionalRaisesNonPayload && manoeuvreClass === "occasional" && !payload;
  const raised = explanations.length === 0 || nonoperational || (recordSignatures > 0 && !outweighed) || occasionalNonPayload;
  return { raised, explanations, explanationBits, signatures, signatureBits };
}

/** One persistence tier as the alert reached it. */
export interface TierPoint {
  /** The run's instant when the tier was reached, in milliseconds since 1970. */
  at: number;
  k: number;
  spanHours: number;
  z: number;
  zMean: number;
  rho: number;
  evidence: number;
  /** Whether the persistence gates still passed at the tier. */
  held: boolean;
}

/** The tiers by key: `3` and `5` after that many post sets, `D1` to `D7` after that many days of span. */
export type TierKey = "3" | "5" | "D1" | "D3" | "D5" | "D7";

/** What the alert counted of the bodies catalogued under the launch while it was open. */
export interface PieceCounts {
  /** New bodies under the launch after the step, those numbered above the mark and with no set before the step, those in the parent's plane, and those first published after the step. */
  new: number;
  aboveMark: number;
  inPlane: number;
  afterStep: number;
}

/**
 * What the confirmation rules read when pieces in the parent's plane came
 * under the launch after the step, kept on the alert so its row and its
 * verdict carry the numbers: the pieces and their cloud velocity, the
 * parent's standing under the launch, the launch's background and its
 * remembered cloud, and how the pieces stood against that cloud.
 */
export interface ConfirmationReading {
  /** The pieces in the parent's plane, new by numbering and first published after the step, and the median tangential impulse they imply from the parent, in metres a second. */
  pieces: number;
  deltaVMps: number;
  /** The parent's age in days from its first set under the launch to its step (infinite where the launch has no record of it), and whether the catalogue classes it as a fragment is. */
  parentAgeDays: number;
  parentFragment: boolean;
  /** The launch's new bodies in the year before the window, every class; the bodies of its earlier cloud (fragment-classed, first seen in the year before and in the window, the parent and the pieces left out); and how many other bodies the window brought. */
  backgroundBodies: number;
  cloudPieces: number;
  windowBodies: number;
  /** The days since the launch's last remembered cloud (a burst with consistent pieces or a confirmation), infinite where none. */
  daysSinceCloud: number;
  /** The parent's nearest plane distance to the earlier cloud's bodies, infinite with none. */
  parentCloudDistance: number;
  /** How many of the pieces lie out of the earlier cloud's plane, and how many lie nearer the parent's plane than the cloud's nearest body does. */
  piecesOutOfCloud: number;
  piecesNearerThanCloud: number;
  /** The days from the pieces' earliest first set to the parent's reentry, where the catalogue had published it by the run (negative where the parent fell before its pieces were seen); NaN where it had not. */
  decayDays: number;
  /** Whether the rules refused the confirmation. */
  refused: boolean;
}

export interface OpenAlert {
  origin: AlertOrigin;
  /** When the alert was raised, the run's instant. */
  raisedAt: number;
  /** The candidate, frozen: its pre fits are what every later set is measured against. */
  candidate: Candidate;
  step: Step;
  event: EventEstimate | null;
  launch: string | null;
  /** The parent's orbit after the step, for the plane test: the opening post set's. */
  orbit: PlaneOrbit;
  regime: Regime;
  bodyClass: BodyClass;
  /** The evidence the raising verdict carried, for the confirming one to extend. */
  evidence: Record<string, number>;
  reasons: string[];
  tiers: Partial<Record<TierKey, TierPoint>>;
  /** The last estimate over the post sets, and how many it read. */
  last: StepEstimate | null;
  /** The epochs of the post sets seen, for the cadence after the step; bounded by the alert's post-set limit. */
  postEpochs: number[];
  /** The sets a day before the step, from the state's day bins at the opening. */
  cadenceBefore: number;
  pieces: PieceCounts;
  noticed: boolean;
  /** The last confirmation reading, where pieces in the parent's plane were judged; null where none came. */
  confirmation: ConfirmationReading | null;
  /** Whether the scoped line has raised the step (a `scoped` verdict); absent on an alert written before the scope existed. */
  scopedRaised?: boolean;
  /** The object's one-step-ahead residuals in the damage window after the step, by the epoch each belongs to, as the alert collected them from the ring; bounded. Absent on an alert written before the reading existed. */
  damage?: { epochs: number[]; residuals: number[] };
}

/** The most residuals the damage reading keeps. Policy: the ring's size. */
export const DAMAGE_MAX_RESIDUALS = 32;
/** The fewest residuals the damage ratio rests on; with fewer it is not read. Policy: four, the least a robust scale means anything with. */
export const DAMAGE_MIN_RESIDUALS = 4;

/** Collects from the ring the residuals of the sets in the damage window after the step that the alert has not yet noted. */
export function noteDamage(alert: OpenAlert, state: SeriesState, params: DetectorParameters): void {
  const damage = (alert.damage ??= { epochs: [], residuals: [] });
  const from = alert.candidate.afterEpoch + params.damageFromDays * DAY_MS;
  const to = alert.candidate.afterEpoch + params.damageToDays * DAY_MS;
  for (let i = 0; i < state.epochs.length && damage.epochs.length < DAMAGE_MAX_RESIDUALS; i++) {
    const epoch = state.epochs[i]!;
    const residual = state.resid[i]!;
    if (epoch < from || epoch > to || !Number.isFinite(residual) || damage.epochs.includes(epoch)) continue;
    damage.epochs.push(epoch);
    damage.residuals.push(residual);
  }
}

/** The damage reading: the robust scatter of the residuals collected, how many, and the ratio to the object's short scatter before the step (its own scatter where the short one was not yet measured); NaN with too few. */
export function damageOf(alert: OpenAlert): { sigma: number; residuals: number; ratio: number } {
  const residuals = alert.damage?.residuals ?? [];
  if (residuals.length < DAMAGE_MIN_RESIDUALS) return { sigma: Number.NaN, residuals: residuals.length, ratio: Number.NaN };
  const sigma = robustScale(residuals);
  const before = alert.candidate.sigmaShort > 0 ? alert.candidate.sigmaShort : alert.candidate.sigmaOwn;
  return { sigma, residuals: residuals.length, ratio: before > 0 ? sigma / before : Number.NaN };
}

/** Whether the persistence gates pass on an estimate: the size (the level or the mean, by the parameter), the ratio's band and the evidence. */
export function persistent(estimate: StepEstimate, params: DetectorParameters): boolean {
  const size = params.persistOnMeanStep ? estimate.zMean : estimate.z;
  const inBand = Number.isFinite(estimate.rhoMedian) && estimate.rhoMedian >= params.rhoMin && estimate.rhoMedian <= params.rhoMax;
  return Math.abs(size) >= params.zPersist && inBand && estimate.evidence >= params.evidenceMin;
}

export interface OpenAlertInput {
  origin: AlertOrigin;
  now: number;
  candidate: Candidate;
  step: Step;
  event: EventEstimate | null;
  launch: string | null;
  orbit: PlaneOrbit;
  regime: Regime;
  bodyClass: BodyClass;
  evidence: Record<string, number>;
  reasons: string[];
  estimate: StepEstimate;
  cadenceBefore: number;
}

/** Opens an alert on the object, the candidate's estimate as the first reading. */
export function openAlert(state: SeriesState, input: OpenAlertInput, params: DetectorParameters): OpenAlert {
  const alert: OpenAlert = {
    origin: input.origin,
    raisedAt: input.now,
    candidate: input.candidate,
    step: input.step,
    event: input.event,
    launch: input.launch,
    orbit: input.orbit,
    regime: input.regime,
    bodyClass: input.bodyClass,
    evidence: input.evidence,
    reasons: input.reasons,
    tiers: {},
    last: input.estimate,
    postEpochs: [],
    cadenceBefore: input.cadenceBefore,
    pieces: { new: 0, aboveMark: 0, inPlane: 0, afterStep: 0 },
    noticed: false,
    confirmation: null,
    damage: { epochs: [], residuals: [] },
  };
  recordTiers(alert, input.estimate, input.now, params);
  state.alert = alert;
  return alert;
}

/** Records every tier the estimate has reached and the alert had not. */
function recordTiers(alert: OpenAlert, estimate: StepEstimate, now: number, params: DetectorParameters): void {
  const point = (): TierPoint => ({ at: now, k: estimate.k, spanHours: estimate.spanHours, z: estimate.z, zMean: estimate.zMean, rho: estimate.rhoMedian, evidence: estimate.evidence, held: persistent(estimate, params) });
  for (const sets of params.tierSets) {
    const key = String(sets) as TierKey;
    if (estimate.k >= sets && alert.tiers[key] === undefined) alert.tiers[key] = point();
  }
  for (const days of params.tierDays) {
    const key = `D${days}` as TierKey;
    if (estimate.spanHours >= days * 24 && alert.tiers[key] === undefined) alert.tiers[key] = point();
  }
}

/** Reads the object's post sets against the alert's frozen pre fits once more, on a run that brought a post set. */
export function trackAlert(state: SeriesState, alert: OpenAlert, epochMs: number, environment: Environment, now: number, params: DetectorParameters): void {
  if (epochMs > alert.candidate.afterEpoch && alert.postEpochs.length < params.alertMaxPostSets && !alert.postEpochs.includes(epochMs)) alert.postEpochs.push(epochMs);
  const estimate = estimateStep(state, alert.candidate, environment, params, params.alertMaxPostSets);
  if (estimate === null) return;
  alert.last = estimate;
  // The tiers read the step's persistence where it was judged: on the perigee radius or the inclination where either opened the candidate.
  recordTiers(alert, alert.candidate.axis === undefined ? estimate : persistenceEstimate(state, alert.candidate, environment, params, params.alertMaxPostSets)!, now, params);
}

/** The sets a day the object had in the days after the step, from the post sets the alert saw; NaN until those days have passed. */
export function cadenceAfter(alert: OpenAlert, now: number, params: DetectorParameters): number {
  const until = alert.candidate.afterEpoch + params.cadenceAfterDays * DAY_MS;
  if (now < until) return Number.NaN;
  let sets = 0;
  for (const epoch of alert.postEpochs) if (epoch > alert.candidate.afterEpoch && epoch <= until) sets++;
  // The opening post set itself.
  return (sets + 1) / params.cadenceAfterDays;
}

/** How the alert ended, by what it saw: confirmed by pieces or a notice, dismissed when bodies came and every one was old, expired otherwise. */
export function closingOutcome(alert: OpenAlert): number {
  if (alert.noticed || alert.pieces.inPlane > 0) return OUTCOMES.confirmed;
  if (alert.pieces.new > 0) return OUTCOMES.dismissed;
  return OUTCOMES.expired;
}

/** The alert's row for the log: the tiers, the cadence and the pieces. */
export function alertSignals(alert: OpenAlert, now: number, params: DetectorParameters): Partial<Record<SignalName, number>> {
  const after = cadenceAfter(alert, now, params);
  const damage = damageOf(alert);
  const signals: Partial<Record<SignalName, number>> = {
    damageSigma: damage.sigma,
    damageResiduals: damage.residuals,
    damageRatio: damage.ratio,
    alertState: alert.origin === "suspected" ? OUTCOMES.suspected : OUTCOMES.manoeuvre,
    alertSets: alert.last?.k ?? 1,
    alertSpanHours: alert.last?.spanHours ?? 0,
    alertDays: (now - alert.raisedAt) / DAY_MS,
    deltaKm: alert.last?.delta,
    zk: alert.last?.z,
    zMean: alert.last?.zMean,
    rhoMedian: alert.last?.rhoMedian,
    stepEvidence: alert.last?.evidence,
    cadenceBefore: alert.cadenceBefore,
    cadenceAfter: after,
    cadenceRatio: alert.cadenceBefore > 0 ? after / alert.cadenceBefore : Number.NaN,
    piecesNew: alert.pieces.new,
    piecesAboveMark: alert.pieces.aboveMark,
    piecesInPlane: alert.pieces.inPlane,
    piecesAfterStep: alert.pieces.afterStep,
    noticed: alert.noticed ? 1 : 0,
  };
  const reading = alert.confirmation;
  if (reading !== null) {
    signals.confirmPieces = reading.pieces;
    signals.confirmDeltaVMps = reading.deltaVMps;
    signals.parentAgeDays = reading.parentAgeDays;
    signals.parentFragment = reading.parentFragment ? 1 : 0;
    signals.backgroundBodies = reading.backgroundBodies;
    signals.cloudPieces = reading.cloudPieces;
    signals.windowBodies = reading.windowBodies;
    signals.daysSinceCloud = reading.daysSinceCloud;
    signals.parentCloudDistance = reading.parentCloudDistance;
    signals.piecesOutOfCloud = reading.piecesOutOfCloud;
    signals.piecesNearerThanCloud = reading.piecesNearerThanCloud;
    signals.confirmRefused = reading.refused ? 1 : 0;
  }
  for (const [key, point] of Object.entries(alert.tiers) as [TierKey, TierPoint][]) {
    const name = `tier${key}` as const;
    signals[`${name}Held`] = point.held ? 1 : 0;
    signals[`${name}Z`] = point.z;
    signals[`${name}ZMean`] = point.zMean;
    signals[`${name}Rho`] = point.rho;
    signals[`${name}At`] = point.at;
  }
  return signals;
}

/** The days from the step's first post set to an instant. */
export const daysAfterStep = (alert: OpenAlert, at: number): number => (at - alert.candidate.afterEpoch) / DAY_MS;

/** The hours a span covers, for the reasons. */
export const hoursOf = (ms: number): number => ms / HOUR_MS;
