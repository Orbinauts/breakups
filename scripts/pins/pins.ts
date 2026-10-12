import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The exact versions of the runtime packages a score is made with
 * (`pins.json`, docs/decisions/0004): `scoring`, which the KPI and
 * maintenance workflows install to make and check main's score, and
 * `frozenDetector`, which the prospective workflow installs for the
 * frozen tag's detector, kept apart so a move of main's pins never moves
 * the frozen detector's (docs/decisions/0008). They are not a lockfile:
 * CI still installs from the manifest's ranges, to test what a consumer
 * gets, and a bump is a deliberate commit.
 *
 * `npm run pins -- install <scoring|frozenDetector> [--dir <dir>]`
 * installs the project in `dir` (this repository by default) with the
 * named pins, without saving them or writing a lockfile, then refuses,
 * naming each package, the version found and the pin, where a resolved
 * version is not its pin, where the engine carries its own copy of a
 * propagator, or where a pin lies outside the range the project or the
 * pinned engine declares.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The runtime packages a score depends on: the engine and, through it, the two propagators. */
export const PINNED = ["@orbinauts/engine", "satellite.js", "astronomy-engine"] as const;

/** One of the runtime packages pinned. */
export type PinnedPackage = (typeof PINNED)[number];

const ENGINE: PinnedPackage = "@orbinauts/engine";

/** An exact version of each runtime package. */
export type Versions = Record<PinnedPackage, string>;

/** The committed pins: main's scoring pins, and the frozen detector's, apart. */
export interface Pins {
  scoring: Versions;
  frozenDetector: Versions;
}

/** The two sets of pins, by their key in the file. */
const PIN_SETS = ["scoring", "frozenDetector"] as const satisfies readonly (keyof Pins)[];

/** The file the pins are committed in, at the repository's root. */
export const PINS_FILE = "pins.json";

/** The pins as committed, each set refused unless it names every runtime package, and nothing else, at an exact version. */
export function readPins(root = ROOT): Pins {
  const read = JSON.parse(readFileSync(join(root, PINS_FILE), "utf8")) as Record<string, Record<string, string>>;
  for (const key of PIN_SETS) {
    const set = read[key];
    if (set === undefined || Object.keys(set).sort().join() !== [...PINNED].sort().join()) throw new Error(`${PINS_FILE}: ${key} must pin ${PINNED.join(", ")} and nothing else`);
    for (const name of PINNED) if (!EXACT.test(set[name]!)) throw new Error(`${PINS_FILE}: ${key} pins ${name} at ${set[name]}, not an exact version`);
  }
  return read as unknown as Pins;
}

const EXACT = /^(\d+)\.(\d+)\.(\d+)$/;

/** An exact version's major, minor and patch numbers. */
function versionParts(version: string): [number, number, number] {
  const match = EXACT.exec(version);
  if (match === null) throw new Error(`not an exact version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Whether an exact version lies within a caret range as npm reads it, the only form the package's and the engine's manifests use; any other range is refused. */
export function satisfies(version: string, range: string): boolean {
  if (!range.startsWith("^")) throw new Error(`a range this check does not read: ${range}`);
  const v = versionParts(version);
  const floor = versionParts(range.slice(1));
  const below = v[0] !== floor[0] ? v[0] < floor[0] : v[1] !== floor[1] ? v[1] < floor[1] : v[2] < floor[2];
  if (below) return false;
  // A caret allows changes right of the first non-zero part.
  if (floor[0] !== 0) return v[0] === floor[0];
  if (floor[1] !== 0) return v[0] === 0 && v[1] === floor[1];
  return v[0] === 0 && v[1] === 0 && v[2] === floor[2];
}

/** Each pin outside the range given for its package, named with both; a package with no range given is not checked. */
export function outOfRange(pins: Versions, ranges: Partial<Record<PinnedPackage, string>>): string[] {
  return PINNED.flatMap((name) => {
    const range = ranges[name];
    return range === undefined || satisfies(pins[name], range) ? [] : [`${name} is pinned at ${pins[name]}, outside the range ${range}`];
  });
}

/** The version of the package installed at a path under node_modules, or null where there is none. */
function versionAt(path: string): string | null {
  const manifest = join(path, "package.json");
  return existsSync(manifest) ? (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version : null;
}

/** Where a package is installed at the top of a project, and where the engine would carry its own copy. */
const topOf = (dir: string, name: string): string => join(dir, "node_modules", name);
const nestedOf = (dir: string, name: string): string => join(topOf(dir, ENGINE), "node_modules", name);

/** The versions a project's code runs on, read from its node_modules: the engine's, and each propagator's as the engine resolves it (its own copy where it carries one). */
export function installedVersions(dir: string): Versions {
  return Object.fromEntries(
    PINNED.map((name) => {
      const version = (name === ENGINE ? null : versionAt(nestedOf(dir, name))) ?? versionAt(topOf(dir, name));
      if (version === null) throw new Error(`${name} is not installed under ${dir}`);
      return [name, version];
    }),
  ) as Versions;
}

/** What differs between the pins and a project's node_modules, each named with the version found and the pin; empty where the project runs on the pins. */
export function mismatches(pins: Versions, dir: string): string[] {
  return PINNED.flatMap((name) => {
    const found = versionAt(topOf(dir, name));
    const nested = name === ENGINE ? null : versionAt(nestedOf(dir, name));
    return [
      ...(found === null ? [`${name} is not installed, the pin is ${pins[name]}`] : found !== pins[name] ? [`${name} is ${found}, the pin is ${pins[name]}`] : []),
      ...(nested === null ? [] : [`the engine carries its own ${name} (${nested}), not the pinned ${pins[name]}`]),
    ];
  });
}

/** Each pin outside the ranges declared for it: the engine's by the project's manifest, the propagators' by the engine installed. */
function declaredRangeErrors(pins: Versions, dir: string): string[] {
  const manifest = (path: string) => JSON.parse(readFileSync(join(path, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  const project = manifest(dir).dependencies ?? {};
  const engine = manifest(topOf(dir, ENGINE)).dependencies ?? {};
  return outOfRange(pins, { [ENGINE]: project[ENGINE], "satellite.js": engine["satellite.js"], "astronomy-engine": engine["astronomy-engine"] });
}

const isPinSet = (key: string | undefined): key is keyof Pins => (PIN_SETS as readonly (string | undefined)[]).includes(key);

function main(): void {
  const [command, key, ...rest] = process.argv.slice(2);
  const at = rest.indexOf("--dir");
  const given = at === -1 ? ROOT : rest[at + 1];
  if (command !== "install" || !isPinSet(key) || given === undefined) throw new Error(`usage: npm run pins -- install <${PIN_SETS.join("|")}> [--dir <dir>]`);
  const dir = resolve(given);
  const pins = readPins()[key];
  const specs = PINNED.map((name) => `${name}@${pins[name]}`);
  const npm = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--no-save", "--no-package-lock", ...specs], { cwd: dir, stdio: "inherit" });
  if (npm.status !== 0) throw new Error(`npm install ${specs.join(" ")} failed in ${dir}`);
  const wrong = [...mismatches(pins, dir), ...declaredRangeErrors(pins, dir)];
  if (wrong.length > 0) throw new Error(`${dir} does not run on the ${key} pins:\n${wrong.join("\n")}`);
  console.log(`${dir} runs on the ${key} pins: ${specs.join(", ")}`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("pins.ts")) main();
