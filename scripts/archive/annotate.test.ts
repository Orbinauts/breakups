import { describe, expect, test } from "vitest";
import type { ArchivedBody } from "./archive.ts";
import { annotateBodies, statusCounts } from "./annotate.ts";
import type { GcatPayload } from "./gcat.ts";
import { parseSatcat } from "./satcat.ts";

/** The annotation of a body table from a snapshot: the status carried as the catalogue prints it, null where blank or where the snapshot has no row, nothing else touched. */

const CSV = [
  "OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OPS_STATUS_CODE,OWNER,LAUNCH_DATE,LAUNCH_SITE,DECAY_DATE,PERIOD,INCLINATION,APOGEE,PERIGEE,RCS,DATA_STATUS_CODE,ORBIT_CENTER,ORBIT_TYPE",
  "ALPHA,2010-001A,40001,PAY,+,US,2010-01-05,AFETR,,96,98,700,690,1.0,,EA,ORB",
  "BETA,2010-002A,40002,PAY,-,US,2010-01-20,AFETR,,96,98,700,690,1.0,,EA,ORB",
  "GAMMA R/B,2010-003A,40003,R/B,,US,2010-02-02,AFETR,,96,98,700,690,1.0,,EA,ORB",
  "DELTA,2010-004A,40004,PAY,D,US,2010-02-11,AFETR,2015-01-01,96,98,700,690,1.0,,EA,ORB",
  "",
].join("\n");

const body = (number: number): ArchivedBody => ({ number, first: 0, count: 1, designator: `2010-00${number - 40000}A`, name: null, bodyClass: "payload", launch: null, decay: null });

describe("the annotation", () => {
  test("carries the snapshot's status code onto every body, null where blank or unlisted, and touches nothing else", () => {
    const rows = parseSatcat(CSV);
    expect(rows.get(40001)!.opsStatus).toBe("+");
    expect(rows.get(40003)!.opsStatus).toBeNull();
    const bodies = annotateBodies([body(40001), body(40002), body(40003), body(40004), body(40005)], rows);
    expect(bodies.map((b) => b.opsStatus)).toEqual(["+", "-", null, "D", null]);
    expect(bodies.map((b) => b.endedOn)).toEqual([null, null, null, null, null]);
    expect(bodies[0]).toMatchObject({ number: 40001, first: 0, count: 1, designator: "2010-001A", bodyClass: "payload" });
    expect([...statusCounts(bodies).entries()].sort()).toEqual([
      ["+", 1],
      ["-", 1],
      ["D", 1],
      ["none", 2],
    ]);
  });

  test("carries GCAT's dated end of transmission onto the payloads it dates, null on the rest", () => {
    const ends = new Map<number, GcatPayload>([
      [40002, { number: 40002, designator: "2010-002A", name: "BETA", stated: "2014 Jun", operating: false, endedOn: "2014-06-30", endedFrom: "2014-06-01" }],
      [40001, { number: 40001, designator: "2010-001A", name: "ALPHA", stated: "*", operating: true, endedOn: null, endedFrom: null }],
    ]);
    const bodies = annotateBodies([body(40001), body(40002), body(40003)], parseSatcat(CSV), ends);
    expect(bodies.map((b) => [b.opsStatus, b.endedFrom, b.endedOn])).toEqual([
      ["+", null, null],
      ["-", "2014-06-01", "2014-06-30"],
      [null, null, null],
    ]);
  });
});
