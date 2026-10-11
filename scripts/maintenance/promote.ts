import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { annotateBodies } from "../archive/annotate.ts";
import { archiveHome, writeYear, yearDir } from "../archive/archive.ts";
import { latestGcat } from "../archive/gcat.ts";
import { historyYear } from "../archive/pull.ts";
import { ASSET_LIMIT_BYTES, type ReleaseManifest } from "../archive/release.ts";
import { latestSatcat } from "../archive/satcat.ts";
import { assetName, fetchAsset, fetchVerified, untarHistory, type DataManifest } from "../prospective/data.ts";
import { createIssue, ensureLabel, issuesLabelled, setOutput } from "./github.ts";
import { MAINTENANCE_COLOR, MAINTENANCE_DESCRIPTION, MAINTENANCE_LABEL } from "./reminder.ts";

/**
 * The yearly promotion of a closed year into the Archive. Through a year
 * the prospective test pulls its days from the catalogue's history class
 * and keeps them in the release `prospective-data` (`history-<year>.tar`);
 * the Archive's release holds that year only as it was last uploaded by
 * hand, part of it. On the first maintenance run from 5 January, once the
 * test has settled the year (its last days kept for good, the history's
 * last day 31 December, and the frozen detector's end states of the year,
 * `states-<year>.json.gz`, kept in the release), the year is built from
 * those days as the pull builds it, its body table annotated with the
 * latest satellite and payload catalogues, and put in the Archive in place
 * of the part; the workflow then rebuilds the catalogue index, replays the
 * scorecard over every year, and uploads the year and the side files
 * (`npm run archive:upload -- <year>`) once every check has passed.
 *
 * The promotion is idempotent: the release's manifest records the last day
 * each year holds (`through`), and a year it holds through 31 December is
 * not promoted again. A year whose tarball would be over GitHub's 2 GiB
 * limit on an asset is refused before it touches the Archive, with an
 * issue labelled `maintenance` saying so, opened once.
 *
 * `npm run maintenance:promote -- <year>` builds the year into the
 * Archive (`BREAKUPS_ARCHIVE`), the side files already downloaded, and
 * writes `<archive>/promotion/promotion.json` for the pull request's body.
 */

/** The first day of the year after a closed one on which it may be promoted. */
export const PROMOTE_FROM = "01-05";

/** Whether a year is promoted, and why or why not. */
export interface Promotion {
  year: number | null;
  reason: string;
}

/** Whether the release holds a year whole: through its last day. */
export const holdsWhole = (released: ReleaseManifest, year: number): boolean => released.years[String(year)]?.through === `${year}-12-31`;

/**
 * The year due for promotion on a day, from the two releases' manifests:
 * the previous year, from 5 January, where the Archive's release does not
 * hold it through 31 December and the test's release holds its history
 * through that day and its end states. Null, with the reason, otherwise.
 */
export function promotionDue(today: string, released: ReleaseManifest, data: DataManifest): Promotion {
  const year = Number(today.slice(0, 4)) - 1;
  if (today < `${year + 1}-${PROMOTE_FROM}`) return { year: null, reason: `${year} is promoted from ${year + 1}-${PROMOTE_FROM}` };
  if (holdsWhole(released, year)) return { year: null, reason: `the Archive's release holds ${year} through ${year}-12-31` };
  const history = data.assets[assetName("history", year)];
  if (history === undefined) return { year: null, reason: `the release prospective-data holds no history of ${year}` };
  if (history.through !== `${year}-12-31`) return { year: null, reason: `the history of ${year} ends on ${history.through ?? "no day"}, not ${year}-12-31` };
  if (data.assets[assetName("states", year)] === undefined) return { year: null, reason: `${year} has not settled: the release prospective-data holds no ${assetName("states", year)}` };
  return { year, reason: `${year} has settled and the Archive's release holds it through ${released.years[String(year)]?.through ?? (released.years[String(year)] === undefined ? "no day" : "an unrecorded day")}` };
}

/** The bytes a tarball of a directory's files takes: a header and the content in 512-byte blocks for each entry, the two closing blocks, and the 10 KiB record it is padded to. */
export function tarBytes(dir: string): number {
  let bytes = 512;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    bytes += stat.isDirectory() ? tarBytes(path) : 512 + Math.ceil(stat.size / 512) * 512;
  }
  return bytes;
}

/** The tarball's size with the end blocks and the record padding. */
export const tarballBytes = (dir: string): number => Math.ceil((tarBytes(dir) + 1024) / 10240) * 10240;

/** What the promotion did, for the pull request's body. */
export interface Promoted {
  year: number;
  days: number;
  from: string;
  through: string;
  sets: number;
  bodies: number;
  tarballBytes: number;
  builtAt: string;
}

export const promotionDir = (archive: string): string => join(archive, "promotion");

const oversizeTitle = (year: number): string => `The Archive's ${year} is over the 2 GiB asset limit and was not promoted`;

/** The year built from the test's history into the Archive, or refused with an issue where its tarball would be over the limit; what it did, or null. */
export function promote(archive: string, year: number): Promoted | null {
  const work = promotionDir(archive);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  fetchAsset("manifest.json", join(work, "data-manifest.json"));
  const data = JSON.parse(readFileSync(join(work, "data-manifest.json"), "utf8")) as DataManifest;
  const asset = data.assets[assetName("history", year)];
  if (asset === undefined) throw new Error(`the release prospective-data holds no history of ${year}`);
  const tarball = join(work, asset.file);
  fetchVerified(asset, tarball);
  untarHistory(archive, year, tarball);
  rmSync(tarball);
  const satcat = latestSatcat(archive);
  const gcat = latestGcat(archive);
  if (satcat === null || gcat === null) throw new Error(`the Archive lacks a satellite or payload catalogue snapshot under ${archive}: download the side files first (npm run archive:download)`);
  const built = historyYear(archive, year);
  if (built.manifest.source.kind !== "history" || built.manifest.source.through !== `${year}-12-31`) throw new Error(`the history of ${year} does not reach ${year}-12-31`);
  // Built beside the Archive first, so a refused year leaves the Archive as it was.
  writeYear(work, { ...built, bodies: annotateBodies(built.bodies, satcat.rows, gcat.rows) });
  const bytes = tarballBytes(yearDir(work, year));
  if (bytes > ASSET_LIMIT_BYTES) {
    const title = oversizeTitle(year);
    ensureLabel(MAINTENANCE_LABEL, MAINTENANCE_COLOR, MAINTENANCE_DESCRIPTION);
    if (!issuesLabelled(MAINTENANCE_LABEL).some((issue) => issue.title === title && issue.state === "OPEN")) {
      createIssue(title, `The yearly promotion built ${year} from the prospective test's day slices, ${built.manifest.sets} sets, and its tarball would be ${bytes} bytes, over GitHub's limit of ${ASSET_LIMIT_BYTES} bytes on a release asset. Nothing was uploaded and the Archive's release still holds ${year} as it was. The year must be split across assets (by half year, say) or its columns compressed harder before it can be promoted; until then every weekly run refuses it again.${process.env.GITHUB_RUN_ID === undefined ? "" : `\n\nRun: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`}`, MAINTENANCE_LABEL);
    }
    rmSync(yearDir(work, year), { recursive: true, force: true });
    console.log(`${year}: the tarball would be ${bytes} bytes, over the limit; not promoted`);
    return null;
  }
  rmSync(yearDir(archive, year), { recursive: true, force: true });
  renameSync(yearDir(work, year), yearDir(archive, year));
  const source = built.manifest.source;
  const promoted: Promoted = { year, days: asset.days ?? 0, from: source.from, through: source.through, sets: built.manifest.sets, bodies: built.manifest.bodies, tarballBytes: bytes, builtAt: built.manifest.builtAt };
  writeFileSync(join(work, "promotion.json"), `${JSON.stringify(promoted, null, 2)}\n`);
  console.log(`${year}: ${promoted.sets} sets of ${promoted.bodies} objects from ${promoted.from} through ${promoted.through}, a tarball of ${(bytes / 1e6).toFixed(0)} MB, in the Archive`);
  return promoted;
}

/** What the promotion wrote for the pull request, or null where nothing was promoted. */
export function readPromoted(archive: string): Promoted | null {
  const path = join(promotionDir(archive), "promotion.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Promoted) : null;
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("promote.ts")) {
  const year = Number(process.argv[2]);
  if (!Number.isInteger(year)) throw new Error("usage: promote.ts <year>");
  const promoted = promote(archiveHome(), year);
  setOutput("promoted", promoted === null ? "" : String(promoted.year));
}
