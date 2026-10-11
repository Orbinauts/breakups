import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { readBreakups } from "../../src/index.ts";
import { readBodies, readManifest, type ArchivedBody } from "../archive/archive.ts";
import { readYearFile, throughOf } from "../prospective/run.ts";
import { readPublished, writePublished } from "./files.ts";
import { mergePublished } from "./merge.ts";
import { selectPublished } from "./select.ts";

/**
 * The published files brought up to date by one replay: its year files'
 * verdicts selected against the ground truth, merged into what a checkout
 * of the `published` branch already holds, and written back there.
 *
 *   npm run published -- --year-file <Y.json.gz> [--year-file ...] --truth data/breakups.json --out <published checkout> --archive <Archive>
 *
 * Each year file is one the frozen detector's replay wrote (`<out>/years/<Y>.json.gz`),
 * carried from the states at the end of the year before; in early January a
 * run passes both years. The Archive gives the catalogue's identity of the
 * parents the truth does not name, from each year's body table, and the last
 * day of sets the replay read, from the latest year's manifest. It commits
 * nothing.
 */

export interface PublishedRunOptions {
  /** The replay's year files, in any order. */
  yearFiles: readonly string[];
  /** The ground truth's file, main's `data/breakups.json`. */
  truth: string;
  /** The checkout of the `published` branch the files are read from and written to. */
  out: string;
  /** The Archive the replay read. */
  archive: string;
  /** When the job runs, in milliseconds. */
  now: number;
}

/** Selects, merges and writes the published files for one replay, and returns a line saying what it did. */
export function publishedRun(options: PublishedRunOptions): string {
  if (options.yearFiles.length === 0) throw new Error("no year file to publish from");
  const files = options.yearFiles.map((path) => ({ path, file: readYearFile(path) })).sort((a, b) => a.file.year - b.file.year);
  const detectors = [...new Set(files.map(({ file }) => file.detector.name))];
  if (detectors.length > 1) throw new Error(`the year files come from two detectors: ${detectors.join(" and ")}`);
  const uncarried = files.find(({ file }) => !file.carried);
  if (uncarried !== undefined) throw new Error(`${uncarried.path} was not carried from the states at the end of ${uncarried.file.year - 1}, so it is not the detector's run`);
  const verdicts = files.flatMap(({ file }) => file.verdicts);

  const truthBytes = readFileSync(options.truth);
  const truthSha256 = createHash("sha256").update(truthBytes).digest("hex");
  const breakups = readBreakups(JSON.parse(truthBytes.toString("utf8")));

  const bodies = new Map<number, ArchivedBody>();
  for (const { file } of files) for (const body of readBodies(options.archive, file.year)) bodies.set(body.number, body);
  const latestYear = files[files.length - 1]!.file.year;
  const setsThrough = throughOf(readManifest(options.archive, latestYear).source, latestYear);

  const previous = readPublished(options.out);
  const merged = mergePublished(previous, selectPublished(verdicts, breakups, (number) => bodies.get(number)), verdicts);
  const detector = detectors[0]!;
  writePublished(options.out, merged, { ranAt: new Date(options.now).toISOString(), setsThrough, detector, truthSha256 });

  const before = new Set(previous.map((b) => b.id));
  const after = new Set(merged.map((b) => b.id));
  const confirmed = merged.filter((b) => b.state === "confirmed").length;
  const added = merged.filter((b) => !before.has(b.id)).length;
  const left = previous.filter((b) => !after.has(b.id)).length;
  return `published ${merged.length} breakup${merged.length === 1 ? "" : "s"} (${confirmed} confirmed, ${merged.length - confirmed} suspected): ${added} new, ${left} left; sets through ${setsThrough}, detector ${detector}, truth ${truthSha256.slice(0, 12)}`;
}

function main(): void {
  const { values } = parseArgs({
    options: { "year-file": { type: "string", multiple: true }, truth: { type: "string" }, out: { type: "string" }, archive: { type: "string" } },
    strict: true,
  });
  const yearFiles = values["year-file"] ?? [];
  const { truth, out, archive } = values;
  if (yearFiles.length === 0 || truth === undefined || out === undefined || archive === undefined) {
    throw new Error("usage: npm run published -- --year-file <Y.json.gz> [--year-file ...] --truth <data/breakups.json> --out <published checkout> --archive <Archive>");
  }
  console.log(publishedRun({ yearFiles, truth, out, archive, now: Date.now() }));
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("published/cli.ts")) {
  try {
    main();
  } catch (error) {
    console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
