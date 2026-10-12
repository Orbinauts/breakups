import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStatements, type Statement } from "../../src/index.ts";
import { createIssue, ensureLabel, issuesLabelled } from "./github.ts";

/**
 * The quarterly reminder of what no script can read: NASA's Orbital Debris
 * Quarterly News, the U.S. Space Forces-Space notices and the news reports
 * of fragmentations, which reach the truth only as statements a person
 * types into `data/truth/hand.json`. The weekly maintenance workflow runs
 * `npm run maintenance:reminder` every Monday; in the week that starts on
 * the first Monday of January, April, July and October it opens an issue,
 * labelled `maintenance`, listing what to check by hand since the last
 * reminder, with the hand file's latest statement and how to add a row.
 * The issue is opened once per quarter, by its title, so a run made again
 * in that week opens no second one.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const MAINTENANCE_LABEL = "maintenance";
export const MAINTENANCE_COLOR = "0e8a16";
export const MAINTENANCE_DESCRIPTION = "The project's automatic upkeep: a failed run, a refused step, or a check a person must make";

/** The months a quarter's reminder falls in: January, April, July and October (0-based). */
export const REMINDER_MONTHS = [0, 3, 6, 9] as const;

const DAY_MS = 86_400_000;
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The first Monday of a month (0-based), as an ISO day. */
export function firstMonday(year: number, month: number): string {
  const first = Date.UTC(year, month, 1);
  const weekday = new Date(first).getUTCDay();
  return dayOf(first + ((8 - weekday) % 7) * DAY_MS);
}

/** A quarter's reminder: its label (`2027 Q1`), the first Monday it falls on, and the previous reminder's first Monday. */
export interface Quarter {
  label: string;
  from: string;
  previous: string;
}

/**
 * The quarter whose reminder is due on a day: the day lies in the week
 * that starts on the first Monday of January, April, July or October (the
 * Monday itself when the workflow runs on schedule, the days after it when
 * a run is made again by hand). Null on every other day.
 */
export function reminderDue(today: string): Quarter | null {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  const q = REMINDER_MONTHS.indexOf(month as (typeof REMINDER_MONTHS)[number]);
  if (q === -1) return null;
  const from = firstMonday(year, month);
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
  if (days < 0 || days > 6) return null;
  const previous = q === 0 ? firstMonday(year - 1, 9) : firstMonday(year, REMINDER_MONTHS[q - 1]!);
  return { label: `${year} Q${q + 1}`, from, previous };
}

/** The reminder issue's title for a quarter: what the dedup reads. */
export const reminderTitle = (quarter: Pick<Quarter, "label">): string => `Quarterly check of the hand-typed sources, ${quarter.label}`;

/** What the hand file holds that the reminder names: its latest statement, and the latest quarterly news issue and notice it carries. */
export interface HandFile {
  /** The statement with the latest event, by its window's end. */
  latestEvent: { to: string; ref: string } | null;
  /** The latest day a statement was stated on. */
  latestStatedOn: string | null;
  /** The latest quarterly news issue typed in, as its reference names it (`ODQN 30(3), September 2026`). */
  latestOdqn: string | null;
  /** The latest day a notice was seen on. */
  latestNotice: string | null;
}

/** Reads what the reminder names from the hand file's statements. */
export function handFileOf(statements: readonly Statement[]): HandFile {
  let latestEvent: HandFile["latestEvent"] = null;
  let latestStatedOn: string | null = null;
  let latestOdqn: { volume: number; issue: number; ref: string } | null = null;
  let latestNotice: string | null = null;
  for (const s of statements) {
    if (latestEvent === null || s.event.to > latestEvent.to) latestEvent = { to: s.event.to, ref: s.ref };
    const on = s.statedOn?.on ?? null;
    if (on !== null && (latestStatedOn === null || on > latestStatedOn)) latestStatedOn = on;
    const odqn = /ODQN (\d+)\((\d+)\)[^;:]*/.exec(s.ref);
    if (s.source === "odqn" && odqn !== null) {
      const [volume, issue] = [Number(odqn[1]), Number(odqn[2])];
      if (latestOdqn === null || volume > latestOdqn.volume || (volume === latestOdqn.volume && issue > latestOdqn.issue)) latestOdqn = { volume, issue, ref: odqn[0].replace(/,?\s*p+\.\s*[\d-]+$/, "").trim() };
    }
    if (s.source === "s4s-notice" && on !== null && (latestNotice === null || on > latestNotice)) latestNotice = on;
  }
  return { latestEvent, latestStatedOn, latestOdqn: latestOdqn?.ref ?? null, latestNotice };
}

/** The reminder issue's body: what to check since the last reminder, what the hand file already holds, and how to add a row. */
export function reminderBody(quarter: Quarter, hand: HandFile, handChangedOn: string | null): string {
  return [
    `The truth reads NASA's history, GCAT's tables and the catalogue by itself every week. Three kinds of source reach it only when a person types them into \`data/truth/hand.json\`; this is the reminder for ${quarter.label} to check them for what has come out since the last reminder, on ${quarter.previous}.`,
    "",
    "What to check:",
    "",
    `- [ ] **NASA's Orbital Debris Quarterly News**, the latest issue (https://orbitaldebris.jsc.nasa.gov/quarterly-news/): every fragmentation it reports. The hand file's latest issue is ${hand.latestOdqn ?? "none"}.`,
    `- [ ] **U.S. Space Forces-Space fragmentation notices**, posted on the public catalogue's login page: every notice since the last reminder. The hand file's latest notice was seen on ${hand.latestNotice ?? "no day"}.`,
    `- [ ] **News reports of fragmentations** since ${quarter.previous}: LeoLabs' notifications, named analysts, the space press. The hand file's latest event ends on ${hand.latestEvent?.to.slice(0, 10) ?? "no day"} (${hand.latestEvent?.ref ?? "none"}), its latest statement was made on ${hand.latestStatedOn ?? "no day"}, and the file last changed on ${handChangedOn ?? "a day git does not know"}.`,
    "- [ ] **ESA's Space Environment Report**, once a year: a new edition's table of fragmentations.",
    "",
    "The daily watcher opens a prefilled `breakup-report` issue for each new quarterly news issue, ESA edition, Jonathan's Space Report section and news article it reads; what it does not read (the Space Forces notices among them) is for this check.",
    "",
    "How to add a row:",
    "",
    "- The quick path: file the report with the breakup-report issue form (or complete an issue the watcher opened), then label it `breakup-report-accepted`. A workflow checks the fields, adds the statement on a branch and runs the maintenance workflow on it.",
    "",
    "By hand, for several rows at once:",
    "",
    "1. Write each statement as JSON, as the others in `data/truth/hand.json` are written: the source, the reference (issue and page, or the post's address and day), the kind, the parent (catalogue number, designator, name), the event as stated and as a window, the orbit, the cause, the pieces catalogued, and when it was stated (`statedOn`), and run `npm run truth:add -- <statement.json>` for each, which checks it, appends it to the hand file and rebuilds the truth. Never edit `data/breakups.json`.",
    "2. Read the diff of `docs/truth.md`: the event added or joined, and any conflict it makes.",
    "3. Commit the hand file with `data/breakups.json` and `docs/truth.md` on a branch and push it, then run `gh workflow run maintenance.yml -f from=<branch>`. The maintenance workflow folds the branch in, rebuilds the truth, replays the scorecard, regenerates the README's tables, runs every check and merges the result into main as one commit; the branch can then be deleted.",
    "",
    "Close this issue once the checks are done, with a word on what was added.",
  ].join("\n");
}

function main(): void {
  const today = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  const quarter = reminderDue(today);
  if (quarter === null) {
    console.log(`${today}: no quarterly reminder is due`);
    return;
  }
  const title = reminderTitle(quarter);
  ensureLabel(MAINTENANCE_LABEL, MAINTENANCE_COLOR, MAINTENANCE_DESCRIPTION);
  const existing = issuesLabelled(MAINTENANCE_LABEL).find((issue) => issue.title === title);
  if (existing !== undefined) {
    console.log(`${title}: already opened, ${existing.url}`);
    return;
  }
  const statements = readStatements((JSON.parse(readFileSync(join(ROOT, "data/truth/hand.json"), "utf8")) as { statements: unknown }).statements);
  const changed = execFileSync("git", ["log", "-1", "--format=%cs", "--", "data/truth/hand.json"], { cwd: ROOT, encoding: "utf8" }).trim();
  console.log(`${title}: ${createIssue(title, reminderBody(quarter, handFileOf(statements), changed === "" ? null : changed), MAINTENANCE_LABEL)}`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("reminder.ts")) main();
