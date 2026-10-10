import { writeFileSync } from "node:fs";
import { ATTRIBUTION_PATHS, DETECTOR_PARAMETERS, EXPLANATION_BITS, MANOEUVRE_CLASSES, OUTCOMES, PHASES, REFUSALS, type LogRow } from "../../src/index.ts";
import { FRAGMENTS_DAYS } from "./catalogue.ts";

import { LINE_LABELS, SCORED_FROM_YEAR, firstConfirmationsOf, isConfirmedTarget, type FirstConfirmations, type Latest, type YearFile } from "./kpi.ts";
import { LINES, marginDaysOf, type Line, type ScoredEvent } from "./match.ts";
import { DAY_MS } from "./replay.ts";
import type { Truth } from "./run.ts";

/**
 * The per-event dissection: one row per scoreable event over every year
 * scored, with how it came out and why, written as `docs/detector/events.md`
 * beside the aggregate so it regenerates with the scorecard. The outcome
 * is the matcher's; the cause is read off the detector's own log for the
 * parent around the event's window, by the rules the first three phases'
 * dissections established by hand:
 *
 * - detected: what raised it (a unique step, or an atypical one on a
 *   manoeuvring record);
 * - late: whether the parent had no post set at all before the catalogue
 *   listed the first fragment, or had one and reached persistence only
 *   after;
 * - missed: the record gate (a persistent step the object's own record
 *   classed as a manoeuvre, with the class and the size against the
 *   record), a manoeuvre explanation from outside the record (a step on
 *   an object with no record of moving itself that its working status, a
 *   return to a held altitude, siblings or a deployment explained), a
 *   ramping fit (the step held at the post sets' centroid but
 *   not at the first post set), a step the later sets took back, a step
 *   that faded under the persistence gates, a candidate that lapsed with
 *   no further set, a persistent step on the parent within ten days of
 *   the window but outside the matcher's margin, no set of the parent
 *   between the event and the catalogue, or sets that left the model by
 *   nothing: the parent did not move;
 * - undetectable: too few public sets before the event.
 *
 * The lead over the catalogue, the confirmation and the timing error are
 * the matcher's cells for the event. The totals by cause close the file.
 */

const EXPLANATION_NAMES = Object.keys(EXPLANATION_BITS) as (keyof typeof EXPLANATION_BITS)[];
const EXPLANATION_WORDS: Record<keyof typeof EXPLANATION_BITS, string> = { record: "its record", maintenance: "a return to an altitude it held", siblings: "like steps of its launch-mates or shell-mates", deployment: "a deployment climb", workingStatus: "its working status at the step" };

/** How far from the window, in days, a persistent step on the parent is read as the event's step outside the margin. */
export const NEAR_WINDOW_DAYS = 10;

export const CAUSES = ["raised", "no post set before the catalogue", "persistence after the catalogue", "record gate", "manoeuvre explanation", "ramping fit", "step taken back", "below persistence", "no further set", "margin", "no sets before the catalogue", "parent did not move", "no public sets"] as const;
export type Cause = (typeof CAUSES)[number];

export interface Dissection {
  event: ScoredEvent;
  year: number;
  cause: Cause;
  detail: string;
}

/** Why the Confirmed line missed a target, read off the detector's attribution and cloud rows for the launch in the 180 days after the event. */
export const CONFIRMED_CAUSES = ["confirmed", "confirmed at the launch", "attributed to another body", "no common origin", "a crewed station", "ambiguous parent", "old cloud", "young launch", "backlog", "velocity floor", "single piece", "fresh piece", "too few pieces", "no convergence", "not timed", "analyst range", "cataloguing batch", "parent not a candidate", "no piece in a plane the detector read", "no new body seen", "no fragments catalogued", "no parent orbit"] as const;
export type ConfirmedCause = (typeof CONFIRMED_CAUSES)[number];

/** The refusal bits in the order a cause is named by: the first that applies. */
const REFUSAL_CAUSES: [number, ConfirmedCause][] = [
  [REFUSALS.ambiguous, "ambiguous parent"],
  [REFUSALS.parentInCloud | REFUSALS.piecesInCloud | REFUSALS.nearerThanCloud, "old cloud"],
  [REFUSALS.youngLaunch, "young launch"],
  [REFUSALS.background, "backlog"],
  [REFUSALS.velocity, "velocity floor"],
  [REFUSALS.singlePiece, "single piece"],
  [REFUSALS.freshPiece, "fresh piece"],
  [REFUSALS.minPieces, "too few pieces"],
  [REFUSALS.miss, "no convergence"],
  [REFUSALS.untimed, "not timed"],
  [REFUSALS.analyst, "analyst range"],
  [REFUSALS.batch, "cataloguing batch"],
  [REFUSALS.origin, "no common origin"],
  [REFUSALS.station, "a crewed station"],
];

/** The words for refusal bits. */
export function refusalWords(bits: number): string {
  const words: string[] = [];
  for (const [bit, cause] of REFUSAL_CAUSES) if ((bits & bit) !== 0) words.push(cause);
  return words.join(", ");
}

/** The attribution and cloud rows of every file, by the launch's code. */
type LaunchRows = Map<number, LogRow[]>;

function launchRowsOf(files: YearFile[]): LaunchRows {
  const rows: LaunchRows = new Map();
  for (const file of files) for (const row of file.log) if ((row.signals.phase === PHASES.attribution || row.signals.phase === PHASES.cloud) && row.signals.launch !== undefined) (rows.get(row.signals.launch) ?? rows.set(row.signals.launch, []).get(row.signals.launch)!).push(row);
  return rows;
}

const launchCode = (launch: string | null): number | null => (launch === null ? null : Number(launch.slice(0, 4)) * 1000 + Number(launch.slice(5, 8)));

/** The Confirmed line's reading of one event: confirmed (and how), not a target, or the cause of the miss and what the log says. */
export function dissectConfirmed(event: ScoredEvent, first: FirstConfirmations, launchRows: LaunchRows, firstTwins: FirstConfirmations = first): { cause: ConfirmedCause; detail: string } {
  const confirmation = first.get(event.id);
  const twin = firstTwins.get(event.id);
  if (confirmation === undefined && twin !== undefined && isConfirmedTarget(event)) {
    const landing = twin.landing;
    return { cause: "confirmed at the launch", detail: `a verdict naming launch ${landing.launch ?? "–"} with its candidates ${(landing.candidates ?? []).join(", ")}, ${landing.number} first, ${((landing.raisedAt - (event.at ?? event.from)) / DAY_MS).toFixed(1)} d after the event: a detection with the twins matched at the launch, a miss on the body named` };
  }
  if (!isConfirmedTarget(event)) {
    const cause: ConfirmedCause = event.fragments !== undefined && !event.fragments.parentOrbit ? "no parent orbit" : "no fragments catalogued";
    return { cause, detail: confirmation === undefined ? "" : "confirmed none the less" };
  }
  if (confirmation !== undefined) {
    const landing = confirmation.landing;
    const statement = event.statement === null || event.statement === undefined ? "" : `, ${((event.statement.at - landing.raisedAt) / DAY_MS).toFixed(1)} d ${landing.raisedAt < event.statement.at ? "before" : "after"} the first agency statement (${event.statement.source}, to the ${event.statement.precision})`;
    return { cause: "confirmed", detail: `${landing.attributed ? "attributed from the pieces" : "the step alert confirmed by the pieces"} ${((landing.raisedAt - (event.at ?? event.from)) / DAY_MS).toFixed(1)} d after the event, ${((landing.raisedAt - event.fragments!.firstAt!) / DAY_MS).toFixed(1)} d after the first fragment's publication${statement}` };
  }
  const code = launchCode(event.launch);
  const window = (event.at ?? event.from) - marginDaysOf(event.regime) * DAY_MS;
  const until = event.to + FRAGMENTS_DAYS * DAY_MS;
  const rows = (code === null ? [] : launchRows.get(code) ?? []).filter((row) => row.at >= window && row.at <= until);
  const attributions = rows.filter((row) => row.signals.phase === PHASES.attribution);
  const own = attributions.filter((row) => row.number === event.parent);
  if (own.length > 0) {
    const bits = own.reduce((all, row) => all | (row.signals.attributionRefused ?? 0), 0);
    const cause = REFUSAL_CAUSES.find(([bit]) => (bits & bit) !== 0)?.[1] ?? "too few pieces";
    const paths = [...new Set(own.map((row) => (row.signals.attributionPath === ATTRIBUTION_PATHS.alert ? "the step alert" : row.signals.attributionPath === ATTRIBUTION_PATHS.analyst ? "an analyst range" : "an attribution")))].join(" and ");
    const best = own.reduce((most, row) => Math.max(most, row.signals.attributionPieces ?? 0), 0);
    return { cause, detail: `${own.length} judgement${own.length === 1 ? "" : "s"} of pieces for the parent (${paths}), at most ${best} in its plane, refused: ${refusalWords(bits)}` };
  }
  const elsewhere = attributions.filter((row) => row.signals.attributionRaised === 1);
  if (elsewhere.length > 0) return { cause: "attributed to another body", detail: `the pieces were attributed to ${[...new Set(elsewhere.map((row) => row.number))].join(", ")} of the launch` };
  const clouds = rows.filter((row) => row.signals.phase === PHASES.cloud);
  if (attributions.length > 0) return { cause: "parent not a candidate", detail: `pieces were judged for ${[...new Set(attributions.map((row) => row.number))].join(", ")} of the launch, never for the parent` };
  if (clouds.length > 0) {
    const inPlane = clouds.reduce((most, row) => Math.max(most, row.signals.inPlane3 ?? 0), 0);
    return inPlane > 0 ? { cause: "parent not a candidate", detail: `${clouds.length} run${clouds.length === 1 ? "" : "s"} brought the launch new bodies, at most ${inPlane} in a plane of its bodies, none judged for the parent` } : { cause: "no piece in a plane the detector read", detail: `${clouds.length} run${clouds.length === 1 ? "" : "s"} brought the launch new bodies, none in the plane of a body the detector held` };
  }
  return { cause: "no new body seen", detail: "the detector saw no new body under the launch in the 180 days after the event" };
}

/** The log rows of an object with a step bracket, over every file. */
function rowsOf(files: YearFile[], number: number): LogRow[] {
  const rows: LogRow[] = [];
  for (const file of files) for (const row of file.log) if (row.number === number && row.signals.phase !== PHASES.cloud && row.signals.afterEpoch !== undefined) rows.push(row);
  return rows.sort((a, b) => a.signals.afterEpoch! - b.signals.afterEpoch!);
}

const overlapsWindow = (row: LogRow, from: number, to: number, slackMs: number): boolean => row.signals.beforeEpoch! <= to + slackMs && row.signals.afterEpoch! >= from - slackMs;

const days = (ms: number): string => `${(ms / DAY_MS).toFixed(1)} d`;

/** What raised an alerted event: the class of the step on the parent's record, from the verdict's evidence. */
function raisedBy(files: YearFile[], event: ScoredEvent): string {
  const file = files.find((f) => f.score.events.some((e) => e.id === event.id));
  const verdict = event.alert === null ? undefined : file?.verdicts[event.alert];
  if (verdict === undefined) return "";
  const cls = MANOEUVRE_CLASSES[verdict.evidence.manoeuvreClass ?? -1];
  const atypical = verdict.evidence.atypical ?? 0;
  if (verdict.state === "confirmed" && verdict.step !== null && verdict.evidence.daysToConfirmation !== undefined) return `a step the record read as a manoeuvre, promoted by the pieces`;
  const size = [verdict.evidence.deltaKm === undefined ? `${verdict.step?.deltaKm.toFixed(2) ?? "?"} km` : `${verdict.evidence.deltaKm.toFixed(2)} km`, verdict.evidence.zk === undefined ? null : `${verdict.evidence.zk.toFixed(0)} sigma over ${verdict.evidence.k ?? "?"} post sets`].filter((part) => part !== null).join(", ");
  if (cls === "unique" || cls === undefined) return `a unique step: ${size}`;
  return `an atypical step on ${cls === "occasional" ? "an" : "a"} ${cls} record (${atypical} test${atypical === 1 ? "" : "s"} passed): ${size}${verdict.evidence.typicality !== undefined ? `, ${verdict.evidence.typicality.toFixed(1)} times the record's median` : ""}`;
}

/** The cause of one event's outcome, from the matcher's cells and the parent's log rows. */
export function dissect(files: YearFile[], event: ScoredEvent, year: number): Dissection {
  const params = DETECTOR_PARAMETERS;
  const margin = marginDaysOf(event.regime) * DAY_MS;
  if (event.status === "undetectable") return { event, year, cause: "no public sets", detail: `${event.parentSetsBefore} set${event.parentSetsBefore === 1 ? "" : "s"} of the parent in the sixty days before` };
  if (event.status === "detected") return { event, year, cause: "raised", detail: raisedBy(files, event) };
  const deadline = Math.min(event.catalogueAt ?? Number.POSITIVE_INFINITY, event.noticeAt ?? Number.POSITIVE_INFINITY);
  if (event.status === "late") {
    const first = event.step?.afterEpoch ?? Number.POSITIVE_INFINITY;
    if (first >= deadline) return { event, year, cause: "no post set before the catalogue", detail: `the parent's first set after the event is dated ${days(first - deadline)} after the catalogue's first fragment${event.noticeAt !== null && event.noticeAt <= (event.catalogueAt ?? Number.POSITIVE_INFINITY) ? " (a notice)" : ""}; ${raisedBy(files, event)}` };
    return { event, year, cause: "persistence after the catalogue", detail: `the first post set came ${days(deadline - first)} before the catalogue, the alert ${days(event.alertAt! - deadline)} after it; ${raisedBy(files, event)}` };
  }
  const rows = rowsOf(files, event.parent);
  const inWindow = rows.filter((row) => overlapsWindow(row, event.from, event.to, margin) && row.signals.phase === PHASES.close);
  const closed = (outcome: number): LogRow | undefined => inWindow.find((row) => row.signals.outcome === outcome);
  const manoeuvre = closed(OUTCOMES.manoeuvre);
  if (manoeuvre !== undefined) {
    const s = manoeuvre.signals;
    const cls = MANOEUVRE_CLASSES[s.manoeuvreClass ?? -1] ?? "?";
    // A step the record left unique and an explanation from outside it read as a manoeuvre: the working status, a return to a held altitude, siblings or a deployment.
    const outside = EXPLANATION_NAMES.filter((name) => name !== "record" && ((s.explanationBits ?? 0) & EXPLANATION_BITS[name]) !== 0);
    if (cls === "unique" && outside.length > 0) return { event, year, cause: "manoeuvre explanation", detail: `a persistent step of ${s.deltaKm?.toFixed(2)} km (${s.zk?.toFixed(0)} sigma) on an object with no record of moving itself, read as a manoeuvre by ${outside.map((name) => EXPLANATION_WORDS[name]).join(" and ")}, with no breakup signature against it` };
    return { event, year, cause: "record gate", detail: `a persistent step of ${s.deltaKm?.toFixed(2)} km (${s.zk?.toFixed(0)} sigma) classed ${cls}: ${s.n730 ?? "?"} accepted step${s.n730 === 1 ? "" : "s"} in two years, the step ${s.typicality !== undefined && Number.isFinite(s.typicality) ? `${s.typicality.toFixed(1)} times the record's median` : "of the record's size"}, consistency ${s.impulseConsistency?.toFixed(0) ?? "?"} under ${params.consistencyMin}` };
  }
  const faded = closed(OUTCOMES.faded);
  if (faded !== undefined) {
    const s = faded.signals;
    if (Math.abs(s.zk ?? 0) < params.zPersist && Math.abs(s.zMean ?? 0) >= params.zPersist) return { event, year, cause: "ramping fit", detail: `the step reads ${s.zk?.toFixed(1)} sigma at the first post set and ${s.zMean?.toFixed(1)} at the post sets' centroid over ${s.k} sets: the catalogue's fit converged on the new orbit over several sets` };
    const why = Math.abs(s.zk ?? 0) < params.zPersist ? `${s.zk?.toFixed(1)} sigma under ${params.zPersist}` : (s.stepEvidence ?? 0) < params.evidenceMin ? `evidence ${s.stepEvidence?.toFixed(1)} against a drift under ${params.evidenceMin}` : `the later sets kept ${s.rhoMedian?.toFixed(2)} of the first jump, outside ${params.rhoMin} to ${params.rhoMax}`;
    return { event, year, cause: "below persistence", detail: `a candidate of ${s.delta1?.toFixed(3)} km closed after ${s.k} post sets: ${why}` };
  }
  const reverted = closed(OUTCOMES.reverted);
  if (reverted !== undefined) return { event, year, cause: "step taken back", detail: `the first post set jumped ${reverted.signals.delta1?.toFixed(3)} km (${reverted.signals.z1?.toFixed(0)} sigma) and the ${reverted.signals.k! - 1} after it kept ${reverted.signals.rhoMedian?.toFixed(2)} of the jump` };
  const lapsed = closed(OUTCOMES.lapsed);
  if (lapsed !== undefined) return { event, year, cause: "no further set", detail: `a candidate of ${lapsed.signals.delta1?.toFixed(3)} km (${lapsed.signals.z1?.toFixed(0)} sigma) lapsed with ${lapsed.signals.k} post set${lapsed.signals.k === 1 ? "" : "s"}: no further set within ${params.lapseDays[event.regime === "unknown" ? "LEO" : event.regime]} days` };
  const suspectedHere = closed(OUTCOMES.suspected);
  if (suspectedHere !== undefined) return { event, year, cause: "below persistence", detail: `a persistent step was raised on the bracket but counted on nothing: ${suspectedHere.signals.deltaKm?.toFixed(2)} km` };
  const near = rows.find((row) => row.signals.phase === PHASES.close && (row.signals.outcome === OUTCOMES.suspected || row.signals.outcome === OUTCOMES.manoeuvre) && overlapsWindow(row, event.from, event.to, NEAR_WINDOW_DAYS * DAY_MS));
  if (near !== undefined) {
    const gap = near.signals.afterEpoch! < event.from ? event.from - near.signals.afterEpoch! : near.signals.beforeEpoch! - event.to;
    return { event, year, cause: "margin", detail: `a persistent step of ${near.signals.deltaKm?.toFixed(2)} km on the parent ${days(gap)} ${near.signals.afterEpoch! < event.from ? "before" : "after"} the stated window, outside the ${marginDaysOf(event.regime)}-day margin, read as ${near.signals.outcome === OUTCOMES.suspected ? "suspected" : "a manoeuvre"}` };
  }
  if (event.parentSetsAfter === 0) return { event, year, cause: "no sets before the catalogue", detail: event.catalogueAt === null ? `no set of the parent in the thirty days after the event` : `no set of the parent between the event and the catalogue's first fragment, ${days(event.catalogueAt - event.from)} later` };
  const opened = rows.filter((row) => row.signals.phase === PHASES.open && overlapsWindow(row, event.from, event.to, margin));
  return { event, year, cause: "parent did not move", detail: `${event.parentSetsAfter} set${event.parentSetsAfter === 1 ? "" : "s"} of the parent between the event and the catalogue, none left the object's model by ${params.zCand} sigma${opened.length > 0 ? " (a candidate opened and was still open at the year's end)" : ""}` };
}

const iso = (ms: number | null): string => (ms === null ? "–" : new Date(ms).toISOString().slice(0, 10));

function leadCell(event: ScoredEvent): string {
  if (event.status === "undetectable" || event.status === "missed") return event.catalogueAt === null ? "no pieces in the year" : `pieces ${days(event.catalogueAt - event.from)} after`;
  if (event.leadHours === null) return event.noticeAt === null ? "no pieces in the year" : "before a notice";
  return event.leadHours >= 0 ? `${(event.leadHours / 24).toFixed(1)} d before` : `${(-event.leadHours / 24).toFixed(1)} d after`;
}

function confirmedCell(event: ScoredEvent): string {
  if (event.confirmedAt === null) return event.status === "detected" || event.status === "late" ? "no" : "–";
  return `${event.daysToConfirmation!.toFixed(1)} d after the alert, ${((event.confirmedAt - (event.at ?? event.from)) / DAY_MS).toFixed(1)} d after the event`;
}

const escape = (text: string): string => text.replace(/\|/g, "\\|");

/** The dissection of every scoreable event over the files, headline line first. */
export function dissectAll(files: YearFile[]): Dissection[] {
  const all: Dissection[] = [];
  for (const file of files) for (const event of file.score.events) all.push(dissect(files, event, file.year));
  const order = new Map(LINES.map((line, i) => [line, i]));
  return all.sort((a, b) => order.get(a.event.line)! - order.get(b.event.line)! || a.event.from - b.event.from);
}

function confirmedTotals(rows: { cause: ConfirmedCause }[]): string[] {
  const counts = new Map<ConfirmedCause, number>();
  for (const row of rows) counts.set(row.cause, (counts.get(row.cause) ?? 0) + 1);
  return CONFIRMED_CAUSES.filter((cause) => counts.has(cause)).map((cause) => `| ${cause} | ${counts.get(cause)} |`);
}

function totals(rows: Dissection[]): string[] {
  const counts = new Map<Cause, number>();
  for (const row of rows) counts.set(row.cause, (counts.get(row.cause) ?? 0) + 1);
  return CAUSES.filter((cause) => counts.has(cause)).map((cause) => `| ${cause} | ${counts.get(cause)} |`);
}

export function renderEvents(files: YearFile[], latest: Latest): string {
  const rows = dissectAll(files);
  const first = firstConfirmationsOf(files);
  const firstTwins = firstConfirmationsOf(files, true);
  const launchRows = launchRowsOf(files);
  const confirmed = new Map(rows.map((r) => [r.event.id, dissectConfirmed(r.event, first, launchRows, firstTwins)]));
  const years = files.map((f) => f.year).sort((a, b) => a - b);
  const out: string[] = [
    "# The events, dissected",
    "",
    `Generated by \`npm run kpi -- --aggregate\` with the scorecard, over the years ${years[0]} to ${years.at(-1)} of the Archive with the ${latest.detector.name} detector: one row per scoreable reported event, with the Confirmed line's outcome and its cause first (the target since the seventh decision record), then the parent-step line's outcome, the cause as the detector's own log for the parent gives it, the alert's lead over the catalogue's first fragment, whether and when the alert was confirmed, and the timing error where the truth states a minute. Never edited by hand. The validation years are the odd ones; ${SCORED_FROM_YEAR - 1}, the warm-up year, is replayed and listed but scored on no split, and the totals leave it out.`,
    "",
    "The Confirmed line's causes: **confirmed** (the first confirmed verdict by pieces on the parent within 180 days: attributed from the pieces, or the step alert confirmed by them, with the days after the event, after the first fragment's publication and before or after the first agency statement); **confirmed at the launch** (a miss on the body named, confirmed only with the twins matched at the launch: a verdict naming the launch with the parent among its candidates); **no fragments catalogued** and **no parent orbit** (not a target: no fresh piece in the parent's plane within 180 days, or no set of the parent before the event to test a plane against); and for a miss, read off the detector's attribution rows for the launch in the 180 days after the event, the first that applies: **ambiguous parent** (the pieces lay in the plane of another body of the launch too and did not converge on the parent clearly better), **old cloud** (the launch remembered a cloud within the year and the parent or the pieces lay in its plane), **young launch** (under a month old), **backlog** (the launch was still cataloguing an old cloud), **velocity floor**, **single piece**, **fresh piece** (a debris-classed parent itself a fresh piece), **too few pieces**, **no convergence** (propagated back, the pieces missed the parent), **not timed**, **analyst range** (the pieces were analyst objects), **cataloguing batch** (the run listed new bodies under many old launches at once), **no common origin** (the pieces' own closest approaches to the parent, propagated back, did not share an instant), **a crewed station** (a station's launch, whose pieces are released on purpose); **attributed to another body** (the launch's pieces were attributed to another of its bodies); **parent not a candidate** (pieces were judged for other bodies of the launch, or lay in some plane, but never for the parent: a debris-classed parent, or one the detector held no set of); **no piece in a plane the detector read**; **no new body seen** (none under the launch in the window, as when the pieces were catalogued as analyst objects).",
    "",
    "The causes: **raised** (detected, with what raised it); **no post set before the catalogue** and **persistence after the catalogue** (late: the parent's first set after the event came after the first fragment's, or came before it but the second or third did not); **record gate** (a persistent step the object's own record classed as a manoeuvre); **manoeuvre explanation** (a persistent step on an object with no record of moving itself that an explanation from outside the record read as a manoeuvre: its working status at the step, a return to a held altitude, siblings or a deployment); **ramping fit** (the step held at the post sets' centroid but not at the first post set); **step taken back** (the later sets undid the first jump); **below persistence** (a candidate that faded under the gates); **no further set** (a candidate that lapsed); **margin** (a persistent step on the parent within ten days of the window but outside the matcher's margin); **no sets before the catalogue** (no set of the parent between the event and the first fragment); **parent did not move** (the parent had sets and none left its model); **no public sets** (undetectable, out of the denominator).",
    "",
  ];
  for (const line of LINES) {
    const mine = rows.filter((r) => r.event.line === line);
    if (mine.length === 0) continue;
    out.push(`## ${LINE_LABELS[line].replace(" (the headline line)", "")}`, "", `| Year | Event | Regime | Confirmed line | Why | Parent step | Cause | What the log says | Lead over the catalogue | Step alert confirmed | Timing error |`, `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
    for (const r of mine) {
      const e = r.event;
      const c = confirmed.get(e.id)!;
      out.push(`| ${r.year}${r.year < SCORED_FROM_YEAR ? " (warm-up)" : ""} | ${escape(e.name)} (${e.parent}, ${e.launch ?? "no launch"}), ${iso(e.at ?? e.from)}${e.at === null ? ` to ${iso(e.to)}` : ""} | ${e.regime} | ${c.cause} | ${escape(c.detail)} | ${e.status} | ${r.cause} | ${escape(r.detail)} | ${leadCell(e)} | ${confirmedCell(e)} | ${e.timingErrorMinutes === null ? "–" : `${e.timingErrorMinutes.toFixed(0)} min`} |`);
    }
    const scored = mine.filter((r) => r.year >= SCORED_FROM_YEAR);
    out.push("", `| Totals, ${LINE_LABELS[line].replace(" (the headline line)", "").toLowerCase()} | Events |`, `| --- | --- |`, ...totals(scored), "", `| Confirmed line, ${LINE_LABELS[line].replace(" (the headline line)", "").toLowerCase()} | Events |`, `| --- | --- |`, ...confirmedTotals(scored.map((r) => confirmed.get(r.event.id)!)), "");
  }
  const counted = rows.filter((r) => r.year >= SCORED_FROM_YEAR);
  const headline = counted.filter((r) => r.event.line === "breakups A-B");
  const validation = headline.filter((r) => r.year % 2 === 1);
  const training = headline.filter((r) => r.year % 2 === 0);
  out.push("## The Confirmed line's causes", "", "| Cause | Breakups A and B, training (even years) | Breakups A and B, validation (odd years) | Every line, every scored year |", "| --- | --- | --- | --- |");
  for (const cause of CONFIRMED_CAUSES) {
    const count = (set: Dissection[]): number => set.filter((r) => confirmed.get(r.event.id)!.cause === cause).length;
    if (count(counted) === 0) continue;
    out.push(`| ${cause} | ${count(training)} | ${count(validation)} | ${count(counted)} |`);
  }
  out.push("");
  out.push("## Totals by cause, the parent-step line", "", "| Cause | Breakups A and B, validation (odd years) | Breakups A and B, every scored year | Every line, every scored year |", "| --- | --- | --- | --- |");
  for (const cause of CAUSES) {
    const count = (set: Dissection[]): number => set.filter((r) => r.cause === cause).length;
    if (count(counted) === 0) continue;
    out.push(`| ${cause} | ${count(validation)} | ${count(headline)} | ${count(counted)} |`);
  }
  out.push("");
  return out.join("\n");
}

export function writeEvents(path: string, files: YearFile[], _truth: Truth, latest: Latest): void {
  writeFileSync(path, renderEvents(files, latest));
}

