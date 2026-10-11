import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { assembleSite } from "./site.ts";

/** A directory of files, from a map of relative paths to their contents. */
function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pages-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const REFERENCE = { "index.html": "<title>reference</title>", ".nojekyll": "", "classes/Verdict.html": "verdict" };

describe("the Pages site", () => {
  test("is the reference alone when there is no published checkout", () => {
    const out = join(tree({}), "site");
    const files = assembleSite({ reference: tree(REFERENCE), published: join(tree({}), "missing"), out });
    expect(files).toEqual([".nojekyll", "classes/Verdict.html", "index.html"]);
    expect(readFileSync(join(out, "index.html"), "utf8")).toBe("<title>reference</title>");
  });

  test("carries the published branch's v1/ beside the reference, and nothing else of that branch", () => {
    const published = tree({
      "v1/breakups.json": '{"version":1}\n',
      "v1/breakups/19460-2026-09-13.json": '{"version":1,"id":"19460-2026-09-13"}\n',
      "v1/status.json": '{"version":1}\n',
      "README.md": "the branch's own readme",
      ".git/HEAD": "ref: refs/heads/published",
    });
    const out = join(tree({}), "site");
    const files = assembleSite({ reference: tree(REFERENCE), published, out });
    expect(files).toEqual([
      ".nojekyll",
      "classes/Verdict.html",
      "index.html",
      "v1/breakups.json",
      "v1/breakups/19460-2026-09-13.json",
      "v1/status.json",
    ]);
    expect(readFileSync(join(out, "v1/breakups/19460-2026-09-13.json"), "utf8")).toBe('{"version":1,"id":"19460-2026-09-13"}\n');
  });

  test("is the reference alone when the published branch has no v1/ yet", () => {
    const out = join(tree({}), "site");
    const files = assembleSite({ reference: tree(REFERENCE), published: tree({ "README.md": "empty" }), out });
    expect(files).toEqual([".nojekyll", "classes/Verdict.html", "index.html"]);
  });

  test("is made afresh: a file left from an earlier assembly is gone", () => {
    const out = join(tree({}), "site");
    assembleSite({ reference: tree(REFERENCE), published: tree({ "v1/breakups/old.json": "{}" }), out });
    const files = assembleSite({ reference: tree(REFERENCE), published: tree({ "v1/breakups.json": "{}" }), out });
    expect(files).toEqual([".nojekyll", "classes/Verdict.html", "index.html", "v1/breakups.json"]);
  });
});
