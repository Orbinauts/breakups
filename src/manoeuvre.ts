import type { DetectorParameters, LegacyParameters } from "./params.ts";
import type { BodyClass, Regime } from "./truth.ts";

/**
 * The object's own step history, and what it says about the step being
 * judged. A working satellite moves its orbit on a pattern: fortnightly
 * east-west steps and a yearly north-south one at geosynchronous
 * altitude, a run of same-sign raises as it climbs to its working orbit,
 * a drag make-up raise every few weeks in low orbit, a disposal lowering
 * at the end. A breakup is a step the object's own record does not
 * explain: the first in two years, or one unlike the others in size,
 * direction or geometry. So the detector keeps, on every object, the
 * persistent steps it accepted over the last two years (either sign,
 * whatever verdict they got) and classes a new step by them alone. The
 * catalogue's class of the object (payload, rocket body, debris) is read
 * as evidence in one place only, where the history is empty because the
 * object is too young to have one; it is never a gate: a payload that has
 * made no step in two years is judged as a rocket body would be, and a
 * rocket body with a regular step pattern is a manoeuvring stage.
 *
 * Nothing here looks ahead: the history is what the object had done by
 * the step, which is what a live run has. End-of-life dates and other
 * hindsight are not read.
 */

const DAY_MS = 86_400_000;

/** One accepted step of the object's past, as the history keeps it: when, how far, and the impulse it implied. */
export interface StepRecord {
  /** The epoch of the first set after the step, in milliseconds since 1970. */
  epochMs: number;
  deltaKm: number;
  deltaPerigeeKm: number;
  deltaInclinationDeg: number;
  tangentialMps: number;
  normalMps: number;
}

/**
 * The classes a step falls in by the object's record. `station-keeping`:
 * frequent steps on a regular or alternating pattern. `campaign`: a run
 * of same-sign steps, an orbit being raised or lowered in stages, or the
 * first raise of a young payload. `disposal`: a step of the size and
 * shape of an end-of-life move. `occasional`: the object has stepped
 * before within two years but on no pattern. `unique`: no accepted step
 * in two years on an object old enough for that to mean something.
 */
export const MANOEUVRE_CLASSES = ["station-keeping", "campaign", "disposal", "occasional", "unique"] as const;
export type ManoeuvreClass = (typeof MANOEUVRE_CLASSES)[number];

/** The step being judged, as the history reads it. */
export interface CurrentStep {
  epochMs: number;
  deltaKm: number;
  deltaPerigeeKm: number;
  tangentialMps: number;
  normalMps: number;
  /** The chi-squared of the eccentricity change beyond a tangential impulse's reach. */
  consistency: number;
  /** The drag term of the first post set over the pre window's; NaN where the window's term was zero. */
  bstarRatio: number;
  regime: Regime;
  bodyClass: BodyClass;
  /** The apogee height after the step, in kilometres, for the disposal test. */
  apogeeHeightAfterKm: number;
}

export interface HistoryFeatures {
  /** Days from the object's first set to the step. */
  ageDays: number;
  /** Accepted steps in the year and in the two years before the step. */
  n365: number;
  n730: number;
  /** Days from the last accepted step; NaN where there is none. */
  daysSinceStep: number;
  /** The coefficient of variation of the intervals between the steps, the current one included, with at least three steps; NaN with fewer. */
  regularity: number;
  /** The step's size over the median size of the past steps; NaN with none. */
  typicality: number;
  /** The share of the past steps with the step's sign; NaN with none. */
  sameSignShare: number;
  /** The share of sign changes between consecutive steps, the current one included; NaN with no past step. */
  alternation: number;
  /** The share of the past steps whose normal component exceeded the tangential; NaN with none. */
  normalShare: number;
  /** Whether the step has the size and shape of an end-of-life move. */
  disposalLike: boolean;
  /** Whether the object is younger than the parameter: its history is unknown rather than empty. */
  young: boolean;
  /** How many of the past steps raised the orbit, for the direction against drag. */
  pastRaises: number;
}

/** Drops records older than the history's reach before the epoch, and the oldest beyond its size. */
export function pruneHistory(steps: StepRecord[], epochMs: number, params: DetectorParameters): void {
  const oldest = epochMs - params.historyDays * DAY_MS;
  while (steps.length > 0 && steps[0]!.epochMs < oldest) steps.shift();
  while (steps.length > params.historyMaxSteps) steps.shift();
}

/** Adds an accepted step to the history, in epoch order, and prunes it. */
export function recordStep(steps: StepRecord[], record: StepRecord, params: DetectorParameters): void {
  let i = steps.length;
  while (i > 0 && steps[i - 1]!.epochMs > record.epochMs) i--;
  steps.splice(i, 0, record);
  pruneHistory(steps, record.epochMs, params);
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** Whether the step has the size and shape of an end-of-life move: in low orbit a perigee lowered by the parameter with the apogee kept, or a raise past the parameter; at geosynchronous altitude a raise past the graveyard parameter. */
export function isDisposalLike(step: CurrentStep, params: DetectorParameters): boolean {
  const deltaApogee = 2 * step.deltaKm - step.deltaPerigeeKm;
  if (step.regime === "LEO") {
    if (step.deltaPerigeeKm <= -params.disposalPerigeeDropKm && Math.abs(deltaApogee) <= 0.5 * Math.abs(step.deltaPerigeeKm)) return true;
    return step.deltaKm >= params.disposalRaiseLeoKm;
  }
  if (step.regime === "GEO") return step.deltaKm >= params.disposalRaiseGeoKm;
  return false;
}

/** The features of a step against the object's history of accepted steps before it, the history pruned to the reach. */
export function featuresOf(steps: StepRecord[], step: CurrentStep, firstEpochMs: number, params: DetectorParameters): HistoryFeatures {
  const oldest = step.epochMs - params.historyDays * DAY_MS;
  const past = steps.filter((s) => s.epochMs < step.epochMs && s.epochMs >= oldest);
  const n730 = past.length;
  const n365 = past.filter((s) => s.epochMs >= step.epochMs - params.stationKeepingWindowDays * DAY_MS).length;
  const ageDays = Number.isFinite(firstEpochMs) ? (step.epochMs - firstEpochMs) / DAY_MS : 0;
  const sign = Math.sign(step.deltaKm);
  let regularity = Number.NaN;
  if (n730 >= 2) {
    const epochs = [...past.map((s) => s.epochMs), step.epochMs];
    const intervals = epochs.slice(1).map((t, i) => t - epochs[i]!);
    const mean = intervals.reduce((sum, v) => sum + v, 0) / intervals.length;
    const variance = intervals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / intervals.length;
    regularity = mean > 0 ? Math.sqrt(variance) / mean : Number.NaN;
  }
  let alternation = Number.NaN;
  if (n730 >= 1) {
    const signs = [...past.map((s) => Math.sign(s.deltaKm)), sign];
    let changes = 0;
    for (let i = 1; i < signs.length; i++) if (signs[i] !== signs[i - 1]) changes++;
    alternation = changes / (signs.length - 1);
  }
  const pastMedian = n730 > 0 ? median(past.map((s) => Math.abs(s.deltaKm))) : Number.NaN;
  return {
    ageDays,
    n365,
    n730,
    daysSinceStep: n730 > 0 ? (step.epochMs - past[n730 - 1]!.epochMs) / DAY_MS : Number.NaN,
    regularity,
    typicality: n730 > 0 && pastMedian > 0 ? Math.abs(step.deltaKm) / pastMedian : Number.NaN,
    sameSignShare: n730 > 0 ? past.filter((s) => Math.sign(s.deltaKm) === sign).length / n730 : Number.NaN,
    alternation,
    normalShare: n730 > 0 ? past.filter((s) => s.normalMps > s.tangentialMps).length / n730 : Number.NaN,
    disposalLike: isDisposalLike(step, params),
    young: ageDays < params.newObjectDays,
    pastRaises: past.filter((s) => s.deltaKm > 0).length,
  };
}

/**
 * The class of a step by its features. A disposal-shaped step is a
 * disposal whatever the record. With no past step, a young payload's
 * raise that a tangential impulse explains is the start of a campaign
 * (the one place the catalogue's class is read, since the history is
 * unknown rather than empty); any other step with no past is unique. A
 * record of one sign, the step's own, is a campaign, whatever its
 * cadence. With enough steps in the year, a regular or alternating record
 * of both signs is station-keeping. The rest is occasional. The verdict
 * does not differ between the three manoeuvre classes; the name says
 * what the record looks like.
 */
export function classify(features: HistoryFeatures, step: CurrentStep, params: DetectorParameters): ManoeuvreClass {
  if (features.disposalLike) return "disposal";
  if (features.n730 === 0) {
    const campaignStart = features.young && step.bodyClass === "payload" && step.deltaKm > 0 && step.consistency < params.consistencyMin;
    return campaignStart ? "campaign" : "unique";
  }
  if (features.sameSignShare >= params.monotoneShareMin) return "campaign";
  if (features.n365 >= params.stationKeepingMinSteps && (features.regularity <= params.regularityMax || features.alternation >= params.alternationMin)) return "station-keeping";
  return "occasional";
}

/** The four tests by which a step on a manoeuvring object is still raised, each with its sentence where it fires: the step's size over the record's, its direction against the record's, the eccentricity change beyond a tangential impulse's reach, and the drag term's change across it. */
export interface AtypicalTests {
  size: string | null;
  direction: string | null;
  geometry: string | null;
  dragTerm: string | null;
}

export function atypicalTests(features: HistoryFeatures, step: CurrentStep, params: DetectorParameters): AtypicalTests {
  // A ratio of zero is a post set whose drag term the catalogue printed as zero, which says nothing of the area over the mass.
  const dragTerm = Number.isFinite(step.bstarRatio) && step.bstarRatio > 0 && (step.bstarRatio >= params.bstarRatioMax || step.bstarRatio <= 1 / params.bstarRatioMax);
  return {
    size: features.typicality >= params.typicalityMax ? `the step is ${features.typicality.toFixed(1)} times the median of the object's past steps` : null,
    direction: features.n730 >= params.oppositeMinSteps && features.sameSignShare === 0 ? `the step is opposite in direction to every one of the object's ${features.n730} past steps` : null,
    geometry: step.consistency >= params.consistencyMin ? `the eccentricity change needs a radial kick a tangential burn cannot give (chi-squared ${step.consistency.toFixed(1)})` : null,
    dragTerm: dragTerm ? `the drag term changed ${step.bstarRatio >= 1 ? step.bstarRatio.toFixed(1) : (1 / step.bstarRatio).toFixed(1)}-fold across the step` : null,
  };
}

/** The tests by which a step on a manoeuvring object is still raised: each a sentence, or none. */
export function atypicalReasons(features: HistoryFeatures, step: CurrentStep, params: DetectorParameters): string[] {
  const tests = atypicalTests(features, step, params);
  return [tests.size, tests.direction, tests.geometry, tests.dragTerm].filter((reason): reason is string => reason !== null);
}

/** Whether a step of the class is raised on the parent alone: a unique step, one the atypical tests single out, or, where the parameter says so, an occasional step on an object the catalogue does not class as a payload, since a stage or a fragment does not manoeuvre and its past step was the catalogue's fit absorbing something. */
export function isRaised(manoeuvreClass: ManoeuvreClass, atypical: string[], bodyClass: BodyClass = "payload", params?: { legacy: Pick<LegacyParameters, "occasionalRaisesNonPayload"> }): boolean {
  if (manoeuvreClass === "unique" || atypical.length > 0) return true;
  return params?.legacy.occasionalRaisesNonPayload === true && manoeuvreClass === "occasional" && bodyClass !== "payload";
}
