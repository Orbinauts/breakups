import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test } from "vitest";
import { ATTRIBUTION_PATHS, DETECTOR_PARAMETERS, PHASES, REFUSALS, readBreakups, type Breakup, type DetectorInput, type LogRow, type Verdict } from "../src/index.ts";
import { decide, namedOf, rulesOf } from "../scripts/kpi/attributions.ts";
import { REQUIRED_COLUMNS, catalogueIndexPath, releaseManifestPath, writeYear, type ArchivedBody, type Columns, type Manifest } from "../scripts/archive/archive.ts";
import { readCatalogue } from "../scripts/kpi/catalogue.ts";
import { jumpDetector } from "../scripts/kpi/jump.ts";
import { SCORED_FROM_YEAR, alertKey, cellsOf, confirmedCellsOf, firstConfirmationsOf, percentile, readingOf, resultsTables, renderLatest, scopedCellsOf, splitYears, wilson, type Latest } from "../scripts/kpi/kpi.ts";
import { STATION_LAUNCHES, VISITING_LAUNCHES, brackets, landConfirmed, lineOf, lowerOf, marginDaysOf, noticesOf, type Row, type ScoredAlert, type ScoredEvent, type YearScore } from "../scripts/kpi/match.ts";
import { fromArchivedSet, loadYear, runsOf, type LoadedYear } from "../scripts/kpi/replay.ts";
import { carriedOf, catalogueOf, readTruth, replayAndScore, rematch, scoreYear, writeAggregate, writeYearFile } from "../scripts/kpi/run.ts";
import { buildCatalogueIndex, loadCatalogue, readCatalogueIndex, writeCatalogueIndex } from "../scripts/kpi/catalogue-index.ts";
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
// The fixture's table says no decay where none is known, as a stripped table says null.
const bodies = (JSON.parse(readFileSync(join(FIXTURE, "bodies.json"), "utf8")) as Omit<ArchivedBody, "first" | "count">[]).map((body) => ({ ...body, decay: body.decay ?? null }));
const truthFile = JSON.parse(readFileSync(join(FIXTURE, "breakups.json"), "utf8")) as unknown;
const truth = { breakups: readBreakups(truthFile), sha256: "synthetic" };

const work = mkdtempSync(join(tmpdir(), "breakups-kpi-"));
const archive = join(work, "archive");
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A year written into an Archive with the catalogue index the scorecard reads, built from it as `npm run kpi:index` builds it. */
function writeIndexedYear(at: string, year: Parameters<typeof writeYear>[1]): void {
  writeYear(at, year);
  writeCatalogueIndex(at, buildCatalogueIndex(at, truth.breakups, truth.sha256, false));
}

/**
 * The jump detector, plus one cloud verdict on the launch of the first
 * event at the run of 1 March, and three confirmed verdicts with no step,
 * as the Confirmed channel attributes them from the pieces: ALPHA's on 14
 * February (its fragments, published the 13th, lie in its plane in the
 * fixture), ALPHA's again on 20 February (a duplicate), and one on GAMMA's
 * rocket body on 25 March, which matches no reported event.
 */
const CLOUD_AT = at(3, 1);
const CONFIRMED_AT = at(2, 14, 4);
const attributedOn = (number: number, now: number, eventAt: number, bodyClass: number): Verdict => ({ kind: "object", state: "confirmed", number, launch: `2010-00${number % 10}`, raisedAt: now, step: null, event: { at: eventAt, from: eventAt - HOUR, to: eventAt + HOUR }, evidence: { attributed: 1, sigmaMinutes: 20, bodyClass }, reasons: ["attributed from the pieces"], bodies: [] });
const stub = (input: DetectorInput) => {
  const output = jumpDetector(1)(input);
  if (input.now === CLOUD_AT) {
    const cloud: Verdict = { kind: "cloud", state: "cloud-only", number: null, launch: "2010-001", raisedAt: input.now, step: null, event: null, evidence: {}, reasons: ["two new bodies under the launch"] };
    output.verdicts.push(cloud);
  }
  if (input.now === CONFIRMED_AT) output.verdicts.push(attributedOn(40001, input.now, at(2, 10, 6), 0));
  if (input.now === at(2, 20, 4)) output.verdicts.push(attributedOn(40001, input.now, at(2, 10, 6), 0));
  if (input.now === at(3, 25, 4)) output.verdicts.push(attributedOn(40003, input.now, at(3, 24), 1));
  return output;
};

describe("the scorecard on the synthetic year", () => {
  writeIndexedYear(archive, yearOf(sets.rows, bodies));
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
    // Both fragments appeared within ninety days: the catalogue reported the event. Daily sets from the event to the fragments: the 10th (before the event's instant that day), the 11th and the 12th.
    expect(alpha.piecesWithin90Days).toBe(2);
    expect(alpha.parentSetsAfter).toBe(2);
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
    expect(beta.piecesWithin90Days).toBe(1);
  });

  test("a false alarm on the parent of a reported event within the month after it is noted as near that event", () => {
    // The jump detector raises the ALPHA parent's step on 11 February (the detection) and nothing later on it, so the synthetic false alarm (GAMMA R/B) is near no event; a verdict placed on ALPHA three weeks after its event would be.
    const gamma = alerts.find((a) => a.number === 40003)!;
    expect(gamma.nearEvent).toBeNull();
    const late: Verdict = { kind: "object", state: "suspected", number: 40001, launch: "2010-001", raisedAt: at(3, 4, 4), step: { beforeEpoch: at(3, 2), afterEpoch: at(3, 3), deltaKm: -2, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 1, z: null }, event: null, evidence: {}, reasons: [] };
    const scored = scoreYear(archive, YEAR, truth, { detector: (input) => ({ ...stub(input), verdicts: input.now === late.raisedAt ? [late] : [] }), detectorName: "jump" });
    const landed = scored.score.alerts.find((a) => a.number === 40001)!;
    expect(landed.outcome).toBe("false-alarm");
    expect(landed.nearEvent).toBe("40001:2013-02-10");
    expect(landed.note).toContain("whose window ended within the month before the step");
  });

  test("the catalogue's mark follows the publication order, not a late body's back-dated epoch", () => {
    // A body numbered above ALPHA's fragments, catalogued last (the highest rank) but with a set epoch of 1 January: by its epoch it would raise the mark above the fragments and hide them; by the clock it appeared in March.
    const rows = [...sets.rows.map((row) => [...row]), [40900, "2013-01-01T00:00:00.000Z", 14.2, 0.001, 98, 100, 0, 0, 1e-4, 1e-6, 0, 1, 1]];
    const late = [...bodies, { number: 40900, designator: "1999-001AB", name: "OLD DEB", bodyClass: "debris" as const, launch: "1999-01-01", decay: null }];
    writeIndexedYear(join(work, "backdated"), yearOf(rows, late));
    const scored = scoreYear(join(work, "backdated"), YEAR, truth, { detector: stub, detectorName: "jump" });
    const alpha = scored.score.events.find((e) => e.name === "ALPHA")!;
    expect(alpha.catalogueBody).toBe(40101);
    expect(alpha.catalogueAt).toBe(at(2, 13));
    expect(alpha.status).toBe("detected");
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

  test("the Confirmed line: the targets are the events whose fragments lie in the parent's plane, and the confirmed verdicts land on them or nowhere", () => {
    // ALPHA's fragments lie in its plane; BETA's piece and EPSILON's none do not.
    expect(events.ALPHA!.fragments).toEqual({ inPlane: 2, firstAt: at(2, 13), firstBody: 40101, parentOrbit: true });
    expect(events.BETA!.fragments!.inPlane).toBe(0);
    expect(events.EPSILON!.fragments!.inPlane).toBe(0);
    expect(events.ALPHA!.statement).toEqual({ at: Date.UTC(YEAR, 3, 1), precision: "month", source: "hoosf-16e" });
    expect(events.BETA!.statement).toBeNull();
    // The confirmed verdicts with no step are the Confirmed line's alone: none landed among the alerts on the parent's step.
    expect(alerts.every((a) => a.state !== "confirmed")).toBe(true);
    expect(file.score.confirmations!.map((c) => `${c.number} ${c.outcome} ${c.event ?? "-"} ${c.attributed}`)).toEqual(["40001 detection 40001:2013-02-10 true", "40001 detection 40001:2013-02-10 true", "40003 false-alarm - true"]);
    const c = cellsOf([file]).confirmedLine;
    expect(c.lines["breakups A-B"]).toEqual({ targets: 1, noFragments: 2, noParentOrbit: 0, detected: 1, missed: 0, rate: 1, interval: wilson(1, 1) });
    expect(c).toMatchObject({ verdicts: 3, attributed: 3, detections: 1, duplicates: 1, exempt: 0, falseAlarms: 1, detectedAllLines: 1, detectedNoFragments: 0, falseAttributed: 1, withStatement: 1, beforeStatement: 1, statementDays: 0, statementMonths: 1 });
    expect(c.falseByClass).toEqual({ payload: 0, "rocket body": 1, debris: 0, unknown: 0 });
    expect(c.falseAlarmRate).toBe(0.5);
    // The lead over the April issue, the lag after the first fragment's publication on the 13th, and the instant's error against 05:30.
    expect(c.lead!.median).toBeCloseTo((Date.UTC(YEAR, 3, 1) - CONFIRMED_AT) / DAY, 9);
    expect(c.lag!.median).toBeCloseTo((CONFIRMED_AT - at(2, 13)) / DAY, 9);
    expect(c.timing).toEqual({ median: 30, tail: 30, count: 1 });
  });

  test("an event's first confirmation counts in its own year's cells, wherever its file is", () => {
    const next = { year: YEAR + 1, score: { ...file.score, year: YEAR + 1, events: [], alerts: [], review: [], confirmations: file.score.confirmations!.slice(0, 1).map((c) => ({ ...c, raisedAt: c.raisedAt - DAY })) } };
    const both = [file, next];
    const first = firstConfirmationsOf(both);
    expect(first.get("40001:2013-02-10")!.year).toBe(YEAR + 1);
    const c = confirmedCellsOf([file], first);
    // In this year's file both of ALPHA's confirmations are now duplicates, and the event is still detected, by the next year's.
    expect(c).toMatchObject({ detections: 0, duplicates: 2, detectedAllLines: 1 });
    expect(c.lines["breakups A-B"].detected).toBe(1);
  });

  test("the cloud verdict goes to the review list and counts as nothing", () => {
    expect(file.score.review).toEqual([{ verdict: expect.any(Number), launch: "2010-001", number: null, raisedAt: CLOUD_AT, state: "cloud-only", pieces: 0 }]);
    expect(file.verdicts.filter((v) => v.kind === "cloud")).toHaveLength(1);
  });

  test("the cells add the year up", () => {
    const cells = cellsOf([file]);
    expect(cells.lines["breakups A-B"]).toEqual({ targets: 2, undetectable: 1, detected: 1, late: 1, missed: 0, detectionRate: 0.5, detectionInterval: wilson(1, 2) });
    for (const line of ["breakups C", "breakups D", "anomalous A-B", "anomalous C-D"] as const) expect(cells.lines[line]).toEqual({ targets: 0, undetectable: 0, detected: 0, late: 0, missed: 0, detectionRate: null, detectionInterval: null });
    // The false-alarm rate's interval: one less the precision's, one detection against one false alarm.
    const precision = wilson(1, 2)!;
    expect(cells.falseAlarmInterval).toEqual([1 - precision[1], 1 - precision[0]]);
    expect(cells).toMatchObject({ alerts: 7, duplicates: 2, exempt: 2, falseAlarms: 1, review: 1, falseAlarmRate: 0.5, confirmedShare: 0, daysToConfirmation: null, timingErrorMinutes: 390 });
    // The tiers: as raised, the detection, the late alert and the false alarm are the three counted; the trivial detector logs no alert row, so no later tier is reached.
    expect(cells.tiers[0]).toEqual({ tier: "2", raised: 3, detections: 1, falseAlarms: 1, precision: 0.5, detectionShare: 1, leadHours: { median: 44, tail: 44, count: 1 } });
    expect(cells.tiers.slice(1).every((t) => t.raised === 0 && t.detections === 0 && t.precision === null && t.detectionShare === 0)).toBe(true);
    // The confirmed line: two targets the catalogue reported (ALPHA's and BETA's fragments), both alerted, neither confirmed by the trivial detector; the truth carries no agency statement.
    expect(cells.confirmed).toEqual({ confirmations: 0, ofTrue: 0, ofExempt: 0, ofFalseAlarms: 0, ofNearEvent: 0, daysToConfirmation: null, precision: null, precisionByParent: null, reported: 2, reportedAlerted: 2, reportedConfirmed: 0, confirmedRate: 0, daysFromEvent: null, daysFromAlert: null, withStatement: 0, beforeStatement: 0 });
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
    const [headline, confirmedLines, confirmedVerdicts, earlyHeadline, lines, scoped, alertsTable, tiers, confirmed] = resultsTables(latest);
    // The early warning's headline: one detection, one late, one false alarm in the one year, the rates with their intervals.
    expect(earlyHeadline).toContain(`| Validation: the odd years (${YEAR}) | 2 | 1 | 1 | 1 | 0 | 50% (9% to 91%) | 1 | 50% (9% to 91%) | 1.0 |`);
    // The Confirmed headline, its lines and its verdicts: ALPHA confirmed, BETA and EPSILON listed apart, GAMMA's rocket body a false confirmation.
    expect(headline).toContain(`| Validation: the odd years (${YEAR}) | 1 | 2 | 1 | 0 | 100% (21% to 100%) | 1 | 50% (9% to 91%) | 45.8 (45.8) | 1 of 1 | 1.2 (1.2) | 30.0 (30.0) |`);
    expect(headline).toContain("| Training: the even years (no year) | 0 | 0 | 0 | 0 | – | 0 | – | – | – | – | – |");
    expect(confirmedLines).toContain("| Breakups, confidence A and B (the target is 90%) | 1 | 2 | 0 | 1 | 0 | 100% (21% to 100%) |");
    expect(confirmedVerdicts).toContain("| False confirmations (matching no reported event) | 1 |");
    expect(confirmedVerdicts).toContain("| Of which the statement dated to the day / to the month | 0 / 1 |");
    // The scoped line: the synthetic bodies carry no launch day, so no parent is known to be five years old and the scope leaves every headline event out, which the table says.
    expect(scoped).toContain("| The whole catalogue | 2 | 1 | 1 | 1 | 0 |");
    expect(scoped).toContain("| Scoped | 0 | 0 | 0 | 0 | 0 | – | 0 | – | 3 of 3 |");
    expect(tiers).toContain("| 2 post sets over 18 h, or 3 (as raised) | 3 | 1 | 1 | 50% | 100% | 44.0 (44.0) |");
    expect(confirmed).toContain("| Events the catalogue reported (new bodies under the launch within 90 days) | 2 |");
    expect(confirmed).toContain("| Of which alerted on the parent (detected or late) | 2 |");
    expect(confirmed).toContain("| Confirmed share of the reported events | 0% |");
    expect(confirmed).toContain("| Precision of the confirmed alerts, on the step | – |");
    expect(confirmed).toContain("| Targets with an agency's statement dated in the truth (the notices) | 0 |");
    expect(tiers).toContain("| 7 days of post sets | 0 | 0 | 0 | – | 0% | – |");
    expect(lines).toContain("| Breakups, confidence A and B (the headline line) | 2 | 1 | 1 | 1 | 0 | 50% (9% to 91%) |");
    expect(lines).toContain("| Breakups, confidence C | 0 | 0 | 0 | 0 | 0 | – |");
    expect(alertsTable).toContain("| False alarms | 1 |");
    expect(alertsTable).toContain("| False-alarm rate | 50% |");
    expect(alertsTable).toContain("| Lead over the catalogue, hours: median (10th percentile) | 44.0 (44.0) |");
    expect(alertsTable).toContain("| Cloud verdicts, for review (a burst with no parent step) | 1 |");
    const markdown = readFileSync(join(dir, "latest.md"), "utf8");
    expect(markdown).toBe(renderLatest(latest));
    expect(markdown).toContain(lines);
    expect(markdown).toContain(confirmed);
    // The dissection is written beside the aggregate (under `docs/detector/` for the committed one), one row per scoreable event with its cause.
    const events = readFileSync(join(dir, "events.md"), "utf8");
    expect(events).toContain("| 2013 | ALPHA (40001, 2010-001), 2013-02-10 | LEO | confirmed | attributed from the pieces 3.9 d after the event, 1.2 d after the first fragment's publication, 45.8 d before the first agency statement (hoosf-16e, to the month) | detected | raised |");
    expect(events).toContain("| 2013 | BETA (40002, 2010-002), 2013-03-05 to 2013-03-06 | LEO | no fragments catalogued |  | late | no post set before the catalogue |");
    expect(events).toContain("| 2013 | EPSILON (40005, 2010-005), 2013-03-20 | LEO | no fragments catalogued |  | undetectable | no public sets |");
    expect(events).toContain("| no public sets | 1 | 1 | 1 |");
    expect(events).toContain("| confirmed | 0 | 1 | 1 |");
    expect(events).toContain("| no fragments catalogued | 0 | 2 | 2 |");
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
    const loaded: LoadedYear = { year: YEAR, manifest: year.manifest, bodies: year.bodies, byNumber: new Map(year.bodies.map((b) => [b.number, b])), statusByNumber: new Map(), endedByNumber: new Map(), endedFromByNumber: new Map(), launchedByNumber: new Map(), columns: year.columns, order: Uint32Array.from(year.columns.rank.map((_, i) => i)), timeBasis: "epoch" };
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
    expect(row).toEqual({ number: 25544, designator: "1998-067A", epochMs: at(1, 1), createdMs: at(1, 1, 3), meanMotion: 15.5, eccentricity: 0.0007, inclinationDeg: 51.6, raanDeg: 100, argpDeg: 200, meanAnomalyDeg: 300, bstar: 1e-4, meanMotionDot: 1e-5, meanMotionDdot: 0, elementSetNumber: 999, bodyClass: "payload", opsStatus: "unknown", endedByMs: null, endedFromMs: null, launchedMs: null });
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
    writeIndexedYear(join(work, "carried"), yearOf(sets.rows, bodies));
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

  test("the splits and the percentile: 2005, the warm-up year, is replayed and scored on no split", () => {
    const years = [2005, 2006, 2016, 2017, 2018, 2025, 2026];
    expect(SCORED_FROM_YEAR).toBe(2006);
    expect(splitYears(years, "validation")).toEqual([2017, 2025]);
    expect(splitYears(years, "train")).toEqual([2006, 2016, 2018, 2026]);
    expect(splitYears(years, "all")).toEqual([2006, 2016, 2017, 2018, 2025, 2026]);
    expect(splitYears(years, "recent")).toEqual([2018, 2025, 2026]);
    expect(splitYears(years, "chronologicalTrain")).toEqual([2006, 2016, 2017]);
    expect(splitYears(years, "chronologicalValidation")).toEqual([2018, 2025, 2026]);
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([5, 1, 3, 4], 10)).toBe(1);
    expect(percentile([5, 1, 3, 4], 90)).toBe(5);
  });
});

describe("the scoped line", () => {
  const DAY = 86_400_000;
  const event = (id: string, parent: number, scopeIn: boolean, status: ScoredEvent["status"], line: ScoredEvent["line"] = "breakups A-B"): ScoredEvent => ({ id, name: id, kind: "breakup", confidence: "A", regime: "LEO", line, parent, launch: null, from: 0, to: 0, at: null, parentSetsBefore: 9, parentSetsAfter: 9, status, piecesWithin90Days: 0, catalogueAt: 10 * DAY, catalogueBody: null, catalogueBasis: "created", noticeAt: null, alert: null, alertAt: null, step: null, leadHours: null, latencyHours: null, confirmedAt: null, daysToConfirmation: null, timingErrorMinutes: null, scopeIn });
  const alert = (number: number, outcome: ScoredAlert["outcome"], eventId: string | null, raisedAt: number, scoped: boolean): ScoredAlert => ({ verdict: 0, number, launch: null, raisedAt, state: "suspected", outcome, event: eventId, nearEvent: null, note: "", confirmedAt: null, daysToConfirmation: null, afterEpoch: raisedAt - DAY, scoped });
  const score: YearScore = {
    year: 2013,
    timeBasis: "created",
    events: [event("in, raised", 1, true, "detected"), event("in, gated out", 2, true, "detected"), event("in, held late", 3, true, "detected"), event("out", 4, false, "detected"), event("in, no sets", 5, true, "undetectable"), event("in, another line", 6, true, "detected", "breakups C")],
    alerts: [alert(1, "detection", "in, raised", DAY, true), alert(2, "detection", "in, gated out", DAY, false), alert(3, "detection", "in, held late", 2 * DAY, true), alert(4, "detection", "out", DAY, true), alert(6, "detection", "in, another line", DAY, true), alert(7, "false-alarm", null, DAY, true), alert(8, "false-alarm", null, DAY, false), alert(9, "false-alarm", null, 3 * DAY, true)],
    review: [],
  };
  const rows = new Map<string, LogRow>([
    // The third target's step held to three days only after the catalogue's first fragment; the last false alarm's never held to three days.
    [alertKey(3, DAY), { at: 0, number: 3, signals: { tierD3Held: 1, tierD3At: 11 * DAY } }],
    [alertKey(1, 0), { at: 0, number: 1, signals: { tierD3Held: 1, tierD3At: 3 * DAY } }],
    [alertKey(6, 0), { at: 0, number: 6, signals: { tierD3Held: 1, tierD3At: 3 * DAY } }],
    [alertKey(7, 0), { at: 0, number: 7, signals: { tierD3Held: 1, tierD3At: 3 * DAY } }],
    [alertKey(9, 2 * DAY), { at: 0, number: 9, signals: { tierD3Held: 0 } }],
  ]);

  test("counts the targets and the alerts in the scope alike, the excluded headline events stated, and the rates with their intervals", () => {
    const c = scopedCellsOf([{ score }], rows, { ...DETECTOR_PARAMETERS.scope, tier: "raised" });
    expect(c).toMatchObject({ targets: 3, undetectable: 1, detected: 2, late: 0, missed: 1, excluded: 1, headlineEvents: 5, detectedAllLines: 3, falseAlarms: 2 });
    expect(c.detectionRate).toBeCloseTo(2 / 3, 9);
    expect(c.falseAlarmRate).toBeCloseTo(2 / 5, 9);
    expect(c.falseAlarmInterval![0]).toBeLessThan(0.4);
    expect(c.falseAlarmInterval![1]).toBeGreaterThan(0.4);
  });

  test("at a tier, an alert is raised when its step held there: after the catalogue it is late, and a step that never held raises nothing", () => {
    const c = scopedCellsOf([{ score }], rows, { ...DETECTOR_PARAMETERS.scope, tier: "D3" });
    expect(c).toMatchObject({ targets: 3, detected: 1, late: 1, missed: 1, detectedAllLines: 2, falseAlarms: 1 });
  });

  test("the Wilson interval brackets the proportion and stays in the unit interval", () => {
    expect(wilson(0, 0)).toBeNull();
    const [low, high] = wilson(0, 2)!;
    expect(low).toBe(0);
    expect(high).toBeCloseTo(0.658, 3);
    const [l, h] = wilson(9, 10)!;
    expect(l).toBeLessThan(0.9);
    expect(h).toBeGreaterThan(0.9);
    expect(h).toBeLessThanOrEqual(1);
  });
});

describe("the Confirmed line's landings: the stations, the crewed and cargo craft and the twins", () => {
  const T = Date.UTC(2016, 5, 1);
  const rowOn = (parent: number, from: number, launch: string): Row => ({ breakup: { id: `${parent}:${new Date(from).toISOString().slice(0, 10)}`, parent: { catalogueNumber: parent, designator: `${launch}A`, name: "TWIN" }, kind: "breakup", scoreable: true, exemptReason: null } as unknown as Breakup, from, to: from, margin: DAY, launch, fragments: new Set(), scored: null });
  // Two ullage motors of one launch, the second breaking up in June; the first in March.
  const rows = [rowOn(33472, T - 67 * DAY, "2008-067"), rowOn(33473, T, "2008-067")];
  const verdict = (number: number, candidates?: number[], launch = "2008-067", eventAt = T + 16 * DAY) => ({ number, launch, raisedAt: T + 40 * DAY, step: null, event: { at: eventAt, from: eventAt, to: eventAt }, evidence: { bodyClass: 1 }, ...(candidates === undefined ? {} : { candidates }) });

  test("a verdict naming twins is matched on the body named first with the switch off, and at the launch with it on", () => {
    // Off: the body named first had an event within the half year, the March one: a detection of that one.
    const twin = landConfirmed(verdict(33472, [33472, 33473]), 0, rows);
    expect(twin.outcome).toBe("detection");
    expect(twin.event).toBe(rows[0]!.breakup.id);
    expect(twin.candidates).toEqual([33472, 33473]);
    // On: the candidates' event nearest the verdict's instant, June's.
    expect(readingOf(twin, true).event).toBe(rows[1]!.breakup.id);
    expect(readingOf(twin, false).event).toBe(rows[0]!.breakup.id);
    // Named on a body with no event, with the parent among the candidates: false off, a detection on.
    const wrong = landConfirmed(verdict(99999, [99999, 33473], "2008-067", T + 2 * DAY), 0, rows);
    expect(wrong.outcome).toBe("false-alarm");
    expect(readingOf(wrong, true).outcome).toBe("detection");
    expect(readingOf(wrong, true).event).toBe(rows[1]!.breakup.id);
    // No candidate with an event: false either way.
    const none = landConfirmed(verdict(99998, [99998, 99999]), 0, rows);
    expect(none.outcome).toBe("false-alarm");
    expect(readingOf(none, true).outcome).toBe("false-alarm");
    // A verdict naming one body reads the same either way.
    const single = landConfirmed(verdict(33473), 0, rows);
    expect(single.twin).toBeUndefined();
    expect(readingOf(single, true)).toEqual(single);
  });

  test("a confirmed verdict under a crewed station's launch is exempt, whatever it names", () => {
    expect(STATION_LAUNCHES).toContain("1998-067");
    expect(STATION_LAUNCHES).toContain("2021-035");
    const station = landConfirmed(verdict(25544, undefined, "1998-067"), 0, rows);
    expect(station.outcome).toBe("exempt");
    expect(station.note).toContain("crewed station");
    expect(readingOf(landConfirmed(verdict(25544, [25544, 33473], "1998-067"), 0, rows), true).outcome).toBe("exempt");
  });

  test("a confirmed verdict under a crewed or cargo craft's launch is exempt unless it names the launch's rocket body", () => {
    expect(VISITING_LAUNCHES).toContain("2022-060");
    const craft = landConfirmed({ ...verdict(52797, undefined, "2022-060"), evidence: { bodyClass: 0 } }, 0, rows);
    expect(craft.outcome).toBe("exempt");
    expect(craft.note).toContain("released on purpose");
    expect(landConfirmed({ ...verdict(52798, undefined, "2022-060"), evidence: { bodyClass: 1 } }, 0, rows).outcome).toBe("false-alarm");
  });

  test("the Confirmed cells read the twins both ways, and the warm-up year scores on no split", () => {
    const files = [2005, 2016].map((year) => ({ year, score: { year, timeBasis: "created" as const, events: [], alerts: [], review: [], confirmations: [{ ...landConfirmed(verdict(99999, [99999, 33473], "2008-067", T + 2 * DAY), 0, rows), raisedAt: Date.UTC(year, 6, 1) }] } }));
    expect(confirmedCellsOf(files.filter((f) => splitYears([2005, 2016], "all").includes(f.year))).falseAlarms).toBe(1);
    const on = confirmedCellsOf(files.slice(1), firstConfirmationsOf(files, true), true);
    expect(on.falseAlarms).toBe(0);
    expect(on.twins).toBe(1);
    expect(firstConfirmationsOf(files).size).toBe(0);
  });
});

describe("the sweep's re-application of the eleventh phase's rules", () => {
  const T = Date.UTC(2014, 6, 10);
  /** An attribution row of the cloud path for body 34839 of launch 2009-021, with the signals given over a passing base. */
  const row = (signals: Record<string, number>): LogRow => ({ at: T, number: 34839, signals: { phase: PHASES.attribution, attributionPath: ATTRIBUTION_PATHS.cloud, launch: 2009021, bodyClass: 0, attributionPieces: 3, launchAgeDays: 1900, cloudDeltaVMps: 1.3, attributionMissKm: 10, originTried: 3, originTimed: 3, originDev50Hours: 0.2, originDev75Hours: 0.3, launchesInRun: 0, piecesFirstAt: T - DAY, ...signals } });
  const base = { ...rulesOf(DETECTOR_PARAMETERS), attributionMinPieces: 3 };

  test("the reentry rule reads the catalogue's decay as published by the row's run, against the pieces' first set", () => {
    const facts = (decayMs: number) => new Map([[34839, { bodyClass: "payload" as const, decayMs }]]);
    expect(decide(row({}), base, Number.NEGATIVE_INFINITY, namedOf(row({}), base, facts(T - 3 * DAY))).refused & REFUSALS.reentry).toBe(REFUSALS.reentry);
    expect(decide(row({}), base, Number.NEGATIVE_INFINITY, namedOf(row({}), base, facts(T + 30 * DAY))).raised).toBe(true);
    expect(decide(row({}), { ...base, reentryRefuses: false }, Number.NEGATIVE_INFINITY, namedOf(row({}), base, facts(T - 3 * DAY))).raised).toBe(true);
  });

  test("a small batch is refused where its crossings spread beyond the bound, and a crewed or cargo craft's launch on its craft", () => {
    expect(decide(row({ originDev50Hours: 5 }), { ...base, smallBatchOriginShare: 0.5, smallBatchOriginHours: 1 }).refused & REFUSALS.smallBatch).toBe(REFUSALS.smallBatch);
    expect(decide(row({ originDev75Hours: 60 }), { ...base, smallBatchOriginShare: 0.75, smallBatchOriginHours: 48 }).refused & REFUSALS.smallBatch).toBe(REFUSALS.smallBatch);
    // On the confirmation of a step, only where the rule reads steps too.
    const step = row({ attributionPath: ATTRIBUTION_PATHS.alert, originDev75Hours: 60 });
    expect(decide(step, { ...base, smallBatchOriginHours: 48 }).raised).toBe(true);
    expect(decide(step, { ...base, smallBatchOriginHours: 48, smallBatchStepsToo: true }).refused & REFUSALS.smallBatch).toBe(REFUSALS.smallBatch);
    expect(decide(row({}), { ...base, smallBatchOriginHours: 1 }).raised).toBe(true);
    expect(decide(row({ attributionPieces: 5, originDev50Hours: 5 }), { ...base, smallBatchOriginShare: 0.5, smallBatchOriginHours: 1 }).raised).toBe(true);
    expect(decide(row({}), { ...base, visitingLaunches: ["2009-021"] }).refused & REFUSALS.visiting).toBe(REFUSALS.visiting);
  });

  test("the stage preference names the row's alternative within the factor, unless the named body alone stepped", () => {
    const preferring = { ...base, attributionPrefersStage: true, attributionPreferCentreRatio: 3 };
    const facts = new Map([[34840, { bodyClass: "rocket body" as const, decayMs: null }]]);
    expect(namedOf(row({ preferAlternative: 34840, preferCentreRatio: 2, preferNamedStepped: 0 }), preferring, facts)).toEqual({ number: 34840, bodyClass: "rocket body", decayMs: null });
    expect(namedOf(row({ preferAlternative: 34840, preferCentreRatio: 4, preferNamedStepped: 0 }), preferring, facts).number).toBe(34839);
    expect(namedOf(row({ preferAlternative: 34840, preferCentreRatio: 2, preferNamedStepped: 1 }), preferring, facts).number).toBe(34839);
    expect(namedOf(row({ preferAlternative: 34840, preferCentreRatio: 2 }), base, facts).number).toBe(34839);
  });
});

describe("the catalogue index", () => {
  const parents = new Set(truth.breakups.map((b) => b.parent.catalogueNumber).filter((n): n is number => n !== null));
  const rowsWithParents = truth.breakups.filter((b) => b.parent.catalogueNumber !== null);

  test("reads back every body's facts, the launches, the mark and every truth row's parent's last set as the whole Archive gives them, with the year's build time recorded", () => {
    const dir = join(work, "indexed");
    writeIndexedYear(dir, yearOf(sets.rows, bodies));
    const index = readCatalogueIndex(catalogueIndexPath(dir));
    expect(index.years).toEqual({ [String(YEAR)]: { builtAt: "2026-01-01T00:00:00.000Z", sets: sets.rows.length } });
    expect(index.truthSha256).toBe("synthetic");
    const whole = readCatalogue(dir, parents, false);
    const read = loadCatalogue(dir, truth.breakups);
    expect([...read.bodies.values()]).toEqual([...whole.bodies.values()]);
    expect([...read.byLaunch.entries()]).toEqual([...whole.byLaunch.entries()]);
    for (const t of [at(1, 1), at(2, 12), at(2, 14), at(6, 1)]) expect(read.markAt(t)).toBe(whole.markAt(t));
    const lastSets = rowsWithParents.map((b) => read.orbitBefore(b.parent.catalogueNumber!, lowerOf(b)));
    expect(lastSets).toEqual(rowsWithParents.map((b) => whole.orbitBefore(b.parent.catalogueNumber!, lowerOf(b))));
    expect(lastSets.some((set) => set !== null)).toBe(true);
    // An instant no truth row asks at is not answered from a part of the Archive: it is refused.
    expect(() => read.orbitBefore(40001, at(7, 1))).toThrow(/holds no last set of 40001 before 2013-07-01/);
  });

  test("the scorecard refuses to run without it, before any replay, rather than read the years on disk as the whole Archive", () => {
    const dir = join(work, "bare");
    writeIndexedYear(dir, yearOf(sets.rows, bodies));
    const scored = scoreYear(dir, YEAR, truth, { detector: stub, detectorName: "jump" });
    rmSync(catalogueIndexPath(dir));
    expect(() => catalogueOf(dir, truth)).toThrow(/no catalogue index at .*npm run kpi:index/);
    expect(() => scoreYear(dir, YEAR, truth, { detector: stub, detectorName: "jump", onRun: () => expect.unreachable("a replay began") })).toThrow(/no catalogue index/);
    expect(() => rematch(dir, scored, truth)).toThrow(/no catalogue index/);
  });

  test("a stale index is refused: a year built again, a year added, a released year it did not read", () => {
    const dir = join(work, "stale");
    const year = yearOf(sets.rows, bodies);
    writeIndexedYear(dir, year);
    expect(() => loadCatalogue(dir, truth.breakups)).not.toThrow();
    writeYear(dir, { ...year, manifest: { ...year.manifest, builtAt: "2026-02-01T00:00:00.000Z" } });
    expect(() => loadCatalogue(dir, truth.breakups)).toThrow(/is stale \(2013 was built at 2026-02-01T00:00:00.000Z, the index read it as built at 2026-01-01T00:00:00.000Z\)/);
    expect(() => scoreYear(dir, YEAR, truth, { detector: stub, detectorName: "jump" })).toThrow(/is stale/);
    writeIndexedYear(dir, { ...year, manifest: { ...year.manifest, builtAt: "2026-02-01T00:00:00.000Z" } });
    expect(() => loadCatalogue(dir, truth.breakups)).not.toThrow();
    writeYear(dir, { ...year, manifest: { ...year.manifest, year: YEAR + 1 } });
    expect(() => loadCatalogue(dir, truth.breakups)).toThrow(/2014 is in the Archive but not in the index/);
    writeIndexedYear(dir, { ...year, manifest: { ...year.manifest, year: YEAR + 1 } });
    // The years not on disk are held to the release's manifest the last download fetched.
    writeFileSync(releaseManifestPath(dir), JSON.stringify({ years: { "2012": { builtAt: "2026-01-01T00:00:00.000Z" }, "2013": { builtAt: "2026-02-01T00:00:00.000Z" } } }));
    expect(() => loadCatalogue(dir, truth.breakups)).toThrow(/2012 is in the release but not in the index/);
    rmSync(join(dir, String(YEAR)), { recursive: true });
    writeFileSync(releaseManifestPath(dir), JSON.stringify({ years: { "2013": { builtAt: "2026-03-01T00:00:00.000Z" }, "2014": { builtAt: "2026-01-01T00:00:00.000Z" } } }));
    expect(() => loadCatalogue(dir, truth.breakups)).toThrow(/2013 was released as built at 2026-03-01T00:00:00.000Z, the index read it as built at 2026-02-01T00:00:00.000Z/);
    writeFileSync(releaseManifestPath(dir), JSON.stringify({ years: { "2013": { builtAt: "2026-02-01T00:00:00.000Z" }, "2014": { builtAt: "2026-01-01T00:00:00.000Z" } } }));
    expect(() => loadCatalogue(dir, truth.breakups)).not.toThrow();
  });

  test("an index built for a truth lacking one of this truth's parents' rows is refused by name", () => {
    const dir = join(work, "another-truth");
    writeIndexedYear(dir, yearOf(sets.rows, bodies));
    const moved = structuredClone(rowsWithParents[0]!);
    moved.event = { ...moved.event, from: null, to: "2013-07-01T00:00:00.000Z" };
    const other = { breakups: [...truth.breakups, moved], sha256: "another" };
    expect(() => loadCatalogue(dir, other.breakups)).toThrow(new RegExp(`built for another truth: it holds no last set of ${moved.parent.catalogueNumber} before 2013-07-01T00:00:00.000Z`));
    expect(() => catalogueOf(dir, other)).toThrow(/built for another truth/);
  });
});
