import { describe, expect, test } from "vitest";
import { dayOf, endedByOf, operationalAt } from "./elements.ts";

/** The status as of a step: the dated window of the end of contact read against the step's instant, with a month either side of it read as nothing, and today's status where no end is dated. */

const DAY = 86_400_000;
const DATED = { opsStatusDated: true, endedUnknownDays: 30 };
const TODAY = { opsStatusDated: false, endedUnknownDays: 30 };

describe("the status as of a step", () => {
  const hitomi = { opsStatus: "nonoperational" as const, endedFromMs: dayOf("2016-03-26"), endedByMs: endedByOf("2016-03-26") };
  // "2021?": the end may fall anywhere in 2020 to 2022.
  const vague = { opsStatus: "nonoperational" as const, endedFromMs: dayOf("2020-01-01"), endedByMs: endedByOf("2022-12-31") };

  test("an end of contact runs from the first day's midnight to the midnight after the last", () => {
    expect(new Date(hitomi.endedByMs!).toISOString()).toBe("2016-03-27T00:00:00.000Z");
    expect(new Date(hitomi.endedFromMs!).toISOString()).toBe("2016-03-26T00:00:00.000Z");
    expect(endedByOf(null)).toBeNull();
    expect(dayOf("")).toBeNull();
    expect(() => endedByOf("not a day")).toThrow();
  });

  test.each([
    ["a step two months before the end could have been a burn", hitomi.endedFromMs! - 60 * DAY, "operational"],
    ["a step a fortnight before the end may be its cause", hitomi.endedFromMs! - 14 * DAY, "unknown"],
    ["a step on the day of the end may be its cause", hitomi.endedFromMs! + 2 * 3_600_000, "unknown"],
    ["a step within the month after the end says nothing", hitomi.endedByMs! + 29 * DAY, "unknown"],
    ["a step a month after the end is a dead object's", hitomi.endedByMs! + 30 * DAY, "nonoperational"],
  ] as const)("%s", (_, at, status) => {
    expect(operationalAt(hitomi, at, DATED)).toBe(status);
  });

  test("a step inside a vague end's window says nothing; before and after it, the window's edges decide", () => {
    expect(operationalAt(vague, Date.UTC(2021, 5, 1), DATED)).toBe("unknown");
    expect(operationalAt(vague, Date.UTC(2019, 0, 1), DATED)).toBe("operational");
    expect(operationalAt(vague, Date.UTC(2023, 6, 1), DATED)).toBe("nonoperational");
  });

  test("with no dated end, only a working status today is read; read as of today, the status is today's whatever the date", () => {
    expect(operationalAt({ opsStatus: "operational", endedByMs: null }, 0, DATED)).toBe("operational");
    expect(operationalAt({ opsStatus: "nonoperational", endedByMs: null }, 0, DATED)).toBe("unknown");
    expect(operationalAt({ opsStatus: "decayed" }, 0, DATED)).toBe("unknown");
    expect(operationalAt({}, 0, DATED)).toBe("unknown");
    expect(operationalAt(hitomi, hitomi.endedFromMs! - 365 * DAY, TODAY)).toBe("nonoperational");
  });
});
