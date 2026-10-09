import type { LogRow } from "./detector.ts";
import { REGIMES, type Regime } from "./truth.ts";

/**
 * The sweep log: one row per candidate, written when it closes, with
 * every signal the decision read and the trajectory of the step over the
 * first post sets, so the thresholds can be swept offline from a year's
 * rows without replaying the year. Every value is a number (the regime by
 * its index in `REGIMES`, the phase and the outcome by the codes below),
 * rounded to four significant digits so a year's rows stay small on disk.
 * A candidate still open when the caller stops has no row.
 */

/** Where in a candidate's life the row was written: its opening on the first post set, a later post set, or its close. */
export const PHASES = { open: 0, post: 1, close: 2 } as const;

/** How a candidate ended: still open, raised as suspected, dismissed as a bad set, lapsed with no post set, or closed unraised after the last gap. */
export const OUTCOMES = { open: 0, suspected: 1, reverted: 2, lapsed: 3, faded: 4 } as const;

/** The origin of a candidate: a single set's jump, or the CUSUM's slow drift. */
export const ORIGINS = { step: 0, cusum: 1 } as const;

/** The signals a row carries, by name, each with its unit. */
export const SIGNALS = {
  /** `PHASES`. */
  phase: "code",
  /** `OUTCOMES`. */
  outcome: "code",
  /** `ORIGINS`. */
  origin: "code",
  /** The index of the regime in `REGIMES`. */
  regime: "index",
  /** The bracket's edges, in milliseconds since 1970. */
  beforeEpoch: "ms",
  afterEpoch: "ms",
  /** The first post set's jump, in kilometres, and its normalised size. */
  delta1: "km",
  z1: "sigma",
  /** The fitted step over the post sets so far, in kilometres, its normalised size, the post sets read and the hours they span. */
  deltaKm: "km",
  zk: "sigma",
  k: "count",
  spanHours: "h",
  /** The median of the later sets' plain residuals over the first set's jump. */
  rhoMedian: "ratio",
  /** The fitted post slope, in kilometres a day. */
  slope: "km/day",
  /** The evidence for a step against a drift: the slope-only fit's weighted squares less the step-and-slope fit's. */
  stepEvidence: "chi2",
  /** The perigee radius and inclination steps with their normalised sizes. */
  deltaPerigeeKm: "km",
  zPerigee: "sigma",
  deltaInclinationDeg: "deg",
  zInclination: "sigma",
  /** The object's own scatter when the candidate opened, in kilometres, how many residuals it rested on, and the first set's prediction sigma. */
  sigmaOwn: "km",
  residuals: "count",
  sigmaPred: "km",
  /** The band's scale and common-mode term at the first post set. */
  bandScale1: "ratio",
  commonMode1: "km/day/bstar",
  /** The gap from the last pre set to the first post set, in hours. */
  gapHours: "h",
  /** The drag term of the pre window, in inverse Earth radii, the first post set's over it, and the perigee height in kilometres. */
  bstar: "1/Re",
  bstarRatio: "ratio",
  perigeeKm: "km",
  /** The trajectory: the normalised step, the later sets' ratio, the evidence and the span when the second and the third post set were first read. */
  z2: "sigma",
  rho2: "ratio",
  evidence2: "chi2",
  span2: "h",
  z3: "sigma",
  rho3: "ratio",
  evidence3: "chi2",
  span3: "h",
  /** The run's weather: the highest Kp over the days given, the flux; whether a storm hold was on; and how many candidates the catalogue opened in the last day. */
  kpMax: "Kp",
  f107: "sfu",
  stormHold: "flag",
  recentCandidates: "count",
  /** The larger side of the CUSUM when the candidate opened. */
  cusumPos: "sigma",
  /** How many sets the pre fit read. */
  preSets: "count",
  /** The object's class as the catalogue says it, by its index in `BODY_CLASSES`. */
  bodyClass: "index",
} as const;

export type SignalName = keyof typeof SIGNALS;

/** Four significant digits; NaN and infinities become null-like NaN, which JSON writes as null. */
export function round5(value: number): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const digits = 4 - Math.ceil(Math.log10(Math.abs(value)));
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function regimeIndex(regime: Regime): number {
  return REGIMES.indexOf(regime);
}

/** A row of the log, the signals rounded; a missing signal is left out. */
export function logRow(at: number, number: number, signals: Partial<Record<SignalName, number>>): LogRow {
  const rounded: Record<string, number> = {};
  for (const [name, value] of Object.entries(signals)) {
    if (value === undefined) continue;
    rounded[name] = name === "beforeEpoch" || name === "afterEpoch" ? Math.round(value) : round5(value);
  }
  return { at, number, signals: rounded };
}
