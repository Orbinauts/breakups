import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DETECTOR_PARAMETERS, isFragmentClass, launchOf, planeDistance, readBreakups, regimeOf, speedAt, yearOf, type PlaneOrbit, type Regime } from "../../src/index.ts";
import type { StatedTime } from "../../src/truth.ts";
import { archiveHome, catalogueIndexPath } from "../archive/archive.ts";
import { parseVagueDate } from "../truth/dates.ts";
import { SAME_SEPARATION_DAYS, parseSatcat, type SatcatRow } from "../truth/parse-gcat-satcat.ts";
import { FRAGMENTS_DAYS, fragmentsOf, type Catalogue } from "./catalogue.ts";
import { catalogueFromIndex, readCatalogueIndex, stalenessOf } from "./catalogue-index.ts";
import { lowerOf, marginDaysOf } from "./match.ts";
import { splitOf } from "./rank.ts";
import { ANALYST_FLOOR, DAY_MS } from "./replay.ts";

/**
 * A measurement of the plane test on the pieces of highly elliptical
 * orbits, and nothing else: it changes no score and no detector. For
 * every scoreable event of the truth from 2006 with a
 * catalogued parent, it reads the fresh pieces under the parent's launch
 * as the scorecard counts them (`fragmentsOf`, the plane test aside) from
 * the Archive's catalogue index, read-only, and asks of each: does
 * today's plane test keep it, how far is its orbit normal from the
 * parent's, what normal speed change at the parent's apogee that angle
 * needs, and whose piece GCAT's satellite catalogue says it is (the
 * committed snapshot under `data/truth/sources/`). It then counts what
 * each bound keeps, by regime (the parent's, from its last set before the
 * event) and by split, with the fresh pieces of every other launch in the
 * same window that each bound would admit by chance.
 *
 *   BREAKUPS_ARCHIVE=<archive> node --experimental-strip-types scripts/kpi/heo-pieces.ts [--json <path>] > report.md
 *
 * The report goes to the standard output; `--json` also writes every
 * event read with its pieces (an infinite impulse written as null).
 *
 * Its findings are written up in `docs/detector/heo-pieces.md`.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEG = Math.PI / 180;

/**
 * The angle between a parent's orbit normal and a piece's, in degrees:
 * the parent's node carried to the piece's epoch as the plane test carries
 * it (at the parent's own J2 rate, the rates' difference since the event
 * taken off), so it holds at near-zero inclination, where the node means
 * nothing, as well as at high inclination.
 */
export function normalAngleDeg(parent: PlaneOrbit, piece: PlaneOrbit, eventMs: number): number {
  const { deltaNodeDeg } = planeDistance(parent, piece, eventMs, DETECTOR_PARAMETERS, Number.POSITIVE_INFINITY);
  const i1 = parent.inclinationDeg * DEG;
  const i2 = piece.inclinationDeg * DEG;
  const cos = Math.cos(i1) * Math.cos(i2) + Math.sin(i1) * Math.sin(i2) * Math.cos(deltaNodeDeg * DEG);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / DEG;
}

/** The parent's speed at apogee, its slowest point, in kilometres a second. */
const apogeeSpeedKmps = (orbit: PlaneOrbit): number => speedAt(orbit.aKm, orbit.aKm * (1 + orbit.eccentricity));

/**
 * The tilt of the orbit plane, in degrees, that a speed change of
 * `deltaVMps` normal to the plane gives at the parent's apogee: the most a
 * piece thrown off at that speed can lean from the parent's plane, since
 * the same impulse anywhere else on the orbit, where it moves faster,
 * tilts it less.
 */
export function impulseTiltDeg(parent: PlaneOrbit, deltaVMps: number): number {
  return Math.atan(deltaVMps / 1000 / apogeeSpeedKmps(parent)) / DEG;
}

/** The normal speed change at the parent's apogee, in metres a second, that tilts its plane by `angleDeg`: the impulse a piece at that angle needs at the least. Infinite from a right angle on, which no normal impulse reaches. */
export function normalDeltaVMps(parent: PlaneOrbit, angleDeg: number): number {
  if (Math.abs(angleDeg) >= 90) return Number.POSITIVE_INFINITY;
  return apogeeSpeedKmps(parent) * Math.tan(Math.abs(angleDeg) * DEG) * 1000;
}

/** What GCAT's satellite catalogue says a piece came from: its parent's catalogue number and the window of its separation date, null where it states neither. */
export interface GcatPiece {
  parent: number | null;
  from: number | null;
  to: number | null;
}

/** Every piece (a row typed as a component or fragmentation debris) of GCAT's satellite catalogue by its catalogue number: its parent where that is an object of the standard catalogue, and its separation date's window where stated. */
export function gcatPiecesOf(rows: readonly SatcatRow[]): Map<number, GcatPiece> {
  const pieces = new Map<number, GcatPiece>();
  for (const row of rows) {
    if (!(row.type.startsWith("C") || row.type.startsWith("D")) || !/^\d+$/.test(row.satcat)) continue;
    const parent = /^S(\d+)/.exec(row.parent);
    let window: StatedTime | null = null;
    try {
      window = row.sdate === "-" || row.sdate === "" ? null : parseVagueDate(row.sdate);
    } catch {
      window = null;
    }
    pieces.set(Number(row.satcat), { parent: parent === null ? null : Number(parent[1]), from: window === null ? null : Date.parse(window.from ?? window.to), to: window === null ? null : Date.parse(window.to) });
  }
  return pieces;
}

/** Whose piece the catalogue says a fresh piece is: the event's, its parent's at another separation, another body's, or nobody's said. */
export type Attribution = "event" | "parent, other separation" | "other body" | "unattributed";

/** Whose piece GCAT says a piece is, against an event: the event's where it names the event's parent and a separation date within `SAME_SEPARATION_DAYS` of the event's window. */
export function attributionOf(piece: GcatPiece | undefined, event: { parent: number; from: number; to: number }): Attribution {
  if (piece === undefined || piece.parent === null) return "unattributed";
  if (piece.parent !== event.parent) return "other body";
  if (piece.from === null || piece.to === null) return "parent, other separation";
  const slack = SAME_SEPARATION_DAYS * DAY_MS;
  return piece.from <= event.to + slack && piece.to >= event.from - slack ? "event" : "parent, other separation";
}

/** An event as the scorecard reads its pieces: its parent and launch, its window, its instant (the stated one, else the window's start) and its regime's margin. */
export interface EventInput {
  id: string;
  name: string;
  parent: number;
  launch: string;
  from: number;
  to: number;
  eventMs: number;
  marginMs: number;
}

/** One fresh piece against the event's parent. */
export interface PieceReading {
  number: number;
  /** Days from the event to the piece's earliest set. */
  daysAfterEvent: number;
  deltaInclinationDeg: number;
  deltaNodeDeg: number;
  normalAngleDeg: number;
  /** Whether the plane test the scorecard and the detector use today keeps it. */
  passesToday: boolean;
  /** The normal speed change at the parent's apogee its normal angle needs. */
  neededDeltaVMps: number;
  /** The normal speed change at the parent's apogee its inclination difference alone needs: the node, which J2 carries and a decaying piece's late set carries badly, left out. */
  inclinationDeltaVMps: number;
  attribution: Attribution;
  gcatParent: number | null;
}

/** An event's fresh pieces under its launch, and the fresh pieces of every other launch in the same window (the strangers a bound might admit by chance). */
export interface EventReading extends EventInput {
  parentOrbit: PlaneOrbit;
  regime: Regime;
  apogeeSpeedKmps: number;
  pieces: PieceReading[];
  strangers: PieceReading[];
}

/**
 * An event's fresh pieces, chosen as the scorecard's `fragmentsOf`
 * chooses them, the plane test aside: bodies numbered above the
 * catalogue's mark the margin before the window (never below the parent)
 * and below the analyst range, classed as a fragment is, first published
 * from the margin before the window to `FRAGMENTS_DAYS` after it, whose
 * earliest set is no more than a day before the window. Those under the
 * event's launch are its pieces; those under any other launch are
 * strangers. Null where the parent had no set before the window.
 */
export function readEvent(catalogue: Catalogue, event: EventInput, gcat: ReadonlyMap<number, GcatPiece>): EventReading | null {
  const before = catalogue.orbitBefore(event.parent, event.from);
  if (before === null) return null;
  const parentOrbit = before.orbit;
  const mark = Math.max(catalogue.markAt(event.from - event.marginMs), event.parent);
  const pieces: PieceReading[] = [];
  const strangers: PieceReading[] = [];
  for (const body of catalogue.bodies.values()) {
    if (body.number <= mark || body.number >= ANALYST_FLOOR || !isFragmentClass(body.bodyClass)) continue;
    if (body.firstClock < event.from - event.marginMs || body.firstClock > event.to + FRAGMENTS_DAYS * DAY_MS || body.firstEpoch < event.from - DAY_MS) continue;
    const plane = planeDistance(parentOrbit, body.orbit, event.eventMs, DETECTOR_PARAMETERS, Number.POSITIVE_INFINITY);
    const angle = normalAngleDeg(parentOrbit, body.orbit, event.eventMs);
    const said = gcat.get(body.number);
    const reading: PieceReading = {
      number: body.number,
      daysAfterEvent: (body.firstEpoch - event.eventMs) / DAY_MS,
      deltaInclinationDeg: plane.deltaInclinationDeg,
      deltaNodeDeg: plane.deltaNodeDeg,
      normalAngleDeg: angle,
      passesToday: plane.distance <= DETECTOR_PARAMETERS.planeDistanceMax,
      neededDeltaVMps: normalDeltaVMps(parentOrbit, angle),
      inclinationDeltaVMps: normalDeltaVMps(parentOrbit, plane.deltaInclinationDeg),
      attribution: attributionOf(said, event),
      gcatParent: said?.parent ?? null,
    };
    (body.launch === event.launch ? pieces : strangers).push(reading);
  }
  pieces.sort((a, b) => a.number - b.number);
  strangers.sort((a, b) => a.number - b.number);
  return { ...event, parentOrbit, regime: regimeOf(parentOrbit), apogeeSpeedKmps: apogeeSpeedKmps(parentOrbit), pieces, strangers };
}

/** A bound on a piece's plane against its parent's: whether it keeps the piece. */
export interface Bound {
  name: string;
  keeps(piece: PieceReading): boolean;
}

/**
 * The bounds measured: today's plane test, the normal angle alone at half
 * a degree and one, the union of today's and the normal angle within
 * one degree; then, for each speed given, the normal angle an impulse of
 * that speed at the parent's apogee reaches, that bound or today's, that
 * bound or that union, and the inclination difference alone within the same
 * reach.
 */
export function boundsOf(deltaVsMps: readonly number[]): Bound[] {
  return [
    { name: "today's test", keeps: (p) => p.passesToday },
    { name: "normal within 0.5°", keeps: (p) => p.normalAngleDeg <= 0.5 },
    { name: "normal within 1°", keeps: (p) => p.normalAngleDeg <= 1 },
    { name: "today's or normal within 1°", keeps: (p) => p.passesToday || p.normalAngleDeg <= 1 },
    ...deltaVsMps.map((v) => ({ name: `impulse ${v} m/s`, keeps: (p: PieceReading) => p.neededDeltaVMps <= v })),
    ...deltaVsMps.map((v) => ({ name: `today's or impulse ${v} m/s`, keeps: (p: PieceReading) => p.passesToday || p.neededDeltaVMps <= v })),
    ...deltaVsMps.map((v) => ({ name: `today's or normal within 1° or impulse ${v} m/s`, keeps: (p: PieceReading) => p.passesToday || p.normalAngleDeg <= 1 || p.neededDeltaVMps <= v })),
    ...deltaVsMps.map((v) => ({ name: `inclination alone, impulse ${v} m/s`, keeps: (p: PieceReading) => p.inclinationDeltaVMps <= v })),
  ];
}

/** What a bound keeps over some events: their pieces by whose the catalogue says they are, the strangers it admits, and the events it keeps any piece of. */
export type Tally = Record<Attribution | "all" | "strangers" | "eventsWithAny", number>;

export function tally(readings: readonly EventReading[], bound: Bound): Tally {
  const count: Tally = { all: 0, event: 0, "parent, other separation": 0, "other body": 0, unattributed: 0, strangers: 0, eventsWithAny: 0 };
  for (const reading of readings) {
    const kept = reading.pieces.filter((p) => bound.keeps(p));
    count.all += kept.length;
    for (const piece of kept) count[piece.attribution]++;
    count.strangers += reading.strangers.filter((p) => bound.keeps(p)).length;
    if (kept.length > 0) count.eventsWithAny++;
  }
  return count;
}

/** The impulses measured, in metres a second. */
export const DELTA_VS_MPS = [10, 25, 50, 100, 150, 200, 300] as const;

/** An event read, with what the truth says of it. */
interface Measured extends EventReading {
  split: string;
  truthRegime: Regime;
  confidence: string;
  kind: string;
}

const quantile = (values: readonly number[], q: number): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
};
const fixed = (x: number, digits = 1): string => (Number.isFinite(x) ? x.toFixed(digits) : "–");

function regimeTable(measured: readonly Measured[], bounds: readonly Bound[]): string[] {
  const all = tally(measured, { name: "all", keeps: () => true });
  const lines = [
    `Events read: ${measured.length}; with any fresh piece under the launch: ${all.eventsWithAny}. Fresh pieces: ${all.all} (the event's by GCAT ${all.event}, the parent's at another separation ${all["parent, other separation"]}, another body's ${all["other body"]}, unattributed ${all.unattributed}); fresh pieces of other launches in the same windows: ${all.strangers}.`,
    "",
    "| Bound | Events kept any piece | Pieces kept | The event's | Parent, other separation | Another body's | Unattributed | Strangers admitted |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const bound of bounds) {
    const t = tally(measured, bound);
    lines.push(`| ${bound.name} | ${t.eventsWithAny} | ${t.all} | ${t.event} | ${t["parent, other separation"]} | ${t["other body"]} | ${t.unattributed} | ${t.strangers} |`);
  }
  return lines;
}

function eventTable(measured: readonly Measured[]): string[] {
  const lines = [
    "| Event | Parent | i (°) | Apogee speed (km/s) | Fresh | Today | Normal ≤ 1° | 50 m/s | 100 m/s | 200 m/s | Inclination alone, 100 m/s | Event's / parent other / other body / unattributed | Event's pieces: median and largest normal angle (°), needed Δv (m/s) | Median days to first set |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const m of measured) {
    if (m.pieces.length === 0) continue;
    const count = (keeps: (p: PieceReading) => boolean): number => m.pieces.filter(keeps).length;
    const own = m.pieces.filter((p) => p.attribution === "event");
    const angles = own.map((p) => p.normalAngleDeg);
    const needed = own.map((p) => p.neededDeltaVMps);
    lines.push(
      `| ${m.id} ${m.name} | ${m.parent} (${m.launch}) | ${fixed(m.parentOrbit.inclinationDeg, 2)} | ${fixed(m.apogeeSpeedKmps, 2)} | ${m.pieces.length} | ${count((p) => p.passesToday)} | ${count((p) => p.normalAngleDeg <= 1)} | ${count((p) => p.neededDeltaVMps <= 50)} | ${count((p) => p.neededDeltaVMps <= 100)} | ${count((p) => p.neededDeltaVMps <= 200)} | ${count((p) => p.inclinationDeltaVMps <= 100)} | ${own.length} / ${count((p) => p.attribution === "parent, other separation")} / ${count((p) => p.attribution === "other body")} / ${count((p) => p.attribution === "unattributed")} | ${own.length === 0 ? "–" : `${fixed(quantile(angles, 0.5), 2)}, ${fixed(Math.max(...angles), 2)}; ${fixed(quantile(needed, 0.5), 0)}, ${fixed(Math.max(...needed), 0)}`} | ${fixed(quantile(m.pieces.map((p) => p.daysAfterEvent), 0.5), 0)} |`,
    );
  }
  return lines;
}

/** The event's own pieces' needed impulse, by how long after the event their first set came: a spread that grows with the days is drift after the event, not the event's impulse. */
function driftTable(measured: readonly Measured[]): string[] {
  const own = measured.flatMap((m) => m.pieces.filter((p) => p.attribution === "event"));
  const bands: [string, (d: number) => boolean][] = [
    ["within 7 days", (d) => d <= 7],
    ["8 to 30 days", (d) => d > 7 && d <= 30],
    ["31 to 90 days", (d) => d > 30 && d <= 90],
    ["over 90 days", (d) => d > 90],
  ];
  const lines = ["| First set after the event | Pieces | Normal angle: median, 90th percentile (°) | \\|Δi\\|: median, 90th percentile (°) | Needed Δv: median, 75th, 90th percentile (m/s) | Inclination alone: needed Δv, median, 75th, 90th percentile (m/s) |", "| --- | --- | --- | --- | --- | --- |"];
  for (const [name, within] of bands) {
    const pieces = own.filter((p) => within(p.daysAfterEvent));
    const angles = pieces.map((p) => p.normalAngleDeg);
    const needed = pieces.map((p) => p.neededDeltaVMps);
    const di = pieces.map((p) => Math.abs(p.deltaInclinationDeg));
    const inclination = pieces.map((p) => p.inclinationDeltaVMps);
    lines.push(`| ${name} | ${pieces.length} | ${fixed(quantile(angles, 0.5), 2)}, ${fixed(quantile(angles, 0.9), 2)} | ${fixed(quantile(di, 0.5), 2)}, ${fixed(quantile(di, 0.9), 2)} | ${fixed(quantile(needed, 0.5), 0)}, ${fixed(quantile(needed, 0.75), 0)}, ${fixed(quantile(needed, 0.9), 0)} | ${fixed(quantile(inclination, 0.5), 0)}, ${fixed(quantile(inclination, 0.75), 0)}, ${fixed(quantile(inclination, 0.9), 0)} |`);
  }
  return lines;
}

function main(): void {
  const args = process.argv.slice(2);
  const jsonAt = args.indexOf("--json");
  const archive = archiveHome();
  const index = readCatalogueIndex(catalogueIndexPath(archive));
  const stale = stalenessOf(archive, index);
  const catalogue = catalogueFromIndex(index);
  const breakups = readBreakups(JSON.parse(readFileSync(resolve(ROOT, "data/breakups.json"), "utf8")));
  const gcat = gcatPiecesOf(parseSatcat(readFileSync(resolve(ROOT, "data/truth/sources/gcat-satcat.tsv"), "utf8")).rows);
  const measured: Measured[] = [];
  const skipped = { noLaunch: 0, notInIndex: 0, noParentOrbit: 0 };
  for (const breakup of breakups) {
    const parent = breakup.parent.catalogueNumber;
    const split = splitOf(yearOf(breakup));
    if (!breakup.scoreable || parent === null || split === "warm-up") continue;
    const launch = launchOf(breakup.parent.designator) ?? catalogue.bodies.get(parent)?.launch ?? null;
    if (launch === null) {
      skipped.noLaunch++;
      continue;
    }
    const from = lowerOf(breakup);
    const to = Date.parse(breakup.event.to);
    const eventMs = breakup.event.at === null ? from : Date.parse(breakup.event.at);
    const marginMs = marginDaysOf(breakup.orbit.regime) * DAY_MS;
    let reading: EventReading | null;
    try {
      reading = readEvent(catalogue, { id: breakup.id, name: breakup.parent.name, parent, launch, from, to, eventMs, marginMs }, gcat);
    } catch {
      skipped.notInIndex++;
      continue;
    }
    if (reading === null) {
      skipped.noParentOrbit++;
      continue;
    }
    // The pieces are the scorecard's: today's test keeps exactly what its count keeps.
    const today = reading.pieces.filter((p) => p.passesToday).length;
    const scorecard = fragmentsOf(catalogue, parent, launch, from, to, eventMs, marginMs, DETECTOR_PARAMETERS).inPlane;
    if (today !== scorecard) throw new Error(`${breakup.id}: today's test keeps ${today} pieces here and ${scorecard} in the scorecard's count`);
    measured.push({ ...reading, split, truthRegime: breakup.orbit.regime, confidence: breakup.confidence, kind: breakup.kind });
  }
  const bounds = boundsOf(DELTA_VS_MPS);
  const out: string[] = [
    `Read ${measured.length} scoreable events from 2006 with a catalogued parent from the catalogue index built ${index.builtAt}${stale.length > 0 ? ` (stale against the Archive: ${stale.join("; ")})` : ""}; skipped ${skipped.noLaunch} with no launch, ${skipped.notInIndex} the index holds no parent instant for, ${skipped.noParentOrbit} with no parent set before the event. GCAT's satellite catalogue: ${gcat.size} pieces.`,
    "",
  ];
  for (const regime of ["HEO", "LEO", "GEO", "MEO"] as const) {
    for (const split of ["train", "validation", "both"] as const) {
      const rows = measured.filter((m) => m.regime === regime && (split === "both" || m.split === split));
      out.push(`## ${regime}, ${split === "both" ? "every year from 2006" : split === "train" ? "training years (even)" : "held-out years (odd)"}`, "", ...regimeTable(rows, bounds), "");
    }
  }
  const heo = measured.filter((m) => m.regime === "HEO");
  out.push("## HEO events", "", ...eventTable(heo), "", "## HEO: the event's own pieces by the days to their first set", "", ...driftTable(heo), "");
  out.push("## GEO events", "", ...eventTable(measured.filter((m) => m.regime === "GEO")), "");
  // The events today's test keeps no piece of, which a wider bound would make targets.
  const widened = boundsOf([100]).filter((b) => b.name === "today's or normal within 1°" || b.name === "today's or normal within 1° or impulse 100 m/s");
  out.push("## Events today's test keeps no piece of", "", "| Event | Regime | Split | Confidence | Kind | Fresh pieces | Today's or normal within 1° keeps | That or 100 m/s keeps | Whose (event's / parent other / other body / unattributed) |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const m of measured) {
    if (m.pieces.length === 0 || m.pieces.some((p) => p.passesToday)) continue;
    const kept = widened.map((b) => m.pieces.filter((p) => b.keeps(p)).length);
    if (kept.every((n) => n === 0)) continue;
    const whose = (a: Attribution): number => m.pieces.filter((p) => widened[1]!.keeps(p) && p.attribution === a).length;
    out.push(`| ${m.id} ${m.name} | ${m.regime} | ${m.split} | ${m.confidence} | ${m.kind} | ${m.pieces.length} | ${kept[0]} | ${kept[1]} | ${whose("event")} / ${whose("parent, other separation")} / ${whose("other body")} / ${whose("unattributed")} |`);
  }
  out.push("");
  process.stdout.write(`${out.join("\n")}\n`);
  if (jsonAt !== -1) writeFileSync(args[jsonAt + 1]!, `${JSON.stringify(measured, null, 1)}\n`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("kpi/heo-pieces.ts")) main();
