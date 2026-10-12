import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

/**
 * The Archive: the local store of every catalogued object's past element
 * sets, stripped to the fields the detector reads, one year at a time, in
 * a directory beside the repository (`BREAKUPS_ARCHIVE`, default
 * `../breakups-archive`). This module is the one place that knows its
 * layout on disk, its columns (names, types, units), the body table's and
 * the manifest's shape, and how a year is written and read back; the build
 * writes through it and every reader reads through it. No side effect on
 * import.
 *
 *   <archive>/raw/tle<year>.txt.zip        a yearly bundle, downloaded by hand, deleted once stripped
 *   <archive>/satcat/<day>.csv             a day's satellite catalogue, as served
 *   <archive>/<year>/<column>.bin.gz       one gzipped typed-array column per field, the year's sets sorted by object then rank
 *   <archive>/<year>/bodies.json           the body table
 *   <archive>/<year>/manifest.json         where the year came from and what it holds
 *   <archive>/.decoded/<year>/<column>.bin a column's unpacked bytes, kept on its first read (`readColumn`)
 *   <archive>/.decoded/<year>/<column>.key the key they were unpacked under: the year's build time and the column's hash
 *   <archive>/release-manifest.json        the release's manifest, as the last download fetched it
 *   <archive>/side.sha256                  the hash of the release's side files the last download extracted whole
 *   <archive>/index/catalogue-index.json.gz every body's facts over every year, each year's build time recorded (`scripts/kpi/catalogue-index.ts`)
 *
 * A column file is the typed array's bytes, little endian, gzipped; its
 * unpacked length is the year's set count times the type's width.
 */

export const ARCHIVE_FORMAT = 1;

/** The repository, which never holds the Archive. */
const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The Archive's home: the environment's, else the sibling directory. */
export function archiveHome(): string {
  const home = resolve(process.env.BREAKUPS_ARCHIVE ?? resolve(REPOSITORY, "../breakups-archive"));
  if (home === REPOSITORY || home.startsWith(`${REPOSITORY}/`)) throw new Error(`the Archive must not live inside the repository (${home})`);
  return home;
}

/**
 * A year's sets, one typed array per field, each lossless at the two-line
 * format's own precision (an integer of the printed digits), every array
 * the same length, sorted by object (`number`) then by `rank`, so an
 * object's sets are contiguous and in the order they were published.
 */
export interface Columns {
  /** The catalogue number, any width. */
  number: Uint32Array;
  /** The epoch, in milliseconds since 1970 (a two-line epoch is to 864 microseconds). */
  epoch: Float64Array;
  /** Revolutions a day, in hundred-millionths. */
  meanMotion: Uint32Array;
  /** In ten-millionths. */
  eccentricity: Uint32Array;
  /** Degrees, in ten-thousandths. */
  inclination: Uint32Array;
  raan: Uint32Array;
  argOfPerigee: Uint32Array;
  meanAnomaly: Uint32Array;
  /** The drag term, per Earth radius; its five printed digits survive a 32-bit float. */
  bstar: Float32Array;
  /** Half the first derivative of the mean motion, as printed, in hundred-millionths of a revolution a day squared. */
  meanMotionDot: Int32Array;
  /** A sixth of the second derivative, as printed. */
  meanMotionDdot: Float32Array;
  elementSetNumber: Uint16Array;
  revAtEpoch: Uint32Array;
  /** The set's ordinal in the year's publication order: a bundle's file order, rejects counted. */
  rank: Uint32Array;
  /** When the catalogue published the set, in milliseconds: only a year pulled from the history class has it. */
  created?: Float64Array;
}

export type ColumnName = keyof Columns;
export type ColumnArray = Exclude<Columns[ColumnName], undefined>;
type ColumnType = { new (length: number): ColumnArray; new (buffer: ArrayBuffer, byteOffset: number, length: number): ColumnArray; BYTES_PER_ELEMENT: number };

export const COLUMN_TYPES: { readonly [Name in ColumnName]-?: ColumnType } = {
  number: Uint32Array,
  epoch: Float64Array,
  meanMotion: Uint32Array,
  eccentricity: Uint32Array,
  inclination: Uint32Array,
  raan: Uint32Array,
  argOfPerigee: Uint32Array,
  meanAnomaly: Uint32Array,
  bstar: Float32Array,
  meanMotionDot: Int32Array,
  meanMotionDdot: Float32Array,
  elementSetNumber: Uint16Array,
  revAtEpoch: Uint32Array,
  rank: Uint32Array,
  created: Float64Array,
};

export const REQUIRED_COLUMNS = ["number", "epoch", "meanMotion", "eccentricity", "inclination", "raan", "argOfPerigee", "meanAnomaly", "bstar", "meanMotionDot", "meanMotionDdot", "elementSetNumber", "revAtEpoch", "rank"] as const satisfies readonly ColumnName[];

/**
 * The columns' fixed-point integers, read two ways, one per source: a
 * two-line set's field (`strip.ts`) and an OMM's decimal as the
 * catalogue's history class prints it in JSON (`pull.ts`). They differ on
 * purpose: a two-line field is unsigned (its sign is read apart) and a
 * blank one is unreadable, so the set is rejected; an OMM's decimal may
 * carry a sign or an exponent, and a blank one reads zero.
 */

/** A two-line set's unsigned fixed-point field, "15.49175317", as an integer of `decimals` places; NaN where it is blank, signed or not a decimal. */
export function fixedOfField(field: string, decimals: number): number {
  const s = field.trim();
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (m === null || s === "" || s === ".") return Number.NaN;
  const whole = m[1] === "" || m[1] === undefined ? 0 : Number(m[1]);
  const fraction = (m[2] ?? "").padEnd(decimals, "0").slice(0, decimals);
  return whole * 10 ** decimals + Number(fraction || "0");
}

/** An OMM's decimal, "-0.00001234" or "1.2e-5", as an integer of `decimals` places, exactly from its digits where it has no exponent; a blank reads zero, anything else not a number NaN. */
export function fixedOfDecimal(text: string, decimals: number): number {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text.trim());
  if (m === null) return Number.NaN;
  if (m[4] !== undefined) return Math.round(Number(text) * 10 ** decimals);
  const sign = m[1] === "-" ? -1 : 1;
  const whole = m[2] === "" ? 0 : Number(m[2]);
  const fraction = (m[3] ?? "").padEnd(decimals, "0").slice(0, decimals);
  return sign * (whole * 10 ** decimals + Number(fraction || "0"));
}

export const MEAN_MOTION_UNIT = 1e-8;
export const ECCENTRICITY_UNIT = 1e-7;
export const ANGLE_UNIT = 1e-4;
export const MEAN_MOTION_DOT_UNIT = 1e-8;

/** One set read back in the OMM's units. */
export interface ArchivedSet {
  number: number;
  epoch: number;
  meanMotion: number;
  eccentricity: number;
  inclination: number;
  raan: number;
  argOfPerigee: number;
  meanAnomaly: number;
  bstar: number;
  meanMotionDot: number;
  meanMotionDdot: number;
  elementSetNumber: number;
  revAtEpoch: number;
  rank: number;
  created?: number;
}

/** The set at an index, each value the double nearest the printed decimal. */
export function setAt(columns: Columns, i: number): ArchivedSet {
  const set: ArchivedSet = {
    number: columns.number[i]!,
    epoch: columns.epoch[i]!,
    meanMotion: columns.meanMotion[i]! / 1e8,
    eccentricity: columns.eccentricity[i]! / 1e7,
    inclination: columns.inclination[i]! / 1e4,
    raan: columns.raan[i]! / 1e4,
    argOfPerigee: columns.argOfPerigee[i]! / 1e4,
    meanAnomaly: columns.meanAnomaly[i]! / 1e4,
    bstar: columns.bstar[i]!,
    meanMotionDot: columns.meanMotionDot[i]! / 1e8,
    meanMotionDdot: columns.meanMotionDdot[i]!,
    elementSetNumber: columns.elementSetNumber[i]!,
    revAtEpoch: columns.revAtEpoch[i]!,
    rank: columns.rank[i]!,
  };
  if (columns.created !== undefined) set.created = columns.created[i]!;
  return set;
}

export const BODY_CLASSES = ["payload", "rocket body", "debris", "unknown"] as const;
export type BodyClass = (typeof BODY_CLASSES)[number];

/** A row of the body table: an object with sets in the year, where they sit in the columns, and what the catalogue says of it. */
export interface ArchivedBody {
  number: number;
  /** The index of its first set in the columns, and how many it has. */
  first: number;
  count: number;
  /** The international designator as the sets print it (`1998-067A`), null where they print none (an analyst object). */
  designator: string | null;
  /** From the satellite catalogue snapshot; null where it has no row. */
  name: string | null;
  bodyClass: BodyClass;
  launch: string | null;
  decay: string | null;
  /** The operational status code from the snapshot (`+`, `P`, `B`, `S`, `X`, `D`, `-`); null where blank or where the snapshot has no row; absent in a body table written before the status was carried (`annotate.ts` adds it). The status is the snapshot's, today's, not the year's. */
  opsStatus?: string | null;
  /** The last day GCAT's stated end of transmission of the payload (its owners' last contact) may fall on, as an ISO day (`gcat.ts`); null where GCAT believes the payload still transmitting, states no date, or has no payload row (every rocket body and piece of debris); absent in a body table written before the end dates were carried (`annotate.ts` adds it). Unlike the status, it is dated: it says when, so a replay can read it as of the step. */
  endedOn?: string | null;
  /** The first day that end may fall on (GCAT's dates are vague: `1998?` spans 1997 to 1999); null with `endedOn`. */
  endedFrom?: string | null;
}

export interface BundleSource {
  kind: "bundle";
  file: string;
  bytes: number;
  sha256: string;
  member: string;
  memberBytes: number;
}

export interface HistorySource {
  kind: "history";
  from: string;
  through: string;
  missing: string[];
}

export interface Reject {
  rank: number;
  reason: string;
  lines: string[];
}

export interface Manifest {
  format: typeof ARCHIVE_FORMAT;
  year: number;
  source: BundleSource | HistorySource;
  columns: ColumnName[];
  sets: number;
  bodies: number;
  /** Objects with no catalogue row: analyst objects, or objects catalogued after the snapshot. */
  withoutSatcat: number;
  satcat: string | null;
  rejects: number;
  rejectSamples: Reject[];
  /** The sha256 of each column's unpacked bytes. */
  columnSha256: Partial<Record<ColumnName, string>>;
  builtAt: string;
  buildSeconds: number;
}

export interface ArchiveYear {
  manifest: Manifest;
  bodies: ArchivedBody[];
  columns: Columns;
}

export const rawDir = (archive: string): string => join(archive, "raw");
export const bundleFile = (year: number): string => `tle${year}.txt.zip`;
export const bundlePath = (archive: string, year: number): string => join(rawDir(archive), bundleFile(year));
export const satcatDir = (archive: string): string => join(archive, "satcat");
export const yearDir = (archive: string, year: number): string => join(archive, String(year));
/** The release's manifest as the last download fetched it: every released year's build time, and the side files' hash. */
export const releaseManifestPath = (archive: string): string => join(archive, "release-manifest.json");
/** The catalogue index: what the scorecard reads of every year's catalogue, built once from the whole Archive and shipped with the side files, since a replay holds two years. */
export const catalogueIndexPath = (archive: string): string => join(archive, "index", "catalogue-index.json.gz");

const columnPath = (dir: string, name: string): string => join(dir, `${name}.bin.gz`);

/** A file's SHA-256, in hex, read a piece at a time: a year's tarball is up to 2 GiB, more than a runner should hold at once. */
export function sha256File(path: string): string {
  const hash = createHash("sha256");
  const piece = Buffer.alloc(64 * 1024);
  const fd = openSync(path, "r");
  try {
    for (let read = readSync(fd, piece); read > 0; read = readSync(fd, piece)) hash.update(piece.subarray(0, read));
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

/**
 * The decoded-column cache: a column unpacked once is kept beside the
 * Archive's years, under `.decoded/<year>/`, as the typed array's raw
 * bytes, and read back with a plain file read on every later replay
 * instead of being unpacked again (the unpacking is most of what reading
 * a year costs, a few seconds for the largest). Each kept column carries
 * the key it was unpacked under, the year's build time and the column's
 * hash from the manifest, so a year rebuilt or pulled again is unpacked
 * afresh on its next read; a column is kept only once its unpacked bytes
 * match the manifest's hash. The cache is a working copy, never part of
 * the Archive's release, and may be deleted at any time; setting
 * `BREAKUPS_DECODED=off` reads every column from its gzipped file and
 * keeps nothing.
 */
export const decodedDir = (archive: string, year: number): string => join(archive, ".decoded", String(year));

/** Whether the decoded-column cache is in use: unless the environment turns it off. */
export const decodedCacheOn = (): boolean => process.env.BREAKUPS_DECODED !== "off";

/** The key a column is kept under: the year's build time, the column's hash and its length. */
export const decodedKey = (manifest: Pick<Manifest, "builtAt" | "columnSha256">, name: ColumnName, length: number): string | null => {
  const sha256 = manifest.columnSha256[name];
  return sha256 === undefined ? null : `${manifest.builtAt} ${sha256} ${length}\n`;
};

/** The typed array over bytes of the right length, copied first where they are not aligned to the type's width. */
function typedOf(name: ColumnName, bytes: Uint8Array, length: number): ColumnArray {
  const type = COLUMN_TYPES[name];
  const aligned = bytes.byteOffset % type.BYTES_PER_ELEMENT === 0 ? bytes : Uint8Array.prototype.slice.call(bytes);
  return new type(aligned.buffer as ArrayBuffer, aligned.byteOffset, length);
}

/** The kept bytes of a column, where they are kept under the key and hold the right length; null otherwise. */
function readDecoded(cache: string, name: ColumnName, key: string, byteLength: number): Uint8Array | null {
  const keyPath = join(cache, `${name}.key`);
  const binPath = join(cache, `${name}.bin`);
  if (!existsSync(keyPath) || !existsSync(binPath) || readFileSync(keyPath, "utf8") !== key) return null;
  const bytes = readFileSync(binPath);
  return bytes.byteLength === byteLength ? bytes : null;
}

let warnedUnwritable = false;

/** Keeps a column's unpacked bytes under its key: each file written beside itself and renamed into place, the bytes before the key, so a reader never finds a key over bytes it does not describe, and processes writing the same column at once leave one whole copy. */
function writeDecoded(cache: string, name: ColumnName, key: string, bytes: Uint8Array): void {
  const unique = `${process.pid}.${Date.now()}`;
  try {
    mkdirSync(cache, { recursive: true });
    rmSync(join(cache, `${name}.key`), { force: true });
    writeFileSync(join(cache, `${name}.bin.${unique}`), bytes);
    renameSync(join(cache, `${name}.bin.${unique}`), join(cache, `${name}.bin`));
    writeFileSync(join(cache, `${name}.key.${unique}`), key);
    renameSync(join(cache, `${name}.key.${unique}`), join(cache, `${name}.key`));
  } catch (error) {
    // A cache that cannot be written costs speed, not results.
    if (!warnedUnwritable) console.error(`the decoded-column cache under ${cache} cannot be written (${(error as Error).message}): reading the gzipped columns`);
    warnedUnwritable = true;
  }
}

/**
 * A column file read back and unpacked, checked to hold `length` values:
 * from the decoded-column cache where it holds the column under the
 * manifest's key, else from the gzipped file, then kept. The manifest is
 * the year's own, read from the directory where not given; a directory
 * with none (a column written alone) is never cached.
 */
export function readColumn(dir: string, name: ColumnName, length: number, manifest?: Pick<Manifest, "builtAt" | "columnSha256">): ColumnArray {
  const type = COLUMN_TYPES[name];
  const byteLength = length * type.BYTES_PER_ELEMENT;
  const known = manifest ?? (decodedCacheOn() && existsSync(join(dir, "manifest.json")) ? (JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Manifest) : undefined);
  const key = known === undefined || !decodedCacheOn() ? null : decodedKey(known, name, length);
  const cache = join(dirname(dir), ".decoded", basename(dir));
  if (key !== null) {
    const kept = readDecoded(cache, name, key, byteLength);
    if (kept !== null) return typedOf(name, kept, length);
  }
  const bytes = gunzipSync(readFileSync(columnPath(dir, name)));
  if (bytes.byteLength !== byteLength) throw new Error(`${columnPath(dir, name)} holds ${bytes.byteLength} bytes, not ${length} values`);
  if (key !== null && createHash("sha256").update(bytes).digest("hex") === known!.columnSha256[name]) writeDecoded(cache, name, key, bytes);
  return typedOf(name, bytes, length);
}

export function writeColumn(dir: string, name: ColumnName, column: ColumnArray): void {
  writeFileSync(columnPath(dir, name), gzipSync(new Uint8Array(column.buffer, column.byteOffset, column.byteLength), { level: 6 }));
}

/** The years built in an Archive, oldest first. */
export function builtYears(archive: string): number[] {
  if (!existsSync(archive)) return [];
  return readdirSync(archive)
    .filter((name) => /^\d{4}$/.test(name) && existsSync(join(archive, name, "manifest.json")))
    .map(Number)
    .sort((a, b) => a - b);
}

export function readManifest(archive: string, year: number): Manifest {
  const manifest = JSON.parse(readFileSync(join(yearDir(archive, year), "manifest.json"), "utf8")) as Manifest;
  if (manifest.format !== ARCHIVE_FORMAT) throw new Error(`${year} is in the Archive's format ${manifest.format}, not ${ARCHIVE_FORMAT}: rebuild it`);
  return manifest;
}

export function readBodies(archive: string, year: number): ArchivedBody[] {
  return JSON.parse(readFileSync(join(yearDir(archive, year), "bodies.json"), "utf8")) as ArchivedBody[];
}

/** A year read back whole: its manifest, its body table and its columns. */
export function readYear(archive: string, year: number, only?: readonly ColumnName[]): ArchiveYear {
  const dir = yearDir(archive, year);
  const manifest = readManifest(archive, year);
  const bodies = readBodies(archive, year);
  const columns = {} as Record<ColumnName, ColumnArray>;
  for (const name of manifest.columns) if (only === undefined || only.includes(name)) columns[name] = readColumn(dir, name, manifest.sets, manifest);
  return { manifest, bodies, columns: columns as unknown as Columns };
}

/** Writes a year whole, into a directory beside it first, then renamed into place, so a failed write leaves the old year as it was. */
export function writeYear(archive: string, { manifest, bodies, columns }: ArchiveYear): void {
  const dir = yearDir(archive, manifest.year);
  const building = `${dir}.building`;
  const old = `${dir}.old`;
  rmSync(building, { recursive: true, force: true });
  mkdirSync(building, { recursive: true });
  for (const name of manifest.columns) {
    const column = columns[name];
    if (column === undefined || column.length !== manifest.sets) throw new Error(`the ${name} column does not hold the manifest's ${manifest.sets} sets`);
    writeColumn(building, name, column);
  }
  writeFileSync(join(building, "bodies.json"), `${JSON.stringify(bodies)}\n`);
  writeFileSync(join(building, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  rmSync(old, { recursive: true, force: true });
  if (existsSync(dir)) renameSync(dir, old);
  renameSync(building, dir);
  rmSync(old, { recursive: true, force: true });
}
