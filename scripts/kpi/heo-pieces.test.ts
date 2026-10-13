import { describe, expect, test } from "vitest";
import { normalAngleDeg, planeDistance, type PlaneOrbit } from "../../src/fragments.ts";
import { DETECTOR_PARAMETERS, type BodyClass } from "../../src/index.ts";
import { nodePrecessionDegPerDay } from "../../src/series.ts";
import type { SatcatRow } from "../truth/parse-gcat-satcat.ts";
import { FRAGMENTS_PLANE, catalogueOver, fragmentsOf, type BodyFact } from "./catalogue.ts";
import { attributionOf, boundsOf, carryBoundsOf, dragBandOf, gcatPiecesOf, impulseTiltDeg, nodeAtEventDifferenceDeg, normalDeltaVMps, readEvent, tally, twinEventOf, type Attribution, type EventReading, type PieceReading } from "./heo-pieces.ts";

/**
 * The measurement of the plane test on the pieces of highly elliptical
 * orbits, on its pure parts: the angle between two orbits' normals, the
 * tilt a normal impulse gives at the parent's slowest
 * point, which body the catalogue says a piece came from, and the count of
 * an event's fresh pieces by each bound, on a synthetic catalogue.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2009, 2, 8, 10);

/** A plane orbit: a Molniya-like one unless said (a 26,550 km, e 0.72, two revolutions a day). */
const orbit = (inclinationDeg: number, raanDeg: number, epochMs = T0, shape: Partial<PlaneOrbit> = {}): PlaneOrbit => ({ epochMs, aKm: 26_550, eccentricity: 0.72, inclinationDeg, raanDeg, meanMotion: 2.006, ...shape });

describe("the angle between two orbits' normals", () => {
  test("at near-zero inclination is the inclination vectors' distance, whatever the nodes", () => {
    // Inclination vectors 0.02° at 0° and 0.3° at 120°: |v1 - v2|² = 0.02² + 0.3² + 2·0.02·0.3·0.5 = 0.0964.
    expect(normalAngleDeg(orbit(0.02, 0), orbit(0.3, 120), T0)).toBeCloseTo(0.31048, 4);
  });

  test("at high inclination counts a node difference by the sine of the inclination", () => {
    expect(normalAngleDeg(orbit(90, 100), orbit(90, 101), T0)).toBeCloseTo(1, 4);
    // sin 64.9° = 0.90557.
    expect(normalAngleDeg(orbit(64.9, 100), orbit(64.9, 101), T0)).toBeCloseTo(0.90557, 3);
    expect(normalAngleDeg(orbit(64.9, 100), orbit(65.9, 100), T0)).toBeCloseTo(1, 6);
  });

  test("carries the parent's node to the piece's epoch at its own J2 rate", () => {
    const shape = { aKm: 7200, eccentricity: 0.001, meanMotion: 14.2 };
    const rate = nodePrecessionDegPerDay(7200, 0.001, 98, 14.2);
    const parent = orbit(98, 100, T0 - 5 * DAY, shape);
    const piece = orbit(98, 100 + rate * 35, T0 + 30 * DAY, shape);
    expect(normalAngleDeg(parent, piece, T0)).toBeLessThan(1e-6);
  });
});

describe("the node difference at the event's instant (issue #42)", () => {
  const leo = { aKm: 7200, eccentricity: 0.001, meanMotion: 14.2 };
  const lower = { aKm: 6950, eccentricity: 0.004, meanMotion: 14.97 };
  const parentRate = nodePrecessionDegPerDay(7200, 0.001, 98, 14.2);
  const pieceRate = nodePrecessionDegPerDay(6950, 0.004, 98.3, 14.97);
  const parent = orbit(98, 100, T0 - 5 * DAY, leo);
  /** The parent's node at the event, its last set's carried five days at its own rate. */
  const atEvent = 100 + parentRate * 5;

  test("carries each node to the event at its own J2 rate: a piece on another orbit, on the parent's plane at the event, is on it", () => {
    // The two rates differ by 0.16°/day, so over 30 days the nodes part by 4.7°, all of it J2.
    expect(Math.abs(pieceRate - parentRate) * 30).toBeCloseTo(4.72, 2);
    const piece = orbit(98.3, atEvent + pieceRate * 30, T0 + 30 * DAY, lower);
    expect(nodeAtEventDifferenceDeg(parent, piece, T0)).toBeCloseTo(0, 9);
    expect(nodeAtEventDifferenceDeg(parent, orbit(98.3, atEvent + pieceRate * 30 + 2, T0 + 30 * DAY, lower), T0)).toBeCloseTo(2, 9);
  });

  test("is the node difference today's plane test already reads, whatever the orbits", () => {
    const pieces = [orbit(98.3, 37, T0 + 30 * DAY, lower), orbit(64.9, 210, T0 + 104 * DAY), orbit(0.4, 300, T0 + 12 * DAY, { aKm: 42_100, eccentricity: 0.002, meanMotion: 1.01 })];
    for (const piece of pieces) expect(nodeAtEventDifferenceDeg(parent, piece, T0)).toBeCloseTo(planeDistance(parent, piece, T0, DETECTOR_PARAMETERS, Number.POSITIVE_INFINITY).deltaNodeDeg, 9);
  });
});

describe("the node difference with drag bounded (issue #42)", () => {
  const leo = { aKm: 7200, eccentricity: 0.001, meanMotion: 14.2 };
  const decayed = { aKm: 6950, eccentricity: 0.004, meanMotion: 14.97 };
  const parentRate = nodePrecessionDegPerDay(7200, 0.001, 98, 14.2);
  const pieceRate = nodePrecessionDegPerDay(6950, 0.004, 98, 14.97);
  const parent = orbit(98, 100, T0, leo);

  test("is zero where a mean rate between the parent's and the piece's own closes the node: a piece that sank from the parent's orbit by drag", () => {
    // The piece's node moved at the rates' mean over 40 days: carried at its own rate it is 40 · (mean - own) off, at the parent's 40 · (mean - parent's).
    const piece = orbit(98, 100 + ((parentRate + pieceRate) / 2) * 40, T0 + 40 * DAY, decayed);
    const band = dragBandOf(parent, piece, T0);
    expect(band.ownRateDeg).toBeCloseTo(20 * (parentRate - pieceRate), 9);
    expect(band.parentRateDeg).toBeCloseTo(20 * (pieceRate - parentRate), 9);
    expect(band.leastDeg).toBe(0);
  });

  test("is the nearer end of the band where no rate between them closes it", () => {
    // The lower piece's rate is the faster: carried at the parent's rate it is 1.5° behind, at its own 40 days of the rates' difference further, so no rate between them closes it.
    const piece = orbit(98, 100 + parentRate * 40 - 1.5, T0 + 40 * DAY, decayed);
    const band = dragBandOf(parent, piece, T0);
    expect(band.ownRateDeg).toBeCloseTo(-1.5 - 40 * (pieceRate - parentRate), 9);
    expect(band.parentRateDeg).toBeCloseTo(-1.5, 9);
    expect(band.leastDeg).toBeCloseTo(-1.5, 9);
  });
});

describe("the tilt a normal impulse gives at the parent's slowest point", () => {
  test("is far larger at a Molniya-like apogee than in a low circular orbit", () => {
    // Apogee speed sqrt(mu/a (1-e)/(1+e)) = 1.5633 km/s: 100 m/s tilts the plane by atan(0.1/1.5633) = 3.660°.
    expect(impulseTiltDeg(orbit(64.9, 0), 100)).toBeCloseTo(3.66, 3);
    // A circular orbit at 7,000 km moves at 7.546 km/s everywhere: 100 m/s tilts it by 0.759°.
    expect(impulseTiltDeg(orbit(98, 0, T0, { aKm: 7000, eccentricity: 0 }), 100)).toBeCloseTo(0.7592, 3);
  });

  test("read backwards, is the normal speed change an angle needs", () => {
    // 19° at the Molniya-like apogee: 1563.3 m/s x tan 19° = 538.3 m/s.
    expect(normalDeltaVMps(orbit(64.9, 0), 19)).toBeCloseTo(538.3, 0);
  });

  test("cannot reach a right angle or more: no normal impulse tilts a plane that far", () => {
    expect(normalDeltaVMps(orbit(64.9, 0), 90)).toBe(Number.POSITIVE_INFINITY);
    expect(normalDeltaVMps(orbit(70.8, 0), 133)).toBe(Number.POSITIVE_INFINITY);
  });
});

/** A row of GCAT's satellite catalogue: a propulsion-breakup piece of the ullage motor 21220 separated on 2009 Mar 8 unless said. */
const row = (satcat: string, cells: Partial<SatcatRow> = {}): SatcatRow => ({ jcat: `S${satcat}`, satcat, launchTag: "1991-025", piece: "1991-025X", type: "D  P", name: "COSMOS 2139-41 ULLAGE MOTOR DEB", ldate: "1991 Apr 4", parent: "S21220", sdate: "2009 Mar 8", ddate: "-", status: "O", ...cells });

describe("which body the catalogue says a piece came from", () => {
  const event = { parent: 21220, from: Date.UTC(2009, 2, 8, 10), to: Date.UTC(2009, 2, 8, 10) };

  test("is read from GCAT's parent and separation date, by catalogue number", () => {
    const pieces = gcatPiecesOf([row("34567"), row("34568", { parent: "S21226", sdate: "2001 Jun 16?" }), row("34569", { parent: "-", sdate: "-" }), row("21220", { type: "R", parent: "-", sdate: "-" })]);
    expect(pieces.get(34567)).toEqual({ parent: 21220, from: Date.UTC(2009, 2, 8), to: Date.UTC(2009, 2, 9) });
    expect(pieces.get(34568)).toEqual({ parent: 21226, from: Date.UTC(2001, 5, 15), to: Date.UTC(2001, 5, 18) });
    expect(pieces.get(34569)).toEqual({ parent: null, from: null, to: null });
    expect(pieces.has(21220)).toBe(false);
  });

  test("is the event's where the parent is the event's and the separation within three days of its window", () => {
    expect(attributionOf({ parent: 21220, from: Date.UTC(2009, 2, 10), to: Date.UTC(2009, 2, 11) }, event)).toBe("event");
    expect(attributionOf({ parent: 21220, from: Date.UTC(2009, 2, 15), to: Date.UTC(2009, 2, 16) }, event)).toBe("parent, other separation");
    expect(attributionOf({ parent: 21226, from: Date.UTC(2009, 2, 8), to: Date.UTC(2009, 2, 9) }, event)).toBe("other body");
    expect(attributionOf({ parent: null, from: null, to: null }, event)).toBe("unattributed");
    expect(attributionOf(undefined, event)).toBe("unattributed");
  });
});

describe("an event's fresh pieces", () => {
  const parentOrbit = orbit(64.9, 100, T0 - 2 * DAY);
  const rate = nodePrecessionDegPerDay(26_550, 0.72, 64.9, 2.006);
  /** A body of the catalogue: under the ullage motor's launch, debris, first published and first set a week after the event, on the parent's plane (its node where the parent's own rate carries it) unless said. */
  const fact = (number: number, extra: Partial<BodyFact> = {}, plane: Partial<PlaneOrbit> = {}): BodyFact => {
    const firstEpoch = extra.firstEpoch ?? T0 + 7 * DAY;
    const node = 100 + (rate * (firstEpoch - parentOrbit.epochMs)) / DAY;
    return { number, launch: "1991-025", name: "", bodyClass: "debris" as BodyClass, decayMs: null, launchMs: null, firstClock: firstEpoch, firstEpoch, ...extra, orbit: { ...orbit(64.9, node, firstEpoch), ...plane } };
  };
  const bodies = [
    fact(21220, { bodyClass: "rocket body", firstEpoch: Date.UTC(1991, 3, 5) }),
    // The catalogue's mark at the event: a body of another launch numbered 34000, published a year before.
    fact(34000, { launch: "2008-001", firstEpoch: T0 - 365 * DAY }),
    fact(33990, { firstEpoch: T0 + 3 * DAY }), // under the mark: not fresh
    fact(34001),
    fact(34002, {}, { inclinationDeg: 66.9 }), // two degrees off
    fact(34003, { bodyClass: "payload" }), // not a fragment's class
    fact(34004, { firstEpoch: T0 + 200 * DAY }), // after the window
    fact(34005, { launch: "2009-010" }), // another launch: a stranger
  ];
  const catalogue = catalogueOver(new Map(bodies.map((b) => [b.number, b])), () => ({ epoch: parentOrbit.epochMs, orbit: parentOrbit }));
  const event = { id: "21220:2009-03-08", name: "COSMOS 2139-41 ULLAGE MOTOR", parent: 21220, launch: "1991-025", from: T0, to: T0, eventMs: T0, marginMs: 5 * DAY };
  const gcat = gcatPiecesOf([row("34001"), row("34002", { parent: "S21226" })]);

  test("are the pieces the scorecard counts, each with its angles and whose the catalogue says it is", () => {
    const reading = readEvent(catalogue, event, gcat);
    expect(reading?.pieces.map((p) => p.number)).toEqual([34001, 34002]);
    const [onPlane, tilted] = reading?.pieces ?? [];
    expect(onPlane).toMatchObject({ passesToday: true, attribution: "event", gcatParent: 21220, daysAfterEvent: 7 });
    expect(onPlane?.normalAngleDeg).toBeLessThan(1e-6);
    expect(tilted).toMatchObject({ passesToday: false, attribution: "other body", gcatParent: 21226 });
    // Two degrees in inclination, and a hair of node from its own J2 rate since the event.
    expect(tilted?.normalAngleDeg).toBeCloseTo(2, 2);
    // 2° at the parent's apogee speed of 1,563 m/s: 1563.3 x tan 2° = 54.6 m/s.
    expect(tilted?.neededDeltaVMps).toBeCloseTo(54.6, 0);
    expect(tilted?.inclinationDeltaVMps).toBeCloseTo(54.6, 0);
    expect(reading?.regime).toBe("HEO");
    expect(reading?.strangers.map((p) => p.number)).toEqual([34005]);
  });

  test("pass the scorecard's test exactly where the scorecard's count does", () => {
    const reading = readEvent(catalogue, event, gcat);
    expect(reading?.pieces.filter((p) => p.passesToday || p.normalAngleDeg <= FRAGMENTS_PLANE.planeNormalAngleMaxDeg).length).toBe(fragmentsOf(catalogue, 21220, "1991-025", T0, T0, T0, 5 * DAY).inPlane);
  });

  test("are not read where the parent had no set before the event", () => {
    const blind = catalogueOver(catalogue.bodies, () => null);
    expect(readEvent(blind, event, gcat)).toBeNull();
  });
});

describe("an event's pieces read by the carries of issue #42", () => {
  const leo = { aKm: 7200, eccentricity: 0.001, meanMotion: 14.2 };
  const decayed = { aKm: 6950, eccentricity: 0.004, meanMotion: 14.97 };
  const raised = { aKm: 7450, eccentricity: 0.004, meanMotion: 13.49 };
  const parentRate = nodePrecessionDegPerDay(7200, 0.001, 98, 14.2);
  const decayedRate = nodePrecessionDegPerDay(6950, 0.004, 98, 14.97);
  const raisedRate = nodePrecessionDegPerDay(7450, 0.004, 98, 13.49);
  const parentOrbit = orbit(98, 100, T0, leo);
  const body = (number: number, plane: PlaneOrbit): BodyFact => ({ number, launch: "2007-001", name: "", bodyClass: "debris", decayMs: null, launchMs: null, firstClock: plane.epochMs, firstEpoch: plane.epochMs, orbit: plane });
  const at = T0 + 120 * DAY;
  const bodies = [
    body(30000, { ...parentOrbit, epochMs: Date.UTC(2007, 0, 11) }),
    // On the parent's plane at the event, each node moved at its own rate since.
    body(30001, orbit(98.05, 100 + decayedRate * 120, at, decayed)),
    // Sank by drag: its node moved at the mean of the parent's rate and its own.
    body(30002, orbit(98.05, 100 + ((parentRate + decayedRate) / 2) * 120, at, decayed)),
    // Raised, with the same mean-rate node: drag cannot have raised it, so the band is not read for it where it is asked for below the parent.
    body(30003, orbit(98.05, 100 + ((parentRate + raisedRate) / 2) * 120, at, raised)),
  ];
  const catalogue = catalogueOver(new Map(bodies.map((b) => [b.number, b])), () => ({ epoch: parentOrbit.epochMs, orbit: parentOrbit }));
  const event = { id: "30000:2009-03-08", name: "X", parent: 30000, launch: "2007-001", from: T0, to: T0, eventMs: T0, marginMs: DAY };

  test("carry the node to the event's instant as today's test does, and read drag's band beside it", () => {
    const reading = readEvent(catalogue, event, new Map());
    const [own, sank, raisedPiece] = reading?.pieces ?? [];
    expect(reading?.pieces.map((p) => p.number)).toEqual([30001, 30002, 30003]);
    for (const p of reading?.pieces ?? []) expect(p.deltaNodeAtEventDeg).toBeCloseTo(p.deltaNodeDeg, 9);
    expect(own).toMatchObject({ passesToday: true, passesAtEvent: true, passesDragBand: true, passesDragBandBelow: true });
    // Half of 120 days of the rates' difference is 7.2° of node for the sunk piece and 6.1° for the raised one, past the test's 4.5° at 98°.
    expect((60 * (decayedRate - parentRate)).toFixed(1)).toBe("7.2");
    expect((60 * (parentRate - raisedRate)).toFixed(1)).toBe("6.1");
    expect(sank).toMatchObject({ passesToday: false, passesAtEvent: false, passesDragBand: true, passesDragBandBelow: true });
    expect(raisedPiece).toMatchObject({ passesToday: false, passesAtEvent: false, passesDragBand: true, passesDragBandBelow: false });
  });
});

describe("a dropped piece's twin", () => {
  const rate = nodePrecessionDegPerDay(26_550, 0.72, 64.9, 2.006);
  // Twin ullage motors of one launch: one plane once, five degrees of node apart by the years of slightly different rates.
  const first = { id: "33472:2016-03-26", launch: "2008-067", parentOrbit: orbit(64.9, 100, T0 - DAY), eventMs: T0 };
  const twin = { id: "33473:2016-06-01", launch: "2008-067", parentOrbit: orbit(64.9, 105 + rate * 66, T0 + 66 * DAY), eventMs: T0 + 67 * DAY };
  const elsewhere = { ...twin, id: "99999:2016-06-01", launch: "2010-001" };

  test("is the other event of the launch whose parent's plane keeps it, the piece first set after that event", () => {
    // First set on day 104 after the first event, on the twin's plane.
    const piece = orbit(64.9, 105 + rate * 104, T0 + 104 * DAY);
    expect(twinEventOf(piece, first, [first, twin, elsewhere])).toBe("33473:2016-06-01");
  });

  test("is none where the piece was set before the other event, or lies on no other parent's plane", () => {
    expect(twinEventOf(orbit(64.9, 105 + rate * 40, T0 + 40 * DAY), first, [first, twin])).toBeNull();
    expect(twinEventOf(orbit(64.9, 112 + rate * 104, T0 + 104 * DAY), first, [first, twin])).toBeNull();
  });
});

describe("a bound's count over events", () => {
  /** A piece read: the impulse its inclination difference alone needs is the one its normal angle needs unless said. */
  const piece = (passesToday: boolean, normalAngleDeg: number, neededDeltaVMps: number, attribution: Attribution, inclinationDeltaVMps = neededDeltaVMps): PieceReading => ({ number: 0, daysAfterEvent: 10, deltaInclinationDeg: 0, deltaNodeDeg: 0, normalAngleDeg, passesToday, neededDeltaVMps, inclinationDeltaVMps, attribution, gcatParent: null, deltaNodeAtEventDeg: 0, passesAtEvent: passesToday || normalAngleDeg <= 1, passesDragBand: passesToday || normalAngleDeg <= 1, passesDragBandBelow: passesToday || normalAngleDeg <= 1 });
  const reading = (pieces: PieceReading[], strangers: PieceReading[] = []): EventReading => ({ id: "x", name: "x", parent: 1, launch: "2009-001", from: T0, to: T0, eventMs: T0, marginMs: 0, parentOrbit: orbit(64.9, 0), regime: "HEO", apogeeSpeedKmps: 1.56, pieces, strangers });
  const readings = [
    reading([piece(true, 0.1, 3, "event"), piece(false, 0.8, 22, "event"), piece(false, 3, 82, "event"), piece(false, 3, 82, "other body"), piece(true, 1.2, 120, "other body")], [piece(false, 0.9, 25, "unattributed")]),
    // A piece six degrees off in node but on the parent's inclination.
    reading([piece(false, 12, 330, "unattributed"), piece(false, 6, 300, "event", 10), piece(false, 0.95, 60, "parent, other separation")]),
  ];
  const none = { all: 0, event: 0, "parent, other separation": 0, "other body": 0, unattributed: 0, strangers: 0, eventsWithAny: 0 };

  test("counts the pieces it keeps by whose they are, and the strangers it admits", () => {
    const bounds = boundsOf([50, 100]);
    expect(bounds.map((b) => b.name)).toEqual(["today's test", "normal within 0.5°", "normal within 1°", "today's or normal within 1°", "impulse 50 m/s", "impulse 100 m/s", "today's or impulse 50 m/s", "today's or impulse 100 m/s", "today's or normal within 1° or impulse 50 m/s", "today's or normal within 1° or impulse 100 m/s", "inclination alone, impulse 50 m/s", "inclination alone, impulse 100 m/s"]);
    const byName = new Map(bounds.map((b) => [b.name, tally(readings, b)]));
    expect(byName.get("today's test")).toEqual({ ...none, all: 2, event: 1, "other body": 1, eventsWithAny: 1 });
    expect(byName.get("normal within 1°")).toEqual({ ...none, all: 3, event: 2, "parent, other separation": 1, strangers: 1, eventsWithAny: 2 });
    expect(byName.get("impulse 50 m/s")).toEqual({ ...none, all: 2, event: 2, strangers: 1, eventsWithAny: 1 });
    expect(byName.get("impulse 100 m/s")).toEqual({ ...none, all: 5, event: 3, "other body": 1, "parent, other separation": 1, strangers: 1, eventsWithAny: 2 });
    expect(byName.get("today's or impulse 50 m/s")).toEqual({ ...none, all: 3, event: 2, "other body": 1, strangers: 1, eventsWithAny: 1 });
    expect(byName.get("today's or normal within 1° or impulse 50 m/s")).toEqual({ ...none, all: 4, event: 2, "other body": 1, "parent, other separation": 1, strangers: 1, eventsWithAny: 2 });
    expect(byName.get("inclination alone, impulse 50 m/s")).toEqual({ ...none, all: 3, event: 3, strangers: 1, eventsWithAny: 2 });
  });

  test("by the carries of issue #42: the scorecard's test, at the event's instant, and with drag's band", () => {
    const carried = (passesAtEvent: boolean, passesDragBand: boolean, passesDragBandBelow: boolean, attribution: Attribution): PieceReading => ({ ...piece(passesAtEvent, 3, 82, attribution), passesAtEvent, passesDragBand, passesDragBandBelow });
    const events = [reading([carried(true, true, true, "event"), carried(false, true, true, "event"), carried(false, true, false, "event")], [carried(false, true, false, "unattributed"), carried(false, false, false, "unattributed")])];
    const bounds = carryBoundsOf();
    expect(bounds.map((b) => b.name)).toEqual(["the scorecard's test (#15's form)", "the scorecard's test, nodes at the event's instant", "the scorecard's test, drag bounded", "the scorecard's test, drag bounded below the parent"]);
    expect(bounds.map((b) => tally(events, b))).toEqual([
      { ...none, all: 1, event: 1, eventsWithAny: 1 },
      { ...none, all: 1, event: 1, eventsWithAny: 1 },
      { ...none, all: 3, event: 3, strangers: 1, eventsWithAny: 1 },
      { ...none, all: 2, event: 2, eventsWithAny: 1 },
    ]);
  });
});
