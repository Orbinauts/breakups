import { describe, expect, test } from "vitest";
import { parseGfz, parseOmniDst } from "./space-weather.ts";

/**
 * The space-weather files read as served, on lines copied from the
 * Archive's own copies: GFZ's daily Kp, ap, Ap and flux, and OMNI2's
 * hourly Dst, over the storm of 10 and 11 May 2024 and a few ordinary
 * days.
 */

const GFZ = [
  "#YYY MM DD  days  days_m  Bsr dB    Kp1    Kp2    Kp3    Kp4    Kp5    Kp6    Kp7    Kp8  ap1  ap2  ap3  ap4  ap5  ap6  ap7  ap8    Ap  SN F10.7obs F10.7adj D",
  "2024 05 10 33733 33733.5 2601 20  2.667  2.667  2.333  2.000  3.667  7.667  8.667  8.667   12   12    9    7   22  179  300  300   105 172    223.4    227.9 2",
  "2024 05 11 33734 33734.5 2601 21  9.000  8.333  8.333  9.000  8.667  8.333  7.667  7.667  400  236  236  400  300  236  179  179   271 173    213.7    218.0 2",
  "2025 02 17 34016 34016.5 2612  6  2.667  3.333  2.333  2.333  3.333  3.667  1.667  3.333   12   18    9    9   18   22    6   18    14 203     -1.0     -1.0 2",
  "2026 10 08 34614 34614.5 2634 10  1.000  1.000  1.000  2.000  1.333  1.333  2.333  1.333    4    4    4    7    5    5    9    5     5  74    119.2    119.0 0",
  "",
].join("\n");

const OMNI = [
  "2024 132  0 2601 51 52  50  29  54.3  51.1 -65.3 123.5 -11.8  17.8 -46.5  35.1 -35.3   9.8  19.1   9.4  13.3   9.9  424750.  14.7  742.   0.7  -2.3 0.134 20.76  267172.   8.2   32.   2.8   1.8 0.034  26.19   0.11   2.6 90 173  -313  874 999999.99 99999.99 99999.99 99999.99 99999.99 99999.99  0 400 218.0  12.1  -219   655  2.5",
  "2024 132  1 2601 51 52  58  34  49.5  42.9 -38.6 226.7 -23.0 -24.4 -26.7 -12.4 -34.0   3.5  24.6   7.6  17.9  15.0  533137.  25.2  732.   5.0  -2.2 0.120 33.37  250584.   4.5   17.   1.2   2.0 0.026  24.89   0.28   3.7 90 173  -390  926 999999.99 99999.99 99999.99 99999.99 99999.99 99999.99  0 400 218.0  14.5  -742   185  3.3",
  "2024 132 23 2601 51 52  61  22  10.4   8.5   2.0  67.9   3.2   7.8   0.3   7.0   3.5   1.7   6.1   3.9   1.8   4.3  758667.   1.7  882.  -1.0  -0.9 9.999  2.64  208858.   0.5   33.   1.8   2.5 9.999  -3.09   0.58   5.5 77 173  -167  233 999999.99 99999.99 99999.99 99999.99 99999.99 99999.99  0 179 218.0   2.2  -129   104  4.5",
  "2026 278 14 9999 99 99 999 999 999.9 999.9 999.9 999.9 999.9 999.9 999.9 999.9 999.9 999.9 999.9 999.9 999.9 999.9 9999999. 999.9 9999. 999.9 999.9 9.999 99.99 9999999. 999.9 9999. 999.9 999.9 9.999 999.99 999.99 999.9 99 999 99999 9999 999999.99 99999.99 99999.99 99999.99 99999.99 99999.99  0 999 999.9 999.9 99999 99999 99.9",
  "",
].join("\n");

describe("GFZ's daily indices", () => {
  const days = parseGfz(GFZ);

  test("are read by day, the header skipped: the eight Kp and ap of each day, the daily Ap and the flux", () => {
    expect([...days.keys()]).toEqual(["2024-05-10", "2024-05-11", "2025-02-17", "2026-10-08"]);
    expect(days.get("2024-05-11")).toEqual({ day: "2024-05-11", kp: [9, 8.333, 8.333, 9, 8.667, 8.333, 7.667, 7.667], ap: [400, 236, 236, 400, 300, 236, 179, 179], Ap: 271, f107: 213.7, f107Adjusted: 218, definitive: true });
  });

  test("a flux not measured is null, and a day GFZ has not made definitive says so", () => {
    expect(days.get("2025-02-17")).toMatchObject({ f107: null, f107Adjusted: null, definitive: true });
    expect(days.get("2026-10-08")).toMatchObject({ f107: 119.2, definitive: false });
  });
});

describe("OMNI2's hourly Dst", () => {
  const days = parseOmniDst(OMNI);

  test("is read by day of the year into twenty-four hours, an hour with no line left null", () => {
    const may11 = days.get("2024-05-11")!;
    expect(may11).toHaveLength(24);
    expect(may11.slice(0, 2)).toEqual([-313, -390]);
    expect(may11[23]).toBe(-167);
    expect(may11.slice(2, 23).every((v) => v === null)).toBe(true);
  });

  test("OMNI's fill value for no Dst is null", () => {
    expect(days.get("2026-10-05")![14]).toBeNull();
  });
});
