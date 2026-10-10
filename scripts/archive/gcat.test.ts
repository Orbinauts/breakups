import { describe, expect, test } from "vitest";
import { GcatPayloadFormError, firstDayOf, lastDayOf, parsePsatcat } from "./gcat.ts";

/** GCAT's payload catalogue read for the end of transmission: the identifier joined to the US catalogue number, the vague date read to the first and last day it may fall on, `*` as still transmitting, `-` as no date. */

const HEADER = "#JCAT\tPiece\tName\tLDate\tTLast\tTOp\tTDate\tTF\tProgram";
const TSV = [
  HEADER,
  "# Updated 2026 Oct  9 1800:52",
  "S41337    \t2016-012A\tHitomi (ASTRO-H)\t2016 Feb 17 \t2016 Mar 26\t2016 Mar 26\t2016 Mar 26\t-\tASTRO",
  "S39765    \t2014-028E\tCosmos-2499\t2014 May 23 \t2023 Jan\t*\t*\t-\tNivelir",
  "S18123    \t1987-053A\t[USA 26]\t1987 Jun 20 \t1994 Aug\t1994 Aug?\t1994 Aug?\t-\tDMSP",
  "S25678    \t1999-019C\tGlobalstar M044\t1999 Apr 15 \t2006 Aug\t2009 Sep 24\t2012 Nov 19\t-\tGlobalstar",
  "S99999    \t2000-001A\tUndated\t2000 Jan  1 \t-\t-\t-\t-\t-",
  "A01234    \t1990-001X\tAttached\t1990 Jan  1 \t1990\t1990\t1990\t-\t-",
  "",
].join("\n");

describe("GCAT's payload catalogue", () => {
  test("joins the S identifiers to catalogue numbers and reads the end of transmission to its first and last day", () => {
    const rows = parsePsatcat(TSV);
    expect([...rows.keys()]).toEqual([41337, 39765, 18123, 25678, 99999]);
    expect(rows.get(41337)).toEqual({ number: 41337, designator: "2016-012A", name: "Hitomi (ASTRO-H)", stated: "2016 Mar 26", operating: false, endedOn: "2016-03-26", endedFrom: "2016-03-26" });
    expect(rows.get(39765)).toMatchObject({ operating: true, endedOn: null });
    expect(rows.get(18123)!.endedOn).toBe("1994-09-30");
    expect(rows.get(18123)!.endedFrom).toBe("1994-07-01");
    // The end of transmission, not the end of operations: Globalstar M044 was commanded three years after its operations ended.
    expect(rows.get(25678)).toMatchObject({ stated: "2012 Nov 19", endedOn: "2012-11-19" });
    expect(rows.get(99999)).toMatchObject({ operating: false, endedOn: null, endedFrom: null });
  });

  test.each([
    ["2013 Apr 10", "2013-04-10", "2013-04-10"],
    ["2013 Apr 10?", "2013-04-09", "2013-04-11"],
    ["1994 Aug", "1994-08-01", "1994-08-31"],
    ["1995", "1995-01-01", "1995-12-31"],
    ["1998?", "1997-01-01", "1999-12-31"],
    ["2004 Dec ?", "2004-11-01", "2005-01-31"],
    ["1988 Q1", "1988-01-01", "1988-03-31"],
    ["2021 Q2?", "2021-01-01", "2021-09-30"],
    ["2010s?", "2000-01-01", "2029-12-31"],
    ["2012 Jun 3 1200", "2012-06-03", "2012-06-03"],
  ])("%s falls from %s to %s", (stated, first, last) => {
    expect(firstDayOf(stated)).toBe(first);
    expect(lastDayOf(stated)).toBe(last);
  });

  test("an end of transmission in no known form throws, naming the row", () => {
    expect(() => parsePsatcat([HEADER, "S00005\t1958 BET 2\tVanguard\t1958 Mar 17\t-\t-\tsoon\t-\t-"].join("\n"))).toThrow(GcatPayloadFormError);
    expect(() => parsePsatcat("#JCAT\tPiece\n")).toThrow(/no column Name/);
  });
});
