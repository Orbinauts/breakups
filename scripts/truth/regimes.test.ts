import { describe, expect, test } from "vitest";
import { regimeAt, regimeRunsOf } from "./regimes.ts";

/** The parents' regimes as the derived file holds them: runs of one regime over a parent's sets, read back at an instant. */

const at = (iso: string): number => Date.parse(iso);

describe("a parent's regime over its sets", () => {
  test("is kept as the runs of one regime, each from its first set's epoch, whatever order the sets were read in", () => {
    const sets: [number, "LEO" | "MEO" | "HEO" | "GEO"][] = [
      [at("2010-03-01T00:00Z"), "HEO"],
      [at("2010-01-01T00:00Z"), "HEO"],
      [at("2010-05-01T12:30Z"), "GEO"],
      [at("2010-04-01T00:00Z"), "GEO"],
      [at("2010-06-01T00:00Z"), "GEO"],
    ];
    expect(regimeRunsOf(sets)).toEqual([
      ["2010-01-01T00:00Z", "HEO"],
      ["2010-04-01T00:00Z", "GEO"],
    ]);
  });

  test("is read at an instant from the last set before it, and is unknown before the first", () => {
    const runs: [string, "LEO" | "MEO" | "HEO" | "GEO"][] = [
      ["2010-01-01T00:00Z", "HEO"],
      ["2010-04-01T00:00Z", "GEO"],
    ];
    expect(regimeAt(runs, at("2009-12-31T00:00Z"))).toBe("unknown");
    expect(regimeAt(runs, at("2010-04-01T00:00Z"))).toBe("HEO");
    expect(regimeAt(runs, at("2010-04-01T00:01Z"))).toBe("GEO");
    expect(regimeAt(undefined, at("2010-04-01T00:01Z"))).toBe("unknown");
  });
});
