import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ASSET_LIMIT_BYTES, type ReleaseManifest } from "../archive/release.ts";
import { scoredYears } from "../archive/years.ts";
import type { Latest } from "../kpi/kpi.ts";
import { PINNED, readPins, type Versions } from "../pins/pins.ts";
import { assetName, DATA_TAG, type DataManifest } from "../prospective/data.ts";
import { createIssue, ensureLabel, gh, issuesLabelled, setOutput } from "./github.ts";
import { promotionDue } from "./promote.ts";
import { MAINTENANCE_COLOR, MAINTENANCE_DESCRIPTION, MAINTENANCE_LABEL, reminderDue } from "./reminder.ts";

/**
 * What the week's maintenance run has to do, decided before any of it is
 * done: `npm run maintenance:plan -- [--rescore]`, after the truth has
 * been fetched and rebuilt. The scorecard is replayed where the committed
 * aggregate no longer describes what it would be made from: the truth's
 * hash is not the one it was scored against, or the Archive's release holds
 * other years, or a year built at another time, than the ones it replayed,
 * or a scoring pin (`pins.json`) is not the version the aggregate records
 * it was scored with (`scorecardStale`); where a closed year is due for
 * promotion (`promote.ts`); or where the run was asked to (`--rescore`).
 * It writes the step outputs the workflow reads: `rescore`, `reasons`,
 * `promote` (the year, or empty), `years` (the released years to
 * download, less a year to promote, which is built on the runner) and
 * `reminder` (the quarter whose reminder is due, or empty). Where the prospective test's
 * history of the current year is on course to pass GitHub's 2 GiB limit
 * on an asset by 31 December, at the rate its days have grown so far, it
 * opens an issue saying so, once a year (`historyOnCourse`): the daily run
 * could not keep the year's slices past that day.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Why the committed aggregate no longer describes the scorecard's inputs; empty where it does. */
export function scorecardStale(latest: Pick<Latest, "truthSha256" | "years" | "archive"> & Partial<Pick<Latest, "versions">>, truthSha256: string, released: Pick<ReleaseManifest, "years">, pinned: Versions): string[] {
  const reasons: string[] = [];
  if (latest.truthSha256 !== truthSha256) reasons.push(`the truth's sha256 is ${truthSha256.slice(0, 12)}…, the aggregate was scored against ${latest.truthSha256.slice(0, 12)}…`);
  // A year the release holds below the Archive's first (the fresh validation's, uploaded before the rule that scores them) is not the scorecard's.
  const releasedYears = scoredYears(Object.keys(released.years).map(Number));
  const added = releasedYears.filter((year) => !latest.years.includes(year));
  const gone = latest.years.filter((year) => !releasedYears.includes(year));
  if (added.length > 0) reasons.push(`the Archive's release holds ${added.join(", ")}, which the aggregate does not score`);
  if (gone.length > 0) reasons.push(`the aggregate scores ${gone.join(", ")}, which the Archive's release no longer holds`);
  const rebuilt = releasedYears.filter((year) => latest.years.includes(year) && latest.archive[String(year)]?.builtAt !== released.years[String(year)]!.builtAt);
  if (rebuilt.length > 0) reasons.push(`the Archive's release holds ${rebuilt.join(", ")} built at another time than the aggregate replayed`);
  // An aggregate written before the versions were recorded is replayed once, to record them.
  if (latest.versions === undefined) reasons.push("the aggregate records no versions of the engine and the propagators it was scored with");
  else for (const name of PINNED) if (latest.versions[name] !== pinned[name]) reasons.push(`${name} is pinned at ${pinned[name]}, the aggregate was scored with ${latest.versions[name] ?? "no recorded version of it"}`);
  return reasons;
}

/** The share of the asset limit past which a year's history is warned of. */
export const HISTORY_WARNING_SHARE = 0.9;

/** The size a year's history will reach on 31 December at the rate its kept days have grown, and whether that passes the warning share of the limit; null where the release holds no history of the year. */
export function historyOnCourse(data: DataManifest, year: number): { bytes: number; projected: number; warn: boolean } | null {
  const history = data.assets[assetName("history", year)];
  if (history === undefined || history.days === undefined || history.days === 0) return null;
  const daysInYear = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
  const projected = Math.round((history.bytes / history.days) * daysInYear);
  return { bytes: history.bytes, projected, warn: projected > HISTORY_WARNING_SHARE * ASSET_LIMIT_BYTES };
}

/** The issue that warns of a year's history heading for the limit, opened once a year, whatever became of it. */
function warnOfHistory(data: DataManifest, year: number): void {
  const course = historyOnCourse(data, year);
  if (course === null || !course.warn) return;
  const title = `The prospective test's history of ${year} is heading for the 2 GiB asset limit`;
  ensureLabel(MAINTENANCE_LABEL, MAINTENANCE_COLOR, MAINTENANCE_DESCRIPTION);
  if (issuesLabelled(MAINTENANCE_LABEL).some((issue) => issue.title === title)) return;
  const gb = (bytes: number): string => `${(bytes / 1e9).toFixed(2)} GB`;
  createIssue(
    title,
    `The release \`${DATA_TAG}\` holds \`${assetName("history", year)}\` at ${gb(course.bytes)}; at the rate its days have grown so far it reaches ${gb(course.projected)} by 31 December, against GitHub's limit of ${gb(ASSET_LIMIT_BYTES)} (2 GiB) on a release asset. Past the limit the daily run's upload of the year's slices fails (\`npm run prospective:data -- upload\`), and the yearly promotion reads the same file. The history must be kept in more than one asset (by half year, say) before then; the catalogue grows each year, so the next year's history will be larger still.`,
    MAINTENANCE_LABEL,
  );
}

/** A release asset read with the CLI, by its id, so a replaced asset is never read from a stale public link. */
function releaseJson<T>(tag: string, asset: string): T {
  const dir = mkdtempSync(join(tmpdir(), "breakups-plan-"));
  try {
    const path = join(dir, asset);
    gh(["release", "download", tag, "--pattern", asset, "--output", path]);
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(): void {
  const today = new Date().toISOString().slice(0, 10);
  const forced = process.argv.includes("--rescore");
  const latest = JSON.parse(readFileSync(join(ROOT, "kpi/latest.json"), "utf8")) as Latest;
  const truthSha256 = createHash("sha256").update(readFileSync(join(ROOT, "data/breakups.json"))).digest("hex");
  const released = releaseJson<ReleaseManifest>("archive-v1", "manifest.json");
  const data = releaseJson<DataManifest>(DATA_TAG, "manifest.json");
  const promotion = promotionDue(today, released, data);
  const reasons = [...(forced ? ["the run was asked to replay it"] : []), ...scorecardStale(latest, truthSha256, released, readPins().scoring), ...(promotion.year === null ? [] : [`${promotion.year} is promoted into the Archive`])];
  console.log(`promotion: ${promotion.reason}`);
  setOutput("rescore", String(reasons.length > 0));
  setOutput("reasons", reasons.join("; "));
  setOutput("promote", promotion.year === null ? "" : String(promotion.year));
  setOutput("years", scoredYears(Object.keys(released.years).map(Number)).filter((year) => year !== promotion.year).join(" "));
  setOutput("reminder", reminderDue(today)?.label ?? "");
  warnOfHistory(data, Number(today.slice(0, 4)));
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("plan.ts")) main();
