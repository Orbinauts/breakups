import { readTwoLineElements } from "@orbinauts/engine";
import { describe, expect, test } from "vitest";
import { catalogueNumber, epochMs, parsePair } from "./strip.ts";

// The ISS set Wikipedia's two-line element set article prints, from 2008.
const LINE1 = "1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927";
const LINE2 = "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537";

describe("a pair of lines read by column", () => {
  test("agrees with the engine's reader, field by field, at the format's own precision", () => {
    const set = parsePair(LINE1, LINE2);
    expect(typeof set).toBe("object");
    if (typeof set === "string") return;
    const elements = readTwoLineElements(LINE1, LINE2);
    expect(set.number).toBe(elements.catalogueNumber);
    expect(set.designator).toBe(elements.omm.OBJECT_ID);
    expect(set.epoch).toBeCloseTo(elements.epoch.getTime(), -1);
    expect(set.meanMotion / 1e8).toBe(elements.omm.MEAN_MOTION);
    expect(set.eccentricity / 1e7).toBe(elements.omm.ECCENTRICITY);
    expect(set.inclination / 1e4).toBe(elements.omm.INCLINATION);
    expect(set.raan / 1e4).toBe(elements.omm.RA_OF_ASC_NODE);
    expect(set.argOfPerigee / 1e4).toBe(elements.omm.ARG_OF_PERICENTER);
    expect(set.meanAnomaly / 1e4).toBe(elements.omm.MEAN_ANOMALY);
    expect(set.bstar).toBeCloseTo(elements.omm.BSTAR, 9);
    expect(set.meanMotionDot / 1e8).toBe(elements.omm.MEAN_MOTION_DOT);
    expect(set.meanMotionDdot).toBe(elements.omm.MEAN_MOTION_DDOT);
    expect(set.elementSetNumber).toBe(elements.omm.ELEMENT_SET_NO);
    expect(set.revAtEpoch).toBe(elements.omm.REV_AT_EPOCH);
  });

  test("refuses a wrong checksum, mismatched objects and a short line, naming why", () => {
    expect(parsePair(LINE1.slice(0, 68) + "0", LINE2)).toBe("line 1 fails its checksum");
    expect(parsePair(LINE1, LINE2.replace("2 25544", "2 25545"))).toMatch(/checksum|different objects/);
    expect(parsePair(LINE1.slice(0, 60), LINE2)).toBe("a line shorter than 68 characters");
  });

  test("reads a space-padded number and an Alpha-5 number", () => {
    expect(catalogueNumber("   50")).toBe(50);
    expect(catalogueNumber("A0001")).toBe(100001);
    expect(catalogueNumber("Z9999")).toBe(339999);
    expect(catalogueNumber("I0001")).toBeNaN();
  });

  test("reads the epoch to the format's precision", () => {
    expect(epochMs("08264.51782528")).toBe(Date.UTC(2008, 8, 20) + 0.51782528 * 86_400_000);
    expect(epochMs("57001.5")).toBe(Date.UTC(1957, 0, 1, 12));
  });
});
