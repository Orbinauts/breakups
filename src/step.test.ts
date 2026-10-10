import { describe, expect, test } from "vitest";
import { DETECTOR_PARAMETERS } from "./params.ts";
import { newState, pushSet } from "./series.ts";
import { advanceCusum, driftChi2, fitSegment, resetCusum } from "./step.ts";
import { DAY, setOf } from "./synthetic.test-support.ts";

const params = DETECTOR_PARAMETERS;

describe("the two-segment fit", () => {
  test("one set is its own level, with the prediction's sigma", () => {
    expect(fitSegment([0], [0.3], [0.01], 0.03)).toEqual({ delta: 0.3, mean: 0.3, sigmaMean: 0.01, slope: 0, sigmaDelta: 0.01, chi2: 0 });
  });

  test("a flat step over four sets is recovered with a small slope and a smaller sigma than one set's", () => {
    const x = [0, 0.5, 1, 1.5];
    const u = [0.30, 0.301, 0.299, 0.30];
    const sigma = [0.01, 0.01, 0.011, 0.012];
    const fit = fitSegment(x, u, sigma, 0.03);
    expect(fit.delta).toBeCloseTo(0.3, 2);
    expect(Math.abs(fit.slope)).toBeLessThan(0.01);
    expect(fit.sigmaDelta).toBeLessThan(0.01);
  });

  test("a step followed by a settling rise keeps its level at the first set, the slope free", () => {
    const x = [0, 1, 2, 3];
    const u = [1.26, 1.5, 1.8, 2.1];
    const fit = fitSegment(x, u, [0.05, 0.05, 0.05, 0.05], 1);
    expect(fit.delta).toBeCloseTo(1.23, 1);
    expect(fit.slope).toBeCloseTo(0.29, 1);
  });

  test("a step away is not explained as a steep slope when the prior is tight and the sets are close", () => {
    const fit = fitSegment([0, 0.1], [0.3, 0.3], [0.01, 0.01], 0.03);
    expect(fit.delta).toBeCloseTo(0.3, 3);
    expect(Math.abs(fit.slope)).toBeLessThan(0.01);
  });
});

describe("the evidence for a step against a drift", () => {
  test("a drift from the step's instant leaves no evidence; a step leaves much", () => {
    const sigma = [0.01, 0.01, 0.01, 0.01];
    const xDrift = [0.5, 1, 1.5, 2];
    const drift = xDrift.map((x) => 0.2 * x);
    // A drift at the rate the prior allows costs about one.
    expect(driftChi2(xDrift, drift, sigma, 0.2)).toBeLessThan(2);
    const step = [0.3, 0.3, 0.3, 0.3];
    const chi2Step = fitSegment([0, 0.5, 1, 1.5], step, sigma, 0.03).chi2;
    expect(driftChi2(xDrift, step, sigma, 0.2) - chi2Step).toBeGreaterThan(100);
  });

  test("a ramp far steeper than drag allows is a step, not a drift", () => {
    // The catalogue's fit converging on a new orbit: -24 m, then -290 m held, on an object whose drag could move it 5 m a day.
    const sigma = [0.002, 0.002, 0.002, 0.002];
    const u = [-0.024, -0.29, -0.292, -0.29];
    const xDrift = [0.1, 0.5, 0.6, 1];
    const xLevel = xDrift.map((x) => x - 0.1);
    const driftPrior = 0.005;
    const chi2Step = fitSegment(xLevel, u, sigma, driftPrior + 0.024).chi2;
    expect(driftChi2(xDrift, u, sigma, driftPrior) - chi2Step).toBeGreaterThan(10);
  });
});

describe("the CUSUM", () => {
  test("accumulates a slow drift past the threshold and remembers where it started", () => {
    const state = newState(1);
    const T0 = Date.UTC(2020, 0, 1);
    for (let i = 0; i < 3; i++) pushSet(state, setOf(1, { epochMs: T0 + i * DAY, aKm: 7000 }), 0, params);
    resetCusum(state, T0 + 2 * DAY);
    let alarm = false;
    let at = T0 + 2 * DAY;
    let steps = 0;
    while (!alarm && steps < 100) {
      alarm = advanceCusum(state, 1.5, at, params);
      at += DAY;
      steps++;
    }
    expect(alarm).toBe(true);
    expect(steps).toBe(Math.ceil(params.hCusum / (1.5 - params.cusumDrift)) + 1);
    expect(state.cusumFrom).toBe(T0 + 2 * DAY);
    expect(state.cusumNeg).toBe(0);
  });

  test("noise within the drift allowance never accumulates", () => {
    const state = newState(1);
    for (let i = 0; i < 50; i++) expect(advanceCusum(state, (i % 2 === 0 ? 1 : -1) * 0.4, i, params)).toBe(false);
    expect(state.cusumPos).toBe(0);
    expect(state.cusumNeg).toBe(0);
  });
});
