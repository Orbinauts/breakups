import { describe, expect, test } from "vitest";
import type { Verdict } from "../../src/index.ts";
import { alertKey, jsonl, type LoggedAlert } from "../prospective/alerts.ts";
import { alertBody, alertTitle, alertsToIssue, issuedKeys, keyLine, loggedLines, runThatLogged } from "./alert-issues.ts";
import { BODY_LIMIT } from "./github.ts";

const DAY = 86_400_000;
const T = Date.parse("2026-10-20T06:00:00Z");

function alert(number: number | null, state: Verdict["state"], raisedAt: number, kind: Verdict["kind"] = "object", reasons: string[] = ["a persistent step"]): LoggedAlert {
  const verdict: Verdict = { kind, state, number, launch: "1982-092", raisedAt, step: kind === "cloud" ? null : { beforeEpoch: raisedAt - 2 * DAY, afterEpoch: raisedAt - DAY, deltaKm: -2, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 3, z: 10 }, event: null, evidence: { pieces: 4, deltaVMps: 12.5 }, reasons, bodies: [90001, 90002] };
  return { key: alertKey(verdict), kind, state, number, launch: "1982-092", raisedAt: new Date(raisedAt).toISOString(), year: 2026, loggedOn: new Date(raisedAt).toISOString().slice(0, 10), frozen: "8729987b9d9890f071aff9a1df594f2daada8ed3", detector: "confirmed-v10", verdict };
}

const suspected = alert(13552, "suspected", T);
const confirmed = alert(13552, "confirmed", T + DAY);
const cloud = alert(null, "confirmed", T + 2 * DAY, "cloud");
const log = loggedLines(jsonl([suspected, confirmed, cloud]));

describe("the issues of the prospective test's alerts", () => {
  test("read the alert keys the issues carry, whatever else their bodies hold", () => {
    expect(issuedKeys([`text\n${keyLine(suspected.key)}\n`, "no key here", `${keyLine(cloud.key)}`])).toEqual(new Set([suspected.key, cloud.key]));
  });

  test("are opened only for the alerts no issue carries yet", () => {
    expect(alertsToIssue(log, new Set()).map((entry) => entry.alert.key)).toEqual([suspected.key, confirmed.key, cloud.key]);
    expect(alertsToIssue(log, new Set([suspected.key, cloud.key])).map((entry) => entry.alert.key)).toEqual([confirmed.key]);
    expect(alertsToIssue(log, new Set(log.map((entry) => entry.alert.key)))).toEqual([]);
  });

  test("never twice for one key, even where the log holds it twice", () => {
    const twice = loggedLines(jsonl([suspected, confirmed, suspected]));
    expect(alertsToIssue(twice, new Set()).map((entry) => entry.alert.key)).toEqual([suspected.key, confirmed.key]);
  });

  test("an issue opened carries its key, so the next run opens none for it", () => {
    const bodies = alertsToIssue(log, new Set()).map((entry) => alertBody(entry, { name: "SL-8 R/B", runUrl: "https://example.org/run", branchUrl: "https://example.org/branch" }));
    expect(alertsToIssue(log, issuedKeys(bodies))).toEqual([]);
  });

  test("are titled with the parent's name, its catalogue number and the state", () => {
    expect(alertTitle(confirmed, "COSMOS 1408")).toBe("COSMOS 1408 (13552): confirmed");
    expect(alertTitle(suspected, null)).toBe("an unnamed body (13552): suspected");
    expect(alertTitle(cloud, null)).toBe("a cloud under the launch 1982-092: cloud");
  });

  test("give the evidence, the run and the line of the log", () => {
    const entry = log[1]!;
    const body = alertBody(entry, { name: "COSMOS 1408", runUrl: "https://example.org/run", branchUrl: "https://example.org/branch" });
    expect(body).toContain("| deltaVMps | 12.5 |");
    expect(body).toContain("- Run: https://example.org/run");
    expect(body).toContain("- a persistent step");
    expect(body).toContain(`\`\`\`json\n${entry.line}\n\`\`\``);
    expect(body).toContain(keyLine(confirmed.key));
  });

  test("cut a line too long for an issue, and keep the key", () => {
    const long = alert(13552, "confirmed", T, "object", ["x".repeat(BODY_LIMIT)]);
    const [entry] = loggedLines(jsonl([long]));
    const body = alertBody(entry!, { name: null, runUrl: null, branchUrl: "https://example.org/branch" });
    expect(body.length).toBeLessThanOrEqual(BODY_LIMIT);
    expect(body).toContain("cut here to fit");
    expect(body).toContain(keyLine(long.key));
  });

  test("name the run that logged the alert, by its day in runs.jsonl", () => {
    const runs = [
      { date: "2026-10-20", newAlerts: 0, runUrl: "https://example.org/a" },
      { date: "2026-10-20", newAlerts: 1, runUrl: "https://example.org/b" },
      { date: "2026-10-21", newAlerts: 0, runUrl: "https://example.org/c" },
    ];
    expect(runThatLogged(runs, "2026-10-20")).toBe("https://example.org/b");
    expect(runThatLogged(runs, "2026-10-21")).toBe("https://example.org/c");
    expect(runThatLogged(runs, "2026-10-22")).toBeNull();
  });
});
