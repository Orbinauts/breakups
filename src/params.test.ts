import { describe, expect, test } from "vitest";
import { DETECTOR_PARAMETERS, OFF, PARAMETER_PROVENANCE, isOn, parametersWith, type DetectorParameters } from "./params.ts";

/**
 * The freeze: every parameter is tagged with its kind and where its value
 * came from, a fitted one by the fitting note and the table in it, so the
 * table of parameters the scorecard records is never read without its
 * provenance.
 */

describe("the parameters' provenance", () => {
  test("every parameter has an entry, and every entry a parameter", () => {
    expect(Object.keys(PARAMETER_PROVENANCE).sort()).toEqual(Object.keys(DETECTOR_PARAMETERS).sort());
  });

  // A fitted value names the note it was read off; the environment's scatter tables were measured by the earlier attempt, before the training split existed, and say so.
  test("a fitted parameter names the fitting note it was read off, a physical or policy one says what it rests on", () => {
    for (const [name, provenance] of [...Object.entries(PARAMETER_PROVENANCE).filter(([key]) => key !== "legacy"), ...Object.entries(PARAMETER_PROVENANCE.legacy)] as [string, { kind: string; source: string }][]) {
      expect(["physical", "policy", "fitted"], name).toContain(provenance.kind);
      expect(provenance.source.length, name).toBeGreaterThan(10);
      if (provenance.kind === "fitted") expect(provenance.source, name).toMatch(/^(?:as \w+|d\d+-(?:fitting|scope|confirmed|three-axis-trigger)\.md, |the earlier attempt.s measurement)/);
    }
  });

  test("the overrides lay over the defaults one level deep", () => {
    expect(parametersWith(undefined)).toBe(DETECTOR_PARAMETERS);
    expect(parametersWith({ cloudMemoryDays: 0 })).toMatchObject({ cloudMemoryDays: 0, freshPieceDays: DETECTOR_PARAMETERS.freshPieceDays });
  });
});

describe("the off sentinel", () => {
  test("a threshold at OFF, or at minus OFF for a lower bound, is off; any value a rule could meet is on", () => {
    expect(isOn(OFF)).toBe(false);
    expect(isOn(-OFF)).toBe(false);
    expect(isOn(1e9)).toBe(false);
    for (const value of [0, 1, 48, -30, 1e6]) expect(isOn(value), String(value)).toBe(true);
  });

  test("OFF is finite, so the scorecard's record of the parameters keeps it", () => {
    expect(JSON.parse(JSON.stringify({ x: OFF })).x).toBe(OFF);
  });
});

describe("the legacy block", () => {
  // The options a phase built and left off by default, as the fitting notes record them (d3, d6, d9 to d11, d13): the live parameters are the rest.
  const LEGACY = ["occasionalRaisesNonPayload", "persistOnMeanStep", "againstDragMinRaises", "analystAttributes", "attributionYoungLaunch", "attributionMissKmMax", "attributionTwinsUnresolved", "originHoursBase", "originHoursPerDay", "originShareMin", "originMinPieces", "originPhaseMax", "originStepHoursMax", "attributionPrefersStage", "attributionConvergenceNames", "smallBatchStepsToo", "openOnThreeAxes"];

  test("holds the options off by default, and none of them is also a live parameter", () => {
    expect(Object.keys(DETECTOR_PARAMETERS.legacy).sort()).toEqual([...LEGACY].sort());
    for (const name of LEGACY) expect(name in DETECTOR_PARAMETERS, name).toBe(false);
  });

  test("every option in it is off: a switch false, a threshold at OFF; the origin gate's settings are read only with its base on", () => {
    const legacy = DETECTOR_PARAMETERS.legacy;
    for (const [name, value] of Object.entries(legacy)) if (typeof value === "boolean") expect(value, name).toBe(false);
    for (const name of ["againstDragMinRaises", "attributionMissKmMax", "originHoursBase", "originPhaseMax", "originStepHoursMax"] as const) expect(isOn(legacy[name]), name).toBe(false);
  });

  test("every option has its provenance, as every live parameter has", () => {
    expect(Object.keys(PARAMETER_PROVENANCE.legacy).sort()).toEqual([...LEGACY].sort());
    for (const [name, provenance] of Object.entries(PARAMETER_PROVENANCE.legacy)) expect(provenance.source.length, name).toBeGreaterThan(10);
  });

  test("an override of an option, in the block or by its bare name as a record written before the block, lands in the block over the defaults", () => {
    expect(parametersWith({ legacy: { ...DETECTOR_PARAMETERS.legacy, analystAttributes: true } }).legacy.analystAttributes).toBe(true);
    const old = parametersWith({ analystAttributes: true, cloudMemoryDays: 0 } as Partial<DetectorParameters>);
    expect(old.legacy).toEqual({ ...DETECTOR_PARAMETERS.legacy, analystAttributes: true });
    expect("analystAttributes" in old).toBe(false);
    expect(old.cloudMemoryDays).toBe(0);
  });
});
