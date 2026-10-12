import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { addedTitle, addMissing, addStatement, formatHandFile } from "./add.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HAND = readFileSync(resolve(ROOT, "data/truth/hand.json"), "utf8");

describe("the hand file's layout", () => {
  test("is the committed file's own, byte for byte", () => {
    expect(formatHandFile(JSON.parse(HAND))).toBe(HAND);
  });
});

/** A news report as a person would type it: Meteor 2-7's second breakup, as a fresh report of another day. */
const REPORT = {
  source: "news",
  ref: "Space.com, 2026-10-08 (https://www.space.com/example-report): 'A dead Soviet satellite just broke apart in orbit (again)'",
  url: "https://www.space.com/example-report",
  kind: "breakup",
  parent: { catalogueNumber: 12456, designator: "1981-043A", name: "Meteor 2-7 (second event)" },
  event: { stated: "5 October 2026", at: null, from: "2026-10-05T00:00Z", to: "2026-10-06T00:00Z", precision: "day" },
  orbit: { altitudeKm: null, apogeeKm: null, perigeeKm: null, inclinationDeg: null },
  cause: null,
  causeStated: null,
  piecesCatalogued: null,
  piecesStatedOn: null,
  preEventElements: null,
  note: null,
  statedOn: { on: "2026-10-08", precision: "day", ref: "Space.com, 2026-10-08" },
};

describe("adding a statement", () => {
  test("appends it after the last statement and leaves every line before it as it was", () => {
    const { text } = addStatement(HAND, REPORT);
    const before = HAND.slice(0, HAND.lastIndexOf("\n    }") + "\n    }".length);
    expect(text.startsWith(before)).toBe(true);
    const parsed = JSON.parse(text) as { statements: unknown[] };
    expect(parsed.statements).toHaveLength((JSON.parse(HAND) as { statements: unknown[] }).statements.length + 1);
    expect(parsed.statements.at(-1)).toEqual(REPORT);
    expect(text).toContain(`      "source": "news", "ref": ${JSON.stringify(REPORT.ref)},\n      "url": "https://www.space.com/example-report",\n`);
  });

  test("refuses what the hand file's schema refuses, saying why", () => {
    expect(() => addStatement(HAND, { ...REPORT, event: { ...REPORT.event, from: "2026-10-07T00:00Z" } })).toThrow(/runs backwards/);
    expect(() => addStatement(HAND, { ...REPORT, url: "http://example.org" })).toThrow(/https/);
    expect(() => addStatement(HAND, { ...REPORT, colour: "red" })).toThrow(/unknown field colour/);
  });

  test("refuses a source the build reads by itself", () => {
    expect(() => addStatement(HAND, { ...REPORT, source: "gcat" })).toThrow(/gcat is read by the truth build itself/);
    expect(() => addStatement(HAND, { ...REPORT, source: "hoosf-16e" })).toThrow(/read by the truth build itself/);
  });

  test("refuses a report with no day it was published, which would count for nothing", () => {
    expect(() => addStatement(HAND, { ...REPORT, ref: "Space.com, a report", statedOn: undefined })).toThrow(/no day it was published/);
    // A news report's day may come from its reference, as the hand file's own rows give it.
    expect(() => addStatement(HAND, { ...REPORT, statedOn: undefined })).not.toThrow();
  });

  test("refuses a report published before the event it reports", () => {
    expect(() => addStatement(HAND, { ...REPORT, statedOn: { ...REPORT.statedOn, on: "2026-10-04" } })).toThrow(/published on 2026-10-04, before the event/);
  });

  test("is titled, for its commit, by its source, its parent and the day it was published", () => {
    const { statement } = addStatement(HAND, REPORT);
    expect(addedTitle(statement)).toBe("The ground truth holds a news report of Meteor 2-7 (second event) (12456), published 2026-10-08");
    expect(addedTitle({ ...statement, source: "analyst", parent: { catalogueNumber: null, designator: null, name: null }, ref: "an analyst, undated", statedOn: null })).toBe("The ground truth holds an analyst's statement of an unnamed object");
  });

  test("from another copy of the hand file, adds every statement this one lacks, in that copy's order", () => {
    const second = { ...REPORT, ref: "EarthSky, 2026-10-09 (https://earthsky.org/example)", url: "https://earthsky.org/example", statedOn: { ...REPORT.statedOn, on: "2026-10-09" } };
    const branch = addStatement(addStatement(HAND, REPORT).text, second).text;
    const { text, added } = addMissing(HAND, branch);
    expect(text).toBe(branch);
    expect(added.map((s) => s.ref)).toEqual([REPORT.ref, second.ref]);
  });

  test("from a copy cut before another report reached this one, adds its own and leaves the other where it is", () => {
    const main = addStatement(HAND, REPORT).text;
    const other = { ...REPORT, ref: "EarthSky, 2026-10-09 (https://earthsky.org/example)", url: "https://earthsky.org/example", statedOn: { ...REPORT.statedOn, on: "2026-10-09" } };
    const branch = addStatement(HAND, other).text;
    const { text, added } = addMissing(main, branch);
    expect(added.map((s) => s.ref)).toEqual([other.ref]);
    expect((JSON.parse(text) as { statements: { ref: string }[] }).statements.slice(-2).map((s) => s.ref)).toEqual([REPORT.ref, other.ref]);
  });

  test("from a copy this one already holds, adds nothing", () => {
    const main = addStatement(HAND, REPORT).text;
    expect(addMissing(main, main)).toEqual({ text: main, added: [], held: [] });
  });

  test("from a copy whose statement this one holds in other words, adds nothing and says so", () => {
    const main = addStatement(HAND, REPORT).text;
    const branch = addStatement(HAND, { ...REPORT, note: "typed again with a note" }).text;
    const { text, added, held } = addMissing(main, branch);
    expect(text).toBe(main);
    expect(added).toEqual([]);
    expect(held).toEqual([expect.stringMatching(/already holds this statement/)]);
  });

  test("refuses a statement the file already holds", () => {
    const { text } = addStatement(HAND, REPORT);
    expect(() => addStatement(text, REPORT)).toThrow(/already holds/);
    expect(() => addStatement(text, { ...REPORT, ref: "another wording of the same article" })).toThrow(/already holds/);
  });
});
