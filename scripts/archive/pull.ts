import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { constants as zlibConstants, gunzipSync, gzipSync } from "node:zlib";
import { archiveHome, writeYear, type ArchivedBody, type ArchiveYear, type ColumnArray, type ColumnName, type Columns, type HistorySource, type Manifest, COLUMN_TYPES, fixedOfDecimal, REQUIRED_COLUMNS } from "./archive.ts";
import { latestSatcat } from "./satcat.ts";
import { parsePair } from "./strip.ts";
import { credentialsFromEnv, SpaceTrack } from "./space-track.ts";

/**
 * Pulls a year the bundles do not cover (the current one) from the
 * catalogue's history class, one day of epochs per request, each day's
 * answer kept under `history/<year>/<day>.json.gz`, then builds the year's
 * columns from the kept days: `npm run archive:pull -- 2026 [--through
 * YYYY-MM-DD]`. A day pulled once it has settled, two days after its
 * end, is kept for good; a more recent day is pulled again on every later
 * run, past the cache, until a pull after it has settled, since the
 * catalogue publishes a set hours after its epoch. Each kept day says in
 * itself when it was pulled (`keepDay`), so the reading survives any copy
 * of the files; a day kept empty is pulled again on every run, and the
 * year counts it missing. The catalogue's day range holds both its ends,
 * so a set whose epoch is exactly midnight comes in two days' answers: the
 * year counts it once. A bundle year, once published, replaces a pulled
 * one.
 */

export const SETTLE_DAYS = 2;
export const historyDir = (archive: string, year: number): string => join(archive, "history", String(year));

const FIELDS = ["NORAD_CAT_ID", "OBJECT_ID", "EPOCH", "MEAN_MOTION", "ECCENTRICITY", "INCLINATION", "RA_OF_ASC_NODE", "ARG_OF_PERICENTER", "MEAN_ANOMALY", "BSTAR", "MEAN_MOTION_DOT", "MEAN_MOTION_DDOT", "ELEMENT_SET_NO", "REV_AT_EPOCH", "CREATION_DATE", "GP_ID"] as const;

const dayQuery = (day: string, next: string): string => `/basicspacedata/query/class/gp_history/EPOCH/${day}--${next}/orderby/CREATION_DATE%20asc,GP_ID%20asc/predicates/${FIELDS.join(",")}/format/json`;

const dayAfter = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

const utcMs = (text: string): number => Date.parse(text.endsWith("Z") ? text : `${text}Z`);

/** Whether a day kept at `keptAt` was kept for good: pulled once it had settled, `SETTLE_DAYS` after its end. */
export const keptSettled = (day: string, keptAt: number): boolean => keptAt >= Date.parse(`${day}T00:00:00Z`) + (1 + SETTLE_DAYS) * 86_400_000;

/**
 * The days to pull: every day of the year to `through`, less those kept
 * for good. A day kept before it settled is pulled again on every run
 * until a pull after it has settled, so a run sees the sets the catalogue
 * published for the recent days since the last run, not only those it had
 * published when the day was first pulled. A day kept empty is never kept
 * for good: the catalogue publishes thousands of sets a day, so an empty
 * answer is a passing fault of the catalogue's, asked again on each run.
 */
export function daysToPull(archive: string, year: number, through: string): string[] {
  const dir = historyDir(archive, year);
  const days: string[] = [];
  for (let day = `${year}-01-01`; day <= through && day.startsWith(String(year)); day = dayAfter(day)) {
    const kept = join(dir, `${day}.json.gz`);
    if (existsSync(kept)) {
      const head = keptHead(kept);
      if (!head.empty && keptSettled(day, head.pulledAt)) continue;
    }
    days.push(day);
  }
  return days;
}

/**
 * A day's answer kept with the time it was pulled, so the slice says for
 * itself whether it was kept for good, wherever its file has been copied:
 * `{"pulledAt":"<ISO time>","rows":[...]}`, gzipped. A slice kept before
 * the pull marked them is the bare array of rows, the time it was pulled
 * its file's modification time.
 */
export function keepDay(path: string, rows: readonly unknown[], pulledAt: number): void {
  writeMarked(path, JSON.stringify(rows), pulledAt);
}

/** A slice written whole under its name, its rows' JSON text as given, marked with the time they were pulled. */
function writeMarked(path: string, rowsText: string, pulledAt: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.keeping`, gzipSync(`{"pulledAt":${JSON.stringify(new Date(pulledAt).toISOString())},"rows":${rowsText}}`));
  renameSync(`${path}.keeping`, path);
}

/** A kept day's file name, the only files a year's history holds. */
export const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.json\.gz$/;

const MARKED = /^\{"pulledAt":"([^"]+)","rows":\[\s*(\])?/;
const BARE = /^\s*\[\s*(\])?/;

/**
 * What a kept slice's first bytes say, read without unpacking the whole
 * day: when it was pulled (its mark, or a bare slice's modification time)
 * and whether it is empty. A slice that cannot be read counts as empty.
 */
function keptHead(path: string): { pulledAt: number; empty: boolean; bare: boolean } {
  const unreadable = { pulledAt: Number.NEGATIVE_INFINITY, empty: true, bare: false };
  const fd = openSync(path, "r");
  const head = Buffer.alloc(4096);
  const read = readSync(fd, head, 0, head.length, 0);
  closeSync(fd);
  let text: string;
  try {
    text = gunzipSync(head.subarray(0, read), { finishFlush: zlibConstants.Z_SYNC_FLUSH }).toString("utf8");
  } catch {
    return unreadable;
  }
  const marked = MARKED.exec(text);
  if (marked !== null) return { pulledAt: Date.parse(marked[1]!), empty: marked[2] !== undefined, bare: false };
  const bare = BARE.exec(text);
  if (bare !== null) return { pulledAt: statSync(path).mtimeMs, empty: bare[1] !== undefined, bare: true };
  return unreadable;
}

/** A kept slice's rows, marked or bare. */
function keptRows(path: string): KeptRow[] {
  const kept = JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as KeptRow[] | { pulledAt: string; rows: KeptRow[] };
  return Array.isArray(kept) ? kept : kept.rows;
}

/**
 * Every bare slice of a year marked with the time its file's modification
 * time says it was pulled, its rows kept as they were, so the reading no
 * longer hangs on that time surviving the next copy: run on the machine
 * that pulled the slices, or after a copy that kept the times (the
 * release's tarball, unpacked by GNU tar). The days marked, by name.
 */
export function markKept(archive: string, year: number): string[] {
  const dir = historyDir(archive, year);
  if (!existsSync(dir)) return [];
  const marked: string[] = [];
  for (const file of readdirSync(dir).filter((f) => DAY_FILE.test(f)).sort()) {
    const path = join(dir, file);
    const head = keptHead(path);
    if (!head.bare) continue;
    writeMarked(path, gunzipSync(readFileSync(path)).toString("utf8").trim(), head.pulledAt);
    marked.push(file.slice(0, 10));
  }
  return marked;
}

/** A kept day's row: the OMM fields this script asks for, or the two lines an earlier cache kept, each with its creation time. */
interface KeptRow {
  NORAD_CAT_ID: string;
  EPOCH: string;
  CREATION_DATE: string;
  GP_ID?: string;
  OBJECT_ID?: string;
  TLE_LINE1?: string;
  TLE_LINE2?: string;
  MEAN_MOTION?: string;
  ECCENTRICITY?: string;
  INCLINATION?: string;
  RA_OF_ASC_NODE?: string;
  ARG_OF_PERICENTER?: string;
  MEAN_ANOMALY?: string;
  BSTAR?: string;
  MEAN_MOTION_DOT?: string;
  MEAN_MOTION_DDOT?: string;
  ELEMENT_SET_NO?: string;
  REV_AT_EPOCH?: string;
}

/** Typed arrays that grow as sets arrive, one per column plus the creation time and the order the days were read in. */
class Growing {
  length = 0;
  private capacity: number;
  columns: Record<ColumnName, ColumnArray>;
  constructor(capacity: number) {
    this.capacity = capacity;
    this.columns = {} as Record<ColumnName, ColumnArray>;
    for (const name of [...REQUIRED_COLUMNS, "created"] as const) this.columns[name] = new COLUMN_TYPES[name](capacity);
  }
  ensure(): void {
    if (this.length < this.capacity) return;
    this.capacity = Math.ceil(this.capacity * 1.5);
    for (const name of [...REQUIRED_COLUMNS, "created"] as const) {
      const grown = new COLUMN_TYPES[name](this.capacity);
      grown.set(this.columns[name] as never);
      this.columns[name] = grown;
    }
  }
}

/**
 * The year's columns from every kept day, read one day at a time, ordered
 * by object then publication (the creation time, then the catalogue's id
 * where the day has it, else the order the day listed them in).
 */
export function buildFromHistory(archive: string, year: number): { columns: Columns; bodies: ArchivedBody[]; sets: number; withoutSatcat: number; from: string; through: string; missing: string[] } {
  const dir = historyDir(archive, year);
  const days = readdirSync(dir).filter((f) => DAY_FILE.test(f)).sort();
  if (days.length === 0) throw new Error(`no days kept under ${dir}`);
  const growing = new Growing(2_000_000);
  const designators = new Map<number, string | null>();
  const gpIds: number[] = [];
  let seq = 0;
  // The day range is inclusive at both ends, so a set whose epoch is exactly midnight is in two days' answers: it is kept from the first.
  let previousDay = new Set<string>();
  const withSets = new Set<string>();
  for (const file of days) {
    const rows = keptRows(join(dir, file));
    if (rows.length > 0) withSets.add(file.slice(0, 10));
    const thisDay = new Set<string>();
    for (const row of rows) {
      const key = row.GP_ID ?? `${row.TLE_LINE1}\n${row.TLE_LINE2}\n${row.CREATION_DATE}`;
      if (previousDay.has(key) || thisDay.has(key)) continue;
      thisDay.add(key);
      let set: { number: number; designator: string | null; meanMotion: number; eccentricity: number; inclination: number; raan: number; argOfPerigee: number; meanAnomaly: number; bstar: number; meanMotionDot: number; meanMotionDdot: number; elementSetNumber: number; revAtEpoch: number };
      if (row.TLE_LINE1 !== undefined && row.TLE_LINE2 !== undefined) {
        const parsed = parsePair(row.TLE_LINE1, row.TLE_LINE2);
        if (typeof parsed === "string") continue;
        set = parsed;
      } else {
        set = {
          number: Number(row.NORAD_CAT_ID),
          designator: row.OBJECT_ID || null,
          meanMotion: fixedOfDecimal(row.MEAN_MOTION!, 8),
          eccentricity: fixedOfDecimal(row.ECCENTRICITY!, 7),
          inclination: fixedOfDecimal(row.INCLINATION!, 4),
          raan: fixedOfDecimal(row.RA_OF_ASC_NODE!, 4),
          argOfPerigee: fixedOfDecimal(row.ARG_OF_PERICENTER!, 4),
          meanAnomaly: fixedOfDecimal(row.MEAN_ANOMALY!, 4),
          bstar: Number(row.BSTAR),
          meanMotionDot: fixedOfDecimal(row.MEAN_MOTION_DOT!, 8),
          meanMotionDdot: Number(row.MEAN_MOTION_DDOT),
          elementSetNumber: Math.min(Number(row.ELEMENT_SET_NO) || 0, 65535),
          revAtEpoch: Number(row.REV_AT_EPOCH) || 0,
        };
      }
      growing.ensure();
      const i = growing.length++;
      const c = growing.columns;
      c.number[i] = set.number;
      c.epoch[i] = utcMs(row.EPOCH);
      c.meanMotion[i] = set.meanMotion;
      c.eccentricity[i] = set.eccentricity;
      c.inclination[i] = set.inclination;
      c.raan[i] = set.raan;
      c.argOfPerigee[i] = set.argOfPerigee;
      c.meanAnomaly[i] = set.meanAnomaly;
      c.bstar[i] = set.bstar;
      c.meanMotionDot[i] = set.meanMotionDot;
      c.meanMotionDdot[i] = set.meanMotionDdot;
      c.elementSetNumber[i] = set.elementSetNumber;
      c.revAtEpoch[i] = set.revAtEpoch;
      c.created![i] = utcMs(row.CREATION_DATE);
      gpIds.push(row.GP_ID !== undefined ? Number(row.GP_ID) : seq);
      seq++;
      if (!designators.has(set.number)) designators.set(set.number, set.designator);
    }
    previousDay = thisDay;
  }
  const n = growing.length;
  // Publication order: by creation time, then the catalogue's id or the day's listing.
  const byPublication = new Uint32Array(n);
  for (let i = 0; i < n; i++) byPublication[i] = i;
  const created = growing.columns.created as Float64Array;
  byPublication.sort((a, b) => created[a]! - created[b]! || gpIds[a]! - gpIds[b]!);
  const rank = growing.columns.rank as Uint32Array;
  for (let r = 0; r < n; r++) rank[byPublication[r]!] = r + 1;
  // Then by object, keeping publication order inside an object: a counting sort over the catalogue number of the publication-ordered sets.
  const numbers = growing.columns.number as Uint32Array;
  let max = 0;
  for (let i = 0; i < n; i++) if (numbers[i]! > max) max = numbers[i]!;
  const counts = new Uint32Array(max + 2);
  for (let i = 0; i < n; i++) counts[numbers[i]! + 1]!++;
  for (let v = 1; v < counts.length; v++) counts[v]! += counts[v - 1]!;
  const order = new Uint32Array(n);
  for (let r = 0; r < n; r++) {
    const i = byPublication[r]!;
    order[counts[numbers[i]!]!++] = i;
  }
  const names: ColumnName[] = [...REQUIRED_COLUMNS, "created"];
  const columns = {} as Record<ColumnName, ColumnArray>;
  for (const name of names) {
    const to = new COLUMN_TYPES[name](n);
    const from = growing.columns[name];
    for (let i = 0; i < n; i++) to[i] = from[order[i]!]!;
    columns[name] = to;
  }
  const satcat = latestSatcat(archive);
  const sorted = columns.number as Uint32Array;
  const bodies: ArchivedBody[] = [];
  let withoutSatcat = 0;
  for (let i = 0; i < n; ) {
    const number = sorted[i]!;
    let j = i;
    while (j < n && sorted[j] === number) j++;
    const row = satcat?.rows.get(number);
    if (row === undefined) withoutSatcat++;
    bodies.push({ number, first: i, count: j - i, designator: row?.designator ?? designators.get(number) ?? null, name: row?.name ?? null, bodyClass: row?.bodyClass ?? "unknown", launch: row?.launch ?? null, decay: row?.decay ?? null, opsStatus: row?.opsStatus ?? null });
    i = j;
  }
  const kept = days.map((f) => f.slice(0, 10));
  const missing: string[] = [];
  for (let day = kept[0]!; day <= kept.at(-1)!; day = dayAfter(day)) if (!withSets.has(day)) missing.push(day);
  return { columns: columns as unknown as Columns, bodies, sets: n, withoutSatcat, from: kept[0]!, through: kept.at(-1)!, missing };
}

/**
 * A year built from its kept days as the Archive writes it: the columns,
 * the body table (named from the latest satellite catalogue under the
 * Archive) and the manifest, not yet written. The pull writes it in place;
 * the weekly maintenance promotes a closed year of the prospective test's
 * day slices with it (`scripts/maintenance/promote.ts`).
 */
export function historyYear(archive: string, year: number): ArchiveYear {
  const started = Date.now();
  const built = buildFromHistory(archive, year);
  const columnSha256: Manifest["columnSha256"] = {};
  for (const name of [...REQUIRED_COLUMNS, "created"] as const) {
    const column = built.columns[name]!;
    columnSha256[name] = createHash("sha256").update(new Uint8Array(column.buffer, column.byteOffset, column.byteLength)).digest("hex");
  }
  const manifest: Manifest = {
    format: 1,
    year,
    source: { kind: "history", from: built.from, through: built.through, missing: built.missing },
    columns: [...REQUIRED_COLUMNS, "created"],
    sets: built.sets,
    bodies: built.bodies.length,
    withoutSatcat: built.withoutSatcat,
    satcat: latestSatcat(archive)?.day ?? null,
    rejects: 0,
    rejectSamples: [],
    columnSha256,
    builtAt: new Date().toISOString(),
    buildSeconds: Math.round((Date.now() - started) / 10) / 100,
  };
  return { manifest, bodies: built.bodies, columns: built.columns };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const year = Number(args.find((a) => /^\d{4}$/.test(a)));
  if (!Number.isInteger(year)) throw new Error("give the year: npm run archive:pull -- 2026 [--through YYYY-MM-DD]");
  const throughIndex = args.indexOf("--through");
  const today = new Date().toISOString().slice(0, 10);
  const through = throughIndex === -1 ? today : args[throughIndex + 1]!;
  const archive = archiveHome();
  const client = new SpaceTrack(credentialsFromEnv(), archive);
  const marked = markKept(archive, year);
  if (marked.length > 0) console.log(`${marked.length} days kept before the slices were marked, marked with the time their files say they were pulled`);
  const days = daysToPull(archive, year, through);
  console.log(`${days.length} days to pull for ${year} through ${through}`);
  let pulled = 0;
  for (const day of days) {
    // A day kept before it settled, or kept empty, is asked for again, past the cache; its answer replaces the kept one only once it has come, marked with the time it was asked for.
    const kept = join(historyDir(archive, year), `${day}.json.gz`);
    const again = existsSync(kept);
    const answer = `${kept}.again`;
    rmSync(answer, { force: true });
    const askedAt = Date.now();
    const { rows } = await client.rows<KeptRow>(answer, dayQuery(day, dayAfter(day)));
    keepDay(kept, rows, askedAt);
    rmSync(answer);
    pulled++;
    console.log(`${day}: ${rows.length} sets${again ? " (again: not yet settled, or empty, when kept)" : ""}`);
  }
  const built = historyYear(archive, year);
  writeYear(archive, built);
  const source = built.manifest.source as HistorySource;
  console.log(`${year}: ${built.manifest.sets} sets of ${built.bodies.length} objects from ${source.from} through ${source.through} (${source.missing.length} days missing), ${pulled} requests this run`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("pull.ts")) await main();
