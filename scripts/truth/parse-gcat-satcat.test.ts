import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { isSatcatStatement, parseSatcat, readPieceType, reduceSatcat, runsOf, satcatStatements, separationsOf, statedDateOf, type Piece, type SatcatRow } from "./parse-gcat-satcat.ts";
import { parseVagueDate } from "./dates.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const text = readFileSync(resolve(ROOT, "data/truth/sources/gcat-satcat.tsv"), "utf8");
const satcat = parseSatcat(text);
const { separations, skipped } = separationsOf(satcat);
const statements = satcatStatements(satcat);
const record = (JSON.parse(readFileSync(resolve(ROOT, "data/truth/sources.json"), "utf8")) as { snapshots: Record<string, { snapshotSha256: string }> }).snapshots;

describe("GCAT's satellite catalogue, read whole", () => {
  test("is the snapshot the sources record names, and reducing it again changes nothing", () => {
    expect(createHash("sha256").update(text).digest("hex")).toBe(record["gcat-satcat"]!.snapshotSha256);
    expect(reduceSatcat(text).text).toBe(text);
  });

  test("yields every row with GCAT's update line", () => {
    expect(satcat.updated).toBe("2026 Oct 9 1800:46");
    expect(satcat.rows).toHaveLength(39_175);
    expect(skipped).toEqual({ notAPiece: 3345, parentNotACatalogueObject: 29, noSeparationDate: 0, releasedAtLaunch: 5011, separatedBeforeLaunch: 2 });
    expect(separations).toHaveLength(statements.length);
    expect(statements).toHaveLength(2387);
  });

  test("every statement is the satellite catalogue's, its window well formed and its count its pieces", () => {
    for (const [i, s] of statements.entries()) {
      expect(isSatcatStatement(s)).toBe(true);
      expect(s.event.to >= (s.event.from ?? "")).toBe(true);
      expect(s.piecesCatalogued).toBe(separations[i]!.pieces.length);
      expect(s.piecesStatedOn).toBe("2026-10-09");
    }
  });
});

describe("real rows", () => {
  test("Yaogan-6's four pieces of about July 2014 are one anomalous separation", () => {
    const yaogan = statements.filter((s) => s.parent.catalogueNumber === 34839);
    expect(yaogan).toHaveLength(1);
    expect(yaogan[0]).toMatchObject({
      source: "gcat",
      ref: "GCAT satellite catalogue (satcat.tsv, updated 2026 Oct 9 1800:46), parent S34839, 4 pieces 40065 to 40068",
      kind: "anomalous",
      parent: { catalogueNumber: 34839, designator: "2009-021A", name: "Yaogan Weixing 6" },
      event: { stated: "2014 Jul?", at: null, from: "2014-06-01T00:00Z", to: "2014-09-01T00:00Z", precision: "month" },
      cause: null,
      piecesCatalogued: 4,
    });
    expect(yaogan[0]!.note).toContain("Type: payload;");
    expect(yaogan[0]!.note).toContain("Parent launched 22 Apr 2009.");
  });

  test("Fengyun 1C's cloud of 11 January 2007 is one breakup at the minute GCAT states", () => {
    const fy = statements.filter((s) => s.parent.catalogueNumber === 25730);
    expect(fy).toHaveLength(1);
    expect(fy[0]).toMatchObject({ kind: "breakup", cause: "collision-deliberate", event: { stated: "2007 Jan 11 2228", at: "2007-01-11T22:28Z", precision: "minute" } });
    expect(fy[0]!.piecesCatalogued).toBeGreaterThan(3000);
  });

  test("ESSA 9's despin weights, dated ten days before its launch, make no statement", () => {
    expect(statements.filter((s) => s.parent.catalogueNumber === 3764)).toHaveLength(0);
  });

  test("a fairing released at launch makes no statement; pieces of an auxiliary-catalogue parent are keyed by their launch", () => {
    // S00044, Midas 2's fairing, separated from its Agena (A00050) on the launch day.
    expect(statements.some((s) => s.ref.includes("parent A00050"))).toBe(false);
    for (const s of statements.filter((x) => x.parent.catalogueNumber === null)) {
      expect(s.ref).toMatch(/parent A\d+/);
      expect(s.note).toContain("auxiliary-catalogue object");
    }
  });
});

describe("the SatType read", () => {
  test.each([
    ["D  P", "breakup", "propulsion"],
    ["D  B", "breakup", "battery"],
    ["D  I", "breakup", "collision-accidental"],
    ["D  W", "breakup", "collision-deliberate"],
    ["D  Z", "breakup", "deliberate"],
    ["D  X", "breakup", null],
    ["D", "breakup", null],
    ["D  J", "anomalous", null],
    ["C  J", "anomalous", null],
    ["D  Q", "aerodynamic", "aerodynamic"],
    ["D  K", "release", null],
    ["D  N", "release", null],
    ["D  O", "release", null],
    ["C  F", "release", null],
    ["C  M", "release", null],
    ["C  H", "release", null],
  ])("%s is a %s, cause %s", (type, kind, cause) => {
    expect(readPieceType(type)).toMatchObject({ kind, cause });
  });

  test("a payload or a stage is not a piece", () => {
    expect(() => readPieceType("P")).toThrow();
    expect(() => readPieceType("R2")).toThrow();
  });
});

describe("the separation date and the piece runs", () => {
  const piece = (sdate: string): Piece => ({ row: {} as SatcatRow, number: 1, reading: readPieceType("D  P"), event: parseVagueDate(sdate) });

  test("most pieces' date wins; a tie goes to the finer date, then the earlier", () => {
    expect(statedDateOf([piece("2014 Jul?"), piece("2014 Jul 3"), piece("2014 Jul?")]).stated).toBe("2014 Jul?");
    expect(statedDateOf([piece("2014 Jul?"), piece("2014 Jul 3")]).stated).toBe("2014 Jul 3");
    expect(statedDateOf([piece("2014 Jul 4"), piece("2014 Jul 3")]).stated).toBe("2014 Jul 3");
  });

  test("numbers are written as runs, the long tail counted", () => {
    expect(runsOf([40068, 40065, 40066, 40067])).toBe("40065 to 40068");
    expect(runsOf([1, 2, 5, 7, 8, 9])).toBe("1, 2, 5, 7 to 9");
    expect(runsOf([1, 3, 5, 7], 2)).toBe("1, 3 and 2 more runs, to 7");
  });
});
