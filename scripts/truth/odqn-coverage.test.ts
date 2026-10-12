import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { readStatements } from "../../src/truth.ts";
import { coverageProblems, type OdqnCoverage } from "./odqn-coverage.ts";

/**
 * Every issue of NASA's Orbital Debris Quarterly News since 26(3), the
 * first after the history's cut-off, is either cited by the hand file or
 * recorded as having no breakup items, so a quiet stretch is a checked
 * one, not an unread one.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const issue = (label: string, status: OdqnCoverage["issues"][number]["status"]): OdqnCoverage["issues"][number] => ({ issue: label, date: "", url: "https://orbitaldebris.jsc.nasa.gov/quarterly-news/", status, items: [] });
const cited = (...refs: string[]): { source: "odqn"; ref: string }[] => refs.map((ref) => ({ source: "odqn", ref }));

describe("the quarterly news coverage", () => {
  test("a run of issues from 26(3) across a volume's end, each cited or checked quiet, has no problem", () => {
    const coverage = { issues: [issue("26(3)", "cited"), issue("26(4)", "no breakup items"), issue("27(1)", "cited")] };
    expect(coverageProblems(coverage, cited("ODQN 26(3), September 2022, p. 2", "ODQN 27(1), March 2023, pp. 1-2"))).toEqual([]);
  });

  test("a missing issue is a gap, named by the issue expected", () => {
    const coverage = { issues: [issue("26(3)", "cited"), issue("27(1)", "cited")] };
    expect(coverageProblems(coverage, cited("ODQN 26(3), September 2022", "ODQN 27(1), March 2023"))).toEqual(["a gap: 26(4) is expected after 26(3), 27(1) comes"]);
  });

  test("a combined issue covers both numbers, and an issue never published is recorded as such", () => {
    const coverage = { issues: [issue("29(3)", "no breakup items"), issue("29(4)", "not published"), issue("30(1 & 2)", "no breakup items"), issue("30(3)", "cited")] };
    expect(coverageProblems({ issues: [issue("26(3)", "cited"), ...coverage.issues] }, cited("ODQN 26(3)", "ODQN 30(3), September 2026, p. 1"))).toEqual(["a gap: 26(4) is expected after 26(3), 29(3) comes"]);
    expect(coverageProblems(coverage, cited("ODQN 30(3), September 2026, p. 1"))).toEqual(["the list starts at 29(3), not 26(3)"]);
  });

  test("an issue the hand file cites must be listed as cited, and one listed as cited must be cited", () => {
    const coverage = { issues: [issue("26(3)", "no breakup items"), issue("26(4)", "cited")] };
    expect(coverageProblems(coverage, cited("ODQN 26(3), September 2022, p. 2; ODQN 27(2), June 2023"))).toEqual([
      "26(3) is cited by the hand file but listed as no breakup items",
      "26(4) is listed as cited but the hand file cites it nowhere",
      "27(2) is cited by the hand file but not listed",
    ]);
  });

  test("an unread issue is no gap, so a source that could not be read is said so rather than guessed", () => {
    expect(coverageProblems({ issues: [issue("26(3)", "cited"), issue("26(4)", "unread")] }, cited("ODQN 26(3)"))).toEqual([]);
  });

  test("the committed list covers every issue since 26(3) and agrees with the hand file", () => {
    const coverage = JSON.parse(readFileSync(resolve(ROOT, "data/truth/odqn-coverage.json"), "utf8")) as OdqnCoverage;
    const hand = readStatements((JSON.parse(readFileSync(resolve(ROOT, "data/truth/hand.json"), "utf8")) as { statements: unknown }).statements);
    expect(coverageProblems(coverage, hand)).toEqual([]);
  });
});
