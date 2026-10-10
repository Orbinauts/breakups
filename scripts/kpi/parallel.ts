import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/**
 * The scorecard's exploration mode: the years split into contiguous
 * chunks, each replayed in its own worker process at once, every chunk
 * after the first starting from the states a previous full sequential
 * replay left at the year before it (`kpi/work/states/<year>.json.gz`, or
 * a directory given), the first from where the sequence starts. A chunk
 * replays its own years in order, carrying the states as the sequence
 * does, so the result differs from the sequence's only at the chunks'
 * first years, and only where the change being explored would have left
 * different states at those boundaries than the run the files came from.
 * The result is therefore approximate and says so (`exact: false`); the
 * committed scorecard and CI keep the sequential replay.
 */

/** A chunk of contiguous years, and the year whose end states it starts from (null for the first chunk, which starts where the sequence does). */
export interface Chunk {
  years: number[];
  startsFrom: number | null;
}

/**
 * The years, in order, split into at most `count` contiguous chunks whose
 * heaviest is as light as it can be: the replay's time grows with a
 * year's sets, so the weights are the years' set counts and the wall time
 * is the heaviest chunk's. The years must be contiguous and ascending, and
 * the weights one per year; a tie keeps the earlier chunks the lighter.
 */
export function chunksOf(years: readonly number[], weights: readonly number[], count: number): Chunk[] {
  if (years.length !== weights.length) throw new Error(`${years.length} years but ${weights.length} weights`);
  if (!Number.isInteger(count) || count < 1) throw new Error(`a parallel replay wants a whole number of chunks of at least one, not ${count}`);
  for (let i = 1; i < years.length; i++) if (years[i] !== years[i - 1]! + 1) throw new Error(`the years must be contiguous and ascending: ${years[i - 1]} is followed by ${years[i]}`);
  const n = years.length;
  const k = Math.min(count, n);
  if (n === 0) return [];
  const prefix = [0];
  for (const weight of weights) prefix.push(prefix.at(-1)! + weight);
  // best[j][i]: the lightest heaviest chunk splitting the first i years into j chunks; cut[j][i] where the last of them starts.
  const best = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY));
  const cut = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(0));
  best[0]![0] = 0;
  for (let j = 1; j <= k; j++) {
    for (let i = j; i <= n; i++) {
      // The last chunk starts as early as it can for the same heaviest chunk, so on a tie the earlier ones stay the lighter.
      for (let s = j - 1; s < i; s++) {
        const heaviest = Math.max(best[j - 1]![s]!, prefix[i]! - prefix[s]!);
        if (heaviest < best[j]![i]!) [best[j]![i], cut[j]![i]] = [heaviest, s];
      }
    }
  }
  const chunks: Chunk[] = [];
  for (let j = k, i = n; j > 0; j--) {
    const s = cut[j]![i]!;
    chunks.unshift({ years: years.slice(s, i), startsFrom: s === 0 ? null : years[s - 1]! });
    i = s;
  }
  return chunks;
}

/** A chunk's years as the output names them. */
export const chunkLabel = (chunk: Chunk): string => (chunk.years.length === 1 ? String(chunk.years[0]) : `${chunk.years[0]}-${chunk.years.at(-1)}`);

/** The statement every parallel result carries, in its output and in its aggregate. */
export function approximation(chunks: readonly Chunk[], statesFrom: string): string {
  const boundaries = chunks.flatMap((chunk) => (chunk.startsFrom === null ? [] : [chunk.startsFrom]));
  return `Approximate: a parallel exploration replay in ${chunks.length} chunks (${chunks.map(chunkLabel).join(", ")}), each after the first starting from the states under ${statesFrom} at the end of ${boundaries.join(", ") || "no year"}. It equals the sequential replay only where the change being explored leaves the states at those boundaries as the run that wrote them had them; it is never the record.`;
}

/**
 * Runs each chunk as its own worker process, `argsOf` giving its command
 * line after the script, with every line it prints prefixed with its
 * years. Resolves once all have exited cleanly; rejects at the first that
 * fails, stopping the others.
 */
export async function runChunks(script: string, chunks: readonly Chunk[], argsOf: (chunk: Chunk) => string[]): Promise<void> {
  const children = chunks.map((chunk) => {
    const child = spawn(process.execPath, [...process.execArgv, script, ...argsOf(chunk)], { stdio: ["ignore", "pipe", "pipe"] });
    const label = `[${chunkLabel(chunk)}]`;
    createInterface({ input: child.stdout }).on("line", (line) => console.log(`${label} ${line}`));
    createInterface({ input: child.stderr }).on("line", (line) => console.error(`${label} ${line}`));
    return { chunk, child };
  });
  try {
    await Promise.all(
      children.map(
        ({ chunk, child }) =>
          new Promise<void>((done, fail) => {
            child.on("error", fail);
            child.on("exit", (code, signal) => (code === 0 ? done() : fail(new Error(`the worker replaying ${chunkLabel(chunk)} exited with ${signal ?? `code ${code}`}`))));
          }),
      ),
    );
  } catch (error) {
    for (const { child } of children) if (child.exitCode === null) child.kill();
    throw error;
  }
}
