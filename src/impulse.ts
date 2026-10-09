import type { DetectorParameters } from "./params.ts";

/**
 * The impulse a measured step implies, by Gauss's variational equations
 * for a single velocity change at one instant: the step in the semi-major
 * axis gives the tangential component, the step in the perigee and apogee
 * radii say where on the orbit it was applied, the step in the inclination
 * gives the normal component, and whatever change in the eccentricity a
 * tangential impulse cannot account for needs a radial component. The
 * detector reads these as evidence, never as a gate: a thruster burns
 * along the velocity at an apsis or across it at a node, so a step that
 * needs a radial kick is harder to explain as a manoeuvre; and the same
 * numbers class the object's past steps as east-west or north-south.
 *
 * For a tangential impulse of size dV at a point of speed V on an orbit of
 * semi-major axis a, `da = 2 a² V dV / mu`, and `de = 2 (e + cos nu) dV / V`
 * where nu is the true anomaly; a normal impulse at argument of latitude u
 * gives `di = dV cos u / V`; a radial impulse gives `de = dV sin nu / V`
 * and leaves a alone. The eccentricity change a tangential impulse can
 * produce is therefore bounded by `(1 + e) |da|`, in kilometres of `a de`,
 * reached at apogee; any excess beyond the measurement's sigma is the
 * radial component's, and its chi-squared is the consistency reported.
 *
 * Units: kilometres and degrees in, metres a second out; the node's
 * precession is not read, so the normal component is a lower bound from
 * the inclination alone.
 */

/** Earth's gravitational parameter, in cubic kilometres a second squared, the WGS84 value the engine's Kepler conversion uses. Physical. */
export const MU_KM3_PER_S2 = 398600.4418;

/** The orbit the step was measured on, at the last set before it. */
export interface Orbit {
  aKm: number;
  eccentricity: number;
}

/** A measured step with the sigma of each component, in kilometres and degrees. */
export interface MeasuredStep {
  deltaKm: number;
  sigmaKm: number;
  deltaPerigeeKm: number;
  sigmaPerigeeKm: number;
  deltaInclinationDeg: number;
}

export interface Impulse {
  /** The tangential component, in metres a second: the least that moves the semi-major axis by the step, at the point the apsides say it was applied. */
  tangentialMps: number;
  /** Where on the orbit a tangential impulse would have been applied to move the two apsides as measured: 0 at perigee (the apogee moved, the perigee stayed), 1 at apogee, a half where both moved alike; NaN where neither moved. */
  apsisLocation: number;
  /** The normal component, in metres a second, from the inclination step; zero where the step is under the format's resolution. */
  normalMps: number;
  /** The least radial component, in metres a second, that gives the eccentricity change a tangential impulse cannot; zero where none is needed. */
  radialMps: number;
  /** The chi-squared of the eccentricity change beyond a single tangential impulse's reach: how many sigmas squared of radial kick the step needs. */
  consistency: number;
  /** The three components in quadrature, in metres a second. */
  totalMps: number;
  /** The orbital speed at the point of the impulse, in kilometres a second. */
  speedKmps: number;
}

const DEG = Math.PI / 180;

/** The orbital speed at a radius on an orbit, in kilometres a second, by the vis-viva equation. */
export function speedAt(aKm: number, rKm: number): number {
  return Math.sqrt(MU_KM3_PER_S2 * Math.max(1e-9, 2 / rKm - 1 / aKm));
}

/** The impulse a measured step implies on the orbit it was measured on. */
export function impulseOf(orbit: Orbit, step: MeasuredStep, params: DetectorParameters): Impulse {
  const { aKm, eccentricity: e } = orbit;
  const rp = aKm * (1 - e);
  const ra = aKm * (1 + e);
  const deltaApogee = 2 * step.deltaKm - step.deltaPerigeeKm;
  const moved = Math.abs(step.deltaPerigeeKm) + Math.abs(deltaApogee);
  const apsisLocation = moved === 0 ? Number.NaN : Math.abs(step.deltaPerigeeKm) / moved;
  const r = Number.isNaN(apsisLocation) ? aKm : rp + apsisLocation * (ra - rp);
  const speedKmps = speedAt(aKm, r);
  const tangentialMps = (Math.abs(step.deltaKm) * MU_KM3_PER_S2) / (2 * aKm * aKm * speedKmps) * 1000;
  const normalMps = Math.abs(step.deltaInclinationDeg) >= params.inclinationStepMinDeg ? speedKmps * Math.abs(step.deltaInclinationDeg) * DEG * 1000 : 0;
  // The eccentricity change in kilometres of `a de`, from the perigee radius: `r_p = a (1 - e)`, so `a de = da (1 - e) - dr_p`.
  const aDeltaE = step.deltaKm * (1 - e) - step.deltaPerigeeKm;
  const bound = (1 + e) * Math.abs(step.deltaKm);
  const excess = Math.max(0, Math.abs(aDeltaE) - bound);
  const sigmaExcess = Math.sqrt(step.sigmaKm * step.sigmaKm * ((1 - e) * (1 - e) + (1 + e) * (1 + e)) + step.sigmaPerigeeKm * step.sigmaPerigeeKm);
  const consistency = sigmaExcess > 0 ? (excess / sigmaExcess) ** 2 : excess > 0 ? Number.POSITIVE_INFINITY : 0;
  const radialMps = (excess / aKm) * speedKmps * 1000;
  return {
    tangentialMps,
    apsisLocation,
    normalMps,
    radialMps,
    consistency,
    totalMps: Math.sqrt(tangentialMps * tangentialMps + normalMps * normalMps + radialMps * radialMps),
    speedKmps,
  };
}
