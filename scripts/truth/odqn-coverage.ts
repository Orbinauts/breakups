/**
 * What has been read of NASA's Orbital Debris Quarterly News since 26(3),
 * the first issue after the 16th edition of NASA's history closed on
 * 1 May 2022: each issue either cited by a statement of the hand file, or
 * read and found to report no fragmentation, or never published, or not
 * read. The list is `data/truth/odqn-coverage.json`, typed by hand from the
 * issues themselves; the check here makes a quiet year a verified one by
 * refusing a list with a hole in it or one that disagrees with the hand
 * file's citations.
 */

/** How an issue stands: a statement of the hand file cites it; it was read and reports no breakup; it never came out (a combined issue took its number); or it could not be read. */
export type CoverageStatus = "cited" | "no breakup items" | "not published" | "unread";

export interface CoverageIssue {
  /** The issue as NASA numbers it, `26(3)`, or a combined one, `30(1 & 2)`. */
  issue: string;
  /** Its month and year as printed on it. */
  date: string;
  /** Where it was read. */
  url: string;
  status: CoverageStatus;
  /** Its fragmentation articles, title and page, and the parents they name; none for a quiet issue. */
  items: string[];
  note?: string;
}

export interface OdqnCoverage {
  issues: CoverageIssue[];
}

/** The first issue after NASA's history's cut-off: the list starts here. */
export const FIRST_ISSUE = "26(3)";
/** Issues a volume runs to. */
const PER_VOLUME = 4;

interface Numbered {
  volume: number;
  numbers: number[];
}

function numbered(label: string): Numbered {
  const m = /^(\d+)\((\d+)(?: & (\d+))?\)$/.exec(label);
  if (m === null) throw new Error(`"${label}" is not an issue as NASA numbers it, like 26(3) or 30(1 & 2)`);
  return { volume: Number(m[1]), numbers: m[3] === undefined ? [Number(m[2])] : [Number(m[2]), Number(m[3])] };
}

const next = (n: Numbered): string => {
  const last = n.numbers[n.numbers.length - 1]!;
  return last >= PER_VOLUME ? `${n.volume + 1}(1)` : `${n.volume}(${last + 1})`;
};
const first = (n: Numbered): string => `${n.volume}(${n.numbers[0]})`;

/** Every issue a statement's reference cites (`ODQN 27(1), March 2023, pp. 1-2; ODQN 28(4), ...`), as NASA numbers it. */
export function citedIssues(ref: string): string[] {
  return [...ref.matchAll(/ODQN (\d+\(\d+(?: & \d+)?\))/g)].map((m) => m[1]!);
}

/**
 * What is wrong with the coverage list against the hand file's
 * statements: a list not starting at 26(3), a hole between two issues, an
 * issue cited by the hand file that the list does not show as cited, and
 * one the list shows as cited that the hand file cites nowhere. Empty
 * when the list is whole and agrees.
 */
export function coverageProblems(coverage: OdqnCoverage, statements: readonly { source: string; ref: string }[]): string[] {
  const problems: string[] = [];
  const issues = coverage.issues;
  if (issues.length > 0 && first(numbered(issues[0]!.issue)) !== FIRST_ISSUE) problems.push(`the list starts at ${issues[0]!.issue}, not ${FIRST_ISSUE}`);
  for (let i = 1; i < issues.length; i++) {
    const expected = next(numbered(issues[i - 1]!.issue));
    if (first(numbered(issues[i]!.issue)) !== expected) problems.push(`a gap: ${expected} is expected after ${issues[i - 1]!.issue}, ${issues[i]!.issue} comes`);
  }
  const cited = new Set(statements.filter((s) => s.source === "odqn").flatMap((s) => citedIssues(s.ref)));
  const listed = new Map(issues.map((issue) => [issue.issue, issue]));
  for (const label of [...cited].sort(byIssue)) {
    const entry = listed.get(label);
    if (entry === undefined) problems.push(`${label} is cited by the hand file but not listed`);
    else if (entry.status !== "cited") problems.push(`${label} is cited by the hand file but listed as ${entry.status}`);
  }
  for (const entry of issues) if (entry.status === "cited" && !cited.has(entry.issue)) problems.push(`${entry.issue} is listed as cited but the hand file cites it nowhere`);
  return problems.sort((a, b) => issueIn(a).localeCompare(issueIn(b)) || a.localeCompare(b));
}

function byIssue(a: string, b: string): number {
  const [x, y] = [numbered(a), numbered(b)];
  return x.volume - y.volume || x.numbers[0]! - y.numbers[0]!;
}

/** The issue a problem is about, zero-padded so problems sort by issue. */
function issueIn(problem: string): string {
  const m = /(\d+)\((\d+)/.exec(problem.replace(/^a gap: /, ""));
  return m === null ? "" : `${m[1]!.padStart(3, "0")}(${m[2]!.padStart(2, "0")}`;
}
