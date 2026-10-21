import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveHome } from "./archive.ts";
import { latestSatcat, type SatcatRow } from "./satcat.ts";
import { STATION_LAUNCHES } from "../../src/stations.ts";
import { EARLIEST_YEAR, IN_ORBIT_FROM } from "./years.ts";

/**
 * The launches of the crewed spacecraft and of the cargo craft that serve
 * the stations, read from the satellite catalogue's snapshot by name, and
 * written as the list the detector refuses to confirm under
 * (`src/visiting.ts`). What such a craft leaves in orbit is released on
 * purpose: a Shenzhou's orbital module and covers at the end of its
 * mission, a Dragon's trunk, a Soyuz's or a Progress's covers, a Shuttle's
 * lost tools and deployed satellites, the cargo craft's jettisoned items.
 * The catalogue lists them as debris under the craft's launch, and they
 * share its plane and an instant, so the Confirmed channel would read them
 * as a breakup, as it reads a station's (`stationLaunches`).
 *
 * The list is every payload whose name is one of the vehicles below and
 * that was in orbit at some time since the earliest replayed year (no decay
 * date, or one on or after `IN_ORBIT_FROM`, `years.ts`), by its launch. The names are the
 * catalogue's: Soyuz TM, TMA and MS, Shenzhou, the Space Shuttle's missions
 * (`STS 60` to `STS 135`), Crew Dragon and the private crewed Dragons
 * (Axiom, Inspiration4, Polaris Dawn, Fram2), Starliner; Progress (M,
 * M1, M-M, MS, and the Progress M-UM that carried the station's Prichal
 * node), Tianzhou, the cargo Dragons (the qualification flight, C1, C2+
 * and CRS), Cygnus, HTV (Kounotori) and HTV-X, and the ATV. The names
 * that merely contain these words are not theirs (DRAGONSAT, DRAGRACER,
 * MICRODRAGON, STSAT, STSS, the Cygnus mass simulator of Antares' test
 * flight), and Orion, which flew alone beyond low orbit, is not a
 * station's craft; a station's own launch (Unity's and Destiny's, each a
 * Shuttle's) is the station rule's. Run by hand after `npm run archive:satcat`:
 * `npm run archive:visiting`, which rewrites `src/visiting.ts`.
 */

/** A vehicle: its name in the list, whether it is crewed or a cargo craft, and the catalogue's names for it. */
export interface Vehicle {
  name: string;
  kind: "crewed" | "cargo";
  pattern: RegExp;
}

export const VEHICLES: readonly Vehicle[] = [
  { name: "Soyuz", kind: "crewed", pattern: /^SOYUZ-(?:TM|TMA|MS)\b/ },
  { name: "Shenzhou", kind: "crewed", pattern: /^SHENZHOU-\d+\b/ },
  { name: "Space Shuttle", kind: "crewed", pattern: /^STS \d+$/ },
  { name: "Crew Dragon", kind: "crewed", pattern: /^(?:CREW DRAGON\b|AXIOM-\d+\b|INSPIRATION4$|POLARIS DAWN$|FRAM2$)/ },
  { name: "Starliner", kind: "crewed", pattern: /^STARLINER\b/ },
  { name: "Progress", kind: "cargo", pattern: /^PROGRESS-M/ },
  { name: "Tianzhou", kind: "cargo", pattern: /^TIANZHOU-\d+\b/ },
  { name: "Dragon", kind: "cargo", pattern: /^DRAGON(?: |$)/ },
  { name: "Cygnus", kind: "cargo", pattern: /^CYGNUS\b/ },
  { name: "HTV", kind: "cargo", pattern: /^HTV-/ },
  { name: "ATV", kind: "cargo", pattern: /^ATV-\d+\b/ },
];


/** The vehicle a catalogue name is, or null. */
export function vehicleOf(name: string): Vehicle | null {
  return VEHICLES.find((vehicle) => vehicle.pattern.test(name)) ?? null;
}

/** One listed launch: its designator's launch, the craft's name and its vehicle. */
export interface VisitingLaunch {
  launch: string;
  name: string;
  vehicle: Vehicle;
}

/** The launches of the craft in the rows, in orbit since `IN_ORBIT_FROM`, one per launch (the first payload of it by catalogue number), by launch; a station's launch (a Shuttle that carried a module up) is left out, the station rule refusing every body of it. */
export function visitingLaunches(rows: Iterable<SatcatRow>, stations: readonly string[] = STATION_LAUNCHES): VisitingLaunch[] {
  const byLaunch = new Map<string, VisitingLaunch>();
  for (const row of [...rows].sort((a, b) => a.number - b.number)) {
    if (row.bodyClass !== "payload" || (row.decay !== null && row.decay < IN_ORBIT_FROM)) continue;
    const vehicle = vehicleOf(row.name);
    const launch = /^(\d{4}-\d{3})/.exec(row.designator)?.[1];
    if (vehicle === null || launch === undefined || byLaunch.has(launch) || stations.includes(launch)) continue;
    byLaunch.set(launch, { launch, name: row.name, vehicle });
  }
  return [...byLaunch.values()].sort((a, b) => a.launch.localeCompare(b.launch));
}

/** The source of `src/visiting.ts` for the launches, from the snapshot of the day given. */
export function renderVisiting(launches: readonly VisitingLaunch[], day: string): string {
  const counts = VEHICLES.map((vehicle) => `${vehicle.name} ${launches.filter((l) => l.vehicle === vehicle).length}`).join(", ");
  return [
    "/**",
    " * The launches of the crewed spacecraft and of the cargo craft that serve",
    ` * the stations, in orbit at some time since ${EARLIEST_YEAR}: what such a craft leaves`,
    " * in orbit is released on purpose, so the detector confirms and attributes",
    " * nothing under them, as under a station's (`visitingLaunches` in",
    " * `params.ts`). Generated by `npm run archive:visiting` from the satellite",
    ` * catalogue's snapshot of ${day}; not edited by hand. ${launches.length} launches: ${counts}.`,
    " */",
    "export const VISITING_LAUNCHES: readonly string[] = [",
    ...launches.map((l) => `  "${l.launch}", // ${l.name}`),
    "];",
    "",
  ].join("\n");
}

function main(): void {
  const satcat = latestSatcat(archiveHome());
  if (satcat === null) throw new Error("no satellite-catalogue snapshot in the Archive: run npm run archive:satcat first");
  const launches = visitingLaunches(satcat.rows.values());
  const path = join(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), "src/visiting.ts");
  writeFileSync(path, renderVisiting(launches, satcat.day));
  console.log(`src/visiting.ts: ${launches.length} launches from satcat/${satcat.day}.csv: ${VEHICLES.map((vehicle) => `${vehicle.name} ${launches.filter((l) => l.vehicle === vehicle).length}`).join(", ")}`);
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("visiting.ts")) main();
