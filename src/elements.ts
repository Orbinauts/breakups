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
}

/** What a caller knows of the object beyond its message: when the set was published, and what the object is. */
export interface SetContext {
  createdMs?: number | null;
  bodyClass?: BodyClass;
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
