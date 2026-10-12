import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

/**
 * The KPI workflow's filter on a pull request, read as GitHub reads it: a
 * change replays the years unless every file it touches is one the replay
 * cannot read, and each pattern is matched in order, the last match
 * deciding.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface Workflow {
  on: { push?: unknown; pull_request?: { paths?: string[] }; schedule?: unknown; workflow_dispatch?: unknown };
}

const workflow = parse(readFileSync(resolve(ROOT, ".github/workflows/kpi.yml"), "utf8")) as Workflow;

/** A pattern of GitHub's filter as a regular expression: `*` stops at a slash, `**` does not, and a `**` before a slash matches no directory too. */
function toRegExp(pattern: string): RegExp {
  if (/[[\]+?]/.test(pattern)) throw new Error(`the test's matcher does not read ${pattern}`);
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (pattern.startsWith("**/", i)) {
      source += "(?:.*/)?";
      i += 2;
    } else if (pattern.startsWith("**", i)) {
      source += ".*";
      i += 1;
    } else if (char === "*") source += "[^/]*";
    else source += char.replace(/[.^$|(){}\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

/** Whether a changed file starts the workflow: the last pattern matching it decides, a `!` one leaving it out. */
function replays(paths: readonly string[], file: string): boolean {
  let included = false;
  for (const pattern of paths) {
    const negated = pattern.startsWith("!");
    if (toRegExp(negated ? pattern.slice(1) : pattern).test(file)) included = !negated;
  }
  return included;
}

describe("the test's matcher", () => {
  test("reads a pattern as GitHub's cheat sheet does", () => {
    expect(toRegExp("*.md").test("README.md")).toBe(true);
    expect(toRegExp("*.md").test("docs/README.md")).toBe(false);
    expect(toRegExp("**/*.md").test("README.md")).toBe(true);
    expect(toRegExp("**/*.md").test("docs/decisions/0004.md")).toBe(true);
    expect(toRegExp("docs/**").test("docs/decisions/0004.md")).toBe(true);
    expect(toRegExp("docs/**").test("docsite/index.html")).toBe(false);
    expect(toRegExp("**").test(".github/workflows/kpi.yml")).toBe(true);
  });

  test("lets the last matching pattern decide", () => {
    expect(replays(["**", "!**/*.md", "kpi/latest.md"], "kpi/latest.md")).toBe(true);
    expect(replays(["**", "!**/*.md", "kpi/latest.md"], "README.md")).toBe(false);
    expect(replays(["kpi/latest.md", "!**/*.md"], "kpi/latest.md")).toBe(false);
  });
});

describe("the KPI workflow on a pull request", () => {
  const paths = workflow.on.pull_request?.paths ?? [];

  test("starts from every path, so a file nobody listed still replays the years", () => {
    expect(paths[0]).toBe("**");
    expect(replays(paths, "a-file-nobody-thought-of.ts")).toBe(true);
  });

  // One file for each thing the replay or its reproducibility step reads.
  test.each([
    "src/detector.ts",
    "scripts/kpi/run.ts",
    "scripts/archive/release.ts",
    "scripts/pins/pins.ts",
    "scripts/truth/parse-gcat.ts",
    "data/breakups.json",
    "data/truth/hand.json",
    "data/truth/sources/gcat-debriscat.html",
    "package.json",
    "package-lock.json",
    "pins.json",
    "kpi/latest.json",
    "kpi/latest.md",
    ".github/workflows/kpi.yml",
  ])("replays the years for a change to %s, which can move the score", (file) => {
    expect(replays(paths, file)).toBe(true);
  });

  test.each(["README.md", "CHANGELOG.md", "docs/decisions/0004-the-scorecard-replays-the-detector-and-ci-must-reproduce-its-number.md", "docs/detector/events.md", "LICENSE", "test/kpi.test.ts", "scripts/kpi/rank.test.ts", ".github/workflows/ci.yml"])(
    "leaves the years alone for a change to %s alone, which cannot",
    (file) => {
      expect(replays(paths, file)).toBe(false);
    },
  );

  test("leaves a push to main, the Monday schedule and a run by hand unfiltered", () => {
    expect(workflow.on.push).toEqual({ branches: ["main"] });
    expect(workflow.on.schedule).toEqual([{ cron: "0 6 * * 1" }]);
    expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "push", "schedule", "workflow_dispatch"]);
    expect(workflow.on.workflow_dispatch).toBeNull();
  });
});
