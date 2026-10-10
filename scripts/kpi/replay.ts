import { existsSync } from "node:fs";
import { join } from "node:path";
import { dayOf, endedByOf, opsStatusOf, runDetector, type DetectorInput, type DetectorOutput, type DetectorParameters, type ElementSet, type LaunchState, type LogRow, type Notice, type ObjectState, type OpsStatus, type SpaceWeatherDay, type Verdict } from "../../src/index.ts";
import { readBodies, readColumn, readManifest, yearDir, type ArchivedBody, type ArchivedSet, type ColumnName, type Columns, type Manifest } from "../archive/archive.ts";
import { readSpaceYear, spaceDir } from "../archive/space-weather.ts";

/**
 * The replay: a year of the Archive fed to the detector as the product
 * will feed it, every set in the order the catalogue published it, in
 * runs of four hours, each run given the states the last one returned and
 * the day's space weather, the verdicts collected. The detector never sees
 * a set before the catalogue published it, and never sees the year whole:
 * what it decides at any run it decides on what was public by then.
 *
 * Publication order is the Archive's `rank`: for a year pulled from the
 * history class it is the order of the publication times, which the year
 * also carries (`created`); for a year stripped from a bundle it is the
 * bundle's own order, which is the catalogue's, but the publication time
 * is not known. The replay's clock is therefore the latest publication
 * time seen so far where the year has them, else the latest epoch seen so
 * far: a set is published no earlier than its epoch, so the clock is a
 * lower bound of the true time, and the detector sees each set no later
 * than it would have. The clock leaps at most a day on any one set, so a
 * set with a wild epoch cannot carry it off. The results of a bundle year
 * say which basis they were timed on.
 *
 * A run is the sets whose publication fell in one four-hour bin of that
 * clock, handed over at the bin's end; a set published with an epoch older
 * than the clock (a late set of an old epoch) goes into the bin it was
 * published in, as it did. Bins with no set still run, so a detector that
 * lets candidates lapse by time sees the time pass.
 *
 * The states are carried across the year's runs and, from one year into
 * the next, across the years: the detector's verdict depends on the
 * object's own record over two years, so the years are replayed in order
 * and a year starts from the states the previous year's replay ended
 * with (`carried`). A year replayed with no carried states, the first
 * year or one run alone, is warmed up from the previous year's last
 * weeks where the Archive has it: those runs are replayed and their
 * verdicts dropped, so the detector meets January with every object's
 * recent sets rather than cold, though with no record of its steps. The
 * result says which of the two it was.
 *
 * Memory: a year's columns are read whole (typed arrays, a few hundred
 * megabytes for the largest), and the light rows the detector reads are
 * built for one run at a time, never for the year.
 */

export const RUN_HOURS = 4;
/** How much of the previous year warms the states up, in days: twice the longest window the detector's design keeps. */
export const WARMUP_DAYS = 60;
/** The days of space weather handed to a run: the run's day and the two before it, so a storm's onset is in view. */
export const SPACE_DAYS = 3;
/**
 * The most the clock may leap forward on one set, in days. A set's epoch
 * is rarely more than hours ahead of its publication, but a bundle holds
 * the odd set with an epoch years ahead (a stage of 2005 with a 2008
 * epoch), and a clock that followed it would hold every later set in one
 * run until the real epochs caught up. Capped, such a set costs the clock a
 * day's lead at most, which the next day's sets close.
 */
export const CLOCK_LEAP_MAX_DAYS = 1;
/** Objects numbered from here are analyst objects, which the catalogue has not designated. */
export const ANALYST_FLOOR = 80_000;
const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** The columns a run reads: every stored field but the revolution count, which the detector does not read. */
const READ_COLUMNS: readonly ColumnName[] = ["number", "epoch", "meanMotion", "eccentricity", "inclination", "raan", "argOfPerigee", "meanAnomaly", "bstar", "meanMotionDot", "meanMotionDdot", "elementSetNumber", "rank", "created"];

export type TimeBasis = "created" | "epoch";

/** A year read for the replay: its columns, its bodies by number, and the set indices in publication order. */
export interface LoadedYear {
  year: number;
  manifest: Manifest;
  bodies: ArchivedBody[];
  byNumber: Map<number, ArchivedBody>;
  /** The operational status of each body the table says something of (the snapshot's, today's); a body absent here is `unknown`. */
  statusByNumber: Map<number, OpsStatus>;
  /** The instant by which each payload had fallen silent, where the table dates it (GCAT's end of transmission); a body absent here has no date. */
  endedByNumber: Map<number, number>;
  /** The first day each dated end of transmission may fall on. */
  endedFromByNumber: Map<number, number>;
  /** Each body's launch day, where the table gives it. */
  launchedByNumber: Map<number, number>;
  columns: Columns;
  /** The set index at each position of the publication order. */
  order: Uint32Array;
  timeBasis: TimeBasis;
}

/** A year read for the replay, with the inverse of its rank column. */
export function loadYear(archive: string, year: number): LoadedYear {
  const dir = yearDir(archive, year);
  const manifest = readManifest(archive, year);
  const bodies = readBodies(archive, year);
  const columns = {} as Record<ColumnName, Columns[ColumnName]>;
  for (const name of manifest.columns) if (READ_COLUMNS.includes(name)) columns[name] = readColumn(dir, name, manifest.sets, manifest);
  // Ranks are the file's ordinals, rejects counted, so they may have gaps: the order lists the sets that exist, by rank.
  const order = orderOf(columns.rank as Uint32Array, year);
  const byNumber = new Map<number, ArchivedBody>();
  for (const body of bodies) byNumber.set(body.number, body);
  return { year, manifest, bodies, byNumber, statusByNumber: statusMapOf(bodies), endedByNumber: endedMapOf(bodies), endedFromByNumber: dayMapOf(bodies, (body) => body.endedFrom), launchedByNumber: dayMapOf(bodies, (body) => body.launch), columns: columns as unknown as Columns, order, timeBasis: columns.created === undefined ? "epoch" : "created" };
}

/** The bodies' operational statuses by number, those the table says something of. */
export function statusMapOf(bodies: readonly ArchivedBody[]): Map<number, OpsStatus> {
  const statuses = new Map<number, OpsStatus>();
  for (const body of bodies) {
    const status = opsStatusOf(body.opsStatus);
    if (status !== "unknown") statuses.set(body.number, status);
  }
  return statuses;
}

/** The bodies' dated ends of operations by number, those the table dates. */
export function endedMapOf(bodies: readonly ArchivedBody[]): Map<number, number> {
  const ends = new Map<number, number>();
  for (const body of bodies) {
    const ended = endedByOf(body.endedOn);
    if (ended !== null) ends.set(body.number, ended);
  }
  return ends;
}

/** A day the body table gives, by number, those it gives. */
export function dayMapOf(bodies: readonly ArchivedBody[], dayOfBody: (body: ArchivedBody) => string | null | undefined): Map<number, number> {
  const days = new Map<number, number>();
  for (const body of bodies) {
    const day = dayOf(dayOfBody(body));
    if (day !== null) days.set(body.number, day);
  }
  return days;
}

/** The light row of an Archive set, with what the body table says of the object. */
export function fromArchivedSet(set: ArchivedSet, body: (Pick<ArchivedBody, "designator" | "bodyClass"> & Partial<Pick<ArchivedBody, "opsStatus" | "endedOn" | "endedFrom" | "launch">>) | undefined): ElementSet {
  return {
    number: set.number,
    designator: body?.designator ?? null,
    epochMs: set.epoch,
    createdMs: set.created ?? null,
    meanMotion: set.meanMotion,
    eccentricity: set.eccentricity,
    inclinationDeg: set.inclination,
    raanDeg: set.raan,
    argpDeg: set.argOfPerigee,
    meanAnomalyDeg: set.meanAnomaly,
    bstar: set.bstar,
    meanMotionDot: set.meanMotionDot,
    meanMotionDdot: set.meanMotionDdot,
    elementSetNumber: set.elementSetNumber,
    bodyClass: body?.bodyClass ?? "unknown",
    opsStatus: opsStatusOf(body?.opsStatus),
    endedByMs: endedByOf(body?.endedOn),
    endedFromMs: dayOf(body?.endedFrom),
    launchedMs: dayOf(body?.launch),
  };
}

/** The light row at a set index, built straight from the columns: the one allocation a set costs the replay. */
export function elementSetAt(loaded: LoadedYear, i: number): ElementSet {
  const c = loaded.columns;
  const number = c.number[i]!;
  const body = loaded.byNumber.get(number);
  return {
    number,
    designator: body?.designator ?? null,
    epochMs: c.epoch[i]!,
    createdMs: c.created === undefined ? null : c.created[i]!,
    meanMotion: c.meanMotion[i]! / 1e8,
    eccentricity: c.eccentricity[i]! / 1e7,
    inclinationDeg: c.inclination[i]! / 1e4,
    raanDeg: c.raan[i]! / 1e4,
    argpDeg: c.argOfPerigee[i]! / 1e4,
    meanAnomalyDeg: c.meanAnomaly[i]! / 1e4,
    bstar: c.bstar[i]!,
    meanMotionDot: c.meanMotionDot[i]! / 1e8,
    meanMotionDdot: c.meanMotionDdot[i]!,
    elementSetNumber: c.elementSetNumber[i]!,
    bodyClass: body?.bodyClass ?? "unknown",
    opsStatus: loaded.statusByNumber.get(number) ?? "unknown",
    endedByMs: loaded.endedByNumber.get(number) ?? null,
    endedFromMs: loaded.endedFromByNumber.get(number) ?? null,
    launchedMs: loaded.launchedByNumber.get(number) ?? null,
  };
}

/** The earliest the set at an index can have been published: its publication time where the year has it, else its epoch. */
export function publishedAt(loaded: LoadedYear, i: number): number {
  return loaded.columns.created === undefined ? loaded.columns.epoch[i]! : loaded.columns.created[i]!;
}

/** One run's worth of sets, and the instant the run happens. */
export interface Run {
  now: number;
  sets: ElementSet[];
}

/**
 * The year's runs in order, from the first position of the publication
 * order whose clock has reached `from` (every position where `from` is
 * omitted). A generator, so one run's rows exist at a time.
 */
export function* runsOf(loaded: LoadedYear, from = Number.NEGATIVE_INFINITY, runHours = RUN_HOURS): Generator<Run> {
  const runMs = runHours * HOUR_MS;
  const binEndOf = (clock: number): number => Math.floor(clock / runMs) * runMs + runMs;
  const leap = CLOCK_LEAP_MAX_DAYS * DAY_MS;
  let clock = Number.NEGATIVE_INFINITY;
  let binEnd = Number.NaN;
  let sets: ElementSet[] = [];
  for (let p = 0; p < loaded.order.length; p++) {
    const i = loaded.order[p]!;
    const published = publishedAt(loaded, i);
    if (published > clock) clock = Number.isFinite(clock) ? Math.min(published, clock + leap) : published;
    if (clock < from) continue;
    if (Number.isNaN(binEnd)) binEnd = binEndOf(clock);
    while (clock >= binEnd) {
      yield { now: binEnd, sets };
      sets = [];
      binEnd += runMs;
    }
    sets.push(elementSetAt(loaded, i));
  }
  if (!Number.isNaN(binEnd)) yield { now: binEnd, sets };
}

/** The space-weather days of a year by day, or an empty map where the Archive has none. */
export function spaceByDay(archive: string, year: number): Map<string, SpaceWeatherDay> {
  const days = new Map<string, SpaceWeatherDay>();
  if (!existsSync(join(spaceDir(archive), `${year}.json`))) return days;
  for (const day of readSpaceYear(archive, year)) days.set(day.day, { day: day.day, kp: day.kp, ap: day.ap, Ap: day.Ap, f107: day.f107, f107Adjusted: day.f107Adjusted, dst: day.dst });
  return days;
}

/** The days handed to a run at `now`: its own day and the days before it that the caller has, oldest first. */
export function spaceFor(space: Map<string, SpaceWeatherDay>, now: number, count = SPACE_DAYS): SpaceWeatherDay[] {
  const days: SpaceWeatherDay[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const day = space.get(new Date(now - back * DAY_MS).toISOString().slice(0, 10));
    if (day !== undefined) days.push(day);
  }
  return days;
}

export type Detector = (input: DetectorInput) => DetectorOutput;

/** What one year's replay hands the next: the states at its end, and its sets as the matcher reads them across the boundary. */
export interface Carried {
  states: Map<number, ObjectState>;
  launches: Map<string, LaunchState>;
  previous: YearSlice | null;
}

export interface ReplayOptions {
  /** The detector to run; the library's by default. */
  detector?: Detector;
  parameters?: Partial<DetectorParameters>;
  /** The notices the caller knows of, handed to each run as far as published by its instant. */
  notices?: Notice[];
  runHours?: number;
  warmupDays?: number;
  /** The states the previous year's replay ended with; given, no warm-up is run. */
  carried?: Carried;
  /** Called after each run, for progress. */
  onRun?: (run: Run, year: number, runs: number) => void;
}

/** The sets of a replayed year and its warm-up, as the matcher reads them: by object, with their epochs and publication bounds. */
/** An object's orbit as one set gives it: the epoch, the mean motion in revolutions a day, the eccentricity and the drag term. */
export interface OrbitSample {
  epochMs: number;
  meanMotion: number;
  eccentricity: number;
  bstar: number;
}

export interface SetIndex {
  /** How many sets of the object have an epoch in [from, to). */
  countSets(number: number, from: number, to: number): number;
  /** The object's last set with an epoch before the instant, over the year and the one before; null where it has none. */
  orbitBefore(number: number, at: number): OrbitSample | null;
  /** What the body tables say of the object, the year's table first; undefined where neither lists it. */
  bodyOf(number: number): ArchivedBody | undefined;
  /** The earliest a set of the object can have been published, over the year and its warm-up; null where it has none. */
  firstPublication(number: number): number | null;
  /** The earliest any set of the object with an epoch at or after `from` appeared in the catalogue's publication order, by the replay's clock; null where there is none. */
  firstPublicationFrom(number: number, from: number): number | null;
  /** The year's bodies, as the body table lists them. */
  bodies: ArchivedBody[];
  /** The highest designated catalogue number (below the analyst range) with a set published by the instant, as far as the year says. */
  highWaterMark(at: number): number;
}

export interface ReplayResult {
  year: number;
  manifest: Manifest;
  timeBasis: TimeBasis;
  runs: number;
  sets: number;
  /** The warm-up run, or null where the states were carried from the previous year's replay. */
  warmup: { year: number; runs: number; sets: number } | null;
  carried: boolean;
  verdicts: Verdict[];
  log: LogRow[];
  states: Map<number, ObjectState>;
  launches: Map<string, LaunchState>;
  /** The sum over the year's objects of the span their sets cover, in years: what a false-alarm rate per body-year divides by. */
  bodyYears: number;
  seconds: number;
  index: SetIndex;
  /** The year's sets as the matcher reads them, for the next year to carry. */
  slice: YearSlice;
}

/**
 * A compact copy of what the matcher needs of a year: by object, the
 * epochs in the body's own order, their publication bounds (the
 * publication time where the year has it, else the epoch), and the
 * replay's clock at each set in the catalogue's publication order, which
 * is when the detector saw it. The clock, not the set's own epoch, says
 * when a body first appeared in the catalogue: a bundle lists old debris
 * catalogued in August with set epochs from January, and a mark read off
 * those epochs would sit above a breakup's real pieces for months.
 */
export interface YearSlice {
  year: number;
  bodies: ArchivedBody[];
  byNumber: Map<number, ArchivedBody>;
  epoch: Float64Array;
  published: Float64Array;
  clock: Float64Array;
  /** The mean motion, the eccentricity and the drag term of each set, as the columns store them (the first two scaled by 1e8 and 1e7), so the matcher can read a parent's orbit at an event; absent on a slice written without them. */
  meanMotion?: ArrayLike<number>;
  eccentricity?: ArrayLike<number>;
  bstar?: ArrayLike<number>;
}

/** The replay's clock at each set: the latest publication bound seen so far in publication order, leaping at most a day on any one set, as `runsOf` keeps it. */
export function clockOf(order: Uint32Array, published: Float64Array): Float64Array {
  const clock = new Float64Array(published.length);
  const leap = CLOCK_LEAP_MAX_DAYS * DAY_MS;
  let now = Number.NEGATIVE_INFINITY;
  for (let p = 0; p < order.length; p++) {
    const i = order[p]!;
    const at = published[i]!;
    if (at > now) now = Number.isFinite(now) ? Math.min(at, now + leap) : at;
    clock[i] = now;
  }
  return clock;
}

function sliceOf(loaded: LoadedYear): YearSlice {
  const published = loaded.columns.created ?? loaded.columns.epoch;
  return { year: loaded.year, bodies: loaded.bodies, byNumber: loaded.byNumber, epoch: loaded.columns.epoch, published, clock: clockOf(loaded.order, published), meanMotion: loaded.columns.meanMotion, eccentricity: loaded.columns.eccentricity, bstar: loaded.columns.bstar };
}

/** The publication order of a year from its rank column: the set indices by ascending rank, gaps skipped; two sets sharing a rank is an error in the year. */
export function orderOf(rank: Uint32Array, year: number): Uint32Array {
  let top = 0;
  for (let i = 0; i < rank.length; i++) if (rank[i]! > top) top = rank[i]!;
  const byRank = new Uint32Array(top + 1).fill(0xffffffff);
  for (let i = 0; i < rank.length; i++) {
    if (byRank[rank[i]!] !== 0xffffffff) throw new Error(`${year}: two sets share rank ${rank[i]}`);
    byRank[rank[i]!] = i;
  }
  const order = new Uint32Array(rank.length);
  let at = 0;
  for (let r = 0; r <= top; r++) if (byRank[r] !== 0xffffffff) order[at++] = byRank[r]!;
  return order;
}

/** The slice of a year alone, read from the three columns it needs rather than the fourteen a replay reads. */
export function loadSlice(archive: string, year: number): YearSlice {
  const dir = yearDir(archive, year);
  const manifest = readManifest(archive, year);
  const bodies = readBodies(archive, year);
  const column = (name: ColumnName) => readColumn(dir, name, manifest.sets, manifest);
  const epoch = column("epoch") as Float64Array;
  const published = manifest.columns.includes("created") ? (column("created") as Float64Array) : epoch;
  const order = orderOf(column("rank") as Uint32Array, year);
  return { year, bodies, byNumber: new Map(bodies.map((body) => [body.number, body])), epoch, published, clock: clockOf(order, published), meanMotion: column("meanMotion"), eccentricity: column("eccentricity"), bstar: column("bstar") };
}

/** The matcher's index over a year's slice and the previous year's, where there is one. */
export function indexOf(current: YearSlice, previous: YearSlice | null): SetIndex {
  const slices = previous === null ? [current] : [previous, current];
  const firstOf = (slice: YearSlice, body: ArchivedBody): number => {
    let first = Number.POSITIVE_INFINITY;
    for (let i = body.first; i < body.first + body.count; i++) if (slice.published[i]! < first) first = slice.published[i]!;
    return first;
  };
  // Each designated body's first appearance in the catalogue's publication order over both years, by the replay's clock, for the high-water mark.
  const firstSeenOf = (slice: YearSlice, body: ArchivedBody): number => {
    let first = Number.POSITIVE_INFINITY;
    for (let i = body.first; i < body.first + body.count; i++) if (slice.clock[i]! < first) first = slice.clock[i]!;
    return first;
  };
  const designatedFirst = new Map<number, number>();
  for (const slice of slices) {
    for (const body of slice.bodies) {
      if (body.designator === null || body.number >= ANALYST_FLOOR) continue;
      designatedFirst.set(body.number, Math.min(designatedFirst.get(body.number) ?? Number.POSITIVE_INFINITY, firstSeenOf(slice, body)));
    }
  }
  return {
    countSets(number, from, to) {
      let count = 0;
      for (const slice of slices) {
        const body = slice.byNumber.get(number);
        if (body === undefined) continue;
        for (let i = body.first; i < body.first + body.count; i++) if (slice.epoch[i]! >= from && slice.epoch[i]! < to) count++;
      }
      return count;
    },
    firstPublication(number) {
      let first = Number.POSITIVE_INFINITY;
      for (const slice of slices) {
        const body = slice.byNumber.get(number);
        if (body !== undefined) first = Math.min(first, firstOf(slice, body));
      }
      return Number.isFinite(first) ? first : null;
    },
    firstPublicationFrom(number, from) {
      // By the replay's clock, as the detector saw it: a newly catalogued piece's first sets carry back-filled epochs from before it appeared.
      let first = Number.POSITIVE_INFINITY;
      for (const slice of slices) {
        const body = slice.byNumber.get(number);
        if (body === undefined) continue;
        for (let i = body.first; i < body.first + body.count; i++) if (slice.epoch[i]! >= from && slice.clock[i]! < first) first = slice.clock[i]!;
      }
      return Number.isFinite(first) ? first : null;
    },
    orbitBefore(number, at) {
      let best: OrbitSample | null = null;
      for (const slice of slices) {
        const body = slice.byNumber.get(number);
        if (body === undefined || slice.meanMotion === undefined || slice.eccentricity === undefined || slice.bstar === undefined) continue;
        for (let i = body.first; i < body.first + body.count; i++) {
          const epoch = slice.epoch[i]!;
          if (epoch < at && (best === null || epoch > best.epochMs)) best = { epochMs: epoch, meanMotion: slice.meanMotion[i]! / 1e8, eccentricity: slice.eccentricity[i]! / 1e7, bstar: slice.bstar[i]! };
        }
      }
      return best;
    },
    bodyOf(number) {
      return current.byNumber.get(number) ?? previous?.byNumber.get(number);
    },
    bodies: current.bodies,
    highWaterMark(at) {
      let mark = 0;
      for (const [number, first] of designatedFirst) if (first <= at && number > mark) mark = number;
      return mark;
    },
  };
}

/** The sum over the bodies of the span their sets' epochs cover within the year, in years, each body at least a day. */
export function bodyYearsOf(loaded: LoadedYear): number {
  const start = Date.UTC(loaded.year, 0, 1);
  const end = Date.UTC(loaded.year + 1, 0, 1);
  const epoch = loaded.columns.epoch;
  let days = 0;
  for (const body of loaded.bodies) {
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;
    for (let i = body.first; i < body.first + body.count; i++) {
      const e = Math.min(end, Math.max(start, epoch[i]!));
      if (e < first) first = e;
      if (e > last) last = e;
    }
    days += Math.max(1, (last - first) / DAY_MS);
  }
  return days / 365.25;
}

/**
 * A year replayed through the detector, warmed up from the previous
 * year's last weeks where the Archive has it. Returns every verdict the
 * year's runs raised, the states at the year's end, and the index the
 * matcher reads the year's sets through.
 */
export function replayYear(archive: string, year: number, options: ReplayOptions = {}): ReplayResult {
  const started = performance.now();
  const detector = options.detector ?? runDetector;
  const runHours = options.runHours ?? RUN_HOURS;
  const warmupDays = options.warmupDays ?? WARMUP_DAYS;
  const notices = options.notices ?? [];
  const carried = options.carried;
  let states = carried?.states ?? new Map<number, ObjectState>();
  let launches = carried?.launches ?? new Map<string, LaunchState>();
  let warmup: ReplayResult["warmup"] = null;
  let previous: YearSlice | null = carried?.previous ?? null;
  const feed = (loaded: LoadedYear, from: number, collect: Verdict[] | null, log: LogRow[] | null): { runs: number; sets: number } => {
    const space = spaceByDay(archive, loaded.year);
    const previousSpace = spaceByDay(archive, loaded.year - 1);
    for (const [day, indices] of previousSpace) if (!space.has(day)) space.set(day, indices);
    let runs = 0;
    let sets = 0;
    for (const run of runsOf(loaded, from, runHours)) {
      const output = detector({ states, launches, sets: run.sets, now: run.now, space: spaceFor(space, run.now), notices: notices.filter((n) => n.at <= run.now), parameters: options.parameters });
      states = output.states;
      launches = output.launches;
      collect?.push(...output.verdicts);
      log?.push(...output.log);
      runs++;
      sets += run.sets.length;
      options.onRun?.(run, loaded.year, runs);
    }
    return { runs, sets };
  };
  if (carried === undefined && existsSync(join(yearDir(archive, year - 1), "manifest.json"))) {
    const loaded = loadYear(archive, year - 1);
    const fed = feed(loaded, Date.UTC(year, 0, 1) - warmupDays * DAY_MS, null, null);
    warmup = { year: year - 1, ...fed };
    previous = sliceOf(loaded);
  }
  const loaded = loadYear(archive, year);
  const verdicts: Verdict[] = [];
  const log: LogRow[] = [];
  const fed = feed(loaded, Number.NEGATIVE_INFINITY, verdicts, log);
  const slice = sliceOf(loaded);
  return {
    year,
    manifest: loaded.manifest,
    timeBasis: loaded.timeBasis,
    runs: fed.runs,
    sets: fed.sets,
    warmup,
    carried: carried !== undefined,
    verdicts,
    log,
    states,
    launches,
    bodyYears: bodyYearsOf(loaded),
    seconds: (performance.now() - started) / 1000,
    index: indexOf(slice, previous),
    slice,
  };
}
