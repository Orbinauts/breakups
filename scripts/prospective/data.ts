import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { archiveHome } from "../archive/archive.ts";
import { historyDir } from "../archive/pull.ts";
import { CITATION, DEFAULT_BASE_URL as ARCHIVE_BASE_URL, download as downloadArchive, fetchTo, sha256File, type ReleaseManifest } from "../archive/release.ts";

/**
 * The prospective test's own data, kept as assets of the release
 * `prospective-data` of this repository, since the scheduled workflow that
 * runs the test starts every day on an empty runner. The release holds the
 * frozen detector's states at the end of each closed year
 * (`states-<year>.json.gz`, the replay of the next year starts from them)
 * with a text saying what made them (`states-<year>.provenance.txt`), the
 * day slices pulled from the catalogue's history class for each year the
 * test has replayed (`history-<year>.tar`, the kept days with their
 * modification times, which say which days had settled when they were
 * kept, so a day kept for good is never asked for again), and
 * `manifest.json`, naming each asset's size and SHA-256.
 *
 * `npm run prospective:data -- download` fetches the manifest, every
 * states file and the history of the years the day's run will replay into
 * the Archive (`BREAKUPS_ARCHIVE`), verifying each hash, then the Archive's
 * own release: every year before the first replayed one, and the side
 * files. `npm run prospective:data -- upload` tars every year's history
 * under the Archive, and uploads with the GitHub CLI, `--clobber`, every
 * states file, provenance and history whose hash the release's manifest
 * does not already name, then the manifest, creating the release if need
 * be; it is how the release was seeded from the maintainer's Archive and
 * how the workflow keeps it after each run. Both go through the GitHub CLI
 * (`gh`, authenticated, `GH_REPO` naming another repository than this
 * one), which reads an asset by its id: the release's public download
 * links may serve a replaced asset's old bytes for a while.
 */

export const DATA_TAG = "prospective-data";
/** The repository whose release holds the data: the CLI's `GH_REPO` where it is set. */
const repository = (): string => process.env.GH_REPO ?? "Orbinauts/breakups";
/** The days of a new year whose history may be missing from the release: they are pulled whole, a request each. */
export const BOOTSTRAP_DAYS = 7;

export type DataKind = "states" | "provenance" | "history";

export interface DataAsset {
  file: string;
  kind: DataKind;
  year: number;
  bytes: number;
  sha256: string;
  /** For a year's history: how many days it holds, and the last. */
  days?: number;
  through?: string;
}

export interface DataManifest {
  format: 1;
  tag: typeof DATA_TAG;
  assets: Record<string, DataAsset>;
  citation: string;
  writtenAt: string;
}

/** Where the test keeps its states under the Archive, as the daily run reads and writes them. */
export const statesDirOf = (archive: string): string => join(archive, "prospective", "states");
export const statesFileOf = (archive: string, year: number): string => join(statesDirOf(archive), `${year}.json.gz`);
export const provenanceFileOf = (archive: string, year: number): string => join(statesDirOf(archive), `${year}.provenance.txt`);

/** The asset's name in the release for a kind and year. */
export function assetName(kind: DataKind, year: number): string {
  if (kind === "states") return `states-${year}.json.gz`;
  if (kind === "provenance") return `states-${year}.provenance.txt`;
  return `history-${year}.tar`;
}

/** The years a run replays: the current one, and the previous one while its end states are not yet kept. */
export const replayYearsOf = (year: number, previousStatesKept: boolean): number[] => (previousStatesKept ? [year] : [year - 1, year]);

export const emptyManifest = (): DataManifest => ({ format: 1, tag: DATA_TAG, assets: {}, citation: CITATION, writtenAt: "" });

const yearsOfKind = (manifest: DataManifest, kind: DataKind): Set<number> => new Set(Object.values(manifest.assets).filter((asset) => asset.kind === kind).map((asset) => asset.year));

/** What a day's run needs on the runner: the years it replays, the history it pulls them onto, and the Archive's years before them. */
export interface Plan {
  replayYears: number[];
  /** The replayed years whose history the release holds, to download. */
  historyYears: number[];
  /** The Archive's released years before the first replayed one, to download; the catalogue index is read over all of them. */
  archiveYears: number[];
  /** The states files and their provenance, every one the release holds. */
  states: string[];
}

/**
 * The plan of a day's run from the two releases' manifests. It refuses,
 * by name, a first replayed year with no states to start from, a released
 * Archive with a gap before it, and a replayed year whose history the
 * release lacks, but for the current year in its first days, whose few
 * days are pulled whole.
 */
export function planOf(today: string, released: readonly number[], data: DataManifest): Plan {
  const year = Number(today.slice(0, 4));
  const states = yearsOfKind(data, "states");
  const replayYears = replayYearsOf(year, states.has(year - 1));
  const first = replayYears[0]!;
  if (!states.has(first - 1)) throw new Error(`the release ${DATA_TAG} holds no states to start ${first} from (${assetName("states", first - 1)})`);
  const archiveYears = released.filter((y) => y < first).sort((a, b) => a - b);
  if (archiveYears.length === 0) throw new Error(`the Archive's release holds no year before ${first}`);
  for (let y = archiveYears[0]!; y < first; y++) if (!archiveYears.includes(y)) throw new Error(`the Archive's release lacks ${y}, which the catalogue index reads with every other year: upload it (npm run archive:upload -- ${y})`);
  const history = yearsOfKind(data, "history");
  const firstDays = today < `${year}-01-${String(BOOTSTRAP_DAYS + 1).padStart(2, "0")}`;
  for (const y of replayYears) if (!history.has(y) && !(y === year && firstDays)) throw new Error(`the release ${DATA_TAG} holds no history of ${y} (${assetName("history", y)}): the run would pull the whole year again`);
  const stateFiles = Object.values(data.assets)
    .filter((asset) => asset.kind === "states" || asset.kind === "provenance")
    .map((asset) => asset.file)
    .sort();
  return { replayYears, historyYears: replayYears.filter((y) => history.has(y)), archiveYears, states: stateFiles };
}

/** The assets of a local set whose hash the manifest does not already name: those to upload. */
export function changedAssets(manifest: DataManifest, local: readonly DataAsset[]): DataAsset[] {
  return local.filter((asset) => manifest.assets[asset.file]?.sha256 !== asset.sha256);
}

/** A kept day's file name, the only files a year's history holds. */
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.json\.gz$/;

/** The day files of a year's history, by name. */
export const historyDays = (archive: string, year: number): string[] =>
  readdirSync(historyDir(archive, year))
    .filter((name) => DAY_FILE.test(name))
    .sort();

/**
 * A year's history as a tarball, its days listed by name so the same days
 * make the same archive on any machine, with their modification times
 * (which say whether a day was kept for good) and without the extended
 * attributes a Mac would add.
 */
export function tarHistory(archive: string, year: number, out: string): DataAsset {
  const days = historyDays(archive, year);
  if (days.length === 0) throw new Error(`no days kept under ${historyDir(archive, year)}`);
  const local = process.platform === "darwin" ? ["--no-xattrs", "--no-mac-metadata"] : [];
  execFileSync("tar", ["-cf", out, ...local, "-C", join(archive, "history"), ...days.map((day) => `${year}/${day}`)], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  return { file: assetName("history", year), kind: "history", year, bytes: statSync(out).size, sha256: sha256File(out), days: days.length, through: days.at(-1)!.slice(0, 10) };
}

/** A year's history put back from its tarball: the year's directory replaced whole, the days' modification times kept. */
export function untarHistory(archive: string, year: number, tarball: string): void {
  rmSync(historyDir(archive, year), { recursive: true, force: true });
  mkdirSync(join(archive, "history"), { recursive: true });
  execFileSync("tar", ["-xf", tarball, "-C", join(archive, "history")]);
  if (!existsSync(historyDir(archive, year))) throw new Error(`${tarball} holds no history of ${year}`);
}

/** The states files and their provenance kept under the Archive, as assets. */
export function localStates(archive: string): DataAsset[] {
  const dir = statesDirOf(archive);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((name): DataAsset[] => {
      const m = /^(\d{4})\.(json\.gz|provenance\.txt)$/.exec(name);
      if (m === null) return [];
      const kind: DataKind = m[2] === "json.gz" ? "states" : "provenance";
      const path = join(dir, name);
      return [{ file: assetName(kind, Number(m[1])), kind, year: Number(m[1]), bytes: statSync(path).size, sha256: sha256File(path) }];
    });
}

/** Where a states asset lands under the Archive. */
const localPathOf = (archive: string, asset: DataAsset): string => (asset.kind === "states" ? statesFileOf(archive, asset.year) : provenanceFileOf(archive, asset.year));

/** A release asset fetched to a path with the GitHub CLI. */
export function fetchAsset(file: string, path: string): void {
  execFileSync("gh", ["release", "download", DATA_TAG, "--repo", repository(), "--pattern", file, "--output", path, "--clobber"], { stdio: ["ignore", "inherit", "inherit"] });
}

/** An asset fetched to a path and checked against the manifest's hash, put in place only once it matches. */
export function fetchVerified(asset: DataAsset, path: string): void {
  const partial = `${path}.partial`;
  fetchAsset(asset.file, partial);
  const sha = sha256File(partial);
  if (sha !== asset.sha256) {
    rmSync(partial, { force: true });
    throw new Error(`${asset.file}: sha256 ${sha} is not the manifest's ${asset.sha256}`);
  }
  renameSync(partial, path);
}

/** What a day's run needs, fetched and verified: the test's states and history, then the Archive's years before the first replayed one and its side files. */
export async function download(archive: string, today: string): Promise<Plan> {
  mkdirSync(statesDirOf(archive), { recursive: true });
  const work = join(archive, "prospective", "release");
  mkdirSync(work, { recursive: true });
  const manifestPath = join(work, "manifest.json");
  fetchAsset("manifest.json", manifestPath);
  const data = JSON.parse(readFileSync(manifestPath, "utf8")) as DataManifest;
  const releasedPath = join(work, "archive-manifest.json");
  await fetchTo(`${process.env.ARCHIVE_BASE_URL ?? ARCHIVE_BASE_URL}/manifest.json`, releasedPath);
  const released = Object.keys((JSON.parse(readFileSync(releasedPath, "utf8")) as ReleaseManifest).years).map(Number);
  const plan = planOf(today, released, data);
  console.log(`replaying ${plan.replayYears.join(" and ")}; the Archive's years ${plan.archiveYears[0]} to ${plan.archiveYears.at(-1)}; history of ${plan.historyYears.join(", ") || "no year"}`);
  for (const file of plan.states) {
    const asset = data.assets[file]!;
    fetchVerified(asset, localPathOf(archive, asset));
    console.log(`${file}: ${(asset.bytes / 1e6).toFixed(1)} MB, verified`);
  }
  for (const year of plan.historyYears) {
    const asset = data.assets[assetName("history", year)]!;
    const tarball = join(work, asset.file);
    fetchVerified(asset, tarball);
    untarHistory(archive, year, tarball);
    rmSync(tarball);
    console.log(`${asset.file}: ${asset.days} days through ${asset.through}, verified`);
  }
  await downloadArchive(archive, plan.archiveYears, false);
  return plan;
}

function releaseExists(): boolean {
  try {
    execFileSync("gh", ["release", "view", DATA_TAG, "--repo", repository(), "--json", "tagName"], { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

/** The release's manifest as it stands, or an empty one where there is no release yet; a release without its manifest is refused by the fetch. */
function remoteManifest(work: string): DataManifest {
  if (!releaseExists()) return emptyManifest();
  const path = join(work, "manifest.remote.json");
  fetchAsset("manifest.json", path);
  return JSON.parse(readFileSync(path, "utf8")) as DataManifest;
}

/** Every year's history and every states file under the Archive uploaded where the release does not already hold it, then the manifest. */
export function upload(archive: string): DataAsset[] {
  const work = join(archive, "prospective", "release");
  mkdirSync(work, { recursive: true });
  const manifest = remoteManifest(work);
  const paths = new Map<string, string>();
  const local: DataAsset[] = [];
  for (const asset of localStates(archive)) {
    local.push(asset);
    paths.set(asset.file, localPathOf(archive, asset));
  }
  const history = join(archive, "history");
  const years = existsSync(history) ? readdirSync(history).filter((name) => /^\d{4}$/.test(name)) : [];
  for (const name of years.sort()) {
    const out = join(work, assetName("history", Number(name)));
    local.push(tarHistory(archive, Number(name), out));
    paths.set(assetName("history", Number(name)), out);
  }
  const changed = changedAssets(manifest, local);
  if (!releaseExists()) {
    execFileSync("gh", ["release", "create", DATA_TAG, "--repo", repository(), "--latest=false", "--title", "The prospective test's data", "--notes", `The prospective test's own data, which its scheduled workflow downloads each day and keeps up to date: the frozen detector's states at the end of each closed year with a text saying what made them, the day slices of each year the test has replayed, pulled from the public catalogue's history class, and a manifest of their sizes and hashes. ${CITATION}`], { stdio: "inherit" });
  }
  for (const asset of changed) {
    // The CLI names an asset after its file: each is staged under its asset's name.
    const staged = join(work, asset.file);
    if (paths.get(asset.file) !== staged) copyFileSync(paths.get(asset.file)!, staged);
    execFileSync("gh", ["release", "upload", DATA_TAG, "--repo", repository(), staged, "--clobber"], { stdio: "inherit" });
    rmSync(staged);
    manifest.assets[asset.file] = asset;
    console.log(`${asset.file}: ${(asset.bytes / 1e6).toFixed(1)} MB, sha256 ${asset.sha256}, uploaded`);
  }
  manifest.citation = CITATION;
  manifest.writtenAt = new Date().toISOString();
  const manifestPath = join(work, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  execFileSync("gh", ["release", "upload", DATA_TAG, "--repo", repository(), manifestPath, "--clobber"], { stdio: "inherit" });
  for (const name of years) rmSync(join(work, assetName("history", Number(name))), { force: true });
  console.log(`${changed.length} of ${local.length} assets uploaded, and the manifest`);
  return changed;
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("prospective/data.ts")) {
  const [command] = process.argv.slice(2);
  const archive = archiveHome();
  if (command === "download") await download(archive, new Date().toISOString().slice(0, 10));
  else if (command === "upload") upload(archive);
  else throw new Error("usage: data.ts download | upload");
}
