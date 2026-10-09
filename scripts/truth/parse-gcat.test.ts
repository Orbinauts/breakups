import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { gcatStatements, kindOf, parseGcat } from "./parse-gcat.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const gcat = parseGcat(readFileSync(resolve(ROOT, "data/truth/sources/gcat-debriscat.html"), "utf8"));

describe("GCAT's debris clouds, read whole", () => {
  test("yields every numbered entry with its update day", () => {
    expect(gcat.updated).toBe("2025 Jun 22 2314:45");
    expect(gcat.rows).toHaveLength(402);
    // GCAT numbers two entries 65 and none 77; the filename tells them apart.
    const numbers = gcat.rows.map((r) => r.number);
    expect(Math.max(...numbers)).toBe(402);
    expect(new Set(gcat.rows.map((r) => r.filename)).size).toBe(402);
  });

  test("Meteor 2-7's 2004 cloud reads as the table prints it", () => {
    const row = gcat.rows.find((r) => r.number === 269)!;
    expect(row).toMatchObject({ piece: "1981-043", name: "Meteor-2 No. 8", parent: { kind: "catalogue", number: 12456 }, sdate: "2004 Jul?", eventType: "Battery", eventPerigeeKm: 826, eventApogeeKm: 895, eventInclinationDeg: 81.26, catalogued: 21, filename: "81043", label: "MET2-8" });
  });

  test("parents are catalogue numbers, analyst objects or none", () => {
    const kinds = new Map<string, number>();
    for (const row of gcat.rows) kinds.set(row.parent?.kind ?? "none", (kinds.get(row.parent?.kind ?? "none") ?? 0) + 1);
    expect(kinds.get("catalogue")).toBe(393);
    expect(kinds.get("analyst")).toBe(7);
    expect(kinds.get("none")).toBe(2);
  });

  test("one statement per cloud, every window well formed", () => {
    const statements = gcatStatements(gcat);
    expect(statements).toHaveLength(402);
    for (const s of statements) {
      expect(s.event.to >= (s.event.from ?? "")).toBe(true);
      expect(s.piecesStatedOn).toBe("2025-06-22");
    }
    expect(statements.filter((s) => s.event.to >= "2005")).toHaveLength(131);
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
