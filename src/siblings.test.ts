import { describe, expect, test } from "vitest";
import { DETECTOR_PARAMETERS } from "./params.ts";
import { LEDGER_DAYS, LEDGER_MAX, isDeploying, matesOf, newLedger, noteLedgerStep, siblingsOf, similarSteps, towardsMates, type LedgerStep } from "./siblings.ts";

/**
 * The ledger of recent steps and the siblings read from it, and where a
 * launch's mates fly, on ledgers drawn by hand: a launch's campaign, a
 * shell-mate of another launch, a step of the other sign, a step too
 * small, a step too old, and a straggler climbing towards its mates.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2023, 2, 1);
const params = { ...DETECTOR_PARAMETERS, siblingWindowDays: 14, siblingSizeFactor: 2, siblingsMin: 2, siblingOrbitInclinationDeg: 0.1, siblingOrbitAltitudeKm: 50, deployAgeDays: 180 };
const step = (number: number, daysAgo: number, deltaKm: number, extra: Partial<LedgerStep> = {}): LedgerStep => ({ number, launchCode: 2023_001, epochMs: T0 - daysAgo * DAY, aKm: 6900, inclinationDeg: 53.05, deltaKm, ...extra });

describe("the ledger", () => {
  test("keeps steps in epoch order and prunes those older than its reach and the oldest past its size", () => {
    const ledger = newLedger();
    noteLedgerStep(ledger, step(1, 5, 1));
    noteLedgerStep(ledger, step(2, 40, 1));
    noteLedgerStep(ledger, step(3, 10, 1));
    expect(ledger.number).toEqual([3, 1]);
    expect(LEDGER_DAYS).toBe(28);
    const full = newLedger();
    for (let i = 0; i < LEDGER_MAX + 10; i++) noteLedgerStep(full, step(i, 0, 1, { epochMs: T0 + i }));
    expect(full.number).toHaveLength(LEDGER_MAX);
    expect(full.number[0]).toBe(10);
  });

  test("two steps are alike when of one sign and within the factor in size", () => {
    expect(similarSteps(5, 4, params)).toBe(true);
    expect(similarSteps(5, 11, params)).toBe(false);
    expect(similarSteps(5, 2.4, params)).toBe(false);
    expect(similarSteps(5, -5, params)).toBe(false);
    expect(similarSteps(0, 5, params)).toBe(false);
  });

  test("the siblings: launch-mates by the launch code, shell-mates by the orbit, neither for the other sign, a size out of the factor, a step too old, a later step, or the object itself", () => {
    const ledger = newLedger();
    noteLedgerStep(ledger, step(11, 3, 5));
    noteLedgerStep(ledger, step(12, 6, 4));
    noteLedgerStep(ledger, step(12, 2, 4.5));
    noteLedgerStep(ledger, step(13, 1, -5));
    noteLedgerStep(ledger, step(14, 4, 20));
    noteLedgerStep(ledger, step(15, 20, 5));
    noteLedgerStep(ledger, step(21, 2, 5, { launchCode: 2023_002 }));
    noteLedgerStep(ledger, step(22, 2, 5, { launchCode: 2023_002, inclinationDeg: 53.4 }));
    noteLedgerStep(ledger, step(23, 2, 5, { launchCode: 2023_002, aKm: 7000 }));
    noteLedgerStep(ledger, step(99, -1, 5));
    const mine = step(99, 0, 5);
    const siblings = siblingsOf(ledger, mine, params);
    expect(siblings).toEqual({ launch: 2, orbit: 1 });
    // The window: fifteen days reaches object 15's step too.
    expect(siblingsOf(ledger, mine, { ...params, siblingWindowDays: 21 }).launch).toBe(3);
    // No launch: launch-mates do not exist, shell-mates do.
    expect(siblingsOf(ledger, { ...mine, launchCode: 0 }, params)).toEqual({ launch: 0, orbit: 3 });
  });

  test("the mates: the launch's other payloads with a known altitude, their median, and whether a step carries the object towards them by at least half its length", () => {
    const bodies = [
      { number: 1, bodyClass: "payload" as const },
      { number: 2, bodyClass: "payload" as const },
      { number: 3, bodyClass: "payload" as const },
      { number: 4, bodyClass: "rocket body" as const },
      { number: 5, bodyClass: "payload" as const },
    ];
    const altitudes = new Map([
      [2, 7100],
      [3, 7110],
      [4, 6800],
    ]);
    const mates = matesOf(bodies, 1, (n) => altitudes.get(n) ?? null);
    expect(mates).toEqual({ count: 2, medianAKm: 7105 });
    expect(towardsMates(6900, 6905, mates, 2.5)).toBe(true);
    expect(towardsMates(6900, 6895, mates, 2.5)).toBe(false);
    expect(towardsMates(7104, 7106, mates, 1)).toBe(false);
    expect(towardsMates(6900, 6905, { count: 0, medianAKm: Number.NaN }, 2.5)).toBe(false);
    expect(isDeploying(30, true, mates, params)).toBe(true);
    expect(isDeploying(200, true, mates, params)).toBe(false);
    expect(isDeploying(30, false, mates, params)).toBe(false);
    expect(isDeploying(30, true, { count: 0, medianAKm: Number.NaN }, params)).toBe(false);
  });
});
