import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import * as library from "../src/index.ts";
import { DETECTOR_NAME, yearOf } from "../src/index.ts";
import { readmeTables, type Latest } from "../scripts/kpi/kpi.ts";

/**
 * The README against the files. Its ground-truth table states counts the
 * built truth must give, its scorecard tables state the cells of the
 * committed aggregate, and its quick start prints what the library
 * answers; all three are read here, so the README cannot drift from any.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const README = readFileSync(resolve(ROOT, "README.md"), "utf8");
const PACKAGE_NAME = (JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { name: string }).name;
const file = JSON.parse(readFileSync(resolve(ROOT, "data/breakups.json"), "utf8")) as unknown;
const breakups = library.readBreakups(file);
const SCORING_FROM = 2005;

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

describe("the README's ground-truth table", () => {
  const since = breakups.filter((b) => yearOf(b) >= SCORING_FROM);
  const scoreable = since.filter((b) => b.scoreable);
  const counts: Record<string, number> = {
    All: since.length,
    "Scoreable (breakups and anomalous events of a catalogued object)": scoreable.length,
    Breakups: since.filter((b) => b.kind === "breakup").length,
    "Anomalous events (low-velocity shedding)": since.filter((b) => b.kind === "anomalous").length,
    "Aerodynamic breakups at reentry (kept out)": since.filter((b) => b.kind === "aerodynamic").length,
    "Objects released on purpose (kept out)": since.filter((b) => b.kind === "release").length,
    "Reports naming no object (kept out)": since.filter((b) => b.kind === "unnamed").length,
    "Confidence A (an authority states the minute)": scoreable.filter((b) => b.confidence === "A").length,
    "Confidence B (an authority states the day, or a window of three days at most)": scoreable.filter((b) => b.confidence === "B").length,
    "Confidence C (GCAT alone, an authority's month, or an analyst's dating)": scoreable.filter((b) => b.confidence === "C").length,
    "Confidence D (pieces in the catalogue, or news with no time)": scoreable.filter((b) => b.confidence === "D").length,
  };
  const lines = section("Ground truth")
    .split("\n")
    .filter((line) => line.startsWith("|"));
  const rows = lines.slice(2).map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));

  test("states every count, and only those", () => {
    expect(lines[0]).toBe(`| Events from ${SCORING_FROM} | Count |`);
    expect(rows.map((row) => row[0])).toEqual(Object.keys(counts));
  });

  test.each(rows.map((row) => [row[0]!, Number(row[1])] as const))("%s: %i", (label, stated) => {
    expect(stated).toBe(counts[label]);
  });
});

/** A rate as the scorecard prints it, a whole percentage. */
const percent = (rate: number): string => `${Math.round(rate * 100)}%`;
/** A rate with its Wilson 95% interval, as the scorecard prints it. */
const withInterval = (rate: number, interval: [number, number]): string => `${percent(rate)} (${percent(interval[0])} to ${percent(interval[1])})`;
/** A timing error in plain units: minutes under two hours, else hours. */
const duration = (minutes: number): string => (minutes < 120 ? `${Math.round(minutes)} minutes` : `${Math.round(minutes / 60)} hours`);

describe("the README's current results", () => {
  const latest = JSON.parse(readFileSync(resolve(ROOT, "kpi/latest.json"), "utf8")) as Latest;
  const text = section("Current results");
  const tables = text
    .split("\n\n")
    .filter((block) => block.startsWith("|"))
    .map((block) => block.trim());
  const held = latest.splits.validation;
  const train = latest.splits.train;
  const span = (years: number[], parity: string) => `${parity}, ${years[0]} to ${years.at(-1)}`;
  const column = (c: Latest["splits"]["validation"]["confirmedLine"]) => {
    const line = c.lines["breakups A-B"];
    return {
      confirmed: `${line.detected} of ${line.targets}`,
      recall: withInterval(line.rate!, line.interval!),
      falseConfirmations: `${c.falseAlarms} of ${c.falseAlarms + c.detectedAllLines}`,
      falseAlarmRate: withInterval(c.falseAlarmRate!, c.falseAlarmInterval!),
      lead: `${Math.round(c.lead!.median)} days, ${c.beforeStatement} of ${c.withStatement} before it`,
      timing: duration(c.timing!.median),
    };
  };
  const h = column(held.confirmedLine);
  const t = column(train.confirmedLine);
  const expected = [
    ["Headline: breakups reported to the day", `Held-out years (${span(held.years, "odd")})`, `Training years (${span(train.years, "even")})`, "Target"],
    ["---", "---", "---", "---"],
    ["Confirmed, of the targets", h.confirmed, t.confirmed, ""],
    ["Recall (95% interval)", h.recall, t.recall, "90% or more"],
    ["False confirmations, of all events confirmed", h.falseConfirmations, t.falseConfirmations, ""],
    ["False-alarm rate (95% interval)", h.falseAlarmRate, t.falseAlarmRate, "under 10%"],
    ["Median lead over the first agency statement", h.lead, t.lead, ""],
    ["Median timing error", h.timing, t.timing, ""],
  ];

  test("carries one table, every cell read from the aggregate", () => {
    expect(tables).toHaveLength(1);
    const rows = tables[0]!.split("\n").map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
    expect(rows).toEqual(expected);
  });

  test("names the detector the aggregate was run with", () => {
    expect(text).toContain(`\`${DETECTOR_NAME}\``);
  });

  test("says plainly whether the held-out years reach the target, and points to the prospective test", () => {
    const line = held.confirmedLine;
    const reached = line.lines["breakups A-B"].rate! >= 0.9 && line.falseAlarmRate! < 0.1;
    if (reached) expect(text).not.toContain("does not reach that target");
    else expect(text).toContain("It does not reach that target on the held-out years.");
    expect(text).toContain("(#prospective-test)");
    expect(section("Prospective test")).toContain("npm run prospective:score");
  });
});

describe("the README's statement of the version", () => {
  test("names one detector version where it describes the current one", () => {
    const current = ["Current results", "How it works", "How well it does"].map(section).join("\n");
    const names = new Set([...current.matchAll(/`((?:step|fusion|scoped|confirmed)-v\d+)`/g)].map((match) => match[1]));
    expect([...names]).toEqual([DETECTOR_NAME]);
  });

  test("states the build's phase once, never two phases as current", () => {
    const ordinals = [...README.matchAll(/\bthe (\w+) phase of its build\b/g)].map((match) => match[1]);
    expect(ordinals).toHaveLength(1);
  });
});

describe("the README's scorecard table", () => {
  const latest = JSON.parse(readFileSync(resolve(ROOT, "kpi/latest.json"), "utf8")) as Latest;
  const text = section("How well it does");
  const tables = text
    .split("\n\n")
    .filter((block) => block.startsWith("|"))
    .map((block) => block.trim());
  const expected = readmeTables(latest);

  test("carries the two tables of the aggregate, every cell equal", () => {
    expect(tables).toHaveLength(expected.length);
    for (const [i, table] of expected.entries()) {
      const rows = (markdown: string) => markdown.split("\n").map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
      expect(rows(tables[i]!)).toEqual(rows(table));
    }
  });

  test("names the detector the aggregate was run with, and says so while it is the placeholder", () => {
    expect(latest.detector.name).toBe(DETECTOR_NAME);
    expect(latest.package.name).toBe(PACKAGE_NAME);
    if (latest.detector.name === "placeholder") {
      expect(text).toContain("The detector is not written yet.");
      const cells = latest.splits.validation;
      expect(cells.alerts + cells.falseAlarms + cells.duplicates + cells.exempt).toBe(0);
      for (const line of Object.values(cells.lines)) expect(line.detected + line.late).toBe(0);
    } else {
      expect(text).not.toContain("not written yet");
    }
  });

  test("is computed from the truth the package ships", () => {
    expect(latest.truthSha256).toBe(createHash("sha256").update(readFileSync(resolve(ROOT, "data/breakups.json"))).digest("hex"));
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
