import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { archiveHome } from "./archive.ts";
import { fetchText } from "./fetch.ts";
import { EARLIEST_YEAR } from "./years.ts";

/**
 * The space-weather indices the detector may be handed: GFZ Potsdam's Kp,
 * ap, Ap, sunspot number and F10.7 (one file since 1932, CC BY 4.0) and
 * NASA's OMNI2 hourly Dst (one file a year). Fetched by hand into the
 * Archive's `space/` as served and read into one compact JSON per year;
 * `npm run archive:space -- [from] [to]`.
 */

export const GFZ_URL = "https://kp.gfz.de/app/files/Kp_ap_Ap_SN_F107_since_1932.txt";
export const OMNI_URL = (year: number): string => `https://spdf.gsfc.nasa.gov/pub/data/omni/low_res_omni/omni2_${year}.dat`;

export const spaceDir = (archive: string): string => join(archive, "space");

/** One day's indices. */
export interface SpaceDay {
  /** `YYYY-MM-DD`. */
  day: string;
  /** The eight three-hourly Kp values, 0 to 9 in thirds. */
  kp: number[];
  /** The eight three-hourly ap values. */
  ap: number[];
  /** The daily Ap. */
  Ap: number;
  /** The observed and the adjusted 10.7 cm flux; null where not yet measured. */
  f107: number | null;
  f107Adjusted: number | null;
  /** 24 hourly Dst values in nT, or null where OMNI has none. */
  dst: (number | null)[] | null;
  /** Whether the day's Kp is definitive, as GFZ marks it. */
  definitive: boolean;
}

/** GFZ's file: one line per day, the columns its header lists. */
export function parseGfz(text: string): Map<string, Omit<SpaceDay, "dst">> {
  const days = new Map<string, Omit<SpaceDay, "dst">>();
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || line.trim() === "") continue;
    const f = line.trim().split(/\s+/);
    // YYYY MM DD days days_m Bsr dB Kp1..Kp8 ap1..ap8 Ap SN F10.7obs F10.7adj D
    if (f.length < 28) continue;
    const day = `${f[0]}-${f[1]}-${f[2]}`;
    const kp = f.slice(7, 15).map(Number);
    const ap = f.slice(15, 23).map(Number);
    const flux = (s: string | undefined): number | null => (s === undefined || Number(s) < 0 ? null : Number(s));
    days.set(day, { day, kp, ap, Ap: Number(f[23]), f107: flux(f[25]), f107Adjusted: flux(f[26]), definitive: f[27] === "2" });
  }
  return days;
}

/** OMNI2's yearly file: one line an hour, Dst in the 41st column, 99999 for none. */
export function parseOmniDst(text: string): Map<string, (number | null)[]> {
  const days = new Map<string, (number | null)[]>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const f = line.trim().split(/\s+/);
    const year = Number(f[0]);
    const doy = Number(f[1]);
    const hour = Number(f[2]);
    const dst = Number(f[40]);
    const day = new Date(Date.UTC(year, 0, doy)).toISOString().slice(0, 10);
    const hours = days.get(day) ?? Array.from({ length: 24 }, () => null);
    hours[hour] = dst === 99999 ? null : dst;
    days.set(day, hours);
  }
  return days;
}

/** The days of a year, from the Archive's `space/<year>.json`. */
export function readSpaceYear(archive: string, year: number): SpaceDay[] {
  return JSON.parse(readFileSync(join(spaceDir(archive), `${year}.json`), "utf8")) as SpaceDay[];
}

async function main(): Promise<void> {
  const archive = archiveHome();
  const dir = spaceDir(archive);
  mkdirSync(dir, { recursive: true });
  const [from, to] = [Number(process.argv[2] ?? String(EARLIEST_YEAR)), Number(process.argv[3] ?? new Date().getUTCFullYear())];
  const gfzPath = join(dir, "Kp_ap_Ap_SN_F107_since_1932.txt");
  writeFileSync(gfzPath, await fetchText(GFZ_URL));
  const gfz = parseGfz(readFileSync(gfzPath, "utf8"));
  for (let year = from; year <= to; year++) {
    const omniPath = join(dir, `omni2_${year}.dat`);
    // A past year's OMNI file does not change; the current year's does.
    if (!existsSync(omniPath) || year === to) writeFileSync(omniPath, await fetchText(OMNI_URL(year)));
    const dst = parseOmniDst(readFileSync(omniPath, "utf8"));
    const days: SpaceDay[] = [...gfz.values()].filter((d) => d.day.startsWith(String(year))).map((d) => ({ ...d, dst: dst.get(d.day) ?? null }));
    writeFileSync(join(dir, `${year}.json`), `${JSON.stringify(days)}\n`);
    console.log(`space/${year}.json: ${days.length} days, ${days.filter((d) => d.dst !== null).length} with Dst, ${days.filter((d) => d.definitive).length} definitive`);
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("space-weather.ts")) await main();
