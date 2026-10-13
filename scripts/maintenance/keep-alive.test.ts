import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { toReenable, type WorkflowState } from "./keep-alive.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const workflow = (path: string, state: string): WorkflowState => ({ id: path.length, name: path, path: `.github/workflows/${path}`, state });

describe("the keep-alive", () => {
  test("re-enables a workflow GitHub disabled for the repository's inactivity", () => {
    expect(toReenable([workflow("prospective.yml", "disabled_inactivity"), workflow("kpi.yml", "active")]).map((w) => w.path)).toEqual([".github/workflows/prospective.yml"]);
  });

  test("never one a person disabled, nor one disabled on a fork, nor a deleted one", () => {
    expect(toReenable([workflow("prospective.yml", "disabled_manually"), workflow("kpi.yml", "disabled_fork"), workflow("old.yml", "deleted"), workflow("ci.yml", "active")])).toEqual([]);
  });
});

describe("the scheduled workflows", () => {
  interface Step {
    if?: string;
    run?: string;
  }
  interface Read {
    on: Record<string, unknown>;
    permissions?: Record<string, string>;
    jobs: Record<string, { if?: string; permissions?: Record<string, string>; steps?: Step[] }>;
  }
  const scheduled = ["prospective.yml", "maintenance.yml", "kpi.yml"];
  const read = (file: string): Read => parse(readFileSync(resolve(ROOT, ".github/workflows", file), "utf8")) as Read;

  test("are the three that run on a schedule", () => {
    const all = ["ci.yml", "docs.yml", "kpi.yml", "maintenance.yml", "prospective.yml", "publish.yml"];
    expect(all.filter((file) => read(file).on["schedule"] !== undefined).sort()).toEqual([...scheduled].sort());
  });

  test.each(scheduled)("%s keeps the others alive on its scheduled runs, with leave to enable a workflow, whatever its other steps did", (file) => {
    const jobs = Object.values(read(file).jobs);
    const keeping = jobs.filter((job) => job.steps?.some((step) => /npm run -s maintenance:keep-alive/.test(step.run ?? "")) === true);
    expect(keeping).toHaveLength(1);
    const job = keeping[0]!;
    expect({ ...read(file).permissions, ...job.permissions }["actions"]).toBe("write");
    const step = job.steps!.find((s) => /maintenance:keep-alive/.test(s.run ?? ""))!;
    const condition = `${job.if ?? ""} ${step.if ?? ""}`;
    expect(condition).toMatch(/github\.event_name == 'schedule'/);
    expect(condition).toMatch(/!cancelled\(\)/);
  });
});
