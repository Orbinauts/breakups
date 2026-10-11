import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { readBreakups, type Breakup, type Verdict } from "../../src/index.ts";
import { archiveHome, readBodies } from "../archive/archive.ts";
import type { YearFile } from "../kpi/kpi.ts";
import { overlaps } from "../kpi/match.ts";
import { readYearFile } from "../prospective/run.ts";
import { selectPublished, type BodyIdentity, type BodyOf } from "./select.ts";

/**
 * The regression fixtures of the published lists on the real replays,
 * which `scripts/published/real-lists.test.ts` runs the selection on with
 * no Archive and no year file. A year file holds every verdict the frozen
 * detector raised over a year, some four thousand, and weighs tens of
 * megabytes with its log; a fixture keeps what the selection reads of it:
 *
 * - every suspected and confirmed object verdict, the ones that can land
 *   on a reported breakup;
 * - the expired and dismissed verdicts on the same object whose step
 *   overlaps one of theirs, which decide whether a suspected breakup has
 *   left;
 *
 * in the order raised, and the catalogue's identity (designator, name,
 * launch day) of the bodies the selection asks for, from the Archive's
 * body table of that year. Every other verdict (watch, scoped, manoeuvre,
 * cloud-only, a cloud's, a step let go that was never suspected) changes
 * nothing the selection does, and the script checks it: the selection on
 * the fixture must equal the selection on the whole year file, landed on
 * the ground truth as committed, or no fixture is written.
 *
 * Provenance: the year, the detector's name, the Archive's build time and
 * how many verdicts the year file held. Regenerate with
 *
 *     npm run published:fixtures -- --year-file <year file> [--year-file <year file> ...] [--archive <dir>]
 *
 * where a year file is the frozen detector's replay of a year (`npm run kpi
 * -- --year <Y>` writes `<out>/years/<Y>.json.gz`; the live test's daily
 * replay writes one too). It writes `test/fixtures/published/<year>.json.gz`.
 */

/** A year's regression fixture of the published list. */
export interface PublishedFixture {
  year: number;
  /** The name of the detector that raised the verdicts. */
  detector: string;
  /** When the Archive the year was replayed over was built. */
  archiveBuiltAt: string;
  /** How many verdicts the year file held, of every state. */
  verdictsInYear: number;
  /** The verdicts the selection reads, in the order raised. */
  verdicts: Verdict[];
  /** The catalogue's identity of each body the selection asks for, by catalogue number. */
  bodies: Record<string, BodyIdentity>;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The verdicts of a year the selection reads: suspected and confirmed object verdicts, and the expired and dismissed ones whose step overlaps one of theirs on the same object. */
export function verdictsRead(verdicts: readonly Verdict[]): Verdict[] {
  const alerts = verdicts.filter((verdict) => verdict.kind === "object" && verdict.number !== null && (verdict.state === "suspected" || verdict.state === "confirmed"));
  const onAlertStep = (verdict: Verdict): boolean => verdict.step !== null && alerts.some((alert) => alert.number === verdict.number && alert.step !== null && overlaps(alert.step, verdict.step!));
  return verdicts.filter((verdict) => alerts.includes(verdict) || (verdict.kind === "object" && (verdict.state === "expired" || verdict.state === "dismissed") && onAlertStep(verdict)));
}

/** A year's fixture from its year file, the ground truth and the catalogue's lookup; throws where the selection on the fixture differs from the selection on the whole year. */
export function fixtureOf(file: YearFile, breakups: readonly Breakup[], bodyOf: BodyOf): PublishedFixture {
  const bodies: Record<string, BodyIdentity> = {};
  const recording: BodyOf = (number) => {
    const body = bodyOf(number);
    if (body !== undefined) bodies[String(number)] = { designator: body.designator, name: body.name, launch: body.launch };
    return body;
  };
  const whole = selectPublished(file.verdicts, breakups, recording);
  const verdicts = verdictsRead(file.verdicts);
  const fixture: PublishedFixture = { year: file.year, detector: file.detector.name, archiveBuiltAt: file.archive.builtAt, verdictsInYear: file.verdicts.length, verdicts, bodies };
  const trimmed = selectPublished(verdicts, breakups, (number) => bodies[String(number)]);
  if (!isDeepStrictEqual(trimmed, whole)) throw new Error(`${file.year}: the selection on the trimmed verdicts differs from the selection on the whole year`);
  return fixture;
}

function main(): void {
  const { values } = parseArgs({ options: { "year-file": { type: "string", multiple: true }, archive: { type: "string" } } });
  const paths = values["year-file"] ?? [];
  if (paths.length === 0) throw new Error("usage: npm run published:fixtures -- --year-file <year file> [--year-file ...] [--archive <dir>]");
  const archive = values.archive === undefined ? archiveHome() : resolve(values.archive);
  const breakups = readBreakups(JSON.parse(readFileSync(resolve(ROOT, "data/breakups.json"), "utf8")));
  const out = resolve(ROOT, "test/fixtures/published");
  mkdirSync(out, { recursive: true });
  for (const path of paths) {
    const file = readYearFile(path);
    const table = new Map(readBodies(archive, file.year).map((body) => [body.number, body]));
    const fixture = fixtureOf(file, breakups, (number) => table.get(number));
    const target = resolve(out, `${file.year}.json.gz`);
    writeFileSync(target, gzipSync(JSON.stringify(fixture), { level: 9 }));
    console.log(`${target}: ${fixture.verdicts.length} of ${fixture.verdictsInYear} verdicts, ${Object.keys(fixture.bodies).length} bodies (${fixture.detector})`);
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("real-fixtures.ts")) main();
