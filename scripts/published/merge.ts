import type { PublishedBreakup, PublishedStep, PublishedVerdict, Step, Verdict } from "../../src/index.ts";
import { overlaps } from "../kpi/match.ts";
import { isLetGo } from "./select.ts";

/** A published step back in milliseconds, as the detector's verdicts carry it. */
const stepIn = (step: PublishedStep | null): Step | null => (step === null ? null : { ...step, beforeEpoch: Date.parse(step.beforeEpoch), afterEpoch: Date.parse(step.afterEpoch) });

/** Whether a published breakup stays: a confirmed one for good, a suspected one until the latest verdict on its step expired or dismissed it. */
const stays = (breakup: PublishedBreakup, verdicts: readonly Verdict[]): boolean => breakup.state === "confirmed" || !isLetGo(breakup.parent.catalogueNumber, stepIn(breakup.step), verdicts);

/** What tells two verdicts apart: their state, raising and step. */
const verdictKey = (v: PublishedVerdict): string => `${v.state}|${v.raisedAt}|${v.step === null ? "-" : `${v.step.beforeEpoch}/${v.step.afterEpoch}`}`;

/** Every step a breakup's verdicts measured. */
const stepsOf = (breakup: PublishedBreakup): Step[] => [breakup.step, ...breakup.verdicts.map((v) => v.step)].map(stepIn).filter((step) => step !== null);

/**
 * Whether two published breakups are one: the same object, and the same
 * landed row, an overlapping step, or a verdict both carry (a confirmation
 * from the pieces alone that lands on no row has neither, and each day's
 * replay of the year raises it again the same).
 */
function isSame(a: PublishedBreakup, b: PublishedBreakup): boolean {
  if (a.parent.catalogueNumber !== b.parent.catalogueNumber) return false;
  if (a.row !== null && a.row === b.row) return true;
  const steps = stepsOf(b);
  if (stepsOf(a).some((x) => steps.some((y) => overlaps(x, y)))) return true;
  const keys = new Set(b.verdicts.map(verdictKey));
  return a.verdicts.some((v) => keys.has(verdictKey(v)));
}

const earlier = (a: string, b: string): string => (Date.parse(a) <= Date.parse(b) ? a : b);
const lastRaisedOf = (breakup: PublishedBreakup): number => Math.max(Date.parse(breakup.raisedAt), ...breakup.verdicts.map((v) => Date.parse(v.raisedAt)));

/**
 * One breakup from a published one and a later run's: the published id,
 * the earlier raising and confirmation, confirmed if either was, the
 * verdicts of both, the latest verdict's step, estimate, reasons and
 * evidence, and the later run's parent, row and reports (the truth as it
 * stands now).
 */
function mergeOne(published: PublishedBreakup, later: PublishedBreakup): PublishedBreakup {
  const latest = lastRaisedOf(later) >= lastRaisedOf(published) ? later : published;
  const byKey = new Map([...published.verdicts, ...later.verdicts].map((v) => [verdictKey(v), v]));
  const verdicts = [...byKey.values()].sort((a, b) => Date.parse(a.raisedAt) - Date.parse(b.raisedAt));
  const confirmedAt = published.confirmedAt === null ? later.confirmedAt : later.confirmedAt === null ? published.confirmedAt : earlier(published.confirmedAt, later.confirmedAt);
  return {
    id: published.id,
    state: published.state === "confirmed" || later.state === "confirmed" ? "confirmed" : "suspected",
    raisedAt: earlier(published.raisedAt, later.raisedAt),
    confirmedAt,
    parent: later.parent,
    event: latest.event,
    step: latest.step,
    reasons: latest.reasons,
    reports: later.reports,
    evidence: latest.evidence,
    bodies: latest.bodies,
    candidates: latest.candidates,
    row: later.row,
    verdicts,
  };
}

const byRaised = (a: PublishedBreakup, b: PublishedBreakup): number => Date.parse(a.raisedAt) - Date.parse(b.raisedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The published list after a run: the breakups already published
 * (`previous`, as the files hold them) merged with the run's selection
 * (`fresh`, from `selectPublished`), in the light of the run's verdicts,
 * earliest raised first.
 *
 * A run's breakup is the published one on the same object with the same
 * landed row or an overlapping step: it keeps the id fixed when it was
 * first published, the earlier raising and confirmation, and every verdict
 * of both, and takes the latest verdict's fields. A confirmed breakup stays
 * for good, whether or not the run finds it again; a suspected one the run
 * does not find stays until the latest verdict on its step expired or
 * dismissed it. A run's breakup with no published match is added.
 */
export function mergePublished(previous: readonly PublishedBreakup[], fresh: readonly PublishedBreakup[], verdicts: readonly Verdict[]): PublishedBreakup[] {
  let unmatched = [...previous];
  const merged: PublishedBreakup[] = [];
  for (const breakup of fresh) {
    const matches = unmatched.filter((published) => isSame(published, breakup)).sort(byRaised);
    unmatched = unmatched.filter((published) => !matches.includes(published));
    merged.push([...matches, breakup].reduce(mergeOne));
  }
  return [...merged, ...unmatched.filter((breakup) => stays(breakup, verdicts))].sort(byRaised);
}
