import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { parse } from "yaml";
import { installedVersions, mismatches, outOfRange, readPins } from "./pins.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const today = { "@orbinauts/engine": "0.1.2", "satellite.js": "7.1.0", "astronomy-engine": "2.1.19" };

describe("a pin against the range it must lie within", () => {
  test("lies within a caret range from its floor to the next breaking version", () => {
    expect(outOfRange(today, { "@orbinauts/engine": "^0.1.2", "satellite.js": "^7.1.0", "astronomy-engine": "^2.1.19" })).toEqual([]);
    expect(outOfRange({ ...today, "@orbinauts/engine": "0.1.9", "satellite.js": "7.9.3" }, { "@orbinauts/engine": "^0.1.2", "satellite.js": "^7.1.0" })).toEqual([]);
  });

  test("is named where it lies below the range or past its next breaking version", () => {
    expect(outOfRange({ ...today, "@orbinauts/engine": "0.2.0" }, { "@orbinauts/engine": "^0.1.2" })).toEqual(["@orbinauts/engine is pinned at 0.2.0, outside the range ^0.1.2"]);
    expect(outOfRange({ ...today, "satellite.js": "8.0.0", "astronomy-engine": "2.1.18" }, { "satellite.js": "^7.1.0", "astronomy-engine": "^2.1.19" })).toEqual([
      "satellite.js is pinned at 8.0.0, outside the range ^7.1.0",
      "astronomy-engine is pinned at 2.1.18, outside the range ^2.1.19",
    ]);
  });

  test("is checked only against the ranges given", () => {
    expect(outOfRange({ ...today, "satellite.js": "9.0.0" }, { "@orbinauts/engine": "^0.1.2" })).toEqual([]);
  });
});

describe("what is installed, against the pins", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A project directory whose node_modules holds each package at the version given, under the path given. */
  function tree(packages: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "breakups-pins-"));
    dirs.push(dir);
    for (const [path, version] of Object.entries(packages)) {
      mkdirSync(join(dir, "node_modules", path), { recursive: true });
      writeFileSync(join(dir, "node_modules", path, "package.json"), JSON.stringify({ name: path.split("/node_modules/").at(-1), version }));
    }
    return dir;
  }

  test("are the versions found, each propagator the copy the engine resolves", () => {
    const flat = tree({ "@orbinauts/engine": "0.1.2", "satellite.js": "7.1.0", "astronomy-engine": "2.1.19" });
    expect(installedVersions(flat)).toEqual(today);
    expect(mismatches(today, flat)).toEqual([]);
    const nested = tree({ "@orbinauts/engine": "0.1.2", "satellite.js": "7.1.0", "astronomy-engine": "2.1.19", "@orbinauts/engine/node_modules/satellite.js": "7.4.0" });
    expect(installedVersions(nested)).toEqual({ ...today, "satellite.js": "7.4.0" });
  });

  test("name each package found at another version than its pin, and a propagator the engine carries a copy of", () => {
    const moved = tree({ "@orbinauts/engine": "0.1.3", "satellite.js": "7.1.0", "astronomy-engine": "2.1.19", "@orbinauts/engine/node_modules/astronomy-engine": "2.2.0" });
    expect(mismatches(today, moved)).toEqual(["@orbinauts/engine is 0.1.3, the pin is 0.1.2", "the engine carries its own astronomy-engine (2.2.0), not the pinned 2.1.19"]);
  });

  test("name a package not installed at all", () => {
    const bare = tree({ "@orbinauts/engine": "0.1.2", "satellite.js": "7.1.0" });
    expect(mismatches(today, bare)).toEqual(["astronomy-engine is not installed, the pin is 2.1.19"]);
  });
});

describe("the committed pins", () => {
  const pins = readPins();
  const manifest = (path: string) => JSON.parse(readFileSync(join(path, "package.json"), "utf8")) as { version: string; dependencies: Record<string, string> };

  test("score on an engine within the range the package declares", () => {
    expect(outOfRange(pins.scoring, { "@orbinauts/engine": manifest(ROOT).dependencies["@orbinauts/engine"] })).toEqual([]);
  });

  // The engine's own ranges are read from the engine installed; CI installs from the ranges, so it may hold another engine than the pinned one, whose ranges say nothing of the pin's.
  const engine = manifest(join(ROOT, "node_modules/@orbinauts/engine"));
  test.skipIf(engine.version !== pins.scoring["@orbinauts/engine"])("score on propagators within the ranges the pinned engine declares", () => {
    expect(outOfRange(pins.scoring, { "satellite.js": engine.dependencies["satellite.js"], "astronomy-engine": engine.dependencies["astronomy-engine"] })).toEqual([]);
  });

  test("keep the frozen detector on the versions its test began with, whatever main's scoring pins are", () => {
    expect(pins.frozenDetector).toEqual({ "@orbinauts/engine": "0.1.2", "satellite.js": "7.1.0", "astronomy-engine": "2.1.19" });
  });
});

describe("the workflows' installs", () => {
  /** The shell of every step of a job, in order. */
  const runs = (workflow: string, job: string): string[] => {
    const read = parse(readFileSync(join(ROOT, ".github/workflows", workflow), "utf8")) as { jobs: Record<string, { steps: { run?: string }[] }> };
    return read.jobs[job]!.steps.flatMap((step) => (step.run === undefined ? [] : [step.run]));
  };
  const installs = (lines: string[]): string[] => lines.flatMap((run) => run.split("\n")).filter((line) => /npm (run -s pins -- install|install)|pins\.ts install/.test(line)).map((line) => line.trim());

  test("make and check main's score on the scoring pins, and nothing installed from the ranges", () => {
    expect(installs(runs("kpi.yml", "replay"))).toEqual(["npm run -s pins -- install scoring"]);
    expect(installs(runs("maintenance.yml", "maintain"))).toEqual(["npm run -s pins -- install scoring"]);
  });

  test("run the frozen detector on its own pins, which main's scoring pins never reach", () => {
    expect(installs(runs("prospective.yml", "daily"))).toEqual(["npm install --no-audit --no-fund", "node --experimental-strip-types ../main/scripts/pins/pins.ts install frozenDetector --dir ."]);
  });

  test("leave CI installing from the ranges, as a consumer's project does", () => {
    expect(installs(runs("ci.yml", "check"))).toEqual(["npm install --no-audit --no-fund"]);
  });
});
