import { readFileSync, writeFileSync } from "node:fs";
import { comment, ensureLabel, gh, setOutput } from "../maintenance/github.ts";

/**
 * The owner's acceptance of a breakup report, read by the workflow
 * `.github/workflows/breakup-report.yml` when an issue is labelled.
 * `npm run truth:report -- check <body file>` reads the event GitHub
 * wrote (`GITHUB_EVENT_PATH`) and accepts the report only where the label
 * is `breakup-report-accepted`, the issue is a `breakup-report` and the
 * person who applied it is the repository's owner (`OWNER`, the workflow's
 * `github.repository_owner`: the repository belongs to a user account, so
 * the owner is one login). Anyone with triage permission can apply a
 * label, and an admin is not the owner, so neither the label alone nor a
 * permission proves the owner's acceptance. An accepted report's body is written to the
 * file for `npm run truth:add -- --form`; a refused one has the label
 * taken off again and a comment saying why. `npm run truth:report --
 * refused <issue number> <log file>` does the same for a report the hand file's checks
 * refused, quoting their words, so the issue can be edited and labelled
 * again.
 */

export const REPORT_LABEL = "breakup-report";
export const ACCEPT_LABEL = "breakup-report-accepted";
const REPORT_COLOR = "1d76db";
const REPORT_DESCRIPTION = "A published report of a breakup, for the owner to accept into the ground truth";
const ACCEPT_COLOR = "0e8a16";
const ACCEPT_DESCRIPTION = "The owner accepts the report: a workflow adds it to the ground truth (only the owner's label counts)";

/** What GitHub says of an issue labelled, the fields read here. */
export interface LabelledEvent {
  action: string;
  label?: { name: string };
  issue: { number: number; body: string | null; labels: { name: string }[] };
  sender: { login: string };
}

export type Acceptance = { accepted: true; number: number; body: string; by: string } | { accepted: false; number: number; reason: string };

/** Whether a labelling accepts a report: the accepting label, on a breakup report, applied by the repository's owner (`owner`, a login). */
export function acceptance(event: LabelledEvent, owner: string): Acceptance {
  const number = event.issue.number;
  const label = event.label?.name ?? "none";
  if (label !== ACCEPT_LABEL) return { accepted: false, number, reason: `the label applied is ${label}, not ${ACCEPT_LABEL}` };
  if (!event.issue.labels.some((l) => l.name === REPORT_LABEL)) return { accepted: false, number, reason: `the issue is not labelled ${REPORT_LABEL}` };
  if (event.sender.login !== owner) return { accepted: false, number, reason: `${event.sender.login} applied ${ACCEPT_LABEL}; only the repository's owner, ${owner}, accepts a report` };
  if (event.issue.body === null || event.issue.body.trim() === "") return { accepted: false, number, reason: "the issue has no body to read the report from" };
  return { accepted: true, number, body: event.issue.body, by: event.sender.login };
}

/** The branch an accepted report's statement is committed to: named by the issue's number alone, never by its text. */
export const reportBranch = (number: number): string => `report/issue-${number}`;

/** The repository's owner, a login: `OWNER` as the workflow passes it (`github.repository_owner`). */
function ownerOf(): string {
  const owner = process.env.OWNER;
  if (owner === undefined || owner === "") throw new Error("OWNER names no repository owner: the workflow passes github.repository_owner");
  return owner;
}

function unlabel(number: number): void {
  gh(["issue", "edit", String(number), "--remove-label", ACCEPT_LABEL]);
}

function check(bodyFile: string): void {
  const path = process.env.GITHUB_EVENT_PATH;
  if (path === undefined) throw new Error("GITHUB_EVENT_PATH names no event: this runs in the workflow");
  const event = JSON.parse(readFileSync(path, "utf8")) as LabelledEvent;
  ensureLabel(REPORT_LABEL, REPORT_COLOR, REPORT_DESCRIPTION);
  ensureLabel(ACCEPT_LABEL, ACCEPT_COLOR, ACCEPT_DESCRIPTION);
  const result = acceptance(event, ownerOf());
  setOutput("number", String(result.number));
  if (!result.accepted) {
    console.log(`not accepted: ${result.reason}`);
    if (event.label?.name === ACCEPT_LABEL) {
      unlabel(result.number);
      comment(result.number, `Not accepted: ${result.reason}. Nothing was added to the ground truth.`);
    }
    setOutput("accepted", "false");
    return;
  }
  writeFileSync(bodyFile, result.body);
  setOutput("accepted", "true");
  setOutput("branch", reportBranch(result.number));
  setOutput("by", result.by);
  console.log(`issue ${result.number} accepted by ${result.by}`);
}

function refused(number: number, logFile: string): void {
  const log = readFileSync(logFile, "utf8").trim().slice(-6000);
  unlabel(number);
  comment(number, ["The report was accepted, but the hand file's checks refused it, so nothing was added to the ground truth:", "", "```text", log === "" ? "(no output)" : log, "```", "", `Edit the issue's fields and label it ${ACCEPT_LABEL} again.`].join("\n"));
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("report-issue.ts")) {
  const [command, arg, extra] = process.argv.slice(2);
  if (command === "check" && arg !== undefined) check(arg);
  else if (command === "refused" && arg !== undefined && extra !== undefined) refused(Number(arg), extra);
  else {
    console.error("usage: npm run truth:report -- check <body file> | refused <issue number> <log file>");
    process.exit(1);
  }
}
