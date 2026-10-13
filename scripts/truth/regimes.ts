import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { regimeOf as regimeOfSet } from "../../src/elements.ts";
import { readBreakups, yearOf, type Regime } from "../../src/index.ts";
import { archiveHome, builtYears, readManifest, readYear } from "../archive/archive.ts";
import { isoMinute } from "../time.ts";

/**
 * The regimes of the truth's parents, read from the Archive into a file
 * the truth's build reads (`data/truth/regimes.json`), so the build stays
 * reproducible without the Archive. GCAT's satellite catalogue and the
 * catalogue's bursts state no orbit, so most of their rows had no regime;
 * a row whose statements give none takes its parent's at the event: the
 * regime of the parent's last set before the window opens, by the
 * detector's own filing of a set (`regimeOf` in `src/elements.ts`).
 *
 * The file holds, for each parent of a row from 2005 whose statements give
 * no regime, the runs of one regime over every set the Archive holds of it,
 * each from its first set's epoch, so a window moved by a rebuild is read
 * without regenerating the file; a parent the truth gains is not in it
 * until `npm run truth:regimes` is run again on the Archive, and its rows
 * keep the regime unknown meanwhile.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const REGIMES_PATH = "data/truth/regimes.json";

type Known = Exclude<Regime, "unknown">;
/** A run: the epoch of its first set (`YYYY-MM-DDTHH:MMZ`, to the minute) and the regime its sets share. */
export type RegimeRun = [string, Known];

export interface RegimesFile {
  about: string;
  /** The Archive's years the runs were read from, with each year's build time. */
  years: Record<string, string>;
  parents: Record<string, RegimeRun[]>;
}


/** The runs of one regime over a parent's sets, in epoch order, each from its first set's epoch. */
export function regimeRunsOf(sets: readonly [number, Known][]): RegimeRun[] {
  const runs: RegimeRun[] = [];
  for (const [epoch, regime] of [...sets].sort((a, b) => a[0] - b[0])) if (runs.at(-1)?.[1] !== regime) runs.push([isoMinute(epoch), regime]);
  return runs;
}

/** The regime of the last set before an instant, unknown where there is none. */
export function regimeAt(runs: readonly RegimeRun[] | undefined, at: number): Regime {
  let regime: Regime = "unknown";
  for (const [from, known] of runs ?? []) {
    if (Date.parse(from) >= at) break;
    regime = known;
  }
  return regime;
}

/** The derived file as committed, or none. */
export function readRegimes(root = ROOT): RegimesFile | null {
  const path = resolve(root, REGIMES_PATH);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as RegimesFile) : null;
}

/** The parents whose rows from 2005 give no regime of their own: no statement gives both ends of the orbit (`regimeOf` in the build reads them so). */
function parentsWanted(): Set<number> {
  const breakups = readBreakups(JSON.parse(readFileSync(resolve(ROOT, "data/breakups.json"), "utf8")));
  const stated = (b: (typeof breakups)[number]): boolean => (b.orbit.apogeeKm ?? b.orbit.altitudeKm) !== null && (b.orbit.perigeeKm ?? b.orbit.altitudeKm) !== null;
  return new Set(breakups.filter((b) => b.parent.catalogueNumber !== null && yearOf(b) >= 2005 && !stated(b)).map((b) => b.parent.catalogueNumber!));
}

function main(): void {
  const archive = archiveHome();
  const wanted = parentsWanted();
  const sets = new Map<number, [number, Known][]>();
  const years: Record<string, string> = {};
  for (const year of builtYears(archive)) {
    years[String(year)] = readManifest(archive, year).builtAt;
    const { bodies, columns } = readYear(archive, year, ["number", "epoch", "meanMotion", "eccentricity"]);
    for (const body of bodies) {
      if (!wanted.has(body.number)) continue;
      const list = sets.get(body.number) ?? sets.set(body.number, []).get(body.number)!;
      for (let i = body.first; i < body.first + body.count; i++) {
        const regime = regimeOfSet({ meanMotion: columns.meanMotion[i]! / 1e8, eccentricity: columns.eccentricity[i]! / 1e7 });
        if (regime !== "unknown") list.push([columns.epoch[i]!, regime]);
      }
    }
    console.error(`regimes: read ${year}`);
  }
  const parents = Object.fromEntries([...sets].sort((a, b) => a[0] - b[0]).map(([number, list]) => [String(number), regimeRunsOf(list)]));
  const file: RegimesFile = {
    about: "Derived from the Archive by `npm run truth:regimes` (scripts/truth/regimes.ts): for each parent of a truth row from 2005 whose statements give no orbit, the runs of one regime over every set the Archive holds of it, each from its first set's epoch, by the detector's filing of a set. The truth's build reads a row's regime from its parent's last set before the window opens. Never edited by hand.",
    years,
    parents,
  };
  writeFileSync(resolve(ROOT, REGIMES_PATH), `${JSON.stringify(file, null, 1)}\n`);
  console.log(`${REGIMES_PATH}: ${Object.keys(parents).length} of ${wanted.size} parents with sets in the Archive`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
