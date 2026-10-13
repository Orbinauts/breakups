import type { Omm } from "@orbinauts/engine";

/**
 * The Known Breakups: every on-orbit fragmentation an authority reported,
 * one row per event, read from the file this package ships
 * (`data/breakups.json`) and built from the sources it names. Each row keeps
 * every source's statement verbatim beside the values resolved from them,
 * with the source each resolved field came from, so a reader can check any
 * number against where it was read. The scorecard's truth; the library
 * never reads it to decide anything.
 */

/**
 * NASA's two kinds (a breakup, "the usually destructive disassociation" of
 * a body "with a wide range of separation velocities"; an anomalous event,
 * "the unplanned separation, usually at low velocity, of one or more
 * detectable objects from a satellite, which remains essentially intact"),
 * its aerodynamic breakups at reentry, a deliberate or wear-and-tear
 * release of objects as GCAT lists them, and an event whose report names no
 * object.
 */
export const BREAKUP_KINDS = ["breakup", "anomalous", "aerodynamic", "release", "unnamed"] as const;
export type BreakupKind = (typeof BREAKUP_KINDS)[number];

export const CAUSES = ["propulsion", "deliberate", "collision-accidental", "collision-deliberate", "battery", "aerodynamic", "unknown"] as const;
export type Cause = (typeof CAUSES)[number];

/** Low, medium, geosynchronous or highly elliptical, from the orbit at the event. */
export const REGIMES = ["LEO", "MEO", "GEO", "HEO", "unknown"] as const;
export type Regime = (typeof REGIMES)[number];

/** How finely a source states the event's instant. */
export const PRECISIONS = ["second", "minute", "hour", "day", "month", "year", "none"] as const;
export type Precision = (typeof PRECISIONS)[number];

/**
 * How far the event's time can be trusted, read from its best statement
 * whichever source states the instant most finely: A, an authority states
 * the minute; B, an authority states the day or a window of three days at
 * most; C, GCAT dates it to the month or finer, or an authority states the
 * month, or a named analyst dated it from public elements, or a report
 * quotes a company's measured instant; D, pieces in the catalogue alone, or
 * news to the day at best.
 */
export const CONFIDENCES = ["A", "B", "C", "D"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const SOURCE_IDS = ["hoosf-16e", "gcat", "odqn", "s4s-notice", "esa-ser", "news", "analyst", "catalogue"] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

/**
 * The sources whose statements are an agency's: NASA (its history, whose
 * reference documents date its quarterly news issues, and the quarterly
 * news itself), U.S. Space Forces-Space's notices and ESA's report. The
 * owner reads the lead of a confirmation against the first of these; an
 * analyst's dating, a company's post or a news report is recorded beside
 * them and marked by its source, never counted as an agency's word.
 */
export const AGENCY_SOURCES: readonly SourceId[] = ["hoosf-16e", "odqn", "s4s-notice", "esa-ser"];

export const isAgencySource = (source: SourceId): boolean => AGENCY_SOURCES.includes(source);

/**
 * Whether a statement is an agency's word on the event's object: made by
 * an agency (`AGENCY_SOURCES`) and naming what it is about. An ESA row
 * that names no object, which the truth's build placed on an event by its
 * own rule (its parent all null: the only event the other sources state
 * within a day of it, in an orbit and of an object type it allows), may
 * date and corroborate the event, but no agency said it of this object:
 * it is no authority for the event's confidence and no first agency
 * notice for the lead. A row ESA left unnamed stands as an event of its
 * own, described, and is that event's word.
 */
export const isAgencyWord = (statement: Pick<Statement, "source" | "parent">): boolean =>
  isAgencySource(statement.source) && !(statement.source === "esa-ser" && statement.parent.catalogueNumber === null && statement.parent.designator === null && statement.parent.name === null);

export const BODY_CLASSES = ["payload", "rocket body", "debris", "unknown"] as const;
export type BodyClass = (typeof BODY_CLASSES)[number];

/** The parent as a source names it: any of the three may be missing. */
export interface StatedParent {
  catalogueNumber: number | null;
  /** The international designator (`1981-043A`), or the launch alone (`2018-005`) where no piece is named. */
  designator: string | null;
  name: string | null;
}

/**
 * When a source says the event happened: its words, the instant to the
 * minute where it states one, and the window both edges included (an
 * instant alone is a window of no width; a day runs from its midnight to
 * the next; GCAT's trailing `?` widens its last unit by one either side).
 * `from` is null where the source states no lower edge ("prior to ...").
 */
export interface StatedTime {
  stated: string;
  at: string | null;
  from: string | null;
  to: string;
  precision: Precision;
}

/** The orbit a source gives at the event, in kilometres and degrees; null where it gives none. */
export interface StatedOrbit {
  altitudeKm: number | null;
  apogeeKm: number | null;
  perigeeKm: number | null;
  inclinationDeg: number | null;
}

/** How finely a statement's publication day is known: to the day (a notice seen, a post, a report's date), or to the month (a quarterly news issue's month). */
export const STATED_PRECISIONS = ["day", "month"] as const;
export type StatedPrecision = (typeof STATED_PRECISIONS)[number];

/**
 * When a statement can first have been public: the earliest day it can
 * have been read, how finely that is known, and where the day was read.
 * A quarterly news issue is dated to its month, and its first day is the
 * earliest it can have been public, or the event's own day where the
 * issue is of the event's month; a notice to the day it was seen; a post
 * or a report to its day.
 */
export interface StatedOn {
  /** `YYYY-MM-DD`. */
  on: string;
  precision: StatedPrecision;
  ref: string;
}

/** The first statement on an event: the earliest any of its statements can have been public, with the source that made it. */
export interface FirstStatement extends StatedOn {
  source: SourceId;
}

/** One source's statement about one event, kept verbatim beside what was read from it. */
export interface Statement {
  source: SourceId;
  /** Where in the source: a page, an issue and page, a table entry, a link. */
  ref: string;
  kind: BreakupKind | null;
  parent: StatedParent;
  event: StatedTime;
  orbit: StatedOrbit;
  cause: Cause | null;
  /** The cause in the source's words. */
  causeStated: string | null;
  piecesCatalogued: number | null;
  /** The day the piece count was counted on, where the source says. */
  piecesStatedOn: string | null;
  /** The element set the source publishes for the parent before the event (NASA's spreads), in the OMM's shape. */
  preEventElements: Omm | null;
  note: string | null;
  /** When the statement can first have been public; null where the source gives no publication date (GCAT's table, the catalogue itself, NASA's history where its references name no quarterly news issue after the event). A hand-entered statement may leave it out, and the build reads it from the reference. */
  statedOn: StatedOn | null;
  /** The page the statement is read from, where it has one: the article or post it is dated from. Left out where the source has no link (a table, a notice on a login page). */
  url?: string;
}

/** The parent of a Known Breakup, resolved across its statements. */
export interface Parent extends StatedParent {
  name: string;
  class: BodyClass;
  owner: string | null;
  /** The launch day as a source gives it, `YYYY-MM-DD` or a coarser prefix. */
  launchedOn: string | null;
}

/** Which source each resolved field was read from. */
export interface ResolvedFrom {
  event: SourceId;
  orbit: SourceId | null;
  cause: SourceId | null;
  pieces: SourceId | null;
  kind: SourceId;
}

export const CONFLICT_FIELDS = ["event", "day", "parent", "kind", "cause"] as const;
export type ConflictField = (typeof CONFLICT_FIELDS)[number];

/** Where two sources disagree: on the instant (by more than ten minutes), the day, the parent, the kind or the cause. */
export interface Conflict {
  field: ConflictField;
  sources: SourceId[];
  detail: string;
}

/** One Known Breakup, as the file carries it. */
export interface Breakup {
  /** The parent's catalogue number (or `A:` and its launch for an analyst object) and the day of the instant where the event states one, else the first day of the window. */
  id: string;
  parent: Parent;
  kind: BreakupKind;
  event: StatedTime;
  orbit: StatedOrbit & { regime: Regime };
  cause: Cause;
  piecesCatalogued: number | null;
  confidence: Confidence;
  /** Whether the scorecard counts it: not an aerodynamic breakup, a release or an unnamed event. */
  scoreable: boolean;
  exemptReason: string | null;
  resolvedFrom: ResolvedFrom;
  statements: Statement[];
  conflicts: Conflict[];
  /** The reviewer's overrides applied, by name. */
  overrides: string[];
  /** The earliest any statement of the event can have been public, and which; null where none is dated. An agency's first statement is read from the statements (`firstAgencyStatement`). */
  firstStatement: FirstStatement | null;
}

/** What the file says of each source it was built from. */
export interface SourceRecord {
  citation: string;
  licence: string;
  version: string;
}

export interface BreakupsFile {
  format: 1;
  sources: Partial<Record<SourceId, SourceRecord>>;
  breakups: Breakup[];
}

export class TruthError extends Error {}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/;
const DAY = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;
/** A designator, or the launch alone where the source names no piece. */
const DESIGNATOR = /^\d{4}-\d{3}[A-Z]{0,3}$/;
const ID = /^(?:\d+|A:\d{4}-\d{3}[A-Z]{0,3}|U:\d+):\d{4}-\d{2}-\d{2}$/;

type Fields = Record<string, unknown>;

function fail(where: string, reason: string): never {
  throw new TruthError(`${where}: ${reason}`);
}

function object(value: unknown, where: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(where, "is not an object");
  return value as Fields;
}

function text(fields: Fields, name: string, where: string): string {
  const value = fields[name];
  if (typeof value !== "string" || value.trim() === "") fail(where, `${name} is not text`);
  return value;
}

function textOrNull(fields: Fields, name: string, where: string): string | null {
  const value = fields[name];
  if (value === null) return null;
  if (typeof value !== "string" || value.trim() === "") fail(where, `${name} is not text or null`);
  return value;
}

function numberOrNull(fields: Fields, name: string, where: string): number | null {
  const value = fields[name];
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(where, `${name} is not a finite number or null`);
  return value;
}

function catalogueNumberOrNull(fields: Fields, name: string, where: string): number | null {
  const value = numberOrNull(fields, name, where);
  if (value !== null && (!Number.isInteger(value) || value < 1)) fail(where, `${name} is not a positive whole number or null`);
  return value;
}

function oneOf<T extends string>(fields: Fields, name: string, allowed: readonly T[], where: string): T {
  const value = fields[name];
  if (!allowed.includes(value as T)) fail(where, `${name} is not one of ${allowed.join(", ")}`);
  return value as T;
}

function oneOfOrNull<T extends string>(fields: Fields, name: string, allowed: readonly T[], where: string): T | null {
  return fields[name] === null ? null : oneOf(fields, name, allowed, where);
}

function instantOrNull(fields: Fields, name: string, where: string): string | null {
  const value = textOrNull(fields, name, where);
  if (value !== null && (!INSTANT.test(value) || Number.isNaN(Date.parse(value)))) fail(where, `${name} is not an ISO 8601 UTC instant`);
  return value;
}

function known(fields: Fields, allowed: readonly string[], where: string, optional: readonly string[] = []): void {
  const extra = Object.keys(fields).find((key) => !allowed.includes(key) && !optional.includes(key));
  if (extra !== undefined) fail(where, `unknown field ${extra}`);
  const missing = allowed.find((key) => !(key in fields));
  if (missing !== undefined) fail(where, `no ${missing} (null where the source gives none)`);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A publication day checked: an ISO day, a precision of the day or the month, and where it was read; null passes. */
function readStatedOn(value: unknown, where: string): StatedOn | null {
  if (value === null || value === undefined) return null;
  const fields = object(value, where);
  known(fields, ["on", "precision", "ref"], where);
  const on = text(fields, "on", where);
  if (!ISO_DAY.test(on) || Number.isNaN(Date.parse(on))) fail(where, "on is not a day like 2020-02-01");
  return { on, precision: oneOf(fields, "precision", STATED_PRECISIONS, where), ref: text(fields, "ref", where) };
}

function readParent(value: unknown, where: string): StatedParent {
  const fields = object(value, where);
  known(fields, ["catalogueNumber", "designator", "name"], where);
  const designator = textOrNull(fields, "designator", where);
  if (designator !== null && !DESIGNATOR.test(designator)) fail(where, "designator is not like 1981-043A or the launch 2018-005");
  return { catalogueNumber: catalogueNumberOrNull(fields, "catalogueNumber", where), designator, name: textOrNull(fields, "name", where) };
}

/** A statement of time checked: instants ISO 8601 UTC, `to` present, from ≤ at ≤ to. */
export function readStatedTime(value: unknown, where: string): StatedTime {
  const fields = object(value, where);
  known(fields, ["stated", "at", "from", "to", "precision"], where);
  const stated = text(fields, "stated", where);
  const at = instantOrNull(fields, "at", where);
  const from = instantOrNull(fields, "from", where);
  const to = instantOrNull(fields, "to", where);
  if (to === null) fail(where, "to is null: every statement has an upper edge");
  if (from !== null && from > to) fail(where, `the window runs backwards (${from} after ${to})`);
  if (at !== null && ((from !== null && at < from) || at > to)) fail(where, `the instant ${at} is outside the window`);
  return { stated, at, from, to, precision: oneOf(fields, "precision", PRECISIONS, where) };
}

function readOrbit(value: unknown, where: string): StatedOrbit {
  const fields = object(value, where);
  known(fields, ["altitudeKm", "apogeeKm", "perigeeKm", "inclinationDeg"], where);
  return {
    altitudeKm: numberOrNull(fields, "altitudeKm", where),
    apogeeKm: numberOrNull(fields, "apogeeKm", where),
    perigeeKm: numberOrNull(fields, "perigeeKm", where),
    inclinationDeg: numberOrNull(fields, "inclinationDeg", where),
  };
}

const HTTPS_LINK = /^https:\/\/\S+$/;

const STATEMENT_FIELDS = ["source", "ref", "kind", "parent", "event", "orbit", "cause", "causeStated", "piecesCatalogued", "piecesStatedOn", "preEventElements", "note"] as const;

/** One statement checked; `where` names it in any error. A statement with no `statedOn` (a hand-entered one the build dates from its reference) reads it as null. */
export function readStatement(value: unknown, where: string): Statement {
  const fields = object(value, where);
  known(fields, STATEMENT_FIELDS, where, ["statedOn", "url"]);
  const piecesStatedOn = textOrNull(fields, "piecesStatedOn", where);
  if (piecesStatedOn !== null && !DAY.test(piecesStatedOn)) fail(where, "piecesStatedOn is not a day");
  const elements = fields.preEventElements;
  if (elements !== null && (typeof elements !== "object" || Array.isArray(elements))) fail(where, "preEventElements is not an object or null");
  const url = fields.url;
  if (url !== undefined && (typeof url !== "string" || !HTTPS_LINK.test(url))) fail(where, "url is not an https:// link");
  return {
    source: oneOf(fields, "source", SOURCE_IDS, where),
    ref: text(fields, "ref", where),
    kind: oneOfOrNull(fields, "kind", BREAKUP_KINDS, where),
    parent: readParent(fields.parent, `${where} parent`),
    event: readStatedTime(fields.event, `${where} event`),
    orbit: readOrbit(fields.orbit, `${where} orbit`),
    cause: oneOfOrNull(fields, "cause", CAUSES, where),
    causeStated: textOrNull(fields, "causeStated", where),
    piecesCatalogued: numberOrNull(fields, "piecesCatalogued", where),
    piecesStatedOn,
    preEventElements: elements as Omm | null,
    note: textOrNull(fields, "note", where),
    statedOn: readStatedOn(fields.statedOn, `${where} statedOn`),
    ...(url === undefined ? {} : { url }),
  };
}

/** A list of statements checked, each named by its place and parent in any error. */
export function readStatements(input: unknown): Statement[] {
  if (!Array.isArray(input)) throw new TruthError("the statements are not a list");
  return input.map((entry, index) => {
    const name = typeof entry === "object" && entry !== null ? ((entry as Fields).parent as Fields | undefined)?.name : undefined;
    return readStatement(entry, `statement ${index + 1}${typeof name === "string" ? ` (${name})` : ""}`);
  });
}

const BREAKUP_FIELDS = ["id", "parent", "kind", "event", "orbit", "cause", "piecesCatalogued", "confidence", "scoreable", "exemptReason", "resolvedFrom", "statements", "conflicts", "overrides", "firstStatement"] as const;

function readBreakup(value: unknown, where: string): Breakup {
  const fields = object(value, where);
  known(fields, BREAKUP_FIELDS, where);
  const id = text(fields, "id", where);
  if (!ID.test(id)) fail(where, `id ${id} is not a parent and a day`);
  const parentFields = object(fields.parent, `${where} parent`);
  known(parentFields, ["catalogueNumber", "designator", "name", "class", "owner", "launchedOn"], `${where} parent`);
  const launchedOn = textOrNull(parentFields, "launchedOn", `${where} parent`);
  if (launchedOn !== null && !DAY.test(launchedOn)) fail(`${where} parent`, "launchedOn is not a day");
  const parent: Parent = {
    ...readParent({ catalogueNumber: parentFields.catalogueNumber, designator: parentFields.designator, name: parentFields.name }, `${where} parent`),
    name: text(parentFields, "name", `${where} parent`),
    class: oneOf(parentFields, "class", BODY_CLASSES, `${where} parent`),
    owner: textOrNull(parentFields, "owner", `${where} parent`),
    launchedOn,
  };
  const kind = oneOf(fields, "kind", BREAKUP_KINDS, where);
  if (kind === "unnamed" && (parent.catalogueNumber !== null || parent.designator !== null)) fail(where, "an unnamed event names no parent");
  const orbitFields = object(fields.orbit, `${where} orbit`);
  const { regime, ...orbitRest } = orbitFields;
  const orbit = { ...readOrbit(orbitRest, `${where} orbit`), regime: oneOf({ regime }, "regime", REGIMES, `${where} orbit`) };
  const scoreable = fields.scoreable;
  if (typeof scoreable !== "boolean") fail(where, "scoreable is not true or false");
  const exemptReason = textOrNull(fields, "exemptReason", where);
  if (scoreable === (exemptReason !== null)) fail(where, "an exempt reason is given exactly when the event is not scoreable");
  const resolvedFields = object(fields.resolvedFrom, `${where} resolvedFrom`);
  known(resolvedFields, ["event", "orbit", "cause", "pieces", "kind"], `${where} resolvedFrom`);
  const resolvedFrom: ResolvedFrom = {
    event: oneOf(resolvedFields, "event", SOURCE_IDS, `${where} resolvedFrom`),
    orbit: oneOfOrNull(resolvedFields, "orbit", SOURCE_IDS, `${where} resolvedFrom`),
    cause: oneOfOrNull(resolvedFields, "cause", SOURCE_IDS, `${where} resolvedFrom`),
    pieces: oneOfOrNull(resolvedFields, "pieces", SOURCE_IDS, `${where} resolvedFrom`),
    kind: oneOf(resolvedFields, "kind", SOURCE_IDS, `${where} resolvedFrom`),
  };
  if (!Array.isArray(fields.statements) || fields.statements.length === 0) fail(where, "has no statements");
  const statements = fields.statements.map((entry, index) => readStatement(entry, `${where} statement ${index + 1}`));
  if (!Array.isArray(fields.conflicts)) fail(where, "conflicts is not a list");
  const conflicts = fields.conflicts.map((entry, index) => {
    const conflict = object(entry, `${where} conflict ${index + 1}`);
    known(conflict, ["field", "sources", "detail"], `${where} conflict ${index + 1}`);
    if (!Array.isArray(conflict.sources) || !conflict.sources.every((source) => SOURCE_IDS.includes(source as SourceId))) fail(`${where} conflict ${index + 1}`, "sources is not a list of source ids");
    return { field: oneOf(conflict, "field", CONFLICT_FIELDS, `${where} conflict ${index + 1}`), sources: conflict.sources as SourceId[], detail: text(conflict, "detail", `${where} conflict ${index + 1}`) };
  });
  if (!Array.isArray(fields.overrides) || !fields.overrides.every((name) => typeof name === "string")) fail(where, "overrides is not a list of names");
  let firstStatement: FirstStatement | null = null;
  if (fields.firstStatement !== null) {
    const first = object(fields.firstStatement, `${where} firstStatement`);
    known(first, ["on", "precision", "source", "ref"], `${where} firstStatement`);
    const { source, ...rest } = first;
    firstStatement = { ...readStatedOn(rest, `${where} firstStatement`)!, source: oneOf({ source }, "source", SOURCE_IDS, `${where} firstStatement`) };
    if (!statements.some((s) => s.source === firstStatement!.source && s.statedOn?.on === firstStatement!.on)) fail(`${where} firstStatement`, "names no statement of the event dated so");
  }
  return {
    id,
    parent,
    kind,
    event: readStatedTime(fields.event, `${where} event`),
    orbit,
    cause: oneOf(fields, "cause", CAUSES, where),
    piecesCatalogued: numberOrNull(fields, "piecesCatalogued", where),
    confidence: oneOf(fields, "confidence", CONFIDENCES, where),
    scoreable,
    exemptReason,
    resolvedFrom,
    statements,
    conflicts,
    overrides: fields.overrides as string[],
    firstStatement,
  };
}

/**
 * The Known Breakups of the file as it is shipped, every row checked: a row
 * that is not a Known Breakup throws, naming it by its place and name, so a
 * malformed file fails the tests rather than the scorecard. Ids are unique.
 */
export function readBreakups(input: unknown): Breakup[] {
  const file = object(input, "the breakups file");
  if (file.format !== 1) fail("the breakups file", `format ${String(file.format)} is not 1`);
  object(file.sources, "the breakups file sources");
  if (!Array.isArray(file.breakups)) fail("the breakups file", "has no list of breakups");
  const breakups = file.breakups.map((entry, index) => {
    const name = typeof entry === "object" && entry !== null ? ((entry as Fields).parent as Fields | undefined)?.name : undefined;
    return readBreakup(entry, `breakup ${index + 1}${typeof name === "string" ? ` (${name})` : ""}`);
  });
  const seen = new Set<string>();
  for (const breakup of breakups) {
    if (seen.has(breakup.id)) fail(`breakup ${breakup.id}`, "its id is not unique");
    seen.add(breakup.id);
  }
  return breakups;
}

/** The launch of a designator: `1981-043` of `1981-043A`, or of `2018-005` alone; null for none. */
export function launchOf(designator: string | null): string | null {
  return designator !== null && DESIGNATOR.test(designator) ? designator.slice(0, 8) : null;
}

/**
 * The first statement of an event by an agency (`isAgencyWord`): the
 * earliest of its agency statements' publication days, with the source;
 * null where no agency statement is dated. The scorecard reads the lead
 * of a confirmation against this, the owner's reading of "before the
 * agencies said it".
 */
export function firstAgencyStatement(breakup: Pick<Breakup, "statements">): FirstStatement | null {
  return firstStatementOf(breakup.statements.filter(isAgencyWord));
}

/** The earliest dated statement among those given, a finer day before a month on the same day, then the source's order in `SOURCE_IDS`; null where none is dated. */
export function firstStatementOf(statements: readonly Statement[]): FirstStatement | null {
  let first: FirstStatement | null = null;
  for (const s of statements) {
    if (s.statedOn === null) continue;
    const candidate: FirstStatement = { ...s.statedOn, source: s.source };
    if (first === null || candidate.on < first.on || (candidate.on === first.on && (STATED_PRECISIONS.indexOf(candidate.precision) < STATED_PRECISIONS.indexOf(first.precision) || (candidate.precision === first.precision && SOURCE_IDS.indexOf(candidate.source) < SOURCE_IDS.indexOf(first.source))))) first = candidate;
  }
  return first;
}

/** The UTC year a Known Breakup is counted in: its instant's where it states one, else its window's lower edge, else its upper. */
export function yearOf(breakup: Pick<Breakup, "event">): number {
  return new Date(breakup.event.at ?? breakup.event.from ?? breakup.event.to).getUTCFullYear();
}
