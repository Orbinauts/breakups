import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { regimeOf } from "../../src/elements.ts";
import { isFragmentClass, normalAngleDeg, planeDistance, type PlaneOrbit } from "../../src/fragments.ts";
import { speedAt } from "../../src/impulse.ts";
import { nodePrecessionDegPerDay } from "../../src/series.ts";
import { wrapDegrees } from "../../src/units.ts";
import { DETECTOR_PARAMETERS, launchOf, readBreakups, yearOf, type Regime } from "../../src/index.ts";
import type { StatedTime } from "../../src/truth.ts";
import { archiveHome, catalogueIndexPath } from "../archive/archive.ts";
import { parseVagueDate } from "../truth/dates.ts";
import { SAME_SEPARATION_DAYS, parseSatcat, type SatcatRow } from "../truth/parse-gcat-satcat.ts";
import { FRAGMENTS_DAYS, FRAGMENTS_PLANE, fragmentsOf, type Catalogue } from "./catalogue.ts";
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
 * same window that each bound would admit by chance. For issue #42 it
 * also reads each piece with the nodes carried to the event's instant at
 * each body's own rate, and with drag's effect on the piece's rate
 * bounded, and looks for the twin event whose plane keeps a piece its own
 * event's drops.
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

/** An orbit's node rate under J2, in degrees a day, from its own a, e, i and mean motion. */
const nodeRateOf = (orbit: PlaneOrbit): number => nodePrecessionDegPerDay(orbit.aKm, orbit.eccentricity, orbit.inclinationDeg, orbit.meanMotion);

/** The parent's node at the event's instant: its last set's node carried there at its own J2 rate. */
const parentNodeAtEventDeg = (parent: PlaneOrbit, eventMs: number): number => parent.raanDeg + (nodeRateOf(parent) * (eventMs - parent.epochMs)) / DAY_MS;

/**
 * The node difference at the event's instant, the carry issue #42 asked
 * to measure: the piece's node carried back from its first set to the
 * event at its own J2 rate (from that set's a, e and i), less the
 * parent's carried forward to the event at the parent's. Both bodies were
 * on one plane at the event, so a piece of the event reads zero here
 * wherever J2 alone moved the nodes since.
 */
export function nodeAtEventDifferenceDeg(parent: PlaneOrbit, piece: PlaneOrbit, eventMs: number): number {
  const pieceNodeAtEvent = piece.raanDeg - (nodeRateOf(piece) * (piece.epochMs - eventMs)) / DAY_MS;
  return wrapDegrees(pieceNodeAtEvent - parentNodeAtEventDeg(parent, eventMs));
}

/**
 * The node difference at the event's instant with drag's effect on the
 * piece's rate bounded. Drag lowers a piece's orbit after the event, and
 * its J2 rate changes with it, so the rate its first set gives is the
 * rate at the end of the interval, not over it. A piece thrown off at a
 * modest speed started on about the parent's orbit, so its mean rate over
 * the interval lies between the parent's rate and its own: carried back at
 * its own (`ownRateDeg`, `nodeAtEventDifferenceDeg`) and at the parent's
 * (`parentRateDeg`) are the band's ends, and `leastDeg` is the smallest
 * node difference any rate between them gives, zero where the band
 * straddles it.
 */
export function dragBandOf(parent: PlaneOrbit, piece: PlaneOrbit, eventMs: number): { ownRateDeg: number; parentRateDeg: number; leastDeg: number } {
  const ownRateDeg = nodeAtEventDifferenceDeg(parent, piece, eventMs);
  const parentRateDeg = ownRateDeg + ((nodeRateOf(piece) - nodeRateOf(parent)) * (piece.epochMs - eventMs)) / DAY_MS;
  const [low, high] = ownRateDeg <= parentRateDeg ? [ownRateDeg, parentRateDeg] : [parentRateDeg, ownRateDeg];
  const leastDeg = low <= 0 && high >= 0 ? 0 : Math.abs(low) < Math.abs(high) ? low : high;
  return { ownRateDeg, parentRateDeg, leastDeg };
}

/** Whether the scorecard's own plane test (`FRAGMENTS_PLANE`: the tolerances, or the normals within its angle) keeps a piece whose node lies `deltaNodeDeg` from the parent's at the event's instant: both planes are set at that instant, so nothing is carried. */
export function scorecardKeepsAtNode(parent: PlaneOrbit, piece: PlaneOrbit, deltaNodeDeg: number): boolean {
  const atEvent = (orbit: PlaneOrbit, raanDeg: number): PlaneOrbit => ({ ...orbit, epochMs: 0, raanDeg });
  const [p, q] = [atEvent(parent, 0), atEvent(piece, deltaNodeDeg)];
  return planeDistance(p, q, 0, FRAGMENTS_PLANE).distance <= FRAGMENTS_PLANE.planeDistanceMax || normalAngleDeg(p, q, 0) <= FRAGMENTS_PLANE.planeNormalAngleMaxDeg;
}

/** An event as a twin is looked for among: its id, launch, parent's last set before it and instant. */
export interface TwinCandidate {
  id: string;
  launch: string;
  parentOrbit: PlaneOrbit;
  eventMs: number;
}

/**
 * The other event of the same launch whose parent's plane the scorecard's
 * test keeps a piece in, the node at that event's instant, where the
 * piece's first set came no earlier than a day before that event; null
 * where none does. A piece its own event's plane drops but a twin's keeps
 * is the twin's, whatever the catalogue's attribution says, unless the
 * twins still share a plane.
 */
export function twinEventOf(piece: PlaneOrbit, own: TwinCandidate, events: readonly TwinCandidate[]): string | null {
  for (const other of events) {
    if (other.id === own.id || other.launch !== own.launch || piece.epochMs < other.eventMs - DAY_MS) continue;
    if (scorecardKeepsAtNode(other.parentOrbit, piece, nodeAtEventDifferenceDeg(other.parentOrbit, piece, other.eventMs))) return other.id;
  }
  return null;
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
  /** The node difference at the event's instant, each node carried there at its own J2 rate (issue #42): the same as `deltaNodeDeg`, by algebra. */
  deltaNodeAtEventDeg: number;
  /** Whether the scorecard's test (`FRAGMENTS_PLANE`) keeps it with the node difference at the event's instant. */
  passesAtEvent: boolean;
  /** Whether the scorecard's test keeps it with the least node difference drag's band allows (`dragBandOf`). */
  passesDragBand: boolean;
  /** The same, the band read only where the piece's first set sits below the parent's semi-major axis, as drag leaves it; else at its own rate. */
  passesDragBandBelow: boolean;
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
    const band = dragBandOf(parentOrbit, body.orbit, event.eventMs);
    const passesDragBand = scorecardKeepsAtNode(parentOrbit, body.orbit, band.leastDeg);
    const passesAtEvent = scorecardKeepsAtNode(parentOrbit, body.orbit, band.ownRateDeg);
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
      deltaNodeAtEventDeg: band.ownRateDeg,
      passesAtEvent,
      passesDragBand,
      passesDragBandBelow: body.orbit.aKm < parentOrbit.aKm ? passesDragBand : passesAtEvent,
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

/**
 * The carries issue #42 measured, each under the scorecard's own test
 * (`FRAGMENTS_PLANE`): today's, the nodes at the event's instant (each at
 * its own J2 rate), and drag's band, read for every piece or only where
 * the piece's first set sits below the parent.
 */
export function carryBoundsOf(): Bound[] {
  return [
    { name: "the scorecard's test (#15's form)", keeps: (p) => p.passesToday || p.normalAngleDeg <= FRAGMENTS_PLANE.planeNormalAngleMaxDeg },
    { name: "the scorecard's test, nodes at the event's instant", keeps: (p) => p.passesAtEvent },
    { name: "the scorecard's test, drag bounded", keeps: (p) => p.passesDragBand },
    { name: "the scorecard's test, drag bounded below the parent", keeps: (p) => p.passesDragBandBelow },
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

/**
 * Issue #42's measurement: the scorecard's test under each carry, by
 * regime and split; how far the carry at the event's instant is from
 * today's; and, of the event's pieces the scorecard's test drops, those a
 * twin event's plane keeps.
 */
function carrySection(measured: readonly Measured[], catalogue: Catalogue): string[] {
  const lines = ["## Issue #42: the nodes carried to the event's instant, and drag bounded", ""];
  const all = measured.flatMap((m) => [...m.pieces, ...m.strangers]);
  const largest = all.reduce((most, p) => Math.max(most, Math.abs(wrapDegrees(p.deltaNodeAtEventDeg - p.deltaNodeDeg))), 0);
  const scorecard = carryBoundsOf()[0]!;
  const differ = all.filter((p) => p.passesAtEvent !== scorecard.keeps(p)).length;
  lines.push(`Over ${all.length} pieces and strangers, the node difference at the event's instant is today's within ${largest.toExponential(1)}°, and the scorecard's test keeps a different piece under it ${differ} times.`, "");
  lines.push("| Regime | Split | Carry | Pieces kept | The event's | Parent, other separation | Another body's | Strangers admitted |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const regime of ["HEO", "LEO", "GEO", "MEO"] as const) {
    for (const split of ["train", "validation"] as const) {
      const rows = measured.filter((m) => m.regime === regime && m.split === split);
      const whole = tally(rows, { name: "all", keeps: () => true });
      for (const bound of carryBoundsOf()) {
        const t = tally(rows, bound);
        lines.push(`| ${regime} | ${split === "train" ? "training" : "held-out"} | ${bound.name} | ${t.all} of ${whole.all} | ${t.event} of ${whole.event} | ${t["parent, other separation"]} | ${t["other body"]} | ${t.strangers} of ${whole.strangers} |`);
      }
    }
  }
  lines.push("", "### The event's pieces the scorecard's test drops, and a twin's plane", "", "| Regime | Split | Dropped | A twin event's plane keeps |", "| --- | --- | --- | --- |");
  const twins: string[] = [];
  for (const regime of ["HEO", "LEO", "GEO", "MEO"] as const) {
    for (const split of ["train", "validation"] as const) {
      let dropped = 0;
      let kept = 0;
      for (const m of measured.filter((e) => e.regime === regime && e.split === split)) {
        const byTwin = new Map<string, number>();
        for (const p of m.pieces) {
          if (p.attribution !== "event" || scorecard.keeps(p)) continue;
          dropped++;
          const twin = twinEventOf(catalogue.bodies.get(p.number)!.orbit, m, measured);
          if (twin === null) continue;
          kept++;
          byTwin.set(twin, (byTwin.get(twin) ?? 0) + 1);
        }
        for (const [twin, n] of byTwin) twins.push(`| ${m.id} ${m.name} | ${regime} | ${n} | ${twin} |`);
      }
      lines.push(`| ${regime} | ${split === "train" ? "training" : "held-out"} | ${dropped} | ${kept} |`);
    }
  }
  lines.push("", "| Event | Regime | Its pieces (by GCAT) a twin's plane keeps | The twin's event |", "| --- | --- | --- | --- |", ...twins, "");
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
  const notInIndex: string[] = [];
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
      notInIndex.push(`${breakup.id} (${breakup.orbit.regime})`);
      continue;
    }
    if (reading === null) {
      skipped.noParentOrbit++;
      continue;
    }
    // The pieces are the scorecard's: today's test or the normals within the scorecard's bound keep exactly what its count keeps.
    const today = reading.pieces.filter((p) => p.passesToday || p.normalAngleDeg <= FRAGMENTS_PLANE.planeNormalAngleMaxDeg).length;
    const scorecard = fragmentsOf(catalogue, parent, launch, from, to, eventMs, marginMs).inPlane;
    if (today !== scorecard) throw new Error(`${breakup.id}: the scorecard's test keeps ${today} pieces here and ${scorecard} in the scorecard's count`);
    measured.push({ ...reading, split, truthRegime: breakup.orbit.regime, confidence: breakup.confidence, kind: breakup.kind });
  }
  const bounds = boundsOf(DELTA_VS_MPS);
  const out: string[] = [
    `Read ${measured.length} scoreable events from 2006 with a catalogued parent from the catalogue index built ${index.builtAt}${stale.length > 0 ? ` (stale against the Archive: ${stale.join("; ")})` : ""}; skipped ${skipped.noLaunch} with no launch, ${skipped.notInIndex} the index holds no parent instant for${notInIndex.length > 0 ? ` (${notInIndex.join(", ")}: rebuild the index for this truth)` : ""}, ${skipped.noParentOrbit} with no parent set before the event. GCAT's satellite catalogue: ${gcat.size} pieces.`,
    "",
  ];
  for (const regime of ["HEO", "LEO", "GEO", "MEO"] as const) {
    for (const split of ["train", "validation", "both"] as const) {
      const rows = measured.filter((m) => m.regime === regime && (split === "both" || m.split === split));
      out.push(`## ${regime}, ${split === "both" ? "every year from 2006" : split === "train" ? "training years (even)" : "held-out years (odd)"}`, "", ...regimeTable(rows, bounds), "");
    }
  }
  out.push(...carrySection(measured, catalogue));
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
