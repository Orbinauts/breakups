import { describe, expect, test } from "vitest";
import type { Breakup, BreakupKind, Precision, SourceId, Step, Verdict } from "../../src/index.ts";
import { selectPublished, type BodyOf } from "./select.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (iso: string): number => Date.parse(iso);
const iso = (ms: number): string => new Date(ms).toISOString();

interface RowOptions {
  kind?: BreakupKind;
  designator?: string | null;
  name?: string;
  launchedOn?: string | null;
  catalogueNumber?: number | null;
  regime?: Breakup["orbit"]["regime"];
  /** Each statement as `[source, statedOn day or null, url?]`. */
  statements?: [SourceId, string | null, string?][];
  id?: string;
  /** How finely the row dates the event; `none` by default, so the id takes the detector's day. */
  precision?: Precision;
  /** The instant the row states, ISO; none by default. */
  at?: string;
  /** The source the row's date was resolved from; its first statement's by default. */
  datedBy?: SourceId;
}

/** A ground-truth row with what the selection reads of it: its parent, kind, window (`from` to `to`, ISO), its dating, regime and dated statements. */
function row(catalogueNumber: number, from: string, to: string, options: RowOptions = {}): Breakup {
  const number = options.catalogueNumber === undefined ? catalogueNumber : options.catalogueNumber;
  const kind = options.kind ?? "breakup";
  const scoreable = (kind === "breakup" || kind === "anomalous") && number !== null;
  return {
    id: options.id ?? `${number}:${from.slice(0, 10)}`,
    parent: { catalogueNumber: number, designator: options.designator === undefined ? "2014-058A" : options.designator, name: options.name ?? `SAT ${catalogueNumber}`, class: "payload", owner: null, launchedOn: options.launchedOn === undefined ? "2014-09-27" : options.launchedOn },
    kind,
    event: { stated: from, at: options.at ?? null, from, to, precision: options.precision ?? "none" },
    orbit: { altitudeKm: null, apogeeKm: null, perigeeKm: null, inclinationDeg: null, regime: options.regime ?? "GEO" },
    resolvedFrom: { event: options.datedBy ?? options.statements?.[0]?.[0] ?? "catalogue" },
    scoreable,
    exemptReason: scoreable ? null : number === null ? "the parent has no catalogue number" : `a ${kind}`,
    statements: (options.statements ?? []).map(([source, on, url]) => ({ source, ref: `a ${source} statement`, statedOn: on === null ? null : { on, precision: "day", ref: "a ref" }, ...(url === undefined ? {} : { url }) })),
  } as unknown as Breakup;
}

function step(before: string, after: string): Step {
  return { beforeEpoch: at(before), afterEpoch: at(after), deltaKm: -1.5, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 4, z: 12 };
}

/** An object verdict on `number`, raised at `raisedAt` (ISO). */
function verdict(number: number, state: Verdict["state"], raisedAt: string, overrides: Partial<Verdict> = {}): Verdict {
  return { kind: "object", state, number, launch: "2014-058", raisedAt: at(raisedAt), step: null, event: null, evidence: { bodyClass: 0 }, reasons: [`${state} at ${raisedAt}`], ...overrides };
}

const noBodies: BodyOf = () => undefined;

describe("a detector confirmation landing on a reported breakup", () => {
  const luchRow = row(40258, "2026-01-30T06:09Z", "2026-01-30T06:10Z", {
    name: "Luch (Olymp-K 1)",
    precision: "minute",
    at: "2026-01-30T06:09Z",
    datedBy: "news",
    statements: [
      ["analyst", "2026-02-15", "https://planet4589.org/space/jsr/back/news.853.txt"],
      ["news", "2026-02-02", "https://universemagazine.com/en/russian-spy-satellite-destroyed-in-orbit/"],
      ["gcat", null],
    ],
  });
  const luchStep = step("2026-01-30T08:18Z", "2026-02-01T08:12Z");
  const confirmed = verdict(40258, "confirmed", "2026-02-27T04:00Z", { step: luchStep, event: { at: at("2026-01-31T08:15Z"), from: at("2026-01-31T00:00Z"), to: at("2026-01-31T16:00Z") }, evidence: { bodyClass: 0, pieces: 7 }, bodies: [67001, 67002] });

  test("is published confirmed, on the row, dated by the row, with its outside reports earliest first", () => {
    expect(selectPublished([confirmed], [luchRow], noBodies)).toEqual([
      {
        id: "40258-2026-01-30",
        state: "confirmed",
        raisedAt: "2026-02-27T04:00:00.000Z",
        confirmedAt: "2026-02-27T04:00:00.000Z",
        parent: { catalogueNumber: 40258, designator: "2014-058A", name: "Luch (Olymp-K 1)", launchedOn: "2014-09-27" },
        event: { at: "2026-01-31T08:15:00.000Z", from: "2026-01-31T00:00:00.000Z", to: "2026-01-31T16:00:00.000Z" },
        rowEvent: { at: "2026-01-30T06:09:00.000Z", from: "2026-01-30T06:09:00.000Z", to: "2026-01-30T06:10:00.000Z", precision: "minute", source: "news", row: "40258:2026-01-30" },
        step: { beforeEpoch: "2026-01-30T08:18:00.000Z", afterEpoch: "2026-02-01T08:12:00.000Z", deltaKm: -1.5, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 4, z: 12 },
        reasons: ["confirmed at 2026-02-27T04:00Z"],
        reports: [
          { source: "news", date: "2026-02-02", precision: "day", url: "https://universemagazine.com/en/russian-spy-satellite-destroyed-in-orbit/" },
          { source: "analyst", date: "2026-02-15", precision: "day", url: "https://planet4589.org/space/jsr/back/news.853.txt" },
        ],
        evidence: { bodyClass: 0, pieces: 7 },
        bodies: [67001, 67002],
        candidates: [],
        row: "40258:2026-01-30",
        verdicts: [
          {
            state: "confirmed",
            raisedAt: "2026-02-27T04:00:00.000Z",
            step: { beforeEpoch: "2026-01-30T08:18:00.000Z", afterEpoch: "2026-02-01T08:12:00.000Z", deltaKm: -1.5, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 4, z: 12 },
            event: { at: "2026-01-31T08:15:00.000Z", from: "2026-01-31T00:00:00.000Z", to: "2026-01-31T16:00:00.000Z" },
            evidence: { bodyClass: 0, pieces: 7 },
            reasons: ["confirmed at 2026-02-27T04:00Z"],
            bodies: [67001, 67002],
            candidates: [],
          },
        ],
      },
    ]);
  });
});

describe("the id's day", () => {
  const estimate = { at: at("2026-01-31T08:15Z"), from: at("2026-01-30T08:18Z"), to: at("2026-02-01T08:12Z") };
  const confirmed = verdict(40258, "confirmed", "2026-02-27T04:00Z", { step: step("2026-01-30T08:18Z", "2026-02-01T08:12Z"), event: estimate });
  const idOn = (options: RowOptions, from = "2026-01-30T00:00Z", to = "2026-01-31T00:00Z") => selectPublished([confirmed], [row(40258, from, to, { statements: [["news", "2026-02-02"]], ...options })], noBodies).map((b) => b.id);

  test("is the row's where the row dates the event to the second, minute, hour or day: its instant, else its start", () => {
    expect(idOn({ precision: "second", at: "2026-01-30T06:09:03Z" }, "2026-01-30T06:09:03Z", "2026-01-30T06:09:04Z")).toEqual(["40258-2026-01-30"]);
    expect(idOn({ precision: "minute", at: "2026-01-30T06:09Z" }, "2026-01-30T06:09Z", "2026-01-30T06:10Z")).toEqual(["40258-2026-01-30"]);
    expect(idOn({ precision: "hour", at: "2026-01-30T23:30Z" }, "2026-01-30T23:00Z", "2026-01-31T00:00Z")).toEqual(["40258-2026-01-30"]);
    expect(idOn({ precision: "day" })).toEqual(["40258-2026-01-30"]);
  });

  test("is the row's whatever source dated it, GCAT's too, and the row's event names that source", () => {
    const [breakup] = selectPublished([confirmed], [row(40258, "2026-01-30T02:10Z", "2026-01-30T02:10Z", { statements: [["gcat", null]], precision: "minute", at: "2026-01-30T02:10Z" })], noBodies);
    expect(breakup!.id).toBe("40258-2026-01-30");
    expect(breakup!.rowEvent).toEqual({ at: "2026-01-30T02:10:00.000Z", from: "2026-01-30T02:10:00.000Z", to: "2026-01-30T02:10:00.000Z", precision: "minute", source: "gcat", row: "40258:2026-01-30" });
    expect(breakup!.reports).toEqual([]);
  });

  test("is the detector's where the row dates the event to the month, the year or not at all", () => {
    expect(idOn({ precision: "month" }, "2026-01-01T00:00Z", "2026-02-01T00:00Z")).toEqual(["40258-2026-01-31"]);
    expect(idOn({ precision: "year" }, "2026-01-01T00:00Z", "2027-01-01T00:00Z")).toEqual(["40258-2026-01-31"]);
    expect(idOn({ precision: "none" })).toEqual(["40258-2026-01-31"]);
  });
});

describe("an exempt confirmation", () => {
  test("under a crewed station's launch is left out", () => {
    const onStation = verdict(25544, "confirmed", "2026-03-01T00:00Z", { launch: "1998-067" });
    expect(selectPublished([onStation], [], noBodies)).toEqual([]);
  });

  test("under a visiting craft's launch, not on its rocket body, is left out; on its rocket body it is published", () => {
    const onCraft = verdict(52738, "confirmed", "2026-03-01T00:00Z", { launch: "2022-060", evidence: { bodyClass: 0 } });
    const onStage = verdict(52739, "confirmed", "2026-03-01T00:00Z", { launch: "2022-060", evidence: { bodyClass: 1 } });
    expect(selectPublished([onCraft, onStage], [], noBodies).map((b) => b.parent.catalogueNumber)).toEqual([52739]);
  });

  test("inside a release row's window is left out (LDPE 1, W-4)", () => {
    const release = row(64543, "2026-05-10T00:00Z", "2026-05-11T00:00Z", { kind: "release", regime: "LEO", statements: [["news", "2026-05-12"], ["odqn", "2026-06-01"]] });
    const confirmed = verdict(64543, "confirmed", "2026-05-20T00:00Z");
    expect(selectPublished([confirmed], [release], noBodies)).toEqual([]);
  });

  test("inside the window of a row naming the launch alone is published with no row, no row's event and no reports, dated by the detector, the parent from the catalogue (Intelsat 805)", () => {
    const launchOnly = row(25371, "2026-06-19T23:35Z", "2026-08-18T23:35Z", { catalogueNumber: null, designator: "1998-037", name: "INTELSAT 805", id: "A:1998-037:2026-06-19", statements: [["catalogue", null]] });
    const intelsatStep = step("2026-07-29T20:14Z", "2026-07-30T13:06Z");
    const suspected = verdict(25371, "suspected", "2026-07-31T20:00Z", { launch: "1998-037", step: intelsatStep });
    const confirmed = verdict(25371, "confirmed", "2026-08-20T04:00Z", { launch: "1998-037", step: intelsatStep, event: { at: at("2026-07-30T04:50Z"), from: at("2026-07-30T00:00Z"), to: at("2026-07-30T12:00Z") } });
    const bodyOf: BodyOf = (number) => (number === 25371 ? { designator: "1998-037A", name: "INTELSAT 805 (IS-805)", launch: "1998-06-18" } : undefined);
    expect(selectPublished([suspected, confirmed], [launchOnly], bodyOf)).toMatchObject([
      { id: "25371-2026-07-30", state: "confirmed", raisedAt: "2026-07-31T20:00:00.000Z", confirmedAt: "2026-08-20T04:00:00.000Z", parent: { catalogueNumber: 25371, designator: "1998-037A", name: "INTELSAT 805 (IS-805)", launchedOn: "1998-06-18" }, rowEvent: null, row: null, reports: [] },
    ]);
  });
});

describe("a row that never makes a verdict publishable", () => {
  const suspected = verdict(64543, "suspected", "2026-05-12T00:00Z", { step: step("2026-05-10T06:00Z", "2026-05-10T18:00Z") });

  test("is a release row, whatever reports it holds (LDPE 1, W-4)", () => {
    const release = row(64543, "2026-05-10T00:00Z", "2026-05-11T00:00Z", { kind: "release", regime: "LEO", statements: [["news", "2026-05-12"], ["odqn", "2026-06-01"]] });
    expect(selectPublished([suspected], [release], noBodies)).toEqual([]);
  });

  test("is a row whose only statements are GCAT's and the catalogue's, dated or not", () => {
    const listed = row(64543, "2026-05-10T00:00Z", "2026-05-11T00:00Z", { regime: "LEO", statements: [["gcat", "2026-05-11"], ["catalogue", "2026-05-13"], ["catalogue", null]] });
    expect(selectPublished([suspected], [listed], noBodies)).toEqual([]);
  });
});

describe("verdicts on one step (USA 32)", () => {
  const usaStep = step("2026-09-13T12:59Z", "2026-09-14T20:48Z");
  const usaEvent = { at: at("2026-09-13T21:20Z"), from: at("2026-09-13T13:00Z"), to: at("2026-09-14T06:00Z") };
  const usaRow = row(19460, "2026-09-13T00:00Z", "2026-09-14T00:00Z", { regime: "LEO", name: "USA 32", designator: "1988-078A", launchedOn: null, statements: [["s4s-notice", "2026-09-17"], ["gcat", null]] });
  const suspected = verdict(19460, "suspected", "2026-09-15T12:00Z", { launch: "1988-078", step: usaStep, event: { ...usaEvent, at: at("2026-09-14T02:00Z") } });
  const confirmed = verdict(19460, "confirmed", "2026-09-17T00:00Z", { launch: "1988-078", step: usaStep, event: usaEvent, evidence: { bodyClass: 0, noticed: 1 } });

  test("are one breakup, confirmed from the earlier of the confirmation and the notice, raised at the first, described by the latest", () => {
    const published = selectPublished([suspected, confirmed], [usaRow], noBodies);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      id: "19460-2026-09-13",
      state: "confirmed",
      raisedAt: "2026-09-15T12:00:00.000Z",
      confirmedAt: "2026-09-17T00:00:00.000Z",
      event: { at: "2026-09-13T21:20:00.000Z" },
      evidence: { bodyClass: 0, noticed: 1 },
      row: "19460:2026-09-13",
      reports: [{ source: "s4s-notice", date: "2026-09-17", precision: "day", url: null }],
    });
    expect(published[0]!.verdicts.map((v) => [v.state, v.raisedAt])).toEqual([
      ["suspected", "2026-09-15T12:00:00.000Z"],
      ["confirmed", "2026-09-17T00:00:00.000Z"],
    ]);
  });

  test("stay confirmed when the step expires afterwards", () => {
    const expired = verdict(19460, "expired", "2026-10-15T00:00Z", { step: usaStep });
    expect(selectPublished([suspected, confirmed, expired], [usaRow], noBodies)).toMatchObject([{ state: "confirmed" }]);
  });

  test("take the parent's launch from the catalogue where the row gives none", () => {
    const bodyOf: BodyOf = (number) => (number === 19460 ? { designator: "1988-078A", name: "USA 32", launch: "1988-09-02" } : undefined);
    expect(selectPublished([suspected, confirmed], [usaRow], bodyOf)[0]!.parent).toEqual({ catalogueNumber: 19460, designator: "1988-078A", name: "USA 32", launchedOn: "1988-09-02" });
  });

  test("are confirmed from the notice's day where the notice comes before the detector's confirmation", () => {
    const earlier = row(19460, "2026-09-13T00:00Z", "2026-09-14T00:00Z", { regime: "LEO", statements: [["s4s-notice", "2026-09-16"]] });
    expect(selectPublished([suspected, confirmed], [earlier], noBodies)[0]!.confirmedAt).toBe("2026-09-16T00:00:00.000Z");
  });
});

describe("a confirmation from the pieces alone, with no step", () => {
  const yaoganRow = row(68196, "2026-09-04T00:00Z", "2026-09-05T00:00Z", { regime: "LEO", name: "Yaogan-50 02", statements: [["catalogue", null], ["news", "2026-09-06"]] });
  const suspected = verdict(68196, "suspected", "2026-09-04T20:00Z", { step: step("2026-09-04T02:00Z", "2026-09-04T10:00Z"), event: { at: at("2026-09-04T05:00Z"), from: at("2026-09-04T02:00Z"), to: at("2026-09-04T10:00Z") } });
  const pieces = verdict(68196, "confirmed", "2026-09-10T20:00Z", { event: { at: at("2026-07-24T06:35Z"), from: at("2026-07-20T00:00Z"), to: at("2026-07-28T00:00Z") }, bodies: [68301] });

  test("joins the breakup of the row it lands on, which the latest verdict then describes", () => {
    const published = selectPublished([suspected, pieces], [yaoganRow], noBodies);
    expect(published).toMatchObject([{ id: "68196-2026-07-24", state: "confirmed", raisedAt: "2026-09-04T20:00:00.000Z", confirmedAt: "2026-09-10T20:00:00.000Z", step: null, bodies: [68301], row: "68196:2026-09-04" }]);
    expect(published[0]!.verdicts.map((v) => v.state)).toEqual(["suspected", "confirmed"]);
  });

  test("with no estimate either takes its id from the day it was raised", () => {
    const bare = verdict(68196, "confirmed", "2026-09-10T20:00Z");
    expect(selectPublished([bare], [yaoganRow], noBodies)).toMatchObject([{ id: "68196-2026-09-10", event: null, step: null }]);
  });

  test("that lands on no row is a breakup of its own, the breakups listed in the order first raised", () => {
    const elsewhere = verdict(70001, "confirmed", "2026-03-01T08:00Z");
    expect(selectPublished([suspected, pieces, elsewhere], [yaoganRow], noBodies).map((b) => b.id)).toEqual(["70001-2026-03-01", "68196-2026-07-24"]);
  });
});

describe("verdicts never published", () => {
  test("are a cloud's, a watch, a manoeuvre, a scoped step, and a dismissal or expiry alone", () => {
    const onRow = row(12456, "2026-10-05T00:00Z", "2026-10-06T00:00Z", { regime: "LEO", statements: [["news", "2026-10-06"], ["odqn", "2026-10-10"]] });
    const s = step("2026-10-05T12:42Z", "2026-10-05T16:07Z");
    const others: Verdict[] = [
      { ...verdict(12456, "confirmed", "2026-10-06T00:00Z"), kind: "cloud", number: null, launch: "1981-043" },
      ...(["watch", "manoeuvre", "scoped", "dismissed", "expired", "cloud-only"] as const).map((state) => verdict(12456, state, "2026-10-06T00:00Z", { step: s })),
    ];
    expect(selectPublished(others, [onRow], noBodies)).toEqual([]);
  });
});

describe("a suspected verdict", () => {
  const meteorStep = step("2026-10-05T12:42Z", "2026-10-05T16:07Z");
  const meteorRow = row(12456, "2026-10-05T00:00Z", "2026-10-06T00:00Z", { regime: "LEO", name: "Meteor 2-7", designator: "1981-043A", launchedOn: "1981-05-14", statements: [["analyst", "2026-10-07", "https://earthsky.org/space/another-satellite-breakup-meteor-2-7-oct-5-2026/"]] });
  const suspected = verdict(12456, "suspected", "2026-10-06T12:00Z", { launch: "1981-043", step: meteorStep, event: { at: at("2026-10-05T09:46Z"), from: at("2026-10-05T08:00Z"), to: at("2026-10-05T16:07Z") } });

  test("whose step brackets a breakup with an outside report is published suspected", () => {
    const [published, ...rest] = selectPublished([suspected], [meteorRow], noBodies);
    expect(rest).toEqual([]);
    expect(published).toMatchObject({ id: "12456-2026-10-05", state: "suspected", raisedAt: "2026-10-06T12:00:00.000Z", confirmedAt: null, row: "12456:2026-10-05", reports: [{ source: "analyst", date: "2026-10-07", precision: "day", url: "https://earthsky.org/space/another-satellite-breakup-meteor-2-7-oct-5-2026/" }] });
    expect(published!.verdicts.map((v) => v.state)).toEqual(["suspected"]);
  });

  test("on a parent whose reported breakup is outside the window is not published (OV2-5 R/B, TES R/B)", () => {
    const ov25 = row(3432, "1992-02-21T00:00Z", "1992-02-22T00:00Z", { regime: "LEO", statements: [["news", "1992-03-01"], ["hoosf-16e", "1992-04-01"]] });
    const early = verdict(3432, "suspected", "2026-01-11T00:00Z", { step: step("2026-01-09T00:00Z", "2026-01-10T00:00Z") });
    expect(selectPublished([early], [ov25], noBodies)).toEqual([]);
  });

  test("on a row whose agency notice is dated no earlier than the event is published confirmed from the notice's day", () => {
    const noticed = row(12456, "2026-10-05T00:00Z", "2026-10-06T00:00Z", { regime: "LEO", statements: [["odqn", "2026-10-05"], ["hoosf-16e", "2026-10-09"]] });
    expect(selectPublished([suspected], [noticed], noBodies)).toMatchObject([{ state: "confirmed", raisedAt: "2026-10-06T12:00:00.000Z", confirmedAt: "2026-10-05T00:00:00.000Z", reports: [{ source: "odqn", date: "2026-10-05" }, { source: "hoosf-16e", date: "2026-10-09" }] }]);
  });

  test("on a row whose ESA row names no object, placed by the truth build's rule, is reported by it but not confirmed by it", () => {
    const placed = row(12456, "2026-10-05T00:00Z", "2026-10-06T00:00Z", { regime: "LEO", statements: [["esa-ser", "2026-10-07"], ["news", "2026-10-08"]] });
    placed.statements[0] = { ...placed.statements[0]!, parent: { catalogueNumber: null, designator: null, name: null } };
    expect(selectPublished([suspected], [placed], noBodies)).toMatchObject([{ state: "suspected", confirmedAt: null, reports: [{ source: "esa-ser", date: "2026-10-07" }, { source: "news", date: "2026-10-08" }] }]);
  });

  test("on a row whose only agency notice predates the event is not published", () => {
    const stale = row(12456, "2026-10-05T00:00Z", "2026-10-06T00:00Z", { regime: "LEO", statements: [["s4s-notice", "2026-10-04"]] });
    expect(selectPublished([suspected], [stale], noBodies)).toEqual([]);
  });

  test("on a row whose agency statement is undated is not confirmed by it, nor reported by it", () => {
    const undated = row(12456, "2026-10-05T00:00Z", "2026-10-06T00:00Z", { regime: "LEO", statements: [["hoosf-16e", null], ["news", "2026-10-08"]] });
    expect(selectPublished([suspected], [undated], noBodies)).toMatchObject([{ state: "suspected", confirmedAt: null, reports: [{ source: "news", date: "2026-10-08" }] }]);
    const undatedOnly = row(12456, "2026-10-05T00:00Z", "2026-10-06T00:00Z", { regime: "LEO", statements: [["hoosf-16e", null]] });
    expect(selectPublished([suspected], [undatedOnly], noBodies)).toEqual([]);
  });

  test("that expires or is dismissed later in the replay is not published", () => {
    const expired = verdict(12456, "expired", "2026-11-05T12:00Z", { step: meteorStep });
    const dismissed = verdict(12456, "dismissed", "2026-10-07T12:00Z", { step: step("2026-10-05T14:00Z", "2026-10-05T20:00Z") });
    expect(selectPublished([suspected, expired], [meteorRow], noBodies)).toEqual([]);
    expect(selectPublished([suspected, dismissed], [meteorRow], noBodies)).toEqual([]);
  });

  test("raised again after its step expired is published", () => {
    const expired = verdict(12456, "expired", "2026-10-06T16:00Z", { step: meteorStep });
    const again = verdict(12456, "suspected", "2026-10-06T20:00Z", { step: meteorStep });
    expect(selectPublished([suspected, expired, again], [meteorRow], noBodies)).toMatchObject([{ state: "suspected", raisedAt: "2026-10-06T12:00:00.000Z" }]);
  });

  test("whose expiry is on another step, or another object, is published", () => {
    const elsewhere = verdict(12456, "expired", "2026-11-05T12:00Z", { step: step("2026-09-01T00:00Z", "2026-09-02T00:00Z") });
    const otherObject = verdict(12457, "dismissed", "2026-10-07T12:00Z", { step: meteorStep });
    expect(selectPublished([suspected, elsewhere, otherObject], [meteorRow], noBodies)).toHaveLength(1);
  });

  test("with no report on the row it lands on is not published", () => {
    const unreported = row(12456, "2026-10-05T00:00Z", "2026-10-06T00:00Z", { regime: "LEO" });
    expect(selectPublished([suspected], [unreported], noBodies)).toEqual([]);
  });
});

describe("verdicts on one row whose steps do not overlap", () => {
  const wide = row(41000, "2026-05-01T00:00Z", "2026-05-20T00:00Z", { statements: [["news", "2026-05-21"]] });
  const first = verdict(41000, "suspected", "2026-05-04T12:00Z", { step: step("2026-05-03T00:00Z", "2026-05-04T00:00Z") });
  const second = verdict(41000, "suspected", "2026-05-13T12:00Z", { step: step("2026-05-12T00:00Z", "2026-05-13T00:00Z") });

  test("are two breakups", () => {
    expect(selectPublished([first, second], [wide], noBodies).map((b) => [b.id, b.verdicts.length])).toEqual([
      ["41000-2026-05-04", 1],
      ["41000-2026-05-13", 1],
    ]);
  });

  test("and a confirmation with no step on that row joins only the latest of them", () => {
    const pieces = verdict(41000, "confirmed", "2026-05-25T00:00Z");
    expect(selectPublished([first, second, pieces], [wide], noBodies).map((b) => [b.id, b.state, b.verdicts.length])).toEqual([
      ["41000-2026-05-04", "suspected", 1],
      ["41000-2026-05-13", "confirmed", 2],
    ]);
  });

  test("are joined, where a confirmation with no step was raised first, by the one landing on its row", () => {
    const pieces = verdict(41000, "confirmed", "2026-05-02T00:00Z");
    expect(selectPublished([pieces, first], [wide], noBodies).map((b) => [b.id, b.state, b.verdicts.length])).toEqual([["41000-2026-05-02", "confirmed", 2]]);
  });
});

describe("an exempt confirmation on the step of a reported suspected verdict", () => {
  test("is left out alone, and the suspected verdict is published on its own report", () => {
    const stationStep = step("2026-03-01T00:00Z", "2026-03-01T12:00Z");
    const stationRow = row(25544, "2026-03-01T00:00Z", "2026-03-02T00:00Z", { regime: "LEO", statements: [["news", "2026-03-02"]] });
    const suspected = verdict(25544, "suspected", "2026-03-01T20:00Z", { launch: "1998-067", step: stationStep });
    const exempt = verdict(25544, "confirmed", "2026-03-03T00:00Z", { launch: "1998-067", step: stationStep });
    const published = selectPublished([suspected, exempt], [stationRow], noBodies);
    expect(published).toMatchObject([{ id: "25544-2026-03-01", state: "suspected", confirmedAt: null, row: "25544:2026-03-01" }]);
    expect(published[0]!.verdicts.map((v) => v.state)).toEqual(["suspected"]);
  });
});
