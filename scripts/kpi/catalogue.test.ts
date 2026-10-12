import { describe, expect, test } from "vitest";
import { DETECTOR_PARAMETERS } from "../../src/index.ts";
import { semiMajorAxisOf } from "../../src/elements.ts";
import type { PlaneOrbit } from "../../src/fragments.ts";
import { nodePrecessionDegPerDay } from "../../src/series.ts";
import { catalogueOver, fragmentsOf, type BodyFact, type Catalogue } from "./catalogue.ts";
import { DAY_MS } from "./replay.ts";

/**
 * The Confirmed line's target test on catalogues of one launch: a parent
 * and the pieces published after its event, each piece's plane set by
 * hand against the parent's. The scorecard's plane test is its own: a
 * piece is in the parent's plane by the detector's test as it stood on
 * 2026-10-12, frozen, or by the angle between the two orbits' normals,
 * which holds where the node is undefined at near-zero inclination.
 */

const EVENT = Date.UTC(2024, 9, 19);
const LAUNCH = "2016-053";
const PARENT = 41748;

const orbitOf = (meanMotion: number, inclinationDeg: number, raanDeg: number, epochMs: number): PlaneOrbit => ({ epochMs, aKm: semiMajorAxisOf({ meanMotion }), eccentricity: 0.0005, inclinationDeg, raanDeg, meanMotion });

function fact(number: number, firstClock: number, orbit: PlaneOrbit): BodyFact {
  return { number, launch: LAUNCH, name: "", bodyClass: number === PARENT ? "payload" : "debris", decayMs: null, launchMs: Date.UTC(2016, 7, 24), firstClock, firstEpoch: orbit.epochMs, orbit };
}

/** A catalogue holding the parent, published years before the event with its last set the day before, and the pieces, numbered above it and published a week after. */
function catalogueWith(parentOrbit: PlaneOrbit, pieces: readonly PlaneOrbit[]): Catalogue {
  const bodies = new Map<number, BodyFact>([[PARENT, fact(PARENT, Date.UTC(2016, 7, 25), parentOrbit)]]);
  pieces.forEach((orbit, i) => bodies.set(62000 + i, fact(62000 + i, EVENT + 7 * DAY_MS, orbit)));
  return catalogueOver(bodies, (parent, from) => (parent === PARENT && parentOrbit.epochMs < from ? { epoch: parentOrbit.epochMs, orbit: parentOrbit } : null));
}

const inPlane = (catalogue: Catalogue): number => fragmentsOf(catalogue, PARENT, LAUNCH, EVENT, EVENT, EVENT, DAY_MS).inPlane;

describe("the Confirmed line's target test", () => {
  test("a geostationary parent's pieces, their nodes a third of the circle from its own but their planes within half a degree, lie in its plane", () => {
    const parent = orbitOf(1.0027, 0.02, 80, EVENT - DAY_MS);
    // At a fiftieth of a degree the node says nothing: the first two normals are under four hundredths of a degree from the parent's, the third four tenths.
    const pieces = [orbitOf(1.01, 0.02, 200, EVENT + 6 * DAY_MS), orbitOf(0.99, 0.03, 320, EVENT + 6 * DAY_MS), orbitOf(1.02, 0.4, 150, EVENT + 6 * DAY_MS)];
    expect(inPlane(catalogueWith(parent, pieces))).toBe(3);
  });

  test("a sun-synchronous parent's piece two degrees off in node still lies in its plane by the detector's test as it stood; one five degrees off lies outside both", () => {
    const parent = orbitOf(14.5, 98, 100, EVENT - DAY_MS);
    // The parent's node a week on, where the J2 precession of a sun-synchronous orbit (about a degree a day) carries a piece of the same period.
    const node = 100 + nodePrecessionDegPerDay(parent.aKm, parent.eccentricity, parent.inclinationDeg, parent.meanMotion) * 7;
    // Two degrees of node is within distance three, though at this inclination the normals are two degrees apart.
    expect(inPlane(catalogueWith(parent, [orbitOf(14.5, 98, node + 2, EVENT + 6 * DAY_MS)]))).toBe(1);
    // Five degrees of node is beyond distance three, and the normals are five degrees apart.
    expect(inPlane(catalogueWith(parent, [orbitOf(14.5, 98, node + 5, EVENT + 6 * DAY_MS)]))).toBe(0);
  });

  test("tuning the detector's plane test moves no target", () => {
    const parent = orbitOf(14.5, 98, 100, EVENT - DAY_MS);
    const node = 100 + nodePrecessionDegPerDay(parent.aKm, parent.eccentricity, parent.inclinationDeg, parent.meanMotion) * 7;
    const catalogue = catalogueWith(parent, [orbitOf(14.5, 98, node + 2, EVENT + 6 * DAY_MS), orbitOf(14.5, 98.5, node, EVENT + 6 * DAY_MS)]);
    const held = { ...DETECTOR_PARAMETERS };
    try {
      // The detector's tolerances tightened tenfold and its bound to a third: under them neither piece would be in the plane.
      Object.assign(DETECTOR_PARAMETERS, { planeInclinationToleranceDeg: 0.02, planeNodeToleranceDeg: 0.15, planeDistanceMax: 1, planeMaxDays: 1 });
      expect(inPlane(catalogue)).toBe(2);
    } finally {
      Object.assign(DETECTOR_PARAMETERS, held);
    }
    expect(inPlane(catalogue)).toBe(2);
  });
});
