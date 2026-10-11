import { isAgencySource, type Breakup, type EventEstimate, type PublishedBreakup, type PublishedEvent, type PublishedReport, type PublishedState, type PublishedStep, type PublishedVerdict, type Statement, type Step, type Verdict } from "../../src/index.ts";
import { brackets, landConfirmed, lowerOf, marginDaysOf, overlaps, type Row } from "../kpi/match.ts";
import { rowsOf } from "../prospective/score.ts";

/** What the satellite catalogue says of a body: the fields of the Archive's body table (`ArchivedBody`) the parent is filled from. */
export interface BodyIdentity {
  designator: string | null;
  name: string | null;
  /** The launch day, `YYYY-MM-DD`. */
  launch: string | null;
}

/** The catalogue's identity of a body by its number; undefined where it has none. */
export type BodyOf = (number: number) => BodyIdentity | undefined;

type ObjectVerdict = Verdict & { number: number };

/** A suspected or confirmed object verdict, with the ground-truth row it lands on (null for none), and whether it is a confirmation exempt as a release on purpose. */
interface Landed {
  verdict: ObjectVerdict;
  row: Breakup | null;
  exempt: boolean;
}

const iso = (ms: number): string => new Date(ms).toISOString();
const stepOut = (step: Step | null): PublishedStep | null => (step === null ? null : { ...step, beforeEpoch: iso(step.beforeEpoch), afterEpoch: iso(step.afterEpoch) });
const eventOut = (event: EventEstimate | null): PublishedEvent | null => (event === null ? null : { at: iso(event.at), from: iso(event.from), to: iso(event.to) });
const canLand = (row: Breakup): boolean => row.kind === "breakup" || row.kind === "anomalous";

/** The day an event starts on, which an agency notice must not precede. */
const eventDayOf = (row: Breakup): string => (row.event.from ?? row.event.to).slice(0, 10);

type Dated = Statement & { statedOn: NonNullable<Statement["statedOn"]> };
const isOutside = (s: Statement): s is Dated => s.statedOn !== null && (s.source === "news" || s.source === "analyst");
const isAgencyNotice = (row: Breakup) => (s: Statement): s is Dated => s.statedOn !== null && isAgencySource(s.source) && s.statedOn.on >= eventDayOf(row);

/** The statements of a row that count as reports, earliest first: dated outside reports, and dated agency notices no earlier than the event's day. */
function reportsOf(row: Breakup | null): PublishedReport[] {
  if (row === null) return [];
  const notice = isAgencyNotice(row);
  return row.statements
    .filter((s): s is Dated => isOutside(s) || notice(s))
    .map((s) => ({ source: s.source, date: s.statedOn.on, precision: s.statedOn.precision, url: s.url ?? null }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function verdictOut(verdict: Verdict): PublishedVerdict {
  return { state: verdict.state as PublishedState, raisedAt: iso(verdict.raisedAt), step: stepOut(verdict.step), event: eventOut(verdict.event), evidence: verdict.evidence, reasons: verdict.reasons, bodies: verdict.bodies ?? [], candidates: verdict.candidates ?? [] };
}

/** The row a suspected verdict lands on by its step: a breakup or anomalous row of its object whose window, widened by the regime's margin, the step brackets; the latest such. */
function landSuspected(verdict: ObjectVerdict, breakups: readonly Breakup[]): Breakup | null {
  const onStep = breakups.filter((row) => row.parent.catalogueNumber === verdict.number && canLand(row) && brackets(verdict.step, lowerOf(row), Date.parse(row.event.to), marginDaysOf(row.orbit.regime)));
  return onStep.sort((a, b) => lowerOf(b) - lowerOf(a))[0] ?? null;
}

/**
 * Where a confirmed verdict lands, as the scorecard's Confirmed line lands
 * it (`landConfirmed`): on the row of a detection. It is exempt, a release
 * on purpose, under a crewed station's launch, under a crewed or cargo
 * craft's launch other than on its rocket body, or inside a release row's
 * window. Any other landing (a row naming the launch alone or no object,
 * an aerodynamic row, no row at all) is a breakup on no row.
 */
function landedConfirmation(verdict: ObjectVerdict, i: number, rows: readonly Row[], byId: ReadonlyMap<string, Breakup>): Landed {
  const landing = landConfirmed(verdict, i, rows);
  const on = landing.event === null ? null : (byId.get(landing.event) ?? null);
  const exempt = landing.outcome === "exempt" && (landing.note.startsWith("a crewed") || on?.kind === "release");
  return { verdict, row: landing.outcome === "detection" ? on : null, exempt };
}

/** One breakup: the verdicts merged into it, in the order raised. */
type Cluster = Landed[];

/** Whether a landed verdict belongs to a breakup: the same object, and an overlapping step or the same landed row. */
function joins(cluster: Cluster, landed: Landed): boolean {
  return cluster.some(({ verdict, row }) => {
    if (verdict.number !== landed.verdict.number) return false;
    const a = verdict.step;
    const b = landed.verdict.step;
    if (a !== null && b !== null && overlaps(a, b)) return true;
    return row !== null && row === landed.row;
  });
}

/** The verdicts merged into breakups: each joins every breakup it belongs to, which then become one. */
function clustersOf(landed: readonly Landed[]): Cluster[] {
  let clusters: Cluster[] = [];
  for (const one of landed) {
    const into = clusters.filter((cluster) => joins(cluster, one));
    const merged = [...into.flat(), one];
    clusters = [...clusters.filter((cluster) => !into.includes(cluster)), merged];
  }
  return clusters.map((cluster) => [...cluster].sort((a, b) => a.verdict.raisedAt - b.verdict.raisedAt));
}

/** The states that decide a suspected step's fate: raised (again), confirmed, or let go. */
const FATES: readonly Verdict["state"][] = ["suspected", "confirmed", "expired", "dismissed"];

/** Whether a suspected step on an object has been let go: the latest verdict on the object whose step overlaps it expired or dismissed it. A breakup with no step is never let go. */
export function isLetGo(number: number, step: Step | null, verdicts: readonly Verdict[]): boolean {
  if (step === null) return false;
  const fate = verdicts.filter((v) => v.kind === "object" && v.number === number && FATES.includes(v.state) && v.step !== null && overlaps(v.step, step)).at(-1);
  return fate !== undefined && (fate.state === "expired" || fate.state === "dismissed");
}

function publishedOf(cluster: Cluster, verdicts: readonly Verdict[], bodyOf: BodyOf): PublishedBreakup | null {
  if (cluster.some((landed) => landed.exempt)) return null;
  const latest = cluster[cluster.length - 1]!.verdict;
  const row = [...cluster].reverse().find((landed) => landed.row !== null)?.row ?? null;
  const confirmedVerdict = cluster.find(({ verdict }) => verdict.state === "confirmed")?.verdict;
  const reports = reportsOf(row);
  const firstNotice = reports.find((report) => isAgencySource(report.source));
  const confirmedOn = [confirmedVerdict?.raisedAt, firstNotice === undefined ? undefined : Date.parse(`${firstNotice.date}T00:00:00.000Z`)].filter((t) => t !== undefined);
  const confirmedAt = confirmedOn.length === 0 ? null : iso(Math.min(...confirmedOn));
  const state: PublishedState | null = confirmedAt !== null ? "confirmed" : reports.length > 0 ? "suspected" : null;
  if (state === null || (state === "suspected" && isLetGo(latest.number, latest.step, verdicts))) return null;
  const number = latest.number;
  const body = bodyOf(number);
  const raisedAt = cluster[0]!.verdict.raisedAt;
  return {
    id: `${number}-${iso(latest.event?.at ?? raisedAt).slice(0, 10)}`,
    state,
    raisedAt: iso(raisedAt),
    confirmedAt,
    parent: { catalogueNumber: number, designator: row?.parent.designator ?? body?.designator ?? null, name: row?.parent.name ?? body?.name ?? null, launchedOn: row?.parent.launchedOn ?? body?.launch ?? null },
    event: eventOut(latest.event),
    step: stepOut(latest.step),
    reasons: latest.reasons,
    reports,
    evidence: latest.evidence,
    bodies: latest.bodies ?? [],
    candidates: latest.candidates ?? [],
    row: row?.id ?? null,
    verdicts: cluster.map(({ verdict }) => verdictOut(verdict)),
  };
}

/**
 * The breakups fit to show from one replay: the frozen detector's verdicts
 * (the year file's, every state, in the order raised) landed on the ground
 * truth as it stands on main, earliest raised first. Pure: the catalogue's
 * identity of a parent comes in through `bodyOf`.
 *
 * A suspected verdict lands by its step on a `breakup` or `anomalous` row
 * of its object, the window widened by the regime's margin; a confirmed one
 * as the scorecard's Confirmed line lands it. Verdicts on one object whose
 * steps overlap, or that land on one row, are one breakup. It is published
 * confirmed when the detector confirmed it or an agency notice on its row,
 * dated no earlier than the event, did; suspected when a dated outside
 * report (news, an analyst) names its row and no later verdict on its step
 * expired or dismissed it. A confirmation exempt as a release on purpose
 * takes its breakup out. GCAT, the catalogue and undated statements never
 * count. The id is the object and the day of the latest verdict's estimate
 * (of the first raising where it made none); merging with what is already
 * published, which may fix an earlier id, is the caller's.
 */
export function selectPublished(verdicts: readonly Verdict[], breakups: readonly Breakup[], bodyOf: BodyOf): PublishedBreakup[] {
  const rows = rowsOf(breakups);
  const byId = new Map(breakups.map((row) => [row.id, row]));
  const landed: Landed[] = [];
  verdicts.forEach((verdict, i) => {
    if (verdict.kind !== "object" || verdict.number === null) return;
    const object = verdict as ObjectVerdict;
    if (verdict.state === "suspected") landed.push({ verdict: object, row: landSuspected(object, breakups), exempt: false });
    if (verdict.state === "confirmed") landed.push(landedConfirmation(object, i, rows, byId));
  });
  return clustersOf(landed)
    .map((cluster) => publishedOf(cluster, verdicts, bodyOf))
    .filter((published) => published !== null)
    .sort((a, b) => Date.parse(a.raisedAt) - Date.parse(b.raisedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
