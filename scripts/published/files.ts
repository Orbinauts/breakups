import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PUBLISHED_VERSION, type PublishedBreakup, type PublishedBreakupEntry, type PublishedBreakupFile, type PublishedBreakupsFile, type PublishedEvent, type PublishedReport, type PublishedRowEvent, type PublishedStatusFile, type PublishedStep, type PublishedVerdict } from "../../src/index.ts";

/**
 * The published files under a checkout of the `published` branch:
 * `v2/breakups.json` (the list), `v2/breakups/<id>.json` (one per breakup,
 * its whole evidence) and `v2/status.json` (the last run). Each is written
 * with its keys in the order the types declare them, one space deep, with a
 * final newline, so a run that changes nothing changes no byte but the
 * status's. The first version's files, `v1/`, stay as their last run left
 * them: the first run of the second version reads them where it finds no
 * list of its own, and nothing writes them again.
 */

/** The directory a version's files sit under, on the `published` branch and on Pages alike: `v` and the version. */
const versionDirOf = (version: number): string => `v${version}`;

/** Whether a directory's name is a version's (`v1`, `v2`, ...), as `versionDirOf` names them. */
export const isVersionDir = (name: string): boolean => /^v[1-9]\d*$/.test(name);

/** The directory the published files sit under: this version's. */
export const PUBLISHED_DIR = versionDirOf(PUBLISHED_VERSION);

/** The paths of a version's files, under its directory (`at`). */
const listPath = (at: string): string => join(at, "breakups.json");
const breakupsDir = (at: string): string => join(at, "breakups");
const breakupPath = (at: string, id: string): string => join(breakupsDir(at), `${id}.json`);
const statusPath = (at: string): string => join(at, "status.json");

const text = (value: unknown): string => JSON.stringify(value, null, 1) + "\n";

/** A published step, estimate, row's event, report and verdict with their keys in the order the types declare them, whatever order they were built in. */
const inKeyOrderStep = (s: PublishedStep | null): PublishedStep | null =>
  s === null ? null : { beforeEpoch: s.beforeEpoch, afterEpoch: s.afterEpoch, deltaKm: s.deltaKm, deltaPerigeeKm: s.deltaPerigeeKm, deltaApogeeKm: s.deltaApogeeKm, deltaInclinationDeg: s.deltaInclinationDeg, postSets: s.postSets, z: s.z };
const inKeyOrderEvent = (e: PublishedEvent | null): PublishedEvent | null => (e === null ? null : { at: e.at, from: e.from, to: e.to });
const inKeyOrderRowEvent = (e: PublishedRowEvent | null): PublishedRowEvent | null => (e === null ? null : { at: e.at, from: e.from, to: e.to, precision: e.precision, source: e.source, row: e.row });
const inKeyOrderReport = (r: PublishedReport): PublishedReport => ({ source: r.source, date: r.date, precision: r.precision, url: r.url });
const inKeyOrderVerdict = (v: PublishedVerdict): PublishedVerdict => ({ state: v.state, raisedAt: v.raisedAt, step: inKeyOrderStep(v.step), event: inKeyOrderEvent(v.event), evidence: v.evidence, reasons: v.reasons, bodies: v.bodies, candidates: v.candidates });

function entryOf(b: PublishedBreakupEntry): PublishedBreakupEntry {
  const { catalogueNumber, designator, name, launchedOn } = b.parent;
  return { id: b.id, state: b.state, raisedAt: b.raisedAt, confirmedAt: b.confirmedAt, unreportedAt: b.unreportedAt, parent: { catalogueNumber, designator, name, launchedOn }, event: inKeyOrderEvent(b.event), rowEvent: inKeyOrderRowEvent(b.rowEvent), step: inKeyOrderStep(b.step), reasons: b.reasons, reports: b.reports.map(inKeyOrderReport) };
}

function readVersioned<T extends { version: number }>(path: string, version: number): T {
  const file = JSON.parse(readFileSync(path, "utf8")) as T;
  if (file.version !== version) throw new Error(`${path} is in version ${file.version}, not ${version}`);
  return file;
}

/** The breakups listed under a version's directory (`at`), each file in that version, in the list's order. */
function readListed(at: string, version: number): PublishedBreakup[] {
  return readVersioned<PublishedBreakupsFile>(listPath(at), version).breakups.map(({ id }) => {
    const { version: read, ...breakup } = readVersioned<PublishedBreakupFile>(breakupPath(at, id), version);
    void read;
    // Every file has carried the row's event since the one run that re-keyed the files written before it.
    if (breakup.rowEvent === undefined) throw new Error(`${breakupPath(at, id)}: ${id} carries no rowEvent; every published breakup has carried one since the run that re-keyed the files written before it`);
    return breakup;
  });
}

/**
 * The breakups published under a `published` checkout, in the list's
 * order; none where the files were never written. Before version 2's first
 * run, once, they are version 1's under `v1/`, so the list and its ids
 * carry over: none of them was unreported then.
 */
export function readPublished(dir: string): PublishedBreakup[] {
  const current = join(dir, PUBLISHED_DIR);
  if (existsSync(listPath(current))) return readListed(current, PUBLISHED_VERSION);
  const first = join(dir, versionDirOf(1));
  if (existsSync(listPath(first))) return readListed(first, 1).map((breakup) => ({ ...breakup, unreportedAt: null }));
  return [];
}

/** Writes the three files for these breakups and this run under a `published` checkout, removing the file of every breakup no longer listed. */
export function writePublished(dir: string, breakups: readonly PublishedBreakup[], status: Omit<PublishedStatusFile, "version">): void {
  const at = join(dir, PUBLISHED_DIR);
  mkdirSync(breakupsDir(at), { recursive: true });
  const listed = new Set(breakups.map((b) => `${b.id}.json`));
  for (const name of readdirSync(breakupsDir(at))) if (name.endsWith(".json") && !listed.has(name)) rmSync(join(breakupsDir(at), name));
  for (const b of breakups) {
    const file: PublishedBreakupFile = { version: PUBLISHED_VERSION, ...entryOf(b), evidence: b.evidence, bodies: b.bodies, candidates: b.candidates, row: b.row, verdicts: b.verdicts.map(inKeyOrderVerdict) };
    writeFileSync(breakupPath(at, b.id), text(file));
  }
  const list: PublishedBreakupsFile = { version: PUBLISHED_VERSION, breakups: breakups.map(entryOf) };
  writeFileSync(listPath(at), text(list));
  const statusFile: PublishedStatusFile = { version: PUBLISHED_VERSION, ranAt: status.ranAt, setsThrough: status.setsThrough, detector: status.detector, truthSha256: status.truthSha256 };
  writeFileSync(statusPath(at), text(statusFile));
}
