import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BODY_CLASSES, DETECTOR_PARAMETERS, REGIMES, type BodyClass, type LogRow, type OpsStatus, type Regime, type ScopeGates, type ScopePolicy } from "../../src/index.ts";
import { dayOf, endedByOf, isWorkingStatus, operationalAt, opsStatusOf, regimeOf } from "../../src/elements.ts";
import { OPEN_GATES, WHOLE_CATALOGUE, inScope, passesGates, type GatedStep, type ScopeSubject } from "../../src/scope.ts";
import { archiveHome, builtYears, readBodies, readYear } from "../archive/archive.ts";
import { dissectAll, type Cause } from "./events.ts";
import { alertKey, alertRowsOf, type YearFile } from "./kpi.ts";
import type { ScoredEvent } from "./match.ts";
import { DAY_MS } from "./replay.ts";
import { readTruth, readYearFiles } from "./run.ts";

/**
 * The scope study: which population of parents, with which strict gates,
 * brings the parent-step channel to the owner's target (nine breakups in
 * ten detected, under one false alarm in ten alerts), read off a replay's
 * year files without replaying. A scope is a predicate on the parent at
 * the time of the step (`inScope` in `src/scope.ts`), applied alike to the
 * reported events, which are the targets, and to the alerts, so the
 * detection rate and the false-alarm rate are measured on one population;
 * the gates (`passesGates`) and a persistence tier are applied to the
 * alerts the replay raised. A detection is the first alert on the event's
 * parent and step, in scope and through the gates, raised (at the tier's
 * instant where a tier is asked) before the catalogue's first fragment and
 * any notice; one after that is late; an event with none is missed. A
 * false alarm is an alert the matcher landed as one (or the same step
 * raised again), in scope and through the gates, counted once per step.
 * The gates only take alerts away, so reading the replay's alerts is
 * exact for them; a scoped detector that raised differently upstream
 * would need a replay, which the committed scorecard is.
 *
 * The parent of an event is read at the event's lower edge from the
 * Archive (its last set before: regime, perigee, drag term), the body
 * tables (class, launch, today's status, GCAT's dated end of transmission)
 * and the replay's own record (its last persistent step before); the
 * parent of an alert at the step's first post set from the alert's
 * evidence, the same body tables and the same record. The training split
 * is the even years and every operating point is chosen there; the odd
 * years are read once at the point chosen, with Wilson intervals, and the
 * chronological halves beside them.
 *
 * `node --experimental-strip-types scripts/kpi/scope.ts <kpi dir> [--status dated|today|none] [--misses] [--show <scope>]`
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** What the body tables say of an object, merged over the years (the latest table wins). */
interface BodyFacts {
  bodyClass: BodyClass;
  launchMs: number;
  opsStatus: OpsStatus;
  endedByMs: number | null;
  endedFromMs: number | null;
}

export type StatusMode = "dated" | "today" | "none";

function bodyFacts(archive: string): Map<number, BodyFacts> {
  const facts = new Map<number, BodyFacts>();
  for (const year of builtYears(archive)) {
    for (const body of readBodies(archive, year)) {
      facts.set(body.number, { bodyClass: body.bodyClass, launchMs: body.launch === null ? Number.NaN : Date.parse(`${body.launch}T00:00:00Z`), opsStatus: opsStatusOf(body.opsStatus), endedByMs: endedByOf(body.endedOn), endedFromMs: dayOf(body.endedFrom) });
    }
  }
  return facts;
}

/** The status the scope reads at an instant, by the mode: dated (GCAT's end of transmission as of the instant), today's, or none. */
export function statusFor(facts: BodyFacts | undefined, at: number, mode: StatusMode): OpsStatus {
  if (facts === undefined || mode === "none") return "unknown";
  return operationalAt(facts, at, { opsStatusDated: mode === "dated", endedUnknownDays: DETECTOR_PARAMETERS.endedUnknownDays });
}

/** Every persistent step of the replay (a close row raised or read as a manoeuvre), by object, its first post set's epoch, sorted. */
function persistentSteps(files: YearFile[]): Map<number, number[]> {
  const steps = new Map<number, number[]>();
  for (const file of files) for (const row of file.log) if (row.signals.phase === 2 && (row.signals.outcome === 1 || row.signals.outcome === 5) && row.signals.afterEpoch !== undefined) (steps.get(row.number) ?? steps.set(row.number, []).get(row.number)!).push(row.signals.afterEpoch);
  for (const list of steps.values()) list.sort((a, b) => a - b);
  return steps;
}

/** Days from the object's last persistent step strictly before an instant (with an hour's slack, so a step is not its own record) to it; infinite with none. */
function daysSinceStepBefore(steps: Map<number, number[]>, number: number, at: number): number {
  const list = steps.get(number);
  if (list === undefined) return Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const epoch of list) if (epoch < at - 3_600_000) last = epoch;
  return Number.isFinite(last) ? (at - last) / DAY_MS : Number.POSITIVE_INFINITY;
}

/** The parent's orbit at an event's lower edge, from its last set before it in the Archive. */
interface OrbitAt {
  regime: Regime;
  perigeeKm: number;
  bstar: number;
}

/** The orbits of the events' parents at their lower edges, read from the Archive once and cached beside the year files. */
function orbitsAt(archive: string, events: { id: string; parent: number; from: number }[], cachePath: string): Map<string, OrbitAt | null> {
  const cached: Record<string, OrbitAt | null> = existsSync(cachePath) ? (JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, OrbitAt | null>) : {};
  const missing = events.filter((e) => !(e.id in cached));
  if (missing.length > 0) {
    const years = builtYears(archive);
    const best = new Map<string, { epoch: number; meanMotion: number; eccentricity: number; bstar: number }>();
    const wanted = new Map<number, { id: string; from: number }[]>();
    for (const e of missing) (wanted.get(e.parent) ?? wanted.set(e.parent, []).get(e.parent)!).push({ id: e.id, from: e.from });
    const firstYear = Math.min(...missing.map((e) => new Date(e.from).getUTCFullYear())) - 1;
    const lastYear = Math.max(...missing.map((e) => new Date(e.from).getUTCFullYear()));
    for (const year of years.filter((y) => y >= firstYear && y <= lastYear)) {
      const { columns } = readYear(archive, year, ["number", "epoch", "meanMotion", "eccentricity", "bstar"]);
      const n = columns.number.length;
      for (let i = 0; i < n; i++) {
        const list = wanted.get(columns.number[i]!);
        if (list === undefined) continue;
        const epoch = columns.epoch[i]!;
        for (const w of list) {
          if (epoch >= w.from) continue;
          const b = best.get(w.id);
          if (b === undefined || epoch > b.epoch) best.set(w.id, { epoch, meanMotion: columns.meanMotion[i]! / 1e8, eccentricity: columns.eccentricity[i]! / 1e7, bstar: columns.bstar[i]! });
        }
      }
      console.error(`orbits: read ${year}`);
    }
    for (const e of missing) {
      const b = best.get(e.id);
      if (b === undefined || e.from - b.epoch > 365 * DAY_MS) {
        cached[e.id] = null;
        continue;
      }
      const a = 42241.09769 / Math.pow(b.meanMotion, 2 / 3);
      cached[e.id] = { regime: regimeOf(b), perigeeKm: a * (1 - b.eccentricity) - 6378.137, bstar: b.bstar };
    }
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify(cached)}\n`);
  }
  return new Map(events.map((e) => [e.id, cached[e.id] ?? null]));
}

/** A target of the study: a scored event and its parent at the event. */
export interface StudyTarget {
  year: number;
  event: ScoredEvent;
  subject: ScopeSubject;
  /** The alerts on the event's parent and step, in the order raised: the detection or the late alert and the parent's duplicates. */
  alerts: StudyAlert[];
  deadline: number;
}

/** An alert of the study: where the matcher landed it, its parent at the step, what the gates read, and when each tier was reached. */
export interface StudyAlert {
  year: number;
  number: number;
  raisedAt: number;
  outcome: string;
  event: string | null;
  beforeEpoch: number;
  afterEpoch: number;
  subject: ScopeSubject;
  gated: GatedStep;
  /** The instant each persistence tier was reached with the step still held, by key; absent where it was not. */
  tiers: Partial<Record<TierKey, number>>;
}

export const TIER_KEYS = ["raised", "3", "5", "D1", "D3", "D5", "D7"] as const;
export type TierKey = (typeof TIER_KEYS)[number];

export interface StudyData {
  targets: StudyTarget[];
  /** The false alarms, grouped by step: an alert the matcher landed as a false alarm with the same step raised again. */
  falseAlarms: StudyAlert[][];
}

const ev = (evidence: Record<string, number>, name: string): number => evidence[name] ?? Number.NaN;

/** The study's targets and false alarms from a replay's year files. */
export function studyData(files: YearFile[], facts: Map<number, BodyFacts>, orbits: Map<string, OrbitAt | null>, mode: StatusMode, truthOrbit: Map<string, { regime: Regime; perigeeKm: number | null }>): StudyData {
  const steps = persistentSteps(files);
  const rows = alertRowsOf(files);
  const targets: StudyTarget[] = [];
  const falseAlarms: StudyAlert[][] = [];
  for (const file of files) {
    const alerts: StudyAlert[] = [];
    for (const alert of file.score.alerts) {
      if (alert.outcome === "confirmation" || alert.outcome === "exempt") continue;
      const verdict = file.verdicts[alert.verdict]!;
      if (verdict.step === null) continue;
      const e = verdict.evidence;
      const at = verdict.step.afterEpoch;
      const f = facts.get(alert.number);
      const subject: ScopeSubject = {
        bodyClass: BODY_CLASSES[e.bodyClass ?? 3] ?? f?.bodyClass ?? "unknown",
        status: statusFor(f, at, mode),
        regime: REGIMES[e.regime ?? 4] ?? "unknown",
        perigeeKm: ev(e, "perigeeKm"),
        bstar: ev(e, "bstar"),
        ageDays: f === undefined ? Number.NaN : (at - f.launchMs) / DAY_MS,
        daysSinceStep: daysSinceStepBefore(steps, alert.number, at),
      };
      const row: LogRow | undefined = rows.get(alertKey(alert.number, at));
      const tiers: Partial<Record<TierKey, number>> = { raised: alert.raisedAt };
      // A tier reached before the alert was raised (a step read as a manoeuvre, promoted later by the pieces) raises nothing before the alert itself.
      for (const key of TIER_KEYS) if (key !== "raised" && row?.signals[`tier${key}Held`] === 1) tiers[key] = Math.max(row.signals[`tier${key}At`]!, alert.raisedAt);
      alerts.push({ year: file.year, number: alert.number, raisedAt: alert.raisedAt, outcome: alert.outcome, event: alert.event, beforeEpoch: verdict.step.beforeEpoch, afterEpoch: at, subject, gated: { zk: ev(e, "zk"), deltaKm: ev(e, "deltaKm"), deltaVMps: ev(e, "deltaVMps"), bstarRatio: ev(e, "bstarRatio"), impulseConsistency: ev(e, "impulseConsistency"), explanations: e.explanations ?? 0 }, tiers });
    }
    for (const event of file.score.events) {
      const f = facts.get(event.parent);
      const orbit = orbits.get(event.id) ?? null;
      const stated = truthOrbit.get(event.id);
      const subject: ScopeSubject = {
        bodyClass: f?.bodyClass ?? "unknown",
        status: statusFor(f, event.from, mode),
        regime: orbit?.regime ?? stated?.regime ?? event.regime,
        perigeeKm: orbit?.perigeeKm ?? stated?.perigeeKm ?? Number.NaN,
        bstar: orbit?.bstar ?? Number.NaN,
        ageDays: f === undefined ? Number.NaN : (event.from - f.launchMs) / DAY_MS,
        daysSinceStep: daysSinceStepBefore(steps, event.parent, event.from),
      };
      const own = alerts.filter((a) => a.event === event.id && a.number === event.parent && (a.outcome === "detection" || a.outcome === "late" || a.outcome === "duplicate")).sort((a, b) => a.raisedAt - b.raisedAt);
      targets.push({ year: file.year, event, subject, alerts: own, deadline: Math.min(event.catalogueAt ?? Number.POSITIVE_INFINITY, event.noticeAt ?? Number.POSITIVE_INFINITY) });
    }
    // The false alarms, with the same step raised again joined to them.
    const groups: StudyAlert[][] = [];
    for (const a of alerts.filter((x) => x.outcome === "false-alarm" || (x.outcome === "duplicate" && x.event === null)).sort((x, y) => x.raisedAt - y.raisedAt)) {
      const group = groups.find((g) => g[0]!.number === a.number && g.some((b) => b.beforeEpoch <= a.afterEpoch && a.beforeEpoch <= b.afterEpoch));
      if (group === undefined) groups.push([a]);
      else group.push(a);
    }
    falseAlarms.push(...groups);
  }
  return { targets, falseAlarms };
}

/** An operating point: the scope, the gates and the tier at which a scoped alert is raised. */
export interface Point {
  gates: ScopeGates;
  tier: TierKey;
}

/** When an alert would be raised at the point; null where the gates or the tier refuse it. */
function raisedUnder(alert: StudyAlert, scope: ScopePolicy, point: Point): number | null {
  if (!inScope(alert.subject, scope) || !passesGates(alert.gated, point.gates)) return null;
  return alert.tiers[point.tier] ?? null;
}

export interface Reading {
  /** Headline targets in scope and in all (detectable), the scope's kept share, and the outcome. */
  headlineTargets: number;
  headlineAll: number;
  headlineUndetectableInScope: number;
  detected: number;
  late: number;
  /** Detections on every line in scope, for the false-alarm rate. */
  detectedAllLines: number;
  falseAlarms: number;
  hits: string[];
}

export function read(data: StudyData, years: Set<number>, scope: ScopePolicy, point: Point): Reading {
  const r: Reading = { headlineTargets: 0, headlineAll: 0, headlineUndetectableInScope: 0, detected: 0, late: 0, detectedAllLines: 0, falseAlarms: 0, hits: [] };
  for (const t of data.targets) {
    if (!years.has(t.year)) continue;
    const headline = t.event.line === "breakups A-B";
    const detectable = t.event.status !== "undetectable";
    if (headline && detectable) r.headlineAll++;
    if (!inScope(t.subject, scope)) continue;
    if (!detectable) {
      if (headline) r.headlineUndetectableInScope++;
      continue;
    }
    if (headline) r.headlineTargets++;
    let outcome: "detected" | "late" | "missed" = "missed";
    for (const a of t.alerts) {
      const at = raisedUnder(a, scope, point);
      if (at === null) continue;
      outcome = at < t.deadline ? "detected" : "late";
      break;
    }
    if (outcome === "detected") {
      r.detectedAllLines++;
      if (headline) {
        r.detected++;
        r.hits.push(t.event.id);
      }
    } else if (outcome === "late" && headline) r.late++;
  }
  for (const group of data.falseAlarms) {
    if (!years.has(group[0]!.year)) continue;
    if (group.some((a) => raisedUnder(a, scope, point) !== null)) r.falseAlarms++;
  }
  return r;
}

/** The Wilson score interval of a proportion, 95%; null where n is zero. */
export function wilson(k: number, n: number, z = 1.96): [number, number] | null {
  if (n === 0) return null;
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export const faRate = (r: Reading): number | null => (r.falseAlarms + r.detectedAllLines === 0 ? null : r.falseAlarms / (r.falseAlarms + r.detectedAllLines));

/** The gates' grid the study searches on the training years. */
export const GRID = {
  zMin: [0, 15, 20, 30, 50, 100, 300],
  deltaMinKm: [0, 0.03, 0.1, 0.3, 1, 3],
  deltaVMinMps: [0, 0.03, 0.1, 0.3, 1],
  bstarRatioMin: [0, 1.5, 2, 3, 5],
  consistencyMin: [0, 9, 100],
  unexplainedOnly: [false, true],
  tier: ["raised", "3", "5", "D1", "D3", "D5", "D7"] as TierKey[],
};

export function* points(): Generator<Point> {
  for (const tier of GRID.tier) for (const zMin of GRID.zMin) for (const deltaMinKm of GRID.deltaMinKm) for (const deltaVMinMps of GRID.deltaVMinMps) for (const bstarRatioMin of GRID.bstarRatioMin) for (const consistencyMin of GRID.consistencyMin) for (const unexplainedOnly of GRID.unexplainedOnly) yield { tier, gates: { zMin, deltaMinKm, deltaVMinMps, bstarRatioMin, consistencyMin, unexplainedOnly } };
}

/** How strict a point is, for the tie-break: the loosest point with the best reading is chosen. */
const strictness = (p: Point): number => GRID.tier.indexOf(p.tier) + GRID.zMin.indexOf(p.gates.zMin) + GRID.deltaMinKm.indexOf(p.gates.deltaMinKm) + GRID.deltaVMinMps.indexOf(p.gates.deltaVMinMps) + GRID.bstarRatioMin.indexOf(p.gates.bstarRatioMin) + GRID.consistencyMin.indexOf(p.gates.consistencyMin) + (p.gates.unexplainedOnly ? 1 : 0);

/** The target's false-alarm rate. */
export const FA_TARGET = 0.1;

export interface Fit {
  point: Point;
  train: Reading;
  /** Whether the point reaches the false-alarm target on the training years. */
  feasible: boolean;
  /** The training frontier: for each count of headline detections, the fewest false alarms any point reached with it. */
  frontier: { detected: number; falseAlarms: number; detectedAllLines: number; point: Point }[];
}

/** The operating point chosen on the training years: the most headline detections at a false-alarm rate within the target, then the most detections on every line, then the fewest false alarms, then the loosest gates; where no point reaches the target, the point nearest it (the larger of the two shortfalls smallest). */
export function fit(all: StudyData, years: Set<number>, scope: ScopePolicy): Fit {
  // The years and the scope first, so the grid reads only what can count.
  const data: StudyData = { targets: all.targets.filter((t) => years.has(t.year)), falseAlarms: all.falseAlarms.filter((g) => years.has(g[0]!.year) && g.some((a) => inScope(a.subject, scope))) };
  let best: { point: Point; reading: Reading } | null = null;
  let fallback: { point: Point; reading: Reading } | null = null;
  const frontier = new Map<number, { detected: number; falseAlarms: number; detectedAllLines: number; point: Point }>();
  for (const point of points()) {
    const reading = read(data, years, scope, point);
    const rate = faRate(reading);
    const f = frontier.get(reading.detected);
    if (f === undefined || reading.falseAlarms < f.falseAlarms || (reading.falseAlarms === f.falseAlarms && reading.detectedAllLines > f.detectedAllLines)) frontier.set(reading.detected, { detected: reading.detected, falseAlarms: reading.falseAlarms, detectedAllLines: reading.detectedAllLines, point });
    if (rate !== null && rate <= FA_TARGET && reading.detected > 0) {
      const better = best === null || reading.detected > best.reading.detected || (reading.detected === best.reading.detected && (reading.detectedAllLines > best.reading.detectedAllLines || (reading.detectedAllLines === best.reading.detectedAllLines && (reading.falseAlarms < best.reading.falseAlarms || (reading.falseAlarms === best.reading.falseAlarms && strictness(point) < strictness(best.point))))));
      if (better) best = { point, reading };
    }
    if (reading.detected > 0 && rate !== null) {
      const fr = fallback === null ? Number.POSITIVE_INFINITY : faRate(fallback.reading)!;
      if (fallback === null || rate < fr || (rate === fr && reading.detected > fallback.reading.detected)) fallback = { point, reading };
    }
  }
  // Where no point reaches the target: the point nearest it, the larger of the two shortfalls (recall under nine in ten, the false-alarm rate over one in ten) the smallest, then the most headline detections.
  if (best === null) {
    let nearest: { point: Point; reading: Reading; gap: number } | null = null;
    for (const point of points()) {
      const reading = read(data, years, scope, point);
      const rate = faRate(reading);
      if (rate === null || reading.headlineTargets === 0 || reading.detected === 0) continue;
      const gap = Math.max(0.9 - reading.detected / reading.headlineTargets, rate - FA_TARGET);
      if (nearest === null || gap < nearest.gap - 1e-12 || (Math.abs(gap - nearest.gap) <= 1e-12 && (reading.detected > nearest.reading.detected || (reading.detected === nearest.reading.detected && strictness(point) < strictness(nearest.point))))) nearest = { point, reading, gap };
    }
    if (nearest !== null) fallback = nearest;
  }
  const chosen = best ?? fallback ?? { point: { tier: "raised" as TierKey, gates: OPEN_GATES }, reading: read(data, years, scope, { tier: "raised", gates: OPEN_GATES }) };
  // The frontier keeps only the points no other dominates: more detections at as few false alarms.
  const sorted = [...frontier.values()].sort((a, b) => b.detected - a.detected);
  const pareto: typeof sorted = [];
  let floor = Number.POSITIVE_INFINITY;
  for (const p of sorted) if (p.falseAlarms < floor) {
    pareto.push(p);
    floor = p.falseAlarms;
  }
  return { point: chosen.point, train: chosen.reading, feasible: best !== null, frontier: pareto.reverse() };
}

/** The scopes the study tests: the hypotheses of the seventh phase, each a policy. */
export function hypotheses(): { name: string; scope: ScopePolicy }[] {
  const W = WHOLE_CATALOGUE;
  const nonPayload: BodyClass[] = ["rocket body", "debris", "unknown"];
  const dead = { classes: ["payload"] as BodyClass[], payloadsNotWorking: true, unknownPayloads: false };
  const deadOrNonPayload = { classes: ["payload", ...nonPayload] as BodyClass[], payloadsNotWorking: true, unknownPayloads: false };
  const leo = { regimes: ["LEO"] as Regime[] };
  return [
    { name: "the whole catalogue", scope: W },
    { name: "(a) payloads dead at the step", scope: { ...W, ...dead } },
    { name: "(b) rocket bodies", scope: { ...W, classes: ["rocket body"] } },
    { name: "(c) non-payloads", scope: { ...W, classes: nonPayload } },
    { name: "(d) dead payloads and rocket bodies", scope: { ...W, classes: ["payload", "rocket body"], payloadsNotWorking: true, unknownPayloads: false } },
    { name: "(d') dead payloads and non-payloads", scope: { ...W, ...deadOrNonPayload } },
    { name: "(d'') payloads not known working, and non-payloads", scope: { ...W, ...deadOrNonPayload, unknownPayloads: true } },
    { name: "(e) LEO", scope: { ...W, ...leo } },
    { name: "(e) LEO, perigee 600 to 2,000 km", scope: { ...W, ...leo, perigeeMinKm: 600 } },
    { name: "(e) perigee above 500 km", scope: { ...W, perigeeMinKm: 500 } },
    { name: "(f) older than a year", scope: { ...W, minAgeDays: 365 } },
    { name: "(f) older than five years", scope: { ...W, minAgeDays: 5 * 365 } },
    { name: "(g) no persistent step in the year before", scope: { ...W, quietDays: 365 } },
    { name: "(g) no persistent step in the two years before", scope: { ...W, quietDays: 730 } },
    { name: "(h) drag term under 1e-4", scope: { ...W, bstarMax: 1e-4 } },
    { name: "(h) drag term under 3e-5", scope: { ...W, bstarMax: 3e-5 } },
    { name: "(i) not highly elliptical", scope: { ...W, regimes: ["LEO", "MEO", "GEO"] } },
    { name: "(j) non-payloads in LEO", scope: { ...W, classes: nonPayload, ...leo } },
    { name: "(j) dead payloads and non-payloads in LEO", scope: { ...W, ...deadOrNonPayload, ...leo } },
    { name: "(j) dead payloads and non-payloads, perigee above 500 km", scope: { ...W, ...deadOrNonPayload, perigeeMinKm: 500 } },
    { name: "(j) dead payloads and non-payloads in LEO, older than a year", scope: { ...W, ...deadOrNonPayload, ...leo, minAgeDays: 365 } },
    { name: "(j) dead payloads and non-payloads in LEO, quiet a year", scope: { ...W, ...deadOrNonPayload, ...leo, quietDays: 365 } },
    { name: "(j) dead payloads and non-payloads in LEO above 500 km, older than a year", scope: { ...W, ...deadOrNonPayload, ...leo, perigeeMinKm: 500, minAgeDays: 365 } },
    { name: "(j) dead payloads and non-payloads in LEO above 500 km, older than a year, quiet a year", scope: { ...W, ...deadOrNonPayload, ...leo, perigeeMinKm: 500, minAgeDays: 365, quietDays: 365 } },
    { name: "(j) dead payloads and rocket bodies in LEO above 500 km, older than a year", scope: { ...W, classes: ["payload", "rocket body"], payloadsNotWorking: true, unknownPayloads: false, ...leo, perigeeMinKm: 500, minAgeDays: 365 } },
    { name: "(j) payloads not known working and non-payloads in LEO above 500 km, older than a year", scope: { ...W, ...deadOrNonPayload, unknownPayloads: true, ...leo, perigeeMinKm: 500, minAgeDays: 365 } },
    { name: "(j) rocket bodies in LEO above 500 km, older than a year", scope: { ...W, classes: ["rocket body"], ...leo, perigeeMinKm: 500, minAgeDays: 365 } },
    { name: "(j) not highly elliptical, older than a year, quiet a year", scope: { ...W, regimes: ["LEO", "MEO", "GEO"], minAgeDays: 365, quietDays: 365 } },
    { name: "(k) the exclusions the misses support: perigee 400 km or more", scope: { ...W, perigeeMinKm: 400 } },
    { name: "(k) the exclusions the misses support: perigee 400 km or more, older than a year", scope: { ...W, perigeeMinKm: 400, minAgeDays: 365 } },
  ];
}

const pct = (x: number | null): string => (x === null ? "–" : `${Math.round(100 * x)}%`);
const interval = (k: number, n: number): string => {
  const w = wilson(k, n);
  return w === null ? "–" : `${pct(k / n)} (${pct(w[0])}–${pct(w[1])})`;
};
/** The false-alarm rate with its interval: one less the precision's. */
const faInterval = (r: Reading): string => {
  const n = r.falseAlarms + r.detectedAllLines;
  const w = wilson(r.detectedAllLines, n);
  return w === null ? "–" : `${pct(r.falseAlarms / n)} (${pct(1 - w[1])}–${pct(1 - w[0])})`;
};

export function describePoint(p: Point): string {
  const parts: string[] = [];
  if (p.tier !== "raised") parts.push(`held at ${p.tier.startsWith("D") ? `${p.tier.slice(1)} d` : `${p.tier} sets`}`);
  if (p.gates.zMin > 0) parts.push(`z ≥ ${p.gates.zMin}`);
  if (p.gates.deltaMinKm > 0) parts.push(`Δa ≥ ${p.gates.deltaMinKm * 1000} m`);
  if (p.gates.deltaVMinMps > 0) parts.push(`ΔV ≥ ${p.gates.deltaVMinMps} m/s`);
  if (p.gates.bstarRatioMin > 1) parts.push(`B* ratio ≥ ${p.gates.bstarRatioMin}`);
  if (p.gates.consistencyMin > 0) parts.push(`kick χ² ≥ ${p.gates.consistencyMin}`);
  if (p.gates.unexplainedOnly) parts.push("unexplained only");
  return parts.length === 0 ? "as raised" : parts.join(", ");
}

const cell = (r: Reading): string => `${r.detected}/${r.headlineTargets}, late ${r.late}; FA ${r.falseAlarms}, D(all) ${r.detectedAllLines}`;

const EVEN = (y: number): boolean => y % 2 === 0;

function hypothesisTable(data: StudyData, years: number[]): string[] {
  const train = new Set(years.filter(EVEN));
  const validation = new Set(years.filter((y) => !EVEN(y)));
  const early = new Set(years.filter((y) => y <= 2017));
  const late = new Set(years.filter((y) => y >= 2018));
  const all = new Set(years);
  const out = [
    "| Scope | Headline targets kept (all years) | Gates chosen on training | Training: detected/targets, false alarms | Training recall (95%) | Training FA rate (95%) | Validation: detected/targets, false alarms | Validation recall (95%) | Validation FA rate (95%) | ≤ 2017 | ≥ 2018 | Reaches 90/10 on training? |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  const frontiers: string[] = [];
  for (const { name, scope } of hypotheses()) {
    const f = fit(data, train, scope);
    const v = read(data, validation, scope, f.point);
    const e = read(data, early, scope, f.point);
    const l = read(data, late, scope, f.point);
    const everywhere = read(data, all, scope, { tier: "raised", gates: OPEN_GATES });
    const reaches = f.feasible && f.train.headlineTargets > 0 && f.train.detected / f.train.headlineTargets >= 0.9;
    const small = Math.min(v.headlineTargets, f.train.headlineTargets) < 8 ? " (fewer than 8 targets on a split: reported, not proposed)" : "";
    out.push(`| ${name}${small} | ${everywhere.headlineTargets} of ${everywhere.headlineAll} (${pct(everywhere.headlineTargets / everywhere.headlineAll)}) | ${describePoint(f.point)}${f.feasible ? "" : " (no point reaches 10%: the nearest)"} | ${cell(f.train)} | ${interval(f.train.detected, f.train.headlineTargets)} | ${faInterval(f.train)} | ${cell(v)} | ${interval(v.detected, v.headlineTargets)} | ${faInterval(v)} | ${e.detected}/${e.headlineTargets}, FA ${e.falseAlarms} | ${l.detected}/${l.headlineTargets}, FA ${l.falseAlarms} | ${reaches ? "yes" : "no"} |`);
    frontiers.push(`- ${name}: ${f.frontier.map((p) => `${p.detected} hits at ${p.falseAlarms} FA (${p.detectedAllLines} on every line; ${describePoint(p.point)})`).join("; ")}`);
  }
  return [...out, "", "The training frontier per scope (headline hits against the fewest false alarms any point reached with them):", "", ...frontiers];
}

/** Each scope as raised (the whole-catalogue gates) and at its training frontier's points, each read on the training and the validation years: the frontier the owner trades on. */
function frontierTable(data: StudyData, years: number[]): string[] {
  const train = new Set(years.filter(EVEN));
  const validation = new Set(years.filter((y) => !EVEN(y)));
  const out = ["| Scope | Operating point (chosen on training) | Training: recall (95%) | Training: FA rate (95%), false alarms | Validation: recall (95%) | Validation: FA rate (95%), false alarms |", "| --- | --- | --- | --- | --- | --- |"];
  for (const { name, scope } of hypotheses()) {
    const f = fit(data, train, scope);
    const rows: Point[] = [{ tier: "raised", gates: OPEN_GATES }, ...f.frontier.filter((p) => p.detected > 0).map((p) => p.point)];
    for (const point of rows) {
      const t = read(data, train, scope, point);
      const v = read(data, validation, scope, point);
      out.push(`| ${name} | ${describePoint(point)} | ${t.detected}/${t.headlineTargets}: ${interval(t.detected, t.headlineTargets)} | ${faInterval(t)}, ${t.falseAlarms} | ${v.detected}/${v.headlineTargets}: ${interval(v.detected, v.headlineTargets)} | ${faInterval(v)}, ${v.falseAlarms} |`);
    }
  }
  return out;
}

/** The always-missed analysis: every headline target of every year, by what it was at the event and how it came out. */
function missesTables(files: YearFile[], data: StudyData): string[] {
  const causes = new Map<string, Cause>(dissectAll(files).map((d) => [d.event.id, d.cause]));
  const targets = data.targets.filter((t) => t.event.line === "breakups A-B");
  const band = (t: StudyTarget): string => {
    const p = t.subject.perigeeKm;
    if (t.subject.regime === "HEO") return "highly elliptical";
    if (t.subject.regime === "GEO") return "geosynchronous";
    if (!Number.isFinite(p)) return "unknown";
    return p < 300 ? "under 300 km" : p < 500 ? "300 to 500 km" : p < 600 ? "500 to 600 km" : p < 800 ? "600 to 800 km" : p < 1000 ? "800 to 1,000 km" : p < 2000 ? "1,000 to 2,000 km" : "above 2,000 km";
  };
  const age = (t: StudyTarget): string => {
    const d = t.subject.ageDays;
    return !Number.isFinite(d) ? "unknown" : d < 365 ? "under a year" : d < 5 * 365 ? "1 to 5 years" : d < 15 * 365 ? "5 to 15 years" : "over 15 years";
  };
  const status = (t: StudyTarget): string => (t.subject.bodyClass !== "payload" ? "not a payload" : isWorkingStatus(t.subject.status) ? "payload working at the event" : t.subject.status === "nonoperational" ? "payload dead at the event" : "payload, status unknown at the event");
  const quiet = (t: StudyTarget): string => (t.subject.daysSinceStep < 365 ? "a persistent step in the year before" : t.subject.daysSinceStep < 730 ? "a step one to two years before" : "no step in two years");
  const dimensions: [string, (t: StudyTarget) => string][] = [
    ["regime", (t) => t.subject.regime],
    ["class", (t) => t.subject.bodyClass],
    ["perigee band", band],
    ["age from launch", age],
    ["status at the event (dated)", status],
    ["record", quiet],
    ["cause", (t) => causes.get(t.event.id) ?? "?"],
  ];
  const out: string[] = [];
  for (const [title, key] of dimensions) {
    const groups = new Map<string, Record<"detected" | "late" | "missed" | "undetectable", number>>();
    for (const t of targets) {
      const g = groups.get(key(t)) ?? groups.set(key(t), { detected: 0, late: 0, missed: 0, undetectable: 0 }).get(key(t))!;
      g[t.event.status]++;
    }
    out.push(`| ${title} | events | detected | late | missed | undetectable | detected of detectable |`, "| --- | --- | --- | --- | --- | --- | --- |");
    for (const [k, g] of [...groups].sort((a, b) => b[1].detected + b[1].late + b[1].missed + b[1].undetectable - (a[1].detected + a[1].late + a[1].missed + a[1].undetectable))) {
      const n = g.detected + g.late + g.missed + g.undetectable;
      out.push(`| ${k} | ${n} | ${g.detected} | ${g.late} | ${g.missed} | ${g.undetectable} | ${interval(g.detected, g.detected + g.late + g.missed)} |`);
    }
    out.push("");
  }
  // Every headline target, with what the scope reads of it.
  out.push("| year | event | outcome | cause | regime | class | perigee km | age y | status | days since a step |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const t of targets) out.push(`| ${t.year} | ${t.event.name} (${t.event.parent}) | ${t.event.status} | ${causes.get(t.event.id) ?? "?"} | ${t.subject.regime} | ${t.subject.bodyClass} | ${Number.isFinite(t.subject.perigeeKm) ? t.subject.perigeeKm.toFixed(0) : "–"} | ${Number.isFinite(t.subject.ageDays) ? (t.subject.ageDays / 365.25).toFixed(1) : "–"} | ${t.subject.status} | ${Number.isFinite(t.subject.daysSinceStep) ? t.subject.daysSinceStep.toFixed(0) : "none"} |`);
  return out;
}

/** The study's data for a replay's year files, by status mode. */
export function loadStudy(dir: string, mode: StatusMode): { files: YearFile[]; data: StudyData } {
  const archive = archiveHome();
  const files = readYearFiles(dir);
  if (files.length === 0) throw new Error(`no year files under ${dir}/years`);
  const facts = bodyFacts(archive);
  const events = files.flatMap((f) => f.score.events.map((e) => ({ id: e.id, parent: e.parent, from: e.from })));
  const orbits = orbitsAt(archive, events, join(ROOT, "kpi/work/scope-orbits.json"));
  const truth = readTruth().breakups;
  const truthOrbit = new Map(truth.map((b) => [b.id, { regime: b.orbit.regime, perigeeKm: b.orbit.perigeeKm }]));
  return { files, data: studyData(files, facts, orbits, mode, truthOrbit) };
}

function main(): void {
  const args = process.argv.slice(2);
  const dir = resolve(args[0] ?? join(ROOT, "kpi"));
  const mode = (args.includes("--status") ? args[args.indexOf("--status") + 1] : "dated") as StatusMode;
  if (!["dated", "today", "none"].includes(mode)) throw new Error("--status dated|today|none");
  const { files, data } = loadStudy(dir, mode);
  const years = files.map((f) => f.year);
  if (args.includes("--misses")) {
    for (const line of missesTables(files, data)) console.log(line);
    return;
  }
  if (args.includes("--frontier")) {
    for (const line of frontierTable(data, years)) console.log(line);
    return;
  }
  if (args.includes("--show")) {
    const name = args[args.indexOf("--show") + 1]!;
    const h = hypotheses().find((x) => x.name.startsWith(name));
    if (h === undefined) throw new Error(`no scope named ${name}`);
    const f = fit(data, new Set(years.filter(EVEN)), h.scope);
    for (const [label, ys] of [["training", years.filter(EVEN)], ["validation", years.filter((y) => !EVEN(y))]] as const) {
      const r = read(data, new Set(ys), h.scope, f.point);
      console.log(`${h.name}, ${describePoint(f.point)}, ${label}: ${cell(r)}; hits ${r.hits.join(", ")}`);
      for (const group of data.falseAlarms) {
        if (!ys.includes(group[0]!.year)) continue;
        const a = group.find((x) => raisedUnder(x, h.scope, f.point) !== null);
        if (a === undefined) continue;
        console.log(`  FA ${new Date(a.afterEpoch).toISOString().slice(0, 10)} ${a.number} ${a.subject.bodyClass} ${a.subject.regime} rp ${a.subject.perigeeKm.toFixed(0)} age ${(a.subject.ageDays / 365.25).toFixed(1)} y status ${a.subject.status} z ${a.gated.zk} Δa ${a.gated.deltaKm} ΔV ${a.gated.deltaVMps} B* ratio ${a.gated.bstarRatio} explanations ${a.gated.explanations}`);
      }
      for (const t of data.targets) if (ys.includes(t.year) && t.event.line === "breakups A-B" && t.event.status !== "undetectable" && inScope(t.subject, h.scope) && !r.hits.includes(t.event.id)) console.log(`  missed in scope: ${t.event.id} ${t.event.name} (${t.event.status}); its alerts: ${t.alerts.map((a) => `${a.outcome} in scope ${inScope(a.subject, h.scope)} gates ${passesGates(a.gated, f.point.gates)} z ${a.gated.zk} Δa ${a.gated.deltaKm} ΔV ${a.gated.deltaVMps} B* ${a.gated.bstarRatio} expl ${a.gated.explanations}`).join("; ") || "none"}`);
    }
    return;
  }
  console.log(`${dir}: status read ${mode}; ${data.targets.length} scored events, ${data.falseAlarms.length} false-alarm steps`);
  for (const line of hypothesisTable(data, years)) console.log(line);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("scope.ts")) main();
