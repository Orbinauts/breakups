import { isAgencySource, type Breakup, type Regime, type EventEstimate, type Precision, type PublishedBreakup, type PublishedEvent, type PublishedReport, type PublishedRowEvent, type PublishedStep, type PublishedVerdict, type PublishedVerdictState, type Statement, type Step, type Verdict } from "../../src/index.ts";
import { isAgencyWord } from "../../src/truth.ts";
import { STATION_LAUNCHES, VISITING_LAUNCHES, brackets, carriedRegime, landConfirmed, lowerOf, marginDaysOf, overlaps, type Row } from "../kpi/match.ts";
import { rowsOf } from "../prospective/score.ts";
import { isoInstant } from "../time.ts";

/** What the satellite catalogue says of a body: the fields of the Archive's body table (`ArchivedBody`) the parent is filled from. */
export interface BodyIdentity {
  designator: string | null;
  name: string | null;
  /** The launch day, `YYYY-MM-DD`. */
  launch: string | null;
}

/** The catalogue's identity of a body by its number; undefined where it has none. */
export type BodyOf = (number: number) => BodyIdentity | undefined;

/** The regime of a body by its last set before an instant, as the Archive's sets give it (`regimeBefore`); unknown where they give none. */
export type RegimeAt = (number: number, at: number) => Regime;

type ObjectVerdict = Verdict & { number: number };

/** A suspected or confirmed object verdict, with the ground-truth row it lands on (null for none). */
interface Landed {
  verdict: ObjectVerdict;
  row: Breakup | null;
}

/** The detector's step, estimate and verdict in their published shape: instants in milliseconds become ISO strings. */
const publishedStepOf = (step: Step | null): PublishedStep | null => (step === null ? null : { ...step, beforeEpoch: isoInstant(step.beforeEpoch), afterEpoch: isoInstant(step.afterEpoch) });
const publishedEventOf = (event: EventEstimate | null): PublishedEvent | null => (event === null ? null : { at: isoInstant(event.at), from: isoInstant(event.from), to: isoInstant(event.to) });
const canLand = (row: Breakup): boolean => row.kind === "breakup" || row.kind === "anomalous";

/** The precisions fine enough to name the day of a row's event. */
const DAY_OR_FINER: readonly Precision[] = ["second", "minute", "hour", "day"];

const isoOrNull = (instant: string | null): string | null => (instant === null ? null : new Date(instant).toISOString());

/** The event as a landed row dates it, its instants as ISO strings; null for no row. */
export function rowEventOf(row: Breakup | null): PublishedRowEvent | null {
  if (row === null) return null;
  return { at: isoOrNull(row.event.at), from: isoOrNull(row.event.from), to: isoOrNull(row.event.to), precision: row.event.precision, source: row.resolvedFrom.event, row: row.id };
}

/**
 * A breakup's id: its object and a UTC day, the row's where the row dates
 * the event to the day or finer (its instant, else its start), else the
 * detector's estimate's, else the day it was first raised. The caller keeps
 * an id once published.
 */
export function publishedIdOf(number: number, rowEvent: PublishedRowEvent | null, event: PublishedEvent | null, raisedAt: string): string {
  const fine = rowEvent !== null && DAY_OR_FINER.includes(rowEvent.precision) ? (rowEvent.at ?? rowEvent.from) : null;
  return `${number}-${(fine ?? event?.at ?? raisedAt).slice(0, 10)}`;
}

/** The day an event starts on, which an agency notice must not precede. */
const eventDayOf = (row: Breakup): string => (row.event.from ?? row.event.to).slice(0, 10);

type Dated = Statement & { statedOn: NonNullable<Statement["statedOn"]> };
const isOutside = (s: Statement): s is Dated => s.statedOn !== null && (s.source === "news" || s.source === "analyst");
const isAgencyNotice = (row: Breakup) => (s: Statement): s is Dated => s.statedOn !== null && isAgencySource(s.source) && s.statedOn.on >= eventDayOf(row);

/** The day of the row's first agency notice on its object (`isAgencyWord`), which confirms a breakup: an ESA row the truth's build placed by its own rule is listed among the reports, but confirms nothing. */
const firstNoticeOn = (row: Breakup | null): string | undefined => (row === null ? undefined : row.statements.filter(isAgencyNotice(row)).filter(isAgencyWord).map((s) => s.statedOn.on).sort()[0]);

/** The statements of a row that count as reports, earliest first: dated outside reports, and dated agency notices no earlier than the event's day. */
function reportsOf(row: Breakup | null): PublishedReport[] {
  if (row === null) return [];
  const notice = isAgencyNotice(row);
  return row.statements
    .filter((s): s is Dated => isOutside(s) || notice(s))
    .map((s) => ({ source: s.source, date: s.statedOn.on, precision: s.statedOn.precision, url: s.url ?? null }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function publishedVerdictOf(verdict: Verdict): PublishedVerdict {
  return { state: verdict.state as PublishedVerdictState, raisedAt: isoInstant(verdict.raisedAt), step: publishedStepOf(verdict.step), event: publishedEventOf(verdict.event), evidence: verdict.evidence, reasons: verdict.reasons, bodies: verdict.bodies ?? [], candidates: verdict.candidates ?? [] };
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
 * window: then it lands nowhere and is left out (null), on its own. A
 * detection lands on its row, a row naming the launch alone among them
 * (the Confirmed line scores those by their launch). Any other landing (a
 * row naming no object, an aerodynamic row, no row at all) is a breakup on
 * no row. A report naming no object but a regime is read with the
 * object's regime by its last set before the raising (`regimeAt`), as the
 * scorecard reads it; a caller with no sets passes none, and the regime
 * the verdict carries is read instead (`carriedRegime`). Exempt by a
 * regime or not, such a confirmation is a breakup on no row.
 */
function landedConfirmation(verdict: ObjectVerdict, i: number, rows: readonly Row[], byId: ReadonlyMap<string, Breakup>, regimeAt: RegimeAt | undefined): Landed | null {
  const landing = landConfirmed(verdict, i, rows, STATION_LAUNCHES, VISITING_LAUNCHES, regimeAt === undefined ? carriedRegime(verdict) : regimeAt(verdict.number, verdict.raisedAt));
  const on = landing.event === null ? null : (byId.get(landing.event) ?? null);
  const exempt = landing.outcome === "exempt" && (landing.note.startsWith("a crewed") || on?.kind === "release");
  return exempt ? null : { verdict, row: landing.outcome === "detection" ? on : null };
}

/** One breakup: the verdicts merged into it, in the order raised. */
type Cluster = Landed[];

/** The steps a breakup's verdicts measured. */
const stepsOf = (cluster: Cluster): Step[] => cluster.flatMap(({ verdict }) => (verdict.step === null ? [] : [verdict.step]));

/**
 * Whether a landed verdict belongs to a breakup of the same object: its
 * step overlaps one of the breakup's, or it lands on one of the breakup's
 * rows and one side measured no step (the verdict has none, or the
 * breakup's verdicts have none). Two verdicts with steps that do not
 * overlap are two breakups, whatever row they land on.
 */
function joins(cluster: Cluster, landed: Landed): boolean {
  if (cluster[0]!.verdict.number !== landed.verdict.number) return false;
  const step = landed.verdict.step;
  const steps = stepsOf(cluster);
  if (step !== null && steps.some((s) => overlaps(s, step))) return true;
  const onRow = landed.row !== null && cluster.some(({ row }) => row === landed.row);
  return onRow && (step === null || steps.length === 0);
}

const lastRaisedOf = (cluster: Cluster): number => Math.max(...cluster.map(({ verdict }) => verdict.raisedAt));

/**
 * The verdicts merged into breakups: a verdict with a step joins every
 * breakup it belongs to, which then become one; a verdict with no step
 * joins only the breakup on its row raised to last, so it never makes one
 * of two breakups its row holds.
 */
function clustersOf(landed: readonly Landed[]): Cluster[] {
  let clusters: Cluster[] = [];
  for (const one of landed) {
    const joined = clusters.filter((cluster) => joins(cluster, one));
    const into = one.verdict.step === null ? joined.sort((a, b) => lastRaisedOf(a) - lastRaisedOf(b)).slice(-1) : joined;
    const merged = [...into.flat(), one];
    clusters = [...clusters.filter((cluster) => !into.includes(cluster)), merged];
  }
  return clusters.map((cluster) => [...cluster].sort((a, b) => a.verdict.raisedAt - b.verdict.raisedAt));
}

/** The order of the published list: earliest raised first, then by id. */
export const byFirstRaised = (a: PublishedBreakup, b: PublishedBreakup): number => Date.parse(a.raisedAt) - Date.parse(b.raisedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The states that decide a suspected step's fate: raised (again), confirmed, or let go. */
const FATES: readonly Verdict["state"][] = ["suspected", "confirmed", "expired", "dismissed"];

/** Whether a suspected step on an object has been let go: the latest verdict on the object whose step overlaps it expired or dismissed it. A breakup with no step is never let go. */
export function isLetGo(number: number, step: Step | null, verdicts: readonly Verdict[]): boolean {
  if (step === null) return false;
  const fate = verdicts.filter((v) => v.kind === "object" && v.number === number && FATES.includes(v.state) && v.step !== null && overlaps(v.step, step)).at(-1);
  return fate !== undefined && (fate.state === "expired" || fate.state === "dismissed");
}

function publishedOf(cluster: Cluster, verdicts: readonly Verdict[], bodyOf: BodyOf): PublishedBreakup | null {
  const latest = cluster[cluster.length - 1]!.verdict;
  const row = [...cluster].reverse().find((landed) => landed.row !== null)?.row ?? null;
  const confirmedVerdict = cluster.find(({ verdict }) => verdict.state === "confirmed")?.verdict;
  const reports = reportsOf(row);
  const firstNotice = firstNoticeOn(row);
  const confirmedOn = [confirmedVerdict?.raisedAt, firstNotice === undefined ? undefined : Date.parse(`${firstNotice}T00:00:00.000Z`)].filter((t) => t !== undefined);
  const confirmedAt = confirmedOn.length === 0 ? null : isoInstant(Math.min(...confirmedOn));
  const state: PublishedVerdictState | null = confirmedAt !== null ? "confirmed" : reports.length > 0 ? "suspected" : null;
  if (state === null || (state === "suspected" && isLetGo(latest.number, latest.step, verdicts))) return null;
  const number = latest.number;
  const body = bodyOf(number);
  const raisedAt = isoInstant(cluster[0]!.verdict.raisedAt);
  const event = publishedEventOf(latest.event);
  const rowEvent = rowEventOf(row);
  const named = row !== null && row.parent.catalogueNumber === number ? row : null;
  return {
    id: publishedIdOf(number, rowEvent, event, raisedAt),
    state,
    raisedAt,
    confirmedAt,
    // Whether a confirmation on no row has turned unreported is read at the truth's date by the merge.
    unreportedAt: null,
    // The parent as the row names it where the row names this body; a row naming the launch alone leaves the body's own identity.
    parent: { catalogueNumber: number, designator: named?.parent.designator ?? body?.designator ?? null, name: named?.parent.name ?? body?.name ?? null, launchedOn: named?.parent.launchedOn ?? body?.launch ?? null },
    event,
    rowEvent,
    step: publishedStepOf(latest.step),
    reasons: latest.reasons,
    reports,
    evidence: latest.evidence,
    bodies: latest.bodies ?? [],
    candidates: latest.candidates ?? [],
    row: row?.id ?? null,
    verdicts: cluster.map(({ verdict }) => publishedVerdictOf(verdict)),
  };
}

/**
 * The breakups fit to show from one replay: the frozen detector's verdicts
 * (the year file's, every state, in the order raised) landed on the ground
 * truth as it stands on main, earliest raised first. Pure: the catalogue's
 * identity of a parent comes in through `bodyOf`, and a confirmed object's
 * regime by its last set through `regimeAt` (the verdict's own where none
 * is given).
 *
 * A suspected verdict lands by its step on a `breakup` or `anomalous` row
 * of its object, the window widened by the regime's margin; a confirmed one
 * as the scorecard's Confirmed line lands it. Verdicts on one object whose
 * steps overlap are one breakup; a verdict with no step joins the breakup
 * of the row it lands on (the latest raised where the row holds two), and
 * two whose steps do not overlap are two breakups, whatever row they land
 * on. It is published
 * confirmed when the detector confirmed it or an agency notice on its row's object (`isAgencyWord`),
 * dated no earlier than the event, did; suspected when a dated outside
 * report (news, an analyst) names its row and no later verdict on its step
 * expired or dismissed it. A confirmation exempt as a release on purpose
 * is left out on its own; the breakup's other verdicts are published if
 * they qualify without it. GCAT, the catalogue and undated statements never
 * count. The id is the object and the day of the row's event where the row
 * dates it to the day or finer, else of the latest verdict's estimate, else
 * of the first raising (`publishedIdOf`); merging with what is already
 * published, which may fix an earlier id, and reading a confirmation on no
 * row as unreported once 90 days have passed, are the merge's
 * (`mergePublished`).
 */
export function selectPublished(verdicts: readonly Verdict[], breakups: readonly Breakup[], bodyOf: BodyOf, regimeAt?: RegimeAt): PublishedBreakup[] {
  const rows = rowsOf(breakups);
  const byId = new Map(breakups.map((row) => [row.id, row]));
  const landed: Landed[] = [];
  verdicts.forEach((verdict, i) => {
    if (verdict.kind !== "object" || verdict.number === null) return;
    const object = verdict as ObjectVerdict;
    if (verdict.state === "suspected") landed.push({ verdict: object, row: landSuspected(object, breakups) });
    if (verdict.state === "confirmed") {
      const confirmation = landedConfirmation(object, i, rows, byId, regimeAt);
      if (confirmation !== null) landed.push(confirmation);
    }
  });
  return clustersOf(landed)
    .map((cluster) => publishedOf(cluster, verdicts, bodyOf))
    .filter((published) => published !== null)
    .sort(byFirstRaised);
}
