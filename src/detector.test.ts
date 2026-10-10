import { describe, expect, test } from "vitest";
import { OUTCOMES } from "./log.ts";
import { MANOEUVRE_CLASSES } from "./manoeuvre.ts";
import { DETECTOR_PARAMETERS } from "./params.ts";
import { DAY, HOUR, feed, noise, one, setOf, type SyntheticSet } from "./synthetic.test-support.ts";
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
    expect(late.reasons.join(" ")).toContain("a manoeuvre, not a breakup");
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
