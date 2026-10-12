import type { BodyClass, DetectorParameters } from "../../src/index.ts";
import { semiMajorAxisOf } from "../../src/elements.ts";
import { isFragmentClass, planeDistance, type PlaneOrbit } from "../../src/fragments.ts";
import { builtYears, readYear, type ArchivedBody } from "../archive/archive.ts";
import { ANALYST_FLOOR, DAY_MS, clockOf, orderOf } from "./replay.ts";

/**
 * The catalogue over every built year of the Archive, for the scripts that
 * read pieces against parents outside the replay: every body's launch,
 * class, name, decay and launch days, when it was first published (by the
 * replay's clock, in the catalogue's publication order, so a newly
 * catalogued piece's back-filled epochs do not date it early), and its
 * earliest set's orbit; each parent's last set before a time; and the
 * high-water mark of designated numbers against time. The scorecard reads
 * through it which reported events gained fresh pieces in their parent's
 * plane (the Confirmed line's targets) and the reentries the detector is
 * given, and the truth audit of the eighth phase read its false alarms'
 * pieces through it.
 *
 * It is read two ways. `readCatalogue` reads every built year of the
 * Archive's columns, about a minute over twenty-two years, and is what the
 * catalogue index is built from (`catalogue-index.ts`) and what the truth
 * audit reads, since it wants every set of the bodies it asks for. The
 * scorecard reads it from the index alone, since a replay holds a year
 * and the one before it, not the whole Archive: a year downloaded with its
 * predecessor, as the KPI workflow does, must score as it does beside
 * every other year.
 */

/** What the Archive says of one body over every year: its launch, class and name, when it was first published, and its earliest set's orbit. */
export interface BodyFact {
  number: number;
  launch: string | null;
  name: string;
  bodyClass: BodyClass;
  decayMs: number | null;
  launchMs: number | null;
  firstClock: number;
  firstEpoch: number;
  orbit: PlaneOrbit;
}

export interface ParentSet {
  epoch: number;
  orbit: PlaneOrbit;
}

export const planeOrbit = (epoch: number, meanMotion: number, eccentricity: number, inclination: number, raan: number): PlaneOrbit => ({ epochMs: epoch, aKm: semiMajorAxisOf({ meanMotion }), eccentricity, inclinationDeg: inclination, raanDeg: raan, meanMotion });

/** The catalogue as its readers hold it: every body's facts, each parent's last set before a time, and the high-water mark against time. */
export interface Catalogue {
  bodies: Map<number, BodyFact>;
  byLaunch: Map<string, BodyFact[]>;
  /** The parent's last set (the latest epoch) before `from` in any year of the Archive, null where it has none; a catalogue read from the index throws where the index does not hold the answer. */
  orbitBefore(parent: number, from: number): ParentSet | null;
  markAt(at: number): number;
}

/** The catalogue read from every year of the Archive, with every set of the parents asked for. */
export interface WholeCatalogue extends Catalogue {
  parentSets: Map<number, ParentSet[]>;
}

/** The last of a parent's sets, in epoch order, dated before `from`: the first of them where several share the latest epoch. */
export function lastSetBefore(sets: readonly ParentSet[], from: number): ParentSet | null {
  let before: ParentSet | null = null;
  for (const set of sets) if (set.epoch < from && (before === null || set.epoch > before.epoch)) before = set;
  return before;
}

/** The catalogue over the bodies' facts, in the order the Archive's years first list them: the launches' bodies and the high-water mark, with the parents' sets read through `orbitBefore`. */
export function catalogueOver(bodies: Map<number, BodyFact>, orbitBefore: Catalogue["orbitBefore"]): Catalogue {
  const byLaunch = new Map<string, BodyFact[]>();
  for (const fact of bodies.values()) if (fact.launch !== null) (byLaunch.get(fact.launch) ?? byLaunch.set(fact.launch, []).get(fact.launch)!).push(fact);
  // The mark: the highest designated number published by each instant.
  const designated = [...bodies.values()].filter((b) => b.launch !== null && b.number < ANALYST_FLOOR).sort((a, b) => a.firstClock - b.firstClock);
  const at = designated.map((b) => b.firstClock);
  const top: number[] = [];
  let mark = 0;
  for (const b of designated) top.push((mark = Math.max(mark, b.number)));
  return {
    bodies,
    byLaunch,
    orbitBefore,
    markAt(t) {
      let lo = 0;
      let hi = at.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (at[mid]! <= t) lo = mid + 1;
        else hi = mid;
      }
      return lo === 0 ? 0 : top[lo - 1]!;
    },
  };
}

/** The catalogue read from every built year of the Archive, one year at a time, with every set of the parents asked for. */
export function readCatalogue(archive: string, parents: ReadonlySet<number>, log = true): WholeCatalogue {
  const bodies = new Map<number, BodyFact>();
  const parentSets = new Map<number, ParentSet[]>();
  for (const year of builtYears(archive)) {
    const { manifest, bodies: table, columns } = readYear(archive, year, ["number", "epoch", "meanMotion", "eccentricity", "inclination", "raan", "rank", "created"]);
    const published = columns.created ?? columns.epoch;
    const clock = clockOf(orderOf(columns.rank, year), published);
    for (const body of table) {
      let firstClock = Number.POSITIVE_INFINITY;
      let firstIndex = -1;
      for (let i = body.first; i < body.first + body.count; i++) {
        if (clock[i]! < firstClock) firstClock = clock[i]!;
        if (firstIndex === -1 || columns.epoch[i]! < columns.epoch[firstIndex]!) firstIndex = i;
      }
      if (firstIndex === -1) continue;
      const orbit = planeOrbit(columns.epoch[firstIndex]!, columns.meanMotion[firstIndex]! / 1e8, columns.eccentricity[firstIndex]! / 1e7, columns.inclination[firstIndex]! / 1e4, columns.raan[firstIndex]! / 1e4);
      const known = bodies.get(body.number);
      const fact = factOf(body, firstClock, orbit);
      if (known === undefined) bodies.set(body.number, fact);
      else {
        // The latest table's class, name and decay; the earliest publication and set.
        known.bodyClass = fact.bodyClass;
        known.name = fact.name || known.name;
        known.decayMs = fact.decayMs ?? known.decayMs;
        known.launchMs = known.launchMs ?? fact.launchMs;
        known.launch = known.launch ?? fact.launch;
        known.firstClock = Math.min(known.firstClock, firstClock);
        if (orbit.epochMs < known.firstEpoch) [known.firstEpoch, known.orbit] = [orbit.epochMs, orbit];
      }
      if (parents.has(body.number)) {
        const list = parentSets.get(body.number) ?? parentSets.set(body.number, []).get(body.number)!;
        for (let i = body.first; i < body.first + body.count; i++) list.push({ epoch: columns.epoch[i]!, orbit: planeOrbit(columns.epoch[i]!, columns.meanMotion[i]! / 1e8, columns.eccentricity[i]! / 1e7, columns.inclination[i]! / 1e4, columns.raan[i]! / 1e4) });
      }
    }
    if (log) console.error(`catalogue: read ${year} (${manifest.sets} sets)`);
  }
  for (const list of parentSets.values()) list.sort((a, b) => a.epoch - b.epoch);
  return { ...catalogueOver(bodies, (parent, from) => lastSetBefore(parentSets.get(parent) ?? [], from)), parentSets };
}

export function factOf(body: ArchivedBody, firstClock: number, orbit: PlaneOrbit): BodyFact {
  const launch = body.designator !== null && /^\d{4}-\d{3}/.test(body.designator) ? body.designator.slice(0, 8) : null;
  return { number: body.number, launch, name: body.name ?? "", bodyClass: body.bodyClass, decayMs: body.decay === null ? null : Date.parse(`${body.decay}T00:00:00Z`), launchMs: body.launch === null || body.launch.length !== 10 ? null : Date.parse(`${body.launch}T00:00:00Z`), firstClock, firstEpoch: orbit.epochMs, orbit };
}


/** How long after a reported event the catalogue's fresh pieces in the parent's plane count as its fragments for the Confirmed line, in days: the owner's window, which the matcher also gives a confirmation to come. */
export const FRAGMENTS_DAYS = 180;

/** What the catalogue published of an event's fragments: the fresh pieces in the parent's plane within the window, the first of them to be published and when, and whether the parent's orbit before the event was known at all. */
export interface EventFragments {
  inPlane: number;
  firstAt: number | null;
  firstBody: number | null;
  parentOrbit: boolean;
}

/**
 * The fresh pieces in the parent's plane the catalogue published within
 * `FRAGMENTS_DAYS` of an event: bodies under the parent's launch numbered
 * above the catalogue's mark at the event (taken the margin before its
 * window, and never below the parent's own number) and below the analyst
 * range, classed as a fragment is (debris, or not said), first published
 * from the margin before the window to the window's end and the days
 * after, whose earliest set is no more than a day before the window, and
 * whose plane lies within the detector's bound of the parent's last set
 * before the event, each node carried at its own J2 rate. The parent's
 * plane is unknown where it had no set before the event in any year of the
 * Archive; then no piece can be in it.
 */
export function fragmentsOf(catalogue: Catalogue, parent: number, launch: string | null, from: number, to: number, eventMs: number, marginMs: number, params: DetectorParameters): EventFragments {
  const before = catalogue.orbitBefore(parent, from);
  const result: EventFragments = { inPlane: 0, firstAt: null, firstBody: null, parentOrbit: before !== null };
  if (before === null || launch === null) return result;
  const mark = Math.max(catalogue.markAt(from - marginMs), parent);
  for (const body of catalogue.byLaunch.get(launch) ?? []) {
    if (body.number <= mark || body.number >= ANALYST_FLOOR || !isFragmentClass(body.bodyClass)) continue;
    if (body.firstClock < from - marginMs || body.firstClock > to + FRAGMENTS_DAYS * DAY_MS || body.firstEpoch < from - DAY_MS) continue;
    if (planeDistance(before.orbit, body.orbit, eventMs, params, Number.POSITIVE_INFINITY).distance > params.planeDistanceMax) continue;
    result.inPlane++;
    if (result.firstAt === null || body.firstClock < result.firstAt) [result.firstAt, result.firstBody] = [body.firstClock, body.number];
  }
  return result;
}

/**
 * The fresh pieces the catalogue published under a launch within
 * `FRAGMENTS_DAYS` of a launch-level event, one whose parent has no
 * catalogue number (a burst under the launch, a separation GCAT gives an
 * object the public catalogue does not list): as `fragmentsOf`, but with
 * no parent's plane to test them against, every such piece counts. The
 * count is carried as `inPlane` and the parent's orbit as known, so the
 * Confirmed line reads the row as any other target.
 */
export function launchFragmentsOf(catalogue: Catalogue, launch: string, from: number, to: number, marginMs: number): EventFragments {
  const result: EventFragments = { inPlane: 0, firstAt: null, firstBody: null, parentOrbit: true };
  const mark = catalogue.markAt(from - marginMs);
  for (const body of catalogue.byLaunch.get(launch) ?? []) {
    if (body.number <= mark || body.number >= ANALYST_FLOOR || !isFragmentClass(body.bodyClass)) continue;
    if (body.firstClock < from - marginMs || body.firstClock > to + FRAGMENTS_DAYS * DAY_MS || body.firstEpoch < from - DAY_MS) continue;
    result.inPlane++;
    if (result.firstAt === null || body.firstClock < result.firstAt) [result.firstAt, result.firstBody] = [body.firstClock, body.number];
  }
  return result;
}
