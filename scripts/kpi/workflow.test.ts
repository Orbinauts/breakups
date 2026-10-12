import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

interface Step {
  id?: string;
  run?: string;
  env?: Record<string, string>;
}

interface Workflow {
  on: { push?: unknown; pull_request?: { paths?: string[] }; schedule: { cron: string }[]; workflow_dispatch?: unknown };
  concurrency: { group: string; "cancel-in-progress": boolean | string };
  jobs: Record<string, { if?: string; needs?: string; steps: Step[]; permissions?: Record<string, string> }>;
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

  test.each(["README.md", "CHANGELOG.md", "docs/decisions/0004-the-scorecard-replays-the-detector-and-ci-must-reproduce-its-number.md", "docs/detector/events.md", "LICENSE", "test/kpi.test.ts", "scripts/kpi/rank.test.ts", ".github/workflows/ci.yml", ".github/ISSUE_TEMPLATE/breakup-report.yml"])(
    "leaves the years alone for a change to %s alone, which cannot",
    (file) => {
      expect(replays(paths, file)).toBe(false);
    },
  );

  test("leaves a push to main, the Monday schedule and a run by hand unfiltered", () => {
    expect(workflow.on.push).toEqual({ branches: ["main"] });
    expect(workflow.on.schedule).toHaveLength(1);
    expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "push", "schedule", "workflow_dispatch"]);
    expect(workflow.on.workflow_dispatch).toBeNull();
  });
});

describe("the KPI workflow when the Archive's release cannot be reached", () => {
  const reach = workflow.jobs["years"]!.steps.find((step) => step.id === "reach")!;

  /** Runs the step's script with a `curl` that exits `status`, as from a fork's pull request or not; the exit status, the step's output and what it printed. */
  function runReach(status: number, fork: boolean): { status: number | null; output: string; printed: string } {
    const dir = mkdtempSync(join(tmpdir(), "kpi-reach-"));
    try {
      mkdirSync(join(dir, "bin"));
      writeFileSync(join(dir, "bin", "curl"), `#!/bin/sh\nexit ${status}\n`, { mode: 0o755 });
      const output = join(dir, "output");
      writeFileSync(output, "");
      const run = spawnSync("bash", ["-e", "-c", reach.run!], { env: { PATH: `${join(dir, "bin")}:${process.env["PATH"]}`, GITHUB_OUTPUT: output, ARCHIVE_MANIFEST_URL: "https://example.com/manifest.json", FORK: String(fork) }, encoding: "utf8" });
      return { status: run.status, output: readFileSync(output, "utf8"), printed: run.stdout };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("replays where the release answers", () => {
    expect(runReach(0, false)).toMatchObject({ status: 0, output: "reachable=true\n" });
  });

  test("fails the run on main, on schedule, by hand and on the repository's own pull requests: a check that cannot run is not a check passed", () => {
    const failed = runReach(22, false);
    expect(failed.status).not.toBe(0);
    expect(failed.output).toBe("");
    expect(failed.printed).toMatch(/::error::/);
  });

  test("skips the replay with a notice only on a pull request from a fork, which has no release of its own to read", () => {
    const skipped = runReach(22, true);
    expect(skipped).toMatchObject({ status: 0, output: "reachable=false\n" });
    expect(skipped.printed).toMatch(/::notice::/);
  });

  test("knows a fork's pull request from the event, not from the branch's name", () => {
    expect(reach.env?.["FORK"]).toBe("${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository }}");
  });
});

describe("the KPI workflow beside the maintenance run and the prospective test", () => {
  interface Scheduled {
    on: { schedule: { cron: string }[] };
    concurrency: { group: string; "cancel-in-progress": boolean };
    jobs: Record<string, { "timeout-minutes"?: number }>;
  }
  const read = (file: string): Scheduled => parse(readFileSync(resolve(ROOT, ".github/workflows", file), "utf8")) as Scheduled;
  const maintenance = read("maintenance.yml");
  const prospective = read("prospective.yml");

  /** A cron of the form `m h * * d` (or `*` for every day) as the minutes of the week from Sunday 00:00 UTC; every day's where it runs daily. */
  function minutesOfWeek(cron: string): number[] {
    const [minute, hour, dom, month, dow] = cron.split(" ");
    if (dom !== "*" || month !== "*" || !/^\d+$/.test(minute!) || !/^\d+$/.test(hour!)) throw new Error(`the test does not read the cron ${cron}`);
    const days = dow === "*" ? [0, 1, 2, 3, 4, 5, 6] : [Number(dow)];
    return days.map((day) => day * 1440 + Number(hour) * 60 + Number(minute));
  }

  /**
   * GitHub's expressions as the concurrency key uses them, for one event:
   * comparisons of the event's name, `&&`, `||`, `!`, quoted strings and
   * `format('kpi-{0}', github.ref)`.
   */
  function evaluate(value: string | boolean, event: string, ref: string): string | boolean {
    if (typeof value === "boolean") return value;
    const expression = /^\$\{\{(.*)\}\}$/s.exec(value.trim());
    if (expression === null) return value;
    const js = expression[1]!
      .replace(/format\('kpi-\{0\}', github\.ref\)/g, "('kpi-' + ref)")
      .replace(/github\.event_name/g, "event")
      .replace(/github\.ref/g, "ref")
      .replace(/==/g, "===")
      .replace(/!===/g, "!==");
    if (/[^\w\s'()!=&|+-]/.test(js)) throw new Error(`the test does not read ${value}`);
    return new Function("event", "ref", `return (${js});`)(event, ref) as string | boolean;
  }

  test("waits, on its schedule, for the maintenance run and the prospective test, which share one group", () => {
    expect(maintenance.concurrency).toEqual({ group: "prospective", "cancel-in-progress": false });
    expect(prospective.concurrency).toEqual({ group: "prospective", "cancel-in-progress": false });
    expect(evaluate(workflow.concurrency.group, "schedule", "refs/heads/main")).toBe(maintenance.concurrency.group);
    expect(evaluate(workflow.concurrency["cancel-in-progress"], "schedule", "refs/heads/main")).toBe(false);
  });

  test("never cancels a run of that group, whatever started it", () => {
    for (const [event, ref] of [["push", "refs/heads/main"], ["pull_request", "refs/pull/7/merge"], ["schedule", "refs/heads/main"], ["workflow_dispatch", "refs/heads/main"]] as const) {
      if (evaluate(workflow.concurrency.group, event, ref) === "prospective") expect(evaluate(workflow.concurrency["cancel-in-progress"], event, ref)).toBe(false);
    }
  });

  test("keeps a group of its own otherwise, where a newer run supersedes an older one and never displaces a daily run waiting in the shared group", () => {
    expect(evaluate(workflow.concurrency.group, "workflow_dispatch", "refs/heads/main")).toBe("kpi-refs/heads/main");
    expect(evaluate(workflow.concurrency.group, "pull_request", "refs/pull/7/merge")).toBe("kpi-refs/pull/7/merge");
    expect(evaluate(workflow.concurrency["cancel-in-progress"], "pull_request", "refs/pull/7/merge")).toBe(true);
    expect(evaluate(workflow.concurrency.group, "push", "refs/heads/main")).toBe("kpi-refs/heads/main");
    expect(evaluate(workflow.concurrency["cancel-in-progress"], "push", "refs/heads/main")).toBe(true);
  });

  test("is scheduled after the maintenance run's longest window, even one that waited for the daily test, and off the hour", () => {
    const [kpi] = minutesOfWeek(workflow.on.schedule[0]!.cron);
    const [maintained] = minutesOfWeek(maintenance.on.schedule[0]!.cron);
    const daily = minutesOfWeek(prospective.on.schedule[0]!.cron);
    const dailyTimeout = prospective.jobs["daily"]!["timeout-minutes"]!;
    const maintenanceTimeout = maintenance.jobs["maintain"]!["timeout-minutes"]!;
    // The latest the maintenance run can start: its own time, or the end of a daily run that started before it.
    const started = Math.max(maintained!, ...daily.filter((at) => at <= maintained! && at + dailyTimeout > maintained!).map((at) => at + dailyTimeout));
    expect(kpi!).toBeGreaterThan(started + maintenanceTimeout);
    expect(kpi! % 60).not.toBe(0);
    // And not in the daily test's own window, nor the next one's.
    for (const at of daily) expect(kpi! >= at && kpi! < at + dailyTimeout).toBe(false);
  });
});
