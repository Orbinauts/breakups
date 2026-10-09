import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DETECTOR_NAME, DETECTOR_PARAMETERS, readBreakups, type Breakup } from "../../src/index.ts";
import { archiveHome, builtYears } from "../archive/archive.ts";
import { jumpDetector } from "./jump.ts";
import { aggregate, renderLatest, type Latest, type YearFile } from "./kpi.ts";
import { matchYear, noticesOf } from "./match.ts";
import { replayYear, type Detector, type ReplayOptions } from "./replay.ts";

/**
 * The scorecard's command: `npm run kpi:year -- --year 2013` replays one
 * year of the Archive through the detector, matches it against the truth
 * and writes `kpi/years/2013.json`; `npm run kpi -- --aggregate` folds
 * every year file into `kpi/latest.json` and `kpi/latest.md`; `npm run
 * kpi -- --all` does both over every built year. `--detector jump` runs
 * the trivial step detector instead of the library's, for timing and for
 * trying the rules, and writes under `kpi/work/` so the committed results
 * are never the trivial detector's.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const KPI_DIR = join(ROOT, "kpi");

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
}

/** One year replayed and matched: the file as it is written. */
export function scoreYear(archive: string, year: number, truth: Truth, options: ScoreYearOptions = {}): YearFile {
  const notices = options.notices ?? noticesOf(truth.breakups);
  const result = replayYear(archive, year, { ...options, notices });
  const score = matchYear(year, truth.breakups, result.verdicts, result.index, result.timeBasis, notices);
  return {
    format: 1,
    year,
    archive: { source: result.manifest.source.kind, builtAt: result.manifest.builtAt, sets: result.manifest.sets, bodies: result.manifest.bodies },
    detector: { name: options.detectorName ?? DETECTOR_NAME, parameters: { ...DETECTOR_PARAMETERS, ...options.parameters } },
    timeBasis: result.timeBasis,
    runs: result.runs,
    sets: result.sets,
    warmup: result.warmup,
    bodyYears: result.bodyYears,
    replaySeconds: Math.round(result.seconds * 10) / 10,
    score,
    verdicts: result.verdicts,
    log: result.log,
  };
}

export const yearsDir = (dir: string): string => join(dir, "years");

export function writeYearFile(dir: string, file: YearFile): string {
  mkdirSync(yearsDir(dir), { recursive: true });
  const path = join(yearsDir(dir), `${file.year}.json`);
  writeFileSync(path, `${JSON.stringify(file)}\n`);
  return path;
}

export function readYearFiles(dir: string): YearFile[] {
  if (!existsSync(yearsDir(dir))) return [];
  return readdirSync(yearsDir(dir))
    .filter((name) => /^\d{4}\.json$/.test(name))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(yearsDir(dir), name), "utf8")) as YearFile);
}

/** The aggregate over the year files in a directory, written beside them as `latest.json` and `latest.md`. */
export function writeAggregate(dir: string, truth: Truth, root = ROOT): Latest {
  const files = readYearFiles(dir);
  if (files.length === 0) throw new Error(`no year files under ${yearsDir(dir)}: run a year first`);
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string };
  const detectors = new Set(files.map((f) => f.detector.name));
  if (detectors.size > 1) throw new Error(`the year files were run with different detectors (${[...detectors].join(", ")}): rerun them`);
  const latest = aggregate(files, { package: { name: pkg.name, version: pkg.version }, truthSha256: truth.sha256, detector: files[0]!.detector });
  writeFileSync(join(dir, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);
  writeFileSync(join(dir, "latest.md"), renderLatest(latest));
  return latest;
}

function summary(file: YearFile): string {
  const events = file.score.events;
  const count = (status: string): number => events.filter((e) => e.status === status).length;
  const alerts = (outcome: string): number => file.score.alerts.filter((a) => a.outcome === outcome).length;
  return `${file.year}: ${file.sets} sets in ${file.runs} runs${file.warmup === null ? "" : ` after ${file.warmup.runs} of ${file.warmup.year}`}, ${file.replaySeconds} s; targets ${events.length - count("undetectable")} (undetectable ${count("undetectable")}): detected ${count("detected")}, late ${count("late")}, missed ${count("missed")}; alerts ${file.score.alerts.length}: false alarms ${alerts("false-alarm")}, duplicates ${alerts("duplicate")}, exempt ${alerts("exempt")}; review ${file.score.review.length}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const years: number[] = [];
  let all = false;
  let doAggregate = false;
  let detector: Detector | undefined;
  let detectorName: string | undefined;
  let dir = KPI_DIR;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--year") years.push(Number(args[++i]));
    else if (arg === "--all") all = true;
    else if (arg === "--aggregate") doAggregate = true;
    else if (arg === "--detector") {
      const name = args[++i];
      if (name === "jump") [detector, detectorName, dir] = [jumpDetector(), "jump", join(KPI_DIR, "work")];
      else if (name !== "placeholder") throw new Error(`no detector named ${name}: placeholder or jump`);
    } else throw new Error(`usage: run.ts --year <year> [--year ...] | --all | --aggregate [--detector placeholder|jump]`);
  }
  const archive = archiveHome();
  const truth = readTruth();
  if (all) years.push(...builtYears(archive));
  if (years.length === 0 && !doAggregate) throw new Error("nothing to do: give --year, --all or --aggregate");
  for (const year of years) {
    const file = scoreYear(archive, year, truth, { detector, detectorName });
    writeYearFile(dir, file);
    console.log(summary(file));
  }
  if (all || doAggregate) {
    const latest = writeAggregate(dir, truth);
    const headline = latest.splits.validation.lines["breakups A-B"];
    console.log(`${join(dir, "latest.json")}: ${latest.years.length} years; validation headline ${headline.detected} of ${headline.targets} detected, ${latest.splits.validation.falseAlarms} false alarms`);
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("run.ts")) await main();
