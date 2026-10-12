import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { Latest } from "./kpi.ts";
import { readBreakups } from "../../src/index.ts";
import { beginOf, endOf, GENERATED_PARTS, GROUND_TRUTH, inWords, keptOutByWindowTable, markedPart, mediansSentence, readInputs, README, renderPage, replacePart, RESULTS, splitsSentence, targetSentence } from "./pages.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PAGES = Object.fromEntries(Object.keys(GENERATED_PARTS).map((page) => [page, readFileSync(join(ROOT, page), "utf8")])) as Record<string, string>;
const inputs = readInputs(ROOT);

/** The aggregate with the held-out and training splits' headline recall and false-alarm rate set. */
function withRates(latest: Latest, held: [number, number], train: [number, number]): Latest {
  const copy = JSON.parse(JSON.stringify(latest)) as Latest;
  for (const [split, [recall, falseRate]] of [["validation", held], ["train", train]] as const) {
    copy.splits[split].confirmedLine.lines["breakups A-B"].rate = recall;
    copy.splits[split].confirmedLine.falseAlarmRate = falseRate;
  }
  return copy;
}

describe("the markers", () => {
  const text = `intro\n\n${beginOf("a")}\n\nold table\n\n${endOf("a")}\n\nThe sentence ${beginOf("b")}old${endOf("b")} ends.\n`;

  test("a block part is replaced between its markers, set off by blank lines, and the prose around it kept", () => {
    const after = replacePart(text, "a", "| new |\n");
    expect(after).toBe(`intro\n\n${beginOf("a")}\n\n| new |\n\n${endOf("a")}\n\nThe sentence ${beginOf("b")}old${endOf("b")} ends.\n`);
    expect(markedPart(after, "a")).toBe("| new |");
  });

  test("an inline part is replaced with nothing around it", () => {
    const after = replacePart(text, "b", "new", true);
    expect(after).toContain(`The sentence ${beginOf("b")}new${endOf("b")} ends.`);
    expect(markedPart(after, "b")).toBe("new");
  });

  test("a missing, doubled or unclosed marker is refused by name", () => {
    expect(() => replacePart(text, "c", "x")).toThrow("no <!-- c:begin -->");
    expect(() => replacePart(`${text}${beginOf("a")}`, "a", "x")).toThrow("twice");
    expect(() => replacePart(`${beginOf("d")} and nothing after`, "d", "x")).toThrow("no <!-- d:end -->");
  });

  test("every generated part is marked once, on the one page that holds it", () => {
    const names = Object.values(GENERATED_PARTS).flat();
    expect(new Set(names).size).toBe(names.length);
    for (const [page, text] of Object.entries(PAGES)) {
      for (const name of names) {
        const count = GENERATED_PARTS[page]!.includes(name) ? 2 : 1;
        expect(text.split(beginOf(name)), `${page}: ${name}`).toHaveLength(count);
        expect(text.split(endOf(name)), `${page}: ${name}`).toHaveLength(count);
      }
    }
  });
});

describe("npm run kpi:readme", () => {
  test.each(Object.keys(GENERATED_PARTS))("changes nothing on the committed %s and the files it was generated from", async (page) => {
    expect(await renderPage(page, PAGES[page]!, inputs)).toBe(PAGES[page]);
  });

  test("writes the same pages twice over", async () => {
    for (const [page, part] of [[README, "kpi:summary"], [README, "kpi:early-warning"], [README, "kpi:lifecycle"], [RESULTS, "kpi:current"], [RESULTS, "kpi:current-early-warning"], [RESULTS, "kpi:early-warning-tables"], [RESULTS, "kpi:lifecycle-full"], [GROUND_TRUTH, "truth:counts"]] as const) {
      const once = await renderPage(page, replacePart(PAGES[page]!, part, "| stale |"), inputs);
      expect(once).toBe(PAGES[page]);
      expect(await renderPage(page, once, inputs)).toBe(once);
    }
  });

  test("leaves the prose and the prospective score's summary as they are", async () => {
    const edited = PAGES[RESULTS]!.replace("## The headline\n\n", "## The headline\n\nA sentence added by hand.\n\n");
    const summary = replacePart(edited, "prospective:score", "A summary written by the score.", true);
    const after = await renderPage(RESULTS, summary, inputs);
    expect(after).toContain("A sentence added by hand.");
    expect(markedPart(after, "prospective:score")).toBe("A summary written by the score.");
  });

  test("refuses a page that holds no generated part", async () => {
    await expect(renderPage("CHANGELOG.md", "", inputs)).rejects.toThrow("holds no generated part");
  });
});

describe("the target sentences follow the numbers", () => {
  test("the held-out sentence says the target is not reached while it is not, and that it is once it is", () => {
    expect(targetSentence(withRates(inputs.latest, [0.74, 0.21], [0.63, 0.06]))).toBe("**It does not reach that target yet.**");
    expect(targetSentence(withRates(inputs.latest, [0.95, 0.21], [0.63, 0.06]))).toBe("**It does not reach that target yet.**");
    expect(targetSentence(withRates(inputs.latest, [0.9, 0.08], [0.63, 0.06]))).toBe("**It reaches that target on the held-out years.**");
  });

  test("the splits sentence names the splits that reach it", () => {
    expect(splitsSentence(withRates(inputs.latest, [0.74, 0.21], [0.63, 0.06]))).toBe("The target is not reached on either split.");
    expect(splitsSentence(withRates(inputs.latest, [0.92, 0.05], [0.63, 0.06]))).toBe("The target is reached on the held-out years, not on the training years.");
    expect(splitsSentence(withRates(inputs.latest, [0.5, 0.05], [0.91, 0.09]))).toBe("The target is reached on the training years, not on the held-out years.");
    expect(splitsSentence(withRates(inputs.latest, [0.92, 0.05], [0.91, 0.09]))).toBe("The target is reached on both splits.");
  });

  test("the pages written from an aggregate that meets the target say so, and no longer say it does not", async () => {
    const met = { ...inputs, latest: withRates(inputs.latest, [0.92, 0.05], [0.91, 0.09]) };
    const readme = await renderPage(README, PAGES[README]!, met);
    expect(readme).toContain("**It reaches that target on the held-out years.**");
    expect(readme).not.toContain("does not reach that target");
    expect(await renderPage(RESULTS, PAGES[RESULTS]!, met)).toContain("The target is reached on both splits.");
  });
});

describe("the medians in words", () => {
  test("weeks from two weeks, days from two days, hours below", () => {
    expect(inWords(41.7)).toBe("six weeks");
    expect(inWords(14)).toBe("two weeks");
    expect(inWords(9.8)).toBe("ten days");
    expect(inWords(1)).toBe("24 hours");
    expect(inWords(0.1117)).toBe("three hours");
    expect(inWords(1 / 24)).toBe("one hour");
    expect(inWords(0.01)).toBe("under an hour");
    expect(inWords(200)).toBe("29 weeks");
  });

  test("the sentences say how many confirmations came before each statement, the notice and the quarterly news, and how long after the first piece", () => {
    const latest = JSON.parse(JSON.stringify(inputs.latest)) as Latest;
    const c = latest.splits.validation.confirmedLine;
    c.withNotice = 0;
    c.beforeNotice = 0;
    c.leadNotice = null;
    c.withQuarterly = 17;
    c.beforeQuarterly = 17;
    c.leadQuarterly = { median: 41.7, tail: 9.8, count: 17 };
    c.lag = { median: 0.1117, tail: 4, count: 17 };
    expect(mediansSentence(latest)).toBe("No held-out confirmation has an agency notice dated to the day yet, so the lead over the first public notice is not measured on them. Every held-out confirmation with an issue of NASA's quarterly news came before that issue's month, and the median one by six weeks. The median confirmation came three hours after the catalogue published the first fresh piece.");
    c.withNotice = 5;
    c.beforeNotice = 1;
    c.leadNotice = { median: -1.2, tail: -3, count: 5 };
    expect(mediansSentence(latest)).toContain("1 of the 5 held-out confirmations with an agency notice dated to the day came before that notice, and the median one 29 hours after it.");
    c.beforeQuarterly = 12;
    c.leadQuarterly = { median: -3, tail: -20, count: 17 };
    expect(mediansSentence(latest)).toContain("12 of the 17 held-out confirmations with an issue of NASA's quarterly news came before that issue's month, and the median one three days after it.");
    c.leadNotice = null;
    c.withNotice = 0;
    c.leadQuarterly = null;
    c.withQuarterly = 0;
    c.lag = null;
    expect(mediansSentence(latest)).toBe("No held-out confirmation is timed yet.");
  });
});

describe("the rows kept out by the shape of their window", () => {
  test("are listed on the results page from 2005, each with its window and its reason", () => {
    const table = keptOutByWindowTable(readBreakups(inputs.file));
    expect(table.split("\n")[0]).toBe("| Event | Kind | Confidence | Window | Why it is kept out |");
    expect(table).toContain("| 13923:2011-01-01 NOAA 8 | anomalous | D | 2011-01-01 to 2014-01-01 | the window is wider than 93 days |");
    expect(table.split("\n")).toHaveLength(2 + 12);
  });
});
