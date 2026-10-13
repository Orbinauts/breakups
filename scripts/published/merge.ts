import type { Breakup, PublishedBreakup, PublishedVerdict, Step, Verdict } from "../../src/index.ts";
import { overlaps } from "../kpi/match.ts";
import { byFirstRaised, isLetGo, relandPublished, stepIn } from "./select.ts";

/** Whether a published breakup stays: a confirmed or unreported one for good, a suspected one until the latest verdict on its step expired or dismissed it. */
const stays = (breakup: PublishedBreakup, verdicts: readonly Verdict[]): boolean => breakup.state !== "suspected" || !isLetGo(breakup.parent.catalogueNumber, stepIn(breakup.step), verdicts);

/** What tells two verdicts apart: their state, raising and step. */
const verdictKey = (v: PublishedVerdict): string => `${v.state}|${v.raisedAt}|${v.step === null ? "-" : `${v.step.beforeEpoch}/${v.step.afterEpoch}`}`;

/** Every step a breakup's verdicts measured. */
const stepsOf = (breakup: PublishedBreakup): Step[] => [breakup.step, ...breakup.verdicts.map((v) => v.step)].map(stepIn).filter((step) => step !== null);

/** Whether two published breakups on one object are one by what they measured: an overlapping step, or a verdict both carry (a confirmation from the pieces alone that lands on no row has neither, and each day's replay of the year raises it again the same). */
function sharesStepOrVerdict(a: PublishedBreakup, b: PublishedBreakup): boolean {
  const steps = stepsOf(b);
  if (stepsOf(a).some((x) => steps.some((y) => overlaps(x, y)))) return true;
  const keys = new Set(b.verdicts.map(verdictKey));
  return a.verdicts.some((v) => keys.has(verdictKey(v)));
}

/** Whether two published breakups on one object are one by their row: the same landed row, where one of them measured no step (as a verdict with no step joins the breakup of its row). */
const sharesRow = (a: PublishedBreakup, b: PublishedBreakup): boolean => a.row !== null && a.row === b.row && (stepsOf(a).length === 0 || stepsOf(b).length === 0);

/**
 * The published breakups a run's breakup is: those on its object that
 * share a step or a verdict with it, and those that share its row where
 * one side measured no step. A run's breakup with no step matched by row
 * alone takes only the latest raised of them, as the selection joins a
 * verdict with no step to the latest breakup on its row; earliest raised
 * first.
 */
function matchesOf(previous: readonly PublishedBreakup[], breakup: PublishedBreakup): PublishedBreakup[] {
  const onObject = previous.filter((published) => published.parent.catalogueNumber === breakup.parent.catalogueNumber);
  const measured = onObject.filter((published) => sharesStepOrVerdict(published, breakup));
  const onRow = onObject.filter((published) => !measured.includes(published) && sharesRow(published, breakup)).sort(byFirstRaised);
  return [...measured, ...(stepsOf(breakup).length === 0 ? onRow.slice(-1) : onRow)].sort(byFirstRaised);
}

const earlier = (a: string, b: string): string => (Date.parse(a) <= Date.parse(b) ? a : b);
const lastRaisedOf = (breakup: PublishedBreakup): number => Math.max(Date.parse(breakup.raisedAt), ...breakup.verdicts.map((v) => Date.parse(v.raisedAt)));

/**
 * One breakup from a published one and a later run's: the published id,
 * the earlier raising and confirmation, the verdicts of both, the latest
 * verdict's step, estimate, reasons and evidence, and the later run's
 * state, unreported day, parent, row, row's event and reports (the truth as
 * it stands now, read at its date by the selection); confirmed where the
 * later run reads suspected what was confirmed before, on the row its
 * report names.
 */
function mergeOne(published: PublishedBreakup, later: PublishedBreakup): PublishedBreakup {
  const latest = lastRaisedOf(later) >= lastRaisedOf(published) ? later : published;
  const byKey = new Map([...published.verdicts, ...later.verdicts].map((v) => [verdictKey(v), v]));
  const verdicts = [...byKey.values()].sort((a, b) => Date.parse(a.raisedAt) - Date.parse(b.raisedAt));
  const confirmedAt = published.confirmedAt === null ? later.confirmedAt : later.confirmedAt === null ? published.confirmedAt : earlier(published.confirmedAt, later.confirmedAt);
  return {
    id: published.id,
    state: confirmedAt !== null && later.state === "suspected" ? "confirmed" : later.state,
    raisedAt: earlier(published.raisedAt, later.raisedAt),
    confirmedAt,
    unreportedAt: later.unreportedAt,
    parent: later.parent,
    event: latest.event,
    rowEvent: later.rowEvent,
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

/**
 * The published list after a run: the breakups already published
 * (`previous`, as the files hold them) merged with the run's selection
 * (`selected`, from `selectPublished`), in the light of the run's verdicts,
 * earliest raised first.
 *
 * A run's breakup is every published one on the same object that
 *
 * - measured a step overlapping one of its steps (the breakup's own step or
 *   any of its verdicts'), or
 * - carries a verdict it carries too (the same state, raising and step), or
 * - landed on the same row, where one of the two measured no step at all;
 *   a run's breakup with no step matched by its row alone is the latest
 *   raised of those, as the selection joins a verdict with no step to the
 *   latest breakup on its row.
 *
 * Two breakups whose steps do not overlap stay two, whatever row they land
 * on. The merged breakup keeps the id fixed when it was first published,
 * the earlier raising and confirmation, and every verdict of both, and
 * takes the latest verdict's fields. A confirmed or unreported breakup
 * stays for good, whether or not the run finds it again; a suspected one
 * the run does not find stays until the latest verdict on its step expired
 * or dismissed it. A run's breakup with no published match is added.
 *
 * A breakup's state is the run's reading of it at the truth's date
 * (`selectPublished`), so a confirmed breakup on no row turns unreported
 * there, and confirmed again once a run lands it on a row. A confirmed or
 * unreported breakup on no row that the run does not find, one of a year
 * the daily replay no longer covers, has its verdicts landed again on the
 * truth the run landed on (`breakups`), by the same matching
 * (`relandPublished`): it turns unreported as a run's would, and confirmed,
 * on its row, once the truth holds a row for it.
 */
export function mergePublished(previous: readonly PublishedBreakup[], selected: readonly PublishedBreakup[], verdicts: readonly Verdict[], breakups: readonly Breakup[]): PublishedBreakup[] {
  let unmatched = [...previous];
  const merged: PublishedBreakup[] = [];
  for (const breakup of selected) {
    const matches = matchesOf(unmatched, breakup);
    unmatched = unmatched.filter((published) => !matches.includes(published));
    merged.push([...matches, breakup].reduce(mergeOne));
  }
  const kept = unmatched.filter((breakup) => stays(breakup, verdicts)).map((breakup) => (breakup.confirmedAt !== null && breakup.row === null ? landedAgain(breakup, breakups) : breakup));
  return [...merged, ...kept].sort(byFirstRaised);
}

/** A confirmed breakup on no row that no run finds, merged with what its verdicts land as on the truth as it stands; as it was where they land on nothing it shares a step or verdict with (an exemption the truth now makes). */
function landedAgain(breakup: PublishedBreakup, breakups: readonly Breakup[]): PublishedBreakup {
  return [breakup, ...relandPublished(breakup, breakups).filter((again) => sharesStepOrVerdict(breakup, again))].reduce(mergeOne);
}
