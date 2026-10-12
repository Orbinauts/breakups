import { ALERT_STATES, type DetectorInput, type DetectorOutput, type ElementSet, type Verdict } from "../../src/index.ts";
import { semiMajorAxisOf } from "../../src/elements.ts";

/**
 * The simplest detector that can be scored: a verdict on any object whose
 * semi-major axis moved by more than a threshold between one set and the
 * next. It exists so the scorecard's rules can be tested on a synthetic
 * year with alerts in it, and so the replay can be timed with a detector
 * that touches every set, which the placeholder does not. It is not the
 * library's detector and never produces the committed score: it judges one
 * pair of sets against a fixed threshold, which is the design the library
 * exists to replace.
 */

/** How far the semi-major axis must move between two sets to be a step, in kilometres: the size of a modest breakup's trace. */
export const JUMP_KM = 1;

interface Last {
  epochMs: number;
  aKm: number;
}

export function jumpDetector(thresholdKm = JUMP_KM): (input: DetectorInput) => DetectorOutput {
  return (input) => {
    const states = input.states as Map<number, Last>;
    const verdicts: Verdict[] = [];
    for (const set of input.sets) {
      const aKm = semiMajorAxisOf(set);
      const last = states.get(set.number);
      if (last !== undefined && set.epochMs > last.epochMs && Math.abs(aKm - last.aKm) > thresholdKm) {
        verdicts.push(verdictOf(set, last, aKm, input.now, thresholdKm));
      }
      if (last === undefined || set.epochMs >= last.epochMs) states.set(set.number, { epochMs: set.epochMs, aKm });
    }
    return { states, launches: input.launches, verdicts, log: [] };
  };
}

function verdictOf(set: ElementSet, last: Last, aKm: number, now: number, thresholdKm: number): Verdict {
  const deltaKm = aKm - last.aKm;
  return {
    kind: "object",
    state: ALERT_STATES[0]!,
    number: set.number,
    launch: set.designator === null ? null : set.designator.slice(0, 8),
    raisedAt: now,
    step: { beforeEpoch: last.epochMs, afterEpoch: set.epochMs, deltaKm, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 1, z: null },
    event: { at: (last.epochMs + set.epochMs) / 2, from: last.epochMs, to: set.epochMs },
    evidence: { deltaKm, thresholdKm },
    reasons: [`the semi-major axis moved ${deltaKm.toFixed(2)} km between two sets, past ${thresholdKm} km`],
  };
}
