import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addMissing } from "./add.ts";
import { ACCEPT_LABEL, acceptance, acceptedHandFile, acceptedStatement, REPORT_LABEL, type AcceptedIssue, type IssueEvent, type LabelledEvent } from "./report-issue.ts";

const event = (over: { label?: string; labels?: string[]; sender?: string; body?: string | null } = {}): LabelledEvent => ({
  action: "labeled",
  label: { name: over.label ?? ACCEPT_LABEL },
  issue: { number: 41, body: over.body === undefined ? "### Source\n\nnews" : over.body, labels: (over.labels ?? [REPORT_LABEL, ACCEPT_LABEL]).map((name) => ({ name })) },
  sender: { login: over.sender ?? "the-owner" },
});

describe("accepting a breakup report", () => {
  test("is the owner's alone: the label applied by anyone but the repository's owner is refused, an admin too", () => {
    expect(acceptance(event(), "the-owner")).toEqual({ accepted: true, number: 41, body: "### Source\n\nnews", by: "the-owner" });
    for (const sender of ["an-admin", "a-maintainer", "someone", "The-Owner-Not"]) {
      expect(acceptance(event({ sender }), "the-owner")).toEqual({ accepted: false, number: 41, reason: `${sender} applied ${ACCEPT_LABEL}; only the repository's owner, the-owner, accepts a report` });
    }
  });

  test("reads only the accepting label, on an issue that is a breakup report", () => {
    expect(acceptance(event({ label: "bug" }), "the-owner")).toMatchObject({ accepted: false, reason: `the label applied is bug, not ${ACCEPT_LABEL}` });
    expect(acceptance(event({ labels: [ACCEPT_LABEL] }), "the-owner")).toMatchObject({ accepted: false, reason: `the issue is not labelled ${REPORT_LABEL}` });
  });

  test("refuses an issue with no body", () => {
    expect(acceptance(event({ body: null }), "the-owner")).toMatchObject({ accepted: false, reason: "the issue has no body to read the report from" });
  });

});

/** The issues labelled breakup-report-accepted and each one's events, as GitHub's issues and issue events APIs gave them (test/fixtures/report-issues/). */
const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../../test/fixtures/report-issues");
const fixture = <T>(name: string): T => JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8")) as T;
const issues = fixture<{ number: number; body: string | null; labels: { name: string }[] }[]>("issues.json");
const accepted = (number: number, lastEditedAt: string | null = null): AcceptedIssue => ({ ...issues.find((issue) => issue.number === number)!, lastEditedAt, events: fixture<IssueEvent[]>(`events-${number}.json`) });
const HAND = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../data/truth/hand.json"), "utf8");

describe("the statements of the accepted reports, read again from their issues", () => {
  test("an issue the owner labelled last, its body unedited since, states the form's statement", () => {
    const read = acceptedStatement(accepted(57), "the-owner");
    expect("statement" in read && read.statement).toMatchObject({ source: "analyst", url: "https://earthsky.org/space/another-satellite-breakup-meteor-2-7-oct-5-2026/", parent: { catalogueNumber: 12456, designator: "1981-043A" } });
    // A body edited before the owner's label is the body the owner read.
    expect("statement" in acceptedStatement(accepted(57, "2026-10-08T08:30:00Z"), "the-owner")).toBe(true);
  });

  test("an issue whose accepting label someone else applied last states nothing, whoever applied it before", () => {
    expect(acceptedStatement(accepted(58), "the-owner")).toEqual({ number: 58, reason: `a-collaborator applied ${ACCEPT_LABEL} last; only the repository's owner, the-owner, accepts a report` });
  });

  test("an issue whose body was edited after the owner accepted it states nothing until the owner labels it again", () => {
    expect(acceptedStatement(accepted(59, "2026-10-09T12:00:00Z"), "the-owner")).toEqual({ number: 59, reason: `its body was edited on 2026-10-09T12:00:00Z, after the owner accepted it on 2026-10-08T09:01:05Z: the owner labels it ${ACCEPT_LABEL} again to accept the new text` });
  });

  test("an issue that is not a breakup report states nothing", () => {
    expect(acceptedStatement(accepted(60), "the-owner")).toEqual({ number: 60, reason: `the issue is not labelled ${REPORT_LABEL}` });
  });

  test("are gathered as a hand file the maintenance run appends the missing statements of, in the issues' order", () => {
    const { file, passed } = acceptedHandFile([accepted(57), accepted(58), accepted(59, "2026-10-09T12:00:00Z"), accepted(60)], "the-owner");
    expect(file.statements.map((s) => s.source)).toEqual(["analyst"]);
    expect(passed.map((p) => p.number)).toEqual([58, 59, 60]);
    // The hand file holds Jim Shell's dating of Meteor 2-7 already, in other words: nothing is added.
    expect(addMissing(HAND, JSON.stringify(file)).added).toEqual([]);
  });
});
