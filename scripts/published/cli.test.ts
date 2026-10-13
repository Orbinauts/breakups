import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Verdict } from "../../src/index.ts";
import { publishedRun } from "./cli.ts";
import { writeFixtureYear } from "./archive-fixture.ts";
import { readPublished } from "./files.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TRUTH = join(ROOT, "data/breakups.json");
const at = (iso: string): number => Date.parse(iso);

/** A confirmed verdict from the pieces alone, as the detector raises one with no step. */
function confirmed(number: number, raisedAt: string): Verdict {
  return { kind: "object", state: "confirmed", number, launch: null, raisedAt: at(raisedAt), step: null, event: null, evidence: { bodyClass: 0, pieces: 5 }, reasons: ["pieces catalogued"] };
}

let scratch: string;
let archive: string;
let out: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "published-run-"));
  archive = join(scratch, "archive");
  out = join(scratch, "published");
  mkdirSync(out);
  writeFixtureYear(archive, 2026, { kind: "history", from: "2026-01-01", through: "2026-10-10", missing: [] }, [{ number: 99001, first: 0, count: 3, designator: "2020-001A", name: "TESTSAT 1", bodyClass: "payload", launch: "2020-01-07", decay: null }]);
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

function yearFile(year: number, verdicts: Verdict[], options: { detector?: string; carried?: boolean } = {}): string {
  const path = join(scratch, `${year}-${Math.random().toString(36).slice(2)}.json.gz`);
  writeFileSync(path, gzipSync(JSON.stringify({ format: 1, year, detector: { name: options.detector ?? "confirmed-v10", parameters: {} }, carried: options.carried ?? true, verdicts })));
  return path;
}

describe("a publishing run", () => {
  const luch = confirmed(40258, "2026-02-27T04:00:00.000Z");
  const testsat = confirmed(99001, "2026-06-01T04:00:00.000Z");

  test("lands the year's verdicts on the truth, writes the three files and says what it did", () => {
    const summary = publishedRun({ yearFiles: [yearFile(2026, [luch, testsat])], truth: TRUTH, out, archive, now: at("2026-10-11T03:12:45Z") });
    const breakups = readPublished(out);
    expect(breakups.map((b) => [b.id, b.state, b.row, b.parent.name])).toEqual([
      ["40258-2026-01-30", "confirmed", "40258:2026-01-30", "Luch (Olymp-K 1)"],
      ["99001-2026-06-01", "confirmed", null, "TESTSAT 1"],
    ]);
    const sha256 = createHash("sha256").update(readFileSync(TRUTH)).digest("hex");
    expect(JSON.parse(readFileSync(join(out, "v1/status.json"), "utf8"))).toEqual({ version: 1, ranAt: "2026-10-11T03:12:45.000Z", setsThrough: "2026-10-10", detector: "confirmed-v10", truthSha256: sha256 });
    expect(summary).toBe(`published 2 breakups (2 confirmed, 0 suspected): 2 new, 0 left; sets through 2026-10-10, detector confirmed-v10, truth ${sha256.slice(0, 12)}`);
  });

  test("merges into what is already published: a confirmed breakup the run no longer finds stays", () => {
    publishedRun({ yearFiles: [yearFile(2026, [luch, testsat])], truth: TRUTH, out, archive, now: at("2026-10-11T03:12:45Z") });
    const summary = publishedRun({ yearFiles: [yearFile(2026, [testsat])], truth: TRUTH, out, archive, now: at("2026-10-12T03:12:45Z") });
    expect(readPublished(out).map((b) => b.id)).toEqual(["40258-2026-01-30", "99001-2026-06-01"]);
    expect(summary).toMatch(/^published 2 breakups \(2 confirmed, 0 suspected\): 0 new, 0 left;/);
  });

  test("refuses year files from two detectors, or a replay that did not carry the states from the year before", () => {
    writeFixtureYear(archive, 2025, { kind: "bundle", file: "tle2025.txt.zip", bytes: 1, sha256: "", member: "tle2025.txt", memberBytes: 1 }, []);
    const run = (files: string[]) => () => publishedRun({ yearFiles: files, truth: TRUTH, out, archive, now: 0 });
    expect(run([yearFile(2025, [], { detector: "confirmed-v9" }), yearFile(2026, [luch])])).toThrow(/confirmed-v9.*confirmed-v10|two detectors/);
    expect(run([yearFile(2026, [luch], { carried: false })])).toThrow(/carr/);
  });

  test("reads the last day of sets from the latest year: a settled year's bundle runs to its end", () => {
    writeFixtureYear(archive, 2025, { kind: "bundle", file: "tle2025.txt.zip", bytes: 1, sha256: "", member: "tle2025.txt", memberBytes: 1 }, []);
    const summary = publishedRun({ yearFiles: [yearFile(2025, [])], truth: TRUTH, out, archive, now: 0 });
    expect(summary).toContain("sets through 2025-12-31");
    expect(publishedRun({ yearFiles: [yearFile(2026, []), yearFile(2025, [])], truth: TRUTH, out, archive, now: 0 })).toContain("sets through 2026-10-10");
  });
});
