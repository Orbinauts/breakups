import { describe, expect, test } from "vitest";
import { unchanged, type SnapshotRecord } from "./fetch-sources.ts";

const record: SnapshotRecord = { url: "https://example.org", fetchedOn: "2026-10-10", originalSha256: "o1", originalBytes: 1, snapshot: "sources/x", madeWith: "fetched as served", snapshotSha256: "s1", licence: "CC-BY-4.0" };

describe("a source fetched again", () => {
  test("is unchanged where its original's hash is the recorded one and the kept snapshot is the recorded snapshot", () => {
    expect(unchanged(record, "o1", null, "s1")).toBe(true);
    expect(unchanged(record, "o2", null, "s1")).toBe(false);
    expect(unchanged(record, "o1", null, "s2")).toBe(false);
    expect(unchanged(record, "o1", null, null)).toBe(false);
    expect(unchanged(undefined, "o1", null, "s1")).toBe(false);
  });

  test("a reduced source is unchanged where its reduction is the kept snapshot, whatever its original's hash", () => {
    expect(unchanged(record, "o2", "s1", "s1")).toBe(true);
    expect(unchanged(record, "o1", "s2", "s1")).toBe(false);
  });
});
