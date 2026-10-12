import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { buildTruth, distinctInstants } from "../scripts/truth/build-truth.ts";
import { readRegimes, regimeAt } from "../scripts/truth/regimes.ts";
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
    const { file, statements, skipped, esa } = buildTruth();
    expect(`${JSON.stringify(file, null, 1)}\n`).toBe(committed);
    expect(renderReport(file, statements, skipped, esa)).toBe(readFileSync(resolve(ROOT, "docs/truth.md"), "utf8"));
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

  test("no window opens before its parent's launch day", () => {
    for (const b of breakups) if (b.parent.launchedOn !== null && b.parent.launchedOn.length === 10 && b.event.from !== null) expect(b.event.from.slice(0, 10) >= b.parent.launchedOn, b.id).toBe(true);
  });

  test("an id's day is the instant's where the event states one, else the window's lower edge", () => {
    for (const b of breakups) expect(b.id.slice(-10), b.id).toBe((b.event.at ?? b.event.from ?? b.event.to).slice(0, 10));
    expect(breakups.find((b) => b.id === "42052:2018-01-01")).toBeDefined();
  });

  test("no scoreable window is wider than 93 days or open below: such a row is kept out with its reason", () => {
    for (const b of breakups) {
      const wide = b.event.from === null || Date.parse(b.event.to) - Date.parse(b.event.from) > 93 * 86_400_000;
      if (wide && ["breakup", "anomalous"].includes(b.kind) && b.parent.catalogueNumber !== null) expect(b.exemptReason, b.id).toBe(b.event.from === null ? "the window has no lower edge" : "the window is wider than 93 days");
    }
    expect(scoring.filter((b) => b.exemptReason === "the window is wider than 93 days").map((b) => b.parent.name)).toContain("NOAA 8");
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

  test("takes the confidence from the best authority statement, whichever source states the instant most finely", () => {
    const authorities = new Set(["hoosf-16e", "odqn", "s4s-notice", "esa-ser"]);
    for (const b of scoring) {
      const stated = b.statements.filter((s) => authorities.has(s.source));
      if (stated.some((s) => s.event.precision === "minute" || s.event.precision === "second")) expect(b.confidence, b.id).toBe("A");
      else if (stated.some((s) => s.event.from !== null && Date.parse(s.event.to) - Date.parse(s.event.from) <= 3 * 86_400_000)) expect(b.confidence, b.id).toBe("B");
    }
    // NASA or the quarterly news states the day; GCAT's cloud table the minute, which stands as the event's time.
    for (const id of ["29523:2006-11-04", "30324:2007-02-02", "32288:2007-11-11", "37756:2020-05-08", "25117:2021-11-18", "43227:2024-09-06"]) {
      const b = breakups.find((x) => x.id === id)!;
      expect([b.confidence, b.resolvedFrom.event, b.event.precision], id).toEqual(["B", "gcat", "minute"]);
    }
    // Where the Space Forces' notice states the minute itself, the authority's minute stands.
    const orbcomm = breakups.find((x) => x.id === "25984:2023-03-11")!;
    expect([orbcomm.confidence, orbcomm.resolvedFrom.event, orbcomm.event.precision]).toEqual(["A", "s4s-notice", "minute"]);
  });

  test("a company's measured instant ranks with a named analyst's dating: Luch as Meteor 2-7", () => {
    expect(breakups.find((b) => b.id === "40258:2026-01-30")!.confidence).toBe("C");
    expect(breakups.find((b) => b.id === "12456:2026-10-05")!.confidence).toBe("C");
  });

  test("a burst under a launch with no catalogued parent is scoreable, the Confirmed line scoring it by its launch", () => {
    for (const id of ["A:1965-027:2012-03-28", "A:1998-037:2026-06-19", "A:2013-076:2023-05-28", "A:2018-005:2024-03-17"]) expect(breakups.find((b) => b.id === id), id).toMatchObject({ scoreable: true, exemptReason: null });
  });

  test("a row whose statements give no orbit takes its parent's regime before the window from the file derived from the Archive", () => {
    const regimes = readRegimes(ROOT)!;
    let filled = 0;
    for (const b of scoring) {
      if (b.parent.catalogueNumber === null || (b.orbit.apogeeKm ?? b.orbit.altitudeKm) !== null) continue;
      const runs = regimes.parents[String(b.parent.catalogueNumber)];
      expect(b.orbit.regime, b.id).toBe(regimeAt(runs, Date.parse(b.event.from ?? b.event.to)));
      if (b.orbit.regime !== "unknown") filled++;
    }
    expect(filled).toBeGreaterThan(100);
  });

  test("scoreable events name a catalogued parent or its launch and are breakups or anomalous events", () => {
    for (const b of breakups.filter((x) => x.scoreable)) {
      expect(b.parent.catalogueNumber ?? b.parent.designator, b.id).not.toBeNull();
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

  test("only statements read from a page carry one: the news, the analysts and the notices read from a post or an article; the tables and the login page's notice have none", () => {
    const statements = breakups.flatMap((b) => b.statements);
    const linked = statements.filter((s) => s.url !== undefined);
    expect([...new Set(linked.map((s) => s.source))].sort()).toEqual(["analyst", "news", "s4s-notice"]);
    for (const s of linked) expect(s.ref).toContain(s.url!);
    expect(statements.filter((s) => s.source === "s4s-notice" && s.url === undefined).map((s) => s.parent.name)).toEqual(["USA 32"]);
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

describe("ESA's tables in the truth", () => {
  const esaOf = (id: string): Breakup["statements"] => breakups.find((b) => b.id === id)!.statements.filter((s) => s.source === "esa-ser");

  test("a row a cited report names is a scoreable event of that object, dated to ESA's day", () => {
    const stage = breakups.find((b) => b.id === "59344:2024-04-02")!;
    expect(stage.parent.name).toBe("CZ-6A R/B (Yunhai-3 02)");
    expect(stage.confidence).toBe("B");
    expect(stage.statements.map((s) => s.source).sort()).toEqual(["esa-ser", "news"]);
  });

  test("Hitomi and the ullage motor of the same day each take the row their orbit allows", () => {
    expect(esaOf("41337:2016-03-26").map((s) => s.causeStated)).toEqual(["Attitude"]);
    expect(esaOf("33472:2016-03-26").map((s) => s.causeStated)).toEqual(["Unknown"]);
  });

  test("a row two events could be joins neither: ESA's 2025-12-18 payload stays off both Starlink-35956 and Shiyan 32-02", () => {
    expect(breakups.filter((b) => b.event.to.startsWith("2025-12-") && b.statements.some((s) => s.source === "esa-ser")).map((b) => b.id)).toEqual([]);
  });
});
