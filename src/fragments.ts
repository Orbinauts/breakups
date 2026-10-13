import { semiMajorAxisOf, type ElementSet } from "./elements.ts";
import { DEG, MU_KM3_PER_S2, speedAt } from "./impulse.ts";
import { median } from "./model.ts";
import type { DetectorParameters } from "./params.ts";
import { nodePrecessionDegPerDay } from "./series.ts";
import { newLedger, type StepLedger } from "./siblings.ts";
import { launchOf, type BodyClass } from "./truth.ts";
import { DAY_MS, wrapDegrees } from "./units.ts";

/**
 * The per-launch channel: what the catalogue says about a launch by the
 * bodies it lists under it. A breakup's fragments are catalogued under
 * the parent's launch, numbered above every object that existed at the
 * event, with their first element sets days to weeks after it, in the
 * parent's orbital plane, spread in period about the parent's as a
 * Gabbard diagram shows. The channel keeps, per launch, every body seen
 * with its first set's epoch, when the detector first saw it, and the
 * orbit of that first set; and, catalogue-wide, the high-water mark of
 * designated catalogue numbers against time. From these it reads four
 * things on a run that brings a launch new bodies:
 *
 * - a burst over the launch's own background: the count of new bodies in
 *   the sliding window against a Poisson rate read off the year before
 *   it, floored, so a big old cloud whose late pieces trickle in at tens
 *   a month is not read as a new event when a batch arrives, while five
 *   new pieces under a launch that gained none in a year is;
 * - the numbering: a body numbered at or below the high-water mark at the
 *   alleged event existed before it and is a returning old body, not a
 *   piece; and a body with any set before the event is not a piece;
 * - the plane: a piece's inclination and node against each candidate
 *   parent's, the node adjusted for each orbit's own J2 precession from
 *   the event to the piece's first set, as a distance in units of the
 *   tolerances; pieces within the bound share the parent's plane;
 * - the cloud's velocity and spread: the median change of semi-major axis
 *   of the consistent pieces from the parent's, read as a tangential
 *   impulse in metres a second, and the range of their semi-major axes.
 *   A rideshare's satellites leave their dispenser at under a metre a
 *   second and are classed payloads; fragments are classed debris and
 *   spread over tens of metres a second or more.
 *
 * None of this is a detection: it is the catalogue's own report, read
 * back, and it confirms a parent's step or lists a cloud for review. The
 * analyst objects (numbered from eighty thousand, and from two hundred
 * and seventy thousand) have no designator, so they go to a pseudo-launch
 * each; their numbers are reused, so neither the mark nor the first set
 * says anything of them, and they are listed, never confirming.
 */

/** The first analyst range and the second, by catalogue number. Physical: the catalogue's own conventions. */
export const ANALYST_FLOOR = 80_000;
export const ANALYST_SECOND_FLOOR = 270_000;
/** How many months of new-body counts a launch keeps. Policy: two years, the reach of the object's own history. */
export const LAUNCH_MONTHS = 24;
/** The reserved key under which the catalogue-wide state (the high-water mark, the notices applied) is kept in the launches map: no launch designator reads so. */
export const CATALOGUE_KEY = "catalogue";
/** How far back the high-water mark's record reaches, in days: two years, beyond which one entry stands for all that came before. Policy. */
export const MARK_DAYS = 730;

/** One body seen under a launch: when it was first seen and the orbit of its first set. */
export interface BodyRecord {
  number: number;
  /** The run's instant when the detector first saw a set of it, in milliseconds since 1970: the earliest it is known to have been published. */
  firstSeenAt: number;
  /** The epoch of that first set, and the earliest epoch any set of it carried, which an older set slotted in later lowers. */
  firstEpoch: number;
  minEpoch: number;
  /** The orbit of the first set: semi-major axis in kilometres, eccentricity, inclination and node in degrees, mean motion in revolutions a day. */
  aKm: number;
  eccentricity: number;
  inclinationDeg: number;
  raanDeg: number;
  meanMotion: number;
  bodyClass: BodyClass;
}

/** What the detector keeps of one launch between runs. */
export interface LaunchRecord {
  key: string;
  /** Every body seen under it, in the order first seen. */
  bodies: BodyRecord[];
  /** When the first body was first seen: the launch's age is read from here, since the designator gives the year alone. */
  firstSeenAt: number;
  /** New bodies by month over the last two years: the count per bin and the month (years since 1970 times twelve plus the month) each bin stands for. */
  monthCounts: number[];
  monthOf: number[];
  /** When the launch was last listed for review, so a cloud whose pieces keep coming is listed once. */
  lastCloudAt: number;
  /** The launch's cloud memory: when a burst with consistent pieces was last judged under it or an alert on one of its bodies was last confirmed by pieces, and the event instant that cloud's nodes are carried from. A later alert under the launch is confirmed only by pieces this cloud cannot account for, for the policy's memory. */
  lastCloudBurstAt: number;
  lastCloudEventMs: number;
  /** When a cloud under the launch was last named for a parent (a confirmation of an alert by pieces, or an attribution), and the event instant it was carried from; absent on a record written before the attribution existed, or where none was. A burst nobody was named for is remembered as a cloud too, and the attribution reads it apart (`attributionUnnamedGraceDays`). */
  lastNamedAt?: number;
  lastNamedEventMs?: number;
}

/** The catalogue-wide state: the high-water mark of designated numbers against time, and the notices already applied. */
export interface CatalogueRecord {
  key: typeof CATALOGUE_KEY;
  /** The record of new maxima: when each was first seen and the number, both ascending. */
  markAt: number[];
  markNumber: number[];
  /** The notices applied, as `number:at` or `launch:at`. */
  noticesApplied: string[];
  /** The objects with an open alert, by number, so a run finds them without walking every state. */
  alerted: number[];
  /** The objects with a live candidate, by number, so a run counts and lapses them without walking every state; absent in a record written before the list existed, and listed afresh from the states then. */
  candidates?: number[];
  /** The instant of the first run, in milliseconds since 1970: every body the detector meets in its first window is new to it, so no launch is judged until the window has passed. */
  startedAt: number;
  /** The persistent steps of the last weeks, every object's, for the siblings test; absent in a record written before the ledger existed. */
  ledger?: StepLedger;
}

/** The launch a set is filed under: its designator's launch, a pseudo-launch for an analyst object, or null where neither applies. */
export function launchKeyOf(set: Pick<ElementSet, "number" | "designator">): string | null {
  const launch = launchOf(set.designator);
  if (launch !== null) return launch;
  if (set.number >= ANALYST_SECOND_FLOOR) return `analyst-${ANALYST_SECOND_FLOOR}`;
  if (set.number >= ANALYST_FLOOR) return `analyst-${ANALYST_FLOOR}`;
  return null;
}

export const isAnalystLaunch = (key: string): boolean => key.startsWith("analyst-");

/** The launch as a number for the log: the year times a thousand plus the launch number, or the analyst range's floor. */
export function launchCodeOf(key: string): number {
  if (isAnalystLaunch(key)) return Number(key.slice("analyst-".length));
  return Number(key.slice(0, 4)) * 1000 + Number(key.slice(5, 8));
}

export function newLaunch(key: string): LaunchRecord {
  return { key, bodies: [], firstSeenAt: Number.POSITIVE_INFINITY, monthCounts: new Array<number>(LAUNCH_MONTHS).fill(0), monthOf: new Array<number>(LAUNCH_MONTHS).fill(Number.NEGATIVE_INFINITY), lastCloudAt: Number.NEGATIVE_INFINITY, lastCloudBurstAt: Number.NEGATIVE_INFINITY, lastCloudEventMs: Number.NaN };
}

/** Records a cloud under the launch: a burst with consistent pieces, or a confirmation by pieces, at the run's instant, with the event instant its nodes are carried from. */
export function noteCloud(launch: LaunchRecord, now: number, eventMs: number, named = false): void {
  launch.lastCloudBurstAt = now;
  launch.lastCloudEventMs = eventMs;
  if (named) {
    launch.lastNamedAt = now;
    launch.lastNamedEventMs = eventMs;
  }
}

export function newCatalogue(): CatalogueRecord {
  return { key: CATALOGUE_KEY, markAt: [], markNumber: [], noticesApplied: [], alerted: [], startedAt: Number.POSITIVE_INFINITY, ledger: newLedger() };
}

/** The catalogue's step ledger, made where the record was written before it existed. */
export function ledgerOf(catalogue: CatalogueRecord): StepLedger {
  if (catalogue.ledger === undefined) catalogue.ledger = newLedger();
  return catalogue.ledger;
}

/** The launch's record in the map, made where missing. */
export function launchFor(launches: Map<string, unknown>, key: string): LaunchRecord {
  let record = launches.get(key) as LaunchRecord | undefined;
  if (record === undefined) {
    record = newLaunch(key);
    launches.set(key, record);
  } else if (record.lastCloudBurstAt === undefined) {
    // A record written before the cloud memory existed: no cloud remembered.
    record.lastCloudBurstAt = Number.NEGATIVE_INFINITY;
    record.lastCloudEventMs = Number.NaN;
  }
  return record;
}

export function catalogueFor(launches: Map<string, unknown>): CatalogueRecord {
  let record = launches.get(CATALOGUE_KEY) as CatalogueRecord | undefined;
  if (record === undefined) {
    record = newCatalogue();
    launches.set(CATALOGUE_KEY, record);
  }
  return record;
}

const monthIndexOf = (ms: number): number => {
  const date = new Date(ms);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
};

/**
 * Notes a body under its launch on the first set of it the detector
 * sees, and the catalogue-wide mark where it is a designated number
 * above every one seen. Returns the record where the body is new to the
 * launch, null where it was already there (an older set of it slotted in
 * only lowers its earliest epoch).
 */
export function noteBody(launches: Map<string, unknown>, set: ElementSet, now: number): BodyRecord | null {
  const key = launchKeyOf(set);
  if (key === null) return null;
  const launch = launchFor(launches, key);
  const known = launch.bodies.find((b) => b.number === set.number);
  if (known !== undefined) {
    if (set.epochMs < known.minEpoch) known.minEpoch = set.epochMs;
    return null;
  }
  const record: BodyRecord = { number: set.number, firstSeenAt: now, firstEpoch: set.epochMs, minEpoch: set.epochMs, aKm: semiMajorAxisOf(set), eccentricity: set.eccentricity, inclinationDeg: set.inclinationDeg, raanDeg: set.raanDeg, meanMotion: set.meanMotion, bodyClass: set.bodyClass };
  launch.bodies.push(record);
  if (now < launch.firstSeenAt) launch.firstSeenAt = now;
  const month = monthIndexOf(now);
  const bin = ((month % LAUNCH_MONTHS) + LAUNCH_MONTHS) % LAUNCH_MONTHS;
  if (launch.monthOf[bin] !== month) {
    launch.monthOf[bin] = month;
    launch.monthCounts[bin] = 0;
  }
  launch.monthCounts[bin]!++;
  // The mark is the designated numbers' below the analyst ranges: a designated body numbered in or above them (a re-designated analyst object) would lift it over every piece catalogued after it, as one did in 2020.
  if (!isAnalystLaunch(key) && set.number < ANALYST_FLOOR) noteMark(catalogueFor(launches), set.number, now);
  return record;
}

/** Records a new maximum of the designated numbers, and prunes the record to its reach. */
export function noteMark(catalogue: CatalogueRecord, number: number, now: number): void {
  const last = catalogue.markNumber.length === 0 ? 0 : catalogue.markNumber[catalogue.markNumber.length - 1]!;
  if (number <= last) return;
  catalogue.markAt.push(now);
  catalogue.markNumber.push(number);
  const oldest = now - MARK_DAYS * DAY_MS;
  let drop = 0;
  while (drop + 1 < catalogue.markAt.length && catalogue.markAt[drop + 1]! < oldest) drop++;
  if (drop > 0) {
    catalogue.markAt.splice(0, drop);
    catalogue.markNumber.splice(0, drop);
  }
}

/**
 * The highest designated number first seen before the instant; zero where
 * none was. The mark is indexed by the instant a body was first published
 * (the run that first saw it), and `judgeCloud` queries it with the
 * event's instant, an epoch: both are instants on one clock, so the query
 * reads the numbers the catalogue had handed out by the time the event
 * happened, and a piece of the event, published after it whatever its
 * lag, is above it. Queried at the window's start (`now - window`)
 * instead, a body published between the event and the window with a
 * number above some of the event's pieces (numbers are handed out when a
 * body is catalogued, not when it is published) would lift the mark over
 * them, and they would read as returning old bodies.
 */
export function markAt(catalogue: CatalogueRecord, at: number): number {
  let lo = 0;
  let hi = catalogue.markAt.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (catalogue.markAt[mid]! < at) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? 0 : catalogue.markNumber[lo - 1]!;
}

/** What the plane test reads of an orbit, at an epoch. */
export interface PlaneOrbit {
  epochMs: number;
  aKm: number;
  eccentricity: number;
  inclinationDeg: number;
  raanDeg: number;
  meanMotion: number;
}

export const planeOrbitOf = (body: BodyRecord): PlaneOrbit => ({ epochMs: body.firstEpoch, aKm: body.aKm, eccentricity: body.eccentricity, inclinationDeg: body.inclinationDeg, raanDeg: body.raanDeg, meanMotion: body.meanMotion });

export interface PlaneDistance {
  /** The inclination difference, in degrees. */
  deltaInclinationDeg: number;
  /** The node difference at the piece's epoch, the parent's node carried there at its own J2 rate and the rates' difference since the event taken off, in degrees. */
  deltaNodeDeg: number;
  /** The distance in units of the tolerances; infinite where the piece's set is too far from the event to carry the node. */
  distance: number;
}

/**
 * How far a piece's plane is from a parent's. Both were on one plane at
 * the event; since then each node has precessed at its own J2 rate, so
 * the parent's node is carried to the piece's epoch at the parent's
 * rate, and the difference of the two rates over the time from the event
 * to the piece's set is taken off. A piece catalogued longer after the
 * event than the parameter allows is not tested.
 */
export function planeDistance(parent: PlaneOrbit, piece: PlaneOrbit, eventMs: number, params: Pick<DetectorParameters, "planeInclinationToleranceDeg" | "planeNodeToleranceDeg" | "planeMaxDays">, limitDays = params.planeMaxDays): PlaneDistance {
  const deltaInclinationDeg = piece.inclinationDeg - parent.inclinationDeg;
  const deltaNodeDeg = carriedNodeDifferenceDeg(parent, piece, eventMs);
  const sinceEvent = (piece.epochMs - eventMs) / DAY_MS;
  const distance = Math.abs(sinceEvent) > limitDays ? Number.POSITIVE_INFINITY : Math.hypot(deltaInclinationDeg / params.planeInclinationToleranceDeg, deltaNodeDeg / params.planeNodeToleranceDeg);
  return { deltaInclinationDeg, deltaNodeDeg, distance };
}

/** The node difference at the piece's epoch, the parent's node carried there at its own J2 rate and the rates' difference since the event taken off, in degrees. */
function carriedNodeDifferenceDeg(parent: PlaneOrbit, piece: PlaneOrbit, eventMs: number): number {
  const parentRate = nodePrecessionDegPerDay(parent.aKm, parent.eccentricity, parent.inclinationDeg, parent.meanMotion);
  const pieceRate = nodePrecessionDegPerDay(piece.aKm, piece.eccentricity, piece.inclinationDeg, piece.meanMotion);
  const sinceParent = (piece.epochMs - parent.epochMs) / DAY_MS;
  const sinceEvent = (piece.epochMs - eventMs) / DAY_MS;
  const parentNodeAtPiece = parent.raanDeg + parentRate * sinceParent;
  return wrapDegrees(piece.raanDeg - parentNodeAtPiece - (pieceRate - parentRate) * sinceEvent);
}

/**
 * The angle between a piece's orbit normal and a parent's, in degrees,
 * the parent's node carried to the piece's epoch as `planeDistance`
 * carries it, with no limit on the time since the event. Unlike the plane
 * distance it holds at near-zero inclination, where the node is undefined
 * and pieces in the parent's plane scatter over the whole circle of nodes:
 * there every normal lies near the pole, and so near the parent's.
 */
export function normalAngleDeg(parent: PlaneOrbit, piece: PlaneOrbit, eventMs: number): number {
  const deltaNodeRad = carriedNodeDifferenceDeg(parent, piece, eventMs) * DEG;
  const [i1, i2] = [parent.inclinationDeg * DEG, piece.inclinationDeg * DEG];
  // The normals in a frame whose first axis is the parent's node: (0, -sin i1, cos i1) and (sin i2 sin dN, -sin i2 cos dN, cos i2), dN the node difference.
  const [bx, by, bz] = [Math.sin(i2) * Math.sin(deltaNodeRad), -Math.sin(i2) * Math.cos(deltaNodeRad), Math.cos(i2)];
  const [ay, az] = [-Math.sin(i1), Math.cos(i1)];
  const cross = Math.hypot(ay * bz - az * by, az * bx, -ay * bx);
  const dot = ay * by + az * bz;
  return Math.atan2(cross, dot) / DEG;
}

/**
 * The detector's plane test, as a distance in units of the tolerances:
 * `planeDistance`'s, or, where the angle between the two orbits' normals
 * is within `planeNormalAngleMaxDeg`, that angle scaled so the bound falls
 * at `planeDistanceMax`, whichever is the less. So a piece is in the plane
 * (distance at or under `planeDistanceMax`) by today's tolerances or by
 * the normals, and the test holds at near-zero inclination, where the
 * node is undefined. The same limit on the days since the event applies
 * to both; with the angle at zero it is `planeDistance`'s alone.
 */
export function planeTestDistance(parent: PlaneOrbit, piece: PlaneOrbit, eventMs: number, params: DetectorParameters, limitDays = params.planeMaxDays): number {
  const distance = planeDistance(parent, piece, eventMs, params, limitDays).distance;
  if (!(params.planeNormalAngleMaxDeg > 0) || Math.abs(piece.epochMs - eventMs) / DAY_MS > limitDays) return distance;
  const byNormal = (normalAngleDeg(parent, piece, eventMs) / params.planeNormalAngleMaxDeg) * params.planeDistanceMax;
  return Math.min(distance, byNormal);
}

/**
 * The bodies of an earlier cloud under the launch: those classed as a
 * fragment is (debris, or not yet said) first seen in the span, less the
 * bodies excluded (the alerted parent, and the pieces now being judged).
 * This is what a later alert's pieces are told apart from.
 */
export function cloudBodies(launch: LaunchRecord, from: number, to: number, exclude: ReadonlySet<number>): BodyRecord[] {
  return launch.bodies.filter((b) => b.firstSeenAt > from && b.firstSeenAt <= to && isFragmentClass(b.bodyClass) && !exclude.has(b.number));
}

/**
 * How near an orbit lies to a cloud: the least plane test distance
 * (`planeTestDistance`) to any of the cloud's bodies, each distance taken both ways (the orbit as the
 * reference and the body as the reference, since the node is carried at
 * the reference's own rate) and the smaller kept, with no limit on how
 * long after the cloud's event either set is, since the test is whether
 * the orbit can be told from the cloud at all. Infinite with no body.
 */
export function nearestCloudDistance(orbit: PlaneOrbit, cloud: readonly BodyRecord[], eventMs: number, params: DetectorParameters): number {
  let least = Number.POSITIVE_INFINITY;
  for (const body of cloud) {
    const other = planeOrbitOf(body);
    const d = Math.min(planeTestDistance(orbit, other, eventMs, params, Number.POSITIVE_INFINITY), planeTestDistance(other, orbit, eventMs, params, Number.POSITIVE_INFINITY));
    if (d < least) least = d;
  }
  return least;
}

/** The tangential impulse, in metres a second, that moves the semi-major axis of a near-circular orbit at `aKm` by `deltaKm`. */
export function deltaVOfAxisChange(aKm: number, deltaKm: number): number {
  return (Math.abs(deltaKm) * MU_KM3_PER_S2) / (2 * aKm * aKm * speedAt(aKm, aKm)) * 1000;
}

/**
 * The upper tail of a Poisson distribution: the probability of at least
 * `n` events at rate `lambda`. One where `n` is zero or no more than the
 * rate (the count is not even above its expectation); the terms are
 * summed in the logarithm so a large rate does not underflow.
 */
export function poissonTail(n: number, lambda: number): number {
  if (n <= 0) return 1;
  if (lambda <= 0) return 0;
  if (n <= lambda) return 1;
  // P(X < n) = sum_{k<n} e^{-lambda} lambda^k / k!, summed from the largest term down.
  let logTerm = -lambda;
  let sum = 0;
  const terms: number[] = [logTerm];
  for (let k = 1; k < n; k++) {
    logTerm += Math.log(lambda) - Math.log(k);
    terms.push(logTerm);
  }
  const top = Math.max(...terms);
  for (const t of terms) sum += Math.exp(t - top);
  const below = Math.exp(top) * sum;
  return Math.max(0, Math.min(1, 1 - below));
}

/** A parent the launch's new bodies are tested against: its number, the orbit used, and the event instant the node is carried from. */
export interface ParentCandidate {
  number: number;
  orbit: PlaneOrbit;
  eventMs: number;
}

/** One new body as the cloud test read it. */
export interface PieceReading {
  number: number;
  bodyClass: BodyClass;
  firstSeenAt: number;
  firstEpoch: number;
  /** Whether its number is above the high-water mark at the event, so it did not exist before; always true for an analyst pseudo-launch, whose numbers say nothing. */
  aboveMark: boolean;
  /** The nearest parent by plane distance and that distance; null where the launch has no parent. */
  parent: number | null;
  distance: number;
  /** Its change of semi-major axis from that parent, in kilometres, and as a tangential impulse in metres a second. */
  deltaKm: number;
  deltaVMps: number;
  /** Every candidate parent whose plane it lies within the bound of, nearest first: more than one, and the plane test alone cannot say whose piece it is. */
  within: number[];
}

/** The cloud as the launch pass judged it on one run. */
export interface CloudVerdict {
  key: string;
  /** How many new bodies the run brought, how many were first seen in the window, and how many in the year before it (the background's count, every class). */
  newBodies: number;
  windowBodies: number;
  backgroundBodies: number;
  /** The event instant the mark was taken at and the nodes were carried from: a parent's step where there is one, else the first window body's first epoch. */
  eventMs: number;
  /** The background rate per window as read off the year before (unfloored), the floored rate the tail was computed at, and the Poisson tail probability of the window's count. */
  rate: number;
  lambda: number;
  p: number;
  burst: boolean;
  /** The window's bodies, each as read. */
  pieces: PieceReading[];
  /** The pieces that are new by numbering and share some parent's plane, and are not a deployment. */
  consistent: PieceReading[];
  /** The candidate parents and, per parent, the least plane distance over the window's pieces. */
  parents: { number: number; distance: number }[];
  /** The median tangential impulse of the consistent pieces, in metres a second, and the range of their semi-major axes, in kilometres; NaN with none. */
  cloudDeltaVMps: number;
  gabbardSpreadKm: number;
  /** The launch's age at the run, in days from its first body's first set. */
  launchAgeDays: number;
  /** The confounds found: returning old bodies, pieces with a set before the event, payload-classed bodies at deployment speed, and an old cloud's background. */
  returning: number;
  seenBefore: number;
  deployments: number;
  oldCloud: boolean;
  /** Why, in words. */
  reasons: string[];
}

/** The bodies of the launch first seen in the window `(from, to]`. */
function bodiesSeenIn(launch: LaunchRecord, from: number, to: number): BodyRecord[] {
  return launch.bodies.filter((b) => b.firstSeenAt > from && b.firstSeenAt <= to);
}

/** Whether the class the catalogue gives a body is a fragment's: debris, or not yet said. */
export const isFragmentClass = (bodyClass: BodyClass): boolean => bodyClass === "debris" || bodyClass === "unknown";

/**
 * The launch's cloud judged at the run's instant against the parents
 * given: the burst over the launch's own background, and each window
 * body's numbering, plane and velocity. `eventMs` is the alleged event
 * the mark is taken at and the nodes are carried from: a parent's step
 * where there is one, else the first window body's first epoch.
 */
export function judgeCloud(launch: LaunchRecord, catalogue: CatalogueRecord, parents: ParentCandidate[], now: number, newBodies: number, params: DetectorParameters): CloudVerdict {
  const window = params.burstWindowDays * DAY_MS;
  // A candidate parent is not a piece of itself.
  const inWindow = bodiesSeenIn(launch, now - window, now).filter((body) => !parents.some((p) => p.number === body.number));
  const before = bodiesSeenIn(launch, now - window - params.burstBackgroundDays * DAY_MS, now - window);
  const rate = (before.length * params.burstWindowDays) / params.burstBackgroundDays;
  const lambda = Math.max(rate, params.lambdaFloor);
  const analyst = isAnalystLaunch(launch.key);
  const eventMs = parents.length > 0 ? Math.min(...parents.map((p) => p.eventMs)) : inWindow.length > 0 ? Math.min(...inWindow.map((b) => b.firstEpoch)) : now;
  const mark = analyst ? 0 : markAt(catalogue, eventMs);
  const pieces: PieceReading[] = inWindow.map((body) => {
    let parent: number | null = null;
    let distance = Number.POSITIVE_INFINITY;
    let deltaKm = Number.NaN;
    const within: { number: number; distance: number }[] = [];
    for (const candidate of parents) {
      if (candidate.number === body.number) continue;
      const d = planeTestDistance(candidate.orbit, planeOrbitOf(body), candidate.eventMs, params);
      if (d <= params.planeDistanceMax) within.push({ number: candidate.number, distance: d });
      if (d < distance) [parent, distance, deltaKm] = [candidate.number, d, body.aKm - candidate.orbit.aKm];
    }
    const aboveMark = analyst || body.number > mark;
    return { number: body.number, bodyClass: body.bodyClass, firstSeenAt: body.firstSeenAt, firstEpoch: body.firstEpoch, aboveMark, parent, distance, deltaKm, deltaVMps: parent === null ? Number.NaN : deltaVOfAxisChange(parents.find((p) => p.number === parent)!.orbit.aKm, deltaKm), within: within.sort((a, b) => a.distance - b.distance).map((w) => w.number) };
  });
  const n = pieces.filter((p) => p.aboveMark).length;
  const p = poissonTail(n, lambda);
  const burst = n >= params.burstMinBodies && p <= params.pBurst;
  const returning = pieces.length - n;
  const seenBefore = pieces.filter((piece) => piece.aboveMark && piece.firstEpoch < eventMs - DAY_MS).length;
  const inPlane = pieces.filter((piece) => piece.aboveMark && piece.firstEpoch >= eventMs - DAY_MS && piece.distance <= params.planeDistanceMax);
  const deployments = inPlane.filter((piece) => piece.bodyClass === "payload" || piece.bodyClass === "rocket body").length;
  let consistent = inPlane.filter((piece) => isFragmentClass(piece.bodyClass));
  const cloudDeltaVMps = consistent.length === 0 ? Number.NaN : median(consistent.map((piece) => piece.deltaVMps));
  const launchAgeDays = Number.isFinite(launch.firstSeenAt) ? (now - launch.firstSeenAt) / DAY_MS : Number.POSITIVE_INFINITY;
  const reasons: string[] = [];
  if (launchAgeDays < params.youngLaunchDays && consistent.length > 0 && !(cloudDeltaVMps >= params.youngLaunchDeltaVMps)) {
    reasons.push(`the launch is ${launchAgeDays.toFixed(0)} days old and its new bodies move ${cloudDeltaVMps.toFixed(2)} m/s from the parent, under ${params.youngLaunchDeltaVMps}: its own objects being catalogued, whatever their class`);
    consistent = [];
  }
  if (consistent.length > 0 && cloudDeltaVMps < params.deploymentDeltaVMps && consistent.every((piece) => piece.bodyClass !== "debris")) {
    reasons.push(`the new bodies move ${cloudDeltaVMps.toFixed(2)} m/s from the parent and none is classed debris: a deployment`);
    consistent = [];
  }
  const axes = consistent.map((piece) => piece.deltaKm);
  const gabbardSpreadKm = axes.length === 0 ? Number.NaN : Math.max(...axes) - Math.min(...axes);
  const oldCloud = n >= params.burstMinBodies && !burst && rate > params.lambdaFloor;
  reasons.unshift(`${n} new bod${n === 1 ? "y" : "ies"} under ${launch.key} in ${params.burstWindowDays} days against a background of ${lambda.toFixed(2)} (${before.length} in the year before): Poisson tail ${p.toExponential(1)}${burst ? ", a burst" : oldCloud ? ", an old cloud's own cataloguing" : ", no burst"}`);
  if (returning > 0) reasons.push(`${returning} numbered at or below the catalogue's mark of ${mark} at the event: returning old bodies, not pieces`);
  if (seenBefore > 0) reasons.push(`${seenBefore} with a set before the event: not pieces of it`);
  if (deployments > 0) reasons.push(`${deployments} in plane but classed payload or rocket body: the launch's own objects`);
  if (consistent.length > 0) reasons.push(`${consistent.length} piece${consistent.length > 1 ? "s" : ""} in the plane of parent ${consistent[0]!.parent} (distance under ${params.planeDistanceMax}), moving ${cloudDeltaVMps.toFixed(1)} m/s, the semi-major axes spread over ${gabbardSpreadKm.toFixed(1)} km`);
  const parentRows = parents.map((candidate) => ({ number: candidate.number, distance: pieces.reduce((least, piece) => (piece.parent === candidate.number ? Math.min(least, piece.distance) : least), Number.POSITIVE_INFINITY) }));
  return { key: launch.key, newBodies, windowBodies: inWindow.length, backgroundBodies: before.length, eventMs, rate, lambda, p, burst, pieces, consistent, parents: parentRows, cloudDeltaVMps, gabbardSpreadKm, launchAgeDays, returning, seenBefore, deployments, oldCloud, reasons };
}

/** The pieces within each plane distance, for the log's sweep columns. */
export function piecesWithin(verdict: CloudVerdict, distance: number): number {
  return verdict.pieces.filter((piece) => piece.aboveMark && piece.distance <= distance).length;
}
