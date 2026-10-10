import { describe, expect, test } from "vitest";
import { OUTCOMES } from "./log.ts";
import { MANOEUVRE_CLASSES } from "./manoeuvre.ts";
import { DETECTOR_PARAMETERS } from "./params.ts";
import { nodePrecessionDegPerDay } from "./series.ts";
import { DAY, HOUR, feed, meanMotionOf, noise, one, setOf, type SyntheticSet } from "./synthetic.test-support.ts";
import type { ElementSet } from "./elements.ts";

/**
 * The detector end to end on synthetic series, each the shape of one
 * thing the design must get right: a pure drag decay raises nothing; a
 * storm that moves a whole band is taken off as common mode; a bad set
 * the next sets undo is dismissed; a real step with a settling slope
 * after it is suspected on the right bracket, before its third day; a
 * day-old stage with no record of its own is still caught, by the prior;
 * and a geosynchronous object with a set every two days is caught across
 * its sparse sets. Then the object's record: a station-keeper's steps, a
 * young payload's raising campaign and a disposal lowering are
 * manoeuvres, a quiet rocket body's one step is unique, and a working
 * payload's step far larger than its own is atypical. The numbers are
 * modest: kilometres of semi-major axis for low orbits near 7,200 km,
 * noise of a few metres, as the catalogue's own fits scatter.
 */

const T0 = Date.UTC(2020, 3, 1);
const params = DETECTOR_PARAMETERS;

/** A drag decay of `rate` kilometres a day from `a0`, sampled every `stepHours`, with Gaussian noise of `sigma` kilometres, over `days`. */
function decaying(a0: number, rate: number, sigma: number, days: number, stepHours = 8, seed = 1, bstar = 1e-4): SyntheticSet[] {
  const gauss = noise(seed);
  const sets: SyntheticSet[] = [];
  for (let t = 0; t <= days * DAY; t += stepHours * HOUR) sets.push({ epochMs: T0 + t, aKm: a0 - rate * (t / DAY) + sigma * gauss(), bstar });
  return sets;
}

const suspected = (fed: ReturnType<typeof feed>) => fed.verdicts.filter((v) => v.state === "suspected");

describe("the detector on synthetic series", () => {
  test("a pure drag decay with its own noise raises nothing and logs no candidate", () => {
    const fed = feed(one(decaying(7200, 0.02, 0.004, 40).map((s) => setOf(1, s))));
    expect(suspected(fed)).toEqual([]);
    expect(fed.log.filter((r) => r.signals.outcome === OUTCOMES.suspected)).toEqual([]);
  });

  test("a storm that lowers every object of a band in proportion to its drag term raises nothing, since the band's common mode takes it off", () => {
    // Forty objects in one band, each decaying with its own drag term; on day 20 every orbit drops by 200 km per day per unit of B* at once.
    const batches: ReturnType<typeof setOf>[][] = [];
    const objects = Array.from({ length: 40 }, (_, i) => ({ number: 100 + i, bstar: 2e-4 * (1 + (i % 5)), gauss: noise(10 + i) }));
    for (let t = 0; t <= 30 * DAY; t += 8 * HOUR) {
      const batch = objects.map((o) => {
        const storm = t >= 20 * DAY ? -200 * o.bstar : 0;
        return setOf(o.number, { epochMs: T0 + t, aKm: 7100 - 0.05 * (t / DAY) * (o.bstar / 2e-4) + storm + 0.003 * o.gauss(), bstar: o.bstar });
      });
      batches.push(batch);
    }
    const fed = feed(batches);
    expect(suspected(fed)).toEqual([]);
    // The same band on a quiet day with one object alone making that move would be a candidate: the storm's move is as large as a step.
    const alone = feed(one(decaying(7100, 0.05, 0.003, 30, 8, 3, 2e-4).map((s, i) => setOf(1, { ...s, aKm: s.aKm + (i * 8 * HOUR >= 20 * DAY ? -0.2 : 0) }))));
    expect(suspected(alone).length).toBeGreaterThan(0);
  });

  test("a bad set is dismissed when the next sets are back where the model said", () => {
    const series = decaying(7200, 0.02, 0.004, 30);
    series[60]!.aKm += 0.5;
    const fed = feed(one(series.map((s) => setOf(1, s))));
    expect(suspected(fed)).toEqual([]);
    const closed = fed.log.find((r) => r.signals.phase === 2 && r.signals.outcome === OUTCOMES.reverted);
    expect(closed).toBeDefined();
    expect(closed!.signals.afterEpoch).toBe(series[60]!.epochMs);
    expect(Math.abs(closed!.signals.rhoMedian!)).toBeLessThan(params.rhoRevert);
    // The bad set left the ring, so the object's scatter is still a few metres.
    expect(closed!.signals.sigmaOwn).toBeLessThan(0.02);
  });

  test("a real step with a settling slope after it is suspected on the bracket around the step, within three days", () => {
    const series = decaying(7200, 0.02, 0.004, 30);
    const stepAt = 60;
    for (let i = stepAt; i < series.length; i++) series[i]!.aKm += -0.3 - 0.02 * ((series[i]!.epochMs - series[stepAt]!.epochMs) / DAY);
    const fed = feed(one(series.map((s) => setOf(1, s))));
    const raised = suspected(fed);
    expect(raised).toHaveLength(1);
    const verdict = raised[0]!;
    expect(verdict.step!.beforeEpoch).toBe(series[stepAt - 1]!.epochMs);
    expect(verdict.step!.afterEpoch).toBe(series[stepAt]!.epochMs);
    expect(verdict.step!.deltaKm).toBeCloseTo(-0.3, 1);
    expect(verdict.step!.postSets).toBeGreaterThanOrEqual(2);
    expect(verdict.raisedAt - series[stepAt]!.epochMs).toBeLessThan(3 * DAY);
    expect(verdict.evidence.rhoMedian).toBeGreaterThan(params.rhoMin);
    expect(verdict.evidence.stepEvidence).toBeGreaterThan(params.evidenceMin);
    expect(verdict.reasons.join(" ")).toContain("holds over");
    // A watch verdict showed it first, on the first post set.
    const watch = fed.verdicts.find((v) => v.state === "watch");
    expect(watch?.step?.afterEpoch).toBe(series[stepAt]!.epochMs);
    expect(watch!.raisedAt).toBeLessThan(verdict.raisedAt);
    // No second verdict on the same step, and the object's window restarted on the post sets.
    expect(fed.verdicts.filter((v) => v.state === "dismissed")).toEqual([]);
  });

  test("a drift that grows from nothing at a rate drag can produce opens no candidate: the drag term covers it", () => {
    // A high-drag object whose decay doubles from one day: twice its drag term's worth, which the prediction's drag term allows for.
    const series = decaying(7200, 0.1, 0.004, 30, 8, 1, 1e-3);
    const from = 60;
    for (let i = from; i < series.length; i++) series[i]!.aKm += -0.2 * ((series[i]!.epochMs - series[from - 1]!.epochMs) / DAY);
    const fed = feed(one(series.map((s) => setOf(1, s))));
    expect(suspected(fed)).toEqual([]);
    expect(fed.log.filter((r) => r.number === 1)).toEqual([]);
  });

  test("a day-old stage with no record of its own is caught by the prior, still rising after its step", () => {
    const gauss = noise(7);
    const series: SyntheticSet[] = [];
    // Four sets in its first day, then the step of +1.3 km rising a further 0.3 km a day, as a settling fit does.
    for (let i = 0; i < 4; i++) series.push({ epochMs: T0 + i * 6 * HOUR, aKm: 7190 + 0.01 * gauss(), bstar: 0 });
    for (let i = 4; i < 16; i++) series.push({ epochMs: T0 + i * 6 * HOUR, aKm: 7191.3 + 0.3 * ((i - 4) / 4) + 0.01 * gauss(), bstar: 0 });
    const fed = feed(one(series.map((s) => setOf(1, s, "rocket body"))));
    const raised = suspected(fed);
    expect(raised).toHaveLength(1);
    expect(raised[0]!.step!.beforeEpoch).toBe(series[3]!.epochMs);
    expect(raised[0]!.step!.afterEpoch).toBe(series[4]!.epochMs);
    expect(raised[0]!.evidence.sigmaOwn).toBeGreaterThanOrEqual(params.sigmaPrior.LEO);
  });

  test("a geosynchronous object with a set every two days is caught across its sparse sets, with its longer lapse", () => {
    const gauss = noise(11);
    const series: SyntheticSet[] = [];
    for (let i = 0; i < 30; i++) series.push({ epochMs: T0 + i * 2 * DAY, aKm: 42164.2 + 0.05 * gauss() + (i >= 20 ? -8 : 0), eccentricity: 0.0002, inclinationDeg: 0.05, raanDeg: (i * 137) % 360, bstar: 0 });
    const fed = feed(one(series.map((s) => setOf(1, s))));
    const raised = suspected(fed);
    expect(raised).toHaveLength(1);
    expect(raised[0]!.step!.beforeEpoch).toBe(series[19]!.epochMs);
    expect(raised[0]!.step!.afterEpoch).toBe(series[20]!.epochMs);
    expect(raised[0]!.evidence.regime).toBe(2);
  });

  test("a candidate whose object falls silent lapses and is shown dismissed, and the step is measured again when a set returns", () => {
    const series = decaying(7200, 0.02, 0.004, 20);
    const stepAt = 45;
    series.splice(stepAt + 1);
    series[stepAt]!.aKm += -0.3;
    const fed = feed(one(series.map((s) => setOf(1, s))), { until: series[stepAt]!.epochMs + 8 * DAY });
    expect(suspected(fed)).toEqual([]);
    expect(fed.verdicts.map((v) => v.state)).toEqual(["watch", "dismissed"]);
    expect(fed.log.at(-1)!.signals.outcome).toBe(OUTCOMES.lapsed);
  });

  test("a quiet old rocket body with one large step is suspected as a unique step, with the impulse it implies", () => {
    const series = decaying(7200, 0.02, 0.004, 40);
    const stepAt = 90;
    for (let i = stepAt; i < series.length; i++) series[i]!.aKm += -0.4;
    const fed = feed(one(series.map((s) => setOf(1, s, "rocket body"))));
    const raised = suspected(fed);
    expect(raised).toHaveLength(1);
    expect(raised[0]!.evidence.manoeuvreClass).toBe(MANOEUVRE_CLASSES.indexOf("unique"));
    expect(raised[0]!.evidence.n730).toBe(0);
    expect(raised[0]!.evidence.deltaVMps).toBeCloseTo(0.207, 1);
    expect(raised[0]!.reasons.join(" ")).toContain("classed unique");
    expect(fed.verdicts.filter((v) => v.state === "manoeuvre")).toEqual([]);
    // The step joined the object's record.
    expect((fed.states.get(1) as { steps: unknown[] }).steps).toHaveLength(1);
  });

  test("a geostationary station-keeper with fortnightly alternating east-west steps and a yearly north-south step: its steps are manoeuvres once its record holds a few", () => {
    const gauss = noise(21);
    const series: SyntheticSet[] = [];
    let level = 42164.2;
    let inclination = 0.05;
    for (let i = 0; i < 400; i++) {
      const day = i * 2;
      // Sixty quiet days so the object's scatter is measured; then every fourteen days the longitude drift is reversed with a step of two kilometres, alternating in sign; on day 300 the inclination is pulled back by a twentieth of a degree, which moves the axis by nothing.
      if (day >= 70 && (day - 70) % 14 === 0) level += ((day - 70) / 14) % 2 === 0 ? 2 : -2;
      if (day === 300) inclination += 0.05;
      series.push({ epochMs: T0 + day * DAY, aKm: level + 0.02 * gauss(), eccentricity: 0.0002, inclinationDeg: inclination, raanDeg: (i * 137) % 360, bstar: 0 });
    }
    const fed = feed(one(series.map((s) => setOf(1, s))));
    const persistent = fed.verdicts.filter((v) => v.state === "suspected" || v.state === "manoeuvre");
    expect(persistent.length).toBeGreaterThan(40);
    // The first step, on a young payload with no record, starts a campaign; the second is occasional; from the third on the record of both signs explains every one, and none is suspected.
    expect(suspected(fed)).toEqual([]);
    expect(persistent[0]!.evidence.manoeuvreClass).toBe(MANOEUVRE_CLASSES.indexOf("campaign"));
    const settled = persistent.filter((v) => v.step!.afterEpoch >= T0 + 140 * DAY);
    expect(settled.length).toBeGreaterThan(35);
    expect(settled.every((v) => v.state === "manoeuvre")).toBe(true);
    const late = settled.at(-1)!;
    expect(late.evidence.manoeuvreClass).toBe(MANOEUVRE_CLASSES.indexOf("station-keeping"));
    expect(late.evidence.n365).toBeGreaterThanOrEqual(24);
    expect(late.evidence.sameSignShare).toBeCloseTo(0.5, 1);
    expect(late.reasons.join(" ")).toContain("not a breakup");
  });

  test("a low-orbit raising campaign on a young payload: the first raise starts a campaign, the next ones continue it, none is suspected", () => {
    const gauss = noise(31);
    const series: SyntheticSet[] = [];
    let level = 6900;
    for (let i = 0; i < 240; i++) {
      const t = i * 6 * HOUR;
      if (i > 0 && i % 20 === 0) level += 5;
      series.push({ epochMs: T0 + t, aKm: level + 0.005 * gauss(), bstar: 1e-4 });
    }
    const fed = feed(one(series.map((s) => setOf(1, s, "payload"))));
    const manoeuvres = fed.verdicts.filter((v) => v.state === "manoeuvre");
    expect(suspected(fed)).toEqual([]);
    expect(manoeuvres.length).toBeGreaterThanOrEqual(10);
    expect(manoeuvres[0]!.evidence.n730).toBe(0);
    expect(manoeuvres[0]!.evidence.ageDays).toBeLessThan(params.newObjectDays);
    expect(manoeuvres[0]!.evidence.manoeuvreClass).toBe(MANOEUVRE_CLASSES.indexOf("campaign"));
    expect(manoeuvres.at(-1)!.evidence.sameSignShare).toBe(1);
    // The same raises on a young rocket body are unique steps: a stage does not climb.
    const stage = feed(one(series.map((s) => setOf(2, s, "rocket body"))));
    expect(suspected(stage).length).toBeGreaterThan(0);
    expect(suspected(stage)[0]!.evidence.manoeuvreClass).toBe(MANOEUVRE_CLASSES.indexOf("unique"));
  });

  test("a disposal lowering, the perigee dropped thirty kilometres with the apogee kept, is a manoeuvre whatever the record", () => {
    const gauss = noise(41);
    const series: SyntheticSet[] = [];
    for (let i = 0; i < 400; i++) {
      const t = i * 8 * HOUR;
      const dropped = i >= 360;
      // After the burn at apogee the perigee is thirty kilometres lower: the axis fifteen lower and the eccentricity up by the same fifteen over the axis.
      series.push({ epochMs: T0 + t, aKm: (dropped ? 7185 : 7200) + 0.004 * gauss(), eccentricity: dropped ? 0.001 + 15 / 7185 : 0.001, bstar: 1e-4 });
    }
    const fed = feed(one(series.map((s) => setOf(1, s, "payload"))));
    expect(suspected(fed)).toEqual([]);
    const manoeuvre = fed.verdicts.find((v) => v.state === "manoeuvre");
    expect(manoeuvre).toBeDefined();
    expect(manoeuvre!.evidence.manoeuvreClass).toBe(MANOEUVRE_CLASSES.indexOf("disposal"));
    expect(manoeuvre!.evidence.disposalLike).toBeUndefined();
    expect(manoeuvre!.step!.deltaPerigeeKm).toBeLessThan(-25);
    expect(manoeuvre!.evidence.ageDays).toBeGreaterThan(params.newObjectDays);
  });

  test("a working payload with a step far larger than its own, and a drag term that jumped, is suspected as atypical", () => {
    const gauss = noise(51);
    const series: SyntheticSet[] = [];
    let level = 7000;
    for (let i = 0; i < 1000; i++) {
      const t = i * 8 * HOUR;
      // A drag make-up raise of 400 m every thirty days, then on day 310 a jump of thirteen kilometres with the drag term tenfold.
      if (i > 0 && i % 90 === 0 && i < 930) level += 0.4;
      const huge = i >= 930;
      if (i === 930) level += 13;
      series.push({ epochMs: T0 + t, aKm: level + 0.004 * gauss(), bstar: huge ? 1e-3 : 1e-4 });
    }
    const fed = feed(one(series.map((s) => setOf(1, s, "payload"))));
    const raised = suspected(fed);
    expect(raised).toHaveLength(1);
    expect(raised[0]!.step!.deltaKm).toBeCloseTo(13, 0);
    expect(raised[0]!.evidence.n730).toBeGreaterThanOrEqual(8);
    expect(raised[0]!.evidence.typicality).toBeGreaterThan(params.typicalityMax);
    expect(raised[0]!.evidence.bstarRatio).toBeCloseTo(10, 0);
    expect(raised[0]!.evidence.atypical).toBeGreaterThanOrEqual(1);
    expect(raised[0]!.reasons.join(" ")).toContain("times the median of the object's past steps");
    // Its own raises before it were manoeuvres, bar the first few on an empty record.
    expect(fed.verdicts.filter((v) => v.state === "manoeuvre").length).toBeGreaterThanOrEqual(7);
  });

  test("a storm hold asks for three post sets, and says so", () => {
    // Sets twenty hours apart: two of them span the eighteen hours the quiet gate asks for.
    const series = decaying(7200, 0.02, 0.004, 40, 20);
    const stepAt = 30;
    for (let i = stepAt; i < series.length; i++) series[i]!.aKm += -0.3;
    const day = (kp: number) => ({ day: "2020-04-21", kp: [kp, kp, kp, kp, kp, kp, kp, kp], ap: [], Ap: 50, f107: 120, f107Adjusted: 120, dst: null });
    const quiet = feed(one(series.map((s) => setOf(1, s))), { space: [day(2)] });
    const stormy = feed(one(series.map((s) => setOf(1, s))), { space: [day(7)] });
    expect(suspected(quiet)[0]!.step!.postSets).toBe(2);
    expect(suspected(stormy)[0]!.step!.postSets).toBe(3);
    expect(suspected(stormy)[0]!.reasons.join(" ")).toContain("storm hold");
    expect(suspected(stormy)[0]!.evidence.kpMax).toBe(7);
  });
});

/**
 * The fusion with the fragments: a suspected step is confirmed by new
 * debris bodies under the parent's launch in its plane, first published
 * after the step; expires when nothing comes in thirty days; is dismissed
 * when bodies came and every one was old by numbering or out of the plane;
 * is confirmed by a notice; and a quiet parent whose launch bursts with
 * pieces in its plane is listed as a cloud for review, never a detection.
 * The suspected verdict carries the event's time from the two sets either
 * side of the step, bounded by the bracket.
 */
describe("the fusion with the fragments", () => {
  /** The real-step series: a decaying object, number 1 of launch 2010-001, stepping down 0.3 km at set 105 (day thirty-five, so the launch is older than a month at the step). */
  function stepped(): { series: SyntheticSet[]; stepAt: number } {
    const series = decaying(7200, 0.02, 0.004, 48);
    const stepAt = 105;
    for (let i = stepAt; i < series.length; i++) series[i]!.aKm += -0.3;
    return { series, stepAt };
  }

  /** Six debris bodies under launch 2010-001, numbered from `from`, at the epoch and node given, spread a few kilometres about 7,200 km. */
  function pieces(from: number, epochMs: number, raanDeg: number): ElementSet[] {
    return Array.from({ length: 6 }, (_, i) => ({ ...setOf(from + i, { epochMs, aKm: 7200 + (i - 2.5) * 3, raanDeg }, "debris"), designator: `2010-001${"CDEFGH"[i]}` }));
  }

  test("a suspected step is confirmed by pieces in the parent's plane first published after it, and the verdict carries the event's time", () => {
    const { series, stepAt } = stepped();
    const parent = series.map((s) => setOf(1, s, "rocket body"));
    const stepEpoch = series[stepAt]!.epochMs;
    // The pieces' first sets are dated an hour after the parent's first post set and published five days later.
    const batches = [...one(parent.filter((s) => s.epochMs < stepEpoch + 5 * DAY)), pieces(50001, stepEpoch + HOUR, 100), ...one(parent.filter((s) => s.epochMs >= stepEpoch + 5 * DAY))];
    const fed = feed(batches);
    const raised = suspected(fed);
    expect(raised).toHaveLength(1);
    const confirmed = fed.verdicts.filter((v) => v.state === "confirmed");
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.number).toBe(1);
    expect(confirmed[0]!.launch).toBe("2010-001");
    expect(confirmed[0]!.bodies).toEqual([50001, 50002, 50003, 50004, 50005, 50006]);
    expect(confirmed[0]!.step).toEqual(raised[0]!.step);
    expect(confirmed[0]!.evidence.piecesInPlane).toBe(6);
    expect(confirmed[0]!.evidence.daysToConfirmation).toBeGreaterThan(4);
    expect(confirmed[0]!.evidence.daysToConfirmation).toBeLessThan(6);
    expect(confirmed[0]!.reasons.join(" ")).toContain("in the parent's plane");
    expect(confirmed[0]!.raisedAt).toBeGreaterThan(raised[0]!.raisedAt);
    expect(fed.verdicts.filter((v) => v.state === "expired" || v.state === "dismissed" || v.kind === "cloud")).toEqual([]);
    // The event's time lies within the bracket, widened by the lead the search allows before the pre set.
    const event = raised[0]!.event!;
    expect(event.at).toBeGreaterThanOrEqual(series[stepAt - 1]!.epochMs - params.eventLeadHours * HOUR);
    expect(event.at).toBeLessThanOrEqual(stepEpoch);
    expect(event.from).toBeLessThanOrEqual(event.at);
    expect(event.to).toBeGreaterThanOrEqual(event.at);
    expect(raised[0]!.reasons.join(" ")).toMatch(/along-track separation crosses zero|closest approach/);
    // The alert's row was logged with its tiers and the cadence after the step.
    const row = fed.log.find((r) => r.signals.phase === 3 && r.number === 1);
    expect(row).toBeDefined();
    expect(row!.signals.outcome).toBe(OUTCOMES.confirmed);
    expect(row!.signals.tier3Held).toBe(1);
    expect(row!.signals.tierD1Held).toBe(1);
    expect(row!.signals.cadenceBefore).toBeCloseTo(3, 0);
    expect(row!.signals.cadenceAfter).toBeCloseTo(3, 0);
    expect(row!.signals.piecesInPlane).toBe(6);
  });

  test("a suspected step with nothing under the launch expires after the time to live, and says so", () => {
    const { series, stepAt } = stepped();
    const fed = feed(one(series.map((s) => setOf(1, s, "rocket body"))), { until: series[stepAt]!.epochMs + 33 * DAY });
    expect(suspected(fed)).toHaveLength(1);
    const expired = fed.verdicts.filter((v) => v.state === "expired");
    expect(expired).toHaveLength(1);
    expect(expired[0]!.number).toBe(1);
    expect(expired[0]!.evidence.piecesNew).toBe(0);
    expect(expired[0]!.raisedAt - suspected(fed)[0]!.raisedAt).toBeGreaterThanOrEqual(params.alertTtlDays * DAY);
    expect(expired[0]!.reasons[0]).toContain("no new body under the launch");
    const row = fed.log.find((r) => r.signals.phase === 3 && r.number === 1);
    expect(row!.signals.outcome).toBe(OUTCOMES.expired);
    expect(row!.signals.tierD7Held).toBe(1);
  });

  test("bodies numbered under the catalogue's mark and out of the parent's plane dismiss the alert when the time runs out", () => {
    const { series, stepAt } = stepped();
    const parent = series.map((s) => setOf(1, s, "rocket body"));
    const stepEpoch = series[stepAt]!.epochMs;
    // Another launch's body numbered 60000 was catalogued before the step, so the mark is far above the late batch's numbers; the batch is also thirty degrees off in node.
    const marker: ElementSet = { ...setOf(60000, { epochMs: series[0]!.epochMs, aKm: 7500, raanDeg: 200 }, "payload"), designator: "2010-009A" };
    const batches = [[marker], ...one(parent.filter((s) => s.epochMs < stepEpoch + 5 * DAY)), pieces(50001, stepEpoch + HOUR, 130), ...one(parent.filter((s) => s.epochMs >= stepEpoch + 5 * DAY))];
    const fed = feed(batches, { until: stepEpoch + 33 * DAY });
    expect(suspected(fed)).toHaveLength(1);
    expect(fed.verdicts.filter((v) => v.state === "confirmed")).toEqual([]);
    const dismissed = fed.verdicts.filter((v) => v.state === "dismissed" && v.number === 1 && v.step !== null && v.step.afterEpoch === stepEpoch);
    expect(dismissed).toHaveLength(1);
    expect(dismissed[0]!.evidence.piecesNew).toBe(6);
    expect(dismissed[0]!.evidence.piecesInPlane).toBe(0);
    expect(dismissed[0]!.reasons[0]).toContain("every one was old");
    const cloud = fed.log.find((r) => r.signals.phase === 4 && r.signals.launch === 2010001 && r.signals.newBodies === 6);
    expect(cloud).toBeDefined();
    expect(cloud!.signals.aboveMark).toBe(0);
    expect(cloud!.signals.openAlert).toBe(1);
  });

  test("a notice naming the object confirms the alert", () => {
    const { series, stepAt } = stepped();
    const stepEpoch = series[stepAt]!.epochMs;
    const notice = { number: 1, launch: "2010-001", at: stepEpoch + 3 * DAY, text: "a notice confirms the fragmentation of object 1" };
    const fed = feed(one(series.map((s) => setOf(1, s, "rocket body"))), { notices: [notice] });
    const confirmed = fed.verdicts.filter((v) => v.state === "confirmed");
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.reasons[0]).toContain("a public notice names the object");
    expect(confirmed[0]!.evidence.noticed).toBe(1);
    expect(confirmed[0]!.raisedAt).toBeGreaterThanOrEqual(notice.at);
    expect(confirmed[0]!.bodies).toEqual([]);
  });

  test("a burst of pieces in the plane of a parent that did not move is listed as a cloud for review, never a detection", () => {
    const quiet = decaying(7200, 0.02, 0.004, 48).map((s) => setOf(2, s, "payload"));
    const at = quiet[110]!.epochMs;
    const cloudPieces = Array.from({ length: 6 }, (_, i) => ({ ...setOf(50011 + i, { epochMs: at + HOUR, aKm: 7200 + (i - 2.5) * 3, raanDeg: 100 }, "debris"), designator: `2010-002${"CDEFGH"[i]}` }));
    const fed = feed([...one(quiet.slice(0, 115)), cloudPieces, ...one(quiet.slice(115))]);
    expect(suspected(fed)).toEqual([]);
    const clouds = fed.verdicts.filter((v) => v.kind === "cloud");
    expect(clouds).toHaveLength(1);
    expect(clouds[0]!.state).toBe("cloud-only");
    expect(clouds[0]!.number).toBe(2);
    expect(clouds[0]!.launch).toBe("2010-002");
    expect(clouds[0]!.bodies).toHaveLength(6);
    expect(clouds[0]!.evidence.piecesInPlane).toBe(6);
    expect(clouds[0]!.evidence.pBurst).toBeLessThan(params.pBurst);
    expect(clouds[0]!.reasons[0]).toContain("listed for review, not a detection");
    // Listed once: the same cloud's later pieces do not list it again within the repeat window.
    const more = Array.from({ length: 3 }, (_, i) => ({ ...setOf(50021 + i, { epochMs: at + 2 * DAY, aKm: 7201, raanDeg: 102 }, "debris"), designator: "2010-002J" }));
    const again = feed([...one(quiet.slice(0, 115)), cloudPieces, ...one(quiet.slice(115, 125)), more, ...one(quiet.slice(125))]);
    expect(again.verdicts.filter((v) => v.kind === "cloud")).toHaveLength(1);
  });

  test("pieces under a launch younger than a month, or one with a cloud still being catalogued, confirm nothing", () => {
    const { series, stepAt } = stepped();
    const stepEpoch = series[stepAt]!.epochMs;
    // The launch's first body was seen a week before the step: its pieces are its own objects.
    const young = feed([...one(series.slice(stepAt - 20).map((s) => setOf(1, s, "rocket body")).filter((s) => s.epochMs < stepEpoch + 5 * DAY)), pieces(50001, stepEpoch + HOUR, 100), ...one(series.slice(stepAt - 20).map((s) => setOf(1, s, "rocket body")).filter((s) => s.epochMs >= stepEpoch + 5 * DAY))], { until: stepEpoch + 33 * DAY });
    expect(young.verdicts.filter((v) => v.state === "confirmed")).toEqual([]);
    // A launch that gained a hundred bodies in the year before the step is an old cloud under cataloguing: its next pieces confirm nothing.
    const parent = series.map((s) => setOf(1, s, "rocket body"));
    const backlog = Array.from({ length: 100 }, (_, i) => ({ ...setOf(40001 + i, { epochMs: series[0]!.epochMs - 300 * DAY + i * 2 * DAY, aKm: 7190, raanDeg: 150 }, "debris"), designator: "2010-001Z" }));
    const old = feed([...one(backlog), ...one(parent.filter((s) => s.epochMs < stepEpoch + 5 * DAY)), pieces(50001, stepEpoch + HOUR, 100), ...one(parent.filter((s) => s.epochMs >= stepEpoch + 5 * DAY))], { until: stepEpoch + 33 * DAY });
    expect(suspected(old)).toHaveLength(1);
    expect(old.verdicts.filter((v) => v.state === "confirmed")).toEqual([]);
    const row = old.log.find((r) => r.signals.phase === 4 && r.signals.launch === 2010001 && r.signals.newBodies === 6)!;
    expect(row.signals.lambdaRate).toBeGreaterThan(params.confirmBackgroundMax);
  });

  test("a step raised more than the time to live after it (a batch of decades-old sets) opens no alert", () => {
    // A set of another object fixes the run's instant in 2020; then the stepped series is published at once with its epochs moved back thirty-three years, as a bundle's batch of old sets is.
    const { series, stepAt } = stepped();
    const stale = series.map((s) => setOf(1, { ...s, epochMs: s.epochMs - 33 * 365 * DAY }, "rocket body")).slice(0, stepAt + 10);
    const fed = feed([[setOf(9, { epochMs: T0, aKm: 7300 })], stale], { until: T0 + 40 * DAY });
    expect(fed.verdicts.filter((v) => v.state === "expired" || v.state === "confirmed")).toEqual([]);
    for (const v of suspected(fed)) expect(v.reasons.join(" ")).toContain("no alert is kept");
    expect(fed.log.filter((r) => r.signals.phase === 3)).toEqual([]);
  });

  test("in the detector's first fortnight every body is new to it, so no cloud is listed then", () => {
    // The same cloud as above, but the pieces come on the detector's third day: nothing is listed; the next batch after the fortnight is.
    const quiet = decaying(7200, 0.02, 0.004, 48).map((s) => setOf(2, s, "payload"));
    const early = Array.from({ length: 6 }, (_, i) => ({ ...setOf(50041 + i, { epochMs: quiet[9]!.epochMs + HOUR, aKm: 7200 + (i - 2.5) * 3, raanDeg: 100 }, "debris"), designator: `2010-002${"CDEFGH"[i]}` }));
    const fed = feed([...one(quiet.slice(0, 10)), early, ...one(quiet.slice(10))]);
    expect(fed.verdicts.filter((v) => v.kind === "cloud")).toEqual([]);
    expect(fed.log.filter((r) => r.signals.phase === 4)).toEqual([]);
  });

  test("a persistent step the record explains, a manoeuvre, is promoted to confirmed when pieces come, and says so", () => {
    // A young payload's raise of five kilometres starts a campaign, a manoeuvre; six debris bodies in its plane then say otherwise.
    const gauss = noise(61);
    const series: SyntheticSet[] = [];
    for (let i = 0; i < 200; i++) series.push({ epochMs: T0 + i * 6 * HOUR, aKm: (i >= 160 ? 6905 : 6900) + 0.005 * gauss(), bstar: 1e-4 });
    const parent = series.map((s) => setOf(3, s, "payload"));
    const stepEpoch = series[160]!.epochMs;
    const cloudPieces = Array.from({ length: 6 }, (_, i) => ({ ...setOf(50031 + i, { epochMs: stepEpoch + HOUR, aKm: 6905 + (i - 2.5) * 3, raanDeg: 100 }, "debris"), designator: `2010-003${"CDEFGH"[i]}` }));
    const fed = feed([...one(parent.slice(0, 170)), cloudPieces, ...one(parent.slice(170))]);
    expect(suspected(fed)).toEqual([]);
    expect(fed.verdicts.filter((v) => v.state === "manoeuvre")).toHaveLength(1);
    const confirmed = fed.verdicts.filter((v) => v.state === "confirmed");
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.number).toBe(3);
    expect(confirmed[0]!.reasons.join(" ")).toContain("read as a manoeuvre");
  });
});

describe("the confirmation rules", () => {
  /** The node's J2 rate at the test orbit, so a parent's sets and its pieces' first sets precess as real ones do and the plane test's carried node meets them. */
  const RATE = nodePrecessionDegPerDay(7200, 0.001, 98, meanMotionOf(7200));
  const nodeAt = (epochMs: number): number => 100 + RATE * ((epochMs - T0) / DAY);
  const withNode = (set: ElementSet): ElementSet => ({ ...set, raanDeg: nodeAt(set.epochMs) });

  /** A quiet decaying parent, number 1 of launch 2010-001, over `days`, stepping down 0.3 km at `stepAt` sets in, its node precessing. */
  function parentSeries(days: number, stepAt: number, bodyClass: ElementSet["bodyClass"] = "rocket body"): ElementSet[] {
    const series = decaying(7200, 0.02, 0.004, days);
    for (let i = stepAt; i < series.length; i++) series[i]!.aKm += -0.3;
    return series.map((s) => withNode(setOf(1, s, bodyClass)));
  }

  /** Debris bodies under launch 2010-001 numbered from `from`, at the epoch, `nodeOffsetDeg` from the precessing plane, spread a few kilometres about the axis given. */
  function debris(from: number, count: number, epochMs: number, nodeOffsetDeg: number, options: { aKm?: number; spreadKm?: number } = {}): ElementSet[] {
    const spread = options.spreadKm ?? 3;
    return Array.from({ length: count }, (_, i) => ({ ...setOf(from + i, { epochMs, aKm: (options.aKm ?? 7200) + (i - (count - 1) / 2) * spread, raanDeg: nodeAt(epochMs) + nodeOffsetDeg }, "debris"), designator: `2010-001${"CDEFGHJKLMNP"[i % 12]}` }));
  }

  /** The parent's sets in runs of one, with a batch of pieces slotted in after the last set before `pieceEpoch`. */
  function runsWith(parent: ElementSet[], pieces: ElementSet[][], others: ElementSet[] = []): ElementSet[][] {
    const runs = one([...parent, ...others].sort((a, b) => a.epochMs - b.epochMs));
    for (const batch of pieces) {
      const epoch = batch[0]!.epochMs;
      const at = runs.findIndex((r) => r[0]!.epochMs > epoch);
      runs.splice(at === -1 ? runs.length : at, 0, batch);
    }
    return runs;
  }

  const confirmedOn = (fed: ReturnType<typeof feed>, number: number) => fed.verdicts.filter((v) => v.state === "confirmed" && v.number === number);
  const alertRow = (fed: ReturnType<typeof feed>, number: number) => fed.log.find((r) => r.signals.phase === 3 && r.number === number);

  test("a fresh cloud on a quiet launch confirms, and the verdict carries the rules' reading", () => {
    const parent = parentSeries(48, 105);
    const stepEpoch = parent[105]!.epochMs;
    const fed = feed(runsWith(parent, [debris(50001, 6, stepEpoch + 5 * DAY, 0)]));
    const confirmed = confirmedOn(fed, 1);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.bodies).toHaveLength(6);
    expect(confirmed[0]!.evidence.piecesJudged).toBe(6);
    expect(confirmed[0]!.evidence.cloudPieces).toBe(0);
    // The parent itself, first seen thirty-five days before, is the launch's one new body in the year before.
    expect(confirmed[0]!.evidence.backgroundBodies).toBe(1);
    expect(confirmed[0]!.evidence.cloudDeltaVMps).toBeGreaterThan(params.confirmDeltaVMinMps);
    const row = alertRow(fed, 1)!;
    expect(row.signals.confirmPieces).toBe(6);
    expect(row.signals.confirmRefused).toBe(0);
    expect(row.signals.parentFragment).toBe(0);
  });

  test("a launch that had a burst within the year confirms nothing on a parent lying in that cloud's plane, and confirms a parent on another plane by pieces out of it", () => {
    // Parent 1 steps on day sixty; on day thirty-two six pieces came under the launch on its plane, a cloud listed for review and remembered.
    const parent = parentSeries(80, 180);
    const stepEpoch = parent[180]!.epochMs;
    const cloudEpoch = parent[96]!.epochMs + HOUR;
    const same = feed(runsWith(parent, [debris(50001, 6, cloudEpoch, 0), debris(50011, 6, stepEpoch + 5 * DAY, 0)]), { until: stepEpoch + 33 * DAY });
    expect(same.verdicts.filter((v) => v.kind === "cloud")).toHaveLength(1);
    expect(suspected(same)).toHaveLength(1);
    expect(confirmedOn(same, 1)).toEqual([]);
    const row = alertRow(same, 1)!;
    expect(row.signals.confirmPieces).toBe(6);
    expect(row.signals.confirmRefused).toBe(1);
    expect(row.signals.cloudPieces).toBe(6);
    expect(row.signals.daysSinceCloud).toBeGreaterThan(25);
    expect(row.signals.daysSinceCloud).toBeLessThan(params.cloudMemoryDays);
    expect(row.signals.parentCloudDistance).toBeLessThan(params.planeDistanceMax);
    expect(same.verdicts.filter((v) => v.state === "expired" && v.number === 1)).toHaveLength(1);
    // The same launch with a second body sixty degrees of node away whose plane the earlier cloud shares: parent 1's new pieces lie out of that cloud's plane and confirm it.
    const other = decaying(7200, 0.02, 0.004, 80, 8, 5).map((s) => ({ ...withNode(setOf(2, s, "payload")), designator: "2010-001B" })).map((s) => ({ ...s, raanDeg: s.raanDeg + 60 }));
    const apart = feed(runsWith(parent, [debris(50001, 6, cloudEpoch, 60), debris(50011, 6, stepEpoch + 5 * DAY, 0)], other), { until: stepEpoch + 33 * DAY });
    expect(apart.verdicts.filter((v) => v.kind === "cloud").map((v) => v.number)).toEqual([2]);
    const confirmed = confirmedOn(apart, 1);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.bodies).toHaveLength(6);
    expect(confirmed[0]!.evidence.cloudPieces).toBe(6);
    expect(confirmed[0]!.evidence.parentCloudDistance).toBeGreaterThan(params.planeDistanceMax);
    expect(confirmed[0]!.reasons.join(" ")).toContain("on another plane");
  });

  test("a debris-classed parent that is itself a fresh piece of the launch's cloud is confirmed by nothing, and an old one under an active cloud only by pieces nearer its plane than the cloud is", () => {
    // The launch's payload sits ninety degrees of node away, so the pieces attach to the piece's plane and not to the payload's.
    const quiet = parentSeries(80, 10_000, "payload").map((s) => ({ ...s, raanDeg: s.raanDeg + 90 }));
    /** Piece 50001's own series: `days` of eight-hourly sets from `from`, stepping down 0.3 km at `stepAt`. */
    const pieceSeries = (from: number, days: number, stepAt: number): ElementSet[] => {
      const gauss = noise(31);
      const sets: ElementSet[] = [];
      for (let i = 0; i <= days * 3; i++) sets.push({ ...withNode(setOf(50001, { epochMs: from + i * 8 * HOUR, aKm: (i >= stepAt ? 7196.7 : 7197) + 0.004 * gauss() }, "debris")), designator: "2010-001C" });
      return sets;
    };
    // Catalogued with five siblings on day thirty-two, stepping eighteen days later: the siblings' next batch does not confirm it.
    const cloudEpoch = quiet[96]!.epochMs + HOUR;
    const fresh = pieceSeries(cloudEpoch, 40, 54);
    const freshStep = fresh[54]!.epochMs;
    const first = feed(runsWith(quiet, [[fresh[0]!, ...debris(50002, 5, cloudEpoch, 0)], debris(50021, 4, freshStep + 5 * DAY, 0)], fresh.slice(1)), { parameters: { cloudMemoryDays: 0 }, until: freshStep + 33 * DAY });
    expect(suspected(first).map((v) => v.number)).toEqual([50001]);
    expect(confirmedOn(first, 50001)).toEqual([]);
    const row = alertRow(first, 50001)!;
    expect(row.signals.parentFragment).toBe(1);
    expect(row.signals.parentAgeDays).toBeLessThan(params.freshPieceDays);
    expect(row.signals.confirmRefused).toBe(1);
    // The same piece first catalogued two hundred days before its step, under a launch whose cloud trickles on a degree and a half of node from it: pieces on its own plane are nearer than the cloud and confirm it; pieces farther off than the cloud, though within the plane bound, do not.
    const old = pieceSeries(T0 + 2 * DAY, 230, 600);
    const oldStep = old[600]!.epochMs;
    const trickle = [0, 60, 120].map((day, i) => ({ ...setOf(40001 + i, { epochMs: T0 + 10 * DAY + day * DAY, aKm: 7230, raanDeg: nodeAt(T0 + 10 * DAY + day * DAY) + 1.5 }, "debris"), designator: "2010-001D" }));
    const scenario = (offsetDeg: number): ReturnType<typeof feed> => feed(runsWith(quiet, [debris(50021, 4, oldStep + 5 * DAY, offsetDeg)], [...old, ...trickle]), { parameters: { cloudMemoryDays: 0, singlePieceNeedsQuietLaunch: false }, until: oldStep + 33 * DAY });
    const nearer = scenario(0);
    expect(suspected(nearer).map((v) => v.number)).toEqual([50001]);
    expect(confirmedOn(nearer, 50001)).toHaveLength(1);
    expect(confirmedOn(nearer, 50001)[0]!.evidence.cloudPieces).toBe(3);
    const asFar = scenario(2.5);
    expect(suspected(asFar).map((v) => v.number)).toEqual([50001]);
    expect(confirmedOn(asFar, 50001)).toEqual([]);
    expect(alertRow(asFar, 50001)!.signals.piecesNearerThanCloud).toBe(0);
  });

  test("a single piece confirms a parent that is not debris under a launch that gained nothing in the year before, and nothing else", () => {
    // The parent's first set is four hundred days before the step, so the launch gained nothing in the year before.
    const parent = parentSeries(48, 105, "payload");
    const stepEpoch = parent[105]!.epochMs;
    const early: ElementSet = withNode(setOf(1, { epochMs: T0 - 400 * DAY, aKm: 7208 }, "payload"));
    const piece = (pieceClass: "payload" | "debris"): ElementSet => ({ ...setOf(50001, { epochMs: stepEpoch + 5 * DAY, aKm: 7197, raanDeg: nodeAt(stepEpoch + 5 * DAY) }, pieceClass), designator: "2010-001C" });
    const run = (others: ElementSet[]) => feed(runsWith([early, ...parent], [[piece("debris")]], others), { until: stepEpoch + 33 * DAY });
    const quiet = run([]);
    expect(suspected(quiet)).toHaveLength(1);
    expect(confirmedOn(quiet, 1)).toHaveLength(1);
    expect(confirmedOn(quiet, 1)[0]!.bodies).toEqual([50001]);
    // A debris body catalogued under the launch a hundred days before the step: the launch is not quiet.
    const busy = run([{ ...setOf(40001, { epochMs: stepEpoch - 100 * DAY, aKm: 7250, raanDeg: 140 }, "debris"), designator: "2010-001D" }]);
    expect(suspected(busy)).toHaveLength(1);
    expect(confirmedOn(busy, 1)).toEqual([]);
    expect(alertRow(busy, 1)!.signals.backgroundBodies).toBe(1);
    expect(alertRow(busy, 1)!.signals.confirmRefused).toBe(1);
  });

  test("pieces in the parent's own orbit at under a metre a second confirm nothing", () => {
    const parent = parentSeries(48, 105);
    const stepEpoch = parent[105]!.epochMs;
    const fed = feed(runsWith(parent, [debris(50001, 6, stepEpoch + 5 * DAY, 0, { aKm: 7199.7, spreadKm: 0.1 })]), { until: stepEpoch + 33 * DAY });
    expect(suspected(fed)).toHaveLength(1);
    expect(confirmedOn(fed, 1)).toEqual([]);
    const row = alertRow(fed, 1)!;
    expect(row.signals.confirmDeltaVMps).toBeLessThan(params.confirmDeltaVMinMps);
    expect(row.signals.confirmRefused).toBe(1);
  });
});

/**
 * The sixth phase's discriminators, each on the series it was built for:
 * a maintenance saw-tooth, a constellation's raising campaign and a
 * straggler's climb towards its mates, a dead satellite's lone step, a
 * kicked body whose scatter triples, and a lowering on a never-manoeuvred
 * object. Where the fitted value might read otherwise, the parameter under
 * test is given, so each case documents the mechanism rather than the fit.
 */
describe("the sixth phase's discriminators", () => {
  /** A payload decaying from `a0` at `rate` kilometres a day, raised back to `a0` every `period` days, sampled every eight hours with a few metres of noise. */
  function sawTooth(a0: number, rate: number, period: number, days: number, seed = 61): SyntheticSet[] {
    const gauss = noise(seed);
    const sets: SyntheticSet[] = [];
    for (let t = 0; t <= days * DAY; t += 8 * HOUR) {
      const sincePeak = (t / DAY) % period;
      sets.push({ epochMs: T0 + t, aKm: a0 - rate * sincePeak + 0.004 * gauss(), bstar: 1e-4 });
    }
    return sets;
  }

  test("a maintenance saw-tooth: each raise back to the held altitude is a manoeuvre, by the envelope, on a payload the catalogue says nothing of", () => {
    const parameters = { maintenanceToleranceSigmas: 3, maintenanceToleranceKm: 0.1, opsStatusEvidence: false };
    const fed = feed(one(sawTooth(7000, 0.02, 45, 200).map((s) => setOf(1, s, "payload"))), { parameters });
    const persistent = fed.verdicts.filter((v) => v.state === "suspected" || v.state === "manoeuvre");
    expect(persistent.length).toBeGreaterThanOrEqual(3);
    expect(suspected(fed)).toEqual([]);
    // The first raise, on a payload under ninety days old, starts a campaign by the record alone; every later one is a return to the held altitude.
    expect(persistent[0]!.evidence.manoeuvreClass).toBe(MANOEUVRE_CLASSES.indexOf("campaign"));
    for (const later of persistent.slice(1)) {
      expect(later.evidence.envelopeMissKm).toBeLessThan(0.05);
      expect(later.evidence.envelopeTopKm).toBeGreaterThan(0.8);
      expect(later.reasons.join(" ")).toContain("orbit maintenance");
    }
    // A lone return on an old payload with no record: unique by the record, explained by the envelope alone.
    const lone = feed(one(sawTooth(7000, 0.02, 150, 200).map((s) => setOf(4, s, "payload"))), { parameters });
    expect(suspected(lone)).toEqual([]);
    const only = lone.verdicts.find((v) => v.state === "manoeuvre")!;
    expect(only.evidence.manoeuvreClass).toBe(MANOEUVRE_CLASSES.indexOf("unique"));
    expect(only.evidence.explanations).toBe(1);
    expect(only.evidence.envelopeMonths).toBeGreaterThanOrEqual(5);
    // The same raise on a rocket body: a stage does not maintain its orbit, so the envelope explains nothing and the first raise is suspected.
    const stage = feed(one(sawTooth(7000, 0.02, 45, 100).map((s) => setOf(2, s, "rocket body"))), { parameters: { ...parameters, explanationsForNonPayloads: false } });
    expect(suspected(stage).length).toBeGreaterThanOrEqual(1);
    // A kick that lands the object a kilometre above anything it held is not a return: the lone raise of day 150, overshooting by a kilometre.
    const kicked = sawTooth(7000, 0.02, 150, 200);
    for (let i = 0; i < kicked.length; i++) if (kicked[i]!.epochMs >= T0 + 150 * DAY) kicked[i]!.aKm += 1;
    const far = feed(one(kicked.map((s) => setOf(3, s, "payload"))), { parameters });
    const raised = suspected(far);
    expect(raised).toHaveLength(1);
    expect(raised[0]!.evidence.envelopeMissKm).toBeGreaterThan(0.9);
    expect(raised[0]!.evidence.explanations).toBe(0);
  });

  test("a constellation's raising campaign: the first raises of a launch are alone, the later ones have siblings and are manoeuvres; a straggler climbing towards its mates is deploying", () => {
    const gauss = noise(71);
    const launch = "2021-010";
    const members = [11, 12, 13, 14, 15];
    const batches: ReturnType<typeof setOf>[][] = [];
    // Five payloads of one launch, older than the record's youth, each raising five kilometres on its own day from day 200 on.
    for (let t = 0; t <= 215 * DAY; t += 8 * HOUR) {
      batches.push(members.map((number, i) => {
        const raised = t >= (200 + i) * DAY;
        return setOf(number, { epochMs: T0 + t, aKm: 6900 + (raised ? 5 : 0) + 0.004 * gauss(), bstar: 1e-4 }, "payload", { designator: `${launch}${"ABCDE"[i]}` });
      }));
    }
    const parameters = { siblingsMin: 2, opsStatusEvidence: false, maintenanceToleranceKm: -1 };
    const fed = feed(batches, { parameters });
    const persistent = fed.verdicts.filter((v) => (v.state === "suspected" || v.state === "manoeuvre") && v.step!.deltaKm > 4);
    expect(persistent).toHaveLength(5);
    const raised = suspected(fed);
    // The first two climb alone and are suspected; from the third on two siblings explain the climb.
    expect(raised.map((v) => v.number)).toEqual([11, 12]);
    const third = persistent.find((v) => v.number === 13)!;
    expect(third.state).toBe("manoeuvre");
    expect(third.evidence.siblingsLaunch).toBe(2);
    expect(third.reasons.join(" ")).toContain("a coordinated manoeuvre");
    expect(persistent.find((v) => v.number === 15)!.evidence.siblingsLaunch).toBe(4);
    // With three siblings required the third climbs alone too.
    expect(suspected(feed(batches, { parameters: { ...parameters, siblingsMin: 3 } })).map((v) => v.number)).toEqual([11, 12, 13]);
    // A straggler: a payload of a launch whose four mates fly at 7100, thirty days old, climbing five kilometres towards them; in the record alone a young payload's first raise is a campaign, so the record is told to say nothing of youth here.
    const straggler: ReturnType<typeof setOf>[][] = [];
    for (let t = 0; t <= 40 * DAY; t += 8 * HOUR) {
      const mates = [22, 23, 24, 25].map((number, i) => setOf(number, { epochMs: T0 + t, aKm: 7100 + 0.004 * gauss(), bstar: 1e-4 }, "payload", { designator: `2021-011${"BCDE"[i]}` }));
      straggler.push([...mates, setOf(21, { epochMs: T0 + t, aKm: 7080 + (t >= 30 * DAY ? 5 : 0) + 0.004 * gauss(), bstar: 1e-4 }, "payload", { designator: "2021-011A" })]);
    }
    const climbing = { ...parameters, deployAgeDays: 180, newObjectDays: 0 };
    const deploying = feed(straggler, { parameters: climbing });
    expect(suspected(deploying)).toEqual([]);
    const climb = deploying.verdicts.find((v) => v.state === "manoeuvre" && v.number === 21)!;
    expect(climb.evidence.mates).toBe(4);
    expect(climb.evidence.matesMedianAKm).toBeCloseTo(7100, 0);
    expect(climb.evidence.towardsMates).toBe(1);
    expect(climb.reasons.join(" ")).toContain("deploying");
    // The same climb away from the mates, or on an object past the age, is suspected.
    const away = feed(straggler.map((batch) => batch.map((s) => (s.number === 21 ? { ...s, meanMotion: meanMotionOf(7120 + (s.epochMs >= T0 + 30 * DAY ? 5 : 0) + 0.004 * gauss()) } : s))), { parameters: climbing });
    expect(suspected(away).map((v) => v.number)).toEqual([21]);
    expect(suspected(feed(straggler, { parameters: { ...climbing, deployAgeDays: 10 } })).map((v) => v.number)).toEqual([21]);
  });

  test("a dead satellite's lone step: the same return to a held altitude is suspected on a payload nonoperational today, a manoeuvre on one working today, and read neither way with the status off", () => {
    // One raise on day 150, on an object with no record, back to the altitude it held in the spring.
    const series = sawTooth(7000, 0.02, 150, 200);
    const parameters = { maintenanceToleranceSigmas: 3, maintenanceToleranceKm: 0.1, opsStatusEvidence: true, nonoperationalOverrides: true };
    const dead = feed(one(series.map((s) => setOf(1, s, "payload", { opsStatus: "nonoperational" }))), { parameters });
    expect(suspected(dead).length).toBeGreaterThanOrEqual(1);
    expect(suspected(dead)[0]!.reasons.join(" ")).toContain("nonoperational");
    expect(suspected(dead)[0]!.evidence.explanations).toBe(1);
    const alive = feed(one(series.map((s) => setOf(2, s, "payload", { opsStatus: "operational" }))), { parameters });
    expect(suspected(alive)).toEqual([]);
    const burn = alive.verdicts.find((v) => v.state === "manoeuvre")!;
    expect(burn.reasons.join(" ")).toContain("could have burned");
    expect(burn.evidence.explanations).toBe(2);
    // The status off: both read as the envelope alone reads them, a manoeuvre.
    const off = { ...parameters, opsStatusEvidence: false };
    expect(suspected(feed(one(series.map((s) => setOf(3, s, "payload", { opsStatus: "nonoperational" }))), { parameters: off }))).toEqual([]);
    expect(feed(one(series.map((s) => setOf(4, s, "payload", { opsStatus: "operational" }))), { parameters: off }).verdicts.find((v) => v.state === "manoeuvre")!.evidence.explanations).toBe(1);
    // A working satellite's lone step that no envelope explains is a manoeuvre by its status alone; a dead one's is suspected whatever the envelope.
    const lone = decaying(7200, 0.02, 0.004, 120);
    for (let i = 0; i < lone.length; i++) if (lone[i]!.epochMs >= T0 + 100 * DAY) lone[i]!.aKm += 3;
    expect(suspected(feed(one(lone.map((s) => setOf(5, s, "payload", { opsStatus: "operational" }))), { parameters }))).toEqual([]);
    expect(suspected(feed(one(lone.map((s) => setOf(6, s, "payload", { opsStatus: "nonoperational" }))), { parameters })).length).toBe(1);
  });

  test("a kicked body whose residual scatter triples after the step: the alert's row carries a damage ratio near three, and a clean step one near one", () => {
    const gauss = noise(81);
    const kicked: SyntheticSet[] = [];
    const clean: SyntheticSet[] = [];
    for (let t = 0; t <= 60 * DAY; t += 8 * HOUR) {
      const after = t >= 20 * DAY;
      const g = gauss();
      kicked.push({ epochMs: T0 + t, aKm: 7200 - 0.02 * (t / DAY) - (after ? 0.5 : 0) + (after ? 0.012 : 0.004) * g, bstar: 1e-4 });
      clean.push({ epochMs: T0 + t, aKm: 7200 - 0.02 * (t / DAY) - (after ? 0.5 : 0) + 0.004 * g, bstar: 1e-4 });
    }
    const parameters = { damageFromDays: 14, damageToDays: 28 };
    const damaged = feed(one(kicked.map((s) => setOf(1, s, "rocket body"))), { parameters, until: T0 + 60 * DAY });
    expect(suspected(damaged)).toHaveLength(1);
    const row = damaged.log.find((r) => r.signals.phase === 3)!;
    expect(row).toBeDefined();
    expect(row.signals.damageResiduals).toBeGreaterThanOrEqual(10);
    expect(row.signals.damageRatio).toBeGreaterThan(2);
    expect(row.signals.damageRatio).toBeLessThan(5);
    const whole = feed(one(clean.map((s) => setOf(2, s, "rocket body"))), { parameters, until: T0 + 60 * DAY });
    const control = whole.log.find((r) => r.signals.phase === 3)!;
    expect(control.signals.damageRatio).toBeGreaterThan(0.5);
    expect(control.signals.damageRatio).toBeLessThan(1.6);
  });

  test("a lowering on a never-manoeuvred object is the breakup pattern: suspected on a working payload too where the parameter reads a lowering with no record against drag, and on a record of one raise", () => {
    const series = decaying(7200, 0.02, 0.004, 60);
    for (let i = 0; i < series.length; i++) if (series[i]!.epochMs >= T0 + 40 * DAY) series[i]!.aKm -= 0.5;
    // The working status explains the lowering; with the record's signatures never outweighed, the move against drag beats it where the parameter reads a bare lowering, and with one independent explanation outweighing them it does not.
    const base = { maintenanceToleranceKm: -1, opsStatusEvidence: true, independentOutweighs: Number.POSITIVE_INFINITY };
    expect(suspected(feed(one(series.map((s) => setOf(1, s, "payload", { opsStatus: "operational" }))), { parameters: { ...base, againstDragMinRaises: Number.POSITIVE_INFINITY } }))).toEqual([]);
    const bare = suspected(feed(one(series.map((s) => setOf(2, s, "payload", { opsStatus: "operational" }))), { parameters: { ...base, againstDragMinRaises: 0 } }));
    expect(bare).toHaveLength(1);
    expect(bare[0]!.reasons.join(" ")).toContain("a move against drag");
    expect(bare[0]!.evidence.againstDrag).toBe(1);
    expect(suspected(feed(one(series.map((s) => setOf(5, s, "payload", { opsStatus: "operational" }))), { parameters: { ...base, againstDragMinRaises: 0, independentOutweighs: 1 } }))).toEqual([]);
    // A record of one raise, then a lowering: against drag from one raise, not from two.
    const gauss = noise(91);
    const twice: SyntheticSet[] = [];
    for (let t = 0; t <= 120 * DAY; t += 8 * HOUR) twice.push({ epochMs: T0 + t, aKm: 7200 + (t >= 50 * DAY ? 0.4 : 0) - (t >= 100 * DAY ? 0.4 : 0) + 0.004 * gauss(), bstar: 1e-4 });
    const fromOne = feed(one(twice.map((s) => setOf(3, s, "payload", { opsStatus: "operational" }))), { parameters: { ...base, againstDragMinRaises: 1 } });
    const lowering = suspected(fromOne).filter((v) => v.step!.deltaKm < 0);
    expect(lowering).toHaveLength(1);
    expect(lowering[0]!.evidence.pastRaises).toBe(1);
    expect(lowering[0]!.reasons.join(" ")).toContain("past step was a raise");
    expect(suspected(feed(one(twice.map((s) => setOf(4, s, "payload", { opsStatus: "operational" }))), { parameters: { ...base, againstDragMinRaises: 2 } })).filter((v) => v.step!.deltaKm < 0)).toEqual([]);
  });
});
