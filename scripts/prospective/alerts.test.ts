import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, test } from "vitest";
import type { Verdict } from "../../src/index.ts";
import { daysToPull, historyDir, keptSettled } from "../archive/pull.ts";
import { FREEZE_MS, alertKey, alertsOf, appendJsonl, isLogged, newAlerts, parseJsonl, readJsonl, type LoggedAlert } from "./alerts.ts";
import { frozenEnv, pruneScratch } from "./run.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const work = mkdtempSync(join(tmpdir(), "breakups-prospective-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function verdict(overrides: Partial<Verdict>): Verdict {
  return {
    kind: "object",
    state: "suspected",
    number: 25544,
    launch: "1998-067",
    raisedAt: FREEZE_MS + 4 * HOUR,
    step: { beforeEpoch: FREEZE_MS - 6 * HOUR, afterEpoch: FREEZE_MS - 2 * HOUR, deltaKm: -1.2, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 3, z: 9 },
    event: null,
    evidence: { z1: 9.1 },
    reasons: ["a step that persists"],
    ...overrides,
  };
}

const context = { year: 2026, loggedOn: "2026-10-12", frozen: "f".repeat(40), detector: "confirmed-v10" };

describe("the alerts the log keeps", () => {
  test("are the suspected, scoped and confirmed object verdicts and every cloud, raised after the freeze", () => {
    expect(isLogged({ kind: "object", state: "suspected" })).toBe(true);
    expect(isLogged({ kind: "object", state: "scoped" })).toBe(true);
    expect(isLogged({ kind: "object", state: "confirmed" })).toBe(true);
    expect(isLogged({ kind: "object", state: "watch" })).toBe(false);
    expect(isLogged({ kind: "object", state: "manoeuvre" })).toBe(false);
    expect(isLogged({ kind: "object", state: "dismissed" })).toBe(false);
    expect(isLogged({ kind: "cloud", state: "cloud-only" })).toBe(true);
    const verdicts = [
      verdict({ raisedAt: FREEZE_MS - HOUR }),
      verdict({ raisedAt: FREEZE_MS }),
      verdict({ state: "watch" }),
      verdict({ state: "manoeuvre" }),
      verdict({ state: "confirmed", raisedAt: FREEZE_MS + 2 * DAY, bodies: [60001, 60002] }),
      verdict({ kind: "cloud", state: "cloud-only", number: null, launch: "2026-200", step: null, raisedAt: FREEZE_MS + DAY, bodies: [70001] }),
      verdict({}),
    ];
    const alerts = alertsOf(verdicts, context);
    expect(alerts.map((a) => [a.kind, a.state, a.raisedAt])).toEqual([
      ["object", "suspected", new Date(FREEZE_MS + 4 * HOUR).toISOString()],
      ["cloud", "cloud-only", new Date(FREEZE_MS + DAY).toISOString()],
      ["object", "confirmed", new Date(FREEZE_MS + 2 * DAY).toISOString()],
    ]);
  });

  test("carry the verdict whole, its evidence and reasons with it, and the run's context", () => {
    const [alert] = alertsOf([verdict({ state: "confirmed", bodies: [60001] })], context);
    expect(alert).toMatchObject({ year: 2026, loggedOn: "2026-10-12", frozen: context.frozen, detector: "confirmed-v10", number: 25544, launch: "1998-067" });
    expect(alert!.verdict.evidence).toEqual({ z1: 9.1 });
    expect(alert!.verdict.reasons).toEqual(["a step that persists"]);
    expect(alert!.verdict.bodies).toEqual([60001]);
  });
});

describe("the key an alert is logged under", () => {
  test("is the kind, the parent and launch, the step bracket and the state", () => {
    const v = verdict({});
    expect(alertKey(v)).toBe(`object|25544|1998-067|${v.step!.beforeEpoch}-${v.step!.afterEpoch}|suspected`);
    // The same step raised again by a later replay, at another run, is the same alert.
    expect(alertKey(verdict({ raisedAt: v.raisedAt + 8 * HOUR }))).toBe(alertKey(v));
    // Its confirmation is another line, and so is another step on the same parent.
    expect(alertKey(verdict({ state: "confirmed" }))).not.toBe(alertKey(v));
    expect(alertKey(verdict({ step: { ...v.step!, afterEpoch: v.step!.afterEpoch + HOUR } }))).not.toBe(alertKey(v));
  });

  test("is the run it was raised at for a verdict with no step: a cloud, or a confirmation with no step on the parent", () => {
    const cloud = verdict({ kind: "cloud", state: "cloud-only", number: null, launch: "2026-200", step: null });
    expect(alertKey(cloud)).toBe(`cloud|-|2026-200|raised ${new Date(cloud.raisedAt).toISOString()}|cloud-only`);
    expect(alertKey({ ...cloud, raisedAt: cloud.raisedAt + 4 * HOUR })).not.toBe(alertKey(cloud));
  });

  test("lets a replay that raises an alert twice log it once", () => {
    expect(alertsOf([verdict({}), verdict({ raisedAt: FREEZE_MS + 8 * HOUR })], context)).toHaveLength(1);
  });
});

describe("the log's file", () => {
  test("takes only the alerts whose keys it does not hold, each once", () => {
    const [a, b, c] = alertsOf([verdict({}), verdict({ state: "confirmed" }), verdict({ state: "scoped" })], context);
    expect(newAlerts([a!], [a!, b!, c!, b!]).map((x) => x.state)).toEqual(["confirmed", "scoped"]);
    expect(newAlerts([a!, b!, c!], [a!, b!, c!])).toEqual([]);
  });

  test("is appended to, started where it does not exist, its last line ended first where it lacks a newline, and read back", () => {
    const path = join(work, "alerts.jsonl");
    const [a, b] = alertsOf([verdict({}), verdict({ state: "confirmed" })], context);
    expect(readJsonl<LoggedAlert>(path)).toEqual([]);
    appendJsonl(path, [a]);
    appendJsonl(path, []);
    writeFileSync(path, readFileSync(path, "utf8").trimEnd());
    appendJsonl(path, [b]);
    const text = readFileSync(path, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.split("\n").filter((line) => line !== "")).toHaveLength(2);
    expect(readJsonl<LoggedAlert>(path).map((x) => x.key)).toEqual([a!.key, b!.key]);
  });

  test("refuses a malformed line by its number", () => {
    expect(() => parseJsonl('{"a":1}\n\nnot json\n', "alerts.jsonl")).toThrow(/alerts\.jsonl:3 is not JSON/);
  });
});

describe("the daily run's housekeeping", () => {
  test("hands the frozen worktree the test's view of the Archive and no catalogue credentials", () => {
    const env = frozenEnv({ PATH: "/bin", SPACETRACK_IDENTITY: "x", SPACETRACK_PASSWORD: "y", BREAKUPS_ARCHIVE: "/elsewhere" }, "/archive/prospective/view");
    expect(env).toEqual({ PATH: "/bin", BREAKUPS_ARCHIVE: "/archive/prospective/view" });
  });

  test("keeps the last days' scratch directories and nothing else of the test's is touched", () => {
    const home = join(work, "prospective");
    for (const name of ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "states", "view"]) mkdirSync(join(home, name), { recursive: true });
    expect(pruneScratch(home, 2)).toEqual(["2026-10-11", "2026-10-12"]);
    expect(readdirSync(home).sort()).toEqual(["2026-10-13", "2026-10-14", "states", "view"]);
  });
});

describe("the pull's days", () => {
  test("pull again every day kept before it settled, and never one kept after, a bare slice read from its modification time", () => {
    const archive = join(work, "archive");
    const dir = historyDir(archive, 2026);
    mkdirSync(dir, { recursive: true });
    const keep = (day: string, at: number): void => {
      writeFileSync(join(dir, `${day}.json.gz`), gzipSync(JSON.stringify([{ NORAD_CAT_ID: "25544", GP_ID: "1" }])));
      utimesSync(join(dir, `${day}.json.gz`), at / 1000, at / 1000);
    };
    const end = (day: string): number => Date.parse(`${day}T00:00:00Z`) + DAY;
    keep("2026-01-01", end("2026-01-01") + 2 * DAY);
    keep("2026-01-02", end("2026-01-02") + 2 * HOUR);
    keep("2026-01-03", end("2026-01-03") - 20 * HOUR);
    expect(keptSettled("2026-01-01", end("2026-01-01") + 2 * DAY)).toBe(true);
    expect(keptSettled("2026-01-02", end("2026-01-02") + 2 * DAY - 1)).toBe(false);
    expect(daysToPull(archive, 2026, "2026-01-04")).toEqual(["2026-01-02", "2026-01-03", "2026-01-04"]);
  });
});
