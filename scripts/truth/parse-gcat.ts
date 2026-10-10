import type { BreakupKind, Cause, Statement } from "../../src/truth.ts";
import { parseVagueDate } from "./dates.ts";

/**
 * GCAT's Space Debris Clouds catalogue (Jonathan McDowell, planet4589.org,
 * CC-BY-4.0), read from its one HTML table: an entry per cloud with the
 * launch it belongs to, the parent (`S` and a catalogue number, `A` and an
 * analyst number, or none), the event date in GCAT's vague-date form, the
 * event type, the parent's orbit at the event and the number of catalogued
 * pieces. The four picture columns are skipped.
 */

export const SOURCE_ID = "gcat" as const;

export class GcatFormError extends Error {}

export const COLUMNS = ["Number", "Piece", "Data", "Height history", "Gabbard", "AngMom", "Name", "Parent", "SDate", "DDate", "EventType", "EventPeri", "EventApo", "EventInc", "NCat", "HtLo", "HtHi", "IncLo", "IncHi", "ApseMode", "Filename", "Label"] as const;

export interface CloudRow {
  number: number;
  /** The launch (`1981-043`), or GCAT's pre-1963 name (`1961 Omi`). */
  piece: string;
  name: string;
  parent: { kind: "catalogue"; number: number } | { kind: "analyst"; number: number } | null;
  sdate: string;
  ddate: string | null;
  eventType: string;
  eventPerigeeKm: number | null;
  eventApogeeKm: number | null;
  eventInclinationDeg: number | null;
  catalogued: number;
  filename: string;
  label: string;
}

const strip = (cell: string): string => cell.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim();

const numberOrNull = (text: string): number | null => (text === "" || text === "-" || !Number.isFinite(Number(text)) ? null : Number(text));

/** Every row of the table, in GCAT's order, and the day GCAT last updated it. */
export function parseGcat(html: string): { updated: string; rows: CloudRow[] } {
  const updated = /Data last updated:\s*([^<\n]+)/.exec(html)?.[1]?.trim();
  if (updated === undefined) throw new GcatFormError("no 'Data last updated' line");
  const headers = [...html.matchAll(/<TH[^>]*>([^<]*)</g)].map((m) => m[1]!.trim());
  if (headers.length !== COLUMNS.length || headers.some((h, i) => h !== COLUMNS[i])) throw new GcatFormError(`columns are ${headers.join(", ")}`);
  const rows: CloudRow[] = [];
  for (const match of html.matchAll(/<TR>(.*?)<\/TR>/gs)) {
    const cells = [...match[1]!.matchAll(/<TD[^>]*>(.*?)<\/TD>/gs)].map((m) => strip(m[1]!));
    if (cells.length === 0) continue;
    if (cells.length !== COLUMNS.length) throw new GcatFormError(`a row with ${cells.length} cells: ${cells.slice(0, 3).join(" | ")}`);
    const parentText = cells[7]!;
    const parent = /^S(\d+)$/.exec(parentText) ? { kind: "catalogue" as const, number: Number(parentText.slice(1)) } : /^A(\d+)$/.exec(parentText) ? { kind: "analyst" as const, number: Number(parentText.slice(1)) } : parentText === "-" ? null : undefined;
    if (parent === undefined) throw new GcatFormError(`unreadable parent ${parentText}`);
    if (!/^\d+$/.test(cells[14]!)) throw new GcatFormError(`unreadable NCat ${cells[14]}`);
    rows.push({
      number: Number(cells[0]),
      piece: cells[1]!,
      name: cells[6]!,
      parent,
      sdate: cells[8]!,
      ddate: cells[9] === "-" ? null : cells[9]!,
      eventType: cells[10]!,
      eventPerigeeKm: numberOrNull(cells[11]!),
      eventApogeeKm: numberOrNull(cells[12]!),
      eventInclinationDeg: numberOrNull(cells[13]!),
      catalogued: Number(cells[14]),
      filename: cells[20]!,
      label: cells[21]!,
    });
  }
  if (rows.length === 0) throw new GcatFormError("no rows");
  return { updated, rows };
}

/**
 * GCAT's event type as a kind and a cause. Aerodyn is a reentry breakup;
 * Deploy, Release, Insul, Slag and Coolant are releases, deliberate or
 * wear, not breakups; a trailing `?` marks GCAT's guess and leaves the
 * cause as stated only.
 */
export function kindOf(eventType: string): { kind: BreakupKind; cause: Cause | null } {
  const guessed = eventType.endsWith("?");
  const type = eventType.replace(/\?$/, "");
  const cause = ((): Cause | null => {
    switch (type) {
      case "Aerodyn":
        return "aerodynamic";
      case "ASAT":
        return "collision-deliberate";
      case "Destruct":
        return "deliberate";
      case "Coll":
      case "Sep/Coll":
        return "collision-accidental";
      case "Batt":
      case "Battery":
        return "battery";
      case "Resid":
      case "Burn":
        return "propulsion";
      case "Unknown":
      case "Unk":
        return "unknown";
      default:
        return null;
    }
  })();
  const kind: BreakupKind = type === "Aerodyn" ? "aerodynamic" : ["Deploy", "Release", "Insul", "Slag", "Coolant"].includes(type) ? "release" : "breakup";
  return { kind, cause: guessed ? null : cause };
}

/** One statement per cloud: the parent as GCAT names it, its vague date read into a window, the orbit at the event and the piece count. */
export function gcatStatements(parsed: { updated: string; rows: CloudRow[] }): Statement[] {
  const day = /^(\d{4}) ([A-Z][a-z]{2}) (\d{1,2})/.exec(parsed.updated);
  const updatedOn = day !== null ? `${day[1]}-${String(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(day[2]!) + 1).padStart(2, "0")}-${day[3]!.padStart(2, "0")}` : null;
  return parsed.rows.map((row) => {
    const { kind, cause } = kindOf(row.eventType);
    const designator = /^\d{4}-\d{3}$/.test(row.piece) ? row.piece : null;
    return {
      source: SOURCE_ID,
      ref: `entry ${row.number} (${row.filename})`,
      kind,
      parent: { catalogueNumber: row.parent?.kind === "catalogue" ? row.parent.number : null, designator, name: row.name },
      event: parseVagueDate(row.sdate),
      orbit: { altitudeKm: null, apogeeKm: row.eventApogeeKm, perigeeKm: row.eventPerigeeKm, inclinationDeg: row.eventInclinationDeg },
      cause,
      causeStated: row.eventType,
      piecesCatalogued: row.catalogued,
      piecesStatedOn: updatedOn,
      preEventElements: null,
      note: row.parent?.kind === "analyst" ? `Parent is GCAT's analyst object A${row.parent.number}.` : row.parent === null ? "GCAT names no parent object." : null,
      statedOn: null,
    };
  });
}
