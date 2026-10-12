import { propagate, semiMajorAxisKm } from "@orbinauts/engine";
import type { DetectorInput, DetectorOutput, Notice, SpaceWeatherDay } from "./detector.ts";
import type { ElementSet } from "./elements.ts";
import { cartesianOf, elementsOf } from "./event-time.ts";
import type { DetectorParameters, ParameterOverrides } from "./params.ts";
import { runDetector } from "./run.ts";
import { nodePrecessionDegPerDay } from "./series.ts";

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

/** What a test may set beside the orbit: the designator (the launch the object is filed under), the catalogue's operational status, the dated end of contact with it and its launch. */
export interface SetExtras {
  designator?: string;
  opsStatus?: ElementSet["opsStatus"];
  endedByMs?: number | null;
  launchedMs?: number | null;
}

export function setOf(number: number, s: SyntheticSet, bodyClass: ElementSet["bodyClass"] = "payload", extras: SetExtras = {}): ElementSet {
  return {
    number,
    designator: extras.designator ?? `2010-00${number % 10}A`,
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
    opsStatus: extras.opsStatus ?? "unknown",
    ...(extras.endedByMs === undefined ? {} : { endedByMs: extras.endedByMs }),
    ...(extras.launchedMs === undefined ? {} : { launchedMs: extras.launchedMs }),
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
 * every four hours up to `until`, so lapses happen. `space` is the days
 * handed to every run, or the days for a run's instant.
 */
export function feed(batches: ElementSet[][], options: { parameters?: ParameterOverrides; space?: SpaceWeatherDay[] | ((at: number) => SpaceWeatherDay[]); until?: number; notices?: Notice[]; decays?: ReadonlyMap<number, number> } = {}): Fed {
  let states: DetectorInput["states"] = new Map();
  let launches: DetectorInput["launches"] = new Map();
  const verdicts: Fed["verdicts"] = [];
  const log: Fed["log"] = [];
  let now = Number.NEGATIVE_INFINITY;
  const run = (sets: ElementSet[], at: number): void => {
    const output = runDetector({ states, launches, sets, now: at, parameters: options.parameters, space: typeof options.space === "function" ? options.space(at) : options.space, notices: options.notices?.filter((n) => n.at <= at), decays: options.decays });
    states = output.states;
    launches = output.launches;
    verdicts.push(...output.verdicts);
    log.push(...output.log);
    now = at;
  };
  for (const batch of batches) {
    const latest = Math.max(...batch.map((s) => s.epochMs).filter(Number.isFinite));
    run(batch, Math.max(now + 1, latest + HOUR));
  }
  if (options.until !== undefined) for (let at = now + 4 * HOUR; at <= options.until; at += 4 * HOUR) run([], at);
  return { verdicts, log, states };
}

/** Each set in its own run. */
export const one = (sets: ElementSet[]): ElementSet[][] => sets.map((s) => [s]);

/** The distance between two sets' propagated positions at an instant, in kilometres; infinite where either cannot be propagated. */
export function apartAt(a: ElementSet, b: ElementSet, at: number): number {
  const ea = elementsOf(a);
  const eb = elementsOf(b);
  if (ea === null || eb === null) return Number.POSITIVE_INFINITY;
  const p = propagate(ea, new Date(at));
  const q = propagate(eb, new Date(at));
  const r = cartesianOf(p.latitude, p.longitude, p.altitude);
  const s = cartesianOf(q.latitude, q.longitude, q.altitude);
  return Math.hypot(s[0] - r[0], s[1] - r[1], s[2] - r[2]);
}

/**
 * A piece of a breakup of `parent` at `eventMs`: its first set at
 * `epochMs`, its semi-major axis `deltaAKm` from the parent's, the same
 * plane (the node carried from the event at each orbit's own J2 rate, as
 * a real piece's would be printed), and its mean anomaly searched so that
 * it is where the parent was at the event, as every piece of a breakup is.
 * The printed mean motion is not the rate the propagation advances the
 * phase at, so the phase is searched rather than carried by hand.
 */
export function pieceOf(parent: ElementSet, eventMs: number, deltaAKm: number, epochMs: number, number: number, designator: string): ElementSet {
  const aKm = semiMajorAxisKm(parent.meanMotion) + deltaAKm;
  const meanMotion = meanMotionOf(aKm);
  const parentRate = nodePrecessionDegPerDay(semiMajorAxisKm(parent.meanMotion), parent.eccentricity, parent.inclinationDeg, parent.meanMotion);
  const pieceRate = nodePrecessionDegPerDay(aKm, parent.eccentricity, parent.inclinationDeg, meanMotion);
  const raanDeg = parent.raanDeg + parentRate * ((eventMs - parent.epochMs) / DAY) + pieceRate * ((epochMs - eventMs) / DAY);
  const at = (meanAnomalyDeg: number): ElementSet => ({ ...parent, number, designator, epochMs, meanMotion, raanDeg: ((raanDeg % 360) + 360) % 360, meanAnomalyDeg: ((meanAnomalyDeg % 360) + 360) % 360, bodyClass: "debris" });
  let best = 0;
  let least = Number.POSITIVE_INFINITY;
  for (let m = 0; m < 360; m += 0.5) {
    const d = apartAt(parent, at(m), eventMs);
    if (d < least) [best, least] = [m, d];
  }
  for (let m = best - 0.5; m <= best + 0.5; m += 0.002) {
    const d = apartAt(parent, at(m), eventMs);
    if (d < least) [best, least] = [m, d];
  }
  return at(best);
}
