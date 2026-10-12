import { describe, expect, test } from "vitest";
import { DETECTOR_PARAMETERS, PARAMETER_PROVENANCE, parametersWith } from "./params.ts";

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

  test("a fitted parameter names the fitting note it was read off, a physical or policy one says what it rests on", () => {
    for (const [name, provenance] of Object.entries(PARAMETER_PROVENANCE)) {
      expect(["physical", "policy", "fitted"], name).toContain(provenance.kind);
      expect(provenance.source.length, name).toBeGreaterThan(10);
      if (provenance.kind === "fitted") expect(provenance.source, name).toMatch(/^(?:as \w+|d\d+-(?:fitting|scope|confirmed|three-axis-trigger)\.md, )/);
    }
  });

  test("the overrides lay over the defaults one level deep", () => {
    expect(parametersWith(undefined)).toBe(DETECTOR_PARAMETERS);
    expect(parametersWith({ cloudMemoryDays: 0 })).toMatchObject({ cloudMemoryDays: 0, freshPieceDays: DETECTOR_PARAMETERS.freshPieceDays });
  });
});
