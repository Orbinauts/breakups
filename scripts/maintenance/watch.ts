import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceId } from "../../src/truth.ts";
import { formBody } from "../truth/report-form.ts";
import { ACCEPT_LABEL, REPORT_LABEL } from "../truth/report-issue.ts";
import { createIssue, ensureLabel, issuesLabelled } from "./github.ts";
import { MAINTENANCE_COLOR, MAINTENANCE_DESCRIPTION, MAINTENANCE_LABEL } from "./reminder.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The watcher of public notices: `npm run maintenance:watch`, run once a
 * day by `.github/workflows/watch.yml`. It reads the notices of
 * fragmentations that anyone can read without an account, and opens an
 * issue for each new one: for a report (an analyst's section, a news
 * article) a `breakup-report` issue prefilled with its source, the day it
 * was published, a reference and the link, for a person to complete and
 * the owner to accept; for a new issue of the quarterly news or edition of
 * ESA's report, which may report many breakups or none, a `maintenance`
 * issue asking a person to read it and record it as the truth's files do. It never writes the truth itself: a notice
 * becomes a statement only through the breakup-report workflow, once the
 * owner has labelled the issue `breakup-report-accepted`.
 *
 * What it reads, each page's shape checked as it was served on 2026-10-12:
 *
 * - NASA's Orbital Debris Quarterly News, the list of issues: each issue
 *   `data/truth/odqn-coverage.json` does not record as read.
 * - ESA's Space Environment Report, the yearly edition's page: each
 *   edition after the latest `data/truth/esa-ser.json` types.
 * - Jonathan's Space Report, the back issues: each section of an issue
 *   after the last read that reports a breakup, quoted.
 * - The news: the RSS feeds of EarthSky, Space.com, SpaceNews and Ars
 *   Technica's space desk, each article of the last three days whose title
 *   reports a breakup. A day's articles are one issue, since several
 *   publishers report one breakup at once.
 *
 * An issue carries its notices' keys in hidden lines, and the issues of
 * both labels are read in every state first, so a notice opens one issue
 * however many runs see it. A page that cannot be read, or whose shape
 * changed, fails the run after the other pages are read and their issues
 * opened.
 */

/** A notice read from a watched page. */
export interface Notice {
  /** What makes it one notice across runs: the source and the item's own name or address. */
  key: string;
  source: SourceId;
  title: string;
  /** The day it was published (a month, `2026-12`, for a quarterly issue); null where the page gives none. */
  published: string | null;
  url: string;
  /** The reference prefilled, as the hand file cites one. */
  ref: string;
  /** What the page says of it: an issue's contents, a quoted paragraph. */
  lines: string[];
}

/** The last issue of Jonathan's Space Report when the watcher began, 2026-10-12: only later ones are watched. The quarterly news and ESA's report are watched from what the truth's own files record as read. */
export const JSR_AFTER = 860;

/** What `data/truth/odqn-coverage.json` records: the issues read, by their address, and the list's first issue (those before it NASA's history covers). */
export interface OdqnCoverage {
  read: ReadonlySet<string>;
  from: readonly [number, number];
}

export function odqnRead(coverage: string): OdqnCoverage {
  const issues = (JSON.parse(coverage) as { issues: { issue: string; url: string }[] }).issues;
  const numbers = issues.map((issue) => /^(\d+)\((\d+)/.exec(issue.issue)).filter((m) => m !== null).map((m) => [Number(m[1]), Number(m[2])] as const);
  const from = numbers.reduce((a, b) => (b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]) ? b : a));
  return { read: new Set(issues.map((issue) => issue.url)), from };
}

/** The latest edition of ESA's report `data/truth/esa-ser.json` types. */
export function esaLatest(file: string): number {
  return Math.max(...(JSON.parse(file) as { editions: { edition: string }[] }).editions.map((e) => Number(e.edition)));
}

/** How far back the news is read: articles the runs before read are older. */
export const NEWS_DAYS = 3;
/** At most this many issues a run: a page read wrong opens no flood. */
export const MAX_ISSUES = 5;

export const FEEDS = [
  { publisher: "EarthSky", url: "https://earthsky.org/feed/" },
  { publisher: "Space.com", url: "https://www.space.com/feeds/all" },
  { publisher: "SpaceNews", url: "https://spacenews.com/feed/" },
  { publisher: "Ars Technica", url: "https://arstechnica.com/space/feed/" },
] as const;

const ODQN_PAGE = "https://orbitaldebris.jsc.nasa.gov/quarterly-news/";
const ODQN_ORIGIN = "https://orbitaldebris.jsc.nasa.gov";
const esaPage = (year: number): string => `https://www.esa.int/Space_Safety/Space_Debris/ESA_Space_Environment_Report_${year}`;
const JSR_BACK = "https://planet4589.org/space/jsr/back/";
const jsrIssue = (number: number): string => `${JSR_BACK}news.${number}.txt`;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number): string => String(n).padStart(2, "0");

/** Text with its markup's entities read: the named ones the pages use and the numbered ones. */
function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words that say a body broke up or apart. A breakup's own words, never an explosion alone, which a launch's failure shares. */
const BREAKING = /\b(?:break(?:s|ing)?[ -]?(?:up|apart)|broke[ -]?(?:up|apart)|break-?ups?|fragmentation|fragment(?:s|ed)? (?:in|into)|shatter(?:s|ed)?|debris[- ]generating)\b/i;
/** Words that name a body in orbit. */
const IN_ORBIT = /\b(?:satellites?|rockets?|stages?|spacecraft|orbit(?:al|s)?|starlink|space junk)\b/i;

/** Whether a title or a paragraph reports a breakup: a body broken up or apart, and a body in orbit. */
export const isBreakupTitle = (text: string): boolean => BREAKING.test(text) && IN_ORBIT.test(text);

/**
 * The quarterly news' issues on its list, newest first, from the
 * coverage list's first on, that it does not record as read (by their
 * addresses). Each is referenced as the hand file cites the quarterly
 * news (`ODQN 30(3), September 2026`), with the issue's contents.
 */
export function odqnNotices(html: string, coverage: OdqnCoverage): Notice[] {
  const notices: Notice[] = [];
  for (const article of html.split(/<article>/).slice(1)) {
    const head = /<a href="(\/quarterly-news\/pdfs\/ODQNv(\d+)i(\d+)\.pdf)"[^>]*>\s*([A-Za-z]+)\s+(\d{4})\s*<\/a>\s*<b>\s*\|\s*Volume\s+\d+\s*-\s*([^<]*?)\s*<\/b>/.exec(article);
    if (head === null) continue;
    const [, path, volume, issue, monthName, year, issueText] = head;
    const month = MONTHS.indexOf(monthName!);
    if (month === -1) throw new Error(`the quarterly news' issue ${path} is dated ${monthName} ${year}, not a month`);
    const named = decode(issueText!);
    const ref = `ODQN ${volume}(${issue}), ${monthName} ${year}${named === `Issue ${issue}` ? "" : ` (${named})`}`;
    const lines = [...(article.split("</article>")[0] ?? "").matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => decode(m[1]!));
    notices.push({ key: `odqn:ODQNv${volume}i${issue}`, source: "odqn", title: `Orbital Debris Quarterly News ${volume}(${issue}), ${monthName} ${year}`, published: `${year}-${pad(month + 1)}`, url: `${ODQN_ORIGIN}${path}`, ref, lines });
  }
  if (notices.length === 0) throw new Error(`the quarterly news' list (${ODQN_PAGE}) lists no issue: its shape changed`);
  const [v, i] = coverage.from;
  return notices.filter((n) => {
    const [, volume, issue] = /ODQNv(\d+)i(\d+)/.exec(n.key)!.map(Number);
    return !coverage.read.has(n.url) && (volume! > v || (volume === v && issue! >= i));
  });
}

/** A year's edition of ESA's report, from its page: the report's issue and revision, its day and its link. */
export function esaNotice(html: string, year: number): Notice {
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
  if (!title.includes(`Space Environment Report ${year}`)) throw new Error(`ESA's page is not the ${year} edition: its title is "${title}"`);
  const link = /https:\/\/[^"]*\/Space_Environment_Report_I(\d+)R(\d+)_(\d{4})(\d{2})(\d{2})\.pdf/.exec(html);
  if (link === null) throw new Error(`ESA's page of the ${year} edition links no report`);
  const [url, issue, revision, y, m, d] = link;
  return {
    key: `esa-ser:${year}`,
    source: "esa-ser",
    title: `ESA Space Environment Report ${year}`,
    published: `${y}-${m}-${d}`,
    url: url!,
    ref: `ESA Space Environment Report ${year} (issue ${issue}.${revision}, dated ${Number(d)} ${MONTHS[Number(m) - 1]} ${y})`,
    lines: [],
  };
}

/** The latest issue the report's back issues list, by its number: a corrected or lettered file is not an issue. */
export function jsrLatest(html: string): number {
  const numbers = [...html.matchAll(/href="\.\/news\.(\d+)\.txt"/g)].map((m) => Number(m[1]));
  if (numbers.length === 0) throw new Error(`the report's back issues (${JSR_BACK}) lists no issue: its shape changed`);
  return Math.max(...numbers);
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Each section of an issue whose text reports a breakup, its paragraphs that say so quoted. */
export function jsrNotices(text: string, number: number): Notice[] {
  const head = /^Jonathan's Space Report\s*\nNo\. (\d+)\s+(\d{4}) ([A-Z][a-z]{2}) +(\d{1,2})\b/.exec(text);
  if (head === null || Number(head[1]) !== number) throw new Error(`the text read is not issue ${number} of the report`);
  const published = `${head[2]}-${pad(SHORT_MONTHS.indexOf(head[3]!) + 1)}-${pad(Number(head[4]))}`;
  const lines = text.split("\n");
  const starts = lines.flatMap((line, i) => (i > 2 && line.trim() !== "" && /^-{3,}\s*$/.test(lines[i + 1] ?? "") ? [i] : []));
  const url = jsrIssue(number);
  return starts.flatMap((start, s) => {
    const name = lines[start]!.trim();
    const body = lines.slice(start + 2, starts[s + 1] ?? lines.length).join("\n");
    const paragraphs = body.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p !== "" && isBreakupTitle(p));
    if (paragraphs.length === 0) return [];
    return [{ key: `jsr:${number}:${name}`, source: "analyst" as const, title: `Jonathan's Space Report No. ${number}: ${name}`, published, url, ref: `J. McDowell, Jonathan's Space Report No. ${number}, ${published} (${url}): '${paragraphs.join(" ")}'`, lines: paragraphs }];
  });
}

/** A publisher's articles in its RSS feed whose title reports a breakup. */
export function feedNotices(xml: string, publisher: string): Notice[] {
  if (!/<rss[\s>]/.test(xml) || !xml.includes("<channel>")) throw new Error(`${publisher}'s feed is not an RSS channel: its shape changed`);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap((m) => {
    const item = m[1]!;
    const field = (name: string): string | null => {
      const found = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(item);
      return found === null ? null : decode(found[1]!);
    };
    const title = field("title");
    const url = field("link");
    const date = field("pubDate");
    if (title === null || url === null || !/^https:\/\//.test(url) || !isBreakupTitle(title)) return [];
    const ms = date === null ? Number.NaN : Date.parse(date);
    const published = Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
    return [{ key: `news:${url}`, source: "news" as const, title, published, url, ref: `${publisher}, ${published ?? "undated"} (${url}): '${title}'`, lines: [] }];
  });
}

/** The hidden line an issue carries a notice's key in. */
export const keyLine = (key: string): string => `<!-- watch-key: ${key} -->`;

/** The notice keys the issues' bodies carry. */
export function watchedKeys(bodies: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const body of bodies) for (const match of body.matchAll(/<!-- watch-key: (.+?) -->/g)) keys.add(match[1]!);
  return keys;
}

const DAY_MS = 86_400_000;

/** The notices that open an issue: those no issue carries yet, each once, the news only of the last days. */
export function toOpen(notices: readonly Notice[], issued: ReadonlySet<string>, now: number): Notice[] {
  const since = new Date(now - (NEWS_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
  const seen = new Set(issued);
  return notices.filter((notice) => {
    if (seen.has(notice.key)) return false;
    if (notice.source === "news" && (notice.published === null || notice.published < since)) return false;
    seen.add(notice.key);
    return true;
  });
}

export interface WatchIssue {
  title: string;
  body: string;
  /** `breakup-report` for a report a form states; `maintenance` for an issue or edition a person reads and records. */
  label: string;
}

const HOW = `Complete the fields above as the report states them (the kind, the object, the time as stated, its precision and window), one statement to an issue (the breakup-report form opens another), then label this issue \`${ACCEPT_LABEL}\`: a workflow checks it and adds it to the ground truth. Close it if it reports no breakup.`;

function body(first: Notice, others: readonly Notice[]): string {
  const read = (n: Notice): string => `- [${n.title}](${n.url}), published ${n.published ?? "on a day the page does not give"}`;
  return [
    formBody({ source: first.source, published: first.published, ref: first.ref, url: first.url }),
    "",
    "### What the watcher read",
    "",
    read(first),
    ...first.lines.map((line) => `  > ${line}`),
    ...(others.length === 0 ? [] : ["", "Other articles of the day, each a report of its own (the form above is the first's):", "", ...others.map((n) => `${read(n)}; reference: ${n.ref}`)]),
    "",
    HOW,
    "",
    ...[first, ...others].map((n) => keyLine(n.key)),
    "",
  ].join("\n");
}

/** What a person does with a new quarterly news issue or ESA edition, which may report many breakups or none. */
const RECORD: Partial<Record<SourceId, string>> = {
  odqn: "Read the issue for every on-orbit fragmentation it reports. File each as a report of its own with the breakup-report issue form (source odqn, the issue's month as the day it was published, the reference with its page), or add it with `npm run truth:add` on a branch; then record the issue in `data/truth/odqn-coverage.json`, as cited or as having no breakup items, on a branch folded in by the maintenance workflow (a test fails on an issue missing from that list).",
  "esa-ser": "Type the edition's table of fragmentations (its Table 3.7) into `data/truth/esa-ser.json`, row by row as printed, on a branch folded in by the maintenance workflow; the build places each row by its rule. A row is never a breakup-report statement.",
};

function task(n: Notice): string {
  return [`A new ${n.title} is out: [${n.url}](${n.url}), published ${n.published ?? "on a day the page does not give"}.`, ...(n.lines.length === 0 ? [] : ["", "Its contents:", "", ...n.lines.map((line) => `- ${line}`)]), "", RECORD[n.source] ?? "", "", "Close this issue once it is recorded.", "", keyLine(n.key), ""].join("\n");
}

/** The issues the notices open: a task per quarterly news issue or ESA edition; a prefilled breakup-report form per report, the day's news gathered into one. */
export function issuesFor(notices: readonly Notice[]): WatchIssue[] {
  const news = notices.filter((n) => n.source === "news");
  const issues: WatchIssue[] = notices
    .filter((n) => n.source !== "news")
    .map((n) => (RECORD[n.source] !== undefined ? { title: `Read the new ${n.title}`, body: task(n), label: MAINTENANCE_LABEL } : { title: `Report: ${n.title}`, body: body(n, []), label: REPORT_LABEL }));
  if (news.length > 0) {
    const [first, ...others] = news;
    issues.push({ title: `Report: ${first!.title}${others.length === 0 ? "" : ` (and ${others.length} more article${others.length === 1 ? "" : "s"})`}`, body: body(first!, others), label: REPORT_LABEL });
  }
  return issues;
}

const USER_AGENT = "breakups-watcher (+https://github.com/Orbinauts/breakups)";

/** A page's status and text; a failure to fetch throws. */
async function get(url: string): Promise<{ status: number; text: string }> {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  return { status: response.status, text: await response.text() };
}

async function ok(url: string): Promise<string> {
  const { status, text } = await get(url);
  if (status !== 200) throw new Error(`${url} answered ${status}`);
  return text;
}

/** Every watched page's notices after what the truth was read from, each page's failure named. */
async function readAll(now: Date): Promise<{ notices: Notice[]; errors: string[] }> {
  const truthFile = (name: string): string => readFileSync(resolve(ROOT, "data/truth", name), "utf8");
  const notices: Notice[] = [];
  const errors: string[] = [];
  const attempt = async (name: string, read: () => Promise<Notice[]>): Promise<void> => {
    try {
      const found = await read();
      console.log(`${name}: ${found.length} notices`);
      notices.push(...found);
    } catch (error) {
      errors.push(`${name}: ${(error as Error).message}`);
    }
  };
  await attempt("the Orbital Debris Quarterly News", async () => odqnNotices(await ok(ODQN_PAGE), odqnRead(truthFile("odqn-coverage.json"))));
  await attempt("ESA's Space Environment Report", async () => {
    const found: Notice[] = [];
    for (let year = esaLatest(truthFile("esa-ser.json")) + 1; year <= now.getUTCFullYear(); year++) {
      const { status, text } = await get(esaPage(year));
      if (status === 404) continue;
      if (status !== 200) throw new Error(`${esaPage(year)} answered ${status}`);
      found.push(esaNotice(text, year));
    }
    return found;
  });
  await attempt("Jonathan's Space Report", async () => {
    const latest = jsrLatest(await ok(JSR_BACK));
    const found: Notice[] = [];
    for (let number = Math.max(JSR_AFTER + 1, latest - 2); number <= latest; number++) found.push(...jsrNotices(await ok(jsrIssue(number)), number));
    return found;
  });
  for (const feed of FEEDS) await attempt(`${feed.publisher}'s feed`, async () => feedNotices(await ok(feed.url), feed.publisher));
  return { notices, errors };
}

/** `--dry-run` reads the pages and prints the issues it would open, asking GitHub nothing. */
async function main(dryRun: boolean): Promise<void> {
  const now = new Date();
  if (!dryRun) {
    ensureLabel(REPORT_LABEL, "1d76db", "A published report of a breakup, for the owner to accept into the ground truth");
    ensureLabel(MAINTENANCE_LABEL, MAINTENANCE_COLOR, MAINTENANCE_DESCRIPTION);
  }
  const issued = dryRun ? new Set<string>() : watchedKeys([...issuesLabelled(REPORT_LABEL), ...issuesLabelled(MAINTENANCE_LABEL)].map((issue) => issue.body));
  const { notices, errors } = await readAll(now);
  const issues = issuesFor(toOpen(notices, issued, now.getTime()));
  for (const issue of issues.slice(0, MAX_ISSUES)) console.log(dryRun ? `would open "${issue.title}":\n${issue.body}\n` : `${issue.title}: ${createIssue(issue.title, issue.body, issue.label)}`);
  if (issues.length > MAX_ISSUES) console.log(`${issues.length - MAX_ISSUES} more wait for the next run`);
  if (issues.length === 0) console.log("no new notice");
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("watch.ts")) await main(process.argv.includes("--dry-run"));
