import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { buildTruth, distinctInstants } from "../scripts/truth/build-truth.ts";
import { renderReport } from "../scripts/truth/report.ts";
import { readBreakups, yearOf, type Breakup } from "../src/index.ts";

/**
 * The committed truth against its build. The file is generated from the
 * committed snapshots and the hand file, so rebuilding it here must give
 * the committed bytes, and the report beside it must be the one a rebuild
 * writes: a parser change, a new hand row or an override shows up as a
 * diff, never as a silent drift.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const committed = readFileSync(resolve(ROOT, "data/breakups.json"), "utf8");
const breakups = readBreakups(JSON.parse(committed));
const SCORING_FROM = 2005;
const scoring = breakups.filter((b) => yearOf(b) >= SCORING_FROM);

describe("the committed truth", () => {
  test("is what the sources build, byte for byte, and the report beside it", () => {
    const { file, statements, skipped } = buildTruth();
    expect(`${JSON.stringify(file, null, 1)}\n`).toBe(committed);
    expect(renderReport(file, statements, skipped)).toBe(readFileSync(resolve(ROOT, "docs/truth.md"), "utf8"));
  });

  test("reads back, every row checked", () => {
    expect(breakups.length).toBeGreaterThan(500);
    expect(scoring.filter((b) => b.scoreable).length).toBeGreaterThan(140);
  });

  test("holds no two instants one listing source states more than a day apart in one event", () => {
    for (const group of buildTruth().groups) {
      if (group.overrides.length > 0) continue;
      const s = group.statements;
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) expect(distinctInstants(s[i]!, s[j]!), `${s[i]!.ref} / ${s[j]!.ref}`).toBe(false);
    }
  });

  test("splits ALOS-1's stage into NASA's two events and Cosmos 2392's ullage motor into GCAT's two separations", () => {
    expect(breakups.find((b) => b.id === "28932:2006-08-27")).toMatchObject({ event: { at: "2006-08-27T16:18Z" }, confidence: "A", scoreable: true });
    expect(breakups.find((b) => b.id === "28932:2006-08-08")!.conflicts.filter((c) => c.field === "event")).toEqual([]);
    expect(breakups.find((b) => b.id === "27474:2005-06-30")).toMatchObject({ piecesCatalogued: 55, scoreable: true });
  });

  test("is ordered by time, with no two events of one parent within a day", () => {
    for (let i = 1; i < breakups.length; i++) {
      const [a, b] = [breakups[i - 1]!, breakups[i]!];
      expect(Date.parse(a.event.from ?? a.event.to) <= Date.parse(b.event.from ?? b.event.to)).toBe(true);
    }
    const byParent = new Map<number, Breakup[]>();
    for (const b of breakups) if (b.parent.catalogueNumber !== null) byParent.set(b.parent.catalogueNumber, [...(byParent.get(b.parent.catalogueNumber) ?? []), b]);
    for (const events of byParent.values()) {
      for (let i = 1; i < events.length; i++) {
        expect(Date.parse(events[i]!.event.from ?? events[i]!.event.to) - Date.parse(events[i - 1]!.event.to), events[i]!.id).toBeGreaterThan(86_400_000);
      }
    }
  });

  test("every event happens after its parent's launch and not after today", () => {
    const today = new Date().toISOString();
    for (const b of breakups) {
      expect(b.event.to <= today, b.id).toBe(true);
      if (b.parent.launchedOn !== null && b.parent.launchedOn.length === 10) expect(b.event.to >= b.parent.launchedOn, b.id).toBe(true);
    }
  });

  test("every resolved field names a source that made a statement", () => {
    for (const b of breakups) {
      const sources = new Set(b.statements.map((s) => s.source));
      for (const source of Object.values(b.resolvedFrom)) if (source !== null) expect(sources.has(source), `${b.id} ${source}`).toBe(true);
      for (const conflict of b.conflicts) for (const source of conflict.sources) expect(sources.has(source), `${b.id} ${source}`).toBe(true);
    }
  });

  test("every NASA minute is confidence A, every GCAT-only date to the month or finer C and coarser D, every catalogue-only row D", () => {
    for (const b of scoring) {
      if (b.resolvedFrom.event === "hoosf-16e" && b.event.precision === "minute") expect(b.confidence, b.id).toBe("A");
      if (b.statements.every((s) => s.source === "gcat")) expect(b.confidence, b.id).toBe(b.event.precision === "year" || b.event.precision === "none" ? "D" : "C");
      if (b.statements.every((s) => s.source === "catalogue")) expect(b.confidence, b.id).toBe("D");
    }
  });

  test("scoreable events name a catalogued parent and are breakups or anomalous events", () => {
    for (const b of breakups.filter((x) => x.scoreable)) {
      expect(b.parent.catalogueNumber, b.id).not.toBeNull();
      expect(["breakup", "anomalous"]).toContain(b.kind);
    }
    for (const b of breakups.filter((x) => !x.scoreable)) expect(b.exemptReason, b.id).not.toBeNull();
  });
});

describe("links to the statements' pages", () => {
  test("the Luch event's news and analyst statements carry the pages they are read from", () => {
    const luch = breakups.find((b) => b.id === "40258:2026-01-30")!;
    expect(luch.statements.filter((s) => s.url !== undefined).map((s) => [s.source, s.url]).sort()).toEqual([
      ["analyst", "https://planet4589.org/space/jsr/back/news.853.txt"],
      ["news", "https://universemagazine.com/en/russian-spy-satellite-destroyed-in-orbit/"],
    ]);
  });

  test("only news and analyst statements carry one: the Space Force notice and the tables have none", () => {
    const linked = breakups.flatMap((b) => b.statements).filter((s) => s.url !== undefined);
    expect(linked.map((s) => s.source).sort()).toEqual(["analyst", "analyst", "news", "news", "news", "news"]);
  });
});

describe("events checked by hand", () => {
  const known = (JSON.parse(readFileSync(resolve(ROOT, "test/fixtures/truth-known.json"), "utf8")) as { events: Record<string, string>[] }).events;

  test.each(known.map((event) => [event.id!, event] as const))("%s is in the truth as read from its source", (id, event) => {
    const built = breakups.find((b) => b.id === id);
    expect(built, `${id} ${event.name}`).toBeDefined();
    expect(built!.parent.name).toBe(event.name);
    expect(built!.kind).toBe(event.kind);
    if (event.at !== undefined) expect(built!.event.at).toBe(event.at);
    if (event.from !== undefined) expect(built!.event.from).toBe(event.from);
    if (event.to !== undefined) expect(built!.event.to).toBe(event.to);
    if (event.cause !== undefined) expect(built!.cause).toBe(event.cause);
    if (event.regime !== undefined) expect(built!.orbit.regime).toBe(event.regime);
    if (event.confidence !== undefined) expect(built!.confidence).toBe(event.confidence);
    expect(built!.scoreable).toBe(true);
  });
});
