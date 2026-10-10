import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { DETECTOR_PARAMETERS, readBreakups, type DetectorInput, type Verdict } from "../src/index.ts";
import { REQUIRED_COLUMNS, writeYear, type ArchivedBody, type Columns, type Manifest } from "../scripts/archive/archive.ts";
import { jumpDetector } from "../scripts/kpi/jump.ts";
import { cellsOf, percentile, readmeTables, renderLatest, splitYears, type Latest } from "../scripts/kpi/kpi.ts";
import { brackets, lineOf, marginDaysOf, noticesOf } from "../scripts/kpi/match.ts";
import { fromArchivedSet, loadYear, runsOf, type LoadedYear } from "../scripts/kpi/replay.ts";
import { carriedOf, readTruth, replayAndScore, scoreYear, writeAggregate, writeYearFile } from "../scripts/kpi/run.ts";
import { readStates, writeStates } from "../scripts/kpi/states.ts";

/**
 * The scorecard on a synthetic year, with no Archive: the fixture's few
 * hundred daily sets of seven objects are written as a year of the
 * Archive's format into a temporary directory, replayed through the
 * trivial jump detector with one cloud verdict injected, and matched
 * against the fixture's truth. Every rule of the matching lands on one
 * object of the fixture: a detection before the fragments, the same step
 * raised again, an alert on a fragment, an alert after the fragment was
 * published, a false alarm, a step inside an aerodynamic row's window, and
 * a parent with too few sets to be scored. The cells and the tables are
 * then checked against what those land as.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, "test/fixtures/kpi-synthetic");
const YEAR = 2013;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (month: number, day: number, hour = 0, minute = 0): number => Date.UTC(YEAR, month - 1, day, hour, minute);

interface SetsFile {
  columns: string[];
  rows: (number | string)[][];
}

/** The fixture's rows as a year's columns and body table, sorted by object then rank as the Archive stores them. */
function yearOf(rows: (number | string)[][], bodies: Omit<ArchivedBody, "first" | "count">[], created?: (row: (number | string)[], rank: number) => number): { manifest: Manifest; bodies: ArchivedBody[]; columns: Columns } {
  const ranked = rows.map((row, i) => ({ row, rank: i + 1 })).sort((a, b) => (a.row[0] as number) - (b.row[0] as number) || a.rank - b.rank);
  const n = ranked.length;
  const columns: Columns = {
    number: new Uint32Array(n),
    epoch: new Float64Array(n),
    meanMotion: new Uint32Array(n),
    eccentricity: new Uint32Array(n),
    inclination: new Uint32Array(n),
    raan: new Uint32Array(n),
    argOfPerigee: new Uint32Array(n),
    meanAnomaly: new Uint32Array(n),
    bstar: new Float32Array(n),
    meanMotionDot: new Int32Array(n),
    meanMotionDdot: new Float32Array(n),
    elementSetNumber: new Uint16Array(n),
    revAtEpoch: new Uint32Array(n),
    rank: new Uint32Array(n),
  };
  if (created !== undefined) columns.created = new Float64Array(n);
  ranked.forEach(({ row, rank }, i) => {
    const [number, epoch, meanMotion, eccentricity, inclination, raan, argOfPerigee, meanAnomaly, bstar, meanMotionDot, meanMotionDdot, elementSetNumber, revAtEpoch] = row as [number, string, number, number, number, number, number, number, number, number, number, number, number];
    columns.number[i] = number;
    columns.epoch[i] = Date.parse(epoch);
    columns.meanMotion[i] = Math.round(meanMotion * 1e8);
    columns.eccentricity[i] = Math.round(eccentricity * 1e7);
    columns.inclination[i] = Math.round(inclination * 1e4);
    columns.raan[i] = Math.round(raan * 1e4);
    columns.argOfPerigee[i] = Math.round(argOfPerigee * 1e4);
    columns.meanAnomaly[i] = Math.round(meanAnomaly * 1e4);
    columns.bstar[i] = bstar;
    columns.meanMotionDot[i] = Math.round(meanMotionDot * 1e8);
    columns.meanMotionDdot[i] = meanMotionDdot;
    columns.elementSetNumber[i] = elementSetNumber;
    columns.revAtEpoch[i] = revAtEpoch;
    columns.rank[i] = rank;
    if (created !== undefined) columns.created![i] = created(row, rank);
  });
  const table: ArchivedBody[] = [];
  for (const body of bodies) {
    const first = columns.number.indexOf(body.number);
    const count = columns.number.lastIndexOf(body.number) - first + 1;
    if (first !== -1) table.push({ ...body, first, count });
  }
  table.sort((a, b) => a.first - b.first);
  const manifest: Manifest = {
    format: 1,
    year: YEAR,
    source: { kind: "bundle", file: "synthetic", bytes: 0, sha256: "", member: "synthetic", memberBytes: 0 },
    columns: created === undefined ? [...REQUIRED_COLUMNS] : [...REQUIRED_COLUMNS, "created"],
    sets: n,
    bodies: table.length,
    withoutSatcat: 0,
    satcat: null,
    rejects: 0,
    rejectSamples: [],
    columnSha256: {},
    builtAt: "2026-01-01T00:00:00.000Z",
    buildSeconds: 0,
  };
  return { manifest, bodies: table, columns };
}

const sets = JSON.parse(readFileSync(join(FIXTURE, "sets.json"), "utf8")) as SetsFile;
const bodies = JSON.parse(readFileSync(join(FIXTURE, "bodies.json"), "utf8")) as Omit<ArchivedBody, "first" | "count">[];
const truthFile = JSON.parse(readFileSync(join(FIXTURE, "breakups.json"), "utf8")) as unknown;
const truth = { breakups: readBreakups(truthFile), sha256: "synthetic" };

const work = mkdtempSync(join(tmpdir(), "breakups-kpi-"));
const archive = join(work, "archive");
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** The jump detector, plus one cloud verdict on the launch of the first event at the run of 1 March. */
const CLOUD_AT = at(3, 1);
const stub = (input: DetectorInput) => {
  const output = jumpDetector(1)(input);
  if (input.now === CLOUD_AT) {
    const cloud: Verdict = { kind: "cloud", state: "cloud-only", number: null, launch: "2010-001", raisedAt: input.now, step: null, event: null, evidence: {}, reasons: ["two new bodies under the launch"] };
    output.verdicts.push(cloud);
  }
  return output;
};

describe("the scorecard on the synthetic year", () => {
  writeYear(archive, yearOf(sets.rows, bodies));
  const file = scoreYear(archive, YEAR, truth, { detector: stub, detectorName: "jump" });
  const events = Object.fromEntries(file.score.events.map((e) => [e.name, e]));
  const alerts = file.score.alerts;

  test("replays the year in runs of four hours, timed by the epoch, with no previous year to warm up from", () => {
    expect(file.sets).toBe(sets.rows.length);
    expect(file.timeBasis).toBe("epoch");
    expect(file.warmup).toBeNull();
    expect(file.carried).toBe(false);
    // The first of January to the last of March, one run every four hours, bins with no set included.
    expect(file.runs).toBeGreaterThanOrEqual((at(3, 31) - at(1, 1)) / (4 * HOUR));
    expect(file.runs).toBeLessThan((at(3, 31) - at(1, 1)) / (4 * HOUR) + 3);
    expect(file.bodyYears).toBeGreaterThan(1);
    // The parameters recorded are the library's, which the trivial detector ignores: the file says what the library would have run with.
    expect(file.detector).toEqual({ name: "jump", parameters: DETECTOR_PARAMETERS });
  });

  test("lists the three scoreable events and not the aerodynamic row", () => {
    expect(Object.keys(events).sort()).toEqual(["ALPHA", "BETA", "EPSILON"]);
    for (const event of Object.values(events)) expect(event.line).toBe("breakups A-B");
  });

  test("a step on the parent before the fragments' first set is a detection, with its lead, latency and timing error", () => {
    const alpha = events.ALPHA!;
    expect(alpha.status).toBe("detected");
    // Daily sets from 1 January to 10 February, all within the sixty days before the event.
    expect(alpha.parentSetsBefore).toBe(41);
    // The post-event set has the epoch of 11 February 00:00 and is handed over at the end of its four-hour bin.
    expect(alpha.alertAt).toBe(at(2, 11, 4));
    expect(alpha.step).toMatchObject({ beforeEpoch: at(2, 10), afterEpoch: at(2, 11) });
    // The fragments' first sets are dated 13 February: the lower number is the body named.
    expect(alpha.catalogueAt).toBe(at(2, 13));
    expect(alpha.catalogueBody).toBe(40101);
    expect(alpha.catalogueBasis).toBe("epoch");
    expect(alpha.leadHours).toBe(44);
    expect(alpha.latencyHours).toBe(22.5);
    // The jump detector dates the event at the middle of its bracket, noon on the 10th, against 05:30.
    expect(alpha.timingErrorMinutes).toBe(390);
    expect(alpha.confirmedAt).toBeNull();
  });

  test("a step raised only after the fragment was published is late, listed apart", () => {
    const beta = events.BETA!;
    expect(beta.status).toBe("late");
    expect(beta.catalogueAt).toBe(at(3, 8));
    expect(beta.catalogueBody).toBe(40201);
    expect(beta.alertAt).toBe(at(3, 12, 4));
    expect(beta.leadHours).toBeLessThan(0);
    expect(beta.latencyHours).toBe((at(3, 12, 4) - at(3, 5)) / HOUR);
  });

  test("a parent with too few sets before the event is undetectable, out of the denominator", () => {
    const epsilon = events.EPSILON!;
    expect(epsilon.status).toBe("undetectable");
    expect(epsilon.parentSetsBefore).toBe(2);
    expect(epsilon.alert).toBeNull();
  });

  test("every alert lands in one place: detection, late, two kinds of duplicate, two kinds of exempt, one false alarm", () => {
    const landed = alerts.map((a) => `${a.number} ${a.outcome} ${a.event ?? "-"}`).sort();
    expect(landed).toEqual(
      [
        "40001 detection 40001:2013-02-10",
        "40001 duplicate 40001:2013-02-10",
        "40101 duplicate 40001:2013-02-10",
        "40002 late 40002:2013-03-05",
        "40003 false-alarm -",
        "40004 exempt 40004:2013-01-25",
        "40005 exempt 40005:2013-03-20",
      ].sort(),
    );
    expect(alerts.find((a) => a.number === 40101)!.note).toBe("an alert on a fragment of a reported event");
    expect(alerts.find((a) => a.number === 40004)!.note).toBe("inside the window of an aerodynamic breakup at reentry");
    expect(alerts.find((a) => a.number === 40005)!.note).toBe("the parent had too few public sets before the event to be scored");
  });

  test("the cloud verdict goes to the review list and counts as nothing", () => {
    expect(file.score.review).toEqual([{ verdict: expect.any(Number), launch: "2010-001", number: null, raisedAt: CLOUD_AT, state: "cloud-only", pieces: 0 }]);
    expect(file.verdicts.filter((v) => v.kind === "cloud")).toHaveLength(1);
  });

  test("the cells add the year up", () => {
    const cells = cellsOf([file]);
    expect(cells.lines["breakups A-B"]).toEqual({ targets: 2, undetectable: 1, detected: 1, late: 1, missed: 0, detectionRate: 0.5 });
    for (const line of ["breakups C", "breakups D", "anomalous A-B", "anomalous C-D"] as const) expect(cells.lines[line]).toEqual({ targets: 0, undetectable: 0, detected: 0, late: 0, missed: 0, detectionRate: null });
    expect(cells).toMatchObject({ alerts: 7, duplicates: 2, exempt: 2, falseAlarms: 1, review: 1, falseAlarmRate: 0.5, confirmedShare: 0, daysToConfirmation: null, timingErrorMinutes: 390 });
    // The tiers: as raised, the detection, the late alert and the false alarm are the three counted; the trivial detector logs no alert row, so no later tier is reached.
    expect(cells.tiers[0]).toEqual({ tier: "2", raised: 3, detections: 1, falseAlarms: 1, precision: 0.5, detectionShare: 1, leadHours: { median: 44, tail: 44, count: 1 } });
    expect(cells.tiers.slice(1).every((t) => t.raised === 0 && t.detections === 0 && t.precision === null && t.detectionShare === 0)).toBe(true);
    expect(cells.confirmed).toEqual({ confirmations: 0, ofTrue: 0, ofExempt: 0, ofFalseAlarms: 0, daysToConfirmation: null });
    expect(cells.leadHours).toEqual({ median: 44, tail: 44, count: 1 });
    expect(cells.latencyHours).toEqual({ median: 22.5, tail: 22.5, count: 1 });
    expect(cells.falseAlarmsPer10kBodyYears).toBeCloseTo(10_000 / file.bodyYears, 6);
    expect(cells.byRegime.LEO).toEqual(cells.lines["breakups A-B"]);
    expect(cells.byKind.breakup).toEqual(cells.lines["breakups A-B"]);
  });

  test("the year file and the aggregate are written and read back, and the tables show the cells", () => {
    const dir = join(work, "kpi");
    writeYearFile(dir, file);
    const latest = writeAggregate(dir, truth, ROOT);
    const read = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8")) as Latest;
    expect(read).toEqual(latest);
    expect(latest.years).toEqual([YEAR]);
    expect(latest.detector.name).toBe("jump");
    expect(latest.truthSha256).toBe("synthetic");
    expect(latest.archive[String(YEAR)]).toMatchObject({ source: "bundle", sets: sets.rows.length, timeBasis: "epoch" });
    // An odd year is in the validation split and not in the training one.
    expect(latest.splits.validation.years).toEqual([YEAR]);
    expect(latest.splits.train.years).toEqual([]);
    expect(latest.splits.train.lines["breakups A-B"].targets).toBe(0);
    const [lines, alertsTable, tiers] = readmeTables(latest);
    expect(tiers).toContain("| 2 post sets over 18 h, or 3 (as raised) | 3 | 1 | 1 | 50% | 100% | 44.0 (44.0) |");
    expect(tiers).toContain("| 7 days of post sets | 0 | 0 | 0 | – | 0% | – |");
    expect(lines).toContain("| Breakups, confidence A and B (the target is 90%) | 2 | 1 | 1 | 1 | 0 | 50% |");
    expect(lines).toContain("| Breakups, confidence C | 0 | 0 | 0 | 0 | 0 | – |");
    expect(alertsTable).toContain("| False alarms | 1 |");
    expect(alertsTable).toContain("| False-alarm rate (the target is under 10%) | 50% |");
    expect(alertsTable).toContain("| Lead over the catalogue, hours: median (10th percentile) | 44.0 (44.0) |");
    expect(alertsTable).toContain("| Cloud verdicts, for review (a burst with no parent step) | 1 |");
    expect(alertsTable).toContain("| Alerts confirmed by the fragments or a notice | 0 |");
    const markdown = readFileSync(join(dir, "latest.md"), "utf8");
    expect(markdown).toBe(renderLatest(latest));
    expect(markdown).toContain(lines);
    expect(markdown).toContain("| 2013 | bundle | 2026-01-01 | 575 | 9 | epoch (a lower bound) |");
  });
});

describe("the replay's runs", () => {
  test("a year with publication times is sliced by them, bins with no set included, and the rows carry them", () => {
    const rows = sets.rows.filter((row) => row[0] === 40006).slice(0, 3);
    // Three sets of one object published at 01:00, 02:00 and 09:00 on 1 January: two runs with sets and one empty between.
    const created = (_row: unknown, rank: number): number => at(1, 1, rank === 3 ? 9 : rank);
    writeYear(join(work, "pulled"), yearOf(rows, bodies, created));
    const loaded = loadYear(join(work, "pulled"), YEAR);
    expect(loaded.timeBasis).toBe("created");
    const runs = [...runsOf(loaded)];
    expect(runs.map((run) => [new Date(run.now).toISOString(), run.sets.length])).toEqual([
      ["2013-01-01T04:00:00.000Z", 2],
      ["2013-01-01T08:00:00.000Z", 0],
      ["2013-01-01T12:00:00.000Z", 1],
    ]);
    expect(runs[0]!.sets[0]).toMatchObject({ number: 40006, designator: "2010-006A", bodyClass: "payload", createdMs: at(1, 1, 1), epochMs: at(1, 1) });
    expect(runs[0]!.sets[0]!.meanMotion).toBeCloseTo(rows[0]![2] as number, 7);
  });

  test("a set with a wild epoch moves the clock a day at most, so the sets after it still run on time", () => {
    const rows = sets.rows.filter((row) => row[0] === 40006).slice(0, 5).map((row) => [...row]);
    rows[1]![1] = "2020-06-01T00:00:00.000Z";
    const year = yearOf(rows, bodies);
    const loaded: LoadedYear = { year: YEAR, manifest: year.manifest, bodies: year.bodies, byNumber: new Map(year.bodies.map((b) => [b.number, b])), columns: year.columns, order: Uint32Array.from(year.columns.rank.map((_, i) => i)), timeBasis: "epoch" };
    const runs = [...runsOf(loaded)].filter((run) => run.sets.length > 0);
    // The wild set moves the clock a day past the set before it, not seven years, and the sets after it run on their own days.
    expect(runs.map((run) => [new Date(run.now).toISOString().slice(0, 13), run.sets.map((s) => new Date(s.epochMs).toISOString().slice(0, 10))])).toEqual([
      ["2013-01-01T04", ["2013-01-01"]],
      ["2013-01-02T04", ["2020-06-01"]],
      ["2013-01-03T04", ["2013-01-03"]],
      ["2013-01-04T04", ["2013-01-04"]],
      ["2013-01-05T04", ["2013-01-05"]],
    ]);
  });

  test("an Archive set becomes the light row the detector reads", () => {
    const row = fromArchivedSet({ number: 25544, epoch: at(1, 1), meanMotion: 15.5, eccentricity: 0.0007, inclination: 51.6, raan: 100, argOfPerigee: 200, meanAnomaly: 300, bstar: 1e-4, meanMotionDot: 1e-5, meanMotionDdot: 0, elementSetNumber: 999, revAtEpoch: 1, rank: 1, created: at(1, 1, 3) }, { designator: "1998-067A", bodyClass: "payload" });
    expect(row).toEqual({ number: 25544, designator: "1998-067A", epochMs: at(1, 1), createdMs: at(1, 1, 3), meanMotion: 15.5, eccentricity: 0.0007, inclinationDeg: 51.6, raanDeg: 100, argpDeg: 200, meanAnomalyDeg: 300, bstar: 1e-4, meanMotionDot: 1e-5, meanMotionDdot: 0, elementSetNumber: 999, bodyClass: "payload" });
    expect(fromArchivedSet({ ...row, epoch: 0, inclination: 0, raan: 0, argOfPerigee: 0, meanAnomaly: 0, revAtEpoch: 0, rank: 2 }, undefined)).toMatchObject({ designator: null, createdMs: null, bodyClass: "unknown" });
  });
});

describe("the matching rule's pieces", () => {
  test("a step brackets a window when the two, each widened by a day, overlap", () => {
    const step = { beforeEpoch: at(2, 10), afterEpoch: at(2, 11), deltaKm: -3, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 1, z: null };
    expect(brackets(step, at(2, 10, 5, 30), at(2, 10, 5, 30))).toBe(true);
    expect(brackets(step, at(2, 12), at(2, 12))).toBe(true);
    expect(brackets(step, at(2, 12, 0, 1), at(2, 13))).toBe(false);
    expect(brackets(step, at(2, 1), at(2, 9))).toBe(true);
    expect(brackets(step, at(2, 1), at(2, 8, 23, 59))).toBe(false);
    expect(brackets(null, at(2, 10), at(2, 11))).toBe(false);
  });

  test("the margin is a day in low and medium orbits and five days in highly elliptical and geosynchronous ones", () => {
    expect(marginDaysOf("LEO")).toBe(1);
    expect(marginDaysOf("MEO")).toBe(1);
    expect(marginDaysOf("HEO")).toBe(5);
    expect(marginDaysOf("GEO")).toBe(5);
    expect(marginDaysOf("unknown")).toBe(1);
    // A step four days before a stated instant matches in a highly elliptical orbit and not in a low one.
    const step = { beforeEpoch: at(2, 6), afterEpoch: at(2, 7), deltaKm: -3, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 1, z: null };
    expect(brackets(step, at(2, 11), at(2, 11), marginDaysOf("HEO"))).toBe(true);
    expect(brackets(step, at(2, 11), at(2, 11), marginDaysOf("LEO"))).toBe(false);
  });

  test("a year replayed from carried states skips the warm-up and says so, and the states carry an object's record across the boundary", () => {
    writeYear(join(work, "carried"), yearOf(sets.rows, bodies));
    const first = replayAndScore(join(work, "carried"), YEAR, truth, { detector: stub, detectorName: "jump" });
    const again = replayAndScore(join(work, "carried"), YEAR, truth, { detector: stub, detectorName: "jump", carried: carriedOf(first.result) });
    expect(again.file.carried).toBe(true);
    expect(again.file.warmup).toBeNull();
    expect(again.result.states).toBe(first.result.states);
    // The states file round-trips the numbers JSON cannot carry.
    const path = join(work, "states", "2013.json.gz");
    const states = new Map<number, unknown>([[1, { never: Number.NEGATIVE_INFINITY, unmeasured: Number.NaN, steps: [{ epochMs: 1, deltaKm: 0.5 }], regime: "LEO", nested: new Map([["a", Number.POSITIVE_INFINITY]]) }]]);
    writeStates(path, { format: 1, year: YEAR, states, launches: new Map() });
    const read = readStates(path);
    expect(read.year).toBe(YEAR);
    const state = read.states.get(1) as { never: number; unmeasured: number; steps: unknown[]; regime: string; nested: Map<string, number> };
    expect(state.never).toBe(Number.NEGATIVE_INFINITY);
    expect(Number.isNaN(state.unmeasured)).toBe(true);
    expect(state.steps).toEqual([{ epochMs: 1, deltaKm: 0.5 }]);
    expect(state.regime).toBe("LEO");
    expect(state.nested.get("a")).toBe(Number.POSITIVE_INFINITY);
  });

  test("the lines by kind and confidence", () => {
    expect(lineOf({ kind: "breakup", confidence: "A" })).toBe("breakups A-B");
    expect(lineOf({ kind: "breakup", confidence: "B" })).toBe("breakups A-B");
    expect(lineOf({ kind: "breakup", confidence: "C" })).toBe("breakups C");
    expect(lineOf({ kind: "breakup", confidence: "D" })).toBe("breakups D");
    expect(lineOf({ kind: "anomalous", confidence: "B" })).toBe("anomalous A-B");
    expect(lineOf({ kind: "anomalous", confidence: "D" })).toBe("anomalous C-D");
  });

  test("the notices come from the truth, timed by the day each was seen", () => {
    const notices = noticesOf(readTruth().breakups);
    expect(notices.length).toBeGreaterThan(0);
    const usa32 = notices.find((n) => n.number === 19460);
    expect(usa32).toMatchObject({ launch: "1988-078", at: Date.UTC(2026, 8, 17) });
  });

  test("the splits and the percentile", () => {
    const years = [2005, 2006, 2016, 2017, 2018, 2025, 2026];
    expect(splitYears(years, "validation")).toEqual([2005, 2017, 2025]);
    expect(splitYears(years, "train")).toEqual([2006, 2016, 2018, 2026]);
    expect(splitYears(years, "recent")).toEqual([2018, 2025, 2026]);
    expect(splitYears(years, "chronologicalTrain")).toEqual([2005, 2006, 2016, 2017]);
    expect(splitYears(years, "chronologicalValidation")).toEqual([2018, 2025, 2026]);
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([5, 1, 3, 4], 10)).toBe(1);
    expect(percentile([5, 1, 3, 4], 90)).toBe(5);
  });
});
