import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { keepDay } from "../archive/pull.ts";
import { PINNED } from "../pins/pins.ts";
import { parseJsonl, type LoggedAlert } from "./alerts.ts";
import { checkTagged, daily, FROZEN_COMMIT, FROZEN_DETECTOR, FROZEN_TAG, frozenEnv, placesOf, provenanceOf, pruneScratch, refreshView, runUrlOf, throughOf, type DailyTools, type Places, type RunLine } from "./run.ts";

/**
 * The prospective test's daily run, `daily()`, over a world built in a
 * temporary directory: a repository whose tag is the frozen detector, its
 * worktree at the tag, the `prospective` branch's worktree with a remote to
 * push to, and an Archive with a year's manifest, a satellite catalogue
 * and states to start from. The commands the run hands out (the fetches,
 * the pulls, the frozen index and replay) are a stand-in that records
 * each call and writes what the frozen replay would write; git is git.
 * Never a network call. The helpers the run is made of are read on their
 * own first.
 */

describe("the daily run's helpers", () => {
  test("the run's URL is the Actions run's, with its attempt past the first, and none outside Actions", () => {
    const env = { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "Orbinauts/breakups", GITHUB_RUN_ID: "42" };
    expect(runUrlOf(env)).toBe("https://github.com/Orbinauts/breakups/actions/runs/42");
    expect(runUrlOf({ ...env, GITHUB_RUN_ATTEMPT: "1" })).toBe("https://github.com/Orbinauts/breakups/actions/runs/42");
    expect(runUrlOf({ ...env, GITHUB_RUN_ATTEMPT: "3" })).toBe("https://github.com/Orbinauts/breakups/actions/runs/42/attempts/3");
    expect(runUrlOf({ ...env, GITHUB_RUN_ID: "" })).toBeNull();
    expect(runUrlOf({})).toBeNull();
  });

  test("a tag naming any commit but the frozen one is refused", () => {
    expect(() => checkTagged(FROZEN_COMMIT)).not.toThrow();
    expect(() => checkTagged("0".repeat(40))).toThrow(/a moved tag is not the frozen detector/);
  });

  test("a year's last day is a pulled year's last kept day, a bundle year's December the 31st", () => {
    expect(throughOf({ kind: "history", from: "2026-01-01", through: "2026-10-12", missing: [] }, 2026)).toBe("2026-10-12");
    expect(throughOf({ kind: "bundle", file: "2025.zip" } as never, 2025)).toBe("2025-12-31");
  });

  test("the frozen worktree runs on the test's view of the Archive, with no catalogue credentials", () => {
    const env = frozenEnv({ PATH: "/bin", BREAKUPS_ARCHIVE: "/archive", SPACETRACK_USER: "u", SPACETRACK_PASSWORD: "p" }, "/archive/prospective/view");
    expect(env).toEqual({ PATH: "/bin", BREAKUPS_ARCHIVE: "/archive/prospective/view" });
  });

  test("a settled year's provenance names the year, the commit, the place and the hash, and the run where there was one", () => {
    const text = provenanceOf(2026, { today: "2027-01-03", tagged: FROZEN_COMMIT, scratch: "/a/2027-01-03", runUrl: "https://example/runs/1", sha256: "ab".repeat(32) });
    expect(text).toBe(`2026.json.gz is the detector ${FROZEN_DETECTOR}'s states at the end of 2026, written on 2027-01-03 by the prospective test's daily run once 2026 had settled: the frozen commit ${FROZEN_COMMIT} replayed 2026 through 2026-12-31 from its states at the end of 2025, in /a/2027-01-03 by https://example/runs/1. sha256 ${"ab".repeat(32)}.\n`);
  });

  test("the places are the environment's where it names them, the test's own under the Archive", () => {
    const places = placesOf("/archive", { BREAKUPS_FROZEN: "/f", BREAKUPS_PROSPECTIVE: "/p" });
    expect(places).toMatchObject({ frozen: "/f", branch: "/p", archive: "/archive", home: "/archive/prospective", view: "/archive/prospective/view", states: "/archive/prospective/states" });
  });

  describe("on disk", () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "breakups-daily-helpers-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    test("the view links every entry of the Archive but its index and the test's directory, drops a link whose entry went, and keeps its own index", () => {
      const archive = join(dir, "archive");
      const view = join(archive, "prospective", "view");
      for (const name of ["2025", "2026", "index", "satcat"]) mkdirSync(join(archive, name), { recursive: true });
      mkdirSync(join(view, "index"), { recursive: true });
      symlinkSync(join(archive, "gone"), join(view, "gone"));
      refreshView(archive, view);
      expect(readdirSync(view).sort()).toEqual(["2025", "2026", "index", "satcat"]);
      expect(execFileSync("readlink", [join(view, "2026")], { encoding: "utf8" }).trim()).toBe(join(archive, "2026"));
      // A file the view holds that is not a link is refused, not overwritten.
      writeFileSync(join(view, "stray"), "");
      expect(() => refreshView(archive, view)).toThrow(/is not a link/);
    });

    test("the scratch directories of days past the last seven are removed, oldest first, and nothing else", () => {
      const days = Array.from({ length: 9 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
      for (const day of [...days, "states", "view"]) mkdirSync(join(dir, day));
      expect(pruneScratch(dir)).toEqual(["2026-10-01", "2026-10-02"]);
      expect(readdirSync(dir).sort()).toEqual([...days.slice(2), "states", "view"]);
    });
  });
});

/** The bot's identity, and no global configuration: the machine's own (a signing key) is not the run's. */
const GIT_ENV = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "bot", GIT_AUTHOR_EMAIL: "bot@example", GIT_COMMITTER_NAME: "bot", GIT_COMMITTER_EMAIL: "bot@example" };

const DAY_MS = 86_400_000;
/** The run's instant: the third of January 2027, so 2026, after the freeze, is replayed with it while its last days settle. */
const STARTED = Date.UTC(2027, 0, 3, 6);
const TODAY = "2027-01-03";

/** A suspected verdict on an object, raised at the instant. */
function verdict(number: number, raisedAt: number): object {
  return { kind: "object", state: "suspected", number, launch: "2020-001", raisedAt, step: { beforeEpoch: raisedAt - 2 * DAY_MS, afterEpoch: raisedAt - DAY_MS, deltaKm: -1, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 3, z: 20 }, event: null, evidence: {}, reasons: ["a step"] };
}

interface World {
  places: Places;
  calls: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv | undefined }[];
  tools: DailyTools;
  /** What the stand-in replay raises per year, and whether it fails. */
  replay: { verdicts: Record<number, object[]>; fails: boolean };
  git: (cwd: string, ...args: string[]) => string;
  logged: () => LoggedAlert[];
  lines: () => RunLine[];
  remoteHead: () => string;
}

function worldIn(dir: string): World {
  const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } }).trim();
  const root = join(dir, "root");
  const frozen = join(dir, "frozen");
  const branch = join(dir, "branch");
  const remote = join(dir, "remote.git");
  const archive = join(dir, "archive");
  // The repository and its tag; the frozen worktree at the tag, its installed packages ignored as a checkout's are.
  mkdirSync(root);
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, ".gitignore"), "node_modules/\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "The frozen detector");
  git(root, "tag", FROZEN_TAG);
  git(root, "worktree", "add", "-q", "--detach", frozen, FROZEN_TAG);
  for (const name of PINNED) {
    mkdirSync(join(frozen, "node_modules", name), { recursive: true });
    writeFileSync(join(frozen, "node_modules", name, "package.json"), JSON.stringify({ name, version: "1.2.3" }));
  }
  // The prospective branch, pushed to its remote.
  git(dir, "init", "-q", "--bare", remote);
  mkdirSync(branch);
  git(branch, "init", "-q", "-b", "prospective");
  writeFileSync(join(branch, "alerts.jsonl"), "");
  writeFileSync(join(branch, "runs.jsonl"), "");
  git(branch, "add", "-A");
  git(branch, "commit", "-q", "-m", "The log");
  git(branch, "remote", "add", "origin", remote);
  git(branch, "push", "-q", "-u", "origin", "prospective");
  // The Archive: the two years' manifests and body tables, today's satellite catalogue, the payload catalogue, and the states the frozen detector ended 2025 with.
  for (const [year, through] of [[2026, "2026-12-31"], [2027, "2027-01-02"]] as const) {
    mkdirSync(join(archive, String(year)), { recursive: true });
    writeFileSync(join(archive, String(year), "manifest.json"), JSON.stringify({ format: 1, year, source: { kind: "history", from: `${year}-01-01`, through, missing: [] } }));
    writeFileSync(join(archive, String(year), "bodies.json"), JSON.stringify([{ number: 7, first: 0, count: 1, designator: "2020-001A", name: "SEVEN", bodyClass: "payload", launch: "2020-01-01", decay: null }]));
  }
  mkdirSync(join(archive, "satcat"), { recursive: true });
  writeFileSync(join(archive, "satcat", `${TODAY}.csv`), "OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,LAUNCH_DATE,DECAY_DATE,OPS_STATUS_CODE\nSEVEN,2020-001A,7,PAYLOAD,2020-01-01,,D\n");
  mkdirSync(join(archive, "gcat"), { recursive: true });
  writeFileSync(join(archive, "gcat", "psatcat-2026-12-01.tsv"), "#JCAT\tPiece\tName\tTDate\n");
  const places: Places = { root, frozen, branch, archive, home: join(archive, "prospective"), view: join(archive, "prospective", "view"), states: join(archive, "prospective", "states") };
  mkdirSync(places.states, { recursive: true });
  writeFileSync(join(places.states, "2025.json.gz"), gzipSync("the states at the end of 2025"));

  const calls: World["calls"] = [];
  const replay: World["replay"] = { verdicts: {}, fails: false };
  const run: DailyTools["run"] = (command, args, cwd, env) => {
    calls.push({ command, args, cwd, env });
    if (command === "git") {
      const result = spawnSync("git", args, { cwd, env: { ...process.env, ...GIT_ENV } });
      if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
      return;
    }
    if (args[2] !== "kpi") return;
    if (replay.fails) throw new Error("npm run -s kpi exited with 1");
    // What the frozen runner writes under its out directory: each year's file, and its end states.
    const out = args[args.indexOf("--out") + 1]!;
    const years = args.flatMap((arg, i) => (args[i - 1] === "--year" ? [Number(arg)] : []));
    for (const year of years) {
      mkdirSync(join(out, "years"), { recursive: true });
      mkdirSync(join(out, "work", "states"), { recursive: true });
      writeFileSync(join(out, "years", `${year}.json.gz`), gzipSync(JSON.stringify({ year, carried: true, detector: { name: FROZEN_DETECTOR }, sets: 1000 + year, runs: 10, verdicts: replay.verdicts[year] ?? [] })));
      writeFileSync(join(out, "work", "states", `${year}.json.gz`), gzipSync(`the states at the end of ${year}`));
    }
  };
  const remoteHead = (): string => git(remote, "rev-parse", "refs/heads/prospective");
  return {
    places,
    calls,
    tools: { run, frozenCommit: git(root, "rev-parse", `${FROZEN_TAG}^{commit}`) },
    replay,
    git,
    logged: () => parseJsonl<LoggedAlert>(git(remote, "show", "prospective:alerts.jsonl")),
    lines: () => parseJsonl<RunLine>(git(remote, "show", "prospective:runs.jsonl")),
    remoteHead,
  };
}

/** Every day of 2026 kept for good, as a settled year's history is. */
function settle(archive: string, year: number, except: string[] = []): void {
  for (let at = Date.UTC(year, 0, 1); at < Date.UTC(year + 1, 0, 1); at += DAY_MS) {
    const day = new Date(at).toISOString().slice(0, 10);
    if (!except.includes(day)) keepDay(join(archive, "history", String(year), `${day}.json.gz`), [{ NORAD_CAT_ID: "7" }], at + 5 * DAY_MS);
  }
}

describe("the daily run", { timeout: 30_000 }, () => {
  let dir: string;
  let world: World;
  beforeEach(() => {
    for (const [name, value] of Object.entries(GIT_ENV)) vi.stubEnv(name, value);
    vi.stubEnv("SPACETRACK_USER", "someone");
    vi.stubEnv("SPACETRACK_PASSWORD", "secret");
    for (const name of ["GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_RUN_ID"]) vi.stubEnv(name, "");
    dir = mkdtempSync(join(tmpdir(), "breakups-daily-"));
    world = worldIn(dir);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  test("replays both years in the frozen worktree on the test's view, logs the alerts raised after the freeze, and pushes the line of the run", () => {
    const freeze = Date.parse("2026-10-11T00:00:00Z");
    world.replay.verdicts = { 2026: [verdict(7, freeze - DAY_MS), verdict(7, freeze + 30 * DAY_MS)], 2027: [verdict(8, STARTED - DAY_MS)] };
    const before = world.remoteHead();
    const { line, commit, fresh } = daily(world.places, STARTED, world.tools);
    // The commands, in order: no satellite catalogue fetched (today's is kept), the weather, both years' pulls, the frozen index and replay.
    expect(world.calls.map((c) => [c.command, ...c.args].join(" "))).toEqual([
      "git pull -q --ff-only",
      "npm run -s archive:space -- 2026 2027",
      "npm run -s archive:pull -- 2026 --through 2026-12-31",
      "npm run -s archive:pull -- 2027",
      "npm run -s kpi:index",
      `npm run -s kpi -- --year 2026 --year 2027 --out ${join(world.places.home, TODAY)} --from-states ${world.places.states}`,
    ]);
    for (const call of world.calls.slice(-2)) {
      expect(call.cwd).toBe(world.places.frozen);
      expect(call.env?.["BREAKUPS_ARCHIVE"]).toBe(world.places.view);
      expect(Object.keys(call.env ?? {}).filter((name) => name.startsWith("SPACETRACK_"))).toEqual([]);
    }
    expect(readdirSync(world.places.view)).toEqual(expect.arrayContaining(["2026", "2027", "satcat", "gcat"]));
    // The body tables carry today's status.
    expect(JSON.parse(readFileSync(join(world.places.archive, "2027", "bodies.json"), "utf8"))[0]).toMatchObject({ number: 7, opsStatus: "D" });
    // Two alerts after the freeze, none before; pushed with the line.
    expect(fresh.map((a) => [a.number, a.year])).toEqual([[7, 2026], [8, 2027]]);
    expect(world.remoteHead()).toBe(commit);
    expect(commit).not.toBe(before);
    expect(world.logged().map((a) => [a.number, a.loggedOn, a.frozen, a.detector])).toEqual([[7, TODAY, world.tools.frozenCommit, FROZEN_DETECTOR], [8, TODAY, world.tools.frozenCommit, FROZEN_DETECTOR]]);
    expect(world.lines()).toEqual([line]);
    expect(line).toMatchObject({ date: TODAY, frozen: world.tools.frozenCommit, detector: FROZEN_DETECTOR, setsReplayed: 3026 + 3027, alertsFound: 2, newAlerts: 2, requests: 0, satcat: TODAY, runUrl: null });
    expect(line.years).toEqual([{ year: 2026, through: "2026-12-31", sets: 3026, runs: 10, carried: true }, { year: 2027, through: "2027-01-02", sets: 3027, runs: 10, carried: true }]);
    expect(line.versions).toEqual(Object.fromEntries(PINNED.map((name) => [name, "1.2.3"])));
    expect(world.git(world.places.branch, "log", "-1", "--format=%s")).toBe(`Alerts of ${TODAY}`);
  });

  test("a second run logs no alert twice, and still commits its line", () => {
    world.replay.verdicts = { 2027: [verdict(8, STARTED - DAY_MS)] };
    daily(world.places, STARTED, world.tools);
    const again = daily(world.places, STARTED + 3_600_000, world.tools);
    expect(again.fresh).toEqual([]);
    expect(again.line).toMatchObject({ alertsFound: 1, newAlerts: 0 });
    expect(world.logged()).toHaveLength(1);
    expect(world.lines()).toHaveLength(2);
  });

  test("a settled year hands its end states to the next, with their provenance, after the commit; a year with a day still to pull does not", () => {
    settle(world.places.archive, 2026, ["2026-12-30"]);
    daily(world.places, STARTED, world.tools);
    expect(existsSync(join(world.places.states, "2026.json.gz"))).toBe(false);
    settle(world.places.archive, 2026);
    const { commit } = daily(world.places, STARTED + 3_600_000, world.tools);
    expect(readFileSync(join(world.places.states, "2026.json.gz"))).toEqual(gzipSync("the states at the end of 2026"));
    const provenance = readFileSync(join(world.places.states, "2026.provenance.txt"), "utf8");
    expect(provenance).toContain(`the frozen commit ${world.tools.frozenCommit} replayed 2026 through 2026-12-31`);
    expect(provenance).toMatch(/sha256 [0-9a-f]{64}\.\n$/);
    expect(world.remoteHead()).toBe(commit);
    // The next run replays 2027 alone, from them.
    world.calls.length = 0;
    daily(world.places, STARTED + 2 * 3_600_000, world.tools);
    expect(world.calls.at(-1)!.args).toEqual(["run", "-s", "kpi", "--", "--year", "2027", "--out", join(world.places.home, TODAY), "--from-states", world.places.states]);
  });

  test("a replay that fails commits nothing and hands no states on", () => {
    settle(world.places.archive, 2026);
    world.replay.fails = true;
    const before = world.remoteHead();
    expect(() => daily(world.places, STARTED, world.tools)).toThrow(/kpi exited with 1/);
    expect(world.remoteHead()).toBe(before);
    expect(readFileSync(join(world.places.branch, "alerts.jsonl"), "utf8")).toBe("");
    expect(existsSync(join(world.places.states, "2026.json.gz"))).toBe(false);
  });

  test("a commit that fails puts the branch's files back as they were", () => {
    world.replay.verdicts = { 2027: [verdict(8, STARTED - DAY_MS)] };
    const hook = join(world.places.branch, ".git", "hooks", "pre-commit");
    mkdirSync(dirname(hook), { recursive: true });
    writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    expect(() => daily(world.places, STARTED, world.tools)).toThrow();
    expect(readFileSync(join(world.places.branch, "alerts.jsonl"), "utf8")).toBe("");
    expect(readFileSync(join(world.places.branch, "runs.jsonl"), "utf8")).toBe("");
    expect(world.git(world.places.branch, "status", "--porcelain")).toBe("");
  });

  test("refuses a tag moved off the frozen commit, before any command", () => {
    expect(() => daily(world.places, STARTED, { ...world.tools, frozenCommit: "0".repeat(40) })).toThrow(/a moved tag is not the frozen detector/);
    expect(world.calls).toEqual([]);
  });

  test("refuses a frozen worktree with changes, or one moved off the tag", () => {
    writeFileSync(join(world.places.frozen, "patched.ts"), "");
    expect(() => daily(world.places, STARTED, world.tools)).toThrow(/has changes: it must be the tag as committed/);
    rmSync(join(world.places.frozen, "patched.ts"));
    world.git(world.places.frozen, "commit", "-q", "--allow-empty", "-m", "a change");
    expect(() => daily(world.places, STARTED, world.tools)).toThrow(/is at [0-9a-f]+, not at frozen-confirmed-v10/);
    expect(world.calls).toEqual([]);
  });

  test("refuses a branch worktree on another branch or with changes", () => {
    writeFileSync(join(world.places.branch, "alerts.jsonl"), "{}\n");
    expect(() => daily(world.places, STARTED, world.tools)).toThrow(/has changes: commit or remove them first/);
    world.git(world.places.branch, "checkout", "-q", "--", "alerts.jsonl");
    world.git(world.places.branch, "switch", "-q", "-c", "elsewhere");
    expect(() => daily(world.places, STARTED, world.tools)).toThrow(/is not on the prospective branch/);
    expect(world.calls).toEqual([]);
  });

  test("refuses to start a year with no states to start it from", () => {
    rmSync(join(world.places.states, "2025.json.gz"));
    expect(() => daily(world.places, STARTED, world.tools)).toThrow(/no frozen states to start 2026 from/);
  });
});
