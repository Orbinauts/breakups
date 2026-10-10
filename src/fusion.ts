import type { EventEstimate, Step, VerdictState } from "./detector.ts";
import type { PlaneOrbit } from "./fragments.ts";
import { OUTCOMES, type SignalName } from "./log.ts";
import type { DetectorParameters } from "./params.ts";
import type { Candidate, SeriesState } from "./series.ts";
import { estimateStep, type Environment, type StepEstimate } from "./step.ts";
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
 * evidence for the sweeps.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** The state an alert opened with: the detection, or a step the record explained. */
export type AlertOrigin = Extract<VerdictState, "suspected" | "manoeuvre">;

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
  recordTiers(alert, estimate, now, params);
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
  const signals: Partial<Record<SignalName, number>> = {
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
