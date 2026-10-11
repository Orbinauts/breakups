import { describe, expect, test } from "vitest";
import type { ReleaseManifest } from "../archive/release.ts";
import type { Latest } from "../kpi/kpi.ts";
import { scorecardStale } from "./plan.ts";

const latest = {
  truthSha256: "1".repeat(64),
  years: [2025, 2026],
  archive: { "2025": { builtAt: "2026-10-09T19:00:00Z" }, "2026": { builtAt: "2026-10-11T08:50:20Z" } },
} as unknown as Pick<Latest, "truthSha256" | "years" | "archive">;

const released = (years: Record<string, string>): Pick<ReleaseManifest, "years"> => ({ years: Object.fromEntries(Object.entries(years).map(([year, builtAt]) => [year, { file: `archive-v1-${year}.tar`, bytes: 1, sha256: "a", builtAt }])) });
const same = released({ "2025": "2026-10-09T19:00:00Z", "2026": "2026-10-11T08:50:20Z" });

describe("whether the committed scorecard is stale", () => {
  test("not where the truth and the Archive's years are the ones it was made from", () => {
    expect(scorecardStale(latest, "1".repeat(64), same)).toEqual([]);
  });

  test("where the truth changed", () => {
    expect(scorecardStale(latest, "2".repeat(64), same)).toEqual(["the truth's sha256 is 222222222222…, the aggregate was scored against 111111111111…"]);
  });

  test("where the release holds a year more, a year fewer, or a year built again", () => {
    expect(scorecardStale(latest, "1".repeat(64), released({ "2025": "2026-10-09T19:00:00Z", "2026": "2026-10-11T08:50:20Z", "2027": "2028-01-10T05:00:00Z" }))).toEqual(["the Archive's release holds 2027, which the aggregate does not score"]);
    expect(scorecardStale(latest, "1".repeat(64), released({ "2025": "2026-10-09T19:00:00Z" }))).toEqual(["the aggregate scores 2026, which the Archive's release no longer holds"]);
    expect(scorecardStale(latest, "1".repeat(64), released({ "2025": "2026-10-09T19:00:00Z", "2026": "2027-01-11T05:00:00Z" }))).toEqual(["the Archive's release holds 2026 built at another time than the aggregate replayed"]);
  });
});
