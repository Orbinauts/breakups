import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { BODY_LIMIT, type Issue } from "./github.ts";
import { failureBody, failureTarget } from "./failure-issue.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const issue = (number: number, title: string, state: string): Issue => ({ number, title, state, body: "", url: `https://example.com/issues/${number}` });

describe("the issue a failed run opens", () => {
  test("is commented on where the day's issue is open, so a run made again that day opens no second one", () => {
    const issues = [issue(40, "The prospective test failed on 2026-10-11", "OPEN"), issue(41, "The prospective test failed on 2026-10-12", "OPEN")];
    expect(failureTarget("The prospective test failed on 2026-10-12", issues)).toBe(41);
  });

  test("is opened anew where no open issue has the title, the day before's or a closed one apart", () => {
    const issues = [issue(40, "The prospective test failed on 2026-10-11", "OPEN"), issue(41, "The prospective test failed on 2026-10-12", "CLOSED")];
    expect(failureTarget("The prospective test failed on 2026-10-12", issues)).toBeNull();
  });

  test("carries the run, and the end of each log, within GitHub's limit on a body", () => {
    const long = `${"early line\n".repeat(20_000)}the error at the end\n`;
    const body = failureBody("The prospective run https://example.com/run/9 failed.", [
      { name: "the run's steps", text: long },
      { name: "prospective.log", text: "pulled 2026\nreplay failed: no states\n" },
      { name: "requests.log", text: null },
    ]);
    expect(body.length).toBeLessThan(BODY_LIMIT);
    expect(body.startsWith("The prospective run https://example.com/run/9 failed.")).toBe(true);
    expect(body).toContain("the error at the end");
    expect(body).toContain("replay failed: no states");
    expect(body).toContain("requests.log: (no log)");
  });
});

describe("the prospective workflow's failure", () => {
  interface Step {
    name?: string;
    if?: string;
    run?: string;
    uses?: string;
  }
  const workflow = parse(readFileSync(resolve(ROOT, ".github/workflows/prospective.yml"), "utf8")) as { jobs: Record<string, { steps: Step[] }> };
  const steps = workflow.jobs["daily"]!.steps;

  test("opens an issue labelled maintenance, with the log's tail, in the last step that runs on a failure", () => {
    const open = steps.find((step) => /npm run -s maintenance:failure/.test(step.run ?? ""));
    expect(open?.if).toBe("failure()");
    expect(open?.run).toContain('--title "The prospective test failed on $(date -u +%F)"');
    expect(open?.run).toContain('--log "$LOG"');
    const after = steps.slice(steps.indexOf(open!) + 1).filter((step) => step.uses === undefined);
    expect(after).toEqual([]);
  });

  test("logs each step that does the work, so the issue has the end of what failed", () => {
    for (const pattern of [/npm run prospective:data -- download/, /^\s*npm run prospective$/m, /prospective:data -- upload/, /maintenance:alert-issues/, /published:daily/]) {
      const step = steps.find((s) => pattern.test(s.run ?? ""))!;
      expect(step.run).toMatch(/exec > >\(tee -a "\$LOG"\) 2>&1/);
    }
  });
});
