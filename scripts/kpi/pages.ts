import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as library from "../../src/index.ts";
import { DETECTOR_PARAMETERS, readBreakups, yearOf, type Breakup } from "../../src/index.ts";
import { parseGcat } from "../truth/parse-gcat.ts";
import { ALERT_ENDS, BREAKUP_PATHS, CONFIRMED_TABLES, chance, detectedAllLines, falseAlarmsPerYear, lifecycleTables, resultsTables, type AlertEnd, type BreakupPath, type Latest } from "./kpi.ts";

/**
 * The generated parts of the README and the documentation pages:
 * `npm run kpi:readme` rewrites, between explicit markers, every part of
 * those pages that states a number of the scorecard or of the truth, and
 * nothing else, so the prose around them stays as written. Each part sits
 * between `<!-- <name>:begin -->` and `<!-- <name>:end -->`; a block part
 * (a table, a fenced block) has a blank line on either side of it, so the
 * Markdown reads as it would without the markers, and an inline part (a
 * sentence, a count) sits between the markers with nothing around it.
 * Every name is marked once, on one page (`GENERATED_PARTS`).
 *
 * The README carries the summary: the table of the held-out years against
 * the target (`kpi:summary`), the early warning's table beside it
 * (`kpi:early-warning`), the sentence saying whether the target is
 * reached (`kpi:target`), the life of an alert, what each orbit jump that
 * held became and the chance at each end that it was a breakup
 * (`kpi:lifecycle`), with the sentence on what a cleared or expired alert
 * still hides (`kpi:lifecycle-caveat`), and what the quick start prints
 * (`truth:quick-start`), which is the README's own code run against the
 * truth. `docs/results.md` carries the full results: the headline of both
 * splits for the Confirmed line (`kpi:current`) and the early warning
 * (`kpi:current-early-warning`), the sentence saying which splits reach
 * the target (`kpi:splits`), the sentences on the medians of the lead and
 * the lag (`kpi:medians`), the Confirmed tables (`kpi:confirmed`), the
 * early warning's tables (`kpi:early-warning-tables`) and the life of an
 * alert on both splits (`kpi:lifecycle-full`). `docs/ground-truth.md` carries
 * the truth's counts (`truth:counts`) and the count of GCAT's debris
 * clouds (`truth:gcat-clouds`). The prospective score's summary
 * (`prospective:score`, on the results page) is written by
 * `npm run prospective:score -- --readme`, since it reads the
 * `prospective` branch.
 *
 * The inputs are `kpi/latest.json`, `data/breakups.json` and the GCAT
 * snapshot, all committed, so the command run twice, or run on the files
 * the pages were last generated from, changes nothing.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The year the scorecard's truth counts start from. */
export const SCORING_FROM = 2005;

/** The README, the page npm and GitHub show first. */
export const README = "README.md";
/** The full results: every table of the scorecard and the prospective score. */
export const RESULTS = "docs/results.md";
/** The ground truth: what a positive event is, its counts and its sources. */
export const GROUND_TRUTH = "docs/ground-truth.md";

/** Every generated part, by the page that holds it. */
export const GENERATED_PARTS: Readonly<Record<string, readonly string[]>> = {
  [README]: ["kpi:summary", "kpi:early-warning", "kpi:target", "kpi:lifecycle", "kpi:lifecycle-caveat", "truth:quick-start"],
  [RESULTS]: ["kpi:current", "kpi:current-early-warning", "kpi:splits", "kpi:medians", "kpi:confirmed", "kpi:early-warning-tables", "kpi:lifecycle-full", "prospective:score", "truth:kept-out-by-window"],
  [GROUND_TRUTH]: ["truth:counts", "truth:gcat-clouds"],
};

/** A marker's opening and closing comments. */
export const beginOf = (name: string): string => `<!-- ${name}:begin -->`;
export const endOf = (name: string): string => `<!-- ${name}:end -->`;

/** Where a marked part sits in a text: the offsets just inside its two markers. */
function spanOf(text: string, name: string): { from: number; to: number } {
  const begin = beginOf(name);
  const end = endOf(name);
  const at = text.indexOf(begin);
  if (at === -1) throw new Error(`the page has no ${begin}`);
  if (text.indexOf(begin, at + begin.length) !== -1) throw new Error(`the page has ${begin} twice`);
  const close = text.indexOf(end, at + begin.length);
  if (close === -1) throw new Error(`the page has ${begin} with no ${end} after it`);
  if (text.indexOf(end, close + end.length) !== -1) throw new Error(`the page has ${end} twice`);
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

/** A rate with its count, as the README's summary states it: "74% (17 of 23)". */
const rateOf = (rate: number | null, k: number, n: number): string => (rate === null ? "–" : `${percent(rate)} (${k} of ${n})`);

/** The README's summary: the held-out years' headline in plain words, against the target. */
export function summaryTable(latest: Latest): string {
  const held = latest.splits.validation;
  const c = held.confirmedLine;
  const line = c.lines["breakups A-B"];
  return [
    row([`Held-out years (the odd years, ${held.years[0]} to ${held.years.at(-1)})`, "Result", "Target"]),
    row(["---", "---", "---"]),
    row(["Reported breakups confirmed", rateOf(line.rate, line.detected, line.targets), "90% or more"]),
    row(["Confirmations that were false", rateOf(c.falseAlarmRate, c.falseAlarms, c.falseAlarms + c.detectedAllLines), "under 10%"]),
    row(["Median lead over the first official report", c.lead === null ? "–" : `${Math.round(c.lead.median)} days (${c.beforeStatement} of ${c.withStatement} confirmed before it)`, ""]),
    row(["Median error in the time of the breakup", c.timing === null ? "–" : duration(c.timing.median), ""]),
  ].join("\n");
}

/** The README's early-warning table: the held-out years' suspected alerts in plain words, measured beside the target. */
export function earlyWarningSummaryTable(latest: Latest): string {
  const held = latest.splits.validation;
  const line = held.lines["breakups A-B"];
  const all = held.falseAlarms + detectedAllLines(held);
  const perYear = falseAlarmsPerYear(held);
  return [
    row(["Early warning (suspected), the same years", "Result"]),
    row(["---", "---"]),
    row(["Reported breakups flagged before the first fragment was catalogued", rateOf(line.detectionRate, line.detected, line.targets)]),
    row(["Flagged only after the first fragment (late)", `${line.late} of ${line.targets}`]),
    row(["False alarms", perYear === null || held.falseAlarmRate === null ? "–" : `${Math.round(perYear)} a year, ${percent(held.falseAlarmRate)} of all early warnings (${held.falseAlarms} of ${all})`]),
    row(["Median lead over the first catalogued fragment", held.leadHours === null ? "–" : `${Math.round(held.leadHours.median / 24)} days`]),
    row(["Median error in the time of the breakup", held.timingErrorMinutes === null ? "–" : duration(held.timingErrorMinutes)]),
  ].join("\n");
}

/** A chance with its counts, as the README's lifecycle states it: "0.8% (19 of 2463)". */
const chanceOf = (rate: number | null, k: number, n: number): string => (rate === null ? "–" : `${chance(rate)} (${k} of ${n})`);

/** What each end of a suspected alert is called in the README, its timing in words where it has one. */
function endLabel(end: AlertEnd, days: number | null): string {
  if (end === "confirmed") return `then confirmed by fragments or a notice${days === null ? "" : `, a median of ${inWords(days)} later`}`;
  if (end === "dismissed") return "then dismissed: the new pieces under its launch were all old";
  if (end === "expired") return `then expired: nothing confirmed it within ${DETECTOR_PARAMETERS.alertTtlDays} days`;
  return "still open where the data ends";
}

/** The README's words for the reported breakups' paths. */
const PATH_WORDS: Record<BreakupPath, string> = {
  suspectedThenConfirmed: "An early warning first, then confirmed",
  suspectedNotConfirmed: "An early warning, never confirmed",
  confirmedWithoutSuspected: "Confirmed from the fragments, with no early warning first",
  neverFlagged: "Never flagged",
};

/** The README's life of an alert on the held-out years: what each orbit jump that held became, how many, and the chance it was a breakup; then the reported breakups by the path they took. */
export function lifecycleSummary(latest: Latest): string {
  const held = latest.splits.validation;
  const l = held.lifecycle;
  const timing = held.latencyHours === null || held.leadHours === null ? "" : `, a median of ${inWords(held.latencyHours.median / 24)} after the breakup and ${inWords(held.leadHours.median / 24)} before the first fragment`;
  const stages = [
    row(["What became of each orbit jump that held, on the held-out years", "How many", "Chance it was a reported breakup"]),
    row(["---", "---", "---"]),
    row(["Cleared as a manoeuvre", String(l.cleared.steps), chanceOf(l.cleared.realRate, l.cleared.real, l.cleared.steps)]),
    row([`Raised as an early warning${timing}`, String(l.suspected.alerts), chanceOf(l.suspected.realRate, l.suspected.real, l.suspected.real + l.suspected.falseAlarms)]),
    ...ALERT_ENDS.map((end) => {
      const e = l.ends[end];
      return row([`... ${endLabel(end, e.days?.median ?? null)}`, `${e.alerts} (${chance(e.share)})`, chanceOf(e.realRate, e.real, e.real + e.falseAlarms)]);
    }),
  ];
  const b = l.breakups;
  const paths = [
    row([`What happened to the ${b.targets} reported breakups whose fragments were catalogued, on the held-out years`, "Share"]),
    row(["---", "---"]),
    ...BREAKUP_PATHS.map((path) => row([PATH_WORDS[path], rateOf(b[path].share, b[path].count, b.targets)])),
  ];
  return `${stages.join("\n")}\n\n${paths.join("\n")}`;
}

/** The README's sentence on what a cleared or expired alert may still hide, with the measured chance. */
export function lifecycleCaveat(latest: Latest): string {
  const l = latest.splits.validation.lifecycle;
  return `A cleared or an expired alert is no guarantee that nothing happened: on the held-out years, ${chance(l.ends.expired.realRate)} of the expired early warnings (${l.ends.expired.real}) and ${chance(l.cleared.realRate)} of the jumps cleared as manoeuvres (${l.cleared.real}) were on a reported breakup.`;
}

/** The results page's early-warning headline: the held-out and the training years' suspected alerts in plain units. */
export function currentEarlyWarningTable(latest: Latest): string {
  const held = latest.splits.validation;
  const train = latest.splits.train;
  const span = (years: number[], parity: string): string => `${parity}, ${years[0]} to ${years.at(-1)}`;
  const column = (cells: Latest["splits"]["validation"]): string[] => {
    const line = cells.lines["breakups A-B"];
    const perYear = falseAlarmsPerYear(cells);
    return [
      `${line.detected} of ${line.targets}`,
      withInterval(line.detectionRate, line.detectionInterval),
      `${line.late} of ${line.targets}`,
      `${cells.falseAlarms} of ${cells.falseAlarms + detectedAllLines(cells)}`,
      withInterval(cells.falseAlarmRate, cells.falseAlarmInterval),
      perYear === null ? "–" : String(Math.round(perYear)),
      cells.leadHours === null ? "–" : `${Math.round(cells.leadHours.median / 24)} days`,
      cells.timingErrorMinutes === null ? "–" : duration(cells.timingErrorMinutes),
    ];
  };
  const h = column(held);
  const t = column(train);
  return [
    row(["Early warning (suspected): breakups reported to the day", `Held-out years (${span(held.years, "odd")})`, `Training years (${span(train.years, "even")})`]),
    row(["---", "---", "---"]),
    ...EARLY_LABELS.map((label, i) => row([label, h[i]!, t[i]!])),
  ].join("\n");
}

const EARLY_LABELS = ["Flagged before the first fragment, of the targets", "Detection rate (95% interval)", "Flagged only after the first fragment (late)", "False alarms, of all early warnings", "False-alarm rate (95% interval)", "False alarms a year", "Median lead over the first catalogued fragment", "Median timing error"];

/** A column of the results page's first table: a split's headline in plain units. */
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

/** The results page's first table: the headline of the held-out and the training years, in plain units, against the target. */
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

/** The README's sentence that says whether the held-out years reach the target. */
export function targetSentence(latest: Latest): string {
  return reachesTarget(latest.splits.validation.confirmedLine) ? "**It reaches that target on the held-out years.**" : "**It does not reach that target yet.**";
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
/** A count in words up to twelve, in figures above, with its unit. */
const counted = (n: number, unit: string): string => `${n < WORDS.length ? WORDS[n] : n} ${unit}${n === 1 ? "" : "s"}`;

/** A span of days in plain words: weeks from two weeks, days from two days, hours below. */
export function inWords(days: number): string {
  if (days >= 14) return counted(Math.round(days / 7), "week");
  if (days >= 2) return counted(Math.round(days), "day");
  const hours = Math.round(days * 24);
  return hours < 1 ? "under an hour" : counted(hours, "hour");
}

/** The results page's sentences on the held-out years' medians: how long before the first agency statement, and how long after the first fresh piece, the confirmations came. */
export function mediansSentence(latest: Latest): string {
  const c = latest.splits.validation.confirmedLine;
  const sentences: string[] = [];
  if (c.lead !== null && c.withStatement > 0) {
    const who = c.beforeStatement === c.withStatement ? "Every held-out confirmation with an agency's statement came before that statement" : `${c.beforeStatement} of the ${c.withStatement} held-out confirmations with an agency's statement came before that statement`;
    sentences.push(c.lead.median >= 0 ? `${who}, and the median one by ${inWords(c.lead.median)}.` : `${who}, and the median one ${inWords(-c.lead.median)} after it.`);
  }
  if (c.lag !== null) sentences.push(`The median confirmation came ${inWords(c.lag.median)} after the catalogue published the first fresh piece.`);
  return sentences.length === 0 ? "No held-out confirmation is timed yet." : sentences.join(" ");
}

/** The results page's sentence that says which splits reach the target. */
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
  ["Confidence C (GCAT dates it, an authority states the month, or an analyst's dating or a company's measured instant)", (b) => b.scoreable && b.confidence === "C"],
  ["Confidence D (pieces in the catalogue, or news to the day at best)", (b) => b.scoreable && b.confidence === "D"],
];

/** The ground truth's counts from 2005, as the ground-truth page's table. */
export function truthTable(breakups: readonly Breakup[]): string {
  const since = breakups.filter((b) => yearOf(b) >= SCORING_FROM);
  return [row([`Events from ${SCORING_FROM}`, "Count"]), row(["---", "---"]), ...TRUTH_ROWS.map(([label, counts]) => row([label, String(since.filter(counts).length)]))].join("\n");
}

/** The reasons a breakup or anomalous event of a catalogued parent is kept out by the shape of its window (`windowReasonOf` in the truth's build). */
const WINDOW_REASONS: ReadonlySet<string> = new Set(["the window has no lower edge", "the window is wider than 93 days"]);

/** The rows from 2005 kept out of every line by the shape of their window, as the results page lists them. */
export function keptOutByWindowTable(breakups: readonly Breakup[]): string {
  const kept = breakups.filter((b) => yearOf(b) >= SCORING_FROM && b.exemptReason !== null && WINDOW_REASONS.has(b.exemptReason));
  const window = (b: Breakup): string => `${b.event.from === null ? "…" : b.event.from.slice(0, 10)} to ${b.event.to.slice(0, 10)}`;
  return [row(["Event", "Kind", "Confidence", "Window", "Why it is kept out"]), row(["---", "---", "---", "---", "---"]), ...kept.map((b) => row([`${b.id} ${b.parent.name}`, b.kind, b.confidence, window(b), b.exemptReason!]))].join("\n");
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

/** A page with every generated part it holds written from the inputs; the prose and the prospective score's summary are left as they are. */
export async function renderPage(path: string, text: string, inputs: ReadmeInputs): Promise<string> {
  const { latest, file, gcatClouds } = inputs;
  if (path === README) {
    let out = replacePart(text, "kpi:summary", summaryTable(latest));
    out = replacePart(out, "kpi:early-warning", earlyWarningSummaryTable(latest));
    out = replacePart(out, "kpi:target", targetSentence(latest), true);
    out = replacePart(out, "kpi:lifecycle", lifecycleSummary(latest));
    out = replacePart(out, "kpi:lifecycle-caveat", lifecycleCaveat(latest), true);
    return replacePart(out, "truth:quick-start", `\`\`\`text\n${(await quickStartOutput(out, file)).join("\n")}\n\`\`\``);
  }
  if (path === RESULTS) {
    const tables = resultsTables(latest);
    let out = replacePart(text, "kpi:current", currentTable(latest));
    out = replacePart(out, "kpi:current-early-warning", currentEarlyWarningTable(latest));
    out = replacePart(out, "kpi:splits", splitsSentence(latest), true);
    out = replacePart(out, "kpi:medians", mediansSentence(latest), true);
    out = replacePart(out, "kpi:confirmed", tables.slice(0, CONFIRMED_TABLES).join("\n\n"));
    out = replacePart(out, "kpi:early-warning-tables", tables.slice(CONFIRMED_TABLES).join("\n\n"));
    out = replacePart(out, "truth:kept-out-by-window", keptOutByWindowTable(readBreakups(file)));
    return replacePart(out, "kpi:lifecycle-full", lifecycleTables(latest).join("\n\n"));
  }
  if (path === GROUND_TRUTH) {
    const out = replacePart(text, "truth:counts", truthTable(readBreakups(file)));
    return replacePart(out, "truth:gcat-clouds", String(gcatClouds), true);
  }
  throw new Error(`${path} holds no generated part`);
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
  const inputs = readInputs();
  for (const page of Object.keys(GENERATED_PARTS)) {
    const path = join(ROOT, page);
    const before = readFileSync(path, "utf8");
    const after = await renderPage(page, before, inputs);
    if (after === before) {
      console.log(`${page}: every generated part is current`);
      continue;
    }
    writeFileSync(path, after);
    console.log(`${page}: generated parts rewritten from kpi/latest.json and data/breakups.json`);
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("kpi/pages.ts")) await main();
