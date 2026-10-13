import { describe, expect, test } from "vitest";
import { REGIMES, type Breakup, type Regime } from "../src/index.ts";
import { confirmedCellsOf } from "../scripts/kpi/kpi.ts";
import { carriedRegime, firstAgencyNotice, firstQuarterlyNews, landConfirmed, regimeBefore, truthAsOf, type ConfirmedLanding, type Row, type ScoredEvent } from "../scripts/kpi/match.ts";

/**
 * The scorecard's readings amended in the seventh decision record: the
 * exemption of a report naming no object, bounded to what the report does
 * name; a confirmation assigned to the nearest reported event of its
 * parent; a confirmation on no row, pending and then false; and the lead
 * read over the first agency notice and over NASA's quarterly news.
 */

const DAY = 86_400_000;
const T = Date.UTC(2024, 3, 2);

/** A truth row as the matcher holds it. */
function rowOf(fields: { id: string; parent?: number | null; designator?: string | null; kind?: Breakup["kind"]; scoreable?: boolean; regime?: Regime; from: number; to?: number; exemptReason?: string | null }): Row {
  const designator = fields.designator ?? null;
  const breakup = {
    id: fields.id,
    parent: { catalogueNumber: fields.parent ?? null, designator, name: fields.id },
    kind: fields.kind ?? "breakup",
    scoreable: fields.scoreable ?? true,
    exemptReason: fields.exemptReason ?? null,
    orbit: { regime: fields.regime ?? "unknown" },
  } as unknown as Breakup;
  return { breakup, from: fields.from, to: fields.to ?? fields.from + DAY, margin: DAY, launch: designator === null ? null : designator.slice(0, 8), fragments: new Set(), scored: null };
}

const confirmed = (number: number, raisedAt: number, launch: string | null = "2010-001", eventAt?: number) => ({ number, launch, raisedAt, step: null, event: eventAt === undefined ? null : { at: eventAt, from: eventAt, to: eventAt }, evidence: { bodyClass: 1 } });

describe("a report naming no object exempts only what it names", () => {
  test("a row naming no launch and no regime exempts nothing: the confirmation inside its window lands in a cell of its own", () => {
    const unnamed = rowOf({ id: "U:1:2024-04-02", kind: "unnamed", scoreable: false, exemptReason: "the report names no object", from: T });
    const landing = landConfirmed(confirmed(40001, T + 20 * DAY), 0, [unnamed]);
    expect(landing.outcome).toBe("unnamed");
    expect(landing.event).toBe("U:1:2024-04-02");
  });

  test("a row naming a regime exempts a confirmation in that regime alone; one in another regime is false", () => {
    const unnamed = rowOf({ id: "U:3:2024-05-27", kind: "unnamed", scoreable: false, regime: "GEO", from: T });
    expect(landConfirmed(confirmed(40002, T + 5 * DAY), 0, [unnamed], undefined, undefined, "GEO")).toMatchObject({ outcome: "exempt", event: "U:3:2024-05-27" });
    expect(landConfirmed(confirmed(40003, T + 5 * DAY), 0, [unnamed], undefined, undefined, "LEO")).toMatchObject({ outcome: "false-alarm", event: null });
    // The verdict's regime unknown (no set of its object to read it from): the bound cannot be met.
    expect(landConfirmed(confirmed(40003, T + 5 * DAY), 0, [unnamed]).outcome).toBe("false-alarm");
  });

  test("the object's regime is read by its last set before the raising where the reader has the sets, else as its verdict carries it", () => {
    const geo = { epochMs: T, meanMotion: 1.0027, eccentricity: 0.0002, bstar: 0 };
    const index = { orbitBefore: (number: number, at: number) => (number === 40002 && at > T ? geo : null) };
    expect(regimeBefore(index, 40002, T + DAY)).toBe("GEO");
    expect(regimeBefore(index, 40002, T)).toBe("unknown");
    expect(carriedRegime({ evidence: { regime: REGIMES.indexOf("HEO") } })).toBe("HEO");
    // A confirmation from the pieces alone carries none.
    expect(carriedRegime({ evidence: { attributed: 1 } })).toBe("unknown");
  });

  test("a row naming the launch alone exempts that launch only", () => {
    const launch = rowOf({ id: "A:2010-001:2024-04-02", designator: "2010-001", scoreable: false, from: T });
    expect(landConfirmed(confirmed(40004, T + 5 * DAY, "2010-001"), 0, [launch]).outcome).toBe("exempt");
    expect(landConfirmed(confirmed(40005, T + 5 * DAY, "2011-002"), 0, [launch]).outcome).toBe("false-alarm");
  });

  test("past its window and the half year after, a report naming no object holds nothing", () => {
    const unnamed = rowOf({ id: "U:1:2024-04-02", kind: "unnamed", scoreable: false, from: T });
    expect(landConfirmed(confirmed(40001, T + 200 * DAY), 0, [unnamed]).outcome).toBe("false-alarm");
  });
});

describe("a confirmation is assigned to the nearest reported event of its parent", () => {
  const first = rowOf({ id: "A:40010:2024-04-02", parent: 40010, from: T });
  const reentry = rowOf({ id: "A:40010:2024-06-01", parent: 40010, kind: "aerodynamic", scoreable: false, exemptReason: "an aerodynamic breakup at reentry", from: T + 60 * DAY });
  const second = rowOf({ id: "A:40010:2024-06-01b", parent: 40010, from: T + 60 * DAY });

  test("a later event's confirmation never counts for an earlier one, even where the later event is not scored", () => {
    const landing = landConfirmed(confirmed(40010, T + 70 * DAY, "2010-001", T + 61 * DAY), 0, [first, reentry]);
    expect(landing).toMatchObject({ outcome: "exempt", event: "A:40010:2024-06-01" });
  });

  test("the nearest by the detector's instant of the event, where it gives one: a late confirmation of the first event is the first's", () => {
    expect(landConfirmed(confirmed(40010, T + 70 * DAY, "2010-001", T + DAY / 2), 0, [first, second]).event).toBe("A:40010:2024-04-02");
    expect(landConfirmed(confirmed(40010, T + 70 * DAY, "2010-001", T + 60 * DAY), 0, [first, second]).event).toBe("A:40010:2024-06-01b");
  });

  test("with no instant, the nearest by the raising: the latest event before it", () => {
    expect(landConfirmed(confirmed(40010, T + 70 * DAY), 0, [first, second]).event).toBe("A:40010:2024-06-01b");
    expect(landConfirmed(confirmed(40010, T + 70 * DAY), 0, [first, reentry]).outcome).toBe("exempt");
  });
});

describe("a confirmation landing on no row is unreported: pending while the truth may still catch up, then false", () => {
  const asOf = Date.UTC(2026, 9, 9);
  const landed = (raisedAt: number, outcome: ConfirmedLanding["outcome"] = "false-alarm", event: string | null = null): ConfirmedLanding => ({ verdict: 0, number: 40020, launch: "2010-001", raisedAt, outcome, event, note: "", attributed: true, eventAt: null, sigmaMinutes: null, bodyClass: "payload" });
  const file = (confirmations: ConfirmedLanding[]) => ({ year: 2026, score: { year: 2026, timeBasis: "created" as const, events: [], alerts: [], review: [], confirmations } });

  test("younger than 90 days from the truth's date it is pending, out of both counts; older it is a false confirmation", () => {
    const c = confirmedCellsOf([file([landed(asOf - 89 * DAY), landed(asOf - 91 * DAY), landed(asOf + 3 * DAY)])], undefined, false, asOf);
    expect(c.pending).toBe(2);
    expect(c.falseAlarms).toBe(1);
    expect(c.falseAlarmRate).toBe(1);
  });

  test("a confirmation inside a report naming nothing is counted in its own cell, neither exempt nor false", () => {
    const c = confirmedCellsOf([file([landed(asOf - 400 * DAY, "unnamed", "U:1:2024-04-02")])], undefined, false, asOf);
    expect(c.unnamed).toBe(1);
    expect(c.falseAlarms).toBe(0);
    expect(c.exempt).toBe(0);
    expect(c.falseAlarmRate).toBeNull();
  });
});

describe("the lead is read two ways: over the first agency notice dated to the day, and over NASA's quarterly news", () => {
  const confirmedAt = Date.UTC(2015, 4, 10);
  const day = (on: string) => Date.parse(`${on}T00:00:00Z`);
  const event = (id: string, notice: string | null, quarterly: string | null) =>
    ({ id, line: "breakups A-B", at: null, from: confirmedAt - 2 * DAY, fragments: { parentOrbit: true, inPlane: 3, firstAt: confirmedAt - DAY }, statement: null, notice: notice === null ? null : { at: day(notice), precision: "day", source: "s4s-notice" }, quarterly: quarterly === null ? null : { at: day(quarterly), precision: "month", source: "odqn" } }) as unknown as ScoredEvent;
  const landing = (id: string, verdict: number): ConfirmedLanding => ({ verdict, number: 40030 + verdict, launch: "2010-001", raisedAt: confirmedAt, outcome: "detection", event: id, note: "", attributed: true, eventAt: null, sigmaMinutes: null, bodyClass: "payload" });
  const files = [{ year: 2015, score: { year: 2015, timeBasis: "created" as const, events: [event("a", "2015-05-11", "2015-07-01"), event("b", "2015-05-09", "2015-10-01"), event("c", null, "2015-07-01")], alerts: [], review: [], confirmations: [landing("a", 0), landing("b", 1), landing("c", 2)] } }];

  test("each lead is over the confirmations that statement dates, with how many came before it", () => {
    const c = confirmedCellsOf(files);
    expect(c.withNotice).toBe(2);
    expect(c.beforeNotice).toBe(1);
    expect(c.leadNotice).toMatchObject({ median: -1, count: 2 });
    expect(c.withQuarterly).toBe(3);
    expect(c.beforeQuarterly).toBe(3);
    expect(c.leadQuarterly).toMatchObject({ median: 52, count: 3 });
  });
});

describe("the first statements the two leads are read against", () => {
  const named = { catalogueNumber: 40001, designator: "2014-001A", name: "SAT" };
  const statement = (source: string, on: string, precision: "day" | "month", parent: object = named) => ({ source, parent, statedOn: { on, precision, ref: "" } });
  const breakup = { statements: [statement("news", "2015-05-01", "day"), statement("odqn", "2015-07-01", "month"), statement("hoosf-16e", "2015-06-01", "month"), statement("esa-ser", "2016-04-20", "day"), statement("s4s-notice", "2015-05-12", "day")] } as unknown as Breakup;

  test("the notice is an agency's statement dated to the day; the quarterly news is NASA's, dated to its month", () => {
    expect(firstAgencyNotice(breakup)).toMatchObject({ source: "s4s-notice", on: "2015-05-12" });
    expect(firstQuarterlyNews(breakup)).toMatchObject({ source: "hoosf-16e", on: "2015-06-01" });
    expect(firstAgencyNotice({ statements: [statement("odqn", "2015-07-01", "month")] } as unknown as Breakup)).toBeNull();
  });

  test("an ESA row naming no object, placed on the event by the truth build's rule, is no agency's notice of it", () => {
    const placed = statement("esa-ser", "2015-05-02", "day", { catalogueNumber: null, designator: null, name: null });
    expect(firstAgencyNotice({ statements: [placed, statement("s4s-notice", "2015-05-12", "day")] } as unknown as Breakup)).toMatchObject({ source: "s4s-notice", on: "2015-05-12" });
    expect(firstAgencyNotice({ statements: [placed] } as unknown as Breakup)).toBeNull();
    expect(firstAgencyNotice({ statements: [statement("esa-ser", "2015-05-02", "day")] } as unknown as Breakup)).toMatchObject({ source: "esa-ser" });
  });
});

describe("the truth's date", () => {
  test("is the latest day the truth knows of: a statement's publication or an event's start", () => {
    const breakup = (from: string, on: string | null) => ({ event: { from, to: from }, statements: [{ statedOn: on === null ? null : { on, precision: "day" } }] }) as unknown as Breakup;
    expect(truthAsOf([breakup("2026-10-10T00:00Z", null), breakup("2026-01-01T00:00Z", "2026-10-07")])).toBe(Date.UTC(2026, 9, 10));
    expect(truthAsOf([breakup("2025-01-01T00:00Z", "2026-03-01")])).toBe(Date.UTC(2026, 2, 1));
  });
});
