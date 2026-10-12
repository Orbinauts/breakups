import { describe, expect, test } from "vitest";
import { attributeEsaRows, esaStatement, readEsaSer, type EsaCandidate, type EsaRow } from "./parse-esa-ser.ts";

/**
 * ESA's annual Space Environment Report lists each year's fragmentations
 * in its Table 3.7 without naming an object: a day, a mass, an orbit class
 * and a cause. The rows are typed into `data/truth/esa-ser.json` as
 * printed; each becomes a statement of the event it can only be (the one
 * event the other sources state within a day of it, in an orbit and of an
 * object type the row allows), an unnamed event where no source states
 * one, and is left unattributed, and said so, where it could be more than
 * one.
 */

const edition = { edition: "2024", title: "ESA's Annual Space Environment Report", reference: "GEN-DB-LOG-00288-OPS-SD", issue: "8.0", dateOfIssue: "2024-07-19", url: "https://www.sdo.esoc.esa.int/publications/Space_Environment_Report_I8R0_20240719.pdf", sha256: "0".repeat(64), table: "Table 3.7: Fragmentation events in 2023", page: 64 };
const file = (rows: Record<string, unknown>[]): unknown => ({ editions: [{ ...edition, rows }] });
const printed = { epoch: "2023-07-31", objectType: "Rocket Mission Related Object", massKg: "100", catalogued: "7", asserted: "11", orbit: "LEO", cause: "Small Impactor" };
const row = (fields: Partial<Record<keyof typeof printed, string | null>>): EsaRow => readEsaSer(file([{ ...printed, ...fields }]))[0]!;
const event = (key: number, from: string, to: string, fields: Partial<EsaCandidate> = {}): EsaCandidate => ({ key, windows: [{ from, to }], regime: "LEO", class: "payload", kind: "breakup", ...fields });

describe("a row of ESA's table, as a statement", () => {
  test("its day, cause and the report's date of issue, the row kept verbatim, no object named", () => {
    const s = esaStatement(row({}), "attributed");
    expect(s.source).toBe("esa-ser");
    expect(s.ref).toBe("ESA's Annual Space Environment Report, issue 8.0, 19 July 2024 (GEN-DB-LOG-00288-OPS-SD), Table 3.7: Fragmentation events in 2023, p. 64, row 2023-07-31");
    expect(s.event).toEqual({ stated: "2023-07-31", at: null, from: "2023-07-31T00:00Z", to: "2023-08-01T00:00Z", precision: "day" });
    expect(s.cause).toBe("collision-accidental");
    expect(s.causeStated).toBe("Small Impactor");
    expect(s.parent).toEqual({ catalogueNumber: null, designator: null, name: null });
    expect(s.kind).toBeNull();
    expect(s.piecesCatalogued).toBeNull();
    expect(s.statedOn).toEqual({ on: "2024-07-19", precision: "day", ref: "ESA's Annual Space Environment Report, issue 8.0, dated 19 July 2024" });
    expect(s.note).toContain("Rocket Mission Related Object, 100 kg, 7 catalogued, 11 asserted, LEO, Small Impactor");
  });

  test("a row no other source states is an unnamed event, named by what the row says of its object", () => {
    const s = esaStatement(row({ objectType: "Rocket Body", massKg: "6000" }), "unnamed");
    expect(s.kind).toBe("unnamed");
    expect(s.parent.name).toBe("rocket body, 6000 kg, LEO (unnamed)");
  });

  test("ESA's anomalous and aerodynamic causes say the kind; the others leave it to the sources that name the object", () => {
    expect(esaStatement(row({ cause: "Anomalous" }), "attributed")).toMatchObject({ kind: "anomalous", cause: null });
    expect(esaStatement(row({ cause: "Aerodynamics" }), "attributed")).toMatchObject({ kind: "aerodynamic", cause: "aerodynamic" });
    expect(esaStatement(row({ cause: "Electrical" }), "attributed")).toMatchObject({ kind: null, cause: "battery" });
  });

  test("an unknown cause is no statement of one, so it never outranks a cause another source names", () => {
    expect(esaStatement(row({ cause: "Unknown" }), "attributed")).toMatchObject({ cause: null, causeStated: "Unknown" });
    expect(esaStatement(row({ cause: "Attitude" }), "attributed")).toMatchObject({ cause: null, causeStated: "Attitude" });
  });

  test("a cause the table never printed is refused, so a new edition's category is read before it is used", () => {
    expect(() => row({ cause: "Gremlins" })).toThrow(/Gremlins/);
  });

  test("a row a cited source names carries that parent and the citation", () => {
    const named = readEsaSer(file([{ ...printed, parent: { catalogueNumber: 59344, designator: "2024-058B", name: "CZ-6A R/B (Yunhai-3 02)" }, namedBy: "s2a systems, as quoted by SpaceNews" }]))[0]!;
    const s = esaStatement(named, "named");
    expect(s.parent).toEqual({ catalogueNumber: 59344, designator: "2024-058B", name: "CZ-6A R/B (Yunhai-3 02)" });
    expect(s.note).toContain("s2a systems, as quoted by SpaceNews");
  });
});

describe("which event a row is attributed to", () => {
  const day = row({ epoch: "2023-07-31", objectType: "Payload", orbit: "LEO" });

  test("the one event within a day of the row joins it", () => {
    expect(attributeEsaRows([day], [event(1, "2023-08-01T05:00Z", "2023-08-01T06:00Z"), event(2, "2023-08-05T00:00Z", "2023-08-06T00:00Z")])).toEqual([{ row: day, joins: 1 }]);
  });

  test("no event within a day makes an unnamed event", () => {
    expect(attributeEsaRows([day], [event(2, "2023-08-05T00:00Z", "2023-08-06T00:00Z")])).toEqual([{ row: day, unnamed: true }]);
  });

  test("an event of an orbit or an object type the row rules out, a release, or one dated no finer than three days is no candidate", () => {
    const others = [event(1, "2023-07-31T00:00Z", "2023-08-01T00:00Z", { regime: "GEO" }), event(2, "2023-07-31T00:00Z", "2023-08-01T00:00Z", { class: "rocket body" }), event(3, "2023-07-31T00:00Z", "2023-08-01T00:00Z", { kind: "release" }), event(4, "2023-07-01T00:00Z", "2023-08-01T00:00Z")];
    expect(attributeEsaRows([day], others)).toEqual([{ row: day, unnamed: true }]);
  });

  test("two candidates within a day leave the row unattributed, even where only one is dated to the row's own day: ESA's epochs differ from the others' by a day often enough", () => {
    expect(attributeEsaRows([day], [event(1, "2023-07-31T10:00Z", "2023-07-31T10:01Z"), event(2, "2023-07-30T10:00Z", "2023-07-30T10:01Z")])).toEqual([{ row: day, ambiguous: [1, 2] }]);
    expect(attributeEsaRows([day], [event(1, "2023-07-31T10:00Z", "2023-07-31T10:01Z"), event(2, "2023-07-31T12:00Z", "2023-07-31T12:01Z")])).toEqual([{ row: day, ambiguous: [1, 2] }]);
  });

  test("an aerodynamic breakup is weighed whatever its regime: ESA classes it by its last state, at reentry", () => {
    const reentry = row({ epoch: "2016-04-15", objectType: null, orbit: "LEO", cause: "Aerodynamics" });
    expect(attributeEsaRows([reentry], [event(1, "2016-04-15T13:00Z", "2016-04-15T14:00Z", { regime: "MEO", kind: "aerodynamic" })])).toEqual([{ row: reentry, joins: 1 }]);
  });

  test("an event one row can only be is taken from the others, and two rows that can only be one event are both left unattributed", () => {
    const leo = row({ epoch: "2016-03-26", objectType: null, orbit: "LEO", massKg: "2700.0" });
    const lmo = row({ epoch: "2016-03-26", objectType: null, orbit: "LMO", massKg: "56.0" });
    const hitomi = event(1, "2016-03-26T01:42Z", "2016-03-26T01:43Z", { regime: "LEO" });
    const motor = event(2, "2016-03-26T00:00Z", "2016-03-27T00:00Z", { regime: "HEO", class: "rocket body" });
    expect(attributeEsaRows([leo, lmo], [hitomi, motor])).toEqual([{ row: leo, joins: 1 }, { row: lmo, joins: 2 }]);
    const twin = row({ epoch: "2016-03-26", objectType: null, orbit: "LMO", massKg: "56.0", catalogued: "8" });
    expect(attributeEsaRows([lmo, twin], [motor])).toEqual([{ row: lmo, ambiguous: [2] }, { row: twin, ambiguous: [2] }]);
  });
});
