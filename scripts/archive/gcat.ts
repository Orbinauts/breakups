import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DateFormError, parseVagueDate } from "../truth/dates.ts";
import { archiveHome } from "./archive.ts";
import { fetchText } from "./fetch.ts";

/**
 * GCAT's payload catalogue (Jonathan McDowell, planet4589.org, CC-BY-4.0):
 * one row per payload ever launched, with, among much else, three dates
 * of its end of life in GCAT's vague-date form: `TLast`, the last time it
 * was known active; `TOp`, "End Operation Date", when it completed
 * regular operations; and `TDate`, "End of Transmission Date", which GCAT
 * calls the "Dead, Dead, Dead" date: after it the satellite was silent
 * and unresponsive, or no further contact was made by its owners (`*`
 * where it is believed still transmitting). It is the dated status the
 * satellite catalogue's operational code lacks: the code says whether a
 * satellite works today, GCAT says when it stopped, so a backtest can ask
 * whether a satellite could still have been commanded on the day of a
 * step rather than whether it works now. Fetched by hand into the
 * Archive's `gcat/` as served: `npm run archive:gcat`; `npm run
 * archive:annotate` then carries the end date onto every year's body
 * table.
 *
 * The date read is the end of transmission, not the end of operations.
 * The question the detector asks of it is whether the satellite could
 * have burned at the step, and a satellite past its regular operations is
 * still commanded while its owners lower it, raise it to a graveyard or
 * passivate it: Globalstar M044 ended operations in 2009 and raised itself
 * twenty-nine kilometres in November 2012, a week before its end of
 * transmission, and three hundred and twenty-five of the false alarms of
 * the end-of-operations reading on the seventh phase's trial replay were
 * steps between the two dates (`docs/detector/d7-scope.md`).
 *
 * The columns are GCAT's own, documented on its payload-catalogue column
 * page (`web/cat/pcols.html`): `#JCAT` (the catalogue's identifier, `S`
 * and the US catalogue number for every payload the US catalogue lists),
 * `Piece` (the international designator), `Name`, `LDate` (launch),
 * `TLast`, `TOp`, `TDate` and the rest. Only the identifier, the
 * designator, the name and `TDate` are read.
 *
 * Two caveats travel with the date. It is GCAT's belief, updated
 * "infrequently and patchily" in its author's words, so a satellite may
 * have fallen silent earlier or later than the date says. And for a
 * satellite that broke up, the end of transmission is often the breakup
 * itself (Hitomi's is the day of it, Orbcomm FM16's the month): the
 * detector reads an end within a month of a step either way as saying
 * nothing, since it may be the event's own consequence.
 */

export const GCAT_PSATCAT_URL = "https://planet4589.org/space/gcat/tsv/cat/psatcat.tsv";

export const gcatDir = (archive: string): string => join(archive, "gcat");

/** One payload's end of transmission, as GCAT states it. */
export interface GcatPayload {
  number: number;
  designator: string;
  name: string;
  /** `TDate` verbatim, whitespace folded. */
  stated: string;
  /** Whether GCAT believes the payload still transmitting (`*`). */
  operating: boolean;
  /**
   * The last day the stated end of transmission may fall on, as an ISO day,
   * read with GCAT's vague-date convention (a trailing `?` widens the last
   * unit by one either side): `2013 Apr 10` gives `2013-04-10`, `1994 Aug`
   * gives `1994-08-31`, `1998?` gives `1999-12-31`. The upper edge because
   * the detector asks two questions of it: could the satellite still have
   * been working on a day (yes, up to this day) and was it surely dead
   * (only after it). Null where GCAT believes the payload still
   * transmitting, or states no date (`-`).
   */
  endedOn: string | null;
  /** The first day the stated end of transmission may fall on, by the same reading (`1994 Aug` gives `1994-08-01`, `1998?` gives `1997-01-01`); null with `endedOn`. A step inside the window, or within a month of it, cannot say whether the satellite still worked. */
  endedFrom: string | null;
}

export class GcatPayloadFormError extends Error {}

const DAY_MS = 86_400_000;

/** The last day of a month (1 to 12, later months rolling into later years), as an ISO day. */
const lastOfMonth = (year: number, month: number): string => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

/** The first day a vague date may fall on, as an ISO day: the window's lower edge, by the same forms as `lastDayOf`. */
export function firstDayOf(vague: string): string {
  const folded = vague.replace(/\s+\?$/, "?");
  const quarter = /^(\d{4}) Q([1-4])(\?)?$/.exec(folded);
  if (quarter !== null) return new Date(Date.UTC(Number(quarter[1]), (Number(quarter[2]) - 1) * 3 - (quarter[3] === undefined ? 0 : 3), 1)).toISOString().slice(0, 10);
  const decade = /^(\d{3})0s(\?)?$/.exec(folded);
  if (decade !== null) return `${Number(decade[1]) * 10 - (decade[2] === undefined ? 0 : 10)}-01-01`;
  return parseVagueDate(folded).from!.slice(0, 10);
}

/**
 * The last day a vague date may fall on, as an ISO day: the window's upper
 * edge, which is the midnight after its last day. Besides the forms the
 * truth's reader takes, the payload catalogue writes a quarter (`1988 Q1`,
 * `2021 Q2?`) and a decade (`2010s?`) in a few dozen rows; a trailing `?`
 * widens those by a quarter and a decade, by the same convention.
 */
export function lastDayOf(vague: string): string {
  const folded = vague.replace(/\s+\?$/, "?");
  const quarter = /^(\d{4}) Q([1-4])(\?)?$/.exec(folded);
  if (quarter !== null) return lastOfMonth(Number(quarter[1]), Number(quarter[2]) * 3 + (quarter[3] === undefined ? 0 : 3));
  const decade = /^(\d{3})0s(\?)?$/.exec(folded);
  if (decade !== null) return `${Number(decade[1]) * 10 + 9 + (decade[2] === undefined ? 0 : 10)}-12-31`;
  const window = parseVagueDate(folded);
  // A window of whole days ends at the midnight after its last day; an instant ends on its own day.
  const instant = window.precision === "minute" || window.precision === "second";
  return new Date(Date.parse(window.to) - (instant ? 0 : DAY_MS)).toISOString().slice(0, 10);
}

/** The rows of the payload catalogue whose identifier is a US catalogue number (`S` and digits), keyed by that number, with their end of transmission; the header line and GCAT's update line skipped. */
export function parsePsatcat(tsv: string): Map<number, GcatPayload> {
  const lines = tsv.split("\n");
  const header = lines[0]!.replace(/^#/, "").split("\t").map((cell) => cell.trim());
  const at = (name: string): number => {
    const index = header.indexOf(name);
    if (index === -1) throw new GcatPayloadFormError(`GCAT's payload catalogue has no column ${name}`);
    return index;
  };
  const [iJcat, iPiece, iName, iEnd] = [at("JCAT"), at("Piece"), at("Name"), at("TDate")];
  const rows = new Map<number, GcatPayload>();
  for (const line of lines.slice(1)) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const cells = line.split("\t");
    const jcat = /^S(\d+)$/.exec(cells[iJcat]!.trim());
    if (jcat === null) continue;
    const number = Number(jcat[1]);
    const stated = (cells[iEnd] ?? "").replace(/\s+/g, " ").trim();
    const operating = stated === "*";
    let endedOn: string | null = null;
    let endedFrom: string | null = null;
    if (!operating && stated !== "-" && stated !== "") {
      try {
        endedOn = lastDayOf(stated);
        endedFrom = firstDayOf(stated);
      } catch (error) {
        if (error instanceof DateFormError) throw new GcatPayloadFormError(`S${jcat[1]}: unreadable end of transmission "${stated}"`);
        throw error;
      }
    }
    rows.set(number, { number, designator: cells[iPiece]!.trim(), name: cells[iName]!.trim(), stated, operating, endedOn, endedFrom });
  }
  return rows;
}

/** The latest payload-catalogue snapshot's day and rows, or null when none is kept. */
export function latestGcat(archive: string): { day: string; rows: Map<number, GcatPayload> } | null {
  const dir = gcatDir(archive);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((name) => /^psatcat-\d{4}-\d{2}-\d{2}\.tsv$/.test(name)).sort();
  const latest = files.at(-1);
  if (latest === undefined) return null;
  return { day: latest.slice(8, 18), rows: parsePsatcat(readFileSync(join(dir, latest), "utf8")) };
}

async function main(): Promise<void> {
  const archive = archiveHome();
  const tsv = await fetchText(GCAT_PSATCAT_URL);
  const rows = parsePsatcat(tsv);
  const day = new Date().toISOString().slice(0, 10);
  mkdirSync(gcatDir(archive), { recursive: true });
  writeFileSync(join(gcatDir(archive), `psatcat-${day}.tsv`), tsv);
  const operating = [...rows.values()].filter((row) => row.operating).length;
  const dated = [...rows.values()].filter((row) => row.endedOn !== null).length;
  console.log(`gcat/psatcat-${day}.tsv: ${rows.size} payloads, ${operating} believed still transmitting, ${dated} with a dated end of transmission`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("gcat.ts")) await main();
