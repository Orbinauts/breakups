import { describe, expect, test } from "vitest";
import type { PublishedBreakup, PublishedStep, PublishedVerdict, Verdict } from "../../src/index.ts";
import { mergePublished } from "./merge.ts";

const at = (iso: string): number => Date.parse(iso);

function step(before: string, after: string): PublishedStep {
  return { beforeEpoch: before, afterEpoch: after, deltaKm: -1.5, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 4, z: 12 };
}

function published(number: number, state: PublishedBreakup["state"], raisedAt: string, s: PublishedStep | null, overrides: Partial<PublishedBreakup> = {}): PublishedBreakup {
  const verdict: PublishedVerdict = { state, raisedAt, step: s, event: null, evidence: { bodyClass: 0 }, reasons: [`${state} at ${raisedAt}`], bodies: [], candidates: [] };
  return {
    id: `${number}-${raisedAt.slice(0, 10)}`,
    state,
    raisedAt,
    confirmedAt: state === "confirmed" ? raisedAt : null,
    parent: { catalogueNumber: number, designator: "1988-018A", name: `SAT ${number}`, launchedOn: "1988-03-08" },
    event: null,
    step: s,
    reasons: verdict.reasons,
    reports: state === "suspected" ? [{ source: "analyst", date: raisedAt.slice(0, 10), precision: "day", url: null }] : [],
    evidence: verdict.evidence,
    bodies: [],
    candidates: [],
    row: `${number}:${raisedAt.slice(0, 10)}`,
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
