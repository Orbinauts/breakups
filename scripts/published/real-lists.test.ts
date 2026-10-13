import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { readBreakups, type PublishedBreakup } from "../../src/index.ts";
import type { PublishedFixture } from "./real-fixtures.ts";
import { selectPublished } from "./select.ts";

/**
 * The selection on the real replays: the frozen detector's 2025 seed and
 * its 2026 run, landed on the ground truth as committed, publish exactly
 * the breakups the live test is expected to show, and nothing else. Each
 * fixture under `test/fixtures/published/` holds a year's suspected and
 * confirmed verdicts, the expired and dismissed ones on their steps, and
 * the catalogue's identity of the bodies the selection asks for
 * (`scripts/published/real-fixtures.ts` says how they were cut). A change
 * to the truth or to the selection that moves a published breakup, its
 * state, its id, its dates, its row, the row's dating or its reports fails
 * here.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const breakups = readBreakups(JSON.parse(readFileSync(resolve(ROOT, "data/breakups.json"), "utf8")));

function fixture(year: number): PublishedFixture {
  return JSON.parse(gunzipSync(readFileSync(resolve(ROOT, `test/fixtures/published/${year}.json.gz`))).toString("utf8")) as PublishedFixture;
}

function published(year: number): PublishedBreakup[] {
  const { verdicts, bodies } = fixture(year);
  return selectPublished(verdicts, breakups, (number) => bodies[String(number)]);
}

/** What a reader of the list sees of a breakup (the detector's estimate by its instant), with the row it landed on and the verdicts merged into it. */
const shown = (breakup: PublishedBreakup) => ({
  id: breakup.id,
  state: breakup.state,
  raisedAt: breakup.raisedAt,
  confirmedAt: breakup.confirmedAt,
  parent: breakup.parent,
  event: breakup.event?.at ?? null,
  rowEvent: breakup.rowEvent,
  row: breakup.row,
  reports: breakup.reports,
  verdicts: breakup.verdicts.map((verdict) => `${verdict.state} ${verdict.raisedAt}`),
});

describe("the fixtures of the real replays", () => {
  test.each([
    [2025, 319, 1],
    [2026, 294, 4],
  ])("hold every suspected and confirmed verdict of %i's replay by the frozen detector", (year, suspected, confirmed) => {
    const file = fixture(year);
    expect(file.year).toBe(year);
    expect(file.detector).toBe("confirmed-v10");
    expect(file.verdicts.filter((verdict) => verdict.state === "suspected")).toHaveLength(suspected);
    expect(file.verdicts.filter((verdict) => verdict.state === "confirmed")).toHaveLength(confirmed);
    expect(file.verdicts.every((verdict) => ["suspected", "confirmed", "expired", "dismissed"].includes(verdict.state))).toBe(true);
  });
});

describe("the real replays publish exactly the expected lists", () => {
  test("the 2025 seed publishes DMSP F-14 alone, confirmed by U.S. Space Forces-Space's post of the event's day, before its fragments confirmed it and ESA's table of 2024 reported it, dated by that notice, and none of the 319 suspected verdicts", () => {
    expect(published(2025).map(shown)).toEqual([
      {
        id: "24753-2024-12-19",
        state: "confirmed",
        raisedAt: "2025-02-13T20:00:00.000Z",
        confirmedAt: "2024-12-19T00:00:00.000Z",
        parent: { catalogueNumber: 24753, designator: "1997-012A", name: "DMSP 5D-2 F14 (USA 131)", launchedOn: "1997-04-04" },
        event: "2024-10-07T11:53:14.737Z",
        rowEvent: { at: "2024-12-19T02:10:00.000Z", from: "2024-12-19T02:00:00.000Z", to: "2024-12-19T02:20:00.000Z", precision: "minute", source: "s4s-notice", row: "24753:2024-12-19" },
        row: "24753:2024-12-19",
        reports: [{ date: "2024-12-19", precision: "day", source: "s4s-notice", url: "https://x.com/S4S_SDA/status/1869818410277974343" }, { source: "esa-ser", date: "2025-03-31", precision: "day", url: null }],
        verdicts: ["confirmed 2025-02-13T20:00:00.000Z"],
      },
    ]);
  });

  test("2026 publishes Luch, Intelsat 805, Yaogan-50 02 and USA 32 confirmed, Meteor 2-7 suspected, and nothing else", () => {
    expect(published(2026).map(shown)).toEqual([
      {
        id: "40258-2026-01-30",
        state: "confirmed",
        raisedAt: "2026-02-27T04:00:00.000Z",
        confirmedAt: "2026-02-27T04:00:00.000Z",
        parent: { catalogueNumber: 40258, designator: "2014-058A", name: "Luch (Olymp-K 1)", launchedOn: "2014-09-27" },
        event: "2026-01-31T08:15:35.399Z",
        rowEvent: { at: "2026-01-30T06:09:00.000Z", from: "2026-01-30T06:09:00.000Z", to: "2026-01-30T06:10:00.000Z", precision: "minute", source: "news", row: "40258:2026-01-30" },
        row: "40258:2026-01-30",
        reports: [
          { source: "news", date: "2026-02-02", precision: "day", url: "https://universemagazine.com/en/russian-spy-satellite-destroyed-in-orbit/" },
          { source: "analyst", date: "2026-02-15", precision: "day", url: "https://planet4589.org/space/jsr/back/news.853.txt" },
        ],
        verdicts: ["confirmed 2026-02-27T04:00:00.000Z"],
      },
      {
        id: "25371-2026-07-30",
        state: "confirmed",
        raisedAt: "2026-07-31T20:00:00.000Z",
        confirmedAt: "2026-08-20T04:00:00.000Z",
        parent: { catalogueNumber: 25371, designator: "1998-037A", name: "INTELSAT 805 (IS-805)", launchedOn: "1998-06-18" },
        event: "2026-07-30T04:50:11.605Z",
        rowEvent: { at: null, from: "2026-06-19T23:35:00.000Z", to: "2026-08-18T23:35:00.000Z", precision: "none", source: "catalogue", row: "A:1998-037:2026-06-19" },
        row: "A:1998-037:2026-06-19",
        reports: [],
        verdicts: ["suspected 2026-07-31T20:00:00.000Z", "confirmed 2026-08-20T04:00:00.000Z"],
      },
      {
        id: "68196-2026-07-24",
        state: "confirmed",
        raisedAt: "2026-09-03T20:00:00.000Z",
        confirmedAt: "2026-09-03T20:00:00.000Z",
        parent: { catalogueNumber: 68196, designator: "2026-051A", name: "Yaogan-50 02", launchedOn: "2026-03-15" },
        event: "2026-07-24T06:35:44.804Z",
        rowEvent: { at: null, from: "2026-07-01T20:21:00.000Z", to: "2026-09-04T00:00:00.000Z", precision: "none", source: "catalogue", row: "68196:2026-07-01" },
        row: "68196:2026-07-01",
        reports: [],
        verdicts: ["confirmed 2026-09-03T20:00:00.000Z"],
      },
      {
        id: "19460-2026-09-13",
        state: "confirmed",
        raisedAt: "2026-09-15T12:00:00.000Z",
        confirmedAt: "2026-09-17T00:00:00.000Z",
        parent: { catalogueNumber: 19460, designator: "1988-078A", name: "USA 32", launchedOn: "1988-09-05" },
        event: "2026-09-13T21:20:42.966Z",
        rowEvent: { at: "2026-09-13T21:13:00.000Z", from: "2026-09-13T21:03:00.000Z", to: "2026-09-13T21:23:00.000Z", precision: "minute", source: "s4s-notice", row: "19460:2026-09-13" },
        row: "19460:2026-09-13",
        reports: [{ source: "s4s-notice", date: "2026-09-17", precision: "day", url: null }],
        verdicts: ["suspected 2026-09-15T12:00:00.000Z", "confirmed 2026-09-17T00:00:00.000Z"],
      },
      {
        id: "12456-2026-10-05",
        state: "suspected",
        raisedAt: "2026-10-06T12:00:00.000Z",
        confirmedAt: null,
        parent: { catalogueNumber: 12456, designator: "1981-043A", name: "Meteor 2-7 (second event)", launchedOn: "1981-05-14" },
        event: "2026-10-05T09:46:14.575Z",
        rowEvent: { at: "2026-10-05T09:45:00.000Z", from: "2026-10-05T09:35:00.000Z", to: "2026-10-05T09:55:00.000Z", precision: "minute", source: "analyst", row: "12456:2026-10-05" },
        row: "12456:2026-10-05",
        reports: [{ source: "analyst", date: "2026-10-07", precision: "day", url: "https://earthsky.org/space/another-satellite-breakup-meteor-2-7-oct-5-2026/" }],
        verdicts: ["suspected 2026-10-06T12:00:00.000Z"],
      },
    ]);
  });

  test("each fixture carries the catalogue's identity of the published breakups' parents alone", () => {
    expect(Object.keys(fixture(2025).bodies).sort()).toEqual(["24753"]);
    expect(Object.keys(fixture(2026).bodies).sort()).toEqual(["12456", "19460", "25371", "40258", "68196"]);
  });
});
