import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { pruneWork } from "./prune.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kpi-work-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A replay's output directory, last written `daysAgo` days before now, with its log beside it where asked. */
function replay(name: string, daysAgo: number, log = false): void {
  mkdirSync(join(dir, name, "years"), { recursive: true });
  writeFileSync(join(dir, name, "latest.json"), "{}");
  const at = new Date(Date.now() - daysAgo * 86_400_000);
  utimesSync(join(dir, name), at, at);
  if (log) {
    writeFileSync(join(dir, `${name}.log`), "replayed\n");
    utimesSync(join(dir, `${name}.log`), at, at);
  }
}

describe("pruning the work directory", () => {
  test("keeps the replays last written, and removes the others with their logs", () => {
    replay("d10-a", 30, true);
    replay("d11-b", 20, true);
    replay("d12-base", 10);
    replay("explore", 1, true);
    expect(pruneWork(dir, 2)).toEqual(["d10-a", "d10-a.log", "d11-b", "d11-b.log"]);
    expect(readdirSync(dir).sort()).toEqual(["d12-base", "explore", "explore.log"]);
  });

  test("never removes the carried states the parallel replays start from, nor a loose file", () => {
    replay("states", 100);
    replay("old", 50);
    writeFileSync(join(dir, "scope-orbits.json"), "{}");
    writeFileSync(join(dir, "all-run1.log"), "");
    expect(pruneWork(dir, 0)).toEqual(["old"]);
    expect(readdirSync(dir).sort()).toEqual(["all-run1.log", "scope-orbits.json", "states"]);
  });

  test("on a dry run says what it would remove and removes nothing", () => {
    replay("a", 3, true);
    replay("b", 2);
    expect(pruneWork(dir, 1, { dryRun: true })).toEqual(["a", "a.log"]);
    expect(existsSync(join(dir, "a"))).toBe(true);
  });

  test("refuses a count that is not a whole number, and a directory that is not there", () => {
    expect(() => pruneWork(dir, -1)).toThrow(/whole number/);
    expect(() => pruneWork(dir, 1.5)).toThrow(/whole number/);
    expect(() => pruneWork(join(dir, "missing"), 1)).toThrow(/missing/);
  });
});
