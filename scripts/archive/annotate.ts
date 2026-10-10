import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { archiveHome, builtYears, readBodies, yearDir, type ArchivedBody } from "./archive.ts";
import { latestGcat, type GcatPayload } from "./gcat.ts";
import { latestSatcat, type SatcatRow } from "./satcat.ts";

/**
 * Annotates every built year's body table with the operational status of
 * the latest satellite-catalogue snapshot and the end of transmission of the
 * latest GCAT payload-catalogue snapshot, without rebuilding the columns:
 * `bodies.json` is rewritten with `opsStatus` set on every body the
 * satellite catalogue has a row for, `endedOn` and `endedFrom` (the last
 * and the first day GCAT's vague end date may fall on) on every payload
 * GCAT dates an end for, and null on the rest. Nothing else of the table
 * changes, so the manifest and the columns stand as they were. Run by
 * hand after `npm run archive:satcat` and `npm run archive:gcat`:
 * `npm run archive:annotate`.
 *
 * The status is the snapshot's, so it is today's status for every year:
 * a body table of 2010 annotated in 2026 says what the object is now, not
 * what it was then. The end of transmission is dated, so the detector can
 * read it as of the step: a satellite silent before the
 * step was dead at it, whatever it is today. The detector reads both as
 * evidence under the caveats its fitting notes state.
 */

/** The body table with the satellite catalogue's status and GCAT's end of transmission on every row; a body with no row in either gets null for it. */
export function annotateBodies(bodies: ArchivedBody[], rows: Map<number, SatcatRow>, ends: Map<number, GcatPayload> = new Map()): ArchivedBody[] {
  return bodies.map((body) => ({ ...body, opsStatus: rows.get(body.number)?.opsStatus ?? null, endedOn: ends.get(body.number)?.endedOn ?? null, endedFrom: ends.get(body.number)?.endedFrom ?? null }));
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
  const gcat = latestGcat(archive);
  if (gcat === null) throw new Error(`no GCAT payload-catalogue snapshot under ${archive}/gcat: run npm run archive:gcat first`);
  for (const year of builtYears(archive)) {
    const bodies = annotateBodies(readBodies(archive, year), satcat.rows, gcat.rows);
    writeFileSync(join(yearDir(archive, year), "bodies.json"), `${JSON.stringify(bodies)}\n`);
    const counts = statusCounts(bodies);
    const ended = bodies.filter((body) => body.endedOn !== null && body.endedOn !== undefined).length;
    console.log(`${year}: ${bodies.length} bodies annotated from satcat/${satcat.day}.csv and gcat/psatcat-${gcat.day}.tsv: ${[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([status, count]) => `${status} ${count}`).join(", ")}; ${ended} with a dated end of transmission`);
  }
  // A read back of one year, so a malformed write is seen here rather than by the next replay.
  const years = builtYears(archive);
  if (years.length > 0) JSON.parse(readFileSync(join(yearDir(archive, years[0]!), "bodies.json"), "utf8"));
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("annotate.ts")) main();
