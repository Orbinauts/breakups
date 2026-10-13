import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { PublishedBreakup, PublishedBreakupFile, PublishedBreakupsFile, PublishedStatusFile } from "../../src/index.ts";
import { readPublished, writePublished } from "./files.ts";

const usa32: PublishedBreakup = {
  id: "19460-2026-09-13",
  state: "confirmed",
  raisedAt: "2026-09-15T04:00:00.000Z",
  confirmedAt: "2026-09-16T00:00:00.000Z",
  unreportedAt: null,
  parent: { catalogueNumber: 19460, designator: "1988-040A", name: "USA 32", launchedOn: "1988-05-15" },
  event: { at: "2026-09-13T06:00:00.000Z", from: "2026-09-13T00:00:00.000Z", to: "2026-09-13T12:00:00.000Z" },
  rowEvent: { at: "2026-09-13T21:13:00.000Z", from: "2026-09-13T21:03:00.000Z", to: "2026-09-13T21:23:00.000Z", precision: "minute", source: "s4s-notice", row: "19460:2026-09-13" },
  step: { beforeEpoch: "2026-09-12T00:00:00.000Z", afterEpoch: "2026-09-14T00:00:00.000Z", deltaKm: -1.5, deltaPerigeeKm: null, deltaApogeeKm: null, deltaInclinationDeg: null, postSets: 4, z: 12 },
  reasons: ["a step that persists"],
  reports: [{ source: "s4s-notice", date: "2026-09-16", precision: "day", url: null }],
  evidence: { bodyClass: 0, pieces: 3 },
  bodies: [70001],
  candidates: [],
  row: "19460:2026-09-13",
  verdicts: [{ state: "confirmed", raisedAt: "2026-09-17T04:00:00.000Z", step: null, event: null, evidence: { bodyClass: 0, pieces: 3 }, reasons: ["a step that persists"], bodies: [70001], candidates: [] }],
};
const meteor: PublishedBreakup = { ...usa32, id: "12456-2026-10-05", state: "suspected", confirmedAt: null, parent: { catalogueNumber: 12456, designator: "1981-027A", name: "METEOR 2-7", launchedOn: "1981-03-14" }, rowEvent: null, row: null, reports: [] };
const intelsat: PublishedBreakup = { ...usa32, id: "25371-2026-07-30", state: "unreported", confirmedAt: "2026-08-20T04:00:00.000Z", unreportedAt: "2026-11-18T04:00:00.000Z", parent: { catalogueNumber: 25371, designator: "1998-037A", name: "INTELSAT 805 (IS-805)", launchedOn: "1998-06-18" }, rowEvent: null, row: null, reports: [] };
const status = { ranAt: "2026-10-11T03:12:45.000Z", setsThrough: "2026-10-10", detector: "confirmed-v10", truthSha256: "ab".repeat(32) };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "published-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const read = (path: string): unknown => JSON.parse(readFileSync(join(dir, path), "utf8"));

describe("the published files", () => {
  test("read back as the breakups written, an unreported one with its day, and as nothing where none were ever written", () => {
    expect(readPublished(dir)).toEqual([]);
    writePublished(dir, [intelsat, meteor, usa32], status);
    expect(readPublished(dir)).toEqual([intelsat, meteor, usa32]);
    expect(read("v2/breakups.json")).toMatchObject({ breakups: [{ id: intelsat.id, state: "unreported", confirmedAt: "2026-08-20T04:00:00.000Z", unreportedAt: "2026-11-18T04:00:00.000Z" }, { unreportedAt: null }, { unreportedAt: null }] });
  });

  test("read the first version's files where none of this version were written yet, which no write touches: the list carries over to v2", () => {
    const { unreportedAt, ...v1 } = { ...usa32, state: "confirmed" as const };
    void unreportedAt;
    mkdirSync(join(dir, "v1/breakups"), { recursive: true });
    const { evidence, bodies, candidates, row, verdicts, ...entry } = v1;
    void [evidence, bodies, candidates, row, verdicts];
    const listText = JSON.stringify({ version: 1, breakups: [entry] }, null, 1) + "\n";
    const fileText = JSON.stringify({ version: 1, ...v1 }, null, 1) + "\n";
    writeFileSync(join(dir, "v1/breakups.json"), listText);
    writeFileSync(join(dir, "v1/breakups/19460-2026-09-13.json"), fileText);
    expect(readPublished(dir)).toEqual([usa32]);
    writePublished(dir, readPublished(dir), status);
    expect(read("v2/breakups/19460-2026-09-13.json")).toEqual({ version: 2, ...usa32 });
    expect(readFileSync(join(dir, "v1/breakups.json"), "utf8")).toBe(listText);
    expect(readFileSync(join(dir, "v1/breakups/19460-2026-09-13.json"), "utf8")).toBe(fileText);
    writeFileSync(join(dir, "v1/breakups.json"), JSON.stringify({ version: 1, breakups: [] }));
    expect(readPublished(dir)).toEqual([usa32]);
  });

  test("list every breakup's entry fields in the list, and its whole evidence in its own file, each with the version", () => {
    writePublished(dir, [usa32], status);
    const { evidence, bodies, candidates, row, verdicts, ...entry } = usa32;
    expect(read("v2/breakups.json")).toEqual({ version: 2, breakups: [entry] } satisfies PublishedBreakupsFile);
    expect(read("v2/breakups/19460-2026-09-13.json")).toEqual({ version: 2, ...usa32 } satisfies PublishedBreakupFile);
    expect([evidence, bodies, candidates, row, verdicts.length]).toEqual([{ bodyClass: 0, pieces: 3 }, [70001], [], "19460:2026-09-13", 1]);
  });

  test("say when the job last ran, on which sets, with which detector and truth", () => {
    writePublished(dir, [], status);
    expect(read("v2/status.json")).toEqual({ version: 2, ranAt: "2026-10-11T03:12:45.000Z", setsThrough: "2026-10-10", detector: "confirmed-v10", truthSha256: "ab".repeat(32) } satisfies PublishedStatusFile);
    expect(read("v2/breakups.json")).toEqual({ version: 2, breakups: [] });
  });

  test("are written one space deep, keys in the types' order, with a final newline", () => {
    const shuffled = Object.fromEntries(Object.entries(usa32).reverse()) as unknown as PublishedBreakup;
    writePublished(dir, [shuffled], status);
    const text = readFileSync(join(dir, "v2/breakups/19460-2026-09-13.json"), "utf8");
    expect(text).toBe(JSON.stringify({ version: 2, ...usa32 }, null, 1) + "\n");
    expect(readFileSync(join(dir, "v2/status.json"), "utf8")).toBe('{\n "version": 2,\n "ranAt": "2026-10-11T03:12:45.000Z",\n "setsThrough": "2026-10-10",\n "detector": "confirmed-v10",\n "truthSha256": "' + "ab".repeat(32) + '"\n}\n');
  });

  test("lose the file of a breakup that left", () => {
    writePublished(dir, [meteor, usa32], status);
    writePublished(dir, [usa32], status);
    expect(readdirSync(join(dir, "v2/breakups"))).toEqual(["19460-2026-09-13.json"]);
    expect(existsSync(join(dir, "v2/breakups/12456-2026-10-05.json"))).toBe(false);
  });

  test("are refused when written in another version", () => {
    writePublished(dir, [usa32], status);
    const path = join(dir, "v2/breakups/19460-2026-09-13.json");
    writeFileSync(path, JSON.stringify({ version: 3, ...usa32 }));
    expect(() => readPublished(dir)).toThrow(/version 3/);
  });

  test("are refused where a breakup carries no row's event: every file has carried one since the one re-keying run", () => {
    writePublished(dir, [usa32], status);
    const path = join(dir, "v2/breakups/19460-2026-09-13.json");
    const { rowEvent, ...before } = JSON.parse(readFileSync(path, "utf8")) as PublishedBreakupFile;
    void rowEvent;
    writeFileSync(path, JSON.stringify(before));
    expect(() => readPublished(dir)).toThrow(/19460-2026-09-13.*rowEvent/);
  });
});
