import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * What the weekly maintenance run does when main moved while it checked
 * its tree: `npm run maintenance:moved -- --base <sha> --message <file>
 * --out <dir>`, in the run's checkout, on the branch holding the run's
 * change (the folded branch, if any, and the generated commit). The run's
 * checks were made on the base; a main that moved since is fetched and
 * compared with it.
 *
 * Where the moved main touched nothing the run generated or was made from
 * (`clashes`: any file under `data/` or `kpi/`, the pages whose marked
 * parts are generated, `docs/truth.md`, the dependencies' manifests and
 * pins, and any file the run changed itself, a folded branch's included),
 * the run's whole change is put on the moved main as one commit with the
 * run's message (`followMain`), and the run checks the tree again before
 * it goes on. Its change applies cleanly there, since no file it touches
 * moved. Where the moved main touched any of them, the branch is left as
 * it was, and the run leaves its pull request unmerged for the next run to
 * supersede, as before. Either way the decision and the main it was made
 * against are written to `<dir>/moved.txt` (`unmoved|rebased|left <sha>`),
 * and, where the branch is left, a comment for the pull request to
 * `<dir>/moved.md`.
 */

/** What the run generates or is made from, whether or not this run changed it: a directory ends with a slash. */
export const RUN_INPUTS = ["data/", "kpi/", "README.md", "docs/results.md", "docs/ground-truth.md", "docs/detector/events.md", "docs/truth.md", "package.json", "package-lock.json", "pins.json"] as const;

/** The files of the moved main that the run generated, was made from, or changed itself; empty where the run's change can follow main. */
export function clashes(movedFiles: readonly string[], runFiles: readonly string[]): string[] {
  const run = new Set(runFiles);
  return movedFiles.filter((file) => run.has(file) || RUN_INPUTS.some((input) => (input.endsWith("/") ? file.startsWith(input) : file === input)));
}

export type Followed = { decision: "unmoved"; main: string } | { decision: "rebased"; main: string } | { decision: "left"; main: string; clashes: string[] };

/**
 * The run's change (the base to the branch's head) put on `main` as one
 * commit with the message in the file `message`, on the same branch, where
 * the moved main clashes with nothing; the branch untouched otherwise, or
 * where main is still the base.
 */
export function followMain(dir: string, base: string, main: string, message: string): Followed {
  const git = (args: readonly string[], input?: string): string => execFileSync("git", args, { cwd: dir, encoding: "utf8", input, maxBuffer: 1 << 30 });
  if (main === base) return { decision: "unmoved", main };
  const files = (from: string, to: string): string[] => git(["diff", "--name-only", "--no-renames", from, to]).split("\n").filter((file) => file !== "");
  const found = clashes(files(base, main), files(base, "HEAD"));
  if (found.length > 0) return { decision: "left", main, clashes: found };
  const branch = git(["symbolic-ref", "--short", "HEAD"]).trim();
  const patch = git(["diff", "--binary", "--no-renames", base, "HEAD"]);
  git(["switch", "-q", "-C", branch, main]);
  git(["apply", "--index", "-"], patch);
  git(["commit", "-q", "-F", resolve(message)]);
  return { decision: "rebased", main };
}

/** The comment for a pull request left unmerged because the moved main clashed with the run. */
export function leftComment(followed: Extract<Followed, { decision: "left" }>, runUrl: string): string {
  const listed = followed.clashes.slice(0, 50).map((file) => `- \`${file}\``);
  if (followed.clashes.length > listed.length) listed.push(`- and ${followed.clashes.length - listed.length} more`);
  return [
    `Main moved while this run (${runUrl}) checked its tree, to ${followed.main.slice(0, 12)}, and the move touched what the run generated or was made from:`,
    "",
    ...listed,
    "",
    "So it is not merged: its checks ran on a base that is no longer main. The next run starts again from main and supersedes this pull request.",
  ].join("\n");
}

function main(): void {
  const args = process.argv.slice(2);
  const option = (name: string): string => {
    const at = args.indexOf(name);
    if (at === -1 || args[at + 1] === undefined) throw new Error(`usage: maintenance:moved -- --base <sha> --message <file> --out <dir> (missing ${name})`);
    return args[at + 1]!;
  };
  const base = option("--base");
  const message = option("--message");
  const out = option("--out");
  const dir = process.cwd();
  execFileSync("git", ["fetch", "-q", "origin", "+refs/heads/main:refs/remotes/origin/main"], { cwd: dir, stdio: "inherit" });
  const main = execFileSync("git", ["rev-parse", "refs/remotes/origin/main"], { cwd: dir, encoding: "utf8" }).trim();
  const followed = followMain(dir, base, main, message);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "moved.txt"), `${followed.decision} ${followed.main}\n`);
  if (followed.decision === "unmoved") console.log(`main is still ${base}`);
  else if (followed.decision === "rebased") console.log(`main moved from ${base} to ${main}, touching nothing the run generated or was made from: the run's change is now one commit on it`);
  else {
    console.log(`main moved from ${base} to ${main}, touching ${followed.clashes.join(", ")}: the branch is left as it was`);
    writeFileSync(join(out, "moved.md"), `${leftComment(followed, process.env.RUN_URL ?? "this run")}\n`);
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("moved.ts")) main();
