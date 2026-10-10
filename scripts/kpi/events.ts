import { writeFileSync } from "node:fs";
import { DETECTOR_PARAMETERS, MANOEUVRE_CLASSES, OUTCOMES, PHASES, type LogRow } from "../../src/index.ts";

import { LINE_LABELS, type Latest, type YearFile } from "./kpi.ts";
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
 *   record), a ramping fit (the step held at the post sets' centroid but
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

/** How far from the window, in days, a persistent step on the parent is read as the event's step outside the margin. */
export const NEAR_WINDOW_DAYS = 10;

export const CAUSES = ["raised", "no post set before the catalogue", "persistence after the catalogue", "record gate", "ramping fit", "step taken back", "below persistence", "no further set", "margin", "no sets before the catalogue", "parent did not move", "no public sets"] as const;
export type Cause = (typeof CAUSES)[number];

export interface Dissection {
  event: ScoredEvent;
  year: number;
  cause: Cause;
  detail: string;
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

function totals(rows: Dissection[]): string[] {
  const counts = new Map<Cause, number>();
  for (const row of rows) counts.set(row.cause, (counts.get(row.cause) ?? 0) + 1);
  return CAUSES.filter((cause) => counts.has(cause)).map((cause) => `| ${cause} | ${counts.get(cause)} |`);
}

export function renderEvents(files: YearFile[], latest: Latest): string {
  const rows = dissectAll(files);
  const years = files.map((f) => f.year).sort((a, b) => a - b);
  const out: string[] = [
    "# The events, dissected",
    "",
    `Generated by \`npm run kpi -- --aggregate\` with the scorecard, over the years ${years[0]} to ${years.at(-1)} of the Archive with the ${latest.detector.name} detector: one row per scoreable reported event, with the matcher's outcome, the cause as the detector's own log for the parent gives it, the alert's lead over the catalogue's first fragment, whether and when the alert was confirmed, and the timing error where the truth states a minute. Never edited by hand. The validation years are the odd ones.`,
    "",
    "The causes: **raised** (detected, with what raised it); **no post set before the catalogue** and **persistence after the catalogue** (late: the parent's first set after the event came after the first fragment's, or came before it but the second or third did not); **record gate** (a persistent step the object's own record classed as a manoeuvre); **ramping fit** (the step held at the post sets' centroid but not at the first post set); **step taken back** (the later sets undid the first jump); **below persistence** (a candidate that faded under the gates); **no further set** (a candidate that lapsed); **margin** (a persistent step on the parent within ten days of the window but outside the matcher's margin); **no sets before the catalogue** (no set of the parent between the event and the first fragment); **parent did not move** (the parent had sets and none left its model); **no public sets** (undetectable, out of the denominator).",
    "",
  ];
  for (const line of LINES) {
    const mine = rows.filter((r) => r.event.line === line);
    if (mine.length === 0) continue;
    out.push(`## ${LINE_LABELS[line].replace(" (the target is 90%)", "")}`, "", `| Year | Event | Regime | Outcome | Cause | What the log says | Lead over the catalogue | Confirmed | Timing error |`, `| --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
    for (const r of mine) {
      const e = r.event;
      out.push(`| ${r.year} | ${escape(e.name)} (${e.parent}, ${e.launch ?? "no launch"}), ${iso(e.at ?? e.from)}${e.at === null ? ` to ${iso(e.to)}` : ""} | ${e.regime} | ${e.status} | ${r.cause} | ${escape(r.detail)} | ${leadCell(e)} | ${confirmedCell(e)} | ${e.timingErrorMinutes === null ? "–" : `${e.timingErrorMinutes.toFixed(0)} min`} |`);
    }
    out.push("", `| Totals, ${LINE_LABELS[line].replace(" (the target is 90%)", "").toLowerCase()} | Events |`, `| --- | --- |`, ...totals(mine), "");
  }
  const headline = rows.filter((r) => r.event.line === "breakups A-B");
  const validation = headline.filter((r) => r.year % 2 === 1);
  out.push("## Totals by cause", "", "| Cause | Breakups A and B, validation (odd years) | Breakups A and B, every year | Every line, every year |", "| --- | --- | --- | --- |");
  for (const cause of CAUSES) {
    const count = (set: Dissection[]): number => set.filter((r) => r.cause === cause).length;
    if (count(rows) === 0) continue;
    out.push(`| ${cause} | ${count(validation)} | ${count(headline)} | ${count(rows)} |`);
  }
  out.push("");
  return out.join("\n");
}

export function writeEvents(path: string, files: YearFile[], _truth: Truth, latest: Latest): void {
  writeFileSync(path, renderEvents(files, latest));
}

