import type { SpaceWeatherDay } from "./detector.ts";
import { median, robustScale } from "./model.ts";
import { DETECTOR_PARAMETERS, type DetectorParameters } from "./params.ts";
import type { Regime } from "./truth.ts";

/**
 * What one run says about the day, read from the catalogue itself and
 * from the space-weather indices: the drag every object in a band felt
 * beyond what its own model predicted, and how far the band's residuals
 * scatter beyond what the objects' own noise says. A storm moves every
 * high-drag object in a band the same way, in proportion to its drag
 * term and the gap since its last set, so the median of that proportion
 * over the band is the day's common-mode term, taken off each object's
 * residual before it is judged; and the robust scatter of the corrected,
 * normalised residuals is the band's live scale, which raises the bar for
 * everyone on a day the catalogue is noisy and leaves it at one on a quiet
 * day. An intact body hundreds of times above its own scatter still
 * stands out; a fragment that moved with its band does not.
 *
 * The bands are fifty kilometres of perigee height in low orbit, where
 * drag changes by orders of magnitude over a few hundred kilometres, and
 * one band per other regime. A band with too few residuals in a run
 * takes the regime's pooled values, and with too few of those is left
 * uncorrected.
 *
 * The indices say why: Kp at six or more on the run's day or the two
 * before holds the persistence gate up by a set, and the flux and the
 * daily Ap scale the prior a new object is given, since scatter grows
 * with both.
 */


/** A residual as the environment reads it: which band, the residual in kilometres, its prediction sigma, the gap in days and the drag term. */
export interface Measurement {
  band: string;
  regime: Regime;
  residual: number;
  sigmaPred: number;
  gapDays: number;
  bstar: number;
}

/** The band a set is filed in: `LEO:16` for a perigee height of 800 to 850 km, else the regime's name. */
export function bandOf(regime: Regime, perigeeHeightKm: number, params: Pick<DetectorParameters, "leoBandKm"> = DETECTOR_PARAMETERS): string {
  if (regime !== "LEO") return regime;
  return `LEO:${Math.max(0, Math.floor(perigeeHeightKm / params.leoBandKm))}`;
}

export interface BandStats {
  /** The common-mode drag term, in kilometres per day per unit of B*; zero where the band could not say. */
  commonMode: number;
  /** The live scale of the normalised residuals, at least the floor; one where the band could not say. */
  scale: number;
  /** How many residuals the values rest on, and whether they are the regime's pooled values rather than the band's own. */
  members: number;
  pooled: boolean;
}

const UNCORRECTED: BandStats = { commonMode: 0, scale: 1, members: 0, pooled: false };

function statsOf(members: Measurement[], params: DetectorParameters, pooled: boolean): BandStats {
  const ratios: number[] = [];
  for (const m of members) if (Math.abs(m.bstar) > params.commonModeMinBstar && m.gapDays > 0) ratios.push(m.residual / (m.bstar * m.gapDays));
  const commonMode = ratios.length >= params.bandMinMembers ? median(ratios) : 0;
  const normalised = members.map((m) => (m.residual - commonMode * m.bstar * m.gapDays) / m.sigmaPred);
  const scale = Math.max(params.bandScaleFloor, robustScale(normalised));
  return { commonMode, scale, members: members.length, pooled };
}

/**
 * The common-mode term and the live scale of every band seen in a run,
 * and of every regime pooled, keyed by band and by regime name. A band
 * under the member minimum maps to its regime's pooled values, and a
 * regime under it to no correction.
 */
export function environmentOf(measurements: Measurement[], params: DetectorParameters): Map<string, BandStats> {
  const byBand = new Map<string, Measurement[]>();
  const byRegime = new Map<string, Measurement[]>();
  for (const m of measurements) {
    (byBand.get(m.band) ?? byBand.set(m.band, []).get(m.band)!).push(m);
    (byRegime.get(m.regime) ?? byRegime.set(m.regime, []).get(m.regime)!).push(m);
  }
  const stats = new Map<string, BandStats>();
  for (const [regime, members] of byRegime) stats.set(regime, members.length >= params.bandMinMembers ? statsOf(members, params, true) : UNCORRECTED);
  for (const [band, members] of byBand) {
    if (band === members[0]!.regime) continue;
    stats.set(band, members.length >= params.bandMinMembers ? statsOf(members, params, false) : stats.get(members[0]!.regime)!);
  }
  return stats;
}

/** The band's values for a measurement, or no correction where the run saw too little. */
export function statsFor(stats: Map<string, BandStats>, band: string, regime: Regime): BandStats {
  return stats.get(band) ?? stats.get(regime) ?? UNCORRECTED;
}

/** What the space-weather indices say for the run. */
export interface Weather {
  /** The highest three-hourly Kp over the days given; zero where none were. */
  kpMax: number;
  /** The highest daily Ap over the days given. */
  apMax: number;
  /** The latest observed 10.7 cm flux, in solar flux units; NaN where none was given. */
  f107: number;
  /** Whether a storm hold is on: Kp reached the parameter. */
  stormHold: boolean;
  /** The factor the prior scatter is scaled by, from the flux and the Ap; one where no indices were given. */
  priorFactor: number;
  /** The factor the drag term of the prediction variance is scaled by, from the Ap. */
  dragFactor: number;
}

/** The factor the scatter scales by at the 10.7 cm flux, from the parameters' table (`fluxScatter`); one where no flux was given. */
export function fluxFactor(f107: number, params: Pick<DetectorParameters, "fluxScatter"> = DETECTOR_PARAMETERS): number {
  if (!Number.isFinite(f107)) return 1;
  for (const [upTo, factor] of params.fluxScatter) if (f107 <= upTo) return factor;
  return 1;
}

/** The factor the scatter scales by at the daily Ap, a line in its logarithm between the parameters' quiet and storm days (`apScatter`); one where no Ap was given. */
export function apFactor(ap: number, params: Pick<DetectorParameters, "apScatter"> = DETECTOR_PARAMETERS): number {
  if (!Number.isFinite(ap)) return 1;
  const { quiet, storm, quietAp, stormAp } = params.apScatter;
  const position = (Math.log10(Math.max(quietAp, Math.min(stormAp, ap))) - Math.log10(quietAp)) / (Math.log10(stormAp) - Math.log10(quietAp));
  return quiet + (storm - quiet) * position;
}

/** The weather of a run from the days the caller handed in, the run's day last. */
export function weatherOf(space: SpaceWeatherDay[] | undefined, params: DetectorParameters): Weather {
  if (space === undefined || space.length === 0) return { kpMax: 0, apMax: 0, f107: Number.NaN, stormHold: false, priorFactor: 1, dragFactor: 1 };
  let kpMax = 0;
  let apMax = 0;
  let f107 = Number.NaN;
  for (const day of space) {
    for (const kp of day.kp) if (Number.isFinite(kp) && kp > kpMax) kpMax = kp;
    if (Number.isFinite(day.Ap) && day.Ap > apMax) apMax = day.Ap;
    if (day.f107 !== null && Number.isFinite(day.f107)) f107 = day.f107;
  }
  const ap = apFactor(apMax, params);
  return { kpMax, apMax, f107, stormHold: kpMax >= params.stormKp, priorFactor: fluxFactor(f107, params) * ap, dragFactor: ap };
}
