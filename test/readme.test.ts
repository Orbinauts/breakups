import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import * as library from "../src/index.ts";
import { DETECTOR_NAME, DETECTOR_PARAMETERS } from "../src/index.ts";
import type { Latest } from "../scripts/kpi/kpi.ts";

/**
 * The README against the files, and against what it promises a reader who
 * finds it on GitHub or npm. Its summary table states cells of the
 * committed aggregate, its target sentence follows them, and its quick
 * start prints what the library answers; all are read here, so the README
 * cannot drift from any. The early warning's table and the life of an
 * alert are read the same way, and the plain words around them (weeks
 * ahead, within the hour, most of them false, thirty days, a few hours)
 * are checked against the numbers they summarise. `npm run kpi:readme`
 * writes those parts between
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
const SECTIONS = ["What it does", "How well it works", "How it works", "The life of an alert", "Install", "Quick start", "Live test", "Learn more", "Licence and data credits"];

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

  test("are all absolute, since an install from GitHub and the reference site show the README without the repository's files", () => {
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

  test("carries two tables of the held-out years, the Confirmed line and the early warning, every cell read from the aggregate", () => {
    expect(tables).toHaveLength(2);
    const rows = tables[0]!.split("\n").map((row) => row.split("|").slice(1, -1).map((cell) => cell.trim()));
    expect(rows).toEqual([
      [`Held-out years (the odd years, ${held.years[0]} to ${held.years.at(-1)})`, "Result", "Target"],
      ["---", "---", "---"],
      ["Reported breakups confirmed", rateOf(line.rate!, line.detected, line.targets), "90% or more"],
      ["Confirmations that were false", rateOf(c.falseAlarmRate!, c.falseAlarms, c.falseAlarms + c.detectedAllLines), "under 10%"],
      ["Median lead over the first agency notice dated to the day", c.leadNotice == null ? "–" : `${Math.round(c.leadNotice.median)} days (${c.beforeNotice} of ${c.withNotice} confirmed before it)`, ""],
      ["Median lead over NASA's quarterly news, dated to its month", c.leadQuarterly == null ? "–" : `${Math.round(c.leadQuarterly.median)} days (${c.beforeQuarterly} of ${c.withQuarterly} confirmed before it)`, ""],
      ["First agency statements dated to the day, to the month", `${c.statementDays} to the day, ${c.statementMonths} to the month`, ""],
      ["Median error in the time of the breakup", duration(c.timing!.median), ""],
    ]);
  });

  test("the early warning's table: flagged before the first fragment, late, false alarms a year and their share, the lead and the timing", () => {
    const early = held.lines["breakups A-B"];
    const detected = Object.values(held.lines).reduce((sum, l) => sum + l.detected, 0);
    const rows = tables[1]!.split("\n").map((row) => row.split("|").slice(1, -1).map((cell) => cell.trim()));
    expect(rows).toEqual([
      ["Early warning (suspected), the same years", "Result"],
      ["---", "---"],
      ["Reported breakups flagged before the first fragment was catalogued", rateOf(early.detectionRate!, early.detected, early.targets)],
      ["Flagged only after the first fragment (late)", `${early.late} of ${early.targets}`],
      ["False alarms", `${Math.round(held.falseAlarms / held.years.length)} a year, ${Math.round(held.falseAlarmRate! * 100)}% of all early warnings (${held.falseAlarms} of ${held.falseAlarms + detected})`],
      ["Median lead over the first catalogued fragment", `${Math.round(held.leadHours!.median / 24)} days`],
      ["Median error in the time of the breakup", duration(held.timingErrorMinutes!)],
    ]);
  });

  test("says what an early warning is in plain words that the numbers bear out, and no longer calls it unscored", () => {
    expect(text).not.toMatch(/not scored/i);
    expect(text).toContain("it comes weeks before the first fragment is catalogued");
    expect(held.leadHours!.median / 24).toBeGreaterThanOrEqual(14);
    expect(text).toContain("to within the hour");
    expect(held.timingErrorMinutes!).toBeLessThan(60);
    expect(text).toContain("most early warnings are other orbit changes");
    expect(held.falseAlarmRate!).toBeGreaterThan(0.5);
    expect(text).toContain("a watch list, not a confirmation");
    expect(text).toContain("The target is set on confirmed breakups; the early warning is measured and reported beside it");
    expect(text).toContain(`(${REPOSITORY}/blob/main/test/early-warning.test.ts)`);
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

/** A small probability as the lifecycle prints it: to a hundredth of a percent under one percent, a tenth under ten, else whole. */
const chance = (rate: number): string => {
  const percent = rate * 100;
  if (percent === 0 || percent >= 10) return `${Math.round(percent)}%`;
  return percent < 1 ? `${percent.toFixed(2)}%` : `${percent.toFixed(1)}%`;
};

describe("the README's life of an alert", () => {
  const text = section("The life of an alert");
  const held = latest.splits.validation;
  const l = held.lifecycle;
  const tables = text
    .split("\n\n")
    .filter((block) => block.startsWith("|"))
    .map((block) => block.trim().split("\n").map((row) => row.split("|").slice(1, -1).map((cell) => cell.trim())));
  const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  const count = (n: number, unit: string) => `${words[n] ?? n} ${unit}${n === 1 ? "" : "s"}`;
  const spoken = (days: number): string => (days >= 14 ? count(Math.round(days / 7), "week") : days >= 2 ? count(Math.round(days), "day") : Math.round(days * 24) < 1 ? "under an hour" : count(Math.round(days * 24), "hour"));
  const of = (rate: number, k: number, n: number) => `${chance(rate)} (${k} of ${n})`;

  test("names the stages as the detector runs them, its time to live read from the parameters", () => {
    for (const stage of ["**A jump.**", "**The jump holds.**", "cleared as a manoeuvre", "raised as an early warning", "It is confirmed when", "It is dismissed when", "It expires when", "still open when the data ends", "**A breakup can also be confirmed with no early warning first**"]) expect(text).toContain(stage);
    expect(text).toContain(`It expires when nothing confirms it within ${DETECTOR_PARAMETERS.alertTtlDays} days.`);
    // "A few hours after the first one is catalogued": the median confirmation's lag after the first fragment.
    expect(text).toContain("a few hours after the first one is catalogued");
    expect(held.confirmedLine.lag!.median).toBeLessThan(0.5);
  });

  test("carries what became of each jump that held, with the chance it was a breakup, every cell read from the aggregate", () => {
    expect(tables).toHaveLength(2);
    const ends = { confirmed: `then confirmed by fragments or a notice, a median of ${spoken(l.ends.confirmed.days!.median)} later`, dismissed: "then dismissed: the new pieces under its launch were all old", expired: `then expired: nothing confirmed it within ${DETECTOR_PARAMETERS.alertTtlDays} days`, open: "still open where the data ends" } as const;
    expect(tables[0]).toEqual([
      ["What became of each orbit jump that held, on the held-out years", "How many", "Chance it was a reported breakup"],
      ["---", "---", "---"],
      ["Cleared as a manoeuvre", String(l.cleared.steps), of(l.cleared.realRate!, l.cleared.real, l.cleared.steps)],
      [`Raised as an early warning, a median of ${spoken(held.latencyHours!.median / 24)} after the breakup and ${spoken(held.leadHours!.median / 24)} before the first fragment`, String(l.suspected.alerts), of(l.suspected.realRate!, l.suspected.real, l.suspected.real + l.suspected.falseAlarms)],
      ...(["confirmed", "dismissed", "expired", "open"] as const).map((end) => {
        const e = l.ends[end];
        return [`... ${ends[end]}`, `${e.alerts} (${chance(e.share!)})`, of(e.realRate!, e.real, e.real + e.falseAlarms)];
      }),
    ]);
    // Every suspected alert ends one way.
    expect(Object.values(l.ends).reduce((sum, e) => sum + e.alerts, 0)).toBe(l.suspected.alerts);
  });

  test("carries the reported breakups by the path they took, which add up to the Confirmed line's targets", () => {
    const b = l.breakups;
    const rate = (k: number) => `${Math.round((k / b.targets) * 100)}% (${k} of ${b.targets})`;
    expect(tables[1]).toEqual([
      [`What happened to the ${b.targets} reported breakups whose fragments were catalogued, on the held-out years`, "Share"],
      ["---", "---"],
      ["An early warning first, then confirmed", rate(b.suspectedThenConfirmed.count)],
      ["An early warning, never confirmed", rate(b.suspectedNotConfirmed.count)],
      ["Confirmed from the fragments, with no early warning first", rate(b.confirmedWithoutSuspected.count)],
      ["Never flagged", rate(b.neverFlagged.count)],
    ]);
    const c = held.confirmedLine.lines["breakups A-B"];
    expect(b.targets).toBe(c.targets);
    expect(b.suspectedThenConfirmed.count + b.confirmedWithoutSuspected.count).toBe(c.detected);
    expect(b.suspectedThenConfirmed.count + b.suspectedNotConfirmed.count + b.confirmedWithoutSuspected.count + b.neverFlagged.count).toBe(b.targets);
  });

  test("says in one sentence, with the measured chance, that a cleared or expired alert is no guarantee nothing happened", () => {
    expect(text).toContain(`A cleared or an expired alert is no guarantee that nothing happened: on the held-out years, ${chance(l.ends.expired.realRate!)} of the expired early warnings (${l.ends.expired.real}) and ${chance(l.cleared.realRate!)} of the jumps cleared as manoeuvres (${l.cleared.real}) were on a reported breakup.`);
    expect(text).toContain(`(${REPOSITORY}/blob/main/docs/results.md#the-life-of-an-alert)`);
  });
});
