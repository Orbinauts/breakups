import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { LaunchState, ObjectState } from "../../src/index.ts";

/**
 * The detector's states at the end of a year, written to a file so the
 * next year can be replayed alone from where this one left off, as the
 * sequential replay would have had it. The states are the detector's own
 * shape, which the scorecard does not read; they are written as JSON with
 * the numbers JSON cannot carry (NaN, the infinities, which the detector
 * uses for "not yet measured" and "never") spelled out as strings and
 * read back, and the maps as their entries. The file is a working file
 * under `kpi/work/`, never committed: a replay makes it again.
 */

export interface StatesFile {
  format: 1;
  year: number;
  states: Map<number, ObjectState>;
  launches: Map<string, LaunchState>;
}

const SPELLED = new Map<string, number>([
  ["NaN", Number.NaN],
  ["Infinity", Number.POSITIVE_INFINITY],
  ["-Infinity", Number.NEGATIVE_INFINITY],
]);

function replacer(this: unknown, _key: string, value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  if (value instanceof Map) return { __map: [...value.entries()] };
  return value;
}

function reviver(this: unknown, _key: string, value: unknown): unknown {
  if (typeof value === "string" && SPELLED.has(value)) return SPELLED.get(value);
  if (typeof value === "object" && value !== null && "__map" in value) return new Map((value as { __map: [unknown, unknown][] }).__map);
  return value;
}

export function writeStates(path: string, file: StatesFile): void {
  mkdirSync(dirname(path), { recursive: true });
  // The fastest compression: the file is read once by the next replay, and a year's states run to a couple of hundred megabytes plain.
  writeFileSync(path, gzipSync(JSON.stringify(file, replacer), { level: 1 }));
}

export function readStates(path: string): StatesFile {
  return JSON.parse(gunzipSync(readFileSync(path)).toString("utf8"), reviver) as StatesFile;
}

export const hasStates = (path: string): boolean => existsSync(path);
