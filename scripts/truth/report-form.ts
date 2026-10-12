import type { BreakupKind, Cause, Precision, SourceId, Statement } from "../../src/truth.ts";

/**
 * The breakup-report form (`.github/ISSUE_TEMPLATE/breakup-report.yml`)
 * read back from an issue's body. GitHub writes a filled form into the
 * body as one third-level heading per field, its label, with the value
 * below it and `_No response_` for an empty field; the watcher writes its
 * prefilled issues the same way, so a person can edit either before the
 * owner accepts it. A statement is made from the values as the hand file
 * writes one; `npm run truth:add` then checks it against the schema.
 */

/** The form's fields, by the id and label the template gives them, in its order. */
export const FORM_FIELDS = [
  { id: "source", label: "Source", required: true },
  { id: "published", label: "Published on", required: true },
  { id: "ref", label: "Reference", required: true },
  { id: "url", label: "Link", required: false },
  { id: "kind", label: "Kind", required: true },
  { id: "catalogue-number", label: "Catalogue number", required: false },
  { id: "designator", label: "International designator", required: false },
  { id: "name", label: "Name of the object", required: false },
  { id: "stated", label: "Time as stated", required: true },
  { id: "precision", label: "Precision of the time", required: true },
  { id: "at", label: "Instant", required: false },
  { id: "from", label: "Window start", required: false },
  { id: "to", label: "Window end", required: false },
  { id: "altitude", label: "Altitude (km)", required: false },
  { id: "apogee", label: "Apogee (km)", required: false },
  { id: "perigee", label: "Perigee (km)", required: false },
  { id: "inclination", label: "Inclination (degrees)", required: false },
  { id: "cause", label: "Cause", required: false },
  { id: "cause-stated", label: "Cause as stated", required: false },
  { id: "pieces", label: "Pieces catalogued", required: false },
  { id: "pieces-on", label: "Pieces counted on", required: false },
  { id: "note", label: "Note", required: false },
] as const;

export type FieldId = (typeof FORM_FIELDS)[number]["id"];

/** The form's values by field id; null where the field is empty. */
export type FormValues = Record<FieldId, string | null>;

const EMPTY = "_No response_";

/** The values of a form's body; a heading the form does not ask is ignored, a field the body lacks is empty. */
export function readForm(body: string): FormValues {
  const byLabel = new Map<string, string>();
  const sections = body.replace(/\r\n/g, "\n").split(/^### /m).slice(1);
  for (const section of sections) {
    const newline = section.indexOf("\n");
    const label = (newline === -1 ? section : section.slice(0, newline)).trim();
    if (!byLabel.has(label)) byLabel.set(label, newline === -1 ? "" : section.slice(newline + 1).trim());
  }
  return Object.fromEntries(
    FORM_FIELDS.map((field) => {
      const value = byLabel.get(field.label);
      return [field.id, value === undefined || value === "" || value === EMPTY ? null : value];
    }),
  ) as FormValues;
}

/** A form's body as GitHub writes it, the fields given filled in and every other one empty. */
export function formBody(values: Partial<Record<FieldId, string | null>>): string {
  return FORM_FIELDS.map((field) => `### ${field.label}\n\n${values[field.id] ?? EMPTY}`).join("\n\n");
}

const DAY_MS = 86_400_000;
const labelOf = (id: FieldId): string => FORM_FIELDS.find((field) => field.id === id)!.label;

/** An instant in the hand file's form, from an instant or a day in UTC. */
function instant(value: string, id: FieldId): string {
  const day = /^(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (day !== null) return `${day[1]}T00:00Z`;
  const time = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(?:Z|UTC)?$/.exec(value);
  if (time === null || Number.isNaN(Date.parse(`${time[1]}T${time[2]}Z`))) throw new Error(`${labelOf(id)}: "${value}" is not an instant like 2026-10-05T09:45Z, or a day like 2026-10-05`);
  return `${time[1]}T${time[2]}Z`;
}

function number(value: string | null, id: FieldId): number | null {
  if (value === null) return null;
  if (!/^-?\d+(?:\.\d+)?$/.test(value.replace(/,/g, ""))) throw new Error(`${labelOf(id)}: "${value}" is not a number`);
  return Number(value.replace(/,/g, ""));
}

/**
 * The statement a filled form states, as the hand file writes it. A time
 * stated to the day may give its window's start alone, the window then
 * that day; the day the report was published becomes its `statedOn`, a
 * month (`2026-12`) for a quarterly issue. A field it cannot read is named.
 */
export function statementFromForm(form: FormValues): Statement {
  for (const field of FORM_FIELDS) if (field.required && form[field.id] === null) throw new Error(`${field.label} is required`);
  const required = (id: FieldId): string => form[id]!;
  const ref = required("ref");
  const published = required("published");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(published);
  if (!day && !/^\d{4}-\d{2}$/.test(published)) throw new Error(`${labelOf("published")}: "${published}" is not a day like 2026-10-07 or a month like 2026-12`);
  const precision = required("precision") as Precision;
  const from = form.from === null ? null : instant(form.from, "from");
  let to = form.to === null ? null : instant(form.to, "to");
  if (to === null) {
    if (precision !== "day" || from === null || !from.endsWith("T00:00Z")) throw new Error(`${labelOf("to")} is required, unless the time is stated to the day and the window's start is that day`);
    to = new Date(Date.parse(from) + DAY_MS).toISOString().replace(":00.000Z", "Z");
  }
  const cause = form.cause === null || form.cause === "not stated" ? null : (form.cause as Cause);
  const piecesOn = form["pieces-on"];
  return {
    source: required("source") as SourceId,
    ref,
    ...(form.url === null ? {} : { url: form.url }),
    kind: required("kind") as BreakupKind,
    parent: { catalogueNumber: number(form["catalogue-number"], "catalogue-number"), designator: form.designator, name: form.name },
    event: { stated: required("stated"), at: form.at === null ? null : instant(form.at, "at"), from, to, precision },
    orbit: { altitudeKm: number(form.altitude, "altitude"), apogeeKm: number(form.apogee, "apogee"), perigeeKm: number(form.perigee, "perigee"), inclinationDeg: number(form.inclination, "inclination") },
    cause,
    causeStated: form["cause-stated"],
    piecesCatalogued: number(form.pieces, "pieces"),
    piecesStatedOn: piecesOn,
    preEventElements: null,
    note: form.note,
    statedOn: { on: day ? published : `${published}-01`, precision: day ? "day" : "month", ref },
  };
}
