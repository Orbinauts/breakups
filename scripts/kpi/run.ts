import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { totalmem } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { DETECTOR_NAME, DETECTOR_PARAMETERS, readBreakups, type Breakup, type DetectorParameters } from "../../src/index.ts";
import { archiveHome, builtYears, readManifest, yearDir } from "../archive/archive.ts";
import type { Catalogue } from "./catalogue.ts";
import { indexWrittenAt, loadCatalogue } from "./catalogue-index.ts";
import { jumpDetector } from "./jump.ts";
import { writeEvents } from "./events.ts";
import { aggregate, renderLatest, type Latest, type YearFile } from "./kpi.ts";
import { matchYear, noticesOf } from "./match.ts";
import { approximation, chunksOf, runChunks, type Chunk } from "./parallel.ts";
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
 *
 * `npm run kpi -- --all --parallel N --out <dir> [--from-states <dir>]`
 * is the exploration mode (`parallel.ts`): the years in N contiguous
 * chunks, each in its own worker process, every chunk after the first
 * starting from the states a previous full sequential replay left (those
 * under `kpi/work/states/`, or under `--from-states`), then the
 * aggregate, marked `exact: false` with where its states came from. It is
 * approximate, so it never writes to `kpi/`. `--from-states <dir>` alone
 * says where a year not preceded by one replayed in the same command reads
 * its starting states, and likewise wants `--out`.
 *
 * Every command that scores reads the catalogue over every year (the
 * detector's reentries, the Confirmed line's targets) from the Archive's
 * catalogue index, built by `npm run kpi:index` (`catalogue-index.ts`),
 * never from the years on disk, and refuses to run without it or with a
 * stale one: a replay holds a year and the one before it, and the KPI
 * workflow downloads no more.
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
  /** The catalogue over every year, for the Confirmed line's targets and the detector's reentries; read from the Archive's catalogue index where not given. */
  catalogue?: Catalogue;
}

const catalogues = new Map<string, Catalogue>();

/**
 * The catalogue over every year of the Archive, with the last set before
 * the window of every parent the truth names, read from the Archive's
 * catalogue index (`catalogue-index.ts`) once per Archive, index and
 * truth. It is never read from the years on disk: a replay holds a year
 * and the one before it, so the KPI workflow has two years where a local
 * Archive has every one, and the same year scored on each read different
 * catalogues. Without an index, or with a stale one, or with one built for
 * a truth lacking one of this truth's parents' rows, it refuses.
 */
export function catalogueOf(archive: string, truth: Truth): Catalogue {
  const key = `${archive}:${indexWrittenAt(archive)}:${truth.sha256}`;
  let catalogue = catalogues.get(key);
  if (catalogue === undefined) {
    catalogue = loadCatalogue(archive, truth.breakups);
    catalogues.set(key, catalogue);
  }
  return catalogue;
}

const decaysByCatalogue = new WeakMap<Catalogue, Map<number, number>>();

/** The reentries the catalogue records, each body's decay day by catalogue number, as the detector takes them (`DetectorInput.decays`): it reads one only from its day on. */
export function decaysOf(catalogue: Catalogue): Map<number, number> {
  let decays = decaysByCatalogue.get(catalogue);
  if (decays === undefined) {
    decays = new Map();
    for (const body of catalogue.bodies.values()) if (body.decayMs !== null) decays.set(body.number, body.decayMs);
    decaysByCatalogue.set(catalogue, decays);
  }
  return decays;
}

/** One year replayed and matched: the file as it is written, and the replay's result for the next year to carry. */
export function replayAndScore(archive: string, year: number, truth: Truth, options: ScoreYearOptions = {}): { file: YearFile; result: ReplayResult } {
  const notices = options.notices ?? noticesOf(truth.breakups);
  const catalogue = options.catalogue ?? catalogueOf(archive, truth);
  const result = replayYear(archive, year, { ...options, notices, decays: options.decays ?? decaysOf(catalogue) });
  const score = matchYear(year, truth.breakups, result.verdicts, result.index, result.timeBasis, notices, { ...DETECTOR_PARAMETERS, ...options.parameters }, catalogue);
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

/** The states a year starts from when replayed alone: the file its predecessor's replay left in a states directory, with the predecessor's slice read afresh; undefined where there is none. */
export function carriedFromFile(archive: string, states: string, year: number): Carried | undefined {
  const path = join(states, statesFileName(year - 1));
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

/** What an approximate aggregate says of itself: that it is not exact, where its chunks' starting states came from, and the chunks. */
export interface Approximate {
  statesFrom: string;
  chunks: Chunk[];
}

/** The aggregate as written to `latest.json`: the sequential replay's exactly as aggregated, a parallel one's with its approximation stated. */
export function latestJson(latest: Latest, approximate?: Approximate): string {
  const stated = approximate === undefined ? latest : { exact: false, statesFrom: approximate.statesFrom, chunks: approximate.chunks.map((chunk) => ({ years: [chunk.years[0], chunk.years.at(-1)], startsFrom: chunk.startsFrom })), ...latest };
  return `${JSON.stringify(stated, null, 2)}\n`;
}

/** The aggregate over the year files in a directory, written beside them as `latest.json` and `latest.md`, with the per-event dissection written where `eventsPath` says (the committed one under `docs/detector/` for the committed results); an approximate aggregate says so at the head of both files. */
export function writeAggregate(dir: string, truth: Truth, root = ROOT, eventsPath = dir === KPI_DIR ? EVENTS_PATH : join(dir, "events.md"), approximate?: Approximate): Latest {
  const files = readYearFiles(dir);
  if (files.length === 0) throw new Error(`no year files under ${yearsDir(dir)}: run a year first`);
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string };
  const detectors = new Set(files.map((f) => f.detector.name));
  if (detectors.size > 1) throw new Error(`the year files were run with different detectors (${[...detectors].join(", ")}): rerun them`);
  const latest = aggregate(files, { package: { name: pkg.name, version: pkg.version }, truthSha256: truth.sha256, detector: files[0]!.detector });
  if (approximate !== undefined && dir === KPI_DIR) throw new Error("an approximate aggregate is never written to kpi/");
  writeFileSync(join(dir, "latest.json"), latestJson(latest, approximate));
  const rendered = renderLatest(latest);
  writeFileSync(join(dir, "latest.md"), approximate === undefined ? rendered : rendered.replace("\n", `\n\n> **${approximation(approximate.chunks, approximate.statesFrom)}**\n`));
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
  let parallel: number | null = null;
  let fromStates: string | null = null;
  // What a worker of a parallel replay is handed of this command's own arguments.
  const passed: string[] = [];
  const parameters: Partial<DetectorParameters> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--year") years.push(Number(args[++i]));
    else if (arg === "--all") all = true;
    else if (arg === "--aggregate") doAggregate = true;
    else if (arg === "--rematch") [doRematch, doAggregate] = [true, true];
    else if (arg === "--param") {
      parseParameter(args[++i]!, parameters);
      passed.push(arg, args[i]!);
    } else if (arg === "--parallel") parallel = Number(args[++i]);
    else if (arg === "--from-states") fromStates = resolve(args[++i]!);
    else if (arg === "--out") [dir, workDir] = [resolve(args[++i]!), join(resolve(args[i]!), "work")];
    else if (arg === "--detector") {
      const name = args[++i];
      passed.push(arg, name!);
      if (name === "jump") [detector, detectorName, dir, workDir] = [jumpDetector(), "jump", WORK_DIR, join(WORK_DIR, "jump")];
      else if (name !== "placeholder") throw new Error(`no detector named ${name}: placeholder or jump`);
    } else throw new Error(`usage: run.ts --year <year> [--year ...] | --all | --aggregate | --rematch [--detector placeholder|jump] [--param name=value ...] [--out <dir>] [--parallel <workers>] [--from-states <dir>]`);
  }
  // A replay with overridden parameters is a trial, never the committed result.
  if (Object.keys(parameters).length > 0 && dir === KPI_DIR) throw new Error("a replay with --param must also give --out: the committed results are the defaults'");
  // A replay from states another run left, in parallel or not, is an exploration, never the committed result.
  if ((parallel !== null || fromStates !== null) && dir === KPI_DIR) throw new Error("--parallel and --from-states must also give --out: the committed results and CI are the sequential replay's, and an exploration's are approximate");
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
  if (parallel !== null) {
    await replayInParallel(archive, truth, years, parallel, fromStates ?? statesDir(WORK_DIR), dir, workDir, passed);
    return;
  }
  // Each year starts from the states the one before ended with: the previous year of this command where it was replayed here, else its states file where a replay left one, else a warm-up.
  let carried: Carried | undefined;
  let carriedFrom: number | null = null;
  for (const year of years) {
    if (carriedFrom !== year - 1) carried = carriedFromFile(archive, fromStates ?? statesDir(workDir), year);
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

/** What a worker of a parallel replay may hold at its peak, in gigabytes: a recent year's columns, the states read from a file and written to one, and the catalogue (measured on 2024 to 2026). */
const WORKER_GIGABYTES = 7;

/** The years replayed in contiguous chunks by worker processes, each chunk after the first from the states under `statesFrom`, then the aggregate, stated approximate. */
async function replayInParallel(archive: string, truth: Truth, years: number[], workers: number, statesFrom: string, dir: string, workDir: string, passed: string[]): Promise<void> {
  if (years.length === 0) throw new Error("--parallel wants years: give --all or --year");
  // A chunk writing its states where the next chunk reads its own would race it.
  if (resolve(statesFrom) === resolve(statesDir(workDir))) throw new Error(`--from-states ${statesFrom} is where this replay writes its own states: give another directory, or another --out`);
  const chunks = chunksOf(years, years.map((year) => readManifest(archive, year).sets), workers);
  const missing = chunks.flatMap((chunk) => (chunk.startsFrom === null || hasStates(join(statesFrom, statesFileName(chunk.startsFrom))) ? [] : [join(statesFrom, statesFileName(chunk.startsFrom))]));
  if (missing.length > 0) throw new Error(`a parallel replay starts its chunks from the states a full sequential replay left, and ${missing.join(", ")} is missing: run \`npm run kpi -- --all\` (or into --out) first`);
  const named = relative(ROOT, statesFrom);
  const approximate: Approximate = { statesFrom: named.startsWith("..") ? statesFrom : named, chunks };
  const statement = approximation(chunks, approximate.statesFrom);
  console.log(statement);
  const needed = chunks.length * WORKER_GIGABYTES;
  if (needed * 2 ** 30 > totalmem()) console.log(`${chunks.length} workers may want ${needed} GB, more than this machine's ${Math.round(totalmem() / 2 ** 30)} GB: they will swap and may run slower than fewer would (or than the sequential replay)`);
  const started = performance.now();
  await runChunks(fileURLToPath(import.meta.url), chunks, (chunk) => [...passed, ...chunk.years.flatMap((year) => ["--year", String(year)]), "--out", dir, ...(chunk.startsFrom === null ? [] : ["--from-states", statesFrom])]);
  const latest = writeAggregate(dir, truth, ROOT, undefined, approximate);
  const headline = latest.splits.validation.lines["breakups A-B"];
  console.log(`${join(dir, "latest.json")}: ${latest.years.length} years in ${chunks.length} chunks, ${Math.round((performance.now() - started) / 1000)} s; validation headline ${headline.detected} of ${headline.targets} detected, ${latest.splits.validation.falseAlarms} false alarms`);
  console.log(statement);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("run.ts")) await main();
