import { describe, expect, test } from "vitest";
import { DETECTOR_PARAMETERS, parametersWith, type ParameterOverrides } from "../../src/index.ts";
import { parseParameter } from "./run.ts";

/** `--param name=value`: a live parameter by its name, a legacy option in its block or by its bare name, never a name the detector does not have. */
describe("a replay's --param", () => {
  test("sets a live parameter, a legacy option by its block's path and by its bare name", () => {
    const into: ParameterOverrides = {};
    parseParameter("cloudMemoryDays=0", into);
    parseParameter("legacy.analystAttributes=true", into);
    parseParameter("attributionYoungLaunch=true", into);
    const params = parametersWith(into);
    expect(params.cloudMemoryDays).toBe(0);
    expect(params.legacy).toEqual({ ...DETECTOR_PARAMETERS.legacy, analystAttributes: true, attributionYoungLaunch: true });
  });

  test("refuses a name the detector does not have, in the block or out of it", () => {
    expect(() => parseParameter("noSuchKnob=1", {})).toThrow(/no detector parameter named noSuchKnob/);
    expect(() => parseParameter("legacy.cloudMemoryDays=1", {})).toThrow(/no legacy option named cloudMemoryDays/);
  });
});
