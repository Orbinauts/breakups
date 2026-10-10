import { ATTRIBUTION_PATHS, BODY_CLASSES, DETECTOR_PARAMETERS, PHASES, REFUSALS, type DetectorParameters, type LogRow } from "../../src/index.ts";
import type { Catalogue } from "./catalogue.ts";
import { isConfirmedTarget, readingOf, splitYears, type YearFile } from "./kpi.ts";
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
export type AttributionRules = Pick<DetectorParameters, "attributionEnabled" | "confirmDeltaVMinMps" | "freshPieceDays" | "cloudMemoryDays" | "debrisParentNeedsNearerThanCloud" | "singlePieceNeedsQuietLaunch" | "confirmBackgroundMax" | "youngLaunchDays" | "youngLaunchDeltaVMps" | "attributionYoungLaunch" | "attributionDebrisParentsMax" | "attributionBatchLaunchesMax" | "attributionStepBreaksTies" | "attributionMinPieces" | "attributionMissKmMax" | "attributionAmbiguityRatio" | "attributionCentreRatio" | "attributionCentreFloorKm" | "analystAttributes" | "planeDistanceMax" | "attributionTwins" | "attributionTwinsUnresolved" | "originHoursBase" | "originHoursPerDay" | "originShareMin" | "originMinPieces" | "originPhaseMax" | "originOverrideHours" | "originOverrideMinPieces" | "originLaunchMarginDays" | "originStepHoursMax" | "stationLaunches">;

export const rulesOf = (params: DetectorParameters): AttributionRules => ({ attributionTwins: params.attributionTwins, attributionTwinsUnresolved: params.attributionTwinsUnresolved, originHoursBase: params.originHoursBase, originHoursPerDay: params.originHoursPerDay, originShareMin: params.originShareMin, originMinPieces: params.originMinPieces, originPhaseMax: params.originPhaseMax, originOverrideHours: params.originOverrideHours, originOverrideMinPieces: params.originOverrideMinPieces, originLaunchMarginDays: params.originLaunchMarginDays, originStepHoursMax: params.originStepHoursMax, stationLaunches: params.stationLaunches, attributionEnabled: params.attributionEnabled, confirmDeltaVMinMps: params.confirmDeltaVMinMps, freshPieceDays: params.freshPieceDays, cloudMemoryDays: params.cloudMemoryDays, debrisParentNeedsNearerThanCloud: params.debrisParentNeedsNearerThanCloud, singlePieceNeedsQuietLaunch: params.singlePieceNeedsQuietLaunch, confirmBackgroundMax: params.confirmBackgroundMax, youngLaunchDays: params.youngLaunchDays, youngLaunchDeltaVMps: params.youngLaunchDeltaVMps, attributionYoungLaunch: params.attributionYoungLaunch, attributionDebrisParentsMax: params.attributionDebrisParentsMax, attributionBatchLaunchesMax: params.attributionBatchLaunchesMax, attributionStepBreaksTies: params.attributionStepBreaksTies, attributionMinPieces: params.attributionMinPieces, attributionMissKmMax: params.attributionMissKmMax, attributionAmbiguityRatio: params.attributionAmbiguityRatio, attributionCentreRatio: params.attributionCentreRatio, attributionCentreFloorKm: params.attributionCentreFloorKm, analystAttributes: params.analystAttributes, planeDistanceMax: params.planeDistanceMax });

/** Every rule off: what the logging replay is run with. */
export const RULES_OFF: AttributionRules = { attributionTwins: true, attributionTwinsUnresolved: true, originHoursBase: 1e9, originHoursPerDay: 0, originShareMin: 0.5, originMinPieces: 2, originPhaseMax: 1e9, originOverrideHours: 1e9, originOverrideMinPieces: 3, originLaunchMarginDays: -1e9, originStepHoursMax: 1e9, stationLaunches: [], attributionEnabled: true, confirmDeltaVMinMps: 0, freshPieceDays: 0, cloudMemoryDays: 0, debrisParentNeedsNearerThanCloud: false, singlePieceNeedsQuietLaunch: false, confirmBackgroundMax: 1e9, youngLaunchDays: 0, youngLaunchDeltaVMps: DETECTOR_PARAMETERS.youngLaunchDeltaVMps, attributionYoungLaunch: true, attributionDebrisParentsMax: DETECTOR_PARAMETERS.attributionDebrisParentsMax, attributionBatchLaunchesMax: 1e9, attributionStepBreaksTies: true, attributionMinPieces: 1, attributionMissKmMax: 1e9, attributionAmbiguityRatio: 0, attributionCentreRatio: 0, attributionCentreFloorKm: DETECTOR_PARAMETERS.attributionCentreFloorKm, analystAttributes: true, planeDistanceMax: DETECTOR_PARAMETERS.planeDistanceMax };

const v = (row: LogRow, name: string): number => row.signals[name] ?? Number.NaN;

/** Whether the rules raise a confirmed verdict on an attribution row, and the refusals that apply, as `REFUSALS` bits. */
export function decide(row: LogRow, rules: AttributionRules, namedDaysAgo = Number.NEGATIVE_INFINITY): { raised: boolean; refused: number; kept: number } {
  // An attribution to a debris-classed body is an attribution as any other, where the parameter lets debris parents be tried at all.
  const raw = v(row, "attributionPath");
  const path = raw === ATTRIBUTION_PATHS.debris ? ATTRIBUTION_PATHS.cloud : raw;
  if (raw === ATTRIBUTION_PATHS.debris && rules.attributionDebrisParentsMax <= 0) return { raised: false, refused: REFUSALS.minPieces, kept: 0 };
  let refused = 0;
  let kept = v(row, "attributionPieces");
  const fragment = v(row, "parentFragment") === 1;
  if (path === ATTRIBUTION_PATHS.cloud && !rules.attributionEnabled) return { raised: false, refused: REFUSALS.minPieces, kept: 0 };
  // Pieces made at one instant are not an old cloud's: the rules that read the launch's history as one (`HISTORY_REFUSALS`) do not refuse them, and every piece judged is kept.
  const made = path !== ATTRIBUTION_PATHS.analyst && rules.originOverrideHours < 1e8 && v(row, "originTimed") >= rules.originOverrideMinPieces && v(row, "originDev75Hours") <= rules.originOverrideHours;
  if (path === ATTRIBUTION_PATHS.analyst) {
    if (!rules.analystAttributes) refused |= REFUSALS.analyst;
    if (v(row, "attributionRivals") > 0) refused |= REFUSALS.ambiguous;
  } else {
    // A young launch's pieces count only at its velocity floor or more (`judgeCloud`), and then attribute only where the parameter lets them; they never confirm an alert.
    const young = v(row, "launchAgeDays") < rules.youngLaunchDays;
    if (young && (path === ATTRIBUTION_PATHS.alert || !rules.attributionYoungLaunch || !(v(row, "cloudDeltaVMps") >= rules.youngLaunchDeltaVMps))) refused |= REFUSALS.youngLaunch;
    if (v(row, "lambdaRate") > rules.confirmBackgroundMax && !made) refused |= REFUSALS.background;
    const launch = launchOfCode(v(row, "launch"));
    if (launch !== null && rules.stationLaunches.includes(launch)) refused |= REFUSALS.station;
  }
  if (rules.confirmDeltaVMinMps > 0 && !(v(row, "cloudDeltaVMps") >= rules.confirmDeltaVMinMps)) refused |= REFUSALS.velocity;
  if (rules.freshPieceDays > 0 && fragment && v(row, "parentAgeDays") < rules.freshPieceDays) refused |= REFUSALS.freshPiece;
  const cloud = v(row, "cloudPieces") > 0;
  // The cloud memory as the simulation would have kept it: on an attribution, only where the simulation itself named a cloud under the launch within the memory (the logging replay named every one); a step's confirmation reads the replay's memory, which unnamed bursts set too.
  const remembered = path !== ATTRIBUTION_PATHS.cloud || namedDaysAgo === Number.NEGATIVE_INFINITY || namedDaysAgo <= rules.cloudMemoryDays;
  if (rules.cloudMemoryDays > 0 && cloud && v(row, "daysSinceCloud") <= rules.cloudMemoryDays && remembered && !made) {
    if (v(row, "parentCloudDistance") <= rules.planeDistanceMax) refused |= REFUSALS.parentInCloud;
    else {
      kept = Math.min(kept, v(row, "piecesOutOfCloud"));
      if (kept === 0) refused |= REFUSALS.piecesInCloud;
    }
  }
  if (rules.debrisParentNeedsNearerThanCloud && fragment && cloud && !made) {
    kept = Math.min(kept, v(row, "piecesNearerThanCloud"));
    if (kept === 0) refused |= REFUSALS.nearerThanCloud;
  }
  if (rules.singlePieceNeedsQuietLaunch && kept === 1 && (fragment || v(row, "backgroundBodies") > 0 || v(row, "windowBodies") > 1)) refused |= REFUSALS.singlePiece;
  if (path === ATTRIBUTION_PATHS.cloud && kept < rules.attributionMinPieces) refused |= REFUSALS.minPieces;
  if (path === ATTRIBUTION_PATHS.cloud && v(row, "launchesInRun") > rules.attributionBatchLaunchesMax && !made) refused |= REFUSALS.batch;
  if (path !== ATTRIBUTION_PATHS.alert) {
    const miss = v(row, "attributionMissKm");
    if (!Number.isFinite(miss)) refused |= REFUSALS.untimed;
    else if (miss > rules.attributionMissKmMax) refused |= REFUSALS.miss;
    // Twins nothing tells apart are raised naming them all only where the parameter asks; else, as with the twins off, refused unless a step names one.
    if (path === ATTRIBUTION_PATHS.cloud && rules.attributionTwins && !rules.attributionTwinsUnresolved && v(row, "attributionTwins") > 0 && !(rules.attributionStepBreaksTies && v(row, "attributionStepped") === 1)) refused |= REFUSALS.ambiguous;
    // With the twins off, a group the pieces cannot tell from other bodies is refused unless a step names one.
    if (path === ATTRIBUTION_PATHS.cloud && !rules.attributionTwins && v(row, "attributionRivals") > 0 && !(v(row, "attributionRivalMissKm") >= rules.attributionAmbiguityRatio * miss) && !(v(row, "attributionRivalCentreKm") >= rules.attributionCentreRatio * Math.max(v(row, "attributionCentreKm"), rules.attributionCentreFloorKm)) && !(rules.attributionStepBreaksTies && v(row, "attributionStepped") === 1)) refused |= REFUSALS.ambiguous;
  }
  if (!passesOriginRow(row, rules)) refused |= REFUSALS.origin;
  // The pieces' common origin is the launch itself, or (on a step's confirmation) not the step's instant.
  if (v(row, "originTimed") >= 2 && (v(row, "launchAgeDays") - v(row, "originAgeDays") < rules.originLaunchMarginDays || (path === ATTRIBUTION_PATHS.alert && Math.abs(v(row, "originStepHours")) > rules.originStepHoursMax))) refused |= REFUSALS.origin;
  return { raised: refused === 0 && kept > 0, refused, kept };
}

/**
 * The common-origin test on a row's readings, as `passesOrigin` reads the
 * pieces: off where the base is beyond reach; with fewer pieces tried than
 * the rule needs it says nothing; else the share asked must have crossed
 * within the bound of the median, a row with no crossing failing.
 */
export function passesOriginRow(row: LogRow, rules: Pick<AttributionRules, "originHoursBase" | "originHoursPerDay" | "originShareMin" | "originMinPieces" | "originPhaseMax">): boolean {
  if (!(rules.originHoursBase < 1e8) && !(rules.originPhaseMax < 1e8)) return true;
  const tried = v(row, "originTried");
  if (!(tried >= rules.originMinPieces)) return true;
  const deviation = rules.originShareMin <= 0.5 ? v(row, "originDev50Hours") : v(row, "originDev75Hours");
  const age = v(row, "originAgeDays");
  const phase = rules.originShareMin <= 0.5 ? v(row, "originPhase50") : v(row, "originPhase75");
  return deviation <= rules.originHoursBase + rules.originHoursPerDay * Math.max(0, Number.isFinite(age) ? age : 0) && phase <= rules.originPhaseMax;
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
  const namedAt = new Map<number, number>();
  for (const file of [...files].sort((a, b) => a.year - b.year)) {
    for (const row of file.log) {
      if (row.signals.phase !== PHASES.attribution) continue;
      const path = v(row, "attributionPath") === ATTRIBUTION_PATHS.debris ? ATTRIBUTION_PATHS.cloud : v(row, "attributionPath");
      if (path !== ATTRIBUTION_PATHS.cloud) {
        const closed = closedAt.get(row.number);
        if (closed !== undefined && row.at - closed < DETECTOR_PARAMETERS.alertTtlDays * DAY_MS) continue;
      }
      const named = namedAt.get(v(row, "launch"));
      if (!decide(row, rules, named === undefined ? Number.POSITIVE_INFINITY : (row.at - named) / DAY_MS).raised) continue;
      namedAt.set(v(row, "launch"), row.at);
      if (path !== ATTRIBUTION_PATHS.cloud) closedAt.set(row.number, row.at);
      const candidates = rules.attributionTwins && path === ATTRIBUTION_PATHS.cloud && v(row, "attributionTwins") > 0 ? [row.number, ...[v(row, "candidate1"), v(row, "candidate2"), v(row, "candidate3")].filter((n) => Number.isFinite(n))] : undefined;
      const verdict = { number: row.number, launch: launchOfCode(v(row, "launch")), raisedAt: row.at, step: path === ATTRIBUTION_PATHS.cloud ? null : { beforeEpoch: 0, afterEpoch: 0, deltaKm: 0, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 0, z: null }, event: Number.isFinite(v(row, "attributionEventAt")) ? { at: v(row, "attributionEventAt"), from: 0, to: 0 } : null, evidence: { bodyClass: v(row, "bodyClass") }, ...(candidates === undefined ? {} : { candidates }) };
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

export function scoreOf(files: Pick<YearFile, "year" | "score">[], simulatedAsLanded: readonly SimulatedConfirmation[], years: readonly number[], line: Line = "breakups A-B", twins = false): SweepScore {
  const simulated = simulatedAsLanded.map((s) => ({ ...s, landing: readingOf(s.landing, twins) }));
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

/** One point of the common-origin sweep: the rules, and the training split's Confirmed line with the twins matched on the body named and at the launch. */
export interface GridPoint {
  label: string;
  rules: AttributionRules;
  score: SweepScore;
  twins: SweepScore;
}

/**
 * The common-origin sweep: every combination of the axes given, laid over
 * the base rules, simulated over the rows of every year and scored on the
 * split asked, the twins read both ways. The axes are the rule's own (the
 * base of the bound, its allowance per day of the pieces' age, the share
 * of the pieces it reads and the fewest it judges) and any of the ninth
 * phase's rules, so the frontier says what the test buys alone and what it
 * lets be relaxed.
 */
export function originGrid(files: YearFile[], truth: Truth, catalogue: Catalogue, base: AttributionRules, axes: Partial<Record<keyof AttributionRules, AttributionRules[keyof AttributionRules][]>>, split: "train" | "validation" = "train"): GridPoint[] {
  const rows = catalogueRowsOf(truth.breakups, catalogue);
  const years = splitYears(files.map((f) => f.year), split);
  const names = Object.keys(axes) as (keyof AttributionRules)[];
  const points: GridPoint[] = [];
  const walk = (i: number, change: Partial<AttributionRules>): void => {
    if (i === names.length) {
      const rules = { ...base, ...change } as AttributionRules;
      const simulated = simulate(files, rules, rows);
      points.push({ label: names.map((n) => `${n}=${JSON.stringify(rules[n])}`).join(" "), rules, score: scoreOf(files, simulated, years), twins: scoreOf(files, simulated, years, "breakups A-B", true) });
      return;
    }
    for (const value of axes[names[i]!]!) walk(i + 1, { ...change, [names[i]!]: value });
  };
  walk(0, {});
  return points;
}

/** The detail of one rule set for the note: every headline target missed and every false confirmation on the split, with the pieces, their velocity, the common-origin readings and the refusals that applied. */
export function originDetail(files: YearFile[], truth: Truth, catalogue: Catalogue, rules: AttributionRules, split: "train" | "validation" = "train", twins = false): string[] {
  const rows = catalogueRowsOf(truth.breakups, catalogue);
  const years = splitYears(files.map((f) => f.year), split);
  const simulated = simulate(files, rules, rows);
  const s = scoreOf(files, simulated, years, "breakups A-B", twins);
  const events = new Map(files.flatMap((f) => f.score.events.map((e) => [e.id, e] as const)));
  const cell = (x: number | undefined, digits = 1): string => (x === undefined || !Number.isFinite(x) ? "–" : x.toFixed(digits));
  const origin = (r: LogRow): string => `${r.signals.originTimed ?? 0}/${r.signals.originTried ?? 0}, ${cell(r.signals.originDev50Hours)} h / ${cell(r.signals.originDev75Hours)} h at ${cell(r.signals.originAgeDays)} d, miss ${cell(r.signals.originMissKm, 0)} km`;
  const path = (r: LogRow): string => (r.signals.attributionPath === ATTRIBUTION_PATHS.alert ? "alert" : r.signals.attributionPath === ATTRIBUTION_PATHS.analyst ? "analyst" : r.signals.attributionPath === ATTRIBUTION_PATHS.debris ? "debris" : "cloud");
  const out = ["| missed target | parent | launch | pieces in plane | the parent's judgements: date, pieces, path, m/s, crossings timed/tried, half / three quarters within, at age, miss: refusals | twins named |", "| --- | --- | --- | --- | --- | --- |"];
  for (const id of s.missed) {
    const event = events.get(id)!;
    const code = event.launch === null ? null : Number(event.launch.slice(0, 4)) * 1000 + Number(event.launch.slice(5, 8));
    const judged = files.flatMap((f) => f.log).filter((r) => r.signals.phase === PHASES.attribution && r.signals.launch === code && r.at >= event.from - 2 * DAY_MS && r.at <= event.to + 180 * DAY_MS);
    const own = judged.filter((r) => r.number === event.parent).slice(0, 4).map((r) => `${new Date(r.at).toISOString().slice(0, 10)} ${r.signals.attributionPieces}p ${path(r)} ${cell(r.signals.cloudDeltaVMps)} m/s ${origin(r)}: ${refusalNames(decide(r, rules).refused) || "raised"}`);
    const others = judged.filter((r) => r.number !== event.parent && decide(r, rules).raised).map((r) => `${r.number}${(r.signals.attributionTwins ?? 0) > 0 ? ` (with ${[r.signals.candidate1, r.signals.candidate2, r.signals.candidate3].filter((n) => n !== undefined).join(", ")})` : ""}`);
    out.push(`| ${id} ${event.name} | ${event.parent} | ${event.launch ?? "–"} | ${event.fragments?.inPlane ?? "–"} | ${own.join("; ") || "none"} | ${[...new Set(others)].join(", ") || "none"} |`);
  }
  out.push("", "| false confirmation | year | object | launch | class | path | pieces | m/s | crossings timed/tried, half / three quarters within, at age, miss | convergence miss km | twins |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const f of s.falses) {
    const r = f.row;
    out.push(`| ${new Date(r.at).toISOString().slice(0, 10)} | ${f.year} | ${r.number} | ${launchOfCode(r.signals.launch ?? 0) ?? "analyst"} | ${BODY_CLASSES[r.signals.bodyClass ?? -1] ?? "?"} | ${path(r)} | ${r.signals.attributionPieces} | ${cell(r.signals.cloudDeltaVMps)} | ${origin(r)} | ${cell(r.signals.attributionMissKm, 0)} | ${r.signals.attributionTwins ?? 0} |`);
  }
  return out;
}

/** The common-origin readings of the confirmations a rule set raises on the split, true ones (an event's first) against false ones: the quartiles of each reading, so the separation is read before any threshold is set on it. */
export function originSeparation(files: YearFile[], truth: Truth, catalogue: Catalogue, rules: AttributionRules, split: "train" | "validation" = "train"): string[] {
  const rows = catalogueRowsOf(truth.breakups, catalogue);
  const years = splitYears(files.map((f) => f.year), split);
  const simulated = simulate(files, rules, rows).filter((s) => years.includes(s.year));
  const seen = new Set<string>();
  const truths: LogRow[] = [];
  const falses: LogRow[] = [];
  for (const s of simulated) {
    if (s.landing.outcome === "false-alarm") falses.push(s.row);
    else if (s.landing.outcome === "detection" && s.landing.event !== null && !seen.has(s.landing.event)) {
      seen.add(s.landing.event);
      truths.push(s.row);
    }
  }
  const quartiles = (values: number[]): string => {
    const finite = values.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
    if (finite.length === 0) return "–";
    const q = (p: number): string => {
      const x = finite[Math.min(finite.length - 1, Math.floor(p * (finite.length - 1)))]!;
      return Number.isFinite(x) ? x.toPrecision(3) : "∞";
    };
    return `${finite.length}: ${q(0.25)} / ${q(0.5)} / ${q(0.75)}`;
  };
  const reading = (name: string) => (r: LogRow): number => r.signals[name] ?? Number.NaN;
  const signals: [string, (r: LogRow) => number][] = [
    ["pieces tried", reading("originTried")],
    ["share of the pieces crossing in the window", (r) => (r.signals.originTimed ?? 0) / Math.max(1, r.signals.originTried ?? 0)],
    ["half of the pieces within, hours", reading("originDev50Hours")],
    ["three quarters within, hours", reading("originDev75Hours")],
    ["half within, share of a lap", reading("originPhase50")],
    ["three quarters within, share of a lap", reading("originPhase75")],
    ["robust spread, hours", reading("originSpreadHours")],
    ["the pieces' age at the median crossing, days", reading("originAgeDays")],
    ["half within, hours per day of age", (r) => (r.signals.originDev50Hours ?? Number.NaN) / Math.max(1, r.signals.originAgeDays ?? Number.NaN)],
    ["median closest approach, km", reading("originMissKm")],
    ["the convergence's miss, km", reading("attributionMissKm")],
    ["the pieces' crossings about the convergence, minutes (drift-weighted)", reading("attributionSpreadMinutes")],
    ["the cloud velocity, m/s", reading("cloudDeltaVMps")],
  ];
  const out = ["| reading | true confirmations (n: quartiles) | false confirmations (n: quartiles) |", "| --- | --- | --- |"];
  for (const [name, f] of signals) out.push(`| ${name} | ${quartiles(truths.map(f))} | ${quartiles(falses.map(f))} |`);
  return out;
}
