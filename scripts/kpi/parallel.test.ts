import { describe, expect, test } from "vitest";
import type { Latest } from "./kpi.ts";
import { approximation, chunkLabel, chunksOf } from "./parallel.ts";
import { latestJson } from "./run.ts";

/** The years split for a parallel exploration replay: contiguous, every year once, the heaviest chunk as light as it can be. */

const YEARS = Array.from({ length: 22 }, (_, i) => 2005 + i);
// The Archive's set counts per year, in millions, rounded: the later years are the heavy ones.
const SETS = [15.6, 4.0, 4.5, 4.5, 5.6, 5.3, 5.5, 5.2, 3.0, 3.2, 4.5, 6.6, 7.7, 8.8, 7.9, 11.6, 15.2, 17.2, 15.7, 19.7, 20.8, 22.5];

describe("the chunks of a parallel replay", () => {
  test.each([1, 2, 4, 8, 22, 40])("in %i chunks, cover every year once, in order, each after the first starting from the year before it", (count) => {
    const chunks = chunksOf(YEARS, SETS, count);
    expect(chunks.length).toBe(Math.min(count, YEARS.length));
    expect(chunks.flatMap((chunk) => chunk.years)).toEqual(YEARS);
    expect(chunks[0]!.startsFrom).toBeNull();
    for (const chunk of chunks.slice(1)) expect(chunk.startsFrom).toBe(chunk.years[0]! - 1);
    for (const chunk of chunks) expect(chunk.years.length).toBeGreaterThan(0);
  });

  test("make the heaviest chunk as light as any contiguous split can, by a search over every split", () => {
    const sum = (from: number, to: number) => SETS.slice(from, to).reduce((x, y) => x + y, 0);
    // The lightest heaviest chunk over every split of the years from `from` into `count` chunks, by brute force.
    const lightest = (from: number, count: number): number => {
      if (count === 1) return sum(from, SETS.length);
      let best = Number.POSITIVE_INFINITY;
      for (let end = from + 1; end <= SETS.length - count + 1; end++) best = Math.min(best, Math.max(sum(from, end), lightest(end, count - 1)));
      return best;
    };
    const heaviest = (count: number) => Math.max(...chunksOf(YEARS, SETS, count).map((chunk) => sum(chunk.years[0]! - 2005, chunk.years.at(-1)! - 2005 + 1)));
    for (const count of [1, 2, 3, 4, 6, 8]) expect(heaviest(count), `${count} chunks`).toBeCloseTo(lightest(0, count), 9);
    // No chunk can be lighter than the heaviest year.
    expect(heaviest(22)).toBeCloseTo(22.5, 9);
  });

  test("on equal weights, split evenly", () => {
    expect(chunksOf([2001, 2002, 2003, 2004], [1, 1, 1, 1], 2).map((chunk) => chunk.years)).toEqual([
      [2001, 2002],
      [2003, 2004],
    ]);
    expect(chunksOf([2001, 2002, 2003], [1, 1, 1], 1)).toEqual([{ years: [2001, 2002, 2003], startsFrom: null }]);
  });

  test("refuse years with a gap or out of order, a weight short, and a count below one", () => {
    expect(() => chunksOf([2001, 2003], [1, 1], 2)).toThrow(/contiguous/);
    expect(() => chunksOf([2002, 2001], [1, 1], 2)).toThrow(/contiguous/);
    expect(() => chunksOf([2001, 2002], [1], 2)).toThrow(/weights/);
    expect(() => chunksOf([2001, 2002], [1, 1], 0)).toThrow(/at least one/);
    expect(() => chunksOf([2001, 2002], [1, 1], Number.NaN)).toThrow(/at least one/);
    expect(chunksOf([], [], 4)).toEqual([]);
  });

  test("are named by their years, and the statement says the result is approximate and from which states", () => {
    const chunks = chunksOf([2001, 2002, 2003], [1, 1, 1], 2);
    // On a tie the earlier chunk is the lighter.
    expect(chunks.map(chunkLabel)).toEqual(["2001", "2002-2003"]);
    const statement = approximation(chunks, "kpi/work/states");
    expect(statement).toMatch(/^Approximate/);
    expect(statement).toContain("kpi/work/states at the end of 2001");
    expect(statement).toContain("never the record");
  });

  test("leave the sequential aggregate's file as it was, and head a parallel one's with exact false, the states and the chunks", () => {
    const latest = { format: 1, years: [2001, 2002, 2003] } as unknown as Latest;
    expect(latestJson(latest)).toBe(`${JSON.stringify(latest, null, 2)}\n`);
    const stated = JSON.parse(latestJson(latest, { statesFrom: "kpi/work/states", chunks: chunksOf([2001, 2002, 2003], [1, 1, 1], 2) })) as Record<string, unknown>;
    expect(Object.keys(stated).slice(0, 3)).toEqual(["exact", "statesFrom", "chunks"]);
    expect(stated).toMatchObject({ exact: false, statesFrom: "kpi/work/states", chunks: [{ years: [2001, 2001], startsFrom: null }, { years: [2002, 2003], startsFrom: 2001 }], format: 1, years: [2001, 2002, 2003] });
  });
});
