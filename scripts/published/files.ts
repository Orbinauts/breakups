import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PUBLISHED_VERSION, type PublishedBreakup, type PublishedBreakupEntry, type PublishedBreakupFile, type PublishedBreakupsFile, type PublishedEvent, type PublishedReport, type PublishedStatusFile, type PublishedStep, type PublishedVerdict } from "../../src/index.ts";

/**
 * The published files under a checkout of the `published` branch:
 * `v1/breakups.json` (the list), `v1/breakups/<id>.json` (one per breakup,
 * its whole evidence) and `v1/status.json` (the last run). Each is written
 * with its keys in the order the types declare them, one space deep, with a
 * final newline, so a run that changes nothing changes no byte but the
 * status's.
 */

const versionDir = (dir: string): string => join(dir, `v${PUBLISHED_VERSION}`);
const listPath = (dir: string): string => join(versionDir(dir), "breakups.json");
const breakupsDir = (dir: string): string => join(versionDir(dir), "breakups");
const breakupPath = (dir: string, id: string): string => join(breakupsDir(dir), `${id}.json`);
const statusPath = (dir: string): string => join(versionDir(dir), "status.json");

const text = (value: unknown): string => JSON.stringify(value, null, 1) + "\n";

const stepOut = (s: PublishedStep | null): PublishedStep | null =>
  s === null ? null : { beforeEpoch: s.beforeEpoch, afterEpoch: s.afterEpoch, deltaKm: s.deltaKm, deltaPerigeeKm: s.deltaPerigeeKm, deltaApogeeKm: s.deltaApogeeKm, deltaInclinationDeg: s.deltaInclinationDeg, postSets: s.postSets, z: s.z };
const eventOut = (e: PublishedEvent | null): PublishedEvent | null => (e === null ? null : { at: e.at, from: e.from, to: e.to });
const reportOut = (r: PublishedReport): PublishedReport => ({ source: r.source, date: r.date, precision: r.precision, url: r.url });
const verdictOut = (v: PublishedVerdict): PublishedVerdict => ({ state: v.state, raisedAt: v.raisedAt, step: stepOut(v.step), event: eventOut(v.event), evidence: v.evidence, reasons: v.reasons, bodies: v.bodies, candidates: v.candidates });

function entryOf(b: PublishedBreakupEntry): PublishedBreakupEntry {
  const { catalogueNumber, designator, name, launchedOn } = b.parent;
  return { id: b.id, state: b.state, raisedAt: b.raisedAt, confirmedAt: b.confirmedAt, parent: { catalogueNumber, designator, name, launchedOn }, event: eventOut(b.event), step: stepOut(b.step), reasons: b.reasons, reports: b.reports.map(reportOut) };
}

function readVersioned<T extends { version: number }>(path: string): T {
  const file = JSON.parse(readFileSync(path, "utf8")) as T;
  if (file.version !== PUBLISHED_VERSION) throw new Error(`${path} is in version ${file.version}, not ${PUBLISHED_VERSION}`);
  return file;
}

/** The breakups published under a `published` checkout, in the list's order; none where the files were never written. */
export function readPublished(dir: string): PublishedBreakup[] {
  if (!existsSync(listPath(dir))) return [];
  return readVersioned<PublishedBreakupsFile>(listPath(dir)).breakups.map(({ id }) => {
    const { version, ...breakup } = readVersioned<PublishedBreakupFile>(breakupPath(dir, id));
    void version;
    return breakup;
  });
}

/** Writes the three files for these breakups and this run under a `published` checkout, removing the file of every breakup no longer listed. */
export function writePublished(dir: string, breakups: readonly PublishedBreakup[], status: Omit<PublishedStatusFile, "version">): void {
  mkdirSync(breakupsDir(dir), { recursive: true });
  const listed = new Set(breakups.map((b) => `${b.id}.json`));
  for (const name of readdirSync(breakupsDir(dir))) if (name.endsWith(".json") && !listed.has(name)) rmSync(join(breakupsDir(dir), name));
  for (const b of breakups) {
    const file: PublishedBreakupFile = { version: PUBLISHED_VERSION, ...entryOf(b), evidence: b.evidence, bodies: b.bodies, candidates: b.candidates, row: b.row, verdicts: b.verdicts.map(verdictOut) };
    writeFileSync(breakupPath(dir, b.id), text(file));
  }
  const list: PublishedBreakupsFile = { version: PUBLISHED_VERSION, breakups: breakups.map(entryOf) };
  writeFileSync(listPath(dir), text(list));
  const statusFile: PublishedStatusFile = { version: PUBLISHED_VERSION, ranAt: status.ranAt, setsThrough: status.setsThrough, detector: status.detector, truthSha256: status.truthSha256 };
  writeFileSync(statusPath(dir), text(statusFile));
}
