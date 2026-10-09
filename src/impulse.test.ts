import { describe, expect, test } from "vitest";
import { MU_KM3_PER_S2, impulseOf, speedAt } from "./impulse.ts";
import { DETECTOR_PARAMETERS } from "./params.ts";

const params = DETECTOR_PARAMETERS;
/** A low orbit near 820 km, nearly circular. */
const LEO = { aKm: 7200, eccentricity: 0.001 };
/** The geostationary ring. */
const GEO = { aKm: 42164, eccentricity: 0.0002 };
/** A step measured to a centimetre-class sigma in the axis and a few in the perigee, as the catalogue's fits scatter on an intact low-orbit body. */
const tight = { sigmaKm: 0.01, sigmaPerigeeKm: 0.03 };

describe("the Gauss-equation impulse", () => {
  test("the orbital speed by vis-viva: circular at the semi-major axis, faster at perigee", () => {
    expect(speedAt(7200, 7200)).toBeCloseTo(Math.sqrt(MU_KM3_PER_S2 / 7200), 9);
    expect(speedAt(7200, 7200 * 0.9)).toBeGreaterThan(speedAt(7200, 7200));
  });

  test("a tangential burn that raises a low orbit by 300 m costs about 0.155 m/s, applied where both apsides moved alike", () => {
    // Both apsides up by the step: a burn away from the apsides, so the eccentricity is unchanged.
    const impulse = impulseOf(LEO, { deltaKm: 0.3, deltaPerigeeKm: 0.3 * (1 - LEO.eccentricity), deltaInclinationDeg: 0.0003, ...tight }, params);
    expect(impulse.tangentialMps).toBeCloseTo((0.3 * MU_KM3_PER_S2) / (2 * 7200 ** 2 * speedAt(7200, 7200)) * 1000, 6);
    expect(impulse.tangentialMps).toBeCloseTo(0.155, 2);
    expect(impulse.apsisLocation).toBeCloseTo(0.5, 2);
    // An inclination step under the format's resolution reads as no normal component, and nothing radial is needed.
    expect(impulse.normalMps).toBe(0);
    expect(impulse.radialMps).toBe(0);
    expect(impulse.consistency).toBe(0);
    expect(impulse.totalMps).toBeCloseTo(impulse.tangentialMps, 9);
  });

  test("a burn at perigee leaves the perigee alone and raises the apogee by twice the step", () => {
    const impulse = impulseOf(LEO, { deltaKm: 0.5, deltaPerigeeKm: 0, deltaInclinationDeg: 0, ...tight }, params);
    expect(impulse.apsisLocation).toBe(0);
    expect(impulse.speedKmps).toBeCloseTo(speedAt(7200, 7200 * (1 - 0.001)), 9);
    expect(impulse.consistency).toBe(0);
    const atApogee = impulseOf(LEO, { deltaKm: 0.5, deltaPerigeeKm: 1, deltaInclinationDeg: 0, ...tight }, params);
    expect(atApogee.apsisLocation).toBe(1);
    expect(atApogee.consistency).toBe(0);
    // The same axis step costs less at perigee, where the orbit is fastest.
    expect(impulse.tangentialMps).toBeLessThan(atApogee.tangentialMps);
  });

  test("a tenth of a degree of inclination in low orbit is a thirteen-metre-a-second normal burn", () => {
    const impulse = impulseOf(LEO, { deltaKm: 0, deltaPerigeeKm: 0, deltaInclinationDeg: 0.1, ...tight }, params);
    expect(impulse.normalMps).toBeCloseTo(speedAt(7200, 7200) * 0.1 * (Math.PI / 180) * 1000, 6);
    expect(impulse.normalMps).toBeCloseTo(12.99, 1);
    expect(impulse.tangentialMps).toBe(0);
    expect(Number.isNaN(impulse.apsisLocation)).toBe(true);
  });

  test("an eccentricity change beyond a tangential impulse's reach needs a radial kick, and the chi-squared says how surely", () => {
    // The shape of Cosmos 2251's step: the axis down three kilometres, the perigee down nine, so the apogee rose: no tangential burn does that.
    const impulse = impulseOf(LEO, { deltaKm: -3.04, deltaPerigeeKm: -9.35, deltaInclinationDeg: 0.004, ...tight }, params);
    const aDeltaE = -3.04 * (1 - LEO.eccentricity) + 9.35;
    const excess = Math.abs(aDeltaE) - (1 + LEO.eccentricity) * 3.04;
    expect(excess).toBeGreaterThan(3);
    expect(impulse.radialMps).toBeCloseTo((excess / 7200) * impulse.speedKmps * 1000, 6);
    expect(impulse.radialMps).toBeGreaterThan(3);
    expect(impulse.consistency).toBeGreaterThan(1000);
    // The same step measured with a sigma as wide as the excess is no evidence at all.
    const loose = impulseOf(LEO, { deltaKm: -3.04, deltaPerigeeKm: -9.35, deltaInclinationDeg: 0.004, sigmaKm: 1, sigmaPerigeeKm: 3 }, params);
    expect(loose.consistency).toBeLessThan(2);
  });

  test("a geostationary step that lowers the perigee four times as far as the axis is read as a radial kick of metres a second", () => {
    // The shape of Intelsat 33e's step.
    const impulse = impulseOf(GEO, { deltaKm: -26.7, deltaPerigeeKm: -114.3, deltaInclinationDeg: 0.296, sigmaKm: 2, sigmaPerigeeKm: 5 }, params);
    expect(impulse.tangentialMps).toBeCloseTo(0.97, 1);
    expect(impulse.normalMps).toBeCloseTo(15.9, 0);
    expect(impulse.radialMps).toBeGreaterThan(4);
    expect(impulse.consistency).toBeGreaterThan(100);
  });

  test("a foreign set's step, fifty kilometres of axis in one gap, reads as tens of metres a second, more than any station-keeping burn", () => {
    // The series holds such a set before the impulse is ever estimated; this is what it would read as if it were not.
    const impulse = impulseOf(LEO, { deltaKm: 50, deltaPerigeeKm: 50, deltaInclinationDeg: 0, ...tight }, params);
    expect(impulse.tangentialMps).toBeGreaterThan(25);
    expect(impulse.tangentialMps).toBeLessThan(27);
  });
});
