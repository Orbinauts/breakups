import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

/**
 * The weekly maintenance workflow, read as GitHub reads it: the cheap
 * checks run on the folded tree before the hour's replay, and a main that
 * moved during the run is followed where it touched nothing the run
 * generated.
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
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: Record<string, { steps: Step[] }>;
}

const workflow = parse(readFileSync(resolve(ROOT, ".github/workflows/maintenance.yml"), "utf8")) as Workflow;
const steps = workflow.jobs["maintain"]!.steps;
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
