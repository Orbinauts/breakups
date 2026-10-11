import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

/**
 * The one Pages workflow, read as GitHub reads it: what starts it, which
 * job holds the deploy's concurrency group, what each job may do, and that
 * a missing `published` branch leaves the reference to deploy alone.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface Step {
  id?: string;
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface Job {
  needs?: string;
  permissions?: Record<string, string>;
  concurrency?: { group: string; "cancel-in-progress": boolean };
  environment?: { name: string };
  steps: Step[];
}

interface Workflow {
  on: Record<string, unknown>;
  concurrency?: unknown;
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
}

const workflow = parse(readFileSync(resolve(ROOT, ".github/workflows/docs.yml"), "utf8")) as Workflow;
const build = workflow.jobs["build"]!;
const deploy = workflow.jobs["deploy"]!;

describe("the Pages workflow", () => {
  test("runs on a push to main, by hand, and when the daily job calls it", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["push", "workflow_call", "workflow_dispatch"]);
    expect(workflow.on["push"]).toEqual({ branches: ["main"] });
  });

  test("holds a concurrency group on the deploy job alone, so a caller never waits on itself", () => {
    expect(workflow.concurrency).toBeUndefined();
    expect(build.concurrency).toBeUndefined();
    expect(deploy.concurrency).toEqual({ group: "pages", "cancel-in-progress": false });
  });

  test("lets only the deploy job write to Pages, with its OIDC token", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(build.permissions).toBeUndefined();
    expect(deploy.needs).toBe("build");
    expect(deploy.permissions).toEqual({ pages: "write", "id-token": "write" });
    expect(deploy.environment?.name).toBe("github-pages");
  });

  test("checks out the published branch only when it exists, and uploads the tree assembled from both", () => {
    const exists = build.steps.find((step) => step.run?.includes("git ls-remote") === true);
    expect(exists?.id).toBeDefined();
    const checkout = build.steps.find((step) => step.with?.["ref"] === "published");
    expect(checkout?.uses).toMatch(/^actions\/checkout@/);
    expect(checkout?.if).toBe(`steps.${exists!.id}.outputs.exists == 'true'`);
    expect(checkout?.with?.["path"]).toBe("published");
    const site = build.steps.find((step) => step.run?.includes("npm run pages:site") === true);
    expect(site?.if).toBeUndefined();
    expect(site?.run).toContain("--reference reference --published published --out site");
    const upload = build.steps.find((step) => step.uses?.startsWith("actions/upload-pages-artifact@") === true);
    expect(upload?.with?.["path"]).toBe("site");
    const order = [exists, checkout, site, upload].map((step) => build.steps.indexOf(step!));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  describe("its check for the published branch, run against a stand-in git", () => {
    const check = build.steps.find((step) => step.run?.includes("git ls-remote") === true)!;
    /** Runs the step's script with a `git` that prints `stdout` and exits `status`; returns the exit status and what it wrote to `$GITHUB_OUTPUT`. */
    function runCheck(stdout: string, status: number): { status: number | null; output: string } {
      const dir = mkdtempSync(join(tmpdir(), "pages-check-"));
      try {
        mkdirSync(join(dir, "bin"));
        writeFileSync(join(dir, "bin", "git"), `#!/bin/sh\nprintf '%s' '${stdout}'\nexit ${status}\n`, { mode: 0o755 });
        const output = join(dir, "output");
        writeFileSync(output, "");
        const run = spawnSync("bash", ["-e", "-c", check.run!], { env: { PATH: `${join(dir, "bin")}:${process.env["PATH"]}`, GITHUB_OUTPUT: output }, encoding: "utf8" });
        return { status: run.status, output: readFileSync(output, "utf8") };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    test("says the branch exists when the remote lists it", () => {
      expect(runCheck("abc123\trefs/heads/published\n", 0)).toEqual({ status: 0, output: "exists=true\n" });
    });

    test("says it does not when the remote lists no such branch", () => {
      expect(runCheck("", 0)).toEqual({ status: 0, output: "exists=false\n" });
    });

    test("fails the run when the lookup itself fails, rather than deploying a site with no v1/", () => {
      const failed = runCheck("", 128);
      expect(failed.status).not.toBe(0);
      expect(failed.output).toBe("");
    });
  });

  test("pins every action by its commit", () => {
    const uses = Object.values(workflow.jobs).flatMap((job) => job.steps.flatMap((step) => (step.uses === undefined ? [] : [step.uses])));
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
  });
});

interface CallingJob extends Partial<Job> {
  if?: string;
  uses?: string;
  outputs?: Record<string, string>;
}

const prospective = parse(readFileSync(resolve(ROOT, ".github/workflows/prospective.yml"), "utf8")) as Omit<Workflow, "jobs" | "concurrency"> & {
  concurrency: { group: string; "cancel-in-progress": boolean };
  env: Record<string, string>;
  jobs: Record<string, CallingJob>;
};
const daily = prospective.jobs["daily"] as CallingJob & Job;
const running = (pattern: RegExp): Step => {
  const found = daily.steps.find((step) => pattern.test(step.run ?? ""));
  if (found === undefined) throw new Error(`no step of the daily job runs ${pattern}`);
  return found;
};

describe("the daily job's publishing", () => {
  const replay = running(/^\s*npm run prospective$/m);
  const upload = running(/prospective:data -- upload/);
  const issues = running(/maintenance:alert-issues/);
  const exists = running(/git -C "\$BREAKUPS_PROSPECTIVE" ls-remote --heads origin refs\/heads\/published/);
  const checkout = daily.steps.find((step) => step.with?.["ref"] === "published")!;
  const publish = running(/npm run -s published:daily/);
  const publishing = [exists, checkout, publish];

  test("comes after the replay's log, its data and its issues, and runs whenever the replay succeeded", () => {
    expect(replay.id).toBeDefined();
    const order = [replay, upload, issues, ...publishing].map((step) => daily.steps.indexOf(step));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const step of publishing) expect(step.if).toBe(`\${{ !cancelled() && steps.${replay.id}.outcome == 'success' }}`);
    for (const step of [replay, upload, issues]) expect(step.if).toBeUndefined();
  });

  test("fails with a clear message while the published branch does not exist on the remote", () => {
    expect(exists.run).toMatch(/::error::.*published/);
    expect(exists.run).toMatch(/exit 1/);
  });

  test("checks out the published branch whole, with the credentials to push it, where the publishing reads it", () => {
    expect(checkout.uses).toMatch(/^actions\/checkout@/);
    expect(checkout.with).toEqual({ ref: "published", path: "published", "fetch-depth": 0 });
    expect(prospective.env["BREAKUPS_PUBLISHED"]).toBe("${{ github.workspace }}/published");
  });

  test("commits as the Actions bot, and says it pushed for the deploy to follow", () => {
    expect(publish.run).toContain('git -C "$BREAKUPS_PUBLISHED" config user.name "github-actions[bot]"');
    expect(publish.run).toContain('git -C "$BREAKUPS_PUBLISHED" config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
    expect(publish.run).toMatch(/npm run -s published:daily\n\s*echo "pushed=true" >> "\$GITHUB_OUTPUT"/);
    expect(daily.outputs).toEqual({ published: `\${{ steps.${publish.id}.outputs.pushed }}` });
  });

  test("then calls the Pages workflow from main only, with the deploy's permissions and no concurrency group of its own", () => {
    const pages = prospective.jobs["pages"]!;
    expect(pages.needs).toBe("daily");
    expect(pages.uses).toBe("./.github/workflows/docs.yml");
    expect(pages.if).toBe("${{ !cancelled() && needs.daily.outputs.published == 'true' && github.ref == 'refs/heads/main' }}");
    expect(pages.permissions).toEqual({ contents: "read", pages: "write", "id-token": "write" });
    expect(pages.concurrency).toBeUndefined();
    // The caller's run holds its workflow-level group while it waits on the deploy: the deploy's group must be another.
    expect(prospective.concurrency.group).not.toBe(deploy.concurrency!.group);
  });

  test("pins every action by its commit", () => {
    const uses = daily.steps.flatMap((step) => (step.uses === undefined ? [] : [step.uses]));
    for (const action of uses) expect(action).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
  });
});
