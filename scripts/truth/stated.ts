import type { Statement, StatedOn } from "../../src/truth.ts";

/**
 * When a hand-entered statement can first have been public, read from
 * its reference where the statement does not say: a quarterly news issue
 * by its month ("ODQN 27(1), March 2023"; the earliest where a reference
 * cites two issues), dated to the month's first day or to the event's own
 * day where the issue is of the event's month; a notice by the day it was
 * seen ("seen 2026-09-17"); an analyst's dating, a company's post or a
 * news report by the first day its reference gives. Where a reference is
 * ambiguous (ESA's report, whose row references give the event's day, not
 * the report's) the hand file states `statedOn` itself. The catalogue
 * listing fragments, GCAT's table and NASA's history carry their own and
 * are left as they are.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** The earliest month a reference names, `YYYY-MM`; null with none. */
export function earliestMonth(ref: string): string | null {
  const months = [...ref.matchAll(new RegExp(`(${MONTHS.join("|")}),?\\s+(\\d{4})`, "g"))].map((m) => `${m[2]}-${String(MONTHS.indexOf(m[1] as (typeof MONTHS)[number]) + 1).padStart(2, "0")}`);
  return months.length === 0 ? null : months.sort()[0]!;
}

/** The statement's publication day: its own where it states one, else as its reference gives it by its source's convention, else null. */
export function statedOnFromRef(statement: Statement): StatedOn | null {
  if (statement.statedOn !== null) return statement.statedOn;
  const lower = (statement.event.from ?? statement.event.to).slice(0, 10);
  switch (statement.source) {
    case "odqn": {
      const month = earliestMonth(statement.ref);
      if (month === null) return null;
      const start = `${month}-01`;
      return { on: start > lower ? start : lower, precision: "month", ref: statement.ref };
    }
    case "s4s-notice": {
      const seen = /seen (\d{4}-\d{2}-\d{2})/.exec(statement.ref)?.[1];
      return seen === undefined ? null : { on: seen, precision: "day", ref: statement.ref };
    }
    case "analyst":
    case "news":
    case "esa-ser": {
      const day = /\d{4}-\d{2}-\d{2}/.exec(statement.ref)?.[0];
      return day === undefined ? null : { on: day, precision: "day", ref: statement.ref };
    }
    default:
      return null;
  }
}
