import { describe, expect, test } from "vitest";
import { DETECTOR_PARAMETERS } from "./params.ts";
import { isReadable, newState, nodePrecessionDegPerDay, ownNoise, priorSigma, pushSet, rememberResidual, screenSet, windowOf } from "./series.ts";
import { DAY, meanMotionOf, setOf } from "./synthetic.test-support.ts";

const params = DETECTOR_PARAMETERS;
const T0 = Date.UTC(2020, 0, 1);

function filled(count: number, aKm = 7000): ReturnType<typeof newState> {
  const state = newState(1);
  for (let i = 0; i < count; i++) pushSet(state, setOf(1, { epochMs: T0 + i * DAY, aKm }), i === 0 ? Number.NaN : 0.001 * (i % 3), params);
  return state;
}

describe("the guards", () => {
  test("rejects non-finite values, an unbound orbit and a junk drag derivative", () => {
    expect(isReadable(setOf(1, { epochMs: T0, aKm: 7000 }), params)).toBe(true);
    expect(isReadable({ ...setOf(1, { epochMs: T0, aKm: 7000 }), meanMotion: Number.NaN }, params)).toBe(false);
    expect(isReadable({ ...setOf(1, { epochMs: T0, aKm: 7000 }), eccentricity: 1.2 }, params)).toBe(false);
    expect(isReadable(setOf(1, { epochMs: T0, aKm: 7000, meanMotionDot: -2e-4 }), params)).toBe(false);
  });

  test("the node precesses westward on a prograde orbit at about the textbook rate for a sun-synchronous one", () => {
    // A sun-synchronous orbit precesses eastward by about 0.9856 degrees a day; near 98 degrees the sign flips.
    expect(nodePrecessionDegPerDay(7078, 0.001, 98.2, 14.57)).toBeCloseTo(0.9856, 1);
    expect(nodePrecessionDegPerDay(7078, 0.001, 50, 14.57)).toBeLessThan(0);
  });
});

describe("the ring", () => {
  test("keeps the last K sets, oldest first", () => {
    const state = filled(40);
    expect(state.epochs).toHaveLength(params.ringSize);
    expect(state.epochs[0]).toBe(T0 + 8 * DAY);
    expect(state.epochs.at(-1)).toBe(T0 + 39 * DAY);
  });

  test("a re-published epoch replaces its values and asks for no prediction", () => {
    const state = filled(5);
    const again = setOf(1, { epochMs: T0 + 2 * DAY, aKm: 7000.5 });
    expect(screenSet(state, again, params)).toEqual([]);
    expect(state.epochs).toHaveLength(5);
    expect(state.a[2]).toBeCloseTo(7000.5, 6);
  });

  test("an older epoch is slotted into place without a residual", () => {
    const state = filled(5);
    const late = setOf(1, { epochMs: T0 + 2.5 * DAY, aKm: 7000 });
    expect(screenSet(state, late, params)).toEqual([]);
    expect(state.epochs).toHaveLength(6);
    expect(state.epochs[3]).toBe(T0 + 2.5 * DAY);
    expect(Number.isNaN(state.resid[3]!)).toBe(true);
  });

  test("a foreign set is held until the next set says whether the orbit moved there", () => {
    const state = filled(5);
    const foreign = setOf(1, { epochMs: T0 + 5 * DAY, aKm: 7100 });
    expect(screenSet(state, foreign, params)).toEqual([]);
    expect(state.held?.set).toBe(foreign);
    // The next set is back on the old orbit: the held one was a cross-tag and is dropped.
    const back = setOf(1, { epochMs: T0 + 6 * DAY, aKm: 7000 });
    expect(screenSet(state, back, params)).toEqual([back]);
    expect(state.held).toBeNull();
  });

  test("a foreign set confirmed by the next is accepted, both in order", () => {
    const state = filled(5);
    const moved = setOf(1, { epochMs: T0 + 5 * DAY, aKm: 7100 });
    screenSet(state, moved, params);
    const stays = setOf(1, { epochMs: T0 + 6 * DAY, aKm: 7100.01 });
    expect(screenSet(state, stays, params)).toEqual([moved, stays]);
  });

  test("a sparse object decaying fast is not held as foreign for the drag its own sets say it is under, but a set that rose as far is", () => {
    // Sets twenty-four days apart on an object losing 2.5 km of axis a day, which each set's drag derivative says: sixty kilometres between sets, past the foreign bound.
    const rate = 2.5;
    const gapDays = 24;
    const sets: ReturnType<typeof setOf>[] = [];
    let raanDeg = 100;
    for (let k = 0; k < 4; k++) {
      const aKm = 6700 - rate * gapDays * k;
      const n = meanMotionOf(aKm);
      if (k > 0) {
        const previous = 6700 - rate * gapDays * (k - 1);
        raanDeg += nodePrecessionDegPerDay(previous, 0.001, 98, meanMotionOf(previous)) * gapDays;
      }
      // The half-derivative the format prints for that decay: `da/dt = -(2/3)(a/n) dn/dt`.
      const meanMotionDot = rate / ((2 / 3) * (aKm / n) * 2);
      sets.push(setOf(1, { epochMs: T0 + k * gapDays * DAY, aKm, raanDeg, meanMotionDot }));
    }
    const state = newState(1);
    pushSet(state, sets[0]!, Number.NaN, params);
    for (const set of sets.slice(1)) {
      expect(screenSet(state, set, params)).toEqual([set]);
      pushSet(state, set, Number.NaN, params);
    }
    expect(state.held).toBeNull();
    // A set as far above the last as the drag took it below: no drag raises an orbit.
    const last = 6700 - rate * gapDays * 3;
    const risen = setOf(1, { epochMs: T0 + 4 * gapDays * DAY, aKm: last + rate * gapDays, raanDeg: raanDeg + nodePrecessionDegPerDay(last, 0.001, 98, meanMotionOf(last)) * gapDays, meanMotionDot: sets[3]!.meanMotionDot });
    expect(screenSet(state, risen, params)).toEqual([]);
    expect(state.held?.set).toBe(risen);
  });

  test("a node far off its J2 precession is foreign, except on a near-equatorial orbit where the node means nothing", () => {
    const state = filled(5);
    const off = setOf(1, { epochMs: T0 + 5 * DAY, aKm: 7000, raanDeg: 100 + 30 });
    expect(screenSet(state, off, params)).toEqual([]);
    const geo = newState(2);
    for (let i = 0; i < 5; i++) pushSet(geo, setOf(2, { epochMs: T0 + i * DAY, aKm: 42164, inclinationDeg: 0.05, raanDeg: (i * 90) % 360 }), Number.NaN, params);
    const next = setOf(2, { epochMs: T0 + 5 * DAY, aKm: 42164, inclinationDeg: 0.05, raanDeg: 300 });
    expect(screenSet(geo, next, params)).toEqual([next]);
  });

  test("the window is the last sets within the regime's count and age, and after the restart", () => {
    const state = filled(30);
    expect(windowOf(state, params)).toEqual([14, 30]);
    state.windowFrom = T0 + 25 * DAY;
    expect(windowOf(state, params)).toEqual([25, 30]);
    expect(windowOf(state, params, T0 + 27 * DAY)).toEqual([25, 28]);
  });
});

describe("the own noise", () => {
  test("is the prior until there are enough residuals, then the short scatter floored by the long memory", () => {
    const state = newState(1);
    const prior = priorSigma("LEO", 1e-4, 1, params);
    expect(prior).toBe(params.sigmaPrior.LEO);
    expect(priorSigma("LEO", 1e-3, 1, params)).toBeCloseTo(params.sigmaPrior.LEO * 10, 12);
    expect(priorSigma("LEO", 1e-4, 2, params)).toBeCloseTo(params.sigmaPrior.LEO * 2, 12);
    expect(ownNoise(state, prior, params).sigma).toBe(prior);
    for (let i = 0; i < 12; i++) {
      const residual = 0.004 * (i % 2 === 0 ? 1 : -1);
      pushSet(state, setOf(1, { epochMs: T0 + i * DAY, aKm: 7000 }), residual, params);
      rememberResidual(state, residual, prior, T0 + i * DAY, params);
    }
    const noise = ownNoise(state, prior, params);
    expect(noise.residuals).toBe(12);
    expect(noise.short).toBeCloseTo(1.4826 * 0.004, 6);
    expect(noise.long).toBeGreaterThan(0);
    expect(noise.sigma).toBe(Math.max(noise.short, noise.long));
  });

  test("a step's residual is clipped before it enters the long memory", () => {
    const state = filled(12);
    const before = state.longSigma;
    rememberResidual(state, 5, 0.01, T0 + 12 * DAY, params);
    expect(state.longSigma).toBeLessThan(before + 0.05);
  });
});
