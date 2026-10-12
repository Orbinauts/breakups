import { describe, expect, test } from "vitest";
import type { Breakup, Verdict } from "../../src/index.ts";
import { FREEZE_MS, alertKey, jsonl, parseJsonl, type LoggedAlert } from "./alerts.ts";
import { committedAtOf, renderScore, resultsSummary, scoreProspective } from "./score.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** A truth row with what the score reads of it. */
function breakup(parent: number, launch: string, from: number, pieces: number | null, statedOn: number | null, scoreable = true): Breakup {
  return {
    id: `${parent}:${day(from)}`,
    parent: { catalogueNumber: parent, designator: `${launch}A`, name: `SAT ${parent}` },
    kind: "breakup",
    event: { from: new Date(from).toISOString(), to: new Date(from + HOUR).toISOString() },
    orbit: { regime: "LEO" },
    piecesCatalogued: pieces,
    scoreable,
    exemptReason: scoreable ? null : "a release",
    statements: statedOn === null ? [] : [{ source: "odqn", statedOn: { on: day(statedOn), precision: "day", ref: "a report" } }],
  } as unknown as Breakup;
}

function alert(number: number, launch: string, raisedAt: number, state: Verdict["state"] = "confirmed", evidence: Record<string, number> = {}): LoggedAlert {
  const verdict: Verdict = { kind: "object", state, number, launch, raisedAt, step: { beforeEpoch: raisedAt - 2 * DAY, afterEpoch: raisedAt - DAY, deltaKm: -2, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 3, z: 10 }, event: null, evidence: { bodyClass: 0, ...evidence }, reasons: [], bodies: [90001] };
  return { key: alertKey(verdict), kind: "object", state, number, launch, raisedAt: new Date(raisedAt).toISOString(), year: 2026, loggedOn: day(raisedAt), frozen: "f".repeat(40), detector: "confirmed-v10", verdict };
}

/** The text `git log --reverse --format="commit %H %cI" --unified=0 -p` prints over the file, for the commits given. */
function gitLog(commits: { at: number; alerts: LoggedAlert[] }[]): string {
  return commits
    .map(({ at, alerts }, i) => [`commit ${String(i + 1).padStart(40, "a")} ${new Date(at).toISOString().replace(".000Z", "+00:00")}`, "", "diff --git a/alerts.jsonl b/alerts.jsonl", "--- a/alerts.jsonl", "+++ b/alerts.jsonl", "@@ -1,0 +1 @@", ...jsonl(alerts).trimEnd().split("\n").filter((line) => line !== "").map((line) => `+${line}`)].join("\n"))
    .join("\n");
}

const T = FREEZE_MS;
const caught = breakup(40001, "2015-010", T + 10 * DAY, 30, T + 40 * DAY);
const missed = breakup(40002, "2016-020", T + 20 * DAY, 12, T + 60 * DAY);
const unreported = breakup(40003, "2017-030", T + 25 * DAY, null, null);
const before = breakup(40004, "2018-040", T - 20 * DAY, 50, T - 5 * DAY);
const exempt = breakup(40005, "2019-050", T + 5 * DAY, 4, null, false);
const truth = [caught, missed, unreported, before, exempt];

const onCaught = alert(40001, "2015-010", T + 12 * DAY);
const again = alert(40001, "2015-010", T + 14 * DAY);
const onBefore = alert(40004, "2018-040", T + 2 * DAY);
const falseOne = alert(41000, "2020-001", T + 3 * DAY);
const noticed = alert(40002, "2016-020", T + 21 * DAY, "confirmed", { noticed: 1 });
const suspected = alert(40002, "2016-020", T + 20.5 * DAY, "suspected");
const logged = [onBefore, falseOne, onCaught, suspected, noticed, again];
const log = gitLog([
  { at: T + 3.2 * DAY, alerts: [onBefore, falseOne] },
  { at: T + 12.1 * DAY, alerts: [onCaught] },
  { at: T + 21.1 * DAY, alerts: [suspected, noticed] },
  { at: T + 14.1 * DAY, alerts: [again] },
]);

describe("the commit times of the log's lines", () => {
  test("are read from the commit that first added each line", () => {
    const at = committedAtOf(log);
    expect(at.get(onCaught.key)).toBe(T + 12.1 * DAY);
    expect(at.get(onBefore.key)).toBe(T + 3.2 * DAY);
    expect(at.get(noticed.key)).toBe(T + 21.1 * DAY);
    expect(at.size).toBe(6);
  });

  test("keep a key's first commit when a later one adds it again", () => {
    const at = committedAtOf(`${log}\n${gitLog([{ at: T + 50 * DAY, alerts: [onCaught] }])}`);
    expect(at.get(onCaught.key)).toBe(T + 12.1 * DAY);
  });
});

describe("the prospective score on a synthetic log", () => {
  const score = scoreProspective(parseJsonl<LoggedAlert>(jsonl(logged)), committedAtOf(log), truth);

  test("counts every logged alert by state", () => {
    expect(score.logged).toEqual({ confirmed: 5, suspected: 1 });
  });

  test("lands a confirmation on a reported event after the freeze, with its lead over the first agency statement from its commit", () => {
    expect(score.detections.map((d) => d.breakup.id)).toEqual([caught.id]);
    const d = score.detections[0]!;
    expect(d.committedAt).toBe(T + 12.1 * DAY);
    expect(d.leadDays).toBeCloseTo(40 - 12.1, 1);
  });

  test("counts an event's first confirmation and sets the later one apart as a duplicate", () => {
    expect(score.notCounted.find((n) => n.alert.key === again.key)?.outcome).toBe("duplicate");
  });

  test("states a confirmation that lands on no reported event as false, and one on an event before the freeze as not counted", () => {
    expect(score.falseConfirmations.map((f) => f.alert.number)).toEqual([41000]);
    expect(score.notCounted.find((n) => n.alert.key === onBefore.key)).toMatchObject({ outcome: "detection", event: before.id });
  });

  test("leaves a confirmation by a notice alone out, so its event is missed", () => {
    expect(score.confirmed).toBe(4);
    expect(score.missed.map((b) => b.id)).toEqual([missed.id]);
  });

  test("lists apart the events whose pieces the truth does not count yet, and counts the reported events with pieces", () => {
    expect(score.awaitingPieces.map((b) => b.id)).toEqual([unreported.id]);
    expect(score.reported).toBe(2);
  });

  test("prints the headline with the truth's last change and the warning that the recent events may not be reported yet", () => {
    const text = renderScore(score, "2027-02-01T10:00:00+01:00", T + 120 * DAY);
    expect(text).toContain("Truth: data/breakups.json last changed 2027-02-01T10:00:00+01:00.");
    expect(text).toContain(`the events since about ${day(T + 30 * DAY)} may not be reported yet`);
    expect(text).toContain("1 of 2 reported events with pieces confirmed; 1 false confirmation of 4 confirmed alerts.");
    expect(text).toContain(`${caught.id} SAT 40001`);
    expect(text).toContain(`${missed.id} SAT 40002: 12 pieces`);
  });
});

describe("the early warning's line of the prospective score", () => {
  // A suspected alert on the caught event raised after its confirmation by pieces (late), one on no reported event (false), one on an event before the freeze (not counted), and the one on the missed event's step, raised long before its first agency statement (flagged), timed against the truth's instant.
  const late = alert(40001, "2015-010", T + 13 * DAY, "suspected");
  const falseWarning = alert(41001, "2021-001", T + 30 * DAY, "suspected");
  const beforeFreeze = alert(40004, "2018-040", T - 19 * DAY + 2 * DAY, "suspected");
  const timed: LoggedAlert = { ...suspected, verdict: { ...suspected.verdict, event: { at: T + 20 * DAY + 30 * 60_000, from: T + 20 * DAY, to: T + 20 * DAY + HOUR } } };
  const all = [...logged.filter((a) => a.key !== suspected.key), timed, late, falseWarning, beforeFreeze];
  const at = committedAtOf(gitLog([{ at: T + 40 * DAY, alerts: all }]));
  const truthTimed = truth.map((b) => (b.id === missed.id ? ({ ...b, event: { ...b.event, at: new Date(T + 20 * DAY).toISOString(), precision: "minute" } } as Breakup) : b));
  const score = scoreProspective(parseJsonl<LoggedAlert>(jsonl(all)), at, truthTimed);
  const ew = score.earlyWarning;

  test("lands each suspected alert since the freeze: flagged, late, false or not counted", () => {
    expect(ew.suspected).toBe(4);
    expect(ew.flagged.map((w) => w.breakup.id)).toEqual([missed.id]);
    expect(ew.late.map((w) => w.breakup.id)).toEqual([caught.id]);
    expect(ew.falseAlarms.map((f) => f.alert.number)).toEqual([41001]);
    expect(ew.notCounted).toMatchObject([{ outcome: "before the freeze", event: before.id }]);
    expect(ew.missed).toEqual([]);
  });

  test("reads the first sign of the fragments off the log and the truth: a confirmation by pieces, else the first agency statement", () => {
    const flagged = ew.flagged[0]!;
    expect(flagged.firstSignAt).toBe(T + 60 * DAY);
    // From the commit that logged it, at T + 40 days, not from the replay's clock.
    expect(flagged.leadDays).toBeCloseTo(60 - 40, 1);
    expect(flagged.timingMinutes).toBe(30);
    expect(ew.late[0]!.firstSignAt).toBe(Date.parse(onCaught.raisedAt));
    expect(ew.late[0]!.timingMinutes).toBeNull();
  });

  test("prints the early warning's line beside the Confirmed headline, and the results page's summary says both", () => {
    const text = renderScore(score, "2027-02-01T10:00:00+01:00", T + 120 * DAY);
    expect(text).toContain("Early warning (suspected), events after the freeze: 1 of 2 reported events with pieces flagged before the first sign of their fragments, 1 late; 1 false alarm of 4 suspected alerts.");
    expect(text).toContain(`${missed.id} SAT 40002: flagged`);
    const summary = resultsSummary(score, "2027-02-01");
    expect(summary).toContain("1 confirmed alert matches a reported event after the freeze, of 2 reported events with pieces;");
    expect(summary).toContain("Early warning: 1 suspected alert flags a reported event after the freeze before the first sign of its fragments, and 1 after it, of 2 reported events with pieces; 1 false early warning of 4 suspected alerts.");
  });
});

describe("the early warning is known when it was committed, not when the replay's clock raised it", () => {
  // The year is replayed whole each day against the day's catalogue status, so a step can be raised dated back days, after the fragments were public.
  const warning = (raisedAt: number): LoggedAlert => alert(40002, "2016-020", raisedAt, "suspected");
  const score = (alerts: LoggedAlert[], commits: { at: number; alerts: LoggedAlert[] }[]) => scoreProspective(parseJsonl<LoggedAlert>(jsonl(alerts)), committedAtOf(gitLog(commits)), [missed]).earlyWarning;

  test("a warning raised before the first sign but committed after it is late", () => {
    const backdated = warning(T + 20.5 * DAY);
    const ew = score([backdated], [{ at: T + 61 * DAY, alerts: [backdated] }]);
    expect(ew.flagged).toEqual([]);
    expect(ew.late).toHaveLength(1);
    expect(ew.late[0]!.leadDays).toBeCloseTo(-1, 1);
    expect(ew.late[0]!.note).toBe("committed after the first sign of the fragments");
  });

  test("a warning committed before the first sign is flagged, its lead counted from the commit", () => {
    const timely = warning(T + 20.5 * DAY);
    const ew = score([timely], [{ at: T + 21.1 * DAY, alerts: [timely] }]);
    expect(ew.flagged).toHaveLength(1);
    expect(ew.flagged[0]!.leadDays).toBeCloseTo(60 - 21.1, 1);
    expect(ew.flagged[0]!.note).toBe("committed before the first sign of the fragments");
  });

  test("the first warning known of an event is the one counted, whatever the replay's clock says", () => {
    const backdated = warning(T + 20.2 * DAY);
    const first = { ...warning(T + 20.6 * DAY), key: "first known" };
    const ew = score([backdated, first], [{ at: T + 21 * DAY, alerts: [first] }, { at: T + 25 * DAY, alerts: [backdated] }]);
    expect(ew.flagged.map((w) => w.alert.key)).toEqual(["first known"]);
    expect(ew.notCounted).toMatchObject([{ outcome: "duplicate", alert: { key: backdated.key } }]);
  });

  test("a warning the log has no commit for is never flagged", () => {
    const uncommitted = warning(T + 20.5 * DAY);
    const ew = score([uncommitted], []);
    expect(ew.flagged).toEqual([]);
    expect(ew.late).toHaveLength(1);
    expect(ew.late[0]!.leadDays).toBeNull();
  });
});
