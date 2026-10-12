import type { LogRow } from "./detector.ts";
import { overridesHistory, passesOrigin, originTested, type PiecesEventTime } from "./event-time.ts";
import { cloudBodies, isFragmentClass, launchCodeOf, nearestCloudDistance, planeOrbitOf, type BodyRecord, type CloudVerdict, type LaunchRecord, type PieceReading, type PlaneOrbit } from "./fragments.ts";
import type { ConfirmationReading, OpenAlert } from "./fusion.ts";
import { ATTRIBUTION_PATHS, HISTORY_REFUSALS, PHASES, REFUSALS, logRow, round5, type SignalName } from "./log.ts";
import { median } from "./model.ts";
import type { DetectorParameters } from "./params.ts";
import { BODY_CLASSES, type BodyClass } from "./truth.ts";

/**
 * The confirmation of an open alert by pieces, and the rules every
 * judgement of pieces against a parent goes through, the attribution's
 * (`attribution.ts`) included. The launch pass (`judgeLaunches` in
 * `run.ts`) reads them through a narrow view of the run: the run's
 * instant and parameters, a launch's bodies by number, the reentries the
 * caller passed, the log, and the pieces timed back against a parent.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * What the confirmation rules judge pieces against: the parent, its orbit
 * (after the step for an alert, its last set for a body with none), its
 * class, the instant its standing under the launch is read at (the step's
 * second edge, or the cloud's event), and the instant a remembered cloud's
 * nodes are carried from where the launch kept none.
 */
export interface PieceSubject {
  number: number;
  orbit: PlaneOrbit;
  bodyClass: BodyClass;
  atMs: number;
  eventMs: number;
}

export interface PieceJudgement {
  pieces: PieceReading[];
  reading: ConfirmationReading;
  reasons: string[];
  /** The rules that refused, as `REFUSALS` bits; zero where some pieces were kept. */
  refused: number;
}

/** What the confirmation rules read of the run: its instant and parameters, a launch's body by number, and a parent's reentry where the caller passed one (`DetectorInput.decays`). */
export interface PieceRulesView {
  params: DetectorParameters;
  now: number;
  decayOf(number: number): number | undefined;
  bodyOf(launch: LaunchRecord, number: number): BodyRecord | undefined;
}

/** What the launch pass reads of the run besides: the log its rows go to, and the pieces timed back against a parent (`eventFromPieces`), null where either cannot be propagated or no piece crosses it in the search window. */
export interface LaunchPassView extends PieceRulesView {
  log: LogRow[];
  timePieces(parent: number, pieces: readonly PieceReading[]): PiecesEventTime | null;
}

/** The launch's cloud memory as a judgement reads it: when a cloud was last remembered under the launch, and the event it was carried from. */
export interface CloudMemory {
  at: number;
  eventMs: number;
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
export function judgePieces(subject: PieceSubject, launch: LaunchRecord, verdict: CloudVerdict, judged: PieceReading[], memory: CloudMemory, view: PieceRulesView, rememberedUpTo = Number.NEGATIVE_INFINITY): PieceJudgement {
  const { params, now } = view;
  const reasons: string[] = [];
  let refused = 0;
  const own = view.bodyOf(launch, subject.number);
  const parentAgeDays = own === undefined ? Number.POSITIVE_INFINITY : (subject.atMs - own.firstEpoch) / DAY_MS;
  const parentFragment = isFragmentClass(subject.bodyClass);
  // The pieces judged are told apart from the launch's earlier cloud; a piece first seen by the time the launch remembered a cloud is that cloud's, whether or not it is judged again.
  const exclude = new Set<number>([subject.number, ...judged.filter((p) => p.firstSeenAt > rememberedUpTo).map((p) => p.number)]);
  const cloud = cloudBodies(launch, now - (params.burstWindowDays + params.burstBackgroundDays) * DAY_MS, now, exclude);
  const daysSinceCloud = (now - memory.at) / DAY_MS;
  const cloudEventMs = Number.isFinite(memory.eventMs) ? memory.eventMs : cloud.length > 0 ? Math.min(...cloud.map((b) => b.firstEpoch)) : subject.eventMs;
  const parentCloudDistance = nearestCloudDistance(subject.orbit, cloud, cloudEventMs, params);
  const orbitOf = (piece: PieceReading): PlaneOrbit => planeOrbitOf(view.bodyOf(launch, piece.number)!);
  const outOfCloud = cloud.length === 0 ? judged : judged.filter((piece) => nearestCloudDistance(orbitOf(piece), cloud, cloudEventMs, params) > params.planeDistanceMax);
  const nearerThanCloud = judged.filter((piece) => piece.distance < parentCloudDistance);
  const deltaVMps = median(judged.map((p) => p.deltaVMps));
  // The parent's reentry, where the catalogue had published it by the run, against the pieces' earliest first set.
  const decayed = view.decayOf(subject.number);
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

/** Whether a launch is a crewed spacecraft's or a station's cargo craft's and the parent is not its rocket body: what such a craft leaves in orbit is released on purpose (`visitingLaunches`). */
export const visitingRelease = (key: string, bodyClass: BodyClass, params: DetectorParameters): boolean => params.visitingLaunches.includes(key) && bodyClass !== "rocket body";

/**
 * The launch's own rules, before any piece is judged: the launch must be
 * old enough for its new bodies not to be its own, and quiet enough in the
 * year before for them not to be an old cloud's backlog; a crewed
 * station's pieces are released on purpose, and so are a crewed or cargo
 * craft's, but for its rocket body's. On the attribution (`attribution`
 * given) the young launch is let through where its parameter says, and a
 * run that brought new bodies to many old launches at once is the
 * catalogue listing a batch of old objects. Returns the `REFUSALS` bits
 * and the reasons, in the attribution's words.
 */
export function launchRefusals(subject: { key: string; number: number; bodyClass: BodyClass }, verdict: Pick<CloudVerdict, "launchAgeDays" | "rate" | "backgroundBodies">, params: DetectorParameters, attribution?: { launchesInRun: number; youngExempt: boolean }): { refused: number; reasons: string[] } {
  let refused = 0;
  const reasons: string[] = [];
  if (verdict.launchAgeDays < params.youngLaunchDays && attribution?.youngExempt !== true) {
    refused |= REFUSALS.youngLaunch;
    reasons.push(`the launch is ${verdict.launchAgeDays.toFixed(0)} days old: its new bodies may be its own objects`);
  }
  if (verdict.rate > params.confirmBackgroundMax) {
    refused |= REFUSALS.background;
    reasons.push(`the launch gained ${verdict.backgroundBodies} new bodies in the year before (${verdict.rate.toFixed(1)} a window): an old cloud's backlog`);
  }
  if (attribution !== undefined && attribution.launchesInRun > params.attributionBatchLaunchesMax) {
    refused |= REFUSALS.batch;
    reasons.push(`the run brought new bodies to ${attribution.launchesInRun} launches older than a year: the catalogue listing a batch of old objects`);
  }
  if (params.stationLaunches.includes(subject.key)) {
    refused |= REFUSALS.station;
    reasons.push(`launch ${subject.key} is a crewed station's: what it sheds is released on purpose`);
  }
  if (visitingRelease(subject.key, subject.bodyClass, params)) {
    refused |= REFUSALS.visiting;
    reasons.push(`launch ${subject.key} is a crewed spacecraft's or a station's cargo craft's, and ${subject.number} is not its rocket body: what the craft leaves in orbit is released on purpose`);
  }
  return { refused, reasons };
}

/** An analyst range's numbers are reused and say nothing of a launch: its pieces confirm an alert only where the parameters let them and the plane test names that parent alone among the open alerts. Returns the `REFUSALS` bits. */
export function analystRefusals(confirming: readonly PieceReading[], params: DetectorParameters): number {
  if (!params.analystAttributes) return REFUSALS.analyst;
  return confirming.some((piece) => piece.within.length !== 1) ? REFUSALS.ambiguous : 0;
}

/** Whether a batch of pieces passes the small-batch rule (`smallBatchOriginHours`): a batch outside the rule's sizes, or the rule off, passes; a small one needs at least two pieces crossing the parent in the window, the share asked of them within the bound of their median crossing. */
export function passesSmallBatch(pieces: number, timed: Pick<PiecesEventTime, "origin"> | null, params: Pick<DetectorParameters, "smallBatchMinPieces" | "smallBatchMaxPieces" | "smallBatchOriginShare" | "smallBatchOriginHours">): boolean {
  if (!(params.smallBatchOriginHours < 1e8) || pieces < params.smallBatchMinPieces || pieces > params.smallBatchMaxPieces) return true;
  if (timed === null || !(timed.origin.timed >= 2)) return false;
  const deviation = params.smallBatchOriginShare <= 0.5 ? timed.origin.dev50Hours : timed.origin.dev75Hours;
  return deviation <= params.smallBatchOriginHours;
}

/** The words for a small batch the rule refused. */
export const smallBatchReason = (pieces: number, timed: PiecesEventTime | null, parent: number, params: DetectorParameters): string => `a small batch of ${pieces} pieces needs them to share a tight common origin, ${params.smallBatchOriginShare <= 0.5 ? "half" : "three quarters"} of them crossing ${parent} within ${params.smallBatchOriginHours} h of their median, and ${timed === null || !(timed.origin.timed >= 2) ? "too few of them cross it in the window" : `they cross it within ${(params.smallBatchOriginShare <= 0.5 ? timed.origin.dev50Hours : timed.origin.dev75Hours).toFixed(1)} h`}: an old cloud's cataloguing as likely as a new event`;

const iso16 = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

/** The words for a back-propagated timing. */
export function timingReason(timed: PiecesEventTime, parent: number): string {
  const o = timed.origin;
  const origin = o.timed >= 2 ? `; each piece's closest approach to ${parent}: ${o.timed} of ${o.tried} cross it in the window, their median at ${iso16(o.medianAt)}, half of them within ${o.dev50Hours.toFixed(1)} h of it and three quarters within ${o.dev75Hours.toFixed(1)} h (robust spread ${o.spreadHours.toFixed(1)} h), the pieces ${o.ageDays.toFixed(1)} days old at it` : `; ${o.timed} of ${o.tried} pieces cross ${parent} in the window`;
  return `propagated back, ${timed.pieces} piece${timed.pieces === 1 ? "" : "s"} converge on ${parent} at ${iso16(timed.at)}, sigma ${timed.sigmaMinutes.toFixed(0)} min, missing it by ${timed.missKm.toFixed(1)} km${timed.crossings > 1 ? `; ${timed.crossings} laps' crossings lie within twice that miss` : ""}${origin}`;
}

/** The common-origin test's readings for a row: the pieces tried and timed, the median crossing, the deviations, the spread, the sigma, the age and the miss; the pieces tried alone where the timing gave nothing. */
export function originSignals(timed: PiecesEventTime | null, tried: number): Partial<Record<SignalName, number>> {
  if (timed === null) return { originTried: tried, originTimed: 0 };
  const o = timed.origin;
  return { originTried: o.tried, originTimed: o.timed, originMedianAt: o.medianAt, originDev50Hours: o.dev50Hours, originDev75Hours: o.dev75Hours, originPhase50: o.phase50, originPhase75: o.phase75, originSpreadHours: o.spreadHours, originSigmaMinutes: o.sigmaMinutes, originAgeDays: o.ageDays, originMissKm: o.missKm };
}

/** Whether the pieces' common instant is the remembered cloud's own event (within a day, or the override's hours if longer): a later batch of that cloud shares its origin, and is that cloud's, not a new one. */
export function sameInstant(at: number, eventMs: number, params: DetectorParameters): boolean {
  return Number.isFinite(eventMs) && Math.abs(at - eventMs) <= Math.max(DAY_MS, params.originOverrideHours * HOUR_MS);
}

/** The attribution row's signals. */
export function attributionSignals(launch: LaunchRecord, verdict: CloudVerdict, path: number, parentClass: BodyClass, judged: readonly PieceReading[], judgement: PieceJudgement | null, rivals: number, timed: PiecesEventTime | null, rival: number, refused: number, raised: boolean): Partial<Record<SignalName, number>> {
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
 * The rules on the pieces timed back against an alert's parent: an
 * analyst range's must converge on it (timed, within the miss bound);
 * with the common-origin test on, enough pieces must share an instant; a
 * small batch is held to its rule where the parameter asks it of steps
 * too; and pieces crossing the parent too soon after the launch was first
 * seen, or too far from the step, are not the step's. Returns the
 * `REFUSALS` bits and the reasons, the timing's own words last.
 */
export function alertTimingRefusals(alert: { number: number; tStep: number }, pieces: readonly PieceReading[], timed: PiecesEventTime | null, verdict: Pick<CloudVerdict, "launchAgeDays">, analyst: boolean, params: DetectorParameters): { refused: number; reasons: string[] } {
  let refused = 0;
  const reasons: string[] = [];
  if (analyst && timed === null) refused |= REFUSALS.untimed;
  else if (analyst && timed!.missKm > params.attributionMissKmMax) refused |= REFUSALS.miss;
  if (originTested(params) && Math.min(pieces.length, params.attributionMaxPieces) >= params.originMinPieces && (timed === null || !passesOrigin(timed.origin, params))) {
    refused |= REFUSALS.origin;
    reasons.push(`the pieces' crossings of ${alert.number} do not share an instant: the late pieces of an old cloud, not this step's`);
  }
  if (!analyst && params.smallBatchStepsToo && !passesSmallBatch(pieces.length, timed, params)) {
    refused |= REFUSALS.smallBatch;
    reasons.push(smallBatchReason(pieces.length, timed, alert.number, params));
  }
  if (timed !== null && timed.origin.timed >= 2 && (verdict.launchAgeDays - timed.origin.ageDays < params.originLaunchMarginDays || Math.abs(timed.origin.medianAt - alert.tStep) / HOUR_MS > params.originStepHoursMax)) {
    refused |= REFUSALS.origin;
    reasons.push(`the pieces cross ${alert.number} ${((timed.origin.medianAt - alert.tStep) / HOUR_MS).toFixed(0)} h from its step, ${(verdict.launchAgeDays - timed.origin.ageDays).toFixed(0)} days after the launch was first seen: not the step's pieces`);
  }
  if (timed !== null) reasons.push(timingReason(timed, alert.number));
  return { refused, reasons };
}

/** A confirmation of an open alert by pieces: the reasons, the evidence and the pieces, for the verdict. */
export interface PiecesConfirmation {
  reasons: string[];
  evidence: Record<string, number>;
  bodies: number[];
}

/**
 * The confirmation of one open alert by the pieces of a launch's cloud
 * verdict: the pieces nearest the alerted parent, new by numbering, in its
 * plane and first published after its step, counted on the alert; then
 * judged by the launch's own rules (or an analyst range's), the
 * confirmation rules (`judgePieces`), the common-origin override of the
 * rules that read the launch's history, and the rules on the pieces timed
 * back against the parent. The attribution row goes to the log; returns
 * the confirmation where the pieces confirm the alert, null otherwise.
 */
export function confirmByPieces(number: number, alert: OpenAlert, launch: LaunchRecord, verdict: CloudVerdict, memory: CloudMemory, analyst: boolean, view: LaunchPassView): PiecesConfirmation | null {
  const { params, now } = view;
  const key = launch.key;
  const mine = verdict.pieces.filter((piece) => piece.parent === number || (verdict.parents.length === 1 && piece.parent === null));
  const afterStep = mine.filter((piece) => piece.firstSeenAt >= alert.candidate.beforeEpoch && piece.firstEpoch >= alert.candidate.beforeEpoch - DAY_MS);
  alert.pieces.new += mine.length;
  alert.pieces.aboveMark += afterStep.filter((piece) => piece.aboveMark).length;
  const confirming = verdict.consistent.filter((piece) => piece.parent === number && piece.firstSeenAt >= alert.candidate.beforeEpoch && piece.firstEpoch >= alert.candidate.beforeEpoch - DAY_MS);
  alert.pieces.inPlane += confirming.length;
  alert.pieces.afterStep += afterStep.length;
  if (confirming.length === 0) return null;
  const path = analyst ? ATTRIBUTION_PATHS.analyst : ATTRIBUTION_PATHS.alert;
  const extra: string[] = [];
  let timed: PiecesEventTime | null = null;
  let refused = analyst ? analystRefusals(confirming, params) : launchRefusals({ key, number, bodyClass: alert.bodyClass }, verdict, params).refused;
  // On an analyst range, the pieces that lie within the plane bound of another open alert's parent too: the plane test does not name this one alone.
  const shared = analyst ? confirming.filter((piece) => piece.within.length > 1).length : 0;
  const overridable = (bits: number): boolean => !analyst && bits !== 0 && (bits & ~HISTORY_REFUSALS) === 0 && params.originOverrideHours < 1e8;
  if (refused !== 0 && !overridable(refused)) {
    view.log.push(logRow(now, number, attributionSignals(launch, verdict, path, alert.bodyClass, confirming, null, shared, null, Number.NaN, refused, false)));
    return null;
  }
  const judged = judgePieces({ number, orbit: alert.orbit, bodyClass: alert.bodyClass, atMs: alert.candidate.afterEpoch, eventMs: alert.candidate.tStep }, launch, verdict, confirming, memory, view);
  alert.confirmation = judged.reading;
  refused |= judged.refused;
  let pieces = judged.pieces;
  // Pieces made at one instant are not an old cloud's: where they share an origin closely enough, the rules that read the launch's history as one do not refuse them.
  if (overridable(refused)) {
    const strict = view.timePieces(number, confirming);
    if (strict !== null && overridesHistory(strict.origin, params) && !sameInstant(strict.origin.medianAt, memory.eventMs, params)) {
      extra.push(`${strict.origin.timed} of the ${strict.origin.tried} pieces cross ${number} within ${strict.origin.dev75Hours.toFixed(1)} h of one instant, three quarters of them: made at once, not an old cloud's, so the launch's history does not refuse them`);
      [refused, pieces, timed] = [0, confirming, strict];
    }
  }
  if (refused === 0 && pieces.length > 0) {
    // The pieces timed back against the parent, for the common-origin test and the record: an analyst range's must also converge on it.
    timed = timed ?? view.timePieces(number, pieces);
    const rules = alertTimingRefusals({ number, tStep: alert.candidate.tStep }, pieces, timed, verdict, analyst, params);
    refused |= rules.refused;
    extra.push(...rules.reasons);
  }
  const stepSignals: Partial<Record<SignalName, number>> = timed === null || !Number.isFinite(timed.origin.medianAt) ? {} : { originStepHours: (timed.origin.medianAt - alert.candidate.tStep) / HOUR_MS };
  view.log.push(logRow(now, number, { ...attributionSignals(launch, verdict, path, alert.bodyClass, confirming, judged, shared, timed, Number.NaN, refused, refused === 0 && pieces.length > 0), ...(refused === 0 || timed !== null ? originSignals(timed, Math.min(pieces.length, params.attributionMaxPieces)) : {}), ...stepSignals }));
  if (refused !== 0 || pieces.length === 0) return null;
  const evidence: Record<string, number> = { piecesInPlane: pieces.length, piecesJudged: confirming.length, piecesNew: verdict.pieces.length, windowBodies: verdict.windowBodies, backgroundBodies: verdict.backgroundBodies, lambda: round5(verdict.lambda), pBurst: round5(verdict.p), cloudDeltaVMps: round5(judged.reading.deltaVMps), gabbardSpreadKm: round5(verdict.gabbardSpreadKm), planeDistanceMax: params.planeDistanceMax, parentAgeDays: round5(judged.reading.parentAgeDays), cloudPieces: judged.reading.cloudPieces, daysSinceCloud: round5(judged.reading.daysSinceCloud), parentCloudDistance: round5(judged.reading.parentCloudDistance) };
  // An analyst range's confirmation is timed by its pieces; an alert's event stays its step's, the pieces' timing kept beside it.
  if (timed !== null && analyst) [evidence.missKm, evidence.sigmaMinutes] = [round5(timed.missKm), round5(timed.sigmaMinutes)];
  else if (timed !== null) [evidence.piecesMissKm, evidence.piecesSigmaMinutes] = [round5(timed.missKm), round5(timed.sigmaMinutes)];
  if (timed !== null) for (const [name, value] of [["originTried", timed.origin.tried], ["originTimed", timed.origin.timed], ["originDev50Hours", timed.origin.dev50Hours], ["originDev75Hours", timed.origin.dev75Hours], ["originAgeDays", timed.origin.ageDays]] as const) if (Number.isFinite(value)) evidence[name] = round5(value);
  const reasons = [`${pieces.length} new bod${pieces.length === 1 ? "y" : "ies"} under ${analyst ? `the analyst range ${key}` : `launch ${key}`} (${pieces.map((p) => p.number).join(", ")}) numbered above the catalogue's mark at the step, first published after it, in the parent's plane (distance ${pieces.map((p) => p.distance.toFixed(1)).join(", ")}), moving ${judged.reading.deltaVMps.toFixed(1)} m/s from it`, ...extra, ...judged.reasons, ...verdict.reasons];
  return { reasons, evidence, bodies: pieces.map((p) => p.number) };
}
