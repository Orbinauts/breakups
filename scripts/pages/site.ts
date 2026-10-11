import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { PUBLISHED_DIR } from "../published/files.ts";

/**
 * The tree GitHub Pages serves, put together by the Pages workflow
 * (`.github/workflows/docs.yml`): the TypeDoc reference built from main at
 * its root, and beside it `v1/`, the published breakups, copied from a
 * checkout of the `published` branch. The two are deployed together, so
 * neither wipes out the other. A missing checkout, or one with no `v1/`
 * yet, gives the reference alone: the reference deploys before the first
 * publish.
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

/** Writes the Pages tree and returns its files, relative to its root and sorted. */
export function assembleSite(dirs: SiteDirs): string[] {
  rmSync(dirs.out, { recursive: true, force: true });
  cpSync(dirs.reference, dirs.out, { recursive: true });
  const v1 = join(dirs.published, PUBLISHED_DIR);
  if (existsSync(v1)) cpSync(v1, join(dirs.out, PUBLISHED_DIR), { recursive: true });
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
  const files = assembleSite({ reference, published, out });
  const v1 = files.filter((file) => file.startsWith(`${PUBLISHED_DIR}/`)).length;
  console.log(`${out}: ${files.length - v1} reference files and ${v1} published files${v1 === 0 ? ` (no ${published}/${PUBLISHED_DIR})` : ""}`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("site.ts")) main();
