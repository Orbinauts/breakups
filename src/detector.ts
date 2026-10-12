import type { ElementSet } from "./elements.ts";
import type { DetectorParameters } from "./params.ts";

/**
 * The detector's one entry point and the shapes it speaks in. A caller runs
 * it every few hours over the element sets published since the last run,
 * hands back the states it returned last time, and reads what it raised.
 * The scorecard runs it the same way over twenty years of the Archive, in
 * runs of four hours, and scores the verdicts against the ground truth; so
 * these shapes are the contract between the two, fixed here, and the
 * detector (`run.ts`) is written to fill them. Every threshold it decides
 * by is in `params.ts`.
 */

/**
 * What a verdict is about: one object, from its own element sets (the
 * parent of a breakup, measured by its step); or one launch, from the new
 * bodies catalogued under it (a cloud of fragments). Only an object verdict
 * can be a detection: a cloud is the catalogue's own report, read back.
 */
export const VERDICT_KINDS = ["object", "cloud"] as const;
export type VerdictKind = (typeof VERDICT_KINDS)[number];

/**
 * Where a verdict stands. `watch`: the first set past the threshold on a
 * quiet body, shown so a reader sees it the moment it appears, counted by
 * nothing. `suspected`: the step persists across the sets that follow and
 * no manoeuvre explains it; this is the detection the scorecard counts, and
 * it must come before the fragments' sets are published. `scoped`: a
 * suspected step on a parent inside the scoped line's population, through
 * its gates and held to its tier (`scope.ts`): the scoped line's alert,
 * raised once per step beside the suspected verdict it narrows, and scored
 * on the scorecard's scoped line rather than the whole catalogue's. `confirmed`: the
 * fragments or a notice bore it out. `dismissed`: the next sets took the
 * step back, or every piece proved old. `expired`: nothing confirmed it in
 * the time allowed. `manoeuvre`: the step is one the object's own history
 * explains, promoted only by pieces or a notice. `cloud-only`: fragments
 * under a launch with no step on any parent, listed for review and never a
 * detection.
 */
export const VERDICT_STATES = ["watch", "suspected", "scoped", "confirmed", "dismissed", "expired", "manoeuvre", "cloud-only"] as const;
export type VerdictState = (typeof VERDICT_STATES)[number];

/** The states the scorecard counts as an alert on the object: a suspected step, or one already confirmed. */
export const ALERT_STATES: readonly VerdictState[] = ["suspected", "confirmed"];

/**
 * The step the detector measured: the two sets it lies between, and how
 * far the orbit moved. The scorecard matches a verdict to a reported event
 * by this bracket, so it is the measurement, never an estimate of the
 * event's instant (that is `EventEstimate`). The deltas are the post-step
 * fit less the pre-step fit at the step, in kilometres and degrees; a null
 * is a quantity the detector did not measure for this step.
 */
export interface Step {
  /** The epoch of the last set before the step, in milliseconds since 1970. */
  beforeEpoch: number;
  /** The epoch of the first set after it. */
  afterEpoch: number;
  /** The change in the semi-major axis, in kilometres, signed (a descent is negative). */
  deltaKm: number;
  deltaPerigeeKm: number | null;
  deltaApogeeKm: number | null;
  deltaInclinationDeg: number | null;
  /** How many sets after the step the detector had seen when it raised the verdict. */
  postSets: number;
  /** The step in units of the object's own noise at the time, where measured. */
  z: number | null;
}

/**
 * The detector's estimate of when the event happened: its best instant and
 * the window it is sure of, in milliseconds since 1970. The scorecard
 * reports the timing error against the truth where the truth states a
 * minute.
 */
export interface EventEstimate {
  at: number;
  from: number;
  to: number;
}

/** What the detector raised, with the numbers it was judged by. */
export interface Verdict {
  kind: VerdictKind;
  state: VerdictState;
  /** The object, for an object verdict (the parent of the suspected breakup); null for a cloud. */
  number: number | null;
  /** The launch the fragments are catalogued under, for a cloud verdict; an object verdict carries its own launch where the designator says it. */
  launch: string | null;
  /** When the detector raised it: the `now` of the run, in milliseconds since 1970. */
  raisedAt: number;
  /** The measured step bracket; null for a cloud verdict, which measured no step. */
  step: Step | null;
  /** The detector's estimate of the event's time; null where it made none. */
  event: EventEstimate | null;
  /** Every number the verdict rests on, by name, thresholds included, so a reader can check it. */
  evidence: Record<string, number>;
  /** Why, in words, one reason per line. */
  reasons: string[];
  /** The bodies the verdict rests on beside the object: the pieces that confirmed it, or a cloud's consistent pieces; absent where none. */
  bodies?: number[];
  /** For a confirmed verdict whose pieces cannot be told from two bodies of the launch or more (twins): every such body, the one named first; the verdict names the launch, and `number` is the body the centre of the pieces or a persistent step picked. Absent on any other verdict. */
  candidates?: number[];
}

/**
 * One row of the sweep log: a candidate the detector looked at in a run,
 * whether or not it raised anything, with every signal it computed, so the
 * scorecard can re-threshold offline without replaying the years.
 */
export interface LogRow {
  /** The `now` of the run. */
  at: number;
  number: number;
  signals: Record<string, number>;
}

/**
 * A public notice that an authority confirmed a breakup, as the caller
 * hands it in: the object, its launch, and when the notice was published
 * (milliseconds since 1970). A notice confirms a suspected step; an alert
 * raised after one is late, since the news was out.
 */
export interface Notice {
  number: number | null;
  launch: string | null;
  at: number;
  text: string;
}

/**
 * One day's space-weather indices, as the caller hands them in: GFZ
 * Potsdam's three-hourly Kp and ap, the daily Ap and 10.7 cm flux, and
 * hourly Dst where it has it. The catalogue measures the day's drag by
 * itself; these say why, and let a storm raise the bar before the sets do.
 */
export interface SpaceWeatherDay {
  /** `YYYY-MM-DD`. */
  day: string;
  /** The eight three-hourly Kp values, 0 to 9 in thirds. */
  kp: number[];
  /** The eight three-hourly ap values. */
  ap: number[];
  /** The daily Ap. */
  Ap: number;
  /** The observed 10.7 cm flux, in solar flux units; null where not measured. */
  f107: number | null;
  /** The same adjusted to one astronomical unit. */
  f107Adjusted: number | null;
  /** Twenty-four hourly Dst values in nanotesla, each null where missing; null where the day has none. */
  dst: (number | null)[] | null;
}

/**
 * What the detector keeps of an object between runs, and of a launch. The
 * caller stores and returns them without reading them; their shape belongs
 * to the detector and will change as it is written, which is why they are
 * opaque here. A caller that keeps them as text writes them with
 * `serialiseStates` and reads them with `reviveStates` (`states.ts`):
 * plain JSON loses them.
 */
export type ObjectState = unknown;
export type LaunchState = unknown;

export interface DetectorInput {
  /** The states the last run returned, by catalogue number; an empty map on the first run. */
  states: Map<number, ObjectState>;
  /** The states the last run returned, by launch (`1998-067`). */
  launches: Map<string, LaunchState>;
  /** The sets published since the last run, in the order the catalogue published them. */
  sets: ElementSet[];
  /** The run's instant, in milliseconds since 1970: nothing published after it is in `sets`. */
  now: number;
  /** The days' indices up to `now`, oldest first, where the caller has them. */
  space?: SpaceWeatherDay[];
  /** The notices published up to `now`, where the caller has them. */
  notices?: Notice[];
  /** Every threshold the detector decides by, where the caller overrides the defaults. */
  parameters?: Partial<DetectorParameters>;
  /** The reentries the catalogue has published, where the caller has them: each object's decay day, as the midnight that starts it in milliseconds since 1970, by catalogue number. The detector reads a reentry only from its day on, so a map holding later ones (a backtest's catalogue) gives it nothing a live run would not have had. */
  decays?: ReadonlyMap<number, number>;
}

export interface DetectorOutput {
  states: Map<number, ObjectState>;
  launches: Map<string, LaunchState>;
  /** What the run raised, in the order it raised it. */
  verdicts: Verdict[];
  /** The candidates it looked at, with their signals. */
  log: LogRow[];
}

export type { DetectorParameters } from "./params.ts";
export { DETECTOR_PARAMETERS } from "./params.ts";
export { DETECTOR_NAME, runDetector } from "./run.ts";
