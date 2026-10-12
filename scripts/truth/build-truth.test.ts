import { describe, expect, test } from "vitest";
import type { Statement } from "../../src/truth.ts";
import { groupStatements } from "./build-truth.ts";
import { SATCAT_REF_PREFIX } from "./parse-gcat-satcat.ts";

/** Statements grouped into events, by the build's rules, on statements made up to show each rule. */

const statement = (source: Statement["source"], ref: string, at: string, overrides: Partial<Statement> = {}): Statement => ({
  source,
  ref,
  kind: "breakup",
  parent: { catalogueNumber: 28932, designator: "2006-002B", name: "ALOS-1 R/B" },
  event: { stated: at, at, from: at, to: at, precision: "minute" },
  orbit: { altitudeKm: null, apogeeKm: null, perigeeKm: null, inclinationDeg: null },
  cause: null,
  causeStated: null,
  piecesCatalogued: null,
  piecesStatedOn: null,
  preEventElements: null,
  note: null,
  statedOn: null,
  ...overrides,
});

const day = (source: Statement["source"], ref: string, date: string, overrides: Partial<Statement> = {}): Statement => {
  const next = new Date(Date.parse(`${date}T00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return statement(source, ref, `${date}T00:00Z`, { event: { stated: date, at: null, from: `${date}T00:00Z`, to: `${next}T00:00Z`, precision: "day" }, ...overrides });
};

const satcat = (date: string, pieces: number): Statement => day("gcat", `${SATCAT_REF_PREFIX} (satcat.tsv), parent S28932, ${pieces} pieces`, date, { piecesCatalogued: pieces });

/** The groups as the refs of their statements, in the order the groups and their statements come. */
const refsOf = (statements: Statement[]): string[][] => groupStatements(statements, []).map((group) => group.statements.map((s) => s.ref));

describe("the same-event rule", () => {
  test("two instants NASA states of one parent nineteen days apart are two events, each source's statement joining the instant it states", () => {
    const nasaFirst = statement("hoosf-16e", "NASA, event 1 of 2", "2006-08-08T14:07Z");
    const nasaSecond = statement("hoosf-16e", "NASA, event 2 of 2", "2006-08-27T16:18Z");
    const cloud = statement("gcat", "GCAT cloud", "2006-08-27T16:18Z");
    expect(refsOf([nasaFirst, nasaSecond, cloud, satcat("2006-08-08", 4), satcat("2006-08-27", 17)])).toEqual([
      ["NASA, event 1 of 2", `${SATCAT_REF_PREFIX} (satcat.tsv), parent S28932, 4 pieces`],
      ["NASA, event 2 of 2", "GCAT cloud", `${SATCAT_REF_PREFIX} (satcat.tsv), parent S28932, 17 pieces`],
    ]);
  });

  test("a separation the satellite catalogue dates weeks before NASA's instant stands apart, whichever of the catalogue's two it meets first", () => {
    const nasa = statement("hoosf-16e", "NASA", "2003-12-09T01:29Z");
    const cloud = statement("gcat", "GCAT cloud", "2003-12-09T01:29Z");
    expect(refsOf([nasa, cloud, satcat("2003-11-19", 3), satcat("2003-12-09", 9)])).toEqual([
      ["NASA", "GCAT cloud", `${SATCAT_REF_PREFIX} (satcat.tsv), parent S28932, 9 pieces`],
      [`${SATCAT_REF_PREFIX} (satcat.tsv), parent S28932, 3 pieces`],
    ]);
  });

  test("two sources a week apart on one event stay one event, their disagreement a conflict", () => {
    expect(refsOf([statement("hoosf-16e", "NASA", "2019-08-12T13:58Z"), statement("gcat", "GCAT cloud", "2019-08-19T13:58Z")])).toEqual([["NASA", "GCAT cloud"]]);
  });

  test("NASA's aerodynamic table read twice from one wrapped row, and a station's releases weeks apart, stay one event each", () => {
    const aerodynamic = { kind: "aerodynamic" as const };
    expect(refsOf([day("hoosf-16e", "Table 4.1-1, reentry", "2008-01-21", aerodynamic), day("hoosf-16e", "Table 4.1-1, breakup", "2008-01-16", aerodynamic)])).toHaveLength(1);
    const release = { kind: "release" as const };
    expect(refsOf([day("gcat", `${SATCAT_REF_PREFIX} a`, "1984-07-10", release), day("gcat", `${SATCAT_REF_PREFIX} b`, "1984-07-29", release)])).toHaveLength(1);
  });

  test("a news outlet and another a week apart are not one source's two instants", () => {
    expect(refsOf([day("news", "LeoLabs", "2026-03-29"), day("news", "a newspaper", "2026-04-05")])).toHaveLength(1);
  });
});
