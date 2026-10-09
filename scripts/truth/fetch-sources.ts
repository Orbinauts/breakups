import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Fetches the machine-readable sources of the truth and writes their
 * snapshots under `data/truth/sources/`, recording each original's hash in
 * `data/truth/sources.json`. The one step that touches the network, run by
 * hand when a source publishes a new edition; the build and the tests read
 * the committed snapshots only. NASA's PDF is turned into text with
 * poppler's `pdftotext -layout`, which must be installed; the PDF itself is
 * not kept.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const USER_AGENT = "breakups-truth (https://github.com/Orbinauts/breakups)";

const SOURCES = {
  "hoosf-16e": { url: "https://orbitaldebris.jsc.nasa.gov/library/HOOSF_16e.pdf", snapshot: "sources/hoosf-16e.txt", licence: "US Government work (NASA technical publication NASA/TP-20220019160)" },
  gcat: { url: "https://planet4589.org/space/debris/debriscat/index.html", snapshot: "sources/gcat-debriscat.html", licence: "CC-BY-4.0, Jonathan McDowell, planet4589.org" },
} as const;

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function main(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const record = JSON.parse(readFileSync(resolve(ROOT, "data/truth/sources.json"), "utf8")) as { about: string; snapshots: Record<string, unknown> };
  const scratch = mkdtempSync(join(tmpdir(), "breakups-sources-"));
  for (const [id, source] of Object.entries(SOURCES)) {
    const original = await fetchBytes(source.url);
    let snapshot: Uint8Array;
    let madeWith: string;
    if (source.url.endsWith(".pdf")) {
      const pdf = join(scratch, `${id}.pdf`);
      writeFileSync(pdf, original);
      const text = join(scratch, `${id}.txt`);
      execFileSync("pdftotext", ["-layout", pdf, text]);
      const version = execFileSync("pdftotext", ["-v"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n")[0] ?? "pdftotext";
      snapshot = readFileSync(text);
      madeWith = `pdftotext -layout, poppler ${version.replace(/^pdftotext version /, "")}`;
    } else {
      snapshot = original;
      madeWith = "fetched as served";
    }
    writeFileSync(resolve(ROOT, "data/truth", source.snapshot), snapshot);
    record.snapshots[id] = { url: source.url, fetchedOn: today, originalSha256: sha256(original), originalBytes: original.byteLength, snapshot: source.snapshot, madeWith, snapshotSha256: sha256(snapshot), licence: source.licence };
    console.log(`${id}: ${original.byteLength} bytes, sha256 ${sha256(original).slice(0, 12)}…, snapshot ${snapshot.byteLength} bytes`);
  }
  writeFileSync(resolve(ROOT, "data/truth/sources.json"), `${JSON.stringify(record, null, 2)}\n`);
}

await main();
