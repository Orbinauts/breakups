import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { readForm } from "../truth/report-form.ts";
import { esaNotice, feedNotices, isBreakupTitle, issuesFor, jsrLatest, jsrNotices, odqnNotices, toOpen, watchedKeys, type Notice } from "./watch.ts";

/**
 * The watcher of public notices, on the pages as they were served on
 * 2026-10-12 (`test/fixtures/watch/`, each cut to the part read): what it
 * reads from each, what it refuses as a page whose shape changed, which
 * notices open an issue, and that each issue is a prefilled
 * breakup-report form carrying the keys of its notices.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = (name: string): string => readFileSync(resolve(ROOT, "test/fixtures/watch", name), "utf8");

describe("NASA's Orbital Debris Quarterly News", () => {
  test("lists each issue with its reference as the hand file cites one, its month and its link", () => {
    const notices = odqnNotices(fixture("odqn.html"), [29, 2]);
    expect(notices.map((n) => [n.key, n.ref, n.published, n.url])).toEqual([
      ["odqn:ODQNv30i3", "ODQN 30(3), September 2026", "2026-09", "https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/ODQNv30i3.pdf"],
      ["odqn:ODQNv30i1", "ODQN 30(1), July 2026 (Issue 1 & 2)", "2026-07", "https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/ODQNv30i1.pdf"],
      ["odqn:ODQNv29i3", "ODQN 29(3), September 2025", "2025-09", "https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/ODQNv29i3.pdf"],
    ]);
    expect(notices[0]!.source).toBe("odqn");
    expect(notices[0]!.lines).toContain("The NASA Battery Passivation Workshop");
  });

  test("keeps only the issues after the last one the truth was read from", () => {
    expect(odqnNotices(fixture("odqn.html"), [30, 1]).map((n) => n.key)).toEqual(["odqn:ODQNv30i3"]);
    expect(odqnNotices(fixture("odqn.html"))).toEqual([]);
  });

  test("refuses a page that lists no issue: its shape changed", () => {
    expect(() => odqnNotices("<html><body>Quarterly News</body></html>")).toThrow(/lists no issue/);
  });
});

describe("ESA's Space Environment Report", () => {
  test("reads a year's edition from its page: the report's issue, its day and its link", () => {
    const notice = esaNotice(fixture("esa-ser-2026.html"), 2026);
    expect(notice).toMatchObject({
      key: "esa-ser:2026",
      source: "esa-ser",
      published: "2026-09-08",
      url: "https://www.sdo.esoc.esa.int/environment_report/Space_Environment_Report_I10R1_20260908.pdf",
      ref: "ESA Space Environment Report 2026 (issue 10.1, dated 8 September 2026)",
    });
  });

  test("refuses a page that is not the year's edition, or links no report", () => {
    expect(() => esaNotice(fixture("esa-ser-2026.html"), 2027)).toThrow(/not the 2027 edition/);
    expect(() => esaNotice(fixture("esa-ser-2026.html").replace(/I10R1_20260908/g, "x"), 2026)).toThrow(/links no report/);
  });
});

describe("Jonathan's Space Report", () => {
  test("names its latest issue by the back issues' list, a corrected or lettered file aside", () => {
    expect(jsrLatest(fixture("jsr-back.html"))).toBe(860);
    expect(() => jsrLatest("<html></html>")).toThrow(/lists no issue/);
  });

  test("gives each section of an issue that reports a breakup, quoted as the hand file quotes it", () => {
    expect(jsrNotices(fixture("jsr-853.txt"), 853)).toEqual([
      {
        key: "jsr:853:Olimp",
        source: "analyst",
        title: "Jonathan's Space Report No. 853: Olimp",
        published: "2026-02-15",
        url: "https://planet4589.org/space/jsr/back/news.853.txt",
        ref: "J. McDowell, Jonathan's Space Report No. 853, 2026-02-15 (https://planet4589.org/space/jsr/back/news.853.txt): 'On Jan 30 the retired Olimp satellite, in the GEO graveyard, underwent a breakup event, according to optical monitoring by the Swiss company s2a Systems.'",
        lines: ["On Jan 30 the retired Olimp satellite, in the GEO graveyard, underwent a breakup event, according to optical monitoring by the Swiss company s2a Systems."],
      },
    ]);
  });

  test("gives nothing for an issue that reports no breakup, and refuses a text that is not an issue", () => {
    expect(jsrNotices(fixture("jsr-860.txt"), 860)).toEqual([]);
    expect(() => jsrNotices("Some other text", 861)).toThrow(/not issue 861/);
  });
});

describe("the news", () => {
  test("keeps a publisher's articles whose title reports a breakup", () => {
    expect(feedNotices(fixture("earthsky.xml"), "EarthSky")).toEqual([
      {
        key: "news:https://earthsky.org/space/another-satellite-breakup-meteor-2-7-oct-5-2026/",
        source: "news",
        title: "Another satellite breakup raises concerns about space junk",
        published: "2026-10-09",
        url: "https://earthsky.org/space/another-satellite-breakup-meteor-2-7-oct-5-2026/",
        ref: "EarthSky, 2026-10-09 (https://earthsky.org/space/another-satellite-breakup-meteor-2-7-oct-5-2026/): 'Another satellite breakup raises concerns about space junk'",
        lines: [],
      },
    ]);
    expect(feedNotices(fixture("spacecom.xml"), "Space.com").map((n) => n.title)).toEqual(["A dead Soviet satellite just broke apart in orbit (again). Experts say it's part of 'a worrying trend'"]);
  });

  test("reads a title as a breakup's by its words: a body breaking up or apart, never dawn breaking or a forest fragmented", () => {
    for (const title of ["China satellite breaks up in unusual orbit, leaves 43 fragments", "Cold War US spy satellite breaks apart in orbit", "A Chinese rocket breaks apart dangerously close to the Starlink constellation", "Retired military weather satellite breaks up", "Russian satellite breakup creates more than 100 pieces of debris"]) expect(isBreakupTitle(title)).toBe(true);
    for (const title of ["Dawn breaks on Mars | Space photo of the day", "Forests are heating up as they become more fragmented", "SpaceX launches Google AI satellite, 129 other payloads"]) expect(isBreakupTitle(title)).toBe(false);
  });

  test("refuses a feed that is not one", () => {
    expect(() => feedNotices("<html>moved</html>", "EarthSky")).toThrow(/EarthSky's feed is not an RSS channel/);
  });
});

const notice = (key: string, source: Notice["source"], published: string): Notice => ({ key, source, title: key, published, url: `https://example.org/${key}`, ref: `${key}, ${published}`, lines: [] });

describe("the notices that open an issue", () => {
  const now = Date.parse("2026-10-12T07:41:00Z");

  test("are those no breakup-report issue carries yet", () => {
    const notices = [notice("odqn:ODQNv30i4", "odqn", "2026-12"), notice("esa-ser:2026", "esa-ser", "2026-09-08")];
    expect(toOpen(notices, new Set(["esa-ser:2026"]), now).map((n) => n.key)).toEqual(["odqn:ODQNv30i4"]);
  });

  test("leave out news older than the last three days, which the runs before read", () => {
    const notices = [notice("news:a", "news", "2026-10-09"), notice("news:b", "news", "2026-10-10"), notice("news:c", "news", "2026-10-12")];
    expect(toOpen(notices, new Set(), now).map((n) => n.key)).toEqual(["news:b", "news:c"]);
  });

  test("never take one key twice", () => {
    expect(toOpen([notice("news:a", "news", "2026-10-12"), notice("news:a", "news", "2026-10-12")], new Set(), now)).toHaveLength(1);
  });
});

describe("the issues opened", () => {
  const agency = notice("odqn:ODQNv30i4", "odqn", "2026-12");
  const news = [notice("news:a", "news", "2026-10-11"), notice("news:b", "news", "2026-10-12")];

  test("are one per notice, the day's news gathered into one, each a form prefilled with its source, day, reference and link", () => {
    const issues = issuesFor([agency, ...news]);
    expect(issues.map((issue) => issue.title)).toEqual(["Report: odqn:ODQNv30i4", "Report: news:a (and 1 more article)"]);
    expect(readForm(issues[0]!.body)).toMatchObject({ source: "odqn", published: "2026-12", ref: "odqn:ODQNv30i4, 2026-12", url: "https://example.org/odqn:ODQNv30i4", kind: null });
    expect(readForm(issues[1]!.body)).toMatchObject({ source: "news", published: "2026-10-11", ref: "news:a, 2026-10-11" });
    expect(issues[1]!.body).toContain("news:b, 2026-10-12");
  });

  test("carry the keys of their notices, so no notice opens a second", () => {
    const issues = issuesFor([agency, ...news]);
    expect(watchedKeys(issues.map((issue) => issue.body))).toEqual(new Set(["odqn:ODQNv30i4", "news:a", "news:b"]));
  });
});

describe("the watch workflow", () => {
  const workflow = parse(readFileSync(resolve(ROOT, ".github/workflows/watch.yml"), "utf8")) as { on: Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, { steps: { run?: string; with?: Record<string, unknown> }[] }> };
  const steps = workflow.jobs["watch"]!.steps;

  test("runs once a day and by hand", () => {
    expect(workflow.on).toEqual({ schedule: [{ cron: "41 7 * * *" }], workflow_dispatch: null });
  });

  test("may open issues and read the repository, never write to it: the truth is a person's to change", () => {
    expect(workflow.permissions).toEqual({ contents: "read", issues: "write" });
    expect(steps[0]!.with).toEqual({ "persist-credentials": false });
    expect(steps.some((step) => step.run?.includes("npm run -s maintenance:watch"))).toBe(true);
  });
});
