import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Verdict } from "../../src/index.ts";
import { writeFixtureYear } from "./archive-fixture.ts";
import { publishDaily, type DailyPlaces } from "./daily.ts";
import { readPublished } from "./files.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const at = (iso: string): number => Date.parse(iso);

const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A confirmed verdict from the pieces alone, as the detector raises one with no step. */
function confirmed(number: number, raisedAt: string): Verdict {
  return { kind: "object", state: "confirmed", number, launch: null, raisedAt: at(raisedAt), step: null, event: null, evidence: { bodyClass: 0, pieces: 5 }, reasons: ["pieces catalogued"] };
}

let scratch: string;
let places: DailyPlaces;
let remote: string;
let hooks: string;

/** Configures a checkout as the bot's, unsigned, with this test's hooks only. */
function asBot(checkout: string): void {
  git(checkout, "config", "user.name", "github-actions[bot]");
  git(checkout, "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
  git(checkout, "config", "commit.gpgsign", "false");
  git(checkout, "config", "core.hooksPath", hooks);
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "published-daily-"));
  hooks = join(scratch, "hooks");
  mkdirSync(hooks);
  const archive = join(scratch, "archive");
  places = { root: ROOT, archive, home: join(archive, "prospective"), branch: join(scratch, "prospective"), published: join(scratch, "published") };

  // The Archive as the day's run left it: the year's manifest and body table, and the replay's year file in the day's scratch.
  writeFixtureYear(archive, 2026, { kind: "history", from: "2026-01-01", through: "2026-10-10", missing: [] }, []);
  yearFile("2026-10-11", 2026, [confirmed(40258, "2026-02-27T04:00:00.000Z")]);

  // The prospective log, whose last line is the run that just committed.
  mkdirSync(places.branch);
  writeFileSync(join(places.branch, "runs.jsonl"), `${JSON.stringify(runLine("2026-10-10", [2026]))}\n${JSON.stringify(runLine("2026-10-11", [2026]))}\n`);

  // The `published` branch on a remote, and a checkout of it that tracks it.
  remote = join(scratch, "remote.git");
  git(scratch, "init", "-q", "--bare", remote);
  const seed = join(scratch, "seed");
  git(scratch, "init", "-q", "-b", "published", seed);
  asBot(seed);
  writeFileSync(join(seed, "README.md"), "the published breakups\n");
  git(seed, "add", ".");
  git(seed, "commit", "-q", "-m", "The seed");
  git(seed, "push", "-q", remote, "published");
  git(scratch, "clone", "-q", "-b", "published", remote, places.published);
  asBot(places.published);
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

function yearFile(day: string, year: number, verdicts: Verdict[]): void {
  const dir = join(places.home, day, "years");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${year}.json.gz`), gzipSync(JSON.stringify({ format: 1, year, detector: { name: "confirmed-v10", parameters: {} }, carried: true, verdicts })));
}

function runLine(date: string, years: number[]): object {
  return { date, startedAt: `${date}T02:40:00.000Z`, detector: "confirmed-v10", years: years.map((year) => ({ year, through: `${date}`, sets: 1, runs: 1, carried: true })) };
}

const remoteLog = (): string[] => git(remote, "log", "--format=%s", "published").split("\n");

describe("the daily publishing", () => {
  test("publishes the replay of the run just logged, commits v2/ to the published branch and pushes it", () => {
    const { summary, commit } = publishDaily(places, at("2026-10-11T03:12:45Z"), { runUrl: "https://github.com/Orbinauts/breakups/actions/runs/7" });
    expect(readPublished(places.published).map((b) => b.id)).toEqual(["40258-2026-01-30"]);
    expect(summary).toMatch(/^published 1 breakup \(1 confirmed, 0 unreported, 0 suspected\): 1 new, 0 left; sets through 2026-10-10/);
    expect(git(remote, "rev-parse", "published")).toBe(commit);
    expect(remoteLog()).toEqual(["Published breakups of 2026-10-11", "The seed"]);
    const body = git(remote, "log", "-1", "--format=%b", "published");
    expect(body).toContain(summary);
    expect(body).toContain("https://github.com/Orbinauts/breakups/actions/runs/7");
    expect(git(places.published, "show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual(["v2/breakups.json", "v2/breakups/40258-2026-01-30.json", "v2/status.json"]);
    expect(git(places.published, "status", "--porcelain")).toBe("");
  });

  test("puts the worktree back and pushes nothing when the commit fails", () => {
    writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\necho refused >&2\nexit 1\n");
    chmodSync(join(hooks, "pre-commit"), 0o755);
    expect(() => publishDaily(places, at("2026-10-11T03:12:45Z"), { runUrl: null })).toThrow(/refused/);
    expect(existsSync(join(places.published, "v2"))).toBe(false);
    expect(git(places.published, "status", "--porcelain")).toBe("");
    expect(remoteLog()).toEqual(["The seed"]);
  });

  test("keeps a commit it could not push, and the next run pushes both", () => {
    const pushUrl = git(places.published, "remote", "get-url", "origin");
    git(places.published, "remote", "set-url", "--push", "origin", join(scratch, "nowhere.git"));
    expect(() => publishDaily(places, at("2026-10-11T03:12:45Z"), { runUrl: null })).toThrow();
    expect(git(places.published, "log", "-1", "--format=%s")).toBe("Published breakups of 2026-10-11");
    git(places.published, "remote", "set-url", "--push", "origin", pushUrl);
    yearFile("2026-10-12", 2026, [confirmed(40258, "2026-02-27T04:00:00.000Z")]);
    writeFileSync(join(places.branch, "runs.jsonl"), `${readFileSync(join(places.branch, "runs.jsonl"), "utf8")}${JSON.stringify(runLine("2026-10-12", [2026]))}\n`);
    publishDaily(places, at("2026-10-12T03:12:45Z"), { runUrl: null });
    expect(remoteLog()).toEqual(["Published breakups of 2026-10-12", "Published breakups of 2026-10-11", "The seed"]);
  });

  test("reads both year files of an early-January run", () => {
    writeFixtureYear(places.archive, 2025, { kind: "bundle", file: "tle2025.txt.zip", bytes: 1, sha256: "", member: "tle2025.txt", memberBytes: 1 }, []);
    yearFile("2026-01-03", 2025, [confirmed(24753, "2025-11-20T04:00:00.000Z")]);
    yearFile("2026-01-03", 2026, [confirmed(40258, "2026-02-27T04:00:00.000Z")]);
    writeFileSync(join(places.branch, "runs.jsonl"), `${JSON.stringify(runLine("2026-01-03", [2025, 2026]))}\n`);
    publishDaily(places, at("2026-01-03T03:12:45Z"), { runUrl: null });
    expect(readPublished(places.published).map((b) => b.parent.catalogueNumber)).toEqual([24753, 40258]);
  });

  test("refuses, writing nothing, a worktree off the branch or with changes, and a run whose year file is gone", () => {
    const run = () => publishDaily(places, at("2026-10-11T03:12:45Z"), { runUrl: null });
    writeFileSync(join(places.published, "stray.txt"), "left over\n");
    expect(run).toThrow(/has changes/);
    rmSync(join(places.published, "stray.txt"));
    git(places.published, "switch", "-q", "-c", "elsewhere");
    expect(run).toThrow(/not on the published branch/);
    git(places.published, "switch", "-q", "published");
    rmSync(join(places.home, "2026-10-11"), { recursive: true });
    expect(run).toThrow(/no year file of the run of 2026-10-11/);
    expect(existsSync(join(places.published, "v2"))).toBe(false);
    expect(remoteLog()).toEqual(["The seed"]);
  });
});
