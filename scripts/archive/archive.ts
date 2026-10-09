import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

const columnPath = (dir: string, name: string): string => join(dir, `${name}.bin.gz`);

/** A column file read back and unpacked, checked to hold `length` values. */
export function readColumn(dir: string, name: ColumnName, length: number): ColumnArray {
  const type = COLUMN_TYPES[name];
  const bytes = gunzipSync(readFileSync(columnPath(dir, name)));
  if (bytes.byteLength !== length * type.BYTES_PER_ELEMENT) throw new Error(`${columnPath(dir, name)} holds ${bytes.byteLength} bytes, not ${length} values`);
  const aligned = bytes.byteOffset % type.BYTES_PER_ELEMENT === 0 ? bytes : Uint8Array.prototype.slice.call(bytes);
  return new type(aligned.buffer as ArrayBuffer, aligned.byteOffset, length);
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
  for (const name of manifest.columns) if (only === undefined || only.includes(name)) columns[name] = readColumn(dir, name, manifest.sets);
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
