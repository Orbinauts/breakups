import { BREAKUP_KINDS, REGIMES, type BreakupKind, type DetectorParameters, type LogRow, type Regime, type Verdict } from "../../src/index.ts";
import type { Manifest } from "../archive/archive.ts";
import { LINES, type Line, type YearScore } from "./match.ts";
import { DAY_MS, type TimeBasis } from "./replay.ts";

/**
 * The scorecard's cells: what a year's matched verdicts add up to over a
 * split of years, and the tables that show them. The headline split is
 * the validation one, the odd years, held out from the even years the
 * thresholds are fitted on; the reverse split, every year, the last three
 * and a chronological split (fitted up to 2017, validated from 2018) are
 * shown beside it so a fit that only describes its training years is seen
 * for what it is.
 *
 * The cells are per line (targets, undetectable, detected, late, missed
 * and the detection rate, whose target is nine in ten on the headline
 * line) and over the split (alerts, duplicates, exempt, false alarms, the
 * false-alarm rate, false alarms per ten thousand body-years, the lead
 * over the catalogue, the latency from the event, the confirmed share and
 * the timing error). The detection rate is detected over targets, where
 * late and missed both count against; the false-alarm rate is false
 * alarms over false alarms plus detections on every line, the owner's
 * "parent jumps it raises that match no such event".
 *
 * Two more things are read off the alerts. The precision per persistence
 * tier: every alert's row in the log says whether its step still held
 * after three and five post sets and after one, three, five and seven
 * days, and when each tier was reached, so the cells say what raising
 * only at that tier would have cost in false alarms and in detections
 * that still beat the catalogue, which is the owner's trade to make. And
 * the confirmations: of the alerts, how many the fragments or a notice
 * confirmed, how many of those were true, and how long after.
 */

export const SPLITS = ["validation", "train", "all", "recent", "chronologicalTrain", "chronologicalValidation"] as const;
export type SplitName = (typeof SPLITS)[number];

/** The last year of the chronological training split. */
export const CHRONOLOGICAL_SPLIT_YEAR = 2017;
/** How many of the latest years the recent split holds. */
export const RECENT_YEARS = 3;

export const SPLIT_TITLES: Record<SplitName, string> = {
  validation: "Validation: the odd years",
  train: "Training: the even years",
  all: "Every year",
  recent: `The last ${RECENT_YEARS} years`,
  chronologicalTrain: `Fitted on the years to ${CHRONOLOGICAL_SPLIT_YEAR}`,
  chronologicalValidation: `Validated on the years from ${CHRONOLOGICAL_SPLIT_YEAR + 1}`,
};

export const LINE_LABELS: Record<Line, string> = {
  "breakups A-B": "Breakups, confidence A and B (the target is 90%)",
  "breakups C": "Breakups, confidence C",
  "breakups D": "Breakups, confidence D",
  "anomalous A-B": "Anomalous events, confidence A and B",
  "anomalous C-D": "Anomalous events, confidence C and D",
};

export interface LineCells {
  targets: number;
  undetectable: number;
  detected: number;
  late: number;
  missed: number;
  /** Detected over targets; null where there is no target. */
  detectionRate: number | null;
}

export interface Spread {
  median: number;
  /** The tenth percentile for the lead (the worst leads), the ninetieth for the latency (the slowest alerts). */
  tail: number;
  count: number;
}

/** The persistence tiers the sweep reads off the alert rows: as raised (two post sets), and the later ones. */
export const TIERS = [
  { key: "2", label: "2 post sets over 18 h, or 3 (as raised)" },
  { key: "3", label: "3 post sets" },
  { key: "5", label: "5 post sets" },
  { key: "D1", label: "1 day of post sets" },
  { key: "D3", label: "3 days of post sets" },
  { key: "D5", label: "5 days of post sets" },
  { key: "D7", label: "7 days of post sets" },
] as const;
export type TierKey = (typeof TIERS)[number]["key"];

export interface TierCells {
  tier: TierKey;
  /** The alerts whose step still held at the tier (detections, late ones and false alarms alike), and of those the detections that still beat the catalogue and the false alarms. */
  raised: number;
  detections: number;
  falseAlarms: number;
  /** Detections over detections plus false alarms at the tier; null where both are zero. */
  precision: number | null;
  /** The tier's detections over the detections as raised; null where there were none. */
  detectionShare: number | null;
  leadHours: Spread | null;
}

export interface ConfirmedCells {
  /** The alerts a confirmed verdict followed, and of those how many had matched a reported event (a detection or a late alert), how many an exempt window or a duplicate, and how many nothing. */
  confirmations: number;
  ofTrue: number;
  ofExempt: number;
  ofFalseAlarms: number;
  /** Of the false alarms confirmed, how many were on the parent of a reported event whose window ended within the month before the step: the right object named late, which the product would show as that object's breakup. */
  ofNearEvent: number;
  /** The median days from the alert to its confirmation. */
  daysToConfirmation: number | null;
  /** The precision of the confirmed alerts: those on a reported event's step over all; and counting the near ones as right. Null with no confirmation. */
  precision: number | null;
  precisionByParent: number | null;
  /** The events the catalogue reported (targets whose launch gained new bodies within ninety days of the event), how many of those were alerted (detected or late), how many confirmed, and the days to the confirmation from the event and from the alert. */
  reported: number;
  reportedAlerted: number;
  reportedConfirmed: number;
  /** Confirmed over reported; null with no reported event. */
  confirmedRate: number | null;
  daysFromEvent: Spread | null;
  daysFromAlert: Spread | null;
  /** The targets with an agency's statement dated in the truth (a notice's day seen), and how many of those were confirmed before it. */
  withStatement: number;
  beforeStatement: number;
}

export interface Cells {
  years: number[];
  lines: Record<Line, LineCells>;
  alerts: number;
  duplicates: number;
  exempt: number;
  falseAlarms: number;
  review: number;
  tiers: TierCells[];
  confirmed: ConfirmedCells;
  /** False alarms over false alarms plus detections on every line; null where both are zero. */
  falseAlarmRate: number | null;
  bodyYears: number;
  falseAlarmsPer10kBodyYears: number | null;
  leadHours: Spread | null;
  latencyHours: Spread | null;
  /** Of the detections, the share a confirmed verdict followed, and the median days to it. */
  confirmedShare: number | null;
  daysToConfirmation: number | null;
  timingErrorMinutes: number | null;
  byRegime: Record<Regime, LineCells>;
  byKind: Record<BreakupKind, LineCells>;
}

/** What a year's file carries: the replay's record, the matched score, every verdict and log row. */
export interface YearFile {
  format: 1;
  year: number;
  archive: { source: Manifest["source"]["kind"]; builtAt: string; sets: number; bodies: number };
  detector: { name: string; parameters: DetectorParameters };
  timeBasis: TimeBasis;
  runs: number;
  sets: number;
  /** The warm-up run from the previous year's last weeks, or null where the states were carried from the previous year's replay, which `carried` says. */
  warmup: { year: number; runs: number; sets: number } | null;
  carried: boolean;
  bodyYears: number;
  replaySeconds: number;
  score: YearScore;
  verdicts: Verdict[];
  log: LogRow[];
}

/** The aggregate: the cells per split, with what they were computed from, and nothing that changes between two runs over the same inputs. */
export interface Latest {
  format: 1;
  package: { name: string; version: string };
  truthSha256: string;
  detector: { name: string; parameters: DetectorParameters };
  archive: Record<string, { source: Manifest["source"]["kind"]; builtAt: string; sets: number; bodies: number; timeBasis: TimeBasis }>;
  years: number[];
  splits: Record<SplitName, Cells>;
}

const emptyLine = (): LineCells => ({ targets: 0, undetectable: 0, detected: 0, late: 0, missed: 0, detectionRate: null });

function fill<K extends string>(keys: readonly K[]): Record<K, LineCells> {
  return Object.fromEntries(keys.map((key) => [key, emptyLine()])) as Record<K, LineCells>;
}

/** The nearest-rank percentile of the values, 0 to 100. */
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

const spread = (values: number[], tail: number): Spread | null => (values.length === 0 ? null : { median: percentile(values, 50), tail: percentile(values, tail), count: values.length });

function rate(line: LineCells): void {
  line.detectionRate = line.targets === 0 ? null : line.detected / line.targets;
}

/** The alert rows of the log, keyed by object and the step's second edge, over every year file: an alert raised in December closes in the next year's file. */
export type AlertRows = Map<string, LogRow>;

export const alertKey = (number: number, afterEpoch: number): string => `${number}:${Math.round(afterEpoch)}`;

export function alertRowsOf(files: Pick<YearFile, "log">[]): AlertRows {
  const rows: AlertRows = new Map();
  for (const file of files) for (const row of file.log) if (row.signals.phase === 3 && row.signals.afterEpoch !== undefined) rows.set(alertKey(row.number, row.signals.afterEpoch), row);
  return rows;
}

/** One counted alert as the tiers read it: its outcome as raised, the deadline it had to beat, its catalogue time, and its row. */
export interface TieredAlert {
  outcome: "detection" | "late" | "false-alarm";
  deadline: number;
  catalogueAt: number | null;
  leadHours: number | null;
  row: LogRow | undefined;
}

/** The tier cells over the counted alerts. */
export function tierCellsOf(alerts: TieredAlert[]): TierCells[] {
  const baseDetections = alerts.filter((a) => a.outcome === "detection").length;
  return TIERS.map(({ key }) => {
    let raised = 0;
    let detections = 0;
    let falseAlarms = 0;
    const leads: number[] = [];
    for (const alert of alerts) {
      let at = Number.NEGATIVE_INFINITY;
      if (key !== "2") {
        if (alert.row?.signals[`tier${key}Held`] !== 1) continue;
        at = alert.row.signals[`tier${key}At`]!;
      }
      raised++;
      if (alert.outcome === "false-alarm") falseAlarms++;
      else if (alert.outcome === "detection" && at < alert.deadline) {
        detections++;
        if (alert.catalogueAt !== null) leads.push(key === "2" ? alert.leadHours! : (alert.catalogueAt - at) / 3_600_000);
      }
    }
    return { tier: key, raised, detections, falseAlarms, precision: detections + falseAlarms === 0 ? null : detections / (detections + falseAlarms), detectionShare: baseDetections === 0 ? null : detections / baseDetections, leadHours: spread(leads, 10) };
  });
}

/** The cells over a set of scored years; the alert rows, where given, feed the persistence tiers. */
export function cellsOf(years: Pick<YearFile, "year" | "score" | "bodyYears">[], rows: AlertRows = new Map()): Cells {
  const lines = fill(LINES);
  const byRegime = fill(REGIMES);
  const byKind = fill(BREAKUP_KINDS);
  const cells: Cells = { years: years.map((y) => y.year).sort((a, b) => a - b), lines, alerts: 0, duplicates: 0, exempt: 0, falseAlarms: 0, review: 0, tiers: [], confirmed: { confirmations: 0, ofTrue: 0, ofExempt: 0, ofFalseAlarms: 0, ofNearEvent: 0, daysToConfirmation: null, precision: null, precisionByParent: null, reported: 0, reportedAlerted: 0, reportedConfirmed: 0, confirmedRate: null, daysFromEvent: null, daysFromAlert: null, withStatement: 0, beforeStatement: 0 }, falseAlarmRate: null, bodyYears: 0, falseAlarmsPer10kBodyYears: null, leadHours: null, latencyHours: null, confirmedShare: null, daysToConfirmation: null, timingErrorMinutes: null, byRegime, byKind };
  const leads: number[] = [];
  const latencies: number[] = [];
  const confirmations: number[] = [];
  const alertConfirmations: number[] = [];
  const reportedFromEvent: number[] = [];
  const reportedFromAlert: number[] = [];
  const timings: number[] = [];
  const tiered: TieredAlert[] = [];
  let detections = 0;
  let confirmed = 0;
  for (const { score, bodyYears } of years) {
    cells.bodyYears += bodyYears;
    cells.review += score.review.length;
    const eventsById = new Map(score.events.map((e) => [e.id, e]));
    for (const event of score.events) {
      for (const line of [lines[event.line], byRegime[event.regime], byKind[event.kind]]) {
        if (event.status === "undetectable") line.undetectable++;
        else {
          line.targets++;
          line[event.status]++;
        }
      }
      if (event.status === "detected") {
        detections++;
        if (event.leadHours !== null) leads.push(event.leadHours);
        if (event.latencyHours !== null) latencies.push(event.latencyHours);
        if (event.timingErrorMinutes !== null) timings.push(event.timingErrorMinutes);
        if (event.confirmedAt !== null) {
          confirmed++;
          confirmations.push(event.daysToConfirmation!);
        }
      }
      // The catalogue reported the event: new bodies under the launch within ninety days. Older year files have no count; the catalogue's first fragment within the span stands in.
      const reported = event.status !== "undetectable" && ((event.piecesWithin90Days ?? 0) > 0 || (event.piecesWithin90Days === undefined && event.catalogueAt !== null && event.catalogueAt - event.from <= 90 * DAY_MS));
      if (reported) {
        cells.confirmed.reported++;
        if (event.status === "detected" || event.status === "late") cells.confirmed.reportedAlerted++;
        if (event.confirmedAt !== null) {
          cells.confirmed.reportedConfirmed++;
          reportedFromEvent.push((event.confirmedAt - (event.at ?? event.from)) / DAY_MS);
          reportedFromAlert.push(event.daysToConfirmation!);
        }
      }
      // An agency's statement dated in the truth (a notice's day seen), whether or not the catalogue listed pieces: was the confirmation ahead of it?
      if (event.status !== "undetectable" && event.noticeAt !== null) {
        cells.confirmed.withStatement++;
        if (event.confirmedAt !== null && event.confirmedAt < event.noticeAt) cells.confirmed.beforeStatement++;
      }
    }
    for (const alert of score.alerts) {
      if (alert.outcome === "confirmation") continue;
      cells.alerts++;
      if (alert.outcome === "duplicate") cells.duplicates++;
      else if (alert.outcome === "exempt") cells.exempt++;
      else if (alert.outcome === "false-alarm") cells.falseAlarms++;
      if (alert.confirmedAt !== null) {
        cells.confirmed.confirmations++;
        if (alert.outcome === "detection" || alert.outcome === "late") cells.confirmed.ofTrue++;
        else if (alert.outcome === "exempt" || alert.outcome === "duplicate") cells.confirmed.ofExempt++;
        else {
          cells.confirmed.ofFalseAlarms++;
          if (alert.nearEvent !== null && alert.nearEvent !== undefined) cells.confirmed.ofNearEvent++;
        }
        alertConfirmations.push(alert.daysToConfirmation!);
      }
      if (alert.outcome === "detection" || alert.outcome === "late" || alert.outcome === "false-alarm") {
        const event = alert.event === null ? undefined : eventsById.get(alert.event);
        const deadline = Math.min(event?.catalogueAt ?? Number.POSITIVE_INFINITY, event?.noticeAt ?? Number.POSITIVE_INFINITY);
        tiered.push({ outcome: alert.outcome, deadline, catalogueAt: event?.catalogueAt ?? null, leadHours: event?.leadHours ?? null, row: alert.afterEpoch === null ? undefined : rows.get(alertKey(alert.number, alert.afterEpoch)) });
      }
    }
  }
  cells.tiers = tierCellsOf(tiered);
  cells.confirmed.daysToConfirmation = alertConfirmations.length === 0 ? null : percentile(alertConfirmations, 50);
  cells.confirmed.precision = cells.confirmed.confirmations === 0 ? null : cells.confirmed.ofTrue / cells.confirmed.confirmations;
  cells.confirmed.precisionByParent = cells.confirmed.confirmations === 0 ? null : (cells.confirmed.ofTrue + cells.confirmed.ofNearEvent) / cells.confirmed.confirmations;
  cells.confirmed.confirmedRate = cells.confirmed.reported === 0 ? null : cells.confirmed.reportedConfirmed / cells.confirmed.reported;
  cells.confirmed.daysFromEvent = spread(reportedFromEvent, 90);
  cells.confirmed.daysFromAlert = spread(reportedFromAlert, 90);
  for (const group of [lines, byRegime, byKind]) for (const line of Object.values(group) as LineCells[]) rate(line);
  cells.falseAlarmRate = cells.falseAlarms + detections === 0 ? null : cells.falseAlarms / (cells.falseAlarms + detections);
  cells.falseAlarmsPer10kBodyYears = cells.bodyYears === 0 ? null : (cells.falseAlarms / cells.bodyYears) * 10_000;
  cells.leadHours = spread(leads, 10);
  cells.latencyHours = spread(latencies, 90);
  cells.confirmedShare = detections === 0 ? null : confirmed / detections;
  cells.daysToConfirmation = confirmations.length === 0 ? null : percentile(confirmations, 50);
  cells.timingErrorMinutes = timings.length === 0 ? null : percentile(timings, 50);
  return cells;
}

/** Which years each split holds, of the years scored. */
export function splitYears(years: number[], split: SplitName): number[] {
  const sorted = [...years].sort((a, b) => a - b);
  switch (split) {
    case "validation":
      return sorted.filter((y) => y % 2 === 1);
    case "train":
      return sorted.filter((y) => y % 2 === 0);
    case "all":
      return sorted;
    case "recent":
      return sorted.slice(-RECENT_YEARS);
    case "chronologicalTrain":
      return sorted.filter((y) => y <= CHRONOLOGICAL_SPLIT_YEAR);
    case "chronologicalValidation":
      return sorted.filter((y) => y > CHRONOLOGICAL_SPLIT_YEAR);
  }
}

/** The aggregate over the year files. */
export function aggregate(files: YearFile[], meta: Pick<Latest, "package" | "truthSha256" | "detector">): Latest {
  const years = files.map((f) => f.year).sort((a, b) => a - b);
  const rows = alertRowsOf(files);
  const splits = Object.fromEntries(SPLITS.map((split) => [split, cellsOf(files.filter((f) => splitYears(years, split).includes(f.year)), rows)])) as Record<SplitName, Cells>;
  const archive = Object.fromEntries(files.sort((a, b) => a.year - b.year).map((f) => [String(f.year), { ...f.archive, timeBasis: f.timeBasis }]));
  return { format: 1, ...meta, archive, years, splits };
}

const DASH = "–";
const pct = (value: number | null | undefined): string => (value === null || value === undefined ? DASH : `${Math.round(value * 100)}%`);
const one = (value: number | null | undefined): string => (value === null || value === undefined ? DASH : value.toFixed(1));
const spreadCell = (value: Spread | null | undefined): string => (value === null || value === undefined ? DASH : `${one(value.median)} (${one(value.tail)})`);

function table(headers: string[], rows: (string | number)[][]): string {
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

/** The per-line table of a split: targets, undetectable, detected, late, missed and the rate. */
export function linesTable(cells: Cells, title: string): string {
  return table([title, "Targets", "Undetectable", "Detected", "Late", "Missed", "Detection rate"], LINES.map((line) => [LINE_LABELS[line], ...countsOf(cells.lines[line])]));
}

const countsOf = (line: LineCells): (string | number)[] => [line.targets, line.undetectable, line.detected, line.late, line.missed, pct(line.detectionRate)];

/** The table of a split's alerts and timings. */
export function alertsTable(cells: Cells, title: string): string {
  return table(
    [title, "Count"],
    [
      ["Alerts (object verdicts, suspected or confirmed)", cells.alerts],
      ["Duplicates", cells.duplicates],
      ["Exempt", cells.exempt],
      ["False alarms", cells.falseAlarms],
      ["False-alarm rate (the target is under 10%)", pct(cells.falseAlarmRate)],
      ["False alarms per 10,000 body-years", one(cells.falseAlarmsPer10kBodyYears)],
      ["Lead over the catalogue, hours: median (10th percentile)", spreadCell(cells.leadHours)],
      ["Latency from the event, hours: median (90th percentile)", spreadCell(cells.latencyHours)],
      ["Confirmed share of the detections", pct(cells.confirmedShare)],
      ["Days to confirmation, median", one(cells.daysToConfirmation)],
      ["Timing error, minutes, median", one(cells.timingErrorMinutes)],
      ["Cloud verdicts, for review (a burst with no parent step)", cells.review],
    ],
  );
}

/**
 * The table of a split's confirmed line: the events the catalogue
 * reported (new bodies under the launch within ninety days), how many of
 * those the detector confirmed and how long after the event and the
 * alert; the confirmed alerts and what they were on, with the precision
 * on the step and counting the right object named late; and how many
 * confirmations came before an agency's statement where the truth dates
 * one, which it does for the notices alone.
 */
export function confirmedTable(cells: Cells, title: string): string {
  const c = cells.confirmed;
  return table(
    [title, "Count"],
    [
      ["Events the catalogue reported (new bodies under the launch within 90 days)", c.reported],
      ["Of which alerted on the parent (detected or late)", c.reportedAlerted],
      ["Of which confirmed", c.reportedConfirmed],
      ["Confirmed share of the reported events", pct(c.confirmedRate)],
      ["Days from the event to the confirmation, median (90th percentile)", spreadCell(c.daysFromEvent)],
      ["Days from the alert to the confirmation, median (90th percentile)", spreadCell(c.daysFromAlert)],
      ["Confirmed alerts (by the fragments or a notice)", c.confirmations],
      ["Of which on a reported event's step (a detection or a late alert)", c.ofTrue],
      ["Of which inside an exempt window or a duplicate", c.ofExempt],
      ["Of which matching no reported event's step", c.ofFalseAlarms],
      ["Of those, on the parent of a reported event within the month before (the right object, the step late)", c.ofNearEvent],
      ["Precision of the confirmed alerts, on the step", pct(c.precision)],
      ["Precision of the confirmed alerts, on the object", pct(c.precisionByParent)],
      ["Targets with an agency's statement dated in the truth (the notices)", c.withStatement],
      ["Of which confirmed before that statement", c.beforeStatement],
    ],
  );
}

/** The table of a split's precision per persistence tier: what raising only once the step had held that long would have cost. */
export function tiersTable(cells: Cells, title: string): string {
  return table(
    [title, "Raised", "Detections still before the catalogue", "False alarms", "Precision", "Share of the detections kept", "Lead over the catalogue, hours: median (10th percentile)"],
    cells.tiers.map((tier) => [TIERS.find((t) => t.key === tier.tier)!.label, tier.raised, tier.detections, tier.falseAlarms, pct(tier.precision), pct(tier.detectionShare), spreadCell(tier.leadHours)]),
  );
}

/** The breakdown of a split's targets by regime and by kind. */
export function breakdownTable(cells: Cells, title: string): string {
  const rows: (string | number)[][] = [];
  for (const regime of REGIMES) if (cells.byRegime[regime].targets + cells.byRegime[regime].undetectable > 0) rows.push([regime, ...countsOf(cells.byRegime[regime])]);
  for (const kind of BREAKUP_KINDS) if (cells.byKind[kind].targets + cells.byKind[kind].undetectable > 0) rows.push([kind === "anomalous" ? "Anomalous events" : `${kind[0]!.toUpperCase()}${kind.slice(1)}s`, ...countsOf(cells.byKind[kind])]);
  return table([title, "Targets", "Undetectable", "Detected", "Late", "Missed", "Detection rate"], rows);
}

const yearsOf = (cells: Cells): string => (cells.years.length === 0 ? "no year" : cells.years.length === 1 ? String(cells.years[0]) : `${cells.years[0]} to ${cells.years.at(-1)}, ${cells.years.length} years`);

/** The four tables the README carries: the headline split. */
export function readmeTables(latest: Latest): string[] {
  const cells = latest.splits.validation;
  const title = `${SPLIT_TITLES.validation} (${yearsOf(cells)})`;
  const lower = `${title.charAt(0).toLowerCase()}${title.slice(1)}`;
  return [linesTable(cells, title), alertsTable(cells, `Alerts, ${lower}`), tiersTable(cells, `Precision per persistence tier, ${lower}`), confirmedTable(cells, `The confirmed line, ${lower}`)];
}

/** The whole report: every split's tables, with the breakdown. */
export function renderLatest(latest: Latest): string {
  const sections = [
    "# The scorecard, as last run",
    "",
    `Generated by \`npm run kpi -- --aggregate\` over the years ${latest.years[0]} to ${latest.years.at(-1)} of the Archive with the ${latest.detector.name} detector of \`${latest.package.name}\` ${latest.package.version}, against the ground truth whose SHA-256 is \`${latest.truthSha256}\`. The README's "How well it does" carries the first four tables; the tests check them against \`kpi/latest.json\`. Never edited by hand. The per-event dissection is in \`docs/detector/events.md\`, written with this file.`,
    "",
    "A target is a scoreable reported event whose parent had at least five public element sets in the sixty days before it; an event with fewer is undetectable and out of the denominator. Detected: an alert on the parent's own step before the first fragment's set was published and before any notice. Late: the same alert after that. The false-alarm rate is false alarms over false alarms plus detections on every line. A year with no publication times (one stripped from a yearly bundle) times the catalogue by the first fragment's epoch, a lower bound. The tier table reads every alert's later sets: what raising only once the step had held for that many post sets or days would have left of the false alarms and of the detections that still beat the catalogue. The confirmed table is the product's second line: of the targets the catalogue itself reported (new bodies under the launch within ninety days of the event), how many the fragments or a notice confirmed and how long after; and of every alert confirmed, how many were on a reported event's step, how many on the right object with the step late, and how many on nothing. The agencies' publication dates are not in the truth except for the notices, so the last two rows count those alone.",
    "",
  ];
  for (const split of SPLITS) {
    const cells = latest.splits[split];
    const title = `${SPLIT_TITLES[split]} (${yearsOf(cells)})`;
    const lower = `${title.charAt(0).toLowerCase()}${title.slice(1)}`;
    sections.push(`## ${SPLIT_TITLES[split]}`, "", linesTable(cells, title), "", alertsTable(cells, `Alerts, ${lower}`), "", tiersTable(cells, `Precision per persistence tier, ${lower}`), "", confirmedTable(cells, `The confirmed line, ${lower}`), "", breakdownTable(cells, `By regime and kind, ${lower}`), "");
  }
  sections.push("## The years", "", table(["Year", "Source", "Built", "Sets", "Bodies", "Timed by"], latest.years.map((year) => {
    const record = latest.archive[String(year)]!;
    return [year, record.source, record.builtAt.slice(0, 10), record.sets, record.bodies, record.timeBasis === "created" ? "publication time" : "epoch (a lower bound)"];
  })), "");
  return sections.join("\n");
}
