import { describe, expect, test } from "vitest";
import { reviveStates, runDetector, serialiseStates, type DetectorInput, type ElementSet, type Verdict } from "./index.ts";
import { DAY, HOUR, noise, one, setOf, type SyntheticSet } from "./synthetic.test-support.ts";

/**
 * The states a caller stores between runs. A live caller keeps them in a
 * store that holds text (a key-value store, a file), so each run's states
 * go out as text and come back from it; the detector must then decide
 * exactly as it would have on the states it returned. Each case runs the
 * same sets twice, once handing the states straight back and once through
 * text at every run, and the verdicts must be the same.
 */

const T0 = Date.UTC(2020, 3, 1);

interface States {
  states: DetectorInput["states"];
  launches: DetectorInput["launches"];
}

/** The batches run one after another, the states passed through `carry` between runs. */
function run(batches: ElementSet[][], carry: (states: States) => States): Verdict[] {
  let carried: States = { states: new Map(), launches: new Map() };
  let now = Number.NEGATIVE_INFINITY;
  const verdicts: Verdict[] = [];
  for (const batch of batches) {
    now = Math.max(now + 1, Math.max(...batch.map((s) => s.epochMs)) + HOUR);
    const output = runDetector({ ...carried, sets: batch, now });
    verdicts.push(...output.verdicts);
    carried = carry({ states: output.states, launches: output.launches });
  }
  return verdicts;
}

const unbroken = (states: States): States => states;
const throughText = (states: States): States => reviveStates(serialiseStates(states));

/** A payload watched quietly for `quietDays`, then raised five kilometres every five days. */
function raising(quietDays: number): ElementSet[][] {
  const gauss = noise(31);
  const series: SyntheticSet[] = [];
  let level = 6900;
  for (let t = 0; t <= (quietDays + 60) * DAY; t += 6 * HOUR) {
    if (t > quietDays * DAY && Math.round(t / (6 * HOUR)) % 20 === 0) level += 5;
    series.push({ epochMs: T0 + t, aKm: level + 0.005 * gauss(), bstar: 1e-4 });
  }
  return one(series.map((s) => setOf(1, s, "payload")));
}

/** A rocket body decaying quietly, stepping down 0.3 km on day thirty-five, then six pieces of its launch in its plane published five days later. */
function breakup(): ElementSet[][] {
  const gauss = noise(1);
  const series: SyntheticSet[] = [];
  for (let t = 0; t <= 48 * DAY; t += 8 * HOUR) series.push({ epochMs: T0 + t, aKm: 7200 - 0.02 * (t / DAY) + 0.004 * gauss() - (t >= 35 * DAY ? 0.3 : 0) });
  const parent = series.map((s) => setOf(1, s, "rocket body"));
  const stepEpoch = T0 + 35 * DAY;
  const pieces = Array.from({ length: 6 }, (_, i) => ({ ...setOf(50001 + i, { epochMs: stepEpoch + HOUR, aKm: 7200 + (i - 2.5) * 3, raanDeg: 100 }, "debris"), designator: `2010-001${"CDEFGH"[i]}` }));
  return [...one(parent.filter((s) => s.epochMs < stepEpoch + 5 * DAY)), pieces, ...one(parent.filter((s) => s.epochMs >= stepEpoch + 5 * DAY))];
}

describe("the states through text", () => {
  test.each([
    ["a young payload's raising campaign", raising(0)],
    ["an old payload's raises, its age read from its first set", raising(120)],
    ["a step confirmed by pieces of its launch, the launch's age read from its first body", breakup()],
  ])("%s: the same verdicts as an unbroken run", (_, batches) => {
    const straight = run(batches, unbroken);
    expect(straight.length).toBeGreaterThan(0);
    expect(run(batches, throughText)).toEqual(straight);
  });

  test("are text, and the text carries what plain JSON loses", () => {
    const text = serialiseStates({ states: new Map([[1, { never: Number.NEGATIVE_INFINITY, unmeasured: Number.NaN, first: Number.POSITIVE_INFINITY }]]), launches: new Map() });
    expect(typeof text).toBe("string");
    const revived = reviveStates(text);
    expect(revived.states.get(1)).toEqual({ never: Number.NEGATIVE_INFINITY, unmeasured: Number.NaN, first: Number.POSITIVE_INFINITY });
    expect(revived.launches).toEqual(new Map());
  });
});
