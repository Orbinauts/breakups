import type { EventEstimate, Step, Verdict } from "./detector.ts";
import type { Precision, SourceId, StatedPrecision } from "./truth.ts";

/**
 * The breakups fit to show, as the daily job publishes them under `v2/` on
 * this repository's GitHub Pages: the frozen detector's verdicts, landed on
 * the ground truth as it stands that day, kept when the detector confirmed
 * the breakup, when an agency notice dated no earlier than the event
 * confirms it, or, as suspected, when an outside report (news or an
 * analyst) names it. A consumer reads the three files and checks them
 * against these types: the list (`v2/breakups.json`, a
 * {@link PublishedBreakupsFile}), one file per breakup with its whole
 * evidence (`v2/breakups/<id>.json`, a {@link PublishedBreakupFile}) and
 * the job's status (`v2/status.json`, a {@link PublishedStatusFile}).
 * Every instant is an ISO string (`2026-09-17T00:00:00.000Z`) and every
 * day `YYYY-MM-DD`; each file carries the {@link PUBLISHED_VERSION} it was
 * written in.
 */

/**
 * The version of the published files' shape: the `v2/` of their path and
 * the `version` each carries. A change a strict reader can trip on raises
 * it. Version 2 added the state `unreported` and `unreportedAt`; the files
 * of version 1, under `v1/`, are no longer written.
 */
export const PUBLISHED_VERSION = 2;

/**
 * How a published breakup stands: suspected (reported by news or an
 * analyst; it leaves when its step expires or is dismissed), confirmed (by
 * the detector or an agency notice) or unreported (confirmed by the
 * detector alone, on no row of the ground truth and on no reported event
 * as the scorecard lands it, once 90 days have passed, when the scorecard
 * reads it as a false confirmation; confirmed again if a report lands
 * later). A confirmed or unreported breakup stays for good.
 */
export const PUBLISHED_STATES = ["suspected", "confirmed", "unreported"] as const;
export type PublishedState = (typeof PUBLISHED_STATES)[number];

/** The states a verdict merged into a published breakup can carry: the detector's own, suspected or confirmed; `unreported` is a reading of the breakup, never a verdict's. */
export type PublishedVerdictState = Exclude<PublishedState, "unreported">;

/** The parent of a published breakup: from the ground-truth row it landed on, what the row leaves out filled from the satellite catalogue; null where neither names it. */
export interface PublishedParent {
  catalogueNumber: number;
  /** The international designator (`2014-058A`), or the launch alone (`1998-037`) where the row names no piece. */
  designator: string | null;
  name: string | null;
  /** The launch day, `YYYY-MM-DD` or a coarser prefix as the source gives it. */
  launchedOn: string | null;
}

/** The step the detector measured ({@link Step}), its epochs as ISO instants. */
export interface PublishedStep {
  beforeEpoch: string;
  afterEpoch: string;
  deltaKm: number;
  deltaPerigeeKm: number | null;
  deltaApogeeKm: number | null;
  deltaInclinationDeg: number | null;
  postSets: number;
  z: number | null;
}

/** The detector's estimate of the event's time ({@link EventEstimate}), as ISO instants. */
export interface PublishedEvent {
  at: string;
  from: string;
  to: string;
}

/**
 * The event as the ground-truth row the breakup landed on dates it, beside
 * the detector's estimate: the row's instants, its precision, the source its
 * date was resolved from and its id. The source is any of the truth's, GCAT
 * and the catalogue too, so a reader that calls the time reported checks it
 * against {@link PublishedReport}'s sources first.
 */
export interface PublishedRowEvent {
  /** The instant the row states; null where it states none (a day, a month). */
  at: string | null;
  /** The earliest the event can have happened; null where the row gives no start. */
  from: string | null;
  /** The latest the event can have happened; null where the row gives no end. */
  to: string | null;
  /** How finely the row's source states the event (`second` to `none`). */
  precision: Precision;
  /** The source the row's date was resolved from. */
  source: SourceId;
  /** The row's id (`40258:2026-01-30`). */
  row: string;
}

/**
 * A report that counts on the ground-truth row the breakup landed on: an
 * agency notice (`AGENCY_SOURCES`) dated no earlier than the event, or a
 * dated outside report (`news`, `analyst`). An undated statement, and any
 * from `gcat` or the catalogue, is never one.
 */
export interface PublishedReport {
  source: SourceId;
  /** The day the report can first have been public (`YYYY-MM-DD`), to its {@link PublishedReport.precision}. */
  date: string;
  precision: StatedPrecision;
  /** The page it is read from, where it has one. */
  url: string | null;
}

/** One entry of the list, `v2/breakups.json`. */
export interface PublishedBreakupEntry {
  /** `<catalogue number>-<UTC day>` (`40258-2026-01-30`), fixed the first time the breakup is published. The day is the row's ({@link PublishedBreakupEntry.rowEvent}) where it is dated to the day or finer, else the detector's estimate's, else {@link PublishedBreakupEntry.raisedAt}'s. */
  id: string;
  state: PublishedState;
  /** When the detector first raised it: the earliest of its verdicts. */
  raisedAt: string;
  /** The earlier of the first confirmed verdict and the first agency notice's day (at midnight UTC); null while suspected. */
  confirmedAt: string | null;
  /** The instant it turned unreported: when the 90 days after {@link PublishedBreakupEntry.confirmedAt} ran out and the scorecard's reading of its confirmation turned false, not the day of the run that relabelled it; null unless unreported, and null again once a report lands and it is confirmed again. */
  unreportedAt: string | null;
  parent: PublishedParent;
  /** The latest verdict's estimate of the event; null where it made none. */
  event: PublishedEvent | null;
  /** The event as the row it landed on dates it, as the truth stands at the last run that found the breakup; null where it landed on no row. */
  rowEvent: PublishedRowEvent | null;
  /** The latest verdict's step; null for a confirmation from the pieces alone. */
  step: PublishedStep | null;
  /** The latest verdict's reasons, one per line. */
  reasons: string[];
  /** The reports that count, earliest first. */
  reports: PublishedReport[];
}

/** A verdict merged into a published breakup, as the detector raised it ({@link Verdict}), its instants as ISO strings. */
export interface PublishedVerdict {
  state: PublishedVerdictState;
  raisedAt: string;
  step: PublishedStep | null;
  event: PublishedEvent | null;
  evidence: Record<string, number>;
  reasons: string[];
  /** The bodies the verdict rests on beside the object; empty where none. */
  bodies: number[];
  /** The twins the pieces cannot tell apart, the object named first; empty where none. */
  candidates: number[];
}

/** One published breakup with its whole evidence: the body of `v2/breakups/<id>.json`. */
export interface PublishedBreakup extends PublishedBreakupEntry {
  /** The latest verdict's evidence numbers, by name. */
  evidence: Record<string, number>;
  /** The latest verdict's bodies; empty where none. */
  bodies: number[];
  /** The latest verdict's candidates; empty where none. */
  candidates: number[];
  /** The id of the ground-truth row it landed on (`40258:2026-01-30`); null where it landed on none. */
  row: string | null;
  /** Every suspected and confirmed verdict merged into it, in the order raised. */
  verdicts: PublishedVerdict[];
}

/** `v2/breakups.json`: every published breakup. */
export interface PublishedBreakupsFile {
  version: typeof PUBLISHED_VERSION;
  breakups: PublishedBreakupEntry[];
}

/** `v2/breakups/<id>.json`: one breakup with its whole evidence. */
export interface PublishedBreakupFile extends PublishedBreakup {
  version: typeof PUBLISHED_VERSION;
}

/** `v2/status.json`: the last run that wrote the files. */
export interface PublishedStatusFile {
  version: typeof PUBLISHED_VERSION;
  /** When the job last ran. */
  ranAt: string;
  /** The last day of element sets the replay read, `YYYY-MM-DD`. */
  setsThrough: string;
  /** The frozen detector's name (`confirmed-v10`). */
  detector: string;
  /** The sha256 of the ground truth's file (`data/breakups.json`) the verdicts were landed on, in hex. */
  truthSha256: string;
}
