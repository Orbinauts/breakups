import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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

  test("pins every action by its commit", () => {
    const uses = Object.values(workflow.jobs).flatMap((job) => job.steps.flatMap((step) => (step.uses === undefined ? [] : [step.uses])));
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
  });
});
