import { median, predictAt, predictionSigma, type Fit } from "./model.ts";
import type { DetectorParameters } from "./params.ts";
import { SIGMA_FLOOR_DEG, SIGMA_FLOOR_KM, firstAfter, indexOfEpoch, type Candidate, type SeriesState } from "./series.ts";
import { DAY_MS, HOUR_MS } from "./units.ts";

/**
 * The two-segment step estimator: the pre-step model is frozen when the
 * candidate opens, and every post set is read as a residual from it;
 * those residuals are then fitted as a level plus a slope in time, the
 * level being the step as it stood at the first post set. The slope is
 * free because a parent's new orbit decays at a new rate once its area
 * and mass have changed, and a day-old stage keeps settling after its
 * jump, so the residuals after a true step need not be flat; but it is
 * held by a prior no wider than the noise and the drag allow per day, so
 * two sets a few hours apart cannot explain a step away as a steep line.
 * The level's uncertainty comes from the weighted fit, and every
 * residual's sigma grows with its gap from the pre window, since the
 * pre model's extrapolation worsens with time.
 *
 * Three things then say whether the step is one. The later sets' median
 * residual over the first set's jump: near one for a step, near zero for
 * a bad set the next sets undo, which dismisses it; above one where the
 * catalogue's fit converged on the new orbit over a few sets and the
 * first post set carried only part of the jump, which the band allows
 * for. The evidence for a step against a drift: a drag rate the model
 * mispredicted grows from nothing at the step's instant at a rate drag
 * can produce, so a line through the instant with no level and a slope
 * within the drag prior fits it as well as the step model does; a true
 * step, or a ramp far steeper than drag allows, leaves that line far from
 * the sets or costs it a slope the prior forbids. The difference of the
 * two fits' weighted squares is the evidence. And the level in units of
 * its uncertainty, the persistent step's size.
 */

export interface StepEstimate {
  /** How many post sets were read, and the hours from the first to the last. */
  k: number;
  spanHours: number;
  /** The fitted step at the first post set, in kilometres of semi-major axis, its sigma, and the step in units of it. */
  delta: number;
  sigmaDelta: number;
  z: number;
  /** The fitted line's value at the centroid of the post sets, the weighted mean step, in kilometres, its sigma and its normalised size: where a line fit is best determined, and what a step the catalogue's fit converged on over several sets reads as when its first post set carried only part of it. */
  mean: number;
  sigmaMean: number;
  zMean: number;
  /** The fitted post-step slope, in kilometres per day. */
  slope: number;
  /** The fitted step over the first set's jump, and the median of the later sets' plain residuals over the first set's; the latter is NaN with one set. */
  rho: number;
  rhoMedian: number;
  /** The weighted squares of the step-and-slope fit and of the drift from the step's instant; their difference is the evidence for a step. */
  chi2Step: number;
  chi2Drift: number;
  evidence: number;
  /** The weighted mean post residual of the perigee radius, in kilometres, and of the inclination, in degrees, with their normalised sizes. */
  deltaPerigee: number;
  zPerigee: number;
  deltaInclination: number;
  zInclination: number;
  /** The epoch of the last post set read. */
  lastEpoch: number;
}

/** What the run's environment lends the estimate: the band's common-mode drag term (kilometres per day per unit of B*), its scale, and the weather's factor on the drag term. */
export interface Environment {
  commonMode: number;
  scale: number;
  weather: number;
}

export interface SegmentFit {
  delta: number;
  slope: number;
  sigmaDelta: number;
  /** The line's value at the weighted centroid of the times and its sigma. */
  mean: number;
  sigmaMean: number;
  chi2: number;
}

/**
 * The level-and-slope fit of post residuals `u` at times `x` (days from
 * the first post set) with sigmas, the slope under a Gaussian prior of
 * width `slopePrior` per day. With one set the level is the residual and
 * the slope zero.
 */
export function fitSegment(x: number[], u: number[], sigma: number[], slopePrior: number): SegmentFit {
  const k = x.length;
  if (k === 1) return { delta: u[0]!, slope: 0, sigmaDelta: sigma[0]!, mean: u[0]!, sigmaMean: sigma[0]!, chi2: 0 };
  let sw = 0;
  let swx = 0;
  let swxx = 0;
  let swu = 0;
  let swxu = 0;
  for (let i = 0; i < k; i++) {
    const w = 1 / (sigma[i]! * sigma[i]!);
    sw += w;
    swx += w * x[i]!;
    swxx += w * x[i]! * x[i]!;
    swu += w * u[i]!;
    swxu += w * x[i]! * u[i]!;
  }
  const ridge = 1 / (slopePrior * slopePrior);
  const det = sw * (swxx + ridge) - swx * swx;
  const delta = ((swxx + ridge) * swu - swx * swxu) / det;
  const slope = (sw * swxu - swx * swu) / det;
  const sigmaDelta = Math.sqrt((swxx + ridge) / det);
  const centroid = swx / sw;
  const sigmaMean = Math.sqrt(Math.max(0, (swxx + ridge - 2 * centroid * swx + centroid * centroid * sw) / det));
  let chi2 = slope * slope * ridge;
  for (let i = 0; i < k; i++) chi2 += (u[i]! - delta - slope * x[i]!) ** 2 / (sigma[i]! * sigma[i]!);
  return { delta, slope, sigmaDelta, mean: delta + slope * centroid, sigmaMean, chi2 };
}

/** The weighted squares of a drift through the origin, `u = b x`, the slope under a Gaussian prior of width `slopePrior`: what a mispredicted rate growing from the step's instant, at a rate drag and noise allow, leaves. */
export function driftChi2(x: number[], u: number[], sigma: number[], slopePrior: number): number {
  let swxx = 0;
  let swxu = 0;
  for (let i = 0; i < x.length; i++) {
    const w = 1 / (sigma[i]! * sigma[i]!);
    swxx += w * x[i]! * x[i]!;
    swxu += w * x[i]! * u[i]!;
  }
  const ridge = 1 / (slopePrior * slopePrior);
  const b = swxu / (swxx + ridge);
  let chi2 = b * b * ridge;
  for (let i = 0; i < x.length; i++) chi2 += (u[i]! - b * x[i]!) ** 2 / (sigma[i]! * sigma[i]!);
  return chi2;
}

/** The post sets of a candidate: the ring indices from the bracket's second edge (the set that opened it; failing that, the first after the first edge), at most `maxPostSets` (the parameter's many by default; an open alert reads more). An older set slotted in between the edges later is neither pre nor post. */
export function postIndices(state: SeriesState, candidate: Candidate, params: DetectorParameters, maxPostSets = params.maxPostSets): number[] {
  const opener = indexOfEpoch(state, candidate.afterEpoch);
  const first = opener === -1 ? firstAfter(state, candidate.beforeEpoch) : opener;
  if (first === -1) return [];
  const indices: number[] = [];
  for (let i = first; i < state.epochs.length && indices.length < maxPostSets; i++) indices.push(i);
  return indices;
}

/** A quantity's post residuals against its frozen pre fit, with the sigma of each prediction and the epochs. */
function residualsAgainst(state: SeriesState, values: number[], fit: Fit, indices: number[], sigmaOwn: number, kappa: number, bstar: number, commonMode: number, weather: number): { u: number[]; sigma: number[]; epochs: number[] } {
  const u: number[] = [];
  const sigma: number[] = [];
  const epochs: number[] = [];
  for (const i of indices) {
    const prediction = predictAt(fit, state.epochs[i]!);
    u.push(values[i]! - prediction.value - commonMode * bstar * prediction.gapDays);
    sigma.push(predictionSigma(sigmaOwn, prediction.leverage, prediction.gapDays, bstar, kappa, weather));
    epochs.push(state.epochs[i]!);
  }
  return { u, sigma, epochs };
}

/** The weighted mean of residuals and its normalised size. */
function weightedMean(u: number[], sigma: number[]): { mean: number; z: number } {
  let sw = 0;
  let swu = 0;
  for (let i = 0; i < u.length; i++) {
    const w = 1 / (sigma[i]! * sigma[i]!);
    sw += w;
    swu += w * u[i]!;
  }
  const mean = swu / sw;
  return { mean, z: mean * Math.sqrt(sw) };
}

/** What a quantity other than the semi-major axis is read with against its frozen fit: its scatter (the floor, the fit's own scale and, for the perigee radius, the semi-major axis's scatter), grown by `inflation`; the drag term's rate (the regime's for the perigee radius, none for the inclination) and the weather's factor on it. */
export function axisReading(axis: "rp" | "inc", fit: Fit, sigmaOwn: number, kappa: number, weather: number, inflation = 1): { sigmaOwn: number; kappa: number; weather: number } {
  return axis === "rp" ? { sigmaOwn: Math.max(SIGMA_FLOOR_KM, fit.scale, sigmaOwn) * inflation, kappa, weather } : { sigmaOwn: Math.max(SIGMA_FLOOR_DEG, fit.scale) * inflation, kappa: 0, weather: 1 };
}

/**
 * How much a trailing fit's own scale under-reads the scatter of the next
 * set: the semi-major axis's measured one-step-ahead scatter over its
 * fit's scale, at least one. The perigee radius's and the inclination's
 * one-step-ahead scatter is not measured, so the three-axis trigger grows
 * their fits' scales by the semi-major axis's factor: the same window and
 * the same fit under-read the next set alike.
 */
export function scaleInflation(sigmaOwn: number, aFit: Fit): number {
  return Math.max(1, sigmaOwn / Math.max(SIGMA_FLOOR_KM, aFit.scale));
}

type Level = Pick<StepEstimate, "k" | "spanHours" | "delta" | "sigmaDelta" | "z" | "mean" | "sigmaMean" | "zMean" | "slope" | "rho" | "rhoMedian" | "chi2Step" | "chi2Drift" | "evidence" | "lastEpoch">;

/** The step's level and slope, the later sets' ratio to the first jump and the evidence against a drift, from one quantity's post residuals, in that quantity's units. */
function levelOf(residuals: { u: number[]; sigma: number[]; epochs: number[] }, candidate: Candidate, sigmaOwn: number, kappa: number, weather: number, jump: number, scale: number, params: DetectorParameters): Level {
  const { u, sigma, epochs } = residuals;
  const xLevel = epochs.map((t) => (t - candidate.afterEpoch) / DAY_MS);
  const xDrift = epochs.map((t) => (t - candidate.tStep) / DAY_MS);
  // What drag and noise can do to the slope in a day; the step's own slope may also settle at the jump's scale a day.
  const driftPrior = (params.slopePriorSigmas * sigmaOwn + kappa * Math.abs(candidate.bstar)) * weather;
  const fit = fitSegment(xLevel, u, sigma, driftPrior + Math.abs(jump));
  const chi2Drift = driftChi2(xDrift, u, sigma, driftPrior);
  const k = epochs.length;
  const spanHours = (epochs[k - 1]! - epochs[0]!) / HOUR_MS;
  const delta1 = jump === 0 ? Number.NaN : jump;
  const rhoMedian = k >= 2 ? median(u.slice(1)) / delta1 : Number.NaN;
  return {
    k,
    spanHours,
    delta: fit.delta,
    sigmaDelta: fit.sigmaDelta * scale,
    z: fit.delta / (fit.sigmaDelta * scale),
    mean: fit.mean,
    sigmaMean: fit.sigmaMean * scale,
    zMean: fit.mean / (fit.sigmaMean * scale),
    slope: fit.slope,
    rho: fit.delta / delta1,
    rhoMedian,
    chi2Step: fit.chi2,
    chi2Drift,
    evidence: (chi2Drift - fit.chi2) / (scale * scale),
    lastEpoch: epochs[k - 1]!,
  };
}

/**
 * The step as the post sets so far measure it, against the candidate's
 * frozen pre fits, the band's common-mode term taken off each residual of
 * the semi-major axis in proportion to the object's drag term and the
 * gap, and the normalised step divided by the band's scale.
 */
export function estimateStep(state: SeriesState, candidate: Candidate, environment: Environment, params: DetectorParameters, maxPostSets = params.maxPostSets): StepEstimate | null {
  const indices = postIndices(state, candidate, params, maxPostSets);
  if (indices.length === 0) return null;
  const regime = state.regime === "unknown" ? "LEO" : state.regime;
  const kappa = params.kappa[regime];
  const bstar = candidate.bstar;
  const a = residualsAgainst(state, state.a, candidate.pre, indices, candidate.sigmaOwn, kappa, bstar, environment.commonMode, environment.weather);
  const level = levelOf(a, candidate, candidate.sigmaOwn, kappa, environment.weather, candidate.delta1, environment.scale, params);
  const rpReading = axisReading("rp", candidate.preRp, candidate.sigmaOwn, kappa, environment.weather);
  const incReading = axisReading("inc", candidate.preInc, candidate.sigmaOwn, kappa, environment.weather);
  const rp = residualsAgainst(state, state.rp, candidate.preRp, indices, rpReading.sigmaOwn, rpReading.kappa, bstar, 0, rpReading.weather);
  const inc = residualsAgainst(state, state.inc, candidate.preInc, indices, incReading.sigmaOwn, incReading.kappa, bstar, 0, incReading.weather);
  const perigee = weightedMean(rp.u, rp.sigma);
  const inclination = weightedMean(inc.u, inc.sigma);
  return {
    ...level,
    deltaPerigee: perigee.mean,
    zPerigee: perigee.z / environment.scale,
    deltaInclination: inclination.mean,
    zInclination: inclination.z / environment.scale,
  };
}

/**
 * The step its persistence is judged on: the semi-major axis's, as
 * `estimateStep` measures it, or, where the three-axis trigger opened the
 * candidate on the perigee radius or the inclination, the same level,
 * ratio and evidence read on that quantity against its frozen fit, in its
 * units. The perigee's and the inclination's means stay the estimate's.
 */
export function persistenceEstimate(state: SeriesState, candidate: Candidate, environment: Environment, params: DetectorParameters, maxPostSets = params.maxPostSets): StepEstimate | null {
  const estimate = estimateStep(state, candidate, environment, params, maxPostSets);
  const axis = candidate.axis;
  if (estimate === null || axis === undefined) return estimate;
  const indices = postIndices(state, candidate, params, maxPostSets);
  const kappa = params.kappa[state.regime === "unknown" ? "LEO" : state.regime];
  const fit = axis === "rp" ? candidate.preRp : candidate.preInc;
  const reading = axisReading(axis, fit, candidate.sigmaOwn, kappa, environment.weather, scaleInflation(candidate.sigmaOwn, candidate.pre));
  const residuals = residualsAgainst(state, axis === "rp" ? state.rp : state.inc, fit, indices, reading.sigmaOwn, reading.kappa, candidate.bstar, 0, reading.weather);
  return { ...estimate, ...levelOf(residuals, candidate, reading.sigmaOwn, reading.kappa, reading.weather, candidate.axisDelta1 ?? Number.NaN, environment.scale, params) };
}

/**
 * Advances the two-sided CUSUM of an object by a normalised residual,
 * with the drift allowance taken off each side, and says whether either
 * side crossed the threshold. `previousEpochMs` is the epoch of the set
 * before the one the residual belongs to: when both sides sat at zero
 * before this residual, it is kept as the last set before whatever the
 * CUSUM goes on to accumulate, the bracket's first edge if it alarms.
 */
export function advanceCusum(state: SeriesState, z: number, previousEpochMs: number, params: DetectorParameters): boolean {
  if (state.cusumPos === 0 && state.cusumNeg === 0) state.cusumFrom = previousEpochMs;
  state.cusumPos = Math.max(0, state.cusumPos + z - params.cusumDrift);
  state.cusumNeg = Math.max(0, state.cusumNeg - z - params.cusumDrift);
  return state.cusumPos > params.hCusum || state.cusumNeg > params.hCusum;
}

export function resetCusum(state: SeriesState, epochMs: number): void {
  state.cusumPos = 0;
  state.cusumNeg = 0;
  state.cusumFrom = epochMs;
}
