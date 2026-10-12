import { describe, expect, test } from "vitest";
import { ACCEPT_LABEL, acceptance, reportBranch, REPORT_LABEL, type LabelledEvent } from "./report-issue.ts";

const event = (over: { label?: string; labels?: string[]; sender?: string; body?: string | null } = {}): LabelledEvent => ({
  action: "labeled",
  label: { name: over.label ?? ACCEPT_LABEL },
  issue: { number: 41, body: over.body === undefined ? "### Source\n\nnews" : over.body, labels: (over.labels ?? [REPORT_LABEL, ACCEPT_LABEL]).map((name) => ({ name })) },
  sender: { login: over.sender ?? "the-owner" },
});

describe("accepting a breakup report", () => {
  test("is the owner's alone: the label applied by anyone without admin permission is refused", () => {
    expect(acceptance(event(), "admin")).toEqual({ accepted: true, number: 41, body: "### Source\n\nnews", by: "the-owner" });
    for (const permission of ["maintain", "write", "triage", "read", "none"]) {
      expect(acceptance(event({ sender: "someone" }), permission)).toEqual({ accepted: false, number: 41, reason: `someone applied ${ACCEPT_LABEL} with ${permission} permission; only the repository's owner, with admin permission, accepts a report` });
    }
  });

  test("reads only the accepting label, on an issue that is a breakup report", () => {
    expect(acceptance(event({ label: "bug" }), "admin")).toMatchObject({ accepted: false, reason: `the label applied is bug, not ${ACCEPT_LABEL}` });
    expect(acceptance(event({ labels: [ACCEPT_LABEL] }), "admin")).toMatchObject({ accepted: false, reason: `the issue is not labelled ${REPORT_LABEL}` });
  });

  test("refuses an issue with no body", () => {
    expect(acceptance(event({ body: null }), "admin")).toMatchObject({ accepted: false, reason: "the issue has no body to read the report from" });
  });

  test("builds the statement on a branch named by the issue's number alone", () => {
    expect(reportBranch(41)).toBe("report/issue-41");
  });
});
