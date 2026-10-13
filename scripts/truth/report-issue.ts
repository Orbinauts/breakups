import { readFileSync, writeFileSync } from "node:fs";
import { comment, ensureLabel, gh, setOutput } from "../maintenance/github.ts";
import type { HandFile } from "./add.ts";
import { readForm, statementFromForm } from "./report-form.ts";

/**
 * The owner's acceptance of a breakup report.
 *
 * Read by the workflow `.github/workflows/breakup-report.yml` when an
 * issue is labelled: `npm run truth:report -- check <body file>` reads the
 * event GitHub wrote (`GITHUB_EVENT_PATH`) and accepts the report only
 * where the label is `breakup-report-accepted`, the issue is a
 * `breakup-report` and the person who applied it is the repository's owner
 * (`OWNER`, the workflow's `github.repository_owner`: the repository
 * belongs to a user account, so the owner is one login). Anyone with triage
 * permission can apply a label, and an admin is not the owner, so neither
 * the label alone nor a permission proves the owner's acceptance. An
 * accepted report's body is written to the file for `npm run truth:add --
 * --form`, which checks it; a refused one has the label taken off again
 * and a comment saying why. `npm run truth:report -- refused <issue number>
 * <log file>` does the same for a report the hand file's checks refused,
 * quoting their words, so the issue can be edited and labelled again.
 *
 * Read again by every maintenance run: `npm run truth:report -- accepted
 * <file>` reads each issue labelled `breakup-report-accepted` from GitHub,
 * with its events and when its body was last edited, and writes the
 * statements of those the owner accepted as a hand file, for `npm run
 * truth:add -- --missing-from` to append those main lacks
 * (`acceptedStatement`). A statement reaches the truth from the issue the
 * owner accepted and from nowhere else: no branch is read.
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

/** One event of an issue as GitHub's issue events API gives it (`GET /repos/{repo}/issues/{number}/events`), the fields read here. */
export interface IssueEvent {
  event: string;
  actor: { login: string } | null;
  label?: { name: string } | null;
  created_at: string;
}

/** An issue labelled `breakup-report-accepted` as the maintenance run reads it: its body and labels (the issues API), when its body was last edited (GraphQL's `lastEditedAt`, null for never) and its events. */
export interface AcceptedIssue {
  number: number;
  body: string | null;
  labels: { name: string }[];
  lastEditedAt: string | null;
  events: IssueEvent[];
}

type Fields = Record<string, unknown>;

/** The statement an accepted issue states, or why it states none. */
export type AcceptedRead = { number: number; statement: Fields } | { number: number; reason: string };

/**
 * The statement an issue states as the owner accepted it: an issue
 * labelled `breakup-report` and `breakup-report-accepted`, on which the
 * last application of the accepting label (its events) was the
 * repository's owner's, and whose body was not edited after it, read with
 * the form reader. The label may be applied by anyone the repository lets
 * label, so only its events say who; a body edited after the owner read it
 * is no longer what the owner accepted, until the owner labels it again.
 */
export function acceptedStatement(issue: AcceptedIssue, owner: string): AcceptedRead {
  const number = issue.number;
  if (!issue.labels.some((l) => l.name === REPORT_LABEL)) return { number, reason: `the issue is not labelled ${REPORT_LABEL}` };
  if (!issue.labels.some((l) => l.name === ACCEPT_LABEL)) return { number, reason: `the issue is not labelled ${ACCEPT_LABEL}` };
  const applied = issue.events.filter((e) => e.event === "labeled" && e.label?.name === ACCEPT_LABEL).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const last = applied[applied.length - 1];
  if (last === undefined) return { number, reason: `no event of the issue applies ${ACCEPT_LABEL}` };
  const by = last.actor?.login ?? "a deleted account";
  if (by !== owner) return { number, reason: `${by} applied ${ACCEPT_LABEL} last; only the repository's owner, ${owner}, accepts a report` };
  if (issue.lastEditedAt !== null && Date.parse(issue.lastEditedAt) > Date.parse(last.created_at)) return { number, reason: `its body was edited on ${issue.lastEditedAt}, after the owner accepted it on ${last.created_at}: the owner labels it ${ACCEPT_LABEL} again to accept the new text` };
  if (issue.body === null || issue.body.trim() === "") return { number, reason: "the issue has no body to read the report from" };
  try {
    return { number, statement: statementFromForm(readForm(issue.body)) as unknown as Fields };
  } catch (error) {
    return { number, reason: `its form cannot be read: ${(error as Error).message}` };
  }
}

/** The statements of the accepted issues as a hand file, in the issues' order, for `truth:add -- --missing-from`; with the issues that state none and why. */
export function acceptedHandFile(issues: readonly AcceptedIssue[], owner: string): { file: HandFile; passed: { number: number; reason: string }[] } {
  const reads = issues.map((issue) => acceptedStatement(issue, owner));
  return {
    file: { about: `The statements of the breakup-report issues the repository's owner, ${owner}, accepted, read again from the issues.`, statements: reads.flatMap((read) => ("statement" in read ? [read.statement] : [])) },
    passed: reads.flatMap((read) => ("reason" in read ? [read] : [])),
  };
}

/** The repository's owner, a login: `OWNER` as the workflow passes it (`github.repository_owner`). */
function ownerOf(): string {
  const owner = process.env.OWNER;
  if (owner === undefined || owner === "") throw new Error("OWNER names no repository owner: the workflow passes github.repository_owner");
  return owner;
}

function repositoryOf(): string {
  const repository = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY;
  if (repository === undefined || !repository.includes("/")) throw new Error("GH_REPO names no repository");
  return repository;
}

/** The objects of a paginated array answer, one a line (`--jq '.[]'`). */
const lines = <T>(text: string): T[] =>
  text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);

/** Every issue labelled `breakup-report-accepted`, open or closed, with its events and when its body was last edited, as GitHub gives them. */
export function readAcceptedIssues(repository = repositoryOf()): AcceptedIssue[] {
  const [owner, name] = repository.split("/") as [string, string];
  const issues = lines<{ number: number; body: string | null; labels: { name: string }[]; pull_request?: unknown }>(gh(["api", "--paginate", `repos/${repository}/issues?labels=${ACCEPT_LABEL}&state=all&per_page=100`, "--jq", ".[]"])).filter((issue) => issue.pull_request === undefined);
  const query = "query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { lastEditedAt } } }";
  return issues.map((issue) => {
    const edited = gh(["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${issue.number}`, "--jq", ".data.repository.issue.lastEditedAt"]).trim();
    return { number: issue.number, body: issue.body, labels: issue.labels, lastEditedAt: edited === "" || edited === "null" ? null : edited, events: lines<IssueEvent>(gh(["api", "--paginate", `repos/${repository}/issues/${issue.number}/events?per_page=100`, "--jq", ".[]"])) };
  });
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
  setOutput("by", result.by);
  console.log(`issue ${result.number} accepted by ${result.by}`);
}

function refused(number: number, logFile: string): void {
  const log = readFileSync(logFile, "utf8").trim().slice(-6000);
  unlabel(number);
  comment(number, ["The report was accepted, but the hand file's checks refused it, so nothing was added to the ground truth:", "", "```text", log === "" ? "(no output)" : log, "```", "", `Edit the issue's fields and label it ${ACCEPT_LABEL} again.`].join("\n"));
}

function accepted(out: string): void {
  const { file, passed } = acceptedHandFile(readAcceptedIssues(), ownerOf());
  for (const { number, reason } of passed) console.log(`issue ${number} passed over: ${reason}`);
  console.log(`${file.statements.length} accepted report${file.statements.length === 1 ? "" : "s"} read from their issues`);
  writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("report-issue.ts")) {
  const [command, arg, extra] = process.argv.slice(2);
  if (command === "check" && arg !== undefined) check(arg);
  else if (command === "refused" && arg !== undefined && extra !== undefined) refused(Number(arg), extra);
  else if (command === "accepted" && arg !== undefined) accepted(arg);
  else {
    console.error("usage: npm run truth:report -- check <body file> | refused <issue number> <log file> | accepted <hand file to write>");
    process.exit(1);
  }
}
