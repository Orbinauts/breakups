import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import * as library from "../src/index.ts";
import { DETECTOR_NAME } from "../src/index.ts";
import type { Latest } from "../scripts/kpi/kpi.ts";

/**
 * The README against the files, and against what it promises a reader who
 * finds it on GitHub or npm. Its summary table states cells of the
 * committed aggregate, its target sentence follows them, and its quick
 * start prints what the library answers; all are read here, so the README
 * cannot drift from any. `npm run kpi:readme` writes those parts between
 * their markers (`scripts/kpi/pages.ts`); these tests compute every cell
 * on their own, so a fault in the generator is caught here rather than
 * copied. The full tables live on `docs/results.md`, checked by
 * `results.test.ts`.
 *
 * npm shows the README without the repository's files, so every link in it
 * is an absolute URL, and every link into the repository names a file or
 * a heading that exists.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const README = readFileSync(resolve(ROOT, "README.md"), "utf8");
const PACKAGE_NAME = (JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { name: string }).name;
const REPOSITORY = "https://github.com/Orbinauts/breakups";
const file = JSON.parse(readFileSync(resolve(ROOT, "data/breakups.json"), "utf8")) as unknown;
const latest = JSON.parse(readFileSync(resolve(ROOT, "kpi/latest.json"), "utf8")) as Latest;

/** The README's sections, in order. */
const SECTIONS = ["What it does", "How well it works", "How it works", "Install", "Quick start", "Live test", "Learn more", "Licence and data credits"];

function section(heading: string): string {
  const start = README.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`The README has no section "${heading}"`);
  const end = README.indexOf("\n## ", start + 1);
  return README.slice(start, end === -1 ? undefined : end);
}

function fenced(text: string, language: string): string {
  const match = new RegExp("```" + language + "\\n([\\s\\S]*?)```").exec(text);
  if (match === null) throw new Error(`No ${language} block`);
  return match[1]!;
}

/** A heading's anchor as GitHub makes it. */
const slug = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^\w\- ]/g, "")
    .replace(/ /g, "-");

/** The anchors of a Markdown page's headings. */
const anchorsOf = (text: string): Set<string> => new Set([...text.matchAll(/^#{1,6} (.+)$/gm)].map((match) => slug(match[1]!)));

describe("the README's shape", () => {
  test("has its sections, in order, and no other", () => {
    expect([...README.matchAll(/^## (.+)$/gm)].map((match) => match[1])).toEqual(SECTIONS);
  });

  test("tells no internal history: no phase, no fitting round, no owner's decision", () => {
    expect(README).not.toMatch(/\bphases?\b/i);
    expect(README).not.toMatch(/\bD\d{1,2}\b/);
    expect(README).not.toMatch(/\bowner\b/i);
  });

  test("uses no em-dash", () => {
    expect(README).not.toContain("—");
  });
});

describe("the README's links", () => {
  const links = [...README.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]!);

  test("are all absolute, since npm shows the README without the repository's files", () => {
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link, link).toMatch(/^https:\/\//);
  });

  test("into the repository name a file or folder of main, and a heading that exists", () => {
    const into = links.filter((link) => link.startsWith(`${REPOSITORY}/blob/main/`) || link.startsWith(`${REPOSITORY}/tree/main/`) || link.startsWith(`${REPOSITORY}#`));
    expect(into.length).toBeGreaterThan(5);
    for (const link of into) {
      const [path, anchor] = link.replace(new RegExp(`^${REPOSITORY}(?:/(?:blob|tree)/main/)?`), "").split("#");
      const page = path === "" ? "README.md" : path!;
      expect(existsSync(resolve(ROOT, page)), `${link}: ${page} exists`).toBe(true);
      if (anchor !== undefined) expect([...anchorsOf(readFileSync(resolve(ROOT, page), "utf8"))], `${link}: #${anchor}`).toContain(anchor);
    }
  });
});

/** A rate with its count, as the summary states it. */
const rateOf = (rate: number, k: number, n: number): string => `${Math.round(rate * 100)}% (${k} of ${n})`;
/** A timing error in plain units: minutes under two hours, else hours. */
const duration = (minutes: number): string => (minutes < 120 ? `${Math.round(minutes)} minutes` : `${Math.round(minutes / 60)} hours`);

describe("the README's summary of the results", () => {
  const text = section("How well it works");
  const held = latest.splits.validation;
  const c = held.confirmedLine;
  const line = c.lines["breakups A-B"];
  const tables = text
    .split("\n\n")
    .filter((block) => block.startsWith("|"))
    .map((block) => block.trim());

  test("carries one table of the held-out years, every cell read from the aggregate", () => {
    expect(tables).toHaveLength(1);
    const rows = tables[0]!.split("\n").map((row) => row.split("|").slice(1, -1).map((cell) => cell.trim()));
    expect(rows).toEqual([
      [`Held-out years (the odd years, ${held.years[0]} to ${held.years.at(-1)})`, "Result", "Target"],
      ["---", "---", "---"],
      ["Reported breakups confirmed", rateOf(line.rate!, line.detected, line.targets), "90% or more"],
      ["Confirmations that were false", rateOf(c.falseAlarmRate!, c.falseAlarms, c.falseAlarms + c.detectedAllLines), "under 10%"],
      ["Median lead over the first official report", `${Math.round(c.lead!.median)} days (${c.beforeStatement} of ${c.withStatement} confirmed before it)`, ""],
      ["Median error in the time of the breakup", duration(c.timing!.median), ""],
    ]);
  });

  test("says plainly whether the target is reached, and points to the live test and the full results", () => {
    const reached = line.rate! >= 0.9 && c.falseAlarmRate! < 0.1;
    if (reached) expect(text).not.toContain("does not reach that target");
    else expect(text).toContain("**It does not reach that target yet.**");
    expect(text).toContain(`(${REPOSITORY}#live-test)`);
    expect(text).toContain(`(${REPOSITORY}/blob/main/docs/results.md)`);
  });

  test("names the one detector version the aggregate was run with", () => {
    expect(latest.detector.name).toBe(DETECTOR_NAME);
    const current = ["How well it works", "How it works"].map(section).join("\n");
    const names = new Set([...current.matchAll(/`((?:step|fusion|scoped|confirmed)-v\d+)`/g)].map((match) => match[1]));
    expect([...names]).toEqual([DETECTOR_NAME]);
  });
});

describe("the README's quick start", () => {
  const code = fenced(section("Quick start"), "js");
  const printed = fenced(section("Quick start"), "text").trimEnd().split("\n");

  test("prints what the README says it prints", async () => {
    const imports = [...code.matchAll(/^import (?:\{ ([\w, ]+) \}|(\w+)) from "([^"]+)"[^\n]*\n/gm)];
    expect(imports.length, "the quick start opens with its imports").toBe(2);
    const names: string[] = [];
    const bindings: unknown[] = [];
    for (const [, named, defaulted, from] of imports) {
      if (named !== undefined) {
        expect(from).toBe(PACKAGE_NAME);
        for (const name of named.split(", ")) {
          names.push(name);
          bindings.push((library as Record<string, unknown>)[name]);
        }
      } else {
        expect(from).toBe(`${PACKAGE_NAME}/breakups.json`);
        names.push(defaulted!);
        bindings.push(file);
      }
    }
    expect(bindings.every((binding) => binding !== undefined), `the package exports ${names.join(", ")}`).toBe(true);
    const logged: string[] = [];
    const log = { log: (...parts: unknown[]) => logged.push(parts.join(" ")) };
    const body = code.replace(/^import [^\n]*\n/gm, "");
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<void>;
    await new AsyncFunction(...names, "console", body)(...bindings, log);
    expect(logged, `the quick start now prints:\n${logged.join("\n")}`).toEqual(printed);
  });
});
