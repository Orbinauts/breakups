import type { BodyClass } from "./truth.ts";
import { median } from "./model.ts";
import type { DetectorParameters } from "./params.ts";
import { DAY_MS } from "./units.ts";

/**
 * The launch-mates. A constellation raises its satellites in campaigns:
 * sixty satellites of one launch climb from the insertion orbit in steps
 * of the same size and sign within days of each other, and a straggler
 * climbs later towards the altitude where its mates already fly. A
 * breakup is one object alone: no other body of its launch, and none in
 * its shell, steps the same way the same week. So the detector keeps a
 * catalogue-wide ledger of the persistent steps of the last weeks, every
 * object's, with the orbit each was made on, and reads a new step
 * against it twice: how many other objects of the same launch, and how
 * many of other launches in the same shell (the same inclination within a
 * tenth of a degree and a semi-major axis within a few tens of
 * kilometres), made a step of the same sign and of a size within a factor
 * of it in the window before. A step with enough such siblings is a
 * coordinated manoeuvre. And for a young object, where its launch-mates
 * fly: the median semi-major axis of the launch's other payloads as their
 * states hold it; a step that carries the object towards that altitude is
 * a deployment climb.
 *
 * The ledger is flat arrays in the catalogue-wide record, pruned by time
 * and bounded in size; a few thousand steps at most.
 */

/** How long a step stays in the ledger, in days: twice the sibling window, so a window read back from any instant is complete. Policy. */
export const LEDGER_DAYS = 28;
/** The most steps the ledger keeps, beyond which the oldest go: a busy month of the catalogue opens a few thousand persistent steps. Policy. */
export const LEDGER_MAX = 8192;

/** One persistent step as the ledger keeps it: whose, under which launch (as the log's launch code), when, on what orbit, and how far. */
export interface LedgerStep {
  number: number;
  launchCode: number;
  epochMs: number;
  aKm: number;
  inclinationDeg: number;
  deltaKm: number;
}

/** The ledger: one entry per persistent step of the last weeks, oldest first, as flat arrays. */
export interface StepLedger {
  number: number[];
  launchCode: number[];
  epochMs: number[];
  aKm: number[];
  inclinationDeg: number[];
  deltaKm: number[];
}

export function newLedger(): StepLedger {
  return { number: [], launchCode: [], epochMs: [], aKm: [], inclinationDeg: [], deltaKm: [] };
}

const columnsOf = (ledger: StepLedger): number[][] => [ledger.number, ledger.launchCode, ledger.epochMs, ledger.aKm, ledger.inclinationDeg, ledger.deltaKm];

/** Adds a step to the ledger in epoch order and prunes the ledger to its reach and size. */
export function noteLedgerStep(ledger: StepLedger, step: LedgerStep): void {
  let i = ledger.epochMs.length;
  while (i > 0 && ledger.epochMs[i - 1]! > step.epochMs) i--;
  ledger.number.splice(i, 0, step.number);
  ledger.launchCode.splice(i, 0, step.launchCode);
  ledger.epochMs.splice(i, 0, step.epochMs);
  ledger.aKm.splice(i, 0, step.aKm);
  ledger.inclinationDeg.splice(i, 0, step.inclinationDeg);
  ledger.deltaKm.splice(i, 0, step.deltaKm);
  const newest = ledger.epochMs[ledger.epochMs.length - 1]!;
  const oldest = newest - LEDGER_DAYS * DAY_MS;
  let drop = 0;
  while (drop < ledger.epochMs.length && ledger.epochMs[drop]! < oldest) drop++;
  if (ledger.epochMs.length - drop > LEDGER_MAX) drop = ledger.epochMs.length - LEDGER_MAX;
  if (drop > 0) for (const column of columnsOf(ledger)) column.splice(0, drop);
}

/** The siblings of a step: how many other objects of its launch, and how many of other launches in its shell, made a similar step in the window before it. */
export interface Siblings {
  launch: number;
  orbit: number;
}

/** Whether two steps are alike: the same sign, and sizes within the parameter's factor of each other. */
export function similarSteps(deltaKm: number, otherKm: number, params: DetectorParameters): boolean {
  if (Math.sign(deltaKm) !== Math.sign(otherKm) || deltaKm === 0) return false;
  const ratio = Math.abs(otherKm) / Math.abs(deltaKm);
  return ratio >= 1 / params.siblingSizeFactor && ratio <= params.siblingSizeFactor;
}

/**
 * The siblings of a step in the ledger: distinct other objects whose step
 * within the window before this one was alike, counted by launch (the
 * same launch code) and by shell (another launch, the inclination within
 * the parameter and the semi-major axis within the parameter). A
 * launch code of zero (an object with no launch) has no launch-mates.
 */
export function siblingsOf(ledger: StepLedger, step: LedgerStep, params: DetectorParameters): Siblings {
  const from = step.epochMs - params.siblingWindowDays * DAY_MS;
  const launchMates = new Set<number>();
  const orbitMates = new Set<number>();
  for (let i = ledger.epochMs.length - 1; i >= 0; i--) {
    const epoch = ledger.epochMs[i]!;
    if (epoch < from) break;
    if (epoch > step.epochMs) continue;
    const number = ledger.number[i]!;
    if (number === step.number || !similarSteps(step.deltaKm, ledger.deltaKm[i]!, params)) continue;
    if (step.launchCode !== 0 && ledger.launchCode[i] === step.launchCode) launchMates.add(number);
    else if (Math.abs(ledger.inclinationDeg[i]! - step.inclinationDeg) <= params.siblingOrbitInclinationDeg && Math.abs(ledger.aKm[i]! - step.aKm) <= params.siblingOrbitAltitudeKm) orbitMates.add(number);
  }
  return { launch: launchMates.size, orbit: orbitMates.size };
}

/** Where a launch's other payloads fly: how many there are with a known altitude, and the median of their semi-major axes in kilometres (NaN with none). */
export interface Mates {
  count: number;
  medianAKm: number;
}

/** The launch's payload-classed bodies other than the object, with the altitude each one's state gives (null where it has none). */
export function matesOf(bodies: readonly { number: number; bodyClass: BodyClass }[], number: number, altitudeOf: (number: number) => number | null): Mates {
  const altitudes: number[] = [];
  for (const body of bodies) {
    if (body.number === number || body.bodyClass !== "payload") continue;
    const aKm = altitudeOf(body.number);
    if (aKm !== null && Number.isFinite(aKm)) altitudes.push(aKm);
  }
  if (altitudes.length === 0) return { count: 0, medianAKm: Number.NaN };
  return { count: altitudes.length, medianAKm: median(altitudes) };
}

/** Whether a step carries the object towards where its mates fly: the post-step level nearer their median altitude than the pre-step level was, and by more than the tolerance in kilometres, so a step along a level the mates already share is not read as a climb towards them. */
export function towardsMates(preAKm: number, postAKm: number, mates: Mates, toleranceKm: number): boolean {
  if (mates.count === 0 || !Number.isFinite(mates.medianAKm)) return false;
  return Math.abs(postAKm - mates.medianAKm) < Math.abs(preAKm - mates.medianAKm) - toleranceKm;
}

/** Whether a young object's step is a deployment climb: the object under the parameter's age, with at least one mate, stepping towards them. */
export function isDeploying(ageDays: number, towards: boolean, mates: Mates, params: DetectorParameters): boolean {
  return ageDays < params.deployAgeDays && mates.count >= 1 && towards;
}
