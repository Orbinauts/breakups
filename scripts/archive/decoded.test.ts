import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ARCHIVE_FORMAT, COLUMN_TYPES, REQUIRED_COLUMNS, decodedDir, readColumn, readYear, writeYear, type ArchiveYear, type ColumnArray, type ColumnName, type Columns, type Manifest } from "./archive.ts";

/**
 * The decoded-column cache: a column read once is kept unpacked under
 * `.decoded/<year>/`, read back from there while the year is the one it
 * was unpacked from, and unpacked afresh once the year is rebuilt.
 */

const YEAR = 2013;

/** A year of three sets whose every column holds `base` plus the set's index, written whole into the Archive. */
function writeTinyYear(archive: string, base: number, builtAt: string): ArchiveYear {
  const columns = {} as Record<ColumnName, ColumnArray>;
  const columnSha256: Partial<Record<ColumnName, string>> = {};
  for (const name of REQUIRED_COLUMNS) {
    const column = new COLUMN_TYPES[name](3);
    for (let i = 0; i < 3; i++) column[i] = name === "rank" || name === "number" ? i : base + i;
    columns[name] = column;
    columnSha256[name] = createHash("sha256").update(new Uint8Array(column.buffer, column.byteOffset, column.byteLength)).digest("hex");
  }
  const manifest: Manifest = { format: ARCHIVE_FORMAT, year: YEAR, source: { kind: "history", from: `${YEAR}-01-01`, through: `${YEAR}-12-31`, missing: [] }, columns: [...REQUIRED_COLUMNS], sets: 3, bodies: 0, withoutSatcat: 0, satcat: null, rejects: 0, rejectSamples: [], columnSha256, builtAt, buildSeconds: 0 };
  const year: ArchiveYear = { manifest, bodies: [], columns: columns as unknown as Columns };
  writeYear(archive, year);
  return year;
}

describe("the decoded-column cache", () => {
  let archive = "";
  const saved = process.env.BREAKUPS_DECODED;
  beforeEach(() => {
    archive = mkdtempSync(join(tmpdir(), "breakups-decoded-"));
    delete process.env.BREAKUPS_DECODED;
  });
  afterEach(() => {
    rmSync(archive, { recursive: true, force: true });
    if (saved === undefined) delete process.env.BREAKUPS_DECODED;
    else process.env.BREAKUPS_DECODED = saved;
  });

  test("keeps a column unpacked on its first read, under the year's build time and the column's hash, and reads it back from there", () => {
    const { manifest } = writeTinyYear(archive, 1000, "2026-01-01T00:00:00.000Z");
    const dir = join(archive, String(YEAR));
    expect([...readColumn(dir, "epoch", 3)]).toEqual([1000, 1001, 1002]);
    const kept = join(decodedDir(archive, YEAR), "epoch.bin");
    expect(readFileSync(kept).byteLength).toBe(3 * Float64Array.BYTES_PER_ELEMENT);
    expect(readFileSync(join(decodedDir(archive, YEAR), "epoch.key"), "utf8")).toBe(`${manifest.builtAt} ${manifest.columnSha256.epoch} 3\n`);
    // What the cache holds is what is read: the gzipped file is not unpacked again.
    writeFileSync(kept, new Uint8Array(new Float64Array([7, 8, 9]).buffer));
    expect([...readColumn(dir, "epoch", 3)]).toEqual([7, 8, 9]);
    expect([...readYear(archive, YEAR).columns.epoch]).toEqual([7, 8, 9]);
  });

  test("unpacks a rebuilt year afresh, its build time and hashes no longer the key", () => {
    writeTinyYear(archive, 1000, "2026-01-01T00:00:00.000Z");
    expect([...readYear(archive, YEAR).columns.meanMotion]).toEqual([1000, 1001, 1002]);
    writeTinyYear(archive, 5000, "2026-02-01T00:00:00.000Z");
    expect([...readYear(archive, YEAR).columns.meanMotion]).toEqual([5000, 5001, 5002]);
    expect(readFileSync(join(decodedDir(archive, YEAR), "meanMotion.key"), "utf8")).toMatch(/^2026-02-01T00:00:00.000Z /);
  });

  test("unpacks afresh a kept column of the wrong length or with no key, and keeps nothing when turned off", () => {
    writeTinyYear(archive, 1000, "2026-01-01T00:00:00.000Z");
    const dir = join(archive, String(YEAR));
    readColumn(dir, "raan", 3);
    writeFileSync(join(decodedDir(archive, YEAR), "raan.bin"), new Uint8Array(4));
    expect([...readColumn(dir, "raan", 3)]).toEqual([1000, 1001, 1002]);
    rmSync(join(decodedDir(archive, YEAR), "raan.key"));
    writeFileSync(join(decodedDir(archive, YEAR), "raan.bin"), new Uint8Array(new Uint32Array([1, 2, 3]).buffer));
    expect([...readColumn(dir, "raan", 3)]).toEqual([1000, 1001, 1002]);
    process.env.BREAKUPS_DECODED = "off";
    rmSync(decodedDir(archive, YEAR), { recursive: true });
    expect([...readColumn(dir, "inclination", 3)]).toEqual([1000, 1001, 1002]);
    expect(existsSync(decodedDir(archive, YEAR))).toBe(false);
  });

  test("keeps no column whose unpacked bytes are not the ones the manifest hashed", () => {
    const { manifest } = writeTinyYear(archive, 1000, "2026-01-01T00:00:00.000Z");
    const dir = join(archive, String(YEAR));
    expect([...readColumn(dir, "bstar", 3, { ...manifest, columnSha256: { ...manifest.columnSha256, bstar: "0".repeat(64) } })]).toEqual([1000, 1001, 1002]);
    expect(existsSync(join(decodedDir(archive, YEAR), "bstar.bin"))).toBe(false);
  });
});
