import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, test } from "vitest";
import { buildFromHistory, daysToPull, historyDir, keepDay, markKept } from "./pull.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const work = mkdtempSync(join(tmpdir(), "breakups-pull-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

let archives = 0;
const freshArchive = (): string => join(work, `archive-${++archives}`);

/** A set as the history class answers it, with the fields the pull asks for. */
function omm(gpId: number, number: number, epoch: string, created: string): Record<string, string> {
  return {
    NORAD_CAT_ID: String(number),
    OBJECT_ID: "1998-067A",
    EPOCH: epoch,
    MEAN_MOTION: "15.50000000",
    ECCENTRICITY: "0.0005000",
    INCLINATION: "51.6400",
    RA_OF_ASC_NODE: "100.0000",
    ARG_OF_PERICENTER: "90.0000",
    MEAN_ANOMALY: "270.0000",
    BSTAR: "0.00010000",
    MEAN_MOTION_DOT: "0.00001000",
    MEAN_MOTION_DDOT: "0",
    ELEMENT_SET_NO: "999",
    REV_AT_EPOCH: "1000",
    CREATION_DATE: created,
    GP_ID: String(gpId),
  };
}

/** A day's answer kept as the pull kept it before it marked its slices: the bare array of rows. */
function keepBare(archive: string, day: string, rows: unknown[]): string {
  const dir = historyDir(archive, 2026);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${day}.json.gz`);
  writeFileSync(path, gzipSync(JSON.stringify(rows)));
  return path;
}

describe("a year built from its kept days", () => {
  test("counts once a set whose epoch is exactly midnight, which both days' answers hold", () => {
    const archive = freshArchive();
    const boundary = omm(9003, 25544, "2026-01-02T00:00:00.000000", "2026-01-02T03:00:00");
    keepBare(archive, "2026-01-01", [omm(9001, 25544, "2026-01-01T06:00:00.000000", "2026-01-01T09:00:00"), boundary]);
    keepBare(archive, "2026-01-02", [boundary, omm(9004, 25544, "2026-01-02T12:00:00.000000", "2026-01-02T15:00:00")]);
    const built = buildFromHistory(archive, 2026);
    expect(built.sets).toBe(3);
    expect(Array.from(built.columns.epoch as Float64Array)).toEqual([Date.parse("2026-01-01T06:00:00Z"), Date.parse("2026-01-02T00:00:00Z"), Date.parse("2026-01-02T12:00:00Z")]);
  });

  test("counts once a set an earlier cache kept as two lines, listed twice, but keeps a correction published later", () => {
    const archive = freshArchive();
    // The ISS set Wikipedia's two-line element set article prints; the cache kept no catalogue id with the lines.
    const lines = { NORAD_CAT_ID: "25544", EPOCH: "2008-09-20T12:25:40.104192", TLE_LINE1: "1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927", TLE_LINE2: "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537" };
    const first = { ...lines, CREATION_DATE: "2008-09-20T15:00:00" };
    keepBare(archive, "2026-01-01", [first, first]);
    keepBare(archive, "2026-01-02", [first, { ...lines, CREATION_DATE: "2008-09-21T15:00:00" }]);
    expect(buildFromHistory(archive, 2026).sets).toBe(2);
  });
});

/** A kept file's modification time set, as a tool that does not keep them would leave it. */
const touch = (path: string, at: number): void => utimesSync(path, at / 1000, at / 1000);
const endOf = (day: string): number => Date.parse(`${day}T00:00:00Z`) + DAY;
const dayPath = (archive: string, day: string): string => join(historyDir(archive, 2026), `${day}.json.gz`);

describe("the days a pull asks for", () => {
  test("are read from the time each slice says it was pulled, whatever its file's modification time", () => {
    const archive = freshArchive();
    const set = omm(1, 25544, "2026-01-01T06:00:00.000000", "2026-01-01T09:00:00");
    keepDay(dayPath(archive, "2026-01-01"), [set], endOf("2026-01-01") + 2 * DAY);
    keepDay(dayPath(archive, "2026-01-02"), [set], endOf("2026-01-02") + 2 * HOUR);
    // The first kept for good though its file looks freshly made; the second not yet settled though its file looks old.
    touch(dayPath(archive, "2026-01-01"), endOf("2026-01-01") - HOUR);
    touch(dayPath(archive, "2026-01-02"), endOf("2026-01-02") + 30 * DAY);
    expect(daysToPull(archive, 2026, "2026-01-03")).toEqual(["2026-01-02", "2026-01-03"]);
  });
});

describe("a slice kept before the pull marked them", () => {
  test("is marked with its file's modification time, so a copy that loses the time keeps its reading and its rows", () => {
    const archive = freshArchive();
    keepBare(archive, "2026-01-01", [omm(1, 25544, "2026-01-01T06:00:00.000000", "2026-01-01T09:00:00")]);
    keepBare(archive, "2026-01-02", [omm(2, 25544, "2026-01-02T06:00:00.000000", "2026-01-02T09:00:00")]);
    keepDay(dayPath(archive, "2026-01-03"), [omm(3, 25544, "2026-01-03T06:00:00.000000", "2026-01-03T09:00:00")], endOf("2026-01-03") + 5 * DAY);
    touch(dayPath(archive, "2026-01-01"), endOf("2026-01-01") + 2 * DAY);
    touch(dayPath(archive, "2026-01-02"), endOf("2026-01-02") + 2 * HOUR);
    const before = buildFromHistory(archive, 2026);
    expect(daysToPull(archive, 2026, "2026-01-03")).toEqual(["2026-01-02"]);
    expect(markKept(archive, 2026)).toEqual(["2026-01-01", "2026-01-02"]);
    expect(markKept(archive, 2026)).toEqual([]);
    for (const day of ["2026-01-01", "2026-01-02", "2026-01-03"]) touch(dayPath(archive, day), Date.parse("2026-01-01T00:00:00Z"));
    expect(daysToPull(archive, 2026, "2026-01-03")).toEqual(["2026-01-02"]);
    const after = buildFromHistory(archive, 2026);
    expect([after.sets, Array.from(after.columns.epoch as Float64Array)]).toEqual([before.sets, Array.from(before.columns.epoch as Float64Array)]);
  });
});

describe("an empty day", () => {
  test("is never kept for good, marked or bare, and the year counts it missing", () => {
    const archive = freshArchive();
    const set = omm(1, 25544, "2026-01-01T06:00:00.000000", "2026-01-01T09:00:00");
    keepDay(dayPath(archive, "2026-01-01"), [set], endOf("2026-01-01") + 5 * DAY);
    keepDay(dayPath(archive, "2026-01-02"), [], endOf("2026-01-02") + 5 * DAY);
    keepBare(archive, "2026-01-03", [set]);
    keepBare(archive, "2026-01-04", []);
    touch(dayPath(archive, "2026-01-03"), endOf("2026-01-03") + 5 * DAY);
    touch(dayPath(archive, "2026-01-04"), endOf("2026-01-04") + 5 * DAY);
    keepDay(dayPath(archive, "2026-01-05"), [set], endOf("2026-01-05") + 5 * DAY);
    expect(daysToPull(archive, 2026, "2026-01-05")).toEqual(["2026-01-02", "2026-01-04"]);
    const built = buildFromHistory(archive, 2026);
    expect(built.missing).toEqual(["2026-01-02", "2026-01-04"]);
    expect([built.from, built.through, built.sets]).toEqual(["2026-01-01", "2026-01-05", 3]);
  });
});
