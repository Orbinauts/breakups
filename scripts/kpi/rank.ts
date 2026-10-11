import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { BODY_CLASSES, OPS_STATUSES, REGIMES } from "../../src/index.ts";
import { SCORED_FROM_YEAR, percentile, wilson, type YearFile } from "./kpi.ts";
import type { Line } from "./match.ts";
import { DAY_MS } from "./replay.ts";
import { readYearFile, yearsDir } from "./run.ts";

/**
 * The early warning ranked: whether ordering the detector's early warnings
 * by what each already records makes a short watch list of them useful.
 * The owner's question: of the top five or ten each month, how many are
 * real, and how many of the real ones make the list.
 *
 * The data are one row per early warning the scorecard counts: a
 * suspected verdict on the parent's own step that the matcher landed as a
 * detection, a late alert or a false alarm (a duplicate and an alert
 * inside an exempt window are neither, as on the scorecard). Its label is
 * one where it was on a reported event's step (a detection or a late
 * alert, on every line) and zero for a false alarm. Its features are read
 * from the verdict's evidence alone, which is what the detector knew when
 * it raised it: nothing after the raising (the damage ratio of the second
 * to fourth week, the persistence tiers, the pieces) enters the ranking.
 * The ranking changes nothing the detector decides; it is computed
 * afterwards, from the verdict.
 *
 * Two rankers are fitted on the training years (the even years) alone: a
 * hand-built score, the mean of a few features' percentiles among the
 * training early warnings, the features chosen by their separation of the
 * real from the false; and a small logistic regression with an L2 penalty
 * on standardised features. The one with the better training precision of
 * a monthly list, read by leaving each training year out in turn, is
 * frozen (`FROZEN_RANKER`), and the held-out years (the odd ones) are then
 * read once with it.
 *
 * A monthly list is the top k of the early warnings raised in a calendar
 * month, ranked at the month's end; a yearly list likewise over the year.
 * The live list a daily product would keep is the early warnings whose
 * score reaches a running threshold, set from the scores of the twelve
 * months before (no label is read), so that k a month would have passed
 * it. Precision is the real alerts over the list's entries, pooled over
 * the months, with its Wilson 95% interval; recall is the headline
 * targets (reported breakups of confidence A and B with public sets) whose
 * detection made the list, and made it before the first fragment's set or
 * any notice.
 *
 * `npm run kpi:rank -- --fit` reads the training years only and prints the
 * separation, the cross-validated comparison and the ranker to freeze.
 * `npm run kpi:rank` reads every year, scores with the frozen ranker,
 * prints the measurement on both splits and writes the rows to
 * `kpi/work/early-warnings.json.gz`.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The features a ranker may read, each a number derived from the verdict's evidence at the raising; NaN where the evidence does not give it. */
export const FEATURES = [
  "logZ",
  "logZMean",
  "logStepMetres",
  "logStepOverNoise",
  "logBstarFold",
  "bstarRead",
  "logDeltaV",
  "logDeltaVNormal",
  "logDeltaVRadial",
  "logKick",
  "dead",
  "working",
  "quiet",
  "logSteps",
  "logAgeYears",
  "logRecordDays",
  "rocketBody",
  "debris",
  "payload",
  "leo",
  "heo",
  "geo",
  "perigeeThousandKm",
  "logBstar",
  "explanations",
  "signatures",
  "logSiblings",
  "logBandScale",
  "logRunStress",
  "logGapHours",
  "rho",
  "logEvidence",
  "logCadence",
  "logCadenceRatio",
  "logInclinationStep",
  "scopeIn",
] as const;
export type FeatureName = (typeof FEATURES)[number];

/** What each feature reads, for the note and the report. */
export const FEATURE_WORDS: Record<FeatureName, string> = {
  logZ: "the step's size in its own sigma at the raising (log10)",
  logZMean: "the fitted step at the post sets' centroid in sigma (log10)",
  logStepMetres: "the step in semi-major axis, metres (log10)",
  logStepOverNoise: "the step over the object's own scatter (log10)",
  logBstarFold: "the drag term's change across the step, folded above one (log10; 0 where not read)",
  bstarRead: "whether the drag term's change was read (1)",
  logDeltaV: "the along-track impulse, m/s (log10 of it plus 0.001)",
  logDeltaVNormal: "the cross-track impulse, m/s (log10 of it plus 0.001)",
  logDeltaVRadial: "the least radial impulse, m/s (log10 of it plus 0.001)",
  logKick: "the chi-squared of the eccentricity change one tangential impulse cannot explain (log10 of one plus it)",
  dead: "a payload dead at the step by its dated status (1)",
  working: "a payload working at the step by its dated status (1)",
  quiet: "no persistent step in the two years before (1)",
  logSteps: "the persistent steps in the two years before (log10 of one plus them)",
  logAgeYears: "the years since launch (log10, at least a day)",
  logRecordDays: "the days since the object's first set (log10, at least one)",
  rocketBody: "a rocket body (1)",
  debris: "debris (1)",
  payload: "a payload (1)",
  leo: "low orbit (1)",
  heo: "highly elliptical orbit (1)",
  geo: "geosynchronous orbit (1)",
  perigeeThousandKm: "the perigee height, thousands of kilometres",
  logBstar: "the drag term before the step (log10 of its size plus 1e-6)",
  explanations: "how many manoeuvre explanations applied",
  signatures: "how many breakup signatures fired",
  logSiblings: "the like steps of launch-mates and shell-mates in the fortnight before (log10 of one plus them)",
  logBandScale: "the band's live scale at the first post set (log10)",
  logRunStress: "the candidates the catalogue opened in the last day (log10 of one plus them)",
  logGapHours: "the gap from the last pre set to the first post set, hours (log10)",
  rho: "the later sets' median over the first jump (clamped to 0 to 3)",
  logEvidence: "the evidence for a step against a drift (log10 of one plus it)",
  logCadence: "the sets a day before the step (log10 of it plus 0.01)",
  logCadenceRatio: "the sets a day after the step over before, at the raising (log10)",
  logInclinationStep: "the inclination step, degrees (log10 of it plus 1e-4)",
  scopeIn: "the parent in the scoped line's scope at the step (1)",
};

export type Features = Record<FeatureName, number>;

const log10 = Math.log10;
const NAN = Number.NaN;
const at = (evidence: Record<string, number>, name: string): number => {
  const value = evidence[name];
  return value === undefined || value === null ? NAN : value;
};

/** The features of an early warning from its verdict's evidence, as the detector recorded it at the raising. */
export function featuresOf(evidence: Record<string, number>): Features {
  const e = (name: string): number => at(evidence, name);
  const bodyClass = BODY_CLASSES[e("bodyClass")] ?? "unknown";
  const regime = REGIMES[e("regime")] ?? "unknown";
  const status = OPS_STATUSES[e("opsStatus")] ?? "unknown";
  const working = status === "operational" || status === "partially operational" || status === "backup" || status === "spare" || status === "extended mission";
  const ratio = e("bstarRatio");
  const sigma = e("sigmaOwn");
  const age = e("ageFromLaunchDays");
  const n730 = e("n730");
  const before = e("cadenceBefore");
  const after = e("cadenceAfter");
  return {
    logZ: log10(Math.max(Math.abs(e("zk")), 1e-3)),
    logZMean: log10(Math.max(Math.abs(e("zMean")), 1e-3)),
    logStepMetres: log10(Math.max(Math.abs(e("deltaKm")) * 1000, 1e-3)),
    logStepOverNoise: Number.isFinite(sigma) && sigma > 0 ? log10(Math.max(Math.abs(e("deltaKm")) / sigma, 1e-6)) : NAN,
    logBstarFold: Number.isFinite(ratio) && ratio > 0 ? Math.abs(log10(ratio)) : 0,
    bstarRead: Number.isFinite(ratio) && ratio > 0 ? 1 : 0,
    logDeltaV: log10(Math.abs(e("deltaVMps")) + 1e-3),
    logDeltaVNormal: log10(Math.abs(e("deltaVNormalMps")) + 1e-3),
    logDeltaVRadial: log10(Math.abs(e("deltaVRadialMps")) + 1e-3),
    logKick: log10(1 + Math.max(e("impulseConsistency"), 0)),
    dead: bodyClass === "payload" && status === "nonoperational" ? 1 : 0,
    working: bodyClass === "payload" && working ? 1 : 0,
    quiet: Number.isFinite(n730) ? (n730 === 0 ? 1 : 0) : NAN,
    logSteps: Number.isFinite(n730) ? log10(1 + n730) : NAN,
    logAgeYears: Number.isFinite(age) ? log10(Math.max(age, 1) / 365.25) : NAN,
    logRecordDays: log10(Math.max(e("ageDays"), 1)),
    rocketBody: bodyClass === "rocket body" ? 1 : 0,
    debris: bodyClass === "debris" ? 1 : 0,
    payload: bodyClass === "payload" ? 1 : 0,
    leo: regime === "LEO" ? 1 : 0,
    heo: regime === "HEO" ? 1 : 0,
    geo: regime === "GEO" ? 1 : 0,
    perigeeThousandKm: e("perigeeKm") / 1000,
    logBstar: log10(Math.abs(e("bstar")) + 1e-6),
    explanations: e("explanations"),
    signatures: e("signatures"),
    logSiblings: log10(1 + e("siblingsLaunch") + e("siblingsOrbit")),
    logBandScale: log10(Math.max(e("bandScale1"), 1e-3)),
    logRunStress: log10(1 + e("recentCandidates")),
    logGapHours: log10(Math.max(e("gapHours"), 0.01)),
    rho: Math.min(Math.max(e("rhoMedian"), 0), 3),
    logEvidence: log10(1 + Math.max(e("stepEvidence"), 0)),
    logCadence: log10(Math.max(before, 0) + 0.01),
    logCadenceRatio: log10((Math.max(after, 0) + 0.01) / (Math.max(before, 0) + 0.01)),
    logInclinationStep: log10(Math.abs(e("deltaInclinationDeg")) + 1e-4),
    scopeIn: e("scopeIn") === 1 ? 1 : 0,
  };
}

export const SPLIT_NAMES = ["warm-up", "train", "validation"] as const;
export type Split = (typeof SPLIT_NAMES)[number];

/** The split a year belongs to: the warm-up year before the scored ones, the even years the rankers are fitted on, the odd years held out. */
export const splitOf = (year: number): Split => (year < SCORED_FROM_YEAR ? "warm-up" : year % 2 === 0 ? "train" : "validation");

/** One early warning: when it was raised, what it was, what the detector recorded of it, and how it ended. */
export interface EarlyWarning {
  year: number;
  split: Split;
  number: number;
  launch: string | null;
  raisedAt: number;
  /** The calendar month it was raised in, `YYYY-MM`, in UTC. */
  month: string;
  outcome: "detection" | "late" | "false-alarm";
  /** One where it was on a reported event's step (a detection or a late alert), zero for a false alarm. */
  label: 0 | 1;
  event: string | null;
  eventName: string | null;
  line: Line | null;
  /** The reported event's first fragment's set or notice, whichever came first: a list must name the alert before it to have flagged the event. Null for a false alarm, or where neither came. */
  deadline: number | null;
  catalogueAt: number | null;
  timingErrorMinutes: number | null;
  /** Whether the step passed the scoped line's scope and gates, and whether the fragments or a notice later confirmed the alert. */
  scoped: boolean;
  confirmed: boolean;
  /** What the examples print of it. */
  bodyClass: string;
  regime: string;
  status: string;
  features: Features;
}

/** A headline target of a split: a reported breakup of confidence A and B whose parent had public sets, and how the scorecard found it. */
export interface Target {
  id: string;
  name: string;
  year: number;
  split: Split;
  status: "detected" | "late" | "missed";
}

/** The calendar month an alert is listed in: the month it was raised in, in UTC, except that an alert the replay of a year raised in the first days after it (its last run reaches past the year's end) is its year's, as the scorecard counts it, and listed with its December. */
export function monthOf(raisedAt: number, year: number): string {
  const month = new Date(raisedAt).toISOString().slice(0, 7);
  return month > `${year}-12` ? `${year}-12` : month;
}

/** The early warnings and the headline targets of one year's file. */
export function warningsOf(file: Pick<YearFile, "year" | "score" | "verdicts">): { warnings: EarlyWarning[]; targets: Target[] } {
  const events = new Map(file.score.events.map((event) => [event.id, event]));
  const split = splitOf(file.year);
  const warnings: EarlyWarning[] = [];
  for (const alert of file.score.alerts) {
    if (alert.state !== "suspected") continue;
    if (alert.outcome !== "detection" && alert.outcome !== "late" && alert.outcome !== "false-alarm") continue;
    const verdict = file.verdicts[alert.verdict]!;
    const event = alert.event === null ? undefined : events.get(alert.event);
    const deadline = event === undefined ? null : Math.min(event.catalogueAt ?? Number.POSITIVE_INFINITY, event.noticeAt ?? Number.POSITIVE_INFINITY);
    const evidence = verdict.evidence;
    warnings.push({
      year: file.year,
      split,
      number: alert.number,
      launch: alert.launch,
      raisedAt: alert.raisedAt,
      month: monthOf(alert.raisedAt, file.year),
      outcome: alert.outcome,
      label: alert.outcome === "false-alarm" ? 0 : 1,
      event: alert.event,
      eventName: event?.name ?? null,
      line: event?.line ?? null,
      deadline: deadline === null || !Number.isFinite(deadline) ? null : deadline,
      catalogueAt: event?.catalogueAt ?? null,
      timingErrorMinutes: event?.timingErrorMinutes ?? null,
      scoped: alert.scoped === true,
      confirmed: alert.confirmedAt !== null,
      bodyClass: BODY_CLASSES[evidence.bodyClass ?? 3] ?? "unknown",
      regime: REGIMES[evidence.regime ?? 4] ?? "unknown",
      status: OPS_STATUSES[evidence.opsStatus ?? 7] ?? "unknown",
      features: featuresOf(evidence),
    });
  }
  const targets: Target[] = file.score.events.filter((event) => event.line === "breakups A-B" && event.status !== "undetectable").map((event) => ({ id: event.id, name: event.name, year: file.year, split, status: event.status as Target["status"] }));
  return { warnings, targets };
}

/** The early warnings and targets of the year files under a directory, one file at a time, of the years the filter keeps. */
export function loadWarnings(dir: string, keep: (year: number) => boolean = () => true): { warnings: EarlyWarning[]; targets: Target[]; years: number[] } {
  const warnings: EarlyWarning[] = [];
  const targets: Target[] = [];
  const years: number[] = [];
  if (!existsSync(yearsDir(dir))) throw new Error(`no year files under ${yearsDir(dir)}`);
  for (const name of readdirSync(yearsDir(dir)).filter((n) => /^\d{4}\.json\.gz$/.test(n)).sort()) {
    const year = Number(name.slice(0, 4));
    if (!keep(year)) continue;
    const file = readYearFile(join(yearsDir(dir), name));
    const read = warningsOf(file);
    warnings.push(...read.warnings);
    targets.push(...read.targets);
    years.push(year);
    console.error(`rank: read ${year}: ${read.warnings.length} early warnings`);
  }
  return { warnings, targets, years };
}

// ——— The rankers ———

/** The hand-built ranker: the mean, over a few features, of the alert's percentile among the training early warnings on each (turned over where a low value is the breakup's side); a missing value reads as the median. */
export interface RankSum {
  kind: "rank-sum";
  features: { name: FeatureName; sign: 1 | -1; cuts: number[] }[];
}

/** The logistic ranker: the probability a logistic regression with an L2 penalty gives, on features standardised by the training mean and deviation; a missing value reads as the mean. */
export interface Logistic {
  kind: "logistic";
  lambda: number;
  intercept: number;
  features: { name: FeatureName; mean: number; sd: number; weight: number }[];
}

export type Ranker = RankSum | Logistic;

/** How many cut points a percentile is read off: every two percent. */
export const CUTS = 51;

/** Four significant digits, as the log rows are kept, so a frozen ranker reads the same printed as computed. */
const round4 = (value: number): number => {
  if (!Number.isFinite(value) || value === 0) return value;
  const digits = 3 - Math.floor(Math.log10(Math.abs(value)));
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** The cut points of a sample: its 0th, 2nd, ..., 100th percentiles, by linear interpolation between order statistics. */
export function cutsOf(values: number[]): number[] {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  return Array.from({ length: CUTS }, (_, i) => {
    const position = (i / (CUTS - 1)) * (sorted.length - 1);
    const lo = Math.floor(position);
    const hi = Math.min(lo + 1, sorted.length - 1);
    return round4(sorted[lo]! + (position - lo) * (sorted[hi]! - sorted[lo]!));
  });
}

/** A value's percentile, 0 to 1, along cut points: piecewise linear between them, the middle of a run of equal cuts where it equals them; a half where the value or the cuts are missing. */
export function percentileAlong(cuts: readonly number[], value: number): number {
  if (!Number.isFinite(value) || cuts.length < 2) return 0.5;
  const last = cuts.length - 1;
  if (value < cuts[0]!) return 0;
  if (value > cuts[last]!) return 1;
  let below = 0;
  while (below < cuts.length && cuts[below]! < value) below++;
  let through = below;
  while (through < cuts.length && cuts[through]! === value) through++;
  if (through > below) return (below + through - 1) / 2 / last;
  const lo = cuts[below - 1]!;
  const hi = cuts[below]!;
  return (below - 1 + (value - lo) / (hi - lo)) / last;
}

const sigmoid = (x: number): number => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));

/** A ranker's score of an alert's features, 0 to 1: the higher, the likelier a breakup. */
export function scoreOf(ranker: Ranker, features: Features): number {
  if (ranker.kind === "rank-sum") {
    let sum = 0;
    for (const f of ranker.features) {
      const p = percentileAlong(f.cuts, features[f.name]);
      sum += f.sign === 1 ? p : 1 - p;
    }
    return sum / ranker.features.length;
  }
  let eta = ranker.intercept;
  for (const f of ranker.features) {
    const x = features[f.name];
    if (Number.isFinite(x) && f.sd > 0) eta += (f.weight * (x - f.mean)) / f.sd;
  }
  return sigmoid(eta);
}

// ——— Separation and fitting, on the training rows ———

/** The mid-ranks of a sample, from one. */
function midRanks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    for (let t = i; t <= j; t++) ranks[order[t]![1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return ranks;
}

/** The area under the curve of a feature: the chance a real alert reads higher than a false one, ties counting a half; over the rows where the feature is read. */
export function aucOf(rows: readonly Pick<EarlyWarning, "label" | "features">[], name: FeatureName): number {
  const read = rows.filter((r) => Number.isFinite(r.features[name]));
  const ranks = midRanks(read.map((r) => r.features[name]));
  let positives = 0;
  let sum = 0;
  read.forEach((r, i) => {
    if (r.label === 1) {
      positives++;
      sum += ranks[i]!;
    }
  });
  const negatives = read.length - positives;
  if (positives === 0 || negatives === 0) return 0.5;
  return (sum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

/** Spearman's correlation of two features over the rows where both are read. */
export function spearmanOf(rows: readonly Pick<EarlyWarning, "features">[], a: FeatureName, b: FeatureName): number {
  const both = rows.filter((r) => Number.isFinite(r.features[a]) && Number.isFinite(r.features[b]));
  if (both.length < 3) return 0;
  const ra = midRanks(both.map((r) => r.features[a]));
  const rb = midRanks(both.map((r) => r.features[b]));
  const mean = (both.length + 1) / 2;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < both.length; i++) {
    sab += (ra[i]! - mean) * (rb[i]! - mean);
    saa += (ra[i]! - mean) ** 2;
    sbb += (rb[i]! - mean) ** 2;
  }
  return saa === 0 || sbb === 0 ? 0 : sab / Math.sqrt(saa * sbb);
}

/** The rule the hand-built ranker's features are chosen by, written before the held-out years were read: by their separation on the training rows, the farthest from even first, each at least this far from a half and less correlated than the bound with every one already taken, at most this many. */
export const RANK_SUM_RULE = { minDistance: 0.1, maxCorrelation: 0.7, maxFeatures: 6 } as const;

/** The hand-built ranker fitted on the rows: the features the rule chooses, each with its side and its cut points. */
export function fitRankSum(rows: readonly EarlyWarning[], rule = RANK_SUM_RULE): RankSum {
  const separation = FEATURES.map((name) => ({ name, auc: aucOf(rows, name) })).sort((a, b) => Math.abs(b.auc - 0.5) - Math.abs(a.auc - 0.5) || FEATURES.indexOf(a.name) - FEATURES.indexOf(b.name));
  const chosen: { name: FeatureName; sign: 1 | -1 }[] = [];
  for (const { name, auc } of separation) {
    if (chosen.length >= rule.maxFeatures || Math.abs(auc - 0.5) < rule.minDistance) break;
    if (chosen.some((c) => Math.abs(spearmanOf(rows, c.name, name)) >= rule.maxCorrelation)) continue;
    chosen.push({ name, sign: auc >= 0.5 ? 1 : -1 });
  }
  return { kind: "rank-sum", features: chosen.map((c) => ({ ...c, cuts: cutsOf(rows.map((r) => r.features[c.name])) })) };
}

/** Solves a small dense linear system by Gaussian elimination with partial pivoting. */
function solve(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const p = a[col]![col]!;
    for (let r = col + 1; r < n; r++) {
      const factor = a[r]![col]! / p;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) a[r]![c]! -= factor * a[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = a[r]![n]!;
    for (let c = r + 1; c < n; c++) sum -= a[r]![c]! * x[c]!;
    x[r] = sum / a[r]![r]!;
  }
  return x;
}

/** The logistic ranker fitted on the rows by Newton's method: every feature standardised by the rows' mean and deviation, a missing value at the mean, the weights (not the intercept) held by an L2 penalty of `lambda`. */
export function fitLogistic(rows: readonly EarlyWarning[], lambda: number, names: readonly FeatureName[] = FEATURES): Logistic {
  const stats = names.map((name) => {
    const values = rows.map((r) => r.features[name]).filter(Number.isFinite);
    const mean = values.reduce((s, v) => s + v, 0) / Math.max(values.length, 1);
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(values.length - 1, 1));
    return { name, mean, sd };
  });
  const used = stats.filter((s) => s.sd > 0);
  const x = rows.map((r) => [1, ...used.map((s) => (Number.isFinite(r.features[s.name]) ? (r.features[s.name] - s.mean) / s.sd : 0))]);
  const y = rows.map((r) => r.label);
  const p = used.length + 1;
  let w = new Array<number>(p).fill(0);
  for (let iteration = 0; iteration < 100; iteration++) {
    const gradient = new Array<number>(p).fill(0);
    const hessian = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    for (let i = 0; i < x.length; i++) {
      const xi = x[i]!;
      let eta = 0;
      for (let j = 0; j < p; j++) eta += w[j]! * xi[j]!;
      const mu = sigmoid(eta);
      const residual = mu - y[i]!;
      const curvature = mu * (1 - mu);
      for (let j = 0; j < p; j++) {
        gradient[j]! += residual * xi[j]!;
        const hj = hessian[j]!;
        for (let k = j; k < p; k++) hj[k]! += curvature * xi[j]! * xi[k]!;
      }
    }
    for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) hessian[j]![k] = hessian[k]![j]!;
    for (let j = 1; j < p; j++) {
      gradient[j]! += lambda * w[j]!;
      hessian[j]![j]! += lambda;
    }
    const step = solve(hessian, gradient);
    w = w.map((wj, j) => wj - step[j]!);
    if (Math.max(...step.map(Math.abs)) < 1e-10) break;
  }
  return { kind: "logistic", lambda, intercept: round4(w[0]!), features: used.map((s, j) => ({ name: s.name, mean: round4(s.mean), sd: round4(s.sd), weight: round4(w[j + 1]!) })) };
}

// ——— Lists ———

/** An early warning with its score. */
export type Scored = Pick<EarlyWarning, "year" | "split" | "number" | "raisedAt" | "month" | "label" | "outcome" | "event" | "deadline" | "catalogueAt" | "timingErrorMinutes"> & { score: number };

/** A listed early warning, and when the list named it. */
export interface Listed {
  warning: Scored;
  listedAt: number;
  /** Its rank in its list, from one; the live list ranks none. */
  rank: number | null;
}

/** The order of a list: the highest score first, then the earliest raised, then the lowest catalogue number, so a list is the same whatever order its rows came in. */
export const byScore = (a: Scored, b: Scored): number => b.score - a.score || a.raisedAt - b.raisedAt || a.number - b.number;

const monthStartOf = (month: string): number => Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
/** A month's place in the calendar, counted in months from year zero. */
const monthIndexOf = (month: string): number => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const nextMonthStartOf = (month: string): number => Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1);

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = groups.get(k);
    if (list === undefined) groups.set(k, [row]);
    else list.push(row);
  }
  return groups;
}

/** The monthly lists: in each calendar month, the top k of the early warnings raised in it, ranked at the month's end (or at the last of them, for a December holding the first days after it) by score, or by the order given. */
export function monthlyLists(rows: readonly Scored[], k: number, order: (a: Scored, b: Scored) => number = byScore): Listed[] {
  const listed: Listed[] = [];
  for (const [month, group] of [...groupBy(rows, (r) => r.month)].sort((a, b) => a[0].localeCompare(b[0]))) {
    const end = Math.max(nextMonthStartOf(month), ...group.map((r) => r.raisedAt));
    [...group].sort(order).slice(0, k).forEach((warning, i) => listed.push({ warning, listedAt: end, rank: i + 1 }));
  }
  return listed;
}

/** The yearly lists: in each calendar year, the top k of the early warnings raised in it, ranked at the year's end (or at the last of them). */
export function yearlyLists(rows: readonly Scored[], k: number, order: (a: Scored, b: Scored) => number = byScore): Listed[] {
  const listed: Listed[] = [];
  for (const [year, group] of [...groupBy(rows, (r) => r.month.slice(0, 4))].sort((a, b) => a[0].localeCompare(b[0]))) {
    const end = Math.max(Date.UTC(Number(year) + 1, 0, 1), ...group.map((r) => r.raisedAt));
    [...group].sort(order).slice(0, k).forEach((warning, i) => listed.push({ warning, listedAt: end, rank: i + 1 }));
  }
  return listed;
}

/** How many months back the live list's threshold reads the scores. */
export const LIVE_WINDOW_MONTHS = 12;

/**
 * The live list: an early warning is listed when it is raised if its
 * score reaches the month's threshold, the score above which k a month
 * of the early warnings raised in the `window` months before the month
 * lay (the (k times window)th highest of their scores; every one of them
 * where fewer were raised). No label is read, so the threshold of a
 * month uses nothing a live run would not have had. A month with no
 * month before it in the rows lists nothing. The rows are every year
 * read, the warm-up year's too, so the first scored month has its year
 * before it.
 */
export function liveLists(rows: readonly Scored[], k: number, window = LIVE_WINDOW_MONTHS): Listed[] {
  const sorted = [...rows].sort((a, b) => a.raisedAt - b.raisedAt || a.number - b.number);
  if (sorted.length === 0) return [];
  const first = monthIndexOf(sorted[0]!.month);
  const listed: Listed[] = [];
  for (const [month, group] of [...groupBy(sorted, (r) => r.month)].sort((a, b) => a[0].localeCompare(b[0]))) {
    const index = monthIndexOf(month);
    if (index <= first) continue;
    const start = monthStartOf(month);
    const from = Date.UTC(Math.floor((index - window) / 12), (index - window) % 12, 1);
    const months = Math.min(window, index - first);
    const before = sorted.filter((r) => r.raisedAt >= from && r.raisedAt < start).map((r) => r.score).sort((a, b) => b - a);
    const quota = Math.max(1, k * months);
    const threshold = before.length === 0 ? Number.POSITIVE_INFINITY : before[Math.min(quota, before.length) - 1]!;
    for (const warning of group) if (warning.score >= threshold) listed.push({ warning, listedAt: warning.raisedAt, rank: null });
  }
  return listed;
}

// ——— Reading a list ———

/** A list read on a split: its entries, the real ones among them, the precision with its Wilson interval, the months it ran over, and the headline targets it caught. */
export interface ListReading {
  entries: number;
  real: number;
  precision: number | null;
  interval: [number, number] | null;
  months: number;
  /** The headline targets of the split, those whose detection made the list at all, and those it named before the first fragment's set or any notice. */
  targets: number;
  inList: number;
  onTime: number;
  /** Of those named on time: the lead over the first fragment's set from when the list named it, days, median; and the timing error, minutes, median. */
  leadDays: number | null;
  timingMinutes: number | null;
  caught: string[];
}

/** A list read on a split's rows and headline targets. */
export function readList(listed: readonly Listed[], split: Split, targets: readonly Target[], months: number): ListReading {
  const mine = listed.filter((l) => l.warning.split === split);
  const real = mine.filter((l) => l.warning.label === 1).length;
  const headline = targets.filter((t) => t.split === split);
  const byEvent = new Map(mine.filter((l) => l.warning.outcome === "detection" && l.warning.event !== null).map((l) => [l.warning.event!, l]));
  let inList = 0;
  const onTime: Listed[] = [];
  const caught: string[] = [];
  for (const target of headline) {
    const l = byEvent.get(target.id);
    if (l === undefined) continue;
    inList++;
    if (l.warning.deadline === null || l.listedAt < l.warning.deadline) {
      onTime.push(l);
      caught.push(target.id);
    }
  }
  const leads = onTime.filter((l) => l.warning.catalogueAt !== null).map((l) => (l.warning.catalogueAt! - l.listedAt) / DAY_MS);
  const timings = onTime.map((l) => l.warning.timingErrorMinutes).filter((t): t is number => t !== null);
  return { entries: mine.length, real, precision: mine.length === 0 ? null : real / mine.length, interval: wilson(real, mine.length), months, targets: headline.length, inList, onTime: onTime.length, leadDays: leads.length === 0 ? null : percentile(leads, 50), timingMinutes: timings.length === 0 ? null : percentile(timings, 50), caught };
}

/** The months of a split that raised at least one early warning. */
export const monthsOf = (rows: readonly Scored[], split: Split): number => new Set(rows.filter((r) => r.split === split).map((r) => r.month)).size;

/** The rule the frozen ranker was chosen by, written before the held-out years were read: the mean of the pooled precision of the monthly top five and top ten, each training year's scores from a ranker fitted on the other training years. */
export function criterionOf(rows: readonly Scored[]): number {
  const p = (k: number): number => {
    const listed = monthlyLists(rows, k);
    return listed.length === 0 ? 0 : listed.filter((l) => l.warning.label === 1).length / listed.length;
  };
  return (p(5) + p(10)) / 2;
}

/** The scores of the rows, each year's from a ranker fitted on the other years' rows. */
export function crossValidated(rows: readonly EarlyWarning[], fit: (training: EarlyWarning[]) => Ranker): Scored[] {
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const scored: Scored[] = [];
  for (const year of years) {
    const ranker = fit(rows.filter((r) => r.year !== year));
    for (const r of rows.filter((x) => x.year === year)) scored.push({ ...r, score: scoreOf(ranker, r.features) });
  }
  return scored;
}

/** The penalties the logistic ranker is tried at. */
export const LAMBDAS = [1, 3, 10, 30, 100] as const;

// ——— The frozen ranker ———

/** When the ranker below was frozen, before the held-out years were read with it. */
export const FROZEN_AT = "2026-10-11T17:34:50Z";

/** The ranker chosen on the training years by `criterionOf` and frozen: the logistic regression at the penalty 3, refitted on every training year (`npm run kpi:rank -- --fit`). The held-out years are read with it as it stands. */
export const FROZEN_RANKER: Ranker = {
  kind: "logistic",
  lambda: 3,
  intercept: -6.188,
  features: [
    { name: "logZ", mean: 1.61, sd: 0.7934, weight: -0.2227 },
    { name: "logZMean", mean: 1.858, sd: 0.8052, weight: -0.281 },
    { name: "logStepMetres", mean: 3.52, sd: 1.244, weight: -0.7851 },
    { name: "logStepOverNoise", mean: 1.933, sd: 0.9638, weight: 0.6221 },
    { name: "logBstarFold", mean: 0.2496, sd: 0.5556, weight: 0.2945 },
    { name: "bstarRead", mean: 0.5968, sd: 0.4906, weight: 0.4934 },
    { name: "logDeltaV", mean: -0.215, sd: 1.242, weight: -0.2482 },
    { name: "logDeltaVNormal", mean: -2.034, sd: 1.719, weight: 0.4829 },
    { name: "logDeltaVRadial", mean: -1.719, sd: 1.61, weight: -0.4837 },
    { name: "logKick", mean: 0.9827, sd: 1.488, weight: -0.03302 },
    { name: "dead", mean: 0.2704, sd: 0.4442, weight: -0.1053 },
    { name: "quiet", mean: 0.7108, sd: 0.4535, weight: -0.1219 },
    { name: "logSteps", mean: 0.2222, sd: 0.4155, weight: -0.4474 },
    { name: "logAgeYears", mean: 0.4125, sd: 1.412, weight: 0.1337 },
    { name: "logRecordDays", mean: 2.679, sd: 1.318, weight: 0.235 },
    { name: "rocketBody", mean: 0.2513, sd: 0.4338, weight: 0.5873 },
    { name: "debris", mean: 0.1946, sd: 0.396, weight: -0.4282 },
    { name: "payload", mean: 0.5418, sd: 0.4983, weight: -0.03541 },
    { name: "leo", mean: 0.509, sd: 0.5, weight: 0.1036 },
    { name: "heo", mean: 0.1765, sd: 0.3813, weight: 0.07673 },
    { name: "geo", mean: 0.2322, sd: 0.4223, weight: 0.1498 },
    { name: "perigeeThousandKm", mean: 10.01, sd: 15.4, weight: -0.204 },
    { name: "logBstar", mean: -4.529, sd: 1.304, weight: -0.001082 },
    { name: "explanations", mean: 0.3291, sd: 0.4707, weight: 0.1279 },
    { name: "signatures", mean: 0.6576, sd: 0.6055, weight: 0.6466 },
    { name: "logSiblings", mean: 0.04931, sd: 0.132, weight: 0.03071 },
    { name: "logBandScale", mean: 0.01453, sd: 0.08028, weight: -0.3161 },
    { name: "logRunStress", mean: 1.462, sd: 0.5942, weight: 0.04902 },
    { name: "logGapHours", mean: 1.322, sd: 0.8354, weight: 0.25 },
    { name: "rho", mean: 1.609, sd: 0.7409, weight: -0.7211 },
    { name: "logEvidence", mean: 3.073, sd: 1.666, weight: 0.2171 },
    { name: "logCadence", mean: -0.187, sd: 0.7641, weight: 0.4621 },
    { name: "logCadenceRatio", mean: 0.573, sd: 0.8042, weight: -0.1534 },
    { name: "logInclinationStep", mean: -2.493, sd: 0.9878, weight: 0.461 },
    { name: "scopeIn", mean: 0.6156, sd: 0.4865, weight: 0.1527 },
  ],
};

// ——— The command ———

const pct = (x: number | null, digits = 1): string => (x === null ? "–" : `${(100 * x).toFixed(digits)}%`);
const intervalText = (r: Pick<ListReading, "precision" | "interval" | "real" | "entries">): string => (r.precision === null ? "–" : `${pct(r.precision)} (${pct(r.interval![0])} to ${pct(r.interval![1])}), ${r.real} of ${r.entries}`);
const num = (x: number | null, digits = 1): string => (x === null ? "–" : x.toFixed(digits));

function table(headers: string[], rows: (string | number)[][]): string {
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

const describeRanker = (ranker: Ranker): string => (ranker.kind === "rank-sum" ? `rank-sum of ${ranker.features.map((f) => `${f.sign === 1 ? "+" : "−"}${f.name}`).join(", ")}` : `logistic, λ ${ranker.lambda}: intercept ${ranker.intercept}; ${ranker.features.map((f) => `${f.name} ${f.weight}`).join(", ")}`);

function fitCommand(dir: string): void {
  const { warnings } = loadWarnings(dir, (year) => splitOf(year) === "train");
  const rows = warnings.filter((w) => w.split === "train");
  const positives = rows.filter((r) => r.label === 1).length;
  console.log(`# The training years: ${rows.length} early warnings, ${positives} on a reported event's step (${pct(positives / rows.length, 2)}), ${new Set(rows.map((r) => r.month)).size} months\n`);
  console.log(table(["Feature", "Reads", "AUC", "Median, real", "Median, false", "Read on"], FEATURES.map((name) => {
    const read = rows.filter((r) => Number.isFinite(r.features[name]));
    const med = (label: 0 | 1): string => {
      const v = read.filter((r) => r.label === label).map((r) => r.features[name]);
      return v.length === 0 ? "–" : percentile(v, 50).toFixed(3);
    };
    return [name, FEATURE_WORDS[name], aucOf(rows, name).toFixed(3), med(1), med(0), read.length];
  }).sort((a, b) => Math.abs(Number(b[2]) - 0.5) - Math.abs(Number(a[2]) - 0.5))));
  const candidates: { name: string; fit: (training: EarlyWarning[]) => Ranker }[] = [{ name: "rank-sum", fit: (training) => fitRankSum(training) }, ...LAMBDAS.map((lambda) => ({ name: `logistic λ ${lambda}`, fit: (training: EarlyWarning[]) => fitLogistic(training, lambda) }))];
  console.log("\n## Cross-validated on the training years (each year scored by a ranker fitted on the others)\n");
  const results = candidates.map((c) => {
    const scored = crossValidated(rows, c.fit);
    const inSample = c.fit(rows);
    const insample = rows.map((r) => ({ ...r, score: scoreOf(inSample, r.features) }));
    const read = (k: number): ListReading => readList(monthlyLists(scored, k), "train", [], 0);
    return { ...c, criterion: criterionOf(scored), inSampleCriterion: criterionOf(insample), p1: read(1), p3: read(3), p5: read(5), p10: read(10), ranker: inSample };
  });
  console.log(table(["Ranker", "Criterion: mean of P@5 and P@10 a month, cross-validated", "In sample", "P@1 a month", "P@3", "P@5", "P@10"], results.map((r) => [r.name, pct(r.criterion, 2), pct(r.inSampleCriterion, 2), intervalText(r.p1), intervalText(r.p3), intervalText(r.p5), intervalText(r.p10)])));
  const best = results.reduce((a, b) => (b.criterion > a.criterion + 1e-12 ? b : a));
  console.log(`\nChosen by the rule (the higher cross-validated criterion, a tie to the hand-built): ${best.name}\n`);
  for (const r of results) console.log(`- ${r.name}: ${describeRanker(r.ranker)}`);
  console.log("\nThe ranker to freeze, fitted on every training year:\n");
  console.log(JSON.stringify(best.ranker));
}

function measureCommand(dir: string): void {
  const ranker = FROZEN_RANKER;
  const { warnings, targets } = loadWarnings(dir);
  const scored: (EarlyWarning & { score: number })[] = warnings.map((w) => ({ ...w, score: scoreOf(ranker, w.features) }));
  const out = join(ROOT, "kpi/work/early-warnings.json.gz");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, gzipSync(`${JSON.stringify({ ranker, frozenAt: FROZEN_AT, warnings: scored, targets })}\n`));
  console.error(`rank: wrote ${out}`);
  const chronological = (a: Scored, b: Scored): number => a.raisedAt - b.raisedAt || a.number - b.number;
  console.log(`# The early warning ranked, with the frozen ranker (${FROZEN_AT})\n\n${describeRanker(ranker)}\n`);
  for (const split of ["validation", "train"] as const) {
    const rows = scored.filter((r) => r.split === split);
    const real = rows.filter((r) => r.label === 1).length;
    const months = monthsOf(scored, split);
    const base = wilson(real, rows.length)!;
    const headline = targets.filter((t) => t.split === split);
    console.log(`## ${split === "validation" ? "Held out: the odd years" : "Training: the even years"}\n`);
    console.log(`${rows.length} early warnings in ${months} months, ${real} real: ${pct(real / rows.length, 2)} (${pct(base[0], 2)} to ${pct(base[1], 2)}). Headline targets ${headline.length}, ${headline.filter((t) => t.status === "detected").length} flagged before the first fragment, ${headline.filter((t) => t.status === "late").length} late; ${rows.filter((r) => r.confirmed).length} early warnings confirmed, ${rows.filter((r) => r.scoped).length} scoped.\n`);
    const line = (label: string, listed: Listed[]): (string | number)[] => {
      const r = readList(listed, split, targets, months);
      return [label, (r.entries / months).toFixed(1), intervalText(r), `${r.inList} / ${r.onTime} of ${r.targets}`, num(r.leadDays), num(r.timingMinutes), r.caught.join(", ")];
    };
    const head = ["List", "Entries a month", "Precision (95% interval), real of entries", "Headline targets in the list / named before the first fragment", "Lead over the first fragment from the naming, days, median", "Timing error, minutes, median", "Caught"];
    console.log(table(head, [
      ...[1, 3, 5, 10].map((k) => line(`ranked, top ${k} a month`, monthlyLists(scored, k))),
      ...[1, 3, 5, 10].map((k) => line(`unranked (the first raised), ${k} a month`, monthlyLists(scored, k, chronological))),
      ...[10, 20, 50].map((k) => line(`ranked, top ${k} a year`, yearlyLists(scored, k))),
      ...[1, 3, 5, 10].map((k) => line(`live: a running threshold for ${k} a month`, liveLists(scored, k))),
      line("every early warning", scored.map((warning) => ({ warning, listedAt: warning.raisedAt, rank: null }))),
    ]));
    console.log("\nPrecision against the monthly list's size:\n");
    console.log(table(["Top k a month", "Entries", "Real", "Precision", "Headline targets named before the first fragment"], [1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 50].map((k) => {
      const r = readList(monthlyLists(scored, k), split, targets, months);
      return [k, r.entries, r.real, pct(r.precision), `${r.onTime} of ${r.targets}`];
    })));
    console.log("\nThe real early warnings, each with its rank in its month:\n");
    const ranked = new Map<EarlyWarning, number>();
    for (const l of monthlyLists(scored, 1000)) ranked.set(l.warning as EarlyWarning & { score: number }, l.rank!);
    const sample = (r: (typeof scored)[number]): (string | number)[] => [new Date(r.raisedAt).toISOString().slice(0, 16), r.number, r.launch ?? "–", r.eventName ?? "–", r.outcome, `${ranked.get(r)} of ${rows.filter((x) => x.month === r.month).length}`, r.score.toFixed(3), r.bodyClass, r.regime, r.status, (10 ** r.features.logZ).toFixed(0), (10 ** r.features.logStepMetres).toFixed(0), (10 ** r.features.logBstarFold).toFixed(1), r.features.quiet, Number.isFinite(r.features.logAgeYears) ? (10 ** r.features.logAgeYears).toFixed(1) : "–", r.confirmed ? "yes" : ""];
    const exampleHead = ["Raised", "Number", "Launch", "Event", "Outcome", "Rank in its month", "Score", "Class", "Regime", "Status", "z", "Step, m", "B* fold", "Quiet", "Age, years", "Confirmed"];
    console.log(table(exampleHead, rows.filter((r) => r.label === 1).sort((a, b) => a.raisedAt - b.raisedAt).map(sample)));
    console.log("\nThe highest-scored early warnings of the split:\n");
    console.log(table(exampleHead, [...rows].sort(byScore).slice(0, 15).map(sample)));
    console.log("");
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const dir = resolve(args.find((a) => !a.startsWith("--")) ?? join(ROOT, "kpi"));
  if (args.includes("--fit")) fitCommand(dir);
  else measureCommand(dir);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("rank.ts")) main();
