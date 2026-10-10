import { describe, expect, test } from "vitest";
import { OPEN_GATES, WHOLE_CATALOGUE, foldedRatio, inScope, passesGates, type GatedStep, type ScopePolicy, type ScopeSubject } from "./scope.ts";

/** The scope's predicate on the parent at the step, field by field, and the scoped gates on a raised step. */

const YEAR = 365;
const stage: ScopeSubject = { bodyClass: "rocket body", status: "unknown", regime: "LEO", perigeeKm: 780, bstar: 2e-5, ageDays: 20 * YEAR, daysSinceStep: Number.POSITIVE_INFINITY };
const with_ = (over: Partial<ScopeSubject>): ScopeSubject => ({ ...stage, ...over });
const scope = (over: Partial<ScopePolicy>): ScopePolicy => ({ ...WHOLE_CATALOGUE, ...over });

describe("the scope's predicate", () => {
  test("the whole catalogue reads nothing, not even an unread perigee or an unknown launch", () => {
    for (const subject of [stage, with_({ bodyClass: "payload", status: "operational" }), with_({ regime: "HEO", perigeeKm: Number.NaN, ageDays: Number.NaN, bstar: Number.NaN, daysSinceStep: 0 })]) expect(inScope(subject, WHOLE_CATALOGUE)).toBe(true);
  });

  test("the classes, and payloads only when not working at the step", () => {
    const deadOrStages = scope({ classes: ["payload", "rocket body", "debris", "unknown"], payloadsNotWorking: true });
    expect(inScope(stage, deadOrStages)).toBe(true);
    expect(inScope(with_({ bodyClass: "payload", status: "nonoperational" }), deadOrStages)).toBe(true);
    expect(inScope(with_({ bodyClass: "payload", status: "operational" }), deadOrStages)).toBe(false);
    expect(inScope(with_({ bodyClass: "payload", status: "extended mission" }), deadOrStages)).toBe(false);
    expect(inScope(with_({ bodyClass: "payload", status: "unknown" }), deadOrStages)).toBe(false);
    expect(inScope(with_({ bodyClass: "payload", status: "unknown" }), { ...deadOrStages, unknownPayloads: true })).toBe(true);
    expect(inScope(stage, scope({ classes: ["payload"] }))).toBe(false);
  });

  test("the regime and the perigee band, an unread perigee out of a bounded band", () => {
    const leoHigh = scope({ regimes: ["LEO"], perigeeMinKm: 500, perigeeMaxKm: 2000 });
    expect(inScope(stage, leoHigh)).toBe(true);
    expect(inScope(with_({ perigeeKm: 450 }), leoHigh)).toBe(false);
    expect(inScope(with_({ regime: "HEO" }), leoHigh)).toBe(false);
    expect(inScope(with_({ perigeeKm: Number.NaN }), leoHigh)).toBe(false);
  });

  test("the age from launch, the quiet record and the drag term", () => {
    expect(inScope(with_({ ageDays: 200 }), scope({ minAgeDays: YEAR }))).toBe(false);
    expect(inScope(with_({ ageDays: Number.NaN }), scope({ minAgeDays: YEAR }))).toBe(false);
    expect(inScope(with_({ daysSinceStep: 100 }), scope({ quietDays: YEAR }))).toBe(false);
    expect(inScope(with_({ daysSinceStep: 400 }), scope({ quietDays: YEAR }))).toBe(true);
    expect(inScope(with_({ bstar: -3e-4 }), scope({ bstarMax: 1e-4 }))).toBe(false);
    expect(inScope(stage, scope({ bstarMax: 1e-4 }))).toBe(true);
  });
});

describe("the scoped gates", () => {
  const step: GatedStep = { zk: -40, deltaKm: -0.3, deltaVMps: -0.15, bstarRatio: 0.25, impulseConsistency: 120, explanations: 0 };

  test("open gates pass every raised step", () => {
    expect(passesGates(step, OPEN_GATES)).toBe(true);
    expect(passesGates({ ...step, deltaVMps: Number.NaN, bstarRatio: Number.NaN, impulseConsistency: Number.NaN }, OPEN_GATES)).toBe(true);
  });

  test.each([
    ["the size in sigma", { zMin: 50 }],
    ["the size in kilometres", { deltaMinKm: 0.5 }],
    ["the impulse", { deltaVMinMps: 0.2 }],
    ["the drag term's change, folded above one", { bstarRatioMin: 5 }],
    ["the kick", { consistencyMin: 200 }],
  ])("%s, by magnitude", (_, over) => {
    expect(passesGates(step, { ...OPEN_GATES, ...over })).toBe(false);
  });

  test("a drag term four times smaller passes a ratio of three; one not read passes untested; an explained step passes only where explained steps may", () => {
    expect(foldedRatio(0.25)).toBe(4);
    expect(foldedRatio(0)).toBeNaN();
    expect(passesGates(step, { ...OPEN_GATES, bstarRatioMin: 3 })).toBe(true);
    expect(passesGates({ ...step, bstarRatio: Number.NaN }, { ...OPEN_GATES, bstarRatioMin: 3 })).toBe(true);
    expect(passesGates({ ...step, explanations: 1 }, { ...OPEN_GATES, unexplainedOnly: true })).toBe(false);
    expect(passesGates({ ...step, explanations: 1 }, OPEN_GATES)).toBe(true);
  });
});
