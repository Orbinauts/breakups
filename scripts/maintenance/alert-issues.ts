import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { archiveHome } from "../archive/archive.ts";
import { latestSatcat } from "../archive/satcat.ts";
import type { LoggedAlert } from "../prospective/alerts.ts";
import { parseJsonl, readJsonl } from "../prospective/alerts.ts";
import { runUrlOf, type RunLine } from "../prospective/run.ts";
import { BODY_LIMIT, createIssue, ensureLabel, issuesLabelled } from "./github.ts";

/**
 * One GitHub issue per alert of the prospective test:
 * `npm run maintenance:alert-issues -- <prospective worktree>`, run by the
 * daily workflow once the run has appended its alerts to `alerts.jsonl`
 * and the branch is pushed. Every alert of the log with no issue yet gets
 * one, labelled `prospective-alert` (the label made where missing): the
 * title names the parent, its catalogue number and the alert's state; the
 * body gives the evidence, the run that logged it (its line in
 * `runs.jsonl`) and the line of
 * `alerts.jsonl` itself. An issue carries its alert's key in a hidden
 * comment, and the issues of the label are read in every state before any
 * is opened, so an alert gets one issue however many runs see it, and a run
 * that failed half way is made good by the next.
 */

export const ALERT_LABEL = "prospective-alert";
const LABEL_COLOR = "b60205";
const LABEL_DESCRIPTION = "An alert the frozen detector raised in the prospective test";

/** The hidden line an issue carries its alert's key in. */
export const keyLine = (key: string): string => `<!-- alert-key: ${key} -->`;

/** The alert keys the issues' bodies carry. */
export function issuedKeys(bodies: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const body of bodies) for (const match of body.matchAll(/<!-- alert-key: (.+?) -->/g)) keys.add(match[1]!);
  return keys;
}

/** An alert of the log with the line it was read from. */
export interface LoggedLine {
  alert: LoggedAlert;
  line: string;
}

/** The log's alerts with their lines, blank lines skipped. */
export function loggedLines(text: string): LoggedLine[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, i) => ({ alert: parseJsonl<LoggedAlert>(line, `alerts.jsonl:${i + 1}`)[0]!, line }));
}

/** The logged alerts no issue names yet, in the log's order, each key once. */
export function alertsToIssue(logged: readonly LoggedLine[], issued: ReadonlySet<string>): LoggedLine[] {
  const seen = new Set(issued);
  return logged.filter(({ alert }) => {
    if (seen.has(alert.key)) return false;
    seen.add(alert.key);
    return true;
  });
}

/** The run that logged alerts on a day: the last line of `runs.jsonl` of that day that logged any, else the last of the day; null where none names its run. */
export function runThatLogged(runs: readonly Pick<RunLine, "date" | "newAlerts" | "runUrl">[], loggedOn: string): string | null {
  const ofDay = runs.filter((run) => run.date === loggedOn);
  const logging = ofDay.filter((run) => run.newAlerts > 0);
  return (logging.at(-1) ?? ofDay.at(-1))?.runUrl ?? null;
}

const iso = (ms: number): string => new Date(ms).toISOString().replace(/:\d\d\.\d{3}Z$/, "Z");

/** The issue's title: the parent's name and catalogue number (a cloud's launch where it names no parent) and the alert's state. */
export function alertTitle(alert: LoggedAlert, name: string | null): string {
  const what = alert.number !== null ? `${name ?? "an unnamed body"} (${alert.number})` : `a cloud under the launch ${alert.launch ?? "unknown"}`;
  return `${what}: ${alert.kind === "cloud" ? "cloud" : alert.state}`;
}

/** The issue's body: what was raised and when, the run that logged it, the reasons and the evidence, and the line of the log. */
export function alertBody(entry: LoggedLine, context: { name: string | null; runUrl: string | null; branchUrl: string }): string {
  const { alert, line } = entry;
  const verdict = alert.verdict;
  const parent = alert.number === null ? "no parent named" : `${context.name ?? "an unnamed body"} (${alert.number})`;
  const step = verdict.step === null ? "none measured" : `between the sets of ${iso(verdict.step.beforeEpoch)} and ${iso(verdict.step.afterEpoch)}`;
  const event = verdict.event === null ? "none estimated" : JSON.stringify(verdict.event);
  // The reasons and the evidence are bounded, so the line of the log always has room under the limit on a body.
  const evidence = Object.entries(verdict.evidence)
    .slice(0, 300)
    .map(([name, value]) => `| ${name} | ${value} |`);
  const head = [
    `The detector ${alert.detector}, frozen at \`${alert.frozen.slice(0, 7)}\`, raised a **${alert.kind === "cloud" ? "cloud" : alert.state}** ${alert.kind} verdict in the prospective test. The daily run of ${alert.loggedOn} logged it to \`alerts.jsonl\` on the [\`prospective\` branch](${context.branchUrl}), whose commit time is when it was known.`,
    "",
    `- Parent: ${parent}${alert.launch === null ? "" : `, launch ${alert.launch}`}`,
    `- Raised at: ${alert.raisedAt} (the replay's clock), in the replay of ${alert.year}`,
    `- Step: ${step}`,
    `- Event estimate: ${event}`,
    `- Bodies: ${verdict.bodies === undefined || verdict.bodies.length === 0 ? "none" : verdict.bodies.join(", ")}${verdict.candidates === undefined ? "" : `; candidates ${verdict.candidates.join(", ")}`}`,
    `- Run: ${context.runUrl ?? "not run in GitHub Actions"}`,
    "",
    "Reasons:",
    "",
    ...(verdict.reasons.length === 0 ? ["- none given"] : verdict.reasons.slice(0, 50).map((reason) => `- ${reason.length > 1000 ? `${reason.slice(0, 1000)}…` : reason}`)),
    "",
    "| Evidence | Value |",
    "| --- | --- |",
    ...(evidence.length === 0 ? ["| none | |"] : evidence),
    "",
    "The line of `alerts.jsonl`:",
    "",
  ];
  const foot = ["", keyLine(alert.key), ""];
  const room = BODY_LIMIT - [...head, ...foot].join("\n").length - 200;
  const shown = line.length <= room ? ["```json", line, "```"] : ["```json", line.slice(0, Math.max(0, room)), "```", "", `The line is ${line.length} characters, cut here to fit the issue; the whole line is on the branch.`];
  return [...head, ...shown, ...foot].join("\n");
}

function main(): void {
  const branch = resolve(process.argv[2] ?? process.env.BREAKUPS_PROSPECTIVE ?? "../breakups-prospective");
  const path = join(branch, "alerts.jsonl");
  const logged = existsSync(path) ? loggedLines(readFileSync(path, "utf8")) : [];
  ensureLabel(ALERT_LABEL, LABEL_COLOR, LABEL_DESCRIPTION);
  const fresh = alertsToIssue(logged, issuedKeys(issuesLabelled(ALERT_LABEL).map((issue) => issue.body)));
  console.log(`${logged.length} alerts logged, ${fresh.length} without an issue`);
  if (fresh.length === 0) return;
  let names = new Map<number, string>();
  try {
    names = new Map([...(latestSatcat(archiveHome())?.rows ?? new Map()).values()].map((row) => [row.number, row.name]));
  } catch {
    // Without a satellite catalogue the issues name the parent by its number alone.
  }
  const repository = process.env.GITHUB_REPOSITORY ?? "Orbinauts/breakups";
  const runs = readJsonl<RunLine>(join(branch, "runs.jsonl"));
  const branchUrl = `https://github.com/${repository}/blob/prospective/alerts.jsonl`;
  for (const entry of fresh) {
    const name = entry.alert.number === null ? null : (names.get(entry.alert.number) ?? null);
    const runUrl = runThatLogged(runs, entry.alert.loggedOn) ?? runUrlOf(process.env);
    const url = createIssue(alertTitle(entry.alert, name), alertBody(entry, { name, runUrl, branchUrl }), ALERT_LABEL);
    console.log(`${entry.alert.key}: ${url}`);
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("alert-issues.ts")) main();
