import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/**
 * Pruning `kpi/work/`, where the exploring replays (`npm run kpi -- --out
 * kpi/work/<name>`) and the sweeps leave their output: gitignored, and
 * tens of gigabytes after a phase of fitting. `npm run kpi:prune -- --keep
 * N` keeps the N replay directories last written (by the directory's
 * modification time) and removes the others, each with the log of its
 * name beside it (`<name>.log`). It never removes `states/`, the carried
 * states the parallel replays start from, nor a loose file (a log of no
 * directory, `scope-orbits.json`, `early-warnings.json.gz`): those are
 * small, or read by other commands. `--dry-run` prints what it would
 * remove and removes nothing.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The directories under the work directory that are never pruned: the states the parallel replays start from. */
export const KEPT_ALWAYS = ["states"] as const;

/** Prunes the work directory to the `keep` replay directories last written, removing each other one with its log; returns the names removed (or, on a dry run, that would be), oldest first. */
export function pruneWork(dir: string, keep: number, options: { dryRun?: boolean } = {}): string[] {
  if (!Number.isInteger(keep) || keep < 0) throw new Error(`--keep must be a whole number of replays, not ${keep}`);
  if (!existsSync(dir)) throw new Error(`${dir}: no such work directory`);
  const names = readdirSync(dir);
  const replays = names
    .filter((name) => !(KEPT_ALWAYS as readonly string[]).includes(name) && statSync(join(dir, name)).isDirectory())
    .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at || a.name.localeCompare(b.name));
  const removed = replays
    .slice(keep)
    .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
    .flatMap(({ name }) => [name, ...(names.includes(`${name}.log`) ? [`${name}.log`] : [])]);
  if (!options.dryRun) for (const name of removed) rmSync(join(dir, name), { recursive: true, force: true });
  return removed;
}

function main(): void {
  const { values } = parseArgs({ options: { keep: { type: "string" }, "dry-run": { type: "boolean", default: false }, dir: { type: "string", default: join(ROOT, "kpi/work") } } });
  if (values.keep === undefined) throw new Error("usage: npm run kpi:prune -- --keep <N> [--dry-run]");
  const removed = pruneWork(values.dir, Number(values.keep), { dryRun: values["dry-run"] });
  const verb = values["dry-run"] ? "would remove" : "removed";
  console.log(removed.length === 0 ? `${values.dir}: nothing to remove` : `${values.dir}: ${verb} ${removed.join(", ")}`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("prune.ts")) main();
