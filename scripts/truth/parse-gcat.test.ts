import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { gcatStatements, kindOf, parseGcat } from "./parse-gcat.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "data/truth/sources/gcat-debriscat.html"), "utf8");
const gcat = parseGcat(html);
const record = (JSON.parse(readFileSync(resolve(ROOT, "data/truth/sources.json"), "utf8")) as { snapshots: Record<string, { snapshotSha256: string }> }).snapshots;

/** The calendar day of GCAT's update line, derived here again so the test checks the statements' day and not one edition's value. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayOf = (updated: string): string => {
  const m = /^(\d{4}) ([A-Z][a-z]{2}) (\d{1,2})/.exec(updated)!;
  return `${m[1]}-${String(MONTHS.indexOf(m[2]!) + 1).padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
};

// The snapshot is refreshed by the weekly maintenance, so nothing here may name its edition: the update line, the day it gives and the counts are checked as relations to the snapshot read, which must be the one the sources record names.
describe("GCAT's debris clouds, read whole", () => {
  test("is the snapshot the sources record names", () => {
    expect(createHash("sha256").update(html).digest("hex")).toBe(record["gcat"]!.snapshotSha256);
  });

  test("yields every numbered entry, each under its own file name, with GCAT's update line", () => {
    expect(gcat.updated).toMatch(/^\d{4} [A-Z][a-z]{2} \d{1,2} \d{4}:\d{2}(?::\d{2})?$/);
    expect(gcat.rows.length).toBeGreaterThan(300);
    // GCAT has numbered two entries alike: the file name tells every entry apart.
    expect(new Set(gcat.rows.map((r) => r.filename)).size).toBe(gcat.rows.length);
    for (const row of gcat.rows) expect(Number.isInteger(row.number) && row.number > 0, row.filename).toBe(true);
  });

  test("Meteor 2-7's 2004 cloud reads as the table prints it", () => {
    const row = gcat.rows.find((r) => r.filename === "81043")!;
    expect(row).toMatchObject({ piece: "1981-043", name: "Meteor-2 No. 8", parent: { kind: "catalogue", number: 12456 }, sdate: "2004 Jul?", eventType: "Battery", eventPerigeeKm: 826, eventApogeeKm: 895, eventInclinationDeg: 81.26, label: "MET2-8" });
    expect(row.catalogued).toBeGreaterThanOrEqual(21);
  });

  test("parents are catalogue numbers, analyst objects or none, catalogue numbers the most", () => {
    const kinds = new Map<string, number>();
    for (const row of gcat.rows) kinds.set(row.parent?.kind ?? "none", (kinds.get(row.parent?.kind ?? "none") ?? 0) + 1);
    expect([...kinds.keys()].every((kind) => ["catalogue", "analyst", "none"].includes(kind))).toBe(true);
    expect(kinds.get("catalogue")!).toBeGreaterThan(0.9 * gcat.rows.length);
  });

  test("one statement per cloud, every window well formed, every count stated on the update line's day", () => {
    const statements = gcatStatements(gcat);
    expect(statements).toHaveLength(gcat.rows.length);
    const statedOn = dayOf(gcat.updated);
    for (const s of statements) {
      expect(s.event.to >= (s.event.from ?? "")).toBe(true);
      expect(s.piecesStatedOn).toBe(statedOn);
    }
    expect(statements.filter((s) => s.event.to >= "2005").length).toBeGreaterThan(100);
  });
});

describe("GCAT's event types", () => {
  test.each([
    ["Resid", "breakup", "propulsion"],
    ["Resid?", "breakup", null],
    ["ASAT", "breakup", "collision-deliberate"],
    ["Destruct", "breakup", "deliberate"],
    ["Coll", "breakup", "collision-accidental"],
    ["Battery", "breakup", "battery"],
    ["Unknown", "breakup", "unknown"],
    ["Tumble", "breakup", null],
    ["Aerodyn", "aerodynamic", "aerodynamic"],
    ["Deploy", "release", null],
    ["Insul?", "release", null],
  ])("%s is a %s, cause %s", (type, kind, cause) => {
    expect(kindOf(type)).toEqual({ kind, cause });
  });
});
