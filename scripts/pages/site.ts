import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

/**
 * The tree GitHub Pages serves, put together by the Pages workflow
 * (`.github/workflows/docs.yml`): the TypeDoc reference built from main at
 * its root, and beside it every version of the published breakups a
 * checkout of the `published` branch holds (`v1/`, frozen since version 2,
 * and `v2/`), so a reader of an earlier version still finds its files. The
 * two are deployed together, so neither wipes out the other. A missing
 * checkout, or one with no version yet, gives the reference alone: the
 * reference deploys before the first publish.
 */

/** Where the Pages tree's parts are read from and where it is written. */
export interface SiteDirs {
  /** What `npm run docs` writes (`reference/`). */
  reference: string;
  /** A checkout of the `published` branch, which may not exist. */
  published: string;
  /** The tree to upload, made afresh. */
  out: string;
}

/** The directories of the published files' versions in a checkout of the `published` branch: `v1`, `v2`, ... */
const versionsIn = (published: string): string[] => (existsSync(published) ? readdirSync(published, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name)).map((entry) => entry.name) : []);

/** Writes the Pages tree and returns its files, relative to its root and sorted. */
export function assembleSite(dirs: SiteDirs): string[] {
  rmSync(dirs.out, { recursive: true, force: true });
  cpSync(dirs.reference, dirs.out, { recursive: true });
  for (const version of versionsIn(dirs.published)) cpSync(join(dirs.published, version), join(dirs.out, version), { recursive: true });
  return readdirSync(dirs.out, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath}/${entry.name}`.slice(dirs.out.length + 1))
    .sort();
}

/** `npm run pages:site -- --reference reference --published published --out site`. */
function main(): void {
  const { values } = parseArgs({
    options: { reference: { type: "string" }, published: { type: "string" }, out: { type: "string" } },
  });
  const { reference, published, out } = values;
  if (reference === undefined || published === undefined || out === undefined) {
    throw new Error("usage: npm run pages:site -- --reference <dir> --published <dir> --out <dir>");
  }
  const versions = versionsIn(published);
  const files = assembleSite({ reference, published, out });
  const served = files.filter((file) => versions.some((version) => file.startsWith(`${version}/`))).length;
  console.log(`${out}: ${files.length - served} reference files and ${served} published files${versions.length === 0 ? ` (no version under ${published})` : ` (${versions.sort().join(", ")})`}`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("site.ts")) main();
