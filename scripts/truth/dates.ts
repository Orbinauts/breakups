import type { Precision, StatedTime } from "../../src/truth.ts";
import { isoMinute } from "../time.ts";

/**
 * The dates and times the sources write, read into the window a statement
 * carries. NASA's history prints a date and a time in a closed set of forms
 * ("23 Dec. 2019", "1302 GMT", "~ 0712 GMT", "0600-0700 GMT", "1000 GMT ±
 * 8 hours", "Mid-Jun 1966", "Prior to 1800 GMT, 8 Nov 1994"); its tables
 * print "29-Jun-61", "Jun-66", "21-23-Dec-19", "Apr/May 96"; GCAT prints a
 * vague date ("2016 Jun 8?", "1963", "2004 Jul?") whose trailing question
 * mark widens the last unit by one either side. Every form is listed here;
 * a form not listed throws, so a new edition cannot slip a date past the
 * build unread.
 */

export class DateFormError extends Error {}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function month(word: string): number {
  const number = MONTHS[word.toLowerCase().replace(/\.$/, "")];
  if (number === undefined) throw new DateFormError(`not a month: ${word}`);
  return number;
}

/** A two-digit year as the tables and the two-line format read it: 57 to 99 are the 1900s. */
function century(year: number): number {
  return year >= 100 ? year : year < 57 ? 2000 + year : 1900 + year;
}

const daysIn = (year: number, m: number): number => new Date(Date.UTC(year, m, 0)).getUTCDate();

/** An instant, as ISO 8601 UTC to the minute (seconds kept when given). */
export function utc(year: number, m: number, d: number, h = 0, min = 0, s = 0): string {
  const iso = new Date(Date.UTC(year, m - 1, d, h, min, Math.floor(s), Math.round((s % 1) * 1000))).toISOString();
  return s === 0 ? `${iso.slice(0, 16)}Z` : iso;
}

/** A window, both edges included, over whole days: from the first day's midnight to the midnight after the last. */
function days(year: number, m: number, first: number, last: number, precision: Precision = "day"): Omit<StatedTime, "stated"> {
  const end = new Date(Date.UTC(year, m - 1, last + 1));
  return { at: null, from: utc(year, m, first), to: isoMinute(end), precision };
}

function months(year: number, first: number, last: number, precision: Precision = "month"): Omit<StatedTime, "stated"> {
  const end = new Date(Date.UTC(year, last, 1));
  return { at: null, from: utc(year, first, 1), to: isoMinute(end), precision };
}

function years(first: number, last: number): Omit<StatedTime, "stated"> {
  return { at: null, from: utc(first, 1, 1), to: utc(last + 1, 1, 1), precision: "year" };
}

/** A calendar day as the sources write it: year, month and day. */
export interface Day {
  year: number;
  month: number;
  day: number;
}

type Shape = Omit<StatedTime, "stated">;

/**
 * NASA's DATE field or a table's date cell. Answers the window the words
 * span; "Approx."/"~" widen a day by one either side; "Prior to <time>, <day>"
 * has no lower edge.
 */
export function parseNasaDate(text: string): Shape {
  const raw = text.replace(/\s+/g, " ").replace(/∼/g, "~").trim();
  let s = raw.replace(/\*+$/, "").replace(/\s*\((?:\?|EST|est\.?)\)\s*$/, "").replace(/;.*$/, "").trim();
  const approximate = /^(?:~\s*|approx\.?\s*)/i.test(s);
  s = s.replace(/^(?:~\s*|approx\.?\s*)/i, "");
  let m: RegExpExecArray | null;
  // "Prior to 1800 GMT, 8 Nov 1994", "prior to 1-Jan-18", "prior to 1 Jan. 2014"
  if ((m = /^prior to (?:(\d{4}) GMT, )?(.+)$/i.exec(s)) !== null) {
    const bound = parseNasaDate(m[2]!);
    const to = m[1] !== undefined ? utc(...dayOf(bound.from!), Number(m[1].slice(0, 2)), Number(m[1].slice(2))) : bound.from!;
    return { at: null, from: null, to, precision: "none" };
  }
  // "3.736 Feb 2015", "24.82 May 2007", "26.5 July 1993": a day and its fraction, an instant to the fraction's precision
  if ((m = /^(\d{1,2})\.(\d+) ([A-Za-z]+\.?) (\d{4})$/.exec(s)) !== null) {
    const [year, mo, d] = [Number(m[4]), month(m[3]!), Number(m[1])];
    const minutes = Math.round(Number(`0.${m[2]}`) * 1440);
    const at = isoMinute(new Date(Date.UTC(year, mo - 1, d, 0, minutes)));
    const half = Math.ceil((1440 / 10 ** m[2]!.length) / 2);
    const edge = (offset: number): string => isoMinute(new Date(Date.UTC(year, mo - 1, d, 0, minutes + offset)));
    return { at, from: edge(-half), to: edge(half), precision: m[2]!.length >= 3 ? "minute" : "hour" };
  }
  // "23 Dec. 2019", "25 Dec 2013", "3 Apr 2014", "14 Feb 2006"
  if ((m = /^(\d{1,2}) ([A-Za-z]+\.?) (\d{4})$/.exec(s)) !== null) {
    const [year, mo, d] = [Number(m[3]), month(m[2]!), Number(m[1])];
    return approximate ? widened(year, mo, d) : days(year, mo, d, d);
  }
  // "29-Jun-61", "~22-Apr-05" (approximate already stripped), "13-Feb-98"
  if ((m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(s)) !== null) {
    const [year, mo, d] = [century(Number(m[3])), month(m[2]!), Number(m[1])];
    return approximate ? widened(year, mo, d) : days(year, mo, d, d);
  }
  // "21-23-Dec-19", "3/4-Aug-15", "25-28 Jan-84", "9/10-Jan-98", "16-19 Sep-87"
  if ((m = /^(\d{1,2})[-/](\d{1,2})[- ]([A-Za-z]{3})-(\d{2,4})$/.exec(s)) !== null) {
    return days(century(Number(m[4])), month(m[3]!), Number(m[1]), Number(m[2]));
  }
  // "25-28 Jan 1984", "16-19 Sep 1987", "3/4 Aug 2015"
  if ((m = /^(\d{1,2})[-/](\d{1,2}) ([A-Za-z]+\.?) (\d{4})$/.exec(s)) !== null) {
    return days(Number(m[4]), month(m[3]!), Number(m[1]), Number(m[2]));
  }
  // "30 March to 4 April 2015"
  if ((m = /^(\d{1,2}) ([A-Za-z]+\.?) to (\d{1,2}) ([A-Za-z]+\.?) (\d{4})$/.exec(s)) !== null) {
    const year = Number(m[5]);
    const from = days(year, month(m[2]!), Number(m[1]), Number(m[1]));
    const to = days(year, month(m[4]!), Number(m[3]), Number(m[3]));
    return { at: null, from: from.from, to: to.to, precision: "day" };
  }
  // "Jun-66", "Jul-92", "Apr-80"
  if ((m = /^([A-Za-z]{3})-(\d{2})$/.exec(s)) !== null) {
    const year = century(Number(m[2]));
    return months(year, month(m[1]!), month(m[1]!));
  }
  // "Late-2010", "Late 2015", "early 2006", "early 2006?"
  if ((m = /^(early|late)[- ](\d{2,4})\??$/i.exec(s)) !== null) {
    const year = century(Number(m[2]));
    return m[1]!.toLowerCase() === "early" ? months(year, 1, 4) : months(year, 10, 12);
  }
  // "Jul 1992", "Feb 1996", "April 2019", "Sept. 1987"
  if ((m = /^([A-Za-z]+\.?) (\d{4})$/.exec(s)) !== null) {
    return months(Number(m[2]), month(m[1]!), month(m[1]!));
  }
  // "Mid-Jun 1966", "Mid-Feb 1976", "Early Dec 1990", "Late Apr 1981", "early Dec. 2003"
  if ((m = /^(early|mid|late)[- ]([A-Za-z]+\.?) (\d{4})$/i.exec(s)) !== null) {
    const [year, mo] = [Number(m[3]), month(m[2]!)];
    const part = m[1]!.toLowerCase();
    return part === "early" ? days(year, mo, 1, 10) : part === "mid" ? days(year, mo, 10, 20) : days(year, mo, 20, daysIn(year, mo));
  }
  // "Late Apr-early May 1981"
  if ((m = /^late ([A-Za-z]+\.?)-early ([A-Za-z]+\.?) (\d{4})$/i.exec(s)) !== null) {
    const year = Number(m[3]);
    return { at: null, from: utc(year, month(m[1]!), 20), to: days(year, month(m[2]!), 1, 10).to, precision: "day" };
  }
  // "Apr-May 1981", "Apr/May 96"
  if ((m = /^([A-Za-z]{3})[-/]([A-Za-z]{3}) (\d{2,4})$/.exec(s)) !== null) {
    return months(century(Number(m[3])), month(m[1]!), month(m[2]!));
  }
  // "1996-2001"
  if ((m = /^(\d{4})-(\d{4})$/.exec(s)) !== null) return years(Number(m[1]), Number(m[2]));
  // "2017"
  if ((m = /^(\d{4})$/.exec(s)) !== null) return years(Number(m[1]), Number(m[1]));
  throw new DateFormError(`unreadable date "${raw}"`);
}

function widened(year: number, mo: number, d: number): Shape {
  const start = new Date(Date.UTC(year, mo - 1, d - 1));
  const end = new Date(Date.UTC(year, mo - 1, d + 2));
  return { at: null, from: isoMinute(start), to: isoMinute(end), precision: "day" };
}

function dayOf(iso: string): [number, number, number] {
  const date = new Date(iso);
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
}

/** What NASA's TIME field says: an instant, a window, or nothing. */
export interface ParsedTime {
  /** Minutes from the day's midnight, or null for unknown. */
  start: number | null;
  end: number | null;
  /** Whether the words mark the instant as approximate ("~", "(est.)"). */
  approximate: boolean;
  /** Whether only an upper bound is given ("Before 0340 GMT"). */
  before: boolean;
  precision: Precision;
  /** Seconds, where the source states them. */
  seconds: number | null;
}

const hhmm = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(2, 4));

/** NASA's TIME field. "Unknown" answers no time at all. */
export function parseNasaTime(text: string): ParsedTime | null {
  const s = text.replace(/\s+/g, " ").replace(/∼/g, "~").trim();
  if (/^unknown$/i.test(s)) return null;
  let m: RegExpExecArray | null;
  // "1302 GMT", "1425Z", "1425 Z", "0240 GMT (est.)", "~0712 GMT", "~ 0712 GMT", "~0712Z"
  if ((m = /^(~\s*|approximately\s+|approx\.?\s+)?(\d{4})\s*(?:GMT|Z)(?:\s*\(est\.\))?$/i.exec(s)) !== null) {
    const approximate = m[1] !== undefined || /\(est\.\)/.test(s);
    return { start: hhmm(m[2]!), end: hhmm(m[2]!), approximate, before: false, precision: "minute", seconds: null };
  }
  // "09:14:54.5 GMT", "11:22:35 GMT"
  if ((m = /^(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?) GMT$/.exec(s)) !== null) {
    const minutes = Number(m[1]) * 60 + Number(m[2]);
    return { start: minutes, end: minutes, approximate: false, before: false, precision: "second", seconds: Number(m[3]) };
  }
  // "0600-0700 GMT", "0006-0040 GMT?", "between 1918–0253 GMT"
  if ((m = /^(?:between )?(\d{4})\s*[-–]\s*(\d{4}) GMT\??$/.exec(s)) !== null) {
    return { start: hhmm(m[1]!), end: hhmm(m[2]!), approximate: false, before: false, precision: "hour", seconds: null };
  }
  // "Before 0340 GMT"
  if ((m = /^before (\d{4}) GMT$/i.exec(s)) !== null) {
    return { start: null, end: hhmm(m[1]!), approximate: false, before: true, precision: "hour", seconds: null };
  }
  // "1000 GMT ± 8 hours"
  if ((m = /^(\d{4}) GMT ± (\d+) hours?$/.exec(s)) !== null) {
    const centre = hhmm(m[1]!);
    return { start: centre - Number(m[2]) * 60, end: centre + Number(m[2]) * 60, approximate: true, before: false, precision: "hour", seconds: null };
  }
  throw new DateFormError(`unreadable time "${text}"`);
}

/** Minutes either side an approximate instant ("~ 0712 GMT") is taken to cover. */
export const APPROXIMATE_MINUTES = 10;

/**
 * NASA's DATE and TIME together: the time narrows a one-day date to an
 * instant or a window inside it (a window ending before it starts crosses
 * midnight into the next day); a time on a wider date, or no time at all,
 * leaves the date's window.
 */
export function nasaWindow(date: string, time: string | null): StatedTime {
  // The late anomalous spreads print "28 December 2021, 1836 GMT" in the DATE field alone.
  const split = /^(.+?),\s*(.+ GMT.*)$/.exec(date.trim());
  if (time === null && split !== null) [date, time] = [split[1]!, split[2]!];
  const stated = time === null ? date.trim() : `${date.trim()}, ${time.trim()}`;
  const day = parseNasaDate(date);
  const clock = time === null ? null : parseNasaTime(time);
  const oneDay = day.from !== null && day.precision === "day" && Date.parse(day.to) - Date.parse(day.from) === 86_400_000;
  if (clock === null || !oneDay) return { stated, ...day };
  const [y, mo, d] = dayOf(day.from!);
  const minute = (minutes: number, extraDays = 0): string => {
    const t = new Date(Date.UTC(y, mo - 1, d + extraDays, 0, minutes));
    return isoMinute(t);
  };
  if (clock.before) return { stated, at: null, from: minute(0), to: minute(clock.end!), precision: "hour" };
  if (clock.start === clock.end) {
    const at = clock.seconds !== null ? utc(y, mo, d, Math.floor(clock.start! / 60), clock.start! % 60, clock.seconds) : minute(clock.start!);
    if (clock.approximate) return { stated, at, from: minute(clock.start! - APPROXIMATE_MINUTES), to: minute(clock.start! + APPROXIMATE_MINUTES), precision: "minute" };
    return { stated, at, from: at, to: at, precision: clock.precision };
  }
  const crosses = clock.end! < clock.start!;
  return { stated, at: null, from: minute(clock.start!), to: minute(clock.end!, crosses ? 1 : 0), precision: clock.precision };
}

/**
 * GCAT's vague date: "2016 Jun 8 2355", "2016 Jun 8", "2016 Jun", "2016",
 * "1963 May 10 1756:24", each optionally ending in "?", which widens the
 * last unit by one either side (a day to three days, a minute to three
 * minutes, a month to three months, a year to three years).
 */
export function parseVagueDate(text: string): StatedTime {
  const stated = text.replace(/\s+/g, " ").trim();
  const m = /^(\d{4})(?: ([A-Z][a-z]{2})(?: (\d{1,2})(?: (\d{2})(\d{2})(?::(\d{2}))?)?)?)?(\?)?$/.exec(stated);
  if (m === null) throw new DateFormError(`unreadable vague date "${text}"`);
  const year = Number(m[1]);
  const uncertain = m[7] !== undefined;
  if (m[2] === undefined) return { stated, ...(uncertain ? years(year - 1, year + 1) : years(year, year)) };
  const mo = month(m[2]);
  if (m[3] === undefined) {
    if (!uncertain) return { stated, ...months(year, mo, mo) };
    const before = new Date(Date.UTC(year, mo - 2, 1));
    const after = new Date(Date.UTC(year, mo + 1, 1));
    return { stated, at: null, from: isoMinute(before), to: isoMinute(after), precision: "month" };
  }
  const d = Number(m[3]);
  if (m[4] === undefined) return { stated, ...(uncertain ? widened(year, mo, d) : days(year, mo, d, d)) };
  const [h, min] = [Number(m[4]), Number(m[5])];
  const seconds = m[6] === undefined ? 0 : Number(m[6]);
  const at = utc(year, mo, d, h, min, seconds);
  if (!uncertain) return { stated, at, from: at, to: at, precision: seconds === 0 ? "minute" : "second" };
  const edge = (offset: number): string => isoMinute(new Date(Date.UTC(year, mo - 1, d, h, min + offset)));
  return { stated, at, from: edge(-1), to: edge(1), precision: "minute" };
}
