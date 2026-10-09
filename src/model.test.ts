import { describe, expect, test } from "vitest";
import { dragRateKmPerDay, fitWindow, invert, median, polynomialAt, predictAt, predictionSigma, robustScale, slopeAt } from "./model.ts";
import { DETECTOR_PARAMETERS } from "./params.ts";

const DAY = 86_400_000;
const params = DETECTOR_PARAMETERS;

describe("the robust statistics", () => {
  test("the median of an odd and an even count, and of nothing", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  test("the robust scale of a Gaussian-like spread is near its sigma, and one outlier does not move it", () => {
    const values = [-1.5, -1, -0.5, -0.2, 0, 0.2, 0.5, 1, 1.5];
    const plain = robustScale(values);
    const withOutlier = robustScale([...values, 1000]);
    expect(plain).toBeCloseTo(1.4826 * 0.5, 6);
    expect(withOutlier).toBeLessThan(2 * plain);
  });

  test("a median over more values than the insertion sort takes still sorts", () => {
    const values = Array.from({ length: 200 }, (_, i) => (i * 7919) % 200);
    expect(median(values)).toBe(99.5);
  });
});

describe("the small inverses", () => {
  test("two by two and three by three agree with elimination and multiply back to the identity", () => {
    const m3 = [4, 1, 2, 1, 3, 0, 2, 0, 5];
    const inv = invert(m3, 3)!;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      let v = 0;
      for (let k = 0; k < 3; k++) v += m3[r * 3 + k]! * inv[k * 3 + c]!;
      expect(v).toBeCloseTo(r === c ? 1 : 0, 10);
    }
    const inv2 = invert([2, 1, 1, 3], 2)!;
    expect(inv2[0]! * 2 + inv2[1]! * 1).toBeCloseTo(1, 12);
    expect(invert([1, 2, 2, 4], 2)).toBeNull();
  });
});

describe("the local polynomial", () => {
  const epochs = Array.from({ length: 16 }, (_, i) => Date.UTC(2020, 0, 1) + i * 0.5 * DAY);

  test("recovers a quadratic exactly and predicts along it with growing leverage", () => {
    const values = epochs.map((t) => 7000 - 0.01 * ((t - epochs[15]!) / DAY) - 0.002 * ((t - epochs[15]!) / DAY) ** 2);
    const fit = fitWindow(epochs, values, 0, 16, params, 0, true);
    expect(fit.degree).toBe(2);
    expect(fit.fallback).toBe(false);
    expect(fit.coef[0]).toBeCloseTo(7000, 6);
    expect(fit.coef[1]).toBeCloseTo(-0.01, 6);
    expect(fit.coef[2]).toBeCloseTo(-0.002, 6);
    const near = predictAt(fit, epochs[15]! + 0.5 * DAY);
    const far = predictAt(fit, epochs[15]! + 3 * DAY);
    expect(near.value).toBeCloseTo(7000 - 0.005 - 0.0005, 6);
    expect(far.leverage).toBeGreaterThan(near.leverage);
    expect(slopeAt(fit.coef, 0)).toBeCloseTo(-0.01, 6);
    expect(polynomialAt([1, 2, 3], 2)).toBe(1 + 4 + 12);
  });

  test("one bad set in the window barely bends the fit", () => {
    const values = epochs.map((t) => 7000 - 0.01 * ((t - epochs[15]!) / DAY));
    values[7]! += 5;
    const fit = fitWindow(epochs, values, 0, 16, params, 0, true);
    expect(predictAt(fit, epochs[15]! + DAY).value).toBeCloseTo(7000 - 0.01, 1);
    expect(fit.scale).toBeLessThan(0.1);
  });

  test("is linear over a short span, and falls back to the drag rate under the minimum", () => {
    const short = fitWindow(epochs, epochs.map(() => 7000), 0, 5, { ...params, quadraticMinDays: 3 }, 0);
    expect(short.degree).toBe(1);
    const fallback = fitWindow(epochs, [7000, 7001, 7002], 0, 2, params, -0.5);
    expect(fallback.fallback).toBe(true);
    expect(predictAt(fallback, epochs[1]! + DAY).value).toBeCloseTo(7001 - 0.5, 9);
    expect(predictAt(fallback, epochs[1]! + 2 * DAY).leverage).toBe(5);
  });

  test("the drag rate from a set's half-derivative lowers the axis", () => {
    expect(dragRateKmPerDay(7000, 14.5, 1e-5)).toBeCloseTo(-(2 / 3) * (7000 / 14.5) * 2e-5, 12);
  });

  test("the prediction sigma grows with leverage and with the drag term over the gap", () => {
    expect(predictionSigma(0.01, 0, 1, 0, 100, 1)).toBeCloseTo(0.01, 12);
    expect(predictionSigma(0.01, 3, 0, 0, 100, 1)).toBeCloseTo(0.02, 12);
    expect(predictionSigma(0, 0, 2, 1e-3, 100, 1)).toBeCloseTo(0.2, 12);
    expect(predictionSigma(0, 0, 2, 1e-3, 100, 1.5)).toBeCloseTo(0.3, 12);
  });
});
