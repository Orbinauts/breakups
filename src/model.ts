import type { DetectorParameters } from "./params.ts";

/**
 * The local model of one orbital quantity over an object's trailing sets:
 * a polynomial in time, fitted by iteratively reweighted least squares
 * with Huber weights so one bad set does not bend it, and evaluated ahead
 * of the window with the leverage of the extrapolation, which is what
 * makes a prediction a day past a week of sets more certain than one past
 * a single set. Everything is in the caller's units (kilometres of
 * semi-major axis or perigee radius, degrees of inclination) over time in
 * days from the window's last set, so the coefficients read as a level, a
 * rate per day and half an acceleration per day squared.
 *
 * The degree follows the window: quadratic when it has enough sets over
 * enough days for a curvature to be more than noise (drag bends the
 * semi-major axis downward, and faster as the orbit lowers), linear with
 * fewer, and with too few sets to fit anything the last set's own drag
 * rate from its first derivative of the mean motion is extrapolated, the
 * one case where the set's own prediction is trusted.
 */

const DAY_MS = 86_400_000;

/** The least scale a fit's residuals are given, in the quantity's units: a window of identical values is not a window of no noise. */
const SCALE_FLOOR = 1e-6;

export interface Fit {
  /** The polynomial's degree, one less than its coefficients: 1 for the fallback, a line through the window's last set whose slope is that set's drag rate, not fitted. */
  degree: number;
  /** Coefficients in powers of the time in days from `t0`. */
  coef: number[];
  /** The reference time, the window's last epoch, in milliseconds since 1970. */
  t0: number;
  /** The robust scale of the fit's residuals, in the quantity's units, where the fit was asked for it (`withScale`); zero for the fallback, which leaves no residuals; NaN, not measured, where it was not asked. */
  scale: number;
  /** How many sets the window held and how many days they spanned. */
  n: number;
  spanDays: number;
  /** The inverse of the weighted normal matrix, row-major, for the leverage of a prediction; null for the fallback. */
  inverse: number[] | null;
  /** Whether the fallback was taken: the slope is the set's own drag rate, not fitted. */
  fallback: boolean;
}

/** The orbit's own drag rate from a set, in kilometres of semi-major axis per day, by Kepler's third law: `da/dt = -(2/3)(a/n) dn/dt`, where the set prints half of `dn/dt`. */
export function dragRateKmPerDay(aKm: number, meanMotion: number, meanMotionDot: number): number {
  return -(2 / 3) * (aKm / meanMotion) * (2 * meanMotionDot);
}

/** A scratch buffer for the medians: the arrays are at most a ring long, and a typed array sorts numerically without a comparator, which is what keeps a median cheap. */
let scratch = new Float64Array(64);

/** Up to this many values are sorted by insertion, which beats a general sort's overhead on a ring's worth; a band's residuals, in the hundreds, take the native sort. */
const INSERTION_SORT_MAX = 48;

/** The median of the first `n` entries of the buffer, sorted in place. */
function medianOf(buffer: Float64Array, n: number): number {
  if (n > INSERTION_SORT_MAX) buffer.subarray(0, n).sort();
  else for (let i = 1; i < n; i++) {
    const v = buffer[i]!;
    let j = i - 1;
    while (j >= 0 && buffer[j]! > v) {
      buffer[j + 1] = buffer[j]!;
      j--;
    }
    buffer[j + 1] = v;
  }
  const mid = n >> 1;
  return n % 2 === 1 ? buffer[mid]! : (buffer[mid - 1]! + buffer[mid]!) / 2;
}

/** The median of the values; zero for none. */
export function median(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  if (scratch.length < n) scratch = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) scratch[i] = values[i]!;
  return medianOf(scratch, n);
}

/** The median absolute deviation scaled to a Gaussian sigma: 1.4826 times the median distance from the median. */
export function robustScale(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const centre = median(values);
  for (let i = 0; i < n; i++) scratch[i] = Math.abs(values[i]! - centre);
  return 1.4826 * medianOf(scratch, n);
}

/** The same over the first `n` entries of a typed array. */
export function robustScaleOf(values: Float64Array, n: number): number {
  if (n === 0) return 0;
  if (scratch.length < n) scratch = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) scratch[i] = values[i]!;
  const centre = medianOf(scratch, n);
  for (let i = 0; i < n; i++) scratch[i] = Math.abs(values[i]! - centre);
  return 1.4826 * medianOf(scratch, n);
}

/** The inverse of a small matrix, row-major: closed forms for one by one to three by three, elimination above; null where singular. */
export function invert(matrix: number[], size: number): number[] | null {
  if (size === 2) {
    const [a, b, c, d] = matrix as [number, number, number, number];
    const det = a * d - b * c;
    if (!(Math.abs(det) > 1e-300)) return null;
    return [d / det, -b / det, -c / det, a / det];
  }
  if (size === 3) {
    const [a, b, c, d, e, f, g, h, i] = matrix as [number, number, number, number, number, number, number, number, number];
    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (!(Math.abs(det) > 1e-300)) return null;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  }
  const m = matrix.slice();
  const inv = new Array<number>(size * size).fill(0);
  for (let i = 0; i < size; i++) inv[i * size + i] = 1;
  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let row = col + 1; row < size; row++) if (Math.abs(m[row * size + col]!) > Math.abs(m[pivot * size + col]!)) pivot = row;
    const p = m[pivot * size + col]!;
    if (!(Math.abs(p) > 1e-300)) return null;
    if (pivot !== col) {
      for (let k = 0; k < size; k++) {
        [m[col * size + k], m[pivot * size + k]] = [m[pivot * size + k]!, m[col * size + k]!];
        [inv[col * size + k], inv[pivot * size + k]] = [inv[pivot * size + k]!, inv[col * size + k]!];
      }
    }
    for (let k = 0; k < size; k++) {
      m[col * size + k]! /= p;
      inv[col * size + k]! /= p;
    }
    for (let row = 0; row < size; row++) {
      if (row === col) continue;
      const f = m[row * size + col]!;
      if (f === 0) continue;
      for (let k = 0; k < size; k++) {
        m[row * size + k]! -= f * m[col * size + k]!;
        inv[row * size + k]! -= f * inv[col * size + k]!;
      }
    }
  }
  return inv;
}

/** The value of the polynomial at a time in days from its reference. */
export function polynomialAt(coef: number[], xDays: number): number {
  let v = 0;
  for (let i = coef.length - 1; i >= 0; i--) v = v * xDays + coef[i]!;
  return v;
}

/** The polynomial's slope at a time in days from its reference, in units per day. */
export function slopeAt(coef: number[], xDays: number): number {
  let v = 0;
  for (let i = coef.length - 1; i >= 1; i--) v = v * xDays + i * coef[i]!;
  return v;
}

/** What the fallback needs of the window's last set: its value, mean motion and the printed half-derivative. */
export interface FallbackSource {
  meanMotion: number;
  meanMotionDot: number;
}

/**
 * The robust polynomial over the window `[from, to)` of the arrays, the
 * epochs in milliseconds since 1970 and ascending. The degree is chosen
 * by the window's size and span against the parameters; `rate` gives the
 * fallback its slope, in the quantity's units per day, where the window is
 * too small to fit (for the semi-major axis, the set's drag rate; for a
 * quantity drag does not move, zero). The residuals' scale is computed
 * where the next pass needs it for its weights, and at the end only when
 * `withScale` asks, since the hot path (one prediction per set) reads the
 * coefficients and the leverage alone.
 */
export function fitWindow(epochs: number[], values: number[], from: number, to: number, params: DetectorParameters, rate: number, withScale = false): Fit {
  const n = to - from;
  const t0 = epochs[to - 1]!;
  const spanDays = n > 0 ? (t0 - epochs[from]!) / DAY_MS : 0;
  const fallbackScale = withScale ? 0 : Number.NaN;
  if (n < params.linearMinSets) {
    return { degree: 1, coef: [values[to - 1]!, rate], t0, scale: fallbackScale, n, spanDays, inverse: null, fallback: true };
  }
  const degree = n >= params.quadraticMinSets && spanDays >= params.quadraticMinDays ? 2 : 1;
  const p = degree + 1;
  const x = new Float64Array(n);
  const w = new Float64Array(n).fill(1);
  const residuals = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = (epochs[from + i]! - t0) / DAY_MS;
  let coef = new Array<number>(p).fill(0);
  let inverse: number[] | null = null;
  let scale = 0;
  const reweighting = n > p + 1;
  // Three passes: a plain least squares, then two reweighted by Huber's rule on the residuals' robust scale.
  for (let pass = 0; pass < 3; pass++) {
    // The weighted power sums the normal equations are built from, up to the fourth power for a quadratic.
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    let s4 = 0;
    let y0 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < n; i++) {
      const wi = w[i]!;
      const xi = x[i]!;
      const xx = xi * xi;
      const y = values[from + i]!;
      s0 += wi;
      s1 += wi * xi;
      s2 += wi * xx;
      y0 += wi * y;
      y1 += wi * xi * y;
      if (degree === 2) {
        s3 += wi * xx * xi;
        s4 += wi * xx * xx;
        y2 += wi * xx * y;
      }
    }
    const normal = degree === 2 ? [s0, s1, s2, s1, s2, s3, s2, s3, s4] : [s0, s1, s1, s2];
    const rhs = degree === 2 ? [y0, y1, y2] : [y0, y1];
    inverse = invert(normal, p);
    if (inverse === null) {
      // A degenerate window (every set at one epoch): fall back to the linear fit, or to the level alone.
      if (degree === 2) return fitWindow(epochs, values, from, to, { ...params, quadraticMinSets: Number.POSITIVE_INFINITY }, rate, withScale);
      return { degree: 1, coef: [values[to - 1]!, rate], t0, scale: fallbackScale, n, spanDays, inverse: null, fallback: true };
    }
    const next = new Array<number>(p).fill(0);
    for (let r = 0; r < p; r++) for (let c = 0; c < p; c++) next[r]! += inverse[r * p + c]! * rhs[c]!;
    coef = next;
    const last = pass === 2 || !reweighting;
    if (last && !withScale) break;
    for (let i = 0; i < n; i++) residuals[i] = values[from + i]! - polynomialAt(coef, x[i]!);
    scale = Math.max(SCALE_FLOOR, robustScaleOf(residuals, n));
    if (last) break;
    const cut = params.huberConstant * scale;
    let changed = false;
    for (let i = 0; i < n; i++) {
      const r = Math.abs(residuals[i]!);
      const wi = r <= cut ? 1 : cut / r;
      if (wi !== w[i]) changed = true;
      w[i] = wi;
    }
    // Every set within the cut: the next pass would repeat this one.
    if (!changed) break;
  }
  return { degree, coef, t0, scale: withScale ? scale : Number.NaN, n, spanDays, inverse, fallback: false };
}

export interface Prediction {
  value: number;
  /** The leverage of the point: the factor over the window's scatter the prediction's own variance carries, `x (XᵀWX)⁻¹ xᵀ`; for the fallback, one plus the square of the gap in days, so a far extrapolation of one set's rate is held cheap. */
  leverage: number;
  /** The gap from the window's last set, in days. */
  gapDays: number;
}

/** The model's value and leverage at an epoch, usually past the window's end. */
export function predictAt(fit: Fit, epochMs: number): Prediction {
  const gapDays = (epochMs - fit.t0) / DAY_MS;
  const value = polynomialAt(fit.coef, gapDays);
  if (fit.inverse === null) return { value, leverage: 1 + gapDays * gapDays, gapDays };
  const p = fit.degree + 1;
  const powers = [1, gapDays, gapDays * gapDays];
  let leverage = 0;
  for (let r = 0; r < p; r++) for (let c = 0; c < p; c++) leverage += powers[r]! * fit.inverse[r * p + c]! * powers[c]!;
  return { value, leverage: Math.max(0, leverage), gapDays };
}

/**
 * The standard deviation of a prediction: the object's own scatter grown
 * by the leverage, plus the drag the model may have mispredicted over the
 * gap, in quadrature. `kappa` is in the quantity's units per day per unit
 * of B*, `weather` the factor a disturbed day multiplies the drag term by.
 */
export function predictionSigma(sigmaOwn: number, leverage: number, gapDays: number, bstar: number, kappa: number, weather: number): number {
  const drag = kappa * Math.abs(bstar) * Math.max(0, gapDays) * weather;
  return Math.sqrt(sigmaOwn * sigmaOwn * (1 + leverage) + drag * drag);
}
