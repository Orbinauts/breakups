import { describe, expect, test } from "vitest";
import { apFactor, bandOf, environmentOf, fluxFactor, statsFor, weatherOf, type Measurement } from "./environment.ts";
import { DETECTOR_PARAMETERS } from "./params.ts";

const params = DETECTOR_PARAMETERS;

describe("the bands", () => {
  test("fifty kilometres of perigee height in low orbit, one band elsewhere", () => {
    expect(bandOf("LEO", 812)).toBe("LEO:16");
    expect(bandOf("LEO", 849.9)).toBe("LEO:16");
    expect(bandOf("LEO", -10)).toBe("LEO:0");
    expect(bandOf("GEO", 35786)).toBe("GEO");
    expect(bandOf("HEO", 300)).toBe("HEO");
  });
});

describe("the common mode and the live scale", () => {
  const member = (residual: number, bstar: number, gapDays = 1, sigmaPred = 0.01, band = "LEO:12"): Measurement => ({ band, regime: "LEO", residual, sigmaPred, gapDays, bstar });

  test("a storm that moved every high-drag object in proportion to its drag term is taken off, and the scale stays at one", () => {
    const members: Measurement[] = [];
    for (let i = 0; i < 40; i++) {
      const bstar = 1e-4 * (1 + (i % 5));
      // The day's drag lowered every object by 50 km per day per unit of B*, plus a little noise.
      members.push(member(-50 * bstar + 0.002 * ((i % 3) - 1), bstar));
    }
    const stats = statsFor(environmentOf(members, params), "LEO:12", "LEO");
    expect(stats.commonMode).toBeCloseTo(-50, 0);
    expect(stats.pooled).toBe(false);
    expect(stats.scale).toBeLessThan(1.5);
  });

  test("a band whose residuals scatter about four times their sigma gets a scale near four", () => {
    // Residuals spread evenly from -0.06 to +0.06 against a sigma of 0.01: a uniform spread's robust scale is 1.4826 times half its half-width, so about 4.4.
    const members = Array.from({ length: 41 }, (_, i) => member(0.003 * (i - 20), 0));
    const stats = statsFor(environmentOf(members, params), "LEO:12", "LEO");
    expect(stats.commonMode).toBe(0);
    expect(stats.scale).toBeGreaterThan(4);
    expect(stats.scale).toBeLessThan(5);
  });

  test("a small band takes the regime's pooled values, and a small regime no correction", () => {
    const members = [...Array.from({ length: 35 }, (_, i) => member(0.003 * (i - 17), 0, 1, 0.01, "LEO:14")), ...Array.from({ length: 3 }, () => member(0.05, 0, 1, 0.01, "LEO:15"))];
    const stats = environmentOf(members, params);
    expect(statsFor(stats, "LEO:15", "LEO").pooled).toBe(true);
    expect(statsFor(stats, "LEO:15", "LEO").scale).toBeGreaterThan(2);
    expect(statsFor(stats, "GEO", "GEO")).toEqual({ commonMode: 0, scale: 1, members: 0, pooled: false });
    const few = environmentOf(Array.from({ length: 10 }, () => member(0.05, 0)), params);
    expect(statsFor(few, "LEO:12", "LEO").scale).toBe(1);
  });

  test("the scale never drops under its floor", () => {
    const members = Array.from({ length: 40 }, () => member(0, 0));
    expect(statsFor(environmentOf(members, params), "LEO:12", "LEO").scale).toBe(params.bandScaleFloor);
  });
});

describe("the weather", () => {
  const day = (kp: number[], Ap: number, f107: number | null) => ({ day: "2024-05-10", kp, ap: kp.map((k) => k * 10), Ap, f107, f107Adjusted: f107, dst: null });

  test("no indices means no hold and a factor of one", () => {
    expect(weatherOf(undefined, params)).toEqual({ kpMax: 0, apMax: 0, f107: Number.NaN, stormHold: false, priorFactor: 1, dragFactor: 1 });
    expect(weatherOf([], params).priorFactor).toBe(1);
  });

  test("a storm day sets the hold and scales the prior up; a quiet one at low flux scales it down", () => {
    const storm = weatherOf([day([2, 2, 2, 2, 2, 2, 2, 2], 7, 110), day([3, 5, 7, 8, 6, 4, 3, 3], 80, 150)], params);
    expect(storm.kpMax).toBe(8);
    expect(storm.stormHold).toBe(true);
    expect(storm.priorFactor).toBeGreaterThan(1.5);
    const quiet = weatherOf([day([1, 1, 1, 1, 1, 1, 1, 1], 4, 70)], params);
    expect(quiet.stormHold).toBe(false);
    expect(quiet.priorFactor).toBeLessThan(0.5);
    expect(fluxFactor(Number.NaN)).toBe(1);
    expect(fluxFactor(250)).toBe(3.8);
    expect(apFactor(5)).toBeCloseTo(0.67, 6);
    expect(apFactor(100)).toBeCloseTo(1.79, 6);
    expect(apFactor(400)).toBeCloseTo(1.79, 6);
  });
});
