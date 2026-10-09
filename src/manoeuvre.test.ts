import { describe, expect, test } from "vitest";
import { atypicalReasons, classify, featuresOf, isDisposalLike, isRaised, recordStep, type CurrentStep, type StepRecord } from "./manoeuvre.ts";
import { DETECTOR_PARAMETERS } from "./params.ts";
import type { BodyClass, Regime } from "./truth.ts";

/**
 * The step history and the class it gives a step, on histories drawn by
 * hand: a geostationary station-keeper with fortnightly east-west steps
 * and a yearly north-south one, a low-orbit raising campaign, a disposal
 * lowering, a quiet old rocket body with one large step, and a working
 * payload whose step is far larger than any of its own.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2022, 0, 1);
const params = DETECTOR_PARAMETERS;

const record = (daysAgo: number, deltaKm: number, extra: Partial<StepRecord> = {}): StepRecord => ({ epochMs: T0 - daysAgo * DAY, deltaKm, deltaPerigeeKm: deltaKm, deltaInclinationDeg: 0, tangentialMps: Math.abs(deltaKm) * 0.5, normalMps: 0, ...extra });

const step = (deltaKm: number, extra: Partial<CurrentStep> = {}): CurrentStep => ({ epochMs: T0, deltaKm, deltaPerigeeKm: deltaKm, tangentialMps: Math.abs(deltaKm) * 0.5, normalMps: 0, consistency: 0, bstarRatio: 1, regime: "LEO" as Regime, bodyClass: "payload" as BodyClass, apogeeHeightAfterKm: 800, ...extra });

/** A history of the records, in any order, kept as the state would keep it. */
function history(records: StepRecord[]): StepRecord[] {
  const steps: StepRecord[] = [];
  for (const r of records) recordStep(steps, r, params);
  return steps;
}

describe("the history", () => {
  test("keeps records in epoch order, drops those older than its reach and the oldest past its size", () => {
    const steps = history([record(10, 1), record(800, 1), record(400, -1), record(5, 1)]);
    expect(steps.map((s) => (T0 - s.epochMs) / DAY)).toEqual([400, 10, 5]);
    const many = history(Array.from({ length: 80 }, (_, i) => record(700 - i * 5, 1)));
    expect(many).toHaveLength(params.historyMaxSteps);
    expect((T0 - many[0]!.epochMs) / DAY).toBe(700 - (80 - params.historyMaxSteps) * 5);
  });
});

describe("the features and the class", () => {
  test("a geostationary station-keeper with fortnightly alternating east-west steps and a yearly north-south one: station-keeping, and nothing atypical about the next step", () => {
    const records: StepRecord[] = [];
    for (let i = 1; i <= 50; i++) records.push(record(i * 14, i % 2 === 0 ? 1 : -1));
    records.push(record(300, 0.05, { deltaInclinationDeg: 0.08, tangentialMps: 0.002, normalMps: 4.3 }));
    const steps = history(records);
    const next = step(1, { regime: "GEO", apogeeHeightAfterKm: 35_786 });
    const features = featuresOf(steps, next, T0 - 3000 * DAY, params);
    expect(features.n730).toBe(51);
    // Twenty-six east-west steps in the year, and the north-south one.
    expect(features.n365).toBe(27);
    expect(features.alternation).toBeGreaterThan(0.9);
    expect(features.regularity).toBeLessThan(0.75);
    expect(features.typicality).toBeCloseTo(1, 6);
    expect(features.normalShare).toBeCloseTo(1 / 51, 6);
    expect(features.young).toBe(false);
    expect(classify(features, next, params)).toBe("station-keeping");
    expect(atypicalReasons(features, next, params)).toEqual([]);
    expect(isRaised("station-keeping", [])).toBe(false);
  });

  test("a low-orbit raising campaign: a run of same-sign raises is a campaign, and the next raise is nothing new, but a step the other way on a long one-sided record is", () => {
    const steps = history([record(40, 5), record(30, 5.2), record(20, 4.8), record(10, 5)]);
    const raise = step(5);
    const features = featuresOf(steps, raise, T0 - 60 * DAY, params);
    expect(features.sameSignShare).toBe(1);
    expect(features.alternation).toBe(0);
    expect(classify(features, raise, params)).toBe("campaign");
    expect(atypicalReasons(features, raise, params)).toEqual([]);
    const lowering = step(-5);
    const opposite = featuresOf(steps, lowering, T0 - 60 * DAY, params);
    expect(opposite.sameSignShare).toBe(0);
    expect(atypicalReasons(opposite, lowering, params)).toEqual([`the step is opposite in direction to every one of the object's 4 past steps`]);
    expect(isRaised(classify(opposite, lowering, params), atypicalReasons(opposite, lowering, params))).toBe(true);
    // With one past step the opposite test does not fire: an alternating pattern's second step is its opposite.
    const one = featuresOf(history([record(14, 1)]), step(-1), T0 - 500 * DAY, params);
    expect(atypicalReasons(one, step(-1), params)).toEqual([]);
    expect(classify(one, step(-1), params)).toBe("occasional");
  });

  test("a disposal: the perigee lowered by thirty kilometres with the apogee kept, a raise of fifty in low orbit, or of two hundred at geosynchronous altitude", () => {
    const lowering = step(-15, { deltaPerigeeKm: -30 });
    expect(isDisposalLike(lowering, params)).toBe(true);
    expect(classify(featuresOf([], lowering, T0 - 1000 * DAY, params), lowering, params)).toBe("disposal");
    expect(isDisposalLike(step(-15, { deltaPerigeeKm: -15 }), params)).toBe(false);
    expect(isDisposalLike(step(60, { deltaPerigeeKm: 60 }), params)).toBe(true);
    expect(isDisposalLike(step(250, { deltaPerigeeKm: 250, regime: "GEO" }), params)).toBe(true);
    expect(isDisposalLike(step(150, { deltaPerigeeKm: 150, regime: "GEO" }), params)).toBe(false);
    // A breakup that lowers the perigee of a highly elliptical orbit is not a disposal by this shape.
    expect(isDisposalLike(step(-36, { deltaPerigeeKm: -30, regime: "HEO" }), params)).toBe(false);
  });

  test("a quiet old rocket body with one large step: unique, raised, whatever the catalogue calls it", () => {
    for (const bodyClass of ["rocket body", "payload", "debris"] as const) {
      const large = step(-0.4, { bodyClass });
      const features = featuresOf([], large, T0 - 2000 * DAY, params);
      expect(features.n730).toBe(0);
      expect(features.young).toBe(false);
      expect(Number.isNaN(features.typicality)).toBe(true);
      expect(classify(features, large, params)).toBe("unique");
      expect(isRaised("unique", [])).toBe(true);
    }
  });

  test("a young object's first step: a payload's raise that a tangential burn explains starts a campaign; its lowering, a radial kick, or a young rocket body's raise is unique", () => {
    const young = T0 - 10 * DAY;
    const raise = step(5);
    expect(classify(featuresOf([], raise, young, params), raise, params)).toBe("campaign");
    const lowering = step(-5);
    expect(classify(featuresOf([], lowering, young, params), lowering, params)).toBe("unique");
    const kicked = step(5, { consistency: 100 });
    expect(classify(featuresOf([], kicked, young, params), kicked, params)).toBe("unique");
    const stage = step(5, { bodyClass: "rocket body" });
    expect(classify(featuresOf([], stage, young, params), stage, params)).toBe("unique");
    // Past the age bound the class says nothing: the raise is unique.
    expect(classify(featuresOf([], raise, T0 - 100 * DAY, params), raise, params)).toBe("unique");
  });

  test("a working payload with a step far larger than its own, and a drag term that jumped: atypical by size, and by the drag term once that test is on", () => {
    const steps = history(Array.from({ length: 10 }, (_, i) => record(30 * (i + 1), 0.4)));
    const huge = step(13, { bstarRatio: 9.8 });
    const features = featuresOf(steps, huge, T0 - 400 * DAY, params);
    expect(features.typicality).toBeCloseTo(32.5, 6);
    expect(classify(features, huge, params)).toBe("campaign");
    const reasons = atypicalReasons(features, huge, params);
    expect(reasons).toEqual([`the step is 32.5 times the median of the object's past steps`]);
    expect(isRaised("campaign", reasons)).toBe(true);
    const withBstar = atypicalReasons(features, huge, { ...params, typicalityMax: 100, bstarRatioMax: 5 });
    expect(withBstar).toEqual([`the drag term changed 9.8-fold across the step`]);
    expect(atypicalReasons(features, step(13, { bstarRatio: 0.1 }), { ...params, typicalityMax: 100, bstarRatioMax: 5 })).toEqual([`the drag term changed 10.0-fold across the step`]);
  });

  test("a step whose eccentricity change needs a radial kick is atypical whatever the record", () => {
    const steps = history([record(14, 1), record(28, -1), record(42, 1), record(56, -1), record(70, 1)]);
    const kicked = step(1, { consistency: 400 });
    expect(classify(featuresOf(steps, kicked, T0 - 1000 * DAY, params), kicked, params)).toBe("station-keeping");
    expect(atypicalReasons(featuresOf(steps, kicked, T0 - 1000 * DAY, params), kicked, params)).toEqual([`the eccentricity change needs a radial kick a tangential burn cannot give (chi-squared 400.0)`]);
  });
});
