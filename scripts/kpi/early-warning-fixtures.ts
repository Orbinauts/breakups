import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { readBreakups, type Confidence, type ElementSet, type Regime, type SpaceWeatherDay, type Verdict } from "../../src/index.ts";
import { dayOf, endedByOf, opsStatusOf } from "../../src/elements.ts";
import { archiveHome, readYear, setAt, type ArchivedBody } from "../archive/archive.ts";
import { clockOf, orderOf, RUN_HOURS, spaceByDay, DAY_MS } from "./replay.ts";
import { readYearFile, yearsDir } from "./run.ts";

/**
 * The early warning's regression fixtures: small slices of the Archive,
 * one per case, that `test/early-warning.test.ts` replays through the
 * detector as the scorecard does, in runs of four hours. `npm run
 * kpi -- --all` must have been run first: besides the Archive, the script
 * reads the scorecard's year files under `kpi/years/`, for what the full
 * replay raised on each case's object and, for a reported breakup, when
 * the first fragment was catalogued.
 *
 * A positive case is a reported breakup the full replay flags with a
 * suspected verdict on the parent's own step before the first fragment:
 * the parent's element sets from a hundred days before the event to ten
 * days after it. A hundred, not sixty: the detector counts an object's age
 * from the first set it saw of it, and a payload it first saw under ninety
 * days before (`newObjectDays`) is young, whose first raise starts a
 * campaign, a manoeuvre; from sixty days, NOAA 17, DMSP 5D-2 F8 and
 * Meteor 2-7, which the full replay has known since 2005, each raised
 * their step as a young payload's campaign rather than as the unique step
 * it was. A negative case is an object whose orbit changed, or did not,
 * where the full replay raised no suspected verdict: a station's reboost,
 * a constellation satellite raising its orbit, a geosynchronous
 * satellite's station-keeping burn, and a quiet rocket body over the same
 * span as a breakup.
 *
 * Each fixture holds one object's sets alone, with no band-mate. What the
 * rest of the catalogue gives a run is the band's live scale and
 * common-mode drag (`environment.ts`), which need thirty residuals in a
 * run, and the run's stress (how many candidates the catalogue had that
 * day). A run with no band-mate takes the scale at its floor, one, and no
 * common mode; each positive case's step was raised in the full replay
 * with the scale at that floor too (the `bandScale1` signal of its row),
 * and alone each gives the same step bracket and the same instant as the
 * full replay, which the test checks. Alone, a negative case meets the
 * lowest bar a run can set, so it is a stricter test than the full
 * replay's. With no stress a step may be raised a few runs earlier than
 * in the full replay (the rocket body of LES 8 and 9: two days earlier);
 * none of these cases is raised later. No notice and no reentry is handed
 * to the runs: a notice confirms a suspected step and never raises one.
 *
 * Each set is kept as the replay hands it to the detector, in the
 * catalogue's publication order, with the instant of the run it was
 * handed over in: the replay's clock (the latest publication time seen,
 * else the latest epoch) at the set, rounded up to the four-hour bin; and
 * each year's first and last run, since a year's replay starts its clock
 * afresh (a bundle's last sets carry epochs of the next January, so the
 * next year's first runs come before the last year's last). The days of
 * space weather the runs read are carried too. Provenance: the
 * Archive's year, its build time, the object and the window, so a fixture
 * can be made again with `npm run kpi:fixtures`, or `npm run kpi:fixtures
 * -- <case> ...` for some of them. The fixtures are gzipped JSON, a dozen
 * to twenty-five kilobytes each.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const FIXTURES_DIR = join(ROOT, "test/fixtures/early-warning");

/** How far before the event a fixture starts, and how far after it ends, in days. */
export const DAYS_BEFORE = 100;
export const DAYS_AFTER = 10;

/** One case: a reported breakup by its id in the truth, or an object over a window around an instant, with what it is. */
export interface EarlyWarningCase {
  name: string;
  kind: "breakup" | "negative";
  number: number;
  /** The truth's id, for a breakup. */
  truthId?: string;
  /** The instant the window is centred on, for a negative: the step's middle, or any instant for a quiet object. */
  at?: string;
  /** Where a young object has no sets a hundred days before, the window's start: its first. */
  from?: string;
  what: string;
}

export const CASES: readonly EarlyWarningCase[] = [
  { name: "usa-32", kind: "breakup", number: 19460, truthId: "19460:2026-09-13", what: "USA 32, a defunct weather satellite, broke up on 13 September 2026 (confidence A)" },
  { name: "meteor-2-7", kind: "breakup", number: 12456, truthId: "12456:2026-10-05", what: "Meteor 2-7, a defunct weather satellite, shed pieces again on 5 October 2026" },
  { name: "cosmos-2491", kind: "breakup", number: 39497, truthId: "39497:2019-12-23", what: "Cosmos 2491 broke up on 23 December 2019 (confidence A)" },
  { name: "noaa-17", kind: "breakup", number: 27453, truthId: "27453:2021-03-10", what: "NOAA 17, a defunct weather satellite, broke up on 10 March 2021 (confidence A)" },
  { name: "cosmos-2499", kind: "breakup", number: 39765, truthId: "39765:2021-10-23", what: "Cosmos 2499 broke up on 23 October 2021 (confidence A)" },
  { name: "dmsp-5d-2-f8", kind: "breakup", number: 18123, truthId: "18123:2024-07-19", what: "DMSP 5D-2 F8, a defunct weather satellite, broke up on 19 July 2024 (confidence A)" },
  { name: "titan-iiic-transtage", kind: "breakup", number: 3692, truthId: "3692:2018-02-28", what: "a Titan IIIC Transtage near the geostationary ring broke up on 28 February 2018 (confidence A)" },
  { name: "les-8-9-rocket-body", kind: "breakup", number: 8751, truthId: "8751:2019-05-07", what: "the rocket body of LES 8 and 9 near the geostationary ring broke up on 7 May 2019 (confidence A)" },
  { name: "iss-reboost", kind: "negative", number: 25544, at: "2026-06-10T07:00:00Z", what: "the International Space Station's reboost of 10 June 2026, a 1.6 km raise" },
  { name: "starlink-orbit-raise", kind: "negative", number: 67309, at: "2026-01-19T00:00:00Z", from: "2026-01-04T00:00:00Z", what: "a Starlink satellite launched on 4 January 2026 raising its orbit by a hundred kilometres" },
  { name: "geo-station-keeping", kind: "negative", number: 39522, at: "2026-02-10T04:00:00Z", what: "Turksat 4A's station-keeping burn of 10 February 2026, half a kilometre" },
  { name: "quiet-rocket-body", kind: "negative", number: 47, at: "2026-09-13T21:13:00Z", what: "a Thor Ablestar rocket body of 1960 over the same days as the USA 32 breakup, its orbit decaying with nothing else" },
];

/** What a body's sets carry beside the orbit, as the replay reads it off the year's body table. */
export interface FixtureBody {
  designator: string | null;
  bodyClass: ElementSet["bodyClass"];
  opsStatus: NonNullable<ElementSet["opsStatus"]>;
  endedByMs: number | null;
  endedFromMs: number | null;
  launchedMs: number | null;
}

/** One set as a row: the number, the epoch and the publication time (null in a year with none), then the elements in the OMM's units. */
export type FixtureRow = [number: number, epochMs: number, createdMs: number | null, meanMotion: number, eccentricity: number, inclinationDeg: number, raanDeg: number, argpDeg: number, meanAnomalyDeg: number, bstar: number, meanMotionDot: number, meanMotionDdot: number, elementSetNumber: number];

/** A verdict the full replay raised on the object in the window, as the fixture records it. */
export interface ReplayedVerdict {
  state: Verdict["state"];
  raisedAt: number;
  beforeEpoch: number | null;
  afterEpoch: number | null;
  eventAt: number | null;
}

export interface EarlyWarningFixture {
  format: 1;
  case: EarlyWarningCase;
  provenance: {
    source: string;
    /** Each year the window reaches into: its build time, how its sets are timed, and the instants of the first and the last run its replay made, the runs between them every four hours. */
    years: { year: number; builtAt: string; timeBasis: "created" | "epoch"; firstRun: number; lastRun: number }[];
    numbers: number[];
    window: { from: string; to: string };
    runHours: number;
    extractedBy: string;
  };
  /** For a breakup: the truth's instant and window, and the first fragment's publication (the Confirmed line's first fresh piece in the parent's plane or the parent-step line's first new body under the launch, whichever came first) and the first notice; null where none came. */
  event: { at: number | null; from: number; to: number; regime: Regime; confidence: Confidence; firstFragmentAt: number | null; noticeAt: number | null } | null;
  /** What the full replay raised on the object in the window: the scorecard's record the case is checked against. */
  replay: ReplayedVerdict[];
  space: SpaceWeatherDay[];
  /** The body table's facts, by year and number. */
  bodies: Record<string, Record<string, FixtureBody>>;
  /** The runs that handed over a set, in the replay's order: the year, the run's instant, its rows. */
  runs: [year: number, now: number, rows: FixtureRow[]][];
}

const iso = (ms: number): string => new Date(ms).toISOString();

function bodyOf(body: ArchivedBody): FixtureBody {
  return { designator: body.designator, bodyClass: body.bodyClass, opsStatus: opsStatusOf(body.opsStatus), endedByMs: endedByOf(body.endedOn), endedFromMs: dayOf(body.endedFrom), launchedMs: dayOf(body.launch) };
}

/** The window of a case: a hundred days before its instant to ten after, or from its stated start. */
function windowOf(c: EarlyWarningCase, at: number): { from: number; to: number } {
  return { from: c.from === undefined ? at - DAYS_BEFORE * DAY_MS : Date.parse(c.from), to: at + DAYS_AFTER * DAY_MS };
}

const yearsOver = (from: number, to: number): number[] => {
  const years: number[] = [];
  for (let y = new Date(from).getUTCFullYear(); y <= new Date(to).getUTCFullYear(); y++) years.push(y);
  return years;
};

function main(): void {
  const archive = archiveHome();
  const only = process.argv.slice(2);
  const cases = only.length === 0 ? CASES : CASES.filter((c) => only.includes(c.name));
  const truth = readBreakups(JSON.parse(readFileSync(join(ROOT, "data/breakups.json"), "utf8")));
  const planned = cases.map((c) => {
    const breakup = c.truthId === undefined ? undefined : truth.find((b) => b.id === c.truthId);
    if (c.truthId !== undefined && breakup === undefined) throw new Error(`${c.name}: no ${c.truthId} in the truth`);
    const at = breakup === undefined ? Date.parse(c.at!) : Date.parse(breakup.event.at ?? breakup.event.from!);
    const window = windowOf(c, at);
    return { c, breakup, at, window, years: yearsOver(window.from, window.to).filter((y) => existsSync(join(archive, String(y), "manifest.json"))) };
  });
  const fixtures = new Map(planned.map((p) => [p.c.name, { format: 1, case: p.c, provenance: { source: "the Archive (docs/archive.md)", years: [], numbers: [p.c.number], window: { from: iso(p.window.from), to: iso(p.window.to) }, runHours: RUN_HOURS, extractedBy: "scripts/kpi/early-warning-fixtures.ts" }, event: null, replay: [], space: [], bodies: {}, runs: [] } as EarlyWarningFixture]));
  const runMs = RUN_HOURS * 3_600_000;
  // The run a set is handed over in: the end of the four-hour bin its clock falls in, as `runsOf` bins it.
  const binEnd = (clock: number): number => Math.floor(clock / runMs) * runMs + runMs;
  for (const year of [...new Set(planned.flatMap((p) => p.years))].sort((a, b) => a - b)) {
    const here = planned.filter((p) => p.years.includes(year));
    const { manifest, bodies, columns } = readYear(archive, year);
    const published = columns.created ?? columns.epoch;
    const order = orderOf(columns.rank, year);
    const clock = clockOf(order, published);
    const byNumber = new Map(bodies.map((body) => [body.number, body]));
    const space = spaceByDay(archive, year);
    for (const [day, indices] of spaceByDay(archive, year - 1)) if (!space.has(day)) space.set(day, indices);
    const file = join(yearsDir(join(ROOT, "kpi")), `${year}.json.gz`);
    if (!existsSync(file)) throw new Error(`${file} is missing: run npm run kpi -- --all first`);
    const scored = readYearFile(file);
    for (const p of here) {
      const fixture = fixtures.get(p.c.name)!;
      const body = byNumber.get(p.c.number);
      if (body === undefined) continue;
      fixture.provenance.years.push({ year, builtAt: manifest.builtAt, timeBasis: columns.created === undefined ? "epoch" : "created", firstRun: binEnd(clock[order[0]!]!), lastRun: binEnd(clock[order[order.length - 1]!]!) });
      fixture.bodies[String(year)] = { [String(p.c.number)]: bodyOf(body) };
      // The object's sets in publication order, each with the run it was handed over in.
      const indices: number[] = [];
      for (let i = body.first; i < body.first + body.count; i++) indices.push(i);
      indices.sort((a, b) => columns.rank[a]! - columns.rank[b]!);
      for (const i of indices) {
        const now = binEnd(clock[i]!);
        if (now < p.window.from || now > p.window.to) continue;
        const s = setAt(columns, i);
        const row: FixtureRow = [s.number, s.epoch, s.created ?? null, s.meanMotion, s.eccentricity, s.inclination, s.raan, s.argOfPerigee, s.meanAnomaly, s.bstar, s.meanMotionDot, s.meanMotionDdot, s.elementSetNumber];
        const last = fixture.runs.at(-1);
        if (last !== undefined && last[0] === year && last[1] === now) last[2].push(row);
        else fixture.runs.push([year, now, [row]]);
      }
      for (const v of scored.verdicts) {
        if (v.number !== p.c.number || v.raisedAt < p.window.from || v.raisedAt > p.window.to) continue;
        fixture.replay.push({ state: v.state, raisedAt: v.raisedAt, beforeEpoch: v.step?.beforeEpoch ?? null, afterEpoch: v.step?.afterEpoch ?? null, eventAt: v.event?.at ?? null });
      }
      for (const [day, indices] of space) {
        const ms = Date.parse(`${day}T00:00:00Z`);
        if (ms >= p.window.from - 3 * DAY_MS && ms <= p.window.to && !fixture.space.some((d) => d.day === day)) fixture.space.push(indices);
      }
      if (p.breakup !== undefined) {
        const event = scored.score.events.find((e) => e.id === p.c.truthId);
        if (event !== undefined) {
          const firsts = [event.catalogueAt, event.fragments?.firstAt ?? null].filter((t): t is number => t !== null);
          fixture.event = { at: event.at, from: event.from, to: event.to, regime: event.regime, confidence: event.confidence, firstFragmentAt: firsts.length === 0 ? null : Math.min(...firsts), noticeAt: event.noticeAt };
        }
      }
    }
  }
  mkdirSync(FIXTURES_DIR, { recursive: true });
  for (const fixture of fixtures.values()) {
    fixture.space.sort((a, b) => a.day.localeCompare(b.day));
    if (fixture.case.kind === "breakup" && fixture.event === null) throw new Error(`${fixture.case.name}: the scorecard's year file has no scored event ${fixture.case.truthId}`);
    const sets = fixture.runs.reduce((sum, run) => sum + run[2].length, 0);
    const bytes = gzipSync(`${JSON.stringify(fixture)}\n`, { level: 9 });
    writeFileSync(join(FIXTURES_DIR, `${fixture.case.name}.json.gz`), bytes);
    const suspected = fixture.replay.filter((v) => v.state === "suspected");
    console.log(`${fixture.case.name}: ${sets} sets in ${fixture.runs.length} runs, ${fixture.provenance.window.from} to ${fixture.provenance.window.to}, ${bytes.length} bytes; the full replay raised ${fixture.replay.map((v) => v.state).join(", ") || "nothing"}${suspected.length > 0 ? ` (suspected at ${iso(suspected[0]!.raisedAt)})` : ""}`);
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("early-warning-fixtures.ts")) main();
