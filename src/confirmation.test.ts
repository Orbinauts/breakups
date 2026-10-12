import { describe, expect, test } from "vitest";
import { alertTimingRefusals, analystRefusals, judgePieces, launchRefusals, type PieceRulesView, type PieceSubject } from "./confirmation.ts";
import type { PiecesEventTime, PiecesOrigin } from "./event-time.ts";
import { newLaunch, planeOrbitOf, type BodyRecord, type CloudVerdict, type LaunchRecord, type PieceReading } from "./fragments.ts";
import { REFUSALS } from "./log.ts";
import { DETECTOR_PARAMETERS, type DetectorParameters } from "./params.ts";
import { DAY, HOUR, meanMotionOf } from "./synthetic.test-support.ts";

/**
 * The confirmation rules one at a time, each through the narrow view the
 * launch pass gives them: a launch's bodies, the cloud verdict's counts,
 * the pieces as the plane test read them, and the parent's reentry. Every
 * body here has its first set at one epoch, so two bodies on the same
 * inclination and node lie at plane distance zero, and two degrees of
 * inclination apart lie ten tolerances apart.
 */

const NOW = Date.UTC(2020, 5, 1);
const EPOCH = NOW - 2 * DAY;
const params = DETECTOR_PARAMETERS;
const LAUNCH = "2010-001";
const PARENT = 1;

function body(number: number, options: Partial<BodyRecord> = {}): BodyRecord {
  return { number, firstSeenAt: NOW - 1000 * DAY, firstEpoch: EPOCH, minEpoch: EPOCH, aKm: 7200, eccentricity: 0.001, inclinationDeg: 98, raanDeg: 100, meanMotion: meanMotionOf(7200), bodyClass: "payload", ...options };
}

/** A fresh piece of the launch, first seen two days ago, as a body and as the plane test read it. */
function piece(number: number, options: { inclinationDeg?: number; deltaVMps?: number; distance?: number } = {}): { body: BodyRecord; reading: PieceReading } {
  const record = body(number, { firstSeenAt: NOW - DAY, inclinationDeg: options.inclinationDeg ?? 98, bodyClass: "debris" });
  return { body: record, reading: { number, bodyClass: "debris", firstSeenAt: record.firstSeenAt, firstEpoch: record.firstEpoch, aboveMark: true, parent: PARENT, distance: options.distance ?? 0, deltaKm: 1, deltaVMps: options.deltaVMps ?? 5, within: [PARENT] } };
}

function launchOf(bodies: BodyRecord[]): LaunchRecord {
  return { ...newLaunch(LAUNCH), bodies, firstSeenAt: NOW - 3000 * DAY };
}

const verdictOf = (options: Partial<CloudVerdict> = {}): CloudVerdict => ({ key: LAUNCH, newBodies: 3, windowBodies: 3, backgroundBodies: 0, eventMs: EPOCH, rate: 0, lambda: 0, p: 0, burst: true, pieces: [], consistent: [], parents: [], cloudDeltaVMps: 5, gabbardSpreadKm: 3, launchAgeDays: 3000, returning: 0, seenBefore: 0, deployments: 0, oldCloud: false, reasons: [], ...options }) as CloudVerdict;

function viewOf(decays: ReadonlyMap<number, number> = new Map(), parameters: Partial<DetectorParameters> = {}): PieceRulesView {
  return { params: { ...params, ...parameters }, now: NOW, decayOf: (number) => decays.get(number), bodyOf: (launch, number) => launch.bodies.find((b) => b.number === number) };
}

const NO_MEMORY = { at: Number.NEGATIVE_INFINITY, eventMs: Number.NaN };

/** The parent's subject: its orbit at the pieces' epoch, read at the instant of its step a day before its pieces. */
function subjectOf(parent: BodyRecord): PieceSubject {
  return { number: parent.number, orbit: { ...planeOrbitOf(parent), epochMs: EPOCH }, bodyClass: parent.bodyClass, atMs: EPOCH - DAY, eventMs: EPOCH - DAY };
}

describe("the confirmation rules judging pieces against a parent", () => {
  test("three fast pieces in the plane of a payload on a quiet launch are all kept", () => {
    const parent = body(PARENT);
    const pieces = [piece(101), piece(102), piece(103)];
    const judgement = judgePieces(subjectOf(parent), launchOf([parent, ...pieces.map((p) => p.body)]), verdictOf(), pieces.map((p) => p.reading), NO_MEMORY, viewOf());
    expect(judgement.refused).toBe(0);
    expect(judgement.pieces.map((p) => p.number)).toEqual([101, 102, 103]);
    expect(judgement.reading.refused).toBe(false);
    expect(judgement.reading.cloudPieces).toBe(0);
  });

  test("a parent that reentered before its pieces' first set is refused by the reentry rule; a reentry after the run is not read", () => {
    const parent = body(PARENT);
    const pieces = [piece(101), piece(102), piece(103)];
    const launch = launchOf([parent, ...pieces.map((p) => p.body)]);
    const fell = judgePieces(subjectOf(parent), launch, verdictOf(), pieces.map((p) => p.reading), NO_MEMORY, viewOf(new Map([[PARENT, EPOCH - HOUR]])));
    expect(fell.refused).toBe(REFUSALS.reentry);
    expect(fell.pieces).toEqual([]);
    expect(fell.reasons[0]).toContain("reentered");
    const later = judgePieces(subjectOf(parent), launch, verdictOf(), pieces.map((p) => p.reading), NO_MEMORY, viewOf(new Map([[PARENT, NOW + DAY]])));
    expect(later.refused).toBe(0);
  });

  test("pieces moving under the velocity floor from the parent are refused as bodies in its own orbit", () => {
    const parent = body(PARENT);
    const pieces = [piece(101, { deltaVMps: 0.2 }), piece(102, { deltaVMps: 0.3 }), piece(103, { deltaVMps: 0.4 })];
    const judgement = judgePieces(subjectOf(parent), launchOf([parent, ...pieces.map((p) => p.body)]), verdictOf(), pieces.map((p) => p.reading), NO_MEMORY, viewOf());
    expect(judgement.refused).toBe(REFUSALS.velocity);
    expect(judgement.pieces).toEqual([]);
  });

  test("a debris-classed parent first catalogued weeks before its step is a fresh piece of the launch's cloud, refused", () => {
    const parent = body(PARENT, { bodyClass: "debris", firstEpoch: EPOCH - 20 * DAY, firstSeenAt: NOW - 20 * DAY });
    const pieces = [piece(101), piece(102), piece(103)];
    const judgement = judgePieces(subjectOf(parent), launchOf([parent, ...pieces.map((p) => p.body)]), verdictOf(), pieces.map((p) => p.reading), NO_MEMORY, viewOf());
    expect(judgement.refused & REFUSALS.freshPiece).toBe(REFUSALS.freshPiece);
    expect(judgement.reading.parentAgeDays).toBeCloseTo(19, 5);
  });

  test("under a remembered cloud, a parent lying in that cloud's plane is refused", () => {
    const parent = body(PARENT);
    const cloud = [body(50, { bodyClass: "debris", firstSeenAt: NOW - 200 * DAY }), body(51, { bodyClass: "debris", firstSeenAt: NOW - 200 * DAY })];
    const pieces = [piece(101), piece(102), piece(103)];
    const judgement = judgePieces(subjectOf(parent), launchOf([parent, ...cloud, ...pieces.map((p) => p.body)]), verdictOf(), pieces.map((p) => p.reading), { at: NOW - 200 * DAY, eventMs: EPOCH }, viewOf());
    expect(judgement.refused).toBe(REFUSALS.parentInCloud);
    expect(judgement.reading.cloudPieces).toBe(2);
    expect(judgement.reading.parentCloudDistance).toBe(0);
  });

  test("under a remembered cloud on another plane, the pieces in that cloud's plane are left out, and where none is left the rule refuses", () => {
    const parent = body(PARENT);
    const cloud = [body(50, { bodyClass: "debris", firstSeenAt: NOW - 200 * DAY, inclinationDeg: 100 })];
    const memory = { at: NOW - 200 * DAY, eventMs: EPOCH };
    const mixed = [piece(101), piece(102), piece(103, { inclinationDeg: 100 })];
    const some = judgePieces(subjectOf(parent), launchOf([parent, ...cloud, ...mixed.map((p) => p.body)]), verdictOf(), mixed.map((p) => p.reading), memory, viewOf());
    expect(some.refused).toBe(0);
    expect(some.pieces.map((p) => p.number)).toEqual([101, 102]);
    expect(some.reading.piecesOutOfCloud).toBe(2);
    const inCloud = [piece(101, { inclinationDeg: 100 }), piece(102, { inclinationDeg: 100 })];
    const none = judgePieces(subjectOf(parent), launchOf([parent, ...cloud, ...inCloud.map((p) => p.body)]), verdictOf(), inCloud.map((p) => p.reading), memory, viewOf());
    expect(none.refused).toBe(REFUSALS.piecesInCloud);
    expect(none.pieces).toEqual([]);
  });

  test("a debris-classed parent under an active cloud keeps only the pieces nearer its plane than the cloud lies", () => {
    const parent = body(PARENT, { bodyClass: "debris", firstEpoch: EPOCH - 2000 * DAY });
    // The cloud lies 0.4 degrees of inclination from the parent's plane: two tolerances, and its normal 0.4 degrees off, 1.2 by the normals' bound; the plane test reads the lesser.
    const cloud = [body(50, { bodyClass: "debris", firstSeenAt: NOW - 200 * DAY, inclinationDeg: 98.4 })];
    const near = [piece(101, { distance: 0.5 }), piece(102, { distance: 2.5 }), piece(103, { distance: 1 })];
    const some = judgePieces(subjectOf(parent), launchOf([parent, ...cloud, ...near.map((p) => p.body)]), verdictOf(), near.map((p) => p.reading), NO_MEMORY, viewOf());
    expect(some.reading.parentCloudDistance).toBeCloseTo(1.2, 5);
    expect(some.refused).toBe(0);
    expect(some.pieces.map((p) => p.number)).toEqual([101, 103]);
    const far = [piece(101, { distance: 2.5 }), piece(102, { distance: 2.8 })];
    const none = judgePieces(subjectOf(parent), launchOf([parent, ...cloud, ...far.map((p) => p.body)]), verdictOf(), far.map((p) => p.reading), NO_MEMORY, viewOf());
    expect(none.refused).toBe(REFUSALS.nearerThanCloud);
  });

  test("a single piece confirms only a parent that is not debris, under a launch that gained nothing in the year before and nothing else in the window", () => {
    const parent = body(PARENT);
    const one = [piece(101)];
    const launch = launchOf([parent, one[0]!.body]);
    const judge = (verdict: CloudVerdict, subject = subjectOf(parent)) => judgePieces(subject, launch, verdict, one.map((p) => p.reading), NO_MEMORY, viewOf());
    expect(judge(verdictOf({ windowBodies: 1 })).refused).toBe(0);
    expect(judge(verdictOf({ windowBodies: 1, backgroundBodies: 1 })).refused).toBe(REFUSALS.singlePiece);
    expect(judge(verdictOf({ windowBodies: 2 })).refused).toBe(REFUSALS.singlePiece);
    const oldDebris = body(PARENT, { bodyClass: "debris", firstEpoch: EPOCH - 2000 * DAY });
    const underDebris = judgePieces(subjectOf(oldDebris), launchOf([oldDebris, one[0]!.body]), verdictOf({ windowBodies: 1 }), one.map((p) => p.reading), NO_MEMORY, viewOf());
    expect(underDebris.refused).toBe(REFUSALS.singlePiece);
  });

  test("each rule turned off by its parameter refuses nothing", () => {
    const parent = body(PARENT);
    const slow = [piece(101, { deltaVMps: 0.2 }), piece(102, { deltaVMps: 0.2 })];
    const launch = launchOf([parent, ...slow.map((p) => p.body)]);
    const judgement = judgePieces(subjectOf(parent), launch, verdictOf(), slow.map((p) => p.reading), NO_MEMORY, viewOf(new Map([[PARENT, EPOCH - HOUR]]), { confirmDeltaVMinMps: 0, reentryRefuses: false }));
    expect(judgement.refused).toBe(0);
    expect(judgement.pieces).toHaveLength(2);
  });
});

describe("the launch's own rules", () => {
  const subject = { key: LAUNCH, number: PARENT, bodyClass: "payload" as const };

  test("an old quiet launch refuses nothing", () => {
    expect(launchRefusals(subject, verdictOf(), params).refused).toBe(0);
  });

  test("a launch younger than the young-launch days is refused, unless the attribution's parameter lets it", () => {
    expect(launchRefusals(subject, verdictOf({ launchAgeDays: 10 }), params).refused).toBe(REFUSALS.youngLaunch);
    expect(launchRefusals(subject, verdictOf({ launchAgeDays: 10 }), params, { launchesInRun: 0, youngExempt: true }).refused).toBe(0);
  });

  test("a launch whose background rate passes the bound is an old cloud's backlog, refused", () => {
    const refusal = launchRefusals(subject, verdictOf({ rate: 3, backgroundBodies: 80 }), params);
    expect(refusal.refused).toBe(REFUSALS.background);
    expect(refusal.reasons[0]).toContain("80 new bodies");
  });

  test("a run that brought new bodies to more old launches than the bound is a batch, on the attribution alone", () => {
    expect(launchRefusals(subject, verdictOf(), params, { launchesInRun: 3, youngExempt: false }).refused).toBe(REFUSALS.batch);
    expect(launchRefusals(subject, verdictOf(), params, { launchesInRun: 2, youngExempt: false }).refused).toBe(0);
  });

  test("a crewed station's launch is refused, and a crewed or cargo craft's for any body but its rocket body", () => {
    expect(launchRefusals({ ...subject, key: "1998-067" }, verdictOf(), params).refused).toBe(REFUSALS.station);
    const craft = { ...params, visitingLaunches: [LAUNCH] };
    expect(launchRefusals(subject, verdictOf(), craft).refused).toBe(REFUSALS.visiting);
    expect(launchRefusals({ ...subject, bodyClass: "rocket body" }, verdictOf(), craft).refused).toBe(0);
  });
});

describe("an analyst range's rules", () => {
  test("an analyst range's pieces confirm nothing unless the parameter lets them, and then only pieces the plane test names one parent for", () => {
    const one = [piece(101).reading];
    expect(analystRefusals(one, params)).toBe(REFUSALS.analyst);
    const on = { ...params, analystAttributes: true };
    expect(analystRefusals(one, on)).toBe(0);
    expect(analystRefusals([{ ...one[0]!, within: [PARENT, 2] }], on)).toBe(REFUSALS.ambiguous);
  });
});

/** A timing of the pieces against the parent: `timed` of `tried` crossing it, three quarters within `dev75Hours`, at the median instant. */
function timing(options: { missKm?: number; tried?: number; timed?: number; dev50Hours?: number; dev75Hours?: number; medianAt?: number; ageDays?: number } = {}): PiecesEventTime {
  const medianAt = options.medianAt ?? EPOCH - DAY;
  const origin: PiecesOrigin = { tried: options.tried ?? 3, timed: options.timed ?? 3, medianAt, dev50Hours: options.dev50Hours ?? 1, dev75Hours: options.dev75Hours ?? 2, phase50: 0.01, phase75: 0.02, spreadHours: 1, sigmaMinutes: 30, ageDays: options.ageDays ?? 2, missKm: 5 } as PiecesOrigin;
  return { at: medianAt, from: medianAt - HOUR, to: medianAt + HOUR, sigmaMinutes: 30, missKm: options.missKm ?? 5, pieces: 3, spreadMinutes: 10, crossings: 1, gridSeconds: 60, points: 100, pieceCrossings: [], origin };
}

describe("the rules on the pieces timed back against an alert's parent", () => {
  const alert = { number: PARENT, tStep: EPOCH - DAY };
  const pieces = [piece(101).reading, piece(102).reading, piece(103).reading, piece(104).reading, piece(105).reading];

  test("pieces crossing the parent at its step refuse nothing", () => {
    expect(alertTimingRefusals(alert, pieces, timing(), verdictOf(), false, params).refused).toBe(0);
  });

  test("an analyst range's pieces must be timed and converge on the parent", () => {
    const on = { ...params, analystAttributes: true, attributionMissKmMax: 50 };
    expect(alertTimingRefusals(alert, pieces, null, verdictOf(), true, on).refused).toBe(REFUSALS.untimed);
    expect(alertTimingRefusals(alert, pieces, timing({ missKm: 80 }), verdictOf(), true, on).refused).toBe(REFUSALS.miss);
    expect(alertTimingRefusals(alert, pieces, null, verdictOf(), false, on).refused).toBe(0);
  });

  test("with the common-origin test on, pieces that do not share an instant are refused", () => {
    const tested = { ...params, originHoursBase: 6 };
    expect(alertTimingRefusals(alert, pieces, timing({ dev75Hours: 40, dev50Hours: 30 }), verdictOf(), false, tested).refused).toBe(REFUSALS.origin);
    expect(alertTimingRefusals(alert, pieces, null, verdictOf(), false, tested).refused).toBe(REFUSALS.origin);
  });

  test("pieces crossing the parent too far from its step, or too soon after the launch was first seen, are not the step's", () => {
    const bounded = { ...params, originStepHoursMax: 48 };
    expect(alertTimingRefusals(alert, pieces, timing({ medianAt: alert.tStep + 72 * HOUR }), verdictOf(), false, bounded).refused).toBe(REFUSALS.origin);
    expect(alertTimingRefusals(alert, pieces, timing({ ageDays: 10 }), verdictOf({ launchAgeDays: 5 }), false, params).refused).toBe(REFUSALS.origin);
  });

  test("a small batch on a step is held to the small-batch rule only where the parameter asks", () => {
    const small = pieces.slice(0, 3);
    const loose = timing({ dev75Hours: 100, dev50Hours: 90 });
    expect(alertTimingRefusals(alert, small, loose, verdictOf(), false, params).refused).toBe(0);
    expect(alertTimingRefusals(alert, small, loose, verdictOf(), false, { ...params, smallBatchStepsToo: true }).refused).toBe(REFUSALS.smallBatch);
  });
});
