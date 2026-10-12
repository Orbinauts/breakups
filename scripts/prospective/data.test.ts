import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, test } from "vitest";
import { daysToPull, historyDir } from "../archive/pull.ts";
import { assetName, changedAssets, emptyManifest, localStates, planOf, provenanceFileOf, replayYearsOf, statesFileOf, tarHistory, untarHistory, type DataAsset, type DataManifest } from "./data.ts";
import { checkTagged, FROZEN_COMMIT, provenanceOf, runUrlOf } from "./run.ts";

const DAY = 86_400_000;
const work = mkdtempSync(join(tmpdir(), "breakups-prospective-data-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const asset = (kind: DataAsset["kind"], year: number, sha256 = `${kind}${year}`): DataAsset => ({ file: assetName(kind, year), kind, year, bytes: 1, sha256 });

function manifestOf(...assets: DataAsset[]): DataManifest {
  const manifest = emptyManifest();
  for (const one of assets) manifest.assets[one.file] = one;
  return manifest;
}

const RELEASED = Array.from({ length: 22 }, (_, i) => 2005 + i);

describe("the plan of a day's run", () => {
  const seeded = manifestOf(asset("states", 2025), asset("provenance", 2025), asset("history", 2026));

  test("replays the current year from the previous year's states, over every released year before it", () => {
    const plan = planOf("2026-10-12", RELEASED, seeded);
    expect(plan.replayYears).toEqual([2026]);
    expect(plan.historyYears).toEqual([2026]);
    expect(plan.archiveYears).toEqual(RELEASED.filter((y) => y < 2026));
    expect(plan.states).toEqual(["states-2025.json.gz", "states-2025.provenance.txt"]);
  });

  test("replays the previous year too while its end states are not kept, and pulls a new year's first days whole", () => {
    const plan = planOf("2027-01-02", RELEASED, seeded);
    expect(plan.replayYears).toEqual([2026, 2027]);
    expect(plan.historyYears).toEqual([2026]);
    expect(plan.archiveYears.at(-1)).toBe(2025);
  });

  test("once the closed year's states are kept, replays the new year alone over the released years before it", () => {
    const carried = manifestOf(asset("states", 2025), asset("states", 2026), asset("history", 2026), asset("history", 2027));
    const plan = planOf("2027-03-01", [...RELEASED, 2026], carried);
    expect(plan.replayYears).toEqual([2027]);
    expect(plan.historyYears).toEqual([2027]);
    expect(plan.archiveYears.at(-1)).toBe(2026);
  });

  test("refuses a year with no states to start from, a gap in the released Archive, and a missing history past a year's first days", () => {
    expect(() => planOf("2026-10-12", RELEASED, manifestOf(asset("history", 2026)))).toThrow(/no states to start 2025 from/);
    expect(() => planOf("2026-10-12", RELEASED.filter((y) => y !== 2010), seeded)).toThrow(/lacks 2010/);
    expect(() => planOf("2026-10-12", RELEASED, manifestOf(asset("states", 2025)))).toThrow(/no history of 2026/);
    expect(() => planOf("2027-02-01", RELEASED, manifestOf(asset("states", 2025), asset("states", 2026), asset("history", 2026)))).toThrow(/no history of 2027/);
  });

  test("names the replayed years as the daily run does", () => {
    expect(replayYearsOf(2026, true)).toEqual([2026]);
    expect(replayYearsOf(2027, false)).toEqual([2026, 2027]);
  });
});

describe("what an upload sends", () => {
  test("is every asset whose hash the release's manifest does not already name", () => {
    const manifest = manifestOf(asset("states", 2025), asset("history", 2026, "old"));
    const local = [asset("states", 2025), asset("provenance", 2025), asset("history", 2026, "new")];
    expect(changedAssets(manifest, local).map((one) => one.file)).toEqual(["states-2025.provenance.txt", "history-2026.tar"]);
    expect(changedAssets(manifest, [asset("states", 2025)])).toEqual([]);
  });

  test("names the states kept under the Archive, and nothing else there", () => {
    const archive = join(work, "states-archive");
    mkdirSync(join(archive, "prospective", "states"), { recursive: true });
    writeFileSync(statesFileOf(archive, 2025), gzipSync("{}"));
    writeFileSync(provenanceFileOf(archive, 2025), "made by the full replay\n");
    writeFileSync(`${statesFileOf(archive, 2026)}.copying`, "half");
    expect(localStates(archive).map((one) => [one.file, one.kind, one.year])).toEqual([
      ["states-2025.json.gz", "states", 2025],
      ["states-2025.provenance.txt", "provenance", 2025],
    ]);
  });
});

describe("a year's history as a tarball", () => {
  test("comes back with its days and their modification times, so the bare days kept for good are not pulled again", () => {
    const from = join(work, "from");
    const to = join(work, "to");
    const dir = historyDir(from, 2026);
    mkdirSync(dir, { recursive: true });
    const days = ["2026-01-01", "2026-01-02", "2026-01-03"];
    for (const day of days) {
      const path = join(dir, `${day}.json.gz`);
      writeFileSync(path, gzipSync(JSON.stringify([{ NORAD_CAT_ID: "25544", GP_ID: day }])));
      const keptAt = new Date(Date.parse(`${day}T00:00:00Z`) + 5 * DAY);
      utimesSync(path, keptAt, keptAt);
    }
    // A day kept before it settled, and a leftover of an interrupted pull, which the tarball leaves out.
    utimesSync(join(dir, "2026-01-03.json.gz"), new Date("2026-01-03T12:00:00Z"), new Date("2026-01-03T12:00:00Z"));
    writeFileSync(join(dir, "2026-01-04.json.gz.again"), "partial");
    const tarball = join(work, "history-2026.tar");
    const made = tarHistory(from, 2026, tarball);
    expect(made).toMatchObject({ file: "history-2026.tar", kind: "history", year: 2026, days: 3, through: "2026-01-03" });
    expect(tarHistory(from, 2026, join(work, "again.tar")).sha256).toBe(made.sha256);
    mkdirSync(historyDir(to, 2026), { recursive: true });
    writeFileSync(join(historyDir(to, 2026), "stale.json.gz"), "replaced whole");
    untarHistory(to, 2026, tarball);
    expect(readdirSync(historyDir(to, 2026)).sort()).toEqual(days.map((day) => `${day}.json.gz`));
    for (const day of days) expect(Math.floor(statSync(join(historyDir(to, 2026), `${day}.json.gz`)).mtimeMs / 1000)).toBe(Math.floor(statSync(join(dir, `${day}.json.gz`)).mtimeMs / 1000));
    expect(daysToPull(to, 2026, "2026-01-03")).toEqual(["2026-01-03"]);
  });
});

describe("the daily run's record of where it ran", () => {
  test("is the GitHub Actions run's URL, with its attempt past the first, or null elsewhere", () => {
    const env = { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "owner/repo", GITHUB_RUN_ID: "123" };
    expect(runUrlOf(env)).toBe("https://github.com/owner/repo/actions/runs/123");
    expect(runUrlOf({ ...env, GITHUB_RUN_ATTEMPT: "1" })).toBe("https://github.com/owner/repo/actions/runs/123");
    expect(runUrlOf({ ...env, GITHUB_RUN_ATTEMPT: "2" })).toBe("https://github.com/owner/repo/actions/runs/123/attempts/2");
    expect(runUrlOf({})).toBeNull();
  });

  test("refuses a tag moved off the frozen commit", () => {
    expect(() => checkTagged(FROZEN_COMMIT)).not.toThrow();
    expect(() => checkTagged("0".repeat(40))).toThrow(/not the frozen detector/);
  });

  test("says what made a closed year's end states", () => {
    const text = provenanceOf(2026, { today: "2027-01-03", tagged: FROZEN_COMMIT, scratch: "/archive/prospective/2027-01-03", runUrl: "https://github.com/owner/repo/actions/runs/9", sha256: "ab".repeat(32) });
    expect(text).toContain("2026.json.gz is the detector confirmed-v10's states at the end of 2026");
    expect(text).toContain("from its states at the end of 2025");
    expect(text).toContain("by https://github.com/owner/repo/actions/runs/9");
    expect(text.endsWith(`sha256 ${"ab".repeat(32)}.\n`)).toBe(true);
  });
});
