import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reduceSatcat } from "./parse-gcat-satcat.ts";

/**
 * Fetches the machine-readable sources of the truth and writes their
 * snapshots under `data/truth/sources/`, recording each original's hash in
 * `data/truth/sources.json`. The one step that touches the network, run by
 * hand when a source publishes a new edition; the build and the tests read
 * the committed snapshots only. NASA's PDF is turned into text with
 * poppler's `pdftotext -layout`, which must be installed; the PDF itself is
 * not kept. GCAT's satellite catalogue is kept reduced to the rows and
 * columns the truth reads (`reduceSatcat`), every kept cell verbatim; the
 * whole file's hash is recorded beside the snapshot's. GCAT's pages that
 * document the catalogue's columns and codes are kept as served, so the
 * reading of each code can be checked against the words it was read from.
 *
 * `--only <id>[,<id>…]` fetches the sources named alone and leaves every
 * other snapshot as it is.
 *
 * A source that has not changed keeps its snapshot and its record as they
 * were, the day it was fetched included, so a fetch that finds nothing new
 * makes no diff: NASA's PDF is unchanged when its hash is the recorded one
 * (and `pdftotext` is then not run), a page kept as served likewise, and
 * GCAT's satellite catalogue, whose whole file changes almost every day,
 * when its reduction is the snapshot already kept. The weekly maintenance
 * workflow runs it this way and opens a pull request only for a change.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const USER_AGENT = "breakups-truth (https://github.com/Orbinauts/breakups)";
const GCAT_LICENCE = "CC-BY-4.0, Jonathan McDowell, planet4589.org";

type Made = "pdftotext" | "as served" | "satcat";

const SOURCES: Record<string, { url: string; snapshot: string; licence: string; made: Made }> = {
  "hoosf-16e": { url: "https://orbitaldebris.jsc.nasa.gov/library/HOOSF_16e.pdf", snapshot: "sources/hoosf-16e.txt", licence: "US Government work (NASA technical publication NASA/TP-20220019160)", made: "pdftotext" },
  gcat: { url: "https://planet4589.org/space/debris/debriscat/index.html", snapshot: "sources/gcat-debriscat.html", licence: GCAT_LICENCE, made: "as served" },
  "gcat-satcat": { url: "https://planet4589.org/space/gcat/tsv/cat/satcat.tsv", snapshot: "sources/gcat-satcat.tsv", licence: GCAT_LICENCE, made: "satcat" },
  "gcat-satcat-columns": { url: "https://planet4589.org/space/gcat/web/cat/cols.html", snapshot: "sources/gcat-satcat-columns.html", licence: GCAT_LICENCE, made: "as served" },
  "gcat-sattype": { url: "https://planet4589.org/space/gcat/web/intro/type.html", snapshot: "sources/gcat-sattype.html", licence: GCAT_LICENCE, made: "as served" },
  "gcat-phases": { url: "https://planet4589.org/space/gcat/web/intro/phases.html", snapshot: "sources/gcat-phases.html", licence: GCAT_LICENCE, made: "as served" },
  "gcat-vague-dates": { url: "https://planet4589.org/space/gcat/web/intro/vague.html", snapshot: "sources/gcat-vague-dates.html", licence: GCAT_LICENCE, made: "as served" },
};

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** What the sources record keeps of a snapshot. */
export interface SnapshotRecord {
  url: string;
  fetchedOn: string;
  originalSha256: string;
  originalBytes: number;
  snapshot: string;
  madeWith: string;
  snapshotSha256: string;
  licence: string;
}

/**
 * Whether a fetched source is the one already kept: its original's hash is
 * the recorded one and the kept snapshot is the recorded snapshot, or,
 * where the original is reduced, the reduction is the kept snapshot.
 */
export function unchanged(record: SnapshotRecord | undefined, original: string, snapshot: string | null, kept: string | null): boolean {
  if (record === undefined || kept !== record.snapshotSha256) return false;
  return snapshot !== null ? snapshot === record.snapshotSha256 : original === record.originalSha256;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function onlyArgument(): Set<string> | null {
  const at = process.argv.indexOf("--only");
  if (at === -1) return null;
  const ids = (process.argv[at + 1] ?? "").split(",").filter((id) => id !== "");
  const unknown = ids.find((id) => SOURCES[id] === undefined);
  if (ids.length === 0 || unknown !== undefined) throw new Error(`--only takes source ids among ${Object.keys(SOURCES).join(", ")}`);
  return new Set(ids);
}

async function main(): Promise<void> {
  const only = onlyArgument();
  const today = new Date().toISOString().slice(0, 10);
  const record = JSON.parse(readFileSync(resolve(ROOT, "data/truth/sources.json"), "utf8")) as { about: string; snapshots: Record<string, SnapshotRecord> };
  const scratch = mkdtempSync(join(tmpdir(), "breakups-sources-"));
  for (const [id, source] of Object.entries(SOURCES)) {
    if (only !== null && !only.has(id)) continue;
    const original = await fetchBytes(source.url);
    const path = resolve(ROOT, "data/truth", source.snapshot);
    const kept = existsSync(path) ? sha256(readFileSync(path)) : null;
    const reduced = source.made === "satcat" ? reduceSatcat(new TextDecoder().decode(original)) : null;
    if (unchanged(record.snapshots[id], sha256(original), reduced === null ? null : sha256(new TextEncoder().encode(reduced.text)), kept)) {
      console.log(`${id}: unchanged (sha256 ${sha256(original).slice(0, 12)}…), kept as fetched on ${record.snapshots[id]!.fetchedOn}`);
      continue;
    }
    let snapshot: Uint8Array;
    let madeWith: string;
    if (source.made === "pdftotext") {
      const pdf = join(scratch, `${id}.pdf`);
      writeFileSync(pdf, original);
      const text = join(scratch, `${id}.txt`);
      execFileSync("pdftotext", ["-layout", pdf, text]);
      const version = execFileSync("pdftotext", ["-v"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n")[0] ?? "pdftotext";
      snapshot = readFileSync(text);
      madeWith = `pdftotext -layout, poppler ${version.replace(/^pdftotext version /, "")}`;
    } else if (reduced !== null) {
      snapshot = new TextEncoder().encode(reduced.text);
      madeWith = reduced.madeWith;
    } else {
      snapshot = original;
      madeWith = "fetched as served";
    }
    writeFileSync(path, snapshot);
    record.snapshots[id] = { url: source.url, fetchedOn: today, originalSha256: sha256(original), originalBytes: original.byteLength, snapshot: source.snapshot, madeWith, snapshotSha256: sha256(snapshot), licence: source.licence };
    console.log(`${id}: ${original.byteLength} bytes, sha256 ${sha256(original).slice(0, 12)}…, snapshot ${snapshot.byteLength} bytes`);
  }
  writeFileSync(resolve(ROOT, "data/truth/sources.json"), `${JSON.stringify(record, null, 2)}\n`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("fetch-sources.ts")) await main();
