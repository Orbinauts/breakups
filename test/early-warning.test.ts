import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { runDetector, type DetectorInput, type ElementSet, type SpaceWeatherDay, type Verdict } from "../src/index.ts";
import type { EarlyWarningFixture, FixtureRow } from "../scripts/kpi/early-warning-fixtures.ts";
import { regimeOf } from "../src/elements.ts";
import type { Latest } from "../scripts/kpi/kpi.ts";
import { brackets, marginDaysOf } from "../scripts/kpi/match.ts";
import { RUN_HOURS, spaceFor } from "../scripts/kpi/replay.ts";

/**
 * The early warning on real orbit histories: the suspected verdict the
 * detector raises on a parent's own orbit jump, before the first fragment
 * is catalogued, checked case by case. Each fixture under
 * `test/fixtures/early-warning/` is one object's element sets from the
 * Archive, from a hundred days before an instant to ten days after it
 * (to a stated end where the sets come days apart),
 * each with the four-hour run the scorecard's replay handed it over in
 * (`scripts/kpi/early-warning-fixtures.ts` says how they were cut and
 * why no band-mate is carried). Each is replayed here through
 * `runDetector` as the replay does: a run every four hours, the empty ones
 * too, each given the states the last returned and the days of space
 * weather.
 *
 * A reported breakup must come out as the full replay had it: a suspected
 * verdict on the parent whose step bracket covers the event (each widened
 * by the matcher's margin for the regime), on the same bracket as the full
 * replay's, raised before the first fragment was catalogued and before any
 * notice, with the detector's instant of the event within the tolerance
 * of the truth's. The tolerance is three times the held-out years' median
 * timing error of the early warning (`kpi/latest.json`), and at least two
 * hours, in low orbit; near the geostationary ring and in a high eccentric
 * orbit, where the sets come a day or more apart and the instant is placed
 * less finely, it is a day and a half. The cases reach every regime. An
 * orbit change that is not a breakup (a station's reboost, a
 * constellation satellite raising its orbit, a geosynchronous satellite's
 * station-keeping burn, a navigation satellite's burn in medium orbit) must raise no suspected verdict, the
 * change still seen and called a manoeuvre; and a quiet rocket body must
 * raise nothing at all.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = resolve(ROOT, "test/fixtures/early-warning");
const HOUR_MS = 3_600_000;
const RUN_MS = RUN_HOURS * HOUR_MS;
const latest = JSON.parse(readFileSync(resolve(ROOT, "kpi/latest.json"), "utf8")) as Latest;

/** The tolerance on the instant in low orbit: three times the held-out median timing error, at least two hours. */
const LOW_ORBIT_TOLERANCE_MS = Math.max(2 * HOUR_MS, 3 * latest.splits.validation.timingErrorMinutes! * 60_000);
/** Near the geostationary ring and in a high eccentric orbit: a day and a half. */
const DEEP_SPACE_TOLERANCE_MS = 36 * HOUR_MS;

const fixtures: EarlyWarningFixture[] = readdirSync(DIR)
  .filter((name) => name.endsWith(".json.gz"))
  .sort()
  .map((name) => JSON.parse(gunzipSync(readFileSync(resolve(DIR, name))).toString("utf8")) as EarlyWarningFixture);

const positives = fixtures.filter((f) => f.case.kind === "breakup");
const negatives = fixtures.filter((f) => f.case.kind === "negative");

/** A row of a fixture as the light row the detector reads, with what the year's body table says of the object. */
function setOf(fixture: EarlyWarningFixture, year: number, row: FixtureRow): ElementSet {
  const [number, epochMs, createdMs, meanMotion, eccentricity, inclinationDeg, raanDeg, argpDeg, meanAnomalyDeg, bstar, meanMotionDot, meanMotionDdot, elementSetNumber] = row;
  const body = fixture.bodies[String(year)]![String(number)]!;
  return { number, designator: body.designator, epochMs, createdMs, meanMotion, eccentricity, inclinationDeg, raanDeg, argpDeg, meanAnomalyDeg, bstar, meanMotionDot, meanMotionDdot, elementSetNumber, bodyClass: body.bodyClass, opsStatus: body.opsStatus, endedByMs: body.endedByMs, endedFromMs: body.endedFromMs, launchedMs: body.launchedMs };
}

/**
 * The fixture replayed: each year's runs every four hours, inside the
 * window, from the year's first run to its last, each handed the sets the
 * replay handed it. A year's replay starts its clock afresh, so the next
 * year's first runs may come before the last year's last, as they did.
 */
function replay(fixture: EarlyWarningFixture): Verdict[] {
  const space = new Map<string, SpaceWeatherDay>(fixture.space.map((day) => [day.day, day]));
  let states: DetectorInput["states"] = new Map();
  let launches: DetectorInput["launches"] = new Map();
  const verdicts: Verdict[] = [];
  const from = Date.parse(fixture.provenance.window.from);
  const to = Date.parse(fixture.provenance.window.to);
  for (const { year, firstRun, lastRun } of fixture.provenance.years) {
    const handed = new Map(fixture.runs.filter(([y]) => y === year).map(([, now, rows]) => [now, rows.map((row) => setOf(fixture, year, row))]));
    for (let now = Math.max(firstRun, Math.ceil(from / RUN_MS) * RUN_MS); now <= Math.min(lastRun, to); now += RUN_MS) {
      const output = runDetector({ states, launches, sets: handed.get(now) ?? [], now, space: spaceFor(space, now) });
      states = output.states;
      launches = output.launches;
      verdicts.push(...output.verdicts);
      handed.delete(now);
    }
    expect([...handed.keys()], `${fixture.case.name}: every run of ${year} with a set was made`).toEqual([]);
  }
  return verdicts;
}

const replayed = new Map(fixtures.map((fixture) => [fixture.case.name, replay(fixture)]));

describe("the early warning's fixtures", () => {
  test("hold at least six reported breakups and four orbit changes, or none, that are not breakups", () => {
    expect(positives.length).toBeGreaterThanOrEqual(6);
    expect(negatives.length).toBeGreaterThanOrEqual(4);
  });

  test("reach every regime: a breakup in low orbit, near the geostationary ring and in a high eccentric orbit, and an orbit change in medium Earth orbit", () => {
    const regimeOfCase = (fixture: EarlyWarningFixture): string => {
      const [year, , rows] = fixture.runs[0]!;
      return regimeOf(setOf(fixture, year, rows[0]!));
    };
    expect(new Set(positives.map(regimeOfCase))).toEqual(new Set(["LEO", "GEO", "HEO"]));
    expect(new Set(fixtures.map(regimeOfCase))).toEqual(new Set(["LEO", "MEO", "GEO", "HEO"]));
  });

  test.each(fixtures.map((f) => [f.case.name, f] as const))("%s says where it came from and is small", (_, fixture) => {
    expect(fixture.format).toBe(1);
    expect(fixture.provenance.source).toMatch(/^the Archive/);
    expect(fixture.provenance.numbers).toEqual([fixture.case.number]);
    expect(fixture.provenance.runHours).toBe(RUN_HOURS);
    expect(fixture.provenance.years.length).toBeGreaterThan(0);
    for (const year of fixture.provenance.years) {
      expect(year.builtAt).toMatch(/^\d{4}-\d\d-\d\dT/);
      expect(year.firstRun % RUN_MS).toBe(0);
      expect(year.lastRun).toBeGreaterThanOrEqual(year.firstRun);
    }
    const sets = fixture.runs.reduce((sum, [, , rows]) => sum + rows.length, 0);
    expect(sets).toBeGreaterThan(50);
    expect(sets).toBeLessThan(1000);
    for (const [, , rows] of fixture.runs) for (const row of rows) expect(row[0]).toBe(fixture.case.number);
    // Every run on a four-hour bin, inside the window and its year's runs, in the replay's order: by year, then by instant.
    const from = Date.parse(fixture.provenance.window.from);
    const to = Date.parse(fixture.provenance.window.to);
    for (const [i, [year, now]] of fixture.runs.entries()) {
      const record = fixture.provenance.years.find((y) => y.year === year)!;
      expect(now % RUN_MS).toBe(0);
      expect(now).toBeGreaterThanOrEqual(Math.max(from, record.firstRun));
      expect(now).toBeLessThanOrEqual(Math.min(to, record.lastRun));
      const previous = fixture.runs[i - 1];
      if (previous !== undefined) expect(year > previous[0] || (year === previous[0] && now > previous[1])).toBe(true);
    }
  });
});

describe("the early warning flags each reported breakup before its first fragment", () => {
  test.each(positives.map((f) => [f.case.name, f] as const))("%s", (_, fixture) => {
    const event = fixture.event!;
    expect(event, "the truth's event as the scorecard scored it").not.toBeNull();
    const full = fixture.replay.find((v) => v.state === "suspected");
    expect(full, "the full replay raised a suspected verdict on the parent").toBeDefined();
    const suspected = replayed.get(fixture.case.name)!.filter((v) => v.state === "suspected" && v.number === fixture.case.number && v.step !== null && brackets(v.step, event.from, event.to, marginDaysOf(event.regime)));
    expect(suspected.length, "a suspected verdict whose step bracket covers the event").toBeGreaterThan(0);
    const alert = suspected[0]!;
    // The same step as the full replay measured, and the same instant within a minute.
    expect([alert.step!.beforeEpoch, alert.step!.afterEpoch]).toEqual([full!.beforeEpoch, full!.afterEpoch]);
    expect(Math.abs(alert.event!.at - full!.eventAt!)).toBeLessThan(60_000);
    // Raised before the catalogue listed the first fragment, and before any notice.
    const deadline = Math.min(event.firstFragmentAt ?? Number.POSITIVE_INFINITY, event.noticeAt ?? Number.POSITIVE_INFINITY);
    expect(alert.raisedAt).toBeLessThan(deadline);
    expect(alert.raisedAt).toBeLessThanOrEqual(full!.raisedAt);
    // The instant, against the truth's.
    expect(event.at).not.toBeNull();
    const tolerance = event.regime === "LEO" ? LOW_ORBIT_TOLERANCE_MS : DEEP_SPACE_TOLERANCE_MS;
    expect(Math.abs(alert.event!.at - event.at!), `the instant within ${tolerance / HOUR_MS} h of the truth's`).toBeLessThanOrEqual(tolerance);
  });

  test("the low-orbit tolerance is the held-out median timing error three times over, at least two hours", () => {
    expect(latest.splits.validation.timingErrorMinutes).not.toBeNull();
    expect(LOW_ORBIT_TOLERANCE_MS).toBeGreaterThanOrEqual(2 * HOUR_MS);
  });
});

describe("the early warning stays quiet on orbit changes that are not breakups", () => {
  test.each(negatives.map((f) => [f.case.name, f] as const))("%s", (_, fixture) => {
    expect(fixture.replay.filter((v) => v.state === "suspected"), "the full replay raised no suspected verdict").toEqual([]);
    const verdicts = replayed.get(fixture.case.name)!.filter((v) => v.number === fixture.case.number);
    expect(verdicts.filter((v) => v.state === "suspected" || v.state === "scoped" || v.state === "confirmed")).toEqual([]);
    if (fixture.replay.length === 0) expect(verdicts).toEqual([]);
    else expect(verdicts.some((v) => v.state === "manoeuvre"), "the orbit change was seen and called a manoeuvre").toBe(true);
  });
});
