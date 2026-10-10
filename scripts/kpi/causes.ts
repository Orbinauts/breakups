import { resolve } from "node:path";
import { BODY_CLASSES, EXPLANATION_BITS, MANOEUVRE_CLASSES, SIGNATURE_BITS, type LogRow, type Verdict } from "../../src/index.ts";
import { alertKey, type YearFile } from "./kpi.ts";
import { readYearFiles } from "./run.ts";

/**
 * The false alarms by cause, before and after a change of the fusion, and
 * what each manoeuvre explanation removed and cost: two replays' year
 * files (`kpi/years/` of the earlier detector, the trial's of the later)
 * read side by side on one split.
 *
 * `node --experimental-strip-types scripts/kpi/causes.ts <before> <after> [odd|even]`
 *
 * A false alarm's cause is read off its verdict's evidence: where no
 * manoeuvre explanation applied, the step was alone (by the object's
 * class and, for a payload, its age); where one applied, the first breakup
 * signature that overrode it. A step joins the two replays by its object
 * and the epoch of its first post set, which the candidate logic upstream
 * of the fusion leaves unchanged; a false alarm of the earlier replay
 * that the later closed as a manoeuvre is counted against every
 * explanation that applied to it.
 */

export type FalseAlarmCause = "alone: payload older than 90 days" | "alone: payload younger than 90 days" | "alone: rocket body" | "alone: debris" | "alone: unknown class" | "size" | "direction" | "geometry" | "drag term" | "against drag" | "nonoperational" | "occasional on a non-payload";

export const FALSE_ALARM_CAUSES: FalseAlarmCause[] = ["alone: payload older than 90 days", "alone: payload younger than 90 days", "alone: rocket body", "alone: debris", "alone: unknown class", "size", "direction", "geometry", "drag term", "against drag", "nonoperational", "occasional on a non-payload"];

/** The young payload bound of the earlier phases' cause table, in days. */
const YOUNG_DAYS = 90;

/** The cause of a raised step from its verdict's evidence, for either detector: the sixth phase's bits where present, else the record's class and its tests. */
export function causeOf(evidence: Record<string, number>, params: { typicalityMax: number; oppositeMinSteps: number; consistencyMin: number }): FalseAlarmCause {
  const bodyClass = BODY_CLASSES[evidence.bodyClass ?? 3] ?? "unknown";
  const alone = (): FalseAlarmCause => (bodyClass === "payload" ? ((evidence.ageDays ?? Number.POSITIVE_INFINITY) < YOUNG_DAYS ? "alone: payload younger than 90 days" : "alone: payload older than 90 days") : bodyClass === "rocket body" ? "alone: rocket body" : bodyClass === "debris" ? "alone: debris" : "alone: unknown class");
  if (evidence.explanationBits !== undefined) {
    const sig = evidence.signatureBits ?? 0;
    if ((evidence.explanationBits ?? 0) === 0) return alone();
    if (sig & SIGNATURE_BITS.nonoperational) return "nonoperational";
    if (sig & SIGNATURE_BITS.size) return "size";
    if (sig & SIGNATURE_BITS.direction) return "direction";
    if (sig & SIGNATURE_BITS.geometry) return "geometry";
    if (sig & SIGNATURE_BITS.dragTerm) return "drag term";
    if (sig & SIGNATURE_BITS.againstDrag) return "against drag";
    return "occasional on a non-payload";
  }
  if (MANOEUVRE_CLASSES[evidence.manoeuvreClass ?? 4] === "unique") return alone();
  if ((evidence.typicality ?? 0) >= params.typicalityMax) return "size";
  if ((evidence.n730 ?? 0) >= params.oppositeMinSteps && evidence.sameSignShare === 0) return "direction";
  if ((evidence.impulseConsistency ?? 0) >= params.consistencyMin) return "geometry";
  return "drag term";
}

interface Landed {
  verdict: Verdict;
  key: string;
  year: number;
}

/** The false alarms of the files, each with its verdict and its join key. */
function falseAlarmsOf(files: YearFile[]): Landed[] {
  const out: Landed[] = [];
  for (const file of files) for (const alert of file.score.alerts) if (alert.outcome === "false-alarm" && alert.afterEpoch !== null) out.push({ verdict: file.verdicts[alert.verdict]!, key: alertKey(alert.number, alert.afterEpoch), year: file.year });
  return out;
}

/** The close rows of persistent steps of the files, by join key. */
function closesOf(files: YearFile[]): Map<string, LogRow> {
  const rows = new Map<string, LogRow>();
  for (const file of files) for (const row of file.log) if (row.signals.phase === 2 && row.signals.afterEpoch !== undefined && (row.signals.outcome === 1 || row.signals.outcome === 5)) rows.set(alertKey(row.number, row.signals.afterEpoch), row);
  return rows;
}

const EXPLANATION_NAMES = Object.keys(EXPLANATION_BITS) as (keyof typeof EXPLANATION_BITS)[];

function main(): void {
  const [beforeDir, afterDir, parityArg] = process.argv.slice(2);
  if (beforeDir === undefined || afterDir === undefined) throw new Error("usage: causes.ts <before> <after> [odd|even]");
  const parity = parityArg === "even" ? 0 : 1;
  const before = readYearFiles(resolve(beforeDir)).filter((f) => f.year % 2 === parity);
  const after = readYearFiles(resolve(afterDir)).filter((f) => f.year % 2 === parity);
  const paramsBefore = before[0]!.detector.parameters;
  const paramsAfter = after[0]!.detector.parameters;
  const fb = falseAlarmsOf(before);
  const fa = falseAlarmsOf(after);
  const closesAfter = closesOf(after);
  const count = (list: Landed[], params: typeof paramsBefore): Map<FalseAlarmCause, number> => {
    const counts = new Map<FalseAlarmCause, number>();
    for (const l of list) counts.set(causeOf(l.verdict.evidence, params), (counts.get(causeOf(l.verdict.evidence, params)) ?? 0) + 1);
    return counts;
  };
  const cb = count(fb, paramsBefore);
  const ca = count(fa, paramsAfter);
  console.log(`${parity === 1 ? "validation (odd years)" : "training (even years)"}: ${fb.length} false alarms before, ${fa.length} after`);
  console.log("| cause | before | after |");
  console.log("| --- | --- | --- |");
  for (const cause of FALSE_ALARM_CAUSES) if ((cb.get(cause) ?? 0) + (ca.get(cause) ?? 0) > 0) console.log(`| ${cause} | ${cb.get(cause) ?? 0} | ${ca.get(cause) ?? 0} |`);
  // What became of the earlier false alarms, by the explanation that applied.
  const removedBy = new Map<string, number>();
  const removedByCause = new Map<string, number>();
  let stayed = 0;
  let notFound = 0;
  const afterKeys = new Set(fa.map((l) => l.key));
  for (const l of fb) {
    if (afterKeys.has(l.key)) {
      stayed++;
      continue;
    }
    const row = closesAfter.get(l.key);
    if (row === undefined || row.signals.outcome !== 5) {
      notFound++;
      continue;
    }
    const bits = row.signals.explanationBits ?? 0;
    const names = EXPLANATION_NAMES.filter((name) => (bits & EXPLANATION_BITS[name]) !== 0);
    for (const name of names) removedBy.set(name, (removedBy.get(name) ?? 0) + 1);
    const only = names.filter((n) => n !== "record");
    const label = only.length === 0 ? "the record alone" : only.join(" + ");
    removedByCause.set(`${causeOf(l.verdict.evidence, paramsBefore)} | ${label}`, (removedByCause.get(`${causeOf(l.verdict.evidence, paramsBefore)} | ${label}`) ?? 0) + 1);
  }
  console.log("");
  console.log(`of the ${fb.length} earlier false alarms: ${stayed} still false alarms, ${fb.length - stayed - notFound} now manoeuvres, ${notFound} not raised or landed otherwise`);
  console.log("| explanation | earlier false alarms it applied to (a step may count under several) |");
  console.log("| --- | --- |");
  for (const name of EXPLANATION_NAMES) console.log(`| ${name} | ${removedBy.get(name) ?? 0} |`);
  console.log("");
  console.log("| earlier cause | explanations beyond the record | removed |");
  console.log("| --- | --- | --- |");
  for (const [k, v] of [...removedByCause].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`| ${k} | ${v} |`);
  // The events: detected before and not after, and the reverse.
  const status = (files: YearFile[]): Map<string, { status: string; name: string; line: string; parent: number; from: number }> => new Map(files.flatMap((f) => f.score.events.map((e) => [e.id, { status: e.status, name: e.name, line: e.line, parent: e.parent, from: e.from }] as const)));
  const sb = status(before);
  const sa = status(after);
  console.log("");
  console.log("| event | line | before | after | why, from the later replay's close row on the parent |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const [id, b] of sb) {
    const a = sa.get(id);
    if (a === undefined || a.status === b.status) continue;
    const rows = after.flatMap((f) => f.log.filter((r) => r.number === b.parent && r.signals.phase === 2 && (r.signals.outcome === 1 || r.signals.outcome === 5) && Math.abs((r.signals.afterEpoch ?? 0) - b.from) < 10 * 86_400_000));
    const why = rows.map((r) => `${r.signals.outcome === 5 ? "manoeuvre" : "suspected"}, explanations ${EXPLANATION_NAMES.filter((n) => ((r.signals.explanationBits ?? 0) & EXPLANATION_BITS[n]) !== 0).join("+") || "none"}, signatures ${r.signals.signatureBits ?? 0}, status ${r.signals.opsStatus}`).join("; ");
    console.log(`| ${b.name} | ${b.line} | ${b.status} | ${a.status} | ${why} |`);
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("causes.ts")) main();
