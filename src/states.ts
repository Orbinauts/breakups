import type { LaunchState, ObjectState } from "./detector.ts";

/**
 * The detector's states as text, for a caller that stores them between
 * runs in something that holds text (a key-value store, a file).
 *
 * Plain `JSON.stringify` is not enough. The states are kept in maps,
 * which JSON writes as empty objects, so every state is lost. And they
 * hold numbers JSON cannot carry: the detector uses the infinities for
 * "not yet" and "never", and NaN for "not measured", and JSON writes
 * each as `null`, which arithmetic and comparisons read as zero, so the
 * next run would decide on numbers the detector never held.
 * `serialiseStates` spells those numbers out as strings ("NaN",
 * "Infinity", "-Infinity") and each map as its entries
 * (`{"__map": [[key, value], ...]}`), and `reviveStates` reads them back,
 * so the next run decides exactly as it would have on the states it
 * returned. The text is JSON, and the states' shape stays the
 * detector's own: a caller stores it and hands it back without reading it.
 */

/** The states a run returns and the next run takes: by catalogue number, and by launch (`1998-067`). */
export interface DetectorStates {
  states: Map<number, ObjectState>;
  launches: Map<string, LaunchState>;
}

const SPELLED = new Map<string, number>([
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["-Infinity", Number.NEGATIVE_INFINITY],
]);

/** The `JSON.stringify` replacer the states are written with: a number JSON cannot carry as its string, a map as its entries. */
export function statesReplacer(this: unknown, _key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  if (value instanceof Map) return { __map: [...value.entries()] };
  return value;
}

/** The `JSON.parse` reviver that reads them back. */
export function statesReviver(this: unknown, _key: string, value: unknown): unknown {
  if (typeof value === "string" && SPELLED.has(value)) return SPELLED.get(value);
  if (typeof value === "object" && value !== null && "__map" in value) return new Map((value as { __map: [unknown, unknown][] }).__map);
  return value;
}

/** A run's states as text, to store until the next run. */
export function serialiseStates({ states, launches }: DetectorStates): string {
  return JSON.stringify({ states, launches }, statesReplacer);
}

/** The states stored as text by `serialiseStates`, to hand to the next run. */
export function reviveStates(text: string): DetectorStates {
  const { states, launches } = JSON.parse(text, statesReviver) as DetectorStates;
  return { states, launches };
}
