import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { BODY_CLASSES, DETECTOR_PARAMETERS, MANOEUVRE_CLASSES, OPS_STATUSES, REGIMES, deltaVOfAxisChange, foldedRatio, isWorkingStatus, planeDistance, poissonTail, readBreakups, readStatements, type BodyClass, type Breakup, type PlaneOrbit, type Regime, type Statement, type Step, type Verdict } from "../../src/index.ts";
import { archiveHome } from "../archive/archive.ts";
import { gcatStatements, parseGcat } from "../truth/parse-gcat.ts";
import type { YearFile } from "./kpi.ts";
import { readCatalogue, type BodyFact, type Catalogue, type ParentSet } from "./catalogue.ts";
import { MATCH_MARGIN_DAYS } from "./match.ts";
import { ANALYST_FLOOR, DAY_MS } from "./replay.ts";

/**
 * The truth audit of the eighth phase: how many of the scorecard's false
 * alarms are, by the owner's own definition, real events the truth
 * misses. The owner counts a breakup as reported when the catalogue
 * publishes element data for its fragments; the truth adds such events
 * only for a burst of five or more new debris objects of a launch within
 * thirty days, so a breakup that sheds one to four catalogued pieces is a
 * false alarm on the scorecard whatever happened.
 *
 * For every false alarm of the scoped line on both splits, and for a
 * seeded random sample of the whole catalogue's false alarms per split,
 * the Archive is read for the new bodies the parent's launch gained in
 * the year after the step: numbered above the catalogue's high-water mark
 * at the step (so not old bodies returning), first published after it,
 * with no set before it; each piece's first orbit against the parent's
 * last orbit before the step by the detector's own plane test (the node
 * carried at each orbit's J2 rate), and its change of semi-major axis as
 * a tangential impulse. GCAT's cloud table and the hand file are read for
 * any statement on the parent or the launch near the step, and the
 * alert's own drag-term ratio, kick and damage ratio are carried. Each
 * false alarm is then classed (`classOf`): (A) pieces in plane after the
 * step that no reported event, young launch or old cloud explains, a real
 * event by the owner's definition; (D) a data artefact; (B) no such
 * pieces but a breakup's signatures; (C) manoeuvre-like; (U) none of
 * these. Pieces in plane that a reported event of the parent or launch,
 * the launch's own first months, or an old cloud's late cataloguing
 * explain are counted apart and the alert classed by the rest.
 *
 * The re-score counts the class A false alarms as positives on each line:
 * an A alert raised before the launch's first new body was published
 * becomes a detection, one after it a late alert, and each A event joins
 * the targets, so the recall is not inflated by the added events alone.
 * For the whole catalogue, the sample's shares are carried to the split's
 * false alarms with their Wilson intervals.
 *
 * `node --experimental-strip-types scripts/kpi/audit.ts <kpi dir> [--seed 8] [--sample 300] [--out <dir>]`
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The window after the step in which the launch's new bodies are read. */
export const AFTER_DAYS = 365;
/** The shorter window the confirmation rules use, reported beside it. */
export const SHORT_DAYS = 90;
/** The class A test: at least this many fresh fragment-class pieces in the parent's plane, each moving at least this much from it. */
export const A_MIN_PIECES = 1;
export const A_MIN_DELTA_V_MPS = DETECTOR_PARAMETERS.confirmDeltaVMinMps;
/** The class B test: the drag term changed at least this many times over across the step, with a kick of this chi-squared. */
export const B_MIN_BSTAR_RATIO = 5;
export const B_MIN_KICK = 100;
/** The class D test: a parent re-entering within this many days of the step. */
export const D_DECAY_DAYS = 60;
/** Statements on the parent or its launch within this many days of the step are listed. */
export const STATEMENT_DAYS = 180;

type Split = "validation" | "train";
const splitOf = (year: number): Split => (year % 2 === 1 ? "validation" : "train");

/** A false alarm as the year files give it: the verdict's step and evidence, and its alert row's later readings. */
export interface FalseAlarm {
  year: number;
  split: Split;
  number: number;
  raisedAt: number;
  /** When the scoped line raised it (its tier's instant), or null where it is not a scoped false alarm. */
  scopedAt: number | null;
  step: Step;
  eventMs: number;
  regime: Regime;
  bodyClass: BodyClass;
  opsStatus: string;
  manoeuvreClass: string;
  explanationBits: number;
  signatureBits: number;
  bstarRatio: number;
  kick: number;
  deltaVMps: number;
  radialMps: number;
  perigeeKm: number;
  ageDays: number;
  damageRatio: number;
  heldD3: boolean;
  heldD7: boolean;
  /** The later sets' median share of the first jump when the step had three days of post sets; NaN where it never had them. */
  rhoD3: number;
  nearEvent: string | null;
  /** How the matcher landed the alert: a false alarm, or, for the calibration, a detection or a late alert. */
  outcome: "false-alarm" | "detection" | "late";
  /** Whether the detector's own confirmation rules confirmed the alert from the pieces or a notice. */
  confirmed: boolean;
}

const evidenceOf = (verdict: Verdict, name: string): number => verdict.evidence[name] ?? Number.NaN;

/** Every false alarm of every year file, and every alert on a reported event's step (detected or late) for the calibration, with the alert rows read across the files (an alert raised in December closes in the next year's). */
export function falseAlarmsOf(kpiDir: string): FalseAlarm[] {
  const dir = join(kpiDir, "years");
  const names = readdirSync(dir).filter((n) => /^\d{4}\.json\.gz$/.test(n)).sort();
  const rows = new Map<string, Record<string, number>>();
  const pending: { fa: FalseAlarm; key: string; scoped: boolean }[] = [];
  const tier = DETECTOR_PARAMETERS.scope.tier;
  for (const name of names) {
    const file = JSON.parse(gunzipSync(readFileSync(join(dir, name))).toString("utf8")) as YearFile;
    for (const row of file.log) if (row.signals.phase === 3 && row.signals.afterEpoch !== undefined) rows.set(`${row.number}:${Math.round(row.signals.afterEpoch)}`, row.signals);
    for (const alert of file.score.alerts) {
      if (alert.outcome !== "false-alarm" && alert.outcome !== "detection" && alert.outcome !== "late") continue;
      const verdict = file.verdicts[alert.verdict]!;
      if (verdict.step === null) continue;
      const regime = REGIMES[evidenceOf(verdict, "regime")] ?? "unknown";
      const fa: FalseAlarm = {
        year: file.year,
        split: splitOf(file.year),
        number: alert.number,
        raisedAt: alert.raisedAt,
        scopedAt: null,
        step: verdict.step,
        eventMs: verdict.event?.at ?? (verdict.step.beforeEpoch + verdict.step.afterEpoch) / 2,
        regime,
        bodyClass: BODY_CLASSES[evidenceOf(verdict, "bodyClass")] ?? "unknown",
        opsStatus: OPS_STATUSES[evidenceOf(verdict, "opsStatus")] ?? "unknown",
        manoeuvreClass: MANOEUVRE_CLASSES[evidenceOf(verdict, "manoeuvreClass")] ?? "unique",
        explanationBits: evidenceOf(verdict, "explanationBits"),
        signatureBits: evidenceOf(verdict, "signatureBits"),
        bstarRatio: foldedRatio(evidenceOf(verdict, "bstarRatio")),
        kick: evidenceOf(verdict, "impulseConsistency"),
        deltaVMps: evidenceOf(verdict, "deltaVMps"),
        radialMps: evidenceOf(verdict, "deltaVRadialMps"),
        perigeeKm: evidenceOf(verdict, "perigeeKm"),
        ageDays: evidenceOf(verdict, "ageFromLaunchDays"),
        damageRatio: Number.NaN,
        heldD3: false,
        heldD7: false,
        rhoD3: Number.NaN,
        nearEvent: alert.nearEvent ?? null,
        outcome: alert.outcome,
        confirmed: alert.confirmedAt !== null,
      };
      pending.push({ fa, key: `${alert.number}:${Math.round(verdict.step.afterEpoch)}`, scoped: alert.scoped === true });
    }
  }
  for (const { fa, key, scoped } of pending) {
    const row = rows.get(key);
    if (row === undefined) continue;
    fa.damageRatio = row.damageRatio ?? Number.NaN;
    fa.heldD3 = row.tierD3Held === 1;
    fa.heldD7 = row.tierD7Held === 1;
    fa.rhoD3 = row.tierD3Rho ?? Number.NaN;
    if (scoped) {
      if (tier === "raised") fa.scopedAt = fa.raisedAt;
      else if (row[`tier${tier}Held`] === 1) fa.scopedAt = Math.max(row[`tier${tier}At`]!, fa.raisedAt);
    }
  }
  return pending.map((p) => p.fa);
}

/** A small seeded generator (mulberry32), so the sample is the same on every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A sample of `n` drawn without replacement by a seeded shuffle, in the input's order. */
export function sampleOf<T>(items: T[], n: number, random: () => number): T[] {
  const index = items.map((_, i) => i);
  for (let i = index.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [index[i], index[j]] = [index[j]!, index[i]!];
  }
  return index.slice(0, n).sort((a, b) => a - b).map((i) => items[i]!);
}

/** One new body under the parent's launch, as read against the parent. */
export interface Piece {
  number: number;
  name: string;
  bodyClass: BodyClass;
  daysAfter: number;
  seenBefore: boolean;
  distance: number;
  deltaKm: number;
  deltaVMps: number;
}

/** A statement on the parent or its launch near the step, from GCAT or the hand file, or a row of the truth on the launch. */
export interface Nearby {
  source: string;
  text: string;
}

export type AuditClass = "A" | "B" | "C" | "D" | "U";

/** Why pieces in plane are not a missed event: they belong to a reported event of the parent or launch, they are a young launch's own objects, or they do not stand out of an old cloud's late cataloguing. */
export type PiecesExplained = "reported" | "young" | "background" | null;

export interface Audited {
  fa: FalseAlarm;
  name: string;
  launch: string | null;
  mark: number;
  parentOrbit: PlaneOrbit | null;
  /** Every new body of the launch first published within the year after the step, and in the year before it (the launch's background). */
  pieces: Piece[];
  background: Piece[];
  /** The pieces in plane: fragment-class, new by number, no set before the step, in the parent's plane, at least a metre a second. */
  cloud: Piece[];
  cloudDeltaVMps: number;
  spreadKm: number;
  /** The in-plane pieces' excess over the launch's background: the binomial tail of the in-plane count among the fragment-class pieces after, at the background's in-plane share; one where the launch was quiet. */
  excessP: number;
  quiet: boolean;
  /** Why the in-plane pieces are not a missed event, where they are not. */
  explained: PiecesExplained;
  /** The loose reading, for the test's blind spots (the plane test in geosynchronous orbit, pieces under a metre a second): any fresh fragment-class piece after the step, in any plane, that no reported event or young launch explains and that stands out of the launch's background count (quiet, or a Poisson tail under the excess bound). */
  loose: boolean;
  /** When the launch's first new body was published after the step (the matcher's deadline), and whether the alert came before it. */
  deadline: number | null;
  early: boolean;
  statements: Nearby[];
  truth: Nearby[];
  decayDays: number | null;
  /** The share of the step the parent's orbit kept twenty to sixty days later, against its trend before (null with too few sets). */
  retained: number | null;
  klass: AuditClass;
  why: string;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? Number.NaN : sorted.length % 2 === 1 ? sorted[sorted.length >> 1]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
};

const isFragment = (c: BodyClass): boolean => c === "debris" || c === "unknown";

/** A launch is quiet when it gained at most this many fragment-class bodies in the year before the step. */
export const QUIET_MAX = 2;
/** The in-plane pieces of a launch that was not quiet must stand out of its background at this tail probability. */
export const EXCESS_P_MAX = 0.01;
/** A reported event of the parent or its launch this long before the step (the truth build's late-batch span) or within the year after it owns the pieces. */
export const REPORTED_BEFORE_YEARS = 3;
/** The truth's own rule: nothing within this many days of the launch is a breakup. */
export const YOUNG_DAYS = 90;
/** A step whose orbit kept less than this share of it twenty to sixty days later was taken back (outside low orbit). */
export const RETAINED_MIN = 0.3;
/** A step whose later sets kept less than this share of the first jump at three days was taken back: the detector's own bad-set share. */
export const TAKEN_BACK_RHO = 0.5;

/** The upper tail of a binomial: the probability of at least `k` successes in `n` trials at `p`. */
export function binomialTail(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let logTerm = n * Math.log(1 - p);
  let below = 0;
  for (let i = 0; i < k; i++) {
    below += Math.exp(logTerm);
    logTerm += Math.log((n - i) / (i + 1)) + Math.log(p / (1 - p));
  }
  return Math.max(0, Math.min(1, 1 - below));
}

/** How much of the step the parent's orbit kept twenty to sixty days later, against the trend of its sets in the sixty days before (flat outside low orbit, where drag does not move the semi-major axis). */
function retainedOf(sets: ParentSet[], fa: FalseAlarm): number | null {
  const before = sets.filter((s) => s.epoch <= fa.step.beforeEpoch + 60_000 && s.epoch >= fa.step.beforeEpoch - 60 * DAY_MS);
  const late = sets.filter((s) => s.epoch >= fa.step.afterEpoch + 20 * DAY_MS && s.epoch <= fa.step.afterEpoch + 60 * DAY_MS);
  if (before.length < 3 || late.length < 2 || fa.step.deltaKm === 0) return null;
  const t0 = fa.step.beforeEpoch;
  let slope = 0;
  let level = median(before.slice(-3).map((s) => s.orbit.aKm));
  if (fa.regime === "LEO") {
    const xs = before.map((s) => (s.epoch - t0) / DAY_MS);
    const ys = before.map((s) => s.orbit.aKm);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < xs.length; i++) [sxx, sxy] = [sxx + (xs[i]! - mx) ** 2, sxy + (xs[i]! - mx) * (ys[i]! - my)];
    slope = sxx === 0 ? 0 : sxy / sxx;
    level = my - slope * mx;
  }
  return median(late.map((s) => s.orbit.aKm - (level + slope * (s.epoch - t0) / DAY_MS))) / fa.step.deltaKm;
}

/** One false alarm read against the catalogue, the statements and the truth, and classed. */
export function audit(fa: FalseAlarm, catalogue: Catalogue, statements: Statement[], truth: Breakup[], alertAt: number): Audited {
  const params = DETECTOR_PARAMETERS;
  const parent = catalogue.bodies.get(fa.number);
  const launch = parent?.launch ?? null;
  const margin = MATCH_MARGIN_DAYS[fa.regime] * DAY_MS;
  const sets = catalogue.parentSets.get(fa.number) ?? [];
  let parentOrbit: PlaneOrbit | null = null;
  for (const s of sets) if (s.epoch <= fa.step.beforeEpoch + 60_000) parentOrbit = s.orbit;
  const mark = Math.max(catalogue.markAt(fa.eventMs - margin), fa.number);
  const read = (b: BodyFact): Piece => {
    const distance = parentOrbit === null ? Number.POSITIVE_INFINITY : planeDistance(parentOrbit, b.orbit, fa.eventMs, params, AFTER_DAYS).distance;
    const deltaKm = parentOrbit === null ? Number.NaN : b.orbit.aKm - parentOrbit.aKm;
    return { number: b.number, name: b.name, bodyClass: b.bodyClass, daysAfter: (b.firstClock - fa.eventMs) / DAY_MS, seenBefore: b.firstEpoch < fa.eventMs - DAY_MS, distance, deltaKm, deltaVMps: parentOrbit === null ? Number.NaN : deltaVOfAxisChange(parentOrbit.aKm, deltaKm) };
  };
  const mates = launch === null ? [] : (catalogue.byLaunch.get(launch) ?? []).filter((b) => b.number !== fa.number && b.number < ANALYST_FLOOR);
  const pieces = mates.filter((b) => b.number > mark && b.firstClock > fa.eventMs - margin && b.firstClock <= fa.eventMs + AFTER_DAYS * DAY_MS).map(read).sort((a, b) => a.daysAfter - b.daysAfter);
  const backgroundMark = catalogue.markAt(fa.eventMs - AFTER_DAYS * DAY_MS);
  const background = mates.filter((b) => b.number > backgroundMark && b.firstClock > fa.eventMs - AFTER_DAYS * DAY_MS && b.firstClock <= fa.eventMs - margin).map(read);
  const inPlane = (p: Piece): boolean => isFragment(p.bodyClass) && p.distance <= params.planeDistanceMax && p.deltaVMps >= A_MIN_DELTA_V_MPS;
  const cloud = pieces.filter((p) => !p.seenBefore && inPlane(p));
  const axes = cloud.map((p) => p.deltaKm);
  // The excess: the in-plane share among the fragment-class pieces after, against the share in the year before.
  const fragmentsAfter = pieces.filter((p) => isFragment(p.bodyClass) && !p.seenBefore).length;
  const fragmentsBefore = background.filter((p) => isFragment(p.bodyClass));
  const quiet = fragmentsBefore.length <= QUIET_MAX;
  const share = (fragmentsBefore.filter(inPlane).length + 0.5) / (fragmentsBefore.length + 1);
  const excessP = quiet ? (cloud.length > 0 ? 0 : 1) : binomialTail(cloud.length, fragmentsAfter, share);
  const deadline = pieces.length === 0 ? null : fa.eventMs + pieces[0]!.daysAfter * DAY_MS;
  const near = (s: Statement): boolean => {
    const from = Date.parse(s.event.from ?? s.event.to);
    const to = Date.parse(s.event.to);
    return fa.eventMs >= from - STATEMENT_DAYS * DAY_MS && fa.eventMs <= to + STATEMENT_DAYS * DAY_MS;
  };
  const onParentOrLaunch = (number: number | null, designator: string | null): boolean => number === fa.number || (launch !== null && designator !== null && designator.slice(0, 8) === launch);
  const said = statements.filter((s) => onParentOrLaunch(s.parent.catalogueNumber, s.parent.designator) && near(s)).map((s) => ({ source: s.source, text: `${s.parent.name ?? s.parent.designator ?? "?"} (${s.parent.catalogueNumber ?? "no number"}), ${s.event.stated}, ${s.piecesCatalogued ?? "?"} pieces, ${s.ref}` }));
  const owning = truth.filter((b) => {
    const lower = Date.parse(b.event.from ?? b.event.to);
    // A launch whose catalogued objects the truth exempts as releases (the station's jettisoned objects) owns its pieces at any time.
    const release = b.kind === "release" && !b.scoreable;
    return onParentOrLaunch(b.parent.catalogueNumber, b.parent.designator) && (release || (lower >= fa.eventMs - REPORTED_BEFORE_YEARS * 365.25 * DAY_MS && lower <= fa.eventMs + AFTER_DAYS * DAY_MS));
  });
  const rows = owning.map((b) => ({ source: "truth", text: `${b.id} ${b.parent.name}, ${b.kind}, confidence ${b.confidence}${b.scoreable ? "" : `, exempt: ${b.exemptReason}`}` }));
  const launchMs = parent?.launchMs ?? null;
  const young = launchMs !== null && (fa.eventMs - launchMs < YOUNG_DAYS * DAY_MS || (cloud[0] !== undefined && fa.eventMs + cloud[0].daysAfter * DAY_MS - launchMs < YOUNG_DAYS * DAY_MS));
  const explained: PiecesExplained = cloud.length === 0 ? null : owning.length > 0 ? "reported" : young ? "young" : excessP > EXCESS_P_MAX ? "background" : null;
  const decayDays = parent?.decayMs === null || parent?.decayMs === undefined ? null : (parent.decayMs - fa.eventMs) / DAY_MS;
  const youngAt = (at: number): boolean => launchMs !== null && at - launchMs < YOUNG_DAYS * DAY_MS;
  const fresh = pieces.filter((p) => isFragment(p.bodyClass) && !p.seenBefore);
  const loose = fresh.length > 0 && owning.length === 0 && !youngAt(fa.eventMs) && !youngAt(fa.eventMs + fresh[0]!.daysAfter * DAY_MS) && (quiet || poissonTail(fresh.length, Math.max(fragmentsBefore.length, 0.5)) <= EXCESS_P_MAX);
  const audited: Audited = { fa, name: parent?.name ?? "", launch, mark, parentOrbit, pieces, background, cloud, cloudDeltaVMps: median(cloud.map((p) => p.deltaVMps)), spreadKm: axes.length === 0 ? Number.NaN : Math.max(...axes) - Math.min(...axes), excessP, quiet, explained, loose, deadline, early: deadline === null || alertAt < deadline, statements: said, truth: rows, decayDays, retained: retainedOf(sets, fa), klass: "U", why: "" };
  [audited.klass, audited.why] = classOf(audited);
  return audited;
}

/**
 * The class, by precedence. (A) pieces in plane that no reported event,
 * young launch or old cloud explains. (D) a data artefact: the later sets
 * kept under half the jump at three days, or the parent re-entered within
 * two months. (B) a breakup's signatures on an object that was not a
 * working payload: the drag term five-fold, a kick one tangential burn
 * cannot explain. (C) manoeuvre-like: a payload that could have burned
 * (working or of unknown status at the step), a payload whose record or
 * a manoeuvre explanation reads the step as a burn, or a rocket body
 * under a month old. (D) again, for what is left: an orbit where drag
 * does not act that was back within a third of the step twenty to sixty
 * days later. (U) none of these: a lone, lasting step on a body that
 * cannot burn, with no strong signature.
 */
export function classOf(a: Audited): [AuditClass, string] {
  const fa = a.fa;
  if (a.cloud.length >= A_MIN_PIECES && a.explained === null) return ["A", `${a.cloud.length} fresh piece${a.cloud.length === 1 ? "" : "s"} in plane, first ${a.cloud[0]!.daysAfter.toFixed(0)} days after, ${a.cloudDeltaVMps.toFixed(1)} m/s${a.quiet ? ", the launch quiet the year before" : `, tail ${a.excessP.toExponential(1)} over the background`}`];
  const signature = fa.bstarRatio >= B_MIN_BSTAR_RATIO && fa.kick >= B_MIN_KICK;
  const payload = fa.bodyClass === "payload";
  const capable = payload && (isWorkingStatus(fa.opsStatus as (typeof OPS_STATUSES)[number]) || fa.opsStatus === "unknown");
  const working = payload && isWorkingStatus(fa.opsStatus as (typeof OPS_STATUSES)[number]);
  const recordReads = payload && (fa.manoeuvreClass !== "unique" || (fa.explanationBits ?? 0) !== 0);
  const youngStage = fa.bodyClass === "rocket body" && fa.ageDays < 30;
  const takenBack = Number.isFinite(fa.rhoD3) && fa.rhoD3 < TAKEN_BACK_RHO;
  const decayed = a.decayDays !== null && a.decayDays >= 0 && a.decayDays <= D_DECAY_DAYS;
  // Where drag does not move the semi-major axis (medium and geosynchronous orbits, and highly elliptical ones with a perigee above a thousand kilometres), an orbit back where it was weeks later had no lasting step.
  const dragFree = fa.regime === "MEO" || fa.regime === "GEO" || (fa.regime === "HEO" && fa.perigeeKm >= 1000);
  const reverted = dragFree && a.retained !== null && Math.abs(a.retained) < RETAINED_MIN;
  if (takenBack || decayed) return ["D", takenBack ? `the later sets kept ${(fa.rhoD3 * 100).toFixed(0)}% of the jump at three days` : `re-entered ${a.decayDays!.toFixed(0)} days after`];
  if (signature && !working) return ["B", `drag term ×${fa.bstarRatio.toFixed(1)}, kick χ² ${fa.kick.toFixed(0)}`];
  if (capable || recordReads || youngStage) return ["C", capable ? `a payload ${fa.opsStatus} at the step` : recordReads ? `the record reads ${fa.manoeuvreClass}` : `a rocket body ${fa.ageDays.toFixed(0)} days old`];
  if (reverted) return ["D", `the orbit kept ${(a.retained! * 100).toFixed(0)}% of the step twenty to sixty days later`];
  return ["U", `drag term ×${Number.isFinite(fa.bstarRatio) ? fa.bstarRatio.toFixed(1) : "?"}, kick χ² ${Number.isFinite(fa.kick) ? fa.kick.toFixed(0) : "?"}`];
}

/** The statements GCAT and the hand file make. */
export function sideStatements(root = ROOT): Statement[] {
  const gcat = gcatStatements(parseGcat(readFileSync(join(root, "data/truth/sources/gcat-debriscat.html"), "utf8")));
  const hand = readStatements((JSON.parse(readFileSync(join(root, "data/truth/hand.json"), "utf8")) as { statements: unknown }).statements);
  return [...gcat, ...hand];
}

/** The Wilson 95% interval of a proportion. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const kpiDir = resolve(args[0] ?? join(ROOT, "kpi"));
  let seed = 8;
  let sampleSize = 300;
  let out = join(ROOT, "kpi/work/d8");
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--seed") seed = Number(args[++i]);
    else if (args[i] === "--sample") sampleSize = Number(args[++i]);
    else if (args[i] === "--out") out = resolve(args[++i]!);
    else throw new Error("usage: audit.ts <kpi dir> [--seed 8] [--sample 300] [--out <dir>]");
  }
  const read = falseAlarmsOf(kpiDir);
  const all = read.filter((f) => f.outcome === "false-alarm");
  const hits = read.filter((f) => f.outcome !== "false-alarm");
  console.error(`audit: ${all.length} false alarms and ${hits.length} alerts on reported events read`);
  const random = seeded(seed);
  const chosen: { set: string; fa: FalseAlarm; alertAt: number }[] = [];
  for (const split of ["train", "validation"] as const) {
    for (const fa of all.filter((f) => f.split === split && f.scopedAt !== null)) chosen.push({ set: `scoped ${split}`, fa, alertAt: fa.scopedAt! });
    for (const fa of sampleOf(all.filter((f) => f.split === split), sampleSize, random)) chosen.push({ set: `whole ${split}`, fa, alertAt: fa.raisedAt });
  }
  for (const fa of hits) chosen.push({ set: `hits ${fa.split}`, fa, alertAt: fa.raisedAt });
  for (const fa of all.filter((f) => f.confirmed)) chosen.push({ set: `confirmed ${fa.split}`, fa, alertAt: fa.raisedAt });
  const catalogue = readCatalogue(archiveHome(), new Set(chosen.map((c) => c.fa.number)));
  const statements = sideStatements();
  const truth = readBreakups(JSON.parse(readFileSync(join(ROOT, "data/breakups.json"), "utf8")));
  const rows = chosen.map((c) => ({ set: c.set, alertAt: c.alertAt, ...audit(c.fa, catalogue, statements, truth, c.alertAt) }));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "audit.json"), `${JSON.stringify({ seed, sampleSize, population: { train: all.filter((f) => f.split === "train").length, validation: all.filter((f) => f.split === "validation").length }, rows }, null, 1)}\n`);
  for (const set of ["scoped train", "scoped validation", "whole train", "whole validation", "hits train", "hits validation", "confirmed train", "confirmed validation"]) {
    const of = rows.filter((r) => r.set === set);
    const count = (k: AuditClass): number => of.filter((r) => r.klass === k).length;
    const explained = (e: PiecesExplained): number => of.filter((r) => r.explained === e).length;
    console.log(`${set}: ${of.length}; A ${count("A")} (early ${of.filter((r) => r.klass === "A" && r.early).length}), B ${count("B")}, C ${count("C")}, D ${count("D")}, U ${count("U")}; pieces in plane explained: reported ${explained("reported")}, young ${explained("young")}, background ${explained("background")}; loose ${of.filter((r) => r.loose).length}`);
  }
  // The re-score: the class A alerts as positives, each a new target, detected where raised before the launch's first new body.
  const latest = JSON.parse(readFileSync(join(kpiDir, "latest.json"), "utf8")) as { splits: Record<Split, { falseAlarms: number; lines: Record<string, { targets: number; detected: number }>; scoped: { targets: number; detected: number; detectedAllLines: number; falseAlarms: number } }> };
  for (const split of ["train", "validation"] as const) {
    const cells = latest.splits[split];
    const allLines = Object.values(cells.lines).reduce((sum, line) => sum + line.detected, 0);
    const headline = cells.lines["breakups A-B"]!;
    const scoped = rows.filter((r) => r.set === `scoped ${split}`);
    const sa = scoped.filter((r) => r.klass === "A").length;
    const se = scoped.filter((r) => r.klass === "A" && r.early).length;
    const sf = cells.scoped.falseAlarms - sa;
    console.log(`re-score scoped ${split}: false alarms ${sf}, FA rate ${(sf / (sf + cells.scoped.detectedAllLines + se) * 100).toFixed(1)}%, recall ${cells.scoped.detected + se}/${cells.scoped.targets + sa}`);
    const whole = rows.filter((r) => r.set === `whole ${split}`);
    const wa = whole.filter((r) => r.klass === "A").length;
    const we = whole.filter((r) => r.klass === "A" && r.early).length;
    const [lo, hi] = wilson(wa, whole.length);
    const estimate = (share: number): string => {
      const added = share * cells.falseAlarms;
      const f = cells.falseAlarms - added;
      return `${added.toFixed(1)} events, false alarms ${f.toFixed(0)}, FA rate ${(f / (f + allLines + added * (wa === 0 ? 1 : we / wa)) * 100).toFixed(1)}%`;
    };
    console.log(`re-score whole ${split}: A ${wa}/${whole.length} (early ${we}), Wilson ${(lo * 100).toFixed(2)}% to ${(hi * 100).toFixed(2)}%; point: ${estimate(wa / whole.length)}, headline recall with them ${((headline.detected + (we / whole.length) * cells.falseAlarms) / (headline.targets + (wa / whole.length) * cells.falseAlarms) * 100).toFixed(0)}%; upper: ${estimate(hi)}`);
  }
  console.log(`written ${join(out, "audit.json")}`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("audit.ts")) await main();
