import { ALERT_STATES, BODY_CLASSES, DETECTOR_PARAMETERS, firstAgencyStatement, firstStatementOf, isAgencySource, launchOf, yearOf, type BodyClass, type Breakup, type BreakupKind, type Confidence, type DetectorParameters, type FirstStatement, type Notice, type Regime, type SourceId, type StatedPrecision, type Step, type Verdict } from "../../src/index.ts";
import { dayOf, endedByOf, operationalAt, opsStatusOf, regimeOf, semiMajorAxisOf } from "../../src/elements.ts";
import { inScope, type ScopeSubject } from "../../src/scope.ts";
import { WGS84_EQUATORIAL_KM } from "@orbinauts/engine";
import { FRAGMENTS_DAYS, fragmentsOf, launchFragmentsOf, type Catalogue, type EventFragments } from "./catalogue.ts";
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
/** The days after the event within which the catalogue's new bodies under the launch count as the event's pieces: the truth's own rule counts a burst's pieces to ninety days. */
export const PIECES_DAYS = 90;
/** The days after the event over which the parent's own sets are counted (up to the catalogue's first fragment), for the dissection of a miss: the alert's time to live. */
export const PARENT_SETS_AFTER_DAYS = 30;
/** How long after a reported event's window a false alarm on the same parent is noted as near it, in days: the step is the event's parent's, late by up to the truth's burst window. The alert stays a false alarm; the note is for the confirmed line, where the product would name the right object. */
export const NEAR_EVENT_DAYS = 30;
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
  /** The parent's sets in the sixty days before the window, and its sets from the window's start to the catalogue's first fragment (at most thirty days): whether a miss had sets to be judged on. */
  parentSetsBefore: number;
  parentSetsAfter: number;
  status: EventStatus;
  /** How many new bodies under the launch, numbered above the mark, were first published within ninety days of the event: the catalogue's own report of it, in the owner's definition. */
  piecesWithin90Days: number;
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
  /** The parent at the event's lower edge as the scope reads it (`scope.ts`): its class, its status as of the event, its last set's orbit before the event, its age from launch and the days since its last persistent step in the year; and whether it is in the detector's scope. Absent on a year file scored before the scope existed. */
  subject?: ScopeSubject;
  scopeIn?: boolean;
  /** The Confirmed line's reading of the event (`catalogue.ts`): the fresh pieces the catalogue published in the parent's plane within 180 days, the first of them and when, and whether the parent's orbit before the event was known. Absent on a year file scored before the Confirmed line existed. */
  fragments?: EventFragments;
  /** The first statement on the event by an agency, and by anyone, as the truth dates them: the earliest instant it can have been public (the first day of a quarterly news issue's month, or the day a notice was seen), how finely, and the source. */
  statement?: StatementAt | null;
  firstStatement?: StatementAt | null;
  /** The two statements the lead is read against side by side: the first agency notice dated to the day (`firstAgencyNotice`), and NASA's first quarterly news issue (`firstQuarterlyNews`). Absent on a year file scored before they were. */
  notice?: StatementAt | null;
  quarterly?: StatementAt | null;
}

/**
 * A target of the year that names a launch and no catalogued parent (a
 * burst under the launch, a separation GCAT gives an object the public
 * catalogue does not list): scored on the Confirmed line alone, by its
 * launch, since the early warning's lines read the parent's own orbit.
 */
export interface LaunchEvent {
  id: string;
  name: string;
  kind: BreakupKind;
  confidence: Confidence;
  line: Line;
  launch: string;
  from: number;
  to: number;
  at: number | null;
  /** The fresh pieces under the launch within 180 days (`launchFragmentsOf`); absent where the scorecard ran with no catalogue. */
  fragments?: EventFragments;
  statement: StatementAt | null;
  firstStatement: StatementAt | null;
  /** The two statements the lead is read against side by side, as on `ScoredEvent`. */
  notice?: StatementAt | null;
  quarterly?: StatementAt | null;
}

/** Whether a row is scored by its launch: scoreable, naming a launch and no catalogued parent. */
export const isLaunchRow = (row: Pick<Row, "breakup" | "launch">): boolean => row.breakup.scoreable && row.breakup.parent.catalogueNumber === null && row.launch !== null;

/** A first statement as the scorecard reads it: the earliest it can have been public, in milliseconds since 1970, how finely that is known, and who made it. */
export interface StatementAt {
  at: number;
  precision: StatedPrecision;
  source: SourceId;
}

/** NASA's sources: its quarterly news, and the reference documents of its history that date the news' issues. */
export const QUARTERLY_NEWS_SOURCES: readonly SourceId[] = ["hoosf-16e", "odqn"];

/** The first public agency notice of an event: the earliest statement by an agency (`AGENCY_SOURCES`) dated to the day, a U.S. Space Forces-Space notice, ESA's report or any other; null where none is. */
export const firstAgencyNotice = (breakup: Pick<Breakup, "statements">): FirstStatement | null => firstStatementOf(breakup.statements.filter((s) => isAgencySource(s.source) && s.statedOn?.precision === "day"));

/** The first issue of NASA's quarterly news on an event, dated to the first day of its month; null where none is dated. */
export const firstQuarterlyNews = (breakup: Pick<Breakup, "statements">): FirstStatement | null => firstStatementOf(breakup.statements.filter((s) => QUARTERLY_NEWS_SOURCES.includes(s.source)));

const statementAt = (first: FirstStatement | null): StatementAt | null => (first === null ? null : { at: Date.parse(`${first.on}T00:00:00Z`), precision: first.precision, source: first.source });

/**
 * One confirmed verdict of the year as the Confirmed line lands it: a
 * confirmation of a reported event (the verdict on the event's parent
 * from the margin before its window to 180 days after it; the matcher of
 * the aggregate makes the first on each event its detection and the rest
 * duplicates, across the years), inside an exempt window, on a fragment
 * of a reported event, or a false alarm. A confirmation by a notice alone
 * is not the Confirmed line's: the agency had said it.
 */
/**
 * Where a confirmed verdict lands: a detection, exempt, on a fragment of a
 * reported event, false, or `unnamed`: inside the window of a report naming
 * no object, no launch and no regime, which cannot say whether the verdict
 * is its object. Such a landing is neither exempt nor false, and the
 * scorecard counts it in a cell of its own, so the reports naming nothing
 * are seen to grow rather than hide confirmations.
 */
export type ConfirmedOutcome = "detection" | "exempt" | "fragment" | "false-alarm" | "unnamed";

export interface ConfirmedLanding {
  verdict: number;
  number: number;
  launch: string | null;
  raisedAt: number;
  outcome: ConfirmedOutcome;
  /** The event it lands on, is exempt by, or (for `unnamed`) falls inside the window of; null for a false alarm. */
  event: string | null;
  note: string;
  /** Whether it was attributed from the pieces with no step seen on the parent, or confirmed an alert on the parent's step. */
  attributed: boolean;
  /** The detector's instant of the event and its sigma in minutes, where it gave them. */
  eventAt: number | null;
  sigmaMinutes: number | null;
  /** The parent's class as the verdict's evidence gives it. */
  bodyClass: BodyClass;
  /** For a verdict naming the launch and its candidate bodies (the twins the pieces cannot tell apart): the candidates, and the landing with the twins matched at the launch's level (`matchTwinsAtLaunch`): a detection where the parent of a reported event is among them. Absent on any other verdict, whose landing is the same either way. */
  candidates?: number[];
  twin?: { outcome: ConfirmedLanding["outcome"]; event: string | null; note: string };
}

/**
 * Whether the Confirmed line matches a verdict naming a launch and its
 * candidate bodies at the launch's level: a detection where the parent of
 * a reported event is among the candidates, a false confirmation where no
 * candidate has one. Off, such a verdict is matched on the body it names
 * first, as any other. The owner's call: the headline is read off, the
 * reading on is reported beside it.
 */
export type MatchTwinsAtLaunch = boolean;

/** The crewed stations' launches, whose confirmed verdicts are exempt on the Confirmed line: what a station sheds is released on purpose, as the truth exempts the station's bursts. The scorecard's methodology, read from the detector's default list so a trial replay that changes the detector's cannot change the scoring. */
export const STATION_LAUNCHES: readonly string[] = DETECTOR_PARAMETERS.stationLaunches;
/** The launches of the crewed spacecraft and the stations' cargo craft, whose confirmed verdicts are exempt on the Confirmed line unless they name the launch's rocket body: what the craft leaves in orbit is released on purpose, its stage is an ordinary stage. The owner's decision for the eleventh phase, read from the detector's default list as the stations' is. */
export const VISITING_LAUNCHES: readonly string[] = DETECTOR_PARAMETERS.visitingLaunches;

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
  /** For a false alarm: a scoreable event on the same parent whose window ended within the month before the step, so the step is the right object's and late; null otherwise. */
  nearEvent: string | null;
  note: string;
  /** When a confirmed verdict on the same step followed, and how many days after this alert; null where none did. */
  confirmedAt: number | null;
  daysToConfirmation: number | null;
  /** The step's second edge, by which the alert's row in the log is found; null for a verdict with no step. */
  afterEpoch: number | null;
  /** Whether the detector read the step's parent as in its scope and the step as through the scope's gates (the verdict's evidence); absent on a year file scored before the scope existed. */
  scoped?: boolean;
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
  /** The year's confirmed verdicts as the Confirmed line lands them; absent on a year file scored before it existed. */
  confirmations?: ConfirmedLanding[];
  /** The year's targets scored by their launch on the Confirmed line alone; absent on a year file scored before they were. */
  launchEvents?: LaunchEvent[];
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

/**
 * How long a confirmation that lands on no row of the truth is pending,
 * in days after it was raised, before it counts as false: the agencies'
 * quarterly reports, which come months after an event. Such a
 * confirmation is unreported: neither true nor false while younger than
 * this, measured to the truth's date (`truthAsOf`), and a false
 * confirmation after it. The scorecard, the live test's score and the
 * published files read it alike (decision records 0007 and 0010).
 */
export const UNREPORTED_PENDING_DAYS = 90;

/**
 * The truth's date: the latest day it knows of, the publication of a
 * statement or the start of an event, in milliseconds since 1970. Read
 * from the truth alone, so a replay of the same truth reads the same
 * date; it is no later than the day the truth was built, so a refresh
 * that finds nothing new leaves it where it was.
 */
export function truthAsOf(breakups: readonly Pick<Breakup, "event" | "statements">[]): number {
  let latest = Number.NEGATIVE_INFINITY;
  for (const breakup of breakups) {
    latest = Math.max(latest, lowerOf(breakup as Breakup));
    for (const statement of breakup.statements) if (statement.statedOn !== null) latest = Math.max(latest, Date.parse(`${statement.statedOn.on}T00:00:00Z`));
  }
  return latest;
}

/** Whether a confirmation landing on no row is still pending at the truth's date: raised less than `UNREPORTED_PENDING_DAYS` before it, or after it. */
export const isPendingUnreported = (raisedAt: number, asOf: number): boolean => asOf - raisedAt < UNREPORTED_PENDING_DAYS * DAY_MS;

/** Where a row's window starts: the event's earliest instant, or its only one. */
export const lowerOf = (breakup: Breakup): number => Date.parse(breakup.event.from ?? breakup.event.to);
const upperOf = (breakup: Breakup): number => Date.parse(breakup.event.to);

/** Whether a step bracket and a window, each widened by the margin, overlap. */
export function brackets(step: Step | null, from: number, to: number, marginDays = MATCH_MARGIN_DAYS.LEO): boolean {
  if (step === null) return false;
  const margin = marginDays * DAY_MS;
  return step.beforeEpoch <= to + margin && step.afterEpoch >= from - margin;
}

/** Whether two step brackets overlap: the scorecard's rule for one step raised again, and for a confirmation of an alert on the same step. */
export const overlaps = (a: Step, b: Step): boolean => a.beforeEpoch <= b.afterEpoch && b.beforeEpoch <= a.afterEpoch;

/** A row of the truth as the matcher holds it, scoreable or not. */
export interface Row {
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

/**
 * Every row of the truth as the Confirmed line lands verdicts against it,
 * read through the catalogue of every year rather than one year's index:
 * the offline sweeps land simulated confirmations with it, as the matcher
 * lands the replay's.
 */
export function catalogueRowsOf(breakups: readonly Breakup[], catalogue: Catalogue): Row[] {
  return breakups.map((breakup) => {
    const from = lowerOf(breakup);
    const to = upperOf(breakup);
    const margin = marginDaysOf(breakup.orbit.regime) * DAY_MS;
    const parent = breakup.parent.catalogueNumber;
    const launch = launchOf(breakup.parent.designator) ?? (parent === null ? null : catalogue.bodies.get(parent)?.launch ?? null);
    const fragments = new Set<number>();
    if (launch !== null) {
      const mark = Math.max(catalogue.markAt(from - margin), parent ?? 0);
      for (const body of catalogue.byLaunch.get(launch) ?? []) if (body.number > mark && body.number < ANALYST_FLOOR) fragments.add(body.number);
    }
    return { breakup, from, to, margin, launch, fragments, scored: null };
  });
}

const hours = (ms: number): number => ms / 3_600_000;

/**
 * The year's verdicts matched against the truth. `breakups` is the whole
 * truth: the year's rows are its targets, and the rows of the year before
 * and after lend their exempt windows and fragments across the boundary.
 */
/** The days back the record of persistent steps is read for an event's parent: the record's own reach. */
const RECORD_DAYS = 730;

/**
 * The parent of an event at the event's lower edge, as the scope reads it:
 * the class and launch the body tables give, the status as of the event
 * (dated, as the detector reads it for the scope), the orbit of its last
 * set before the event (the truth's regime where it had none), and the
 * days since the last persistent step the detector made on it in the year
 * before the event, read from the year's verdicts (a step in the year
 * before is not in them, so a parent quiet in this year reads quiet).
 */
export function subjectAt(parent: number, at: number, regime: Regime, index: SetIndex, verdicts: Verdict[], params: DetectorParameters): ScopeSubject {
  const body = index.bodyOf(parent);
  const orbit = index.orbitBefore(parent, at);
  const launched = dayOf(body?.launch);
  let last = Number.NEGATIVE_INFINITY;
  for (const v of verdicts) if (v.number === parent && (v.state === "suspected" || v.state === "manoeuvre") && v.step !== null && v.step.afterEpoch < at - 3_600_000 && v.step.afterEpoch > at - RECORD_DAYS * DAY_MS) last = Math.max(last, v.step.afterEpoch);
  const aKm = orbit === null ? Number.NaN : semiMajorAxisOf(orbit);
  return {
    bodyClass: body?.bodyClass ?? "unknown",
    status: operationalAt({ opsStatus: opsStatusOf(body?.opsStatus), endedByMs: endedByOf(body?.endedOn), endedFromMs: dayOf(body?.endedFrom) }, at, { ...params, opsStatusDated: true }),
    regime: orbit === null ? regime : regimeOf(orbit),
    perigeeKm: orbit === null ? Number.NaN : aKm * (1 - orbit.eccentricity) - WGS84_EQUATORIAL_KM,
    bstar: orbit === null ? Number.NaN : orbit.bstar,
    ageDays: launched === null ? Number.NaN : (at - launched) / DAY_MS,
    daysSinceStep: Number.isFinite(last) ? (at - last) / DAY_MS : Number.POSITIVE_INFINITY,
  };
}

/**
 * Where a confirmed verdict lands on the Confirmed line, against the truth's
 * rows (the year's and its neighbours'): on the parent of a reported event
 * whose window it follows by no more than 180 days (the nearest such
 * event to the verdict's instant of the event, else to its raising, since
 * a parent may break up twice and a later event's confirmation must never
 * count for an earlier one), a detection where that event is scoreable and
 * exempt where it is not; on any body of the launch of a scoreable row
 * naming the launch alone (a burst, a separation of an object the public
 * catalogue does not list), within the same 180 days, a detection of that
 * row (`isLaunchRow`); inside the window of another row naming no
 * catalogued object, exempt where the row names the verdict's launch (one
 * naming the launch alone, as an analyst-parented row does) or a regime the
 * verdict's object is in (`regime`, by its last set; unknown where the
 * caller has none); on a fragment of a reported event after it; inside the
 * window of a report naming no object, no launch and no regime, `unnamed`,
 * a cell of its own; or a false alarm. A verdict under a crewed station's
 * launch is exempt, whatever it names. A verdict naming candidates (twins)
 * is landed on the body it names first, and carries beside it the landing
 * at the launch's level (`twin`): a detection of the reported event on any
 * candidate within the window, the one nearest the verdict's instant.
 */
export function landConfirmed(verdict: Pick<Verdict, "number" | "launch" | "raisedAt" | "step" | "event" | "evidence" | "candidates">, i: number, rows: readonly Row[], stations: readonly string[] = STATION_LAUNCHES, visiting: readonly string[] = VISITING_LAUNCHES, regime: Regime = "unknown"): ConfirmedLanding {
  const landing = landOnBody(verdict, i, rows, stations, visiting, regime);
  const candidates = verdict.candidates;
  if (candidates === undefined || candidates.length < 2 || (landing.outcome === "exempt" && landing.note.startsWith("a crewed"))) return landing;
  // At the launch's level: the reported events on any candidate within the window, the one nearest the verdict's instant where it gave one (twins may each break up within the half year), else the latest.
  const after = FRAGMENTS_DAYS * DAY_MS;
  const onCandidates = rows.filter((row) => row.breakup.scoreable && row.breakup.parent.catalogueNumber !== null && candidates.includes(row.breakup.parent.catalogueNumber) && verdict.raisedAt >= row.from - row.margin && verdict.raisedAt <= row.to + after);
  const at = verdict.event?.at;
  const nearest = onCandidates.sort((a, b) => (at === undefined ? b.from - a.from : Math.abs(a.from - at) - Math.abs(b.from - at) || b.from - a.from))[0];
  const twin = nearest === undefined ? { outcome: landing.outcome, event: landing.event, note: landing.note } : { outcome: "detection" as const, event: nearest.breakup.id, note: `a confirmed verdict naming the launch with ${nearest.breakup.parent.catalogueNumber}, a reported event's parent, among its candidates` };
  return { ...landing, candidates: [...candidates], twin };
}

/** The row whose window is nearest an instant (no distance inside it), the later on a tie; undefined for none. */
export function nearestRow(rows: readonly Row[], at: number): Row | undefined {
  const distance = (row: Row): number => (at < row.from ? row.from - at : at > row.to ? at - row.to : 0);
  return [...rows].sort((a, b) => distance(a) - distance(b) || b.from - a.from)[0];
}

/** Where a confirmed verdict lands on the body it names. */
function landOnBody(verdict: Pick<Verdict, "number" | "launch" | "raisedAt" | "step" | "event" | "evidence">, i: number, rows: readonly Row[], stations: readonly string[], visiting: readonly string[], regime: Regime): ConfirmedLanding {
  const number = verdict.number!;
  const base = { verdict: i, number, launch: verdict.launch, raisedAt: verdict.raisedAt, attributed: verdict.step === null, eventAt: verdict.event?.at ?? null, sigmaMinutes: verdict.evidence.sigmaMinutes ?? null, bodyClass: BODY_CLASSES[verdict.evidence.bodyClass ?? -1] ?? "unknown" };
  if (verdict.launch !== null && stations.includes(verdict.launch)) return { ...base, outcome: "exempt", event: null, note: "a crewed station's launch: what it sheds is released on purpose" };
  if (verdict.launch !== null && visiting.includes(verdict.launch) && base.bodyClass !== "rocket body") return { ...base, outcome: "exempt", event: null, note: "a crewed spacecraft's or a station's cargo craft's launch, not on its rocket body: what the craft leaves in orbit is released on purpose" };
  const after = FRAGMENTS_DAYS * DAY_MS;
  // The nearest reported event of the parent within the window and the half year after it, so a later event's confirmation never counts for an earlier one.
  const nearest = nearestRow(rows.filter((row) => row.breakup.parent.catalogueNumber === number && verdict.raisedAt >= row.from - row.margin && verdict.raisedAt <= row.to + after), verdict.event?.at ?? verdict.raisedAt);
  if (nearest !== undefined && nearest.breakup.scoreable) return { ...base, outcome: "detection", event: nearest.breakup.id, note: "a confirmed verdict on a reported event's parent within 180 days of it" };
  if (nearest !== undefined) return { ...base, outcome: "exempt", event: nearest.breakup.id, note: `inside the window of ${nearest.breakup.exemptReason ?? nearest.breakup.kind}` };
  const byLaunch = nearestRow(rows.filter((row) => isLaunchRow(row) && row.launch === verdict.launch && verdict.raisedAt >= row.from - row.margin && verdict.raisedAt <= row.to + after), verdict.event?.at ?? verdict.raisedAt);
  if (byLaunch !== undefined) return { ...base, outcome: "detection", event: byLaunch.breakup.id, note: "a confirmed verdict on a body of the launch of a reported event naming no catalogued parent, within 180 days of it" };
  // A row naming no catalogued object exempts what it does name: its launch, else its regime; one naming neither cannot say, and gets a cell of its own below.
  const noObject = rows.filter((row) => row.breakup.parent.catalogueNumber === null && verdict.raisedAt >= row.from - row.margin && verdict.raisedAt <= row.to + after);
  const onLaunch = noObject.find((row) => row.launch !== null && row.launch === verdict.launch);
  if (onLaunch !== undefined) return { ...base, outcome: "exempt", event: onLaunch.breakup.id, note: `inside the window of ${onLaunch.breakup.kind === "unnamed" ? "a report naming no object, under its launch" : "a row naming the launch alone"}` };
  const unnamed = noObject.filter((row) => row.breakup.kind === "unnamed" && row.launch === null);
  const inRegime = unnamed.find((row) => row.breakup.orbit.regime !== "unknown" && row.breakup.orbit.regime === regime);
  if (inRegime !== undefined) return { ...base, outcome: "exempt", event: inRegime.breakup.id, note: `inside the window of a report naming no object, in its regime (${regime})` };
  const ofFragment = rows.find((row) => row.fragments.has(number) && verdict.raisedAt >= row.from - row.margin);
  if (ofFragment !== undefined) return { ...base, outcome: ofFragment.breakup.scoreable ? "fragment" : "exempt", event: ofFragment.breakup.id, note: "a confirmed verdict on a fragment of a reported event" };
  const bare = unnamed.find((row) => row.breakup.orbit.regime === "unknown");
  if (bare !== undefined) return { ...base, outcome: "unnamed", event: bare.breakup.id, note: "inside the window of a report naming no object, no launch and no regime: counted apart, neither exempt nor false" };
  return { ...base, outcome: "false-alarm", event: null, note: "matches no reported event" };
}

export function matchYear(year: number, breakups: Breakup[], verdicts: Verdict[], index: SetIndex, timeBasis: TimeBasis, notices: Notice[] = noticesOf(breakups), params: DetectorParameters = DETECTOR_PARAMETERS, catalogue?: Catalogue): YearScore {
  const rows = breakups.filter((b) => Math.abs(yearOf(b) - year) <= 1).map((b) => rowOf(b, index));
  const events: ScoredEvent[] = [];
  const launchEvents: LaunchEvent[] = [];
  for (const row of rows) {
    const { breakup } = row;
    if (isLaunchRow(row) && yearOf(breakup) === year) {
      launchEvents.push({
        id: breakup.id,
        name: breakup.parent.name,
        kind: breakup.kind,
        confidence: breakup.confidence,
        line: lineOf(breakup),
        launch: row.launch!,
        from: row.from,
        to: row.to,
        at: breakup.event.at === null ? null : Date.parse(breakup.event.at),
        ...(catalogue === undefined ? {} : { fragments: launchFragmentsOf(catalogue, row.launch!, row.from, row.to, row.margin) }),
        statement: statementAt(firstAgencyStatement(breakup)),
        firstStatement: statementAt(breakup.firstStatement),
        notice: statementAt(firstAgencyNotice(breakup)),
        quarterly: statementAt(firstQuarterlyNews(breakup)),
      });
      continue;
    }
    if (!breakup.scoreable || yearOf(breakup) !== year || breakup.parent.catalogueNumber === null) continue;
    const parent = breakup.parent.catalogueNumber;
    const parentSetsBefore = index.countSets(parent, row.from - PARENT_SETS_DAYS * DAY_MS, row.from);
    let catalogueAt: number | null = null;
    let catalogueBody: number | null = null;
    let piecesWithin90Days = 0;
    for (const number of row.fragments) {
      const first = index.firstPublicationFrom(number, row.from - row.margin);
      if (first === null) continue;
      if (catalogueAt === null || first < catalogueAt) [catalogueAt, catalogueBody] = [first, number];
      if (first <= row.from + PIECES_DAYS * DAY_MS) piecesWithin90Days++;
    }
    const parentSetsAfter = index.countSets(parent, row.from, Math.max(row.from, Math.min(row.from + PARENT_SETS_AFTER_DAYS * DAY_MS, catalogueAt ?? Number.POSITIVE_INFINITY)));
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
      parentSetsAfter,
      status: parentSetsBefore < MIN_PARENT_SETS ? "undetectable" : "missed",
      piecesWithin90Days,
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
    const subject = subjectAt(parent, row.from, breakup.orbit.regime, index, verdicts, params);
    row.scored.subject = subject;
    row.scored.scopeIn = inScope(subject, params.scope.policy);
    if (catalogue !== undefined) row.scored.fragments = fragmentsOf(catalogue, parent, row.launch, row.from, row.to, row.scored.at ?? row.from, row.margin);
    row.scored.statement = statementAt(firstAgencyStatement(breakup));
    row.scored.firstStatement = statementAt(breakup.firstStatement);
    row.scored.notice = statementAt(firstAgencyNotice(breakup));
    row.scored.quarterly = statementAt(firstQuarterlyNews(breakup));
    events.push(row.scored);
  }
  const alerts: ScoredAlert[] = [];
  const review: ReviewRow[] = [];
  const confirmations: ConfirmedLanding[] = [];
  const stepsRaised = new Map<number, Step[]>();
  const ordered = verdicts.map((verdict, i) => ({ verdict, i })).sort((a, b) => a.verdict.raisedAt - b.verdict.raisedAt || a.i - b.i);
  for (const { verdict, i } of ordered) {
    if (verdict.kind === "cloud") {
      review.push({ verdict: i, launch: verdict.launch, number: verdict.number, raisedAt: verdict.raisedAt, state: verdict.state, pieces: verdict.bodies?.length ?? 0 });
      continue;
    }
    if (!ALERT_STATES.includes(verdict.state) || verdict.number === null) continue;
    // The Confirmed line: every confirmed verdict by pieces, with or without a step seen on the parent.
    if (verdict.state === "confirmed" && verdict.evidence.noticed !== 1) {
      // The object's regime by its last set before the raising: what a report naming no object but a regime is bounded by.
      const orbit = index.orbitBefore(verdict.number, verdict.raisedAt);
      confirmations.push(landConfirmed(verdict, i, rows, STATION_LAUNCHES, VISITING_LAUNCHES, orbit === null ? "unknown" : regimeOf(orbit)));
    }
    // A confirmed verdict with no step was attributed from the pieces alone: the Confirmed line's, never an alert on the parent's step.
    if (verdict.state === "confirmed" && verdict.step === null) continue;
    const number = verdict.number;
    // A confirmed verdict that lands as an alert of its own (a step the record read as a manoeuvre, promoted by the pieces, which raised no counted alert before) is confirmed as it lands.
    const land = (outcome: AlertOutcome, event: string | null, note: string, nearEvent: string | null = null): void => {
      const promoted = verdict.state === "confirmed" && outcome !== "confirmation";
      alerts.push({ verdict: i, number, launch: verdict.launch, raisedAt: verdict.raisedAt, state: verdict.state, outcome, event, nearEvent, note, confirmedAt: promoted ? verdict.raisedAt : null, daysToConfirmation: promoted ? 0 : null, afterEpoch: verdict.step?.afterEpoch ?? null, scoped: verdict.evidence.scoped === 1 });
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
    const near = verdict.step === null ? undefined : rows.find((row) => row.breakup.scoreable && row.breakup.parent.catalogueNumber === number && verdict.step!.afterEpoch >= row.from - row.margin && verdict.step!.beforeEpoch <= row.to + NEAR_EVENT_DAYS * DAY_MS);
    land("false-alarm", null, near === undefined ? "matches no reported event" : `matches no reported event; the parent of ${near.breakup.id}, whose window ended within the month before the step`, near?.breakup.id ?? null);
  }
  return { year, timeBasis, events, alerts, review, confirmations, launchEvents };
}
