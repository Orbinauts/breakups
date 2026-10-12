import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, rmSync, statSync } from "node:fs";
import { archiveHome, bundleFile, bundlePath, writeYear, type ArchivedBody, type ColumnArray, type ColumnName, type Columns, type Manifest, type Reject, COLUMN_TYPES, fixedOfField, REQUIRED_COLUMNS, sha256File } from "./archive.ts";
import { latestSatcat } from "./satcat.ts";

/**
 * Strips a yearly bundle of two-line sets into the Archive's columns for
 * that year: `npm run archive:strip -- 2013 [2014 ...] [--keep]`. The zip's
 * one text member is streamed through `unzip -p` and never unpacked to
 * disk; every pair of lines is read by column into the typed arrays, a
 * line that is not a set is counted as a reject and kept as a sample;
 * the sets are then ordered by object and publication rank, the body table
 * is joined to the latest satellite-catalogue snapshot, and the year is
 * written whole. The zip is deleted once the year is written unless
 * `--keep` is given. One year takes a few minutes.
 */

const LINE = 69;
/**
 * A line the bundles print one character short, or with a backslash where
 * the checksum goes (hundreds of thousands a year, from some generator's
 * escaping): read as if its checksum were right.
 */
const SHORT_LINE = 68;

export { catalogueNumber, epochMs };

/** The 1-based catalogue number from the five columns, Alpha-5 letters read as the format defines them. */
function catalogueNumber(field: string): number {
  const s = field.trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^([A-HJ-NP-Z])(\d{4})$/.exec(s);
  if (m === null) return Number.NaN;
  const letter = m[1]!.charCodeAt(0) - 65;
  // I and O are skipped: A=10 ... H=17, J=18 ... N=22, P=23 ... Z=33.
  const value = letter < 8 ? letter + 10 : letter < 14 ? letter + 9 : letter + 8;
  return value * 10000 + Number(m[2]);
}

/** A signed fixed-point decimal with its leading zero dropped, "-.00000123", as an integer of `decimals` places. */
function signedFixed(field: string, decimals: number): number {
  const s = field.trim();
  const sign = s.startsWith("-") ? -1 : 1;
  return sign * fixedOfField(s.replace(/^[+-]/, ""), decimals);
}

/** An implied-point exponential, "-12007-3", as a number. */
function exponential(field: string): number {
  const m = /^([+-]?)(\d{1,6})([+-]\d)$/.exec(field.trim());
  if (m === null) return Number.NaN;
  return Number(`${m[1]}0.${m[2]}e${m[3]}`);
}

/** The two-line epoch "25001.00717115" in milliseconds since 1970. */
function epochMs(field: string): number {
  const m = /^(\d{2})(\d{3})\.(\d+)$/.exec(field.trim());
  if (m === null) return Number.NaN;
  const yy = Number(m[1]);
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return Date.UTC(year, 0, Number(m[2])) + Number(`0.${m[3]}`) * 86_400_000;
}

/** The international designator "22107Q" as "2022-107Q", or null for none. */
function designatorOf(field: string): string | null {
  const s = field.trim();
  if (s === "") return null;
  const m = /^(\d{2})(\d{3})([A-Z]{1,3})$/.exec(s);
  if (m === null) return null;
  const yy = Number(m[1]);
  return `${yy < 57 ? 2000 + yy : 1900 + yy}-${m[2]}${m[3]}`;
}

function checksumOk(line: string): boolean {
  if (line.length < LINE) return true;
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    const c = line.charCodeAt(i);
    if (c === 45) sum += 1;
    else if (c >= 48 && c <= 57) sum += c - 48;
  }
  return String(sum % 10) === line[68];
}

/** Typed arrays that grow as sets arrive. */
class Growing {
  private capacity: number;
  length = 0;
  columns: Record<ColumnName, ColumnArray>;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.columns = {} as Record<ColumnName, ColumnArray>;
    for (const name of REQUIRED_COLUMNS) this.columns[name] = new COLUMN_TYPES[name](capacity);
  }

  ensure(): void {
    if (this.length < this.capacity) return;
    this.capacity = Math.ceil(this.capacity * 1.5);
    for (const name of REQUIRED_COLUMNS) {
      const grown = new COLUMN_TYPES[name](this.capacity);
      grown.set(this.columns[name] as never);
      this.columns[name] = grown;
    }
  }
}

interface Parsed {
  number: number;
  designator: string | null;
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
}

/** A pair of lines as a set, or the reason it is not one. */
export function parsePair(line1: string, line2: string): Parsed | string {
  if (line1.length < SHORT_LINE || line2.length < SHORT_LINE) return "a line shorter than 68 characters";
  if (!checksumOk(line1)) return "line 1 fails its checksum";
  if (!checksumOk(line2)) return "line 2 fails its checksum";
  const number = catalogueNumber(line1.slice(2, 7));
  const other = catalogueNumber(line2.slice(2, 7));
  if (!Number.isFinite(number)) return "catalogue number unreadable";
  if (number !== other) return "the two lines name different objects";
  const set: Parsed = {
    number,
    designator: designatorOf(line1.slice(9, 17)),
    epoch: epochMs(line1.slice(18, 32)),
    meanMotion: fixedOfField(line2.slice(52, 63), 8),
    eccentricity: fixedOfField(line2.slice(26, 33), 0),
    inclination: fixedOfField(line2.slice(8, 16), 4),
    raan: fixedOfField(line2.slice(17, 25), 4),
    argOfPerigee: fixedOfField(line2.slice(34, 42), 4),
    meanAnomaly: fixedOfField(line2.slice(43, 51), 4),
    bstar: exponential(line1.slice(53, 61)),
    meanMotionDot: signedFixed(line1.slice(33, 43), 8),
    meanMotionDdot: exponential(line1.slice(44, 52)),
    elementSetNumber: Number(line1.slice(64, 68).trim() || "0"),
    revAtEpoch: Number(line2.slice(63, 68).trim() || "0"),
  };
  for (const [field, value] of Object.entries(set)) if (typeof value === "number" && !Number.isFinite(value)) return `${field} unreadable`;
  if (set.elementSetNumber > 65535) set.elementSetNumber = 65535;
  return set;
}

/** The zip's one text member, by name. */
function memberOf(zip: string): Promise<{ name: string; bytes: number }> {
  return new Promise((resolveMember, reject) => {
    const listing = spawn("unzip", ["-Z1", zip]);
    let out = "";
    listing.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    listing.on("close", (code) => {
      if (code !== 0) return reject(new Error(`unzip -Z1 ${zip} exited ${code}`));
      const names = out.split("\n").filter((name) => name.endsWith(".txt") && !name.includes("__MACOSX"));
      if (names.length !== 1) return reject(new Error(`${zip} holds ${names.length} text members: ${names.join(", ")}`));
      const sizes = spawn("unzip", ["-Zl", zip]);
      let lines = "";
      sizes.stdout.on("data", (chunk: Buffer) => (lines += chunk.toString()));
      sizes.on("close", () => {
        const row = lines.split("\n").find((line) => line.endsWith(names[0]!));
        const bytes = Number(row?.trim().split(/\s+/)[3] ?? "0");
        resolveMember({ name: names[0]!, bytes });
      });
    });
  });
}

export interface Stripped {
  columns: Columns;
  bodies: ArchivedBody[];
  sets: number;
  rejects: number;
  rejectSamples: Reject[];
  withoutSatcat: number;
}

/** Reads every set of the member into columns ordered by object then rank. */
async function strip(zip: string, member: { name: string; bytes: number }, satcat: ReturnType<typeof latestSatcat>): Promise<Stripped> {
  const growing = new Growing(Math.ceil((member.bytes / 140) * 1.05) + 1000);
  const designators = new Map<number, string | null>();
  const rejectSamples: Reject[] = [];
  let rejects = 0;
  let rank = 0;
  let pending: string | null = null;
  let tail = "";
  const take = (line: string): void => {
    if (pending === null) {
      if (line.startsWith("1 ")) pending = line;
      else {
        rank++;
        rejects++;
        if (rejectSamples.length < 20) rejectSamples.push({ rank, reason: "a line that is not line 1 of a set", lines: [line] });
      }
      return;
    }
    rank++;
    if (!line.startsWith("2 ")) {
      rejects++;
      if (rejectSamples.length < 20) rejectSamples.push({ rank, reason: "line 1 not followed by line 2", lines: [pending, line] });
      pending = line.startsWith("1 ") ? line : null;
      return;
    }
    const set = parsePair(pending, line);
    const pair = [pending, line];
    pending = null;
    if (typeof set === "string") {
      rejects++;
      if (rejectSamples.length < 20) rejectSamples.push({ rank, reason: set, lines: pair });
      return;
    }
    growing.ensure();
    const i = growing.length++;
    const c = growing.columns;
    c.number[i] = set.number;
    c.epoch[i] = set.epoch;
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
    c.rank[i] = rank;
    if (!designators.has(set.number)) designators.set(set.number, set.designator);
  };
  await new Promise<void>((resolveRead, reject) => {
    const reader = spawn("unzip", ["-p", zip, member.name]);
    reader.stdout.on("data", (chunk: Buffer) => {
      const text = tail + chunk.toString("latin1");
      let start = 0;
      for (let end = text.indexOf("\n", start); end !== -1; start = end + 1, end = text.indexOf("\n", start)) {
        let line = text.slice(start, end).replace(/[\r\\]+$/, "");
        // Some bundles leave a blank line between pairs.
        if (line !== "") take(line);
      }
      tail = text.slice(start);
    });
    reader.on("error", reject);
    reader.on("close", (code) => {
      if (tail !== "") take(tail);
      code === 0 ? resolveRead() : reject(new Error(`unzip -p exited ${code}`));
    });
  });
  // Order by object then rank: a counting sort over the catalogue number, which keeps the file order inside an object.
  const n = growing.length;
  const numbers = growing.columns.number as Uint32Array;
  let max = 0;
  for (let i = 0; i < n; i++) if (numbers[i]! > max) max = numbers[i]!;
  const counts = new Uint32Array(max + 2);
  for (let i = 0; i < n; i++) counts[numbers[i]! + 1]!++;
  for (let v = 1; v < counts.length; v++) counts[v]! += counts[v - 1]!;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[counts[numbers[i]!]!++] = i;
  const columns = {} as Record<ColumnName, ColumnArray>;
  for (const name of REQUIRED_COLUMNS) {
    const from = growing.columns[name];
    const to = new COLUMN_TYPES[name](n);
    for (let i = 0; i < n; i++) to[i] = from[order[i]!]!;
    columns[name] = to;
  }
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
  return { columns: columns as unknown as Columns, bodies, sets: n, rejects, rejectSamples, withoutSatcat };
}

export async function stripYear(archive: string, year: number, keep: boolean): Promise<Manifest> {
  const zip = bundlePath(archive, year);
  if (!existsSync(zip)) throw new Error(`no bundle at ${zip}`);
  const started = Date.now();
  const satcat = latestSatcat(archive);
  const [sha256, member] = await Promise.all([sha256File(zip), memberOf(zip)]);
  const stripped = await strip(zip, member, satcat);
  const columnSha256: Manifest["columnSha256"] = {};
  for (const name of REQUIRED_COLUMNS) {
    const column = stripped.columns[name]!;
    columnSha256[name] = createHash("sha256").update(new Uint8Array(column.buffer, column.byteOffset, column.byteLength)).digest("hex");
  }
  const manifest: Manifest = {
    format: 1,
    year,
    source: { kind: "bundle", file: bundleFile(year), bytes: statSync(zip).size, sha256, member: member.name, memberBytes: member.bytes },
    columns: [...REQUIRED_COLUMNS],
    sets: stripped.sets,
    bodies: stripped.bodies.length,
    withoutSatcat: stripped.withoutSatcat,
    satcat: satcat?.day ?? null,
    rejects: stripped.rejects,
    rejectSamples: stripped.rejectSamples,
    columnSha256,
    builtAt: new Date().toISOString(),
    buildSeconds: 0,
  };
  manifest.buildSeconds = Math.round((Date.now() - started) / 10) / 100;
  writeYear(archive, { manifest, bodies: stripped.bodies, columns: stripped.columns });
  if (!keep) rmSync(zip);
  return manifest;
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("strip.ts")) {
  const args = process.argv.slice(2);
  const keep = args.includes("--keep");
  const years = args.filter((a) => /^\d{4}$/.test(a)).map(Number);
  if (years.length === 0) throw new Error("give the years to strip: npm run archive:strip -- 2013 2014 [--keep]");
  const archive = archiveHome();
  for (const year of years) {
    const manifest = await stripYear(archive, year, keep);
    console.log(`${year}: ${manifest.sets} sets of ${manifest.bodies} objects (${manifest.withoutSatcat} without a catalogue row), ${manifest.rejects} rejects, ${manifest.buildSeconds} s`);
  }
}
