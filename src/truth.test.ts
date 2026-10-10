import { describe, expect, test } from "vitest";
import { firstAgencyStatement, firstStatementOf, launchOf, readBreakups, readStatement, readStatements, TruthError, yearOf, type Statement } from "./index.ts";

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
  statedOn: { on: "2023-10-01", precision: "month", ref: "ODQN 27(4), October 2023" },
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
  firstStatement: { on: "2023-10-01", precision: "month", ref: "ODQN 27(4), October 2023", source: "odqn" },
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
    ["a publication day that is a month", { ...statement, statedOn: { ...statement.statedOn, on: "2023-10" } }, "on is not a day"],
    ["a publication day dated to the year", { ...statement, statedOn: { ...statement.statedOn, precision: "year" } }, "precision is not one of day, month"],
    ["a publication day with no reference", { ...statement, statedOn: { on: "2023-10-01", precision: "month" } }, "no ref"],
  ] as const)("is refused with %s", (_, input, reason) => {
    expect(() => readStatement(input, "it")).toThrow(TruthError);
    expect(() => readStatement(input, "it")).toThrow(reason);
  });
});

describe("a statement's publication day", () => {
  test("a hand-entered statement may leave it out, and reads it as null", () => {
    const { statedOn: _, ...undated } = statement;
    expect(readStatement(undated, "it").statedOn).toBeNull();
    expect(readStatement({ ...statement, statedOn: null }, "it").statedOn).toBeNull();
  });

  const at = (source: Statement["source"], on: string | null, precision: "day" | "month" = "day"): Statement => ({ ...(readStatement(statement, "it") as Statement), source, statedOn: on === null ? null : { on, precision, ref: source } });

  test("the first statement is the earliest dated one, a day before a month on the same day, whoever made it", () => {
    expect(firstStatementOf([at("odqn", "2023-10-01", "month"), at("news", "2023-07-02"), at("gcat", null)])).toEqual({ on: "2023-07-02", precision: "day", ref: "news", source: "news" });
    expect(firstStatementOf([at("odqn", "2023-10-01", "month"), at("s4s-notice", "2023-10-01")])).toMatchObject({ source: "s4s-notice", precision: "day" });
    expect(firstStatementOf([at("gcat", null)])).toBeNull();
  });

  test("the first agency statement leaves out the analyst, the companies and the news", () => {
    expect(firstAgencyStatement({ statements: [at("news", "2023-07-02"), at("analyst", "2023-07-01"), at("odqn", "2023-10-01", "month")] })).toMatchObject({ source: "odqn", on: "2023-10-01" });
    expect(firstAgencyStatement({ statements: [at("news", "2023-07-02")] })).toBeNull();
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
    ["no first statement", { ...file, breakups: [(({ firstStatement: _, ...rest }) => rest)(breakup)] }, "no firstStatement"],
    ["a first statement no statement makes", { ...file, breakups: [{ ...breakup, firstStatement: { ...breakup.firstStatement, on: "2023-09-01" } }] }, "names no statement of the event dated so"],
    ["a first statement by a source not listed", { ...file, breakups: [{ ...breakup, firstStatement: { ...breakup.firstStatement, source: "rumour" } }] }, "source is not one of"],
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
