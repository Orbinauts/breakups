import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveHome } from "../archive/archive.ts";
import { gitOutput } from "../git.ts";
import type { Latest } from "../kpi/kpi.ts";
import { GENERATED_PARTS, markedPart, RESULTS } from "../kpi/pages.ts";
import type { SnapshotRecord } from "../truth/fetch-sources.ts";
import { BODY_LIMIT } from "./github.ts";
import { readPromoted, type Promoted } from "./promote.ts";

/**
 * What a maintenance run changed, as its pull request and its commit say
 * it: `npm run maintenance:pr -- --base <commit> --out <dir>`, run in the
 * checkout once every check has passed. It compares the files the run may
 * change with the base commit's: the sources it fetched with their hashes,
 * the truth's events added, removed or changed by id, the scorecard's
 * cells that moved with their old and new values, the generated parts of
 * the README and the documentation pages, and the year promoted into the
 * Archive; and it gives the
 * prospective score's summary. It writes `title.txt`, `body.md` (the pull
 * request's) and `message.txt` (the commit's and the squash merge's body,
 * prose with no trailer) into the directory given.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The sources record as `data/truth/sources.json` holds it. */
export interface SourcesRecord {
  snapshots: Record<string, SnapshotRecord>;
}

/** A source whose snapshot the run refreshed: its record before (absent for a new source) and after. */
export interface SourceChange {
  id: string;
  before: SnapshotRecord | null;
  after: SnapshotRecord;
}

/** The sources whose record changed, in the record's order. */
export function sourceChanges(before: SourcesRecord, after: SourcesRecord): SourceChange[] {
  return Object.entries(after.snapshots)
    .filter(([id, record]) => JSON.stringify(before.snapshots[id] ?? null) !== JSON.stringify(record))
    .map(([id, record]) => ({ id, before: before.snapshots[id] ?? null, after: record }));
}

/** A truth row as the comparison reads it: its id, its parent's name, and every field. */
export interface TruthRow {
  id: string;
  parent: { name: string };
  [field: string]: unknown;
}

export interface TruthChanges {
  added: TruthRow[];
  removed: TruthRow[];
  /** The rows of an id present before and after whose fields differ, with the fields that do. */
  changed: { row: TruthRow; fields: string[] }[];
}

/** The truth's events added, removed and changed, by id. */
export function truthChanges(before: readonly TruthRow[], after: readonly TruthRow[]): TruthChanges {
  const old = new Map(before.map((row) => [row.id, row]));
  const now = new Map(after.map((row) => [row.id, row]));
  const changed: TruthChanges["changed"] = [];
  for (const row of after) {
    const was = old.get(row.id);
    if (was === undefined) continue;
    const fields = [...new Set([...Object.keys(was), ...Object.keys(row)])].filter((field) => JSON.stringify(was[field]) !== JSON.stringify(row[field]));
    if (fields.length > 0) changed.push({ row, fields });
  }
  return { added: after.filter((row) => !old.has(row.id)), removed: before.filter((row) => !now.has(row.id)), changed };
}

/** A cell of the aggregate that moved: its path and its values before and after. */
export interface Move {
  path: string;
  before: string;
  after: string;
}

/** A leaf as a cell shows it: numbers to four decimals at most, arrays of leaves on one line. */
function show(value: unknown): string {
  if (value === undefined) return "absent";
  if (typeof value === "number") return String(Math.round(value * 1e4) / 1e4);
  if (Array.isArray(value) && value.every((item) => item === null || typeof item !== "object")) return `[${value.map(show).join(", ")}]`;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The leaves of a value by path, an array of leaves kept whole. */
function leaves(value: unknown, path: string, into: Map<string, string>): Map<string, string> {
  if (value !== null && typeof value === "object" && !(Array.isArray(value) && value.every((item) => item === null || typeof item !== "object"))) {
    for (const [key, child] of Object.entries(value)) leaves(child, path === "" ? key : `${path}.${key}`, into);
  } else into.set(path, show(value));
  return into;
}

/** The aggregate's cells that moved, in the order of the new aggregate, then those it no longer has. */
export function kpiMoves(before: Latest | null, after: Latest): Move[] {
  const old = leaves(before ?? {}, "", new Map());
  const now = leaves(after, "", new Map());
  const moves: Move[] = [];
  for (const [path, value] of now) if (old.get(path) !== value) moves.push({ path, before: old.get(path) ?? "absent", after: value });
  for (const [path, value] of old) if (!now.has(path)) moves.push({ path, before: value, after: "absent" });
  return moves;
}

/** The generated parts of a page whose content changed. */
export function changedParts(before: string, after: string, names: readonly string[]): string[] {
  const part = (text: string, name: string): string | null => {
    try {
      return markedPart(text, name);
    } catch {
      return null;
    }
  };
  return names.filter((name) => part(before, name) !== part(after, name));
}

/** Everything a maintenance run's pull request reports. */
export interface RunReport {
  date: string;
  runUrl: string | null;
  sources: SourceChange[];
  truth: TruthChanges;
  /** Why the scorecard was replayed, or empty where it was not. */
  rescored: string;
  moves: Move[];
  /** The generated parts that changed, on every page that holds them. */
  generated: string[];
  promoted: Promoted | null;
  prospective: string;
  /** A branch the run folded in (`-f from=<branch>`), with the subjects of its commits; null where none was. */
  folded: { branch: string; commits: string[] } | null;
  /** Every file the run changed, as git names it. */
  files: string[];
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const named = (row: TruthRow): string => `\`${row.id}\` ${row.parent.name}`;
const shortHash = (hash: string | undefined): string => (hash === undefined ? "none" : `\`${hash.slice(0, 12)}\``);

/** How many cells of moves the body lists before it says how many more there are. */
export const MOVES_SHOWN = 120;

/** The pull request's title: the day, and what changed. */
export function prTitle(report: RunReport): string {
  const parts = [report.folded === null ? null : `${report.folded.branch} folded in`, report.sources.length > 0 ? "sources refreshed" : null, report.truth.added.length + report.truth.removed.length + report.truth.changed.length > 0 ? "truth updated" : null, report.promoted === null ? null : `${report.promoted.year} promoted`, report.rescored !== "" ? "scorecard replayed" : null, report.generated.includes("prospective:score") ? "prospective score" : null].filter((part) => part !== null);
  return `Maintenance of ${report.date}: ${parts.length === 0 ? "generated files brought up to date" : parts.join(", ")}`;
}

/** The commit's body, and the squash merge's: what changed and why, in sentences, with no trailer. */
export function commitMessage(report: RunReport): string {
  const sentences: string[] = [];
  if (report.folded !== null) sentences.push(`The branch ${report.folded.branch} is folded in: ${report.folded.commits.length === 0 ? "it adds no commit of its own" : report.folded.commits.map((subject) => subject.replace(/\.?$/, "")).join("; ")}.`);
  if (report.sources.length > 0) sentences.push(`The weekly fetch found a new edition of ${report.sources.map((s) => s.id).join(", ")}, and the snapshots and their hashes in data/truth/sources.json are refreshed.`);
  const { added, removed, changed } = report.truth;
  if (added.length + removed.length + changed.length > 0) sentences.push(`The truth rebuilt from them has ${plural(added.length, "event", "events")} added, ${removed.length} removed and ${changed.length} changed${added.length > 0 ? ` (added: ${added.slice(0, 10).map((row) => row.id).join(", ")}${added.length > 10 ? ", and more" : ""})` : ""}.`);
  if (report.promoted !== null) sentences.push(`The closed year ${report.promoted.year} is promoted into the Archive from the prospective test's day slices, ${report.promoted.days} days and ${report.promoted.sets} sets through ${report.promoted.through}.`);
  if (report.rescored !== "") sentences.push(`The scorecard was replayed over every year because ${report.rescored}, and ${plural(report.moves.length, "cell", "cells")} of kpi/latest.json moved.`);
  if (report.generated.length > 0) sentences.push(`The generated parts ${report.generated.join(", ")} of the README and the documentation pages follow.`);
  sentences.push(`Every check ran before the merge: the typecheck, the tests and the documentation build${report.runUrl === null ? "" : `, in ${report.runUrl}`}.`);
  return sentences.join(" ");
}

/** The pull request's body: what changed and why, part by part. */
export function prBody(report: RunReport): string {
  const lines = [`The weekly maintenance run of ${report.date}${report.runUrl === null ? "" : ` ([the run](${report.runUrl}))`}. Every check (typecheck, tests, documentation build) passed on this tree before the pull request was opened; CI and the KPI workflow run again on main after the merge.`, ""];
  if (report.folded !== null) lines.push("## The branch folded in", "", `\`${report.folded.branch}\`, asked for by the run, with its commits:`, "", ...(report.folded.commits.length === 0 ? ["- none of its own"] : report.folded.commits.map((subject) => `- ${subject}`)), "");
  lines.push("## Sources", "");
  if (report.sources.length === 0) lines.push("No source the weekly fetch reads had a new edition.");
  else {
    lines.push("| Source | Fetched on | Original sha256 | Snapshot sha256 |", "| --- | --- | --- | --- |");
    for (const s of report.sources) lines.push(`| ${s.id} | ${s.before?.fetchedOn ?? "new"} → ${s.after.fetchedOn} | ${shortHash(s.before?.originalSha256)} → ${shortHash(s.after.originalSha256)} | ${shortHash(s.before?.snapshotSha256)} → ${shortHash(s.after.snapshotSha256)} |`);
  }
  lines.push("", "## The truth", "");
  const { added, removed, changed } = report.truth;
  if (added.length + removed.length + changed.length === 0) lines.push("`data/breakups.json` has no event added, removed or changed.");
  else {
    if (added.length > 0) lines.push(`Added (${added.length}):`, "", ...added.map((row) => `- ${named(row)}`), "");
    if (removed.length > 0) lines.push(`Removed (${removed.length}):`, "", ...removed.map((row) => `- ${named(row)}`), "");
    if (changed.length > 0) lines.push(`Changed (${changed.length}):`, "", ...changed.map(({ row, fields }) => `- ${named(row)}: ${fields.join(", ")}`), "");
    lines.push("`docs/truth.md` is rebuilt with it.");
  }
  if (report.promoted !== null) {
    const p = report.promoted;
    lines.push("", "## The Archive", "", `${p.year} is promoted from the prospective test's day slices (\`history-${p.year}.tar\` of the release \`prospective-data\`): ${p.days} days from ${p.from} through ${p.through}, ${p.sets} sets of ${p.bodies} objects, a tarball of ${(p.tarballBytes / 1e6).toFixed(0)} MB, built at ${p.builtAt}. It is uploaded as \`archive-v1-${p.year}.tar\` with the side files and the manifest, and the catalogue index is rebuilt over every year.`);
  }
  lines.push("", "## The scorecard", "");
  if (report.rescored === "") lines.push("Not replayed: the committed aggregate describes the truth and the Archive as they stand.");
  else {
    lines.push(`Replayed over every year of the Archive, in order, because ${report.rescored}.`, "");
    if (report.moves.length === 0) lines.push("No cell of `kpi/latest.json` moved.");
    else {
      lines.push(`${plural(report.moves.length, "cell", "cells")} of \`kpi/latest.json\` moved:`, "", "| Cell | Before | After |", "| --- | --- | --- |");
      for (const move of report.moves.slice(0, MOVES_SHOWN)) lines.push(`| \`${move.path}\` | ${move.before} | ${move.after} |`);
      if (report.moves.length > MOVES_SHOWN) lines.push("", `And ${report.moves.length - MOVES_SHOWN} more; the diff of \`kpi/latest.json\` has them all.`);
    }
  }
  lines.push("", "## The README and the documentation pages", "", report.generated.length === 0 ? "No generated part changed." : `Generated parts rewritten: ${report.generated.map((name) => `\`${name}\``).join(", ")}.`);
  lines.push("", "## The prospective test", "", report.prospective, "");
  lines.push("## Files", "", ...report.files.map((file) => `- \`${file}\``), "");
  const body = lines.join("\n");
  return body.length <= BODY_LIMIT ? body : `${body.slice(0, BODY_LIMIT - 200)}\n\nThe body is cut here to fit; the diff has the rest.\n`;
}

const git = (...args: string[]): string => gitOutput(ROOT, ...args);

/** A file as the base commit has it, or null where it has none. */
function atBase(base: string, path: string): string | null {
  try {
    return git("show", `${base}:${path}`);
  } catch {
    return null;
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const base = option("--base") ?? "HEAD";
  const out = resolve(option("--out") ?? ".");
  const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
  // The files that differ from the base: those committed by a branch folded in, those changed in the tree, and those new.
  const files = [...new Set([...git("diff", "--name-only", base).split("\n"), ...git("ls-files", "--others", "--exclude-standard").split("\n")])].filter((line) => line.trim() !== "").sort();
  const truthRows = (text: string | null): TruthRow[] => (text === null ? [] : (JSON.parse(text) as { breakups: TruthRow[] }).breakups);
  const latestBefore = atBase(base, "kpi/latest.json");
  const report: RunReport = {
    date: new Date().toISOString().slice(0, 10),
    runUrl: process.env.RUN_URL ?? null,
    sources: sourceChanges(JSON.parse(atBase(base, "data/truth/sources.json") ?? '{"snapshots":{}}') as SourcesRecord, JSON.parse(read("data/truth/sources.json")) as SourcesRecord),
    truth: truthChanges(truthRows(atBase(base, "data/breakups.json")), truthRows(read("data/breakups.json"))),
    rescored: process.env.RESCORE_REASONS ?? "",
    moves: kpiMoves(latestBefore === null ? null : (JSON.parse(latestBefore) as Latest), JSON.parse(read("kpi/latest.json")) as Latest),
    generated: Object.entries(GENERATED_PARTS).flatMap(([page, names]) => changedParts(atBase(base, page) ?? "", read(page), names)),
    promoted: existsSync(archiveHome()) ? readPromoted(archiveHome()) : null,
    prospective: markedPart(read(RESULTS), "prospective:score"),
    folded: process.env.FROM === undefined || process.env.FROM === "" ? null : { branch: process.env.FROM, commits: git("log", "--no-merges", "--reverse", "--format=%s", `${base}..HEAD`).split("\n").filter((line) => line !== "") },
    files,
  };
  writeFileSync(join(out, "title.txt"), `${prTitle(report)}\n`);
  writeFileSync(join(out, "body.md"), prBody(report));
  writeFileSync(join(out, "message.txt"), `${commitMessage(report)}\n`);
  console.log(prTitle(report));
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("pr-body.ts")) main();
