import { BODY_CLASSES, BREAKUP_KINDS, DETECTOR_PARAMETERS, REGIMES, type BodyClass, type BreakupKind, type DetectorParameters, type LogRow, type Regime, type ScopeParameters, type Verdict } from "../../src/index.ts";
import type { Manifest } from "../archive/archive.ts";
import { PINNED, type Versions } from "../pins/pins.ts";
import { LINES, brackets, marginDaysOf, type ConfirmedLanding, type Line, type ScoredEvent, type YearScore } from "./match.ts";
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
/**
 * The first year any split scores. The Archive starts in 2005 and the
 * detector meets every object and launch new in its first year, with no
 * record of steps, no background of new bodies and no cloud remembered;
 * in use it would have that history, so 2005 is the warm-up year: the
 * replay runs it, and every line and split scores from 2006. The tenth
 * phase's methodology, from the ninth's held-out reading (twelve of its
 * thirty-one false confirmations in 2005).
 */
export const SCORED_FROM_YEAR = 2006;
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
  "breakups A-B": "Breakups, confidence A and B (the headline line)",
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
  /** The detection rate's Wilson 95% interval; null where there is no target. */
  detectionInterval: [number, number] | null;
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

/**
 * The scoped line (`src/scope.ts`): the headline line restricted to the
 * reported events whose parent was in the detector's scope at the event,
 * and the alerts whose parent was in it at the step and whose step passed
 * the scope's gates and held to its tier. A target is detected where such
 * an alert on its parent and step came, at the tier's instant, before the
 * catalogue's first fragment and any notice; late where it came after.
 * The false alarms are such alerts matching no reported event. The
 * false-alarm rate is over the detections on every line in the scope, as
 * the whole-catalogue rate is; each rate carries its Wilson 95% interval,
 * since the scoped counts are small; and the headline events the scope
 * leaves out are counted, so a scope cannot reach its rate by leaving the
 * events out unseen.
 */
export interface ScopedCells {
  /** Headline targets in the scope, undetectable ones in it, and the outcomes. */
  targets: number;
  undetectable: number;
  detected: number;
  late: number;
  missed: number;
  /** Headline events (targets and undetectable) the scope leaves out, and all headline events. */
  excluded: number;
  headlineEvents: number;
  /** Detections on every line in the scope, and the scoped false alarms. */
  detectedAllLines: number;
  falseAlarms: number;
  detectionRate: number | null;
  detectionInterval: [number, number] | null;
  falseAlarmRate: number | null;
  falseAlarmInterval: [number, number] | null;
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

/** One line of the Confirmed table: the events whose launch gained fresh pieces in the parent's plane (the targets), those listed apart (no such piece, or no orbit of the parent before the event to test a plane against), and the targets confirmed and missed, with the recall and its Wilson 95% interval. */
export interface ConfirmedLine {
  targets: number;
  noFragments: number;
  noParentOrbit: number;
  detected: number;
  missed: number;
  rate: number | null;
  interval: [number, number] | null;
}

/**
 * The Confirmed line, the owner's target since the decision of 2026-10-10
 * (the seventh decision record): a confirmed verdict by pieces on a reported event's parent,
 * within 180 days of its window, with or without a step seen first, is a
 * detection of the event; the first on each event counts, across the
 * years (an event of December confirmed in January is its year's), the
 * later ones are duplicates; a confirmed verdict matching no reported
 * event is a false alarm. The targets are the events whose launch gained
 * fresh pieces in the parent's plane within 180 days; the false-alarm
 * rate is over the detections on every line, each rate with its Wilson
 * interval. The headline line's confirmations are timed three ways: the
 * lead over the first statement by an agency (positive where the
 * confirmation came first; a quarterly news issue dated to its month's
 * first day, so the lead is the least it can have been), the lag after
 * the first fresh piece's publication, and the error of the detector's
 * instant against the truth's where it states one.
 */
export interface ConfirmedLineCells {
  lines: Record<Line, ConfirmedLine>;
  /** The split's confirmed verdicts by pieces, and where they landed; how many were attributed from the pieces with no step. */
  verdicts: number;
  attributed: number;
  detections: number;
  duplicates: number;
  exempt: number;
  falseAlarms: number;
  /** Events confirmed on every line, targets or not: the precision's numerator. */
  detectedAllLines: number;
  /** Events confirmed though the scorecard reads no fresh piece in the parent's plane (the detector's plane test read them otherwise). */
  detectedNoFragments: number;
  falseAlarmRate: number | null;
  falseAlarmInterval: [number, number] | null;
  /** The headline line: the lead over the first agency statement in days (median, tenth percentile), how many confirmations had one dated and how many came before it, and how the statements were dated (to the day, to the month). */
  lead: Spread | null;
  withStatement: number;
  beforeStatement: number;
  statementDays: number;
  statementMonths: number;
  /** The headline line: the days from the first fresh piece's publication to the confirmation (median, ninetieth percentile). */
  lag: Spread | null;
  /** The headline line: the error of the detector's instant against the truth's, in minutes (median, ninetieth percentile), where both state one. */
  timing: Spread | null;
  /** The false alarms by the parent's class, and how many were attributed with no step. */
  falseByClass: Record<BodyClass, number>;
  falseAttributed: number;
  /** The verdicts naming the launch and its candidate bodies (twins the pieces cannot tell apart). */
  twins: number;
}

/** The first confirmation of each event over every year file, by the event's id: the Confirmed line's detection of it. */
export type FirstConfirmations = Map<string, { year: number; landing: ConfirmedLanding }>;

/** A landing as the Confirmed line reads it: with the twins matched at the launch's level where the switch is on and the verdict named candidates, else as landed on the body it names. */
export const readingOf = (landing: ConfirmedLanding, twins: boolean): ConfirmedLanding => (twins && landing.twin !== undefined ? { ...landing, ...landing.twin } : landing);

export function firstConfirmationsOf(files: Pick<YearFile, "year" | "score">[], twins = false): FirstConfirmations {
  const first: FirstConfirmations = new Map();
  for (const file of files) {
    for (const landed of file.score.confirmations ?? []) {
      const landing = readingOf(landed, twins);
      if (landing.outcome !== "detection" || landing.event === null) continue;
      const known = first.get(landing.event);
      if (known === undefined || landing.raisedAt < known.landing.raisedAt) first.set(landing.event, { year: file.year, landing });
    }
  }
  return first;
}

const emptyConfirmedLine = (): ConfirmedLine => ({ targets: 0, noFragments: 0, noParentOrbit: 0, detected: 0, missed: 0, rate: null, interval: null });

/** Whether an event is a target of the Confirmed line: the parent's orbit known before it, and at least one fresh piece in its plane. */
export const isConfirmedTarget = (event: Pick<ScoredEvent, "fragments">): boolean => event.fragments !== undefined && event.fragments.parentOrbit && event.fragments.inPlane > 0;

/** The Confirmed line over a set of scored years, the first confirmations read over every year (an event's may be in the next year's file). */
export function confirmedCellsOf(years: Pick<YearFile, "year" | "score">[], first: FirstConfirmations = firstConfirmationsOf(years), twins = false): ConfirmedLineCells {
  const lines = Object.fromEntries(LINES.map((line) => [line, emptyConfirmedLine()])) as Record<Line, ConfirmedLine>;
  const c: ConfirmedLineCells = { lines, verdicts: 0, attributed: 0, detections: 0, duplicates: 0, exempt: 0, falseAlarms: 0, detectedAllLines: 0, detectedNoFragments: 0, falseAlarmRate: null, falseAlarmInterval: null, lead: null, withStatement: 0, beforeStatement: 0, statementDays: 0, statementMonths: 0, lag: null, timing: null, falseByClass: Object.fromEntries(BODY_CLASSES.map((k) => [k, 0])) as Record<BodyClass, number>, falseAttributed: 0, twins: 0 };
  const leads: number[] = [];
  const lags: number[] = [];
  const timings: number[] = [];
  for (const { year, score } of years) {
    for (const event of score.events) {
      const line = lines[event.line];
      const confirmation = first.get(event.id);
      if (confirmation !== undefined) c.detectedAllLines++;
      if (!isConfirmedTarget(event)) {
        if (event.fragments === undefined || event.fragments.parentOrbit) line.noFragments++;
        else line.noParentOrbit++;
        if (confirmation !== undefined) c.detectedNoFragments++;
        continue;
      }
      line.targets++;
      if (confirmation === undefined) {
        line.missed++;
        continue;
      }
      line.detected++;
      if (event.line !== "breakups A-B") continue;
      const at = confirmation.landing.raisedAt;
      if (event.statement !== null && event.statement !== undefined) {
        c.withStatement++;
        if (event.statement.precision === "day") c.statementDays++;
        else c.statementMonths++;
        const lead = (event.statement.at - at) / DAY_MS;
        leads.push(lead);
        if (lead > 0) c.beforeStatement++;
      }
      if (event.fragments!.firstAt !== null) lags.push((at - event.fragments!.firstAt) / DAY_MS);
      if (event.at !== null && confirmation.landing.eventAt !== null) timings.push(Math.abs(confirmation.landing.eventAt - event.at) / 60_000);
    }
    for (const landed of score.confirmations ?? []) {
      const landing = readingOf(landed, twins);
      c.verdicts++;
      if (landing.attributed) c.attributed++;
      if (landing.candidates !== undefined) c.twins++;
      if (landing.outcome === "detection") {
        const firstOne = landing.event === null ? undefined : first.get(landing.event);
        if (firstOne !== undefined && firstOne.year === year && firstOne.landing.verdict === landing.verdict) c.detections++;
        else c.duplicates++;
      } else if (landing.outcome === "fragment") c.duplicates++;
      else if (landing.outcome === "exempt") c.exempt++;
      else {
        c.falseAlarms++;
        c.falseByClass[landing.bodyClass]++;
        if (landing.attributed) c.falseAttributed++;
      }
    }
  }
  for (const line of Object.values(lines)) {
    line.rate = line.targets === 0 ? null : line.detected / line.targets;
    line.interval = wilson(line.detected, line.targets);
  }
  const n = c.falseAlarms + c.detectedAllLines;
  c.falseAlarmRate = n === 0 ? null : c.falseAlarms / n;
  const precision = wilson(c.detectedAllLines, n);
  c.falseAlarmInterval = precision === null ? null : [1 - precision[1], 1 - precision[0]];
  c.lead = spread(leads, 10);
  c.lag = spread(lags, 90);
  c.timing = spread(timings, 90);
  return c;
}

export interface Cells {
  years: number[];
  /** The Confirmed line, the target since the seventh decision record: the headline, a verdict naming twins matched on the body it names first; and the same with the twins matched at the launch's level (`matchTwinsAtLaunch`), the owner's call. */
  confirmedLine: ConfirmedLineCells;
  confirmedLineTwins: ConfirmedLineCells;
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
  /** The false-alarm rate's Wilson 95% interval; null where it is. */
  falseAlarmInterval: [number, number] | null;
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
  /** The scoped line, where the year files carry the scope's readings. */
  scoped: ScopedCells;
  /** What became of the persistent steps the detector judged, and of the reported breakups: the life of an alert. */
  lifecycle: LifecycleCells;
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
  /** The engine's and the propagators' versions the score was made with, read from what was installed (`installedVersions`), not from the pins. */
  versions: Versions;
  truthSha256: string;
  detector: { name: string; parameters: DetectorParameters };
  archive: Record<string, { source: Manifest["source"]["kind"]; builtAt: string; sets: number; bodies: number; timeBasis: TimeBasis }>;
  years: number[];
  splits: Record<SplitName, Cells>;
}

const emptyLine = (): LineCells => ({ targets: 0, undetectable: 0, detected: 0, late: 0, missed: 0, detectionRate: null, detectionInterval: null });

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
  line.detectionInterval = wilson(line.detected, line.targets);
}

/** A false-alarm rate's Wilson 95% interval: one less the precision's, the precision being the detections over the detections and the false alarms. */
export function falseAlarmIntervalOf(detections: number, falseAlarms: number): [number, number] | null {
  const precision = wilson(detections, detections + falseAlarms);
  return precision === null ? null : [1 - precision[1], 1 - precision[0]];
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

/** When a scoped alert would be raised: at its raising, or at the instant its step reached the scope's tier still holding (no earlier than the raising); null where it never did. */
function scopedAt(alert: { raisedAt: number }, row: LogRow | undefined, tier: ScopeParameters["tier"]): number | null {
  if (tier === "raised") return alert.raisedAt;
  if (row?.signals[`tier${tier}Held`] !== 1) return null;
  return Math.max(row.signals[`tier${tier}At`]!, alert.raisedAt);
}

/** The scoped line over a set of scored years. */
export function scopedCellsOf(years: Pick<YearFile, "score">[], rows: AlertRows, scope: ScopeParameters): ScopedCells {
  const c: ScopedCells = { targets: 0, undetectable: 0, detected: 0, late: 0, missed: 0, excluded: 0, headlineEvents: 0, detectedAllLines: 0, falseAlarms: 0, detectionRate: null, detectionInterval: null, falseAlarmRate: null, falseAlarmInterval: null };
  for (const { score } of years) {
    for (const event of score.events) {
      const headline = event.line === "breakups A-B";
      if (headline) c.headlineEvents++;
      if (event.scopeIn !== true) {
        if (headline) c.excluded++;
        continue;
      }
      if (event.status === "undetectable") {
        if (headline) c.undetectable++;
        continue;
      }
      const deadline = Math.min(event.catalogueAt ?? Number.POSITIVE_INFINITY, event.noticeAt ?? Number.POSITIVE_INFINITY);
      let at: number | null = null;
      for (const alert of score.alerts.filter((a) => a.event === event.id && a.number === event.parent && a.scoped === true && (a.outcome === "detection" || a.outcome === "late" || a.outcome === "duplicate")).sort((a, b) => a.raisedAt - b.raisedAt)) {
        at = scopedAt(alert, alert.afterEpoch === null ? undefined : rows.get(alertKey(alert.number, alert.afterEpoch)), scope.tier);
        if (at !== null) break;
      }
      const outcome = at === null ? "missed" : at < deadline ? "detected" : "late";
      if (outcome === "detected") c.detectedAllLines++;
      if (!headline) continue;
      c.targets++;
      c[outcome]++;
    }
    for (const alert of score.alerts) {
      if (alert.outcome !== "false-alarm" || alert.scoped !== true) continue;
      if (scopedAt(alert, alert.afterEpoch === null ? undefined : rows.get(alertKey(alert.number, alert.afterEpoch)), scope.tier) !== null) c.falseAlarms++;
    }
  }
  c.detectionRate = c.targets === 0 ? null : c.detected / c.targets;
  c.detectionInterval = wilson(c.detected, c.targets);
  const n = c.falseAlarms + c.detectedAllLines;
  c.falseAlarmRate = n === 0 ? null : c.falseAlarms / n;
  const precision = wilson(c.detectedAllLines, n);
  c.falseAlarmInterval = precision === null ? null : [1 - precision[1], 1 - precision[0]];
  return c;
}

/**
 * The life of an alert, read off the verdicts. A jump in an object's
 * orbit that holds over the sets after it is judged once: raised as a
 * suspected breakup (the early warning), or cleared as a manoeuvre the
 * object's record, its status or its siblings explain. A suspected alert
 * then ends one way: confirmed (fragments in the parent's plane, or a
 * notice), dismissed (the new bodies under its launch were all old
 * pieces), or expired (nothing confirmed it within the alert's time to
 * live, thirty days); or it is still open where the Archive ends. A
 * cleared step is watched as long, and fragments may still confirm it.
 *
 * For each end, its share of the suspected alerts and the probability
 * that the alert was on a reported breakup's step: the alerts the matcher
 * landed on a reported event's step (a detection or a late alert) over
 * those and the false alarms, the duplicates and the alerts inside an
 * exempt window left out of both, each with its Wilson 95% interval. A
 * cleared step is on a reported breakup where its bracket covers the
 * window of a scoreable reported event on the same object, each widened
 * by the matcher's margin. And from the other side, the reported
 * breakups of confidence A and B whose launch gained fresh pieces in the
 * parent's plane (the Confirmed line's targets), by the path they took:
 * suspected, then confirmed; suspected and never confirmed; confirmed with
 * no suspected step first (attributed from the pieces, or a cleared step
 * the pieces confirmed); never flagged.
 */
export const ALERT_ENDS = ["confirmed", "dismissed", "expired", "open"] as const;
export type AlertEnd = (typeof ALERT_ENDS)[number];

/** A share of a count, and the probability that those alerts were real, each with its Wilson 95% interval. */
export interface EndCells {
  alerts: number;
  /** On a reported breakup's step (a detection or a late alert), a false alarm, or neither (a duplicate, or inside an exempt window). */
  real: number;
  falseAlarms: number;
  neither: number;
  share: number | null;
  shareInterval: [number, number] | null;
  realRate: number | null;
  realInterval: [number, number] | null;
  /** Days from the raising to the end: median, ninetieth percentile. */
  days: Spread | null;
}

/** One path of the reported breakups, with its share of them and the interval. */
export interface PathCells {
  count: number;
  share: number | null;
  interval: [number, number] | null;
}

export const BREAKUP_PATHS = ["suspectedThenConfirmed", "suspectedNotConfirmed", "confirmedWithoutSuspected", "neverFlagged"] as const;
export type BreakupPath = (typeof BREAKUP_PATHS)[number];

export interface LifecycleCells {
  /** Every suspected alert the scorecard counts (a raised step, not a later verdict on it), with the probability it was real. */
  suspected: EndCells;
  /** What each suspected alert ended as. */
  ends: Record<AlertEnd, EndCells>;
  /** The steps cleared as manoeuvres, how many were on a reported breakup, and how many of either fragments confirmed later. */
  cleared: { steps: number; real: number; realRate: number | null; realInterval: [number, number] | null; confirmedLater: number; confirmedLaterReal: number };
  /** The Confirmed line's targets of confidence A and B by path, and how many were suspected before the first fragment. */
  breakups: { targets: number; suspectedBeforeFragment: number } & Record<BreakupPath, PathCells>;
}

/** What the lifecycle reads over every year file: the end verdicts on each step, by object and bracket, and every scored event. */
export interface LifecycleIndex {
  ends: Map<string, { state: Verdict["state"]; raisedAt: number }[]>;
  events: Pick<ScoredEvent, "parent" | "from" | "to" | "regime">[];
}

const stepKey = (number: number, step: { beforeEpoch: number; afterEpoch: number }): string => `${number}|${step.beforeEpoch}|${step.afterEpoch}`;

/** The lifecycle's index over the year files: an end may come in the next year's file. */
export function lifecycleIndexOf(files: (Pick<YearFile, "score"> & Partial<Pick<YearFile, "verdicts">>)[]): LifecycleIndex {
  const ends: LifecycleIndex["ends"] = new Map();
  for (const file of files) {
    for (const v of file.verdicts ?? []) {
      if (v.number === null || v.step === null || (v.state !== "confirmed" && v.state !== "dismissed" && v.state !== "expired")) continue;
      const key = stepKey(v.number, v.step);
      (ends.get(key) ?? ends.set(key, []).get(key)!).push({ state: v.state, raisedAt: v.raisedAt });
    }
  }
  return { ends, events: files.flatMap((file) => file.score.events) };
}

const ratio = (k: number, n: number): number | null => (n === 0 ? null : k / n);

function endCellsOf(counts: { real: number; falseAlarms: number; neither: number; days: number[] }, of: number): EndCells {
  const alerts = counts.real + counts.falseAlarms + counts.neither;
  return { alerts, real: counts.real, falseAlarms: counts.falseAlarms, neither: counts.neither, share: ratio(alerts, of), shareInterval: wilson(alerts, of), realRate: ratio(counts.real, counts.real + counts.falseAlarms), realInterval: wilson(counts.real, counts.real + counts.falseAlarms), days: spread(counts.days, 90) };
}

/** The lifecycle over a set of scored years. */
export function lifecycleCellsOf(years: (Pick<YearFile, "score"> & Partial<Pick<YearFile, "verdicts">>)[], index: LifecycleIndex = lifecycleIndexOf(years), first: FirstConfirmations = firstConfirmationsOf(years as Pick<YearFile, "year" | "score">[])): LifecycleCells {
  const blank = () => ({ real: 0, falseAlarms: 0, neither: 0, days: [] as number[] });
  const all = blank();
  const ends = Object.fromEntries(ALERT_ENDS.map((end) => [end, blank()])) as Record<AlertEnd, ReturnType<typeof blank>>;
  const cleared = { steps: 0, real: 0, realRate: null as number | null, realInterval: null as [number, number] | null, confirmedLater: 0, confirmedLaterReal: 0 };
  const paths = { suspectedThenConfirmed: 0, suspectedNotConfirmed: 0, confirmedWithoutSuspected: 0, neverFlagged: 0 };
  let targets = 0;
  let suspectedBeforeFragment = 0;
  for (const { score, verdicts } of years) {
    for (const alert of score.alerts) {
      if (alert.outcome === "confirmation" || alert.state !== "suspected") continue;
      const step = verdicts?.[alert.verdict]?.step ?? null;
      const later = step === null || alert.number === null ? [] : (index.ends.get(stepKey(alert.number, step)) ?? []).filter((e) => e.raisedAt >= alert.raisedAt);
      const end = alert.confirmedAt !== null ? { state: "confirmed" as const, raisedAt: alert.confirmedAt } : later.find((e) => e.state === "dismissed" || e.state === "expired");
      const into = ends[end === undefined ? "open" : (end.state as AlertEnd)];
      for (const counts of [all, into]) {
        if (alert.outcome === "detection" || alert.outcome === "late") counts.real++;
        else if (alert.outcome === "false-alarm") counts.falseAlarms++;
        else counts.neither++;
      }
      if (end !== undefined) into.days.push((end.raisedAt - alert.raisedAt) / DAY_MS);
    }
    for (const v of verdicts ?? []) {
      if (v.state !== "manoeuvre" || v.number === null || v.step === null) continue;
      cleared.steps++;
      const real = index.events.some((event) => event.parent === v.number && brackets(v.step, event.from, event.to, marginDaysOf(event.regime)));
      if (real) cleared.real++;
      if ((index.ends.get(stepKey(v.number, v.step)) ?? []).some((e) => e.state === "confirmed" && e.raisedAt >= v.raisedAt)) {
        cleared.confirmedLater++;
        if (real) cleared.confirmedLaterReal++;
      }
    }
    for (const event of score.events) {
      if (event.line !== "breakups A-B" || !isConfirmedTarget(event)) continue;
      targets++;
      const suspected = event.status === "detected" || event.status === "late";
      if (event.status === "detected") suspectedBeforeFragment++;
      const confirmed = first.has(event.id);
      paths[suspected ? (confirmed ? "suspectedThenConfirmed" : "suspectedNotConfirmed") : confirmed ? "confirmedWithoutSuspected" : "neverFlagged"]++;
    }
  }
  const suspected = endCellsOf(all, all.real + all.falseAlarms + all.neither);
  cleared.realRate = ratio(cleared.real, cleared.steps);
  cleared.realInterval = wilson(cleared.real, cleared.steps);
  return {
    suspected,
    ends: Object.fromEntries(ALERT_ENDS.map((end) => [end, endCellsOf(ends[end], suspected.alerts)])) as Record<AlertEnd, EndCells>,
    cleared,
    breakups: { targets, suspectedBeforeFragment, ...(Object.fromEntries(BREAKUP_PATHS.map((path) => [path, { count: paths[path], share: ratio(paths[path], targets), interval: wilson(paths[path], targets) }])) as Record<BreakupPath, PathCells>) },
  };
}

/** The cells over a set of scored years; the alert rows, where given, feed the persistence tiers and the scoped line's tier. */
export function cellsOf(years: (Pick<YearFile, "year" | "score" | "bodyYears"> & Partial<Pick<YearFile, "verdicts">>)[], rows: AlertRows = new Map(), scope: ScopeParameters = DETECTOR_PARAMETERS.scope, first: FirstConfirmations = firstConfirmationsOf(years), firstTwins: FirstConfirmations = firstConfirmationsOf(years, true), lifecycle: LifecycleIndex = lifecycleIndexOf(years)): Cells {
  const lines = fill(LINES);
  const byRegime = fill(REGIMES);
  const byKind = fill(BREAKUP_KINDS);
  const cells: Cells = { years: years.map((y) => y.year).sort((a, b) => a - b), confirmedLine: confirmedCellsOf(years, first), confirmedLineTwins: confirmedCellsOf(years, firstTwins, true), lines, alerts: 0, duplicates: 0, exempt: 0, falseAlarms: 0, review: 0, tiers: [], confirmed: { confirmations: 0, ofTrue: 0, ofExempt: 0, ofFalseAlarms: 0, ofNearEvent: 0, daysToConfirmation: null, precision: null, precisionByParent: null, reported: 0, reportedAlerted: 0, reportedConfirmed: 0, confirmedRate: null, daysFromEvent: null, daysFromAlert: null, withStatement: 0, beforeStatement: 0 }, falseAlarmRate: null, bodyYears: 0, falseAlarmsPer10kBodyYears: null, leadHours: null, latencyHours: null, confirmedShare: null, daysToConfirmation: null, timingErrorMinutes: null, byRegime, byKind, scoped: scopedCellsOf(years, rows, scope), falseAlarmInterval: null, lifecycle: lifecycleCellsOf(years, lifecycle, first) };
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
  cells.falseAlarmInterval = falseAlarmIntervalOf(detections, cells.falseAlarms);
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
  const sorted = [...years].filter((y) => y >= SCORED_FROM_YEAR).sort((a, b) => a - b);
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
export function aggregate(files: YearFile[], meta: Pick<Latest, "package" | "versions" | "truthSha256" | "detector">): Latest {
  const years = files.map((f) => f.year).sort((a, b) => a - b);
  const rows = alertRowsOf(files);
  const scope = meta.detector.parameters.scope ?? DETECTOR_PARAMETERS.scope;
  // An event's first confirmation may be in the next year's file, whatever split that year is in.
  const first = firstConfirmationsOf(files);
  const firstTwins = firstConfirmationsOf(files, true);
  // A step's end, like an event's confirmation, may be in the next year's file.
  const lifecycle = lifecycleIndexOf(files);
  const splits = Object.fromEntries(SPLITS.map((split) => [split, cellsOf(files.filter((f) => splitYears(years, split).includes(f.year)), rows, scope, first, firstTwins, lifecycle)])) as Record<SplitName, Cells>;
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

/** The per-line table of a split: targets, undetectable, detected, late, missed and the rate with its Wilson 95% interval. */
export function linesTable(cells: Cells, title: string): string {
  return table(
    [title, "Targets", "Undetectable", "Detected", "Late", "Missed", "Detection rate (95% interval)"],
    LINES.map((line) => {
      const l = cells.lines[line];
      return [LINE_LABELS[line], l.targets, l.undetectable, l.detected, l.late, l.missed, intervalCell(l.detectionRate, l.detectionInterval ?? wilson(l.detected, l.targets))];
    }),
  );
}

/** The early warnings raised on every line, the detections the false-alarm rate is read against. */
export const detectedAllLines = (cells: Pick<Cells, "lines">): number => (Object.values(cells.lines) as LineCells[]).reduce((sum, line) => sum + line.detected, 0);

/** False alarms a year over a split: the false alarms over the years it holds. */
export const falseAlarmsPerYear = (cells: Pick<Cells, "falseAlarms" | "years">): number | null => (cells.years.length === 0 ? null : cells.falseAlarms / cells.years.length);

/**
 * The early warning's headline table, the first of its section on the
 * results page: per split, the headline line's targets (breakups A and B
 * whose parent had public sets to be judged on), those undetectable, the
 * flagged before the first fragment, the late and the missed, the
 * detection rate and the false-alarm rate with their Wilson 95%
 * intervals, the false alarms a year and per ten thousand object-years,
 * the lead over the first catalogued fragment in days and the timing
 * error, both over every line's detections.
 */
export function earlyWarningHeadlineTable(latest: Pick<Latest, "splits">, title = "Early warning (suspected): breakups A and B"): string {
  return table(
    [title, "Targets", "Undetectable", "Flagged before the first fragment", "Late", "Missed", "Detection rate (95% interval)", "False alarms", "False-alarm rate (95% interval)", "False alarms a year", "False alarms per 10,000 object-years", "Lead over the first catalogued fragment, days: median (10th percentile)", "Timing error, minutes, median"],
    SPLITS.map((split) => {
      const cells = latest.splits[split];
      const l = cells.lines["breakups A-B"];
      const lead = cells.leadHours === null ? null : { ...cells.leadHours, median: cells.leadHours.median / 24, tail: cells.leadHours.tail / 24 };
      return [`${SPLIT_TITLES[split]} (${yearsOf(cells)})`, l.targets, l.undetectable, l.detected, l.late, l.missed, intervalCell(l.detectionRate, l.detectionInterval ?? wilson(l.detected, l.targets)), cells.falseAlarms, intervalCell(cells.falseAlarmRate, cells.falseAlarmInterval ?? falseAlarmIntervalOf(detectedAllLines(cells), cells.falseAlarms)), one(falseAlarmsPerYear(cells)), one(cells.falseAlarmsPer10kBodyYears), spreadCell(lead), one(cells.timingErrorMinutes)];
    }),
  );
}

/** A small probability as the lifecycle prints it: to a hundredth of a percent under one percent, a tenth under ten, else whole. */
export function chance(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return DASH;
  const percent = rate * 100;
  if (percent === 0 || percent >= 10) return `${Math.round(percent)}%`;
  return percent < 1 ? `${percent.toFixed(2)}%` : `${percent.toFixed(1)}%`;
}

/** A probability with its Wilson 95% interval and its counts, as the lifecycle prints it: "0.8% (0.5% to 1.2%), 19 of 2463". */
export const chanceCell = (rate: number | null, interval: [number, number] | null, k: number, n: number): string => (rate === null ? DASH : `${chance(rate)} (${interval === null ? DASH : `${chance(interval[0])} to ${chance(interval[1])}`}), ${k} of ${n}`);

/** The end states' labels on the results page. */
export const END_LABELS: Record<AlertEnd, string> = {
  confirmed: "Ended confirmed (fragments in the parent's plane, or a notice)",
  dismissed: "Ended dismissed (the new bodies under its launch were all old pieces)",
  expired: `Ended expired (nothing confirmed it in ${DETECTOR_PARAMETERS.alertTtlDays} days)`,
  open: "Still open where the Archive ends",
};

/** The breakups' paths' labels on the results page. */
export const PATH_LABELS: Record<BreakupPath, string> = {
  suspectedThenConfirmed: "An early warning, then confirmed",
  suspectedNotConfirmed: "An early warning, never confirmed",
  confirmedWithoutSuspected: "Confirmed with no early warning first (from the fragments, or a cleared step the fragments confirmed)",
  neverFlagged: "Never flagged",
};

/** The splits the lifecycle tables show side by side: the held-out years and the training years. */
export const LIFECYCLE_SPLITS: readonly SplitName[] = ["validation", "train"];

/**
 * The life of an alert on the results page: the steps cleared as
 * manoeuvres and the suspected alerts, what each suspected alert ended
 * as, with each end's share, the probability it was on a reported
 * breakup and the days it took; then the reported breakups by the path
 * they took. One column per split of `LIFECYCLE_SPLITS`.
 */
export function lifecycleTables(latest: Pick<Latest, "splits">): string[] {
  const columns = LIFECYCLE_SPLITS.map((split) => latest.splits[split]);
  const heads = LIFECYCLE_SPLITS.map((split) => `${SPLIT_TITLES[split]} (${yearsOf(latest.splits[split])})`);
  const stages: (string | number)[][] = [
    ["Steps that held, cleared as manoeuvres", ...columns.map((c) => c.lifecycle.cleared.steps)],
    ["Of those, on a reported breakup's step (95% interval)", ...columns.map((c) => chanceCell(c.lifecycle.cleared.realRate, c.lifecycle.cleared.realInterval, c.lifecycle.cleared.real, c.lifecycle.cleared.steps))],
    ["Of those, confirmed later by fragments (of which on a reported breakup)", ...columns.map((c) => `${c.lifecycle.cleared.confirmedLater} (${c.lifecycle.cleared.confirmedLaterReal})`)],
    ["Steps that held, raised as early warnings (suspected alerts)", ...columns.map((c) => c.lifecycle.suspected.alerts)],
    ["Of those, on a reported breakup's step (95% interval)", ...columns.map((c) => chanceCell(c.lifecycle.suspected.realRate, c.lifecycle.suspected.realInterval, c.lifecycle.suspected.real, c.lifecycle.suspected.real + c.lifecycle.suspected.falseAlarms))],
    ["Of those, duplicates or inside an exempt window (in neither count)", ...columns.map((c) => c.lifecycle.suspected.neither)],
  ];
  for (const end of ALERT_ENDS) {
    stages.push([`${END_LABELS[end]}, share of the early warnings (95% interval)`, ...columns.map((c) => chanceCell(c.lifecycle.ends[end].share, c.lifecycle.ends[end].shareInterval, c.lifecycle.ends[end].alerts, c.lifecycle.suspected.alerts))]);
    stages.push([`${end === "open" ? "Still open" : `Ended ${end}`}: on a reported breakup's step (95% interval)`, ...columns.map((c) => chanceCell(c.lifecycle.ends[end].realRate, c.lifecycle.ends[end].realInterval, c.lifecycle.ends[end].real, c.lifecycle.ends[end].real + c.lifecycle.ends[end].falseAlarms))]);
    if (end !== "open") stages.push([`Ended ${end}: days after the early warning, median (90th percentile)`, ...columns.map((c) => spreadCell(c.lifecycle.ends[end].days))]);
  }
  const paths: (string | number)[][] = [
    ["Reported breakups A and B with fragments catalogued (the Confirmed line's targets)", ...columns.map((c) => c.lifecycle.breakups.targets)],
    ["Of those, flagged by an early warning before the first fragment", ...columns.map((c) => fraction(c.lifecycle.breakups.suspectedBeforeFragment, c.lifecycle.breakups.targets))],
    ...BREAKUP_PATHS.map((path) => [`${PATH_LABELS[path]} (95% interval)`, ...columns.map((c) => chanceCell(c.lifecycle.breakups[path].share, c.lifecycle.breakups[path].interval, c.lifecycle.breakups[path].count, c.lifecycle.breakups.targets))]),
  ];
  return [table(["The life of an alert", ...heads], stages), table(["The reported breakups' paths", ...heads], paths)];
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
      ["False-alarm rate", pct(cells.falseAlarmRate)],
      ["False alarms per 10,000 object-years", one(cells.falseAlarmsPer10kBodyYears)],
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

const fraction = (k: number, n: number): string => (n === 0 ? DASH : `${k} of ${n}`);

/** The rows of the Confirmed headline: the headline line on each split the owner reads, the training and validation splits first. */
export const CONFIRMED_HEADLINE_SPLITS: readonly SplitName[] = ["validation", "train", "chronologicalTrain", "chronologicalValidation"];

/**
 * The Confirmed line's headline table, the first of the results page's: per split, the
 * breakups of confidence A and B whose launch gained fresh pieces in the
 * parent's plane, those listed apart for want of one, the confirmed and
 * missed, the recall and the false-alarm rate with their Wilson 95%
 * intervals, the lead over the first agency statement, the lag after the
 * first fragment's publication and the timing error.
 */
export function confirmedHeadlineTable(latest: Pick<Latest, "splits">, title = "Confirmed: the target, breakups A and B"): string {
  return table(
    [title, "Targets (fragments catalogued)", "No fragments catalogued", "Confirmed", "Missed", "Recall (95% interval)", "False confirmations", "False-alarm rate (95% interval)", "Lead over the first agency statement, days: median (10th percentile)", "Confirmed before it", "Lag after the first fragment, days: median (90th percentile)", "Timing error, minutes: median (90th percentile)"],
    CONFIRMED_HEADLINE_SPLITS.flatMap((split) =>
      ([false, true] as const).map((twins) => {
        const cells = latest.splits[split];
        // A file aggregated before the twins were read has the headline alone; its twin row repeats it.
        const c = twins ? (cells.confirmedLineTwins ?? cells.confirmedLine) : cells.confirmedLine;
        const line = c.lines["breakups A-B"];
        return [twins ? `${SPLIT_TITLES[split]}, twins matched at the launch` : `${SPLIT_TITLES[split]} (${yearsOf(cells)})`, line.targets, line.noFragments + line.noParentOrbit, line.detected, line.missed, intervalCell(line.rate, line.interval), c.falseAlarms, intervalCell(c.falseAlarmRate, c.falseAlarmInterval), spreadCell(c.lead), fraction(c.beforeStatement, c.withStatement), spreadCell(c.lag), spreadCell(c.timing)];
      }),
    ),
  );
}

/** The Confirmed line of a split, every line: the targets, those listed apart (no fresh piece in the plane; no orbit of the parent before the event), the confirmed and missed, the recall. */
export function confirmedLinesTable(cells: Cells, title: string): string {
  return table(
    [title, "Targets (fragments catalogued)", "No fragments catalogued", "No parent orbit before the event", "Confirmed", "Missed", "Recall (95% interval)"],
    LINES.map((line) => {
      const l = cells.confirmedLine.lines[line];
      return [LINE_LABELS[line].replace(" (the headline line)", " (the target is 90%)"), l.targets, l.noFragments, l.noParentOrbit, l.detected, l.missed, intervalCell(l.rate, l.interval)];
    }),
  );
}

/** The Confirmed line's verdicts of a split: where they landed, the false alarms by class and path, and the headline line's timings with how its statements were dated. */
export function confirmedVerdictsTable(cells: Cells, title: string): string {
  const c = cells.confirmedLine;
  return table(
    [title, "Count"],
    [
      ["Confirmed verdicts by pieces", c.verdicts],
      ["Of which attributed from the pieces with no step seen on the parent", c.attributed],
      ["Detections (the first confirmation of a reported event)", c.detections],
      ["Duplicates (a later confirmation of an event, or one on its fragment)", c.duplicates],
      ["Exempt (inside an exempt window)", c.exempt],
      ["False confirmations (matching no reported event)", c.falseAlarms],
      ["Of those, attributed with no step", c.falseAttributed],
      ["Verdicts naming the launch and its candidate bodies (twins), matched on the body named first", c.twins],
      ["Of those, on a payload / a rocket body / debris / an unknown body", BODY_CLASSES.map((k) => c.falseByClass[k]).join(" / ")],
      ["Events confirmed on every line (the precision's numerator)", c.detectedAllLines],
      ["Of which with no fragment the scorecard reads in the plane", c.detectedNoFragments],
      ["False-alarm rate (the target is under 10%)", intervalCell(c.falseAlarmRate, c.falseAlarmInterval)],
      ["Headline confirmations with an agency's statement dated", c.withStatement],
      ["Of which the statement dated to the day / to the month", `${c.statementDays} / ${c.statementMonths}`],
      ["Of which confirmed before the statement", c.beforeStatement],
      ["Lead over the first agency statement, days: median (10th percentile)", spreadCell(c.lead)],
      ["Lag after the first fragment's publication, days: median (90th percentile)", spreadCell(c.lag)],
      ["Timing error against the truth's instant, minutes: median (90th percentile)", spreadCell(c.timing)],
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

const intervalCell = (rate: number | null, interval: [number, number] | null): string => (rate === null ? DASH : `${pct(rate)} (${interval === null ? DASH : `${pct(interval[0])} to ${pct(interval[1])}`})`);

/** The table of a split's scoped line beside the whole catalogue's headline line: the targets, the outcomes, the detection rate and the false-alarm rate with their Wilson intervals, and the headline events the scope leaves out. */
export function scopedTable(cells: Cells, title: string): string {
  const s = cells.scoped;
  const whole = cells.lines["breakups A-B"];
  const allDetected = (Object.values(cells.lines) as LineCells[]).reduce((sum, line) => sum + line.detected, 0);
  const wholeFa = wilson(allDetected, cells.falseAlarms + allDetected);
  return table(
    [title, "Targets", "Undetectable", "Detected", "Late", "Missed", "Detection rate (95% interval)", "False alarms", "False-alarm rate (95% interval)", "Headline events left out"],
    [
      ["The whole catalogue", whole.targets, whole.undetectable, whole.detected, whole.late, whole.missed, intervalCell(whole.detectionRate, wilson(whole.detected, whole.targets)), cells.falseAlarms, intervalCell(cells.falseAlarmRate, wholeFa === null ? null : [1 - wholeFa[1], 1 - wholeFa[0]]), 0],
      ["Scoped", s.targets, s.undetectable, s.detected, s.late, s.missed, intervalCell(s.detectionRate, s.detectionInterval), s.falseAlarms, intervalCell(s.falseAlarmRate, s.falseAlarmInterval), `${s.excluded} of ${s.headlineEvents}`],
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

/** How many of `resultsTables`' tables are the Confirmed line's; the rest are the early warning's. */
export const CONFIRMED_TABLES = 3;

/** The tables the results page (`docs/results.md`) carries: the Confirmed headline over the splits and its lines on the validation split, then the early warning's headline over the splits and its tables on the validation split. */
export function resultsTables(latest: Latest): string[] {
  const cells = latest.splits.validation;
  const title = `${SPLIT_TITLES.validation} (${yearsOf(cells)})`;
  const lower = `${title.charAt(0).toLowerCase()}${title.slice(1)}`;
  return [confirmedHeadlineTable(latest), confirmedLinesTable(cells, `Confirmed, every line, ${lower}`), confirmedVerdictsTable(cells, `Confirmed verdicts, ${lower}`), earlyWarningHeadlineTable(latest), linesTable(cells, `Early warning, every line, ${lower}`), scopedTable(cells, `Early warning on breakups A and B, scoped, ${lower}`), alertsTable(cells, `Early warnings, ${lower}`), tiersTable(cells, `Precision per persistence tier, ${lower}`), confirmedTable(cells, `The early warnings confirmed, ${lower}`)];
}

/** The runtime packages' versions as a phrase: "`a` 1.0.0, `b` 2.0.0 and `c` 3.0.0". */
const versionsOf = (versions: Versions): string => {
  const named = PINNED.map((name) => `\`${name}\` ${versions[name]}`);
  return `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
};

/** The whole report: every split's tables, with the breakdown. */
export function renderLatest(latest: Latest): string {
  const sections = [
    "# The scorecard, as last run",
    "",
    `Generated by \`npm run kpi -- --aggregate\` over the years ${latest.years[0]} to ${latest.years.at(-1)} of the Archive with the ${latest.detector.name} detector of \`${latest.package.name}\` ${latest.package.version} on ${versionsOf(latest.versions)}, against the ground truth whose SHA-256 is \`${latest.truthSha256}\`. The results page, \`docs/results.md\`, carries the Confirmed headline and the validation split's tables; the tests check them against \`kpi/latest.json\`. Never edited by hand. The per-event dissection is in \`docs/detector/events.md\`, written with this file.`,
    "",
    "**The Confirmed line is the target** (the owner's decision of 2026-10-10, `docs/decisions/0007-the-target-is-on-confirmed-alerts.md`). A detection is a confirmed verdict by pieces on a reported event's parent, raised within 180 days after the event's window, with or without a step seen first on the parent: the confirmation of an alert on the parent's step, or the attribution of fresh pieces in the parent's plane to it. The targets are the scoreable events whose launch gained at least one fresh piece in the parent's plane within 180 days in the Archive (a body under the launch numbered above the catalogue's mark at the event, classed as a fragment is, first published after it, its plane within the detector's bound of the parent's last set before the event); events with no such piece, or no orbit of the parent before the event to test a plane against, are listed apart and out of the denominator. The first confirmation of an event counts, across the years; later ones are duplicates; a confirmed verdict matching no reported event is a false alarm, and the false-alarm rate is over the detections on every line, each rate with its Wilson 95% interval. A confirmation by a notice alone is not the Confirmed line's, and a confirmed verdict under a crewed station's launch is exempt: what a station sheds is released on purpose; so is one under the launch of a crewed spacecraft or a station's cargo craft, unless it names the launch's rocket body. Every split scores from " + SCORED_FROM_YEAR + ": " + (SCORED_FROM_YEAR - 1) + ", the Archive's first year, is the detector's warm-up, replayed and scored on no split. A verdict naming a launch and its candidate bodies (twins the pieces cannot tell apart) is matched on the body it names first in the headline rows; the rows marked as the twins matched at the launch read it as a detection where a reported event's parent is among its candidates. The lead is the days from the confirmation to the first statement by an agency (NASA's quarterly news, dated to the first day of its issue's month, the earliest it can have been public; a U.S. Space Forces-Space notice, to the day it was seen; ESA's report), positive where the confirmation came first; the lag is the days from the first fresh piece's publication to the confirmation; the timing error is the detector's instant of the event against the truth's, where both state one.",
    "",
    confirmedHeadlineTable(latest),
    "",
    "**The early warning** is measured and reported beside the target: a suspected verdict on the parent's own step, raised before the fragments are catalogued. Its headline over every split, then the life of an alert (what each step that held became, the probability at each end that it was a reported breakup's, and the reported breakups by the path they took, each with its Wilson 95% interval):",
    "",
    earlyWarningHeadlineTable(latest),
    "",
    ...lifecycleTables(latest).flatMap((t) => [t, ""]),
    "The early warning's lines follow each split's Confirmed tables, as the scorecard measured them before the target moved to the Confirmed line. A target there is a scoreable reported event whose parent had at least five public element sets in the sixty days before it; an event with fewer is undetectable and out of the denominator. Detected: an alert on the parent's own step before the first fragment's set was published and before any notice. Late: the same alert after that. The false-alarm rate is false alarms over false alarms plus detections on every line, with its Wilson 95% interval, as the detection rate has. The scoped table is the headline line restricted to the detector's scope (\`DETECTOR_PARAMETERS.scope\`, \`docs/detector/d7-scope.md\`); both its rates carry their Wilson 95% intervals, and the headline events the scope leaves out are counted beside them. A year with no publication times (one stripped from a yearly bundle) times the catalogue by the first fragment's epoch, a lower bound. The tier table reads every alert's later sets: what raising only once the step had held for that many post sets or days would have left of the false alarms and of the detections that still beat the catalogue. The last table is the step alerts confirmed: of the targets the catalogue itself reported (new bodies under the launch within ninety days of the event), how many alerts on the parent's step the fragments or a notice confirmed and how long after; and of every step alert confirmed, how many were on a reported event's step, how many on the right object with the step late, and how many on nothing.",
    "",
  ];
  for (const split of SPLITS) {
    const cells = latest.splits[split];
    const title = `${SPLIT_TITLES[split]} (${yearsOf(cells)})`;
    const lower = `${title.charAt(0).toLowerCase()}${title.slice(1)}`;
    sections.push(`## ${SPLIT_TITLES[split]}`, "", confirmedLinesTable(cells, `Confirmed, every line, ${lower}`), "", confirmedVerdictsTable(cells, `Confirmed verdicts, ${lower}`), "", linesTable(cells, `Early warning, every line, ${lower}`), "", scopedTable(cells, `Early warning on breakups A and B, scoped, ${lower}`), "", alertsTable(cells, `Early warnings, ${lower}`), "", tiersTable(cells, `Precision per persistence tier, ${lower}`), "", confirmedTable(cells, `The early warnings confirmed, ${lower}`), "", breakdownTable(cells, `By regime and kind, ${lower}`), "");
  }
  sections.push("## The years", "", table(["Year", "Source", "Built", "Sets", "Bodies", "Timed by"], latest.years.map((year) => {
    const record = latest.archive[String(year)]!;
    return [year, record.source, record.builtAt.slice(0, 10), record.sets, record.bodies, record.timeBasis === "created" ? "publication time" : "epoch (a lower bound)"];
  })), "");
  return sections.join("\n");
}
