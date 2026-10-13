import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { assertFresh, readCatalogueIndex } from "../kpi/catalogue-index.ts";
import { archiveHome, builtYears, catalogueIndexPath, readManifest, releaseManifestPath, sha256File, yearDir } from "./archive.ts";
import { spaceDir } from "./space-weather.ts";

/**
 * The Archive as release assets of this repository: one tarball per built
 * year (`archive-v1-<year>.tar`, the year's gzipped columns, body table
 * and manifest), one for the side files (`archive-v1-side.tar`: the
 * space-weather days, the satellite catalogue snapshot, GCAT's payload
 * catalogue and the catalogue index the scorecard reads every year's
 * catalogue through), and `manifest.json` naming each asset's size and
 * SHA-256. `npm run archive:upload -- [years]` builds the tarballs and
 * uploads them with the GitHub CLI to the release `archive-v1`, creating
 * it if need be; `npm run archive:upload -- --side-only` builds and
 * uploads the side files and the manifest alone, the years as they were
 * released. Either refuses a catalogue index that is missing or does not
 * describe the years on disk. `npm run archive:download -- [years]
 * [--warmup]` fetches the manifest, the years asked and the side files
 * into the Archive, verifying each hash, from `ARCHIVE_BASE_URL` (default:
 * this repository's release), with an optional `ARCHIVE_AUTH_HEADER` for a
 * private store; with no years it fetches the side files alone.
 *
 * An upload starts from the release's own manifest, read with the CLI
 * (which reads an asset by its id, never a stale copy of its public link),
 * so a runner that holds only some of the years records them beside the
 * rest; it refuses a tarball over GitHub's 2 GiB limit on an asset before
 * it uploads anything.
 */

export const RELEASE_TAG = "archive-v1";
export const DEFAULT_BASE_URL = `https://github.com/Orbinauts/breakups/releases/download/${RELEASE_TAG}`;

export interface AssetRecord {
  file: string;
  bytes: number;
  sha256: string;
  /** For a year's tarball: the year's set count and build time, from its manifest. */
  sets?: number;
  builtAt?: string;
  /** For a year's tarball: the last day it holds (a bundle year's last, a pulled year's last kept day); absent from the records written before it was kept. */
  through?: string;
}

/** GitHub's limit on one release asset: a tarball larger than this is refused before anything is uploaded. */
export const ASSET_LIMIT_BYTES = 2 * 1024 ** 3;

export interface ReleaseManifest {
  format: 1;
  tag: string;
  years: Record<string, AssetRecord>;
  side: AssetRecord | null;
  citation: string;
  writtenAt: string;
}

/** What the Archive's data are and whence, as every release built from them cites it. */
export const CITATION = "Element sets from the public catalogue's yearly bundles and history, used under its blanket approval for redistribution of basic space-situational-awareness data with citation; space-weather indices from GFZ Potsdam (CC BY 4.0) and NASA OMNI2; the satellite catalogue from CelesTrak; the payloads' end of transmission from GCAT (J. McDowell, planet4589.org, CC-BY-4.0).";

const yearAsset = (year: number): string => `${RELEASE_TAG}-${year}.tar`;
const SIDE_ASSET = `${RELEASE_TAG}-side.tar`;

/** The hash of the side files a download last extracted whole, so a later download knows its copy from one built here. */
const sideRecordPath = (archive: string): string => join(archive, "side.sha256");

/** A tarball of a directory's files, uncompressed (the columns are gzipped already). */
function tar(out: string, dir: string, parent: string): void {
  execFileSync("tar", ["-cf", out, "-C", parent, dir]);
}

/** The catalogue index as it must ship: present, and describing every year on disk. */
function checkIndex(archive: string): void {
  const path = catalogueIndexPath(archive);
  if (!existsSync(path)) throw new Error(`no catalogue index at ${path}: the side files carry it for the scorecard; build it first (npm run kpi:index)`);
  assertFresh(archive, readCatalogueIndex(path), path);
}

/** The years asked and the side files built into tarballs and uploaded with the manifest; with `sideOnly`, the side files and the manifest alone. */
export function upload(archive: string, years: number[], sideOnly = false): void {
  if (sideOnly && years.length > 0) throw new Error("--side-only uploads the side files alone: give no years");
  checkIndex(archive);
  const work = join(archive, "release");
  mkdirSync(work, { recursive: true });
  const manifestPath = join(work, "manifest.json");
  const exists = (() => {
    try {
      execFileSync("gh", ["release", "view", RELEASE_TAG, "--json", "tagName"], { stdio: ["ignore", "pipe", "pipe"] });
      return true;
    } catch {
      return false;
    }
  })();
  // The release's manifest as it stands, so the years this Archive does not upload stay recorded as released.
  if (exists) execFileSync("gh", ["release", "download", RELEASE_TAG, "--pattern", "manifest.json", "--output", manifestPath, "--clobber"], { stdio: ["ignore", "inherit", "inherit"] });
  const manifest: ReleaseManifest = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as ReleaseManifest) : { format: 1, tag: RELEASE_TAG, years: {}, side: null, citation: CITATION, writtenAt: "" };
  if (sideOnly && !exists) throw new Error(`--side-only refreshes the side files of the release ${RELEASE_TAG}, which does not exist: upload the years first`);
  if (sideOnly) {
    // The years stay as released: the index must describe them, as the KPI workflow will read it beside them.
    const released = Object.entries(manifest.years).filter(([year, asset]) => !existsSync(join(yearDir(archive, Number(year)), "manifest.json")) || readManifest(archive, Number(year)).builtAt !== asset.builtAt);
    if (released.length > 0) throw new Error(`the release's manifest under ${work} holds ${released.map(([year]) => year).join(", ")} at another build time than the Archive (or not on disk): upload those years, not the side files alone`);
  }
  if (!exists) {
    execFileSync("gh", ["release", "create", RELEASE_TAG, "--title", "The Archive", "--notes", `The backtest Archive: stripped element histories by year, with a manifest of hashes. ${CITATION}`], { stdio: "inherit" });
  }
  const files: string[] = [];
  for (const year of years) {
    const yearManifest = readManifest(archive, year);
    const out = join(work, yearAsset(year));
    tar(out, String(year), archive);
    manifest.years[String(year)] = { file: yearAsset(year), bytes: statSync(out).size, sha256: sha256File(out), sets: yearManifest.sets, builtAt: yearManifest.builtAt, through: yearManifest.source.kind === "history" ? yearManifest.source.through : `${year}-12-31` };
    files.push(out);
    console.log(`${yearAsset(year)}: ${(statSync(out).size / 1e6).toFixed(0)} MB`);
  }
  if (existsSync(spaceDir(archive))) {
    const out = join(work, SIDE_ASSET);
    execFileSync("tar", ["-cf", out, "-C", archive, "space", "satcat", ...(existsSync(join(archive, "gcat")) ? ["gcat"] : []), "index"]);
    manifest.side = { file: SIDE_ASSET, bytes: statSync(out).size, sha256: sha256File(out) };
    files.push(out);
    console.log(`${SIDE_ASSET}: ${(statSync(out).size / 1e6).toFixed(1)} MB, sha256 ${manifest.side.sha256}`);
  } else if (sideOnly) throw new Error(`no space-weather days under ${spaceDir(archive)}: the side files cannot be built`);
  const oversize = files.map((file) => ({ file, bytes: statSync(file).size })).filter(({ bytes }) => bytes > ASSET_LIMIT_BYTES);
  if (oversize.length > 0) {
    for (const file of files) rmSync(file, { force: true });
    throw new Error(`${oversize.map(({ file, bytes }) => `${file} is ${bytes} bytes`).join("; ")}: over GitHub's limit of ${ASSET_LIMIT_BYTES} bytes on a release asset; nothing was uploaded`);
  }
  manifest.writtenAt = new Date().toISOString();
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of files) execFileSync("gh", ["release", "upload", RELEASE_TAG, file, "--clobber"], { stdio: "inherit" });
  execFileSync("gh", ["release", "upload", RELEASE_TAG, manifestPath, "--clobber"], { stdio: "inherit" });
  for (const file of files) rmSync(file);
}

/** Times a fetch is tried before it fails: a connection the server closed while it idled, or a dropped transfer, is tried again. */
export const FETCH_ATTEMPTS = 3;

/** A URL fetched to a file, following redirects, with `ARCHIVE_AUTH_HEADER` where one is set, tried again on any failure up to `FETCH_ATTEMPTS` times. */
export async function fetchTo(url: string, path: string): Promise<void> {
  const headers: Record<string, string> = { "User-Agent": "breakups-archive (https://github.com/Orbinauts/breakups)" };
  const auth = process.env.ARCHIVE_AUTH_HEADER;
  if (auth !== undefined && auth !== "") {
    const [name, ...value] = auth.split(":");
    headers[name!.trim()] = value.join(":").trim();
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers, redirect: "follow" });
      if (!response.ok || response.body === null) throw new Error(`${url}: ${response.status}`);
      await pipeline(response.body as unknown as NodeJS.ReadableStream, createWriteStream(path));
      return;
    } catch (error) {
      if (attempt >= FETCH_ATTEMPTS) throw error;
      console.log(`${url}: ${(error as Error).message}; trying again (${attempt + 1} of ${FETCH_ATTEMPTS})`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 5000 * attempt));
    }
  }
}

export async function download(archive: string, years: number[], warmup: boolean): Promise<void> {
  const base = process.env.ARCHIVE_BASE_URL ?? DEFAULT_BASE_URL;
  mkdirSync(archive, { recursive: true });
  const manifestPath = releaseManifestPath(archive);
  await fetchTo(`${base}/manifest.json`, manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ReleaseManifest;
  const wanted = new Set(years);
  if (warmup) for (const year of years) if (manifest.years[String(year - 1)] !== undefined) wanted.add(year - 1);
  for (const year of [...wanted].sort()) {
    const asset = manifest.years[String(year)];
    if (asset === undefined) throw new Error(`the release has no ${year}`);
    if (existsSync(join(yearDir(archive, year), "manifest.json")) && readManifest(archive, year).builtAt === asset.builtAt) {
      console.log(`${year}: present`);
      continue;
    }
    const tarball = join(archive, asset.file);
    await fetchTo(`${base}/${asset.file}`, tarball);
    const sha = sha256File(tarball);
    if (sha !== asset.sha256) throw new Error(`${asset.file}: sha256 ${sha} is not the manifest's ${asset.sha256}`);
    rmSync(yearDir(archive, year), { recursive: true, force: true });
    execFileSync("tar", ["-xf", tarball, "-C", archive]);
    rmSync(tarball);
    console.log(`${year}: ${asset.sets} sets, verified`);
  }
  if (manifest.side === null) return;
  // The side files are fetched whole where the Archive has none, or where the last download's copy is not the release's; an Archive built here with no index fetches the release's index alone, its own side files kept.
  const recordPath = sideRecordPath(archive);
  const recorded = existsSync(recordPath) ? readFileSync(recordPath, "utf8").trim() : null;
  const whole = !existsSync(spaceDir(archive)) || (recorded !== null && recorded !== manifest.side.sha256);
  const indexOnly = !whole && !existsSync(catalogueIndexPath(archive));
  if (!whole && !indexOnly) return;
  const tarball = join(archive, manifest.side.file);
  await fetchTo(`${base}/${manifest.side.file}`, tarball);
  const sha = sha256File(tarball);
  if (sha !== manifest.side.sha256) throw new Error(`${manifest.side.file}: sha256 ${sha} is not the manifest's ${manifest.side.sha256}`);
  execFileSync("tar", ["-xf", tarball, "-C", archive, ...(indexOnly ? ["index"] : [])]);
  rmSync(tarball);
  // The index must describe the years the release holds, or the scorecard would refuse it year by year.
  const indexPath = catalogueIndexPath(archive);
  if (!existsSync(indexPath)) throw new Error(`${manifest.side.file} carries no catalogue index: upload the side files again (npm run archive:upload -- --side-only)`);
  const index = readCatalogueIndex(indexPath);
  const off = Object.entries(manifest.years).filter(([year, asset]) => index.years[year]?.builtAt !== asset.builtAt);
  if (off.length > 0) throw new Error(`the released catalogue index does not describe the released years (${off.map(([year]) => year).join(", ")}): build it again (npm run kpi:index) and upload the side files (npm run archive:upload -- --side-only)`);
  if (whole) writeFileSync(recordPath, `${sha}\n`);
  console.log(`side files${indexOnly ? " (the catalogue index alone)" : ""}: verified, the catalogue index over ${Object.keys(index.years).length} released years`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("release.ts")) {
  const [command, ...rest] = process.argv.slice(2);
  const years = rest.filter((a) => /^\d{4}$/.test(a)).map(Number);
  const archive = archiveHome();
  const sideOnly = rest.includes("--side-only");
  if (command === "upload") upload(archive, sideOnly || years.length > 0 ? years : builtYears(archive), sideOnly);
  else if (command === "download") await download(archive, years, rest.includes("--warmup"));
  else throw new Error("usage: release.ts upload [years] [--side-only] | download [years] [--warmup]");
}
