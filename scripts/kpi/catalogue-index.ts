import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { BODY_CLASSES, readBreakups, type Breakup } from "../../src/index.ts";
import { archiveHome, builtYears, catalogueIndexPath, readManifest, releaseManifestPath } from "../archive/archive.ts";
import { catalogueOver, planeOrbit, readCatalogue, type BodyFact, type Catalogue, type ParentSet, type WholeCatalogue } from "./catalogue.ts";
import { lowerOf } from "./match.ts";

/**
 * The catalogue index: what the scorecard reads of every year's catalogue,
 * built once from the whole Archive by `npm run kpi:index` and written to
 * `<archive>/index/catalogue-index.json.gz`, which the release ships with
 * the side files. The scorecard's catalogue (`catalogue.ts`) spans every
 * year, the detector's reentries and the Confirmed line's targets with
 * it, but a replay holds a year and the one before it, and the KPI
 * workflow downloads no more: read from the years on disk, the catalogue
 * of a year scored there was not the one scored beside every other year,
 * and the aggregate the workflow made was not the committed one. The
 * scorecard therefore reads the catalogue from the index alone, and
 * refuses to run without it rather than read a part of the Archive as
 * the whole.
 *
 * The index holds one row per body, in the order the whole read lists
 * them: its catalogue number, its launch, name and class, its decay and
 * launch days, when it was first published by the replay's clock, and
 * its earliest set's epoch and the orbit the plane test reads (mean
 * motion, eccentricity, inclination and node). The high-water mark and
 * the launches' bodies are made from those rows as the whole read makes
 * them. The plane test also reads a parent's last set before an event,
 * which may lie in any year: in a later year's back-filled sets, or years
 * back for a parent the catalogue lost. Answering that for any body at
 * any time would want every set of every year, so the index holds it for
 * the instants the truth asks it at: one row per truth row with a
 * catalogue number, the parent's last set before the row's window opens,
 * or none. A truth row the index was not built for is refused by name.
 *
 * The index records each year's build time and set count as it read
 * them, and a reader refuses a stale index: one that does not hold a year
 * the Archive holds, or holds it at another build time, or, for the years
 * not on disk, at another build time than the release's manifest the last
 * download fetched. Rebuild the index whenever a year of the Archive is
 * built again or added, and whenever the truth gains a row with a parent
 * or moves one's window, and upload the side files with it
 * (`npm run archive:upload -- --side-only`).
 */

export const INDEX_FORMAT = 1;

/** One body: its number, launch, name, class (by its index in `BODY_CLASSES`), decay day and launch day (milliseconds, or null), first publication by the replay's clock, and its earliest set's epoch, mean motion, eccentricity, inclination and node. */
export type BodyRow = [number, string | null, string, number, number | null, number | null, number, number, number, number, number, number];

/** A parent's last set before an instant: the parent, the instant, and the set's epoch, mean motion, eccentricity, inclination and node; the parent and the instant alone where it had none. */
export type ParentRow = [number, number] | [number, number, number, number, number, number, number];

/** A year as the index read it. */
export interface YearStamp {
  builtAt: string;
  sets: number;
}

export interface CatalogueIndex {
  format: typeof INDEX_FORMAT;
  builtAt: string;
  /** Every year of the Archive the index was read from, with its build time and set count. */
  years: Record<string, YearStamp>;
  /** The truth whose rows the parents' last sets were read for (the sha256 of `data/breakups.json`); the rows themselves are what a reader checks. */
  truthSha256: string;
  bodies: BodyRow[];
  parentOrbits: ParentRow[];
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const classIndex = new Map<string, number>(BODY_CLASSES.map((name, i) => [name, i]));

const parentKey = (parent: number, at: number): string => `${parent}@${at}`;

/** The instants the truth asks a parent's last set at: each row with a catalogue number, where its window opens, once each. */
export function parentInstantsOf(breakups: readonly Breakup[]): [number, number][] {
  const seen = new Map<string, [number, number]>();
  for (const breakup of breakups) {
    const parent = breakup.parent.catalogueNumber;
    if (parent === null) continue;
    const from = lowerOf(breakup);
    seen.set(parentKey(parent, from), [parent, from]);
  }
  return [...seen.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function bodyRowOf(fact: BodyFact): BodyRow {
  const bodyClass = classIndex.get(fact.bodyClass);
  if (bodyClass === undefined) throw new Error(`body ${fact.number} has the class ${fact.bodyClass}, which is not one of ${BODY_CLASSES.join(", ")}`);
  return [fact.number, fact.launch, fact.name, bodyClass, fact.decayMs, fact.launchMs, fact.firstClock, fact.firstEpoch, fact.orbit.meanMotion, fact.orbit.eccentricity, fact.orbit.inclinationDeg, fact.orbit.raanDeg];
}

function factOfRow(row: BodyRow): BodyFact {
  const [number, launch, name, bodyClass, decayMs, launchMs, firstClock, firstEpoch, meanMotion, eccentricity, inclination, raan] = row;
  return { number, launch, name, bodyClass: BODY_CLASSES[bodyClass]!, decayMs, launchMs, firstClock, firstEpoch, orbit: planeOrbit(firstEpoch, meanMotion, eccentricity, inclination, raan) };
}

function parentRowOf(parent: number, at: number, set: ParentSet | null): ParentRow {
  return set === null ? [parent, at] : [parent, at, set.epoch, set.orbit.meanMotion, set.orbit.eccentricity, set.orbit.inclinationDeg, set.orbit.raanDeg];
}

const setOfRow = (row: ParentRow): ParentSet | null => (row.length === 2 ? null : { epoch: row[2], orbit: planeOrbit(row[2], row[3], row[4], row[5], row[6]) });

/** Each year of the Archive as it stands: its build time and set count. */
export function stampsOf(archive: string): Record<string, YearStamp> {
  return Object.fromEntries(
    builtYears(archive).map((year) => {
      const manifest = readManifest(archive, year);
      return [String(year), { builtAt: manifest.builtAt, sets: manifest.sets }];
    }),
  );
}

/** The index read from the whole Archive: every body's facts, and each truth row's parent's last set before its window. */
export function buildCatalogueIndex(archive: string, breakups: readonly Breakup[], truthSha256: string, log = true): CatalogueIndex {
  const years = stampsOf(archive);
  if (Object.keys(years).length === 0) throw new Error(`no built year under ${archive}: the index is read from the whole Archive`);
  const instants = parentInstantsOf(breakups);
  const whole = readCatalogue(archive, new Set(instants.map(([parent]) => parent)), log);
  // A year rebuilt while it was read would leave the index describing neither build.
  if (JSON.stringify(stampsOf(archive)) !== JSON.stringify(years)) throw new Error("a year of the Archive was built again while the index read it: build the index again");
  const index: CatalogueIndex = {
    format: INDEX_FORMAT,
    builtAt: new Date().toISOString(),
    years,
    truthSha256,
    bodies: [...whole.bodies.values()].map(bodyRowOf),
    parentOrbits: instants.map(([parent, at]) => parentRowOf(parent, at, whole.orbitBefore(parent, at))),
  };
  checkRoundTrip(index, whole, instants);
  return index;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b) && sameNumbers(a, b);

/** Every number of two values the same double, NaN and the infinities included, which a JSON comparison alone would let pass as null. */
function sameNumbers(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") return Object.is(a, b);
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => sameNumbers((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/** The index read back through its JSON as a reader will read it, checked to give every body's facts, in order, and every parent's last set exactly as the whole read gave them. */
function checkRoundTrip(index: CatalogueIndex, whole: WholeCatalogue, instants: [number, number][]): void {
  const back = catalogueFromIndex(JSON.parse(JSON.stringify(index)) as CatalogueIndex);
  const wholeFacts = [...whole.bodies.values()];
  const backFacts = [...back.bodies.values()];
  if (backFacts.length !== wholeFacts.length) throw new Error(`the index reads back ${backFacts.length} bodies, not ${wholeFacts.length}`);
  for (let i = 0; i < wholeFacts.length; i++) if (!same(backFacts[i], wholeFacts[i])) throw new Error(`the index reads body ${wholeFacts[i]!.number} back otherwise than the Archive gives it`);
  for (const [parent, at] of instants) if (!same(back.orbitBefore(parent, at), whole.orbitBefore(parent, at))) throw new Error(`the index reads ${parent}'s last set before ${new Date(at).toISOString()} back otherwise than the Archive gives it`);
}

/** The catalogue as the index holds it: every body's facts, and the parents' last sets at the instants the index was built for; asked for another, it throws. */
export function catalogueFromIndex(index: CatalogueIndex): Catalogue {
  const bodies = new Map<number, BodyFact>();
  for (const row of index.bodies) bodies.set(row[0], factOfRow(row));
  const orbits = new Map<string, ParentSet | null>();
  for (const row of index.parentOrbits) orbits.set(parentKey(row[0], row[1]), setOfRow(row));
  return catalogueOver(bodies, (parent, at) => {
    const set = orbits.get(parentKey(parent, at));
    if (set === undefined) throw new Error(`the catalogue index holds no last set of ${parent} before ${new Date(at).toISOString()}: ${REBUILD}`);
    return set;
  });
}

const REBUILD = "build it again from the whole Archive (npm run kpi:index) and upload it with the side files (npm run archive:upload -- --side-only)";

export function writeCatalogueIndex(archive: string, index: CatalogueIndex): string {
  const path = catalogueIndexPath(archive);
  mkdirSync(dirname(path), { recursive: true });
  const building = `${path}.${process.pid}.building`;
  writeFileSync(building, gzipSync(`${JSON.stringify(index)}\n`, { level: 9 }));
  renameSync(building, path);
  return path;
}

export function readCatalogueIndex(path: string): CatalogueIndex {
  const index = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as CatalogueIndex;
  if (index.format !== INDEX_FORMAT) throw new Error(`${path} is in the index's format ${index.format}, not ${INDEX_FORMAT}: ${REBUILD}`);
  return index;
}

/**
 * Why an index no longer describes the Archive, if it does not: a year on
 * disk it does not hold or holds at another build time, or, for a year not
 * on disk, another build time than the release's manifest the last
 * download fetched (where there is one) names, or a released year it does
 * not hold.
 */
export function stalenessOf(archive: string, index: CatalogueIndex): string[] {
  const reasons: string[] = [];
  const present = stampsOf(archive);
  for (const [year, stamp] of Object.entries(present)) {
    const read = index.years[year];
    if (read === undefined) reasons.push(`${year} is in the Archive but not in the index`);
    else if (read.builtAt !== stamp.builtAt) reasons.push(`${year} was built at ${stamp.builtAt}, the index read it as built at ${read.builtAt}`);
  }
  if (existsSync(releaseManifestPath(archive))) {
    const release = JSON.parse(readFileSync(releaseManifestPath(archive), "utf8")) as { years: Record<string, { builtAt?: string }> };
    for (const [year, asset] of Object.entries(release.years)) {
      if (present[year] !== undefined) continue;
      const read = index.years[year];
      if (read === undefined) reasons.push(`${year} is in the release but not in the index`);
      else if (read.builtAt !== asset.builtAt) reasons.push(`${year} was released as built at ${asset.builtAt}, the index read it as built at ${read.builtAt}`);
    }
  }
  return reasons;
}

/** Refuses an index that no longer describes the Archive. */
export function assertFresh(archive: string, index: CatalogueIndex, path = catalogueIndexPath(archive)): void {
  const reasons = stalenessOf(archive, index);
  if (reasons.length > 0) throw new Error(`the catalogue index ${path} is stale (${reasons.join("; ")}): ${REBUILD}`);
}

/**
 * The scorecard's catalogue: read from the Archive's index, refused where
 * there is none (the years on disk may be a part of the Archive, and a
 * part read as the whole scores otherwise), where it is stale, and, given
 * the truth, where it lacks a row's parent's last set, so a replay is not
 * spent before the matcher finds out.
 */
export function loadCatalogue(archive: string, breakups?: readonly Breakup[]): Catalogue {
  const path = catalogueIndexPath(archive);
  if (!existsSync(path)) throw new Error(`no catalogue index at ${path}: the scorecard reads every year's catalogue through it, and the Archive on disk may hold only the years replayed; build it from the whole Archive (npm run kpi:index) or download it with the side files (npm run archive:download)`);
  const index = readCatalogueIndex(path);
  assertFresh(archive, index, path);
  if (breakups !== undefined) {
    const held = new Set(index.parentOrbits.map((row) => parentKey(row[0], row[1])));
    const missing = parentInstantsOf(breakups).filter(([parent, at]) => !held.has(parentKey(parent, at)));
    if (missing.length > 0) throw new Error(`the catalogue index ${path} was built for another truth: it holds no last set of ${missing.slice(0, 5).map(([parent, at]) => `${parent} before ${new Date(at).toISOString()}`).join(", ")}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}; ${REBUILD}`);
  }
  return catalogueFromIndex(index);
}

/** When the index file was last written, for a reader's cache: null where there is none. */
export function indexWrittenAt(archive: string): number | null {
  const path = catalogueIndexPath(archive);
  return existsSync(path) ? statSync(path).mtimeMs : null;
}

function main(): void {
  const archive = archiveHome();
  const bytes = readFileSync(join(ROOT, "data/breakups.json"));
  const breakups = readBreakups(JSON.parse(bytes.toString("utf8")));
  const started = performance.now();
  const index = buildCatalogueIndex(archive, breakups, createHash("sha256").update(bytes).digest("hex"));
  const path = writeCatalogueIndex(archive, index);
  const years = Object.keys(index.years);
  console.log(`${path}: ${index.bodies.length} bodies and ${index.parentOrbits.length} parents' last sets over ${years[0]} to ${years.at(-1)} (${years.length} years), ${(statSync(path).size / 1e6).toFixed(1)} MB, ${Math.round((performance.now() - started) / 1000)} s`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("catalogue-index.ts")) main();
