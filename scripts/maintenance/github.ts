import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The few calls the maintenance scripts make to GitHub, through the GitHub
 * CLI (`gh`), authenticated by `GH_TOKEN` (the workflow's own token in
 * Actions) and pointed at the repository `GH_REPO` names, else at the
 * repository of the working directory. Labels are made when missing, and
 * issues are listed in every state, so a script that opens one per key or
 * per title opens it once.
 */

/** A `gh` command's standard output; a failure throws with its standard error. */
export function gh(args: readonly string[], input?: string): string {
  return execFileSync("gh", args, { encoding: "utf8", input, maxBuffer: 1 << 28, stdio: ["pipe", "pipe", "pipe"] });
}

/** A label made where the repository lacks it, its colour and description set where it has it. */
export function ensureLabel(name: string, color: string, description: string): void {
  gh(["label", "create", name, "--color", color, "--description", description, "--force"]);
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
}

/** Every issue carrying a label, open or closed. */
export function issuesLabelled(label: string): Issue[] {
  return JSON.parse(gh(["issue", "list", "--label", label, "--state", "all", "--limit", "10000", "--json", "number,title,body,state,url"])) as Issue[];
}

/** An issue opened with a label, its body passed through a file so no length or character is lost; its URL. */
export function createIssue(title: string, body: string, label: string): string {
  const dir = mkdtempSync(join(tmpdir(), "breakups-issue-"));
  try {
    const path = join(dir, "body.md");
    writeFileSync(path, body);
    return gh(["issue", "create", "--title", title, "--body-file", path, "--label", label]).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A comment on an issue or pull request, its body passed through a file. */
export function comment(number: number, body: string): void {
  const dir = mkdtempSync(join(tmpdir(), "breakups-comment-"));
  try {
    const path = join(dir, "body.md");
    writeFileSync(path, body);
    gh(["issue", "comment", String(number), "--body-file", path]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A step output for the workflow, where the process runs in one; printed either way. */
export function setOutput(name: string, value: string): void {
  console.log(`${name}=${value}`);
  const path = process.env.GITHUB_OUTPUT;
  if (path !== undefined && path !== "") appendFileSync(path, `${name}=${value}\n`);
}

/** GitHub's limit on an issue's or a pull request's body, in characters. */
export const BODY_LIMIT = 65_536;
