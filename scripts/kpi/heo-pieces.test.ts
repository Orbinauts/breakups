import { describe, expect, test } from "vitest";
import { normalAngleDeg, type PlaneOrbit } from "../../src/fragments.ts";
import { DETECTOR_PARAMETERS, type BodyClass } from "../../src/index.ts";
import { nodePrecessionDegPerDay } from "../../src/series.ts";
import type { SatcatRow } from "../truth/parse-gcat-satcat.ts";
import { FRAGMENTS_PLANE, catalogueOver, fragmentsOf, type BodyFact } from "./catalogue.ts";
import { attributionOf, boundsOf, gcatPiecesOf, impulseTiltDeg, normalDeltaVMps, readEvent, tally, type Attribution, type EventReading, type PieceReading } from "./heo-pieces.ts";

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

describe("a bound's count over events", () => {
  /** A piece read: the impulse its inclination difference alone needs is the one its normal angle needs unless said. */
  const piece = (passesToday: boolean, normalAngleDeg: number, neededDeltaVMps: number, attribution: Attribution, inclinationDeltaVMps = neededDeltaVMps): PieceReading => ({ number: 0, daysAfterEvent: 10, deltaInclinationDeg: 0, deltaNodeDeg: 0, normalAngleDeg, passesToday, neededDeltaVMps, inclinationDeltaVMps, attribution, gcatParent: null });
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
});
