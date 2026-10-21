import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { backfillDaysToPull, backfillYears, daysOf, EMPTY_ATTEMPTS, emptyManifest, nextStep, readAttempts, tarHistory, writeAttempts, yearComplete } from "./backfill.ts";
import { historyDir, keepDay } from "./pull.ts";

const work = mkdtempSync(join(tmpdir(), "breakups-backfill-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
let archives = 0;
const freshArchive = (): string => join(work, `archive-${++archives}`);

const keep = (archive: string, year: number, day: string, rows: unknown[]): void => keepDay(join(historyDir(archive, year), `${day}.json.gz`), rows, Date.UTC(2026, 9, 22));

describe("the backfill's years and days", () => {
  test("the years are the fresh validation's warm-up through its last", () => {
    expect(backfillYears()).toEqual([1994, 1995, 1996, 1997, 1998, 1999, 2000, 2001, 2002, 2003, 2004]);
  });

  test("every day of a year, a leap year's 366", () => {
    expect(daysOf(1996)).toHaveLength(366);
    expect(daysOf(1995)).toHaveLength(365);
    expect(daysOf(1995)[0]).toBe("1995-01-01");
    expect(daysOf(1995).at(-1)).toBe("1995-12-31");
  });
});

describe("the days of a closed year still to pull", () => {
  // Three days stand for the year: a file on this disk costs tens of milliseconds, so the test never fills one.
  const days = ["1995-01-01", "1995-01-02", "1995-01-03"];

  test("a day kept with sets is kept for good, an empty one is asked again until the attempts run out, and the year is complete once none is left", () => {
    const archive = freshArchive();
    const year = 1995;
    keep(archive, year, "1995-01-01", [{ NORAD_CAT_ID: "1" }]);
    keep(archive, year, "1995-01-02", []);
    expect(backfillDaysToPull(archive, year, readAttempts(archive, year), days)).toEqual(["1995-01-02", "1995-01-03"]);
    writeAttempts(archive, year, { "1995-01-02": 1 });
    expect(backfillDaysToPull(archive, year, readAttempts(archive, year), days)).toEqual(["1995-01-02", "1995-01-03"]);
    writeAttempts(archive, year, { "1995-01-02": EMPTY_ATTEMPTS });
    expect(readAttempts(archive, year)).toEqual({ "1995-01-02": EMPTY_ATTEMPTS });
    expect(backfillDaysToPull(archive, year, readAttempts(archive, year), days)).toEqual(["1995-01-03"]);
    expect(yearComplete(archive, year, days)).toBe(false);
    keep(archive, year, "1995-01-03", [{ NORAD_CAT_ID: "1" }]);
    expect(yearComplete(archive, year, days)).toBe(true);
    expect(backfillDaysToPull(archive, year, readAttempts(archive, year), days)).toEqual([]);
  });

  test("a year with no history at all wants every day of it, and reads no attempts", () => {
    const archive = freshArchive();
    mkdirSync(archive, { recursive: true });
    expect(backfillDaysToPull(archive, 1996)).toHaveLength(366);
    expect(readAttempts(archive, 1996)).toEqual({});
    expect(yearComplete(archive, 1996, days)).toBe(false);
  });
});

describe("what a run does", () => {
  test("pulls the first year not built, finishes once every year is built, and does nothing once finished", () => {
    const years = [1994, 1995];
    const manifest = emptyManifest();
    expect(nextStep(manifest, years)).toEqual({ kind: "pull", year: 1994 });
    const built = { file: "archive-v1-1994.tar", bytes: 1, sha256: "a", sets: 1, bodies: 1, missing: [], builtAt: "2026-10-22T00:00:00Z" };
    manifest.years["1994"] = built;
    expect(nextStep(manifest, years)).toEqual({ kind: "pull", year: 1995 });
    manifest.years["1995"] = { ...built, file: "archive-v1-1995.tar" };
    expect(nextStep(manifest, years)).toEqual({ kind: "finish" });
    manifest.finishedAt = "2026-11-01T00:00:00Z";
    expect(nextStep(manifest, years)).toEqual({ kind: "done" });
  });
});

describe("a year's history as a tarball", () => {
  test("carries the kept days and the attempts file, and says how many days are kept, how many empty, and the last", () => {
    const archive = freshArchive();
    keep(archive, 1994, "1994-01-01", [{ NORAD_CAT_ID: "1" }]);
    keep(archive, 1994, "1994-01-03", []);
    writeAttempts(archive, 1994, { "1994-01-03": 1 });
    const out = join(work, "history-1994.tar");
    const asset = tarHistory(archive, 1994, out);
    expect(asset).toMatchObject({ file: "history-1994.tar", days: 2, empty: 1, through: "1994-01-03" });
    expect(asset.bytes).toBeGreaterThan(0);
    expect(asset.sha256).toHaveLength(64);
    const listed = readFileSync(out).toString("latin1");
    expect(listed).toContain("1994/1994-01-01.json.gz");
    expect(listed).toContain("1994/empty.json");
  });
});
