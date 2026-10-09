import type { Omm } from "@orbinauts/engine";
import type { BreakupKind, Cause, Statement } from "../../src/truth.ts";
import { DateFormError, nasaWindow, parseNasaDate } from "./dates.ts";

/**
 * NASA's History of On-Orbit Satellite Fragmentations, 16th edition, read
 * from the text `pdftotext -layout` makes of the PDF. Chapter 2 describes
 * every breakup and chapter 3 every anomalous event in a two-page spread:
 * a header line with the name, the international designator and the
 * catalogue number, then SATELLITE DATA, one or more EVENT DATA blocks
 * (DATE, TIME, ALTITUDE, LOCATION, ASSESSED CAUSE; or KNOWN EVENTS and
 * FIRST DATE with the orbit beneath), PRE-EVENT or POST-EVENT ELEMENTS,
 * DEBRIS CLOUD DATA, COMMENTS and REFERENCE DOCUMENTS. Tables 2.1 and 3.1
 * list the same events by launch date with the debris counts and the
 * orbit; Table 4.1-1 lists the aerodynamic breakups at reentry, which have
 * no spread. Every count the document states is checked here, so a new
 * edition that changes shape fails loudly.
 */

export const SOURCE_ID = "hoosf-16e" as const;

/** The counts the 16th edition states of itself, checked on every parse. */
export const EXPECTED = { spreads: 353, breakups: 268, anomalous: 87 } as const;

export class HoosfFormError extends Error {}

/** One EVENT DATA block of a breakup spread, in the document's words. */
export interface SpreadEvent {
  date: string;
  time: string | null;
  altitude: string | null;
  location: string | null;
  cause: string | null;
  /** The element set printed for this event: before it, or after it where the pre-event set was not public. */
  elements: { when: "pre" | "post"; omm: Omm } | null;
}

/** The EVENT DATA of an anomalous-event spread. */
export interface AnomalousEvents {
  knownEvents: string;
  firstDate: string;
  apogeeKm: number | null;
  perigeeKm: number | null;
  periodMinutes: number | null;
  inclinationDeg: number | null;
}

export interface Spread {
  name: string;
  designator: string;
  catalogueNumber: number;
  /** The document page the spread begins on. */
  page: number;
  chapter: 2 | 3;
  type: string | null;
  owner: string | null;
  launchDate: string | null;
  dryMassKg: string | null;
  events: SpreadEvent[];
  anomalous: AnomalousEvents | null;
  comments: string;
}

/** A row of Table 2.1 (breakups by launch date). */
export interface BreakupRow {
  designator: string;
  catalogueNumber: number;
  launchDate: string;
  breakupDate: string;
  debrisCatalogued: number | null;
  debrisLeft: number | null;
  apogeeKm: number | null;
  perigeeKm: number | null;
  inclinationDeg: number | null;
}

/** A row of Table 3.1 (anomalous events by launch date). */
export interface AnomalousRow {
  designator: string;
  catalogueNumber: number;
  launchDate: string;
  firstEventDate: string;
  knownEvents: string;
  debrisCatalogued: number | null;
  debrisInOrbit: number | null;
  apogeeKm: number | null;
  perigeeKm: number | null;
  inclinationDeg: number | null;
}

/** A row of Table 4.1-1 (aerodynamic breakups by launch date), as far as its wrapped cells allow. */
export interface AerodynamicRow {
  name: string;
  designator: string;
  catalogueNumber: number;
  breakupDate: string | null;
  reentryDate: string | null;
  debrisCatalogued: number | null;
  apogeeKm: number | null;
  perigeeKm: number | null;
  inclinationDeg: number | null;
}

export interface Hoosf {
  spreads: Spread[];
  breakupRows: BreakupRow[];
  anomalousRows: AnomalousRow[];
  aerodynamicRows: AerodynamicRow[];
}

const DESIGNATOR = String.raw`\d{4}-\d{3}[A-Z]{0,3}`;
/** A spread's header: the name, the designator and the catalogue number, nothing else on the line. */
const HEADER = new RegExp(String.raw`^\f?(\S.*?)\s{2,}(${DESIGNATOR})\s+(\d{1,6})\s*$`);
const PAGE_NUMBER = /^\s*(\d{1,4})\s*$/;
/** A section heading, numbered on a spread with more than one event ("EVENT DATA (2)", "PRE-EVENT ELEMENTS (2)"). */
const SECTION = /^(?:FIRST |SECOND |THIRD |FOURTH )?(SATELLITE DATA|EVENT DATA|POST-EVENT DATA|PRE-EVENT ELEMENTS|POST-EVENT ELEMENTS|DEBRIS CLOUD DATA|COMMENTS|REFERENCE DOCUMENTS)(?:\s*\(\d+\))?\*?\s*$/;
/** A labelled field; a line may carry two ("DATE: ... LOCATION: ..."). */
const FIELD = /([A-Z][A-Z0-9 .()/∆-]*?):\s+(.*?)(?=\s{2,}[A-Z][A-Z0-9 .()/∆-]*?:\s|\s*$)/g;

function numberOrNull(text: string | undefined): number | null {
  if (text === undefined) return null;
  const cleaned = text.replace(/[~,*]/g, "").trim();
  const value = Number(cleaned.replace(/ km$| deg$| min$/, ""));
  return cleaned !== "" && Number.isFinite(value) ? value : null;
}

/** The lines of the document, the chapter boundaries found by their headings in the body (not the contents page). */
function chapters(lines: string[]): { three: number; four: number } {
  const find = (pattern: RegExp, after: number): number => {
    const index = lines.findIndex((line, i) => i > after && pattern.test(line));
    if (index === -1) throw new HoosfFormError(`no heading ${pattern}`);
    return index;
  };
  // The contents page lists the headings first; the body's are the second occurrence.
  const contents = find(/^\f?\s*3\.0\s+SATELLITE ANOMALOUS EVENTS/, 0);
  const three = find(/^\f?\s*3\.0\s+SATELLITE ANOMALOUS EVENTS/, contents);
  const four = find(/^\f?\s*4\.0\s+OTHER SATELLITES ASSOCIATED WITH FRAGMENTATIONS/, three);
  return { three, four };
}

/** The two-line epoch "19356.69052255" as an ISO instant, to the microsecond. */
export function epochOf(text: string): string {
  const m = /^(\d{2})(\d{3})\.(\d+)$/.exec(text.trim());
  if (m === null) throw new HoosfFormError(`not an epoch: ${text}`);
  const year = Number(m[1]) < 57 ? 2000 + Number(m[1]) : 1900 + Number(m[1]);
  const microseconds = Math.round(Number(`0.${m[3]}`) * 86_400_000_000);
  const instant = new Date(Date.UTC(year, 0, Number(m[2])) + Math.floor(microseconds / 1000)).toISOString();
  return `${instant.slice(0, 19)}.${String(microseconds % 1_000_000).padStart(6, "0")}`;
}

function elementsOf(fields: Map<string, string>, spread: Pick<Spread, "name" | "designator" | "catalogueNumber">): Omm | null {
  const get = (label: string): number | null => numberOrNull(fields.get(label));
  const epoch = fields.get("EPOCH");
  const meanMotion = get("MEAN MOTION");
  if (epoch === undefined || meanMotion === null) return null;
  try {
    return {
      OBJECT_NAME: spread.name,
      OBJECT_ID: spread.designator,
      EPOCH: epochOf(epoch),
      MEAN_MOTION: meanMotion,
      ECCENTRICITY: get("ECCENTRICITY") ?? 0,
      INCLINATION: get("INCLINATION") ?? 0,
      RA_OF_ASC_NODE: get("RIGHT ASCENSION") ?? 0,
      ARG_OF_PERICENTER: get("ARG. OF PERIGEE") ?? 0,
      MEAN_ANOMALY: get("MEAN ANOMALY") ?? 0,
      EPHEMERIS_TYPE: 0,
      CLASSIFICATION_TYPE: "U",
      NORAD_CAT_ID: spread.catalogueNumber,
      ELEMENT_SET_NO: 0,
      REV_AT_EPOCH: 0,
      BSTAR: get("BSTAR") ?? 0,
      MEAN_MOTION_DOT: get("MEAN MOTION DOT/2") ?? 0,
      MEAN_MOTION_DDOT: get("MEAN MOTION DOT DOT/6") ?? 0,
    };
  } catch (error) {
    if (error instanceof HoosfFormError) return null;
    throw error;
  }
}

/** One spread read from its lines (header excluded), its page from the first page number after the header. */
function parseSpread(header: RegExpExecArray, body: string[], chapter: 2 | 3): Spread {
  const spread: Spread = {
    name: header[1]!.trim(),
    designator: header[2]!,
    catalogueNumber: Number(header[3]),
    page: 0,
    chapter,
    type: null,
    owner: null,
    launchDate: null,
    dryMassKg: null,
    events: [],
    anomalous: null,
    comments: "",
  };
  let section: string | null = null;
  let event: SpreadEvent | null = null;
  let elementFields = new Map<string, string>();
  let elementsWhen: "pre" | "post" = "pre";
  const comments: string[] = [];
  let orbitHeader = false;
  const closeElements = (): void => {
    if (elementFields.size === 0) return;
    const omm = elementsOf(elementFields, spread);
    if (omm !== null && event !== null) event.elements = { when: elementsWhen, omm };
    elementFields = new Map();
  };
  for (const line of body) {
    const page = PAGE_NUMBER.exec(line);
    if (page !== null) {
      if (spread.page === 0) spread.page = Number(page[1]);
      continue;
    }
    const heading = SECTION.exec(line.trim());
    if (heading !== null) {
      closeElements();
      section = heading[1] === "POST-EVENT DATA" ? "EVENT DATA" : heading[1]!;
      if (section === "EVENT DATA") {
        event = { date: "", time: null, altitude: null, location: null, cause: null, elements: null };
        spread.events.push(event);
      }
      if (section === "PRE-EVENT ELEMENTS") elementsWhen = "pre";
      if (section === "POST-EVENT ELEMENTS") elementsWhen = "post";
      continue;
    }
    if (section === "COMMENTS") {
      comments.push(line.trim());
      continue;
    }
    if (section === "EVENT DATA" && orbitHeader) {
      if (line.trim() === "") continue;
      // The anomalous spread's orbit: "3310   510   125.14 min   33.4 deg" under "APOGEE PERIGEE PERIOD INCLINATION".
      const values = line.trim().split(/\s{2,}/);
      if (values.length >= 4 && spread.anomalous !== null) {
        spread.anomalous.apogeeKm = numberOrNull(values[0]);
        spread.anomalous.perigeeKm = numberOrNull(values[1]);
        spread.anomalous.periodMinutes = numberOrNull(values[2]);
        spread.anomalous.inclinationDeg = numberOrNull(values[3]);
      }
      orbitHeader = false;
      continue;
    }
    if (section === "EVENT DATA" && /^\s*APOGEE\s+PERIGEE\s+PERIOD\s+INCLINATION\s*$/.test(line)) {
      orbitHeader = true;
      continue;
    }
    for (const match of line.matchAll(FIELD)) {
      const label = match[1]!.trim();
      const value = match[2]!.trim();
      if (section === "SATELLITE DATA") {
        if (label === "TYPE") spread.type = value;
        else if (label === "OWNER") spread.owner = value;
        else if (label === "LAUNCH DATE") spread.launchDate = value;
        else if (label === "DRY MASS (KG)") spread.dryMassKg = value;
      } else if (section === "EVENT DATA" && event !== null) {
        if (label === "DATE") event.date = value;
        else if (label === "TIME") event.time = value;
        else if (label === "ALTITUDE") event.altitude = value;
        else if (label === "LOCATION") event.location = value;
        else if (label === "ASSESSED CAUSE") event.cause = value;
        else if (label === "KNOWN EVENTS") spread.anomalous = { knownEvents: value, firstDate: "", apogeeKm: null, perigeeKm: null, periodMinutes: null, inclinationDeg: null };
        else if (label === "FIRST DATE" && spread.anomalous !== null) spread.anomalous.firstDate = value;
      } else if (section === "PRE-EVENT ELEMENTS" || section === "POST-EVENT ELEMENTS") {
        elementFields.set(label, value);
      }
    }
  }
  closeElements();
  spread.events = spread.events.filter((e) => e.date !== "");
  spread.comments = comments.join(" ").replace(/\s+/g, " ").trim();
  return spread;
}

/** Every spread of chapters 2 and 3, in the document's order. */
export function parseSpreads(text: string): Spread[] {
  const lines = text.split("\n");
  const { three, four } = chapters(lines);
  const headers = lines.map((line, index) => ({ index, match: HEADER.exec(line) })).filter((entry) => entry.match !== null && entry.index < four);
  const spreads = headers.map(({ index, match }, position) => {
    const end = position + 1 < headers.length ? headers[position + 1]!.index : four;
    return parseSpread(match!, lines.slice(index + 1, end), index < three ? 2 : 3);
  });
  if (spreads.length !== EXPECTED.spreads) throw new HoosfFormError(`${spreads.length} spreads, not ${EXPECTED.spreads}`);
  return spreads;
}

const NUMERIC = /^(?:~?[\d.,]+\*?|Unknown|unknown|\?|>\d+|Many|Multiple|\d+\?)$/;
const DATE_TOKEN = /^(?:~?\d{1,2}[-/]|\d{1,2}[-/]\d{1,2}[-/]?)?[A-Za-z]{3}(?:[-/][A-Za-z]{3})?-?\d{2,4}$|^prior$|^to$|^\d{1,2}-\d{1,2}$|^\d{1,2}\/\d{1,2}$|^[A-Za-z]{3}\/[A-Za-z]{3}$|^\d{2}$/;

/** The lines of a table, from its first title to the next table's title or the chapter's next heading. */
function tableLines(lines: string[], title: RegExp, until: RegExp): string[] {
  const start = lines.findIndex((line) => title.test(line));
  if (start === -1) throw new HoosfFormError(`no table ${title}`);
  const end = lines.findIndex((line, index) => index > start && until.test(line));
  return lines.slice(start, end === -1 ? undefined : end);
}

/** The tokens of a row after its designator and number: the launch date, then the event date's tokens, then the numeric columns. */
function rowTokens(line: string): { designator: string; catalogueNumber: number; rest: string[] } | null {
  const m = new RegExp(String.raw`(${DESIGNATOR})\s+(\d{1,6})\s+(.*)$`).exec(line);
  if (m === null) return null;
  return { designator: m[1]!, catalogueNumber: Number(m[2]), rest: m[3]!.trim().split(/\s+/) };
}

/** Table 2.1: breakups by launch date. The event date is whatever stands between the launch date and the five numeric columns. */
export function parseBreakupTable(text: string): BreakupRow[] {
  const lines = tableLines(text.split("\n"), /^\s*TABLE 2\.1 HISTORY OF SATELLITE BREAKUPS BY LAUNCH DATE\s*$/, /^\s*TABLE 2\.2 /);
  const rows: BreakupRow[] = [];
  for (const line of lines) {
    const row = rowTokens(line);
    if (row === null) continue;
    const { rest } = row;
    // The five numeric columns: debris catalogued, debris left, apogee, perigee, inclination.
    let at = -1;
    for (let i = 2; i + 4 < rest.length + 1; i++) {
      if (rest.slice(i, i + 5).every((token) => NUMERIC.test(token))) {
        at = i;
        break;
      }
    }
    if (at === -1) throw new HoosfFormError(`unreadable Table 2.1 row: ${line.trim()}`);
    rows.push({
      designator: row.designator,
      catalogueNumber: row.catalogueNumber,
      launchDate: rest[0]!,
      breakupDate: rest.slice(1, at).join(" "),
      debrisCatalogued: numberOrNull(rest[at]),
      debrisLeft: numberOrNull(rest[at + 1]),
      apogeeKm: numberOrNull(rest[at + 2]),
      perigeeKm: numberOrNull(rest[at + 3]),
      inclinationDeg: numberOrNull(rest[at + 4]),
    });
  }
  if (rows.length !== EXPECTED.breakups) throw new HoosfFormError(`${rows.length} Table 2.1 rows, not ${EXPECTED.breakups}`);
  return rows;
}

/** Table 3.1: anomalous events by launch date. */
export function parseAnomalousTable(text: string): AnomalousRow[] {
  const lines = tableLines(text.split("\n"), /^\s*TABLE 3\.1 HISTORY OF SATELLITE ANOMALOUS EVENTS BY LAUNCH DATE\s*$/, /^\s*TABLE 3\.2 /);
  const rows: AnomalousRow[] = [];
  for (const line of lines) {
    const row = rowTokens(line);
    if (row === null) continue;
    const { rest } = row;
    // The last six columns: known events, debris catalogued, in-orbit debris, apogee, perigee, inclination.
    const at = rest.length - 6;
    if (at < 1 || !rest.slice(at).every((token) => NUMERIC.test(token))) throw new HoosfFormError(`unreadable Table 3.1 row: ${line.trim()}`);
    rows.push({
      designator: row.designator,
      catalogueNumber: row.catalogueNumber,
      launchDate: rest[0]!,
      firstEventDate: rest.slice(1, at).join(" "),
      knownEvents: rest[at]!,
      debrisCatalogued: numberOrNull(rest[at + 1]),
      debrisInOrbit: numberOrNull(rest[at + 2]),
      apogeeKm: numberOrNull(rest[at + 3]),
      perigeeKm: numberOrNull(rest[at + 4]),
      inclinationDeg: numberOrNull(rest[at + 5]),
    });
  }
  if (rows.length !== EXPECTED.anomalous) throw new HoosfFormError(`${rows.length} Table 3.1 rows, not ${EXPECTED.anomalous}`);
  return rows;
}

/**
 * Table 4.1-1: aerodynamic breakups by launch date. Its cells wrap across
 * lines, so a row is read as far as the line that carries its designator
 * allows: the date tokens on that line, the breakup date being the first
 * after the launch date where three are present and the first where two
 * are (the launch date having wrapped), and the trailing numeric columns.
 */
export function parseAerodynamicTable(text: string): AerodynamicRow[] {
  const lines = tableLines(text.split("\n"), /^\s*TABLE 4\.1-1 HISTORY OF SATELLITE AERODYNAMIC EVENTS BY LAUNCH DATE\s*$/, /^\s*5\.0\s+SATELLITES NOT ASSOCIATED/);
  const rows: AerodynamicRow[] = [];
  for (const [index, line] of lines.entries()) {
    const row = rowTokens(line);
    if (row === null) continue;
    const before = line.slice(0, line.indexOf(row.designator)).trim();
    const dates = row.rest.filter((token) => DATE_TOKEN.test(token));
    const numbers = row.rest.filter((token) => NUMERIC.test(token));
    const [breakupDate, reentryDate] = dates.length >= 3 ? [dates[1], dates[2]] : dates.length === 2 ? [dates[0], dates[1]] : [dates[0] ?? null, null];
    const name = before !== "" ? before : (lines[index - 1] ?? "").trim();
    const tail = numbers.slice(-4);
    rows.push({
      name: name.replace(/\s+/g, " "),
      designator: row.designator,
      catalogueNumber: row.catalogueNumber,
      breakupDate: breakupDate ?? null,
      reentryDate: reentryDate ?? null,
      debrisCatalogued: tail.length === 4 ? numberOrNull(tail[0]) : null,
      apogeeKm: tail.length === 4 ? numberOrNull(tail[1]) : null,
      perigeeKm: tail.length === 4 ? numberOrNull(tail[2]) : null,
      inclinationDeg: tail.length === 4 ? numberOrNull(tail[3]) : null,
    });
  }
  return rows;
}

export function parseHoosf(text: string): Hoosf {
  return { spreads: parseSpreads(text), breakupRows: parseBreakupTable(text), anomalousRows: parseAnomalousTable(text), aerodynamicRows: parseAerodynamicTable(text) };
}

/** NASA's assessed cause in the file's vocabulary. */
export function causeOf(text: string | null): Cause | null {
  if (text === null) return null;
  const s = text.toLowerCase();
  if (s.startsWith("unknown")) return "unknown";
  if (s.includes("accidental") || s === "collision" || s.includes("debris impact") || s.includes("hit by")) return "collision-accidental";
  if (s.includes("intentional") || s.includes("deliberate collision") || s.includes("(hvi)")) return "collision-deliberate";
  if (s.startsWith("deliberate")) return "deliberate";
  if (s.startsWith("propulsion")) return "propulsion";
  if (s.startsWith("battery")) return "battery";
  if (s.includes("aerodynamic")) return "aerodynamic";
  return null;
}

/** NASA's TYPE in the file's classes. */
export function classOf(type: string | null): "payload" | "rocket body" | "debris" | "unknown" {
  const s = (type ?? "").toLowerCase();
  if (s.includes("payload")) return "payload";
  if (s.includes("rocket") || s.includes("stage") || s.includes("motor")) return "rocket body";
  if (s.includes("debris") || s.includes("mission-related")) return "debris";
  return "unknown";
}

/** The launch day of a spread ("25 Dec. 2013") or a table row ("25-Dec-13") as `YYYY-MM-DD`, or null when unreadable. */
export function launchDayOf(text: string | null): string | null {
  if (text === null) return null;
  try {
    const window = parseNasaDate(text);
    return window.from !== null && window.precision === "day" ? window.from.slice(0, 10) : null;
  } catch (error) {
    if (error instanceof DateFormError) return null;
    throw error;
  }
}

/** Where every statement from a spread or a row cites: the document page. */
const ref = (page: number): string => `p. ${page}`;

/**
 * Every statement the document makes: one per EVENT DATA block of a breakup
 * spread (its date, time, altitude and cause, the pre-event elements, the
 * debris counts from Table 2.1), one per anomalous-event spread (its first
 * date and orbit, the counts from Table 3.1), and one per row of the
 * aerodynamic table.
 */
export function hoosfStatements(hoosf: Hoosf): Statement[] {
  const breakupRows = new Map(hoosf.breakupRows.map((row) => [row.catalogueNumber, row]));
  const anomalousRows = new Map(hoosf.anomalousRows.map((row) => [row.catalogueNumber, row]));
  const statements: Statement[] = [];
  for (const spread of hoosf.spreads) {
    const parent = { catalogueNumber: spread.catalogueNumber, designator: spread.designator, name: spread.name };
    if (spread.chapter === 3 && spread.anomalous === null) {
      // The late anomalous spreads (2021 on) print DATE and TIME as a breakup spread does.
      const row = anomalousRows.get(spread.catalogueNumber);
      for (const event of spread.events) {
        statements.push({
          source: SOURCE_ID,
          ref: ref(spread.page),
          kind: "anomalous",
          parent,
          event: nasaWindow(event.date, event.time),
          orbit: { altitudeKm: event.altitude !== null && /\d/.test(event.altitude) ? numberOrNull(event.altitude.replace(/km.*$/, "")) : null, apogeeKm: row?.apogeeKm ?? null, perigeeKm: row?.perigeeKm ?? null, inclinationDeg: row?.inclinationDeg ?? null },
          cause: causeOf(event.cause),
          causeStated: event.cause,
          piecesCatalogued: row?.debrisCatalogued ?? null,
          piecesStatedOn: row !== undefined ? "2022-05-01" : null,
          preEventElements: event.elements?.when === "pre" ? event.elements.omm : null,
          note: `Type: ${spread.type ?? "unknown"}; owner: ${spread.owner ?? "unknown"}; launched ${spread.launchDate ?? "unknown"}.${event.elements?.when === "post" ? " Post-event elements only." : ""}`,
        });
      }
      continue;
    }
    if (spread.anomalous !== null) {
      const row = anomalousRows.get(spread.catalogueNumber);
      const kind: BreakupKind = "anomalous";
      statements.push({
        source: SOURCE_ID,
        ref: ref(spread.page),
        kind,
        parent,
        event: nasaWindow(spread.anomalous.firstDate || spread.events[0]?.date || "", spread.anomalous.firstDate ? null : (spread.events[0]?.time ?? null)),
        orbit: { altitudeKm: null, apogeeKm: spread.anomalous.apogeeKm ?? row?.apogeeKm ?? null, perigeeKm: spread.anomalous.perigeeKm ?? row?.perigeeKm ?? null, inclinationDeg: spread.anomalous.inclinationDeg ?? row?.inclinationDeg ?? null },
        cause: null,
        causeStated: null,
        piecesCatalogued: row?.debrisCatalogued ?? null,
        piecesStatedOn: "2022-05-01",
        preEventElements: spread.events[0]?.elements?.when === "pre" ? spread.events[0].elements.omm : null,
        note: `Known events: ${spread.anomalous.knownEvents}. Type: ${spread.type ?? "unknown"}; owner: ${spread.owner ?? "unknown"}; launched ${spread.launchDate ?? "unknown"}.`,
      });
      continue;
    }
    const row = breakupRows.get(spread.catalogueNumber);
    spread.events.forEach((event, index) => {
      const altitude = event.altitude !== null && /\d/.test(event.altitude) ? numberOrNull(event.altitude.replace(/km.*$/, "")) : null;
      statements.push({
        source: SOURCE_ID,
        ref: ref(spread.page),
        kind: "breakup",
        parent,
        event: nasaWindow(event.date, event.time),
        orbit: { altitudeKm: altitude, apogeeKm: index === 0 ? (row?.apogeeKm ?? null) : null, perigeeKm: index === 0 ? (row?.perigeeKm ?? null) : null, inclinationDeg: index === 0 ? (row?.inclinationDeg ?? null) : null },
        cause: causeOf(event.cause),
        causeStated: event.cause,
        piecesCatalogued: index === 0 ? (row?.debrisCatalogued ?? null) : null,
        piecesStatedOn: index === 0 && row !== undefined ? "2022-05-01" : null,
        preEventElements: event.elements?.when === "pre" ? event.elements.omm : null,
        note: `Type: ${spread.type ?? "unknown"}; owner: ${spread.owner ?? "unknown"}; launched ${spread.launchDate ?? "unknown"}.${event.location !== null ? ` Location ${event.location}.` : ""}${event.elements?.when === "post" ? " Post-event elements only." : ""}${spread.events.length > 1 ? ` Event ${index + 1} of ${spread.events.length} on this spread.` : ""}`,
      });
    });
  }
  const withSpread = new Set(hoosf.spreads.map((s) => s.catalogueNumber));
  for (const row of hoosf.breakupRows) {
    if (withSpread.has(row.catalogueNumber)) continue;
    // A row of Table 2.1 with no spread of its own (Meteor 2-8 in the 16th edition): the table is all the document says.
    let event;
    try {
      event = nasaWindow(row.breakupDate, null);
    } catch (error) {
      if (error instanceof DateFormError) continue;
      throw error;
    }
    statements.push({
      source: SOURCE_ID,
      ref: "Table 2.1",
      kind: "breakup",
      parent: { catalogueNumber: row.catalogueNumber, designator: row.designator, name: null },
      event,
      orbit: { altitudeKm: null, apogeeKm: row.apogeeKm, perigeeKm: row.perigeeKm, inclinationDeg: row.inclinationDeg },
      cause: null,
      causeStated: null,
      piecesCatalogued: row.debrisCatalogued,
      piecesStatedOn: "2022-05-01",
      preEventElements: null,
      note: `Listed in Table 2.1 with no spread of its own; launched ${row.launchDate}.`,
    });
  }
  for (const row of hoosf.aerodynamicRows) {
    if (row.breakupDate === null) continue;
    let event;
    try {
      event = nasaWindow(row.breakupDate, null);
    } catch (error) {
      if (error instanceof DateFormError) continue;
      throw error;
    }
    statements.push({
      source: SOURCE_ID,
      ref: "Table 4.1-1",
      kind: "aerodynamic",
      parent: { catalogueNumber: row.catalogueNumber, designator: row.designator, name: row.name || null },
      event,
      orbit: { altitudeKm: null, apogeeKm: row.apogeeKm, perigeeKm: row.perigeeKm, inclinationDeg: row.inclinationDeg },
      cause: "aerodynamic",
      causeStated: "aerodynamic breakup at reentry",
      piecesCatalogued: row.debrisCatalogued,
      piecesStatedOn: "2022-05-01",
      preEventElements: null,
      note: row.reentryDate !== null ? `Reentered ${row.reentryDate}.` : null,
    });
  }
  return statements;
}
