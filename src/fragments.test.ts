import { describe, expect, test } from "vitest";
import { catalogueFor, judgeCloud, launchFor, launchKeyOf, markAt, nearestCloudDistance, noteBody, normalAngleDeg, planeDistance, planeTestDistance, poissonTail, type ParentCandidate, type PlaneOrbit } from "./fragments.ts";
import { DETECTOR_PARAMETERS } from "./params.ts";
import { nodePrecessionDegPerDay } from "./series.ts";
import { DAY, HOUR, meanMotionOf, setOf } from "./synthetic.test-support.ts";

/**
 * The per-launch channel on synthetic launches, each the shape of one
 * thing it must get right: a fresh cloud in the parent's plane is a burst
 * of consistent pieces; an old cloud's late batch, out of plane and
 * numbered under the catalogue's mark, is background and returning
 * bodies; a rideshare's satellites leaving their stage at under a metre a
 * second are a deployment; and a single new piece is no burst. The plane
 * test and the Poisson tail are checked on their own first.
 */

const T0 = Date.UTC(2013, 3, 1);
const params = DETECTOR_PARAMETERS;

/** A set of a body under a launch, with the orbit given: near-circular at 7,200 km unless said, in the plane of inclination 98 and node 100. */
function body(number: number, designator: string, epochMs: number, orbit: { aKm?: number; raanDeg?: number; inclinationDeg?: number } = {}, bodyClass: "payload" | "rocket body" | "debris" = "debris") {
  return { ...setOf(number, { epochMs, aKm: orbit.aKm ?? 7200, raanDeg: orbit.raanDeg ?? 100, inclinationDeg: orbit.inclinationDeg ?? 98 }, bodyClass), designator };
}

const orbitOf = (aKm: number, raanDeg: number, inclinationDeg: number, epochMs: number): PlaneOrbit => ({ epochMs, aKm, eccentricity: 0.001, inclinationDeg, raanDeg, meanMotion: meanMotionOf(aKm) });

describe("the plane test", () => {
  test("a piece on the parent's plane, catalogued a month later, is within distance one once each node's own J2 precession is taken off", () => {
    const parent = orbitOf(7200, 100, 98, T0);
    const rate = nodePrecessionDegPerDay(7195, 0.001, 98, meanMotionOf(7195));
    // The piece is five kilometres lower, so its node precesses a little faster than the parent's; thirty days on, it sits where its own rate put it.
    const piece = orbitOf(7195, 100 + rate * 30, 98, T0 + 30 * DAY);
    const d = planeDistance(parent, piece, T0, params);
    expect(Math.abs(d.deltaInclinationDeg)).toBeLessThan(0.01);
    expect(Math.abs(d.deltaNodeDeg)).toBeLessThan(0.1);
    expect(d.distance).toBeLessThan(1);
    // The same piece without the adjustment would be off by the parent's rate over thirty days, about twenty-seven degrees.
    expect(Math.abs(nodePrecessionDegPerDay(7200, 0.001, 98, meanMotionOf(7200)) * 30)).toBeGreaterThan(20);
  });

  test("a piece six degrees off in node, or seven tenths of a degree in inclination, is out of the plane; two degrees of node alone is within it", () => {
    const parent = orbitOf(7200, 100, 98, T0);
    expect(planeDistance(parent, orbitOf(7200, 106, 98, T0 + HOUR), T0, params).distance).toBeGreaterThan(params.planeDistanceMax);
    expect(planeDistance(parent, orbitOf(7200, 100, 98.7, T0 + HOUR), T0, params).distance).toBeGreaterThan(params.planeDistanceMax);
    expect(planeDistance(parent, orbitOf(7200, 102, 98, T0 + HOUR), T0, params).distance).toBeLessThan(params.planeDistanceMax);
    expect(planeDistance(parent, orbitOf(7200, 100.3, 98.05, T0 + HOUR), T0, params).distance).toBeLessThan(1);
  });

  test("a piece catalogued longer after the event than the node can be carried is not tested", () => {
    const parent = orbitOf(7200, 100, 98, T0);
    expect(planeDistance(parent, orbitOf(7200, 100, 98, T0 + (params.planeMaxDays + 1) * DAY), T0, params).distance).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("the angle between orbit normals", () => {
  test("two near-equatorial planes a third of the circle apart in node are a few hundredths of a degree apart; two polar-ish planes two degrees apart in node are nearly two degrees apart", () => {
    // Normals at 0.02 degrees from the pole, 120 degrees apart around it: a chord of 2 x 0.02 x sin 60.
    expect(normalAngleDeg(orbitOf(42164, 80, 0.02, T0), orbitOf(42164, 200, 0.02, T0), T0)).toBeCloseTo(0.034641, 5);
    // At inclination 98, two degrees of node: 2 asin(sin 98 x sin 1).
    expect(normalAngleDeg(orbitOf(7200, 100, 98, T0), orbitOf(7200, 102, 98, T0), T0)).toBeCloseTo(1.98054, 4);
    expect(normalAngleDeg(orbitOf(7200, 100, 98, T0), orbitOf(7200, 100, 98.7, T0), T0)).toBeCloseTo(0.7, 6);
  });

  test("the parent's node is carried to the piece's epoch as the plane test carries it", () => {
    const parent = orbitOf(7200, 100, 98, T0);
    const rate = nodePrecessionDegPerDay(7195, 0.001, 98, meanMotionOf(7195));
    expect(normalAngleDeg(parent, orbitOf(7195, 100 + rate * 30, 98, T0 + 30 * DAY), T0)).toBeLessThan(0.1);
  });
});

describe("the Poisson tail", () => {
  test("gives the textbook values and the edges", () => {
    expect(poissonTail(2, 0.5)).toBeCloseTo(1 - Math.exp(-0.5) * 1.5, 6);
    expect(poissonTail(5, 0.5)).toBeCloseTo(1.7e-4, 4);
    expect(poissonTail(0, 3)).toBe(1);
    expect(poissonTail(3, 3)).toBe(1);
    expect(poissonTail(1, 0)).toBe(0);
    // A large rate does not underflow: a thousand expected, a thousand and fifty seen is nothing special.
    expect(poissonTail(1050, 1000)).toBeGreaterThan(0.05);
    expect(poissonTail(1200, 1000)).toBeLessThan(1e-6);
  });
});

/** Notes every set under its launch at the run instants given, oldest first. */
function note(launches: Map<string, unknown>, sets: { set: ReturnType<typeof body>; at: number }[]): void {
  for (const { set, at } of sets) noteBody(launches, set, at);
}

describe("the cloud judged on a launch", () => {
  test("a fresh cloud in the parent's plane is a burst of consistent pieces with a cloud velocity and a spread", () => {
    const launches = new Map<string, unknown>();
    const now = T0 + 400 * DAY;
    note(launches, [{ set: body(50001, "2013-010A", T0, {}, "payload"), at: T0 }]);
    // Other launches' bodies set the catalogue's mark well above the parent's number.
    note(launches, [{ set: body(50500, "2013-011A", T0 + 10 * DAY, {}, "payload"), at: T0 + 10 * DAY }]);
    const pieces = [50601, 50602, 50603, 50604, 50605, 50606].map((n, i) => ({ set: body(n, `2013-010${"CDEFGH"[i]}`, now - 2 * DAY, { aKm: 7200 + (i - 2.5) * 4, raanDeg: 100 + 0.2 * (i - 2.5) }), at: now - DAY }));
    note(launches, pieces);
    const launch = launchFor(launches, "2013-010");
    const catalogue = catalogueFor(launches);
    expect(markAt(catalogue, now - 3 * DAY)).toBe(50500);
    const parents: ParentCandidate[] = [{ number: 50001, orbit: orbitOf(7200, 100, 98, now - 2 * DAY - HOUR), eventMs: now - 2 * DAY - HOUR }];
    const verdict = judgeCloud(launch, catalogue, parents, now, 6, params);
    expect(verdict.windowBodies).toBe(6);
    expect(verdict.lambda).toBe(params.lambdaFloor);
    expect(verdict.p).toBeLessThan(params.pBurst);
    expect(verdict.burst).toBe(true);
    expect(verdict.consistent.map((p) => p.number)).toEqual([50601, 50602, 50603, 50604, 50605, 50606]);
    expect(verdict.parents).toEqual([{ number: 50001, distance: expect.any(Number) }]);
    expect(verdict.parents[0]!.distance).toBeLessThan(1);
    expect(verdict.cloudDeltaVMps).toBeGreaterThan(2);
    expect(verdict.cloudDeltaVMps).toBeLessThan(5);
    expect(verdict.gabbardSpreadKm).toBeCloseTo(20, 0);
    expect(verdict.returning + verdict.seenBefore + verdict.deployments).toBe(0);
    expect(verdict.oldCloud).toBe(false);
    expect(verdict.reasons[0]).toContain("a burst");
  });

  test("an old cloud's late batch, out of plane and numbered under the mark, is background and returning bodies, not pieces", () => {
    const launches = new Map<string, unknown>();
    const now = T0 + 400 * DAY;
    note(launches, [{ set: body(30001, "2007-001A", T0, {}, "payload"), at: T0 }]);
    // Two hundred pieces trickled in over the year before the window, about eight a fortnight.
    for (let i = 0; i < 200; i++) note(launches, [{ set: body(31000 + i, `2007-001${"B"}`, T0 + 20 * DAY + i * 1.8 * DAY, { raanDeg: 130 }), at: T0 + 20 * DAY + i * 1.8 * DAY }]);
    // The catalogue's mark has moved on past every number the batch carries.
    note(launches, [{ set: body(50000, "2013-011A", now - 60 * DAY, {}, "payload"), at: now - 60 * DAY }]);
    const batch = Array.from({ length: 8 }, (_, i) => ({ set: body(31300 + i, "2007-001B", now - DAY, { raanDeg: 130 }), at: now - DAY }));
    note(launches, batch);
    const launch = launchFor(launches, "2007-001");
    const parents: ParentCandidate[] = [{ number: 30001, orbit: orbitOf(7200, 100, 98, now - 2 * DAY), eventMs: now - 2 * DAY }];
    const verdict = judgeCloud(launch, catalogueFor(launches), parents, now, 8, params);
    expect(verdict.windowBodies).toBe(8);
    expect(verdict.lambda).toBeGreaterThan(5);
    expect(verdict.burst).toBe(false);
    expect(verdict.returning).toBe(8);
    expect(verdict.consistent).toEqual([]);
    expect(verdict.reasons.join(" ")).toContain("returning old bodies");
    // The same batch numbered above the mark is still no burst against the launch's own rate, and out of the plane.
    const above = Array.from({ length: 8 }, (_, i) => ({ set: body(50100 + i, "2007-001B", now - DAY, { raanDeg: 130 }), at: now - DAY }));
    const again = new Map<string, unknown>();
    note(again, [{ set: body(30001, "2007-001A", T0, {}, "payload"), at: T0 }]);
    for (let i = 0; i < 200; i++) note(again, [{ set: body(31000 + i, "2007-001B", T0 + 20 * DAY + i * 1.8 * DAY, { raanDeg: 130 }), at: T0 + 20 * DAY + i * 1.8 * DAY }]);
    note(again, above);
    const second = judgeCloud(launchFor(again, "2007-001"), catalogueFor(again), parents, now, 8, params);
    expect(second.burst).toBe(false);
    expect(second.oldCloud).toBe(true);
    expect(second.returning).toBe(0);
    expect(second.pieces.every((p) => p.distance > params.planeDistanceMax)).toBe(true);
    expect(second.consistent).toEqual([]);
  });

  test("a rideshare's satellites leaving their stage at under a metre a second are a deployment, not a cloud", () => {
    const launches = new Map<string, unknown>();
    const now = T0 + 3 * DAY;
    note(launches, [{ set: body(51000, "2013-020B", T0, {}, "rocket body"), at: T0 }]);
    const satellites = Array.from({ length: 10 }, (_, i) => ({ set: body(51001 + i, `2013-020${"CDEFGHJKLM"[i]}`, T0 + DAY, { aKm: 7200 + (i - 4.5) * 0.3 }, "payload"), at: T0 + DAY }));
    note(launches, satellites);
    const launch = launchFor(launches, "2013-020");
    const parents: ParentCandidate[] = [{ number: 51000, orbit: orbitOf(7200, 100, 98, T0), eventMs: T0 }];
    const verdict = judgeCloud(launch, catalogueFor(launches), parents, now, 10, params);
    expect(verdict.burst).toBe(true);
    expect(verdict.launchAgeDays).toBeCloseTo(3, 1);
    expect(verdict.pieces.every((p) => p.distance < 1)).toBe(true);
    expect(verdict.deployments).toBe(10);
    expect(verdict.consistent).toEqual([]);
    expect(verdict.reasons.join(" ")).toContain("classed payload or rocket body");
    // Debris-classed bodies off the same young launch at under five metres a second are still its own objects: a platform or a cover.
    const slow = Array.from({ length: 6 }, (_, i) => ({ set: body(52101 + i, "2013-022C", T0 + DAY, { aKm: 7200 + (i - 2.5) * 0.6 }), at: T0 + DAY }));
    const own = new Map<string, unknown>();
    note(own, [{ set: body(52100, "2013-022B", T0, {}, "rocket body"), at: T0 }, ...slow]);
    const platform = judgeCloud(launchFor(own, "2013-022"), catalogueFor(own), [{ number: 52100, orbit: orbitOf(7200, 100, 98, T0), eventMs: T0 }], now, 6, params);
    expect(platform.consistent).toEqual([]);
    expect(platform.reasons.join(" ")).toContain("whatever their class");
    // Debris-classed bodies off the same young launch at a dozen metres a second are pieces: a stage that broke up on its first day.
    const pieces = Array.from({ length: 6 }, (_, i) => ({ set: body(52001 + i, "2013-021C", T0 + DAY, { aKm: 7200 + (i - 2.5) * 12 }), at: T0 + DAY }));
    const fresh = new Map<string, unknown>();
    note(fresh, [{ set: body(52000, "2013-021B", T0, {}, "rocket body"), at: T0 }, ...pieces]);
    const stage = judgeCloud(launchFor(fresh, "2013-021"), catalogueFor(fresh), [{ number: 52000, orbit: orbitOf(7200, 100, 98, T0), eventMs: T0 }], now, 6, params);
    expect(stage.burst).toBe(true);
    expect(stage.consistent).toHaveLength(6);
    expect(stage.cloudDeltaVMps).toBeGreaterThan(params.youngLaunchDeltaVMps);
  });

  test("a single new piece is no burst, and a launch with no parent has nothing to test a plane against", () => {
    const launches = new Map<string, unknown>();
    const now = T0 + 100 * DAY;
    note(launches, [{ set: body(53000, "2013-030A", T0, {}, "payload"), at: T0 }, { set: body(53001, "2013-030B", now - DAY), at: now - DAY }]);
    const verdict = judgeCloud(launchFor(launches, "2013-030"), catalogueFor(launches), [{ number: 53000, orbit: orbitOf(7200, 100, 98, now - DAY), eventMs: now - DAY }], now, 1, params);
    expect(verdict.windowBodies).toBe(1);
    expect(verdict.burst).toBe(false);
    expect(verdict.consistent).toHaveLength(1);
    expect(verdict.reasons[0]).toContain("no burst");
    const orphan = judgeCloud(launchFor(launches, "2013-030"), catalogueFor(launches), [], now, 1, params);
    expect(orphan.pieces[0]!.parent).toBeNull();
    expect(orphan.consistent).toEqual([]);
  });

  test("analyst objects go to a pseudo-launch each, by their range", () => {
    expect(launchKeyOf({ number: 85000, designator: null })).toBe("analyst-80000");
    expect(launchKeyOf({ number: 270123, designator: null })).toBe("analyst-270000");
    expect(launchKeyOf({ number: 25544, designator: "1998-067A" })).toBe("1998-067");
    expect(launchKeyOf({ number: 100, designator: null })).toBeNull();
  });
});

/**
 * The plane test at near-zero inclination, on launches the shape of the
 * two measured on the Archive: there the node is undefined, so a
 * parent's pieces scatter over the whole circle of nodes and fail the
 * node tolerance, while their orbit normals all lie near the pole, and so
 * near the parent's. The test is today's distance or the angle between
 * the normals within `planeNormalAngleMaxDeg`.
 */
describe("the cloud judged on a near-equatorial launch", () => {
  const GEO_KM = 42164;
  const now = T0 + 20 * DAY;
  const event = now - 8 * DAY;

  /** A launch with its parent (published years before) and pieces published a week after the event, each `[inclination, node]`, their semi-major axes spread over a few hundred kilometres. */
  function geoLaunch(designator: string, parent: number, pieces: readonly (readonly [number, number])[]) {
    const launches = new Map<string, unknown>();
    note(launches, [{ set: body(parent, `${designator}A`, T0 - 2000 * DAY, { aKm: GEO_KM, inclinationDeg: 0.1, raanDeg: 80 }, "payload"), at: T0 - 2000 * DAY }]);
    note(launches, pieces.map(([inclinationDeg, raanDeg], i) => ({ set: body(62000 + i, `${designator}${"BCDEFGHJKLMNPQRSTUV"[i]}`, now - 2 * DAY, { aKm: GEO_KM + (i - 3) * 60, inclinationDeg, raanDeg }), at: now - DAY })));
    return { launch: launchFor(launches, designator), catalogue: catalogueFor(launches) };
  }

  test("a geostationary payload at a fiftieth of a degree, its pieces' nodes all round the circle and their planes within a tenth of a degree, is the parent of a consistent cloud (Intelsat 33e)", () => {
    const pieces = [[0.02, 200], [0.03, 320], [0.04, 40], [0.05, 150], [0.02, 260], [0.06, 10]] as const;
    const { launch, catalogue } = geoLaunch("2016-053", 41748, pieces);
    const parents: ParentCandidate[] = [{ number: 41748, orbit: orbitOf(GEO_KM, 80, 0.02, event - DAY), eventMs: event }];
    const today = judgeCloud(launch, catalogue, parents, now, 6, { ...params, planeNormalAngleMaxDeg: 0 });
    expect(today.consistent).toEqual([]);
    const fixed = judgeCloud(launch, catalogue, parents, now, 6, { ...params, planeNormalAngleMaxDeg: 0.5 });
    expect(fixed.burst).toBe(true);
    expect(fixed.consistent.map((p) => p.number)).toEqual([62000, 62001, 62002, 62003, 62004, 62005]);
    expect(fixed.parents[0]!.distance).toBeLessThanOrEqual(params.planeDistanceMax);
  });

  test("as fitted, the detector reads a geostationary parent's pieces in its plane: the normals within a degree", () => {
    expect(params.planeNormalAngleMaxDeg).toBe(1);
    const { launch, catalogue } = geoLaunch("2016-053", 41748, [[0.02, 200], [0.03, 320], [0.04, 40], [0.05, 150], [0.02, 260], [0.06, 10]]);
    const verdict = judgeCloud(launch, catalogue, [{ number: 41748, orbit: orbitOf(GEO_KM, 80, 0.02, event - DAY), eventMs: event }], now, 6, params);
    expect(verdict.consistent).toHaveLength(6);
  });

  test("a stage at under a fifth of a degree keeps the one piece today's tolerances pass, gains the four whose normals lie within half a degree of its own, and the sixth only at a degree (Cosmos 2513 R/B)", () => {
    // Normals 0.01, 0.28, 0.42, 0.24 and 0.29 degrees from the parent's, and the sixth's 0.75: chords between points 0.17 degrees from the pole and the pieces' inclinations from it.
    const pieces = [[0.2, 81], [0.15, 200], [0.25, 260], [0.1, 320], [0.3, 150], [0.6, 230]] as const;
    const { launch, catalogue } = geoLaunch("2015-075", 41122, pieces);
    const parents: ParentCandidate[] = [{ number: 41122, orbit: orbitOf(GEO_KM, 80, 0.17, event - DAY), eventMs: event }];
    const consistentAt = (planeNormalAngleMaxDeg: number): number[] => judgeCloud(launch, catalogue, parents, now, 6, { ...params, planeNormalAngleMaxDeg }).consistent.map((p) => p.number);
    expect(consistentAt(0)).toEqual([62000]);
    expect(consistentAt(0.5)).toEqual([62000, 62001, 62002, 62003, 62004]);
    expect(consistentAt(1)).toEqual([62000, 62001, 62002, 62003, 62004, 62005]);
  });

  test("a geostationary parent lies in the plane of its launch's earlier cloud, whose nodes are all round the circle, so new pieces cannot be told from that cloud's", () => {
    const { launch } = geoLaunch("2016-053", 41748, [[0.03, 200], [0.04, 320], [0.02, 40]]);
    const cloud = launch.bodies.filter((b) => b.number !== 41748);
    const parent = orbitOf(GEO_KM, 80, 0.02, now);
    expect(nearestCloudDistance(parent, cloud, event, { ...params, planeNormalAngleMaxDeg: 0 })).toBeGreaterThan(params.planeDistanceMax);
    expect(nearestCloudDistance(parent, cloud, event, { ...params, planeNormalAngleMaxDeg: 0.5 })).toBeLessThanOrEqual(params.planeDistanceMax);
  });
});

describe("the plane test by the normals at high inclination", () => {
  test("a sun-synchronous piece five degrees off in node is out of the plane at either angle; one eight tenths of a degree off in inclination is out by today's tolerances, out at half a degree, and in at a degree", () => {
    const parent = orbitOf(7200, 100, 98, T0);
    const at = (piece: PlaneOrbit, planeNormalAngleMaxDeg: number): number => planeTestDistance(parent, piece, T0, { ...params, planeNormalAngleMaxDeg });
    const offNode = orbitOf(7200, 105, 98, T0 + HOUR);
    for (const angle of [0, 0.5, 1]) expect(at(offNode, angle)).toBeGreaterThan(params.planeDistanceMax);
    const offInclination = orbitOf(7200, 100, 98.8, T0 + HOUR);
    expect(at(offInclination, 0)).toBeGreaterThan(params.planeDistanceMax);
    expect(at(offInclination, 0.5)).toBeGreaterThan(params.planeDistanceMax);
    expect(at(offInclination, 1)).toBeLessThanOrEqual(params.planeDistanceMax);
  });

  test("the normals are not read for a piece catalogued longer after the event than the node can be carried", () => {
    const parent = orbitOf(7200, 100, 98, T0);
    expect(planeTestDistance(parent, orbitOf(7200, 100, 98, T0 + (params.planeMaxDays + 1) * DAY), T0, { ...params, planeNormalAngleMaxDeg: 1 })).toBe(Number.POSITIVE_INFINITY);
  });
});

