import { describe, expect, test } from "vitest";
import type { Breakup, Precision, PublishedBreakup, PublishedRowEvent, PublishedStep, PublishedVerdict, SourceId, Verdict } from "../../src/index.ts";
import { mergePublished, rekeyedBeforeRowEvent } from "./merge.ts";

const at = (iso: string): number => Date.parse(iso);

function step(before: string, after: string): PublishedStep {
  return { beforeEpoch: before, afterEpoch: after, deltaKm: -1.5, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 4, z: 12 };
}

function published(number: number, state: PublishedBreakup["state"], raisedAt: string, s: PublishedStep | null, overrides: Partial<PublishedBreakup> = {}): PublishedBreakup {
  const verdict: PublishedVerdict = { state, raisedAt, step: s, event: null, evidence: { bodyClass: 0 }, reasons: [`${state} at ${raisedAt}`], bodies: [], candidates: [] };
  const row = overrides.row === undefined ? `${number}:${raisedAt.slice(0, 10)}` : overrides.row;
  return {
    id: `${number}-${raisedAt.slice(0, 10)}`,
    state,
    raisedAt,
    confirmedAt: state === "confirmed" ? raisedAt : null,
    parent: { catalogueNumber: number, designator: "1988-018A", name: `SAT ${number}`, launchedOn: "1988-03-08" },
    event: null,
    rowEvent: row === null ? null : { at: null, from: `${raisedAt.slice(0, 10)}T00:00:00.000Z`, to: null, precision: "month", source: "gcat", row },
    step: s,
    reasons: verdict.reasons,
    reports: state === "suspected" ? [{ source: "analyst", date: raisedAt.slice(0, 10), precision: "day", url: null }] : [],
    evidence: verdict.evidence,
    bodies: [],
    candidates: [],
    row,
    verdicts: [verdict],
    ...overrides,
  };
}

/** An object verdict as the detector raises it, its step's epochs given as ISO. */
function verdict(number: number, state: Verdict["state"], raisedAt: string, s: PublishedStep | null): Verdict {
  return {
    kind: "object",
    state,
    number,
    launch: "1988-018",
    raisedAt: at(raisedAt),
    step: s === null ? null : { ...s, beforeEpoch: at(s.beforeEpoch), afterEpoch: at(s.afterEpoch) },
    event: null,
    evidence: {},
    reasons: [],
  };
}

describe("a run merged into what is already published", () => {
  const meteorStep = step("2026-10-05T00:00:00.000Z", "2026-10-06T00:00:00.000Z");
  const meteor = published(12456, "suspected", "2026-10-06T04:00:00.000Z", meteorStep);
  const luch = published(40258, "confirmed", "2026-02-27T04:00:00.000Z", step("2026-01-30T08:18:00.000Z", "2026-02-01T08:12:00.000Z"));

  test("keeps a confirmed breakup the run no longer mentions, for good", () => {
    expect(mergePublished([luch], [], [])).toEqual([luch]);
  });

  test("keeps a suspected breakup the run does not mention until a verdict on its step lets it go", () => {
    expect(mergePublished([meteor], [], [])).toEqual([meteor]);
    expect(mergePublished([meteor], [], [verdict(12456, "suspected", "2026-10-06T04:00:00.000Z", meteorStep)])).toEqual([meteor]);
  });

  test("drops a suspected breakup once the latest verdict on its step expired it, while a confirmed one stays", () => {
    const expiry = [verdict(12456, "suspected", "2026-10-06T04:00:00.000Z", meteorStep), verdict(12456, "expired", "2026-11-05T04:00:00.000Z", meteorStep)];
    expect(mergePublished([luch, meteor], [], expiry)).toEqual([luch]);
    const dismissal = [verdict(12456, "dismissed", "2026-10-09T04:00:00.000Z", meteorStep)];
    expect(mergePublished([luch, meteor], [], dismissal)).toEqual([luch]);
    const luchExpired = [verdict(40258, "expired", "2026-03-27T04:00:00.000Z", luch.step)];
    expect(mergePublished([luch], [], luchExpired)).toEqual([luch]);
  });

  test("ignores a verdict on another step or another object", () => {
    const elsewhere = [verdict(12456, "expired", "2026-11-05T04:00:00.000Z", step("2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z")), verdict(99999, "expired", "2026-11-05T04:00:00.000Z", meteorStep)];
    expect(mergePublished([meteor], [], elsewhere)).toEqual([meteor]);
  });

  test("keeps the id fixed on first publish when a later estimate moves the day, with the earlier raising and the latest verdict's fields", () => {
    const usaStep = step("2026-09-12T00:00:00.000Z", "2026-09-14T00:00:00.000Z");
    const first = published(19460, "suspected", "2026-09-15T04:00:00.000Z", usaStep, { id: "19460-2026-09-13", event: { at: "2026-09-13T06:00:00.000Z", from: "2026-09-13T00:00:00.000Z", to: "2026-09-13T12:00:00.000Z" } });
    const laterStep = step("2026-09-13T00:00:00.000Z", "2026-09-15T00:00:00.000Z");
    const later = published(19460, "confirmed", "2026-09-17T04:00:00.000Z", laterStep, {
      id: "19460-2026-09-14",
      raisedAt: "2026-09-16T04:00:00.000Z",
      confirmedAt: "2026-09-16T00:00:00.000Z",
      event: { at: "2026-09-14T02:00:00.000Z", from: "2026-09-13T20:00:00.000Z", to: "2026-09-14T08:00:00.000Z" },
      reports: [{ source: "s4s-notice", date: "2026-09-16", precision: "day", url: null }],
      evidence: { bodyClass: 0, pieces: 3 },
      bodies: [70001],
    });
    const [merged, ...rest] = mergePublished([first], [later], []);
    expect(rest).toEqual([]);
    expect(merged).toEqual({
      ...later,
      id: "19460-2026-09-13",
      raisedAt: "2026-09-15T04:00:00.000Z",
      confirmedAt: "2026-09-16T00:00:00.000Z",
      verdicts: [first.verdicts[0], later.verdicts[0]],
    });
  });

  test("keeps the id fixed on first publish when a later, finer row dates the breakup to another day, and takes the row's event from the run", () => {
    const luchStep = step("2026-01-30T08:18:00.000Z", "2026-02-01T08:12:00.000Z");
    const estimate = { at: "2026-01-31T08:15:00.000Z", from: "2026-01-30T08:18:00.000Z", to: "2026-02-01T08:12:00.000Z" };
    const first = published(40258, "confirmed", "2026-02-27T04:00:00.000Z", luchStep, { id: "40258-2026-01-31", event: estimate, row: null });
    const rowEvent: PublishedRowEvent = { at: "2026-01-30T06:09:00.000Z", from: "2026-01-30T06:09:00.000Z", to: "2026-01-30T06:10:00.000Z", precision: "minute", source: "news", row: "40258:2026-01-30" };
    const later = published(40258, "confirmed", "2026-02-27T04:00:00.000Z", luchStep, { id: "40258-2026-01-30", event: estimate, row: "40258:2026-01-30", rowEvent });
    expect(first.rowEvent).toBeNull();
    const [merged, ...rest] = mergePublished([first], [later], []);
    expect(rest).toEqual([]);
    expect(merged!.id).toBe("40258-2026-01-31");
    expect(merged!.row).toBe("40258:2026-01-30");
    expect(merged!.rowEvent).toEqual(rowEvent);
  });

  test("keeps the earlier confirmation, and a confirmed breakup stays confirmed when the run finds it suspected", () => {
    const s = step("2026-09-12T00:00:00.000Z", "2026-09-14T00:00:00.000Z");
    const confirmed = published(19460, "confirmed", "2026-09-17T04:00:00.000Z", s);
    const suspectedAgain = published(19460, "suspected", "2026-09-20T04:00:00.000Z", s);
    const [merged] = mergePublished([confirmed], [suspectedAgain], []);
    expect(merged!.state).toBe("confirmed");
    expect(merged!.confirmedAt).toBe("2026-09-17T04:00:00.000Z");
    expect(merged!.id).toBe(confirmed.id);
    expect(merged!.reasons).toEqual(suspectedAgain.reasons);
  });

  test("does not repeat a verdict both lists carry", () => {
    const fresh = { ...meteor, verdicts: [...meteor.verdicts, { ...meteor.verdicts[0]!, raisedAt: "2026-10-07T04:00:00.000Z" }] };
    expect(mergePublished([meteor], [fresh], []).map((b) => b.verdicts.length)).toEqual([2]);
  });

  test("matches a breakup by the row it landed on where the steps do not overlap", () => {
    const fromPieces = published(68196, "confirmed", "2026-05-01T04:00:00.000Z", null, { row: "68196:2026-04-20" });
    const onStep = published(68196, "confirmed", "2026-05-03T04:00:00.000Z", step("2026-04-19T00:00:00.000Z", "2026-04-21T00:00:00.000Z"), { row: "68196:2026-04-20" });
    expect(mergePublished([fromPieces], [onStep], []).map((b) => [b.id, b.verdicts.length])).toEqual([[fromPieces.id, 2]]);
  });

  test("keeps apart two breakups on one row whose steps do not overlap", () => {
    const first = published(41000, "suspected", "2026-05-04T12:00:00.000Z", step("2026-05-03T00:00:00.000Z", "2026-05-04T00:00:00.000Z"), { row: "41000:2026-05-01" });
    const second = published(41000, "suspected", "2026-05-13T12:00:00.000Z", step("2026-05-12T00:00:00.000Z", "2026-05-13T00:00:00.000Z"), { row: "41000:2026-05-01" });
    expect(mergePublished([first], [second], []).map((b) => [b.id, b.verdicts.length])).toEqual([
      [first.id, 1],
      [second.id, 1],
    ]);
  });

  test("merges a breakup with no step into the latest raised of the breakups on its row", () => {
    const first = published(41000, "suspected", "2026-05-04T12:00:00.000Z", step("2026-05-03T00:00:00.000Z", "2026-05-04T00:00:00.000Z"), { row: "41000:2026-05-01" });
    const second = published(41000, "suspected", "2026-05-13T12:00:00.000Z", step("2026-05-12T00:00:00.000Z", "2026-05-13T00:00:00.000Z"), { row: "41000:2026-05-01" });
    const fromPieces = published(41000, "confirmed", "2026-05-25T00:00:00.000Z", null, { row: "41000:2026-05-01" });
    expect(mergePublished([first, second], [fromPieces], []).map((b) => [b.id, b.state, b.verdicts.length])).toEqual([
      [first.id, "suspected", 1],
      [second.id, "confirmed", 2],
    ]);
  });

  test("adds a breakup published for the first time, and keeps two on one object apart, earliest raised first", () => {
    const another = published(12456, "suspected", "2026-08-01T04:00:00.000Z", step("2026-07-30T00:00:00.000Z", "2026-07-31T00:00:00.000Z"), { row: "12456:2026-07-30" });
    expect(mergePublished([meteor], [another, luch], []).map((b) => b.id)).toEqual([luch.id, another.id, meteor.id]);
  });

  test("matches a breakup with no step and no row by a verdict both carry", () => {
    const fromPieces = published(25371, "confirmed", "2026-05-01T04:00:00.000Z", null, { row: null });
    const again = { ...fromPieces, verdicts: [...fromPieces.verdicts, { ...fromPieces.verdicts[0]!, raisedAt: "2026-05-02T04:00:00.000Z" }] };
    const other = published(25371, "confirmed", "2026-08-01T04:00:00.000Z", null, { row: null });
    expect(mergePublished([fromPieces], [again, other], []).map((b) => [b.id, b.verdicts.length])).toEqual([[fromPieces.id, 2], [other.id, 1]]);
  });
});

/** A ground-truth row with what the re-key reads of it: its id and its dating. */
function truthRow(id: string, precision: Precision, at: string | null, from: string | null, to: string | null, source: SourceId): Breakup {
  return { id, event: { stated: id, at, from, to, precision }, resolvedFrom: { event: source } } as unknown as Breakup;
}

/** A breakup as the files written before `rowEvent` hold it. */
function beforeRowEvent(breakup: PublishedBreakup): PublishedBreakup {
  const { rowEvent, ...rest } = breakup;
  void rowEvent;
  return rest as PublishedBreakup;
}

describe("the breakups published before they carried the row's event", () => {
  const truth = [
    truthRow("40258:2026-01-30", "minute", "2026-01-30T06:09Z", "2026-01-30T06:09Z", "2026-01-30T06:10Z", "news"),
    truthRow("24753:2024-12-19", "minute", "2024-12-19T02:10Z", "2024-12-19T02:10Z", "2024-12-19T02:10Z", "gcat"),
    truthRow("68196:2026-09-04", "none", null, null, "2026-09-04T00:00Z", "catalogue"),
  ];
  const estimate = (day: string) => ({ at: `${day}T08:15:00.000Z`, from: `${day}T00:00:00.000Z`, to: `${day}T16:00:00.000Z` });
  const luch = beforeRowEvent(published(40258, "confirmed", "2026-02-27T04:00:00.000Z", null, { id: "40258-2026-01-31", event: estimate("2026-01-31"), row: "40258:2026-01-30" }));
  const dmsp = beforeRowEvent(published(24753, "confirmed", "2025-02-13T20:00:00.000Z", null, { id: "24753-2024-10-07", event: estimate("2024-10-07"), row: "24753:2024-12-19" }));
  const yaogan = beforeRowEvent(published(68196, "confirmed", "2026-09-03T20:00:00.000Z", null, { id: "68196-2026-07-24", event: estimate("2026-07-24"), row: "68196:2026-09-04" }));
  const intelsat = beforeRowEvent(published(25371, "confirmed", "2026-07-31T20:00:00.000Z", null, { id: "25371-2026-07-30", event: estimate("2026-07-30"), row: null }));

  test("are re-keyed once, as though first published today: the row's day where it dates the event to the day or finer, whatever source dated it", () => {
    const [newLuch, newDmsp] = rekeyedBeforeRowEvent([luch, dmsp], truth);
    expect(newLuch).toEqual({ ...luch, id: "40258-2026-01-30", rowEvent: { at: "2026-01-30T06:09:00.000Z", from: "2026-01-30T06:09:00.000Z", to: "2026-01-30T06:10:00.000Z", precision: "minute", source: "news", row: "40258:2026-01-30" } });
    expect(newDmsp!.id).toBe("24753-2024-12-19");
    expect(newDmsp!.rowEvent).toMatchObject({ precision: "minute", source: "gcat" });
  });

  test("keep the detector's day where their row is dated coarser, is gone from the truth, or there is none", () => {
    const gone = beforeRowEvent(published(40258, "confirmed", "2026-02-27T04:00:00.000Z", null, { id: "40258-2026-01-31", event: estimate("2026-01-31"), row: "40258:2026-01-29" }));
    expect(rekeyedBeforeRowEvent([yaogan, intelsat, gone], truth).map((b) => [b.id, b.rowEvent?.precision ?? null])).toEqual([
      ["68196-2026-07-24", "none"],
      ["25371-2026-07-30", null],
      ["40258-2026-01-31", null],
    ]);
  });

  test("are left alone once they carry the row's event, even a null one", () => {
    const carried = published(40258, "confirmed", "2026-02-27T04:00:00.000Z", null, { id: "40258-2026-01-31", event: estimate("2026-01-31"), row: "40258:2026-01-30", rowEvent: null });
    const rekeyed = rekeyedBeforeRowEvent([luch], truth);
    expect(rekeyedBeforeRowEvent([carried, ...rekeyed], truth)).toEqual([carried, ...rekeyed]);
  });
});
