import { describe, expect, test } from "vitest";
import { EARLIEST_YEAR, FRESH_VALIDATION, IN_ORBIT_FROM, SCORECARD_FROM, SCORED_FROM, scoredYears } from "./years.ts";

describe("the years in one place", () => {
  test("the fresh validation runs 1995 to 2004 with 1994 as its warm-up, below the scorecard's 2005 and its first scored year 2006", () => {
    expect(FRESH_VALIDATION).toEqual({ warmup: 1994, from: 1995, through: 2004 });
    expect(EARLIEST_YEAR).toBe(1994);
    expect(IN_ORBIT_FROM).toBe("1994-01-01");
    expect(SCORECARD_FROM).toBe(2005);
    expect(SCORED_FROM).toBe(2006);
    expect(FRESH_VALIDATION.through + 1).toBe(SCORECARD_FROM);
  });

  test("the years the scorecard may replay leave the fresh validation's out, in order", () => {
    expect(scoredYears([2026, 1994, 2005, 2004, 1995, 2006])).toEqual([2005, 2006, 2026]);
    expect(scoredYears([])).toEqual([]);
  });
});
