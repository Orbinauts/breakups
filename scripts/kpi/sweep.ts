import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DETECTOR_PARAMETERS, OUTCOMES, type LogRow } from "../../src/index.ts";
import { brackets } from "./match.ts";
import { readYearFiles, yearsDir } from "./run.ts";
import { DAY_MS } from "./replay.ts";
import type { YearFile } from "./kpi.ts";

/**
 * The offline sweep: the persistence gates re-thresholded over the
 * candidates a replay logged, without replaying the years. Each log row
 * is one closed candidate with the step's trajectory over its first post
 * sets, so for a set of gate values the sweep can say at which post set,
 * if any, the candidate would have been raised, and whether that beat the
 * catalogue for a target of the year. It is an approximation of the
 * scorecard, not the scorecard: a candidate counts as a hit when its
 * bracket brackets a target's window on the target's parent and the run
 * that would have raised it came before the catalogue and any notice,
 * and as a false alarm otherwise, unless the replay's own matching landed
 * the same object's step as a duplicate or exempt. What it cannot see is
 * the gates that act before the log (the candidate threshold, the
 * guards), which are swept by replaying.
 *
 * `npm run kpi:sweep -- [--years 2006,2008,...] [--payloads] [--show]`
 * prints, for a grid of gate values, the hits on the headline line, the
 * hits on every line and the false alarms; by default over the even
 * years, the training split, and over every object class, with
 * `--payloads` adding the payload false alarms the manoeuvre classing of
 * a later phase will take, and `--show` listing the targets hit.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const KPI_DIR = join(ROOT, "kpi");

export interface Gates {
  zPersist: number;
  rhoMin: number;
  rhoMax: number;
  evidenceMin: number;
  spanHours: number;
}

/** A candidate as the sweep reads it: the row's trajectory and where its object's step landed in the replay. */
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
  /** The final estimate, at the close. */
  zk: number;
  rhoMedian: number;
  evidence: number;
  k: number;
  outcome: number;
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
    zk: signal(row, "zk"),
    rhoMedian: signal(row, "rhoMedian"),
    evidence: signal(row, "stepEvidence"),
    k: signal(row, "k"),
    outcome: signal(row, "outcome"),
  };
}

/** Whether the gates pass at one point of the trajectory. */
function passes(z: number, rho: number, evidence: number, gates: Gates): boolean {
  return Math.abs(z) >= gates.zPersist && rho >= gates.rhoMin && rho <= gates.rhoMax && evidence >= gates.evidenceMin;
}

/**
 * At which post set the candidate would have been raised under the
 * gates: the second where its span allows, else the third, else at its
 * close where it had more; null where never. A reverted candidate
 * (its later sets back under the revert ratio) is never raised.
 */
export function raisedAt(c: SweptCandidate, gates: Gates): 2 | 3 | "close" | null {
  if (c.outcome === OUTCOMES.reverted) return null;
  if (Number.isFinite(c.z2) && c.span2 >= gates.spanHours && passes(c.z2, c.rho2, c.evidence2, gates)) return 2;
  if (Number.isFinite(c.z3) && passes(c.z3, c.rho3, c.evidence3, gates)) return 3;
  if (c.k > 3 && passes(c.zk, c.rhoMedian, c.evidence, gates)) return "close";
  return null;
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
}

/** A target of a year as the sweep sees it. */
interface Target {
  id: string;
  parent: number;
  from: number;
  to: number;
  deadline: number;
  headline: boolean;
}

function targetsOf(file: YearFile): Target[] {
  return file.score.events
    .filter((e) => e.status !== "undetectable")
    .map((e) => ({ id: e.id, parent: e.parent, from: e.from, to: e.to, deadline: Math.min(e.catalogueAt ?? Number.POSITIVE_INFINITY, e.noticeAt ?? Number.POSITIVE_INFINITY), headline: e.line === "breakups A-B" }));
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

/** The tally of a grid point over the files. */
export function tally(files: YearFile[], gates: Gates): Tally {
  const result: Tally = { gates, hit: [], minZ1: Number.POSITIVE_INFINITY, headlineHits: 0, headlineTargets: 0, hits: 0, targets: 0, falseAlarms: 0, falseAlarmsNonPayload: 0, raised: 0 };
  for (const file of files) {
    const targets = targetsOf(file);
    const landed = landedOf(file);
    const hit = new Set<string>();
    const raisedSteps = new Map<number, { beforeEpoch: number; afterEpoch: number }[]>();
    for (const row of file.log) {
      if (row.signals.phase !== 2) continue;
      const c = candidateOf(file.year, row);
      const when = raisedAt(c, gates);
      if (when === null) continue;
      result.raised++;
      const step = { beforeEpoch: c.beforeEpoch, afterEpoch: c.afterEpoch };
      // The instant it would have been raised: no earlier than the epoch of the post set that raised it, and the close row's run where that was the one.
      const at = when === 2 ? c.afterEpoch + c.span2 * HOUR_MS : when === 3 ? c.afterEpoch + c.span3 * HOUR_MS : c.at;
      const onParent = targets.filter((t) => t.parent === c.number && brackets({ ...step, deltaKm: 0, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 0, z: null }, t.from, t.to));
      if (onParent.length > 0) {
        for (const t of onParent) if (at < t.deadline) {
          hit.add(t.id);
          result.minZ1 = Math.min(result.minZ1, Math.abs(c.z1));
        }
        continue;
      }
      const earlier = raisedSteps.get(c.number) ?? [];
      if (earlier.some((s) => s.beforeEpoch <= step.afterEpoch && step.beforeEpoch <= s.afterEpoch)) continue;
      raisedSteps.set(c.number, [...earlier, step]);
      if ((landed.get(c.number) ?? []).some((s) => s.beforeEpoch <= step.afterEpoch + DAY_MS && step.beforeEpoch <= s.afterEpoch + DAY_MS)) continue;
      result.falseAlarms++;
      if (c.bodyClass !== 0) result.falseAlarmsNonPayload++;
    }
    for (const t of targets) {
      result.targets++;
      if (t.headline) result.headlineTargets++;
      if (hit.has(t.id)) {
        result.hit.push(t.id);
        result.hits++;
        if (t.headline) result.headlineHits++;
      }
    }
  }
  return result;
}

const DEFAULT_GRID: Partial<Record<keyof Gates, number[]>> = {
  zPersist: [6, 8, 10, 12, 15, 20],
  rhoMin: [0.5, 0.6, 0.75],
  rhoMax: [1.5, 2, 3, Number.POSITIVE_INFINITY],
  evidenceMin: [0, 5, 10, 20, 50],
  spanHours: [6, 12, 18, 24],
};

function parseArgs(args: string[]): { years: number[] | null; payloads: boolean; show: boolean; grid: Partial<Record<keyof Gates, number[]>> } {
  let years: number[] | null = null;
  let payloads = false;
  let show = false;
  const grid = { ...DEFAULT_GRID };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--years") years = args[++i]!.split(",").map(Number);
    else if (arg === "--payloads") payloads = true;
    else if (arg === "--show") show = true;
    else if (arg.startsWith("--") && arg.slice(2) in DEFAULT_GRID) grid[arg.slice(2) as keyof Gates] = args[++i]!.split(",").map(Number);
    else throw new Error(`usage: sweep.ts [--years 2006,2008] [--payloads] [--zPersist 8,10] [--rhoMin ...] [--rhoMax ...] [--evidenceMin ...] [--spanHours ...]`);
  }
  return { years, payloads, show, grid };
}

function main(): void {
  const { years, payloads, show, grid } = parseArgs(process.argv.slice(2));
  const all = readYearFiles(KPI_DIR);
  const files = all.filter((f) => (years === null ? f.year % 2 === 0 : years.includes(f.year)));
  if (files.length === 0) throw new Error(`no year files under ${yearsDir(KPI_DIR)} for the years asked`);
  console.log(`years ${files.map((f) => f.year).join(", ")}; the detector's current gates: zPersist ${DETECTOR_PARAMETERS.zPersist}, rho ${DETECTOR_PARAMETERS.rhoMin} to ${DETECTOR_PARAMETERS.rhoMax}, evidence ${DETECTOR_PARAMETERS.evidenceMin}, span ${DETECTOR_PARAMETERS.persistMinSpanHours.LEO} h`);
  console.log(`| zPersist | rhoMin | rhoMax | evidenceMin | span h | headline hits | hits | raised | false alarms${payloads ? "" : " (non-payload)"} |`);
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const zPersist of grid.zPersist!) for (const rhoMin of grid.rhoMin!) for (const rhoMax of grid.rhoMax!) for (const evidenceMin of grid.evidenceMin!) for (const spanHours of grid.spanHours!) {
    const t = tally(files, { zPersist, rhoMin, rhoMax, evidenceMin, spanHours });
    console.log(`| ${zPersist} | ${rhoMin} | ${rhoMax} | ${evidenceMin} | ${spanHours} | ${t.headlineHits} of ${t.headlineTargets} | ${t.hits} of ${t.targets} | ${t.raised} | ${payloads ? t.falseAlarms : t.falseAlarmsNonPayload} |`);
    if (show) console.log(`  hit: ${t.hit.join(", ")}; the smallest first-set size among them ${t.minZ1.toFixed(1)} sigma`);
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("sweep.ts")) main();
