import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { DETECTOR_NAME, DETECTOR_PARAMETERS, readBreakups, type Breakup, type DetectorParameters } from "../../src/index.ts";
import { archiveHome, builtYears, yearDir } from "../archive/archive.ts";
import { readCatalogue, type Catalogue } from "./catalogue.ts";
import { jumpDetector } from "./jump.ts";
import { writeEvents } from "./events.ts";
import { aggregate, renderLatest, type Latest, type YearFile } from "./kpi.ts";
import { matchYear, noticesOf } from "./match.ts";
import { indexOf, loadSlice, replayYear, type Carried, type Detector, type ReplayOptions, type ReplayResult } from "./replay.ts";
import { hasStates, readStates, writeStates } from "./states.ts";

/**
 * The scorecard's command: `npm run kpi -- --all` replays every built
 * year of the Archive through the detector in order, each year starting
 * from the states the one before ended with, matches each against the
 * truth, writes `kpi/years/<year>.json.gz` and the states at the year's
 * end under `kpi/work/states/`, and folds the years into
 * `kpi/latest.json` and `kpi/latest.md`. `npm run kpi:year -- 2013`
 * replays one year alone, from the states file its predecessor's replay
 * left where there is one (the same result as in the sequence) and from
 * sixty days of the previous year where there is none (a check, not the
 * record, since the detector then meets the year with no record of any
 * object's steps). `npm run kpi -- --aggregate` folds the year files
 * present. `--detector jump` runs the trivial step detector instead of
 * the library's, for timing and for trying the rules, and writes under
 * `kpi/work/` so the committed results are never the trivial detector's.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const KPI_DIR = join(ROOT, "kpi");
const WORK_DIR = join(KPI_DIR, "work");

export interface Truth {
  breakups: Breakup[];
  sha256: string;
}

/** The ground truth as shipped, with the hash the aggregate records. */
export function readTruth(root = ROOT): Truth {
  const bytes = readFileSync(join(root, "data/breakups.json"));
  return { breakups: readBreakups(JSON.parse(bytes.toString("utf8"))), sha256: createHash("sha256").update(bytes).digest("hex") };
}

export interface ScoreYearOptions extends ReplayOptions {
  detectorName?: string;
  /** The catalogue read over every year, for the Confirmed line's targets; read once per Archive and truth where not given. */
  catalogue?: Catalogue;
}

const catalogues = new Map<string, Catalogue>();

/** The catalogue over every built year of the Archive, with the sets of every parent the truth names, read once per Archive and truth (about a minute over twenty-two years). */
export function catalogueOf(archive: string, truth: Truth): Catalogue {
  const key = `${archive}:${truth.sha256}`;
  let catalogue = catalogues.get(key);
  if (catalogue === undefined) {
    const parents = new Set(truth.breakups.map((b) => b.parent.catalogueNumber).filter((n): n is number => n !== null));
    catalogue = readCatalogue(archive, parents, false);
    catalogues.set(key, catalogue);
  }
  return catalogue;
}

/** One year replayed and matched: the file as it is written, and the replay's result for the next year to carry. */
export function replayAndScore(archive: string, year: number, truth: Truth, options: ScoreYearOptions = {}): { file: YearFile; result: ReplayResult } {
  const notices = options.notices ?? noticesOf(truth.breakups);
  const result = replayYear(archive, year, { ...options, notices });
  const score = matchYear(year, truth.breakups, result.verdicts, result.index, result.timeBasis, notices, { ...DETECTOR_PARAMETERS, ...options.parameters }, options.catalogue ?? catalogueOf(archive, truth));
  const file: YearFile = {
    format: 1,
    year,
    archive: { source: result.manifest.source.kind, builtAt: result.manifest.builtAt, sets: result.manifest.sets, bodies: result.manifest.bodies },
    detector: { name: options.detectorName ?? DETECTOR_NAME, parameters: { ...DETECTOR_PARAMETERS, ...options.parameters } },
    timeBasis: result.timeBasis,
    runs: result.runs,
    sets: result.sets,
    warmup: result.warmup,
    carried: result.carried,
    bodyYears: result.bodyYears,
    replaySeconds: Math.round(result.seconds * 10) / 10,
    score,
    verdicts: result.verdicts,
    log: result.log,
  };
  return { file, result };
}

/** A year's file scored again from its verdicts, against the truth as it stands and the year's slices (the year's and the previous one's where the Archive has it): the matcher's rule re-applied without a replay. */
export function rematch(archive: string, file: YearFile, truth: Truth): YearFile {
  const notices = noticesOf(truth.breakups);
  const previous = existsSync(join(yearDir(archive, file.year - 1), "manifest.json")) ? loadSlice(archive, file.year - 1) : null;
  const index = indexOf(loadSlice(archive, file.year), previous);
  return { ...file, score: matchYear(file.year, truth.breakups, file.verdicts, index, file.timeBasis, notices, { ...DETECTOR_PARAMETERS, ...file.detector.parameters }, catalogueOf(archive, truth)) };
}

/** One year replayed and matched: the file as it is written. */
export function scoreYear(archive: string, year: number, truth: Truth, options: ScoreYearOptions = {}): YearFile {
  return replayAndScore(archive, year, truth, options).file;
}

/** What the next year carries from a replay's result. */
export const carriedOf = (result: ReplayResult): Carried => ({ states: result.states, launches: result.launches, previous: result.slice });

export const yearsDir = (dir: string): string => join(dir, "years");
export const statesDir = (dir: string): string => join(dir, "states");
export const statesFileName = (year: number): string => `${year}.json.gz`;

/** The states a year starts from when replayed alone: the file its predecessor's replay left, with the predecessor's slice read afresh; undefined where there is none. */
export function carriedFromFile(archive: string, workDir: string, year: number): Carried | undefined {
  const path = join(statesDir(workDir), statesFileName(year - 1));
  if (!hasStates(path) || !existsSync(join(yearDir(archive, year - 1), "manifest.json"))) return undefined;
  const file = readStates(path);
  if (file.year !== year - 1) throw new Error(`${path} holds the states of ${file.year}, not ${year - 1}`);
  return { states: file.states, launches: file.launches, previous: loadSlice(archive, year - 1) };
}

/**
 * A year's file is written gzipped: with every persistent step suspected
 * before the manoeuvre classing, a year holds tens of thousands of
 * verdicts and log rows, tens of megabytes as plain text and a few
 * compressed, and the files are committed.
 */
export const yearFileName = (year: number): string => `${year}.json.gz`;

export function writeYearFile(dir: string, file: YearFile): string {
  mkdirSync(yearsDir(dir), { recursive: true });
  const path = join(yearsDir(dir), yearFileName(file.year));
  writeFileSync(path, gzipSync(`${JSON.stringify(file)}\n`, { level: 9 }));
  return path;
}

export function readYearFile(path: string): YearFile {
  const bytes = readFileSync(path);
  return JSON.parse((path.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8")) as YearFile;
}

export function readYearFiles(dir: string): YearFile[] {
  if (!existsSync(yearsDir(dir))) return [];
  return readdirSync(yearsDir(dir))
    .filter((name) => /^\d{4}\.json\.gz$/.test(name))
    .sort()
    .map((name) => readYearFile(join(yearsDir(dir), name)));
}

/** The aggregate over the year files in a directory, written beside them as `latest.json` and `latest.md`, with the per-event dissection written where `eventsPath` says (the committed one under `docs/detector/` for the committed results). */
export function writeAggregate(dir: string, truth: Truth, root = ROOT, eventsPath = dir === KPI_DIR ? EVENTS_PATH : join(dir, "events.md")): Latest {
  const files = readYearFiles(dir);
  if (files.length === 0) throw new Error(`no year files under ${yearsDir(dir)}: run a year first`);
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string };
  const detectors = new Set(files.map((f) => f.detector.name));
  if (detectors.size > 1) throw new Error(`the year files were run with different detectors (${[...detectors].join(", ")}): rerun them`);
  const latest = aggregate(files, { package: { name: pkg.name, version: pkg.version }, truthSha256: truth.sha256, detector: files[0]!.detector });
  writeFileSync(join(dir, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);
  writeFileSync(join(dir, "latest.md"), renderLatest(latest));
  writeEvents(eventsPath, files, truth, latest);
  return latest;
}

/** Where the per-event dissection of the committed results is written. */
export const EVENTS_PATH = join(ROOT, "docs/detector/events.md");

/** A `--param name=value` argument: the name must be a parameter's, the value parses as JSON. */
export function parseParameter(arg: string, into: Partial<DetectorParameters>): void {
  const at = arg.indexOf("=");
  if (at === -1) throw new Error(`--param wants name=value, got ${arg}`);
  const name = arg.slice(0, at) as keyof DetectorParameters;
  if (!(name in DETECTOR_PARAMETERS)) throw new Error(`no detector parameter named ${name}`);
  (into as Record<string, unknown>)[name] = JSON.parse(arg.slice(at + 1)) as unknown;
}

function summary(file: YearFile): string {
  const events = file.score.events;
  const count = (status: string): number => events.filter((e) => e.status === status).length;
  const alerts = (outcome: string): number => file.score.alerts.filter((a) => a.outcome === outcome).length;
  const manoeuvres = file.verdicts.filter((v) => v.state === "manoeuvre").length;
  const scoped = file.verdicts.filter((v) => v.state === "scoped").length;
  const confirmed = file.score.alerts.filter((a) => a.confirmedAt !== null);
  const start = file.carried ? "from the carried states" : file.warmup === null ? "cold" : `after ${file.warmup.runs} runs of ${file.warmup.year}`;
  return `${file.year}: ${file.sets} sets in ${file.runs} runs ${start}, ${file.replaySeconds} s; targets ${events.length - count("undetectable")} (undetectable ${count("undetectable")}): detected ${count("detected")}, late ${count("late")}, missed ${count("missed")}; alerts ${file.score.alerts.length - alerts("confirmation")}: false alarms ${alerts("false-alarm")}, duplicates ${alerts("duplicate")}, exempt ${alerts("exempt")}; confirmed ${confirmed.length} (${confirmed.filter((a) => a.outcome === "detection" || a.outcome === "late").length} on events); Confirmed line ${(file.score.confirmations ?? []).length} (${(file.score.confirmations ?? []).filter((c) => c.outcome === "detection").length} on events, ${(file.score.confirmations ?? []).filter((c) => c.outcome === "false-alarm").length} false); manoeuvres ${manoeuvres}; scoped ${scoped}; review ${file.score.review.length}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const years: number[] = [];
  let all = false;
  let doAggregate = false;
  let doRematch = false;
  let detector: Detector | undefined;
  let detectorName: string | undefined;
  let dir = KPI_DIR;
  let workDir = WORK_DIR;
  const parameters: Partial<DetectorParameters> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--year") years.push(Number(args[++i]));
    else if (arg === "--all") all = true;
    else if (arg === "--aggregate") doAggregate = true;
    else if (arg === "--rematch") [doRematch, doAggregate] = [true, true];
    else if (arg === "--param") parseParameter(args[++i]!, parameters);
    else if (arg === "--out") [dir, workDir] = [resolve(args[++i]!), join(resolve(args[i]!), "work")];
    else if (arg === "--detector") {
      const name = args[++i];
      if (name === "jump") [detector, detectorName, dir, workDir] = [jumpDetector(), "jump", WORK_DIR, join(WORK_DIR, "jump")];
      else if (name !== "placeholder") throw new Error(`no detector named ${name}: placeholder or jump`);
    } else throw new Error(`usage: run.ts --year <year> [--year ...] | --all | --aggregate | --rematch [--detector placeholder|jump] [--param name=value ...] [--out <dir>]`);
  }
  // A replay with overridden parameters is a trial, never the committed result.
  if (Object.keys(parameters).length > 0 && dir === KPI_DIR) throw new Error("a replay with --param must also give --out: the committed results are the defaults'");
  const archive = archiveHome();
  const truth = readTruth();
  if (all) years.push(...builtYears(archive));
  if (years.length === 0 && !doAggregate) throw new Error("nothing to do: give --year, --all, --aggregate or --rematch");
  if (doRematch) {
    for (const file of readYearFiles(dir)) {
      const scored = rematch(archive, file, truth);
      writeYearFile(dir, scored);
      console.log(summary(scored));
    }
  }
  years.sort((a, b) => a - b);
  // Each year starts from the states the one before ended with: the previous year of this command where it was replayed here, else its states file where a replay left one, else a warm-up.
  let carried: Carried | undefined;
  let carriedFrom: number | null = null;
  for (const year of years) {
    if (carriedFrom !== year - 1) carried = carriedFromFile(archive, workDir, year);
    const { file, result } = replayAndScore(archive, year, truth, { detector, detectorName, carried, parameters });
    writeYearFile(dir, file);
    writeStates(join(statesDir(workDir), statesFileName(year)), { format: 1, year, states: result.states, launches: result.launches });
    console.log(summary(file));
    carried = carriedOf(result);
    carriedFrom = year;
  }
  if (all || doAggregate) {
    const latest = writeAggregate(dir, truth);
    const headline = latest.splits.validation.lines["breakups A-B"];
    console.log(`${join(dir, "latest.json")}: ${latest.years.length} years; validation headline ${headline.detected} of ${headline.targets} detected, ${latest.splits.validation.falseAlarms} false alarms`);
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("run.ts")) await main();
