import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { archiveHome, satcatDir, type BodyClass } from "./archive.ts";
import { fetchText } from "./fetch.ts";

/**
 * The satellite catalogue, as CelesTrak serves it (`satcat.csv`, public):
 * every object ever catalogued with its name, type, launch, decay and
 * operational status. A snapshot is kept per day under the Archive's
 * `satcat/`; the body table of a year is joined to the latest. Run by hand:
 * `npm run archive:satcat`.
 *
 * The operational status is CelesTrak's `OPS_STATUS_CODE`, one letter: `+`
 * operational, `P` partially operational, `B` backup or standby, `S` spare,
 * `X` extended mission, `D` decayed, `-` nonoperational, and blank where
 * nothing is known (every piece of debris and most rocket bodies). It is
 * the status today, not at any past date: a satellite nonoperational in
 * this snapshot may have been working in 2010, so a backtest that reads it
 * carries hindsight, which the detector's fitting note states.
 */

export const SATCAT_URL = "https://celestrak.org/pub/satcat.csv";

export interface SatcatRow {
  number: number;
  designator: string;
  name: string;
  bodyClass: BodyClass;
  launch: string | null;
  decay: string | null;
  /** The operational status code as the catalogue prints it; null where blank. */
  opsStatus: string | null;
}

const classOf = (type: string): BodyClass => (type === "PAY" ? "payload" : type === "R/B" ? "rocket body" : type === "DEB" ? "debris" : "unknown");

/** The rows of a snapshot, keyed by catalogue number. */
export function parseSatcat(csv: string): Map<number, SatcatRow> {
  const lines = csv.split("\n");
  const header = lines[0]!.split(",");
  const at = (name: string): number => {
    const index = header.indexOf(name);
    if (index === -1) throw new Error(`the catalogue has no column ${name}`);
    return index;
  };
  const [iName, iDesignator, iNumber, iType, iLaunch, iDecay, iOps] = [at("OBJECT_NAME"), at("OBJECT_ID"), at("NORAD_CAT_ID"), at("OBJECT_TYPE"), at("LAUNCH_DATE"), at("DECAY_DATE"), at("OPS_STATUS_CODE")];
  const rows = new Map<number, SatcatRow>();
  for (const line of lines.slice(1)) {
    if (line.trim() === "") continue;
    const cells = line.split(",");
    const number = Number(cells[iNumber]);
    if (!Number.isInteger(number)) continue;
    rows.set(number, { number, designator: cells[iDesignator]!, name: cells[iName]!, bodyClass: classOf(cells[iType]!), launch: cells[iLaunch] || null, decay: cells[iDecay] || null, opsStatus: cells[iOps]?.trim() || null });
  }
  return rows;
}

/** The latest snapshot's day and rows, or null when none is kept. */
export function latestSatcat(archive: string): { day: string; rows: Map<number, SatcatRow> } | null {
  const dir = satcatDir(archive);
  if (!existsSync(dir)) return null;
  const days = readdirSync(dir).filter((name) => /^\d{4}-\d{2}-\d{2}\.csv$/.test(name)).sort();
  const latest = days.at(-1);
  if (latest === undefined) return null;
  return { day: latest.slice(0, 10), rows: parseSatcat(readFileSync(join(dir, latest), "utf8")) };
}

async function main(): Promise<void> {
  const archive = archiveHome();
  const csv = await fetchText(SATCAT_URL);
  const rows = parseSatcat(csv);
  const day = new Date().toISOString().slice(0, 10);
  writeFileSync(join(satcatDir(archive), `${day}.csv`), csv);
  console.log(`satcat/${day}.csv: ${rows.size} objects`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("satcat.ts")) await main();
