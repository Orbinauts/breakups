import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import type { ReleaseManifest } from "../archive/release.ts";
import { emptyManifest, type DataManifest } from "../prospective/data.ts";
import { holdsWhole, promotionDue, tarballBytes } from "./promote.ts";

const released = (through?: string): ReleaseManifest => ({ format: 1, tag: "archive-v1", years: { "2025": { file: "archive-v1-2025.tar", bytes: 1, sha256: "a", builtAt: "2026-10-09T19:00:00Z" }, "2026": { file: "archive-v1-2026.tar", bytes: 1, sha256: "b", builtAt: "2026-10-11T08:50:20Z", ...(through === undefined ? {} : { through }) } }, side: null, citation: "", writtenAt: "" });

function data(historyThrough: string | null, states: boolean): DataManifest {
  const manifest = emptyManifest();
  if (historyThrough !== null) manifest.assets["history-2026.tar"] = { file: "history-2026.tar", kind: "history", year: 2026, bytes: 1, sha256: "h", days: 365, through: historyThrough };
  if (states) manifest.assets["states-2026.json.gz"] = { file: "states-2026.json.gz", kind: "states", year: 2026, bytes: 1, sha256: "s" };
  return manifest;
}

describe("the yearly promotion", () => {
  test("waits for 5 January", () => {
    expect(promotionDue("2027-01-04", released(), data("2026-12-31", true)).year).toBeNull();
    expect(promotionDue("2026-12-31", released(), data("2026-12-31", true)).year).toBeNull();
    expect(promotionDue("2027-01-05", released(), data("2026-12-31", true)).year).toBe(2026);
  });

  test("waits for the test to settle the year: its history through 31 December and its end states kept", () => {
    expect(promotionDue("2027-01-05", released(), data("2026-12-30", true))).toEqual({ year: null, reason: "the history of 2026 ends on 2026-12-30, not 2026-12-31" });
    expect(promotionDue("2027-01-05", released(), data("2026-12-31", false)).reason).toContain("has not settled");
    expect(promotionDue("2027-01-05", released(), data(null, false)).reason).toContain("no history of 2026");
  });

  test("promotes a year the Archive's release does not hold at all, as well as one it holds in part", () => {
    expect(promotionDue("2028-01-10", released(), { ...emptyManifest(), assets: { "history-2027.tar": { file: "history-2027.tar", kind: "history", year: 2027, bytes: 1, sha256: "h", through: "2027-12-31" }, "states-2027.json.gz": { file: "states-2027.json.gz", kind: "states", year: 2027, bytes: 1, sha256: "s" } } }).year).toBe(2027);
    expect(promotionDue("2027-03-01", released("2026-10-11"), data("2026-12-31", true)).year).toBe(2026);
  });

  test("is idempotent: once the release holds the year through 31 December, no later run promotes it again", () => {
    const after = released("2026-12-31");
    expect(holdsWhole(after, 2026)).toBe(true);
    for (const day of ["2027-01-05", "2027-01-12", "2027-06-07", "2027-12-27"]) expect(promotionDue(day, after, data("2026-12-31", true)).year).toBeNull();
    expect(promotionDue("2027-01-12", after, data("2026-12-31", true)).reason).toBe("the Archive's release holds 2026 through 2026-12-31");
  });
});

describe("the size of a year's tarball", () => {
  const dir = mkdtempSync(join(tmpdir(), "breakups-tar-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("is reckoned before the tarball is made, as tar makes it", () => {
    mkdirSync(join(dir, "2026"));
    writeFileSync(join(dir, "2026", "manifest.json"), "{}\n");
    writeFileSync(join(dir, "2026", "number.bin.gz"), Buffer.alloc(70_001, 7));
    writeFileSync(join(dir, "2026", "bodies.json"), "x".repeat(1_234));
    const out = join(dir, "2026.tar");
    execFileSync("tar", ["-cf", out, "-C", dir, "2026"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
    const made = statSync(out).size;
    const reckoned = tarballBytes(join(dir, "2026"));
    expect(reckoned).toBeGreaterThanOrEqual(made);
    expect(reckoned - made).toBeLessThanOrEqual(10_240);
  });
});
