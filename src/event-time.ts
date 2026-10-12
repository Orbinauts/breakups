import { WGS84_E2, WGS84_EQUATORIAL_KM, propagate, readElements, type Elements } from "@orbinauts/engine";
import type { ElementSet } from "./elements.ts";
import { isOn, type DetectorParameters, type LegacyParameters } from "./params.ts";

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

/**
 * The event's time from the pieces, where no step was measured on the
 * parent: every piece was where the parent was at the instant of the
 * breakup, so the pieces' first sets and the parent's set propagated back
 * converge there. In the parent's plane each piece's angle from the
 * parent, measured about the parent's orbit normal, drifts at the
 * difference of their mean motions and passes through zero once a lap;
 * one of those crossings is the event, and with two pieces or more it is
 * the crossing they share, since pieces of different periods lap the
 * parent at different times everywhere else. The search runs on a coarse
 * grid of the angles from `from` to `to` (the first piece's first epoch,
 * which no piece of the event can predate), takes the crossing the pieces
 * agree on best (each piece weighted by its drift rate squared, so the
 * cost is an angle), and refines it on the event-time grid by the least
 * root-mean-square distance of the pieces from the parent in three
 * dimensions. That distance at the instant is the miss: a few kilometres
 * to tens where the propagation back holds, and hundreds or more where the
 * pieces are not this parent's, which is what tells two candidate parents
 * of one launch apart. The sigma is the miss, floored at a published
 * set's position error, over the pieces' speed relative to the parent at
 * the instant. A single piece crosses the parent once a lap, so its
 * crossing with the least miss is taken and the number of crossings
 * within twice that miss is returned: the laps the instant could be on.
 */
export interface PiecesEventTime {
  /** The event's instant, in milliseconds since 1970, and the window of two sigmas either side. */
  at: number;
  from: number;
  to: number;
  /** The sigma of the instant, in minutes. */
  sigmaMinutes: number;
  /** The pieces' root-mean-square distance from the parent at the instant, in kilometres. */
  missKm: number;
  /** How many pieces were timed. */
  pieces: number;
  /** The scatter of the pieces' own crossings about the instant, in minutes, each weighted by its drift rate squared; NaN with one piece. */
  spreadMinutes: number;
  /** The crossings whose miss lies within twice the least: one where two pieces or more agree, more for a single piece whose laps cannot be told apart. */
  crossings: number;
  /** The coarse grid's step, in seconds, and how many points were propagated on it. */
  gridSeconds: number;
  points: number;
  /** Each piece's own crossing of the parent nearest the instant the pieces' angles agree on best, in the order the pieces were given, and the common-origin test's reading of them (`originOf`). */
  pieceCrossings: PieceCrossing[];
  origin: PiecesOrigin;
}

/**
 * One piece's crossing of the parent, for the common-origin test: of the
 * instants its angle from the parent about the parent's orbit normal
 * passes through zero (once a lap, the lap being the synodic period of
 * the two mean motions), the one nearest the instant at which the pieces'
 * angles agree best. A breakup's pieces were all at the parent at the
 * event, so their crossings there coincide but for what the propagation
 * back loses, hours where the first sets are weeks old; the late pieces
 * of an old cloud cross the parent at unrelated phases, so the nearest
 * crossing of each lies anywhere within half its lap of any instant. The
 * deviation is read in hours and as a share of the piece's lap, the
 * latter's chance level being a quarter. The distance from the parent at
 * the crossing is kept, never as a gate: a change of the axis alone
 * leaves a piece that far from the parent radially at every lap.
 */
export interface PieceCrossing {
  number: number;
  /** The instant, in milliseconds since 1970, and the distance there, in kilometres; null and NaN where the piece does not cross the parent in the window or cannot be propagated over it. */
  at: number | null;
  missKm: number;
  /** The piece's first set's epoch, in milliseconds since 1970: its age at the crossing is the span the propagation back covered. */
  firstEpochMs: number;
  /** The piece's lap about the parent, the synodic period of their mean motions, in milliseconds; infinite where they are equal. */
  lapMs: number;
}

/**
 * The common-origin test's reading of the pieces' closest approaches: a
 * real breakup's pieces cross the parent at nearly one instant, spread by
 * what the propagation back loses over the pieces' age; late pieces of an
 * old cloud cross it at instants spread over months, or not at all in the
 * window. The deviations are every piece's distance in hours from the
 * median crossing, a piece that did not cross counted as infinitely far,
 * so a quantile of them is the half-width within which that share of the
 * pieces tried crossed.
 */
export interface PiecesOrigin {
  /** The pieces tried and those that crossed the parent in the window. */
  tried: number;
  timed: number;
  /** The median of the crossings, in milliseconds since 1970; NaN with none. */
  medianAt: number;
  /** The half-width around the median within which half the pieces tried crossed, and three quarters, in hours (the median and the upper-quartile absolute deviation); NaN with fewer than two crossings, infinite where too few crossed. */
  dev50Hours: number;
  dev75Hours: number;
  /** The same half-widths as a share of each piece's lap (the chance level a quarter, the most a half; a piece that did not cross counts as infinitely far); NaN with fewer than two crossings. */
  phase50: number;
  phase75: number;
  /** The robust spread of the crossings, 1.4826 times their median absolute deviation, in hours; NaN with fewer than two. */
  spreadHours: number;
  /** The sigma of the median crossing as an estimate of the event, in minutes: the robust spread times the median's efficiency factor over the root of the crossings' count; NaN with fewer than two. */
  sigmaMinutes: number;
  /** The median of the pieces' ages at the median crossing (their first sets' epochs less it), in days, and of their distances from the parent at their own closest approach, in kilometres; NaN with none. */
  ageDays: number;
  missKm: number;
}

/** The factor that turns the median absolute deviation into a Gaussian sigma: 1/Φ⁻¹(3/4). Physical. */
export const MAD_TO_SIGMA = 1.4826;
/** The standard error of a median of n Gaussian draws is this factor times the sigma over the root of n: the square root of π/2. Physical. */
export const MEDIAN_EFFICIENCY = Math.sqrt(Math.PI / 2);

/** The value at a share of the sorted values, by the nearest rank: the least value that share of them lie at or under. */
function quantileOf(sorted: readonly number[], share: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))]!;
}

/** The common-origin test's reading of the pieces' closest approaches (`PiecesOrigin`). */
export function originOf(crossings: readonly PieceCrossing[]): PiecesOrigin {
  const timed = crossings.filter((c): c is PieceCrossing & { at: number } => c.at !== null);
  const ats = timed.map((c) => c.at).sort((a, b) => a - b);
  const medianAt = ats.length === 0 ? Number.NaN : ats.length % 2 === 1 ? ats[(ats.length - 1) / 2]! : (ats[ats.length / 2 - 1]! + ats[ats.length / 2]!) / 2;
  const deviations = crossings.map((c) => (c.at === null ? Number.POSITIVE_INFINITY : Math.abs(c.at - medianAt) / 3_600_000)).sort((a, b) => a - b);
  const timedDeviations = timed.map((c) => Math.abs(c.at - medianAt) / 3_600_000).sort((a, b) => a - b);
  const phases = crossings.map((c) => (c.at === null ? Number.POSITIVE_INFINITY : Number.isFinite(c.lapMs) ? Math.abs(c.at - medianAt) / c.lapMs : 0)).sort((a, b) => a - b);
  const few = timed.length < 2;
  const spreadHours = few ? Number.NaN : MAD_TO_SIGMA * quantileOf(timedDeviations, 0.5);
  const middle = (values: number[]): number => {
    if (values.length === 0) return Number.NaN;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  };
  return {
    tried: crossings.length,
    timed: timed.length,
    medianAt,
    dev50Hours: few ? Number.NaN : quantileOf(deviations, 0.5),
    dev75Hours: few ? Number.NaN : quantileOf(deviations, 0.75),
    phase50: few ? Number.NaN : quantileOf(phases, 0.5),
    phase75: few ? Number.NaN : quantileOf(phases, 0.75),
    spreadHours,
    sigmaMinutes: few ? Number.NaN : (MEDIAN_EFFICIENCY * spreadHours * 60) / Math.sqrt(timed.length),
    ageDays: middle(timed.map((c) => (c.firstEpochMs - c.at) / 86_400_000)),
    missKm: middle(timed.map((c) => c.missKm)),
  };
}

/**
 * The half-width, in hours, within which the parameter's share of the
 * pieces must cross the parent around their median for a common origin:
 * a base for the timing of a fresh set, and an allowance per day of the
 * pieces' age at the crossing, since SGP4 run backwards loses the
 * along-track position, and with it the crossing, as the drag it
 * mispredicts accumulates.
 */
export function originBoundHours(origin: Pick<PiecesOrigin, "ageDays">, params: Pick<LegacyParameters, "originHoursBase" | "originHoursPerDay">): number {
  return params.originHoursBase + params.originHoursPerDay * Math.max(0, Number.isFinite(origin.ageDays) ? origin.ageDays : 0);
}

/** The deviation the common-origin test reads at the parameter's share: the half-width within which that share of the pieces tried crossed. */
export function originDeviationHours(origin: Pick<PiecesOrigin, "dev50Hours" | "dev75Hours">, share: number): number {
  return share <= 0.5 ? origin.dev50Hours : origin.dev75Hours;
}

/** Whether the pieces share an origin closely enough to override the rules that read a launch's history as an old cloud: at least the parameter's count crossing the parent, three quarters of those tried within the parameter's hours of their median. */
export function overridesHistory(origin: PiecesOrigin, params: Pick<DetectorParameters, "originOverrideHours" | "originOverrideMinPieces">): boolean {
  return isOn(params.originOverrideHours) && origin.timed >= params.originOverrideMinPieces && origin.dev75Hours <= params.originOverrideHours;
}

/** Whether the common-origin test is on: a bound in hours or in laps within reach. */
export const originTested = (params: Pick<LegacyParameters, "originHoursBase" | "originPhaseMax">): boolean => isOn(params.originHoursBase) || isOn(params.originPhaseMax);

/**
 * Whether the pieces pass the common-origin test: with at least the
 * parameter's count of them crossing the parent, the share asked crossed
 * within the bound of their median, in hours and as a share of each
 * piece's lap. With fewer the test says nothing and passes, so a single
 * piece is judged by the other rules alone.
 */
export function passesOrigin(origin: PiecesOrigin, params: Pick<LegacyParameters, "originHoursBase" | "originHoursPerDay" | "originShareMin" | "originMinPieces" | "originPhaseMax">): boolean {
  if (!originTested(params) || origin.tried < params.originMinPieces) return true;
  const deviation = originDeviationHours(origin, params.originShareMin);
  const phase = params.originShareMin <= 0.5 ? origin.phase50 : origin.phase75;
  return deviation <= originBoundHours(origin, params) && phase <= params.originPhaseMax;
}

/** The farthest from the Earth's centre a propagated position may lie and still be one, in kilometres: beyond the Moon's distance a propagation has failed without saying so, as SGP4 does for a decayed or wildly fitted set. Physical. */
export const MAX_RADIUS_KM = 400_000;

/** A body's Earth-fixed position at an instant, or null where the engine cannot propagate it there or the position it gives is no position. */
function earthFixedAt(elements: Elements, at: number): Vector | null {
  const r = positionAt(elements, at);
  if (r === null) return null;
  const radius = Math.hypot(r[0], r[1], r[2]);
  return Number.isFinite(radius) && radius > WGS84_EQUATORIAL_KM * 0.9 && radius < MAX_RADIUS_KM ? r : null;
}

const unit = (v: Vector): Vector => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
};
const cross = (a: Vector, b: Vector): Vector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vector, b: Vector): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The parent's orbit normal at an instant, from its position and its inertial velocity in the Earth-fixed basis (the chord over a minute with the Earth's rotation added back). */
function normalAt(elements: Elements, at: number, r: Vector): Vector | null {
  const next = earthFixedAt(elements, at + 60_000);
  if (next === null) return null;
  const v: Vector = [(next[0] - r[0]) / 60 - EARTH_ROTATION_RAD_PER_S * r[1], (next[1] - r[1]) / 60 + EARTH_ROTATION_RAD_PER_S * r[0], (next[2] - r[2]) / 60];
  return unit(cross(r, v));
}

/** The root-mean-square distance of the pieces from the parent at an instant, in kilometres; NaN where any cannot be propagated. */
function missAt(parent: Elements, pieces: readonly Elements[], at: number): number {
  const p = earthFixedAt(parent, at);
  if (p === null) return Number.NaN;
  let sum = 0;
  for (const piece of pieces) {
    const q = earthFixedAt(piece, at);
    if (q === null) return Number.NaN;
    sum += (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
  }
  return Math.sqrt(sum / pieces.length);
}

/** The root-mean-square speed of the pieces relative to the parent at an instant, from their separations a minute apart, in kilometres a minute; zero where any cannot be propagated. */
function relativeSpeedAt(parent: Elements, pieces: readonly Elements[], at: number): number {
  const p0 = earthFixedAt(parent, at);
  const p1 = earthFixedAt(parent, at + 60_000);
  if (p0 === null || p1 === null) return 0;
  let sum = 0;
  for (const piece of pieces) {
    const q0 = earthFixedAt(piece, at);
    const q1 = earthFixedAt(piece, at + 60_000);
    if (q0 === null || q1 === null) return 0;
    sum += (q1[0] - p1[0] - (q0[0] - p0[0])) ** 2 + (q1[1] - p1[1] - (q0[1] - p0[1])) ** 2 + (q1[2] - p1[2] - (q0[2] - p0[2])) ** 2;
  }
  return Math.sqrt(sum / pieces.length);
}


/**
 * The event's time from the parent's set and the pieces' first sets,
 * searched between `from` and `to`; null where the parent cannot be
 * propagated, no piece can, or no piece crosses the parent in the window.
 * The pieces given are the ones timed: the caller bounds how many.
 */
export function eventFromPieces(parentSet: ElementSet, pieceSets: readonly ElementSet[], from: number, to: number, params: DetectorParameters): PiecesEventTime | null {
  if (!(to > from)) return null;
  const parent = elementsOf(parentSet);
  if (parent === null) return null;
  // A piece whose set cannot be propagated over the whole window (decayed, or fitted wildly) is not timed.
  const pieces = pieceSets.map((set) => ({ set, elements: elementsOf(set) })).filter((p): p is { set: ElementSet; elements: Elements } => p.elements !== null && earthFixedAt(p.elements, from) !== null && earthFixedAt(p.elements, to) !== null);
  if (pieces.length === 0) return null;
  let gridMs = params.attributionGridMinutes * 60_000;
  if ((to - from) / gridMs + 1 > params.eventMaxPoints) gridMs = Math.ceil((to - from) / (params.eventMaxPoints - 1) / 60_000) * 60_000;
  const times: number[] = [];
  for (let t = from; t <= to; t += gridMs) times.push(t);
  if (times.length < 2) return null;
  // The angle of each piece from the parent about the parent's orbit normal, unwrapped along the grid.
  const angles = pieces.map(() => new Float64Array(times.length).fill(Number.NaN));
  for (let j = 0; j < times.length; j++) {
    const r = earthFixedAt(parent, times[j]!);
    if (r === null) continue;
    const h = normalAt(parent, times[j]!, r);
    if (h === null) continue;
    pieces.forEach((piece, i) => {
      const q = earthFixedAt(piece.elements, times[j]!);
      if (q !== null) angles[i]![j] = Math.atan2(dot(cross(r, q), h), dot(r, q));
    });
  }
  const crossings: number[][] = angles.map((angle) => {
    const roots: number[] = [];
    let previous = Number.NaN;
    let unwrapped = Number.NaN;
    let previousTime = Number.NaN;
    for (let j = 0; j < times.length; j++) {
      const raw = angle[j]!;
      if (Number.isNaN(raw)) continue;
      const value = Number.isNaN(previous) ? raw : unwrapped + wrapRadians(raw - previous);
      if (!Number.isNaN(previous)) {
        // Every whole turn the unwrapped angle passes between the two grid points is a crossing, placed by linear interpolation.
        const lo = Math.min(unwrapped, value);
        const hi = Math.max(unwrapped, value);
        for (let k = Math.ceil(lo / (2 * Math.PI)); k * 2 * Math.PI <= hi; k++) {
          if (hi === lo) continue;
          const f = (k * 2 * Math.PI - unwrapped) / (value - unwrapped);
          roots.push(previousTime + f * (times[j]! - previousTime));
        }
      }
      previous = raw;
      unwrapped = value;
      previousTime = times[j]!;
    }
    return roots;
  });
  const rates = pieces.map((piece) => Math.abs(piece.set.meanMotion - parentSet.meanMotion) * 2 * Math.PI / DAY_MS);
  const timed = pieces.map((_, i) => i).filter((i) => crossings[i]!.length > 0);
  if (timed.length === 0) return null;
  // The coarse candidates: with two pieces or more, the crossings scored by how well every piece agrees; with one, its laps.
  let candidates: number[];
  if (timed.length >= 2) {
    const cost = (t: number): number => timed.reduce((sum, i) => sum + rates[i]! ** 2 * Math.min(...crossings[i]!.map((r) => (t - r) ** 2)), 0);
    // Each crossing's cost once, not once per comparison: the order is the same.
    const all = timed.flatMap((i) => crossings[i]!);
    const costs = all.map(cost);
    candidates = all.map((_, k) => k).sort((a, b) => costs[a]! - costs[b]!).slice(0, params.eventRefinedCrossings).map((k) => all[k]!);
  } else {
    candidates = crossings[timed[0]!]!.slice(-params.eventRefinedCrossings);
  }
  const used = timed.map((i) => pieces[i]!.elements);
  const fineMs = params.eventGridSeconds * 1000;
  const reach = Math.max(gridMs, params.eventRefineReachMinutes * 60_000);
  const refined = candidates.map((t0) => {
    let best = { at: t0, miss: Number.POSITIVE_INFINITY };
    for (let t = Math.max(from - reach, t0 - reach); t <= Math.min(to, t0 + reach); t += fineMs) {
      const miss = missAt(parent, used, t);
      if (miss < best.miss) best = { at: t, miss };
    }
    return best;
  });
  const order = refined.map((r, i) => i).filter((i) => Number.isFinite(refined[i]!.miss)).sort((a, b) => refined[a]!.miss - refined[b]!.miss);
  if (order.length === 0) return null;
  const best = refined[order[0]!]!;
  // The pieces' speed relative to the parent at the instant, over a minute, for the sigma.
  const speedKmPerMinute = relativeSpeedAt(parent, used, best.at);
  const nearest = timed.map((i) => crossings[i]!.reduce((n, r) => (Math.abs(r - best.at) < Math.abs(n - best.at) ? r : n), Number.POSITIVE_INFINITY));
  const weights = timed.map((i) => rates[i]! ** 2);
  const total = weights.reduce((s, w) => s + w, 0);
  const spreadMinutes = timed.length < 2 || total === 0 ? Number.NaN : Math.sqrt(weights.reduce((s, w, k) => s + w * (nearest[k]! - best.at) ** 2, 0) / total) / 60_000;
  // Where the pieces do not agree (their propagations back drift apart, as a low cloud's first sets weeks old do), their scatter about the instant is its sigma, not the miss over the speed.
  const sigmaMinutes = Math.max(params.eventGridSeconds / 60 / 2, Math.max(best.miss, params.eventSigmaPositionKm) / Math.max(speedKmPerMinute, 1e-6), Number.isFinite(spreadMinutes) ? spreadMinutes : 0);
  const sigmaMs = sigmaMinutes * 60_000;
  // Each piece's crossing nearest the instant the angles agree on best (the coarse search's first candidate; a single piece's best crossing), with its distance from the parent there; a piece with none, or that cannot be propagated over the window, is tried and not timed.
  const anchor = timed.length >= 2 ? candidates[0]! : best.at;
  const pieceCrossings: PieceCrossing[] = pieceSets.map((set) => ({ number: set.number, at: null, missKm: Number.NaN, firstEpochMs: set.epochMs, lapMs: Math.abs(set.meanMotion - parentSet.meanMotion) === 0 ? Number.POSITIVE_INFINITY : DAY_MS / Math.abs(set.meanMotion - parentSet.meanMotion) }));
  pieces.forEach((piece, i) => {
    const roots = crossings[i]!;
    if (roots.length === 0) return;
    const at = roots.reduce((n, r) => (Math.abs(r - anchor) < Math.abs(n - anchor) ? r : n), roots[0]!);
    const slot = pieceCrossings[pieceSets.indexOf(piece.set)]!;
    slot.at = at;
    slot.missKm = missAt(parent, [piece.elements], at);
  });
  return {
    at: best.at,
    from: best.at - 2 * sigmaMs,
    to: best.at + 2 * sigmaMs,
    sigmaMinutes,
    missKm: best.miss,
    pieces: timed.length,
    spreadMinutes,
    crossings: timed.length >= 2 ? 1 : order.filter((i) => refined[i]!.miss <= 2 * best.miss).length,
    gridSeconds: gridMs / 1000,
    points: times.length,
    pieceCrossings,
    origin: originOf(pieceCrossings),
  };
}

const wrapRadians = (a: number): number => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
