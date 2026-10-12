import type { Breakup, BreakupsFile, FirstStatement, SourceId, Statement } from "../../src/truth.ts";
import { AGENCY_SOURCES, firstAgencyStatement, yearOf } from "../../src/truth.ts";
import { AT_LAUNCH_DAYS, SAME_SEPARATION_DAYS, isSatcatStatement, type Skipped } from "./parse-gcat-satcat.ts";

/**
 * The report a reviewer reads beside the generated truth: what was built
 * from what, counts per year, source and kind, every conflict between
 * sources and how it resolved, the rows kept out of scoring and why, and
 * every override applied. Generated with the file; never edited by hand.
 */

const SCORING_FROM = 2005;

function table(headers: string[], rows: (string | number)[][]): string {
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");
}

const count = <T>(items: T[], by: (item: T) => string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(by(item), (counts.get(by(item)) ?? 0) + 1);
  return counts;
};

const SOURCES: SourceId[] = ["hoosf-16e", "odqn", "gcat", "esa-ser", "s4s-notice", "analyst", "news", "catalogue"];

function duplicates(breakups: Breakup[]): (string | number)[][] {
  const rows: (string | number)[][] = [];
  const byParent = new Map<number, Breakup[]>();
  for (const b of breakups) if (b.parent.catalogueNumber !== null) byParent.set(b.parent.catalogueNumber, [...(byParent.get(b.parent.catalogueNumber) ?? []), b]);
  for (const events of byParent.values()) {
    for (let i = 0; i + 1 < events.length; i++) {
      const [a, b] = [events[i]!, events[i + 1]!];
      const days = Math.round((Date.parse(b.event.from ?? b.event.to) - Date.parse(a.event.to)) / 86_400_000);
      if (days <= 365) rows.push([`${a.id} ${a.parent.name} (${a.statements.map((s) => s.source).join(", ")})`, `${b.id} ${b.parent.name} (${b.statements.map((s) => s.source).join(", ")})`, days]);
    }
  }
  return rows;
}

const statedCell = (first: FirstStatement | null): string => (first === null ? "" : `${first.on} (${first.source}, ${first.precision})`);

/** The first-statement section: how many scoreable events from the scoring span have a dated first statement, by its source and how finely it is dated, and how many an agency's. */
function firstStatements(scoreable: Breakup[]): string[] {
  const headline = (b: Breakup): boolean => b.kind === "breakup" && (b.confidence === "A" || b.confidence === "B");
  const rows: (string | number)[][] = SOURCES.map((source) => {
    const firsts = scoreable.filter((b) => b.firstStatement?.source === source);
    return [source, AGENCY_SOURCES.includes(source) ? "yes" : "no", firsts.length, firsts.filter(headline).length, firsts.filter((b) => b.firstStatement!.precision === "day").length, firsts.filter((b) => b.firstStatement!.precision === "month").length];
  }).filter((row) => (row[2] as number) > 0);
  const none = scoreable.filter((b) => b.firstStatement === null);
  rows.push(["none dated", "", none.length, none.filter(headline).length, "", ""]);
  const agency = scoreable.filter((b) => firstAgencyStatement(b) !== null);
  return [
    "## First statements",
    "",
    "When each event was first stated in public, as far as the sources date it: NASA's history by the quarterly news issues its reference documents cite (an issue is dated to its month, and the first day of the month, or the event's own day where the issue is of the event's month, is the earliest it can have been public; an issue dated before the event is not its statement), the quarterly news typed by hand by the issue its reference names, a U.S. Space Forces-Space notice by the day it was seen, ESA's report by its date, an analyst's dating or a company's or a newspaper's post by its day. GCAT's table and the catalogue carry no publication date. The first statement is the earliest of an event's dated statements, whoever made it; the scorecard reads the lead of a confirmation against the first statement by an agency (NASA, U.S. Space Forces-Space, ESA), which the source column marks.",
    "",
    table(["Source of the first statement", "An agency", "Scoreable events from 2005", "Of which breakups, confidence A and B", "Dated to the day", "Dated to the month"], rows),
    "",
    `Of the ${scoreable.length} scoreable events from ${SCORING_FROM}, ${scoreable.length - none.length} have a dated first statement and ${agency.length} a dated statement by an agency; of the ${scoreable.filter(headline).length} breakups of confidence A and B, ${scoreable.filter(headline).filter((b) => firstAgencyStatement(b) !== null).length} have an agency's.`,
    "",
  ];
}

/**
 * The satellite catalogue's section: its rule and constants, what it left
 * out, and per year from the scoring span the events it alone states, by
 * kind, and the events of other sources it joined.
 */
function satcatSection(breakups: Breakup[], statements: Statement[], skipped: Skipped | undefined): string[] {
  const satcat = statements.filter(isSatcatStatement);
  if (satcat.length === 0) return [];
  const alone = (b: Breakup): boolean => b.statements.every((s) => isSatcatStatement(s) || s.source === "catalogue") && b.statements.some(isSatcatStatement);
  const joined = (b: Breakup): boolean => !alone(b) && b.statements.some(isSatcatStatement);
  const scoring = breakups.filter((b) => yearOf(b) >= SCORING_FROM);
  const years = [...new Set(scoring.filter((b) => b.statements.some(isSatcatStatement)).map(yearOf))].sort();
  const kinds = ["breakup", "anomalous", "aerodynamic", "release"] as const;
  const rows: (string | number)[][] = years.map((year) => {
    const inYear = scoring.filter((b) => yearOf(b) === year);
    const own = inYear.filter(alone);
    return [year, ...kinds.map((k) => own.filter((b) => b.kind === k).length), own.filter((b) => b.scoreable).length, own.filter((b) => b.scoreable && b.statements.some((s) => s.source === "catalogue")).length, inYear.filter(joined).length];
  });
  const total = (i: number): number => rows.reduce((sum, row) => sum + (row[i] as number), 0);
  rows.push(["All", ...kinds.map((_, i) => total(i + 1)), total(5), total(6), total(7)]);
  const conflicted = scoring.filter(joined).filter((b) => b.conflicts.some((c) => c.detail.includes("gcat")));
  return [
    "## GCAT's satellite catalogue",
    "",
    `Read uniformly, for every object and every year, with no regard to the detector (\`scripts/truth/parse-gcat-satcat.ts\`). A piece is a row typed as a component (\`C\`) or fragmentation debris (\`D\`) whose parent is a standard-catalogue object (\`S\`) or an auxiliary-catalogue one (\`A\`, keyed by its launch) and whose separation date is stated. Its kind is its SatType's: fragmentation debris is a breakup, anomalous debris (subtype \`J\`) an anomalous event, an aerodynamic breakup (\`Q\`) aerodynamic, slag (\`K\`), coolant (\`N\`), debris released at orbit insertion (\`O\`) and every other component a release. A release separated by the end of the ${AT_LAUNCH_DAYS === 1 ? "day" : `${AT_LAUNCH_DAYS} days`} after its launch day is the launch's own staging and makes no statement; a separation dated before its parent's launch is a slip and makes none. The pieces of one parent whose separation windows lie within ${SAME_SEPARATION_DAYS} days of each other (GCAT's own \`?\` on a day) are one separation and one statement, dated as GCAT dates most of them, its kind the first of breakup, anomalous, aerodynamic and release among them. The statements then join the other sources' events by the build's rule (same parent, windows within thirty days, \`SAME_EVENT_DAYS\`, never two separations it dates more than a day apart, each joining the instant nearest it); where another source states the event, that source's instant, kind, orbit, cause and count stand, and the satellite catalogue's are kept beside them. An event it alone states is of confidence C where GCAT dates it to the month or finer, D where to a year.`,
    "",
    `${statements.filter(isSatcatStatement).length} statements${skipped === undefined ? "" : `; left out: ${skipped.releasedAtLaunch} releases at launch, ${skipped.separatedBeforeLaunch} separations dated before the parent's launch, ${skipped.parentNotACatalogueObject} pieces whose parent is not a catalogue object, ${skipped.noSeparationDate} with no separation date (and ${skipped.notAPiece} parent rows, kept to name the parents)`}.`,
    "",
    `Columns, from ${SCORING_FROM}: the events the satellite catalogue alone states (with the catalogue's bursts at most), by kind; how many of them are scoreable, and of those how many absorbed a burst the catalogue alone had reported; and the events of other sources it joined.`,
    "",
    table(["Year", "Breakup", "Anomalous", "Aerodynamic", "Release", "Scoreable", "Of which with a burst", "Joined"], rows),
    "",
    `Of the events it joined from ${SCORING_FROM}, ${conflicted.length} disagree with it on the day, the cause or the parent; each is in the conflicts above.`,
    "",
  ];
}

export function renderReport(file: BreakupsFile, statements: Statement[], skipped?: Skipped): string {
  const breakups = file.breakups;
  const scoring = breakups.filter((b) => yearOf(b) >= SCORING_FROM);
  const years = [...new Set(scoring.map(yearOf))].sort();
  const perYear = years.map((year) => {
    const inYear = scoring.filter((b) => yearOf(b) === year);
    const kinds = count(inYear, (b) => b.kind);
    const sources = count(inYear, (b) => b.resolvedFrom.event);
    return [year, inYear.length, inYear.filter((b) => b.scoreable).length, kinds.get("breakup") ?? 0, kinds.get("anomalous") ?? 0, kinds.get("aerodynamic") ?? 0, kinds.get("release") ?? 0, kinds.get("unnamed") ?? 0, ...SOURCES.map((s) => sources.get(s) ?? 0)];
  });
  const confidences = count(scoring.filter((b) => b.scoreable), (b) => b.confidence);
  const regimes = count(scoring.filter((b) => b.scoreable), (b) => b.orbit.regime);
  const classes = count(scoring.filter((b) => b.scoreable), (b) => b.parent.class);
  const conflicts = breakups.filter((b) => b.conflicts.length > 0 && yearOf(b) >= SCORING_FROM);
  const exempt = scoring.filter((b) => !b.scoreable);
  const overridden = breakups.filter((b) => b.overrides.length > 0);
  const line = (b: Breakup): string => `${b.id} ${b.parent.name}`;
  const sections = [
    "# The ground truth, as built",
    "",
    `Generated by \`npm run truth\` from ${statements.length} statements (${SOURCES.map((s) => `${s}: ${statements.filter((x) => x.source === s).length}`).join(", ")}) into ${breakups.length} events, ${scoring.length} of them from ${SCORING_FROM} on, the span the scorecard runs over. A reviewer who disagrees with a row edits \`data/truth/overrides.json\` or \`data/truth/hand.json\` and rebuilds; \`data/breakups.json\` is never edited by hand.`,
    "",
    "## Sources",
    "",
    table(["Source", "Citation", "Licence", "Version"], SOURCES.filter((s) => file.sources[s] !== undefined).map((s) => [s, file.sources[s]!.citation, file.sources[s]!.licence, file.sources[s]!.version])),
    "",
    `## Events per year from ${SCORING_FROM}`,
    "",
    "Columns: every event, the scoreable ones, then by kind, then by the source whose statement of the time won.",
    "",
    table(["Year", "Events", "Scoreable", "Breakup", "Anomalous", "Aerodynamic", "Release", "Unnamed", ...SOURCES], perYear),
    "",
    `Scoreable events from ${SCORING_FROM}: ${scoring.filter((b) => b.scoreable).length}. By confidence: ${["A", "B", "C", "D"].map((c) => `${c} ${confidences.get(c) ?? 0}`).join(", ")}. By regime: ${[...regimes].map(([r, n]) => `${r} ${n}`).join(", ")}. By class: ${[...classes].map(([c, n]) => `${c} ${n}`).join(", ")}.`,
    "",
    "## Conflicts between sources",
    "",
    "Each disagreement among the statements of one event, and the source whose value stands (the resolved-from column).",
    "",
    conflicts.length === 0 ? "None." : table(["Event", "Field", "Disagreement", "Resolved from"], conflicts.flatMap((b) => b.conflicts.map((c) => [line(b), c.field, c.detail, c.field === "event" || c.field === "day" ? b.resolvedFrom.event : c.field === "cause" ? (b.resolvedFrom.cause ?? "none") : c.field === "kind" ? b.resolvedFrom.kind : b.parent.catalogueNumber ?? "none"]))),
    "",
    ...firstStatements(scoring.filter((b) => b.scoreable)),
    ...satcatSection(breakups, statements, skipped),
    "## Possible duplicates",
    "",
    "Events of one parent within a year of each other that no statement joins: a second event, or one event two sources date months apart. A reviewer merges the latter with an override.",
    "",
    duplicates(breakups).length === 0 ? "None." : table(["Event", "And", "Days apart"], duplicates(breakups)),
    "",
    "## Events the catalogue alone reports",
    "",
    "Bursts of new debris under a launch that no agency wrote up and no earlier reported event of the launch accounts for within three years: real breakups nobody reported, or late cataloguing of an old cloud. Confidence D; a reviewer exempts or merges one with an override.",
    "",
    table(["Event", "Pieces", "First piece's set", "Parent"], breakups.filter((b) => b.statements.every((s) => s.source === "catalogue") && yearOf(b) >= SCORING_FROM).map((b) => [line(b), b.piecesCatalogued ?? "", b.event.to.slice(0, 10), b.parent.catalogueNumber ?? "launch only"])),
    "",
    "## Kept out of scoring",
    "",
    exempt.length === 0 ? "None." : table(["Event", "Kind", "Why"], exempt.map((b) => [line(b), b.kind, b.exemptReason ?? ""])),
    "",
    "## Overrides applied",
    "",
    overridden.length === 0 ? "None." : table(["Event", "Overrides"], overridden.map((b) => [line(b), b.overrides.join(", ")])),
    "",
    `## Every scoreable event from ${SCORING_FROM}`,
    "",
    table(["Event", "Kind", "Time", "Precision", "Confidence", "Regime", "Class", "Cause", "Pieces", "Sources", "First statement", "First agency statement"], scoring.filter((b) => b.scoreable).map((b) => [line(b), b.kind, b.event.at ?? `${b.event.from ?? "…"} to ${b.event.to}`, b.event.precision, b.confidence, b.orbit.regime, b.parent.class, b.cause, b.piecesCatalogued ?? "", b.statements.map((s) => s.source).join(", "), statedCell(b.firstStatement), statedCell(firstAgencyStatement(b))])),
    "",
  ];
  return sections.join("\n");
}
