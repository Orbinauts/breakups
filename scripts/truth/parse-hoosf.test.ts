import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readElements } from "@orbinauts/engine";
import { describe, expect, test } from "vitest";
import { causeOf, epochOf, EXPECTED, hoosfStatements, odqnReferences, parseHoosf, statedOnOf } from "./parse-hoosf.ts";

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

describe("the quarterly news issues the spreads cite", () => {
  test("an entry read as the history prints it, its title, month and issue", () => {
    // Cosmos 2491's spread, p. 554: the entry spans two lines and pads the gap before the link.
    const entry = `“Russian Satellite Fragments,” The Orbital Debris Quarterly News, NASA JSC, February 2020.                    Available online at
https://www.orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/odqnv24i1.pdf.`;
    expect(odqnReferences(entry)).toEqual([{ title: "Russian Satellite Fragments", month: "2020-02", volume: 24, issue: 1 }]);
  });

  test("a month that wraps to the next line, an entry with no link, and other documents left out", () => {
    // DMSP 5D-2 F11's (p. 18011 of the text) and COSMOS 192's entries, beside a technical report the reading must skip.
    const entries = `“Major Satellite Breakup in June,” N. Johnson, Orbital Debris Quarterly News, NASA JSC, September
1996, p. 2 and 11.
History of Soviet/Russian Satellite Fragmentations-A Joint U.S.-Russian Investigation, N. L. Johnson, et al., Kaman Sciences
Corporation, October 1995.
“Flurry of Small Breakups in First Half of 2014”, The Orbital Debris Quarterly News, NASA JSC, July 2014.`;
    expect(odqnReferences(entries)).toEqual([
      { title: "Major Satellite Breakup in June", month: "1996-09", volume: null, issue: null },
      { title: "Flurry of Small Breakups in First Half of 2014", month: "2014-07", volume: null, issue: null },
    ]);
  });

  test("an issue before the event is not its statement; one of the event's month is dated to the event's day", () => {
    const references = [
      { title: "Fragmentation of Fregat Upper Stage Debris", month: "2016-04", volume: 20, issue: 1 },
      { title: "Second Fragmentation of Fregat Upper Stage Debris", month: "2020-08", volume: 24, issue: 3 },
    ];
    const window = (from: string) => ({ stated: from, at: null, from: `${from}T00:00Z`, to: `${from}T23:59Z`, precision: "day" as const });
    expect(statedOnOf(references, window("2015-08-03"), 571)).toEqual({ on: "2016-04-01", precision: "month", ref: "“Fragmentation of Fregat Upper Stage Debris”, ODQN 20(1), April 2016, cited by NASA's history, p. 571" });
    expect(statedOnOf(references, window("2020-07-12"), 571)!.on).toBe("2020-08-01");
    expect(statedOnOf(references, window("2020-08-20"), 571)!.on).toBe("2020-08-20");
    expect(statedOnOf(references, window("2021-01-01"), 571)).toBeNull();
  });

  test("every statement of the history is dated by the issues its spread cites", () => {
    const statements = hoosfStatements(hoosf);
    const of = (number: number) => statements.filter((s) => s.parent.catalogueNumber === number);
    expect(hoosf.spreads.filter((s) => s.references.length > 0).length).toBeGreaterThan(120);
    // Cosmos 2251 and Iridium 33, 10 February 2009: the April 2009 issue.
    for (const number of [22675, 24946]) expect(of(number)[0]!.statedOn).toMatchObject({ on: "2009-04-01", precision: "month" });
    expect(of(22675)[0]!.statedOn!.ref).toBe("“Satellite Collision Leaves Significant Debris Clouds”, ODQN 13(2), April 2009, cited by NASA's history, p. 404");
    // Cosmos 1408, 15 November 2021: the March 2022 issue.
    expect(of(13552)[0]!.statedOn).toMatchObject({ on: "2022-03-01", precision: "month" });
    // The aerodynamic table carries no reference documents.
    expect(statements.filter((s) => s.ref === "Table 4.1-1").every((s) => s.statedOn === null)).toBe(true);
  });
});
