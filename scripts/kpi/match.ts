import { ALERT_STATES, launchOf, yearOf, type Breakup, type BreakupKind, type Confidence, type Notice, type Regime, type Step, type Verdict } from "../../src/index.ts";
import { ANALYST_FLOOR, DAY_MS, type SetIndex, type TimeBasis } from "./replay.ts";

/**
 * The matching rule: what the detector raised over a year, against what
 * the ground truth says happened in it. One pass over the verdicts in the
 * order they were raised, each landing in exactly one place.
 *
 * The targets are the scoreable Known Breakups of the year whose parent
 * had public element sets to be judged on: at least five sets in the sixty
 * days before the window. An event whose parent has fewer is undetectable
 * from public elements and is listed apart, out of the denominator, so a
 * classified parent neither pads nor dilutes the rate. The targets are
 * scored on five lines, never mixed: breakups reported to the day or
 * better (confidence A and B), which is the owner's headline; breakups
 * reported to a month (C) and breakups known only from the pieces (D), on
 * their own lines since a wide window is easier to hit and says less; and
 * anomalous events, which barely move the parent, by the same two groups.
 *
 * A detection is an object verdict in a counted state (suspected or
 * confirmed) on the parent, whose measured step bracket overlaps the
 * truth's window, each widened by a day for the slop between an epoch and
 * an instant, and raised before the catalogue said it: before the first
 * published set of any new body under the parent's launch numbered above
 * the highest designated catalogue number at the event, and before any
 * notice. The same verdict after that is late, listed apart: it repackaged
 * what was public. Further alerts on the same event, or on its fragments,
 * are duplicates. A cloud verdict never counts: it is the catalogue's own
 * report read back, and goes to the review list. An alert inside an exempt
 * window (an aerodynamic breakup at reentry, a release, a report naming no
 * object, a parent with no catalogue number, or an undetectable event's
 * own window) is exempt. Everything else is a false alarm, and a second
 * alert on the same object whose bracket overlaps an earlier alert's is
 * the same step raised again, a duplicate, since the unit the owner
 * counts is the step. A confirmed verdict on a step already alerted is
 * the fragments' or a notice's confirmation of that alert, landed as
 * such and recorded on it, so the scorecard can say how many alerts were
 * confirmed, how many of those were true, and how long after.
 *
 * Per event the lead over the catalogue (hours from the alert to the
 * first fragment's set) and the latency from the event (hours from the
 * event's instant, or its window's lower edge, to the alert) are recorded;
 * for a year with no publication times the catalogue's time is the first
 * fragment's epoch, a lower bound, and the record says so.
 */

/** How many sets the parent must have in the days before the window to be judged on public elements. */
export const MIN_PARENT_SETS = 5;
export const PARENT_SETS_DAYS = 60;
/**
 * How far a step bracket and a truth window may miss each other and still
 * match, in days, per regime: the slop between epochs and instants. A day
 * in low and medium orbits, where sets come hours apart and an authority's
 * instant is measured. Five days in highly elliptical and geosynchronous
 * orbits, where sets are days apart, the catalogue's fit settles on the
 * new orbit over several of them, and the stated instant is itself
 * inferred: the ullage motors and Beidou G2 of the first phase showed the
 * catalogue's step two to four days before the stated time. An event of
 * unknown regime takes the day.
 */
export const MATCH_MARGIN_DAYS: Record<Regime, number> = { LEO: 1, MEO: 1, HEO: 5, GEO: 5, unknown: 1 };

export const marginDaysOf = (regime: Regime): number => MATCH_MARGIN_DAYS[regime];

export const LINES = ["breakups A-B", "breakups C", "breakups D", "anomalous A-B", "anomalous C-D"] as const;
export type Line = (typeof LINES)[number];

/** The line a scoreable event is scored on, by its kind and how finely it was reported. */
export function lineOf(breakup: Pick<Breakup, "kind" | "confidence">): Line {
  const fine = breakup.confidence === "A" || breakup.confidence === "B";
  if (breakup.kind === "anomalous") return fine ? "anomalous A-B" : "anomalous C-D";
  if (fine) return "breakups A-B";
  return breakup.confidence === "C" ? "breakups C" : "breakups D";
}

export const EVENT_STATUSES = ["detected", "late", "missed", "undetectable"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const ALERT_OUTCOMES = ["detection", "late", "duplicate", "exempt", "false-alarm", "confirmation"] as const;
export type AlertOutcome = (typeof ALERT_OUTCOMES)[number];

/** One target of the year, scored. */
export interface ScoredEvent {
  id: string;
  name: string;
  kind: BreakupKind;
  confidence: Confidence;
  regime: Regime;
  line: Line;
  parent: number;
  launch: string | null;
  /** The truth's window, in milliseconds since 1970: the lower edge (the instant where stated), the upper edge, and the instant where stated. */
  from: number;
  to: number;
  at: number | null;
  /** The parent's sets in the sixty days before the window. */
  parentSetsBefore: number;
  status: EventStatus;
  /** When the catalogue published the first set of a new body under the launch after the event, and which body; null where none was in the year. */
  catalogueAt: number | null;
  catalogueBody: number | null;
  catalogueBasis: TimeBasis;
  noticeAt: number | null;
  /** The first counted alert on the event, by its index among the year's verdicts; null where none matched. */
  alert: number | null;
  alertAt: number | null;
  step: Step | null;
  leadHours: number | null;
  latencyHours: number | null;
  /** When a confirmed verdict on the event followed, and how many days after the alert. */
  confirmedAt: number | null;
  daysToConfirmation: number | null;
  /** The detector's estimate of the instant against the truth's, in minutes, where both state one. */
  timingErrorMinutes: number | null;
}

/** One counted verdict of the year, with where it landed. */
export interface ScoredAlert {
  verdict: number;
  number: number;
  launch: string | null;
  raisedAt: number;
  state: Verdict["state"];
  outcome: AlertOutcome;
  /** The event it matched, was late on, duplicated or was exempt by; null for a false alarm. */
  event: string | null;
  note: string;
  /** When a confirmed verdict on the same step followed, and how many days after this alert; null where none did. */
  confirmedAt: number | null;
  daysToConfirmation: number | null;
  /** The step's second edge, by which the alert's row in the log is found; null for a verdict with no step. */
  afterEpoch: number | null;
}

/** A cloud verdict, for the review list. */
export interface ReviewRow {
  verdict: number;
  launch: string | null;
  /** The parent the pieces attach to, where the launch has one. */
  number: number | null;
  raisedAt: number;
  state: Verdict["state"];
  /** How many consistent pieces the cloud rests on. */
  pieces: number;
}

export interface YearScore {
  year: number;
  timeBasis: TimeBasis;
  events: ScoredEvent[];
  alerts: ScoredAlert[];
  review: ReviewRow[];
}

/** The notices the truth records, as the detector and the matcher take them: the day each was seen is the earliest it is known to have been public. */
export function noticesOf(breakups: Breakup[]): Notice[] {
  const notices: Notice[] = [];
  for (const breakup of breakups) {
    for (const statement of breakup.statements) {
      if (statement.source !== "s4s-notice") continue;
      const seen = /seen (\d{4}-\d{2}-\d{2})/.exec(statement.ref)?.[1];
      notices.push({ number: statement.parent.catalogueNumber, launch: launchOf(statement.parent.designator), at: seen === undefined ? Date.parse(statement.event.to) : Date.parse(`${seen}T00:00:00Z`), text: statement.note ?? statement.ref });
    }
  }
  return notices.sort((a, b) => a.at - b.at);
}

const lowerOf = (breakup: Breakup): number => Date.parse(breakup.event.from ?? breakup.event.to);
const upperOf = (breakup: Breakup): number => Date.parse(breakup.event.to);

/** Whether a step bracket and a window, each widened by the margin, overlap. */
export function brackets(step: Step | null, from: number, to: number, marginDays = MATCH_MARGIN_DAYS.LEO): boolean {
  if (step === null) return false;
  const margin = marginDays * DAY_MS;
  return step.beforeEpoch <= to + margin && step.afterEpoch >= from - margin;
}

const overlaps = (a: Step, b: Step): boolean => a.beforeEpoch <= b.afterEpoch && b.beforeEpoch <= a.afterEpoch;

/** A row of the truth as the matcher holds it, scoreable or not. */
interface Row {
  breakup: Breakup;
  from: number;
  to: number;
  /** The row's margin, in milliseconds, by its regime. */
  margin: number;
  launch: string | null;
  /** The bodies under the launch catalogued after the event: its fragments, by number. */
  fragments: Set<number>;
  scored: ScoredEvent | null;
}

function rowOf(breakup: Breakup, index: SetIndex): Row {
  const from = lowerOf(breakup);
  const to = upperOf(breakup);
  const margin = marginDaysOf(breakup.orbit.regime) * DAY_MS;
  const parent = breakup.parent.catalogueNumber;
  const launch = launchOf(breakup.parent.designator) ?? (parent === null ? null : launchOf(index.bodies.find((b) => b.number === parent)?.designator ?? null));
  const fragments = new Set<number>();
  if (launch !== null) {
    // The mark is taken the margin before the window, the same slop the fragment search allows, so a piece published hours before a stated instant is still new.
    const mark = Math.max(index.highWaterMark(from - margin), parent ?? 0);
    for (const body of index.bodies) if (body.number > mark && body.number < ANALYST_FLOOR && launchOf(body.designator) === launch) fragments.add(body.number);
  }
  return { breakup, from, to, margin, launch, fragments, scored: null };
}

const hours = (ms: number): number => ms / 3_600_000;

/**
 * The year's verdicts matched against the truth. `breakups` is the whole
 * truth: the year's rows are its targets, and the rows of the year before
 * and after lend their exempt windows and fragments across the boundary.
 */
export function matchYear(year: number, breakups: Breakup[], verdicts: Verdict[], index: SetIndex, timeBasis: TimeBasis, notices: Notice[] = noticesOf(breakups)): YearScore {
  const rows = breakups.filter((b) => Math.abs(yearOf(b) - year) <= 1).map((b) => rowOf(b, index));
  const events: ScoredEvent[] = [];
  for (const row of rows) {
    const { breakup } = row;
    if (!breakup.scoreable || yearOf(breakup) !== year || breakup.parent.catalogueNumber === null) continue;
    const parent = breakup.parent.catalogueNumber;
    const parentSetsBefore = index.countSets(parent, row.from - PARENT_SETS_DAYS * DAY_MS, row.from);
    let catalogueAt: number | null = null;
    let catalogueBody: number | null = null;
    for (const number of row.fragments) {
      const first = index.firstPublicationFrom(number, row.from - row.margin);
      if (first !== null && (catalogueAt === null || first < catalogueAt)) [catalogueAt, catalogueBody] = [first, number];
    }
    const noticeAt = notices.filter((n) => n.at >= row.from && ((n.number !== null && n.number === parent) || (n.number === null && n.launch !== null && n.launch === row.launch))).map((n) => n.at).sort((a, b) => a - b)[0] ?? null;
    row.scored = {
      id: breakup.id,
      name: breakup.parent.name,
      kind: breakup.kind,
      confidence: breakup.confidence,
      regime: breakup.orbit.regime,
      line: lineOf(breakup),
      parent,
      launch: row.launch,
      from: row.from,
      to: row.to,
      at: breakup.event.at === null ? null : Date.parse(breakup.event.at),
      parentSetsBefore,
      status: parentSetsBefore < MIN_PARENT_SETS ? "undetectable" : "missed",
      catalogueAt,
      catalogueBody,
      catalogueBasis: timeBasis,
      noticeAt,
      alert: null,
      alertAt: null,
      step: null,
      leadHours: null,
      latencyHours: null,
      confirmedAt: null,
      daysToConfirmation: null,
      timingErrorMinutes: null,
    };
    events.push(row.scored);
  }
  const alerts: ScoredAlert[] = [];
  const review: ReviewRow[] = [];
  const stepsRaised = new Map<number, Step[]>();
  const ordered = verdicts.map((verdict, i) => ({ verdict, i })).sort((a, b) => a.verdict.raisedAt - b.verdict.raisedAt || a.i - b.i);
  for (const { verdict, i } of ordered) {
    if (verdict.kind === "cloud") {
      review.push({ verdict: i, launch: verdict.launch, number: verdict.number, raisedAt: verdict.raisedAt, state: verdict.state, pieces: verdict.bodies?.length ?? 0 });
      continue;
    }
    if (!ALERT_STATES.includes(verdict.state) || verdict.number === null) continue;
    const number = verdict.number;
    const land = (outcome: AlertOutcome, event: string | null, note: string): void => {
      alerts.push({ verdict: i, number, launch: verdict.launch, raisedAt: verdict.raisedAt, state: verdict.state, outcome, event, note, confirmedAt: null, daysToConfirmation: null, afterEpoch: verdict.step?.afterEpoch ?? null });
    };
    // A confirmed verdict on a step already alerted: the confirmation of that alert.
    if (verdict.state === "confirmed" && verdict.step !== null) {
      const earlier = alerts.find((a) => a.number === number && a.outcome !== "confirmation" && a.outcome !== "duplicate" && overlaps(verdicts[a.verdict]!.step!, verdict.step!));
      if (earlier !== undefined) {
        earlier.confirmedAt = verdict.raisedAt;
        earlier.daysToConfirmation = (verdict.raisedAt - earlier.raisedAt) / DAY_MS;
        const scored = earlier.event === null ? undefined : rows.find((row) => row.scored?.id === earlier.event)?.scored;
        if (scored && scored.alert === earlier.verdict && scored.confirmedAt === null) {
          scored.confirmedAt = verdict.raisedAt;
          scored.daysToConfirmation = (verdict.raisedAt - scored.alertAt!) / DAY_MS;
        }
        land("confirmation", earlier.event, earlier.outcome === "false-alarm" ? "the fragments or a notice confirmed an alert matching no reported event" : `the fragments or a notice confirmed the alert on ${earlier.event}`);
        continue;
      }
    }
    // A counted alert on the parent of a target, on its step: a detection, late, a duplicate, or exempt for an undetectable one.
    const onParent = rows.filter((row) => row.breakup.parent.catalogueNumber === number && brackets(verdict.step, row.from, row.to, row.margin / DAY_MS)).sort((a, b) => a.from - b.from);
    const target = onParent.find((row) => row.scored !== null);
    if (target?.scored !== undefined && target.scored !== null) {
      const scored = target.scored;
      if (scored.status === "undetectable") {
        land("exempt", scored.id, "the parent had too few public sets before the event to be scored");
      } else if (scored.alert !== null) {
        if (verdict.state === "confirmed" && scored.confirmedAt === null) {
          scored.confirmedAt = verdict.raisedAt;
          scored.daysToConfirmation = (verdict.raisedAt - scored.alertAt!) / DAY_MS;
        }
        land("duplicate", scored.id, "a later alert on an event already alerted");
      } else {
        const deadline = [scored.catalogueAt, scored.noticeAt].filter((t): t is number => t !== null).sort((a, b) => a - b)[0];
        const onTime = deadline === undefined || verdict.raisedAt < deadline;
        scored.status = onTime ? "detected" : "late";
        scored.alert = i;
        scored.alertAt = verdict.raisedAt;
        scored.step = verdict.step;
        scored.leadHours = scored.catalogueAt === null ? null : hours(scored.catalogueAt - verdict.raisedAt);
        scored.latencyHours = hours(verdict.raisedAt - (scored.at ?? scored.from));
        if (verdict.state === "confirmed") [scored.confirmedAt, scored.daysToConfirmation] = [verdict.raisedAt, 0];
        if (scored.at !== null && verdict.event !== null) scored.timingErrorMinutes = Math.abs(verdict.event.at - scored.at) / 60_000;
        land(onTime ? "detection" : "late", scored.id, onTime ? "raised before the catalogue and any notice" : `raised after ${scored.catalogueAt !== null && (scored.noticeAt === null || scored.catalogueAt <= scored.noticeAt) ? "the first fragment's set" : "a notice"}`);
      }
      continue;
    }
    // An alert on a non-scoreable row's parent in its window: exempt.
    const exemptRow = onParent[0] ?? rows.find((row) => row.breakup.parent.catalogueNumber === null && verdict.raisedAt >= row.from - row.margin && verdict.raisedAt <= row.to + row.margin && (row.breakup.kind === "unnamed" || (row.launch !== null && row.launch === verdict.launch)));
    if (exemptRow !== undefined) {
      land("exempt", exemptRow.breakup.id, `inside the window of ${exemptRow.breakup.kind === "unnamed" ? "a report naming no object" : exemptRow.breakup.exemptReason ?? exemptRow.breakup.kind}`);
      continue;
    }
    // An alert on a fragment of a reported event, after it: a duplicate of that event, or exempt where the event is.
    const ofFragment = rows.find((row) => row.fragments.has(number) && verdict.raisedAt >= row.from - row.margin);
    if (ofFragment !== undefined) {
      land(ofFragment.breakup.scoreable ? "duplicate" : "exempt", ofFragment.breakup.id, "an alert on a fragment of a reported event");
      continue;
    }
    // The same step on the same object raised again.
    const earlier = stepsRaised.get(number) ?? [];
    if (verdict.step !== null && earlier.some((step) => overlaps(step, verdict.step!))) {
      land("duplicate", null, "the same step on the same object raised again");
      continue;
    }
    if (verdict.step !== null) stepsRaised.set(number, [...earlier, verdict.step]);
    land("false-alarm", null, "matches no reported event");
  }
  return { year, timeBasis, events, alerts, review };
}
