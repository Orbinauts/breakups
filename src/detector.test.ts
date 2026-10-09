import { describe, expect, test } from "vitest";
import { OUTCOMES } from "./log.ts";
import { DETECTOR_PARAMETERS } from "./params.ts";
import { DAY, HOUR, feed, noise, one, setOf, type SyntheticSet } from "./synthetic.test-support.ts";

/**
 * The detector end to end on synthetic series, each the shape of one
 * thing the design must get right: a pure drag decay raises nothing; a
 * storm that moves a whole band is taken off as common mode; a bad set
 * the next sets undo is dismissed; a real step with a settling slope
 * after it is suspected on the right bracket, before its third day; a
 * day-old stage with no record of its own is still caught, by the prior;
 * and a geosynchronous object with a set every two days is caught across
 * its sparse sets. The numbers are modest: kilometres of semi-major axis
 * for low orbits near 7,200 km, noise of a few metres, as the catalogue's
 * own fits scatter.
 */

const T0 = Date.UTC(2020, 3, 1);
const params = DETECTOR_PARAMETERS;

/** A drag decay of `rate` kilometres a day from `a0`, sampled every `stepHours`, with Gaussian noise of `sigma` kilometres, over `days`. */
function decaying(a0: number, rate: number, sigma: number, days: number, stepHours = 8, seed = 1, bstar = 1e-4): SyntheticSet[] {
  const gauss = noise(seed);
  const sets: SyntheticSet[] = [];
  for (let t = 0; t <= days * DAY; t += stepHours * HOUR) sets.push({ epochMs: T0 + t, aKm: a0 - rate * (t / DAY) + sigma * gauss(), bstar });
  return sets;
}

const suspected = (fed: ReturnType<typeof feed>) => fed.verdicts.filter((v) => v.state === "suspected");

describe("the detector on synthetic series", () => {
  test("a pure drag decay with its own noise raises nothing and logs no candidate", () => {
    const fed = feed(one(decaying(7200, 0.02, 0.004, 40).map((s) => setOf(1, s))));
    expect(suspected(fed)).toEqual([]);
    expect(fed.log.filter((r) => r.signals.outcome === OUTCOMES.suspected)).toEqual([]);
  });

  test("a storm that lowers every object of a band in proportion to its drag term raises nothing, since the band's common mode takes it off", () => {
    // Forty objects in one band, each decaying with its own drag term; on day 20 every orbit drops by 200 km per day per unit of B* at once.
    const batches: ReturnType<typeof setOf>[][] = [];
    const objects = Array.from({ length: 40 }, (_, i) => ({ number: 100 + i, bstar: 2e-4 * (1 + (i % 5)), gauss: noise(10 + i) }));
    for (let t = 0; t <= 30 * DAY; t += 8 * HOUR) {
      const batch = objects.map((o) => {
        const storm = t >= 20 * DAY ? -200 * o.bstar : 0;
        return setOf(o.number, { epochMs: T0 + t, aKm: 7100 - 0.05 * (t / DAY) * (o.bstar / 2e-4) + storm + 0.003 * o.gauss(), bstar: o.bstar });
      });
      batches.push(batch);
    }
    const fed = feed(batches);
    expect(suspected(fed)).toEqual([]);
    // The same band on a quiet day with one object alone making that move would be a candidate: the storm's move is as large as a step.
    const alone = feed(one(decaying(7100, 0.05, 0.003, 30, 8, 3, 2e-4).map((s, i) => setOf(1, { ...s, aKm: s.aKm + (i * 8 * HOUR >= 20 * DAY ? -0.2 : 0) }))));
    expect(suspected(alone).length).toBeGreaterThan(0);
  });

  test("a bad set is dismissed when the next sets are back where the model said", () => {
    const series = decaying(7200, 0.02, 0.004, 30);
    series[60]!.aKm += 0.5;
    const fed = feed(one(series.map((s) => setOf(1, s))));
    expect(suspected(fed)).toEqual([]);
    const closed = fed.log.find((r) => r.signals.phase === 2 && r.signals.outcome === OUTCOMES.reverted);
    expect(closed).toBeDefined();
    expect(closed!.signals.afterEpoch).toBe(series[60]!.epochMs);
    expect(Math.abs(closed!.signals.rhoMedian!)).toBeLessThan(params.rhoRevert);
    // The bad set left the ring, so the object's scatter is still a few metres.
    expect(closed!.signals.sigmaOwn).toBeLessThan(0.02);
  });

  test("a real step with a settling slope after it is suspected on the bracket around the step, within three days", () => {
    const series = decaying(7200, 0.02, 0.004, 30);
    const stepAt = 60;
    for (let i = stepAt; i < series.length; i++) series[i]!.aKm += -0.3 - 0.02 * ((series[i]!.epochMs - series[stepAt]!.epochMs) / DAY);
    const fed = feed(one(series.map((s) => setOf(1, s))));
    const raised = suspected(fed);
    expect(raised).toHaveLength(1);
    const verdict = raised[0]!;
    expect(verdict.step!.beforeEpoch).toBe(series[stepAt - 1]!.epochMs);
    expect(verdict.step!.afterEpoch).toBe(series[stepAt]!.epochMs);
    expect(verdict.step!.deltaKm).toBeCloseTo(-0.3, 1);
    expect(verdict.step!.postSets).toBeGreaterThanOrEqual(2);
    expect(verdict.raisedAt - series[stepAt]!.epochMs).toBeLessThan(3 * DAY);
    expect(verdict.evidence.rhoMedian).toBeGreaterThan(params.rhoMin);
    expect(verdict.evidence.stepEvidence).toBeGreaterThan(params.evidenceMin);
    expect(verdict.reasons.join(" ")).toContain("holds over");
    // A watch verdict showed it first, on the first post set.
    const watch = fed.verdicts.find((v) => v.state === "watch");
    expect(watch?.step?.afterEpoch).toBe(series[stepAt]!.epochMs);
    expect(watch!.raisedAt).toBeLessThan(verdict.raisedAt);
    // No second verdict on the same step, and the object's window restarted on the post sets.
    expect(fed.verdicts.filter((v) => v.state === "dismissed")).toEqual([]);
  });

  test("a drift that grows from nothing at a rate drag can produce opens no candidate: the drag term covers it", () => {
    // A high-drag object whose decay doubles from one day: twice its drag term's worth, which the prediction's drag term allows for.
    const series = decaying(7200, 0.1, 0.004, 30, 8, 1, 1e-3);
    const from = 60;
    for (let i = from; i < series.length; i++) series[i]!.aKm += -0.2 * ((series[i]!.epochMs - series[from - 1]!.epochMs) / DAY);
    const fed = feed(one(series.map((s) => setOf(1, s))));
    expect(suspected(fed)).toEqual([]);
    expect(fed.log.filter((r) => r.number === 1)).toEqual([]);
  });

  test("a day-old stage with no record of its own is caught by the prior, still rising after its step", () => {
    const gauss = noise(7);
    const series: SyntheticSet[] = [];
    // Four sets in its first day, then the step of +1.3 km rising a further 0.3 km a day, as a settling fit does.
    for (let i = 0; i < 4; i++) series.push({ epochMs: T0 + i * 6 * HOUR, aKm: 7190 + 0.01 * gauss(), bstar: 0 });
    for (let i = 4; i < 16; i++) series.push({ epochMs: T0 + i * 6 * HOUR, aKm: 7191.3 + 0.3 * ((i - 4) / 4) + 0.01 * gauss(), bstar: 0 });
    const fed = feed(one(series.map((s) => setOf(1, s, "rocket body"))));
    const raised = suspected(fed);
    expect(raised).toHaveLength(1);
    expect(raised[0]!.step!.beforeEpoch).toBe(series[3]!.epochMs);
    expect(raised[0]!.step!.afterEpoch).toBe(series[4]!.epochMs);
    expect(raised[0]!.evidence.sigmaOwn).toBeGreaterThanOrEqual(params.sigmaPrior.LEO);
  });

  test("a geosynchronous object with a set every two days is caught across its sparse sets, with its longer lapse", () => {
    const gauss = noise(11);
    const series: SyntheticSet[] = [];
    for (let i = 0; i < 30; i++) series.push({ epochMs: T0 + i * 2 * DAY, aKm: 42164.2 + 0.05 * gauss() + (i >= 20 ? -8 : 0), eccentricity: 0.0002, inclinationDeg: 0.05, raanDeg: (i * 137) % 360, bstar: 0 });
    const fed = feed(one(series.map((s) => setOf(1, s))));
    const raised = suspected(fed);
    expect(raised).toHaveLength(1);
    expect(raised[0]!.step!.beforeEpoch).toBe(series[19]!.epochMs);
    expect(raised[0]!.step!.afterEpoch).toBe(series[20]!.epochMs);
    expect(raised[0]!.evidence.regime).toBe(2);
  });

  test("a candidate whose object falls silent lapses and is shown dismissed, and the step is measured again when a set returns", () => {
    const series = decaying(7200, 0.02, 0.004, 20);
    const stepAt = 45;
    series.splice(stepAt + 1);
    series[stepAt]!.aKm += -0.3;
    const fed = feed(one(series.map((s) => setOf(1, s))), { until: series[stepAt]!.epochMs + 8 * DAY });
    expect(suspected(fed)).toEqual([]);
    expect(fed.verdicts.map((v) => v.state)).toEqual(["watch", "dismissed"]);
    expect(fed.log.at(-1)!.signals.outcome).toBe(OUTCOMES.lapsed);
  });

  test("a storm hold asks for three post sets, and says so", () => {
    // Sets twenty hours apart: two of them span the eighteen hours the quiet gate asks for.
    const series = decaying(7200, 0.02, 0.004, 40, 20);
    const stepAt = 30;
    for (let i = stepAt; i < series.length; i++) series[i]!.aKm += -0.3;
    const day = (kp: number) => ({ day: "2020-04-21", kp: [kp, kp, kp, kp, kp, kp, kp, kp], ap: [], Ap: 50, f107: 120, f107Adjusted: 120, dst: null });
    const quiet = feed(one(series.map((s) => setOf(1, s))), { space: [day(2)] });
    const stormy = feed(one(series.map((s) => setOf(1, s))), { space: [day(7)] });
    expect(suspected(quiet)[0]!.step!.postSets).toBe(2);
    expect(suspected(stormy)[0]!.step!.postSets).toBe(3);
    expect(suspected(stormy)[0]!.reasons.join(" ")).toContain("storm hold");
    expect(suspected(stormy)[0]!.evidence.kpMax).toBe(7);
  });
});
