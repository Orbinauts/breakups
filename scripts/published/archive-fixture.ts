import { ARCHIVE_FORMAT, COLUMN_TYPES, REQUIRED_COLUMNS, writeYear, type ArchivedBody, type ColumnArray, type ColumnName, type Columns, type Manifest } from "../archive/archive.ts";

/**
 * A year of the Archive for the publishing run's tests: the manifest with
 * its source, the body table, and each body's `count` sets, a day apart
 * from the year's first day, on a geosynchronous orbit (one revolution a
 * day, round), so the run can read a body's last set as the scorecard
 * does.
 */
export function writeFixtureYear(archive: string, year: number, source: Manifest["source"], bodies: readonly ArchivedBody[]): void {
  const sets = bodies.reduce((sum, body) => sum + body.count, 0);
  const columns = {} as Record<ColumnName, ColumnArray>;
  for (const name of REQUIRED_COLUMNS) columns[name] = new COLUMN_TYPES[name](sets);
  for (const body of bodies) {
    for (let k = 0; k < body.count; k++) {
      const i = body.first + k;
      columns.number[i] = body.number;
      columns.epoch[i] = Date.UTC(year, 0, 1 + k);
      columns.meanMotion[i] = 100_270_000;
      columns.rank[i] = i;
    }
  }
  const manifest: Manifest = { format: ARCHIVE_FORMAT, year, source, columns: [...REQUIRED_COLUMNS], sets, bodies: bodies.length, withoutSatcat: 0, satcat: null, rejects: 0, rejectSamples: [], columnSha256: {}, builtAt: "2026-01-01T00:00:00.000Z", buildSeconds: 0 };
  writeYear(archive, { manifest, bodies: [...bodies], columns: columns as unknown as Columns });
}
