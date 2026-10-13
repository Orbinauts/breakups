import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import * as library from "../src/index.ts";
import { DETECTOR_NAME, yearOf } from "../src/index.ts";
import { SPLITS, lifecycleTables, resultsTables, type Latest } from "../scripts/kpi/kpi.ts";

/**
 * The documentation pages against the files. The ground-truth page
 * (`docs/ground-truth.md`) states counts the built truth must give, and
 * the results page (`docs/results.md`) states the cells of the committed
 * aggregate and the sentences read off them; both are read here, so
 * neither can drift from the files. `npm run kpi:readme` writes those
 * parts between their markers (`scripts/kpi/pages.ts`); these tests
 * compute every cell on their own, so a fault in the generator is caught
 * here rather than copied. The README's summary is checked by
 * `readme.test.ts`.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = readFileSync(resolve(ROOT, "docs/results.md"), "utf8");
const GROUND_TRUTH = readFileSync(resolve(ROOT, "docs/ground-truth.md"), "utf8");
const PACKAGE_NAME = (JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { name: string }).name;
const file = JSON.parse(readFileSync(resolve(ROOT, "data/breakups.json"), "utf8")) as unknown;
const breakups = library.readBreakups(file);
const latest = JSON.parse(readFileSync(resolve(ROOT, "kpi/latest.json"), "utf8")) as Latest;
const SCORING_FROM = 2005;

/** A page's section under a second-level heading, to the next one. */
function section(page: string, heading: string): string {
  const start = page.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`The page has no section "${heading}"`);
  const end = page.indexOf("\n## ", start + 1);
  return page.slice(start, end === -1 ? undefined : end);
}

/** The tables of a text, each trimmed. */
const tablesOf = (text: string): string[] =>
  text
    .split("\n\n")
    .filter((block) => block.startsWith("|"))
    .map((block) => block.trim());

/** A table's rows, each a list of its cells. */
const rowsOf = (markdown: string): string[][] => markdown.split("\n").map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));

/** The content between a part's markers. */
const marked = (page: string, name: string): string => {
  const match = new RegExp(`<!-- ${name}:begin -->([\\s\\S]*?)<!-- ${name}:end -->`).exec(page);
  if (match === null) throw new Error(`No ${name} part`);
  return match[1]!.trim();
};

describe("the ground-truth page's table", () => {
  const since = breakups.filter((b) => yearOf(b) >= SCORING_FROM);
  const scoreable = since.filter((b) => b.scoreable);
  const counts: Record<string, number> = {
    All: since.length,
    "Scoreable (breakups and anomalous events of a catalogued object or of a launch)": scoreable.length,
    Breakups: since.filter((b) => b.kind === "breakup").length,
    "Anomalous events (low-velocity shedding)": since.filter((b) => b.kind === "anomalous").length,
    "Aerodynamic breakups at reentry (kept out)": since.filter((b) => b.kind === "aerodynamic").length,
    "Objects released on purpose (kept out)": since.filter((b) => b.kind === "release").length,
    "Reports naming no object (kept out)": since.filter((b) => b.kind === "unnamed").length,
    "Confidence A (an authority states the minute)": scoreable.filter((b) => b.confidence === "A").length,
    "Confidence B (an authority states the day, or a window of three days at most)": scoreable.filter((b) => b.confidence === "B").length,
    "Confidence C (GCAT dates it, an authority states the month, or an analyst's dating or a company's measured instant)": scoreable.filter((b) => b.confidence === "C").length,
    "Confidence D (pieces in the catalogue, or news to the day at best)": scoreable.filter((b) => b.confidence === "D").length,
  };
  const lines = section(GROUND_TRUTH, "The counts")
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

  test("points to the full report the truth's build writes", () => {
    expect(GROUND_TRUTH).toContain("[docs/truth.md](truth.md)");
  });
});

/** A rate as the scorecard prints it, a whole percentage. */
const percent = (rate: number): string => `${Math.round(rate * 100)}%`;
/** A rate with its Wilson 95% interval, as the scorecard prints it. */
const withInterval = (rate: number, interval: [number, number]): string => `${percent(rate)} (${percent(interval[0])} to ${percent(interval[1])})`;
/** A timing error in plain units: minutes under two hours, else hours. */
const duration = (minutes: number): string => (minutes < 120 ? `${Math.round(minutes)} minutes` : `${Math.round(minutes / 60)} hours`);

const held = latest.splits.validation;
const train = latest.splits.train;
const reaches = (c: Latest["splits"]["validation"]["confirmedLine"]): boolean => c.lines["breakups A-B"].rate! >= 0.9 && c.falseAlarmRate! < 0.1;

describe("the results page's headline", () => {
  const text = section(RESULTS, "The headline");
  const span = (years: number[], parity: string) => `${parity}, ${years[0]} to ${years.at(-1)}`;
  const column = (c: Latest["splits"]["validation"]["confirmedLine"]) => {
    const line = c.lines["breakups A-B"];
    return {
      confirmed: `${line.detected} of ${line.targets}`,
      recall: withInterval(line.rate!, line.interval!),
      falseConfirmations: `${c.falseAlarms} of ${c.falseAlarms + c.detectedAllLines}`,
      falseAlarmRate: withInterval(c.falseAlarmRate!, c.falseAlarmInterval!),
      notice: c.leadNotice == null ? "–" : `${Math.round(c.leadNotice.median)} days, ${c.beforeNotice} of ${c.withNotice} before it`,
      quarterly: c.leadQuarterly == null ? "–" : `${Math.round(c.leadQuarterly.median)} days, ${c.beforeQuarterly} of ${c.withQuarterly} before it`,
      dated: `${c.statementDays} / ${c.statementMonths}`,
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
    ["Median lead over the first agency notice dated to the day", h.notice, t.notice, ""],
    ["Median lead over NASA's quarterly news, dated to its month", h.quarterly, t.quarterly, ""],
    ["First agency statements dated to the day / to the month", h.dated, t.dated, ""],
    ["Median timing error", h.timing, t.timing, ""],
  ];

  test("carries two tables, the Confirmed line and the early warning, every cell read from the aggregate", () => {
    const tables = tablesOf(text);
    expect(tables).toHaveLength(2);
    expect(rowsOf(tables[0]!)).toEqual(expected);
  });

  test("the early warning's headline: flagged, late, the rates with their intervals, false alarms a year, the lead and the timing", () => {
    const early = (cells: Latest["splits"]["validation"]) => {
      const line = cells.lines["breakups A-B"];
      const detected = Object.values(cells.lines).reduce((sum, l) => sum + l.detected, 0);
      return [`${line.detected} of ${line.targets}`, withInterval(line.detectionRate!, line.detectionInterval!), `${line.late} of ${line.targets}`, `${cells.falseAlarms} of ${cells.falseAlarms + detected}`, withInterval(cells.falseAlarmRate!, cells.falseAlarmInterval!), String(Math.round(cells.falseAlarms / cells.years.length)), `${Math.round(cells.leadHours!.median / 24)} days`, duration(cells.timingErrorMinutes!)];
    };
    const h = early(held);
    const t = early(train);
    const labels = ["Flagged before the first fragment, of the targets", "Detection rate (95% interval)", "Flagged only after the first fragment (late)", "False alarms, of all early warnings", "False-alarm rate (95% interval)", "False alarms a year", "Median lead over the first catalogued fragment", "Median timing error"];
    expect(rowsOf(tablesOf(text)[1]!)).toEqual([
      ["Early warning (suspected): breakups reported to the day", `Held-out years (${span(held.years, "odd")})`, `Training years (${span(train.years, "even")})`],
      ["---", "---", "---"],
      ...labels.map((label, i) => [label, h[i]!, t[i]!]),
    ]);
  });

  test("says plainly which splits reach the target, and points to the live test", () => {
    const sentence = marked(RESULTS, "kpi:splits");
    const both = [reaches(held.confirmedLine), reaches(train.confirmedLine)];
    if (!both[0] && !both[1]) expect(sentence).toBe("The target is not reached on either split.");
    else if (both[0] && both[1]) expect(sentence).toBe("The target is reached on both splits.");
    else expect(sentence).toContain(both[0] ? "reached on the held-out years" : "reached on the training years");
    expect(RESULTS).toContain("(#the-live-test)");
  });
});

describe("the results page's sentences on the medians", () => {
  const c = held.confirmedLine;
  const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  const count = (n: number, unit: string) => `${words[n] ?? n} ${unit}${n === 1 ? "" : "s"}`;
  const spoken = (days: number): string => (days >= 14 ? count(Math.round(days / 7), "week") : days >= 2 ? count(Math.round(days), "day") : Math.round(days * 24) < 1 ? "under an hour" : count(Math.round(days * 24), "hour"));
  const text = marked(RESULTS, "kpi:medians");

  test("the lead over the first agency notice dated to the day, as the aggregate gives it, or that none is dated yet", () => {
    if (c.leadNotice == null || !c.withNotice) {
      expect(text).toContain("No held-out confirmation has an agency notice dated to the day yet, so the lead over the first public notice is not measured on them.");
      return;
    }
    const who = c.beforeNotice === c.withNotice ? "Every held-out confirmation with an agency notice dated to the day came before that notice" : `${c.beforeNotice} of the ${c.withNotice} held-out confirmations with an agency notice dated to the day came before that notice`;
    expect(text).toContain(c.leadNotice.median >= 0 ? `${who}, and the median one by ${spoken(c.leadNotice.median)}.` : `${who}, and the median one ${spoken(-c.leadNotice.median)} after it.`);
  });

  test("the lead over NASA's quarterly news, as the aggregate gives it", () => {
    if (c.leadQuarterly == null || !c.withQuarterly) return;
    const who = c.beforeQuarterly === c.withQuarterly ? "Every held-out confirmation with an issue of NASA's quarterly news came before that issue's month" : `${c.beforeQuarterly} of the ${c.withQuarterly} held-out confirmations with an issue of NASA's quarterly news came before that issue's month`;
    expect(text).toContain(c.leadQuarterly.median >= 0 ? `${who}, and the median one by ${spoken(c.leadQuarterly.median)}.` : `${who}, and the median one ${spoken(-c.leadQuarterly.median)} after it.`);
  });

  test("the lag after the first fresh piece, as the aggregate gives it", () => {
    expect(text).toContain(`The median confirmation came ${spoken(c.lag!.median)} after the catalogue published the first fresh piece.`);
  });
});

describe("the results page's statement of the version", () => {
  test("names one detector version where it describes the current one", () => {
    const current = RESULTS.slice(0, RESULTS.indexOf("\n## The live test\n"));
    const names = new Set([...current.matchAll(/`((?:step|fusion|scoped|confirmed)-v\d+)`/g)].map((match) => match[1]));
    expect([...names]).toEqual([DETECTOR_NAME]);
  });

  test("states the build's phase once, never two phases as current", () => {
    const ordinals = [...RESULTS.matchAll(/\bthe (\w+) phase of its build\b/g)].map((match) => match[1]);
    expect(ordinals).toHaveLength(1);
  });
});

describe("the results page's scorecard tables", () => {
  const tables = tablesOf(`${section(RESULTS, "The Confirmed line, the target")}\n${section(RESULTS, "Early warning (suspected)")}`);
  const expected = resultsTables(latest);

  test("carries every table of the aggregate it should, every cell equal", () => {
    expect(tables).toHaveLength(expected.length);
    for (const [i, table] of expected.entries()) expect(rowsOf(tables[i]!)).toEqual(rowsOf(table));
  });

  test("names the detector the aggregate was run with, and says so while it is the placeholder", () => {
    expect(latest.detector.name).toBe(DETECTOR_NAME);
    expect(latest.package.name).toBe(PACKAGE_NAME);
    if (latest.detector.name === "placeholder") {
      expect(RESULTS).toContain("The detector is not written yet.");
      const cells = latest.splits.validation;
      expect(cells.alerts + cells.falseAlarms + cells.duplicates + cells.exempt).toBe(0);
      for (const line of Object.values(cells.lines)) expect(line.detected + line.late).toBe(0);
    } else {
      expect(RESULTS).not.toContain("not written yet");
    }
  });

  // The weekly maintenance runs the suite once before its replay, on a truth it has just rebuilt: there, and only there, this is the replay's to make good (BREAKUPS_SCORECARD_PENDING).
  test.skipIf(process.env["BREAKUPS_SCORECARD_PENDING"] === "1")("is computed from the truth the package ships", () => {
    expect(latest.truthSha256).toBe(createHash("sha256").update(readFileSync(resolve(ROOT, "data/breakups.json"))).digest("hex"));
  });
});

describe("the results page's early warning", () => {
  test("is a section as prominent as the Confirmed line's: every split, with the Wilson intervals of both rates, the late, the false alarms a year and per 10,000 object-years, the lead and the timing", () => {
    const text = section(RESULTS, "Early warning (suspected)");
    const headline = rowsOf(tablesOf(text)[0]!);
    expect(headline[0]).toEqual(["Early warning (suspected): breakups A and B", "Targets", "Undetectable", "Flagged before the first fragment", "Late", "Missed", "Detection rate (95% interval)", "False alarms", "False-alarm rate (95% interval)", "False alarms a year", "False alarms per 10,000 object-years", "Lead over the first catalogued fragment, days: median (10th percentile)", "Timing error, minutes, median"]);
    expect(headline).toHaveLength(2 + SPLITS.length);
    for (const [i, split] of SPLITS.entries()) {
      const cells = latest.splits[split];
      const line = cells.lines["breakups A-B"];
      const row = headline[2 + i]!;
      expect(row.slice(1, 6)).toEqual([line.targets, line.undetectable, line.detected, line.late, line.missed].map(String));
      expect(row[6]).toBe(withInterval(line.detectionRate!, line.detectionInterval!));
      expect(row[7]).toBe(String(cells.falseAlarms));
      expect(row[8]).toBe(withInterval(cells.falseAlarmRate!, cells.falseAlarmInterval!));
      expect(row[9]).toBe((cells.falseAlarms / cells.years.length).toFixed(1));
      expect(row[10]).toBe(cells.falseAlarmsPer10kBodyYears!.toFixed(1));
      expect(row[11]).toBe(cells.leadHours === null ? "–" : `${(cells.leadHours.median / 24).toFixed(1)} (${(cells.leadHours.tail / 24).toFixed(1)})`);
      expect(row[12]).toBe(cells.timingErrorMinutes!.toFixed(1));
    }
    expect(text).toContain("(../test/early-warning.test.ts)");
    expect(text).not.toMatch(/secondary measurement/);
  });

  test("the intervals in the aggregate are the Wilson intervals of the counts", () => {
    for (const split of SPLITS) {
      const cells = latest.splits[split];
      for (const line of Object.values(cells.lines)) {
        if (line.targets === 0) expect(line.detectionInterval).toBeNull();
        else {
          expect(line.detectionInterval![0]).toBeLessThanOrEqual(line.detectionRate!);
          expect(line.detectionInterval![1]).toBeGreaterThanOrEqual(line.detectionRate!);
        }
      }
      expect(cells.falseAlarmInterval![0]).toBeLessThanOrEqual(cells.falseAlarmRate!);
      expect(cells.falseAlarmInterval![1]).toBeGreaterThanOrEqual(cells.falseAlarmRate!);
    }
  });
});

describe("the results page's life of an alert", () => {
  const text = section(RESULTS, "The life of an alert");

  test("carries the lifecycle tables of the held-out and the training years, every cell equal to the aggregate's", () => {
    const tables = tablesOf(text);
    const expected = lifecycleTables(latest);
    expect(tables).toHaveLength(expected.length);
    for (const [i, table] of expected.entries()) expect(rowsOf(tables[i]!)).toEqual(rowsOf(table));
  });

  test("adds up: every suspected alert ends one way, and every reported breakup takes one path", () => {
    for (const split of SPLITS) {
      const { lifecycle, confirmedLine } = latest.splits[split];
      expect(Object.values(lifecycle.ends).reduce((sum, e) => sum + e.alerts, 0)).toBe(lifecycle.suspected.alerts);
      for (const e of [lifecycle.suspected, ...Object.values(lifecycle.ends)]) expect(e.real + e.falseAlarms + e.neither).toBe(e.alerts);
      const b = lifecycle.breakups;
      expect(b.suspectedThenConfirmed.count + b.suspectedNotConfirmed.count + b.confirmedWithoutSuspected.count + b.neverFlagged.count).toBe(b.targets);
      expect(b.targets).toBe(confirmedLine.lines["breakups A-B"].targets);
      expect(b.suspectedThenConfirmed.count + b.confirmedWithoutSuspected.count).toBe(confirmedLine.lines["breakups A-B"].detected);
      expect(lifecycle.cleared.real).toBeLessThanOrEqual(lifecycle.cleared.steps);
    }
  });
});

describe("the results page's live test", () => {
  test("says how to score it and carries the score's summary", () => {
    const text = section(RESULTS, "The live test");
    expect(text).toContain("npm run prospective:score");
    expect(marked(text, "prospective:score")).toMatch(/^So far: /);
    expect(marked(text, "prospective:score")).toContain("Early warning: ");
  });
});

describe("the documentation pages' links", () => {
  test.each(["docs/results.md", "docs/ground-truth.md", "docs/archive.md"])("every relative link of %s names a file of the repository", (page) => {
    const text = readFileSync(resolve(ROOT, page), "utf8");
    const targets = [...text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)].map((match) => match[1]!).filter((target) => !/^[a-z]+:/.test(target));
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(existsSync(resolve(ROOT, dirname(page), target)), `${page} links ${target}`).toBe(true);
  });
});
