import { describe, expect, test } from "vitest";
import { parseSatcat } from "./satcat.ts";
import { renderVisiting, vehicleOf, visitingLaunches } from "./visiting.ts";

/** Rows of the satellite catalogue as it prints them: craft of every vehicle, the names that only contain their words, and a craft that fell before 2005. */
const CSV = [
  "OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OPS_STATUS_CODE,OWNER,LAUNCH_DATE,LAUNCH_SITE,DECAY_DATE,PERIOD,INCLINATION,APOGEE,PERIGEE,RCS,DATA_STATUS_CODE,ORBIT_CENTER,ORBIT_TYPE",
  "PROGRESS-M 50,2004-032A,28399,PAY,D,CIS,2004-08-11,TYMSC,2004-12-23,,,,,,,EA,IMP",
  "SOYUZ-TMA 5,2004-040A,28444,PAY,D,CIS,2004-10-14,TYMSC,2005-04-25,,,,,,,EA,LAN",
  "STS 114,2005-026A,28775,PAY,D,US,2005-07-26,AFETR,2005-08-09,,,,,,,EA,LAN",
  "SHENZHOU-14 (SZ-14),2022-060A,52797,PAY,D,PRC,2022-06-05,JSC,2022-12-04,,,,,,,EA,LAN",
  "CZ-2F R/B,2022-060B,52798,R/B,D,PRC,2022-06-05,JSC,2022-06-21,,,,,,,EA,IMP",
  "DRAGON CRS-1,2012-054A,38846,PAY,D,US,2012-10-08,AFETR,2012-10-28,,,,,,,EA,LAN",
  "CREW DRAGON 5,2022-124A,54016,PAY,D,US,2022-10-05,AFETR,2023-03-12,,,,,,,EA,LAN",
  "AXIOM-1 (AX-1),2022-037A,52204,PAY,D,US,2022-04-08,AFETR,2022-04-25,,,,,,,EA,LAN",
  "CYGNUS NG-17,2022-015A,51595,PAY,D,US,2022-02-19,WI,2022-06-29,,,,,,,EA,IMP",
  "HTV-X1,2025-241A,66174,PAY,D,JPN,2025-10-26,TANSC,2026-05-26,,,,,,,EA,IMP",
  "ATV-1 (JULES VERNE),2008-008A,32787,PAY,D,ESA,2008-03-09,FRGUI,2008-09-29,,,,,,,EA,IMP",
  "TIANZHOU-4,2022-050A,52449,PAY,D,PRC,2022-05-09,WSC,2022-11-14,,,,,,,EA,IMP",
  "STARLINER OFT-2,2022-055A,52554,PAY,D,US,2022-05-19,AFETR,2022-05-26,,,,,,,EA,LAN",
  "DRAGONSAT,2009-038B,35004,PAY,D,US,2009-07-15,AFETR,2010-03-17,,,,,,,EA,IMP",
  "STSAT-3,2013-066G,39422,PAY,,SKOR,2013-11-21,DOMA,,,,,,,,EA,ORB",
  "PAYLOAD SIM (CYGNUS),2013-016D,39145,PAY,D,US,2013-04-21,WI,2013-05-10,,,,,,,EA,IMP",
  "ORION,2022-156A,54257,PAY,D,US,2022-11-16,AFETR,2022-12-11,,,,,,,EA,LAN",
].join("\n");

describe("the crewed and cargo craft's launches", () => {
  test("a craft is known by the catalogue's names for its vehicle, and a name that only contains the words is not one", () => {
    expect(vehicleOf("SOYUZ-MS 22")?.name).toBe("Soyuz");
    expect(vehicleOf("PROGRESS-M UM")?.name).toBe("Progress");
    expect(vehicleOf("DRAGON & FALCON 9 R/B")?.name).toBe("Dragon");
    expect(vehicleOf("INSPIRATION4")?.kind).toBe("crewed");
    expect(vehicleOf("KOUNOTORI 2 (HTV-2)")).toBeNull();
    expect(vehicleOf("HTV-2 (KOUNOTORI 2)")?.kind).toBe("cargo");
    for (const name of ["DRAGONSAT", "MICRODRAGON", "DRAGRACER 1 (ALCHEMY)", "STSAT-3", "STSS DEMO 1 (USA 208)", "PAYLOAD SIM (CYGNUS)", "ORION", "LEMUR-2-MIA-GRACE"]) expect(vehicleOf(name)).toBeNull();
  });

  test("the launches are the craft's in orbit since 2005, by launch, the payload alone deciding", () => {
    const launches = visitingLaunches(parseSatcat(CSV).values());
    expect(launches.map((l) => l.launch)).toEqual(["2004-040", "2005-026", "2008-008", "2012-054", "2022-015", "2022-037", "2022-050", "2022-055", "2022-060", "2022-124", "2025-241"]);
    expect(launches.find((l) => l.launch === "2022-060")?.name).toBe("SHENZHOU-14 (SZ-14)");
  });

  test("the generated list names each launch's craft and the snapshot it was read from", () => {
    const text = renderVisiting(visitingLaunches(parseSatcat(CSV).values()), "2026-10-09");
    expect(text).toContain('  "2022-060", // SHENZHOU-14 (SZ-14)');
    expect(text).toContain("snapshot of 2026-10-09");
    expect(text).toContain("export const VISITING_LAUNCHES: readonly string[] = [");
  });
});
