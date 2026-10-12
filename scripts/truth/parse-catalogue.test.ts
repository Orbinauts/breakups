import { describe, expect, test } from "vitest";
import { BURST_DAYS, catalogueStatements, findBursts, SAME_CLOUD_DAYS } from "./parse-catalogue.ts";

/**
 * The burst rule that reads the catalogue as a source of the truth, on
 * launches made up for each case: at least five new debris objects of a
 * launch within thirty days, more than ninety days after its launch, at
 * least a fifth of the debris it had; a batch within a year of the last
 * is the same cloud.
 */

type Seen = Parameters<typeof findBursts>[0][number];
const DAY_MS = 86_400_000;
const LAUNCHED = "2010-03-01";
const T = Date.parse("2012-06-01T00:00:00Z");

/** A launch's payload and `count` debris objects named for it, first seen a day apart from `from`. */
function launch(count: number, from: number, options: { warmUp?: number; launch?: string } = {}): Seen[] {
  const key = options.launch ?? "2010-012";
  const payload: Seen = { number: 36000, launch: key, designator: `${key}A`, name: "SAT 1", isDebris: false, launchDay: LAUNCHED, firstEpoch: Date.parse(`${LAUNCHED}T06:00:00Z`), warmUp: false };
  const old = Array.from({ length: options.warmUp ?? 0 }, (_, i): Seen => ({ number: 36100 + i, launch: key, designator: `${key}B`, name: "SAT 1 DEB", isDebris: true, launchDay: LAUNCHED, firstEpoch: Date.parse("2010-06-01T00:00:00Z"), warmUp: true }));
  const pieces = Array.from({ length: count }, (_, i): Seen => ({ number: 38000 + i, launch: key, designator: `${key}C`, name: "SAT 1 DEB", isDebris: true, launchDay: LAUNCHED, firstEpoch: from + i * DAY_MS, warmUp: false }));
  return [payload, ...old, ...pieces];
}
const parentsOf = (objects: Seen[]) => (key: string, name: string) => objects.filter((o) => o.launch === key && !o.isDebris && o.name === name).map((o) => ({ number: o.number, name: o.name }));
const bursts = (objects: Seen[]) => findBursts(objects, parentsOf(objects));

describe("the catalogue's burst rule", () => {
  test("five new pieces of a launch within thirty days, long after it, make a burst named for the payload they are named after", () => {
    const objects = launch(5, T);
    const found = bursts(objects);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ launch: "2010-012", parentName: "SAT 1", parentNumber: 36000, start: T, debrisBefore: 0 });
    expect(found[0]!.pieces.map((p) => p.number)).toEqual([38000, 38001, 38002, 38003, 38004]);
  });

  test("four pieces, or five spread over more than thirty days, are no burst", () => {
    expect(bursts(launch(4, T))).toEqual([]);
    const spread = launch(5, T).map((o, i) => (o.isDebris ? { ...o, firstEpoch: T + (i - 1) * 8 * DAY_MS } : o));
    expect(spread.filter((o) => o.isDebris).at(-1)!.firstEpoch - T).toBeGreaterThan(BURST_DAYS * DAY_MS);
    expect(bursts(spread)).toEqual([]);
  });

  test("pieces within ninety days of the launch are its own cataloguing", () => {
    expect(bursts(launch(8, Date.parse(LAUNCHED) + 60 * DAY_MS))).toEqual([]);
  });

  test("a batch under a fifth of the debris the launch had before the Archive began is an old cloud's late pieces", () => {
    expect(bursts(launch(5, T, { warmUp: 30 }))).toEqual([]);
    expect(bursts(launch(6, T, { warmUp: 30 }))).toHaveLength(1);
  });

  test("a second batch within a year of the first is the same cloud; one later is a new burst", () => {
    const first = launch(5, T);
    const soon = launch(5, T + 200 * DAY_MS).filter((o) => o.isDebris).map((o) => ({ ...o, number: o.number + 100 }));
    expect(bursts([...first, ...soon])).toHaveLength(1);
    const late = launch(5, T + (SAME_CLOUD_DAYS + 10) * DAY_MS).filter((o) => o.isDebris).map((o) => ({ ...o, number: o.number + 100 }));
    expect(bursts([...first, ...late]).map((b) => b.start)).toEqual([T, T + (SAME_CLOUD_DAYS + 10) * DAY_MS]);
  });

  test("pieces of several names leave the parent unnamed", () => {
    const objects = launch(5, T).map((o, i) => (o.isDebris && i % 2 === 0 ? { ...o, name: "R/B DEB" } : o));
    expect(bursts(objects)[0]).toMatchObject({ parentName: null, parentNumber: null });
  });

  test("a burst is stated as a breakup before its first piece's first set, within sixty days of it, by the catalogue", () => {
    const [statement] = catalogueStatements(bursts(launch(5, T)));
    expect(statement).toMatchObject({
      source: "catalogue",
      kind: "breakup",
      parent: { catalogueNumber: 36000, designator: "2010-012", name: "SAT 1" },
      event: { at: null, from: "2012-04-02T00:00Z", to: "2012-06-01T00:00Z", precision: "none" },
      piecesCatalogued: 5,
      piecesStatedOn: "2012-08-30",
    });
    expect(statement!.note).toContain("Pieces 38000 to 38004.");
  });
});
