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

/** The calendar day of GCAT's update line, derived here again so the test checks the parser's derivation and not one edition's value. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayOf = (updated: string): string => {
  const m = /^(\d{4}) ([A-Z][a-z]{2}) (\d{1,2}) \d{4}:\d{2}$/.exec(updated);
  if (m === null) throw new Error(`not GCAT's update line: ${updated}`);
  return `${m[1]}-${String(MONTHS.indexOf(m[2]!) + 1).padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
};

// The snapshot is refreshed by the weekly maintenance, so nothing here may name its edition: the update line, the day it gives and the counts are checked as relations to the snapshot read.
describe("GCAT's satellite catalogue, read whole", () => {
  test("is the snapshot the sources record names, and reducing it again changes nothing", () => {
    expect(createHash("sha256").update(text).digest("hex")).toBe(record["gcat-satcat"]!.snapshotSha256);
    expect(reduceSatcat(text).text).toBe(text);
  });

  test("yields every row with GCAT's update line; each row is a piece of a separation or skipped for one reason", () => {
    expect(satcat.updated).toMatch(/^\d{4} [A-Z][a-z]{2} \d{1,2} \d{4}:\d{2}$/);
    const kept = separations.reduce((n, s) => n + s.pieces.length, 0);
    const skippedTotal = Object.values(skipped).reduce((n, c) => n + c, 0);
    expect(kept).toBeGreaterThan(0);
    expect(kept + skippedTotal).toBe(satcat.rows.length);
    expect(statements).toHaveLength(separations.length);
  });

  test("every statement is the satellite catalogue's, its window well formed, its count its pieces and its pieces stated on the update line's day", () => {
    const statedOn = dayOf(satcat.updated);
    for (const [i, s] of statements.entries()) {
      expect(isSatcatStatement(s)).toBe(true);
      expect(s.event.to >= (s.event.from ?? "")).toBe(true);
      expect(s.piecesCatalogued).toBe(separations[i]!.pieces.length);
      expect(s.piecesStatedOn).toBe(statedOn);
      expect(s.ref).toContain(`(satcat.tsv, updated ${satcat.updated})`);
    }
  });
});

describe("a catalogue written for the test", () => {
  // One row per reason to skip, and three pieces of one parent in two separations; its update line is no edition the snapshot ever had.
  const HEADER = "#JCAT\tSatcat\tLaunch_Tag\tPiece\tType\tName\tLDate\tParent\tSDate\tDDate\tStatus";
  const row = (jcat: string, piece: string, type: string, name: string, parent: string, sdate: string): string => `${jcat}    \t${jcat.slice(1)}\t2001-001\t${piece}\t${type.padEnd(12)}\t${name}\t2001 Jan  1\t${parent}\t${sdate}\t-\tO`;
  const TSV = [
    HEADER,
    "# Updated 2031 Feb  3 0912:44",
    row("S10000", "2001-001A", "P", "Parent", "S10001", "2001 Jan  1 1200"),
    row("S10001", "2001-001B", "R2", "Stage", "-", "2001 Jan  1 1150"),
    row("S10002", "2001-001C", "D  P", "deb of no parent", "-", "2003 May  5"),
    row("S10003", "2001-001D", "D  P", "deb undated", "S10000", "-"),
    row("S10004", "2001-001E", "D  P", "deb before launch", "S10000", "2000 Dec 25"),
    row("S10005", "2001-001F", "C  F", "fairing", "S10000", "2001 Jan  1"),
    row("S10006", "2001-001G", "D  P", "deb", "S10000", "2003 May  5"),
    row("S10007", "2001-001H", "D  P", "deb", "S10000", "2003 May  6"),
    row("S10008", "2001-001J", "D  J", "deb", "S10000", "2010 Jan?"),
    "",
  ].join("\n");
  const written = parseSatcat(TSV);

  test("counts each skipped row under its reason, and the rest into separations", () => {
    const { separations: found, skipped: why } = separationsOf(written);
    expect(written.rows).toHaveLength(9);
    expect(why).toEqual({ notAPiece: 2, parentNotACatalogueObject: 1, noSeparationDate: 1, releasedAtLaunch: 1, separatedBeforeLaunch: 1 });
    expect(found.map((s) => s.pieces.map((p) => p.number))).toEqual([[10006, 10007], [10008]]);
  });

  test("states its pieces on the day of its update line, and names the line in each ref", () => {
    const found = satcatStatements(written);
    expect(written.updated).toBe("2031 Feb 3 0912:44");
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ kind: "breakup", cause: "propulsion", piecesCatalogued: 2, piecesStatedOn: "2031-02-03", ref: "GCAT satellite catalogue (satcat.tsv, updated 2031 Feb 3 0912:44), parent S10000, 2 pieces 10006, 10007" });
    expect(found[1]).toMatchObject({ kind: "anomalous", cause: null, piecesCatalogued: 1, piecesStatedOn: "2031-02-03" });
  });
});

describe("real rows", () => {
  test("Yaogan-6's four pieces of about July 2014 are one anomalous separation", () => {
    const yaogan = statements.filter((s) => s.parent.catalogueNumber === 34839);
    expect(yaogan).toHaveLength(1);
    expect(yaogan[0]).toMatchObject({
      source: "gcat",
      ref: `GCAT satellite catalogue (satcat.tsv, updated ${satcat.updated}), parent S34839, 4 pieces 40065 to 40068`,
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
