import { isWorkingStatus, type OpsStatus } from "./elements.ts";
import type { BodyClass, Regime } from "./truth.ts";

/**
 * The scope: which objects the detector's scoped line speaks for, and how
 * strict the scoped line is with a step on them. The whole-catalogue line
 * raises every persistent step no manoeuvre explains, on every object in
 * every orbit, and on the held-out years nearly every one of those alerts
 * is a false alarm. The scope narrows the population to the objects where
 * the parent's own step can separate a breakup from everything else (no
 * manoeuvres to mistake it for, an orbit the catalogue tracks closely),
 * and the gates ask the step to be large and clean enough to stand out
 * from what is left. A scope is a predicate on the parent at the time of
 * the step, applied alike to the reported events (the targets the scoped
 * line is scored on) and to the alerts (the ones it raises), so its
 * detection rate and its false-alarm rate are measured on one population,
 * and the share of reported events it leaves out is stated beside them.
 * Every bound is a plain number or a null, so the policy is written into
 * the scorecard's record of the parameters as it is.
 *
 * The predicate reads what is known of the object at the step and nothing
 * after it: its class (the catalogue's, which barely changes), its
 * operational status as of the step (`operationalAt` in `elements.ts`,
 * dated where an end of contact is), its orbit (regime, perigee height
 * and drag term from its sets before the step), its age from launch, and
 * its record of persistent steps in the year or two before. Each bound is
 * a field of `ScopePolicy`; a field at its open value (an empty list, a
 * zero, an infinity) reads nothing. The values the scorecard runs with are
 * `DETECTOR_PARAMETERS.scope`, chosen on the training years in
 * `docs/detector/d7-scope.md`.
 */

/** The parent of a step, or of a reported event, at its time: what the scope reads. */
export interface ScopeSubject {
  bodyClass: BodyClass;
  /** The operational status at the step, as `operationalAt` reads it. */
  status: OpsStatus;
  regime: Regime;
  /** The perigee height of the last set before the step, in kilometres. */
  perigeeKm: number;
  /** The drag term of the sets before the step, in inverse Earth radii. */
  bstar: number;
  /** Days from the launch to the step; NaN where the launch is not known. */
  ageDays: number;
  /** Days from the object's last persistent step before this one; infinite where it has none on record. */
  daysSinceStep: number;
}

export interface ScopePolicy {
  /** The classes in scope; empty reads every class. */
  classes: BodyClass[];
  /** Whether a payload is in scope only when it was not working at the step: nonoperational as of the step, or (with `unknownPayloads`) of unknown status. */
  payloadsNotWorking: boolean;
  /** With `payloadsNotWorking`, whether a payload whose status at the step is unknown is in scope (true) or only one read nonoperational (false). */
  unknownPayloads: boolean;
  /** The regimes in scope; empty reads every regime. */
  regimes: Regime[];
  /** The perigee height bounds, in kilometres; null reads no bound. */
  perigeeMinKm: number | null;
  perigeeMaxKm: number | null;
  /** The least age from launch, in days; zero reads none. An object of unknown launch is in scope only with no bound. */
  minAgeDays: number;
  /** The days before the step in which the object must have made no persistent step; zero reads none. */
  quietDays: number;
  /** The largest drag term in scope, in inverse Earth radii, by magnitude; null reads none. */
  bstarMax: number | null;
}

/** The scope that reads nothing: every object, every orbit. */
export const WHOLE_CATALOGUE: ScopePolicy = { classes: [], payloadsNotWorking: false, unknownPayloads: false, regimes: [], perigeeMinKm: null, perigeeMaxKm: null, minAgeDays: 0, quietDays: 0, bstarMax: null };

/** Whether the parent at the step is in the scope. */
export function inScope(subject: ScopeSubject, scope: ScopePolicy): boolean {
  if (scope.classes.length > 0 && !scope.classes.includes(subject.bodyClass)) return false;
  if (scope.payloadsNotWorking && subject.bodyClass === "payload") {
    if (isWorkingStatus(subject.status)) return false;
    if (subject.status !== "nonoperational" && !scope.unknownPayloads) return false;
  }
  if (scope.regimes.length > 0 && !scope.regimes.includes(subject.regime)) return false;
  // A perigee or a drag term the caller could not read is out of a bounded scope and in an open one.
  if (scope.perigeeMinKm !== null && !(subject.perigeeKm >= scope.perigeeMinKm)) return false;
  if (scope.perigeeMaxKm !== null && !(subject.perigeeKm <= scope.perigeeMaxKm)) return false;
  if (scope.minAgeDays > 0 && !(subject.ageDays >= scope.minAgeDays)) return false;
  if (scope.quietDays > 0 && subject.daysSinceStep < scope.quietDays) return false;
  if (scope.bstarMax !== null && !(Math.abs(subject.bstar) <= scope.bstarMax)) return false;
  return true;
}

/**
 * The scoped line's gates on a raised step, beyond the whole-catalogue
 * line's: the step's size in units of its own sigma at the raising, its
 * size in kilometres of semi-major axis, the tangential impulse it
 * implies, the drag term's change across it (folded above one: a
 * fragment's loss of mass or a changed shape moves the drag term either
 * way), the part of the eccentricity change one tangential impulse cannot
 * explain (a kick's radial part), and whether a step any manoeuvre explanation applied to (and a
 * breakup signature overrode) may be raised in scope at all. A gate at
 * its open value reads nothing.
 */
export interface ScopeGates {
  zMin: number;
  deltaMinKm: number;
  deltaVMinMps: number;
  bstarRatioMin: number;
  /** The least chi-squared of the eccentricity change beyond what one tangential impulse explains: a breakup's kick has a radial part a burn along the track has not. Zero reads none. */
  consistencyMin: number;
  /** Whether only a step no manoeuvre explanation applied to is raised in scope (true), or any step the whole-catalogue line raised (false). */
  unexplainedOnly: boolean;
}

export const OPEN_GATES: ScopeGates = { zMin: 0, deltaMinKm: 0, deltaVMinMps: 0, bstarRatioMin: 0, consistencyMin: 0, unexplainedOnly: false };

/**
 * How long the scoped line waits before it raises a step the whole-catalogue
 * line raised: at once, after the third or fifth post set, or after one,
 * three, five or seven days of post sets, the step still holding then (the
 * alert's persistence tiers, `fusion.ts`).
 */
export const SCOPE_TIERS = ["raised", "3", "5", "D1", "D3", "D5", "D7"] as const;
export type ScopeTier = (typeof SCOPE_TIERS)[number];

/** The scoped line's whole policy: the population, the gates and the wait. */
export interface ScopeParameters {
  policy: ScopePolicy;
  gates: ScopeGates;
  tier: ScopeTier;
}

/** What the gates read of a raised step: its verdict's evidence, by the log's names. */
export interface GatedStep {
  zk: number;
  deltaKm: number;
  deltaVMps: number;
  bstarRatio: number;
  impulseConsistency: number;
  explanations: number;
}

/** The drag term's ratio across a step folded above one; NaN where it was not read (no drag term). */
export const foldedRatio = (ratio: number): number => (!Number.isFinite(ratio) || ratio <= 0 ? Number.NaN : ratio < 1 ? 1 / ratio : ratio);

/** Whether a raised step passes the scoped gates. A step whose drag term was not read (a geosynchronous object's) passes the drag gate untested. */
export function passesGates(step: GatedStep, gates: ScopeGates): boolean {
  if (Math.abs(step.zk) < gates.zMin) return false;
  if (Math.abs(step.deltaKm) < gates.deltaMinKm) return false;
  if (gates.deltaVMinMps > 0 && !(Math.abs(step.deltaVMps) >= gates.deltaVMinMps)) return false;
  const ratio = foldedRatio(step.bstarRatio);
  if (gates.bstarRatioMin > 1 && Number.isFinite(ratio) && ratio < gates.bstarRatioMin) return false;
  if (gates.consistencyMin > 0 && !(step.impulseConsistency >= gates.consistencyMin)) return false;
  if (gates.unexplainedOnly && step.explanations > 0) return false;
  return true;
}
