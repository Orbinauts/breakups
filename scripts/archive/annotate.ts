import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { archiveHome, builtYears, readBodies, yearDir, type ArchivedBody } from "./archive.ts";
import { latestSatcat, type SatcatRow } from "./satcat.ts";

/**
 * Annotates every built year's body table with the operational status of
 * the latest satellite-catalogue snapshot, without rebuilding the columns:
 * `bodies.json` is rewritten with `opsStatus` set on every body the
 * snapshot has a row for, and null on the rest. Nothing else of the table
 * changes, so the manifest and the columns stand as they were. Run by
 * hand after `npm run archive:satcat`: `npm run archive:annotate`.
 *
 * The status is the snapshot's, so it is today's status for every year:
 * a body table of 2010 annotated in 2026 says what the object is now, not
 * what it was then. The detector reads it as evidence under that caveat.
 */

/** The body table with the snapshot's status on every row; a body with no row in the snapshot gets null. */
export function annotateBodies(bodies: ArchivedBody[], rows: Map<number, SatcatRow>): ArchivedBody[] {
  return bodies.map((body) => ({ ...body, opsStatus: rows.get(body.number)?.opsStatus ?? null }));
}

/** How many bodies of the table carry each status, for the log line. */
export function statusCounts(bodies: ArchivedBody[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const body of bodies) {
    const key = body.opsStatus ?? "none";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function main(): void {
  const archive = archiveHome();
  const satcat = latestSatcat(archive);
  if (satcat === null) throw new Error(`no satellite-catalogue snapshot under ${archive}/satcat: run npm run archive:satcat first`);
  for (const year of builtYears(archive)) {
    const bodies = annotateBodies(readBodies(archive, year), satcat.rows);
    writeFileSync(join(yearDir(archive, year), "bodies.json"), `${JSON.stringify(bodies)}\n`);
    const counts = statusCounts(bodies);
    console.log(`${year}: ${bodies.length} bodies annotated from satcat/${satcat.day}.csv: ${[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([status, count]) => `${status} ${count}`).join(", ")}`);
  }
  // A read back of one year, so a malformed write is seen here rather than by the next replay.
  const years = builtYears(archive);
  if (years.length > 0) JSON.parse(readFileSync(join(yearDir(archive, years[0]!), "bodies.json"), "utf8"));
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("annotate.ts")) main();
