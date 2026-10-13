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

/** The directory the published files sit under, on the `published` branch and on Pages alike: `v` and the files' version. */
export const PUBLISHED_DIR = `v${PUBLISHED_VERSION}`;

/** The version before this one, whose files the first run of this version carries over. */
const PREVIOUS_VERSION = PUBLISHED_VERSION - 1;

const versionDir = (dir: string, version = PUBLISHED_VERSION): string => join(dir, `v${version}`);
const listPath = (dir: string, version = PUBLISHED_VERSION): string => join(versionDir(dir, version), "breakups.json");
const breakupsDir = (dir: string, version = PUBLISHED_VERSION): string => join(versionDir(dir, version), "breakups");
const breakupPath = (dir: string, id: string, version = PUBLISHED_VERSION): string => join(breakupsDir(dir, version), `${id}.json`);
const statusPath = (dir: string): string => join(versionDir(dir), "status.json");

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

/** The breakups listed under one version's directory, in the list's order. A breakup of the first version has no unreported day: none was unreported then. */
function readVersion(dir: string, version: number): PublishedBreakup[] {
  return readVersioned<PublishedBreakupsFile>(listPath(dir, version), version).breakups.map(({ id }) => {
    const { version: read, ...breakup } = readVersioned<PublishedBreakupFile>(breakupPath(dir, id, version), version);
    void read;
    // Every file has carried the row's event since the one run that re-keyed the files written before it.
    if (breakup.rowEvent === undefined) throw new Error(`${breakupPath(dir, id, version)}: ${id} carries no rowEvent; every published breakup has carried one since the run that re-keyed the files written before it`);
    return { ...breakup, unreportedAt: breakup.unreportedAt ?? null };
  });
}

/**
 * The breakups published under a `published` checkout, in the list's
 * order: this version's, else, before this version's first run, the
 * version before's, so the list and its ids carry over; none where neither
 * was ever written.
 */
export function readPublished(dir: string): PublishedBreakup[] {
  if (existsSync(listPath(dir))) return readVersion(dir, PUBLISHED_VERSION);
  if (PREVIOUS_VERSION >= 1 && existsSync(listPath(dir, PREVIOUS_VERSION))) return readVersion(dir, PREVIOUS_VERSION);
  return [];
}

/** Writes the three files for these breakups and this run under a `published` checkout, removing the file of every breakup no longer listed. */
export function writePublished(dir: string, breakups: readonly PublishedBreakup[], status: Omit<PublishedStatusFile, "version">): void {
  mkdirSync(breakupsDir(dir), { recursive: true });
  const listed = new Set(breakups.map((b) => `${b.id}.json`));
  for (const name of readdirSync(breakupsDir(dir))) if (name.endsWith(".json") && !listed.has(name)) rmSync(join(breakupsDir(dir), name));
  for (const b of breakups) {
    const file: PublishedBreakupFile = { version: PUBLISHED_VERSION, ...entryOf(b), evidence: b.evidence, bodies: b.bodies, candidates: b.candidates, row: b.row, verdicts: b.verdicts.map(inKeyOrderVerdict) };
    writeFileSync(breakupPath(dir, b.id), text(file));
  }
  const list: PublishedBreakupsFile = { version: PUBLISHED_VERSION, breakups: breakups.map(entryOf) };
  writeFileSync(listPath(dir), text(list));
  const statusFile: PublishedStatusFile = { version: PUBLISHED_VERSION, ranAt: status.ranAt, setsThrough: status.setsThrough, detector: status.detector, truthSha256: status.truthSha256 };
  writeFileSync(statusPath(dir), text(statusFile));
}
