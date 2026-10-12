import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { comment, createIssue, ensureLabel, issuesLabelled, type Issue } from "./github.ts";
import { MAINTENANCE_COLOR, MAINTENANCE_DESCRIPTION, MAINTENANCE_LABEL } from "./reminder.ts";

/**
 * The issue a failed scheduled run opens, labelled `maintenance`:
 * `npm run maintenance:failure -- --title <title> --intro <text> --log
 * <path>...`, from a step that runs only on a failure. The body is the
 * intro (which names the run) and the end of each log. An open issue with
 * the same title is commented on rather than opened again, so the
 * prospective test, whose title names the day, opens one issue per failing
 * day however many times it is run again that day.
 */

/** The share of GitHub's limit on a body the logs may fill, left for the intro and the fences. */
const LOGS_LIMIT = 60_000;

/** The open issue a failure with this title is added to; null where none is open and one is to be opened. */
export function failureTarget(title: string, issues: readonly Issue[]): number | null {
  return issues.find((issue) => issue.title === title && issue.state.toUpperCase() === "OPEN")?.number ?? null;
}

/** The body: the intro, then the end of each log in a fence, each kept to its share of the limit; a log never written says so. */
export function failureBody(intro: string, logs: readonly { name: string; text: string | null }[]): string {
  const share = Math.floor(LOGS_LIMIT / Math.max(1, logs.length));
  const parts = [intro];
  for (const log of logs) {
    if (log.text === null || log.text.trim() === "") {
      parts.push("", `${log.name}: (no log)`);
      continue;
    }
    const tail = log.text.length > share ? `…\n${log.text.slice(log.text.length - share)}` : log.text;
    parts.push("", `The end of ${log.name}:`, "", "```text", tail.replace(/```/g, "'''").trimEnd(), "```");
  }
  return `${parts.join("\n")}\n`;
}

function main(): void {
  const args = process.argv.slice(2);
  const values = (name: string): string[] => args.flatMap((arg, i) => (arg === name && args[i + 1] !== undefined ? [args[i + 1]!] : []));
  const [title] = values("--title");
  const [intro] = values("--intro");
  if (title === undefined || intro === undefined) throw new Error("usage: maintenance:failure -- --title <title> --intro <text> [--log <path>]...");
  const logs = values("--log").map((path) => ({ name: basename(path), text: existsSync(path) ? readFileSync(path, "utf8") : null }));
  const body = failureBody(intro, logs);
  ensureLabel(MAINTENANCE_LABEL, MAINTENANCE_COLOR, MAINTENANCE_DESCRIPTION);
  const target = failureTarget(title, issuesLabelled(MAINTENANCE_LABEL));
  if (target === null) console.log(`${title}: opened ${createIssue(title, body, MAINTENANCE_LABEL)}`);
  else {
    comment(target, body);
    console.log(`${title}: commented on #${target}`);
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("failure-issue.ts")) main();
