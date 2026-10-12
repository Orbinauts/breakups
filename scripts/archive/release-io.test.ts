import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { writeCatalogueIndex, INDEX_FORMAT } from "../kpi/catalogue-index.ts";
import { releaseManifestPath } from "./archive.ts";
import { CITATION, download, fetchTo, RELEASE_TAG, sha256File, upload, type ReleaseManifest } from "./release.ts";

/**
 * The Archive's release, both ways, with no network and no GitHub: the
 * upload over a stand-in `gh` on the PATH that records each call and keeps
 * what it is handed, the download over a stand-in `fetch` that serves a
 * directory as the release's assets. The Archives are a year or two of
 * stub files, each with a manifest and a catalogue index that describes
 * them.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "breakups-release-io-"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

/** A year of the Archive on disk: its manifest, body table and one column, built at the instant. */
function yearIn(archive: string, year: number, builtAt: string, through = `${year}-12-31`): void {
  mkdirSync(join(archive, String(year)), { recursive: true });
  writeFileSync(join(archive, String(year), "manifest.json"), JSON.stringify({ format: 1, year, source: { kind: "history", from: `${year}-01-01`, through, missing: [] }, sets: 1000 + year, builtAt }));
  writeFileSync(join(archive, String(year), "bodies.json"), "[]\n");
  writeFileSync(join(archive, String(year), "number.bin.gz"), `columns of ${year} built at ${builtAt}`);
}

/** The side files, with a catalogue index over the years and build times given. */
function sideIn(archive: string, years: Record<string, string>): void {
  for (const name of ["space", "satcat", "gcat"]) {
    mkdirSync(join(archive, name), { recursive: true });
    writeFileSync(join(archive, name, "a.json"), name);
  }
  writeCatalogueIndex(archive, { format: INDEX_FORMAT, builtAt: "2026-10-01T00:00:00Z", years: Object.fromEntries(Object.entries(years).map(([year, builtAt]) => [year, { builtAt, sets: 1000 + Number(year) }])), truthSha256: "0", bodies: [], parentOrbits: [] });
}

describe("the upload", () => {
  let archive: string;
  let log: string;
  let kept: string;
  /** A `gh` that records its arguments, says whether the release exists, hands out the release's manifest and keeps each upload. */
  function stubGh(release: ReleaseManifest | null): void {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    log = join(dir, "gh.log");
    kept = join(dir, "kept");
    mkdirSync(kept);
    const manifest = join(dir, "release-manifest.json");
    if (release !== null) writeFileSync(manifest, JSON.stringify(release));
    writeFileSync(
      join(bin, "gh"),
      [
        "#!/bin/sh",
        `echo "$*" >> '${log}'`,
        `if [ "$1 $2" = "release view" ]; then ${release === null ? "exit 1" : "exit 0"}; fi`,
        `if [ "$1 $2" = "release download" ]; then while [ $# -gt 0 ]; do if [ "$1" = --output ]; then cp '${manifest}' "$2"; fi; shift; done; exit 0; fi`,
        `if [ "$1 $2" = "release upload" ]; then cp "$4" '${kept}/'; fi`,
        "exit 0",
      ].join("\n"),
      { mode: 0o755 },
    );
    vi.stubEnv("PATH", `${bin}:${process.env["PATH"]}`);
  }
  const calls = (): string[] => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter((line) => line !== "") : []);

  beforeEach(() => {
    archive = join(dir, "archive");
    yearIn(archive, 2026, "2026-10-12T00:00:00Z", "2026-10-11");
  });

  test("refuses the side files alone with years given, and an Archive with no catalogue index or a stale one, before it asks GitHub anything", () => {
    stubGh(null);
    expect(() => upload(archive, [2026], true)).toThrow(/--side-only uploads the side files alone: give no years/);
    expect(() => upload(archive, [2026])).toThrow(/no catalogue index at/);
    sideIn(archive, { 2026: "2026-01-01T00:00:00Z" });
    expect(() => upload(archive, [2026])).toThrow(/the catalogue index .* is stale \(2026 was built at 2026-10-12T00:00:00Z, the index read it as built at 2026-01-01T00:00:00Z\)/);
    expect(calls()).toEqual([]);
  });

  test("uploads the year asked and the side files beside the years already released, each recorded with its size, hash, sets, build time and last day, and leaves no tarball behind", () => {
    sideIn(archive, { 2026: "2026-10-12T00:00:00Z" });
    const old = { file: `${RELEASE_TAG}-2005.tar`, bytes: 9, sha256: "f".repeat(64), sets: 3005, builtAt: "2026-01-01T00:00:00Z", through: "2005-12-31" };
    stubGh({ format: 1, tag: RELEASE_TAG, years: { 2005: old }, side: null, citation: CITATION, writtenAt: "" });
    upload(archive, [2026]);
    const manifest = JSON.parse(readFileSync(join(kept, "manifest.json"), "utf8")) as ReleaseManifest;
    expect(manifest.years["2005"]).toEqual(old);
    expect(manifest.years["2026"]).toMatchObject({ file: `${RELEASE_TAG}-2026.tar`, sets: 3026, builtAt: "2026-10-12T00:00:00Z", through: "2026-10-11", sha256: sha256File(join(kept, `${RELEASE_TAG}-2026.tar`)) });
    expect(manifest.side).toMatchObject({ file: `${RELEASE_TAG}-side.tar`, sha256: sha256File(join(kept, `${RELEASE_TAG}-side.tar`)) });
    expect(execFileSync("tar", ["-tf", join(kept, `${RELEASE_TAG}-side.tar`)], { encoding: "utf8" })).toMatch(/^index\/catalogue-index\.json\.gz$/m);
    expect(calls().filter((call) => call.startsWith("release create"))).toEqual([]);
    expect(calls().filter((call) => call.startsWith("release upload")).map((call) => call.split(" ")[3]!.split("/").pop())).toEqual([`${RELEASE_TAG}-2026.tar`, `${RELEASE_TAG}-side.tar`, "manifest.json"]);
    expect(readdirSync(join(archive, "release"))).toEqual(["manifest.json"]);
  });

  test("creates the release where there is none", () => {
    sideIn(archive, { 2026: "2026-10-12T00:00:00Z" });
    stubGh(null);
    upload(archive, [2026]);
    expect(calls().filter((call) => call.startsWith("release create"))).toHaveLength(1);
    expect(Object.keys((JSON.parse(readFileSync(join(kept, "manifest.json"), "utf8")) as ReleaseManifest).years)).toEqual(["2026"]);
  });

  test("refuses the side files alone where the release's years were built otherwise than the Archive's, or where there is no release", () => {
    sideIn(archive, { 2026: "2026-10-12T00:00:00Z" });
    stubGh({ format: 1, tag: RELEASE_TAG, years: { 2026: { file: `${RELEASE_TAG}-2026.tar`, bytes: 1, sha256: "0", builtAt: "2026-09-01T00:00:00Z" } }, side: null, citation: CITATION, writtenAt: "" });
    expect(() => upload(archive, [], true)).toThrow(/holds 2026 at another build time than the Archive/);
    expect(calls().filter((call) => call.startsWith("release upload"))).toEqual([]);
  });
});

describe("the download", () => {
  let release: string;
  let archive: string;
  let fetched: { url: string; headers: Record<string, string> }[];
  const BASE = "https://store.example/archive";

  /** The release's assets as a directory: each year's tarball and the side files', with a manifest naming their hashes. */
  function publish(years: Record<number, string>, side: boolean, indexYears: Record<string, string> = Object.fromEntries(Object.entries(years))): ReleaseManifest {
    const built = join(dir, "built");
    rmSync(built, { recursive: true, force: true });
    rmSync(release, { recursive: true, force: true });
    mkdirSync(release, { recursive: true });
    const manifest: ReleaseManifest = { format: 1, tag: RELEASE_TAG, years: {}, side: null, citation: CITATION, writtenAt: "" };
    for (const [year, builtAt] of Object.entries(years)) {
      yearIn(built, Number(year), builtAt);
      const file = `${RELEASE_TAG}-${year}.tar`;
      execFileSync("tar", ["-cf", join(release, file), "-C", built, year]);
      manifest.years[year] = { file, bytes: 0, sha256: sha256File(join(release, file)), sets: 1000 + Number(year), builtAt };
    }
    if (side) {
      sideIn(built, indexYears);
      const file = `${RELEASE_TAG}-side.tar`;
      execFileSync("tar", ["-cf", join(release, file), "-C", built, "space", "satcat", "gcat", "index"]);
      manifest.side = { file, bytes: 0, sha256: sha256File(join(release, file)) };
    }
    writeFileSync(join(release, "manifest.json"), JSON.stringify(manifest));
    return manifest;
  }
  const names = (): string[] => fetched.map((f) => f.url.slice(BASE.length + 1));

  beforeEach(() => {
    release = join(dir, "release");
    archive = join(dir, "archive");
    fetched = [];
    vi.stubEnv("ARCHIVE_BASE_URL", BASE);
    vi.stubGlobal("fetch", async (url: string, init: { headers: Record<string, string> }) => {
      fetched.push({ url, headers: init.headers });
      const path = join(release, url.slice(BASE.length + 1));
      return existsSync(path) ? new Response(readFileSync(path)) : new Response("not found", { status: 404 });
    });
  });

  test("fetches the years asked, the one before each with the warm-up, and the side files, each verified against the manifest, and keeps the manifest", async () => {
    publish({ 2025: "2026-02-01T00:00:00Z", 2026: "2026-10-12T00:00:00Z" }, true);
    await download(archive, [2026], true);
    expect(names()).toEqual(["manifest.json", `${RELEASE_TAG}-2025.tar`, `${RELEASE_TAG}-2026.tar`, `${RELEASE_TAG}-side.tar`]);
    expect(readFileSync(join(archive, "2026", "number.bin.gz"), "utf8")).toBe("columns of 2026 built at 2026-10-12T00:00:00Z");
    expect(existsSync(join(archive, "2025", "manifest.json"))).toBe(true);
    expect(existsSync(join(archive, "index", "catalogue-index.json.gz"))).toBe(true);
    expect(existsSync(releaseManifestPath(archive))).toBe(true);
    // No tarball is left beside the years.
    expect(readdirSync(archive).filter((name) => name.endsWith(".tar"))).toEqual([]);
  });

  test("fetches again only what the release changed: a year at the same build time and the side files it extracted are kept", async () => {
    publish({ 2026: "2026-10-12T00:00:00Z" }, true);
    await download(archive, [2026], false);
    fetched = [];
    await download(archive, [2026], false);
    expect(names()).toEqual(["manifest.json"]);
    // The year rebuilt and the side files with it: both fetched again.
    publish({ 2026: "2026-10-13T00:00:00Z" }, true);
    fetched = [];
    await download(archive, [2026], false);
    expect(names()).toEqual(["manifest.json", `${RELEASE_TAG}-2026.tar`, `${RELEASE_TAG}-side.tar`]);
    expect(readFileSync(join(archive, "2026", "number.bin.gz"), "utf8")).toBe("columns of 2026 built at 2026-10-13T00:00:00Z");
  });

  test("an Archive built here with no index fetches the release's index alone, its own side files kept", async () => {
    publish({ 2026: "2026-10-12T00:00:00Z" }, true);
    mkdirSync(join(archive, "space"), { recursive: true });
    writeFileSync(join(archive, "space", "a.json"), "built here");
    await download(archive, [], false);
    expect(readFileSync(join(archive, "space", "a.json"), "utf8")).toBe("built here");
    expect(existsSync(join(archive, "index", "catalogue-index.json.gz"))).toBe(true);
    expect(existsSync(join(archive, "side.sha256"))).toBe(false);
  });

  test("refuses a tarball whose hash is not the manifest's, and a year the release lacks", async () => {
    const manifest = publish({ 2026: "2026-10-12T00:00:00Z" }, false);
    writeFileSync(join(release, `${RELEASE_TAG}-2026.tar`), "tampered");
    await expect(download(archive, [2026], false)).rejects.toThrow(`${RELEASE_TAG}-2026.tar: sha256 ${sha256File(join(release, `${RELEASE_TAG}-2026.tar`))} is not the manifest's ${manifest.years["2026"]!.sha256}`);
    expect(existsSync(join(archive, "2026"))).toBe(false);
    await expect(download(archive, [2019], false)).rejects.toThrow("the release has no 2019");
  });

  test("refuses side files whose catalogue index does not describe the released years", async () => {
    publish({ 2026: "2026-10-12T00:00:00Z" }, true, { 2026: "2026-01-01T00:00:00Z" });
    await expect(download(archive, [], false)).rejects.toThrow(/the released catalogue index does not describe the released years \(2026\)/);
  });

  test("sends the store's header where one is set, and tries a failed fetch again before failing", async () => {
    publish({}, false);
    vi.stubEnv("ARCHIVE_AUTH_HEADER", "Authorization: Bearer a:b");
    await download(archive, [], false);
    expect(fetched[0]!.headers["Authorization"]).toBe("Bearer a:b");
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    let failures = 2;
    vi.stubGlobal("fetch", async () => (failures-- > 0 ? new Response("busy", { status: 503 }) : new Response("third time")));
    const path = join(dir, "fetched.txt");
    const done = fetchTo(`${BASE}/x`, path);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(readFileSync(path, "utf8")).toBe("third time");
    failures = 3;
    const failed = fetchTo(`${BASE}/x`, path).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(String(await failed)).toContain("503");
  });
});

