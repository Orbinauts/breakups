import type { DetectorParameters } from "./params.ts";

/**
 * Orbit maintenance, read from where the object has been. A working
 * satellite in low orbit loses altitude to drag for weeks or months and
 * then raises itself back to the altitude it holds; a satellite moved up
 * for a season comes back down to where it flew before. Either way the
 * step's new level is one the object held within the last year. A breakup
 * kick lands anywhere: the parent's new orbit is set by the fragment's
 * momentum, not by where it used to fly. So the detector keeps, on every
 * object, a compact envelope of its mean altitude (the semi-major axis, in
 * kilometres) over the last twelve months, the lowest and highest value
 * seen in each calendar month, and reads a persistent step against it: an
 * object that had drifted below the highest altitude it held in the
 * window by more than a tolerance, and whose raise brings it back to
 * within the tolerance of that altitude, has returned to a held altitude,
 * which is what maintenance looks like and what a breakup rarely does (a
 * lowering back to the lowest it held, likewise). The gap matters as much
 * as the landing: a breakup's small step on an object that flew where it
 * always flew lands inside its own range without returning anywhere. The
 * tolerance is the larger of a few times the object's own scatter and a
 * floor in kilometres, both parameters fitted on the training split.
 *
 * The envelope is frozen on the candidate when it opens, before the first
 * post set is noted, so the post-step level is never judged against
 * itself. Twelve pairs of numbers an object, in the state.
 */

/** How many calendar months the envelope keeps. Policy: a year, long enough for a seasonal raise-and-return and for a slow drift down to its make-up raise. */
export const ENVELOPE_MONTHS = 12;

/** The envelope as the state keeps it: per bin the month it stands for (years since 1970 times twelve plus the month), and the lowest and highest semi-major axis seen in it, in kilometres. A bin that stands for no month holds negative infinity as its month. */
export interface AltitudeEnvelope {
  month: number[];
  min: number[];
  max: number[];
}

export function newEnvelope(): AltitudeEnvelope {
  return { month: new Array<number>(ENVELOPE_MONTHS).fill(Number.NEGATIVE_INFINITY), min: new Array<number>(ENVELOPE_MONTHS).fill(Number.POSITIVE_INFINITY), max: new Array<number>(ENVELOPE_MONTHS).fill(Number.NEGATIVE_INFINITY) };
}

/** The calendar month of an instant as the envelope counts them. */
export function monthOf(epochMs: number): number {
  const date = new Date(epochMs);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

const binOf = (month: number): number => ((month % ENVELOPE_MONTHS) + ENVELOPE_MONTHS) % ENVELOPE_MONTHS;

/** Notes a set's semi-major axis in the month bin of its epoch, starting the bin afresh when it stood for an older month. */
export function noteLevel(envelope: AltitudeEnvelope, aKm: number, epochMs: number): void {
  const month = monthOf(epochMs);
  const bin = binOf(month);
  if (envelope.month[bin] !== month) {
    // A set older than the month the bin stands for is not noted: the bin belongs to the newer month.
    if (envelope.month[bin]! > month) return;
    envelope.month[bin] = month;
    envelope.min[bin] = aKm;
    envelope.max[bin] = aKm;
    return;
  }
  if (aKm < envelope.min[bin]!) envelope.min[bin] = aKm;
  if (aKm > envelope.max[bin]!) envelope.max[bin] = aKm;
}

/** A copy of the envelope, for a candidate to freeze at its opening. */
export function snapshotEnvelope(envelope: AltitudeEnvelope): AltitudeEnvelope {
  return { month: [...envelope.month], min: [...envelope.min], max: [...envelope.max] };
}

/** What the envelope says of a step: the highest and lowest semi-major axis held over the window before it, in kilometres, how far the pre-step level had drifted below the top (`topKm`, the highest less the pre-step level) and above the bottom (`bottomKm`), how many months of the window had sets, and how many months ago the top and the bottom were held. With no month in the window the extremes are NaN and the months zero. */
export interface HeldLevel {
  topKm: number;
  bottomKm: number;
  months: number;
  topMonthsAgo: number;
  bottomMonthsAgo: number;
}

/**
 * Where a pre-step level stands in the altitudes the object held over the
 * window of months ending at the instant's month: how far below the
 * highest it had drifted and how far above the lowest. A return to a held
 * altitude is a raise that closes the first gap or a lowering that closes
 * the second.
 */
export function heldLevel(envelope: AltitudeEnvelope, preKm: number, epochMs: number, windowMonths = ENVELOPE_MONTHS): HeldLevel {
  const current = monthOf(epochMs);
  let top = Number.NEGATIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  let topMonthsAgo = Number.NaN;
  let bottomMonthsAgo = Number.NaN;
  let months = 0;
  for (let bin = 0; bin < ENVELOPE_MONTHS; bin++) {
    const month = envelope.month[bin]!;
    if (!Number.isFinite(month) || month > current || current - month >= windowMonths) continue;
    months++;
    if (envelope.max[bin]! > top) [top, topMonthsAgo] = [envelope.max[bin]!, current - month];
    if (envelope.min[bin]! < bottom) [bottom, bottomMonthsAgo] = [envelope.min[bin]!, current - month];
  }
  if (months === 0) return { topKm: Number.NaN, bottomKm: Number.NaN, months: 0, topMonthsAgo: Number.NaN, bottomMonthsAgo: Number.NaN };
  return { topKm: top - preKm, bottomKm: preKm - bottom, months, topMonthsAgo, bottomMonthsAgo };
}

/** The tolerance a returned level may miss a held extreme by, in kilometres: the larger of the parameter's multiple of the object's own scatter and the parameter's floor. */
export function maintenanceToleranceKm(sigmaOwnKm: number, params: DetectorParameters): number {
  return Math.max(params.maintenanceToleranceSigmas * sigmaOwnKm, params.maintenanceToleranceKm);
}

/** How far the post-step level misses the held extreme the step went towards (the top for a raise, the bottom for a lowering), in kilometres. */
export function returnMissKm(held: HeldLevel, deltaKm: number): number {
  return deltaKm >= 0 ? Math.abs(held.topKm - deltaKm) : Math.abs(held.bottomKm + deltaKm);
}

/**
 * Whether a step is a return to a held altitude: the object had drifted
 * from the extreme of what it held by more than the tolerance (below its
 * top for a raise, above its bottom for a lowering, where the parameter
 * reads lowerings), and the step brings it back to within the tolerance
 * of that extreme. A small step on an object that stayed where it flew is
 * not one: it closed no gap. A negative floor turns the test off.
 */
export function isMaintenance(held: HeldLevel, deltaKm: number, sigmaOwnKm: number, params: DetectorParameters): boolean {
  if (held.months === 0 || params.maintenanceToleranceKm < 0) return false;
  if (deltaKm < 0 && !params.maintenanceLoweringsToo) return false;
  const tolerance = maintenanceToleranceKm(sigmaOwnKm, params);
  const gap = deltaKm >= 0 ? held.topKm : held.bottomKm;
  return gap > tolerance && returnMissKm(held, deltaKm) <= tolerance;
}
