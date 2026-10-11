import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as library from "../../src/index.ts";
import { readBreakups, yearOf, type Breakup } from "../../src/index.ts";
import { parseGcat } from "../truth/parse-gcat.ts";
import { readmeTables, type Latest } from "./kpi.ts";

/**
 * The README's generated parts: `npm run kpi:readme` rewrites, between
 * explicit markers, every part of the README that states a number of the
 * scorecard or of the truth, and nothing else, so the prose around them
 * stays as written. Each part sits between `<!-- <name>:begin -->` and
 * `<!-- <name>:end -->`; a block part (a table, a fenced block) has a blank
 * line on either side of it, so the Markdown reads as it would without the
 * markers, and an inline part (a sentence, a count) sits between the
 * markers with nothing around it.
 *
 * The parts: the "Current results" table (`kpi:current`), the sentence
 * that says whether the held-out years reach the target (`kpi:target`)
 * and the one that says it of both splits (`kpi:splits`), the Confirmed
 * tables (`kpi:confirmed`) and the parent-step tables (`kpi:parent-step`)
 * of "How well it does", the counts of the ground truth (`truth:counts`),
 * the count of GCAT's debris clouds (`truth:gcat-clouds`) and what the
 * quick start prints (`truth:quick-start`), which is the README's own code
 * run against the truth. The prospective score's summary
 * (`prospective:score`) is written by `npm run prospective:score --
 * --readme`, since it reads the `prospective` branch.
 *
 * The inputs are `kpi/latest.json`, `data/breakups.json` and the GCAT
 * snapshot, all committed, so the command run twice, or run on the files
 * the README was last generated from, changes nothing.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The year the scorecard's truth counts start from. */
export const SCORING_FROM = 2005;

/** A marker's opening and closing comments. */
export const beginOf = (name: string): string => `<!-- ${name}:begin -->`;
export const endOf = (name: string): string => `<!-- ${name}:end -->`;

/** Where a marked part sits in a text: the offsets just inside its two markers. */
function spanOf(text: string, name: string): { from: number; to: number } {
  const begin = beginOf(name);
  const end = endOf(name);
  const at = text.indexOf(begin);
  if (at === -1) throw new Error(`the README has no ${begin}`);
  if (text.indexOf(begin, at + begin.length) !== -1) throw new Error(`the README has ${begin} twice`);
  const close = text.indexOf(end, at + begin.length);
  if (close === -1) throw new Error(`the README has ${begin} with no ${end} after it`);
  if (text.indexOf(end, close + end.length) !== -1) throw new Error(`the README has ${end} twice`);
  return { from: at + begin.length, to: close };
}

/** The content between a part's markers, without the blank lines a block part is set off by. */
export function markedPart(text: string, name: string): string {
  const { from, to } = spanOf(text, name);
  return text.slice(from, to).replace(/^\n\n/, "").replace(/\n\n$/, "");
}

/** The text with a part's content replaced: a block set off by a blank line on either side, an inline part as given. */
export function replacePart(text: string, name: string, content: string, inline = false): string {
  const { from, to } = spanOf(text, name);
  return `${text.slice(0, from)}${inline ? content : `\n\n${content.trim()}\n\n`}${text.slice(to)}`;
}

/** A rate as the scorecard prints it, a whole percentage. */
const percent = (rate: number): string => `${Math.round(rate * 100)}%`;
/** A rate with its Wilson 95% interval, as the scorecard prints it. */
const withInterval = (rate: number | null, interval: [number, number] | null): string => (rate === null || interval === null ? "–" : `${percent(rate)} (${percent(interval[0])} to ${percent(interval[1])})`);
/** A timing error in plain units: minutes under two hours, else hours. */
const duration = (minutes: number): string => (minutes < 120 ? `${Math.round(minutes)} minutes` : `${Math.round(minutes / 60)} hours`);

const row = (cells: string[]): string => `| ${cells.join(" | ")} |`;

type ConfirmedLineCells = Latest["splits"]["validation"]["confirmedLine"];

/** The "Current results" column of a split: the headline in plain units. */
function currentColumn(c: ConfirmedLineCells): string[] {
  const line = c.lines["breakups A-B"];
  return [
    `${line.detected} of ${line.targets}`,
    withInterval(line.rate, line.interval),
    `${c.falseAlarms} of ${c.falseAlarms + c.detectedAllLines}`,
    withInterval(c.falseAlarmRate, c.falseAlarmInterval),
    c.lead === null ? "–" : `${Math.round(c.lead.median)} days, ${c.beforeStatement} of ${c.withStatement} before it`,
    c.timing === null ? "–" : duration(c.timing.median),
  ];
}

const LABELS = ["Confirmed, of the targets", "Recall (95% interval)", "False confirmations, of all events confirmed", "False-alarm rate (95% interval)", "Median lead over the first agency statement", "Median timing error"];
const TARGETS = ["", "90% or more", "", "under 10%", "", ""];

/** The "Current results" table: the headline of the held-out and the training years, in plain units, against the target. */
export function currentTable(latest: Latest): string {
  const held = latest.splits.validation;
  const train = latest.splits.train;
  const span = (years: number[], parity: string): string => `${parity}, ${years[0]} to ${years.at(-1)}`;
  const h = currentColumn(held.confirmedLine);
  const t = currentColumn(train.confirmedLine);
  return [
    row(["Headline: breakups reported to the day", `Held-out years (${span(held.years, "odd")})`, `Training years (${span(train.years, "even")})`, "Target"]),
    row(["---", "---", "---", "---"]),
    ...LABELS.map((label, i) => row([label, h[i]!, t[i]!, TARGETS[i]!])),
  ].join("\n");
}

/** Whether a split reaches the target: nine confirmed breakups in ten, and fewer than one confirmation in ten false. */
export function reachesTarget(c: ConfirmedLineCells): boolean {
  const rate = c.lines["breakups A-B"].rate;
  return rate !== null && rate >= 0.9 && c.falseAlarmRate !== null && c.falseAlarmRate < 0.1;
}

/** The sentence of "Current results" that says whether the held-out years reach the target. */
export function targetSentence(latest: Latest): string {
  return reachesTarget(latest.splits.validation.confirmedLine) ? "**It reaches that target on the held-out years.**" : "**It does not reach that target on the held-out years.**";
}

/** The sentence of "How well it does" that says which splits reach the target. */
export function splitsSentence(latest: Latest): string {
  const held = reachesTarget(latest.splits.validation.confirmedLine);
  const train = reachesTarget(latest.splits.train.confirmedLine);
  if (held && train) return "The target is reached on both splits.";
  if (held) return "The target is reached on the held-out years, not on the training years.";
  if (train) return "The target is reached on the training years, not on the held-out years.";
  return "The target is not reached on either split.";
}

/** The ground-truth table's rows: a label and the events from 2005 it counts. */
export const TRUTH_ROWS: readonly (readonly [string, (b: Breakup) => boolean])[] = [
  ["All", () => true],
  ["Scoreable (breakups and anomalous events of a catalogued object)", (b) => b.scoreable],
  ["Breakups", (b) => b.kind === "breakup"],
  ["Anomalous events (low-velocity shedding)", (b) => b.kind === "anomalous"],
  ["Aerodynamic breakups at reentry (kept out)", (b) => b.kind === "aerodynamic"],
  ["Objects released on purpose (kept out)", (b) => b.kind === "release"],
  ["Reports naming no object (kept out)", (b) => b.kind === "unnamed"],
  ["Confidence A (an authority states the minute)", (b) => b.scoreable && b.confidence === "A"],
  ["Confidence B (an authority states the day, or a window of three days at most)", (b) => b.scoreable && b.confidence === "B"],
  ["Confidence C (GCAT alone, an authority's month, or an analyst's dating)", (b) => b.scoreable && b.confidence === "C"],
  ["Confidence D (pieces in the catalogue, or news with no time)", (b) => b.scoreable && b.confidence === "D"],
];

/** The ground truth's counts from 2005, as the README's table. */
export function truthTable(breakups: readonly Breakup[]): string {
  const since = breakups.filter((b) => yearOf(b) >= SCORING_FROM);
  return [row([`Events from ${SCORING_FROM}`, "Count"]), row(["---", "---"]), ...TRUTH_ROWS.map(([label, counts]) => row([label, String(since.filter(counts).length)]))].join("\n");
}

/** The fenced block of a language in a text, its content. */
function fenced(text: string, language: string): string {
  const match = new RegExp("```" + language + "\\n([\\s\\S]*?)```").exec(text);
  if (match === null) throw new Error(`the README has no ${language} block`);
  return match[1]!;
}

/**
 * What the README's quick start prints: its JavaScript block run against
 * the library and the truth file, its two imports bound to them, and
 * every line it logs collected.
 */
export async function quickStartOutput(readme: string, file: unknown): Promise<string[]> {
  const start = readme.indexOf("\n## Quick start\n");
  if (start === -1) throw new Error("the README has no Quick start section");
  const code = fenced(readme.slice(start), "js");
  const names: string[] = [];
  const bindings: unknown[] = [];
  for (const [, named, defaulted] of code.matchAll(/^import (?:\{ ([\w, ]+) \}|(\w+)) from "[^"]+"[^\n]*\n/gm)) {
    if (named !== undefined) {
      for (const name of named.split(", ")) {
        names.push(name);
        bindings.push((library as Record<string, unknown>)[name]);
      }
    } else {
      names.push(defaulted!);
      bindings.push(file);
    }
  }
  const logged: string[] = [];
  const log = { log: (...parts: unknown[]) => logged.push(parts.join(" ")) };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<void>;
  await new AsyncFunction(...names, "console", code.replace(/^import [^\n]*\n/gm, ""))(...bindings, log);
  return logged;
}

/** What the generated parts are made from. */
export interface ReadmeInputs {
  latest: Latest;
  /** The truth file as parsed JSON, which the quick start reads. */
  file: unknown;
  /** How many debris clouds GCAT's table holds. */
  gcatClouds: number;
}

/** The README with every generated part written from the inputs; the prose and the prospective score's summary are left as they are. */
export async function renderReadme(readme: string, inputs: ReadmeInputs): Promise<string> {
  const { latest, file, gcatClouds } = inputs;
  const breakups = readBreakups(file);
  const tables = readmeTables(latest);
  let text = readme;
  text = replacePart(text, "kpi:current", currentTable(latest));
  text = replacePart(text, "kpi:target", targetSentence(latest), true);
  text = replacePart(text, "kpi:splits", splitsSentence(latest), true);
  text = replacePart(text, "kpi:confirmed", tables.slice(0, 3).join("\n\n"));
  text = replacePart(text, "kpi:parent-step", tables.slice(3).join("\n\n"));
  text = replacePart(text, "truth:counts", truthTable(breakups));
  text = replacePart(text, "truth:gcat-clouds", String(gcatClouds), true);
  text = replacePart(text, "truth:quick-start", `\`\`\`text\n${(await quickStartOutput(text, file)).join("\n")}\n\`\`\``);
  return text;
}

/** The inputs as committed. */
export function readInputs(root = ROOT): ReadmeInputs {
  return {
    latest: JSON.parse(readFileSync(join(root, "kpi/latest.json"), "utf8")) as Latest,
    file: JSON.parse(readFileSync(join(root, "data/breakups.json"), "utf8")) as unknown,
    gcatClouds: parseGcat(readFileSync(join(root, "data/truth/sources/gcat-debriscat.html"), "utf8")).rows.length,
  };
}

async function main(): Promise<void> {
  const path = join(ROOT, "README.md");
  const before = readFileSync(path, "utf8");
  const after = await renderReadme(before, readInputs());
  if (after === before) {
    console.log("README.md: every generated part is current");
    return;
  }
  writeFileSync(path, after);
  console.log("README.md: generated parts rewritten from kpi/latest.json and data/breakups.json");
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("kpi/readme.ts")) await main();
