import { propagate } from "@orbinauts/engine";
import { describe, expect, test } from "vitest";
import { cartesianOf, elementsOf, eventTimeOf } from "./event-time.ts";
import { MU_KM3_PER_S2, speedAt } from "./impulse.ts";
import { DETECTOR_PARAMETERS } from "./params.ts";
import { nodePrecessionDegPerDay } from "./series.ts";
import { DAY, HOUR, meanMotionOf, setOf } from "./synthetic.test-support.ts";

/**
 * The event's time from a synthetic pre and post set with a known kick:
 * the post orbit is the pre orbit with the semi-major axis raised by what
 * a tangential impulse gives, phased so both are at the same place at the
 * instant of the kick. The crossing must land on that instant within its
 * stated sigma, the minima must list one closest approach a revolution,
 * and the sets that cannot be propagated or are out of order give null.
 */

const T0 = Date.UTC(2013, 3, 1);
const params = DETECTOR_PARAMETERS;

/** The distance between two sets' propagated positions at an instant, in kilometres. */
function apart(a: ReturnType<typeof setOf>, b: ReturnType<typeof setOf>, at: number): number {
  const p = propagate(elementsOf(a)!, new Date(at));
  const q = propagate(elementsOf(b)!, new Date(at));
  const r = cartesianOf(p.latitude, p.longitude, p.altitude);
  const s = cartesianOf(q.latitude, q.longitude, q.altitude);
  return Math.hypot(s[0] - r[0], s[1] - r[1], s[2] - r[2]);
}

/**
 * The pre set at T0 and the post set at `postHours` after it, kicked at
 * `kickHours` by `deltaVMps` along the track, on a near-circular orbit of
 * `aKm`. The post set's mean anomaly is searched so that both orbits are
 * at one place at the kick: the printed mean motion is not the rate the
 * propagation advances the phase at (the secular J2 terms add a part in
 * a thousand), so the phase cannot be carried by hand.
 */
function pair(aKm: number, kickHours: number, postHours: number, deltaVMps: number) {
  const n0 = meanMotionOf(aKm);
  const speed = speedAt(aKm, aKm);
  const deltaKm = (2 * aKm * aKm * speed * (deltaVMps / 1000)) / MU_KM3_PER_S2;
  const a1 = aKm + deltaKm;
  const pre = setOf(1, { epochMs: T0, aKm, eccentricity: 0.0005 });
  const kick = T0 + kickHours * HOUR;
  // The post set's node is the pre set's carried to its epoch at the J2 rate, as the catalogue's fit would print it.
  const raanDeg = pre.raanDeg + nodePrecessionDegPerDay(a1, 0.0005, pre.inclinationDeg, meanMotionOf(a1)) * (postHours / 24);
  const postAt = (meanAnomalyDeg: number) => ({ ...setOf(1, { epochMs: T0 + postHours * HOUR, aKm: a1, eccentricity: 0.0005, raanDeg }), meanAnomalyDeg });
  let best = 0;
  let least = Number.POSITIVE_INFINITY;
  for (let m = 0; m < 360; m += 0.5) {
    const d = apart(pre, postAt(m), kick);
    if (d < least) [best, least] = [m, d];
  }
  for (let m = best - 0.5; m <= best + 0.5; m += 0.002) {
    const d = apart(pre, postAt(((m % 360) + 360) % 360), kick);
    if (d < least) [best, least] = [((m % 360) + 360) % 360, d];
  }
  return { pre, post: postAt(best), deltaKm, n0, apartAtKick: least };
}

describe("the event's time", () => {
  test("a tangential kick of a third of a metre a second at five hours is placed within its sigma, with one closest approach a revolution", () => {
    const { pre, post, deltaKm, n0, apartAtKick } = pair(7000, 5, 12, 0.3);
    expect(deltaKm).toBeCloseTo(0.557, 2);
    expect(apartAtKick).toBeLessThan(1);
    const timed = eventTimeOf(pre, post, params)!;
    expect(timed).not.toBeNull();
    expect(timed.fromMinimum).toBe(false);
    expect(timed.gridSeconds).toBe(params.eventGridSeconds);
    expect(timed.points).toBe(Math.floor(((12 + params.eventLeadHours) * HOUR) / (params.eventGridSeconds * 1000)) + 1);
    const kick = T0 + 5 * HOUR;
    expect(Math.abs(timed.at - kick)).toBeLessThan(2 * timed.sigmaMinutes * 60_000 + 10 * 60_000);
    expect(timed.sigmaMinutes).toBeLessThan(90);
    expect(timed.from).toBeLessThanOrEqual(timed.at);
    expect(timed.to).toBeGreaterThanOrEqual(timed.at);
    // The along-track drift is three pi times the axis change a revolution.
    const periodHours = 24 / n0;
    expect(Math.abs(timed.slopeKmPerHour) * periodHours).toBeCloseTo(3 * Math.PI * deltaKm, 0);
    // The closest approaches come once a revolution, and the ones within two sigmas are the revolutions the event could be on.
    expect(timed.minima.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < timed.minima.length; i++) expect((timed.minima[i]!.at - timed.minima[i - 1]!.at) / HOUR).toBeCloseTo(periodHours, 0);
    expect(timed.ambiguousRevolutions).toBeGreaterThanOrEqual(1);
    expect(timed.ambiguousRevolutions).toBeLessThanOrEqual(timed.minima.length);
  });

  test("a larger kick is timed more finely, since the orbits drift apart faster", () => {
    const small = eventTimeOf(pair(7000, 5, 12, 0.3).pre, pair(7000, 5, 12, 0.3).post, params)!;
    const large = eventTimeOf(pair(7000, 5, 12, 3).pre, pair(7000, 5, 12, 3).post, params)!;
    expect(large.sigmaMinutes).toBeLessThan(small.sigmaMinutes / 5);
    expect(Math.abs(large.at - (T0 + 5 * HOUR))).toBeLessThan(2 * large.sigmaMinutes * 60_000 + 5 * 60_000);
  });

  test("sets seventeen days apart are timed on a wider grid, within the point budget", () => {
    const { pre, post } = pair(26600, 100, 17 * 24, 1);
    const timed = eventTimeOf(pre, post, params)!;
    expect(timed).not.toBeNull();
    expect(timed.points).toBeLessThanOrEqual(params.eventMaxPoints);
    expect(timed.gridSeconds).toBeGreaterThan(params.eventGridSeconds);
    expect(timed.gridSeconds % params.eventGridSeconds).toBe(0);
    expect(timed.at).toBeGreaterThanOrEqual(T0 - params.eventLeadHours * HOUR);
    expect(timed.at).toBeLessThanOrEqual(post.epochMs);
  });

  test("a post set not after the pre set, or a set the engine cannot propagate, gives nothing", () => {
    const { pre, post } = pair(7000, 5, 12, 0.3);
    expect(eventTimeOf(post, pre, params)).toBeNull();
    expect(eventTimeOf(pre, { ...post, meanMotion: Number.NaN }, params)).toBeNull();
    expect(elementsOf({ ...pre, eccentricity: 1.5 })).toBeNull();
    expect(elementsOf(pre)?.catalogueNumber).toBe(1);
  });

  test("the Earth-fixed position of a geodetic point", () => {
    const [x, y, z] = cartesianOf(0, 0, 0);
    expect(x).toBeCloseTo(6378.137, 3);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
    const pole = cartesianOf(90, 0, 100);
    expect(Math.hypot(pole[0], pole[1])).toBeLessThan(1e-9);
    expect(pole[2]).toBeCloseTo(6356.752 + 100, 2);
    const over = cartesianOf(45, 90, 500);
    expect(Math.abs(over[0])).toBeLessThan(1e-9);
    expect(Math.hypot(over[1], over[2])).toBeGreaterThan(6378 + 500 - 30);
    expect(DAY).toBe(86_400_000);
  });
});
