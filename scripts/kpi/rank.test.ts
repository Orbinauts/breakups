import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { CUTS, FEATURES, FROZEN_AT, FROZEN_RANKER, byScore, criterionOf, cutsOf, featuresOf, fitLogistic, fitRankSum, liveLists, monthOf, monthlyLists, percentileAlong, readList, scoreOf, splitOf, yearlyLists, type EarlyWarning, type Features, type Scored, type Target } from "./rank.ts";

const DAY = 86_400_000;
const at = (iso: string): number => Date.parse(iso);

/** An early warning's evidence as a suspected verdict of the 2008 replay recorded it: a dead payload's step in a highly elliptical orbit. */
const EVIDENCE: Record<string, number> = { regime: 3, bodyClass: 0, delta1: 176.8, z1: 12.6, deltaKm: 176.9, zk: 12.8, zMean: 17.75, k: 2, spanHours: 10.56, rhoMedian: 1.023, stepEvidence: 13.34, deltaPerigeeKm: -19.96, deltaInclinationDeg: -0.1762, sigmaOwn: 1.376, bandScale1: 1, gapHours: 483.4, bstar: 0.00006961, bstarRatio: 1.128, perigeeKm: 93.9, recentCandidates: 3, deltaVMps: 5.71, deltaVNormalMps: 27.27, deltaVRadialMps: 0, impulseConsistency: 0, ageDays: 1100, n365: 0, n730: 0, siblingsLaunch: 0, siblingsOrbit: 0, opsStatus: 5, explanations: 1, signatures: 1, cadenceBefore: 0.2667, cadenceAfter: 4.547, ageFromLaunchDays: 6255, scopeIn: 1 };

/** A scored early warning for the lists. */
function warning(raisedAt: number, score: number, label: 0 | 1, extra: Partial<Scored> = {}): Scored {
  const year = new Date(raisedAt).getUTCFullYear();
  return { year, split: splitOf(year), number: 10_000 + Math.round(score * 1000), raisedAt, month: monthOf(raisedAt, year), label, outcome: label === 1 ? "detection" : "false-alarm", event: null, deadline: null, catalogueAt: null, timingErrorMinutes: null, score, ...extra };
}

/** A training row with features drawn from a fixed sequence, the real ones shifted on two features. */
function synthetic(n: number): EarlyWarning[] {
  let seed = 12345;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  return Array.from({ length: n }, (_, i) => {
    const label = (i % 25 === 0 ? 1 : 0) as 0 | 1;
    const features = Object.fromEntries(FEATURES.map((name) => [name, next()])) as Features;
    features.logBstarFold += label * 0.8;
    features.rho -= label * 0.8;
    features.working = 0;
    const raisedAt = at("2008-01-01T00:00:00Z") + i * DAY;
    return { year: 2008 + 2 * (i % 3), split: "train", number: i, launch: null, raisedAt, month: monthOf(raisedAt, 2008), outcome: label === 1 ? "detection" : "false-alarm", label, event: null, eventName: null, line: null, deadline: null, catalogueAt: null, timingErrorMinutes: null, scoped: false, confirmed: false, bodyClass: "payload", regime: "LEO", status: "unknown", features };
  });
}

describe("the early warning's features", () => {
  test("are read from the verdict's evidence at the raising, each as the note describes it", () => {
    const f = featuresOf(EVIDENCE);
    expect(Object.keys(f)).toEqual([...FEATURES]);
    expect(f.logZ).toBeCloseTo(Math.log10(12.8), 12);
    expect(f.logStepMetres).toBeCloseTo(Math.log10(176_900), 12);
    expect(f.logStepOverNoise).toBeCloseTo(Math.log10(176.9 / 1.376), 12);
    expect(f.logBstarFold).toBeCloseTo(Math.log10(1.128), 12);
    expect([f.dead, f.working, f.payload, f.heo, f.quiet, f.bstarRead, f.scopeIn]).toEqual([1, 0, 1, 1, 1, 1, 1]);
    expect(f.logAgeYears).toBeCloseTo(Math.log10(6255 / 365.25), 12);
  });

  test("read a drag term that was not measured as no change, and say it was not read", () => {
    const { bstarRatio: _, ...withoutRatio } = EVIDENCE;
    const f = featuresOf(withoutRatio);
    expect(f.logBstarFold).toBe(0);
    expect(f.bstarRead).toBe(0);
    expect(featuresOf({ ...EVIDENCE, bstarRatio: 0.1 }).logBstarFold).toBeCloseTo(1, 12);
  });
});

describe("the frozen ranker", () => {
  test("is the logistic regression chosen on the training years, its coefficients as frozen", () => {
    expect(FROZEN_AT).toBe("2026-10-11T17:34:50Z");
    expect(FROZEN_RANKER.kind).toBe("logistic");
    if (FROZEN_RANKER.kind !== "logistic") return;
    expect(FROZEN_RANKER.lambda).toBe(3);
    expect(FROZEN_RANKER.intercept).toBe(-6.188);
    expect(FROZEN_RANKER.features.map((f) => f.name)).toEqual(FEATURES.filter((name) => name !== "working"));
    expect(FROZEN_RANKER.features.find((f) => f.name === "logStepMetres")).toEqual({ name: "logStepMetres", mean: 3.52, sd: 1.244, weight: -0.7851 });
    expect(FROZEN_RANKER.features.find((f) => f.name === "rho")).toEqual({ name: "rho", mean: 1.609, sd: 0.7409, weight: -0.7211 });
    // Any change to a coefficient changes the digest: the held-out years were read with these.
    expect(createHash("sha256").update(JSON.stringify(FROZEN_RANKER)).digest("hex")).toBe("308ee6cbfbc531f67fbdbe96e0082ca69531faad00709a5a4047fc9d82ccf96d");
  });

  test("scores an early warning the same every time", () => {
    const score = scoreOf(FROZEN_RANKER, featuresOf(EVIDENCE));
    expect(score).toBeCloseTo(0.032006618797423426, 12);
    expect(scoreOf(FROZEN_RANKER, featuresOf(EVIDENCE))).toBe(score);
  });

  test("reads a missing feature as the training mean", () => {
    const f = featuresOf(EVIDENCE);
    if (FROZEN_RANKER.kind !== "logistic") return;
    const mean = FROZEN_RANKER.features.find((x) => x.name === "logAgeYears")!.mean;
    expect(scoreOf(FROZEN_RANKER, { ...f, logAgeYears: Number.NaN })).toBeCloseTo(scoreOf(FROZEN_RANKER, { ...f, logAgeYears: mean }), 12);
  });
});

describe("fitting the rankers", () => {
  const rows = synthetic(600);

  test("the logistic regression is deterministic and finds the features that separate", () => {
    const a = fitLogistic(rows, 3);
    expect(fitLogistic(rows, 3)).toEqual(a);
    // In another order the sums differ in their last bits only.
    const b = fitLogistic([...rows].reverse(), 3);
    b.features.forEach((f, i) => expect(f.weight).toBeCloseTo(a.features[i]!.weight, 2));
    expect(a.features.some((f) => f.name === "working")).toBe(false);
    const weight = (name: string): number => a.features.find((f) => f.name === name)!.weight;
    expect(weight("logBstarFold")).toBeGreaterThan(0.5);
    expect(weight("rho")).toBeLessThan(-0.5);
  });

  test("a heavier penalty shrinks the weights", () => {
    const light = fitLogistic(rows, 1);
    const heavy = fitLogistic(rows, 100);
    const size = (r: typeof light): number => r.features.reduce((s, f) => s + Math.abs(f.weight), 0);
    expect(size(heavy)).toBeLessThan(size(light));
  });

  test("the hand-built score takes the separating features, each on its side, and ranks the real ones higher", () => {
    const ranker = fitRankSum(rows);
    expect(ranker.features.map((f) => [f.name, f.sign])).toEqual(expect.arrayContaining([["logBstarFold", 1], ["rho", -1]]));
    for (const f of ranker.features) expect(f.cuts).toHaveLength(CUTS);
    const mean = (label: 0 | 1): number => {
      const scores = rows.filter((r) => r.label === label).map((r) => scoreOf(ranker, r.features));
      return scores.reduce((s, x) => s + x, 0) / scores.length;
    };
    expect(mean(1)).toBeGreaterThan(mean(0));
  });

  test("a percentile is read along the cut points, the middle of a run of ties, a half where nothing is read", () => {
    const cuts = cutsOf([0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(cuts).toHaveLength(CUTS);
    expect(percentileAlong(cuts, -1)).toBe(0);
    expect(percentileAlong(cuts, 11)).toBe(1);
    expect(percentileAlong(cuts, Number.NaN)).toBe(0.5);
    expect(percentileAlong([0, 0, 0, 1, 2], 0)).toBe(0.25);
    expect(percentileAlong([0, 1, 2, 3, 4], 2.5)).toBe(0.625);
  });
});

describe("the monthly lists", () => {
  const rows = [
    warning(at("2009-03-02T00:00:00Z"), 0.9, 0),
    warning(at("2009-03-05T00:00:00Z"), 0.5, 1),
    warning(at("2009-03-09T00:00:00Z"), 0.5, 0),
    warning(at("2009-03-20T00:00:00Z"), 0.1, 1),
    warning(at("2009-04-01T00:00:00Z"), 0.2, 1),
    warning(at("2009-12-30T00:00:00Z"), 0.3, 0),
  ];

  test("take the top k raised in each month, ranked at its end, ties to the earlier raised", () => {
    const listed = monthlyLists(rows, 2);
    expect(listed.map((l) => [l.warning.score, l.warning.raisedAt, l.rank])).toEqual([
      [0.9, at("2009-03-02T00:00:00Z"), 1],
      [0.5, at("2009-03-05T00:00:00Z"), 2],
      [0.2, at("2009-04-01T00:00:00Z"), 1],
      [0.3, at("2009-12-30T00:00:00Z"), 1],
    ]);
    expect(listed[0]!.listedAt).toBe(at("2009-04-01T00:00:00Z"));
    expect(listed[2]!.listedAt).toBe(at("2009-05-01T00:00:00Z"));
  });

  test("are the same whatever order the rows come in", () => {
    expect(monthlyLists([...rows].reverse(), 2)).toEqual(monthlyLists(rows, 2));
    expect([...rows].sort(byScore)[0]!.score).toBe(0.9);
  });

  test("list a year's alert raised in the first days after it with its December, named once it is raised", () => {
    const late = warning(at("2010-01-02T08:00:00Z"), 0.4, 0, { year: 2009, split: "validation", month: monthOf(at("2010-01-02T08:00:00Z"), 2009) });
    expect(late.month).toBe("2009-12");
    const listed = monthlyLists([...rows, late], 1).find((l) => l.warning.month === "2009-12")!;
    expect(listed.warning).toBe(late);
    expect(listed.listedAt).toBe(at("2010-01-02T08:00:00Z"));
  });

  test("are read for precision and for the targets named before the first fragment", () => {
    const flagged = warning(at("2009-05-10T00:00:00Z"), 0.8, 1, { event: "a", deadline: at("2009-06-15T00:00:00Z"), catalogueAt: at("2009-06-15T00:00:00Z"), timingErrorMinutes: 12 });
    const tooLate = warning(at("2009-07-10T00:00:00Z"), 0.8, 1, { event: "b", deadline: at("2009-07-20T00:00:00Z"), catalogueAt: at("2009-07-20T00:00:00Z"), timingErrorMinutes: 30 });
    const targets: Target[] = ["a", "b", "c"].map((id) => ({ id, name: id, year: 2009, split: "validation", status: "detected" }));
    const reading = readList(monthlyLists([...rows, flagged, tooLate], 1), "validation", targets, 6);
    expect([reading.entries, reading.real, reading.targets, reading.inList, reading.onTime]).toEqual([5, 3, 3, 2, 1]);
    expect(reading.precision).toBeCloseTo(0.6, 12);
    expect(reading.caught).toEqual(["a"]);
    expect(reading.leadDays).toBeCloseTo(14, 12);
    expect(reading.timingMinutes).toBe(12);
  });

  test("the yearly lists take the top k of each calendar year", () => {
    expect(yearlyLists(rows, 2).map((l) => l.warning.score)).toEqual([0.9, 0.5]);
  });

  test("the choice's criterion is the mean of the monthly top five's and top ten's precision", () => {
    const month = Array.from({ length: 12 }, (_, i) => warning(at("2008-02-01T00:00:00Z") + i * DAY, 1 - i / 100, i === 0 || i === 7 ? 1 : 0));
    expect(criterionOf(month)).toBeCloseTo((1 / 5 + 2 / 10) / 2, 12);
  });
});

describe("the live list", () => {
  test("lists an alert when raised where its score reaches the threshold the months before set, reading no label", () => {
    const rows: Scored[] = [];
    // A year of history: three alerts a month, scored 0.1, 0.2 and 0.3.
    for (let m = 0; m < 12; m++) for (const s of [0.1, 0.2, 0.3]) rows.push(warning(Date.UTC(2008, m, 10) + s * DAY, s, 0));
    const now = [warning(at("2009-01-05T00:00:00Z"), 0.25, 1), warning(at("2009-01-06T00:00:00Z"), 0.3, 0), warning(at("2009-01-07T00:00:00Z"), 0.35, 1)];
    const listed = liveLists([...rows, ...now], 1).filter((l) => l.warning.year === 2009);
    // One a month over the twelve before: the twelfth highest score of the year before, 0.3.
    expect(listed.map((l) => l.warning.score)).toEqual([0.3, 0.35]);
    expect(listed.map((l) => l.listedAt)).toEqual([at("2009-01-06T00:00:00Z"), at("2009-01-07T00:00:00Z")]);
    expect(listed.every((l) => l.rank === null)).toBe(true);
    // Two a month: the twenty-fourth highest, 0.2.
    expect(liveLists([...rows, ...now], 2).filter((l) => l.warning.year === 2009).map((l) => l.warning.score)).toEqual([0.25, 0.3, 0.35]);
  });

  test("lists nothing in the first month, which has no month before it, nor in a month whose window raised nothing", () => {
    const rows = [warning(at("2008-01-05T00:00:00Z"), 0.9, 1), warning(at("2008-02-05T00:00:00Z"), 0.95, 0), warning(at("2008-02-06T00:00:00Z"), 0.5, 1), warning(at("2010-03-05T00:00:00Z"), 0.99, 0)];
    expect(liveLists(rows, 1).map((l) => [l.warning.month, l.warning.score])).toEqual([["2008-02", 0.95]]);
  });
});
