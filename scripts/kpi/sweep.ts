import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BODY_CLASSES, DETECTOR_PARAMETERS, MANOEUVRE_CLASSES, OUTCOMES, REGIMES, atypicalReasons, classify, isRaised, launchOf, poissonTail, yearOf, type CurrentStep, type DetectorParameters, type HistoryFeatures, type LogRow, type ManoeuvreClass } from "../../src/index.ts";
import { brackets, marginDaysOf } from "./match.ts";
import { readTruth, readYearFiles, yearsDir } from "./run.ts";
import { DAY_MS } from "./replay.ts";
import { alertKey, alertRowsOf, cellsOf, tiersTable, type YearFile } from "./kpi.ts";

/**
 * The offline sweep: the persistence gates and the manoeuvre gate
 * re-thresholded over the candidates a replay logged, without replaying
 * the years. Each log row is one closed candidate with the step's
 * trajectory over its first post sets, the impulse it implied and the
 * object's history at it, so for a set of gate values the sweep can say
 * at which post set, if any, the candidate would have been persistent,
 * how the history would have classed it, whether it would have been
 * raised, and whether that beat the catalogue for a target of the year.
 * It is an approximation of the scorecard, not the scorecard: a candidate
 * counts as a hit when its bracket brackets a target's window on the
 * target's parent and the run that would have raised it came before the
 * catalogue and any notice, and as a false alarm otherwise, unless the
 * replay's own matching landed the same object's step as a duplicate or
 * exempt. The history a row carries is the one the replay built, which
 * does not depend on the manoeuvre gate's thresholds (every persistent
 * step joins the history whatever its verdict), so the classing is
 * re-done exactly. What the sweep cannot see is the gates that act
 * before the log (the candidate threshold, the guards), which are swept
 * by replaying.
 *
 * `npm run kpi:sweep -- [--years 2006,2008,...] [--show] [--<gate> v1,v2]`
 * prints, for each gate given (or, with none, each gate in turn at its
 * default grid, the others at the detector's values), the hits on the
 * headline line, the hits on every line, the false alarms in all and on
 * the non-payload classes, and the false alarms by why they were raised;
 * by default over the even years, the training split, and with `--show`
 * listing the targets hit.
 *
 * `--clouds` sweeps the per-launch channel instead, over the cloud rows
 * the launch pass logged (one per launch per run that brought it new
 * bodies, with the window's count, the background rate, the pieces within
 * each plane distance and the cloud velocity): for each threshold the
 * rows that would list a cloud, de-duplicated per launch and month, are
 * counted as hits where a scoreable reported event of the launch lies in
 * the ninety days before, and as false clouds otherwise. `--tiers` prints
 * the persistence-tier table over the alert rows of the years given.
 *
 * `--confirmations` sweeps the confirmation rules of the fifth phase
 * over the alert rows that carry a confirmation reading (pieces in the
 * parent's plane were judged, whether they confirmed or the rules refused
 * them; a replay with the rules off, `--param cloudMemoryDays=0` and the
 * rest, logs every confirmation the third phase would have made): for
 * each rule, and for all together, the confirmations kept and whether
 * each was on a reported event's step, on the right object with the step
 * late, or on nothing, as the matcher landed the alert. The composition
 * of the per-piece rules is approximated by counts (the pieces left out
 * by one rule are taken as the same the next would leave out), so the
 * replay with the rules on is the record.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const KPI_DIR = join(ROOT, "kpi");

/** The gates the sweep varies: the persistence gates of the first phase and the manoeuvre gate's thresholds of the second. */
export interface Gates {
  zPersist: number;
  rhoMin: number;
  rhoMax: number;
  evidenceMin: number;
  spanHours: number;
  typicalityMax: number;
  oppositeMinSteps: number;
  consistencyMin: number;
  bstarRatioMax: number;
  newObjectDays: number;
  /** Whether a step classed occasional (a past step within two years, on no pattern) is raised: 1 to raise, 0 as the design, a manoeuvre. */
  occasionalRaises: number;
  /** Whether an occasional step is raised on the classes the catalogue does not call payloads (1), as the third phase's parameter. */
  occasionalRaisesNonPayload: number;
  /** Whether the persistence size is judged on the mean step at the post sets' centroid (1) rather than the level at the first post set (0). */
  persistOnMeanStep: number;
}

export const DETECTOR_GATES: Gates = {
  zPersist: DETECTOR_PARAMETERS.zPersist,
  rhoMin: DETECTOR_PARAMETERS.rhoMin,
  rhoMax: DETECTOR_PARAMETERS.rhoMax,
  evidenceMin: DETECTOR_PARAMETERS.evidenceMin,
  spanHours: DETECTOR_PARAMETERS.persistMinSpanHours.LEO,
  typicalityMax: DETECTOR_PARAMETERS.typicalityMax,
  oppositeMinSteps: DETECTOR_PARAMETERS.oppositeMinSteps,
  consistencyMin: DETECTOR_PARAMETERS.consistencyMin,
  bstarRatioMax: DETECTOR_PARAMETERS.bstarRatioMax,
  newObjectDays: DETECTOR_PARAMETERS.newObjectDays,
  occasionalRaises: 0,
  occasionalRaisesNonPayload: DETECTOR_PARAMETERS.occasionalRaisesNonPayload ? 1 : 0,
  persistOnMeanStep: DETECTOR_PARAMETERS.persistOnMeanStep ? 1 : 0,
};

/** A candidate as the sweep reads it: the row's trajectory, its reading and where its object's step landed in the replay. */
export interface SweptCandidate {
  year: number;
  number: number;
  at: number;
  beforeEpoch: number;
  afterEpoch: number;
  z1: number;
  regime: number;
  bodyClass: number;
  bstar: number;
  stormHold: number;
  kpMax: number;
  /** The trajectory at the second and the third post set, NaN where not reached. */
  z2: number;
  rho2: number;
  evidence2: number;
  span2: number;
  z3: number;
  rho3: number;
  evidence3: number;
  span3: number;
  /** The mean step at the second and third post set and at the close. */
  zMean2: number;
  zMean3: number;
  zMean: number;
  /** The final estimate, at the close. */
  zk: number;
  rhoMedian: number;
  evidence: number;
  k: number;
  outcome: number;
  /** The reading: the step, its impulse and the object's history, as logged. */
  deltaKm: number;
  deltaPerigeeKm: number;
  deltaVMps: number;
  deltaVNormalMps: number;
  impulseConsistency: number;
  bstarRatio: number;
  ageDays: number;
  n365: number;
  n730: number;
  daysSinceStep: number;
  regularity: number;
  typicality: number;
  sameSignShare: number;
  alternation: number;
  normalShare: number;
  disposalLike: number;
}

const signal = (row: LogRow, name: string): number => row.signals[name] ?? Number.NaN;

export function candidateOf(year: number, row: LogRow): SweptCandidate {
  return {
    year,
    number: row.number,
    at: row.at,
    beforeEpoch: signal(row, "beforeEpoch"),
    afterEpoch: signal(row, "afterEpoch"),
    z1: signal(row, "z1"),
    regime: signal(row, "regime"),
    bodyClass: signal(row, "bodyClass"),
    bstar: signal(row, "bstar"),
    stormHold: signal(row, "stormHold"),
    kpMax: signal(row, "kpMax"),
    z2: signal(row, "z2"),
    rho2: signal(row, "rho2"),
    evidence2: signal(row, "evidence2"),
    span2: signal(row, "span2"),
    z3: signal(row, "z3"),
    rho3: signal(row, "rho3"),
    evidence3: signal(row, "evidence3"),
    span3: signal(row, "span3"),
    zMean2: signal(row, "zMean2"),
    zMean3: signal(row, "zMean3"),
    zMean: signal(row, "zMean"),
    zk: signal(row, "zk"),
    rhoMedian: signal(row, "rhoMedian"),
    evidence: signal(row, "stepEvidence"),
    k: signal(row, "k"),
    outcome: signal(row, "outcome"),
    deltaKm: signal(row, "deltaKm"),
    deltaPerigeeKm: signal(row, "deltaPerigeeKm"),
    deltaVMps: signal(row, "deltaVMps"),
    deltaVNormalMps: signal(row, "deltaVNormalMps"),
    impulseConsistency: signal(row, "impulseConsistency"),
    bstarRatio: signal(row, "bstarRatio"),
    ageDays: signal(row, "ageDays"),
    n365: signal(row, "n365"),
    n730: signal(row, "n730"),
    daysSinceStep: signal(row, "daysSinceStep"),
    regularity: signal(row, "regularity"),
    typicality: signal(row, "typicality"),
    sameSignShare: signal(row, "sameSignShare"),
    alternation: signal(row, "alternation"),
    normalShare: signal(row, "normalShare"),
    disposalLike: signal(row, "disposalLike"),
  };
}

/** Whether the persistence gates pass at one point of the trajectory. */
function passes(z: number, rho: number, evidence: number, gates: Gates): boolean {
  return Math.abs(z) >= gates.zPersist && rho >= gates.rhoMin && rho <= gates.rhoMax && evidence >= gates.evidenceMin;
}

/**
 * At which post set the candidate would have been persistent under the
 * gates: the second where its span allows, else the third, else at its
 * close where it had more; null where never. A reverted candidate (its
 * later sets back under the revert ratio) is never raised.
 */
export function raisedAt(c: SweptCandidate, gates: Gates): 2 | 3 | "close" | null {
  if (c.outcome === OUTCOMES.reverted) return null;
  const mean = gates.persistOnMeanStep === 1;
  if (Number.isFinite(c.z2) && c.span2 >= gates.spanHours && passes(mean ? c.zMean2 : c.z2, c.rho2, c.evidence2, gates)) return 2;
  if (Number.isFinite(c.z3) && passes(mean ? c.zMean3 : c.z3, c.rho3, c.evidence3, gates)) return 3;
  if (c.k > 3 && passes(mean ? c.zMean : c.zk, c.rhoMedian, c.evidence, gates)) return "close";
  return null;
}

/** Why a persistent step was raised, or that it was not: its class where unique, else the first atypical test it passed. */
export type Why = ManoeuvreClass | "typicality" | "opposite" | "consistency" | "bstar" | "occasional-raised" | "manoeuvre";

/** The manoeuvre gate on a persistent candidate, with the thresholds: whether it is raised, and why. */
export function gateOf(c: SweptCandidate, gates: Gates): { raised: boolean; why: Why; manoeuvreClass: ManoeuvreClass } {
  const params: DetectorParameters = { ...DETECTOR_PARAMETERS, typicalityMax: gates.typicalityMax, oppositeMinSteps: gates.oppositeMinSteps, consistencyMin: gates.consistencyMin, bstarRatioMax: gates.bstarRatioMax, newObjectDays: gates.newObjectDays };
  const features: HistoryFeatures = { ageDays: c.ageDays, n365: c.n365, n730: c.n730, daysSinceStep: c.daysSinceStep, regularity: c.regularity, typicality: c.typicality, sameSignShare: c.sameSignShare, alternation: c.alternation, normalShare: c.normalShare, disposalLike: c.disposalLike === 1, young: c.ageDays < gates.newObjectDays };
  const step: CurrentStep = { epochMs: c.afterEpoch, deltaKm: c.deltaKm, deltaPerigeeKm: c.deltaPerigeeKm, tangentialMps: c.deltaVMps, normalMps: c.deltaVNormalMps, consistency: c.impulseConsistency, bstarRatio: c.bstarRatio, regime: REGIMES[c.regime] ?? "unknown", bodyClass: BODY_CLASSES[c.bodyClass] ?? "unknown", apogeeHeightAfterKm: 0 };
  const manoeuvreClass = classify(features, step, params);
  const atypical = atypicalReasons(features, step, params);
  if (isRaised(manoeuvreClass, atypical, step.bodyClass, { occasionalRaisesNonPayload: gates.occasionalRaisesNonPayload === 1 })) {
    const why: Why = manoeuvreClass === "unique" ? "unique" : atypical.length === 0 ? "occasional-raised" : atypical[0]!.includes("times the median") ? "typicality" : atypical[0]!.includes("opposite") ? "opposite" : atypical[0]!.includes("radial") ? "consistency" : "bstar";
    return { raised: true, why, manoeuvreClass };
  }
  if (gates.occasionalRaises === 1 && manoeuvreClass === "occasional") return { raised: true, why: "occasional-raised", manoeuvreClass };
  return { raised: false, why: "manoeuvre", manoeuvreClass };
}

export interface Tally {
  gates: Gates;
  /** The targets hit, by id, and the smallest first-set size among the candidates that hit one. */
  hit: string[];
  minZ1: number;
  /** The targets of the headline line that at least one candidate would have hit before the catalogue, and the targets of every line. */
  headlineHits: number;
  headlineTargets: number;
  hits: number;
  targets: number;
  /** Candidates raised that match no target on their parent: every class, and the non-payload ones. */
  falseAlarms: number;
  falseAlarmsNonPayload: number;
  raised: number;
  /** The false alarms by why they were raised, and the hits by the same. */
  falseAlarmsBy: Partial<Record<Why, number>>;
  hitsBy: Partial<Record<Why, number>>;
  /** Persistent steps the gate read as manoeuvres, and the targets lost to it (persistent on the parent, in time, but not raised). */
  manoeuvres: number;
  lostToGate: string[];
}

/** A target of a year as the sweep sees it. */
interface Target {
  id: string;
  parent: number;
  from: number;
  to: number;
  marginDays: number;
  deadline: number;
  headline: boolean;
}

function targetsOf(file: YearFile): Target[] {
  return file.score.events
    .filter((e) => e.status !== "undetectable")
    .map((e) => ({ id: e.id, parent: e.parent, from: e.from, to: e.to, marginDays: marginDaysOf(e.regime), deadline: Math.min(e.catalogueAt ?? Number.POSITIVE_INFINITY, e.noticeAt ?? Number.POSITIVE_INFINITY), headline: e.line === "breakups A-B" }));
}

/** The steps the replay's matching landed as duplicates or exempt, by object: a swept alarm on those is not a false alarm either. */
function landedOf(file: YearFile): Map<number, { beforeEpoch: number; afterEpoch: number }[]> {
  const landed = new Map<number, { beforeEpoch: number; afterEpoch: number }[]>();
  for (const alert of file.score.alerts) {
    if (alert.outcome !== "duplicate" && alert.outcome !== "exempt") continue;
    const step = file.verdicts[alert.verdict]?.step;
    if (step === null || step === undefined) continue;
    (landed.get(alert.number) ?? landed.set(alert.number, []).get(alert.number)!).push({ beforeEpoch: step.beforeEpoch, afterEpoch: step.afterEpoch });
  }
  return landed;
}

const HOUR_MS = 3_600_000;

const count = (record: Partial<Record<Why, number>>, why: Why): void => {
  record[why] = (record[why] ?? 0) + 1;
};

/** The tally of a grid point over the files. */
export function tally(files: YearFile[], gates: Gates): Tally {
  const result: Tally = { gates, hit: [], minZ1: Number.POSITIVE_INFINITY, headlineHits: 0, headlineTargets: 0, hits: 0, targets: 0, falseAlarms: 0, falseAlarmsNonPayload: 0, raised: 0, falseAlarmsBy: {}, hitsBy: {}, manoeuvres: 0, lostToGate: [] };
  for (const file of files) {
    const targets = targetsOf(file);
    const landed = landedOf(file);
    const hit = new Set<string>();
    const lost = new Set<string>();
    const raisedSteps = new Map<number, { beforeEpoch: number; afterEpoch: number }[]>();
    for (const row of file.log) {
      if (row.signals.phase !== 2) continue;
      const c = candidateOf(file.year, row);
      const when = raisedAt(c, gates);
      if (when === null) continue;
      const step = { beforeEpoch: c.beforeEpoch, afterEpoch: c.afterEpoch };
      // The instant it would have been raised: no earlier than the epoch of the post set that raised it, and the close row's run where that was the one.
      const at = when === 2 ? c.afterEpoch + c.span2 * HOUR_MS : when === 3 ? c.afterEpoch + c.span3 * HOUR_MS : c.at;
      const onParent = targets.filter((t) => t.parent === c.number && brackets({ ...step, deltaKm: 0, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 0, z: null }, t.from, t.to, t.marginDays));
      const gate = gateOf(c, gates);
      if (!gate.raised) {
        result.manoeuvres++;
        for (const t of onParent) if (at < t.deadline) lost.add(t.id);
        continue;
      }
      result.raised++;
      if (onParent.length > 0) {
        for (const t of onParent) if (at < t.deadline) {
          hit.add(t.id);
          count(result.hitsBy, gate.why);
          result.minZ1 = Math.min(result.minZ1, Math.abs(c.z1));
        }
        continue;
      }
      const earlier = raisedSteps.get(c.number) ?? [];
      if (earlier.some((s) => s.beforeEpoch <= step.afterEpoch && step.beforeEpoch <= s.afterEpoch)) continue;
      raisedSteps.set(c.number, [...earlier, step]);
      if ((landed.get(c.number) ?? []).some((s) => s.beforeEpoch <= step.afterEpoch + DAY_MS && step.beforeEpoch <= s.afterEpoch + DAY_MS)) continue;
      result.falseAlarms++;
      count(result.falseAlarmsBy, gate.why);
      if (c.bodyClass !== 0) result.falseAlarmsNonPayload++;
    }
    for (const t of targets) {
      result.targets++;
      if (t.headline) result.headlineTargets++;
      if (hit.has(t.id)) {
        result.hit.push(t.id);
        result.hits++;
        if (t.headline) result.headlineHits++;
      } else if (lost.has(t.id)) result.lostToGate.push(t.id);
    }
  }
  return result;
}

const DEFAULT_GRID: Record<keyof Gates, number[]> = {
  zPersist: [6, 8, 10, 12, 15, 20],
  rhoMin: [0.5, 0.6, 0.75],
  rhoMax: [1.5, 2, 3, Number.POSITIVE_INFINITY],
  evidenceMin: [0, 5, 10, 20, 50],
  spanHours: [6, 12, 18, 24],
  typicalityMax: [3, 5, 10, 20, 50, Number.POSITIVE_INFINITY],
  oppositeMinSteps: [1, 2, 3, Number.POSITIVE_INFINITY],
  consistencyMin: [4, 9, 25, 100, 400, Number.POSITIVE_INFINITY],
  bstarRatioMax: [2, 3, 5, 10, 20, Number.POSITIVE_INFINITY],
  newObjectDays: [0, 30, 60, 90, 180, 365],
  occasionalRaises: [0, 1],
  occasionalRaisesNonPayload: [0, 1],
  persistOnMeanStep: [0, 1],
};

/** The third phase's gates, swept by default; the earlier phases' are swept only when asked. */
const DEFAULT_AXES: (keyof Gates)[] = ["occasionalRaisesNonPayload", "persistOnMeanStep"];

/** The per-launch channel's thresholds the cloud sweep varies. */
export interface CloudGates {
  pBurst: number;
  lambdaFloor: number;
  /** The plane distance within which a piece counts, one of the logged bounds: 1, 3, 5 or 10. */
  planeDistanceMax: number;
  cloudOnlyDeltaVMinMps: number;
  /** The launch age in days under which a cloud is listed only when its velocity reaches `youngLaunchDeltaVMps` whatever the pieces' class (0 lists young launches on debris-classed pieces too, as the design first had it). */
  youngLaunchDays: number;
}

export const DETECTOR_CLOUD_GATES: CloudGates = { pBurst: DETECTOR_PARAMETERS.pBurst, lambdaFloor: DETECTOR_PARAMETERS.lambdaFloor, planeDistanceMax: DETECTOR_PARAMETERS.planeDistanceMax, cloudOnlyDeltaVMinMps: DETECTOR_PARAMETERS.cloudOnlyDeltaVMinMps, youngLaunchDays: DETECTOR_PARAMETERS.youngLaunchDays };

const CLOUD_GRID: Record<keyof CloudGates, number[]> = {
  pBurst: [1e-1, 1e-2, 1e-3, 1e-4, 1e-6, 1e-9],
  lambdaFloor: [0.1, 0.25, 0.5, 1, 2, 4],
  planeDistanceMax: [1, 3, 5, 10],
  cloudOnlyDeltaVMinMps: [0, 0.5, 1, 2, 5, 10],
  youngLaunchDays: [0, 30, 60, 90, 180],
};

/** The launch key of a cloud row's code; null for an analyst range. */
function launchOfCode(code: number): string | null {
  if (code < 1_000_000) return null;
  return `${Math.floor(code / 1000)}-${String(code % 1000).padStart(3, "0")}`;
}

export interface CloudTally {
  gates: CloudGates;
  /** The clouds that would be listed (one per launch and thirty days), the distinct reported events among them, and the listings matching none. */
  listed: number;
  hits: number;
  hitIds: string[];
  falseClouds: number;
  /** The scoreable events of the years whose launch is known, for the share hit. */
  targets: number;
}

/** How many days before a cloud's listing a reported event of the launch may lie to be the cloud's event. Policy: the truth's own rule counts pieces to ninety days. */
export const CLOUD_LOOKBACK_DAYS = 90;

/** The cloud tally of a grid point over the files: every cloud row re-thresholded. */
export function cloudTally(files: YearFile[], gates: CloudGates, truth: { launch: string; from: number; to: number; id: string; year: number }[]): CloudTally {
  const result: CloudTally = { gates, listed: 0, hits: 0, hitIds: [], falseClouds: 0, targets: 0 };
  const years = new Set(files.map((f) => f.year));
  result.targets = truth.filter((t) => years.has(t.year)).length;
  const hit = new Set<string>();
  const lastListed = new Map<string, number>();
  const inPlaneName = `inPlane${gates.planeDistanceMax}`;
  for (const file of files) {
    const rows = file.log.filter((r) => r.signals.phase === 4).sort((a, b) => a.at - b.at);
    for (const row of rows) {
      const launch = launchOfCode(row.signals.launch ?? 0);
      if (launch === null) continue;
      const n = row.signals.aboveMark ?? 0;
      const lambda = Math.max(row.signals.lambdaRate ?? 0, gates.lambdaFloor);
      if (n < DETECTOR_PARAMETERS.burstMinBodies || poissonTail(n, lambda) > gates.pBurst) continue;
      if ((row.signals[inPlaneName] ?? 0) === 0) continue;
      const deltaV = row.signals.cloudDeltaVMps;
      if (gates.cloudOnlyDeltaVMinMps > 0 && !(deltaV !== undefined && deltaV >= gates.cloudOnlyDeltaVMinMps)) continue;
      if ((row.signals.launchAgeDays ?? Number.POSITIVE_INFINITY) < gates.youngLaunchDays && !(deltaV !== undefined && deltaV >= DETECTOR_PARAMETERS.youngLaunchDeltaVMps)) continue;
      if (row.at - (lastListed.get(launch) ?? Number.NEGATIVE_INFINITY) <= DETECTOR_PARAMETERS.cloudRepeatDays * DAY_MS) continue;
      lastListed.set(launch, row.at);
      result.listed++;
      const event = truth.find((t) => t.launch === launch && t.from <= row.at + DAY_MS && t.to >= row.at - CLOUD_LOOKBACK_DAYS * DAY_MS);
      if (event === undefined) result.falseClouds++;
      else hit.add(event.id);
    }
  }
  result.hits = hit.size;
  result.hitIds = [...hit].sort();
  return result;
}

/** One confirmation as the sweep reads it: the alert row's reading and where the matcher landed the alert. */
export interface SweptConfirmation {
  year: number;
  number: number;
  at: number;
  outcome: "detection" | "late" | "near" | "false-alarm" | "other";
  event: string | null;
  pieces: number;
  deltaVMps: number;
  parentAgeDays: number;
  parentFragment: boolean;
  backgroundBodies: number;
  cloudPieces: number;
  windowBodies: number;
  daysSinceCloud: number;
  parentCloudDistance: number;
  piecesOutOfCloud: number;
  piecesNearerThanCloud: number;
}

/** The confirmation readings of the files' alert rows, each joined to the matcher's outcome for its alert. */
export function confirmationsOf(files: YearFile[]): SweptConfirmation[] {
  const landed = new Map<string, { outcome: SweptConfirmation["outcome"]; event: string | null }>();
  for (const file of files) {
    for (const alert of file.score.alerts) {
      if (alert.afterEpoch === null || alert.outcome === "confirmation") continue;
      const outcome: SweptConfirmation["outcome"] = alert.outcome === "detection" || alert.outcome === "late" ? alert.outcome : alert.outcome === "false-alarm" ? (alert.nearEvent !== null && alert.nearEvent !== undefined ? "near" : "false-alarm") : "other";
      landed.set(alertKey(alert.number, alert.afterEpoch), { outcome, event: alert.event ?? alert.nearEvent ?? null });
    }
  }
  const out: SweptConfirmation[] = [];
  for (const file of files) {
    for (const row of file.log) {
      if (row.signals.phase !== 3 || row.signals.confirmPieces === undefined || row.signals.afterEpoch === undefined) continue;
      const where = landed.get(alertKey(row.number, row.signals.afterEpoch));
      const s = (name: string): number => row.signals[name] ?? Number.NaN;
      out.push({ year: file.year, number: row.number, at: row.at, outcome: where?.outcome ?? "other", event: where?.event ?? null, pieces: s("confirmPieces"), deltaVMps: s("confirmDeltaVMps"), parentAgeDays: s("parentAgeDays"), parentFragment: s("parentFragment") === 1, backgroundBodies: s("backgroundBodies"), cloudPieces: s("cloudPieces"), windowBodies: s("windowBodies"), daysSinceCloud: s("daysSinceCloud"), parentCloudDistance: s("parentCloudDistance"), piecesOutOfCloud: s("piecesOutOfCloud"), piecesNearerThanCloud: s("piecesNearerThanCloud") });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The confirmation rules as the sweep applies them, each by its parameter; the pieces left after the rules, zero where refused. */
export function piecesKept(c: SweptConfirmation, rules: Pick<DetectorParameters, "confirmDeltaVMinMps" | "cloudMemoryDays" | "freshPieceDays" | "debrisParentNeedsNearerThanCloud" | "singlePieceNeedsQuietLaunch" | "planeDistanceMax">): number {
  let kept = c.pieces;
  if (rules.confirmDeltaVMinMps > 0 && !(c.deltaVMps >= rules.confirmDeltaVMinMps)) return 0;
  if (rules.freshPieceDays > 0 && c.parentFragment && c.parentAgeDays < rules.freshPieceDays) return 0;
  if (rules.cloudMemoryDays > 0 && c.daysSinceCloud <= rules.cloudMemoryDays && c.cloudPieces > 0) {
    if (c.parentCloudDistance <= rules.planeDistanceMax) return 0;
    kept = Math.min(kept, c.piecesOutOfCloud);
  }
  if (rules.debrisParentNeedsNearerThanCloud && c.parentFragment && c.cloudPieces > 0) kept = Math.min(kept, c.piecesNearerThanCloud);
  if (rules.singlePieceNeedsQuietLaunch && kept === 1 && (c.parentFragment || c.backgroundBodies > 0 || c.windowBodies > 1)) return 0;
  return kept;
}

const OFF = { confirmDeltaVMinMps: 0, cloudMemoryDays: 0, freshPieceDays: 0, debrisParentNeedsNearerThanCloud: false, singlePieceNeedsQuietLaunch: false, planeDistanceMax: DETECTOR_PARAMETERS.planeDistanceMax } as const;

function confirmationLine(label: string, rows: SweptConfirmation[], rules: Parameters<typeof piecesKept>[1]): string {
  const kept = rows.filter((c) => piecesKept(c, rules) > 0);
  const count = (outcome: SweptConfirmation["outcome"]): number => kept.filter((c) => c.outcome === outcome).length;
  return `| ${label} | ${kept.length} | ${count("detection") + count("late")} | ${count("near")} | ${count("false-alarm")} | ${count("other")} |`;
}

function parseArgs(args: string[]): { years: number[] | null; show: boolean; grid: Partial<Record<keyof Gates, number[]>>; clouds: boolean; cloudGrid: Partial<Record<keyof CloudGates, number[]>>; tiers: boolean; confirmations: boolean } {
  let years: number[] | null = null;
  let show = false;
  let clouds = false;
  let tiers = false;
  let confirmations = false;
  const grid: Partial<Record<keyof Gates, number[]>> = {};
  const cloudGrid: Partial<Record<keyof CloudGates, number[]>> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--years") years = args[++i]!.split(",").map(Number);
    else if (arg === "--show") show = true;
    else if (arg === "--clouds") clouds = true;
    else if (arg === "--tiers") tiers = true;
    else if (arg === "--confirmations") confirmations = true;
    else if (arg.startsWith("--") && arg.slice(2) in CLOUD_GRID) cloudGrid[arg.slice(2) as keyof CloudGates] = args[++i]!.split(",").map(Number);
    else if (arg.startsWith("--") && arg.slice(2) in DEFAULT_GRID) grid[arg.slice(2) as keyof Gates] = args[++i]!.split(",").map(Number);
    else throw new Error(`usage: sweep.ts [--years 2006,2008] [--show] [--clouds] [--tiers] [--confirmations] [--<gate> v1,v2,...] where a gate is one of ${Object.keys(DEFAULT_GRID).join(", ")}, ${Object.keys(CLOUD_GRID).join(", ")}`);
  }
  return { years, show, grid, clouds, cloudGrid, tiers, confirmations };
}

const WHYS: Why[] = ["unique", "typicality", "opposite", "consistency", "bstar", "occasional-raised"];

function line(axis: keyof Gates, value: number, t: Tally): string {
  const by = (record: Partial<Record<Why, number>>): string => WHYS.map((why) => `${why} ${record[why] ?? 0}`).join(", ");
  return `| ${axis} | ${value} | ${t.headlineHits} of ${t.headlineTargets} | ${t.hits} of ${t.targets} | ${t.falseAlarms} | ${t.falseAlarmsNonPayload} | ${t.manoeuvres} | ${t.lostToGate.length} | ${by(t.falseAlarmsBy)} | ${by(t.hitsBy)} |`;
}

function main(): void {
  const { years, show, grid, clouds, cloudGrid, tiers, confirmations } = parseArgs(process.argv.slice(2));
  const all = readYearFiles(process.env.KPI_DIR === undefined ? KPI_DIR : resolve(process.env.KPI_DIR));
  const files = all.filter((f) => (years === null ? f.year % 2 === 0 : years.includes(f.year)));
  if (files.length === 0) throw new Error(`no year files under ${yearsDir(KPI_DIR)} for the years asked`);
  if (tiers) {
    console.log(tiersTable(cellsOf(files, alertRowsOf(all)), `Precision per persistence tier, years ${files.map((f) => f.year).join(", ")}`));
    return;
  }
  if (confirmations) {
    const rows = confirmationsOf(files);
    const p = DETECTOR_PARAMETERS;
    console.log(`years ${files.map((f) => f.year).join(", ")}: ${rows.length} confirmation readings on the alert rows`);
    console.log("| rule | kept | on a reported event's step | on the right object, the step late | on nothing | exempt or duplicate |");
    console.log("| --- | --- | --- | --- | --- | --- |");
    console.log(confirmationLine("as the third phase confirmed (the rules off)", rows, OFF));
    for (const v of [0.5, 1, 2]) console.log(confirmationLine(`the pieces move at least ${v} m/s (confirmDeltaVMinMps)`, rows, { ...OFF, confirmDeltaVMinMps: v }));
    for (const d of [30, 90, 180]) console.log(confirmationLine(`a debris-classed parent first seen under ${d} days before its step confirms nothing (freshPieceDays)`, rows, { ...OFF, freshPieceDays: d }));
    for (const d of [180, 365, 730]) console.log(confirmationLine(`a launch with a cloud in the last ${d} days: pieces out of its plane, the parent not in it (cloudMemoryDays)`, rows, { ...OFF, cloudMemoryDays: d }));
    console.log(confirmationLine("a debris-classed parent under an active cloud: pieces nearer than the cloud (debrisParentNeedsNearerThanCloud)", rows, { ...OFF, debrisParentNeedsNearerThanCloud: true }));
    console.log(confirmationLine("a single piece: the parent not debris, the launch quiet (singlePieceNeedsQuietLaunch)", rows, { ...OFF, singlePieceNeedsQuietLaunch: true }));
    console.log(confirmationLine("every rule at the detector's values", rows, p));
    if (show) {
      console.log("");
      console.log("| year | object | alert landed | event | pieces | m/s | parent age d | debris parent | background | cloud bodies | window | days since cloud | parent to cloud | out of cloud | nearer than cloud | kept at the detector's values |");
      console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
      const f = (v: number): string => (Number.isFinite(v) ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : "–");
      for (const c of rows) console.log(`| ${c.year} | ${c.number} | ${c.outcome} | ${c.event ?? "–"} | ${c.pieces} | ${f(c.deltaVMps)} | ${f(c.parentAgeDays)} | ${c.parentFragment ? "yes" : "no"} | ${c.backgroundBodies} | ${c.cloudPieces} | ${c.windowBodies} | ${f(c.daysSinceCloud)} | ${f(c.parentCloudDistance)} | ${c.piecesOutOfCloud} | ${c.piecesNearerThanCloud} | ${piecesKept(c, p)} |`);
    }
    return;
  }
  if (clouds) {
    const truth = readTruth().breakups.filter((b) => b.scoreable && b.kind !== "aerodynamic" && b.kind !== "release").flatMap((b) => {
      const launch = launchOf(b.parent.designator);
      return launch === null ? [] : [{ launch, from: Date.parse(b.event.from ?? b.event.to), to: Date.parse(b.event.to), id: b.id, year: yearOf(b) }];
    });
    const cloudAxes = (Object.keys(cloudGrid) as (keyof CloudGates)[]).length > 0 ? (Object.keys(cloudGrid) as (keyof CloudGates)[]) : (Object.keys(CLOUD_GRID) as (keyof CloudGates)[]);
    console.log(`years ${files.map((f) => f.year).join(", ")}; the detector's cloud gates: ${Object.entries(DETECTOR_CLOUD_GATES).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    console.log("| gate | value | clouds listed | reported events hit | of targets with a launch | false clouds |");
    console.log("| --- | --- | --- | --- | --- | --- |");
    for (const axis of cloudAxes) {
      for (const value of cloudGrid[axis] ?? CLOUD_GRID[axis]) {
        const t = cloudTally(files, { ...DETECTOR_CLOUD_GATES, [axis]: value }, truth);
        console.log(`| ${axis} | ${value} | ${t.listed} | ${t.hits} | ${t.targets} | ${t.falseClouds} |`);
        if (show) console.log(`  hit: ${t.hitIds.join(", ")}`);
      }
    }
    return;
  }
  const axes = (Object.keys(grid) as (keyof Gates)[]).length > 0 ? (Object.keys(grid) as (keyof Gates)[]) : DEFAULT_AXES;
  console.log(`years ${files.map((f) => f.year).join(", ")}; the detector's gates: ${Object.entries(DETECTOR_GATES).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log("| gate | value | headline hits | hits | false alarms | non-payload | manoeuvres | lost to the gate | false alarms by why | hits by why |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  // One axis at a time, the others at the detector's values: the grid over every axis at once is too large to read.
  for (const axis of axes) {
    for (const value of grid[axis] ?? DEFAULT_GRID[axis]) {
      const t = tally(files, { ...DETECTOR_GATES, [axis]: value });
      console.log(line(axis, value, t));
      if (show) console.log(`  hit: ${t.hit.join(", ")}; lost to the gate: ${t.lostToGate.join(", ") || "none"}; the smallest first-set size among the hits ${t.minZ1.toFixed(1)} sigma`);
    }
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("sweep.ts")) main();
