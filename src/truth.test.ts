import { describe, expect, test } from "vitest";
import { launchOf, readBreakups, readStatement, readStatements, TruthError, yearOf } from "./index.ts";

const statement = {
  source: "odqn",
  ref: "ODQN 27(4) p. 1",
  kind: "breakup",
  parent: { catalogueNumber: 21299, designator: "1991-033A", name: "Cosmos 2143" },
  event: { stated: "29 June 2023, 06:49 GMT", at: "2023-06-29T06:49Z", from: "2023-06-29T06:49Z", to: "2023-06-29T06:49Z", precision: "minute" },
  orbit: { altitudeKm: 1400, apogeeKm: 1416, perigeeKm: 1398, inclinationDeg: null },
  cause: "unknown",
  causeStated: "unknown",
  piecesCatalogued: 6,
  piecesStatedOn: "2023-10",
  preEventElements: null,
  note: null,
};

const breakup = {
  id: "21299:2023-06-29",
  parent: { catalogueNumber: 21299, designator: "1991-033A", name: "Cosmos 2143", class: "payload", owner: null, launchedOn: "1991-05-16" },
  kind: "breakup",
  event: statement.event,
  orbit: { altitudeKm: 1400, apogeeKm: 1416, perigeeKm: 1398, inclinationDeg: null, regime: "LEO" },
  cause: "unknown",
  piecesCatalogued: 6,
  confidence: "A",
  scoreable: true,
  exemptReason: null,
  resolvedFrom: { event: "odqn", orbit: "odqn", cause: "odqn", pieces: "odqn", kind: "odqn" },
  statements: [statement],
  conflicts: [],
  overrides: [],
};

const file = { format: 1, sources: {}, breakups: [breakup] };

describe("a statement", () => {
  test("is read as written", () => {
    expect(readStatement(statement, "it")).toEqual(statement);
    expect(readStatements([statement])).toEqual([statement]);
  });

  test.each([
    ["an unknown field", { ...statement, extra: 1 }, "unknown field extra"],
    ["a missing field", (({ note: _, ...rest }) => rest)(statement), "no note"],
    ["a source not listed", { ...statement, source: "wikipedia" }, "source is not one of"],
    ["a window that runs backwards", { ...statement, event: { ...statement.event, from: "2023-06-30T00:00Z" } }, "runs backwards"],
    ["an instant outside its window", { ...statement, event: { ...statement.event, at: "2023-06-28T00:00Z" } }, "outside the window"],
    ["an instant that is not UTC", { ...statement, event: { ...statement.event, at: "2023-06-29T06:49", from: "2023-06-29T06:49" } }, "not an ISO 8601 UTC instant"],
    ["no upper edge", { ...statement, event: { ...statement.event, at: null, from: null, to: null } }, "every statement has an upper edge"],
    ["a designator of the wrong shape", { ...statement, parent: { ...statement.parent, designator: "91033A" } }, "designator is not like"],
    ["a catalogue number that is not positive", { ...statement, parent: { ...statement.parent, catalogueNumber: 0 } }, "positive whole number"],
    ["a piece count day that is not a day", { ...statement, piecesStatedOn: "October" }, "piecesStatedOn is not a day"],
  ] as const)("is refused with %s", (_, input, reason) => {
    expect(() => readStatement(input, "it")).toThrow(TruthError);
    expect(() => readStatement(input, "it")).toThrow(reason);
  });
});

describe("the breakups file", () => {
  test("is read as written", () => {
    expect(readBreakups(file)).toEqual([breakup]);
  });

  test.each([
    ["another format", { ...file, format: 2 }, "format 2 is not 1"],
    ["no list", { ...file, breakups: {} }, "has no list of breakups"],
    ["an id of the wrong shape", { ...file, breakups: [{ ...breakup, id: "cosmos-2143" }] }, "is not a parent and a day"],
    ["an unnamed event with a parent", { ...file, breakups: [{ ...breakup, kind: "unnamed" }] }, "an unnamed event names no parent"],
    ["an exempt reason on a scoreable event", { ...file, breakups: [{ ...breakup, exemptReason: "none" }] }, "exactly when"],
    ["no exempt reason on an event kept out", { ...file, breakups: [{ ...breakup, scoreable: false }] }, "exactly when"],
    ["no statements", { ...file, breakups: [{ ...breakup, statements: [] }] }, "has no statements"],
    ["a regime not listed", { ...file, breakups: [{ ...breakup, orbit: { ...breakup.orbit, regime: "cislunar" } }] }, "regime is not one of"],
    ["two events with one id", { ...file, breakups: [breakup, breakup] }, "its id is not unique"],
  ] as const)("is refused with %s", (_, input, reason) => {
    expect(() => readBreakups(input)).toThrow(TruthError);
    expect(() => readBreakups(input)).toThrow(reason);
  });

  test("names the row that fails", () => {
    expect(() => readBreakups({ ...file, breakups: [{ ...breakup, cause: "gremlins" }] })).toThrow("breakup 1 (Cosmos 2143): cause is not one of");
  });
});

describe("helpers", () => {
  test("the launch of a designator", () => {
    expect(launchOf("1981-043A")).toBe("1981-043");
    expect(launchOf("2018-005")).toBe("2018-005");
    expect(launchOf(null)).toBeNull();
  });

  test("the year an event counts in", () => {
    expect(yearOf({ event: { stated: "", at: null, from: "2019-12-31T23:00Z", to: "2020-01-02T00:00Z", precision: "day" } })).toBe(2019);
    expect(yearOf({ event: { stated: "", at: null, from: null, to: "2026-09-04T00:00Z", precision: "none" } })).toBe(2026);
  });
});
