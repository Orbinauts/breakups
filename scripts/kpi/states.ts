import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { LaunchState, ObjectState } from "../../src/detector.ts";
import { statesReplacer, statesReviver } from "../../src/states.ts";

/**
 * The detector's states at the end of a year, written to a file so the
 * next year can be replayed alone from where this one left off, as the
 * sequential replay would have had it. The states are the detector's own
 * shape, which the scorecard does not read; they are written as the
 * library's `serialiseStates` writes them (the numbers JSON cannot carry
 * spelled out, the maps as their entries), with the format and the year
 * beside them, so `reviveStates` reads a file's text and this reads a
 * caller's. The file is a working file under `kpi/work/`, never
 * committed: a replay makes it again.
 */

export interface StatesFile {
  format: 1;
  year: number;
  states: Map<number, ObjectState>;
  launches: Map<string, LaunchState>;
}

export function writeStates(path: string, file: StatesFile): void {
  mkdirSync(dirname(path), { recursive: true });
  // The fastest compression: the file is read once by the next replay, and a year's states run to a couple of hundred megabytes plain.
  writeFileSync(path, gzipSync(JSON.stringify(file, statesReplacer), { level: 1 }));
}

export function readStates(path: string): StatesFile {
  return JSON.parse(gunzipSync(readFileSync(path)).toString("utf8"), statesReviver) as StatesFile;
}

export const hasStates = (path: string): boolean => existsSync(path);
