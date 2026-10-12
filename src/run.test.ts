import { describe, expect, test } from "vitest";
import type { SpaceWeatherDay } from "./detector.ts";
import type { ElementSet } from "./elements.ts";
import { OUTCOMES, ORIGINS, PHASES, REFUSALS } from "./log.ts";
import { MANOEUVRE_CLASSES } from "./manoeuvre.ts";
import { nodePrecessionDegPerDay } from "./series.ts";
import { DAY, HOUR, feed, meanMotionOf, noise, one, pieceOf, setOf, type SyntheticSet } from "./synthetic.test-support.ts";

/**
 * Paths through `runDetector` the scenes of `detector.test.ts` do not
 * walk: a candidate the CUSUM opens on a slow drift no single set shows;
 * a cross-tagged set held and dropped, and a real move of the same size
 * taken once the next set agrees; a set published after later ones,
 * slotted into the ring and judged by nothing; a storm that steepens a
 * high-drag object's decay; an analyst range's pieces confirming an alert;
 * and the two parent-side parameters the fit left off
 * (`persistOnMeanStep`, `occasionalRaisesNonPayload`), each read both
 * ways on the same sets.
 */

const T0 = Date.UTC(2020, 3, 1);

/** A drag decay of `rate` kilometres a day from `a0`, sampled every `stepHours`, with Gaussian noise of `sigma` kilometres, over `days`. */
function decaying(a0: number, rate: number, sigma: number, days: number, stepHours = 8, seed = 1, bstar = 1e-4): SyntheticSet[] {
  const gauss = noise(seed);
  const sets: SyntheticSet[] = [];
  for (let t = 0; t <= days * DAY; t += stepHours * HOUR) sets.push({ epochMs: T0 + t, aKm: a0 - rate * (t / DAY) + sigma * gauss(), bstar });
  return sets;
}

const raised = (fed: ReturnType<typeof feed>, state: string) => fed.verdicts.filter((v) => v.state === state);
/** The ring's epochs of an object, as the run left them. */
const ringOf = (fed: ReturnType<typeof feed>, number: number): number[] => (fed.states.get(number) as { epochs: number[] }).epochs;
/** The set as it would be printed with its semi-major axis moved by `deltaKm`. */
const movedBy = (set: ElementSet, aKm: number, deltaKm: number): ElementSet => ({ ...set, meanMotion: meanMotionOf(aKm + deltaKm) });

describe("a candidate the CUSUM opens", () => {
  test("a drift of two hundredths of a kilometre a set over five sets, none a candidate alone, opens a candidate on the CUSUM where the drift began, which fades when no step holds", () => {
    const series = decaying(7200, 0.02, 0.004, 40);
    const from = 60;
    for (let i = from; i < series.length; i++) series[i]!.aKm += -0.02 * Math.min(5, i - from + 1);
    const fed = feed(one(series.map((s) => setOf(1, s, "rocket body"))));
    const rows = fed.log.filter((r) => r.number === 1);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.signals.origin).toBe(ORIGINS.cusum);
    expect(row.signals.outcome).toBe(OUTCOMES.faded);
    // The first set's jump is far under the candidate threshold: the CUSUM, not the step test, opened it.
    expect(Math.abs(row.signals.z1!)).toBeLessThan(2);
    // The bracket is where the sum began, within two sets of the drift's first set and never after it.
    expect(row.signals.afterEpoch).toBeLessThanOrEqual(series[from]!.epochMs);
    expect(row.signals.beforeEpoch).toBeGreaterThanOrEqual(series[from - 2]!.epochMs);
    expect(fed.verdicts).toEqual([]);
    // The same move in one set is the step test's.
    const sudden = decaying(7200, 0.02, 0.004, 40);
    for (let i = from; i < sudden.length; i++) sudden[i]!.aKm += -0.1;
    const stepped = feed(one(sudden.map((s) => setOf(1, s, "rocket body"))));
    expect(stepped.log.filter((r) => r.number === 1).map((r) => r.signals.origin)).toEqual([ORIGINS.step]);
  });
});

describe("the sets a run is handed", () => {
  const series = decaying(7200, 0.02, 0.004, 40);
  const sets = series.map((s) => setOf(1, s, "rocket body"));

  test("a cross-tagged set eighty kilometres off, or half a degree of inclination off, is held, then dropped when the next set is back on the orbit: nothing is opened and the ring never holds it", () => {
    const crossTagged = sets.map((s, i) => (i === 60 ? movedBy(s, series[60]!.aKm, -80) : s));
    const tilted = sets.map((s, i) => (i === 60 ? { ...s, inclinationDeg: s.inclinationDeg - 1 } : s));
    for (const runs of [crossTagged, tilted]) {
      const fed = feed(one(runs));
      expect(fed.log).toEqual([]);
      expect(fed.verdicts).toEqual([]);
      // While it is held, the ring has not taken it; once the next set is back, it is gone.
      const held = feed(one(runs.slice(0, 61)));
      expect(ringOf(held, 1).at(-1)).toBe(series[59]!.epochMs);
      expect((held.states.get(1) as { held: { set: ElementSet } | null }).held?.set.epochMs).toBe(series[60]!.epochMs);
      const dropped = feed(one(runs.slice(0, 62)));
      expect(ringOf(dropped, 1).slice(-2)).toEqual([series[59]!.epochMs, series[61]!.epochMs]);
      expect(dropped.states.get(1)).toMatchObject({ held: null });
    }
  });

  test("a real move of the same size, which the next set agrees with, is taken from the held set on: a step on the bracket around it", () => {
    const moved = sets.map((s, i) => (i >= 60 ? movedBy(s, series[i]!.aKm, -80) : s));
    const fed = feed(one(moved));
    expect(raised(fed, "suspected")).toHaveLength(1);
    expect(raised(fed, "suspected")[0]!.step).toMatchObject({ beforeEpoch: series[59]!.epochMs, afterEpoch: series[60]!.epochMs });
    expect(raised(fed, "suspected")[0]!.step!.deltaKm).toBeCloseTo(-80, 0);
  });

  test("a set published after three later ones is slotted into the ring in its place and judged by nothing, even a third of a kilometre off the model", () => {
    for (const late of [sets[60]!, movedBy(sets[60]!, series[60]!.aKm, -0.3)]) {
      const runs = [...sets.slice(0, 60), ...sets.slice(61, 64), late];
      const fed = feed(one(runs));
      expect(fed.log).toEqual([]);
      expect(fed.verdicts).toEqual([]);
      const ring = ringOf(fed, 1);
      expect(ring.slice(-5)).toEqual([59, 60, 61, 62, 63].map((i) => series[i]!.epochMs));
    }
  });
});

describe("a storm on a high-drag object", () => {
  const stormDays = (from: number, kp: number, Ap: number): SpaceWeatherDay[] => [0, 1, 2].map((d) => ({ day: new Date(from + d * DAY).toISOString().slice(0, 10), kp: Array(8).fill(kp), ap: [], Ap, f107: 150, f107Adjusted: 150, dst: null }));

  test("a decay eight times as steep for the two days of a storm, then back, raises nothing where the run reads the storm, and is suspected where it reads a quiet sky", () => {
    // A tenth of a kilometre a day under a drag term ten times the usual, steepening to eight tenths for two days.
    const series = decaying(7200, 0.1, 0.004, 40, 8, 1, 1e-3);
    const from = 60;
    for (let i = from; i < series.length; i++) series[i]!.aKm += -0.7 * Math.min(2, (series[i]!.epochMs - series[from - 1]!.epochMs) / DAY);
    const runs = one(series.map((s) => setOf(1, s, "rocket body")));
    const stormy = feed(runs, { space: stormDays(series[from]!.epochMs, 8, 200) });
    expect(raised(stormy, "suspected")).toEqual([]);
    expect(raised(stormy, "watch")).toEqual([]);
    const quiet = feed(runs, { space: stormDays(series[from]!.epochMs, 1, 4) });
    expect(raised(quiet, "suspected").length).toBeGreaterThan(0);
  });
});

describe("an analyst range's pieces", () => {
  const RATE = nodePrecessionDegPerDay(7200, 0.001, 98, meanMotionOf(7200));
  const withNode = (set: ElementSet): ElementSet => ({ ...set, raanDeg: 100 + RATE * ((set.epochMs - T0) / DAY) });

  /** A rocket body stepping down 0.3 km at set 105, and six pieces of it catalogued as analyst objects four days after its step, with no designator; the analyst range has had a body for over a year, so it is no young launch. */
  function scene(): { runs: ElementSet[][]; stepEpoch: number } {
    const series = decaying(7200, 0.02, 0.004, 48);
    for (let i = 105; i < series.length; i++) series[i]!.aKm += -0.3;
    const parent = series.map((s) => ({ ...withNode(setOf(1, s, "rocket body")), designator: "2010-001A" }));
    const event = (parent[104]!.epochMs + parent[105]!.epochMs) / 2;
    const epoch = event + 4 * DAY;
    const before = parent.filter((s) => s.epochMs <= event).at(-1)!;
    const pieces = [-6, -3, -1, 1.5, 4, 6.5].map((d, i) => ({ ...pieceOf(before, event, d, epoch, 80_001 + i, ""), designator: "" }));
    const old: ElementSet = { ...setOf(85_000, { epochMs: T0 - 400 * DAY, aKm: 7500, raanDeg: 250 }, "debris"), designator: "" };
    const runs = [[old], ...one(parent)];
    runs.splice(runs.findIndex((r) => r[0]!.epochMs > epoch), 0, pieces);
    return { runs, stepEpoch: parent[105]!.epochMs };
  }

  test("confirm the open alert they converge on where the parameter lets them, the verdict naming the parent's own launch and carrying the pieces' timing", () => {
    const { runs, stepEpoch } = scene();
    const fed = feed(runs, { parameters: { analystAttributes: true } });
    const confirmed = raised(fed, "confirmed");
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!).toMatchObject({ number: 1, launch: "2010-001", bodies: [80_001, 80_002, 80_003, 80_004, 80_005, 80_006] });
    expect(confirmed[0]!.step!.afterEpoch).toBe(stepEpoch);
    expect(Number.isFinite(confirmed[0]!.evidence.missKm)).toBe(true);
    expect(Number.isFinite(confirmed[0]!.evidence.sigmaMinutes)).toBe(true);
    expect(confirmed[0]!.reasons.join(" ")).toContain("under the analyst range analyst-80000");
    const row = fed.log.find((r) => r.signals.phase === PHASES.attribution && r.signals.launch === 80_000)!;
    expect(row.signals.attributionRefused).toBe(0);
  });

  test("as fitted, confirm nothing: the burst is refused as an analyst range's and listed for review", () => {
    const fed = feed(scene().runs);
    expect(raised(fed, "confirmed")).toEqual([]);
    const row = fed.log.find((r) => r.signals.phase === PHASES.attribution && r.signals.launch === 80_000)!;
    expect(row.signals.attributionRefused).toBe(REFUSALS.analyst);
    expect(fed.verdicts.filter((v) => v.kind === "cloud").map((v) => [v.state, v.number, v.launch])).toEqual([["cloud-only", 1, null]]);
  });
});

describe("the parent-side parameters the fit left off", () => {
  test("persistOnMeanStep reads the step's size at the post sets' centroid, and says so", () => {
    const series = decaying(7200, 0.02, 0.004, 40);
    for (let i = 60; i < series.length; i++) series[i]!.aKm += -0.3;
    const runs = one(series.map((s) => setOf(1, s, "rocket body")));
    const off = raised(feed(runs), "suspected");
    const on = raised(feed(runs, { parameters: { persistOnMeanStep: true } }), "suspected");
    expect(on.map((v) => v.step)).toEqual(off.map((v) => v.step));
    expect(on[0]!.reasons[0]).toMatch(/sigma at the post sets' centroid/);
    expect(off[0]!.reasons[0]).not.toMatch(/centroid/);
  });

  test("occasionalRaisesNonPayload raises a rocket body's occasional steps, which its record otherwise explains as manoeuvres", () => {
    // A raise, then two lowerings: the second and third steps are occasional on the body's record.
    const series = decaying(7200, 0.02, 0.004, 120);
    for (const [at, delta] of [[60, 0.3], [150, -0.3], [300, -0.3]] as const) for (let i = at; i < series.length; i++) series[i]!.aKm += delta;
    const runs = one(series.map((s) => setOf(1, s, "rocket body")));
    const stateOf = (fed: ReturnType<typeof feed>) => fed.verdicts.filter((v) => v.state === "suspected" || v.state === "manoeuvre").map((v) => [v.state, v.step!.afterEpoch, MANOEUVRE_CLASSES[v.evidence.manoeuvreClass!]]);
    const steps = [60, 150, 300].map((i) => series[i]!.epochMs);
    expect(stateOf(feed(runs))).toEqual([["suspected", steps[0], "unique"], ["manoeuvre", steps[1], "occasional"], ["manoeuvre", steps[2], "occasional"]]);
    const on = feed(runs, { parameters: { occasionalRaisesNonPayload: true } });
    expect(stateOf(on)).toEqual([["suspected", steps[0], "unique"], ["suspected", steps[1], "occasional"], ["suspected", steps[2], "occasional"]]);
    expect(raised(on, "suspected")[1]!.reasons.join(" ")).toContain("a stage or a fragment does not manoeuvre");
    // A payload's occasional step stays a manoeuvre either way.
    const payload = feed(one(series.map((s) => setOf(1, s, "payload"))), { parameters: { occasionalRaisesNonPayload: true } });
    expect(raised(payload, "manoeuvre").length).toBeGreaterThan(0);
    expect(raised(payload, "suspected").filter((v) => v.evidence.manoeuvreClass === MANOEUVRE_CLASSES.indexOf("occasional"))).toEqual([]);
  });
});
