import { ATTRIBUTION_PATHS, BODY_CLASSES, DETECTOR_PARAMETERS, PHASES, REFUSALS, type DetectorParameters, type LogRow } from "../../src/index.ts";
import type { Catalogue } from "./catalogue.ts";
import { isConfirmedTarget, splitYears, type YearFile } from "./kpi.ts";
import { catalogueRowsOf, landConfirmed, type ConfirmedLanding, type Line, type Row } from "./match.ts";
import { DAY_MS } from "./replay.ts";
import type { Truth } from "./run.ts";

/**
 * The Confirmed channel's rules re-applied offline: every judgement of
 * pieces the detector logged (the attribution rows, phase 5, on the alert
 * path, the cloud path and the analyst path), read with the rules the
 * parameters ask, gives the confirmed verdicts the detector would have
 * raised, which are landed against the truth as the matcher lands the
 * replay's (`landConfirmed`) and scored as the Confirmed line is: the
 * first confirmation of each event within 180 days, the false ones by the
 * year raised. A replay with the rules off logs every judgement the rules
 * could refuse, with its readings (the pieces' velocity, the parent's age
 * and class, the launch's age and background, the remembered cloud, the
 * back-propagated miss and the rivals'), so each rule is re-thresholded
 * here without replaying. The readings of the cloud memory are the
 * replay's, which remembered every attribution it made, so a rule set that
 * raises fewer remembers less: the totals are an approximation, and the
 * replay with the values chosen is the record.
 */

/** The rules the sweep re-applies, by the detector's parameter names. */
export type AttributionRules = Pick<DetectorParameters, "attributionEnabled" | "confirmDeltaVMinMps" | "freshPieceDays" | "cloudMemoryDays" | "debrisParentNeedsNearerThanCloud" | "singlePieceNeedsQuietLaunch" | "confirmBackgroundMax" | "youngLaunchDays" | "youngLaunchDeltaVMps" | "attributionYoungLaunch" | "attributionDebrisParentsMax" | "attributionBatchLaunchesMax" | "attributionStepBreaksTies" | "attributionMinPieces" | "attributionMissKmMax" | "attributionAmbiguityRatio" | "attributionCentreRatio" | "attributionCentreFloorKm" | "analystAttributes" | "planeDistanceMax">;

export const rulesOf = (params: DetectorParameters): AttributionRules => ({ attributionEnabled: params.attributionEnabled, confirmDeltaVMinMps: params.confirmDeltaVMinMps, freshPieceDays: params.freshPieceDays, cloudMemoryDays: params.cloudMemoryDays, debrisParentNeedsNearerThanCloud: params.debrisParentNeedsNearerThanCloud, singlePieceNeedsQuietLaunch: params.singlePieceNeedsQuietLaunch, confirmBackgroundMax: params.confirmBackgroundMax, youngLaunchDays: params.youngLaunchDays, youngLaunchDeltaVMps: params.youngLaunchDeltaVMps, attributionYoungLaunch: params.attributionYoungLaunch, attributionDebrisParentsMax: params.attributionDebrisParentsMax, attributionBatchLaunchesMax: params.attributionBatchLaunchesMax, attributionStepBreaksTies: params.attributionStepBreaksTies, attributionMinPieces: params.attributionMinPieces, attributionMissKmMax: params.attributionMissKmMax, attributionAmbiguityRatio: params.attributionAmbiguityRatio, attributionCentreRatio: params.attributionCentreRatio, attributionCentreFloorKm: params.attributionCentreFloorKm, analystAttributes: params.analystAttributes, planeDistanceMax: params.planeDistanceMax });

/** Every rule off: what the logging replay is run with. */
export const RULES_OFF: AttributionRules = { attributionEnabled: true, confirmDeltaVMinMps: 0, freshPieceDays: 0, cloudMemoryDays: 0, debrisParentNeedsNearerThanCloud: false, singlePieceNeedsQuietLaunch: false, confirmBackgroundMax: 1e9, youngLaunchDays: 0, youngLaunchDeltaVMps: DETECTOR_PARAMETERS.youngLaunchDeltaVMps, attributionYoungLaunch: true, attributionDebrisParentsMax: DETECTOR_PARAMETERS.attributionDebrisParentsMax, attributionBatchLaunchesMax: 1e9, attributionStepBreaksTies: true, attributionMinPieces: 1, attributionMissKmMax: 1e9, attributionAmbiguityRatio: 0, attributionCentreRatio: 0, attributionCentreFloorKm: DETECTOR_PARAMETERS.attributionCentreFloorKm, analystAttributes: true, planeDistanceMax: DETECTOR_PARAMETERS.planeDistanceMax };

const v = (row: LogRow, name: string): number => row.signals[name] ?? Number.NaN;

/** Whether the rules raise a confirmed verdict on an attribution row, and the refusals that apply, as `REFUSALS` bits. */
export function decide(row: LogRow, rules: AttributionRules): { raised: boolean; refused: number; kept: number } {
  // An attribution to a debris-classed body is an attribution as any other, where the parameter lets debris parents be tried at all.
  const raw = v(row, "attributionPath");
  const path = raw === ATTRIBUTION_PATHS.debris ? ATTRIBUTION_PATHS.cloud : raw;
  if (raw === ATTRIBUTION_PATHS.debris && rules.attributionDebrisParentsMax <= 0) return { raised: false, refused: REFUSALS.minPieces, kept: 0 };
  let refused = 0;
  let kept = v(row, "attributionPieces");
  const fragment = v(row, "parentFragment") === 1;
  if (path === ATTRIBUTION_PATHS.cloud && !rules.attributionEnabled) return { raised: false, refused: REFUSALS.minPieces, kept: 0 };
  if (path === ATTRIBUTION_PATHS.analyst) {
    if (!rules.analystAttributes) refused |= REFUSALS.analyst;
    if (v(row, "attributionRivals") > 0) refused |= REFUSALS.ambiguous;
  } else {
    // A young launch's pieces count only at its velocity floor or more (`judgeCloud`), and then attribute only where the parameter lets them; they never confirm an alert.
    const young = v(row, "launchAgeDays") < rules.youngLaunchDays;
    if (young && (path === ATTRIBUTION_PATHS.alert || !rules.attributionYoungLaunch || !(v(row, "cloudDeltaVMps") >= rules.youngLaunchDeltaVMps))) refused |= REFUSALS.youngLaunch;
    if (v(row, "lambdaRate") > rules.confirmBackgroundMax) refused |= REFUSALS.background;
  }
  if (rules.confirmDeltaVMinMps > 0 && !(v(row, "cloudDeltaVMps") >= rules.confirmDeltaVMinMps)) refused |= REFUSALS.velocity;
  if (rules.freshPieceDays > 0 && fragment && v(row, "parentAgeDays") < rules.freshPieceDays) refused |= REFUSALS.freshPiece;
  const cloud = v(row, "cloudPieces") > 0;
  if (rules.cloudMemoryDays > 0 && cloud && v(row, "daysSinceCloud") <= rules.cloudMemoryDays) {
    if (v(row, "parentCloudDistance") <= rules.planeDistanceMax) refused |= REFUSALS.parentInCloud;
    else {
      kept = Math.min(kept, v(row, "piecesOutOfCloud"));
      if (kept === 0) refused |= REFUSALS.piecesInCloud;
    }
  }
  if (rules.debrisParentNeedsNearerThanCloud && fragment && cloud) {
    kept = Math.min(kept, v(row, "piecesNearerThanCloud"));
    if (kept === 0) refused |= REFUSALS.nearerThanCloud;
  }
  if (rules.singlePieceNeedsQuietLaunch && kept === 1 && (fragment || v(row, "backgroundBodies") > 0 || v(row, "windowBodies") > 1)) refused |= REFUSALS.singlePiece;
  if (path === ATTRIBUTION_PATHS.cloud && kept < rules.attributionMinPieces) refused |= REFUSALS.minPieces;
  if (path === ATTRIBUTION_PATHS.cloud && v(row, "launchesInRun") > rules.attributionBatchLaunchesMax) refused |= REFUSALS.batch;
  if (path !== ATTRIBUTION_PATHS.alert) {
    const miss = v(row, "attributionMissKm");
    if (!Number.isFinite(miss)) refused |= REFUSALS.untimed;
    else if (miss > rules.attributionMissKmMax) refused |= REFUSALS.miss;
    if (path === ATTRIBUTION_PATHS.cloud && v(row, "attributionRivals") > 0 && !(v(row, "attributionRivalMissKm") >= rules.attributionAmbiguityRatio * miss) && !(v(row, "attributionRivalCentreKm") >= rules.attributionCentreRatio * Math.max(v(row, "attributionCentreKm"), rules.attributionCentreFloorKm)) && !(rules.attributionStepBreaksTies && v(row, "attributionStepped") === 1)) refused |= REFUSALS.ambiguous;
  }
  return { raised: refused === 0 && kept > 0, refused, kept };
}

const launchOfCode = (code: number): string | null => (code >= 1_000_000 ? `${Math.floor(code / 1000)}-${String(code % 1000).padStart(3, "0")}` : null);

/** One confirmed verdict the rules would raise, landed. */
export interface SimulatedConfirmation {
  year: number;
  row: LogRow;
  landing: ConfirmedLanding;
}

/**
 * The confirmed verdicts the rules raise from the rows of the years, in
 * the order logged, landed against the rows of the truth. An alert
 * confirmed closes, so the alert path's later rows on the same object
 * within the alert's time to live are the same alert and raise nothing.
 */
export function simulate(files: Pick<YearFile, "year" | "log">[], rules: AttributionRules, rows: readonly Row[]): SimulatedConfirmation[] {
  const out: SimulatedConfirmation[] = [];
  const closedAt = new Map<number, number>();
  for (const file of [...files].sort((a, b) => a.year - b.year)) {
    for (const row of file.log) {
      if (row.signals.phase !== PHASES.attribution) continue;
      const path = v(row, "attributionPath") === ATTRIBUTION_PATHS.debris ? ATTRIBUTION_PATHS.cloud : v(row, "attributionPath");
      if (path !== ATTRIBUTION_PATHS.cloud) {
        const closed = closedAt.get(row.number);
        if (closed !== undefined && row.at - closed < DETECTOR_PARAMETERS.alertTtlDays * DAY_MS) continue;
      }
      if (!decide(row, rules).raised) continue;
      if (path !== ATTRIBUTION_PATHS.cloud) closedAt.set(row.number, row.at);
      const verdict = { number: row.number, launch: launchOfCode(v(row, "launch")), raisedAt: row.at, step: path === ATTRIBUTION_PATHS.cloud ? null : { beforeEpoch: 0, afterEpoch: 0, deltaKm: 0, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 0, z: null }, event: Number.isFinite(v(row, "attributionEventAt")) ? { at: v(row, "attributionEventAt"), from: 0, to: 0 } : null, evidence: { bodyClass: v(row, "bodyClass") } };
      out.push({ year: file.year, row, landing: landConfirmed(verdict, out.length, rows) });
    }
  }
  return out;
}

/** The Confirmed line over a split as the simulation scores it. */
export interface SweepScore {
  targets: number;
  detected: number;
  /** Detections on every line, the precision's numerator. */
  detectedAllLines: number;
  falseAlarms: number;
  duplicates: number;
  exempt: number;
  recall: number | null;
  falseAlarmRate: number | null;
  /** The headline targets missed, by id, and the false alarms. */
  missed: string[];
  falses: SimulatedConfirmation[];
}

export function scoreOf(files: Pick<YearFile, "year" | "score">[], simulated: readonly SimulatedConfirmation[], years: readonly number[], line: Line = "breakups A-B"): SweepScore {
  const first = new Map<string, SimulatedConfirmation>();
  for (const s of simulated) if (s.landing.outcome === "detection" && s.landing.event !== null && !first.has(s.landing.event)) first.set(s.landing.event, s);
  const score: SweepScore = { targets: 0, detected: 0, detectedAllLines: 0, falseAlarms: 0, duplicates: 0, exempt: 0, recall: null, falseAlarmRate: null, missed: [], falses: [] };
  for (const file of files) {
    if (!years.includes(file.year)) continue;
    for (const event of file.score.events) {
      if (first.has(event.id)) score.detectedAllLines++;
      if (event.line !== line || !isConfirmedTarget(event)) continue;
      score.targets++;
      if (first.has(event.id)) score.detected++;
      else score.missed.push(event.id);
    }
  }
  for (const s of simulated) {
    if (!years.includes(s.year)) continue;
    if (s.landing.outcome === "false-alarm") {
      score.falseAlarms++;
      score.falses.push(s);
    } else if (s.landing.outcome === "exempt") score.exempt++;
    else if (s.landing.outcome === "fragment" || first.get(s.landing.event!) !== s) score.duplicates++;
  }
  score.recall = score.targets === 0 ? null : score.detected / score.targets;
  const n = score.falseAlarms + score.detectedAllLines;
  score.falseAlarmRate = n === 0 ? null : score.falseAlarms / n;
  return score;
}

const pct = (x: number | null): string => (x === null ? "–" : `${Math.round(x * 100)}%`);

/** The sweep's table rows: the rules at the detector's values, each varied in turn, every rule off. */
export function sweepLines(files: YearFile[], truth: Truth, catalogue: Catalogue, base: AttributionRules, grid: [string, Partial<AttributionRules>][], split: "train" | "validation" = "train"): string[] {
  const rows = catalogueRowsOf(truth.breakups, catalogue);
  const years = splitYears(files.map((f) => f.year), split);
  const out = ["| rule | targets | confirmed | recall | events confirmed, every line | false confirmations | false-alarm rate | duplicates | exempt |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const [label, change] of [["the detector's values", {}] as [string, Partial<AttributionRules>], ...grid, ["every rule off", RULES_OFF] as [string, Partial<AttributionRules>]]) {
    const s = scoreOf(files, simulate(files, { ...base, ...change }, rows), years);
    out.push(`| ${label} | ${s.targets} | ${s.detected} | ${pct(s.recall)} | ${s.detectedAllLines} | ${s.falseAlarms} | ${pct(s.falseAlarmRate)} | ${s.duplicates} | ${s.exempt} |`);
  }
  return out;
}

/** The misses and the false confirmations at a rule set, with the refusals that kept each target's pieces from confirming it. */
export function detailLines(files: YearFile[], truth: Truth, catalogue: Catalogue, rules: AttributionRules, split: "train" | "validation" = "train"): string[] {
  const rows = catalogueRowsOf(truth.breakups, catalogue);
  const years = splitYears(files.map((f) => f.year), split);
  const simulated = simulate(files, rules, rows);
  const s = scoreOf(files, simulated, years);
  const events = new Map(files.flatMap((f) => f.score.events.map((e) => [e.id, e] as const)));
  const out = ["| missed target | parent | launch | pieces in plane | judgements for the parent: refusals | judgements for other bodies |", "| --- | --- | --- | --- | --- | --- |"];
  for (const id of s.missed) {
    const event = events.get(id)!;
    const code = event.launch === null ? null : Number(event.launch.slice(0, 4)) * 1000 + Number(event.launch.slice(5, 8));
    const judged = files.flatMap((f) => f.log).filter((r) => r.signals.phase === PHASES.attribution && r.signals.launch === code && r.at >= event.from - 2 * DAY_MS && r.at <= event.to + 180 * DAY_MS);
    const own = judged.filter((r) => r.number === event.parent).map((r) => `${new Date(r.at).toISOString().slice(0, 10)} ${r.signals.attributionPieces}p ${r.signals.attributionPath === ATTRIBUTION_PATHS.alert ? "alert" : r.signals.attributionPath === ATTRIBUTION_PATHS.analyst ? "analyst" : "cloud"}: ${refusalNames(decide(r, rules).refused) || "raised"}`);
    const others = [...new Set(judged.filter((r) => r.number !== event.parent).map((r) => r.number))];
    out.push(`| ${id} ${event.name} | ${event.parent} | ${event.launch ?? "–"} | ${event.fragments?.inPlane ?? "–"} | ${own.join("; ") || "none"} | ${others.join(", ") || "none"} |`);
  }
  out.push("", "| false confirmation | year | object | launch | class | path | pieces | m/s | miss km | rival miss km |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const f of s.falses) {
    const r = f.row;
    out.push(`| ${new Date(r.at).toISOString().slice(0, 10)} | ${f.year} | ${r.number} | ${launchOfCode(r.signals.launch ?? 0) ?? "analyst"} | ${BODY_CLASSES[r.signals.bodyClass ?? -1] ?? "?"} | ${r.signals.attributionPath === ATTRIBUTION_PATHS.alert ? "alert" : r.signals.attributionPath === ATTRIBUTION_PATHS.analyst ? "analyst" : "cloud"} | ${r.signals.attributionPieces} | ${(r.signals.cloudDeltaVMps ?? Number.NaN).toFixed(1)} | ${(r.signals.attributionMissKm ?? Number.NaN).toFixed(1)} | ${(r.signals.attributionRivalMissKm ?? Number.NaN).toFixed(1)} |`);
  }
  return out;
}

/** The names of refusal bits. */
export function refusalNames(bits: number): string {
  return (Object.entries(REFUSALS) as [string, number][]).filter(([, bit]) => (bits & bit) !== 0).map(([name]) => name).join(", ");
}
