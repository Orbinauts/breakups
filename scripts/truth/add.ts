import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readStatement, readStatements, TruthError, type SourceId, type Statement } from "../../src/truth.ts";
import { writeTruth } from "./build-truth.ts";
import { readForm, statementFromForm } from "./report-form.ts";
import { statedOnFromRef } from "./stated.ts";

/**
 * `npm run truth:add -- <statement.json>`, or `-- --form <body.md>` for a
 * filled breakup-report form: one statement a person read, checked
 * against the hand file's schema and appended to `data/truth/hand.json` in
 * the file's own layout, then the truth rebuilt (`data/breakups.json` and
 * `docs/truth.md`). It is the quick hand path for a report of a breakup:
 * the command a person runs, and the one the breakup-report workflow runs
 * on a form the owner accepted. A statement the build cannot take leaves
 * the hand file as it was. `--message <file>` writes the commit's message.
 *
 * `npm run truth:add -- --missing-from <hand.json> [--status <file>]`
 * appends every statement another file in the hand file's shape holds and
 * this one lacks, without rebuilding: the maintenance workflow appends so
 * the statements of the accepted reports, read again from their issues
 * (`npm run truth:report -- accepted`). `--status` writes `added` or
 * `held` (nothing to add).
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HAND_PATH = resolve(ROOT, "data/truth/hand.json");

type Fields = Record<string, unknown>;

/** The hand file as JSON holds it. */
export interface HandFile {
  about: string;
  statements: Fields[];
}

const inline = (value: unknown): string => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  const entries = Object.entries(value as Fields).map(([key, v]) => `${JSON.stringify(key)}: ${JSON.stringify(v)}`);
  return `{ ${entries.join(", ")} }`;
};

/** The fields a line of a statement carries together, in the file's order; any other field has a line of its own. */
const LINES: readonly (readonly string[])[] = [["source", "ref"], ["url"], ["kind"], ["parent"], ["event"], ["orbit"], ["cause", "causeStated"], ["piecesCatalogued", "piecesStatedOn"], ["preEventElements"], ["note"], ["statedOn"]];

/** One statement as the hand file lays it out: a line per group of fields, each object on one line. */
export function formatStatement(statement: Fields): string {
  const known = new Set(LINES.flat());
  const lines = [...LINES.map((group) => group.filter((key) => key in statement)), ...Object.keys(statement).filter((key) => !known.has(key)).map((key) => [key])]
    .filter((group) => group.length > 0)
    .map((group) => `      ${group.map((key) => `${JSON.stringify(key)}: ${inline(statement[key])}`).join(", ")}`);
  return `    {\n${lines.join(",\n")}\n    }`;
}

/** The whole hand file in its layout: the about line, then each statement. */
export function formatHandFile(file: HandFile): string {
  return `{\n  "about": ${JSON.stringify(file.about)},\n  "statements": [\n${file.statements.map(formatStatement).join(",\n")}\n  ]\n}\n`;
}

/** The order of a statement's fields in the hand file. */
const ORDER = ["source", "ref", "url", "kind", "parent", "event", "orbit", "cause", "causeStated", "piecesCatalogued", "piecesStatedOn", "preEventElements", "note", "statedOn"] as const;

/** The statement's fields in the file's order, a field left undefined dropped. */
const ordered = (statement: Fields): Fields =>
  Object.fromEntries([...ORDER.filter((key) => key in statement).map((key) => [key, statement[key]] as const), ...Object.entries(statement).filter(([key]) => !(ORDER as readonly string[]).includes(key))].filter(([, value]) => value !== undefined));

/** The sources the truth build reads from their own files: never typed into the hand file. */
const MACHINE_READ: ReadonlySet<SourceId> = new Set<SourceId>(["gcat", "hoosf-16e"]);
/** The sources whose statement is a report, which counts only where it is dated. */
const REPORTS: ReadonlySet<SourceId> = new Set<SourceId>(["news", "analyst", "odqn", "s4s-notice"]);

/** Why the hand file refuses a statement its schema accepts, or null where it takes it. */
export function refusal(statement: Statement, held: readonly Statement[]): string | null {
  if (MACHINE_READ.has(statement.source)) return `${statement.source} is read by the truth build itself, from its own file: a statement of it is never typed`;
  if (statement.source === "esa-ser") return "ESA's tables are typed apart, row by row as printed, into data/truth/esa-ser.json, and the build places each row: a row is never a statement of the hand file";
  const stated = statedOnFromRef(statement);
  if (REPORTS.has(statement.source) && stated === null) return "the report gives no day it was published (statedOn, or a day like 2026-10-08 in its reference): an undated report counts for nothing";
  const from = statement.event.from;
  if (stated !== null && from !== null) {
    const width = stated.precision === "month" ? 7 : 10;
    if (stated.on.slice(0, width) < from.slice(0, width)) return `the report is published on ${stated.on}, before the event it reports (from ${from})`;
  }
  const same = held.find((other) => other.source === statement.source && (other.ref === statement.ref || (statement.url !== undefined && other.url === statement.url && other.parent.catalogueNumber === statement.parent.catalogueNumber)));
  if (same !== undefined) return `the hand file already holds this statement (${same.source}, ${same.ref})`;
  return null;
}

const END = "\n  ]\n}\n";

/**
 * The hand file with one statement appended after the last, every line
 * before it left as it was; the statement is checked first, and the file
 * is refused where it does not end as the layout ends.
 */
export function addStatement(text: string, raw: unknown): { text: string; statement: Statement } {
  const file = JSON.parse(text) as HandFile;
  const fields = ordered(raw as Fields);
  const statement = readStatement(fields, "the statement");
  const refused = refusal(statement, readStatements(file.statements));
  if (refused !== null) throw new TruthError(refused);
  if (!text.endsWith(END)) throw new Error("the hand file does not end as its layout ends: add the statement by hand");
  const separator = file.statements.length === 0 ? "" : ",";
  return { text: `${text.slice(0, -END.length)}${separator}\n${formatStatement(fields)}${END}`, statement };
}

/**
 * The hand file with every statement of another file in its shape that it
 * lacks, appended in that file's order: how the accepted reports, read
 * again from their issues, are folded into main, whatever main took since
 * they were accepted. A statement it holds word for word is
 * passed over; one it holds in other words (the refusal of a statement
 * already held) is passed over and named in `held`; any other refusal
 * throws.
 */
export function addMissing(text: string, other: string): { text: string; added: Statement[]; held: string[] } {
  const key = (statement: Fields): string => JSON.stringify(ordered(statement));
  const present = new Set((JSON.parse(text) as HandFile).statements.map(key));
  const added: Statement[] = [];
  const held: string[] = [];
  let current = text;
  for (const raw of (JSON.parse(other) as HandFile).statements) {
    if (present.has(key(raw))) continue;
    try {
      const next = addStatement(current, raw);
      current = next.text;
      added.push(next.statement);
      present.add(key(raw));
    } catch (error) {
      if (!(error instanceof TruthError) || !error.message.includes("already holds")) throw error;
      held.push(error.message);
    }
  }
  return { text: current, added, held };
}

const SOURCE_WORDS: Partial<Record<SourceId, string>> = {
  news: "a news report",
  analyst: "an analyst's statement",
  "s4s-notice": "a U.S. Space Forces-Space notice",
  odqn: "an Orbital Debris Quarterly News report",
  catalogue: "the catalogue's listing",
};

/** The commit's title for a statement added: its source, its parent and the day it was published. */
export function addedTitle(statement: Statement): string {
  const { name, catalogueNumber, designator } = statement.parent;
  const parent = name !== null ? `${name}${catalogueNumber === null ? "" : ` (${catalogueNumber})`}` : catalogueNumber !== null ? String(catalogueNumber) : (designator ?? "an unnamed object");
  const stated = statedOnFromRef(statement);
  return `The ground truth holds ${SOURCE_WORDS[statement.source] ?? `a statement of ${statement.source}`} of ${parent}${stated === null ? "" : `, published ${stated.on}`}`;
}

function main(argv: readonly string[]): void {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const missingFrom = arg("--missing-from");
  if (missingFrom !== undefined) {
    const { text, added, held } = addMissing(readFileSync(HAND_PATH, "utf8"), readFileSync(missingFrom, "utf8"));
    writeFileSync(HAND_PATH, text);
    for (const statement of added) console.log(`added: ${addedTitle(statement)}`);
    for (const reason of held) console.log(`passed over: ${reason}`);
    if (added.length === 0) console.log(`the hand file holds every statement of ${missingFrom}`);
    const status = arg("--status");
    if (status !== undefined) writeFileSync(status, added.length === 0 ? "held\n" : "added\n");
    return;
  }
  const form = arg("--form");
  const path = form ?? argv.find((a, i) => !a.startsWith("--") && !["--form", "--message"].includes(argv[i - 1] ?? ""));
  if (path === undefined) throw new Error("usage: npm run truth:add -- <statement.json> | --form <body.md> [--message <file>] | --missing-from <hand.json> [--status <file>]");
  const raw: unknown = form !== undefined ? statementFromForm(readForm(readFileSync(form, "utf8"))) : JSON.parse(readFileSync(path, "utf8"));
  const before = readFileSync(HAND_PATH, "utf8");
  const { text, statement } = addStatement(before, raw);
  writeFileSync(HAND_PATH, text);
  let built: ReturnType<typeof writeTruth>;
  try {
    built = writeTruth();
  } catch (error) {
    writeFileSync(HAND_PATH, before);
    throw new Error(`the truth cannot be built with the statement, so the hand file is left as it was: ${(error as Error).message}`);
  }
  const event = built.file.breakups.find((b) => b.statements.some((s) => s.source === statement.source && s.ref === statement.ref));
  const title = addedTitle(statement);
  const where = event === undefined ? "in no event" : `in the event ${event.id} (${event.statements.length === 1 ? "a new event" : `with ${event.statements.length - 1} other statement${event.statements.length === 2 ? "" : "s"}`})`;
  console.log(`${title}: ${where}`);
  console.log(built.line);
  const message = arg("--message");
  if (message !== undefined) writeFileSync(message, `${title}\n\nThe statement lands ${where}. The diff of docs/truth.md says what it changed.\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
