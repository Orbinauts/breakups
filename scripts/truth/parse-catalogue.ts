import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Statement } from "../../src/truth.ts";
import { archiveHome, builtYears, readBodies, readColumn, readManifest, yearDir } from "../archive/archive.ts";
import { isoMinute } from "../time.ts";

/**
 * The catalogue as a source of the truth: a breakup is reported, in the
 * owner's definition, when the public catalogue publishes element data for
 * its fragments, whether or not an agency writes it up. This script reads
 * every built year of the Archive for the first element set of every
 * object, finds the launches that gained a burst of new debris objects,
 * and writes one statement per burst to `data/truth/catalogue.json`,
 * which the truth build reads as it reads the hand file. The thresholds
 * are stated here and in the file; a reviewer who disagrees with a row
 * exempts or merges it with an override. `npm run truth:catalogue`, then
 * `npm run truth`.
 */

/** A burst: at least this many new debris objects of one launch within this many days. */
export const BURST_PIECES = 5;
export const BURST_DAYS = 30;
/** A burst within this many days of the launch is the launch's own cataloguing, not a breakup. */
export const AFTER_LAUNCH_DAYS = 90;
/** A burst must be at least this share of the debris the launch already had, so a big old cloud's late pieces do not read as a new event. */
export const BURST_SHARE = 0.2;
/** How far before the first piece's first set the event may lie. */
export const BEFORE_FIRST_PIECE_DAYS = 60;
/** Pieces first seen within this many days of the burst's start count towards its size. */
export const COUNT_DAYS = 90;
/** A burst within this many days of the previous burst of the same launch is the same cloud catalogued in batches. */
export const SAME_CLOUD_DAYS = 365;
/** Sets published in the first days of a year may carry the previous year's epochs; an object's first set is dated no earlier than this before its year. */
const YEAR_SLACK_DAYS = 30;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DAY_MS = 86_400_000;

interface FirstSeen {
  number: number;
  launch: string;
  designator: string;
  name: string;
  isDebris: boolean;
  launchDay: string | null;
  firstEpoch: number;
  /** First seen in the Archive's first year, among every object alive then. */
  warmUp: boolean;
}

/**
 * Every object's first element set, by publication: the first built year
 * it appears in, and within that year the epoch of its lowest-ranked set,
 * no earlier than the year's start less a month. The Archive's first year
 * is a warm-up, since every object alive before it appears in it at once,
 * so objects first seen there are marked and never make a burst.
 */
export function firstSets(archive: string, years: number[]): FirstSeen[] {
  const first = new Map<number, FirstSeen>();
  const warmUp = years[0]!;
  for (const year of years) {
    const manifest = readManifest(archive, year);
    const bodies = readBodies(archive, year);
    const epoch = readColumn(yearDir(archive, year), "epoch", manifest.sets, manifest) as Float64Array;
    const yearStart = Date.UTC(year, 0, 1) - YEAR_SLACK_DAYS * DAY_MS;
    for (const body of bodies) {
      if (first.has(body.number)) continue;
      if (body.designator === null || !/^\d{4}-\d{3}[A-Z]{1,3}$/.test(body.designator)) continue;
      // The sets of an object are in publication order: the first is its first publication of the year.
      const firstEpoch = Math.max(epoch[body.first]!, yearStart);
      first.set(body.number, {
        number: body.number,
        launch: body.designator.slice(0, 8),
        designator: body.designator,
        name: body.name ?? "",
        isDebris: body.bodyClass === "debris" || / DEB\b/.test(body.name ?? ""),
        launchDay: body.launch,
        firstEpoch,
        warmUp: year === warmUp,
      });
    }
  }
  return [...first.values()];
}

export interface Burst {
  launch: string;
  parentName: string | null;
  parentNumber: number | null;
  start: number;
  pieces: FirstSeen[];
  debrisBefore: number;
}

/** The bursts of new debris under each launch, by the thresholds above. */
export function findBursts(objects: FirstSeen[], parentsOf: (launch: string, debrisName: string) => { number: number; name: string }[]): Burst[] {
  const byLaunch = new Map<string, FirstSeen[]>();
  for (const o of objects) byLaunch.set(o.launch, [...(byLaunch.get(o.launch) ?? []), o]);
  const bursts: Burst[] = [];
  for (const [launch, members] of byLaunch) {
    const debris = members.filter((m) => m.isDebris && !m.warmUp).sort((a, b) => a.firstEpoch - b.firstEpoch);
    // Debris the launch had before the Archive began counts towards the share a burst must reach.
    const before = members.filter((m) => m.isDebris && m.warmUp).length;
    let lastBurst = Number.NEGATIVE_INFINITY;
    const launchDay = members.map((m) => m.launchDay).find((d) => d !== null && d.length === 10) ?? null;
    const launchMs = launchDay === null ? null : Date.parse(`${launchDay}T00:00:00Z`);
    let i = 0;
    while (i < debris.length) {
      const start = debris[i]!.firstEpoch;
      let j = i;
      while (j < debris.length && debris[j]!.firstEpoch <= start + BURST_DAYS * DAY_MS) j++;
      const inWindow = j - i;
      const afterLaunch = launchMs === null || start >= launchMs + AFTER_LAUNCH_DAYS * DAY_MS;
      if (start < lastBurst + SAME_CLOUD_DAYS * DAY_MS) {
        i++;
        continue;
      }
      if (inWindow >= BURST_PIECES && afterLaunch && inWindow >= BURST_SHARE * (before + i)) {
        let k = j;
        while (k < debris.length && debris[k]!.firstEpoch <= start + COUNT_DAYS * DAY_MS) k++;
        const pieces = debris.slice(i, k);
        lastBurst = start;
        const names = new Set(pieces.map((p) => p.name.replace(/ DEB\b.*$/, "")));
        const parents = names.size === 1 ? parentsOf(launch, [...names][0]!) : [];
        bursts.push({ launch, parentName: parents.length === 1 ? parents[0]!.name : names.size === 1 ? [...names][0]! : null, parentNumber: parents.length === 1 ? parents[0]!.number : null, start, pieces, debrisBefore: before + i });
        i = k;
      } else i++;
    }
  }
  return bursts.sort((a, b) => a.start - b.start);
}

export function catalogueStatements(bursts: Burst[]): Statement[] {
  return bursts.map((burst) => ({
    source: "catalogue" as const,
    ref: `the public catalogue: ${burst.pieces.length} debris objects under launch ${burst.launch} with first element sets from ${isoMinute(burst.start).slice(0, 10)}`,
    kind: "breakup" as const,
    parent: { catalogueNumber: burst.parentNumber, designator: burst.launch, name: burst.parentName },
    event: { stated: `before the first piece's first set, ${isoMinute(burst.start)}`, at: null, from: isoMinute(burst.start - BEFORE_FIRST_PIECE_DAYS * DAY_MS), to: isoMinute(burst.start), precision: "none" as const },
    orbit: { altitudeKm: null, apogeeKm: null, perigeeKm: null, inclinationDeg: null },
    cause: null,
    causeStated: null,
    piecesCatalogued: burst.pieces.length,
    piecesStatedOn: isoMinute(burst.start + COUNT_DAYS * DAY_MS).slice(0, 10),
    preEventElements: null,
    note: `Found by the burst rule: at least ${BURST_PIECES} new debris objects within ${BURST_DAYS} days, more than ${AFTER_LAUNCH_DAYS} days after launch, at least ${Math.round(BURST_SHARE * 100)}% of the ${burst.debrisBefore} debris the launch had before. Pieces ${burst.pieces[0]!.number} to ${burst.pieces.at(-1)!.number}.`,
    statedOn: null,
  }));
}

async function main(): Promise<void> {
  const archive = archiveHome();
  const years = builtYears(archive);
  if (years.length === 0) throw new Error(`no built years under ${archive}`);
  const objects = firstSets(archive, years);
  const byLaunch = new Map<string, FirstSeen[]>();
  for (const o of objects) byLaunch.set(o.launch, [...(byLaunch.get(o.launch) ?? []), o]);
  const parentsOf = (launch: string, debrisName: string) => (byLaunch.get(launch) ?? []).filter((o) => !o.isDebris && o.name === debrisName).map((o) => ({ number: o.number, name: o.name }));
  const bursts = findBursts(objects, parentsOf);
  const statements = catalogueStatements(bursts);
  const file = {
    about: `Statements the public catalogue makes by listing fragments: generated by scripts/truth/parse-catalogue.ts from the Archive's years ${years[0]} to ${years.at(-1)} (a burst of at least ${BURST_PIECES} new debris objects of one launch within ${BURST_DAYS} days, more than ${AFTER_LAUNCH_DAYS} days after launch, at least ${Math.round(BURST_SHARE * 100)}% of the launch's debris so far). Read by the truth build as the hand file is. Regenerate with npm run truth:catalogue; never edit by hand.`,
    years,
    statements,
  };
  writeFileSync(resolve(ROOT, "data/truth/catalogue.json"), `${JSON.stringify(file, null, 1)}\n`);
  console.log(`data/truth/catalogue.json: ${statements.length} bursts over ${objects.length} objects of ${byLaunch.size} launches, years ${years[0]} to ${years.at(-1)}`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("parse-catalogue.ts")) await main();
