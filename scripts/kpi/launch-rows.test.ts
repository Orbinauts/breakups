import { describe, expect, test } from "vitest";
import type { Breakup } from "../../src/index.ts";
import { catalogueOver, launchFragmentsOf, planeOrbit, type BodyFact } from "./catalogue.ts";
import { confirmedCellsOf } from "./kpi.ts";
import { landConfirmed, type LaunchEvent, type Row } from "./match.ts";

/**
 * The rows that name a launch and no catalogued parent (a burst of the
 * catalogue's, a separation GCAT gives an object the public catalogue does
 * not list): scored on the Confirmed line by their launch, since the
 * detector attributes a cloud to a body of the launch it cannot always
 * tell from the launch's other bodies.
 */

const DAY = 86_400_000;
const T = Date.UTC(2023, 4, 28);

const launchRow = (from: number, scoreable = true): Row => ({
  breakup: { id: `A:2013-076:${new Date(from).toISOString().slice(0, 10)}`, parent: { catalogueNumber: null, designator: "2013-076", name: "COSMOS 2491" }, kind: scoreable ? "breakup" : "release", confidence: "D", scoreable, exemptReason: scoreable ? null : "a release of objects, not a breakup" } as unknown as Breakup,
  from,
  to: from + 60 * DAY,
  margin: DAY,
  launch: "2013-076",
  fragments: new Set(),
  scored: null,
});

const verdict = (number: number, raisedAt: number, launch = "2013-076") => ({ number, launch, raisedAt, step: null, event: null, evidence: { bodyClass: 1 } });

describe("a launch-level row on the Confirmed line", () => {
  test("is detected by a confirmed verdict on any body of its launch within its window and the 180 days after it", () => {
    const rows = [launchRow(T)];
    expect(landConfirmed(verdict(39765, T + 70 * DAY), 0, rows)).toMatchObject({ outcome: "detection", event: "A:2013-076:2023-05-28" });
    expect(landConfirmed(verdict(39765, T + 60 * DAY + 181 * DAY), 0, rows).outcome).toBe("false-alarm");
    expect(landConfirmed(verdict(40000, T + 70 * DAY, "2014-001"), 0, rows).outcome).toBe("false-alarm");
  });

  test("a release naming the launch alone still makes its window exempt, not a detection", () => {
    expect(landConfirmed(verdict(39765, T + 70 * DAY), 0, [launchRow(T, false)]).outcome).toBe("exempt");
  });

  test("is a target where its launch gained fresh pieces in the window, with no parent's plane to test them against", () => {
    const fact = (number: number, firstClock: number, bodyClass: BodyFact["bodyClass"] = "debris"): BodyFact => ({ number, launch: "2013-076", name: "", bodyClass, decayMs: null, launchMs: null, firstClock, firstEpoch: firstClock - DAY, orbit: planeOrbit(firstClock, 14, 0.001, 82, 10) });
    const catalogue = catalogueOver(new Map([[39765, fact(39765, Date.UTC(2014, 0, 1), "payload")], [56001, fact(56001, T - 300 * DAY)], [58001, fact(58001, T + 20 * DAY)], [58002, fact(58002, T + 25 * DAY)], [58003, fact(58003, T + 30 * DAY, "payload")]]), () => {
      throw new Error("a launch-level row reads no parent's set");
    });
    expect(launchFragmentsOf(catalogue, "2013-076", T, T + 60 * DAY, DAY)).toEqual({ inPlane: 2, firstAt: T + 20 * DAY, firstBody: 58001, parentOrbit: true });
  });

  test("counts on its line as a target, detected by its first confirmation", () => {
    const rows = [launchRow(T)];
    const confirmation = landConfirmed(verdict(39765, T + 70 * DAY), 0, rows);
    const launchEvent: LaunchEvent = { id: "A:2013-076:2023-05-28", name: "COSMOS 2491", kind: "breakup", confidence: "D", line: "breakups D", launch: "2013-076", from: T, to: T + 60 * DAY, at: null, statement: null, firstStatement: null, fragments: { inPlane: 25, firstAt: T + 20 * DAY, firstBody: 58001, parentOrbit: true } };
    const c = confirmedCellsOf([{ year: 2023, score: { year: 2023, timeBasis: "created", events: [], launchEvents: [launchEvent], alerts: [], review: [], confirmations: [confirmation] } }]);
    expect(c.lines["breakups D"]).toMatchObject({ targets: 1, detected: 1, missed: 0 });
    expect(c.detections).toBe(1);
    expect(c.exempt).toBe(0);
  });
});
