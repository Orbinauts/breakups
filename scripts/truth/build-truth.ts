import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { firstStatementOf, readStatements, type Breakup, type BreakupKind, type BreakupsFile, type Cause, type Confidence, type Conflict, type Parent, type Precision, type Regime, type ResolvedFrom, type SourceId, type SourceRecord, type StatedOrbit, type StatedTime, type Statement } from "../../src/truth.ts";
import { gcatStatements, parseGcat } from "./parse-gcat.ts";
import { isSatcatStatement, parseSatcat, satcatStatements, separationsOf, type Skipped } from "./parse-gcat-satcat.ts";
import { hoosfStatements, parseHoosf } from "./parse-hoosf.ts";
import { readRegimes, regimeAt, type RegimesFile } from "./regimes.ts";
import { renderReport } from "./report.ts";
import { statedOnFromRef } from "./stated.ts";

/**
 * Builds the ground truth, `data/breakups.json`, from every statement the
 * sources make: NASA's history read from its text, GCAT's clouds read from
 * its table, GCAT's satellite catalogue read for every piece's parent and
 * separation date, the catalogue's own bursts, and the hand-entered
 * statements. Statements about one parent
 * whose windows fall within a month of each other are one event, unless
 * one source lists them as two instants more than a day apart; a
 * reviewer's overrides merge or separate what the rule gets wrong. Each
 * field is then resolved by a fixed order of sources, every disagreement is
 * listed as a conflict, and the report `docs/truth.md` says what was built
 * from what. The file carries no timestamp, so a rebuild makes no diff.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");

/** How far apart two statements' windows may be and still describe one event. */
export const SAME_EVENT_DAYS = 30;
/** Two instants further apart than this are a conflict. */
export const CONFLICT_MINUTES = 10;
/** A burst of catalogued pieces within this long after a reported event of the same launch is that event's late cataloguing, not a new event. */
export const LATE_BATCH_YEARS = 3;
/** A window wider than this is no target in a useful sense: a month either side of a stated month fits, GCAT's "2023?" widened to three years does not. */
export const WIDE_WINDOW_DAYS = 93;

const DAY_MS = 86_400_000;

/** An override: statements of these parents between these days are one event; a source may be made to win the instant. */
interface Override {
  name: string;
  merge?: { catalogueNumber: number }[];
  between?: [string, string];
  /** Every event of this launch stated by the catalogues alone (its bursts, GCAT's satellite catalogue) is exempt with the reason given. */
  exemptLaunch?: string;
  event?: SourceId;
  kind?: BreakupKind;
  exempt?: string;
  /** The window's lower edge the reviewer sets on a merged event whose statements give none, with the reason in the note. */
  from?: string;
  note?: string;
}

const PRECISION_RANK: Record<Precision, number> = { second: 0, minute: 1, hour: 2, day: 3, month: 4, year: 5, none: 6 };
/** Authorities first, then the analyst, GCAT, the news and the catalogue. */
const SOURCE_RANK: Record<SourceId, number> = { "hoosf-16e": 0, odqn: 1, "s4s-notice": 2, "esa-ser": 3, analyst: 4, gcat: 5, news: 6, catalogue: 7 };
/**
 * GCAT's satellite catalogue ranks after the news and before the
 * catalogue's bursts: it dates every piece's separation, so it makes an
 * event where no one else reported one and names the parent, the kind and
 * the date of a burst the catalogue alone saw; where another source states
 * the event, that source's instant, kind, orbit, cause and count stand,
 * and the satellite catalogue's statement is kept beside them, its
 * disagreements listed as conflicts.
 */
const SATCAT_RANK = 6.5;
const rankOf = (statement: Statement): number => (isSatcatStatement(statement) ? SATCAT_RANK : SOURCE_RANK[statement.source]);
const AUTHORITIES = new Set<SourceId>(["hoosf-16e", "odqn", "s4s-notice", "esa-ser"]);

const SOURCES: Partial<Record<SourceId, SourceRecord>> = {
  "hoosf-16e": { citation: "Anz-Meador, P., Opiela, J., Liou, J.-C., History of On-Orbit Satellite Fragmentations, 16th Edition, NASA/TP-20220019160, December 2022, https://orbitaldebris.jsc.nasa.gov/library/HOOSF_16e.pdf", licence: "US Government work", version: "16th edition, events to 1 May 2022" },
  odqn: { citation: "NASA Orbital Debris Program Office, Orbital Debris Quarterly News, https://orbitaldebris.jsc.nasa.gov/quarterly-news/", licence: "US Government work", version: "volume 26 issue 3 (September 2022) to volume 30 issue 3 (September 2026)" },
  // The version is read from the two snapshots' own update lines (`gcatVersion`), so a refreshed snapshot states its edition.
  gcat: { citation: "McDowell, J., General Catalog of Artificial Space Objects: Space Debris Clouds, https://planet4589.org/space/debris/debriscat/index.html, and the satellite catalogue, https://planet4589.org/space/gcat/tsv/cat/satcat.tsv", licence: "CC-BY-4.0", version: "" },
  "esa-ser": { citation: "ESA Space Debris Office, ESA's Annual Space Environment Report, GEN-DB-LOG-00288-OPS-SD, issue 9.1, 21 October 2025, Table 3.7", licence: "ESA", version: "2025 edition, events of 2024" },
  "s4s-notice": { citation: "U.S. Space Forces-Space fragmentation announcements, as posted on the public catalogue's login page", licence: "public announcement", version: "as seen on 2026-09-17" },
  analyst: { citation: "Named analysts' statements, each cited on its statement: Jim Shell's dating of Meteor 2-7's second breakup from public elements, as reported by EarthSky, 2026-10-07; J. McDowell's GCAT satellite catalogue and Jonathan's Space Report", licence: "cited reports", version: "to 2026-10-10" },
  news: { citation: "LeoLabs' public notifications and the news reports cited on each statement", licence: "cited reports", version: "to 2026-10-09" },
  catalogue: { citation: "The public catalogue's own listing of new objects under a parent's launch", licence: "public catalogue", version: "as seen on 2026-10-09" },
};

/** The day of a GCAT update line (`2025 Jun 22 2314:45`, `2026 Oct  9 1800:46`): its year, month and day, the whitespace folded. */
export function gcatDay(updated: string): string {
  const day = /^(\d{4})\s+([A-Z][a-z]{2})\s+(\d{1,2})\b/.exec(updated.trim());
  if (day === null) throw new Error(`GCAT's update line "${updated}" names no day`);
  return `${day[1]} ${day[2]} ${Number(day[3])}`;
}

/** GCAT's version as the truth records it: the day of each snapshot's own update line. */
export function gcatVersion(debrisUpdated: string, satcatUpdated: string): string {
  return `debris clouds data last updated ${gcatDay(debrisUpdated)}; satellite catalogue updated ${gcatDay(satcatUpdated)}`;
}

/** The sources' records, GCAT's version read from its snapshots. */
function sourcesOf(): Partial<Record<SourceId, SourceRecord>> {
  const version = gcatVersion(parseGcat(read("data/truth/sources/gcat-debriscat.html")).updated, parseSatcat(read("data/truth/sources/gcat-satcat.tsv")).updated);
  return { ...SOURCES, gcat: { ...SOURCES.gcat!, version } };
}

function parseJson<T>(path: string): T {
  return JSON.parse(read(path)) as T;
}

/** What the satellite catalogue's rule left out, counted for the report. */
function satcatSkipped(): Skipped {
  return separationsOf(parseSatcat(read("data/truth/sources/gcat-satcat.tsv"))).skipped;
}

/** Every statement, from every source. */
function allStatements(): Statement[] {
  const hoosf = hoosfStatements(parseHoosf(read("data/truth/sources/hoosf-16e.txt")));
  const gcat = gcatStatements(parseGcat(read("data/truth/sources/gcat-debriscat.html")));
  const hand = readStatements(parseJson<{ statements: unknown }>("data/truth/hand.json").statements);
  const catalogue = existsSync(resolve(ROOT, "data/truth/catalogue.json")) ? readStatements(parseJson<{ statements: unknown }>("data/truth/catalogue.json").statements) : [];
  const satcat = satcatStatements(parseSatcat(read("data/truth/sources/gcat-satcat.tsv")));
  // Each statement dated by when it can first have been public: NASA's history by the quarterly news it cites, a hand-entered one by its reference where it does not say.
  // The satellite catalogue's come last, so the events the other sources make are grouped as before and its statements join them.
  return [...hoosf, ...gcat, ...hand, ...catalogue, ...satcat].map((statement) => ({ ...statement, statedOn: statedOnFromRef(statement) }));
}

const lower = (time: StatedTime): number => Date.parse(time.from ?? time.to);
const upper = (time: StatedTime): number => Date.parse(time.to);

/** The time between two windows, zero where they overlap. */
const gapOf = (a: StatedTime, b: StatedTime): number => Math.max(0, lower(a) - upper(b), lower(b) - upper(a));

/** Whether two windows fall within `SAME_EVENT_DAYS` of each other. */
function near(a: StatedTime, b: StatedTime): boolean {
  return gapOf(a, b) <= SAME_EVENT_DAYS * DAY_MS;
}

const middle = (time: StatedTime): number => (lower(time) + upper(time)) / 2;
/** How far apart two sets of statements are: the gap between their nearest windows, then, on a tie, between the nearest windows' middles. */
function distanceOf(a: Statement[], b: Statement[]): [number, number] {
  let best: [number, number] = [Infinity, Infinity];
  for (const s of a) {
    for (const t of b) {
      const d: [number, number] = [gapOf(s.event, t.event), Math.abs(middle(s.event) - middle(t.event))];
      if (d[0] < best[0] || (d[0] === best[0] && d[1] < best[1])) best = d;
    }
  }
  return best;
}
const closer = (a: [number, number], b: [number, number]): boolean => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/**
 * The sources that list each event once: NASA's history, GCAT's cloud table
 * and its satellite catalogue (each apart), the quarterly news, the notices
 * and ESA's report. Two of one such source's statements on one parent are
 * two events where both state the day or finer and they lie more than a day
 * apart. The news and the analysts gather many outlets' reports under one
 * name, and the catalogue's bursts are windows, not instants: neither is
 * read so.
 */
const LISTING_SOURCES: ReadonlySet<SourceId> = new Set<SourceId>(["hoosf-16e", "gcat", "odqn", "s4s-notice", "esa-ser"]);
const listingOf = (statement: Statement): string | null => (isSatcatStatement(statement) ? "gcat-satcat" : LISTING_SOURCES.has(statement.source) ? statement.source : null);
const STATES_THE_DAY: ReadonlySet<Precision> = new Set<Precision>(["second", "minute", "hour", "day"]);
/**
 * The kinds the rule reads: the scorecard's targets. NASA's aerodynamic
 * table is read twice where its cells wrap (one row, two dates), and the
 * satellite catalogue's releases from a station or a crewed craft come
 * weeks apart as one episode; both are out of the denominator either way.
 */
const isTargetKind = (statement: Statement): boolean => statement.kind === null || statement.kind === "breakup" || statement.kind === "anomalous";

/** Whether one listing source states these two as distinct instants of one parent: both to the day or finer, more than a day apart. */
export function distinctInstants(a: Statement, b: Statement): boolean {
  const listing = listingOf(a);
  const sameParent = a.parent.catalogueNumber === b.parent.catalogueNumber && (a.parent.catalogueNumber !== null || a.parent.designator === b.parent.designator);
  return listing !== null && listing === listingOf(b) && sameParent && isTargetKind(a) && isTargetKind(b) && STATES_THE_DAY.has(a.event.precision) && STATES_THE_DAY.has(b.event.precision) && gapOf(a.event, b.event) > DAY_MS;
}

/**
 * A run of statements chained within a month, split where one listing
 * source states distinct instants: the two nearest parts (by the gap
 * between their windows, then between the windows' middles) are joined first,
 * then the next nearest, never two parts that hold distinct instants of one
 * source, nor parts further apart than `SAME_EVENT_DAYS`. Each statement so
 * joins the instant nearest it, whatever order the sources come in.
 */
function splitDistinct(group: Group, order: Map<Statement, number>): Group[] {
  const all = group.statements;
  if (!all.some((a, i) => all.slice(i + 1).some((b) => distinctInstants(a, b)))) return [group];
  const parts = all.map((s) => [s]);
  for (;;) {
    let best: { i: number; j: number; distance: [number, number] } | null = null;
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        if (parts[i]!.some((a) => parts[j]!.some((b) => distinctInstants(a, b)))) continue;
        const distance = distanceOf(parts[i]!, parts[j]!);
        if (distance[0] <= SAME_EVENT_DAYS * DAY_MS && (best === null || closer(distance, best.distance))) best = { i, j, distance };
      }
    }
    if (best === null) break;
    parts[best.i]!.push(...parts[best.j]!);
    parts.splice(best.j, 1);
  }
  const byOrder = (a: Statement, b: Statement): number => order.get(a)! - order.get(b)!;
  return parts.map((part) => part.sort(byOrder)).sort((a, b) => byOrder(a[0]!, b[0]!)).map((statements) => ({ statements, overrides: [...group.overrides] }));
}

/** The key statements are first grouped by: the parent's catalogue number, else its launch, else nothing (each unnamed row stands alone). */
function parentKey(statement: Statement, index: number): string {
  if (statement.parent.catalogueNumber !== null) return `N${statement.parent.catalogueNumber}`;
  if (statement.parent.designator !== null) return `D${statement.parent.designator.slice(0, 8)}`;
  return `U${index}`;
}

interface Group {
  statements: Statement[];
  overrides: string[];
}

/**
 * Statements grouped into events: by parent first, then by windows within
 * a month of each other, except that two instants one listing source
 * states more than a day apart are two events (`distinctInstants`), each
 * other statement joining the instant nearest it. Sources that disagree
 * within the month stay one event, their disagreement a conflict. An
 * override's `merge` pulls the named parents' statements between its days
 * into one group before the rule runs, and the rule does not split it.
 */
export function groupStatements(statements: Statement[], overrides: Override[]): Group[] {
  const groups: Group[] = [];
  const taken = new Set<number>();
  for (const override of overrides) {
    if (override.merge === undefined || override.between === undefined) continue;
    const [from, to] = override.between;
    const numbers = new Set(override.merge.map((m) => m.catalogueNumber));
    const members = statements.map((s, i) => [s, i] as const).filter(([s, i]) => !taken.has(i) && s.parent.catalogueNumber !== null && numbers.has(s.parent.catalogueNumber) && upper(s.event) >= Date.parse(from) && lower(s.event) <= Date.parse(to) + DAY_MS);
    if (members.length === 0) throw new Error(`override ${override.name} merges nothing`);
    for (const [, i] of members) taken.add(i);
    groups.push({ statements: members.map(([s]) => s), overrides: [override.name] });
  }
  const byParent = new Map<string, Group[]>();
  const launchOfGroup = (group: Group): string | null => group.statements.map((s) => s.parent.designator?.slice(0, 8) ?? null).find((l) => l !== null) ?? null;
  const numbered = (group: Group): boolean => group.statements.some((s) => s.parent.catalogueNumber !== null);
  statements.forEach((statement, index) => {
    if (taken.has(index)) return;
    const key = parentKey(statement, index);
    const candidates = byParent.get(key) ?? [];
    const home = candidates.find((group) => group.statements.some((other) => near(other.event, statement.event)));
    if (home !== undefined) home.statements.push(statement);
    else {
      const group = { statements: [statement], overrides: [] };
      candidates.push(group);
      groups.push(group);
      byParent.set(key, candidates);
    }
  });
  // A month's chain may hold two instants one listing source states apart: it is split at them.
  const order = new Map(statements.map((s, i) => [s, i] as const));
  const split = groups.flatMap((group) => (group.overrides.length > 0 ? [group] : splitDistinct(group, order)));
  groups.length = 0;
  groups.push(...split);
  // A statement that names the launch alone (the catalogue's pieces, GCAT's analyst parents) joins the event of a
  // numbered parent of that launch whose window is near; else, for the catalogue's bursts, a reported event of the
  // launch in the years before, whose cloud is still being catalogued.
  const kept: Group[] = [];
  const catalogueOnly = (group: Group): boolean => group.statements.every((s) => s.source === "catalogue");
  for (const group of groups) {
    const launch = launchOfGroup(group);
    if (launch === null || (numbered(group) && !catalogueOnly(group))) {
      kept.push(group);
      continue;
    }
    const sameLaunch = groups.filter((other) => other !== group && numbered(other) && !catalogueOnly(other) && launchOfGroup(other) === launch);
    const joinable = (other: Group): boolean => other.statements.some((s) => group.statements.some((g) => near(s.event, g.event))) && !other.statements.some((s) => group.statements.some((g) => distinctInstants(s, g)));
    const home = numbered(group) ? undefined : sameLaunch.filter(joinable).sort((a, b) => (closer(distanceOf(a.statements, group.statements), distanceOf(b.statements, group.statements)) ? -1 : closer(distanceOf(b.statements, group.statements), distanceOf(a.statements, group.statements)) ? 1 : 0))[0];
    if (home !== undefined) {
      home.statements.push(...group.statements);
      continue;
    }
    if (catalogueOnly(group)) {
      const start = lower(group.statements[0]!.event);
      const earlier = sameLaunch.filter((other) => other.statements.some((s) => !["catalogue"].includes(s.source) && upper(s.event) <= start && upper(s.event) >= start - LATE_BATCH_YEARS * 365.25 * DAY_MS)).sort((a, b) => upper(b.statements[0]!.event) - upper(a.statements[0]!.event));
      if (earlier[0] !== undefined) {
        earlier[0].statements.push(...group.statements);
        continue;
      }
    }
    kept.push(group);
  }
  return kept;
}

/**
 * The statement whose time is stated most finely, authorities before the
 * rest on a tie; an override names a source to win instead. The satellite
 * catalogue's statements are weighed only where the catalogue's bursts are
 * all the event has besides them.
 */
function pickEvent(group: Group, forced: SourceId | undefined): Statement {
  const forcedStatement = forced === undefined ? undefined : group.statements.find((s) => s.source === forced && !isSatcatStatement(s));
  if (forcedStatement !== undefined) return forcedStatement;
  const reported = group.statements.filter((s) => !isSatcatStatement(s));
  const pool = reported.some((s) => s.source !== "catalogue") ? reported : group.statements;
  return [...pool].sort((a, b) => PRECISION_RANK[a.event.precision] - PRECISION_RANK[b.event.precision] || rankOf(a) - rankOf(b))[0]!;
}

const bySource = (statements: Statement[]): Statement[] => [...statements].sort((a, b) => rankOf(a) - rankOf(b));

function pickKind(group: Group, forced: BreakupKind | undefined): { kind: BreakupKind; source: SourceId } {
  if (forced !== undefined) return { kind: forced, source: pickEvent(group, undefined).source };
  const stated = bySource(group.statements).find((s) => s.kind !== null);
  return stated === undefined ? { kind: "breakup", source: group.statements[0]!.source } : { kind: stated.kind!, source: stated.source };
}

function pickOrbit(group: Group): { orbit: StatedOrbit; source: SourceId | null } {
  const ordered = bySource(group.statements);
  const first = (field: keyof StatedOrbit): { value: number | null; source: SourceId | null } => {
    const found = ordered.find((s) => s.orbit[field] !== null);
    return found === undefined ? { value: null, source: null } : { value: found.orbit[field], source: found.source };
  };
  const altitude = first("altitudeKm");
  const apogee = first("apogeeKm");
  const perigee = first("perigeeKm");
  const inclination = first("inclinationDeg");
  return { orbit: { altitudeKm: altitude.value, apogeeKm: apogee.value, perigeeKm: perigee.value, inclinationDeg: inclination.value }, source: altitude.source ?? apogee.source ?? inclination.source ?? perigee.source };
}

function pickCause(group: Group): { cause: Cause; source: SourceId | null } {
  const stated = bySource(group.statements).find((s) => s.cause !== null);
  return stated === undefined ? { cause: "unknown", source: null } : { cause: stated.cause!, source: stated.source };
}

/**
 * The latest count an authority or GCAT's cloud table states; where none
 * did, the pieces the satellite catalogue's separations of the event
 * count together; the catalogue's own count of a burst only where no one
 * else counted.
 */
function pickPieces(group: Group): { pieces: number | null; source: SourceId | null } {
  const reported = group.statements.filter((s) => s.piecesCatalogued !== null && s.source !== "catalogue" && !isSatcatStatement(s));
  const separated = group.statements.filter((s) => s.piecesCatalogued !== null && isSatcatStatement(s));
  if (reported.length === 0 && separated.length > 0) return { pieces: separated.reduce((sum, s) => sum + s.piecesCatalogued!, 0), source: "gcat" };
  const counted = (reported.length > 0 ? reported : group.statements.filter((s) => s.piecesCatalogued !== null)).sort((a, b) => (b.piecesStatedOn ?? "").localeCompare(a.piecesStatedOn ?? "") || rankOf(a) - rankOf(b));
  return counted.length === 0 ? { pieces: null, source: null } : { pieces: counted[0]!.piecesCatalogued, source: counted[0]!.source };
}

/** The class of a parent from NASA's TYPE where a statement notes it, else from its name. */
function classOf(group: Group, name: string): Parent["class"] {
  const typed = group.statements.map((s) => /Type: ([^;]+);/.exec(s.note ?? "")?.[1]?.toLowerCase()).find((t) => t !== undefined && t !== "unknown");
  if (typed !== undefined) {
    if (typed.includes("payload")) return "payload";
    if (typed.includes("rocket") || typed.includes("stage") || typed.includes("motor")) return "rocket body";
    if (typed.includes("debris")) return "debris";
  }
  const n = name.toLowerCase();
  if (/\br\/b\b|rocket body|upper stage|third stage|second stage|centaur|ullage motor|transtage|fregat|briz|\bstage\b|tank/.test(n)) return "rocket body";
  if (/\bdeb\b|debris|fairing|adapter|cover|panel|cap\b|module/.test(n)) return "debris";
  if (/unnamed/.test(n)) return "unknown";
  return "payload";
}

function ownerOf(group: Group): string | null {
  return group.statements.map((s) => /owner: ([^;]+);/.exec(s.note ?? "")?.[1]).find((o) => o !== undefined && o !== "unknown") ?? null;
}

function launchedOnOf(group: Group): string | null {
  const stated = group.statements.map((s) => /launched (.+?)\.(?= [A-Z]|$)/.exec(s.note ?? "")?.[1]).find((l) => l !== undefined && l !== "unknown");
  if (stated === undefined) return null;
  const m = /^(?:(\d{1,2})(?:\.\d+)? )?([A-Za-z]+)\.? (\d{4})$/.exec(stated.trim());
  if (m === null) return null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const index = months.indexOf(m[2]!.slice(0, 3).toLowerCase());
  if (index === -1) return null;
  const month = String(index + 1).padStart(2, "0");
  return m[1] === undefined ? `${m[3]}-${month}` : `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
}

/** The parent as the best source names it: the number, the most specific designator, the authority's name. */
function pickParent(group: Group): Parent {
  const ordered = bySource(group.statements);
  const catalogueNumber = ordered.find((s) => s.parent.catalogueNumber !== null)?.parent.catalogueNumber ?? null;
  const designators = ordered.map((s) => s.parent.designator).filter((d): d is string => d !== null);
  const designator = designators.sort((a, b) => b.length - a.length || designators.indexOf(a) - designators.indexOf(b))[0] ?? null;
  const name = ordered.find((s) => s.parent.name !== null)?.parent.name ?? designator ?? "unnamed";
  return { catalogueNumber, designator, name, class: classOf(group, name), owner: ownerOf(group), launchedOn: launchedOnOf(group) };
}

const EARTH_RADIUS_KM = 6378.137;
const GEO_PERIOD_MINUTES = 1436.07;

/** The regime from the orbit at the event, by the semi-major axis and the eccentricity the apsides give. */
export function regimeOf(orbit: StatedOrbit): Regime {
  const apogee = orbit.apogeeKm ?? orbit.altitudeKm;
  const perigee = orbit.perigeeKm ?? orbit.altitudeKm;
  if (apogee === null || perigee === null) return "unknown";
  const a = (apogee + perigee) / 2 + EARTH_RADIUS_KM;
  const e = (apogee - perigee) / (apogee + perigee + 2 * EARTH_RADIUS_KM);
  const period = 2 * Math.PI * Math.sqrt(a ** 3 / 398_600.4418) / 60;
  if (Math.abs(period - GEO_PERIOD_MINUTES) < 60 && e < 0.1) return "GEO";
  if (e >= 0.25) return "HEO";
  if (apogee < 2000) return "LEO";
  return "MEO";
}

/** The precisions of GCAT's dates it is trusted at, C: a year or none is no finer than the catalogue's own burst, D. */
const GCAT_DATED: ReadonlySet<Precision> = new Set<Precision>(["second", "minute", "hour", "day", "month"]);

const MEASURED: ReadonlySet<Precision> = new Set<Precision>(["second", "minute"]);

/**
 * What one statement alone lets the event's time be trusted at: an
 * authority's minute A, its day or a window of three days at most B, any
 * coarser time it states C; a named analyst's dating C, and so a company's
 * measured instant a report quotes to the minute (s2a systems' optical
 * timing of Luch); GCAT's date to the month or finer C; anything else D.
 */
function gradeOf(statement: Statement): Confidence {
  const time = statement.event;
  if (AUTHORITIES.has(statement.source)) {
    if (MEASURED.has(time.precision)) return "A";
    if (time.from !== null && upper(time) - lower(time) <= 3 * DAY_MS) return "B";
    if (time.precision !== "none") return "C";
  }
  if (statement.source === "analyst" || (statement.source === "news" && MEASURED.has(time.precision)) || (statement.source === "gcat" && GCAT_DATED.has(time.precision))) return "C";
  return "D";
}

/** The confidence of an event: its best statement's grade, an authority's above the rest, whichever statement states the instant most finely. */
function confidenceOf(group: Group): Confidence {
  return group.statements.map(gradeOf).sort()[0]!;
}

/** Disagreements among a group's statements, with the sources that disagree. */
function conflictsOf(group: Group): Conflict[] {
  const conflicts: Conflict[] = [];
  const s = group.statements;
  const seen = new Set<string>();
  const add = (conflict: Conflict): void => {
    const key = `${conflict.field}:${conflict.detail}`;
    if (!seen.has(key)) {
      seen.add(key);
      conflicts.push(conflict);
    }
  };
  for (let i = 0; i < s.length; i++) {
    for (let j = i + 1; j < s.length; j++) {
      const [a, b] = [s[i]!, s[j]!];
      // Two separations the satellite catalogue dates apart within one event are two batches of its pieces, not two sources disagreeing.
      if (isSatcatStatement(a) && isSatcatStatement(b)) continue;
      const timed = a.source !== "catalogue" && b.source !== "catalogue";
      if (timed && a.event.at !== null && b.event.at !== null && Math.abs(Date.parse(a.event.at) - Date.parse(b.event.at)) > CONFLICT_MINUTES * 60_000) {
        add({ field: "event", sources: [a.source, b.source], detail: `${a.source} ${a.event.stated} against ${b.source} ${b.event.stated}` });
      } else if (timed && a.event.from !== null && b.event.from !== null && (upper(a.event) < lower(b.event) || upper(b.event) < lower(a.event))) {
        add({ field: "day", sources: [a.source, b.source], detail: `${a.source} ${a.event.stated} against ${b.source} ${b.event.stated}` });
      }
      if (a.parent.catalogueNumber !== null && b.parent.catalogueNumber !== null && a.parent.catalogueNumber !== b.parent.catalogueNumber) {
        add({ field: "parent", sources: [a.source, b.source], detail: `${a.source} names ${a.parent.catalogueNumber} (${a.parent.name ?? ""}), ${b.source} names ${b.parent.catalogueNumber} (${b.parent.name ?? ""})` });
      }
      // GCAT does not separate breakups from anomalous events, so its kind never conflicts with NASA's.
      if (a.kind !== null && b.kind !== null && a.kind !== b.kind && a.source !== "gcat" && b.source !== "gcat") {
        add({ field: "kind", sources: [a.source, b.source], detail: `${a.source} ${a.kind} against ${b.source} ${b.kind}` });
      }
      if (a.cause !== null && b.cause !== null && a.cause !== b.cause) {
        add({ field: "cause", sources: [a.source, b.source], detail: `${a.source} ${a.cause} against ${b.source} ${b.cause}` });
      }
    }
  }
  return conflicts;
}

/** The parent's launch day as a time, the first day of the month or year where the source states no finer; null where none is stated. */
function launchStartOf(parent: Parent): number | null {
  const launched = parent.launchedOn;
  if (launched === null) return null;
  const parsed = Date.parse(`${launched.length === 4 ? `${launched}-01-01` : launched.length === 7 ? `${launched}-01` : launched}T00:00Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

/** The window with its lower edge raised to the parent's launch day where a coarse date widened it to before the launch. */
function clampedToLaunch(time: StatedTime, parent: Parent): StatedTime {
  const launch = launchStartOf(parent);
  if (launch === null || time.from === null || Date.parse(time.from) >= launch) return time;
  return { ...time, from: `${new Date(launch).toISOString().slice(0, 10)}T00:00Z` };
}

/** Why a breakup or anomalous event of a catalogued parent is no target by the shape of its window: none below, or wider than `WIDE_WINDOW_DAYS`. */
function windowReasonOf(time: StatedTime): string | null {
  if (time.from === null) return "the window has no lower edge";
  return upper(time) - lower(time) > WIDE_WINDOW_DAYS * DAY_MS ? `the window is wider than ${WIDE_WINDOW_DAYS} days` : null;
}

function idOf(parent: Parent, time: StatedTime, unnamedIndex: number): string {
  const day = (time.at ?? time.from ?? time.to).slice(0, 10);
  if (parent.catalogueNumber !== null) return `${parent.catalogueNumber}:${day}`;
  if (parent.designator !== null) return `A:${parent.designator}:${day}`;
  return `U:${unnamedIndex}:${day}`;
}

/** The regime of the orbit the statements give, else of the parent's last set before the window as the file derived from the Archive holds it. */
function regimeAtEvent(orbit: StatedOrbit, parent: Parent, event: StatedTime, regimes: RegimesFile | null): Regime {
  const stated = regimeOf(orbit);
  if (stated !== "unknown" || parent.catalogueNumber === null || regimes === null) return stated;
  return regimeAt(regimes.parents[String(parent.catalogueNumber)], lower(event));
}

/** One group resolved into a Known Breakup. */
function resolve_(group: Group, overrides: Override[], unnamedIndex: number, regimes: RegimesFile | null): Breakup {
  const launch = group.statements.map((s) => s.parent.designator?.slice(0, 8)).find((l) => l !== undefined) ?? null;
  // An exempt launch's events that only the catalogues (its bursts, GCAT's satellite catalogue) state are exempt; a report's own event stays scoreable.
  for (const o of overrides) if (o.exemptLaunch !== undefined && o.exemptLaunch === launch && group.statements.every((s) => s.source === "catalogue" || isSatcatStatement(s)) && !group.overrides.includes(o.name)) group.overrides.push(o.name);
  const applied = overrides.filter((o) => group.overrides.includes(o.name));
  const forcedEvent = applied.find((o) => o.event !== undefined)?.event;
  const forcedKind = applied.find((o) => o.kind !== undefined)?.kind;
  const forcedFrom = applied.find((o) => o.from !== undefined)?.from;
  const eventStatement = pickEvent(group, forcedEvent);
  const { kind, source: kindSource } = pickKind(group, forcedKind);
  const { orbit, source: orbitSource } = pickOrbit(group);
  const { cause, source: causeSource } = pickCause(group);
  const { pieces, source: piecesSource } = pickPieces(group);
  const parent = pickParent(group);
  const event = clampedToLaunch(forcedFrom === undefined ? eventStatement.event : { ...eventStatement.event, from: forcedFrom }, parent);
  const exempt = applied.find((o) => o.exempt !== undefined)?.exempt ?? null;
  const kindResolved: BreakupKind = exempt !== null && applied.some((o) => o.exemptLaunch !== undefined) ? "release" : kind;
  const exemptReason = exempt ?? (kind === "aerodynamic" ? "an aerodynamic breakup at reentry" : kind === "release" ? "a release of objects, not a breakup" : kind === "unnamed" ? "the report names no object" : parent.catalogueNumber === null ? "the parent has no catalogue number" : windowReasonOf(event));
  const resolvedFrom: ResolvedFrom = { event: eventStatement.source, orbit: orbitSource, cause: causeSource, pieces: piecesSource, kind: kindSource };
  return {
    id: idOf(parent, event, unnamedIndex),
    parent,
    kind: kindResolved,
    event,
    orbit: { ...orbit, regime: regimeAtEvent(orbit, parent, event, regimes) },
    cause,
    piecesCatalogued: pieces,
    confidence: confidenceOf(group),
    scoreable: exemptReason === null,
    exemptReason,
    resolvedFrom,
    statements: bySource(group.statements),
    conflicts: conflictsOf(group),
    overrides: group.overrides,
    firstStatement: firstStatementOf(group.statements),
  };
}

export function buildTruth(): { file: BreakupsFile; groups: Group[]; statements: Statement[]; skipped: Skipped } {
  const statements = allStatements();
  const overrides = parseJson<{ overrides: Override[] }>("data/truth/overrides.json").overrides;
  const groups = groupStatements(statements, overrides);
  const regimes = readRegimes(ROOT);
  let unnamed = 0;
  const breakups = groups.map((group) => resolve_(group, overrides, group.statements[0]!.parent.catalogueNumber === null && group.statements[0]!.parent.designator === null ? ++unnamed : 0, regimes));
  breakups.sort((a, b) => lower(a.event) - lower(b.event) || upper(a.event) - upper(b.event) || a.id.localeCompare(b.id));
  const ids = new Map<string, number>();
  for (const breakup of breakups) {
    const n = (ids.get(breakup.id) ?? 0) + 1;
    ids.set(breakup.id, n);
    if (n > 1) throw new Error(`two events share the id ${breakup.id}: ${breakup.parent.name}; separate or merge them with an override`);
  }
  for (const override of overrides) if (!breakups.some((b) => b.overrides.includes(override.name))) throw new Error(`override ${override.name} applied to nothing`);
  return { file: { format: 1, sources: sourcesOf(), breakups }, groups, statements, skipped: satcatSkipped() };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { file, statements, skipped } = buildTruth();
  const json = `${JSON.stringify(file, null, 1)}\n`;
  writeFileSync(resolve(ROOT, "data/breakups.json"), json);
  writeFileSync(resolve(ROOT, "docs/truth.md"), renderReport(file, statements, skipped));
  const sha = createHash("sha256").update(json).digest("hex").slice(0, 12);
  console.log(`data/breakups.json: ${file.breakups.length} events from ${statements.length} statements (sha256 ${sha}…); docs/truth.md written`);
}
