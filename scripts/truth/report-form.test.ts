import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { BREAKUP_KINDS, CAUSES, PRECISIONS, readStatement } from "../../src/truth.ts";
import { FORM_FIELDS, formBody, readForm, statementFromForm } from "./report-form.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface FormItem {
  type: string;
  id?: string;
  attributes: { label?: string; options?: string[] };
  validations?: { required?: boolean };
}

const template = parse(readFileSync(resolve(ROOT, ".github/ISSUE_TEMPLATE/breakup-report.yml"), "utf8")) as { labels: string[]; body: FormItem[] };
const fields = template.body.filter((item) => item.type !== "markdown");

/** A filled form as GitHub writes it into the issue's body: each label a third-level heading, an empty field "_No response_". */
const FILLED = `### Source

analyst

### Published on

2026-10-07

### Reference

Jim Shell's dating from public elements, as reported by EarthSky on 2026-10-07 (https://earthsky.org/space/another-satellite-breakup-meteor-2-7-oct-5-2026/)

### Link

https://earthsky.org/space/another-satellite-breakup-meteor-2-7-oct-5-2026/

### Kind

breakup

### Catalogue number

12456

### International designator

1981-043A

### Name of the object

Meteor 2-7 (second event)

### Time as stated

5 October 2026, about 09:45 UTC, plus or minus 10 minutes

### Precision of the time

minute

### Instant

2026-10-05T09:45Z

### Window start

2026-10-05T09:35Z

### Window end

2026-10-05T09:55Z

### Altitude (km)

855

### Apogee (km)

_No response_

### Perigee (km)

_No response_

### Inclination (degrees)

_No response_

### Cause

unknown

### Cause as stated

unconfirmed; an internal pressure or battery failure, or an unrecorded collision

### Pieces catalogued

_No response_

### Pieces counted on

_No response_

### Note

LeoLabs reported a debris-generating event with an estimated tens of fragments.`;

describe("the breakup-report form", () => {
  test("is labelled breakup-report, so the watcher's issues and a person's are read alike", () => {
    expect(template.labels).toEqual(["breakup-report"]);
  });

  test("asks for the fields the reader reads, by the same labels, in the same order", () => {
    expect(fields.map((item) => [item.id, item.attributes.label])).toEqual(FORM_FIELDS.map((field) => [field.id, field.label]));
  });

  test("offers the hand file's own values in its lists", () => {
    const options = (id: string) => fields.find((item) => item.id === id)!.attributes.options;
    expect(options("source")).toEqual(["news", "analyst", "s4s-notice", "odqn", "esa-ser"]);
    expect(options("kind")).toEqual([...BREAKUP_KINDS]);
    expect(options("precision")).toEqual([...PRECISIONS]);
    expect(options("cause")).toEqual(["not stated", ...CAUSES]);
  });
});

describe("reading a filled form", () => {
  test("gives the statement the hand file holds for the same report", () => {
    expect(statementFromForm(readForm(FILLED))).toEqual({
      source: "analyst",
      ref: "Jim Shell's dating from public elements, as reported by EarthSky on 2026-10-07 (https://earthsky.org/space/another-satellite-breakup-meteor-2-7-oct-5-2026/)",
      url: "https://earthsky.org/space/another-satellite-breakup-meteor-2-7-oct-5-2026/",
      kind: "breakup",
      parent: { catalogueNumber: 12456, designator: "1981-043A", name: "Meteor 2-7 (second event)" },
      event: { stated: "5 October 2026, about 09:45 UTC, plus or minus 10 minutes", at: "2026-10-05T09:45Z", from: "2026-10-05T09:35Z", to: "2026-10-05T09:55Z", precision: "minute" },
      orbit: { altitudeKm: 855, apogeeKm: null, perigeeKm: null, inclinationDeg: null },
      cause: "unknown",
      causeStated: "unconfirmed; an internal pressure or battery failure, or an unrecorded collision",
      piecesCatalogued: null,
      piecesStatedOn: null,
      preEventElements: null,
      note: "LeoLabs reported a debris-generating event with an estimated tens of fragments.",
      statedOn: { on: "2026-10-07", precision: "day", ref: "Jim Shell's dating from public elements, as reported by EarthSky on 2026-10-07 (https://earthsky.org/space/another-satellite-breakup-meteor-2-7-oct-5-2026/)" },
    });
  });

  test("reads a day's window from its start alone, and a quarterly issue's month", () => {
    const form = readForm(FILLED.replace("minute\n", "day\n").replace("2026-10-05T09:45Z", "_No response_").replace("2026-10-05T09:35Z", "2026-10-05").replace("2026-10-05T09:55Z", "_No response_").replace("### Published on\n\n2026-10-07", "### Published on\n\n2026-10"));
    const statement = statementFromForm(form);
    expect(statement.event).toEqual({ stated: "5 October 2026, about 09:45 UTC, plus or minus 10 minutes", at: null, from: "2026-10-05T00:00Z", to: "2026-10-06T00:00Z", precision: "day" });
    expect(statement.statedOn).toMatchObject({ on: "2026-10-01", precision: "month" });
  });

  test("reads a cause not stated, and an empty link, as nothing", () => {
    const statement = statementFromForm(readForm(FILLED.replace("### Cause\n\nunknown", "### Cause\n\nnot stated").replace(/### Link\n\n\S+/, "### Link\n\n_No response_")));
    expect(statement.cause).toBeNull();
    expect("url" in statement).toBe(false);
  });

  test("names the field it cannot read", () => {
    expect(() => statementFromForm(readForm(FILLED.replace("### Altitude (km)\n\n855", "### Altitude (km)\n\nabout 855")))).toThrow(/Altitude \(km\): "about 855" is not a number/);
    expect(() => statementFromForm(readForm(FILLED.replace("2026-10-05T09:35Z", "yesterday")))).toThrow(/Window start: "yesterday" is not an instant/);
    expect(() => statementFromForm(readForm(FILLED.replace("### Reference\n\nJim", "### Reference\n\n_No response_\n\nJim").replace(/### Reference\n\n[^#]*/, "### Reference\n\n_No response_\n\n")))).toThrow(/Reference is required/);
  });

  test("ignores sections the form does not ask, such as a watcher's notes below the fields", () => {
    const statement = statementFromForm(readForm(`${FILLED}\n\n### What the watcher read\n\nThe notice's page.\n\n<!-- watch-key: x -->`));
    expect(statement.note).toBe("LeoLabs reported a debris-generating event with an estimated tens of fragments.");
  });
});

describe("a prefilled form", () => {
  test("reads back as the values it was filled with, every field left empty read as empty", () => {
    const values = { source: "odqn", published: "2026-12", ref: "ODQN 30(4), December 2026", url: "https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/ODQNv30i4.pdf" };
    const form = readForm(formBody(values));
    expect(form).toEqual(Object.fromEntries(FORM_FIELDS.map((field) => [field.id, (values as Record<string, string>)[field.id] ?? null])));
  });

  test("filled in full is a statement the hand file's schema accepts", () => {
    const statement = statementFromForm(readForm(formBody(readForm(FILLED) as Record<string, string>)));
    expect(() => readStatement(statement, "the form")).not.toThrow();
  });
});
