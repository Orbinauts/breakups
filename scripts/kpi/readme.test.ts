import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { Latest } from "./kpi.ts";
import { beginOf, endOf, markedPart, readInputs, renderReadme, replacePart, splitsSentence, targetSentence } from "./readme.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const README = readFileSync(join(ROOT, "README.md"), "utf8");
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

describe("the README's markers", () => {
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

  test("every generated part of the README is marked once", () => {
    for (const name of ["kpi:current", "kpi:target", "kpi:splits", "kpi:confirmed", "kpi:parent-step", "truth:counts", "truth:gcat-clouds", "truth:quick-start", "prospective:score"]) {
      expect(README.split(beginOf(name))).toHaveLength(2);
      expect(README.split(endOf(name))).toHaveLength(2);
    }
  });
});

describe("npm run kpi:readme", () => {
  test("changes nothing on the committed README and the files it was generated from", async () => {
    expect(await renderReadme(README, inputs)).toBe(README);
  });

  test("writes the same README twice over", async () => {
    const stale = replacePart(replacePart(README, "kpi:current", "| stale |"), "truth:counts", "| stale |");
    const once = await renderReadme(stale, inputs);
    expect(once).toBe(README);
    expect(await renderReadme(once, inputs)).toBe(once);
  });

  test("leaves the prose and the prospective score's summary as they are", async () => {
    const edited = README.replace("## How it works\n\n", "## How it works\n\nA sentence added by hand.\n\n");
    const summary = replacePart(edited, "prospective:score", "A summary written by the score.", true);
    const after = await renderReadme(summary, inputs);
    expect(after).toContain("A sentence added by hand.");
    expect(markedPart(after, "prospective:score")).toBe("A summary written by the score.");
  });
});

describe("the target sentences follow the numbers", () => {
  test("the held-out sentence says the target is not reached while it is not, and that it is once it is", () => {
    expect(targetSentence(withRates(inputs.latest, [0.74, 0.21], [0.63, 0.06]))).toBe("**It does not reach that target on the held-out years.**");
    expect(targetSentence(withRates(inputs.latest, [0.95, 0.21], [0.63, 0.06]))).toBe("**It does not reach that target on the held-out years.**");
    expect(targetSentence(withRates(inputs.latest, [0.9, 0.08], [0.63, 0.06]))).toBe("**It reaches that target on the held-out years.**");
  });

  test("the splits sentence names the splits that reach it", () => {
    expect(splitsSentence(withRates(inputs.latest, [0.74, 0.21], [0.63, 0.06]))).toBe("The target is not reached on either split.");
    expect(splitsSentence(withRates(inputs.latest, [0.92, 0.05], [0.63, 0.06]))).toBe("The target is reached on the held-out years, not on the training years.");
    expect(splitsSentence(withRates(inputs.latest, [0.5, 0.05], [0.91, 0.09]))).toBe("The target is reached on the training years, not on the held-out years.");
    expect(splitsSentence(withRates(inputs.latest, [0.92, 0.05], [0.91, 0.09]))).toBe("The target is reached on both splits.");
  });

  test("the README written from an aggregate that meets the target says so, and no longer says it does not", async () => {
    const met = await renderReadme(README, { ...inputs, latest: withRates(inputs.latest, [0.92, 0.05], [0.91, 0.09]) });
    expect(met).toContain("**It reaches that target on the held-out years.**");
    expect(met).not.toContain("does not reach that target");
    expect(met).toContain("The target is reached on both splits.");
  });
});
