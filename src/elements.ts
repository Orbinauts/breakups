import { GEOSTATIONARY_MEAN_MOTION, GEOSYNCHRONOUS_MEAN_MOTION_WINDOW, HIGHLY_ELLIPTICAL_MIN_ECCENTRICITY, LOW_EARTH_ORBIT_KM, WGS84_EQUATORIAL_KM, semiMajorAxisKm, type Elements } from "@orbinauts/engine";
import type { BodyClass, Regime } from "./truth.ts";

/**
 * The element set as the detector reads it: one published set of one
 * object, stripped to the numbers a breakup shows in and the two that say
 * when it was known. It is deliberately a light row rather than the
 * engine's `Elements`, which carries the whole message and a parsed epoch:
 * a replay over twenty years hands the detector a hundred million of these,
 * and a run in production a few hundred thousand, so each is a flat object
 * of numbers that costs nothing to build and nothing to keep.
 *
 * The units are the message's own: revolutions a day, degrees, inverse
 * Earth radii for the drag term, revolutions a day squared and cubed for
 * the mean-motion derivatives as the two-line format prints them (half the
 * first derivative, a sixth of the second). Times are milliseconds since
 * 1970, as `Date.getTime` gives them, so a caller subtracts them without a
 * conversion.
 */
export interface ElementSet {
  /** The catalogue number. */
  number: number;
  /** The international designator (`1998-067A`); null for an object the catalogue has not designated (an analyst object). */
  designator: string | null;
  /** The epoch of the set, in milliseconds since 1970. */
  epochMs: number;
  /**
   * When the catalogue published the set, in milliseconds since 1970; null
   * where that is not known (the yearly bundles keep the order of
   * publication but not its time), in which case the epoch is the earliest
   * the set can have been published.
   */
  createdMs: number | null;
  /** Revolutions a day. */
  meanMotion: number;
  eccentricity: number;
  /** Degrees. */
  inclinationDeg: number;
  /** The right ascension of the ascending node, in degrees. */
  raanDeg: number;
  /** The argument of perigee, in degrees. */
  argpDeg: number;
  /** Degrees. */
  meanAnomalyDeg: number;
  /** The drag term, in inverse Earth radii. */
  bstar: number;
  /** Half the first derivative of the mean motion, in revolutions a day squared. */
  meanMotionDot: number;
  /** A sixth of the second derivative of the mean motion, in revolutions a day cubed. */
  meanMotionDdot: number;
  /** The set's number in the catalogue's own sequence for the object, which wraps at 9999. */
  elementSetNumber: number;
  /** What the catalogue says the object is; `unknown` where it says nothing. */
  bodyClass: BodyClass;
  /** What the satellite catalogue says of the object's operational status, where the caller has it; absent or `unknown` where it says nothing. It is the status as of the catalogue snapshot the caller read, which for a backtest is today's, not the set's day: the detector reads it as evidence under that caveat. */
  opsStatus?: OpsStatus;
  /**
   * The instant by which the object had fallen silent for good, its owners'
   * last contact, in milliseconds since 1970, as a dated source gives it
   * (GCAT's end of transmission for a payload: the midnight after the last day its stated end may fall on);
   * null or absent where the caller has no date, which is every rocket body
   * and piece of debris and every payload believed still in contact. Unlike
   * `opsStatus` it says when, so the detector reads it as of the step
   * (`operationalAt`).
   */
  endedByMs?: number | null;
  /** The instant from which the object may have fallen silent, the start of the first day its stated end may fall on (GCAT's dates are vague: `1998?` spans 1997 to 1999); null or absent with `endedByMs`, or where the end is a single day. */
  endedFromMs?: number | null;
  /** The object's launch, in milliseconds since 1970 (the launch day's midnight), as the satellite catalogue gives it; null or absent where the caller has none. The scope reads the object's age from it (`scope.ts`). */
  launchedMs?: number | null;
}

/**
 * The operational status of an object as the satellite catalogue codes
 * it: working (`+`), partially working (`P`), a backup (`B`) or a spare
 * (`S`), on an extended mission (`X`), nonoperational (`-`), decayed
 * (`D`), or nothing said (blank, which is every piece of debris and most
 * rocket bodies). The detector folds these into three readings: an
 * object that works today could have burned at the step, one that is
 * nonoperational today may not have been able to, and the rest say
 * nothing. A decayed object says nothing either: that it has since fallen
 * does not say whether it worked at the step.
 */
export const OPS_STATUSES = ["operational", "partially operational", "backup", "spare", "extended mission", "nonoperational", "decayed", "unknown"] as const;
export type OpsStatus = (typeof OPS_STATUSES)[number];

/** The status a catalogue code stands for; `unknown` for a blank, a null or an unrecognised code. */
export function opsStatusOf(code: string | null | undefined): OpsStatus {
  switch (code?.trim()) {
    case "+":
      return "operational";
    case "P":
      return "partially operational";
    case "B":
      return "backup";
    case "S":
      return "spare";
    case "X":
      return "extended mission";
    case "-":
      return "nonoperational";
    case "D":
      return "decayed";
    default:
      return "unknown";
  }
}

/** Whether the status says the object works today, in any of the catalogue's working grades. */
export const isWorkingStatus = (status: OpsStatus | undefined): boolean => status === "operational" || status === "partially operational" || status === "backup" || status === "spare" || status === "extended mission";

const DAY_MS = 86_400_000;

/**
 * The object's operational status at an instant, as the detector reads it
 * for a step there. Read as of today (the parameter off), it is the
 * caller's status, today's for a backtest, hindsight and all. Read as of
 * the step (on), it is dated where the caller gives the window the
 * object's end of contact falls in (the last time its owners could
 * command it): a step more than `endedUnknownDays` before the window's
 * first day is a commanded satellite's, so it reads `operational` (it
 * could have burned); a step more than that after the window's last day
 * is a dead one's, `nonoperational`; and a step within that margin of the
 * window reads `unknown`, since the end of a satellite that broke up is
 * often the breakup itself (GCAT dates Hitomi's to the day of it and
 * Orbcomm FM16's to the month), so an end that close to the step may be
 * the step's consequence. With no date, a status that says
 * the object works today is kept (a satellite working today was working
 * at any step of its life) and every other reads `unknown`: a satellite
 * nonoperational or decayed today with no dated end may have worked at
 * the step.
 */
export function operationalAt(set: Pick<ElementSet, "opsStatus" | "endedByMs" | "endedFromMs">, atMs: number, params: { opsStatusDated: boolean; endedUnknownDays: number }): OpsStatus {
  const today = set.opsStatus ?? "unknown";
  if (!params.opsStatusDated) return today;
  const by = set.endedByMs;
  if (by === null || by === undefined) return isWorkingStatus(today) ? today : "unknown";
  const from = set.endedFromMs ?? by - DAY_MS;
  const margin = params.endedUnknownDays * DAY_MS;
  if (atMs + margin < from) return "operational";
  if (atMs - margin >= by) return "nonoperational";
  return "unknown";
}

/** The instant by which the object had fallen silent, from the last day the end may fall on (an ISO day): the midnight after it; null for null. */
export function endedByOf(endedOn: string | null | undefined): number | null {
  const day = dayOf(endedOn);
  return day === null ? null : day + DAY_MS;
}

/** The midnight that starts an ISO day, in milliseconds since 1970; null for null or an empty string. */
export function dayOf(day: string | null | undefined): number | null {
  if (day === null || day === undefined || day === "") return null;
  const ms = Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(ms)) throw new Error(`not a day: ${day}`);
  return ms;
}

/** What a caller knows of the object beyond its message: when the set was published, and what the object is. */
export interface SetContext {
  createdMs?: number | null;
  bodyClass?: BodyClass;
  /** The catalogue's operational status code, or the status itself. */
  opsStatus?: OpsStatus | string | null;
  /** The last and the first day the object's end of contact may fall on, as ISO days (GCAT's end of transmission for a payload); null where none is dated. */
  endedOn?: string | null;
  endedFrom?: string | null;
  /** The launch day, as an ISO day; null where unknown. */
  launchedOn?: string | null;
}

/**
 * The light row of the engine's `Elements`, for a caller that reads a
 * message with `readElements` or `readTwoLineElements` and has no other
 * store. The designator is null where the message prints none, as the
 * two-line format does for an analyst object.
 */
export function fromElements(elements: Elements, context: SetContext = {}): ElementSet {
  const omm = elements.omm;
  return {
    number: elements.catalogueNumber,
    designator: omm.OBJECT_ID === "" ? null : omm.OBJECT_ID,
    epochMs: elements.epoch.getTime(),
    createdMs: context.createdMs ?? null,
    meanMotion: omm.MEAN_MOTION,
    eccentricity: omm.ECCENTRICITY,
    inclinationDeg: omm.INCLINATION,
    raanDeg: omm.RA_OF_ASC_NODE,
    argpDeg: omm.ARG_OF_PERICENTER,
    meanAnomalyDeg: omm.MEAN_ANOMALY,
    bstar: omm.BSTAR,
    meanMotionDot: omm.MEAN_MOTION_DOT,
    meanMotionDdot: omm.MEAN_MOTION_DDOT,
    elementSetNumber: omm.ELEMENT_SET_NO,
    bodyClass: context.bodyClass ?? "unknown",
    opsStatus: (OPS_STATUSES as readonly string[]).includes(context.opsStatus ?? "") ? (context.opsStatus as OpsStatus) : opsStatusOf(context.opsStatus),
    endedByMs: endedByOf(context.endedOn),
    endedFromMs: dayOf(context.endedFrom),
    launchedMs: dayOf(context.launchedOn),
  };
}

/** The earliest the set can have been published: its publication time where known, else its epoch. */
export function publishedNoEarlierThan(set: Pick<ElementSet, "epochMs" | "createdMs">): number {
  return set.createdMs ?? set.epochMs;
}

/** The semi-major axis of the set's orbit, in kilometres, by Kepler's third law from the mean motion alone. */
export function semiMajorAxisOf(set: Pick<ElementSet, "meanMotion">): number {
  return semiMajorAxisKm(set.meanMotion);
}

/** The heights of the two ends of the orbit above the equatorial radius, in kilometres, from the mean elements alone. */
export function apsidesOf(set: Pick<ElementSet, "meanMotion" | "eccentricity">): { perigeeKm: number; apogeeKm: number } {
  const a = semiMajorAxisKm(set.meanMotion);
  return { perigeeKm: a * (1 - set.eccentricity) - WGS84_EQUATORIAL_KM, apogeeKm: a * (1 + set.eccentricity) - WGS84_EQUATORIAL_KM };
}

/**
 * The regime the detector files the set under, which is also how the
 * scorecard breaks its cells down: the four the ground truth uses, with the
 * engine's own bounds. Geosynchronous first, within the engine's window of
 * a tenth of a revolution a day either side of a sidereal day's rate and
 * not eccentric past a tenth; then highly elliptical, from the engine's
 * eccentricity bound; then low, when the apogee stays under the engine's
 * ceiling; and medium for everything between. The engine's inclined
 * geosynchronous class is folded into GEO, as the truth folds it, since a
 * breakup there leaves the same sparse trace.
 */
export function regimeOf(set: Pick<ElementSet, "meanMotion" | "eccentricity">): Regime {
  if (Math.abs(set.meanMotion - GEOSTATIONARY_MEAN_MOTION) <= GEOSYNCHRONOUS_MEAN_MOTION_WINDOW && set.eccentricity < GEOSYNCHRONOUS_MAX_ECCENTRICITY) return "GEO";
  if (set.eccentricity >= HIGHLY_ELLIPTICAL_MIN_ECCENTRICITY) return "HEO";
  return apsidesOf(set).apogeeKm < LOW_EARTH_ORBIT_KM ? "LEO" : "MEO";
}

/** An orbit round once a day but eccentric past this is a transfer or a Tundra-like orbit, not a station: it is filed by its eccentricity. */
export const GEOSYNCHRONOUS_MAX_ECCENTRICITY = 0.1;
