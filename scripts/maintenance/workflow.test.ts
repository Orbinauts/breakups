import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

/**
 * The weekly maintenance workflow, read as GitHub reads it: what starts
 * it and what it may do; the branch it folds in; the cheap checks run on
 * the folded tree before the hour's replay; the replay, the promotion and
 * the prospective score in their order; a pull request merged only once
 * CI passed on it, with the Archive's uploads before the merge; a main
 * that moved during the run followed where it touched nothing the run
 * generated; and a failure reported with its log. Its accepted reports
 * are `scripts/truth/report-workflow.test.ts`'s, its concurrency group
 * `scripts/kpi/workflow.test.ts`'s, its install on the scoring pins
 * `scripts/pins/pins.test.ts`'s and its keep-alive
 * `keep-alive.test.ts`'s.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface Step {
  id?: string;
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}

interface Input {
  type: string;
  default: unknown;
}

interface Workflow {
  on: { schedule: { cron: string }[]; workflow_dispatch: { inputs: Record<string, Input> } };
  concurrency: { group: string; "cancel-in-progress": boolean };
  permissions: Record<string, string>;
  env: Record<string, string>;
  jobs: Record<string, { "timeout-minutes": number; steps: Step[] }>;
}

const workflow = parse(readFileSync(resolve(ROOT, ".github/workflows/maintenance.yml"), "utf8")) as Workflow;
const job = workflow.jobs["maintain"]!;
const steps = job.steps;
const named = (name: string): Step => {
  const found = steps.find((step) => step.name === name);
  if (found === undefined) throw new Error(`no step of the maintenance job is named ${name}`);
  return found;
};
const running = (pattern: RegExp): Step => {
  const found = steps.find((step) => pattern.test(step.run ?? ""));
  if (found === undefined) throw new Error(`no step of the maintenance job runs ${pattern}`);
  return found;
};
const at = (step: Step): number => steps.indexOf(step);

describe("the maintenance run's checks before the replay", () => {
  const fold = running(/git merge --no-ff/);
  const truth = running(/npm run -s truth$/m);
  const plan = running(/maintenance:plan/);
  const early = steps.find((step) => step.name === "Check the folded tree before the replay")!;
  const promote = running(/maintenance:promote/);
  const replay = running(/npm run -s kpi -- --aggregate/);
  const after = running(/npm run docs/);

  test("run the typecheck and the whole test suite on the folded tree with the refreshed truth, before any download or replay", () => {
    expect(early.run).toMatch(/npm run typecheck\n\s*npm test/);
    expect(at(fold)).toBeLessThan(at(early));
    expect(at(truth)).toBeLessThan(at(early));
    expect(at(plan)).toBeLessThan(at(early));
    expect(at(early)).toBeLessThan(at(promote));
    expect(at(early)).toBeLessThan(at(replay));
    expect(early.if).toBeUndefined();
  });

  test("write the generated parts first, so the pages agree with the truth just rebuilt", () => {
    expect(early.run).toMatch(/npm run -s kpi:readme\n(?:.*\n)*\s*npm run typecheck/);
  });

  test("leave out only the check the replay makes good, and only where a replay is due", () => {
    expect(early.env?.["BREAKUPS_SCORECARD_PENDING"]).toBe(`\${{ steps.${plan.id}.outputs.rescore == 'true' && '1' || '' }}`);
  });

  test("and run again after the replay, with the documentation build", () => {
    expect(after.run).toMatch(/npm run typecheck\n\s*npm test\n\s*npm run docs/);
    expect(at(replay)).toBeLessThan(at(after));
  });
});

describe("the maintenance run's pull request, when main moved during the run", () => {
  const pr = running(/gh pr merge/).run!;
  const index = (text: string): number => {
    const found = pr.indexOf(text);
    if (found === -1) throw new Error(`the pull request's step does not run ${text}`);
    return found;
  };

  test("follows main before the branch is pushed, and checks the tree again each time it does", () => {
    expect(index("npm run -s maintenance:moved -- --base \"$checked\" --message \"$out/commit.txt\" --out \"$out\"")).toBeLessThan(index('git push -q origin "$branch"'));
    const loop = pr.slice(index("maintenance:moved"), index('git push -q origin "$branch"'));
    expect(loop).toMatch(/rebased\)[\s\S]*npm run typecheck\n\s*npm test/);
  });

  test("leaves the pull request unmerged, with the reason, where main touched what the run generated or kept moving", () => {
    expect(index('gh pr comment "$url" --body-file "$out/moved.md"')).toBeLessThan(index("gh run list --commit"));
    expect(pr).toMatch(/kept moving/);
  });

  test("still refuses to merge onto a main other than the one its tree was last checked against", () => {
    expect(index('[ "$(git ls-remote origin refs/heads/main | cut -f1)" != "$checked" ]')).toBeLessThan(index("gh run list --commit"));
  });

  test("follows main only when it is to merge: a pull request left open for review keeps its base", () => {
    expect(pr).toMatch(/if \[ "\$MERGE" = true \]; then\n\s*for _ in 1 2 3; do/);
  });
});

/** The lines of a step's script that match, run by bash with the environment given: its exit status and what it printed. */
function runLines(step: Step, pattern: RegExp, env: Record<string, string>, after = ""): { status: number | null; out: string } {
  const lines = step.run!.split("\n").filter((line) => pattern.test(line));
  const run = spawnSync("bash", ["-c", `${lines.join("\n")}\n${after}`], { env: { PATH: process.env["PATH"] ?? "", ...env }, encoding: "utf8" });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

describe("the maintenance workflow's start", () => {
  test("runs every Monday and by hand, a replay off, the merge on and no branch folded in unless asked", () => {
    expect(workflow.on.schedule).toHaveLength(1);
    expect(workflow.on.schedule[0]!.cron).toMatch(/^\d+ \d+ \* \* 1$/);
    const inputs = workflow.on.workflow_dispatch.inputs;
    expect(Object.keys(inputs).sort()).toEqual(["from", "merge", "rescore"]);
    expect(inputs["rescore"]).toMatchObject({ type: "boolean", default: false });
    expect(inputs["merge"]).toMatchObject({ type: "boolean", default: true });
    expect(inputs["from"]).toMatchObject({ type: "string", default: "" });
  });

  test("may write the branch, the pull request, the issues and the workflow runs, and nothing else", () => {
    expect(workflow.permissions).toEqual({ contents: "write", "pull-requests": "write", issues: "write", actions: "write" });
  });

  test("ends inside GitHub's six hours, and reads each year of the Archive once, with no decoded cache beside it", () => {
    expect(job["timeout-minutes"]).toBeLessThan(360);
    expect(workflow.env["BREAKUPS_DECODED"]).toBe("off");
  });

  test("runs every action at a full commit hash and every script strictly, with its output in the log once the log exists", () => {
    for (const step of steps.filter((s) => s.uses !== undefined)) expect(step.uses, step.name).toMatch(/@[0-9a-f]{40}(?: #.*)?$/);
    for (const step of steps.filter((s) => (s.run ?? "").includes("\n"))) expect(step.run!.startsWith("set -euo pipefail\n"), step.name).toBe(true);
    const logged = steps.filter((s) => (s.run ?? "").includes('exec > >(tee -a "$LOG") 2>&1'));
    expect(at(logged[0]!)).toBeGreaterThan(at(named("Start the log and name the bot")));
    for (const name of ["Fold in a branch", "Fetch the machine-readable sources and rebuild the truth", "Plan the run", "Replay the scorecard over the whole Archive", "Run every check", "Open the pull request and merge it"]) expect(logged).toContain(named(name));
  });
});

describe("the branch the maintenance run folds in", () => {
  const fold = named("Fold in a branch");
  const decide = (from: string) => runLines(fold, /^case "\$FROM"/, { FROM: from }, "echo folded");

  test("is folded in only when one is named", () => {
    expect(fold.if).toBe("inputs.from != ''");
  });

  test("is a branch name: one that could be an option or that holds a shell's characters is refused", () => {
    for (const from of ["--upload-pack=touch /tmp/x", "main;rm -rf /", "a b", "$(id)", "x`id`"]) {
      const { status, out } = decide(from);
      expect(status, from).toBe(1);
      expect(out).toContain("::error::not a branch name");
    }
    expect(decide("fix/hand-row-2026.10").out).toContain("folded");
  });

  test("a branch named for an accepted report is not merged here: the report is read from its issue", () => {
    const { status, out } = decide("report/issue-41");
    expect(status).toBe(0);
    expect(out).toContain("is not read: an accepted report is read from its issue");
    expect(out).not.toContain("folded");
  });
});

describe("the maintenance run's replay, promotion and score", () => {
  const plan = named("Plan the run");
  const promote = named("Promote the closed year into the Archive");
  const replay = named("Replay the scorecard over the whole Archive");
  const tables = named("Write the generated tables of the README and the documentation pages");
  const score = named("Score the prospective test");
  const keep = named("Keep the score on the prospective branch");
  const checks = named("Run every check");

  test("replay only where the plan says so, and promote only the year it planned", () => {
    expect(plan.id).toBe("plan");
    expect(replay.if).toBe("steps.plan.outputs.rescore == 'true'");
    expect(promote.if).toBe("steps.plan.outputs.promote != ''");
    expect(at(promote)).toBeLessThan(at(replay));
  });

  test("the replay downloads the years, rebuilds the catalogue index, replays each year the Archive holds in order, then aggregates", () => {
    const run = replay.run!;
    const order = ["npm run -s archive:download -- $wanted", "npm run -s kpi:index", "npm run -s kpi:year --", "npm run -s kpi -- --aggregate"].map((text) => run.indexOf(text));
    expect(order.every((i) => i !== -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("a year planned for promotion and refused is replayed as the release holds it; one promoted is not downloaded again", () => {
    const wanted = (env: Record<string, string>) => runLines(replay, /^\s*(wanted=|if \[ -n "\$PLANNED" \])/, env, 'echo "$wanted"').out.trim();
    expect(wanted({ YEARS: "2025 2026", PLANNED: "2025", PROMOTED: "" })).toBe("2025 2026 2025");
    expect(wanted({ YEARS: "2026", PLANNED: "2025", PROMOTED: "2025" })).toBe("2026");
    expect(wanted({ YEARS: "2026", PLANNED: "", PROMOTED: "" })).toBe("2026");
  });

  test("the pages are written after the replay, and the prospective score is kept on its branch before main's checks, whatever they say", () => {
    expect(at(replay)).toBeLessThan(at(tables));
    expect(tables.if).toBeUndefined();
    expect(at(tables)).toBeLessThan(at(score));
    expect(at(score)).toBeLessThan(at(keep));
    expect(at(keep)).toBeLessThan(at(checks));
    expect(keep.if).toBeUndefined();
    expect(keep.run).toMatch(/git diff --cached --quiet[\s\S]*exit 0[\s\S]*git push -q origin HEAD:prospective/);
  });
});

describe("the maintenance run's merge", () => {
  const changes = named("Look for changes");
  const prStep = running(/gh pr merge/);
  const pr = prStep.run!;
  const index = (text: string): number => {
    const found = pr.indexOf(text);
    if (found === -1) throw new Error(`the pull request's step does not run ${text}`);
    return found;
  };
  const merge = index("gh pr merge");

  test("opens no pull request where nothing changed", () => {
    expect(prStep.if).toBe("steps.changes.outputs.changed == 'true'");
    expect(changes.id).toBe("changes");
    expect(at(changes)).toBeLessThan(at(prStep));
  });

  test("merges on its schedule, and by hand only where asked", () => {
    expect(prStep.env?.["MERGE"]).toBe("${{ github.event_name == 'schedule' || inputs.merge }}");
    expect(index('if [ "$MERGE" != true ]; then\n  echo "left open for review"\n  exit 0')).toBeLessThan(merge);
  });

  test("merges only once CI passed on the pull request, and says why where it did not or never ran", () => {
    const watch = index('gh run watch "$ci" --exit-status');
    expect(watch).toBeLessThan(merge);
    const failed = pr.slice(watch, merge);
    expect(failed).toMatch(/CI failed on this pull request[\s\S]*exit 1/);
    expect(failed).toMatch(/CI did not run on this pull request[\s\S]*exit 1/);
  });

  test("uploads the Archive's side files, or the promoted year, before the merge and only after a replay", () => {
    const upload = pr.slice(index('if [ "$RESCORED" = true ]; then'), merge);
    expect(upload).toContain('npm run -s archive:upload -- "$PROMOTED"');
    expect(upload).toContain("npm run -s archive:upload -- --side-only");
    expect(prStep.env?.["RESCORED"]).toBe("${{ steps.plan.outputs.rescore }}");
  });

  test("supersedes an open maintenance pull request rather than opening a second", () => {
    expect(index('gh pr close "$number" --delete-branch')).toBeLessThan(index("gh pr create"));
  });

  test("starts CI, the KPI workflow and the docs on main only after it merged", () => {
    const after = named("Run CI, the KPI workflow and the docs on main");
    expect(after.if).toBe("steps.pr.outputs.merged == 'true'");
    expect(prStep.id).toBe("pr");
    expect(pr.indexOf('echo "merged=true" >> "$GITHUB_OUTPUT"')).toBeGreaterThan(merge);
    expect(after.run).toContain("for workflow in ci.yml kpi.yml docs.yml; do gh workflow run \"$workflow\" --ref main; done");
  });
});

describe("the maintenance run's failure", () => {
  const issue = named("Open an issue with the log");
  const artifact = steps.find((step) => (step.uses ?? "").startsWith("actions/upload-artifact@"))!;

  test("opens an issue labelled maintenance with the end of the log, or comments on the one open", () => {
    expect(issue.if).toBe("failure()");
    expect(issue.run).toContain('tail -c 60000 "$LOG"');
    expect(issue.run).toMatch(/if \[ -n "\$number" \]; then\n\s*gh issue comment "\$number"[\s\S]*else\n\s*gh issue create --title "\$title" --label maintenance/);
  });

  test("keeps the whole log as an artifact, whatever happened", () => {
    expect(artifact.if).toBe("always()");
    expect(artifact.with?.["path"]).toBe("${{ runner.temp }}/maintenance.log");
    expect(at(artifact)).toBe(steps.length - 1);
  });
});
