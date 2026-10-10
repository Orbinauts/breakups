import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BODY_CLASSES, DETECTOR_PARAMETERS, EXPLANATION_BITS, MANOEUVRE_CLASSES, OPS_STATUSES, OUTCOMES, REGIMES, SIGNATURE_BITS, atypicalTests, classify, judgeStep, launchOf, poissonTail, yearOf, type CurrentStep, type DetectorParameters, type HistoryFeatures, type LogRow, type ManoeuvreClass, type StepEvidence, type StepJudgement } from "../../src/index.ts";
import { brackets, marginDaysOf } from "./match.ts";
import { readTruth, readYearFiles, yearsDir } from "./run.ts";
import { DAY_MS } from "./replay.ts";
import { alertKey, alertRowsOf, cellsOf, tiersTable, type YearFile } from "./kpi.ts";
import { RULES_OFF, detailLines, originDetail, originGrid, originSeparation, rulesOf, sweepLines, type AttributionRules } from "./attributions.ts";
import { catalogueOf } from "./run.ts";
import { archiveHome } from "../archive/archive.ts";

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
 * The sixth phase's discriminators are swept the same way: every close
 * row carries the envelope, siblings, mates and status readings, and the
 * fusion's decision (`judgeStep`) is re-applied from them with the gate
 * values asked, so each explanation and signature is re-thresholded
 * exactly. The tally also says how many persistent steps each explanation
 * silenced. `--separation` prints, for the signals the fusion cannot use
 * at the raising (the drag term's ratio across the step, the damage ratio
 * and the tracking cadence after it), their quartiles on the detections
 * against the false alarms.
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
 *
 * `--attributions` sweeps the Confirmed channel of the ninth phase over
 * the attribution rows (`attributions.ts`): each rule of the confirmation
 * and of the attribution varied in turn from the detector's values, the
 * confirmed verdicts it would raise landed against the truth as the
 * matcher lands them, and the Confirmed line scored on the years given
 * (the even years by default); `--set name=value` changes the base, and
 * `--show` lists the misses with what refused their pieces and every
 * false confirmation.
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
  /** The sixth phase's gates, as the parameters of the same names (the booleans as 0 or 1). */
  maintenanceToleranceSigmas: number;
  maintenanceToleranceKm: number;
  maintenanceLoweringsToo: number;
  siblingsMin: number;
  deployAgeDays: number;
  opsStatusEvidence: number;
  nonoperationalOverrides: number;
  againstDragMinRaises: number;
  geometryKickMinMps: number;
  independentOutweighs: number;
  explanationsForNonPayloads: number;
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
  maintenanceToleranceSigmas: DETECTOR_PARAMETERS.maintenanceToleranceSigmas,
  maintenanceToleranceKm: DETECTOR_PARAMETERS.maintenanceToleranceKm,
  maintenanceLoweringsToo: DETECTOR_PARAMETERS.maintenanceLoweringsToo ? 1 : 0,
  siblingsMin: DETECTOR_PARAMETERS.siblingsMin,
  deployAgeDays: DETECTOR_PARAMETERS.deployAgeDays,
  opsStatusEvidence: DETECTOR_PARAMETERS.opsStatusEvidence ? 1 : 0,
  nonoperationalOverrides: DETECTOR_PARAMETERS.nonoperationalOverrides ? 1 : 0,
  againstDragMinRaises: DETECTOR_PARAMETERS.againstDragMinRaises,
  geometryKickMinMps: DETECTOR_PARAMETERS.geometryKickMinMps,
  independentOutweighs: DETECTOR_PARAMETERS.independentOutweighs,
  explanationsForNonPayloads: DETECTOR_PARAMETERS.explanationsForNonPayloads ? 1 : 0,
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
  pastRaises: number;
  /** The sixth phase's readings, as logged. */
  deltaVRadialMps: number;
  sigmaOwn: number;
  envelopeTopKm: number;
  envelopeBottomKm: number;
  envelopeMonths: number;
  siblingsLaunch: number;
  siblingsOrbit: number;
  mates: number;
  matesMedianAKm: number;
  towardsMates: number;
  opsStatus: number;
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
    pastRaises: signal(row, "pastRaises"),
    deltaVRadialMps: signal(row, "deltaVRadialMps"),
    sigmaOwn: signal(row, "sigmaOwn"),
    envelopeTopKm: signal(row, "envelopeTopKm"),
    envelopeBottomKm: signal(row, "envelopeBottomKm"),
    envelopeMonths: row.signals.envelopeMonths ?? 0,
    siblingsLaunch: row.signals.siblingsLaunch ?? 0,
    siblingsOrbit: row.signals.siblingsOrbit ?? 0,
    mates: row.signals.mates ?? 0,
    matesMedianAKm: signal(row, "matesMedianAKm"),
    towardsMates: row.signals.towardsMates ?? 0,
    opsStatus: row.signals.opsStatus ?? OPS_STATUSES.indexOf("unknown"),
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

/** Why a persistent step was raised, or that it was not: `unique` where no manoeuvre explanation applied, else the first breakup signature that overrode the explanations (the size, the direction, the geometry, the drag term, the move against drag, the nonoperational status), `occasional-raised` for the non-payload rule, `manoeuvre` where it was not raised. */
export type Why = ManoeuvreClass | "typicality" | "opposite" | "consistency" | "bstar" | "against-drag" | "nonoperational" | "occasional-raised" | "manoeuvre";

/** The explanations a step may be silenced by, as the fusion names them. */
export type Explanation = keyof typeof EXPLANATION_BITS;
export const EXPLANATIONS = Object.keys(EXPLANATION_BITS) as Explanation[];

/** The parameters a sweep's gates stand for. */
export function paramsOf(gates: Gates): DetectorParameters {
  return { ...DETECTOR_PARAMETERS, typicalityMax: gates.typicalityMax, oppositeMinSteps: gates.oppositeMinSteps, consistencyMin: gates.consistencyMin, bstarRatioMax: gates.bstarRatioMax, newObjectDays: gates.newObjectDays, occasionalRaisesNonPayload: gates.occasionalRaisesNonPayload === 1, maintenanceToleranceSigmas: gates.maintenanceToleranceSigmas, maintenanceToleranceKm: gates.maintenanceToleranceKm, maintenanceLoweringsToo: gates.maintenanceLoweringsToo === 1, siblingsMin: gates.siblingsMin, deployAgeDays: gates.deployAgeDays, opsStatusEvidence: gates.opsStatusEvidence === 1, nonoperationalOverrides: gates.nonoperationalOverrides === 1, againstDragMinRaises: gates.againstDragMinRaises, geometryKickMinMps: gates.geometryKickMinMps, independentOutweighs: gates.independentOutweighs, explanationsForNonPayloads: gates.explanationsForNonPayloads === 1 };
}

/** The fusion on a persistent candidate, with the gates' values: whether it is raised, why, its class, and the judgement with its explanations and signatures. */
export function gateOf(c: SweptCandidate, gates: Gates): { raised: boolean; why: Why; manoeuvreClass: ManoeuvreClass; judgement: StepJudgement } {
  const params = paramsOf(gates);
  const features: HistoryFeatures = { ageDays: c.ageDays, n365: c.n365, n730: c.n730, daysSinceStep: c.daysSinceStep, regularity: c.regularity, typicality: c.typicality, sameSignShare: c.sameSignShare, alternation: c.alternation, normalShare: c.normalShare, disposalLike: c.disposalLike === 1, young: c.ageDays < gates.newObjectDays, pastRaises: c.pastRaises };
  const step: CurrentStep = { epochMs: c.afterEpoch, deltaKm: c.deltaKm, deltaPerigeeKm: c.deltaPerigeeKm, tangentialMps: c.deltaVMps, normalMps: c.deltaVNormalMps, consistency: c.impulseConsistency, bstarRatio: c.bstarRatio, regime: REGIMES[c.regime] ?? "unknown", bodyClass: BODY_CLASSES[c.bodyClass] ?? "unknown", apogeeHeightAfterKm: 0 };
  const manoeuvreClass = classify(features, step, params);
  const evidence: StepEvidence = { manoeuvreClass, tests: atypicalTests(features, step, params), bodyClass: step.bodyClass, opsStatus: OPS_STATUSES[c.opsStatus] ?? "unknown", deltaKm: c.deltaKm, radialMps: c.deltaVRadialMps, n730: c.n730, pastRaises: c.pastRaises, disposalLike: features.disposalLike, ageDays: c.ageDays, sigmaOwnKm: c.sigmaOwn, held: { topKm: c.envelopeTopKm, bottomKm: c.envelopeBottomKm, months: c.envelopeMonths, topMonthsAgo: Number.NaN, bottomMonthsAgo: Number.NaN }, siblings: { launch: c.siblingsLaunch, orbit: c.siblingsOrbit }, mates: { count: c.mates, medianAKm: c.matesMedianAKm }, towardsMates: c.towardsMates === 1 };
  const judgement = judgeStep(evidence, params);
  if (judgement.raised) {
    const bits = judgement.signatureBits;
    const why: Why = judgement.explanations.length === 0 ? "unique" : judgement.signatures.length === 0 ? "occasional-raised" : bits & SIGNATURE_BITS.size ? "typicality" : bits & SIGNATURE_BITS.direction ? "opposite" : bits & SIGNATURE_BITS.geometry ? "consistency" : bits & SIGNATURE_BITS.dragTerm ? "bstar" : bits & SIGNATURE_BITS.againstDrag ? "against-drag" : "nonoperational";
    return { raised: true, why, manoeuvreClass, judgement };
  }
  if (gates.occasionalRaises === 1 && manoeuvreClass === "occasional") return { raised: true, why: "occasional-raised", manoeuvreClass, judgement };
  return { raised: false, why: "manoeuvre", manoeuvreClass, judgement };
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
  /** Persistent steps the gate read as manoeuvres, and the targets lost to it (persistent on the parent, in time, but not raised), each with the explanations that silenced it. */
  manoeuvres: number;
  lostToGate: string[];
  lostBy: Record<string, string>;
  /** Of the steps read as manoeuvres that matched no target, how many each explanation applied to (a step may count under several). */
  silencedBy: Partial<Record<Explanation, number>>;
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
  const result: Tally = { gates, hit: [], minZ1: Number.POSITIVE_INFINITY, headlineHits: 0, headlineTargets: 0, hits: 0, targets: 0, falseAlarms: 0, falseAlarmsNonPayload: 0, raised: 0, falseAlarmsBy: {}, hitsBy: {}, manoeuvres: 0, lostToGate: [], lostBy: {}, silencedBy: {} };
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
        const by = EXPLANATIONS.filter((name) => (gate.judgement.explanationBits & EXPLANATION_BITS[name]) !== 0);
        for (const t of onParent) if (at < t.deadline) {
          lost.add(t.id);
          result.lostBy[t.id] = by.join("+");
        }
        if (onParent.length === 0) for (const name of by) result.silencedBy[name] = (result.silencedBy[name] ?? 0) + 1;
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
  maintenanceToleranceSigmas: [0, 1, 2, 3, 5, 10],
  maintenanceToleranceKm: [-1, 0, 0.25, 0.5, 1, 2, 5],
  maintenanceLoweringsToo: [0, 1],
  siblingsMin: [1, 2, 3, 5, Number.POSITIVE_INFINITY],
  deployAgeDays: [0, 30, 90, 180, 365],
  opsStatusEvidence: [0, 1],
  nonoperationalOverrides: [0, 1],
  againstDragMinRaises: [0, 1, 2, Number.POSITIVE_INFINITY],
  geometryKickMinMps: [0, 0.5, 1, 2, 5, Number.POSITIVE_INFINITY],
  independentOutweighs: [1, 2, 3, Number.POSITIVE_INFINITY],
  explanationsForNonPayloads: [0, 1],
};

/** The sixth phase's gates, swept by default; the earlier phases' are swept only when asked. */
const DEFAULT_AXES: (keyof Gates)[] = ["maintenanceToleranceSigmas", "maintenanceToleranceKm", "maintenanceLoweringsToo", "siblingsMin", "deployAgeDays", "opsStatusEvidence", "nonoperationalOverrides", "againstDragMinRaises", "geometryKickMinMps", "independentOutweighs", "explanationsForNonPayloads"];

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

function parseArgs(args: string[]): { years: number[] | null; show: boolean; grid: Partial<Record<keyof Gates, number[]>>; clouds: boolean; cloudGrid: Partial<Record<keyof CloudGates, number[]>>; tiers: boolean; confirmations: boolean; separation: boolean; attributions: boolean; origin: boolean; twins: boolean; relax: boolean; set: Partial<AttributionRules>; ruleGrid: Partial<Record<keyof AttributionRules, AttributionRules[keyof AttributionRules][]>> } {
  let years: number[] | null = null;
  let show = false;
  let clouds = false;
  let tiers = false;
  let confirmations = false;
  let separation = false;
  let attributions = false;
  let origin = false;
  let twins = false;
  let relax = false;
  const set: Partial<AttributionRules> = {};
  const ruleGrid: Partial<Record<keyof AttributionRules, AttributionRules[keyof AttributionRules][]>> = {};
  const grid: Partial<Record<keyof Gates, number[]>> = {};
  const cloudGrid: Partial<Record<keyof CloudGates, number[]>> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--years") years = args[++i]!.split(",").map(Number);
    else if (arg === "--show") show = true;
    else if (arg === "--clouds") clouds = true;
    else if (arg === "--tiers") tiers = true;
    else if (arg === "--confirmations") confirmations = true;
    else if (arg === "--separation") separation = true;
    else if (arg === "--attributions") attributions = true;
    else if (arg === "--origin") [attributions, origin] = [true, true];
    else if (arg === "--twins") twins = true;
    else if (arg === "--relax") relax = true;
    else if (arg === "--detail" || arg === "--twins-grid") continue;
    else if (arg === "--set") {
      const [name, value] = args[++i]!.split("=");
      (set as Record<string, unknown>)[name!] = JSON.parse(value!) as unknown;
    } else if (arg === "--grid") {
      // An axis of the attribution rules: --grid name=v1,v2 (each value read as JSON), with --origin.
      const [name, values] = args[++i]!.split("=");
      (ruleGrid as Record<string, unknown>)[name!] = values!.split(",").map((value) => JSON.parse(value) as unknown);
    }
    else if (arg.startsWith("--") && arg.slice(2) in CLOUD_GRID) cloudGrid[arg.slice(2) as keyof CloudGates] = args[++i]!.split(",").map(Number);
    else if (arg.startsWith("--") && arg.slice(2) in DEFAULT_GRID) grid[arg.slice(2) as keyof Gates] = args[++i]!.split(",").map(Number);
    else throw new Error(`usage: sweep.ts [--years 2006,2008] [--show] [--clouds] [--tiers] [--confirmations] [--separation] [--<gate> v1,v2,...] where a gate is one of ${Object.keys(DEFAULT_GRID).join(", ")}, ${Object.keys(CLOUD_GRID).join(", ")}`);
  }
  return { years, show, grid, clouds, cloudGrid, tiers, confirmations, separation, attributions, origin, twins, relax, set, ruleGrid };
}

const WHYS: Why[] = ["unique", "typicality", "opposite", "consistency", "bstar", "against-drag", "nonoperational", "occasional-raised"];

function line(axis: keyof Gates, value: number, t: Tally): string {
  const by = (record: Partial<Record<Why, number>>): string => WHYS.filter((why) => (record[why] ?? 0) > 0).map((why) => `${why} ${record[why]}`).join(", ") || "none";
  const silenced = EXPLANATIONS.filter((name) => (t.silencedBy[name] ?? 0) > 0).map((name) => `${name} ${t.silencedBy[name]}`).join(", ") || "none";
  return `| ${axis} | ${value} | ${t.headlineHits} of ${t.headlineTargets} | ${t.hits} of ${t.targets} | ${t.falseAlarms} | ${t.falseAlarmsNonPayload} | ${t.manoeuvres} | ${t.lostToGate.length} | ${by(t.falseAlarmsBy)} | ${by(t.hitsBy)} | ${silenced} |`;
}

/** The quartiles of a signal over a set of rows, for the separation table. */
function quartiles(values: number[]): string {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return "none";
  const at = (p: number): number => finite[Math.min(finite.length - 1, Math.max(0, Math.ceil(p * finite.length) - 1))]!;
  return `${finite.length}: ${at(0.25).toFixed(2)} / ${at(0.5).toFixed(2)} / ${at(0.75).toFixed(2)}`;
}

/**
 * The separation of the signals the fusion cannot use at the raising:
 * the drag term's ratio across the step (on the close rows), the damage
 * ratio and the cadence ratio (on the alert rows), each as its quartiles
 * on the detections and late alerts against the false alarms, and the
 * share of the false alarms above the detections' median.
 */
function separationTable(files: YearFile[]): string[] {
  const landed = new Map<string, "true" | "false">();
  for (const file of files) for (const alert of file.score.alerts) {
    if (alert.afterEpoch === null) continue;
    if (alert.outcome === "detection" || alert.outcome === "late") landed.set(alertKey(alert.number, alert.afterEpoch), "true");
    else if (alert.outcome === "false-alarm") landed.set(alertKey(alert.number, alert.afterEpoch), "false");
  }
  const signals: { name: string; phase: number; fold?: (v: number) => number }[] = [
    { name: "bstarRatio", phase: 2, fold: (v) => (v > 0 && v < 1 ? 1 / v : v) },
    { name: "damageRatio", phase: 3 },
    { name: "cadenceRatio", phase: 3 },
    { name: "envelopeMissKm", phase: 2 },
    { name: "siblingsLaunch", phase: 2 },
  ];
  const out = ["| signal | detections and late (n: quartiles) | false alarms (n: quartiles) | false alarms above the detections' median |", "| --- | --- | --- | --- |"];
  for (const { name, phase, fold } of signals) {
    const yes: number[] = [];
    const no: number[] = [];
    for (const file of files) for (const row of file.log) {
      if (row.signals.phase !== phase || row.signals.afterEpoch === undefined) continue;
      const where = landed.get(alertKey(row.number, row.signals.afterEpoch));
      if (where === undefined) continue;
      const raw = row.signals[name];
      const value = raw === undefined ? Number.NaN : fold === undefined ? raw : fold(raw);
      (where === "true" ? yes : no).push(value);
    }
    const finiteYes = yes.filter(Number.isFinite).sort((a, b) => a - b);
    const median = finiteYes.length === 0 ? Number.NaN : finiteYes[Math.ceil(finiteYes.length / 2) - 1]!;
    const finiteNo = no.filter(Number.isFinite);
    const above = finiteNo.length === 0 || !Number.isFinite(median) ? "–" : `${Math.round((100 * finiteNo.filter((v) => v > median).length) / finiteNo.length)}%`;
    out.push(`| ${name} | ${quartiles(yes)} | ${quartiles(no)} | ${above} |`);
  }
  return out;
}

function main(): void {
  const { years, show, grid, clouds, cloudGrid, tiers, confirmations, separation, attributions, origin, twins, relax, set, ruleGrid } = parseArgs(process.argv.slice(2));
  const all = readYearFiles(process.env.KPI_DIR === undefined ? KPI_DIR : resolve(process.env.KPI_DIR));
  const files = all.filter((f) => (years === null ? f.year % 2 === 0 : years.includes(f.year)));
  if (files.length === 0) throw new Error(`no year files under ${yearsDir(KPI_DIR)} for the years asked`);
  if (attributions) {
    // Every year is simulated, an event's confirmation may come in the next year's file; the split read is the training one unless the odd years were asked.
    const truth = readTruth();
    const catalogue = catalogueOf(archiveHome(), truth);
    const base = { ...rulesOf(DETECTOR_PARAMETERS), ...set };
    const split = years !== null && years.every((y) => y % 2 === 1) ? "validation" : "train";
    if (origin) {
      // The common-origin sweep of the tenth phase: the rule's axes with the ninth phase's rules as they are, then each of those relaxed, every point scored with the twins read both ways; the points under one false confirmation in ten, the most confirmations first, and the frontier.
      const off = (name: keyof AttributionRules): AttributionRules[keyof AttributionRules] => RULES_OFF[name];
      // With --twins-grid, the twins' two switches against the origin's override and launch margin.
      const twinsGrid: Partial<Record<keyof AttributionRules, AttributionRules[keyof AttributionRules][]>> = { attributionTwins: [false, true], attributionTwinsUnresolved: [false, true], originOverrideHours: [1e9, 1], originLaunchMarginDays: [-1e9, 0] };
      // With --grid, the axes given (the eleventh phase's rules) instead of the common origin's.
      const axes: Partial<Record<keyof AttributionRules, AttributionRules[keyof AttributionRules][]>> = Object.keys(ruleGrid).length > 0 ? ruleGrid : process.argv.includes("--twins-grid") ? twinsGrid : {
        originOverrideHours: [1e9, 1, 6, 24],
        originLaunchMarginDays: [-1e9, 0, 30],
        originStepHoursMax: [1e9, 48],
        originHoursBase: [1e9, 24],
        originHoursPerDay: [0, 1],
        originShareMin: [0.75],
        originMinPieces: [3],
        // With --relax, each of the ninth phase's rules the test might replace is tried off too.
        ...(relax ? { cloudMemoryDays: [base.cloudMemoryDays, off("cloudMemoryDays")], attributionBatchLaunchesMax: [base.attributionBatchLaunchesMax, off("attributionBatchLaunchesMax")], confirmBackgroundMax: [base.confirmBackgroundMax, off("confirmBackgroundMax")], youngLaunchDays: [base.youngLaunchDays, off("youngLaunchDays")], attributionMinPieces: [base.attributionMinPieces, 1], singlePieceNeedsQuietLaunch: [base.singlePieceNeedsQuietLaunch, false] } : {}),
      };
      // With --detail, the grid is skipped and only the readings and the detail at the base are printed.
      const points = process.argv.includes("--detail") ? [] : originGrid(all, truth, catalogue, base, axes, split);
      const rate = (x: number | null): string => (x === null ? "–" : `${Math.round(x * 100)}%`);
      const row = (p: (typeof points)[number]): string => `| ${p.label} | ${p.score.targets} | ${p.score.detected} | ${rate(p.score.recall)} | ${p.score.falseAlarms} | ${rate(p.score.falseAlarmRate)} | ${p.twins.detected} | ${p.twins.falseAlarms} | ${rate(p.twins.falseAlarmRate)} |`;
      console.log(`the ${split} years; ${points.length} points; the base: ${Object.entries(base).map(([k, x]) => `${k} ${JSON.stringify(x)}`).join(", ")}`);
      const header = ["| rules | targets | confirmed | recall | false | false-alarm rate | twins at the launch: confirmed | false | rate |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"].join("\n");
      const pick = (p: (typeof points)[number]) => (twins ? p.twins : p.score);
      console.log(`\n### Under one false confirmation in ten${twins ? ", twins at the launch" : ""}, the most confirmations first\n\n${header}`);
      for (const p of points.filter((p) => (pick(p).falseAlarmRate ?? 1) < 0.1).sort((a, b) => pick(b).detected - pick(a).detected || pick(a).falseAlarms - pick(b).falseAlarms).slice(0, 25)) console.log(row(p));
      console.log(`\n### The frontier: the most confirmations at each count of false ones\n\n${header}`);
      const best = new Map<number, (typeof points)[number]>();
      for (const p of points) {
        const known = best.get(pick(p).falseAlarms);
        if (known === undefined || pick(p).detected > pick(known).detected) best.set(pick(p).falseAlarms, p);
      }
      let most = -1;
      for (const [, p] of [...best].sort((a, b) => a[0] - b[0])) if (pick(p).detected > most) [most] = [pick(p).detected, console.log(row(p))];
      console.log(`\n### The test alone, the ninth phase's rules as they are\n\n${header}`);
      for (const p of points.filter((p) => p.rules.cloudMemoryDays === base.cloudMemoryDays && p.rules.attributionBatchLaunchesMax === base.attributionBatchLaunchesMax && p.rules.confirmBackgroundMax === base.confirmBackgroundMax && p.rules.youngLaunchDays === base.youngLaunchDays && p.rules.attributionMinPieces === base.attributionMinPieces && p.rules.originOverrideHours >= 1e8 && p.rules.singlePieceNeedsQuietLaunch === base.singlePieceNeedsQuietLaunch)) console.log(row(p));
      console.log(`\n### Every point\n\n${header}`);
      for (const p of points) console.log(row(p));
      if (show) {
        console.log("\n### The readings of the confirmations the base raises\n");
        for (const line of originSeparation(all, truth, catalogue, base, split)) console.log(line);
        console.log("\n### The misses and the false confirmations at the base\n");
        for (const line of originDetail(all, truth, catalogue, base, split, twins)) console.log(line);
      }
      return;
    }
    const grid: [string, Partial<AttributionRules>][] = [
      ...[0, 0.5, 2, 5].map((x): [string, Partial<AttributionRules>] => [`the pieces move at least ${x} m/s (confirmDeltaVMinMps)`, { confirmDeltaVMinMps: x }]),
      ...[0, 30, 180].map((x): [string, Partial<AttributionRules>] => [`a debris parent first seen under ${x} days confirms nothing (freshPieceDays)`, { freshPieceDays: x }]),
      ...[0, 90, 180, 730].map((x): [string, Partial<AttributionRules>] => [`the cloud memory, ${x} days (cloudMemoryDays)`, { cloudMemoryDays: x }]),
      [`a debris parent's pieces nearer than the cloud (debrisParentNeedsNearerThanCloud) ${!base.debrisParentNeedsNearerThanCloud}`, { debrisParentNeedsNearerThanCloud: !base.debrisParentNeedsNearerThanCloud }],
      [`a single piece needs a quiet launch (singlePieceNeedsQuietLaunch) ${!base.singlePieceNeedsQuietLaunch}`, { singlePieceNeedsQuietLaunch: !base.singlePieceNeedsQuietLaunch }],
      ...[0.5, 5, 20, 1e9].map((x): [string, Partial<AttributionRules>] => [`the launch's background at most ${x} a window (confirmBackgroundMax)`, { confirmBackgroundMax: x }]),
      [`a step on one body breaks a tie (attributionStepBreaksTies) ${!base.attributionStepBreaksTies}`, { attributionStepBreaksTies: !base.attributionStepBreaksTies }],
      [`a young launch attributes (attributionYoungLaunch) ${!base.attributionYoungLaunch}`, { attributionYoungLaunch: !base.attributionYoungLaunch }],
      ...[0, 7, 90].map((x): [string, Partial<AttributionRules>] => [`a launch is young under ${x} days (youngLaunchDays)`, { youngLaunchDays: x }]),
      ...[1, 2, 3, 5].map((x): [string, Partial<AttributionRules>] => [`at least ${x} pieces (attributionMinPieces)`, { attributionMinPieces: x }]),
      ...[1, 2, 3, 5, 10, 1e9].map((x): [string, Partial<AttributionRules>] => [`at most ${x} old launches gaining bodies in the run (attributionBatchLaunchesMax)`, { attributionBatchLaunchesMax: x }]),
      ...[20, 50, 100, 300, 1000, 1e9].map((x): [string, Partial<AttributionRules>] => [`the pieces miss the parent by at most ${x} km (attributionMissKmMax)`, { attributionMissKmMax: x }]),
      ...[0, 1.5, 3, 10].map((x): [string, Partial<AttributionRules>] => [`a rival must be missed ${x} times worse (attributionAmbiguityRatio)`, { attributionAmbiguityRatio: x }]),
      ...[0, 1.5, 3, 10, 1e9].map((x): [string, Partial<AttributionRules>] => [`a rival's centre must be ${x} times further (attributionCentreRatio)`, { attributionCentreRatio: x }]),
      [`an analyst range confirms an alert (analystAttributes) ${!base.analystAttributes}`, { analystAttributes: !base.analystAttributes }],
      [`debris parents tried (attributionDebrisParentsMax) ${base.attributionDebrisParentsMax > 0 ? 0 : DETECTOR_PARAMETERS.attributionDebrisParentsMax}`, { attributionDebrisParentsMax: base.attributionDebrisParentsMax > 0 ? 0 : DETECTOR_PARAMETERS.attributionDebrisParentsMax }],
    ];
    console.log(`the ${split} years of ${files[0] === undefined ? "" : process.env.KPI_DIR ?? KPI_DIR}; the base: ${Object.entries(base).map(([k, x]) => `${k} ${x}`).join(", ")}`);
    for (const line of sweepLines(all, truth, catalogue, base, grid, split)) console.log(line);
    if (show) for (const line of detailLines(all, truth, catalogue, base, split)) console.log(line);
    return;
  }
  if (tiers) {
    console.log(tiersTable(cellsOf(files, alertRowsOf(all)), `Precision per persistence tier, years ${files.map((f) => f.year).join(", ")}`));
    return;
  }
  if (separation) {
    console.log(`years ${files.map((f) => f.year).join(", ")}: the signals the fusion cannot use at the raising`);
    for (const row of separationTable(files)) console.log(row);
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
  console.log("| gate | value | headline hits | hits | false alarms | non-payload | manoeuvres | lost to the gate | false alarms by why | hits by why | silenced by |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  // One axis at a time, the others at the detector's values: the grid over every axis at once is too large to read.
  for (const axis of axes) {
    for (const value of grid[axis] ?? DEFAULT_GRID[axis]) {
      const t = tally(files, { ...DETECTOR_GATES, [axis]: value });
      console.log(line(axis, value, t));
      if (show) console.log(`  hit: ${t.hit.join(", ")}; lost to the gate: ${t.lostToGate.map((id) => `${id} (${t.lostBy[id]})`).join(", ") || "none"}; the smallest first-set size among the hits ${t.minZ1.toFixed(1)} sigma`);
    }
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("sweep.ts")) main();
