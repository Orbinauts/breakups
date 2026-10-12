import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { firstAgencyStatement, launchOf, readBreakups, type Breakup, type FirstStatement } from "../../src/index.ts";
import { UNREPORTED_PENDING_DAYS, brackets, isPendingUnreported, landConfirmed, lowerOf, marginDaysOf, truthAsOf, type Row } from "../kpi/match.ts";
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
 * the commit that logged it; the false confirmations, which land on none
 * and were raised `UNREPORTED_PENDING_DAYS` or more before the truth's
 * date (`truthAsOf`), and the unreported ones raised since, pending, as
 * the scorecard reads them;
 * and the reported events with fragments that no alert confirmed. A
 * confirmation lands as the scorecard's Confirmed line lands it
 * (`landConfirmed`), on the parent within the window and the half year
 * after, a confirmation by a notice alone excluded.
 *
 * Beside it, the early warning: the suspected alerts logged since the
 * freeze, each landed as the scorecard's parent-step line lands it, on a
 * reported event whose parent it names and whose window its step bracket
 * covers, each widened by the matcher's margin. It flagged the event
 * where it was raised before the first sign of the fragments, and is late
 * after it; a suspected alert on no reported event is a false alarm. The
 * score reads no Archive, so the first sign of the fragments is the
 * earliest the log and the truth give: a confirmation by pieces landing
 * on the event, a cloud verdict under its launch after it, or the first
 * agency statement (from the first day of its month for a quarterly
 * news issue), a bound later than or equal to the first fragment's
 * publication. The lead is the days from the alert to that sign, and the
 * timing error is the detector's instant against the truth's where the
 * truth states the minute.
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
export const TRUTH_LAG_DAYS = UNREPORTED_PENDING_DAYS;

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

/** A suspected alert landed on a reported event after the freeze: before the first sign of the fragments, or after it. */
export interface EarlyWarning extends Landed {
  breakup: Breakup;
  status: "flagged" | "late";
  /** The first sign of the fragments the score knows of, in milliseconds since 1970; null where none yet. */
  firstSignAt: number | null;
  /** Days from the alert's raising to that sign; positive where the alert came first. */
  leadDays: number | null;
  /** The detector's instant against the truth's, in minutes, where the truth states the minute. */
  timingMinutes: number | null;
}

/** The early warning's line over the suspected alerts logged since the freeze. */
export interface EarlyWarningScore {
  suspected: number;
  flagged: EarlyWarning[];
  late: EarlyWarning[];
  falseAlarms: Landed[];
  /** Suspected alerts on an event before the freeze, on an exempt row, or a later alert on an event already flagged. */
  notCounted: Landed[];
  /** The reported events after the freeze with pieces that no suspected alert landed on. */
  missed: Breakup[];
}

export interface ProspectiveScore {
  freeze: string;
  /** Every logged alert, by state, the clouds apart. */
  logged: Record<string, number>;
  confirmed: number;
  detections: Detection[];
  falseConfirmations: Landed[];
  /** Confirmed alerts on no reported event raised under `UNREPORTED_PENDING_DAYS` before the truth's date: unreported, pending, neither true nor false yet. */
  pending: Landed[];
  /** The truth's date (`truthAsOf`), in milliseconds since 1970. */
  truthAsOf: number;
  /** Confirmed alerts that land elsewhere: on an event before the freeze, inside an exempt row's window, or on an event already confirmed. */
  notCounted: Landed[];
  /** The scoreable events after the freeze with catalogued pieces that no confirmed alert landed on. */
  missed: Breakup[];
  /** The scoreable events after the freeze whose count of pieces the truth does not state yet. */
  awaitingPieces: Breakup[];
  /** The scoreable events after the freeze with pieces: the headline's denominator. */
  reported: number;
  /** The early warning's line, beside the Confirmed headline. */
  earlyWarning: EarlyWarningScore;
}

/** When an agency first stated the event, as the start of the day (or of the month, or the year) it can first have been public; null where none is dated. */
function statedAtOf(statement: FirstStatement | null): number | null {
  if (statement === null) return null;
  return Date.parse(`${statement.on.length === 7 ? `${statement.on}-01` : statement.on.length === 4 ? `${statement.on}-01-01` : statement.on}T00:00:00Z`);
}

/** The early warning's line: every suspected alert since the freeze, landed on the truth, against the first sign of each event's fragments the log and the truth give. */
export function scoreEarlyWarning(alerts: readonly LoggedAlert[], committedAt: CommittedAt, breakups: readonly Breakup[], confirmations: readonly Detection[], freezeMs = FREEZE_MS): EarlyWarningScore {
  const suspected = alerts.filter((alert) => alert.kind === "object" && alert.state === "suspected" && alert.number !== null).sort((a, b) => Date.parse(a.raisedAt) - Date.parse(b.raisedAt));
  const clouds = alerts.filter((alert) => alert.kind === "cloud");
  const firstSign = (breakup: Breakup): number | null => {
    const launch = launchOf(breakup.parent.designator);
    const signs = [
      statedAtOf(firstAgencyStatement(breakup)),
      ...confirmations.filter((d) => d.breakup.id === breakup.id).map((d) => Date.parse(d.alert.raisedAt)),
      ...clouds.filter((cloud) => launch !== null && cloud.launch === launch && Date.parse(cloud.raisedAt) >= lowerOf(breakup)).map((cloud) => Date.parse(cloud.raisedAt)),
    ].filter((at): at is number => at !== null);
    return signs.length === 0 ? null : Math.min(...signs);
  };
  const score: EarlyWarningScore = { suspected: suspected.length, flagged: [], late: [], falseAlarms: [], notCounted: [], missed: [] };
  const caught = new Set<string>();
  for (const alert of suspected) {
    const step = alert.verdict.step;
    const on = breakups.filter((breakup) => breakup.parent.catalogueNumber === alert.number && brackets(step, lowerOf(breakup), Date.parse(breakup.event.to), marginDaysOf(breakup.orbit.regime)));
    const landed: Landed = { alert, committedAt: committedAt.get(alert.key) ?? null, outcome: "false-alarm", event: null, note: "on no reported event's step" };
    const breakup = on.find((b) => b.scoreable) ?? on[0];
    if (breakup === undefined) {
      score.falseAlarms.push(landed);
      continue;
    }
    if (!breakup.scoreable) score.notCounted.push({ ...landed, outcome: "exempt", event: breakup.id, note: `inside the window of ${breakup.id}, ${breakup.exemptReason ?? "not scoreable"}` });
    else if (lowerOf(breakup) < freezeMs) score.notCounted.push({ ...landed, outcome: "before the freeze", event: breakup.id, note: "an event before the freeze" });
    else if (caught.has(breakup.id)) score.notCounted.push({ ...landed, outcome: "duplicate", event: breakup.id, note: "a later early warning of an event already flagged" });
    else {
      caught.add(breakup.id);
      const raisedAt = Date.parse(alert.raisedAt);
      const sign = firstSign(breakup);
      const instant = breakup.event.precision === "minute" && breakup.event.at !== null && breakup.event.at !== undefined ? Date.parse(breakup.event.at) : null;
      const status = sign === null || raisedAt < sign ? "flagged" : "late";
      const warning: EarlyWarning = { ...landed, outcome: status, event: breakup.id, note: status === "flagged" ? "before the first sign of the fragments" : "after the first sign of the fragments", breakup, status, firstSignAt: sign, leadDays: sign === null ? null : Math.round(((sign - raisedAt) / DAY_MS) * 10) / 10, timingMinutes: instant === null || alert.verdict.event === null ? null : Math.round(Math.abs(alert.verdict.event.at - instant) / 60_000) };
      (status === "flagged" ? score.flagged : score.late).push(warning);
    }
  }
  score.missed = breakups.filter((breakup) => breakup.scoreable && lowerOf(breakup) >= freezeMs && (breakup.piecesCatalogued ?? 0) > 0 && !caught.has(breakup.id));
  return score;
}

/** The Confirmed headline over the alerts logged since the freeze, against the truth. */
export function scoreProspective(alerts: readonly LoggedAlert[], committedAt: CommittedAt, breakups: readonly Breakup[], freezeMs = FREEZE_MS): ProspectiveScore {
  const asOf = truthAsOf(breakups);
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
  const pending: Landed[] = [];
  const notCounted: Landed[] = [];
  const caught = new Set<string>();
  confirmed.forEach((alert, i) => {
    // The headline's reading: a verdict naming twins lands on the body it names first.
    const landing = landConfirmed(alert.verdict, i, rows);
    const { outcome, event } = landing;
    const twin = landing.twin !== undefined && landing.twin.event !== event ? `; matched at the launch it would land on ${landing.twin.event ?? "nothing"}` : "";
    const landed: Landed = { alert, committedAt: committedAt.get(alert.key) ?? null, outcome, event, note: `${landing.note}${twin}` };
    const breakup = event === null ? undefined : byId.get(event);
    // A confirmation on no row is unreported: pending while the truth may still catch up, then false (the scorecard's reading).
    if (outcome === "false-alarm") (isPendingUnreported(Date.parse(alert.raisedAt), asOf) ? pending : falseConfirmations).push(landed);
    else if (outcome === "detection" && breakup !== undefined && caught.has(breakup.id)) notCounted.push({ ...landed, outcome: "duplicate", note: "a later confirmation of an event already confirmed" });
    else if (outcome === "detection" && breakup !== undefined && lowerOf(breakup) >= freezeMs) {
      caught.add(breakup.id);
      const statement = firstAgencyStatement(breakup);
      const statedAt = statedAtOf(statement);
      detections.push({ ...landed, breakup, statement, leadDays: statedAt === null || landed.committedAt === null ? null : Math.round(((statedAt - landed.committedAt) / DAY_MS) * 10) / 10 });
    } else notCounted.push(landed);
  });
  const after = breakups.filter((breakup) => breakup.scoreable && lowerOf(breakup) >= freezeMs);
  const withPieces = after.filter((breakup) => (breakup.piecesCatalogued ?? 0) > 0);
  return {
    earlyWarning: scoreEarlyWarning(alerts, committedAt, breakups, detections, freezeMs),
    freeze: new Date(freezeMs).toISOString(),
    logged,
    confirmed: confirmed.length,
    detections,
    falseConfirmations,
    pending,
    truthAsOf: asOf,
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
    `Confirmed headline, events after the freeze: ${score.detections.length} of ${score.reported} reported events with pieces confirmed; ${score.falseConfirmations.length} false ${score.falseConfirmations.length === 1 ? "confirmation" : "confirmations"} of ${score.confirmed} confirmed alerts${score.pending.length === 0 ? "" : `; ${score.pending.length} unreported and pending`}.`,
  ];
  if (score.detections.length > 0) lines.push("", "Confirmed on a reported event (lead over the first agency statement, from the commit that logged the alert):");
  for (const d of score.detections) lines.push(`  ${named(d.breakup)}: alert raised ${iso(Date.parse(d.alert.raisedAt))}, committed ${iso(d.committedAt)}; first agency statement ${d.statement === null ? "none dated" : `${d.statement.on} (${d.statement.source})`}; lead ${d.leadDays === null ? "unknown" : `${d.leadDays} days`}`);
  if (score.falseConfirmations.length > 0) lines.push("", "False confirmations (no reported event):");
  for (const f of score.falseConfirmations) lines.push(`  ${f.alert.number} ${f.alert.launch ?? "-"}: raised ${iso(Date.parse(f.alert.raisedAt))}, committed ${iso(f.committedAt)}`);
  if (score.pending.length > 0) lines.push("", `Unreported and pending (no reported event yet, raised under ${UNREPORTED_PENDING_DAYS} days before the truth's date, ${new Date(score.truthAsOf).toISOString().slice(0, 10)}):`);
  for (const f of score.pending) lines.push(`  ${f.alert.number} ${f.alert.launch ?? "-"}: raised ${iso(Date.parse(f.alert.raisedAt))}, committed ${iso(f.committedAt)}`);
  if (score.notCounted.length > 0) lines.push("", "Confirmed alerts not counted (an event before the freeze, an exempt row, or a duplicate):");
  for (const n of score.notCounted) lines.push(`  ${n.alert.number} ${n.alert.launch ?? "-"}: ${n.outcome} ${n.event ?? ""}: ${n.note}`);
  if (score.missed.length > 0) lines.push("", "Reported events with pieces that no alert confirmed:");
  for (const m of score.missed) lines.push(`  ${named(m)}: ${m.piecesCatalogued} pieces`);
  if (score.awaitingPieces.length > 0) lines.push("", "Reported events after the freeze whose pieces the truth does not count yet:");
  for (const a of score.awaitingPieces) lines.push(`  ${named(a)}`);
  const ew = score.earlyWarning;
  lines.push("", `Early warning (suspected), events after the freeze: ${ew.flagged.length} of ${score.reported} reported events with pieces flagged before the first sign of their fragments, ${ew.late.length} late; ${ew.falseAlarms.length} false ${ew.falseAlarms.length === 1 ? "alarm" : "alarms"} of ${ew.suspected} suspected alerts.`);
  if (ew.flagged.length + ew.late.length > 0) lines.push("", "Early warnings on a reported event (lead over the first sign of the fragments; timing error against the truth's minute):");
  for (const w of [...ew.flagged, ...ew.late]) lines.push(`  ${named(w.breakup)}: ${w.status}, raised ${iso(Date.parse(w.alert.raisedAt))}, committed ${iso(w.committedAt)}; first sign of the fragments ${w.firstSignAt === null ? "none yet" : iso(w.firstSignAt)}; lead ${w.leadDays === null ? "unknown" : `${w.leadDays} days`}; timing error ${w.timingMinutes === null ? "unknown" : `${w.timingMinutes} minutes`}`);
  if (ew.falseAlarms.length > 0) lines.push("", "False early warnings (no reported event's step):");
  for (const f of ew.falseAlarms) lines.push(`  ${f.alert.number} ${f.alert.launch ?? "-"}: raised ${iso(Date.parse(f.alert.raisedAt))}, committed ${iso(f.committedAt)}`);
  if (ew.notCounted.length > 0) lines.push("", "Early warnings not counted (an event before the freeze, an exempt row, or a duplicate):");
  for (const n of ew.notCounted) lines.push(`  ${n.alert.number} ${n.alert.launch ?? "-"}: ${n.outcome} ${n.event ?? ""}: ${n.note}`);
  if (ew.missed.length > 0) lines.push("", "Reported events with pieces that no early warning flagged:");
  for (const m of ew.missed) lines.push(`  ${named(m)}`);
  return `${lines.join("\n")}\n`;
}

/**
 * The score as the results page's "The live test" section summarises it,
 * between its `prospective:score` markers: the alerts logged since the
 * freeze, the confirmed alerts landing on reported events, the false
 * confirmations, the early warnings flagging reported events and the false
 * ones, when the truth last changed, and the caveat about recent events. It names no date of its own, so the weekly maintenance changes
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
    `${plural(score.falseConfirmations.length, "false confirmation", "false confirmations")} of ${plural(score.confirmed, "confirmed alert", "confirmed alerts")}${score.pending.length === 0 ? "" : `, and ${plural(score.pending.length, "unreported confirmation", "unreported confirmations")} pending, neither true nor false until ${UNREPORTED_PENDING_DAYS} days pass with no report`}.`,
    `Early warning: ${plural(score.earlyWarning.flagged.length, "suspected alert flags", "suspected alerts flag")} a reported event after the freeze before the first sign of its fragments, and ${score.earlyWarning.late.length} after it, of ${plural(score.reported, "reported event", "reported events")} with pieces;`,
    `${plural(score.earlyWarning.falseAlarms.length, "false early warning", "false early warnings")} of ${plural(score.earlyWarning.suspected, "suspected alert", "suspected alerts")}.`,
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
