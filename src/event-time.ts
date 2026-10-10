import { WGS84_E2, WGS84_EQUATORIAL_KM, propagate, readElements, type Elements } from "@orbinauts/engine";
import type { ElementSet } from "./elements.ts";
import type { DetectorParameters } from "./params.ts";

/**
 * When the event happened, from the two sets either side of the step.
 * Before the event the object was on the pre set's orbit; after it, on
 * the post set's. Propagated side by side, the two orbits cross where
 * the impulse was applied: the along-track separation of the post orbit
 * from the pre orbit is zero at the event and grows linearly away from
 * it in both directions, since a change of semi-major axis changes the
 * period and the two drift apart by a fixed distance every revolution.
 * So the along-track separation is fitted as a line over a grid from a
 * few hours before the pre set's epoch to the post set's, the line's
 * root is the event's instant, and the root's sigma is the position
 * error of a published set over the line's slope: a small step drifts
 * slowly and is timed coarsely, a large one finely.
 *
 * The separation also oscillates once a revolution, since the two orbits
 * differ in shape as well as period, and their three-dimensional distance
 * has a minimum every revolution where the orbits cross. The event lies
 * at one of those minima; the list of them within the time's sigma is
 * returned so the revolution ambiguity is stated, not hidden.
 *
 * The propagation is the engine's, which gives a ground position; it is
 * turned back into Earth-fixed Cartesian coordinates here, which is
 * enough since both orbits are propagated to the same instant and a
 * separation is the same in any frame at one instant. The along-track
 * direction is the pre orbit's inertial velocity, from the chord to the
 * next grid point with the Earth's rotation added back.
 *
 * The grid is a minute, which resolves an event to its revolution; where
 * the span between the two sets is long (sets days apart in a highly
 * elliptical orbit) the step is widened so one alert costs a bounded
 * number of propagations, which the result records.
 */

const DAY_MS = 86_400_000;
/** The Earth's rotation rate, in radians a second: added back to an Earth-fixed velocity for the inertial one. Physical. */
export const EARTH_ROTATION_RAD_PER_S = 7.292115e-5;

export interface Minimum {
  /** The instant of the minimum of the three-dimensional distance, in milliseconds since 1970, and the distance, in kilometres. */
  at: number;
  distanceKm: number;
}

export interface EventTime {
  /** The event's instant, in milliseconds since 1970, and the window of two sigmas either side, clipped to the grid. */
  at: number;
  from: number;
  to: number;
  /** The sigma of the instant, in minutes. */
  sigmaMinutes: number;
  /** The along-track drift between the two orbits, in kilometres an hour, and the scatter of the separation about the line, in kilometres. */
  slopeKmPerHour: number;
  residualKm: number;
  /** The per-revolution minima of the distance within three sigmas of the instant, and how many lie within two: the revolutions the event could be on. */
  minima: Minimum[];
  ambiguousRevolutions: number;
  /** The grid step used, in seconds, and how many points were propagated. */
  gridSeconds: number;
  points: number;
  /** Whether the line had no usable slope (the step left the period alone), in which case the instant is the deepest minimum and the sigma half a period. */
  fromMinimum: boolean;
}

/** The engine's elements for a light row; null where the engine cannot propagate the set. */
export function elementsOf(set: ElementSet): Elements | null {
  try {
    return readElements({
      OBJECT_NAME: "",
      OBJECT_ID: set.designator ?? "",
      EPOCH: new Date(set.epochMs).toISOString(),
      MEAN_MOTION: set.meanMotion,
      ECCENTRICITY: set.eccentricity,
      INCLINATION: set.inclinationDeg,
      RA_OF_ASC_NODE: set.raanDeg,
      ARG_OF_PERICENTER: set.argpDeg,
      MEAN_ANOMALY: set.meanAnomalyDeg,
      EPHEMERIS_TYPE: 0,
      CLASSIFICATION_TYPE: "U",
      NORAD_CAT_ID: set.number,
      ELEMENT_SET_NO: set.elementSetNumber,
      REV_AT_EPOCH: 0,
      BSTAR: set.bstar,
      MEAN_MOTION_DOT: set.meanMotionDot,
      MEAN_MOTION_DDOT: set.meanMotionDdot,
    });
  } catch {
    return null;
  }
}

/** A Cartesian position or velocity, in kilometres or kilometres a second. */
export type Vector = [number, number, number];

/** The Earth-fixed Cartesian position of a geodetic point on the WGS84 ellipsoid, in kilometres. */
export function cartesianOf(latitudeDeg: number, longitudeDeg: number, altitudeKm: number): Vector {
  const lat = (latitudeDeg * Math.PI) / 180;
  const lon = (longitudeDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat);
  const n = WGS84_EQUATORIAL_KM / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return [(n + altitudeKm) * Math.cos(lat) * Math.cos(lon), (n + altitudeKm) * Math.cos(lat) * Math.sin(lon), (n * (1 - WGS84_E2) + altitudeKm) * sinLat];
}

function positionAt(elements: Elements, at: number): Vector | null {
  try {
    const p = propagate(elements, new Date(at));
    return cartesianOf(p.latitude, p.longitude, p.altitude);
  } catch {
    return null;
  }
}

/**
 * The event's time from the last set before the step and the first after
 * it; null where either set cannot be propagated or the post set's epoch
 * is not after the pre set's.
 */
export function eventTimeOf(pre: ElementSet, post: ElementSet, params: DetectorParameters): EventTime | null {
  if (!(post.epochMs > pre.epochMs)) return null;
  const before = elementsOf(pre);
  const after = elementsOf(post);
  if (before === null || after === null) return null;
  const start = pre.epochMs - params.eventLeadHours * 3_600_000;
  const end = post.epochMs;
  let gridMs = params.eventGridSeconds * 1000;
  const wanted = Math.floor((end - start) / gridMs) + 1;
  if (wanted > params.eventMaxPoints) gridMs = Math.ceil((end - start) / (params.eventMaxPoints - 1) / gridMs) * gridMs;
  const times: number[] = [];
  for (let t = start; t <= end; t += gridMs) times.push(t);
  const n = times.length;
  if (n < 3) return null;
  const preAt: Vector[] = [];
  const postAt: Vector[] = [];
  for (const t of times) {
    const p = positionAt(before, t);
    const q = positionAt(after, t);
    if (p === null || q === null) return null;
    preAt.push(p);
    postAt.push(q);
  }
  const along = new Float64Array(n);
  const distance = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = preAt[i]!;
    const next = preAt[Math.min(i + 1, n - 1)]!;
    const previous = preAt[i === n - 1 ? n - 2 : i]!;
    const dt = gridMs / 1000;
    // The chord's velocity in the Earth-fixed frame, plus the frame's rotation about the pole: the inertial velocity in the Earth-fixed basis.
    const v: Vector = [(next[0] - previous[0]) / dt - EARTH_ROTATION_RAD_PER_S * p[1], (next[1] - previous[1]) / dt + EARTH_ROTATION_RAD_PER_S * p[0], (next[2] - previous[2]) / dt];
    const speed = Math.hypot(v[0], v[1], v[2]);
    const q = postAt[i]!;
    const d: Vector = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    along[i] = speed > 0 ? (d[0] * v[0] + d[1] * v[1] + d[2] * v[2]) / speed : 0;
    distance[i] = Math.hypot(d[0], d[1], d[2]);
  }
  // The line through the along-track separation, in hours from the grid's middle.
  const t0 = (start + end) / 2;
  let sx = 0;
  let sxx = 0;
  let sy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = (times[i]! - t0) / 3_600_000;
    sx += x;
    sxx += x * x;
    sy += along[i]!;
    sxy += x * along[i]!;
  }
  const det = n * sxx - sx * sx;
  const slope = det === 0 ? 0 : (n * sxy - sx * sy) / det;
  const intercept = (sy - slope * sx) / n;
  let residual2 = 0;
  for (let i = 0; i < n; i++) residual2 += (along[i]! - intercept - slope * ((times[i]! - t0) / 3_600_000)) ** 2;
  const residualKm = Math.sqrt(residual2 / n);
  const minima: Minimum[] = [];
  for (let i = 1; i < n - 1; i++) if (distance[i]! <= distance[i - 1]! && distance[i]! < distance[i + 1]!) minima.push({ at: times[i]!, distanceKm: distance[i]! });
  const periodMs = (DAY_MS / pre.meanMotion);
  const sigmaPositionKm = Math.max(params.eventSigmaPositionKm, residualKm);
  // A slope under the position error per period cannot place the root within a revolution: the deepest minimum stands in.
  const usable = Math.abs(slope) * (periodMs / 3_600_000) > sigmaPositionKm;
  let at: number;
  let sigmaMs: number;
  if (usable) {
    at = t0 - (intercept / slope) * 3_600_000;
    sigmaMs = (sigmaPositionKm / Math.abs(slope)) * 3_600_000;
  } else {
    let deepest = 0;
    for (let i = 1; i < n; i++) if (distance[i]! < distance[deepest]!) deepest = i;
    at = times[deepest]!;
    sigmaMs = periodMs / 2;
  }
  at = Math.max(start, Math.min(end, at));
  const near = minima.filter((m) => Math.abs(m.at - at) <= 3 * sigmaMs);
  return {
    at,
    from: Math.max(start, at - 2 * sigmaMs),
    to: Math.min(end, at + 2 * sigmaMs),
    sigmaMinutes: sigmaMs / 60_000,
    slopeKmPerHour: slope,
    residualKm,
    minima: near,
    ambiguousRevolutions: minima.filter((m) => Math.abs(m.at - at) <= 2 * sigmaMs).length,
    gridSeconds: gridMs / 1000,
    points: n,
    fromMinimum: !usable,
  };
}
