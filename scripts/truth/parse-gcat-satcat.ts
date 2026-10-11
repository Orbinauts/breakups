import type { BreakupKind, Cause, Precision, StatedTime, Statement } from "../../src/truth.ts";
import { parseVagueDate } from "./dates.ts";

/**
 * GCAT's satellite catalogue (Jonathan McDowell, planet4589.org,
 * CC-BY-4.0, `satcat.tsv`) as a source of the truth: one row per object of
 * the standard catalogue, among them every catalogued fragment and
 * component, with its parent object (`Parent`), the date it separated from
 * that parent (`SDate`, in GCAT's vague-date form) and GCAT's type for it
 * (`Type`, the SatType string). The debris-cloud table (`parse-gcat.ts`)
 * lists the clouds GCAT has written up; this catalogue dates the
 * separation of every piece, so it is read uniformly, for every object and
 * every year, with no regard to what the detector raised.
 *
 * The columns and codes are GCAT's own, from its column page
 * (`web/cat/cols.html`) and its SatType page (`web/intro/type.html`), both
 * kept beside the snapshot under `data/truth/sources/`. A SatType's first
 * byte is the coarse type: `P` a payload, `R` a launch-vehicle stage, `C` a
 * component ("a functional part of the spacecraft or rocket that is
 * deliberately or accidentally ejected"), `D` fragmentation debris ("a
 * fragment from a satellite breakup, usually accidental"). Its fourth byte
 * is the subtype, which says what kind of separation made the piece:
 * `B` battery explosion, `I` impact, `P` propulsion-related breakup, `W` a
 * weapons test, `Z` a destruct device, `X` debris of unknown nature, `G`
 * general debris; `J` anomalous debris (insulation, soft material,
 * ablated material); `Q` an aerodynamic breakup at low perigee; `K` solid
 * motor slag, `N` reactor coolant, `O` unknown debris released at orbit
 * insertion; and, on components, fairings, adapters, jettisoned motors and
 * tanks, despin devices, ejection mechanisms and the rest of what a
 * mission sheds by design.
 *
 * The rule, stated once and applied to every row:
 *
 * 1. A piece is a row whose type is a component or fragmentation debris,
 *    whose parent is an object of the standard catalogue (`S` and its
 *    number) or of GCAT's auxiliary catalogue (`A` and its number; an
 *    object the US catalogue does not list apart, such as a stage that
 *    stayed attached), and whose separation date is stated. A parent of
 *    another kind, or a separation date of `-`, makes no statement.
 * 2. The piece's kind is its type's: fragmentation debris of any subtype
 *    but those below is a breakup; anomalous debris (`J`, on debris or a
 *    component) is an anomalous event; an aerodynamic breakup (`Q`) is
 *    aerodynamic; slag, coolant, debris released at orbit insertion and
 *    every other component are a release of objects.
 * 3. A release that separated by the end of the day after its launch day
 *    (`AT_LAUNCH_DAYS`) is the launch's own staging and deployment, not an
 *    event in orbit, and makes no statement. A breakup or an anomalous
 *    event at launch is kept: stages do break up within hours of launch.
 *    A separation GCAT dates wholly before its parent's launch day is a
 *    slip in the catalogue and makes no statement either.
 * 4. The pieces of one parent (a standard-catalogue parent by its number,
 *    an auxiliary-catalogue parent by its launch, as the truth keys a
 *    parent it cannot number) whose separation windows overlap or lie
 *    within `SAME_SEPARATION_DAYS` of each other, chained in the order of
 *    their windows' lower edges, are one separation, and make one
 *    statement.
 * 5. The statement's date is the separation date GCAT states for most of
 *    its pieces (a tie goes to the finer date, then the earlier); its kind
 *    is the first of breakup, anomalous, aerodynamic and release that any
 *    of its pieces has; its cause is the one the subtypes of its pieces
 *    name, where they name one and no other; its count is its pieces.
 */

export const SOURCE_ID = "gcat" as const;

/** Every satellite-catalogue statement's reference begins so: the build tells them from the debris-cloud table's, which share the source. */
export const SATCAT_REF_PREFIX = "GCAT satellite catalogue";

/**
 * How far apart two pieces' separation windows may lie and still be one
 * separation, in days: three days, the width GCAT's own `?` gives a date
 * stated to the day (the day and one either side), so two pieces GCAT dates
 * a day or two apart, or one to the day and one to the day with a `?`,
 * are one event, and pieces dated a week apart are two.
 */
export const SAME_SEPARATION_DAYS = 3;

/** A release that separated by the end of this many days after its launch day is the launch's own staging and deployment. */
export const AT_LAUNCH_DAYS = 1;

/** The columns the truth reads, by GCAT's names; the snapshot keeps these alone. */
export const SATCAT_COLUMNS = ["JCAT", "Satcat", "Launch_Tag", "Piece", "Type", "Name", "LDate", "Parent", "SDate", "DDate", "Status"] as const;

export class GcatSatcatFormError extends Error {}

const DAY_MS = 86_400_000;
const DESIGNATOR = /^\d{4}-\d{3}[A-Z]{0,3}$/;
const PARENT = /^([SA])(\d+)\*?(?:\s.*)?$/;

/** One row of the catalogue, as the truth reads it: the cells trimmed. */
export interface SatcatRow {
  jcat: string;
  satcat: string;
  launchTag: string;
  piece: string;
  type: string;
  name: string;
  ldate: string;
  parent: string;
  sdate: string;
  ddate: string;
  status: string;
}

export interface Satcat {
  /** GCAT's update line, as printed (`2026 Oct  9 1800:46`, whitespace folded). */
  updated: string;
  rows: SatcatRow[];
}

const isPieceType = (type: string): boolean => type.startsWith("C") || type.startsWith("D");

function splitHeader(line: string): string[] {
  return line.replace(/^#/, "").split("\t").map((cell) => cell.trim());
}

/**
 * The catalogue reduced to what the truth reads: the header and GCAT's
 * update line, the rows typed as a component or fragmentation debris and
 * the rows they name as their parent, each in the columns of
 * `SATCAT_COLUMNS`, every kept cell verbatim. The whole file is some
 * twenty megabytes; the reduction keeps the snapshot a size git carries,
 * and its rule is written beside the hashes in `data/truth/sources.json`.
 */
export function reduceSatcat(tsv: string): { text: string; madeWith: string } {
  const lines = tsv.split("\n");
  const header = splitHeader(lines[0] ?? "");
  const at = SATCAT_COLUMNS.map((name) => {
    const index = header.indexOf(name);
    if (index === -1) throw new GcatSatcatFormError(`GCAT's satellite catalogue has no column ${name}`);
    return index;
  });
  const updated = lines.find((line) => line.startsWith("# Updated"));
  if (updated === undefined) throw new GcatSatcatFormError("no '# Updated' line");
  const rows = lines.filter((line) => line.trim() !== "" && !line.startsWith("#")).map((line) => line.split("\t"));
  const typeAt = header.indexOf("Type");
  const parentAt = header.indexOf("Parent");
  const parents = new Set(rows.filter((cells) => isPieceType((cells[typeAt] ?? "").trim())).map((cells) => PARENT.exec((cells[parentAt] ?? "").trim())?.slice(1, 3).join("")).filter((p): p is string => p !== undefined));
  const kept = rows.filter((cells) => isPieceType((cells[typeAt] ?? "").trim()) || parents.has(/^([SA])(\d+)$/.exec((cells[0] ?? "").trim())?.slice(1, 3).join("") ?? ""));
  const text = [`#${SATCAT_COLUMNS.join("\t")}`, updated, ...kept.map((cells) => at.map((index) => cells[index] ?? "").join("\t"))].join("\n");
  return { text: `${text}\n`, madeWith: `reduced to the rows typed C or D (components and fragmentation debris) and the rows they name as parent, in the columns ${SATCAT_COLUMNS.join(", ")}, every kept cell verbatim` };
}

/** Every row of the catalogue (whole or reduced), its cells trimmed, and GCAT's update line. */
export function parseSatcat(tsv: string): Satcat {
  const lines = tsv.split("\n");
  const header = splitHeader(lines[0] ?? "");
  const at = (name: (typeof SATCAT_COLUMNS)[number]): number => {
    const index = header.indexOf(name);
    if (index === -1) throw new GcatSatcatFormError(`GCAT's satellite catalogue has no column ${name}`);
    return index;
  };
  const columns = Object.fromEntries(SATCAT_COLUMNS.map((name) => [name, at(name)])) as Record<(typeof SATCAT_COLUMNS)[number], number>;
  const updatedLine = lines.find((line) => line.startsWith("# Updated"));
  if (updatedLine === undefined) throw new GcatSatcatFormError("no '# Updated' line");
  const rows: SatcatRow[] = [];
  for (const line of lines) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const cells = line.split("\t");
    if (cells.length < header.length) throw new GcatSatcatFormError(`a row with ${cells.length} cells: ${cells.slice(0, 3).join(" | ")}`);
    const cell = (name: (typeof SATCAT_COLUMNS)[number]): string => cells[columns[name]]!.trim();
    rows.push({ jcat: cell("JCAT"), satcat: cell("Satcat"), launchTag: cell("Launch_Tag"), piece: cell("Piece"), type: cell("Type"), name: cell("Name"), ldate: cell("LDate"), parent: cell("Parent"), sdate: cell("SDate"), ddate: cell("DDate"), status: cell("Status") });
  }
  if (rows.length === 0) throw new GcatSatcatFormError("no rows");
  return { updated: updatedLine.replace(/^# Updated\s*/, "").replace(/\s+/g, " ").trim(), rows };
}

/** What a piece's SatType says: the kind of separation that made it, the cause where the subtype names one, and the subtype's meaning in GCAT's words. */
export interface PieceReading {
  kind: BreakupKind;
  cause: Cause | null;
  meaning: string;
}

const DEBRIS_SUBTYPES: Record<string, PieceReading> = {
  B: { kind: "breakup", cause: "battery", meaning: "battery explosion debris" },
  G: { kind: "breakup", cause: null, meaning: "general, miscellaneous debris" },
  I: { kind: "breakup", cause: "collision-accidental", meaning: "impact (accidental collision)" },
  J: { kind: "anomalous", cause: null, meaning: "anomalous debris (insulation, soft material, ablated material)" },
  K: { kind: "release", cause: null, meaning: "possible solid motor slag" },
  N: { kind: "release", cause: null, meaning: "nuclear reactor, reactor core, RTG or coolant blob" },
  O: { kind: "release", cause: null, meaning: "unknown debris released at orbit insertion" },
  P: { kind: "breakup", cause: "propulsion", meaning: "propulsion related, residual-propellant breakup" },
  Q: { kind: "aerodynamic", cause: "aerodynamic", meaning: "aerodynamic breakup at low perigee" },
  W: { kind: "breakup", cause: "collision-deliberate", meaning: "weapons test, ASAT debris" },
  X: { kind: "breakup", cause: null, meaning: "debris of unknown nature" },
  Z: { kind: "breakup", cause: "deliberate", meaning: "breakup debris from on-board destruct device" },
};

const COMPONENT_SUBTYPES: Record<string, string> = {
  A: "payload adapter, support structures, interfaces",
  C: "passive calibration satellites, test objects or chaff",
  F: "fairings and other covers",
  G: "general, miscellaneous debris",
  H: "human spaceflight related",
  J: "anomalous debris (insulation, soft material, ablated material)",
  M: "jettisoned motor or tank",
  N: "nuclear reactor, reactor core, RTG or coolant blob",
  O: "unknown debris released at orbit insertion",
  S: "subsatellite or subpayload",
  T: "ejected section of payload",
  V: "ejection mechanism (deploy canister, clamp band)",
  X: "debris of unknown nature",
  Y: "despin (yo-yo) device",
};

/** A piece's SatType read: fragmentation debris by its subtype (a breakup where the subtype is none of the listed), a component as a release unless its subtype is anomalous debris. */
export function readPieceType(type: string): PieceReading {
  const coarse = type[0];
  const subtype = (type[3] ?? "").trim().replace("-", "");
  if (coarse === "D") return DEBRIS_SUBTYPES[subtype] ?? { kind: "breakup", cause: null, meaning: subtype === "" ? "fragmentation debris" : `fragmentation debris, subtype ${subtype}` };
  if (coarse === "C") {
    const meaning = COMPONENT_SUBTYPES[subtype] ?? (subtype === "" ? "component" : `component, subtype ${subtype}`);
    return { kind: subtype === "J" ? "anomalous" : "release", cause: null, meaning: `component: ${meaning}` };
  }
  throw new GcatSatcatFormError(`not a component or fragmentation debris: ${type}`);
}

/** The order a separation's kind is taken in from its pieces' kinds. */
const KIND_ORDER: readonly BreakupKind[] = ["breakup", "anomalous", "aerodynamic", "release"];
const PRECISION_RANK: Record<Precision, number> = { second: 0, minute: 1, hour: 2, day: 3, month: 4, year: 5, none: 6 };

/** One piece, read. */
export interface Piece {
  row: SatcatRow;
  /** The catalogue number (the JCAT's digits for a standard-catalogue piece). */
  number: number;
  reading: PieceReading;
  event: StatedTime;
}

/** One separation: the pieces of one parent within the rule's days of each other. */
export interface Separation {
  /** `S` and the parent's number, or `A` and the auxiliary-catalogue object's. */
  parent: string;
  parentRow: SatcatRow | null;
  /** The launch the parent belongs to, where the catalogue gives a designator. */
  launch: string | null;
  pieces: Piece[];
}

/** Why a row of the catalogue made no statement, counted. */
export interface Skipped {
  notAPiece: number;
  parentNotACatalogueObject: number;
  noSeparationDate: number;
  releasedAtLaunch: number;
  separatedBeforeLaunch: number;
}

const lower = (time: StatedTime): number => Date.parse(time.from ?? time.to);
const upper = (time: StatedTime): number => Date.parse(time.to);
const folded = (vague: string): string => vague.replace(/\s+/g, " ").trim();

/** The launch of a row: its piece designator's, else its launch tag's, where either is an international designator. */
function launchOfRow(row: SatcatRow): string | null {
  if (DESIGNATOR.test(row.piece)) return row.piece.slice(0, 8);
  return /^\d{4}-\d{3}$/.test(row.launchTag) ? row.launchTag : null;
}

/** The catalogue's pieces grouped into separations by the rule above, and what was skipped and why. */
export function separationsOf(satcat: Satcat): { separations: Separation[]; skipped: Skipped } {
  const byJcat = new Map(satcat.rows.map((row) => [row.jcat, row]));
  const skipped: Skipped = { notAPiece: 0, parentNotACatalogueObject: 0, noSeparationDate: 0, releasedAtLaunch: 0, separatedBeforeLaunch: 0 };
  const byParent = new Map<string, { parent: string; parentRow: SatcatRow | null; launch: string | null; pieces: Piece[] }>();
  for (const row of satcat.rows) {
    if (!isPieceType(row.type)) {
      skipped.notAPiece++;
      continue;
    }
    const parentMatch = PARENT.exec(row.parent);
    if (parentMatch === null) {
      skipped.parentNotACatalogueObject++;
      continue;
    }
    if (row.sdate === "-" || row.sdate === "") {
      skipped.noSeparationDate++;
      continue;
    }
    const reading = readPieceType(row.type);
    const event = parseVagueDate(folded(row.sdate));
    const parent = `${parentMatch[1]}${parentMatch[2]}`;
    const parentRow = byJcat.get(parent) ?? null;
    const launched = parseVagueDate(folded(row.ldate));
    const parentLaunched = parentRow === null ? launched : parseVagueDate(folded(parentRow.ldate));
    if (upper(event) <= lower(parentLaunched)) {
      skipped.separatedBeforeLaunch++;
      continue;
    }
    if (reading.kind === "release" && lower(event) < upper(launched) + AT_LAUNCH_DAYS * DAY_MS) {
      skipped.releasedAtLaunch++;
      continue;
    }
    // An auxiliary-catalogue parent is keyed by its launch, as the truth keys a parent it cannot number.
    const launch = (parentRow === null ? null : launchOfRow(parentRow)) ?? launchOfRow(row);
    const key = parentMatch[1] === "S" ? parent : `L${launch ?? parent}`;
    const number = /^\d+$/.test(row.satcat) ? Number(row.satcat) : Number(row.jcat.slice(1));
    const entry = byParent.get(key) ?? { parent, parentRow: parentMatch[1] === "S" ? parentRow : null, launch, pieces: [] };
    entry.pieces.push({ row, number, reading, event });
    byParent.set(key, entry);
  }
  const separations: Separation[] = [];
  for (const entry of byParent.values()) {
    const pieces = [...entry.pieces].sort((a, b) => lower(a.event) - lower(b.event) || a.number - b.number);
    let current: Piece[] = [];
    let reach = Number.NEGATIVE_INFINITY;
    for (const piece of pieces) {
      if (current.length > 0 && lower(piece.event) > reach + SAME_SEPARATION_DAYS * DAY_MS) {
        separations.push({ parent: entry.parent, parentRow: entry.parentRow, launch: entry.launch, pieces: current });
        current = [];
        reach = Number.NEGATIVE_INFINITY;
      }
      current.push(piece);
      reach = Math.max(reach, upper(piece.event));
    }
    if (current.length > 0) separations.push({ parent: entry.parent, parentRow: entry.parentRow, launch: entry.launch, pieces: current });
  }
  separations.sort((a, b) => lower(a.pieces[0]!.event) - lower(b.pieces[0]!.event) || a.parent.localeCompare(b.parent));
  return { separations, skipped };
}

/** The separation date GCAT states for most of the pieces: a tie to the finer date, then the earlier, then the first in text. */
export function statedDateOf(pieces: readonly Piece[]): StatedTime {
  const counts = new Map<string, { event: StatedTime; n: number }>();
  for (const piece of pieces) {
    const key = piece.event.stated;
    const seen = counts.get(key);
    if (seen === undefined) counts.set(key, { event: piece.event, n: 1 });
    else seen.n++;
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || PRECISION_RANK[a.event.precision] - PRECISION_RANK[b.event.precision] || lower(a.event) - lower(b.event) || a.event.stated.localeCompare(b.event.stated))[0]!.event;
}

/** Catalogue numbers written as runs (`40065 to 40068, 40100`), at most `limit` runs and a count of the rest. */
export function runsOf(numbers: readonly number[], limit = 12): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const runs: string[] = [];
  let start = sorted[0]!;
  let previous = start;
  for (const n of [...sorted.slice(1), Number.NaN]) {
    if (n === previous + 1) {
      previous = n;
      continue;
    }
    runs.push(start === previous ? `${start}` : previous === start + 1 ? `${start}, ${previous}` : `${start} to ${previous}`);
    start = n;
    previous = n;
  }
  if (runs.length <= limit) return runs.join(", ");
  return `${runs.slice(0, limit).join(", ")} and ${runs.length - limit} more runs, to ${sorted.at(-1)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The coarse class GCAT's type gives a parent, in the words the truth's class reader takes: a jettisoned motor or tank (a component of subtype `M`) is a rocket body, as the truth's names class an ullage motor or a stage's tank. */
function classWords(type: string): string | null {
  switch (type[0]) {
    case "P":
      return "payload";
    case "R":
      return "rocket body";
    case "C":
      return type[3] === "M" ? "rocket body" : "debris";
    case "D":
      return "debris";
    default:
      return null;
  }
}

/** One statement per separation: the parent as GCAT names it, the separation date most of its pieces carry, the kind and cause their types give, and the count. */
export function satcatStatements(satcat: Satcat): Statement[] {
  const updated = /^(\d{4}) ([A-Z][a-z]{2}) (\d{1,2})/.exec(satcat.updated);
  const updatedOn = updated === null ? null : `${updated[1]}-${String(MONTHS.indexOf(updated[2]!) + 1).padStart(2, "0")}-${updated[3]!.padStart(2, "0")}`;
  return separationsOf(satcat).separations.map((separation) => {
    const { pieces, parentRow } = separation;
    const event = statedDateOf(pieces);
    const kind = KIND_ORDER.find((k) => pieces.some((p) => p.reading.kind === k))!;
    const causes = new Set(pieces.filter((p) => p.reading.kind === kind).map((p) => p.reading.cause));
    const cause = causes.size === 1 ? [...causes][0]! : null;
    const types = new Map<string, { meaning: string; n: number }>();
    for (const p of pieces) {
      const code = `${p.row.type[0]}${(p.row.type[3] ?? "").trim().replace("-", "")}`;
      const seen = types.get(code);
      if (seen === undefined) types.set(code, { meaning: p.reading.meaning, n: 1 });
      else seen.n++;
    }
    const typesStated = [...types].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).map(([code, { meaning, n }]) => `${code} (${meaning}) x${n}`).join("; ");
    const dates = new Map<string, number>();
    for (const p of pieces) dates.set(p.event.stated, (dates.get(p.event.stated) ?? 0) + 1);
    const designator = parentRow !== null && DESIGNATOR.test(parentRow.piece) ? parentRow.piece : separation.launch;
    const catalogueNumber = separation.parent.startsWith("S") ? Number(separation.parent.slice(1)) : null;
    const name = parentRow?.name ?? (catalogueNumber === null ? `GCAT auxiliary object ${separation.parent}` : `GCAT object ${separation.parent}`);
    const notes: string[] = [];
    const typeWords = parentRow === null ? null : classWords(parentRow.type);
    // The class and launch day are written as NASA's notes write them, so the truth reads them the same way.
    if (typeWords !== null) notes.push(`Type: ${typeWords};`);
    if (parentRow !== null) {
      const launched = /^(\d{4}) ([A-Z][a-z]{2})\s+(\d{1,2})$/.exec(parentRow.ldate);
      if (launched !== null) notes.push(`Parent launched ${Number(launched[3])} ${launched[2]} ${launched[1]}.`);
    }
    if (catalogueNumber === null) notes.push(`Parent is GCAT's auxiliary-catalogue object ${separation.parent}, an object the US catalogue does not list apart.`);
    notes.push(`Separation dates GCAT states for the pieces: ${[...dates].map(([d, n]) => `${d} (${n})`).join(", ")}.`);
    notes.push(`Grouped by the satellite-catalogue rule: pieces of one parent separated within ${SAME_SEPARATION_DAYS} days of each other are one separation.`);
    return {
      source: SOURCE_ID,
      ref: `${SATCAT_REF_PREFIX} (satcat.tsv, updated ${satcat.updated}), parent ${separation.parent}, ${pieces.length === 1 ? "piece" : `${pieces.length} pieces`} ${runsOf(pieces.map((p) => p.number))}`,
      kind,
      parent: { catalogueNumber, designator, name },
      event,
      orbit: { altitudeKm: null, apogeeKm: null, perigeeKm: null, inclinationDeg: null },
      cause,
      causeStated: `GCAT's types: ${typesStated}`,
      piecesCatalogued: pieces.length,
      piecesStatedOn: updatedOn,
      preEventElements: null,
      note: notes.join(" "),
      statedOn: null,
    };
  });
}

/** Whether a statement is the satellite catalogue's (the debris-cloud table's share the source id). */
export const isSatcatStatement = (statement: Pick<Statement, "source" | "ref">): boolean => statement.source === SOURCE_ID && statement.ref.startsWith(SATCAT_REF_PREFIX);
