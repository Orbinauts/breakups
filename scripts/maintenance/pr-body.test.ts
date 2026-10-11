import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { Latest } from "../kpi/kpi.ts";
import type { SnapshotRecord } from "../truth/fetch-sources.ts";
import { commitMessage, kpiMoves, MOVES_SHOWN, prBody, prTitle, readmeParts, sourceChanges, truthChanges, type RunReport, type TruthRow } from "./pr-body.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const latest = JSON.parse(readFileSync(join(ROOT, "kpi/latest.json"), "utf8")) as Latest;

const record = (sha: string, on: string): SnapshotRecord => ({ url: "https://example.org", fetchedOn: on, originalSha256: sha.repeat(64).slice(0, 64), originalBytes: 1, snapshot: "sources/x", madeWith: "fetched as served", snapshotSha256: sha.repeat(64).slice(0, 64), licence: "CC-BY-4.0" });
const row = (id: string, fields: Record<string, unknown> = {}): TruthRow => ({ id, parent: { name: `parent of ${id}` }, kind: "breakup", ...fields });

describe("what a maintenance run moved", () => {
  test("the sources whose record changed, with their hashes before and after", () => {
    const before = { snapshots: { gcat: record("a", "2026-10-09"), "gcat-satcat": record("b", "2026-10-10") } };
    const after = { snapshots: { gcat: record("a", "2026-10-09"), "gcat-satcat": record("c", "2026-10-19") } };
    const changes = sourceChanges(before, after);
    expect(changes.map((change) => change.id)).toEqual(["gcat-satcat"]);
    expect(changes[0]!.before?.originalSha256.startsWith("b")).toBe(true);
    expect(changes[0]!.after.originalSha256.startsWith("c")).toBe(true);
    expect(sourceChanges(before, before)).toEqual([]);
  });

  test("the truth's events added, removed and changed, by id, with the fields that changed", () => {
    const changes = truthChanges([row("1:2026-01-01"), row("2:2026-02-01", { piecesCatalogued: 3 }), row("3:2026-03-01")], [row("2:2026-02-01", { piecesCatalogued: 7 }), row("3:2026-03-01"), row("4:2026-09-01")]);
    expect(changes.added.map((r) => r.id)).toEqual(["4:2026-09-01"]);
    expect(changes.removed.map((r) => r.id)).toEqual(["1:2026-01-01"]);
    expect(changes.changed).toEqual([{ row: row("2:2026-02-01", { piecesCatalogued: 7 }), fields: ["piecesCatalogued"] }]);
  });

  test("the scorecard's cells that moved, old and new, and none where nothing moved", () => {
    expect(kpiMoves(latest, latest)).toEqual([]);
    const moved = JSON.parse(JSON.stringify(latest)) as Latest;
    moved.splits.validation.confirmedLine.lines["breakups A-B"].detected = 18;
    moved.splits.validation.confirmedLine.falseAlarmRate = 0.123456789;
    moved.years = [...moved.years, 2027];
    const moves = kpiMoves(latest, moved);
    expect(moves).toContainEqual({ path: "splits.validation.confirmedLine.lines.breakups A-B.detected", before: "17", after: "18" });
    expect(moves).toContainEqual({ path: "splits.validation.confirmedLine.falseAlarmRate", before: "0.2069", after: "0.1235" });
    expect(moves.find((move) => move.path === "years")?.after.endsWith("2026, 2027]")).toBe(true);
    expect(moves).toHaveLength(3);
  });

  test("the README's generated parts that changed", () => {
    const before = "<!-- a:begin -->1<!-- a:end --> <!-- b:begin -->2<!-- b:end -->";
    const after = "<!-- a:begin -->1<!-- a:end --> <!-- b:begin -->3<!-- b:end -->";
    expect(readmeParts(before, after, ["a", "b", "c"])).toEqual(["b"]);
  });
});

describe("the pull request and its commit", () => {
  const moved = JSON.parse(JSON.stringify(latest)) as Latest;
  moved.splits.validation.confirmedLine.lines["breakups A-B"].detected = 18;
  const report: RunReport = {
    date: "2026-10-19",
    runUrl: "https://example.org/run",
    sources: [{ id: "gcat-satcat", before: record("b", "2026-10-10"), after: record("c", "2026-10-19") }],
    truth: truthChanges([row("2:2026-02-01")], [row("2:2026-02-01"), row("4:2026-09-01")]),
    rescored: "the truth's sha256 changed",
    moves: kpiMoves(latest, moved),
    readme: ["kpi:confirmed", "truth:counts"],
    promoted: null,
    prospective: "So far: 0 alerts logged since the freeze.",
    folded: null,
    files: ["data/breakups.json", "kpi/latest.json", "README.md"],
  };

  test("the body says what changed and why: the sources with their hashes, the events by id, the cells with old and new values, the prospective score", () => {
    const body = prBody(report);
    expect(body).toContain("| gcat-satcat | 2026-10-10 → 2026-10-19 | `bbbbbbbbbbbb` → `cccccccccccc` |");
    expect(body).toContain("- `4:2026-09-01` parent of 4:2026-09-01");
    expect(body).toContain("because the truth's sha256 changed");
    expect(body).toContain("| `splits.validation.confirmedLine.lines.breakups A-B.detected` | 17 | 18 |");
    expect(body).toContain("So far: 0 alerts logged since the freeze.");
    expect(body).toContain("[the run](https://example.org/run)");
  });

  test("a body with more moved cells than it lists says how many more", () => {
    const many = { ...report, moves: Array.from({ length: MOVES_SHOWN + 5 }, (_, i) => ({ path: `cell.${i}`, before: "1", after: "2" })) };
    expect(prBody(many)).toContain("And 5 more");
  });

  test("the title names what changed", () => {
    expect(prTitle(report)).toBe("Maintenance of 2026-10-19: sources refreshed, truth updated, scorecard replayed");
    expect(prTitle({ ...report, sources: [], truth: { added: [], removed: [], changed: [] }, rescored: "", readme: ["prospective:score"] })).toBe("Maintenance of 2026-10-19: prospective score");
  });

  test("a branch folded in is named in the title, the body and the message, with its commits", () => {
    const folded = { ...report, folded: { branch: "hand-row", commits: ["A breakup typed from the quarterly news."] } };
    expect(prTitle(folded)).toBe("Maintenance of 2026-10-19: hand-row folded in, sources refreshed, truth updated, scorecard replayed");
    expect(prBody(folded)).toContain("- A breakup typed from the quarterly news.");
    expect(commitMessage(folded)).toContain("The branch hand-row is folded in: A breakup typed from the quarterly news.");
  });

  test("the commit message is sentences with no trailer", () => {
    const message = commitMessage(report);
    expect(message).toContain("The weekly fetch found a new edition of gcat-satcat");
    expect(message).toContain("1 event added, 0 removed and 0 changed (added: 4:2026-09-01)");
    expect(message).not.toMatch(/^[\w-]+: /m);
    expect(message).not.toMatch(/co-authored-by|signed-off-by/i);
  });
});
