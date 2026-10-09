import { BREAKUP_KINDS, REGIMES, type BreakupKind, type DetectorParameters, type LogRow, type Regime, type Verdict } from "../../src/index.ts";
import type { Manifest } from "../archive/archive.ts";
import { LINES, type Line, type YearScore } from "./match.ts";
import type { TimeBasis } from "./replay.ts";

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

export interface Cells {
  years: number[];
  lines: Record<Line, LineCells>;
  alerts: number;
  duplicates: number;
  exempt: number;
  falseAlarms: number;
  review: number;
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
  warmup: { year: number; runs: number; sets: number } | null;
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

/** The cells over a set of scored years. */
export function cellsOf(years: Pick<YearFile, "year" | "score" | "bodyYears">[]): Cells {
  const lines = fill(LINES);
  const byRegime = fill(REGIMES);
  const byKind = fill(BREAKUP_KINDS);
  const cells: Cells = { years: years.map((y) => y.year).sort((a, b) => a - b), lines, alerts: 0, duplicates: 0, exempt: 0, falseAlarms: 0, review: 0, falseAlarmRate: null, bodyYears: 0, falseAlarmsPer10kBodyYears: null, leadHours: null, latencyHours: null, confirmedShare: null, daysToConfirmation: null, timingErrorMinutes: null, byRegime, byKind };
  const leads: number[] = [];
  const latencies: number[] = [];
  const confirmations: number[] = [];
  const timings: number[] = [];
  let detections = 0;
  let confirmed = 0;
  for (const { score, bodyYears } of years) {
    cells.bodyYears += bodyYears;
    cells.review += score.review.length;
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
    }
    for (const alert of score.alerts) {
      cells.alerts++;
      if (alert.outcome === "duplicate") cells.duplicates++;
      else if (alert.outcome === "exempt") cells.exempt++;
      else if (alert.outcome === "false-alarm") cells.falseAlarms++;
    }
  }
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
  const splits = Object.fromEntries(SPLITS.map((split) => [split, cellsOf(files.filter((f) => splitYears(years, split).includes(f.year)))])) as Record<SplitName, Cells>;
  const archive = Object.fromEntries(files.sort((a, b) => a.year - b.year).map((f) => [String(f.year), { ...f.archive, timeBasis: f.timeBasis }]));
  return { format: 1, ...meta, archive, years, splits };
}

const DASH = "–";
const pct = (value: number | null): string => (value === null ? DASH : `${Math.round(value * 100)}%`);
const one = (value: number | null): string => (value === null ? DASH : value.toFixed(1));
const spreadCell = (value: Spread | null): string => (value === null ? DASH : `${one(value.median)} (${one(value.tail)})`);

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
      ["Cloud verdicts, for review", cells.review],
    ],
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

/** The two tables the README carries: the headline split. */
export function readmeTables(latest: Latest): string[] {
  const cells = latest.splits.validation;
  const title = `${SPLIT_TITLES.validation} (${yearsOf(cells)})`;
  return [linesTable(cells, title), alertsTable(cells, `Alerts, ${title.charAt(0).toLowerCase()}${title.slice(1)}`)];
}

/** The whole report: every split's tables, with the breakdown. */
export function renderLatest(latest: Latest): string {
  const sections = [
    "# The scorecard, as last run",
    "",
    `Generated by \`npm run kpi -- --aggregate\` over the years ${latest.years[0]} to ${latest.years.at(-1)} of the Archive with the ${latest.detector.name} detector of \`${latest.package.name}\` ${latest.package.version}, against the ground truth whose SHA-256 is \`${latest.truthSha256}\`. The README's "How well it does" carries the first two tables; the tests check them against \`kpi/latest.json\`. Never edited by hand.`,
    "",
    "A target is a scoreable reported event whose parent had at least five public element sets in the sixty days before it; an event with fewer is undetectable and out of the denominator. Detected: an alert on the parent's own step before the first fragment's set was published and before any notice. Late: the same alert after that. The false-alarm rate is false alarms over false alarms plus detections on every line. A year with no publication times (one stripped from a yearly bundle) times the catalogue by the first fragment's epoch, a lower bound.",
    "",
  ];
  for (const split of SPLITS) {
    const cells = latest.splits[split];
    const title = `${SPLIT_TITLES[split]} (${yearsOf(cells)})`;
    sections.push(`## ${SPLIT_TITLES[split]}`, "", linesTable(cells, title), "", alertsTable(cells, `Alerts, ${title.charAt(0).toLowerCase()}${title.slice(1)}`), "", breakdownTable(cells, `By regime and kind, ${title.charAt(0).toLowerCase()}${title.slice(1)}`), "");
  }
  sections.push("## The years", "", table(["Year", "Source", "Built", "Sets", "Bodies", "Timed by"], latest.years.map((year) => {
    const record = latest.archive[String(year)]!;
    return [year, record.source, record.builtAt.slice(0, 10), record.sets, record.bodies, record.timeBasis === "created" ? "publication time" : "epoch (a lower bound)"];
  })), "");
  return sections.join("\n");
}
