import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

/**
 * The breakup-report workflow and the maintenance workflow's part in it,
 * read as GitHub reads them: what starts the acceptance, that it checks
 * who accepted before it writes anything, that the issue's text never
 * reaches a shell command, and that every accepted report is folded in by
 * its statements, before the truth is rebuilt.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface Step {
  id?: string;
  name?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
}

interface Workflow {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, { if?: string; steps: Step[] }>;
}

const read = (name: string): Workflow => parse(readFileSync(resolve(ROOT, ".github/workflows", name), "utf8")) as Workflow;
const report = read("breakup-report.yml");
const accept = report.jobs["accept"]!;
const indexOf = (steps: Step[], name: string): number => {
  const index = steps.findIndex((step) => step.name === name);
  if (index === -1) throw new Error(`no step ${name}`);
  return index;
};

describe("the breakup-report workflow", () => {
  test("starts when an issue is labelled, and acts only on the accepting label", () => {
    expect(report.on).toEqual({ issues: { types: ["labeled"] } });
    expect(accept.if).toBe("github.event.label.name == 'breakup-report-accepted'");
  });

  test("may write a branch, the issue and a run of another workflow, and nothing else", () => {
    expect(report.permissions).toEqual({ contents: "write", issues: "write", actions: "write" });
  });

  test("checks who applied the label before it adds anything, and adds only what it accepted", () => {
    const check = indexOf(accept.steps, "Check who accepted it");
    const add = indexOf(accept.steps, "Add the statement and rebuild the truth");
    const commit = indexOf(accept.steps, "Commit it to a branch and fold it in with the maintenance workflow");
    expect(accept.steps[check]!.run).toContain("npm run -s truth:report -- check");
    expect(check).toBeLessThan(add);
    expect(add).toBeLessThan(commit);
    for (const step of [accept.steps[add]!, accept.steps[commit]!]) expect(step.if).toBe("steps.check.outputs.accepted == 'true'");
    expect(accept.steps[add]!.run).toContain("npm run -s truth:add -- --form");
  });

  test("never puts the issue's text into a shell command", () => {
    for (const step of accept.steps) {
      expect(step.run ?? "").not.toMatch(/\$\{\{\s*github\.event\./);
      for (const value of Object.values(step.env ?? {})) expect(value).not.toMatch(/github\.event\.(?:issue|comment|label)/);
    }
  });

  test("commits to the issue's branch and runs the maintenance workflow from it", () => {
    const run = accept.steps[indexOf(accept.steps, "Commit it to a branch and fold it in with the maintenance workflow")]!.run!;
    expect(run).toContain('git switch -q -c "$BRANCH"');
    expect(run).toContain("git add data/truth/hand.json data/breakups.json docs/truth.md");
    expect(run).toContain('gh workflow run maintenance.yml --ref main -f from="$BRANCH"');
  });
});

describe("the maintenance workflow's accepted reports", () => {
  const maintenance = read("maintenance.yml");
  const steps = maintenance.jobs["maintain"]!.steps;

  test("are folded in by their statements, never merged as a branch", () => {
    const fold = steps[indexOf(steps, "Fold in a branch")]!.run!;
    expect(fold.indexOf("report/*)")).toBeLessThan(fold.indexOf("git merge"));
    const add = steps[indexOf(steps, "Add the statements of the accepted reports")]!.run!;
    expect(add).toContain("npm run -s truth:add -- --missing-from");
  });

  test("are added after the dependencies are installed and before the truth is rebuilt, whatever started the run", () => {
    const add = indexOf(steps, "Add the statements of the accepted reports");
    expect(steps[add]!.if).toBeUndefined();
    expect(indexOf(steps, "Install the dependencies on the scoring pins")).toBeLessThan(add);
    expect(add).toBeLessThan(indexOf(steps, "Fetch the machine-readable sources and rebuild the truth"));
  });

  test("lose their branches once main holds them", () => {
    const merge = steps[indexOf(steps, "Open the pull request and merge it")]!.run!;
    expect(merge.indexOf("report-branches.txt")).toBeGreaterThan(merge.indexOf("gh pr merge"));
  });
});
