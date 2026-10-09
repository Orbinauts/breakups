import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { archiveHome, builtYears, readManifest, yearDir } from "./archive.ts";
import { spaceDir } from "./space-weather.ts";

/**
 * The Archive as release assets of this repository: one tarball per built
 * year (`archive-v1-<year>.tar`, the year's gzipped columns, body table
 * and manifest), one for the side files (`archive-v1-side.tar`: the
 * space-weather days and the satellite catalogue snapshot), and
 * `manifest.json` naming each asset's size and SHA-256. `npm run
 * archive:upload -- [years]` builds the tarballs and uploads them with the
 * GitHub CLI to the release `archive-v1`, creating it if need be; `npm run
 * archive:download -- [years] [--warmup]` fetches the manifest and the
 * years asked into the Archive, verifying each hash, from
 * `ARCHIVE_BASE_URL` (default: this repository's release), with an
 * optional `ARCHIVE_AUTH_HEADER` for a private store.
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
}

export interface ReleaseManifest {
  format: 1;
  tag: string;
  years: Record<string, AssetRecord>;
  side: AssetRecord | null;
  citation: string;
  writtenAt: string;
}

const CITATION = "Element sets from the public catalogue's yearly bundles and history, used under its blanket approval for redistribution of basic space-situational-awareness data with citation; space-weather indices from GFZ Potsdam (CC BY 4.0) and NASA OMNI2; the satellite catalogue from CelesTrak.";

const yearAsset = (year: number): string => `${RELEASE_TAG}-${year}.tar`;
const SIDE_ASSET = `${RELEASE_TAG}-side.tar`;

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** A tarball of a directory's files, uncompressed (the columns are gzipped already). */
function tar(out: string, dir: string, parent: string): void {
  execFileSync("tar", ["-cf", out, "-C", parent, dir]);
}

export function upload(archive: string, years: number[]): void {
  const work = join(archive, "release");
  mkdirSync(work, { recursive: true });
  const manifestPath = join(work, "manifest.json");
  const manifest: ReleaseManifest = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as ReleaseManifest) : { format: 1, tag: RELEASE_TAG, years: {}, side: null, citation: CITATION, writtenAt: "" };
  const exists = (() => {
    try {
      execFileSync("gh", ["release", "view", RELEASE_TAG, "--json", "tagName"], { stdio: ["ignore", "pipe", "pipe"] });
      return true;
    } catch {
      return false;
    }
  })();
  if (!exists) {
    execFileSync("gh", ["release", "create", RELEASE_TAG, "--title", "The Archive", "--notes", `The backtest Archive: stripped element histories by year, with a manifest of hashes. ${CITATION}`], { stdio: "inherit" });
  }
  const files: string[] = [];
  for (const year of years) {
    const yearManifest = readManifest(archive, year);
    const out = join(work, yearAsset(year));
    tar(out, String(year), archive);
    manifest.years[String(year)] = { file: yearAsset(year), bytes: statSync(out).size, sha256: sha256File(out), sets: yearManifest.sets, builtAt: yearManifest.builtAt };
    files.push(out);
    console.log(`${yearAsset(year)}: ${(statSync(out).size / 1e6).toFixed(0)} MB`);
  }
  if (existsSync(spaceDir(archive))) {
    const out = join(work, SIDE_ASSET);
    execFileSync("tar", ["-cf", out, "-C", archive, "space", "satcat"]);
    manifest.side = { file: SIDE_ASSET, bytes: statSync(out).size, sha256: sha256File(out) };
    files.push(out);
  }
  manifest.writtenAt = new Date().toISOString();
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of files) execFileSync("gh", ["release", "upload", RELEASE_TAG, file, "--clobber"], { stdio: "inherit" });
  execFileSync("gh", ["release", "upload", RELEASE_TAG, manifestPath, "--clobber"], { stdio: "inherit" });
  for (const file of files) rmSync(file);
}

async function fetchTo(url: string, path: string): Promise<void> {
  const headers: Record<string, string> = { "User-Agent": "breakups-archive (https://github.com/Orbinauts/breakups)" };
  const auth = process.env.ARCHIVE_AUTH_HEADER;
  if (auth !== undefined && auth !== "") {
    const [name, ...value] = auth.split(":");
    headers[name!.trim()] = value.join(":").trim();
  }
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok || response.body === null) throw new Error(`${url}: ${response.status}`);
  await pipeline(response.body as unknown as NodeJS.ReadableStream, createWriteStream(path));
}

export async function download(archive: string, years: number[], warmup: boolean): Promise<void> {
  const base = process.env.ARCHIVE_BASE_URL ?? DEFAULT_BASE_URL;
  mkdirSync(archive, { recursive: true });
  const manifestPath = join(archive, "release-manifest.json");
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
  if (manifest.side !== null && !existsSync(spaceDir(archive))) {
    const tarball = join(archive, manifest.side.file);
    await fetchTo(`${base}/${manifest.side.file}`, tarball);
    if (sha256File(tarball) !== manifest.side.sha256) throw new Error(`${manifest.side.file}: hash mismatch`);
    execFileSync("tar", ["-xf", tarball, "-C", archive]);
    rmSync(tarball);
    console.log("side files: verified");
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("release.ts")) {
  const [command, ...rest] = process.argv.slice(2);
  const years = rest.filter((a) => /^\d{4}$/.test(a)).map(Number);
  const archive = archiveHome();
  if (command === "upload") upload(archive, years.length > 0 ? years : builtYears(archive));
  else if (command === "download") await download(archive, years, rest.includes("--warmup"));
  else throw new Error("usage: release.ts upload [years] | download <years> [--warmup]");
}
