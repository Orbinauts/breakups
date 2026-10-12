import { describe, expect, test } from "vitest";
import type { ReleaseManifest } from "../archive/release.ts";
import type { Latest } from "../kpi/kpi.ts";
import { emptyManifest } from "../prospective/data.ts";
import { historyOnCourse, scorecardStale } from "./plan.ts";

const pinned = { "@orbinauts/engine": "0.1.2", "satellite.js": "7.1.0", "astronomy-engine": "2.1.19" };

const latest = {
  truthSha256: "1".repeat(64),
  years: [2025, 2026],
  archive: { "2025": { builtAt: "2026-10-09T19:00:00Z" }, "2026": { builtAt: "2026-10-11T08:50:20Z" } },
  versions: pinned,
} as unknown as Pick<Latest, "truthSha256" | "years" | "archive" | "versions">;

const released = (years: Record<string, string>): Pick<ReleaseManifest, "years"> => ({ years: Object.fromEntries(Object.entries(years).map(([year, builtAt]) => [year, { file: `archive-v1-${year}.tar`, bytes: 1, sha256: "a", builtAt }])) });
const same = released({ "2025": "2026-10-09T19:00:00Z", "2026": "2026-10-11T08:50:20Z" });

describe("whether the committed scorecard is stale", () => {
  test("not where the truth and the Archive's years are the ones it was made from", () => {
    expect(scorecardStale(latest, "1".repeat(64), same, pinned)).toEqual([]);
  });

  test("where the truth changed", () => {
    expect(scorecardStale(latest, "2".repeat(64), same, pinned)).toEqual(["the truth's sha256 is 222222222222…, the aggregate was scored against 111111111111…"]);
  });

  test("where the release holds a year more, a year fewer, or a year built again", () => {
    expect(scorecardStale(latest, "1".repeat(64), released({ "2025": "2026-10-09T19:00:00Z", "2026": "2026-10-11T08:50:20Z", "2027": "2028-01-10T05:00:00Z" }), pinned)).toEqual(["the Archive's release holds 2027, which the aggregate does not score"]);
    expect(scorecardStale(latest, "1".repeat(64), released({ "2025": "2026-10-09T19:00:00Z" }), pinned)).toEqual(["the aggregate scores 2026, which the Archive's release no longer holds"]);
    expect(scorecardStale(latest, "1".repeat(64), released({ "2025": "2026-10-09T19:00:00Z", "2026": "2027-01-11T05:00:00Z" }), pinned)).toEqual(["the Archive's release holds 2026 built at another time than the aggregate replayed"]);
  });

  test("where a scoring pin moved from the version the aggregate was scored with, one reason per package naming both", () => {
    expect(scorecardStale(latest, "1".repeat(64), same, { ...pinned, "@orbinauts/engine": "0.1.3" })).toEqual(["@orbinauts/engine is pinned at 0.1.3, the aggregate was scored with 0.1.2"]);
    expect(scorecardStale(latest, "1".repeat(64), same, { ...pinned, "satellite.js": "7.2.0", "astronomy-engine": "2.1.20" })).toEqual([
      "satellite.js is pinned at 7.2.0, the aggregate was scored with 7.1.0",
      "astronomy-engine is pinned at 2.1.20, the aggregate was scored with 2.1.19",
    ]);
  });

  test("where the aggregate records no versions, made before they were recorded: one reason", () => {
    const { versions: _, ...unrecorded } = latest;
    expect(scorecardStale(unrecorded, "1".repeat(64), same, pinned)).toEqual(["the aggregate records no versions of the engine and the propagators it was scored with"]);
  });
});

describe("the prospective test's history against the asset limit", () => {
  const data = (bytes: number, days: number) => ({ ...emptyManifest(), assets: { "history-2026.tar": { file: "history-2026.tar", kind: "history" as const, year: 2026, bytes, sha256: "h", days, through: "2026-10-11" } } });

  test("is projected to 31 December at the rate its days have grown", () => {
    expect(historyOnCourse(data(1_000_000_000, 365), 2026)).toEqual({ bytes: 1_000_000_000, projected: 1_000_000_000, warn: false });
    expect(historyOnCourse(data(1_000_000_000, 73), 2026)?.projected).toBe(5_000_000_000);
  });

  test("is warned of past nine tenths of the limit, and not before", () => {
    expect(historyOnCourse(data(1_502_433_280, 284), 2026)?.warn).toBe(false);
    expect(historyOnCourse(data(1_600_000_000, 284), 2026)?.warn).toBe(true);
    expect(historyOnCourse(emptyManifest(), 2026)).toBeNull();
  });
});
