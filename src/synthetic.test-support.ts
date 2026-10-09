import { semiMajorAxisKm } from "@orbinauts/engine";
import type { DetectorInput, DetectorOutput, SpaceWeatherDay } from "./detector.ts";
import type { ElementSet } from "./elements.ts";
import type { DetectorParameters } from "./params.ts";
import { runDetector } from "./run.ts";

/**
 * Synthetic element sets for the detector's tests: an object described
 * by its semi-major axis in kilometres at each epoch, turned into the
 * light rows the detector reads, and fed to it one run per set so every
 * decision is made on exactly the sets a live run would have. Never a
 * real object.
 */

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
/** The gravitational parameter the engine's Kepler conversion uses, recovered from it so the mean motion of a chosen axis rounds back to that axis. */
const MU = semiMajorAxisKm(1) ** 3 * ((2 * Math.PI) / 86_400) ** 2;

/** The mean motion, in revolutions a day, of an orbit with the semi-major axis, by Kepler's third law. */
export function meanMotionOf(aKm: number): number {
  return (Math.sqrt(MU / aKm ** 3) * 86_400) / (2 * Math.PI);
}

export interface SyntheticSet {
  epochMs: number;
  aKm: number;
  eccentricity?: number;
  inclinationDeg?: number;
  raanDeg?: number;
  bstar?: number;
  meanMotionDot?: number;
}

export function setOf(number: number, s: SyntheticSet, bodyClass: ElementSet["bodyClass"] = "payload"): ElementSet {
  return {
    number,
    designator: `2010-00${number % 10}A`,
    epochMs: s.epochMs,
    createdMs: null,
    meanMotion: meanMotionOf(s.aKm),
    eccentricity: s.eccentricity ?? 0.001,
    inclinationDeg: s.inclinationDeg ?? 98,
    raanDeg: s.raanDeg ?? 100,
    argpDeg: 90,
    meanAnomalyDeg: 0,
    bstar: s.bstar ?? 1e-4,
    meanMotionDot: s.meanMotionDot ?? 1e-6,
    meanMotionDdot: 0,
    elementSetNumber: 1,
    bodyClass,
  };
}

/** A deterministic pseudo-random sequence, so a test's noise is the same every run. */
export function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    const u = (state + 0.5) / 4_294_967_296;
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    const v = (state + 0.5) / 4_294_967_296;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

export interface Fed {
  verdicts: DetectorOutput["verdicts"];
  log: DetectorOutput["log"];
  states: DetectorInput["states"];
}

/**
 * Feeds sets to the detector in publication order, one run per distinct
 * epoch batch: sets sharing a batch index go in one run, and each run's
 * instant is an hour after its latest epoch. Runs with no set are added
 * every four hours up to `until`, so lapses happen.
 */
export function feed(batches: ElementSet[][], options: { parameters?: Partial<DetectorParameters>; space?: SpaceWeatherDay[]; until?: number } = {}): Fed {
  let states: DetectorInput["states"] = new Map();
  let launches: DetectorInput["launches"] = new Map();
  const verdicts: Fed["verdicts"] = [];
  const log: Fed["log"] = [];
  let now = Number.NEGATIVE_INFINITY;
  const run = (sets: ElementSet[], at: number): void => {
    const output = runDetector({ states, launches, sets, now: at, parameters: options.parameters, space: options.space });
    states = output.states;
    launches = output.launches;
    verdicts.push(...output.verdicts);
    log.push(...output.log);
    now = at;
  };
  for (const batch of batches) {
    const latest = Math.max(...batch.map((s) => s.epochMs));
    run(batch, Math.max(now + 1, latest + HOUR));
  }
  if (options.until !== undefined) for (let at = now + 4 * HOUR; at <= options.until; at += 4 * HOUR) run([], at);
  return { verdicts, log, states };
}

/** Each set in its own run. */
export const one = (sets: ElementSet[]): ElementSet[][] => sets.map((s) => [s]);
