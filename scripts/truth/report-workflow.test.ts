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

  test("may write the issue, and nothing else: it starts no workflow, so it never displaces a run waiting in the prospective group", () => {
    expect(report.permissions).toEqual({ contents: "read", issues: "write" });
    for (const step of accept.steps) expect(step.run ?? "").not.toContain("gh workflow run");
  });

  test("checks who applied the label before it adds anything, and adds only what it accepted", () => {
    const check = indexOf(accept.steps, "Check who accepted it");
    const add = indexOf(accept.steps, "Check the statement against the hand file and the truth");
    const commit = indexOf(accept.steps, "Say it is accepted and close the issue");
    expect(accept.steps[check]!.run).toContain("npm run -s truth:report -- check");
    expect(check).toBeLessThan(add);
    expect(add).toBeLessThan(commit);
    for (const step of [accept.steps[add]!, accept.steps[commit]!]) expect(step.if).toBe("steps.check.outputs.accepted == 'true'");
    expect(accept.steps[add]!.run).toContain("npm run -s truth:add -- --form");
  });

  test("checks out main without leaving the token in the checkout before it installs anything", () => {
    const checkout = accept.steps[indexOf(accept.steps, "Check out main")]! as Step & { with?: Record<string, unknown> };
    expect(checkout.with?.["persist-credentials"]).toBe(false);
    expect(indexOf(accept.steps, "Check out main")).toBeLessThan(indexOf(accept.steps, "Install the dependencies"));
  });

  test("passes the repository's owner to the check, which accepts the owner's label alone", () => {
    const check = accept.steps[indexOf(accept.steps, "Check who accepted it")]!;
    expect(check.env?.["OWNER"]).toBe("${{ github.repository_owner }}");
  });

  test("never puts the issue's text into a shell command", () => {
    for (const step of accept.steps) {
      expect(step.run ?? "").not.toMatch(/\$\{\{\s*github\.event\./);
      for (const value of Object.values(step.env ?? {})) expect(value).not.toMatch(/github\.event\.(?:issue|comment|label)/);
    }
  });

  test("writes no branch: the statement is read again from the issue by the maintenance run", () => {
    for (const step of accept.steps) expect(step.run ?? "").not.toMatch(/git (?:push|commit|switch)/);
    expect(report.permissions["contents"]).toBe("read");
  });
});

describe("the maintenance workflow's accepted reports", () => {
  const maintenance = read("maintenance.yml");
  const steps = maintenance.jobs["maintain"]!.steps;

  test("are read again from the accepted issues, the owner's label and the form, never from a branch", () => {
    const fold = steps[indexOf(steps, "Fold in a branch")]!.run!;
    expect(fold.indexOf("report/*)")).toBeLessThan(fold.indexOf("git merge"));
    const add = steps[indexOf(steps, "Add the statements of the accepted reports")]!;
    expect(add.run!.indexOf('npm run -s truth:report -- accepted "$RUNNER_TEMP/accepted.json"')).toBeLessThan(add.run!.indexOf('npm run -s truth:add -- --missing-from "$RUNNER_TEMP/accepted.json"'));
    expect(add.env).toMatchObject({ GH_TOKEN: "${{ github.token }}", OWNER: "${{ github.repository_owner }}" });
    for (const step of steps) expect(step.run ?? "").not.toMatch(/git show "?origin\/\$ref/);
  });

  test("are added after the dependencies are installed and before the truth is rebuilt, whatever started the run", () => {
    const add = indexOf(steps, "Add the statements of the accepted reports");
    expect(steps[add]!.if).toBeUndefined();
    expect(indexOf(steps, "Install the dependencies on the scoring pins")).toBeLessThan(add);
    expect(add).toBeLessThan(indexOf(steps, "Fetch the machine-readable sources and rebuild the truth"));
  });

  test("leave no branch: the report branches of the old way are deleted unread", () => {
    expect(steps[indexOf(steps, "Add the statements of the accepted reports")]!.run).toContain("--delete");
    expect(steps[indexOf(steps, "Open the pull request and merge it")]!.run).not.toContain("report-branches.txt");
  });
});
