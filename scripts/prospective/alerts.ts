import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { Verdict, VerdictState } from "../../src/index.ts";

/**
 * The prospective test's log of alerts: what the frozen detector raised
 * after the freeze, taken from a replay's verdicts, keyed so a verdict the
 * daily replay raises again is logged once, and appended to a JSON-lines
 * file on the `prospective` branch, whose commit time is the proof of when
 * each alert was known. Pure but for the file's read and append.
 */

/** The instant the detector was frozen: an alert raised after it is one the test counts. */
export const FREEZE_AT = "2026-10-11T00:00:00Z";
export const FREEZE_MS = Date.parse(FREEZE_AT);

/** The object states the log keeps: a suspected step, the scoped line's alert, and a confirmation. Every cloud verdict is kept as well, as the scorecard's review rows are. */
export const LOGGED_STATES: readonly VerdictState[] = ["suspected", "scoped", "confirmed"];

/** One logged alert: the verdict whole, its evidence and reasons with it, and where and when it was found. */
export interface LoggedAlert {
  key: string;
  kind: Verdict["kind"];
  state: VerdictState;
  number: number | null;
  launch: string | null;
  /** The verdict's `raisedAt`, as an instant: the replay's clock when the detector raised it. */
  raisedAt: string;
  /** The year of the Archive whose replay raised it. */
  year: number;
  /** The day of the run that first found it (UTC); the commit that adds the line is the proof of when. */
  loggedOn: string;
  /** The frozen detector's commit and name. */
  frozen: string;
  detector: string;
  verdict: Verdict;
}

/**
 * The key an alert is logged under: its kind, its parent and launch, the
 * step bracket it measured (the epochs of the sets on either side), or for
 * a verdict with no step (a cloud, or a confirmation by pieces with no step
 * on the parent) the run it was raised at, and its state. A daily replay
 * of the same year raises the same verdict on the same bracket again, so
 * the key is the same and the verdict is logged once.
 */
export function alertKey(verdict: Pick<Verdict, "kind" | "state" | "number" | "launch" | "step" | "raisedAt">): string {
  const at = verdict.step !== null ? `${verdict.step.beforeEpoch}-${verdict.step.afterEpoch}` : `raised ${new Date(verdict.raisedAt).toISOString()}`;
  return [verdict.kind, verdict.number ?? "-", verdict.launch ?? "-", at, verdict.state].join("|");
}

/** Whether the log keeps a verdict: a cloud, or an object verdict in one of the logged states. */
export const isLogged = (verdict: Pick<Verdict, "kind" | "state">): boolean => verdict.kind === "cloud" || LOGGED_STATES.includes(verdict.state);

/** The alerts a replay's verdicts hold that were raised after `since`, in the order raised, each once by its key. */
export function alertsOf(verdicts: readonly Verdict[], context: { year: number; loggedOn: string; frozen: string; detector: string }, since = FREEZE_MS): LoggedAlert[] {
  const seen = new Set<string>();
  const alerts: LoggedAlert[] = [];
  const raised = verdicts.filter((verdict) => verdict.raisedAt > since && isLogged(verdict)).sort((a, b) => a.raisedAt - b.raisedAt);
  for (const verdict of raised) {
    const key = alertKey(verdict);
    if (seen.has(key)) continue;
    seen.add(key);
    alerts.push({ key, kind: verdict.kind, state: verdict.state, number: verdict.number, launch: verdict.launch, raisedAt: new Date(verdict.raisedAt).toISOString(), year: context.year, loggedOn: context.loggedOn, frozen: context.frozen, detector: context.detector, verdict });
  }
  return alerts;
}

/** The rows of a JSON-lines text, blank lines skipped; a malformed line throws with its number. */
export function parseJsonl<T>(text: string, where = "the log"): T[] {
  return text.split("\n").flatMap((line, index) => {
    if (line.trim() === "") return [];
    try {
      return [JSON.parse(line) as T];
    } catch (error) {
      throw new Error(`${where}:${index + 1} is not JSON: ${(error as Error).message}`);
    }
  });
}

/** The rows of a JSON-lines file, none where it does not exist. */
export const readJsonl = <T>(path: string): T[] => (existsSync(path) ? parseJsonl<T>(readFileSync(path, "utf8"), path) : []);

/** The found alerts whose keys the log does not hold yet, in the order found. */
export function newAlerts(logged: readonly Pick<LoggedAlert, "key">[], found: readonly LoggedAlert[]): LoggedAlert[] {
  const keys = new Set(logged.map((alert) => alert.key));
  return found.filter((alert) => {
    if (keys.has(alert.key)) return false;
    keys.add(alert.key);
    return true;
  });
}

/** The rows as JSON lines, one per row, each ending in a newline. */
export const jsonl = (rows: readonly unknown[]): string => rows.map((row) => `${JSON.stringify(row)}\n`).join("");

/** Appends rows to a JSON-lines file, starting it where it does not exist, and first ending its last line where it lacks a newline. */
export function appendJsonl(path: string, rows: readonly unknown[]): void {
  if (rows.length === 0) return;
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  appendFileSync(path, `${before === "" || before.endsWith("\n") ? "" : "\n"}${jsonl(rows)}`);
}
