import { describe, expect, test } from "vitest";
import { DateFormError, nasaWindow, parseNasaDate, parseNasaTime, parseVagueDate } from "./dates.ts";

describe("NASA's date forms", () => {
  test.each([
    ["23 Dec. 2019", "2019-12-23T00:00Z", "2019-12-24T00:00Z", "day"],
    ["3 Apr 2014", "2014-04-03T00:00Z", "2014-04-04T00:00Z", "day"],
    ["29-Jun-61", "1961-06-29T00:00Z", "1961-06-30T00:00Z", "day"],
    ["~22-Apr-05", "2005-04-21T00:00Z", "2005-04-24T00:00Z", "day"],
    ["Approx. 21 Oct 1986", "1986-10-20T00:00Z", "1986-10-23T00:00Z", "day"],
    ["21-23-Dec-19", "2019-12-21T00:00Z", "2019-12-24T00:00Z", "day"],
    ["3/4-Aug-15", "2015-08-03T00:00Z", "2015-08-05T00:00Z", "day"],
    ["25-28 Jan 1984", "1984-01-25T00:00Z", "1984-01-29T00:00Z", "day"],
    ["30 March to 4 April 2015", "2015-03-30T00:00Z", "2015-04-05T00:00Z", "day"],
    ["Jun-66", "1966-06-01T00:00Z", "1966-07-01T00:00Z", "month"],
    ["Jul 1992 (?)", "1992-07-01T00:00Z", "1992-08-01T00:00Z", "month"],
    ["Sept. 2019*", "2019-09-01T00:00Z", "2019-10-01T00:00Z", "month"],
    ["Apr-May 1981", "1981-04-01T00:00Z", "1981-06-01T00:00Z", "month"],
    ["Mid-Jun 1966", "1966-06-10T00:00Z", "1966-06-21T00:00Z", "day"],
    ["Early Dec 1990", "1990-12-01T00:00Z", "1990-12-11T00:00Z", "day"],
    ["Late Apr-early May 1981", "1981-04-20T00:00Z", "1981-05-11T00:00Z", "day"],
    ["Late-2010", "2010-10-01T00:00Z", "2011-01-01T00:00Z", "month"],
    ["early 2006?", "2006-01-01T00:00Z", "2006-05-01T00:00Z", "month"],
    ["1996-2001", "1996-01-01T00:00Z", "2002-01-01T00:00Z", "year"],
    ["2017", "2017-01-01T00:00Z", "2018-01-01T00:00Z", "year"],
  ])("%s spans %s to %s (%s)", (text, from, to, precision) => {
    const window = parseNasaDate(text);
    expect(window.from).toBe(from);
    expect(window.to).toBe(to);
    expect(window.precision).toBe(precision);
    expect(window.at).toBeNull();
  });

  test("a fractional day is an instant", () => {
    expect(parseNasaDate("26.5 July 1993").at).toBe("1993-07-26T12:00Z");
    expect(parseNasaDate("3.736 Feb 2015")).toMatchObject({ at: "2015-02-03T17:40Z", precision: "minute" });
  });

  test("prior to a time has no lower edge", () => {
    expect(parseNasaDate("Prior to 1800 GMT, 8 Nov 1994")).toEqual({ at: null, from: null, to: "1994-11-08T18:00Z", precision: "none" });
    expect(parseNasaDate("prior to 1-Jan-18")).toEqual({ at: null, from: null, to: "2018-01-01T00:00Z", precision: "none" });
  });

  test("a form not listed throws rather than guessing", () => {
    expect(() => parseNasaDate("sometime in 1999")).toThrow(DateFormError);
    expect(() => parseNasaDate("Apr/May")).toThrow(DateFormError);
  });
});

describe("NASA's time forms", () => {
  test.each([
    ["1302 GMT", 782, 782, false],
    ["1425Z", 865, 865, false],
    ["~ 0712 GMT", 432, 432, true],
    ["0240 GMT (est.)", 160, 160, true],
    ["approximately 0950 GMT", 590, 590, true],
    ["0600-0700 GMT", 360, 420, false],
    ["between 1918–0253 GMT", 1158, 173, false],
    ["1000 GMT ± 8 hours", 120, 1080, true],
  ])("%s", (text, start, end, approximate) => {
    expect(parseNasaTime(text)).toMatchObject({ start, end, approximate });
  });

  test("unknown is no time, and a form not listed throws", () => {
    expect(parseNasaTime("Unknown")).toBeNull();
    expect(() => parseNasaTime("noon")).toThrow(DateFormError);
  });
});

describe("a date and a time together", () => {
  test("an exact minute", () => {
    expect(nasaWindow("23 Dec. 2019", "1302 GMT")).toEqual({ stated: "23 Dec. 2019, 1302 GMT", at: "2019-12-23T13:02Z", from: "2019-12-23T13:02Z", to: "2019-12-23T13:02Z", precision: "minute" });
  });
  test("an approximate minute is ten minutes either side", () => {
    expect(nasaWindow("22 Dec. 2018", "~ 0712 GMT")).toMatchObject({ at: "2018-12-22T07:12Z", from: "2018-12-22T07:02Z", to: "2018-12-22T07:22Z" });
  });
  test("a window that crosses midnight ends the next day", () => {
    expect(nasaWindow("4 Jan 1999", "between 1918–0253 GMT")).toMatchObject({ from: "1999-01-04T19:18Z", to: "1999-01-05T02:53Z", precision: "hour" });
  });
  test("seconds are kept", () => {
    expect(nasaWindow("10 Feb 2009", "16:56:54.5 GMT")).toMatchObject({ at: "2009-02-10T16:56:54.500Z", precision: "second" });
  });
  test("a time carried in the date field is read", () => {
    expect(nasaWindow("29 March 2022, approximately 0950 GMT", null)).toMatchObject({ at: "2022-03-29T09:50Z", from: "2022-03-29T09:40Z" });
  });
  test("a time on a multi-day date leaves the date's window", () => {
    expect(nasaWindow("21-23-Dec-19", "Unknown")).toMatchObject({ from: "2019-12-21T00:00Z", to: "2019-12-24T00:00Z", precision: "day" });
  });
});

describe("GCAT's vague dates", () => {
  test.each([
    ["2016 Jun 8 2355", "2016-06-08T23:55Z", "2016-06-08T23:55Z", "2016-06-08T23:55Z", "minute"],
    ["2016 Jun 8 2355?", "2016-06-08T23:55Z", "2016-06-08T23:54Z", "2016-06-08T23:56Z", "minute"],
    ["1963 May 10 1756:24", "1963-05-10T17:56:24.000Z", "1963-05-10T17:56:24.000Z", "1963-05-10T17:56:24.000Z", "second"],
    ["2016 Jun 8", null, "2016-06-08T00:00Z", "2016-06-09T00:00Z", "day"],
    ["2016 Jun  8?", null, "2016-06-07T00:00Z", "2016-06-10T00:00Z", "day"],
    ["2004 Jul", null, "2004-07-01T00:00Z", "2004-08-01T00:00Z", "month"],
    ["2004 Jul?", null, "2004-06-01T00:00Z", "2004-09-01T00:00Z", "month"],
    ["1963", null, "1963-01-01T00:00Z", "1964-01-01T00:00Z", "year"],
    ["1963?", null, "1962-01-01T00:00Z", "1965-01-01T00:00Z", "year"],
  ])("%s", (text, at, from, to, precision) => {
    expect(parseVagueDate(text)).toEqual({ stated: text.replace(/\s+/g, " "), at, from, to, precision });
  });

  test("a form not listed throws", () => {
    expect(() => parseVagueDate("June 2016")).toThrow(DateFormError);
  });
});
