import { describe, expect, test } from "vitest";
import type { Statement } from "../../src/index.ts";
import { firstMonday, handFileOf, reminderBody, reminderDue, reminderTitle } from "./reminder.ts";

describe("the quarterly reminder's days", () => {
  test("the first Monday of a month", () => {
    expect(firstMonday(2027, 0)).toBe("2027-01-04");
    expect(firstMonday(2026, 9)).toBe("2026-10-05");
    expect(firstMonday(2027, 3)).toBe("2027-04-05");
    expect(firstMonday(2027, 6)).toBe("2027-07-05");
    // A month that starts on a Monday.
    expect(firstMonday(2026, 5)).toBe("2026-06-01");
    expect(firstMonday(2029, 0)).toBe("2029-01-01");
  });

  test("is due on the first Monday of January, April, July and October", () => {
    expect(reminderDue("2027-01-04")).toEqual({ label: "2027 Q1", from: "2027-01-04", previous: "2026-10-05" });
    expect(reminderDue("2027-04-05")).toEqual({ label: "2027 Q2", from: "2027-04-05", previous: "2027-01-04" });
    expect(reminderDue("2027-07-05")?.label).toBe("2027 Q3");
    expect(reminderDue("2027-10-04")?.label).toBe("2027 Q4");
    expect(reminderDue("2029-01-01")?.label).toBe("2029 Q1");
  });

  test("is due in the week from that Monday, for a run made again by hand, and on no other day", () => {
    expect(reminderDue("2027-01-10")?.label).toBe("2027 Q1");
    expect(reminderDue("2027-01-11")).toBeNull();
    expect(reminderDue("2027-01-03")).toBeNull();
    expect(reminderDue("2027-01-01")).toBeNull();
    // The other Mondays of the year.
    expect(reminderDue("2027-01-11")).toBeNull();
    expect(reminderDue("2027-02-01")).toBeNull();
    expect(reminderDue("2027-03-01")).toBeNull();
    expect(reminderDue("2027-05-03")).toBeNull();
  });

  test("is titled by its quarter, which is what makes it once a quarter", () => {
    expect(reminderTitle({ label: "2027 Q1" })).toBe("Quarterly check of the hand-typed sources, 2027 Q1");
  });
});

describe("the reminder's body", () => {
  const statement = (source: Statement["source"], ref: string, to: string, on: string | null): Statement => ({ source, ref, event: { to }, statedOn: on === null ? undefined : { on, precision: "day", ref } }) as unknown as Statement;
  const hand = handFileOf([
    statement("odqn", "ODQN 30(3), September 2026, p. 4", "2026-07-01T00:00Z", "2026-09-01"),
    statement("odqn", "ODQN 29(4), December 2025, p. 2", "2025-11-01T00:00Z", "2025-12-01"),
    statement("s4s-notice", "the notice on the catalogue's login page", "2026-09-14T00:00Z", "2026-09-17"),
    statement("news", "a report", "2026-10-05T10:00Z", "2026-10-07"),
  ]);

  test("names the hand file's latest issue, notice, event and statement", () => {
    expect(hand.latestOdqn).toBe("ODQN 30(3), September 2026");
    expect(hand.latestNotice).toBe("2026-09-17");
    expect(hand.latestEvent?.to).toBe("2026-10-05T10:00Z");
    expect(hand.latestStatedOn).toBe("2026-10-07");
  });

  test("lists the three checks, the last reminder's day and how to add a row", () => {
    const body = reminderBody({ label: "2027 Q1", from: "2027-01-04", previous: "2026-10-05" }, hand, "2026-10-11");
    expect(body).toContain("Orbital Debris Quarterly News");
    expect(body).toContain("Space Forces-Space");
    expect(body).toContain("News reports of fragmentations** since 2026-10-05");
    expect(body).toContain("ends on 2026-10-05");
    expect(body).toContain("last changed on 2026-10-11");
    expect(body).toContain("data/truth/hand.json");
    expect(body).toContain("gh workflow run maintenance.yml -f from=<branch>");
  });

  test("gives the quick paths first: the issue form the owner accepts, and the command that checks and appends a statement", () => {
    const body = reminderBody({ label: "2027 Q1", from: "2027-01-04", previous: "2026-10-05" }, hand, "2026-10-11");
    expect(body).toContain("breakup-report");
    expect(body).toContain("`breakup-report-accepted`");
    expect(body).toContain("npm run truth:add -- <statement.json>");
    expect(body.indexOf("breakup-report-accepted")).toBeLessThan(body.indexOf("npm run truth:add"));
  });

  test("asks for every quarterly news issue read to be recorded, and each new ESA table typed into its file", () => {
    const body = reminderBody({ label: "2027 Q1", from: "2027-01-04", previous: "2026-10-05" }, hand, "2026-10-11");
    expect(body).toContain("`data/truth/odqn-coverage.json`");
    expect(body).toContain("`data/truth/esa-ser.json`");
  });
});
