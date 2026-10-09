import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readElements } from "@orbinauts/engine";
import { describe, expect, test } from "vitest";
import { causeOf, epochOf, EXPECTED, hoosfStatements, parseHoosf } from "./parse-hoosf.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const text = readFileSync(resolve(ROOT, "data/truth/sources/hoosf-16e.txt"), "utf8");
const hoosf = parseHoosf(text);

describe("NASA's history, read whole", () => {
  test("yields the counts the edition states of itself", () => {
    expect(hoosf.spreads).toHaveLength(EXPECTED.spreads);
    expect(hoosf.breakupRows).toHaveLength(EXPECTED.breakups);
    expect(hoosf.anomalousRows).toHaveLength(EXPECTED.anomalous);
    expect(hoosf.spreads.filter((s) => s.chapter === 3)).toHaveLength(EXPECTED.anomalous);
  });

  test("every spread has a page, a type, and either dated events or an anomalous block", () => {
    for (const spread of hoosf.spreads) {
      expect(spread.page, spread.name).toBeGreaterThan(0);
      expect(spread.events.length > 0 || spread.anomalous !== null, spread.name).toBe(true);
    }
  });

  test("every breakup spread's catalogue number is a row of Table 2.1, and the other way round", () => {
    const rows = new Set(hoosf.breakupRows.map((row) => row.catalogueNumber));
    const spreads = new Set(hoosf.spreads.filter((s) => s.chapter === 2).map((s) => s.catalogueNumber));
    expect([...spreads].filter((n) => !rows.has(n))).toEqual([]);
    // Meteor 2-8 (13113) is in the table with no spread of its own.
    expect([...rows].filter((n) => !spreads.has(n))).toEqual([13113]);
  });

  test("the pre-event element sets propagate through the engine, all but one", () => {
    const sets = hoosf.spreads.flatMap((s) => s.events).map((e) => e.elements).filter((e) => e !== null);
    expect(sets.length).toBeGreaterThan(250);
    const failing = sets.filter((set) => {
      try {
        readElements(set.omm);
        return false;
      } catch {
        return true;
      }
    });
    expect(failing.map((set) => set.omm.OBJECT_NAME)).toEqual(["COSMOS 2282 ULLAGE MOTOR"]);
  });

  test("Cosmos 2491 reads as its spread prints it", () => {
    const spread = hoosf.spreads.find((s) => s.catalogueNumber === 39497)!;
    expect(spread).toMatchObject({ name: "COSMOS 2491", designator: "2013-076E", page: 554, chapter: 2, type: "payload", owner: "CIS", launchDate: "25 Dec. 2013" });
    expect(spread.events).toHaveLength(1);
    expect(spread.events[0]).toMatchObject({ date: "23 Dec. 2019", time: "1302 GMT", altitude: "1494.1 km", cause: "Unknown" });
    expect(spread.events[0]!.elements!.omm).toMatchObject({ EPOCH: "2019-12-22T16:34:21.148320", MEAN_MOTION: 12.42682561, ECCENTRICITY: 0.0016799, INCLINATION: 82.4845, BSTAR: 0.00016848, MEAN_MOTION_DOT: 3.3e-7 });
    const row = hoosf.breakupRows.find((r) => r.catalogueNumber === 39497)!;
    expect(row).toMatchObject({ launchDate: "25-Dec-13", breakupDate: "23-Dec-19", debrisCatalogued: 27, debrisLeft: 27, apogeeKm: 1517, perigeeKm: 1485, inclinationDeg: 82.5 });
  });

  test("a spread with two events keeps an element set per event", () => {
    const spread = hoosf.spreads.find((s) => s.catalogueNumber === 7587)!;
    expect(spread.events.map((e) => e.date)).toEqual(["17 Apr 1975", "2 Aug 1975"]);
    expect(spread.events.map((e) => e.elements!.omm.EPOCH.slice(0, 10))).toEqual(["1975-04-17", "1975-08-02"]);
  });

  test("an anomalous spread reads its first date and orbit", () => {
    const spread = hoosf.spreads.find((s) => s.catalogueNumber === 35946)!;
    expect(spread.chapter).toBe(3);
    expect(spread.anomalous).toMatchObject({ knownEvents: "1", firstDate: "18 July 2016" });
    expect(spread.anomalous!.apogeeKm).toBeGreaterThan(700);
  });
});

describe("the statements NASA's history makes", () => {
  const statements = hoosfStatements(hoosf);

  test("one per dated event, per anomalous spread and per aerodynamic row", () => {
    const events = hoosf.spreads.filter((s) => s.anomalous === null).reduce((n, s) => n + s.events.length, 0);
    expect(statements.filter((s) => s.kind === "breakup")).toHaveLength(events + 1);
    expect(statements.filter((s) => s.kind === "anomalous")).toHaveLength(EXPECTED.anomalous);
    expect(statements.filter((s) => s.kind === "aerodynamic").length).toBeGreaterThan(30);
  });

  test("every statement's window is well formed and cites a page or the table", () => {
    for (const s of statements) {
      expect(s.ref, s.parent.name ?? "").toMatch(/^p\. \d+$|^Table [24]\.1(?:-1)?$/);
      if (s.event.from !== null) expect(s.event.from <= s.event.to).toBe(true);
      if (s.event.at !== null) expect(s.event.at <= s.event.to).toBe(true);
    }
  });
});

describe("the vocabulary", () => {
  test.each([
    ["Unknown", "unknown"],
    ["Propulsion", "propulsion"],
    ["Propulsion (solid)", "propulsion"],
    ["Deliberate", "deliberate"],
    ["Deliberate (HVI)", "collision-deliberate"],
    ["Intentional Collision", "collision-deliberate"],
    ["Accidental Collision", "collision-accidental"],
    ["Collision, accidental", "collision-accidental"],
    ["Collision", "collision-accidental"],
    ["Battery", "battery"],
    ["Battery?", "battery"],
  ])("cause %s is %s", (stated, cause) => {
    expect(causeOf(stated)).toBe(cause);
  });

  test("the two-line epoch becomes an instant to the microsecond", () => {
    expect(epochOf("19356.69052255")).toBe("2019-12-22T16:34:21.148320");
    expect(epochOf("75192.78059719")).toBe("1975-07-11T18:44:03.597216");
  });
});
