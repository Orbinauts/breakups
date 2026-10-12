import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { annotateBodies } from "../archive/annotate.ts";
import { archiveHome, readBodies, readManifest, satcatDir, yearDir, type Manifest } from "../archive/archive.ts";
import { latestGcat } from "../archive/gcat.ts";
import { daysToPull } from "../archive/pull.ts";
import { latestSatcat } from "../archive/satcat.ts";
import { spaceDir } from "../archive/space-weather.ts";
import type { YearFile } from "../kpi/kpi.ts";
import { installedVersions, type Versions } from "../pins/pins.ts";
import { alertsOf, jsonl, newAlerts, readJsonl, type LoggedAlert } from "./alerts.ts";
import { replayYearsOf } from "./data.ts";

/**
 * The prospective test's daily run: `npm run prospective`, from this
 * repository, which the scheduled workflow `.github/workflows/prospective.yml`
 * runs once a day on a fresh runner (it ran as a launchd agent on the
 * maintainer's machine on the test's first day). It keeps the
 * Archive's current year up to date and replays it through the detector
 * frozen at the tag `frozen-confirmed-v10`, never through the code on this
 * branch, then logs every alert raised after the freeze to the
 * `prospective` branch, whose commit time is the proof of when each alert
 * was known.
 *
 * In order: the satellite catalogue (CelesTrak, public) and the space
 * weather (GFZ and OMNI, public) are fetched, each at most once a day; the
 * current year is pulled from the catalogue's history class
 * (`npm run archive:pull`, only the days not yet kept and settled, about
 * two requests a day, throttled and written to the ledger
 * `requests.log`), and in the first days of a year the previous year too,
 * until it has settled; the pulled years' body tables are annotated with
 * the latest satellite and payload catalogues. Then, in the frozen
 * worktree (`../breakups-frozen`, a checkout of the tag), the catalogue
 * index is built over a view of the Archive kept for the test
 * (`<archive>/prospective/view`, the Archive's entries linked, with an
 * index of its own built from the frozen truth, so the index the work on
 * this branch builds is never the one the test reads, nor the other way
 * round), and the year is replayed from the states the frozen detector
 * ended the previous year with (`<archive>/prospective/states/`) into a
 * scratch directory, `<archive>/prospective/<day>/`, never into `kpi/`.
 * The verdicts raised after the freeze in the logged states are appended
 * to `alerts.jsonl` in the `prospective` branch's worktree
 * (`../breakups-prospective`), those already logged skipped, a line for
 * the run is appended to `runs.jsonl`, and the branch is committed and
 * pushed; a run with no new alert still commits its line. Once a year
 * has settled, its last replay's end states become the next year's start.
 *
 * Any failure stops the run with a non-zero exit and a line in
 * `<archive>/prospective/prospective.log`, and the branch's files are put
 * back as they were, so a run commits whole or not at all.
 *
 * The places are the environment's where it names them: the Archive
 * (`BREAKUPS_ARCHIVE`), the frozen checkout (`BREAKUPS_FROZEN`) and the
 * branch's (`BREAKUPS_PROSPECTIVE`), so the workflow runs the same code
 * over its own checkouts. Run by GitHub Actions, the run's URL
 * (`GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`) goes into its
 * line and its commit, a timestamp kept by another party than the branch's.
 * Wherever it runs, the tag must still name the commit it was made at
 * (`FROZEN_COMMIT`): a tag moved is refused, not followed.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The tag the test runs, and the detector it holds. */
export const FROZEN_TAG = "frozen-confirmed-v10";
/** The commit the tag was made at, the detector scored there; the tag naming any other is refused. */
export const FROZEN_COMMIT = "8729987b9d9890f071aff9a1df594f2daada8ed3";
export const FROZEN_DETECTOR = "confirmed-v10";
export const BRANCH = "prospective";
/** How many days' scratch directories are kept: each holds a year's file and its end states, a couple of hundred megabytes. */
export const KEEP_SCRATCH_DAYS = 7;

/**
 * Where the scorecard's runner writes a year's file and its end states
 * under an out directory. They are spelled here rather than imported from
 * `scripts/kpi/run.ts`, whose command would start on import from a script
 * of the same file name; the frozen runner writes them where it wrote them
 * at the tag.
 */
const yearFilePath = (out: string, year: number): string => join(out, "years", `${year}.json.gz`);
const endStatesPath = (out: string, year: number): string => join(out, "work", "states", `${year}.json.gz`);
const statesFileName = (year: number): string => `${year}.json.gz`;

export const readYearFile = (path: string): YearFile => JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as YearFile;

export interface Places {
  /** This repository. */
  root: string;
  /** The worktree checked out at the frozen tag. */
  frozen: string;
  /** The worktree of the `prospective` branch. */
  branch: string;
  archive: string;
  /** The test's own directory under the Archive. */
  home: string;
  /** The view of the Archive the frozen detector reads. */
  view: string;
  /** The frozen detector's states at the end of each settled year. */
  states: string;
}

export function placesOf(archive = archiveHome(), env: NodeJS.ProcessEnv = process.env): Places {
  const home = join(archive, "prospective");
  return {
    root: ROOT,
    frozen: resolve(env.BREAKUPS_FROZEN ?? resolve(ROOT, "../breakups-frozen")),
    branch: resolve(env.BREAKUPS_PROSPECTIVE ?? resolve(ROOT, "../breakups-prospective")),
    archive,
    home,
    view: join(home, "view"),
    states: join(home, "states"),
  };
}

/** One run's line in `runs.jsonl`. */
export interface RunLine {
  date: string;
  startedAt: string;
  durationSeconds: number;
  frozen: string;
  detector: string;
  years: { year: number; through: string; sets: number; runs: number; carried: boolean }[];
  setsReplayed: number;
  alertsFound: number;
  newAlerts: number;
  requests: number;
  satcat: string | null;
  node: string;
  /** The engine's and the propagators' versions the frozen detector ran on, read from its installed tree; absent from the lines made before they were recorded. */
  versions?: Versions;
  /** The GitHub Actions run that made the line, whose log is a second, independent timestamp; absent from the lines of runs made elsewhere. */
  runUrl?: string | null;
}

/** The URL of the GitHub Actions run the process is part of, or null outside one. */
export function runUrlOf(env: NodeJS.ProcessEnv): string | null {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: id, GITHUB_RUN_ATTEMPT: attempt } = env;
  if (server === undefined || repository === undefined || id === undefined || server === "" || repository === "" || id === "") return null;
  return `${server}/${repository}/actions/runs/${id}${attempt !== undefined && attempt !== "" && attempt !== "1" ? `/attempts/${attempt}` : ""}`;
}

/** Refuses a tag that no longer names the commit the test froze. */
export function checkTagged(tagged: string): void {
  if (tagged !== FROZEN_COMMIT) throw new Error(`the tag ${FROZEN_TAG} names ${tagged}, not ${FROZEN_COMMIT}, the commit the test froze: a moved tag is not the frozen detector`);
}

/** What a settled year's end states are and what made them, kept beside them and in the release with them. */
export function provenanceOf(year: number, context: { today: string; tagged: string; scratch: string; runUrl: string | null; sha256: string }): string {
  const where = context.runUrl === null ? `in ${context.scratch}` : `in ${context.scratch} by ${context.runUrl}`;
  return `${year}.json.gz is the detector ${FROZEN_DETECTOR}'s states at the end of ${year}, written on ${context.today} by the prospective test's daily run once ${year} had settled: the frozen commit ${context.tagged} replayed ${year} through ${year}-12-31 from its states at the end of ${year - 1}, ${where}. sha256 ${context.sha256}.\n`;
}

/** The last day a year of the Archive holds: a pulled year's last kept day, a bundle year's last. */
export const throughOf = (source: Manifest["source"], year: number): string => ("through" in source && typeof source.through === "string" ? source.through : `${year}-12-31`);

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): void {
  console.log(`\n$ ${command} ${args.join(" ")}    (in ${cwd})`);
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error !== undefined) throw new Error(`${command} ${args.join(" ")} in ${cwd}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} in ${cwd} exited with ${result.status ?? result.signal}`);
}

const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** The environment the frozen worktree runs in: the test's view of the Archive, and no catalogue credentials, which it never needs. */
export function frozenEnv(env: NodeJS.ProcessEnv, view: string): NodeJS.ProcessEnv {
  const kept = Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith("SPACETRACK_")));
  return { ...kept, BREAKUPS_ARCHIVE: view };
}

/**
 * The view of the Archive the frozen detector reads: a link to every entry
 * of the Archive but its own index and the test's directory, and an index
 * of its own, so the replay reads the same years and side files as every
 * other reader while the index it reads is built by the frozen code from
 * the frozen truth.
 */
export function refreshView(archive: string, view: string): void {
  mkdirSync(view, { recursive: true });
  const wanted = new Set(readdirSync(archive).filter((name) => name !== "prospective" && name !== "index"));
  for (const name of readdirSync(view)) {
    if (name === "index") continue;
    const path = join(view, name);
    if (!lstatSync(path).isSymbolicLink()) throw new Error(`${path} is not a link: the view holds only links to the Archive and its own index`);
    if (!wanted.has(name)) unlinkSync(path);
  }
  for (const name of wanted) {
    const path = join(view, name);
    let present = false;
    try {
      present = lstatSync(path).isSymbolicLink();
    } catch {
      present = false;
    }
    if (!present) symlinkSync(join(archive, name), path);
  }
}

/** The lines the request ledger holds, the count the run's requests are read from. */
function ledgerLines(archive: string): number {
  const path = join(archive, "requests.log");
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "").length : 0;
}

const modifiedOn = (path: string): string | null => (existsSync(path) ? new Date(statSync(path).mtimeMs).toISOString().slice(0, 10) : null);

/** A lock under the test's directory, so two runs never overlap; one left by a run that died is taken over. */
function acquireLock(home: string): string {
  const path = join(home, "run.lock");
  if (existsSync(path)) {
    const pid = Number(readFileSync(path, "utf8").trim());
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {
      alive = false;
    }
    if (alive) throw new Error(`another run (process ${pid}) holds ${path}`);
    unlinkSync(path);
  }
  writeFileSync(path, `${process.pid}\n`, { flag: "wx" });
  return path;
}

/** The scratch directories of days, oldest first, past the last `keep` removed. */
export function pruneScratch(home: string, keep = KEEP_SCRATCH_DAYS): string[] {
  const days = readdirSync(home)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort();
  const removed = days.slice(0, Math.max(0, days.length - keep));
  for (const day of removed) rmSync(join(home, day), { recursive: true, force: true });
  return removed;
}

/** Writes the branch's two files, commits and pushes them; the files are put back and the index reset if anything before the commit fails. */
function commitRun(branch: string, fresh: LoggedAlert[], line: RunLine, title: string, body: string): string {
  const files = ["alerts.jsonl", "runs.jsonl"].map((name) => join(branch, name));
  const before = files.map((path) => (existsSync(path) ? readFileSync(path, "utf8") : null));
  const ended = (text: string | null): string => (text === null || text === "" || text.endsWith("\n") ? (text ?? "") : `${text}\n`);
  try {
    writeFileSync(files[0]!, `${ended(before[0]!)}${jsonl(fresh)}`);
    writeFileSync(files[1]!, `${ended(before[1]!)}${jsonl([line])}`);
    git(branch, "add", "alerts.jsonl", "runs.jsonl");
    git(branch, "commit", "-q", "-m", title, "-m", body);
  } catch (error) {
    files.forEach((path, i) => (before[i] === null ? rmSync(path, { force: true }) : writeFileSync(path, before[i]!)));
    try {
      git(branch, "reset", "-q");
    } catch {
      // The files are back as they were; an index left staged is seen by the next run's check.
    }
    throw error;
  }
  const commit = git(branch, "rev-parse", "HEAD");
  // A commit made but not pushed is whole: the next run's push carries it.
  git(branch, "push", "-q");
  return commit;
}

function daily(places: Places, started: number): { line: RunLine; commit: string; fresh: LoggedAlert[] } {
  const today = new Date(started).toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const { root, frozen, branch, archive, home, view, states } = places;

  // The frozen worktree is the tag, untouched; the branch's worktree is the branch, clean and current.
  if (!existsSync(frozen)) throw new Error(`no frozen worktree at ${frozen}: git worktree add --detach ${frozen} ${FROZEN_TAG}`);
  const tagged = git(root, "rev-parse", `${FROZEN_TAG}^{commit}`);
  checkTagged(tagged);
  const head = git(frozen, "rev-parse", "HEAD");
  if (head !== tagged) throw new Error(`the frozen worktree ${frozen} is at ${head}, not at ${FROZEN_TAG} (${tagged})`);
  if (git(frozen, "status", "--porcelain") !== "") throw new Error(`the frozen worktree ${frozen} has changes: it must be the tag as committed`);
  if (!existsSync(branch)) throw new Error(`no worktree of the ${BRANCH} branch at ${branch}`);
  if (git(branch, "symbolic-ref", "--short", "HEAD") !== BRANCH) throw new Error(`${branch} is not on the ${BRANCH} branch`);
  if (git(branch, "status", "--porcelain") !== "") throw new Error(`the ${BRANCH} worktree ${branch} has changes: commit or remove them first`);
  run("git", ["pull", "-q", "--ff-only"], branch);

  // The years to replay: the current one, and the previous one while its last days settle.
  const replayYears = replayYearsOf(year, existsSync(join(states, statesFileName(year - 1))));
  const startStates = join(states, statesFileName(replayYears[0]! - 1));
  if (!existsSync(startStates)) throw new Error(`no frozen states to start ${replayYears[0]} from: ${startStates}`);

  const ledgerBefore = ledgerLines(archive);
  if (!existsSync(join(satcatDir(archive), `${today}.csv`))) run("npm", ["run", "-s", "archive:satcat"], root);
  if (modifiedOn(join(spaceDir(archive), `${year}.json`)) !== today) run("npm", ["run", "-s", "archive:space", "--", String(replayYears[0]), String(year)], root);
  for (const y of replayYears) run("npm", ["run", "-s", "archive:pull", "--", String(y), ...(y < year ? ["--through", `${y}-12-31`] : [])], root);

  // The pulled years' body tables, with the latest satellite catalogue's status and the payload catalogue's ends.
  const satcat = latestSatcat(archive);
  const gcat = latestGcat(archive);
  if (satcat === null || gcat === null) throw new Error(`the Archive lacks a satellite or payload catalogue snapshot under ${archive}`);
  for (const y of replayYears) writeFileSync(join(yearDir(archive, y), "bodies.json"), `${JSON.stringify(annotateBodies(readBodies(archive, y), satcat.rows, gcat.rows))}\n`);

  // The frozen detector: its own index over the view, then the replay into the day's scratch directory.
  const env = frozenEnv(process.env, view);
  refreshView(archive, view);
  run("npm", ["run", "-s", "kpi:index"], frozen, env);
  const scratch = join(home, today);
  rmSync(scratch, { recursive: true, force: true });
  run("npm", ["run", "-s", "kpi", "--", ...replayYears.flatMap((y) => ["--year", String(y)]), "--out", scratch, "--from-states", states], frozen, env);

  const files: YearFile[] = replayYears.map((y) => readYearFile(yearFilePath(scratch, y)));
  if (!files[0]!.carried) throw new Error(`the replay of ${files[0]!.year} warmed up rather than starting from ${startStates}`);
  for (const file of files) if (file.detector.name !== FROZEN_DETECTOR) throw new Error(`the replay of ${file.year} ran ${file.detector.name}, not ${FROZEN_DETECTOR}`);
  const found = files.flatMap((file) => alertsOf(file.verdicts, { year: file.year, loggedOn: today, frozen: tagged, detector: file.detector.name }));
  const fresh = newAlerts(readJsonl<LoggedAlert>(join(branch, "alerts.jsonl")), found);

  const line: RunLine = {
    date: today,
    startedAt: new Date(started).toISOString(),
    durationSeconds: Math.round((Date.now() - started) / 1000),
    frozen: tagged,
    detector: FROZEN_DETECTOR,
    years: files.map((file) => ({ year: file.year, through: throughOf(readManifest(archive, file.year).source, file.year), sets: file.sets, runs: file.runs, carried: file.carried })),
    setsReplayed: files.reduce((sum, file) => sum + file.sets, 0),
    alertsFound: found.length,
    newAlerts: fresh.length,
    requests: ledgerLines(archive) - ledgerBefore,
    satcat: satcat.day,
    node: process.version,
    versions: installedVersions(frozen),
    runUrl: runUrlOf(process.env),
  };
  const through = line.years.map((y) => `${y.year} through ${y.through}`).join(" and ");
  const body = `The frozen detector ${FROZEN_DETECTOR} (${tagged.slice(0, 7)}) replayed ${through}, ${line.setsReplayed} sets, and found ${fresh.length} new ${fresh.length === 1 ? "alert" : "alerts"} raised since the freeze, of ${found.length} in all. The run made ${line.requests} requests to the catalogue and took ${line.durationSeconds} seconds.${line.runUrl === null ? "" : ` It ran as ${line.runUrl}.`}`;
  const commit = commitRun(branch, fresh, line, `Alerts of ${today}`, body);

  // A settled year's last replay hands its end states to the next year, only once its alerts are committed.
  for (const y of replayYears) {
    if (y >= year || daysToPull(archive, y, `${y}-12-31`).length > 0) continue;
    const settled = join(states, statesFileName(y));
    copyFileSync(endStatesPath(scratch, y), `${settled}.copying`);
    const sha256 = createHash("sha256").update(readFileSync(`${settled}.copying`)).digest("hex");
    writeFileSync(join(states, `${y}.provenance.txt`), provenanceOf(y, { today, tagged, scratch, runUrl: line.runUrl ?? null, sha256 }));
    renameSync(`${settled}.copying`, settled);
    console.log(`${y} has settled: its end states are ${settled}`);
  }
  pruneScratch(home);
  return { line, commit, fresh };
}

function main(): void {
  const started = Date.now();
  const places = placesOf();
  mkdirSync(places.home, { recursive: true });
  const log = (text: string): void => appendFileSync(join(places.home, "prospective.log"), `${new Date().toISOString()} ${text}\n`);
  let lock: string | null = null;
  try {
    lock = acquireLock(places.home);
    const { line, commit, fresh } = daily(places, started);
    const summary = `ok ${line.date}: ${line.setsReplayed} sets replayed, ${line.alertsFound} alerts since the freeze, ${fresh.length} new, ${line.requests} requests, ${line.durationSeconds} s, committed ${commit.slice(0, 7)}`;
    log(summary);
    console.log(`\n${summary}`);
    for (const alert of fresh) console.log(`  ${alert.raisedAt} ${alert.kind} ${alert.state} ${alert.number ?? "-"} ${alert.launch ?? "-"}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`FAILED ${message.replace(/\s+/g, " ")}`);
    console.error(`\nFAILED: ${message}`);
    process.exitCode = 1;
  } finally {
    if (lock !== null) rmSync(lock, { force: true });
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("prospective/run.ts")) main();
