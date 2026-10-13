import type { Verdict } from "./detector.ts";
import { overridesHistory, passesOrigin, type PiecesEventTime } from "./event-time.ts";
import { attributionSignals, judgePieces, launchRefusals, originSignals, passesSmallBatch, sameInstant, smallBatchReason, timingReason, type CloudMemory, type LaunchPassView } from "./confirmation.ts";
import { isFragmentClass, noteCloud, planeOrbitOf, planeTestDistance, type CloudVerdict, type LaunchRecord, type ParentCandidate, type PieceReading, type PlaneOrbit } from "./fragments.ts";
import { ATTRIBUTION_PATHS, HISTORY_REFUSALS, REFUSALS, logRow, round4, type SignalName } from "./log.ts";
import { median } from "./model.ts";
import { isOn, type DetectorParameters } from "./params.ts";
import { BODY_CLASSES } from "./truth.ts";
import { DAY_MS } from "./units.ts";

/**
 * The Confirmed channel's attribution: a launch's fresh pieces in the
 * plane of a body with no open alert, attributed to that body as a breakup
 * with no step seen on it, where the confirmation rules (`confirmation.ts`)
 * and the attribution's own allow. Read through the launch pass's view of
 * the run, with the verdicts it raises, a body's orbit as the detector
 * last saw it, whether a body made a persistent step in a span, and
 * whether a payload was operating at the cloud's event.
 */

/** What the attribution reads of the run besides the launch pass's view. */
export interface AttributionView extends LaunchPassView {
  verdicts: Verdict[];
  /** The orbit a candidate parent is tested at: its ring's last set where it has a state with sets, else the fallback. */
  orbitOf(number: number, fallback: PlaneOrbit): PlaneOrbit;
  /** Whether the body made a persistent step, whatever verdict it got, with its first post set between the two instants. */
  steppedWithin(number: number, from: number, to: number): boolean;
  /** Whether the body, a payload, was operating at the instant by its dated status as its latest set gave it. */
  workingAt(number: number, atMs: number): boolean;
}


/** The miss of each other body the pieces lie in the plane of, timed against the same pieces, the nearest planes first, as many as the parameter allows; a body not timed is left out. */
function rivalMisses(view: AttributionView, rivals: readonly number[], pieces: readonly PieceReading[]): Map<number, number> {
  const misses = new Map<number, number>();
  for (const rival of rivals.slice(0, Math.max(0, view.params.attributionMaxCandidates - 1))) {
    const timed = view.timePieces(rival, pieces);
    if (timed !== null) misses.set(rival, timed.missKm);
  }
  return misses;
}

/**
 * The debris-classed bodies a launch left at its start (first seen within
 * the launch era, before the window, with no open alert), where it left
 * few of them, whose plane any of the pieces lies within the bound of,
 * each with the orbit it is tested at (its ring's last set), recorded in
 * `orbits`; none where the launch left more than the parameter's count.
 * A later cloud's pieces are not candidates: they are what is being judged.
 */
function debrisSharing(view: AttributionView, launch: LaunchRecord, pieces: readonly PieceReading[], eventMs: number, alerted: ReadonlySet<number>, orbits: Map<number, PlaneOrbit>): number[] {
  const { params, now } = view;
  const windowStart = now - params.burstWindowDays * DAY_MS;
  const pieceNumbers = new Set(pieces.map((p) => p.number));
  const debris = launch.bodies.filter((b) => isFragmentClass(b.bodyClass) && b.firstSeenAt <= windowStart && b.firstSeenAt <= launch.firstSeenAt + params.launchEraDays * DAY_MS && !alerted.has(b.number) && !pieceNumbers.has(b.number));
  if (debris.length === 0 || debris.length > params.attributionDebrisParentsMax) return [];
  const pieceOrbits = pieces.map((piece) => planeOrbitOf(view.bodyOf(launch, piece.number)!));
  const sharing: number[] = [];
  for (const body of debris) {
    const orbit = view.orbitOf(body.number, planeOrbitOf(body));
    if (!pieceOrbits.some((pieceOrbit) => planeTestDistance(orbit, pieceOrbit, eventMs, params) <= params.planeDistanceMax)) continue;
    orbits.set(body.number, orbit);
    sharing.push(body.number);
  }
  return sharing;
}

/** The event the pieces give: the convergence's instant, or the median of the pieces' own closest approaches where the parameter asks and its sigma is the finer. */
function piecesEvent(timed: PiecesEventTime, params: DetectorParameters): { at: number; from: number; to: number; sigmaMinutes: number; byOrigin: boolean } {
  const o = timed.origin;
  if (params.originEventTime && Number.isFinite(o.sigmaMinutes) && o.sigmaMinutes < timed.sigmaMinutes) {
    const sigmaMs = Math.max(o.sigmaMinutes, params.eventGridSeconds / 60 / 2) * 60_000;
    return { at: o.medianAt, from: o.medianAt - 2 * sigmaMs, to: o.medianAt + 2 * sigmaMs, sigmaMinutes: sigmaMs / 60_000, byOrigin: true };
  }
  return { at: timed.at, from: timed.from, to: timed.to, sigmaMinutes: timed.sigmaMinutes, byOrigin: false };
}

/**
 * The rank the stage preference reads a body by (`attributionPrefersStage`):
 * 0 for a rocket body, 2 for a payload operating at the event (its dated
 * status as its latest set gave it, read at `atMs`, the cloud's event:
 * "operating at the time" is at the breakup, not at the run that judges
 * its pieces), 1 for any other body. A rocket body
 * in orbit since 2005 has had a reported breakup three to six times as
 * often as a payload, and a payload breaks up dead far more often than
 * working, so where the pieces cannot tell two bodies apart the lower rank
 * is the likelier parent.
 */
function rankOf(view: AttributionView, launch: LaunchRecord, number: number, atMs: number): number {
  const body = view.bodyOf(launch, number);
  if (body?.bodyClass === "rocket body") return 0;
  if (body?.bodyClass !== "payload") return 1;
  return view.workingAt(number, atMs) ? 2 : 1;
}

const RANK_WORDS = ["a rocket body", "a body not operating at the time", "a payload operating at the time"] as const;

/**
 * The rules on the pieces timed back against the body they are attributed
 * to: they must have been timed, must not miss it by more than the bound,
 * must cross it later than the launch's margin after it was first seen,
 * must share an instant by the common-origin test, and, a small batch,
 * must share a tight one. Returns the `REFUSALS` bits and the reasons.
 */
export function timedRefusals(number: number, kept: readonly PieceReading[], timed: PiecesEventTime | null, verdict: Pick<CloudVerdict, "launchAgeDays">, params: DetectorParameters): { refused: number; reasons: string[] } {
  let refused = 0;
  const reasons: string[] = [];
  if (timed === null) {
    refused |= REFUSALS.untimed;
    reasons.push(`the pieces could not be propagated back against the parent`);
    return { refused, reasons };
  }
  if (timed.missKm > params.legacy.attributionMissKmMax) {
    refused |= REFUSALS.miss;
    reasons.push(`propagated back, the pieces miss the parent by ${timed.missKm.toFixed(0)} km at best, beyond ${params.legacy.attributionMissKmMax}: not its pieces`);
  }
  const sinceLaunchDays = verdict.launchAgeDays - timed.origin.ageDays;
  if (timed.origin.timed >= 2 && sinceLaunchDays < params.originLaunchMarginDays) {
    refused |= REFUSALS.origin;
    reasons.push(`the pieces cross ${number} ${sinceLaunchDays.toFixed(0)} days after the launch was first seen, under ${params.originLaunchMarginDays}: the launch's own objects catalogued late, not a breakup`);
  }
  if (!passesOrigin(timed.origin, params.legacy)) {
    refused |= REFUSALS.origin;
    reasons.push(`the pieces' own closest approaches to ${number} do not share an instant: half of them cross it within ${timed.origin.dev50Hours.toFixed(1)} h of their median, three quarters within ${timed.origin.dev75Hours.toFixed(1)} h, ${timed.origin.timed} of ${timed.origin.tried} in the window, at ${timed.origin.ageDays.toFixed(1)} days' age: the late pieces of an old cloud, not a breakup`);
  }
  if (!passesSmallBatch(kept.length, timed, params)) {
    refused |= REFUSALS.smallBatch;
    reasons.push(smallBatchReason(kept.length, timed, number, params));
  }
  return { refused, reasons };
}

/**
 * How the parent is named among twins, bodies of the launch the pieces
 * cannot be told from: by a persistent step it alone made in the window
 * (`attributionStepBreaksTies`), else by its rank over every twin where
 * the stage preference is on, else not at all. With twins on, the launch
 * is named with its candidates where the parent was named or unresolved
 * twins are raised; otherwise a parent not named is refused as ambiguous.
 */
export function twinRuling(stepped: number, priorBreaks: number, prefersStage: boolean, params: DetectorParameters): { by: "step" | "rank" | null; namesCandidates: boolean; refused: number } {
  const by = params.attributionStepBreaksTies && stepped === 1 ? "step" : prefersStage && priorBreaks === 1 ? "rank" : null;
  if (params.attributionTwins && (by !== null || params.legacy.attributionTwinsUnresolved)) return { by, namesCandidates: true, refused: 0 };
  return { by, namesCandidates: false, refused: by === null ? REFUSALS.ambiguous : 0 };
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
export function attributeCloud(launch: LaunchRecord, verdict: CloudVerdict, parents: readonly ParentCandidate[], alerted: ReadonlySet<number>, memory: CloudMemory, view: AttributionView, launchesInRun: number, path: number = ATTRIBUTION_PATHS.cloud): number {
  const { params, now } = view;
  const groups = new Map<number, PieceReading[]>();
  // The pieces first seen by the time the launch last remembered a cloud are that cloud's: under the memory they are not judged again, and either way they are told apart from the new ones as the cloud.
  const remembered = params.cloudMemoryDays > 0 && now - memory.at <= params.cloudMemoryDays * DAY_MS;
  for (const piece of verdict.consistent) {
    if (piece.parent === null || alerted.has(piece.parent) || (remembered && piece.firstSeenAt <= memory.at)) continue;
    groups.set(piece.parent, [...(groups.get(piece.parent) ?? []), piece]);
  }
  const parentsByNumber = new Map<number, ParentCandidate>();
  for (const parent of parents) if (!parentsByNumber.has(parent.number)) parentsByNumber.set(parent.number, parent);
  let raised = 0;
  const named = new Set<number>();
  for (const [nearest, judged] of [...groups].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])) {
    // The body named is, of the bodies whose plane the pieces share, the one their semi-major axes centre on: a cloud's periods straddle its parent's, and a body of the same plane at another altitude is off their centre by the difference.
    const axes = judged.map((piece) => view.bodyOf(launch, piece.number)!.aKm);
    const debrisOrbits = new Map<number, PlaneOrbit>();
    const centres = new Map<number, number>();
    const centreOf = (n: number): number => {
      const known = centres.get(n);
      if (known !== undefined) return known;
      const orbit = parentsByNumber.get(n)?.orbit ?? debrisOrbits.get(n);
      if (orbit === undefined) return Number.POSITIVE_INFINITY;
      const centre = Math.abs(median(axes.map((aKm) => aKm - orbit.aKm)));
      centres.set(n, centre);
      return centre;
    };
    const sharing = [nearest, ...new Set(judged.flatMap((p) => p.within))].filter((n, i, all) => all.indexOf(n) === i && !alerted.has(n) && parentsByNumber.has(n));
    const centred = sharing.reduce((best, n) => (centreOf(n) < centreOf(best) ? n : best), nearest);
    // The convergence over the centre: where the pieces, propagated back, converge on another body of their plane better than on the one their centre names by the ambiguity ratio, that body is their parent.
    let converged: { number: number; ratio: number } | null = null;
    if (params.legacy.attributionConvergenceNames && sharing.length > 1) {
      const misses = new Map<number, number>();
      for (const n of sharing.slice(0, params.attributionMaxCandidates)) {
        const timed = view.timePieces(n, judged);
        if (timed !== null) misses.set(n, timed.missKm);
      }
      const best = [...misses].reduce<[number, number] | null>((least, entry) => (least === null || entry[1] < least[1] ? entry : least), null);
      const own = misses.get(centred);
      if (best !== null && own !== undefined && best[0] !== centred) converged = { number: best[0], ratio: own / Math.max(best[1], 1e-9) };
    }
    const byCentre = converged !== null && converged.ratio > params.attributionAmbiguityRatio ? converged.number : centred;
    // The stage preference: a body of a better rank in the pieces' plane whose offset from their centre the pieces cannot tell from the named body's is named instead, unless the named body alone made a persistent step in the window.
    // In its narrower form only a rocket body is preferred, and only over a payload operating at the time.
    const rank = (n: number): number => rankOf(view, launch, n, verdict.eventMs);
    const narrow = params.attributionPrefersStageOverWorking && !params.legacy.attributionPrefersStage;
    const better = (n: number, than: number): boolean => (narrow ? rank(n) === 0 && rank(than) === 2 : rank(n) < rank(than));
    const alternative = sharing.filter((n) => n !== byCentre && better(n, byCentre)).reduce<number | null>((best, n) => (best === null || centreOf(n) < centreOf(best) ? n : best), null);
    const preferRatio = alternative === null ? Number.NaN : centreOf(alternative) / Math.max(centreOf(byCentre), params.attributionCentreFloorKm);
    const searchFrom = now - params.attributionSearchDays * DAY_MS;
    const namedStepped = alternative !== null && view.steppedWithin(byCentre, searchFrom, now) && !view.steppedWithin(alternative, searchFrom, now);
    const preferred = (params.legacy.attributionPrefersStage || narrow) && alternative !== null && preferRatio <= params.attributionPreferCentreRatio && !namedStepped;
    const number = preferred ? alternative : byCentre;
    if (named.has(number)) continue;
    const centre = centreOf(number);
    const candidate = parentsByNumber.get(number);
    const own = view.bodyOf(launch, number);
    if (candidate === undefined || own === undefined) continue;
    const launchRules = launchRefusals({ key: launch.key, number, bodyClass: own.bodyClass }, verdict, params, { launchesInRun, youngExempt: params.legacy.attributionYoungLaunch });
    let refused = launchRules.refused;
    const reasons: string[] = [...launchRules.reasons];
    if (byCentre !== centred) reasons.push(`the pieces' axes centre on ${centred}, but propagated back they converge on ${byCentre} ${converged!.ratio.toFixed(1)} times better: it is their parent`);
    if (preferred) reasons.push(`the pieces' axes centre ${centreOf(byCentre).toFixed(1)} km from ${byCentre}'s and ${centreOf(number).toFixed(1)} km from ${number}'s, which their plane and period cannot tell apart, and ${number} is ${RANK_WORDS[rank(number)]} where ${byCentre} is ${RANK_WORDS[rank(byCentre)]}: the likelier parent is named`);
    const judgement = judgePieces({ number, orbit: candidate.orbit, bodyClass: own.bodyClass, atMs: verdict.eventMs, eventMs: verdict.eventMs }, launch, verdict, judged, memory, view, memory.at);
    refused |= judgement.refused;
    reasons.push(...judgement.reasons);
    let kept = judgement.pieces;
    // Pieces made at one instant are not an old cloud's: where they share an origin closely enough, the rules that read the launch's history as one do not refuse them.
    let overridden: PiecesEventTime | null = null;
    if (refused !== 0 && (refused & ~HISTORY_REFUSALS) === 0 && isOn(params.originOverrideHours)) {
      const strict = view.timePieces(number, judged);
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
    if (refused === 0) {
      timed = overridden ?? view.timePieces(number, kept);
      const timedRules = timedRefusals(number, kept, timed, verdict, params);
      refused |= timedRules.refused;
      reasons.push(...timedRules.reasons);
      if (timed !== null) {
        // With the twins on, a launch with few debris-classed bodies offers its older ones as twins too: a fairing cover and its siblings, a tank beside its stage, share the pieces' plane and orbit as a payload's stage does.
        const debrisTwins = path === ATTRIBUTION_PATHS.cloud && params.attributionTwins ? debrisSharing(view, launch, kept, verdict.eventMs, alerted, debrisOrbits) : [];
        if (rivals.length + debrisTwins.length > 0) {
          const misses = rivalMisses(view, [...rivals, ...debrisTwins], kept);
          rival = Math.min(Number.POSITIVE_INFINITY, ...misses.values());
          // A body that made a persistent step in the search window, where none of the others did, is the parent the pieces cannot otherwise name.
          const to = timed.at + 2 * timed.sigmaMinutes * 60_000;
          stepped = (view.steppedWithin(number, to - params.attributionSearchDays * DAY_MS, Math.max(to, now)) ? 1 : 0) | (rivals.some((r) => view.steppedWithin(r, to - params.attributionSearchDays * DAY_MS, Math.max(to, now))) ? 2 : 0);
          // A twin: another body the pieces are not told from, neither by the centre of their axes nor by their convergence; a body not timed is told from it as before.
          twins = [...rivals, ...debrisTwins].filter((r) => centreOf(r) < centreBound && misses.has(r) && misses.get(r)! < params.attributionAmbiguityRatio * timed!.missKm);
          if (twins.length > 0) {
            // The rank breaks a tie no step does: a rocket body among payloads, a dead payload among working ones.
            priorBreaks = twins.every((t) => better(number, t)) ? 1 : 0;
            const ruling = twinRuling(stepped, priorBreaks, params.legacy.attributionPrefersStage || narrow, params);
            const why = ruling.by === "step" ? `, which alone made a persistent step in the window` : ruling.by === "rank" ? `, ${RANK_WORDS[rank(number)]}, the likelier parent of the ${twins.length + 1}` : ", on the centre";
            if (ruling.namesCandidates) reasons.push(`the pieces cannot be told from ${twins.length} other bod${twins.length === 1 ? "y" : "ies"} of the launch (${twins.join(", ")}): their axes centre ${centre.toFixed(1)} km from ${number}'s and ${twins.map((r) => centreOf(r).toFixed(1)).join(", ")} km from theirs, and they converge on them within ${params.attributionAmbiguityRatio} times their miss of ${number} (${twins.map((r) => misses.get(r)!.toFixed(1)).join(", ")} km against ${timed.missKm.toFixed(1)}): the launch is named with its candidates, ${number} first${why}`);
            else if (ruling.by !== null) reasons.push(`the pieces converge on ${number} and on another body of the launch alike, and ${number}${why}: it is named`);
            else reasons.push(`the pieces lie in the plane of ${rivals.length} other bod${rivals.length === 1 ? "y" : "ies"} of the launch too, and converge on one of them within ${params.attributionAmbiguityRatio} times their miss of ${number} (${rival.toFixed(1)} km against ${timed.missKm.toFixed(1)}): the parent cannot be named, the cloud stays for review`);
            refused |= ruling.refused;
            if (!ruling.namesCandidates) twins = [];
          } else if (rival < params.attributionAmbiguityRatio * timed.missKm) reasons.push(`the pieces' semi-major axes centre ${centre.toFixed(1)} km from ${number}'s and ${rivalCentre.toFixed(1)} km at best from the other bodies' in their plane: it is named`);
        }
      }
    }
    const ok = refused === 0 && timed !== null;
    const twinSignals: Partial<Record<SignalName, number>> = { attributionTwins: twins.length, candidate1: twins[0], candidate2: twins[1], candidate3: twins[2], attributionPriorBreaks: priorBreaks };
    const preferSignals: Partial<Record<SignalName, number>> = { preferNamedRank: rank(byCentre), ...(alternative === null ? {} : { preferAlternative: alternative, preferAlternativeRank: rank(alternative), preferCentreRatio: preferRatio, preferNamedStepped: namedStepped ? 1 : 0 }), ...(preferred ? { preferredFrom: byCentre } : {}), ...(converged === null ? {} : { convergedAlternative: converged.number, convergedRatio: converged.ratio }), ...(byCentre !== centred ? { convergedFrom: centred } : {}) };
    view.log.push(logRow(now, number, { ...attributionSignals(launch, verdict, path, own.bodyClass, judged, judgement, rivals.length, timed, rival, refused, ok), ...originSignals(timed, Math.min(kept.length, params.attributionMaxPieces)), ...twinSignals, ...preferSignals, launchesInRun, attributionStepped: stepped, attributionCentreKm: centre, attributionRivalCentreKm: rivalCentre }));
    if (!ok) continue;
    raised++;
    named.add(number);
    const evidence: Record<string, number> = { attributed: 1, piecesInPlane: kept.length, piecesJudged: judged.length, piecesNew: verdict.pieces.length, windowBodies: verdict.windowBodies, backgroundBodies: verdict.backgroundBodies, lambda: round4(verdict.lambda), pBurst: round4(verdict.p), cloudDeltaVMps: round4(judgement.reading.deltaVMps), gabbardSpreadKm: round4(verdict.gabbardSpreadKm), planeDistanceMax: params.planeDistanceMax, planeDistanceMedian: round4(median(kept.map((p) => p.distance))), parentAgeDays: round4(judgement.reading.parentAgeDays), cloudPieces: judgement.reading.cloudPieces, daysSinceCloud: round4(judgement.reading.daysSinceCloud), parentCloudDistance: round4(judgement.reading.parentCloudDistance), launchAgeDays: round4(verdict.launchAgeDays), missKm: round4(timed!.missKm), sigmaMinutes: round4(timed!.sigmaMinutes), crossings: timed!.crossings, rivals: rivals.length, bodyClass: BODY_CLASSES.indexOf(own.bodyClass) };
    if (Number.isFinite(timed!.spreadMinutes)) evidence.spreadMinutes = round4(timed!.spreadMinutes);
    if (Number.isFinite(rival)) evidence.rivalMissKm = round4(rival);
    const event = piecesEvent(timed!, params);
    const o = timed!.origin;
    for (const [name, value] of [["originTried", o.tried], ["originTimed", o.timed], ["originDev50Hours", o.dev50Hours], ["originDev75Hours", o.dev75Hours], ["originSpreadHours", o.spreadHours], ["originAgeDays", o.ageDays]] as const) if (Number.isFinite(value)) evidence[name] = round4(value);
    if (event.byOrigin) [evidence.sigmaMinutes, evidence.eventByOrigin] = [round4(event.sigmaMinutes), 1];
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
    view.verdicts.push({ kind: "object", state: "confirmed", number, launch: launch.key, raisedAt: now, step: null, event: { at: event.at, from: event.from, to: event.to }, evidence, reasons: words, bodies: kept.map((p) => p.number), ...(twins.length > 0 ? { candidates: [number, ...twins] } : {}) });
    noteCloud(launch, now, event.at, true);
    for (const twin of twins) named.add(twin);
    launch.lastCloudAt = now;
  }
  return raised;
}
