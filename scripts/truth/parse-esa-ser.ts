import type { BodyClass, BreakupKind, Cause, Regime, Statement } from "../../src/truth.ts";
import { isoMinute } from "../time.ts";

/**
 * ESA's Annual Space Environment Report: each edition's Table 3.7, the
 * fragmentation events of the year before, typed row by row as printed
 * into `data/truth/esa-ser.json` (the PDFs have no machine-readable table;
 * each edition's address and hash are kept beside its rows). ESA names no
 * object, so a row becomes a statement of an event by a fixed rule, written
 * before any re-scoring and applied to every row alike:
 *
 * - its candidates are the events the other sources make whose statements
 *   date them within a day of the row's epoch (a window of three days at
 *   most, overlapping the day before to the day after), excluding releases
 *   and unnamed rows, in a regime the row's orbit class allows (any regime
 *   for an aerodynamic breakup, which ESA classes by its last state, at
 *   reentry) and, from the 2021 edition on, of a class its object type
 *   allows; a nearer day breaks no tie, since ESA's epoch and another
 *   source's day differ by one often enough;
 * - an event that is the only candidate of exactly one row is that row's,
 *   and is taken from the other rows' candidates, until nothing changes;
 * - a row with no candidate at all is an event of its own, unnamed; a row
 *   left with more than one candidate, or whose only candidate is another
 *   row's only one too, is not placed, and the report lists it.
 *
 * A row a cited source names (`parent` and `namedBy`) is a statement of
 * that parent and joins its events as any statement does.
 */

export interface EsaEdition {
  edition: string;
  title: string;
  reference: string;
  issue: string;
  dateOfIssue: string;
  url: string;
  sha256: string;
  table: string;
  page: number;
}

export interface EsaRow {
  edition: EsaEdition;
  epoch: string;
  objectType: string | null;
  massKg: string;
  catalogued: string;
  asserted: string | null;
  orbit: string;
  cause: string;
  parent: { catalogueNumber: number; designator: string; name: string } | null;
  namedBy: string | null;
}

/**
 * ESA's causes as its tables print them, read into the truth's. A cause
 * ESA has not established (unknown, anomalous, its first edition's
 * "attitude", the "accidental" design flaw) is no statement of one, so it
 * never outranks a cause another source names; the words stay in
 * `causeStated`.
 */
const CAUSES: Record<string, Cause | null> = {
  Propulsion: "propulsion",
  Electrical: "battery",
  Battery: "battery",
  Deliberate: "deliberate",
  Collision: "collision-accidental",
  "Small Impactor": "collision-accidental",
  Aerodynamics: "aerodynamic",
  Anomalous: null,
  Attitude: null,
  Accidental: null,
  Unknown: null,
};

/** The kinds ESA's cause states: an anomalous event, an aerodynamic breakup; the rest are fragmentations whose kind the sources naming the object say. */
const KINDS: Record<string, BreakupKind> = { Anomalous: "anomalous", Aerodynamics: "aerodynamic" };

/** The regimes each of ESA's orbit classes allows (ESA's report, section 2: LEO; GEO and its extended ring EGO; the navigation orbits NSO; MEO; the transfer and crossing orbits GTO, LMO, MGO; HEO). A class not listed allows any. */
const REGIMES: Record<string, readonly Regime[]> = {
  LEO: ["LEO"],
  GEO: ["GEO"],
  EGO: ["GEO", "MEO"],
  NSO: ["MEO"],
  MEO: ["MEO"],
  GTO: ["HEO", "MEO"],
  LMO: ["LEO", "MEO", "HEO"],
  MGO: ["MEO", "HEO"],
  HEO: ["HEO", "MEO"],
};

/** The classes each of ESA's object types allows; a fairing, an adapter or an ullage motor is a rocket mission related object. */
const CLASSES: Record<string, readonly BodyClass[]> = {
  Payload: ["payload"],
  "Rocket Body": ["rocket body"],
  "Rocket Mission Related Object": ["rocket body", "debris"],
};

const DAY_MS = 86_400_000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDay = (day: string): string => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;

function fail(where: string, message: string): never {
  throw new Error(`esa-ser.json ${where}: ${message}`);
}

const text = (fields: Record<string, unknown>, key: string, where: string): string => {
  const value = fields[key];
  if (typeof value !== "string" || value === "") fail(where, `${key} is not a text`);
  return value;
};
const textOrNull = (fields: Record<string, unknown>, key: string, where: string): string | null => (fields[key] === null || fields[key] === undefined ? null : text(fields, key, where));

/** Every row of every edition, checked: a day, a cause the tables print, an object type and an orbit class the rule knows. */
export function readEsaSer(input: unknown): EsaRow[] {
  const editions = (input as { editions?: unknown }).editions;
  if (!Array.isArray(editions)) fail("", "has no editions");
  return editions.flatMap((value: Record<string, unknown>, e: number) => {
    const where = `edition ${e + 1}`;
    const edition: EsaEdition = {
      edition: text(value, "edition", where),
      title: text(value, "title", where),
      reference: text(value, "reference", where),
      issue: text(value, "issue", where),
      dateOfIssue: text(value, "dateOfIssue", where),
      url: text(value, "url", where),
      sha256: text(value, "sha256", where),
      table: text(value, "table", where),
      page: typeof value.page === "number" ? value.page : fail(where, "page is not a number"),
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(edition.dateOfIssue)) fail(where, "dateOfIssue is not a day");
    if (!Array.isArray(value.rows)) fail(where, "has no rows");
    return (value.rows as Record<string, unknown>[]).map((fields, r) => {
      const at = `${where} row ${r + 1}`;
      const epoch = text(fields, "epoch", at);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(epoch) || Number.isNaN(Date.parse(`${epoch}T00:00:00Z`))) fail(at, `epoch ${epoch} is not a day`);
      const cause = text(fields, "cause", at);
      if (!Object.hasOwn(CAUSES, cause)) fail(at, `cause ${cause} is not one the tables print; read its definition in the report and add it`);
      const objectType = textOrNull(fields, "objectType", at);
      if (objectType !== null && CLASSES[objectType] === undefined) fail(at, `object type ${objectType} is not one the rule knows`);
      const parent = fields.parent === undefined || fields.parent === null ? null : (fields.parent as EsaRow["parent"]);
      const namedBy = textOrNull(fields, "namedBy", at);
      if ((parent === null) !== (namedBy === null)) fail(at, "a parent is given exactly when a source naming it is");
      return { edition, epoch, objectType, massKg: text(fields, "massKg", at), catalogued: text(fields, "catalogued", at), asserted: textOrNull(fields, "asserted", at), orbit: text(fields, "orbit", at), cause, parent, namedBy };
    });
  });
}

/** The row as printed, for the statement's note. */
const printedRow = (row: EsaRow): string => [row.epoch, row.objectType, `${row.massKg} kg`, `${row.catalogued} catalogued`, row.asserted === null ? "asserted not given" : `${row.asserted} asserted`, row.orbit, row.cause].filter((cell) => cell !== null).join(", ");

/** What an unnamed event is called: the row's object type, mass and orbit class. */
const unnamedName = (row: EsaRow): string => `${row.objectType?.toLowerCase() ?? "object"}, ${row.massKg === "N/A" ? "mass not given" : `${row.massKg} kg`}, ${row.orbit} (unnamed)`;

/**
 * A row as a statement: named (a cited source names its parent), attributed
 * (the rule joins it to an event, so it names no parent itself) or unnamed
 * (an event of its own). Dated by the edition's date of issue; the pieces
 * are left to the sources that name the object, the counts kept in the note.
 */
export function esaStatement(row: EsaRow, as: "named" | "attributed" | "unnamed"): Statement {
  const day = Date.parse(`${row.epoch}T00:00:00Z`);
  const parent = as === "named" ? row.parent! : { catalogueNumber: null, designator: null, name: as === "unnamed" ? unnamedName(row) : null };
  const how = as === "named" ? `The object is named by ${row.namedBy}.` : as === "attributed" ? "ESA names no object; the build's rule attributes the row to the only event the other sources state within a day of it in an orbit and of an object type the row allows." : "ESA names no object, and no other source states an event within a day of it in an orbit and of an object type the row allows.";
  return {
    source: "esa-ser",
    ref: `${row.edition.title}, issue ${row.edition.issue}, ${longDay(row.edition.dateOfIssue)} (${row.edition.reference}), ${row.edition.table}, p. ${row.edition.page}, row ${row.epoch}`,
    kind: as === "unnamed" ? "unnamed" : (KINDS[row.cause] ?? null),
    parent,
    event: { stated: row.epoch, at: null, from: isoMinute(day), to: isoMinute(day + DAY_MS), precision: "day" },
    orbit: { altitudeKm: null, apogeeKm: null, perigeeKm: null, inclinationDeg: null },
    cause: CAUSES[row.cause] ?? null,
    causeStated: row.cause,
    piecesCatalogued: null,
    piecesStatedOn: null,
    preEventElements: null,
    note: `Table row: ${printedRow(row)}. ${how}`,
    statedOn: { on: row.edition.dateOfIssue, precision: "day", ref: `${row.edition.title}, issue ${row.edition.issue}, dated ${longDay(row.edition.dateOfIssue)}` },
  };
}

/** An event of the other sources, as the rule weighs it: its statements' windows, its regime, its parent's class and its kind. */
export interface EsaCandidate {
  key: number;
  windows: { from: string; to: string }[];
  regime: Regime;
  class: BodyClass;
  kind: BreakupKind;
}

export type EsaAttribution = { row: EsaRow; joins: number } | { row: EsaRow; unnamed: true } | { row: EsaRow; ambiguous: number[] };

/** The longest window a candidate's statement may span: a date to the day, with GCAT's `?` and a day either side. */
const WIDEST_MS = 3 * DAY_MS;

const overlaps = (window: { from: string; to: string }, from: number, to: number): boolean => Date.parse(window.from) < to && Date.parse(window.to) > from;

function allows(row: EsaRow, event: EsaCandidate): boolean {
  if (event.kind === "release" || event.kind === "unnamed") return false;
  const regimes = REGIMES[row.orbit];
  if (row.cause !== "Aerodynamics" && event.regime !== "unknown" && regimes !== undefined && !regimes.includes(event.regime)) return false;
  const classes = row.objectType === null ? undefined : CLASSES[row.objectType];
  return event.class === "unknown" || classes === undefined || classes.includes(event.class);
}

/** The rule above, applied to every row of the tables at once. */
export function attributeEsaRows(rows: readonly EsaRow[], events: readonly EsaCandidate[]): EsaAttribution[] {
  const candidates = rows.map((row) => {
    const day = Date.parse(`${row.epoch}T00:00:00Z`);
    const near = (event: EsaCandidate): boolean => event.windows.some((w) => Date.parse(w.to) - Date.parse(w.from) <= WIDEST_MS && overlaps(w, day - DAY_MS, day + 2 * DAY_MS));
    return events.filter((event) => allows(row, event) && near(event)).map((event) => event.key);
  });
  // Each pass settles the rows left with one candidate: an event one row alone can be is that row's, one two rows can only be is neither's; either way it leaves the other rows' candidates.
  const open = candidates.map((keys) => new Set(keys));
  const settled = new Map<number, number | null>();
  for (;;) {
    const sole = new Map<number, number[]>();
    open.forEach((keys, i) => {
      if (!settled.has(i) && keys.size === 1) {
        const key = [...keys][0]!;
        sole.set(key, [...(sole.get(key) ?? []), i]);
      }
    });
    if (sole.size === 0) break;
    for (const [key, claimants] of sole) {
      for (const i of claimants) settled.set(i, claimants.length === 1 ? key : null);
      open.forEach((keys, i) => {
        if (!claimants.includes(i)) keys.delete(key);
      });
    }
  }
  return rows.map((row, i) => {
    if (candidates[i]!.length === 0) return { row, unnamed: true };
    const key = settled.get(i);
    return key !== undefined && key !== null ? { row, joins: key } : { row, ambiguous: candidates[i]! };
  });
}
