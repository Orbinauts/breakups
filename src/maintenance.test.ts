import { describe, expect, test } from "vitest";
import { ENVELOPE_MONTHS, heldLevel, isMaintenance, maintenanceToleranceKm, monthOf, newEnvelope, noteLevel, returnMissKm, snapshotEnvelope } from "./maintenance.ts";
import { DETECTOR_PARAMETERS } from "./params.ts";

/**
 * The envelope of held altitudes: the month bins, the window read back
 * from an instant, how far a level had drifted from the highest and the
 * lowest held, and the maintenance test with its tolerance, on envelopes
 * drawn by hand.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2022, 5, 15);
const params = { ...DETECTOR_PARAMETERS, maintenanceToleranceSigmas: 3, maintenanceToleranceKm: 1, maintenanceLoweringsToo: true };

describe("the envelope", () => {
  test("notes a level in its month's bin, keeps the lowest and highest, and starts a bin afresh for a newer month while ignoring an older one", () => {
    const envelope = newEnvelope();
    noteLevel(envelope, 7000.5, T0);
    noteLevel(envelope, 7000.2, T0 + DAY);
    noteLevel(envelope, 7000.9, T0 + 2 * DAY);
    const bin = envelope.month.indexOf(monthOf(T0));
    expect(bin).toBeGreaterThanOrEqual(0);
    expect(envelope.min[bin]).toBe(7000.2);
    expect(envelope.max[bin]).toBe(7000.9);
    // Twelve months on, the same bin stands for the new month and forgets the old.
    noteLevel(envelope, 6990, T0 + 365 * DAY);
    expect(envelope.min[bin]).toBe(6990);
    expect(envelope.max[bin]).toBe(6990);
    // A set from the forgotten month does not reopen it.
    noteLevel(envelope, 7005, T0);
    expect(envelope.max[bin]).toBe(6990);
    expect(envelope.month.filter(Number.isFinite)).toHaveLength(1);
  });

  test("reads how far a level had drifted below the highest altitude held over the window and above the lowest, and how many months ago each was held", () => {
    const envelope = newEnvelope();
    // January to June of a slow decay from 7001 to 7000: each month holds a fifth of a kilometre less, over a tenth of a kilometre within the month.
    for (let m = 0; m < 6; m++) {
      const at = Date.UTC(2022, m, 10);
      noteLevel(envelope, 7001 - 0.2 * m, at);
      noteLevel(envelope, 7001 - 0.2 * m - 0.1, at + 10 * DAY);
    }
    const now = T0 + 10 * DAY;
    const held = heldLevel(envelope, 6999.95, now);
    expect(held.topKm).toBeCloseTo(1.05, 9);
    expect(held.bottomKm).toBeCloseTo(0.05, 9);
    expect(held.months).toBe(6);
    expect(held.topMonthsAgo).toBe(5);
    expect(held.bottomMonthsAgo).toBe(0);
    // A window of two months sees only May and June: the top is May's.
    const short = heldLevel(envelope, 6999.95, now, 2);
    expect(short.months).toBe(2);
    expect(short.topKm).toBeCloseTo(7000.2 - 6999.95, 9);
    // Nothing held in the window at all.
    expect(heldLevel(newEnvelope(), 7000, now)).toEqual({ topKm: Number.NaN, bottomKm: Number.NaN, months: 0, topMonthsAgo: Number.NaN, bottomMonthsAgo: Number.NaN });
    expect(ENVELOPE_MONTHS).toBe(12);
  });

  test("a snapshot is a copy the original's later sets do not touch", () => {
    const envelope = newEnvelope();
    noteLevel(envelope, 7000, T0);
    const frozen = snapshotEnvelope(envelope);
    noteLevel(envelope, 7010, T0 + DAY);
    expect(heldLevel(frozen, 7000, T0 + DAY).topKm).toBe(0);
    expect(heldLevel(envelope, 7000, T0 + DAY).topKm).toBe(10);
  });

  test("the maintenance test: a step that closes a drift back to the held extreme within the tolerance; not a small step that closed no gap, not an overshoot; lowerings by the parameter; a negative floor turns it off", () => {
    expect(maintenanceToleranceKm(0.1, params)).toBe(1);
    expect(maintenanceToleranceKm(0.5, params)).toBe(1.5);
    // Drifted 3 km below the top and 0.2 above the bottom.
    const held = { topKm: 3, bottomKm: 0.2, months: 6, topMonthsAgo: 4, bottomMonthsAgo: 0 };
    expect(returnMissKm(held, 2.6)).toBeCloseTo(0.4, 9);
    expect(isMaintenance(held, 2.6, 0.01, params)).toBe(true);
    expect(isMaintenance(held, 4.5, 0.01, params)).toBe(false);
    expect(isMaintenance(held, 0.5, 0.01, params)).toBe(false);
    expect(isMaintenance(held, 2.6, 0.01, { ...params, maintenanceToleranceKm: 0.2 })).toBe(false);
    expect(isMaintenance(held, 2.6, 0.2, { ...params, maintenanceToleranceKm: 0.2 })).toBe(true);
    // An object that stayed at its top: a small raise closes no gap, whatever it lands on.
    const flat = { topKm: 0.01, bottomKm: 0.05, months: 6, topMonthsAgo: 0, bottomMonthsAgo: 0 };
    expect(isMaintenance(flat, 0.05, 0.005, { ...params, maintenanceToleranceKm: 0.02 })).toBe(false);
    // A lowering back to the bottom, by the parameter.
    const raisedForASeason = { topKm: 0.1, bottomKm: 5, months: 6, topMonthsAgo: 0, bottomMonthsAgo: 3 };
    expect(isMaintenance(raisedForASeason, -4.8, 0.01, params)).toBe(true);
    expect(isMaintenance(raisedForASeason, -4.8, 0.01, { ...params, maintenanceLoweringsToo: false })).toBe(false);
    expect(isMaintenance({ ...held, months: 0 }, 2.6, 0.01, params)).toBe(false);
    expect(isMaintenance(held, 2.6, 0.01, { ...params, maintenanceToleranceKm: -1 })).toBe(false);
  });
});
