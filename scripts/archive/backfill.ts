import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { annotateBodies } from "./annotate.ts";
import { archiveHome, sha256File, writeYear, yearDir, type HistorySource } from "./archive.ts";
import { latestGcat } from "./gcat.ts";
import { dayAfter, dayQuery, historyDir, historyYear, keepDay, keptHead } from "./pull.ts";
import { CITATION, DEFAULT_BASE_URL, download as downloadArchive, fetchTo, upload as uploadArchive, type ReleaseManifest } from "./release.ts";
import { latestSatcat } from "./satcat.ts";
import { BACKFILL_SPACING_SECONDS, credentialsFromEnv, MAX_REQUESTS, SpaceTrack } from "./space-track.ts";
import { EARLIEST_YEAR, FRESH_VALIDATION } from "./years.ts";

/**
 * The backfill of the years before the Archive's first from the
 * catalogue's history class, run by the scheduled workflow `backfill.yml`
 * a slab at a time until the fresh validation's years (`years.ts`) are in
 * the Archive's release, then never again (the thirteenth decision record).
 * The catalogue's public folder of yearly bundles starts at 2005, so these
 * years can only be pulled a day of epochs at a time, as the daily run
 * pulls the current year (`pull.ts`), and the account also serves the
 * owner's other uses and the daily run: a run pulls at `BACKFILL_SPACING_SECONDS`, a
 * hundred requests an hour at most, stops at the client's cap or at its
 * own time limit, and keeps what it pulled on a release of its own,
 * `backfill-data`, so the next run goes on from there and no request is
 * made twice:
 *
 * - `history-<year>.tar`: the year's day slices as the pull keeps them,
 *   each marked with the time it was pulled, with `empty.json` beside
 *   them, how many times each day that answered no set was asked (a
 *   closed year's day is asked at most `EMPTY_ATTEMPTS` times, then
 *   counts missing: the catalogue answers an error, not an empty list, to
 *   a bad query, so an empty answer twice is the catalogue's own gap);
 * - `archive-v1-<year>.tar`: the year built from its slices once every
 *   day is kept, on the epoch clock (`historyYear`), its body table
 *   annotated as the yearly promotion annotates one, in the Archive's
 *   own layout, so the finish needs no rebuild;
 * - `ledger.log`: every request the backfill made, appended run by run,
 *   so the budget is read from one file;
 * - `manifest.json`: each asset's size and SHA-256, and when the backfill
 *   finished.
 *
 * The built years go to the Archive's release all at once, never one by
 * one: the daily run downloads every released year before the one it
 * replays and refuses a gap between them, and the release's catalogue
 * index must describe every released year. So once every year is built,
 * a run finishes instead of pulling: it downloads the whole Archive, puts
 * the built years in, fetches the space weather from the earliest year,
 * rebuilds the catalogue index and uploads the years, the side files and
 * the manifest together (`release.ts`). The scorecard leaves the years
 * below its first unscored until the rule that reads them lands
 * (`scoredYears`), so the upload moves no number.
 *
 * `npm run archive:backfill -- [--max-minutes <n>] [--years <from>-<through>]`.
 */

export const BACKFILL_TAG = "backfill-data";
/** How many times a day of a closed year that answers no set is asked before it counts missing. */
export const EMPTY_ATTEMPTS = 2;
/** The minutes a run pulls for before it stops to keep what it has, well inside GitHub's six hours with the upload to come. */
export const DEFAULT_MAX_MINUTES = 270;

const repository = (): string => process.env.GH_REPO ?? "Orbinauts/breakups";

/** The years the backfill pulls: the fresh validation's warm-up through its last. */
export const backfillYears = (): number[] => Array.from({ length: FRESH_VALIDATION.through - EARLIEST_YEAR + 1 }, (_, i) => EARLIEST_YEAR + i);

/** Every day of a year, in order. */
export function daysOf(year: number): string[] {
  const days: string[] = [];
  for (let day = `${year}-01-01`; day.startsWith(String(year)); day = dayAfter(day)) days.push(day);
  return days;
}

/** How many times each empty day of a year was asked: `history/<year>/empty.json`. */
export type EmptyAttempts = Record<string, number>;
const emptyPath = (archive: string, year: number): string => join(historyDir(archive, year), "empty.json");
export const readAttempts = (archive: string, year: number): EmptyAttempts => (existsSync(emptyPath(archive, year)) ? (JSON.parse(readFileSync(emptyPath(archive, year), "utf8")) as EmptyAttempts) : {});
export function writeAttempts(archive: string, year: number, attempts: EmptyAttempts): void {
  mkdirSync(historyDir(archive, year), { recursive: true });
  writeFileSync(emptyPath(archive, year), `${JSON.stringify(attempts, null, 2)}\n`);
}

/**
 * The days of a closed year still to pull: those not kept, and those kept
 * empty and asked fewer than `EMPTY_ATTEMPTS` times. A kept day with sets
 * is kept for good whenever it was pulled: the year is closed, so nothing
 * is published for it any more.
 */
export function backfillDaysToPull(archive: string, year: number, attempts: EmptyAttempts = readAttempts(archive, year), days: readonly string[] = daysOf(year)): string[] {
  const dir = historyDir(archive, year);
  return days.filter((day) => {
    const kept = join(dir, `${day}.json.gz`);
    if (!existsSync(kept)) return true;
    const head = keptHead(kept);
    if (!head.empty) return false;
    return (attempts[day] ?? 0) < EMPTY_ATTEMPTS;
  });
}

/** Whether every day of a closed year is kept, with sets or asked empty enough times. */
export const yearComplete = (archive: string, year: number, days: readonly string[] = daysOf(year)): boolean => backfillDaysToPull(archive, year, readAttempts(archive, year), days).length === 0;

export interface HistoryAsset {
  file: string;
  bytes: number;
  sha256: string;
  /** The days kept, those kept empty, and the last day kept. */
  days: number;
  empty: number;
  through: string | null;
}

export interface BuiltAsset {
  file: string;
  bytes: number;
  sha256: string;
  sets: number;
  bodies: number;
  /** The days the catalogue answered empty, which the year lacks. */
  missing: string[];
  builtAt: string;
}

export interface BackfillManifest {
  format: 1;
  tag: typeof BACKFILL_TAG;
  history: Record<string, HistoryAsset>;
  years: Record<string, BuiltAsset>;
  /** When the built years, the side files and the index went to the Archive's release; null until then. */
  finishedAt: string | null;
  citation: string;
  writtenAt: string;
}

export const emptyManifest = (): BackfillManifest => ({ format: 1, tag: BACKFILL_TAG, history: {}, years: {}, finishedAt: null, citation: CITATION, writtenAt: "" });

/** What a run does: pull the first year not yet built, finish once every year is built, or nothing once finished. */
export type Step = { kind: "pull"; year: number } | { kind: "finish" } | { kind: "done" };

export function nextStep(manifest: Pick<BackfillManifest, "years" | "finishedAt">, years: readonly number[]): Step {
  if (manifest.finishedAt !== null) return { kind: "done" };
  const pending = years.find((year) => manifest.years[String(year)] === undefined);
  return pending === undefined ? { kind: "finish" } : { kind: "pull", year: pending };
}

export const historyAssetName = (year: number): string => `history-${year}.tar`;
export const yearAssetName = (year: number): string => `archive-v1-${year}.tar`;
const LEDGER_ASSET = "ledger.log";

function releaseExists(): boolean {
  try {
    execFileSync("gh", ["release", "view", BACKFILL_TAG, "--repo", repository(), "--json", "tagName"], { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

function fetchAsset(file: string, path: string): void {
  execFileSync("gh", ["release", "download", BACKFILL_TAG, "--repo", repository(), "--pattern", file, "--output", path, "--clobber"], { stdio: ["ignore", "inherit", "inherit"] });
}

/** An asset fetched and checked against the manifest's hash, put in place only once it matches. */
function fetchVerified(asset: { file: string; sha256: string }, path: string): void {
  const partial = `${path}.partial`;
  fetchAsset(asset.file, partial);
  const sha = sha256File(partial);
  if (sha !== asset.sha256) {
    rmSync(partial, { force: true });
    throw new Error(`${asset.file}: sha256 ${sha} is not the manifest's ${asset.sha256}`);
  }
  renameSync(partial, path);
}

function uploadAsset(path: string): void {
  execFileSync("gh", ["release", "upload", BACKFILL_TAG, "--repo", repository(), path, "--clobber"], { stdio: "inherit" });
}

/** The release's manifest as it stands, or an empty one where there is no release yet. */
function remoteManifest(work: string): BackfillManifest {
  if (!releaseExists()) return emptyManifest();
  const path = join(work, "manifest.remote.json");
  fetchAsset("manifest.json", path);
  return JSON.parse(readFileSync(path, "utf8")) as BackfillManifest;
}

function ensureRelease(): void {
  if (releaseExists()) return;
  execFileSync("gh", ["release", "create", BACKFILL_TAG, "--repo", repository(), "--latest=false", "--title", "The backfill of the years before the Archive's first", "--notes", `The day slices pulled from the public catalogue's history class for the fresh validation's years, the years built from them, the ledger of every request, and a manifest of their sizes and hashes; kept between the runs of the backfill workflow, and deleted once the years are in the Archive's release. ${CITATION}`], { stdio: "inherit" });
}

function writeManifest(work: string, manifest: BackfillManifest): void {
  manifest.citation = CITATION;
  manifest.writtenAt = new Date().toISOString();
  const path = join(work, "manifest.json");
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  ensureRelease();
  uploadAsset(path);
}

/** A year's history directory as a tarball, `empty.json` included, without a Mac's extended attributes. */
export function tarHistory(archive: string, year: number, out: string): HistoryAsset {
  const dir = historyDir(archive, year);
  const local = process.platform === "darwin" ? ["--no-xattrs", "--no-mac-metadata"] : [];
  execFileSync("tar", ["-cf", out, ...local, "-C", join(archive, "history"), String(year)], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const kept = daysOf(year).filter((day) => existsSync(join(dir, `${day}.json.gz`)));
  const empty = kept.filter((day) => keptHead(join(dir, `${day}.json.gz`)).empty);
  return { file: historyAssetName(year), bytes: statSync(out).size, sha256: sha256File(out), days: kept.length, empty: empty.length, through: kept.at(-1) ?? null };
}

function untarHistory(archive: string, year: number, tarball: string): void {
  rmSync(historyDir(archive, year), { recursive: true, force: true });
  mkdirSync(join(archive, "history"), { recursive: true });
  execFileSync("tar", ["-xf", tarball, "-C", join(archive, "history")]);
  if (!existsSync(historyDir(archive, year))) throw new Error(`${tarball} holds no history of ${year}`);
}

/** Why a pull stopped: every day kept, the client's cap, or the run's time limit. */
export type Stopped = "done" | "cap" | "time";

/** The days of a year pulled in order until none is left, the cap or the deadline; each answer kept as it comes, an empty one counted against the day. */
export async function pullYear(archive: string, year: number, client: SpaceTrack, deadline: number): Promise<{ pulled: number; stopped: Stopped }> {
  const attempts = readAttempts(archive, year);
  let pulled = 0;
  for (const day of backfillDaysToPull(archive, year, attempts)) {
    if (client.atCap) return { pulled, stopped: "cap" };
    if (Date.now() >= deadline) return { pulled, stopped: "time" };
    const kept = join(historyDir(archive, year), `${day}.json.gz`);
    const answer = `${kept}.again`;
    rmSync(answer, { force: true });
    const askedAt = Date.now();
    const { rows } = await client.rows<unknown>(answer, dayQuery(day, dayAfter(day)));
    keepDay(kept, rows, askedAt);
    rmSync(answer);
    pulled++;
    if (rows.length === 0) {
      attempts[day] = (attempts[day] ?? 0) + 1;
      writeAttempts(archive, year, attempts);
    }
    console.log(`${day}: ${rows.length} sets${rows.length === 0 ? ` (asked ${attempts[day]} of ${EMPTY_ATTEMPTS} times)` : ""}`);
  }
  return { pulled, stopped: "done" };
}

/** A complete year built from its slices on the epoch clock, annotated, written into the Archive and tarred in the release's layout. */
export function buildYear(archive: string, year: number, out: string): BuiltAsset {
  const satcat = latestSatcat(archive);
  const gcat = latestGcat(archive);
  if (satcat === null || gcat === null) throw new Error(`the Archive lacks a satellite or payload catalogue snapshot under ${archive}: download the side files first (npm run archive:download)`);
  const built = historyYear(archive, year, "epoch");
  const source = built.manifest.source as HistorySource;
  if (source.from !== `${year}-01-01` || source.through !== `${year}-12-31`) throw new Error(`the slices of ${year} run from ${source.from} through ${source.through}, not the whole year`);
  writeYear(archive, { ...built, bodies: annotateBodies(built.bodies, satcat.rows, gcat.rows) });
  execFileSync("tar", ["-cf", out, "-C", archive, String(year)]);
  return { file: yearAssetName(year), bytes: statSync(out).size, sha256: sha256File(out), sets: built.manifest.sets, bodies: built.manifest.bodies, missing: source.missing, builtAt: built.manifest.builtAt };
}

/** A year's history tarred and uploaded where the release does not hold it as it stands. */
function keepHistory(archive: string, work: string, manifest: BackfillManifest, year: number): void {
  if (!existsSync(historyDir(archive, year))) return;
  const out = join(work, historyAssetName(year));
  const asset = tarHistory(archive, year, out);
  if (manifest.history[String(year)]?.sha256 !== asset.sha256) {
    ensureRelease();
    uploadAsset(out);
    manifest.history[String(year)] = asset;
    console.log(`${asset.file}: ${(asset.bytes / 1e6).toFixed(1)} MB, ${asset.days} days (${asset.empty} empty), uploaded`);
  }
  rmSync(out);
}

/** The run's requests appended to the release's ledger. */
function keepLedger(archive: string, work: string): void {
  const local = join(archive, "requests.log");
  if (!existsSync(local)) return;
  const path = join(work, LEDGER_ASSET);
  if (releaseExists()) {
    try {
      fetchAsset(LEDGER_ASSET, path);
    } catch {
      writeFileSync(path, "");
    }
  } else writeFileSync(path, "");
  writeFileSync(path, readFileSync(path, "utf8") + readFileSync(local, "utf8"));
  uploadAsset(path);
}

/** One run of the pull: the first year not built, pulled on from its kept slices until the cap or the deadline, kept to the release, and built once complete; on to the next year while the budget lasts. */
export async function pullRun(archive: string, years: readonly number[], maxMinutes: number): Promise<void> {
  const work = join(archive, "backfill");
  mkdirSync(work, { recursive: true });
  const manifest = remoteManifest(work);
  const client = new SpaceTrack(credentialsFromEnv(), archive, { spacingSeconds: BACKFILL_SPACING_SECONDS, maxRequests: MAX_REQUESTS });
  const deadline = Date.now() + maxMinutes * 60_000;
  let step = nextStep(manifest, years);
  while (step.kind === "pull") {
    const year = step.year;
    const history = manifest.history[String(year)];
    if (history !== undefined && !existsSync(historyDir(archive, year))) {
      const tarball = join(work, history.file);
      fetchVerified(history, tarball);
      untarHistory(archive, year, tarball);
      rmSync(tarball);
      console.log(`${history.file}: ${history.days} days (${history.empty} empty) through ${history.through}, verified`);
    }
    const toPull = backfillDaysToPull(archive, year).length;
    console.log(`${year}: ${toPull} days to pull, ${client.made} requests made this run`);
    // Whatever stops the pull, a fault of the catalogue's included, the days kept so far go to the release: no request is made twice.
    let outcome: { pulled: number; stopped: Stopped };
    try {
      outcome = await pullYear(archive, year, client, deadline);
    } catch (error) {
      keepHistory(archive, work, manifest, year);
      keepLedger(archive, work);
      writeManifest(work, manifest);
      throw error;
    }
    console.log(`${year}: ${outcome.pulled} days pulled this run; stopped: ${outcome.stopped}`);
    if (outcome.pulled > 0) keepHistory(archive, work, manifest, year);
    if (outcome.stopped !== "done") break;
    const out = join(work, yearAssetName(year));
    const built = buildYear(archive, year, out);
    ensureRelease();
    uploadAsset(out);
    rmSync(out);
    manifest.years[String(year)] = built;
    console.log(`${built.file}: ${built.sets} sets of ${built.bodies} objects, ${built.missing.length} days missing, ${(built.bytes / 1e6).toFixed(0)} MB, uploaded`);
    writeManifest(work, manifest);
    step = nextStep(manifest, years);
  }
  keepLedger(archive, work);
  writeManifest(work, manifest);
  const left = years.filter((year) => manifest.years[String(year)] === undefined);
  console.log(`${client.made} requests this run; ${left.length === 0 ? "every year is built: the next run finishes" : `${left.join(", ")} still to build`}`);
}

/** The finish: every released year and the built years in one Archive, the space weather from the earliest year, the index rebuilt, and all of it uploaded to the Archive's release together. */
export async function finishRun(archive: string, years: readonly number[]): Promise<void> {
  const work = join(archive, "backfill");
  mkdirSync(work, { recursive: true });
  const manifest = remoteManifest(work);
  if (nextStep(manifest, years).kind !== "finish") throw new Error("the backfill is not ready to finish: a year is not built, or it finished already");
  const releasedPath = join(work, "archive-manifest.json");
  await fetchTo(`${process.env.ARCHIVE_BASE_URL ?? DEFAULT_BASE_URL}/manifest.json`, releasedPath);
  const released = Object.keys((JSON.parse(readFileSync(releasedPath, "utf8")) as ReleaseManifest).years).map(Number);
  await downloadArchive(archive, released, false);
  for (const year of years) {
    const asset = manifest.years[String(year)]!;
    const tarball = join(work, asset.file);
    fetchVerified(asset, tarball);
    rmSync(yearDir(archive, year), { recursive: true, force: true });
    execFileSync("tar", ["-xf", tarball, "-C", archive]);
    rmSync(tarball);
    console.log(`${asset.file}: ${asset.sets} sets, verified, in the Archive`);
  }
  const root = join(import.meta.dirname, "..", "..");
  execFileSync("npm", ["run", "-s", "archive:space", "--", String(EARLIEST_YEAR)], { cwd: root, stdio: "inherit", env: { ...process.env, BREAKUPS_ARCHIVE: archive } });
  execFileSync("npm", ["run", "-s", "kpi:index"], { cwd: root, stdio: "inherit", env: { ...process.env, BREAKUPS_ARCHIVE: archive } });
  uploadArchive(archive, [...years]);
  manifest.finishedAt = new Date().toISOString();
  writeManifest(work, manifest);
  console.log(`finished: ${years[0]} to ${years.at(-1)} are in the Archive's release with the side files and the index`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (flag: string): string | undefined => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const maxMinutes = Number(value("--max-minutes") ?? DEFAULT_MAX_MINUTES);
  const span = value("--years");
  const years = span === undefined ? backfillYears() : (([from, through]) => Array.from({ length: through - from + 1 }, (_, i) => from + i))(span.split("-").map(Number) as [number, number]);
  const archive = archiveHome();
  const work = join(archive, "backfill");
  mkdirSync(work, { recursive: true });
  const step = nextStep(remoteManifest(work), years);
  console.log(`backfill of ${years[0]} to ${years.at(-1)}: ${step.kind === "pull" ? `pulling ${step.year}` : step.kind}`);
  if (step.kind === "pull") await pullRun(archive, years, maxMinutes);
  else if (step.kind === "finish") await finishRun(archive, years);
  else console.log("the backfill finished; the workflow and this release are to be removed");
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("backfill.ts")) await main();
