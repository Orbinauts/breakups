import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { firstAgencyStatement, launchOf, readBreakups, type Breakup, type FirstStatement } from "../../src/index.ts";
import { landConfirmed, lowerOf, marginDaysOf, type Row } from "../kpi/match.ts";
import { DAY_MS } from "../kpi/replay.ts";
import { replacePart, RESULTS } from "../kpi/pages.ts";
import { FREEZE_AT, FREEZE_MS, parseJsonl, type LoggedAlert } from "./alerts.ts";
import { runUrlOf } from "./run.ts";

/**
 * The prospective test's score: `npm run prospective:score`. It reads the
 * `prospective` branch's `alerts.jsonl`, the commit that added each line
 * (its commit time is when the alert was known), and the truth as it
 * stands (`data/breakups.json`), and prints the Confirmed headline for the
 * events after the freeze: the confirmed alerts that land on a reported
 * event, each with its lead over the event's first agency statement from
 * the commit that logged it; the false confirmations, which land on none;
 * and the reported events with fragments that no alert confirmed. A
 * confirmation lands as the scorecard's Confirmed line lands it
 * (`landConfirmed`), on the parent within the window and the half year
 * after, a confirmation by a notice alone excluded.
 *
 * The truth is built from the agencies' reports, which come months after
 * an event, so the score is honest only once the truth has caught up: it
 * prints when the truth last changed and warns that the events of the last
 * three months or so may not be reported yet. Without the Archive the
 * fragments of an event are its reported count of catalogued pieces: an
 * event whose count is not yet stated is listed apart, neither confirmed
 * nor missed.
 *
 * `--markdown <path>` also writes the score as Markdown (the weekly
 * maintenance writes it to `score.md` on the `prospective` branch), and
 * `--readme` rewrites the summary of it between the `prospective:score`
 * markers of the results page, `docs/results.md`, which the README links
 * to. The truth's last change is the last commit that changed it, or
 * today where the working tree's truth differs from the base commit's
 * (`--base`, the last commit by default), as it does in a maintenance run
 * that rebuilt it.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** How long the truth may lag the events: the agencies' quarterly reports. */
export const TRUTH_LAG_DAYS = 90;

/** When each alert was committed, by its key: the first commit that added its line. */
export type CommittedAt = Map<string, number>;

/**
 * The commit time of each line of `alerts.jsonl`, from the text of
 * `git log --reverse --format=commit\ %H\ %cI --unified=0 -p` over the file:
 * every added line belongs to the commit above it, and a key's first
 * commit is the one kept.
 */
export function committedAtOf(log: string): CommittedAt {
  const at: CommittedAt = new Map();
  let current: number | null = null;
  for (const line of log.split("\n")) {
    const commit = /^commit [0-9a-f]{40} (\S+)$/.exec(line);
    if (commit !== null) {
      current = Date.parse(commit[1]!);
      continue;
    }
    if (current === null || !line.startsWith("+{")) continue;
    const key = (JSON.parse(line.slice(1)) as Pick<LoggedAlert, "key">).key;
    if (!at.has(key)) at.set(key, current);
  }
  return at;
}

/** A truth row as the Confirmed line lands verdicts on it, with no fragments: a landing on a fragment wants the Archive, which the score does not read. */
export function rowsOf(breakups: readonly Breakup[]): Row[] {
  return breakups.map((breakup) => ({ breakup, from: lowerOf(breakup), to: Date.parse(breakup.event.to), margin: marginDaysOf(breakup.orbit.regime) * DAY_MS, launch: launchOf(breakup.parent.designator), fragments: new Set<number>(), scored: null }));
}

export interface Landed {
  alert: LoggedAlert;
  committedAt: number | null;
  outcome: string;
  event: string | null;
  note: string;
}

export interface Detection extends Landed {
  breakup: Breakup;
  statement: FirstStatement | null;
  /** Days from the commit that logged the alert to the start of the day of the event's first agency statement; positive where the alert came first. */
  leadDays: number | null;
}

export interface ProspectiveScore {
  freeze: string;
  /** Every logged alert, by state, the clouds apart. */
  logged: Record<string, number>;
  confirmed: number;
  detections: Detection[];
  falseConfirmations: Landed[];
  /** Confirmed alerts that land elsewhere: on an event before the freeze, inside an exempt row's window, or on an event already confirmed. */
  notCounted: Landed[];
  /** The scoreable events after the freeze with catalogued pieces that no confirmed alert landed on. */
  missed: Breakup[];
  /** The scoreable events after the freeze whose count of pieces the truth does not state yet. */
  awaitingPieces: Breakup[];
  /** The scoreable events after the freeze with pieces: the headline's denominator. */
  reported: number;
}

/** The Confirmed headline over the alerts logged since the freeze, against the truth. */
export function scoreProspective(alerts: readonly LoggedAlert[], committedAt: CommittedAt, breakups: readonly Breakup[], freezeMs = FREEZE_MS): ProspectiveScore {
  const rows = rowsOf(breakups);
  const byId = new Map(breakups.map((breakup) => [breakup.id, breakup]));
  const logged: Record<string, number> = {};
  for (const alert of alerts) {
    const name = alert.kind === "cloud" ? "cloud" : alert.state;
    logged[name] = (logged[name] ?? 0) + 1;
  }
  // The first confirmation of an event counts, so they are read in the order they were known.
  const known = (alert: LoggedAlert): number => committedAt.get(alert.key) ?? Number.POSITIVE_INFINITY;
  const confirmed = alerts.filter((alert) => alert.kind === "object" && alert.state === "confirmed" && alert.number !== null && alert.verdict.evidence.noticed !== 1).sort((a, b) => known(a) - known(b) || Date.parse(a.raisedAt) - Date.parse(b.raisedAt));
  const detections: Detection[] = [];
  const falseConfirmations: Landed[] = [];
  const notCounted: Landed[] = [];
  const caught = new Set<string>();
  confirmed.forEach((alert, i) => {
    // The headline's reading: a verdict naming twins lands on the body it names first.
    const landing = landConfirmed(alert.verdict, i, rows);
    const { outcome, event } = landing;
    const twin = landing.twin !== undefined && landing.twin.event !== event ? `; matched at the launch it would land on ${landing.twin.event ?? "nothing"}` : "";
    const landed: Landed = { alert, committedAt: committedAt.get(alert.key) ?? null, outcome, event, note: `${landing.note}${twin}` };
    const breakup = event === null ? undefined : byId.get(event);
    if (outcome === "false-alarm") falseConfirmations.push(landed);
    else if (outcome === "detection" && breakup !== undefined && caught.has(breakup.id)) notCounted.push({ ...landed, outcome: "duplicate", note: "a later confirmation of an event already confirmed" });
    else if (outcome === "detection" && breakup !== undefined && lowerOf(breakup) >= freezeMs) {
      caught.add(breakup.id);
      const statement = firstAgencyStatement(breakup);
      const statedAt = statement === null ? null : Date.parse(`${statement.on.length === 7 ? `${statement.on}-01` : statement.on.length === 4 ? `${statement.on}-01-01` : statement.on}T00:00:00Z`);
      detections.push({ ...landed, breakup, statement, leadDays: statedAt === null || landed.committedAt === null ? null : Math.round(((statedAt - landed.committedAt) / DAY_MS) * 10) / 10 });
    } else notCounted.push(landed);
  });
  const after = breakups.filter((breakup) => breakup.scoreable && lowerOf(breakup) >= freezeMs);
  const withPieces = after.filter((breakup) => (breakup.piecesCatalogued ?? 0) > 0);
  return {
    freeze: new Date(freezeMs).toISOString(),
    logged,
    confirmed: confirmed.length,
    detections,
    falseConfirmations,
    notCounted,
    missed: withPieces.filter((breakup) => !caught.has(breakup.id)),
    awaitingPieces: after.filter((breakup) => breakup.piecesCatalogued === null && !caught.has(breakup.id)),
    reported: new Set([...withPieces.map((breakup) => breakup.id), ...caught]).size,
  };
}

const iso = (ms: number | null): string => (ms === null ? "not committed" : new Date(ms).toISOString().replace(":00.000Z", "Z"));
const named = (breakup: Breakup): string => `${breakup.id} ${breakup.parent.name}`;

/** The score as the command prints it, the truth's last change and the lag warning first. */
export function renderScore(score: ProspectiveScore, truthChangedAt: string, now = Date.now()): string {
  const lagFrom = new Date(now - TRUTH_LAG_DAYS * DAY_MS).toISOString().slice(0, 10);
  const lines = [
    `The prospective test of the detector frozen at ${score.freeze}`,
    `Alerts logged: ${Object.entries(score.logged).map(([state, count]) => `${state} ${count}`).join(", ") || "none"}`,
    `Truth: data/breakups.json last changed ${truthChangedAt}.`,
    `Warning: the truth is built from the agencies' reports, which come months after an event; the events since about ${lagFrom} may not be reported yet, so this score is not final for them.`,
    "",
    `Confirmed headline, events after the freeze: ${score.detections.length} of ${score.reported} reported events with pieces confirmed; ${score.falseConfirmations.length} false ${score.falseConfirmations.length === 1 ? "confirmation" : "confirmations"} of ${score.confirmed} confirmed alerts.`,
  ];
  if (score.detections.length > 0) lines.push("", "Confirmed on a reported event (lead over the first agency statement, from the commit that logged the alert):");
  for (const d of score.detections) lines.push(`  ${named(d.breakup)}: alert raised ${iso(Date.parse(d.alert.raisedAt))}, committed ${iso(d.committedAt)}; first agency statement ${d.statement === null ? "none dated" : `${d.statement.on} (${d.statement.source})`}; lead ${d.leadDays === null ? "unknown" : `${d.leadDays} days`}`);
  if (score.falseConfirmations.length > 0) lines.push("", "False confirmations (no reported event):");
  for (const f of score.falseConfirmations) lines.push(`  ${f.alert.number} ${f.alert.launch ?? "-"}: raised ${iso(Date.parse(f.alert.raisedAt))}, committed ${iso(f.committedAt)}`);
  if (score.notCounted.length > 0) lines.push("", "Confirmed alerts not counted (an event before the freeze, an exempt row, or a duplicate):");
  for (const n of score.notCounted) lines.push(`  ${n.alert.number} ${n.alert.launch ?? "-"}: ${n.outcome} ${n.event ?? ""}: ${n.note}`);
  if (score.missed.length > 0) lines.push("", "Reported events with pieces that no alert confirmed:");
  for (const m of score.missed) lines.push(`  ${named(m)}: ${m.piecesCatalogued} pieces`);
  if (score.awaitingPieces.length > 0) lines.push("", "Reported events after the freeze whose pieces the truth does not count yet:");
  for (const a of score.awaitingPieces) lines.push(`  ${named(a)}`);
  return `${lines.join("\n")}\n`;
}

/**
 * The score as the results page's "The live test" section summarises it,
 * between its `prospective:score` markers: the alerts logged since the
 * freeze, the confirmed alerts landing on reported events, the false
 * confirmations, when the truth last changed, and the caveat about recent
 * events. It names no date of its own, so the weekly maintenance changes
 * it only when the score or the truth does.
 */
export function resultsSummary(score: ProspectiveScore, truthChangedOn: string): string {
  const logged = Object.values(score.logged).reduce((sum, count) => sum + count, 0);
  const byState = Object.entries(score.logged)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([state, count]) => `${count} ${state === "cloud" ? (count === 1 ? "cloud" : "clouds") : state}`)
    .join(", ");
  const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  return [
    `So far: ${plural(logged, "alert", "alerts")} logged since the freeze${logged === 0 ? "" : ` (${byState})`};`,
    `${plural(score.detections.length, "confirmed alert matches", "confirmed alerts match")} a reported event after the freeze, of ${plural(score.reported, "reported event", "reported events")} with pieces;`,
    `${plural(score.falseConfirmations.length, "false confirmation", "false confirmations")} of ${plural(score.confirmed, "confirmed alert", "confirmed alerts")}.`,
    `The truth last changed on ${truthChangedOn}.`,
    `The agencies report an event months after it, so the events of the last ${TRUTH_LAG_DAYS} days or so may not be in the truth yet, and the score is not final for them.`,
    "The maintenance workflow scores the log every week and writes the whole score to `score.md` on the `prospective` branch.",
  ].join(" ");
}

/** The score as the Markdown file `score.md` on the `prospective` branch: the printed score, with the day it was scored and the run that scored it. */
export function scoreMarkdown(printed: string, scoredOn: string, runUrl: string | null): string {
  return [`# The prospective test's score`, "", `Scored on ${scoredOn}${runUrl === null ? "" : ` by ${runUrl}`}, by \`npm run prospective:score\` over this branch's \`alerts.jsonl\` and the truth on main.`, "", "```text", printed.trimEnd(), "```", ""].join("\n");
}

const git = (...args: string[]): string => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 30 });

/** When the truth last changed: now where the working tree's file differs from the base commit's (the last commit, or the commit a run started from), else when the last commit that changed it was made. */
function truthChanged(base = "HEAD"): string {
  try {
    git("diff", "--quiet", base, "--", "data/breakups.json");
  } catch {
    return new Date().toISOString();
  }
  return git("log", "-1", "--format=%cI", "--", "data/breakups.json").trim() || "never committed";
}

function main(): void {
  const args = process.argv.slice(2);
  const at = args.indexOf("--ref");
  const hasLocal = (() => {
    try {
      git("rev-parse", "--verify", "-q", "refs/heads/prospective");
      return true;
    } catch {
      return false;
    }
  })();
  const ref = at !== -1 ? args[at + 1]! : hasLocal ? "prospective" : "origin/prospective";
  const alerts = parseJsonl<LoggedAlert>(git("show", `${ref}:alerts.jsonl`), `${ref}:alerts.jsonl`);
  const committedAt = committedAtOf(git("log", "--reverse", "--format=commit %H %cI", "--unified=0", "-p", ref, "--", "alerts.jsonl"));
  const breakups = readBreakups(JSON.parse(readFileSync(join(ROOT, "data/breakups.json"), "utf8")));
  const base = args.indexOf("--base");
  const truthChangedAt = truthChanged(base === -1 ? "HEAD" : args[base + 1]!);
  const score = scoreProspective(alerts, committedAt, breakups);
  const printed = renderScore(score, truthChangedAt);
  console.log(`Reading ${ref} (freeze ${FREEZE_AT}).`);
  process.stdout.write(printed);
  const markdown = args.indexOf("--markdown");
  if (markdown !== -1) {
    const path = resolve(args[markdown + 1]!);
    writeFileSync(path, scoreMarkdown(printed, new Date().toISOString().slice(0, 10), runUrlOf(process.env)));
    console.log(`${path} written`);
  }
  if (args.includes("--readme")) {
    const path = join(ROOT, RESULTS);
    const before = readFileSync(path, "utf8");
    const after = replacePart(before, "prospective:score", resultsSummary(score, Number.isNaN(Date.parse(truthChangedAt)) ? truthChangedAt : new Date(truthChangedAt).toISOString().slice(0, 10)), true);
    if (after !== before) writeFileSync(path, after);
    console.log(`${RESULTS}: the prospective score's summary ${after === before ? "is current" : "rewritten"}`);
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("score.ts")) main();
