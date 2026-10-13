import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clashes, followMain } from "./moved.ts";

describe("what a main that moved during the run clashes with", () => {
  test("nothing, where it touched only code, tests or documentation the run neither generated nor read", () => {
    expect(clashes(["scripts/kpi/rank.ts", "test/readme.test.ts", "docs/decisions/0004-x.md", ".github/workflows/ci.yml"], ["data/breakups.json", "docs/truth.md", "kpi/latest.json"])).toEqual([]);
  });

  test.each(["data/truth/hand.json", "kpi/latest.json", "README.md", "docs/results.md", "docs/ground-truth.md", "docs/detector/events.md", "docs/truth.md", "package.json", "package-lock.json", "pins.json"])("%s, which the run generates or was made from, wherever the run left it", (file) => {
    expect(clashes([file, "src/index.ts"], [])).toEqual([file]);
  });

  test("a file the run changed, such as one of the branch it folded in", () => {
    expect(clashes(["scripts/truth/parse-gcat.ts", "src/index.ts"], ["scripts/truth/parse-gcat.ts", "data/breakups.json"])).toEqual(["scripts/truth/parse-gcat.ts"]);
  });
});

/** Whoever commits in the test's repositories, with no global configuration: the machine's own (a signing key) is not the run's, and signing every commit outlasts the test's time. */
const IDENTITY = { GIT_AUTHOR_NAME: "bot", GIT_AUTHOR_EMAIL: "bot", GIT_COMMITTER_NAME: "bot", GIT_COMMITTER_EMAIL: "bot", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

describe("following a main that moved, in a repository", { timeout: 60_000 }, () => {
  let dir: string;
  const git = (...args: string[]): string => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...IDENTITY } }).trim();
  const write = (file: string, text: string): void => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  };
  const commit = (message: string, files: Record<string, string>): string => {
    for (const [file, text] of Object.entries(files)) write(file, text);
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  let base: string;
  let message: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "breakups-moved-"));
    // The script under test runs git with the process's environment.
    for (const [name, value] of Object.entries(IDENTITY)) vi.stubEnv(name, value);
    git("init", "-q", "-b", "main");
    base = commit("base", { "src/index.ts": "one\n", "data/breakups.json": "[1]\n", "scripts/rank.ts": "rank\n" });
    message = join(dir, "..", `${dir.split("/").pop()}-message.txt`);
    writeFileSync(message, "Maintenance of today\n\nThe truth moved.\n");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
    rmSync(message, { force: true });
  });

  /** The run's branch from the base: a folded branch's change, then the generated commit. */
  function runBranch(): void {
    git("switch", "-q", "-c", "maintenance/today", base);
    commit("Fold in a branch", { "scripts/rank.ts": "rank, folded\n" });
    commit("Maintenance of today", { "data/breakups.json": "[1, 2]\n" });
  }

  test("says main did not move where it is still the base", () => {
    runBranch();
    const head = git("rev-parse", "HEAD");
    expect(followMain(dir, base, base, message)).toEqual({ decision: "unmoved", main: base });
    expect(git("rev-parse", "HEAD")).toBe(head);
  });

  test("puts the run's whole change, folded branch and generated files, on the moved main as one commit", () => {
    const main = commit("A person's change to the library", { "src/index.ts": "two\n" });
    runBranch();
    expect(followMain(dir, base, main, message)).toEqual({ decision: "rebased", main });
    expect(git("rev-parse", "HEAD^")).toBe(main);
    expect(git("symbolic-ref", "--short", "HEAD")).toBe("maintenance/today");
    expect(git("log", "-1", "--format=%B")).toBe("Maintenance of today\n\nThe truth moved.");
    expect(readFileSync(join(dir, "src/index.ts"), "utf8")).toBe("two\n");
    expect(readFileSync(join(dir, "scripts/rank.ts"), "utf8")).toBe("rank, folded\n");
    expect(readFileSync(join(dir, "data/breakups.json"), "utf8")).toBe("[1, 2]\n");
    expect(git("status", "--porcelain")).toBe("");
  });

  test("leaves the branch as it was where the moved main touched what the run generated", () => {
    const main = commit("A person's change to the truth", { "data/truth/hand.json": "{}\n" });
    runBranch();
    const head = git("rev-parse", "HEAD");
    expect(followMain(dir, base, main, message)).toEqual({ decision: "left", main, clashes: ["data/truth/hand.json"] });
    expect(git("rev-parse", "HEAD")).toBe(head);
  });

  test("as the command the workflow runs: fetches main from the remote, and writes the decision and the pull request's comment", () => {
    const clone = `${dir}-clone`;
    const out = `${dir}-out`;
    try {
      execFileSync("git", ["clone", "-q", dir, clone]);
      const main = commit("A person's change to the truth", { "data/truth/hand.json": "{}\n" });
      const inClone = (...args: string[]): string => execFileSync("git", args, { cwd: clone, encoding: "utf8", env: { ...process.env, ...IDENTITY } }).trim();
      inClone("switch", "-q", "-c", "maintenance/today");
      writeFileSync(join(clone, "data/breakups.json"), "[1, 2]\n");
      inClone("commit", "-q", "-am", "Maintenance of today");
      const script = join(dirname(fileURLToPath(import.meta.url)), "moved.ts");
      execFileSync(process.execPath, ["--experimental-strip-types", script, "--base", base, "--message", message, "--out", out], { cwd: clone, encoding: "utf8", env: { ...process.env, RUN_URL: "https://example.com/run/1" } });
      expect(readFileSync(join(out, "moved.txt"), "utf8")).toBe(`left ${main}\n`);
      const comment = readFileSync(join(out, "moved.md"), "utf8");
      expect(comment).toContain("https://example.com/run/1");
      expect(comment).toContain("- `data/truth/hand.json`");
      expect(comment).toContain("not merged");
    } finally {
      rmSync(clone, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  test("leaves it where the moved main touched a file of the folded branch", () => {
    const main = commit("A person's change to the ranking", { "scripts/rank.ts": "rank, mended\n" });
    runBranch();
    expect(followMain(dir, base, main, message)).toEqual({ decision: "left", main, clashes: ["scripts/rank.ts"] });
  });
});
