import { describe, expect, test } from "vitest";
import { timedRefusals, twinRuling } from "./attribution.ts";
import type { PiecesEventTime } from "./event-time.ts";
import type { PieceReading } from "./fragments.ts";
import { REFUSALS } from "./log.ts";
import { DETECTOR_PARAMETERS } from "./params.ts";

/**
 * The attribution's own rules one at a time: those on the pieces timed
 * back against the body they would be attributed to, and the naming of
 * the parent among twins the pieces cannot tell it from.
 */

const params = DETECTOR_PARAMETERS;
const HOUR = 3_600_000;
const AT = Date.UTC(2020, 5, 1);
const BODY = 1;

const pieces = (count: number): PieceReading[] => Array.from({ length: count }, (_, i) => ({ number: 100 + i, bodyClass: "debris", firstSeenAt: AT, firstEpoch: AT, aboveMark: true, parent: BODY, distance: 0.5, deltaKm: 1, deltaVMps: 5, within: [BODY] }));

/** A timing whose `timed` pieces cross the body, half within `dev50Hours` of their median and three quarters within `dev75Hours`, `ageDays` old at it. */
function timing(options: { missKm?: number; timed?: number; dev50Hours?: number; dev75Hours?: number; ageDays?: number } = {}): PiecesEventTime {
  const timed = options.timed ?? 6;
  return { at: AT, from: AT - HOUR, to: AT + HOUR, sigmaMinutes: 20, missKm: options.missKm ?? 4, pieces: timed, spreadMinutes: 10, crossings: 1, gridSeconds: 60, points: 100, pieceCrossings: [], origin: { tried: timed, timed, medianAt: AT, dev50Hours: options.dev50Hours ?? 1, dev75Hours: options.dev75Hours ?? 2, phase50: 0.01, phase75: 0.02, spreadHours: 1, sigmaMinutes: 20, ageDays: options.ageDays ?? 3, missKm: 4 } };
}

const OLD_LAUNCH = { launchAgeDays: 3000 };

describe("the rules on the pieces timed back against the body", () => {
  test("pieces that converge on the body at one instant, long after its launch, refuse nothing", () => {
    expect(timedRefusals(BODY, pieces(6), timing(), OLD_LAUNCH, params)).toEqual({ refused: 0, reasons: [] });
  });

  test("pieces that could not be timed are refused as untimed, and nothing else is read", () => {
    const refusal = timedRefusals(BODY, pieces(6), null, OLD_LAUNCH, params);
    expect(refusal.refused).toBe(REFUSALS.untimed);
    expect(refusal.reasons).toHaveLength(1);
  });

  test("pieces missing the body by more than the bound are not its pieces", () => {
    expect(timedRefusals(BODY, pieces(6), timing({ missKm: 120 }), OLD_LAUNCH, { ...params, attributionMissKmMax: 50 }).refused).toBe(REFUSALS.miss);
  });

  test("pieces crossing the body within the launch's margin after it was first seen are its own objects catalogued late", () => {
    const refusal = timedRefusals(BODY, pieces(6), timing({ ageDays: 20 }), { launchAgeDays: 25 }, { ...params, originLaunchMarginDays: 30 });
    expect(refusal.refused).toBe(REFUSALS.origin);
    expect(refusal.reasons[0]).toContain("5 days after the launch was first seen");
  });

  test("with the common-origin test on, pieces that do not share an instant are an old cloud's late pieces", () => {
    expect(timedRefusals(BODY, pieces(6), timing({ dev50Hours: 30, dev75Hours: 40 }), OLD_LAUNCH, { ...params, originHoursBase: 6 }).refused).toBe(REFUSALS.origin);
  });

  test("a small batch of three or four pieces needs a tight common origin; five pieces do not", () => {
    const loose = timing({ timed: 3, dev50Hours: 60, dev75Hours: 70 });
    expect(timedRefusals(BODY, pieces(3), loose, OLD_LAUNCH, params).refused).toBe(REFUSALS.smallBatch);
    expect(timedRefusals(BODY, pieces(5), loose, OLD_LAUNCH, params).refused).toBe(0);
  });
});

describe("the naming of the parent among twins", () => {
  const twins = { ...params, attributionTwins: true, attributionTwinsUnresolved: false, attributionStepBreaksTies: true };

  test("a persistent step the body alone made names it, before its rank does", () => {
    expect(twinRuling(1, 1, true, twins)).toEqual({ by: "step", namesCandidates: true, refused: 0 });
  });

  test("with no step to tell them apart, the body's better rank over every twin names it where the stage preference is on", () => {
    expect(twinRuling(3, 1, true, twins)).toEqual({ by: "rank", namesCandidates: true, refused: 0 });
    expect(twinRuling(3, 1, false, twins).by).toBe(null);
  });

  test("a parent nothing names is refused as ambiguous, unless unresolved twins are raised with the launch's candidates", () => {
    expect(twinRuling(0, 0, true, twins)).toEqual({ by: null, namesCandidates: false, refused: REFUSALS.ambiguous });
    expect(twinRuling(0, 0, true, { ...twins, attributionTwinsUnresolved: true })).toEqual({ by: null, namesCandidates: true, refused: 0 });
  });

  test("with the twins off, a body named by its step is named alone, and one nothing names is refused", () => {
    const off = { ...twins, attributionTwins: false, attributionTwinsUnresolved: true };
    expect(twinRuling(1, 0, true, off)).toEqual({ by: "step", namesCandidates: false, refused: 0 });
    expect(twinRuling(0, 0, true, off)).toEqual({ by: null, namesCandidates: false, refused: REFUSALS.ambiguous });
  });
});
