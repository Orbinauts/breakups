import { describe, expect, test } from "vitest";
import type { Statement } from "../../src/truth.ts";
import { earliestMonth, statedOnFromRef } from "./stated.ts";

/** The hand file's statements dated from their references, by the rows the hand file carries. */

const statement = (source: Statement["source"], ref: string, from = "2022-11-12T05:24Z"): Statement => ({
  source,
  ref,
  kind: "breakup",
  parent: { catalogueNumber: 54236, designator: "2022-151B", name: "CZ-6A R/B" },
  event: { stated: "", at: null, from, to: from, precision: "minute" },
  orbit: { altitudeKm: null, apogeeKm: null, perigeeKm: null, inclinationDeg: null },
  cause: null,
  causeStated: null,
  piecesCatalogued: null,
  piecesStatedOn: null,
  preEventElements: null,
  note: null,
  statedOn: null,
});

describe("a hand-entered statement's publication day", () => {
  test("a quarterly news reference: its earliest issue's month, from the month's first day", () => {
    expect(earliestMonth("ODQN 27(1), March 2023, pp. 1-2; ODQN 28(4), October 2024, p. 2")).toBe("2023-03");
    expect(statedOnFromRef(statement("odqn", "ODQN 27(1), March 2023, pp. 1-2; ODQN 28(4), October 2024, p. 2"))).toEqual({ on: "2023-03-01", precision: "month", ref: "ODQN 27(1), March 2023, pp. 1-2; ODQN 28(4), October 2024, p. 2" });
  });

  test("an issue of the event's own month is dated to the event's day", () => {
    expect(statedOnFromRef(statement("odqn", "ODQN 30(3), September 2026, p. 1", "2026-09-13T21:03Z"))!.on).toBe("2026-09-13");
  });

  test("a notice by the day it was seen; a post or a dating by the first day its reference gives", () => {
    expect(statedOnFromRef(statement("s4s-notice", "U.S. Space Forces-Space announcement on the catalogue's login page, seen 2026-09-17"))).toMatchObject({ on: "2026-09-17", precision: "day" });
    expect(statedOnFromRef(statement("news", "LeoLabs on X, 2025-12-18 (https://x.com/...); The Register, 2025-12-23"))).toMatchObject({ on: "2025-12-18", precision: "day" });
    expect(statedOnFromRef(statement("analyst", "Jim Shell's dating, as reported by EarthSky on 2026-10-07"))).toMatchObject({ on: "2026-10-07", precision: "day" });
  });

  test("a stated day stands; the catalogue, GCAT and a reference with no date give none", () => {
    const stated = { ...statement("esa-ser", "ESA Space Environment Report 2025, Table 3.7, row 2024-04-08"), statedOn: { on: "2025-10-21", precision: "day" as const, ref: "the report's date" } };
    expect(statedOnFromRef(stated)).toBe(stated.statedOn);
    expect(statedOnFromRef(statement("catalogue", "the public catalogue: 43 objects first listed on 2026-09-04"))).toBeNull();
    expect(statedOnFromRef(statement("gcat", "entry 402 (2026-051)"))).toBeNull();
    expect(statedOnFromRef(statement("odqn", "ODQN, no month"))).toBeNull();
  });
});
