import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";

/**
 * The package's boundary and hygiene, over every file it carries: its
 * source, its tests, the scripts, the data and the configuration. Two
 * promises are checked here rather than trusted.
 *
 * The boundary: the library imports nothing but @orbinauts/engine and its
 * own files, and no Node built-in, so it runs unchanged in Node, in a
 * browser and in Workers. The tests may also import vitest; the scripts and
 * this folder's support code, which run only under Node, may import Node's
 * built-ins, and the tests the TypeScript compiler they read the source
 * with.
 *
 * The hygiene: a reader who has only this package finds no pointer to
 * something they cannot open (an issue number, a design record or glossary
 * kept elsewhere, a path in another repository) and no word about the
 * product the library was written for. The data folder carries the
 * sources' own words, which say what they say, so it is held to the
 * boundary and not to the hygiene.
 *
 * The documents at the package's root (the README, the changelog, the
 * licence) and the documentation folder speak for the project and may name
 * it, so they are not walked.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SKIPPED = new Set(["node_modules", "dist", "docs", "reference", ".git", ".claude", ".agents", "kpi"]);

/** The documents at the root, which speak for the project. */
const DOCUMENT = /^(?:[A-Z]+(?:\.md)?|LICENSE(?:\.\w+)?|skills-lock\.json)$/;

function walk(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : walk(path);
    if (folder === ROOT && DOCUMENT.test(entry.name)) return [];
    // Credentials the scripts read from the environment, which git ignores and nobody ships.
    if (folder === ROOT && /^\.env(?:\..*)?$/.test(entry.name)) return [];
    return [relative(ROOT, path).split(sep).join("/")];
  });
}

const FILES = walk(ROOT);

/** The sources' own words and the truth built from them: not held to the hygiene rules. */
const isData = (file: string) => file.startsWith("data/");
/** Where the public catalogue may be named as where data came from: the tooling that fetches it, and the data that cites it. */
const mayNameTheCatalogue = (file: string) => file.startsWith("scripts/archive/") || isData(file);

interface Rule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly skip?: (file: string) => boolean;
}

/** Every `@orbinauts` or `Orbinauts` a file may carry: the package's own names and the engine's. */
const OWN_NAMES = /@orbinauts\/(?:breakups|engine)|Orbinauts\/(?:breakups|engine)|Orbinauts contributors|https:\/\/orbinauts\.com/g;

/** Space-Track may be named as a server of a data format; not as where a set came from, since its terms forbid passing its data on. */
const SPACE_TRACK_AS_FORMAT = /Space-Track(?:\s+(?:and|or)\s+CelesTrak)?\s+(?:also\s+)?serves?\b|CelesTrak\s+(?:and|or)\s+Space-Track\s+(?:also\s+)?serve\b/g;

const GITHUB_PAGES = /GitHub Pages|\bgithub-pages\b|\b(?:configure|upload|deploy)-pages\b|\bpages:\s*write\b/g;

const RULES: readonly Rule[] = [
  { name: "an issue reference", pattern: /(?<![\w&/#])#\d+\b/, skip: isData },
  { name: "a design record by number", pattern: /\bADRs?\b/, skip: isData },
  { name: "a glossary kept elsewhere", pattern: /CONTEXT\.md|\bglossary\b/i, skip: isData },
  { name: "a path in another repository", pattern: /(?<![\w.-])(?:apps|research|packages|tools|\.memory)\/[\w.-]/, skip: isData },
  // A page here is a page of a document the truth cites; the product's pages are "the site's" or "a web page".
  { name: "a site's page", pattern: /\bweb ?pages?\b|\bsite's pages?\b/i, skip: isData },
  { name: "the site", pattern: /\bthe site\b|\bsite's\b/i, skip: isData },
  { name: "a service", pattern: /\bWorker\b|\bthe API\b|\bAPI's\b|\bAPI Worker\b/, skip: isData },
  { name: "the product's visitors", pattern: /\bvisitors?\b/i, skip: isData },
  { name: "a product name", pattern: /orbinauts/i, skip: isData },
  { name: "Space-Track as a source", pattern: /space-track/i, skip: mayNameTheCatalogue },
  { name: "an email address", pattern: /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, skip: isData },
];

const RULE_BOOK = "test/boundary.test.ts";

function breaches(file: string): string[] {
  if (file === RULE_BOOK || /\.(?:png|jpg|gif|ico|woff2?|bin|gz|zip)$/.test(file)) return [];
  const text = readFileSync(join(ROOT, file), "utf8");
  return text.split("\n").flatMap((raw, index) => {
    const line = raw.replace(OWN_NAMES, "").replace(SPACE_TRACK_AS_FORMAT, "").replace(GITHUB_PAGES, "");
    return RULES.filter((rule) => !rule.skip?.(file) && rule.pattern.test(line)).map((rule) => `${file}:${index + 1}: ${rule.name}: ${raw.trim()}`);
  });
}

const NODE_BUILT_INS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

/** The modules a file may import besides relative paths, by where it lives. */
function allowedImports(file: string): (specifier: string) => boolean {
  const library = (specifier: string) => specifier === "@orbinauts/engine";
  const node = (specifier: string) => NODE_BUILT_INS.has(specifier);
  if (file.startsWith("src/") && !file.endsWith(".test.ts")) return library;
  if (file.startsWith("src/")) return (specifier) => library(specifier) || specifier === "vitest";
  if (file.startsWith("scripts/") && !file.endsWith(".test.ts")) return (specifier) => library(specifier) || node(specifier);
  if (file.startsWith("scripts/")) return (specifier) => library(specifier) || node(specifier) || specifier === "vitest";
  if (file.startsWith("test/")) return (specifier) => library(specifier) || specifier === "vitest" || specifier === "typescript" || node(specifier);
  return (specifier) => specifier === "vitest/config";
}

function importsOf(file: string): string[] {
  const text = readFileSync(join(ROOT, file), "utf8");
  return ts.preProcessFile(text, true, true).importedFiles.map((imported) => imported.fileName);
}

const TYPESCRIPT = FILES.filter((file) => [".ts", ".mts", ".js", ".mjs"].includes(extname(file)));

describe("the package's boundary", () => {
  test("is walked over its source, its tests, its scripts, its data and the configuration", () => {
    for (const prefix of ["src/", "test/", "scripts/", "data/"]) expect(FILES.some((file) => file.startsWith(prefix))).toBe(true);
    expect(FILES).toContain("package.json");
    expect(FILES).toContain("data/breakups.json");
    expect(FILES).toContain("test/boundary.test.ts");
  });

  test.each(TYPESCRIPT)("%s imports only what its place allows, and a relative path stays inside the package", (file) => {
    const allowed = allowedImports(file);
    const outside = importsOf(file).filter((specifier) => {
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        return relative(ROOT, resolve(ROOT, dirname(file), specifier)).startsWith("..");
      }
      return !allowed(specifier);
    });
    expect(outside).toEqual([]);
  });

  test("the library's own files import no Node built-in", () => {
    const library = TYPESCRIPT.filter((file) => file.startsWith("src/"));
    expect(library.length).toBeGreaterThan(0);
    const reaching = library.flatMap((file) => importsOf(file).filter((specifier) => NODE_BUILT_INS.has(specifier.split("/")[0]!) || specifier.startsWith("node:")).map((specifier) => `${file}: ${specifier}`));
    expect(reaching).toEqual([]);
  });

  test("the library never reads the truth file itself: the scorecard does", () => {
    const library = TYPESCRIPT.filter((file) => file.startsWith("src/") && !file.endsWith(".test.ts"));
    const reading = library.filter((file) => importsOf(file).some((specifier) => specifier.endsWith(".json")));
    expect(reading).toEqual([]);
  });
});

describe("the package's text", () => {
  test("names nothing a reader of the package alone cannot open, and nothing of the product it was written for", () => {
    expect(FILES.flatMap(breaches)).toEqual([]);
  });

  test.each([
    ["an issue reference", "fixed in #12", true],
    ["an issue reference", "the colour #fff and `# 2 steps`", false],
    ["a design record by number", "decided in ADR 0003", true],
    ["a glossary kept elsewhere", "the Source rule (CONTEXT.md)", true],
    ["a path in another repository", "from research/brightness.md", true],
    ["a path in another repository", "written to docs/truth.md", false],
    ["a site's page", "the site's page says", true],
    ["a site's page", "cited on p. 554 of the document, a two-page spread", false],
    ["a site's page", "published to GitHub Pages with actions/deploy-pages", false],
    ["a service", "the API turns it into an error", true],
    ["a service", "runs in browsers and Workers", false],
    ["the product's visitors", "runs in every visitor's browser", true],
    ["a product name", "as the Orbinauts map shows", true],
    ["a product name", "import from @orbinauts/breakups", false],
    ["Space-Track as a source", "the Space-Track set of that day", true],
    ["Space-Track as a source", "the OMM as Space-Track serves it in JSON", false],
    ["an email address", "write to someone@example.com", true],
  ] as const)("the rule against %s, on %j, fires: %s", (name, line, fires) => {
    const rule = RULES.find((candidate) => candidate.name === name)!;
    const cleaned = line.replace(OWN_NAMES, "").replace(SPACE_TRACK_AS_FORMAT, "").replace(GITHUB_PAGES, "");
    expect(rule.pattern.test(cleaned)).toBe(fires);
  });
});
