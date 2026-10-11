import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReleaseManifest } from "../archive/release.ts";
import type { Latest } from "../kpi/kpi.ts";
import { DATA_TAG, type DataManifest } from "../prospective/data.ts";
import { gh, setOutput } from "./github.ts";
import { promotionDue } from "./promote.ts";
import { reminderDue } from "./reminder.ts";

/**
 * What the week's maintenance run has to do, decided before any of it is
 * done: `npm run maintenance:plan -- [--rescore]`, after the truth has
 * been fetched and rebuilt. The scorecard is replayed where the committed
 * aggregate no longer describes what it would be made from: the truth's
 * hash is not the one it was scored against, or the Archive's release holds
 * other years, or a year built at another time, than the ones it replayed
 * (`scorecardStale`); where a closed year is due for promotion
 * (`promote.ts`); or where the run was asked to (`--rescore`). It writes
 * the step outputs the workflow reads: `rescore`, `reasons`, `promote`
 * (the year, or empty), `years` (the released years to download, less a
 * year to promote, which is built on the runner) and `reminder` (the
 * quarter whose reminder is due, or empty).
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Why the committed aggregate no longer describes the scorecard's inputs; empty where it does. */
export function scorecardStale(latest: Pick<Latest, "truthSha256" | "years" | "archive">, truthSha256: string, released: Pick<ReleaseManifest, "years">): string[] {
  const reasons: string[] = [];
  if (latest.truthSha256 !== truthSha256) reasons.push(`the truth's sha256 is ${truthSha256.slice(0, 12)}…, the aggregate was scored against ${latest.truthSha256.slice(0, 12)}…`);
  const releasedYears = Object.keys(released.years).map(Number).sort((a, b) => a - b);
  const added = releasedYears.filter((year) => !latest.years.includes(year));
  const gone = latest.years.filter((year) => !releasedYears.includes(year));
  if (added.length > 0) reasons.push(`the Archive's release holds ${added.join(", ")}, which the aggregate does not score`);
  if (gone.length > 0) reasons.push(`the aggregate scores ${gone.join(", ")}, which the Archive's release no longer holds`);
  const rebuilt = releasedYears.filter((year) => latest.years.includes(year) && latest.archive[String(year)]?.builtAt !== released.years[String(year)]!.builtAt);
  if (rebuilt.length > 0) reasons.push(`the Archive's release holds ${rebuilt.join(", ")} built at another time than the aggregate replayed`);
  return reasons;
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
  const reasons = [...(forced ? ["the run was asked to replay it"] : []), ...scorecardStale(latest, truthSha256, released), ...(promotion.year === null ? [] : [`${promotion.year} is promoted into the Archive`])];
  console.log(`promotion: ${promotion.reason}`);
  setOutput("rescore", String(reasons.length > 0));
  setOutput("reasons", reasons.join("; "));
  setOutput("promote", promotion.year === null ? "" : String(promotion.year));
  setOutput("years", Object.keys(released.years).filter((year) => Number(year) !== promotion.year).sort().join(" "));
  setOutput("reminder", reminderDue(today)?.label ?? "");
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("plan.ts")) main();
