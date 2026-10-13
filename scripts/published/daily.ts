import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveHome } from "../archive/archive.ts";
import { git } from "../git.ts";
import { readJsonl } from "../prospective/alerts.ts";
import { placesOf, runUrlOf, type RunLine } from "../prospective/run.ts";
import { publishedRun } from "./cli.ts";
import { PUBLISHED_DIR } from "./files.ts";

/**
 * The daily job's publishing, run after the prospective test has logged and
 * pushed its run: the replay that run made, read from the day's scratch
 * directory it left in the Archive, is published against main's ground
 * truth into a worktree of the `published` branch, committed there and
 * pushed.
 *
 *   npm run published:daily
 *
 * The run is the last line of the `prospective` branch's `runs.jsonl`: its
 * day names the scratch directory and its years the year files. It reads
 * nothing the prospective run writes after it and writes nothing the run
 * reads, so the run's own log, score and checks are what they were without
 * it, and a failure here leaves the alerts committed. The worktree must be
 * on the `published` branch and clean; a failure before the commit puts it
 * back as it was. A commit that could not be pushed fails the job and is
 * lost with the runner: the next run checks out the remote's `published`
 * afresh and rebuilds the files on it from that day's replay of the whole
 * year, so the list catches up, but the lost commit's day never appears
 * in the branch's history.
 *
 * Places, as the prospective run's: `BREAKUPS_ARCHIVE`, `BREAKUPS_PROSPECTIVE`,
 * and `BREAKUPS_PUBLISHED` (by default `../breakups-published`) for the
 * worktree of the `published` branch.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The branch the published files live on. */
export const PUBLISHED_BRANCH = "published";

export interface DailyPlaces {
  /** This repository, whose `data/breakups.json` is main's ground truth. */
  root: string;
  /** The Archive the replay read. */
  archive: string;
  /** The prospective test's directory under the Archive, holding each day's scratch. */
  home: string;
  /** The worktree of the `prospective` branch. */
  branch: string;
  /** The worktree of the `published` branch. */
  published: string;
}

export function dailyPlacesOf(archive = archiveHome(), env: NodeJS.ProcessEnv = process.env): DailyPlaces {
  const { root, home, branch } = placesOf(archive, env);
  return { root, archive, home, branch, published: resolve(env.BREAKUPS_PUBLISHED ?? resolve(ROOT, "../breakups-published")) };
}

/** The year files of the run the `prospective` branch logged last, from the day's scratch directory. */
export function loggedRunOf(places: Pick<DailyPlaces, "home" | "branch">): { date: string; yearFiles: string[] } {
  const runs = readJsonl<Pick<RunLine, "date" | "years">>(join(places.branch, "runs.jsonl"));
  const last = runs[runs.length - 1];
  if (last === undefined) throw new Error(`no run logged in ${join(places.branch, "runs.jsonl")}: nothing to publish`);
  const yearFiles = last.years.map(({ year }) => join(places.home, last.date, "years", `${year}.json.gz`));
  const missing = yearFiles.find((path) => !existsSync(path));
  if (missing !== undefined) throw new Error(`no year file of the run of ${last.date} at ${missing}: its scratch directory is gone or the replay did not write it`);
  return { date: last.date, yearFiles };
}

/**
 * Writes the files, commits `v1/` with the message made from what the
 * writing said, then pushes; the worktree is put back at its last commit if
 * anything before the commit fails.
 */
function commitPublished(checkout: string, write: () => string, message: (summary: string) => { title: string; body: string }): { summary: string; commit: string } {
  let summary: string;
  try {
    summary = write();
    const { title, body } = message(summary);
    git(checkout, "add", "--all", "--", PUBLISHED_DIR);
    git(checkout, "commit", "-q", "-m", title, "-m", body);
  } catch (error) {
    try {
      git(checkout, "reset", "-q", "--hard", "HEAD");
      git(checkout, "clean", "-q", "-fd", "--", PUBLISHED_DIR);
    } catch {
      // A worktree left changed is refused by the next run's check.
    }
    throw error;
  }
  const commit = git(checkout, "rev-parse", "HEAD");
  // A failed push fails the job; on a fresh runner the commit is lost, and the next run rebuilds from the remote's `published`.
  git(checkout, "push", "-q");
  return { summary, commit };
}

/** Publishes the replay of the run logged last into the `published` worktree, commits and pushes it, and says what it did. */
export function publishDaily(places: DailyPlaces, now: number, context: { runUrl: string | null } = { runUrl: runUrlOf(process.env) }): { summary: string; commit: string } {
  const { published } = places;
  if (!existsSync(published)) throw new Error(`no worktree of the ${PUBLISHED_BRANCH} branch at ${published}: the 2025 seed makes the branch, and a checkout of it goes there`);
  if (git(published, "symbolic-ref", "--short", "HEAD") !== PUBLISHED_BRANCH) throw new Error(`${published} is not on the ${PUBLISHED_BRANCH} branch`);
  if (git(published, "status", "--porcelain") !== "") throw new Error(`the ${PUBLISHED_BRANCH} worktree ${published} has changes: commit or remove them first`);
  git(published, "pull", "-q", "--ff-only");

  const { date, yearFiles } = loggedRunOf(places);
  return commitPublished(
    published,
    () => publishedRun({ yearFiles, truth: join(places.root, "data", "breakups.json"), out: published, archive: places.archive, now }),
    (summary) => ({
      title: `Published breakups of ${date}`,
      body: `The frozen detector's replay of the run of ${date}, landed on main's ground truth: ${summary}.${context.runUrl === null ? "" : ` It ran as ${context.runUrl}.`}`,
    }),
  );
}

function main(): void {
  const { summary, commit } = publishDaily(dailyPlacesOf(), Date.now());
  console.log(`${summary}; committed ${commit.slice(0, 7)} to ${PUBLISHED_BRANCH} and pushed`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("published/daily.ts")) {
  try {
    main();
  } catch (error) {
    console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
