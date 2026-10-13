import { describe, expect, test } from "vitest";
import { fixedOfDecimal, fixedOfField } from "./archive.ts";

/** The columns' two fixed-point readings, side by side where they differ on purpose. */
describe("the columns' fixed-point integers", () => {
  test("read the digits exactly, past what a float would keep", () => {
    expect(fixedOfField("15.49175317", 8)).toBe(1_549_175_317);
    expect(fixedOfDecimal("15.49175317", 8)).toBe(1_549_175_317);
    expect(fixedOfField(" 98.1234", 4)).toBe(981_234);
    expect(fixedOfDecimal(".5", 2)).toBe(50);
  });

  test("a two-line field is unsigned and a blank one unreadable; an OMM's decimal may be signed or in exponent form, and a blank one reads zero", () => {
    expect(fixedOfField("-1.5", 2)).toBeNaN();
    expect(fixedOfDecimal("-1.5", 2)).toBe(-150);
    expect(fixedOfField("1.2e-5", 8)).toBeNaN();
    expect(fixedOfDecimal("1.2e-5", 8)).toBe(1200);
    expect(fixedOfField("   ", 4)).toBeNaN();
    expect(fixedOfDecimal("", 4)).toBe(0);
    expect(fixedOfField("1.2.3", 4)).toBeNaN();
    expect(fixedOfDecimal("abc", 4)).toBeNaN();
  });
});
