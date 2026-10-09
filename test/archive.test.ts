import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { readElements } from "@orbinauts/engine";
import { archiveHome, builtYears, readManifest, readYear, setAt } from "../scripts/archive/archive.ts";

/**
 * A built year of the Archive, where one is present on this machine: its
 * columns hold the manifest's count, its sets are ordered by object then
 * publication rank, every object's row in the body table points at its
 * contiguous sets, and a sample of sets read back propagate through the
 * engine. Skipped where the Archive is absent (CI without the release
 * assets), so the suite needs nothing outside the repository.
 */

const archive = (() => {
  try {
    return archiveHome();
  } catch {
    return null;
  }
})();
const years = archive !== null && existsSync(archive) ? builtYears(archive) : [];

describe.skipIf(years.length === 0)("a built year of the Archive", { timeout: 60_000 }, () => {
  const year = years[Math.floor(years.length / 2)]!;
  const { manifest, bodies, columns } = readYear(archive!, year);

  test(`${year}'s columns hold the manifest's sets, ordered by object then rank`, () => {
    expect(manifest.format).toBe(1);
    for (const name of manifest.columns) expect(columns[name]!.length, name).toBe(manifest.sets);
    let disorder = -1;
    for (let i = 1; i < manifest.sets && disorder === -1; i++) {
      const same = columns.number[i] === columns.number[i - 1];
      if (!(same ? columns.rank[i]! > columns.rank[i - 1]! : columns.number[i]! > columns.number[i - 1]!)) disorder = i;
    }
    expect(disorder).toBe(-1);
  });

  test("the body table points at every object's contiguous sets", () => {
    expect(bodies.length).toBe(manifest.bodies);
    let at = 0;
    let wrong: string | null = null;
    for (const body of bodies) {
      if (body.first !== at || columns.number[body.first] !== body.number || columns.number[body.first + body.count - 1] !== body.number) wrong ??= `object ${body.number} at ${body.first}`;
      at += body.count;
    }
    expect(wrong).toBeNull();
    expect(at).toBe(manifest.sets);
    expect(bodies.filter((b) => b.name === null).length).toBe(manifest.withoutSatcat);
  });

  test("a sample of sets read back propagate through the engine", () => {
    const step = Math.max(1, Math.floor(manifest.sets / 200));
    let propagated = 0;
    for (let i = 0; i < manifest.sets; i += step) {
      const set = setAt(columns, i);
      let lo = 0;
      let hi = bodies.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (bodies[mid]!.first <= i) lo = mid;
        else hi = mid - 1;
      }
      const body = bodies[lo]!;
      try {
        readElements({
          OBJECT_NAME: body.name ?? "",
          OBJECT_ID: body.designator ?? "",
          EPOCH: new Date(set.epoch).toISOString().replace("Z", ""),
          MEAN_MOTION: set.meanMotion,
          ECCENTRICITY: set.eccentricity,
          INCLINATION: set.inclination,
          RA_OF_ASC_NODE: set.raan,
          ARG_OF_PERICENTER: set.argOfPerigee,
          MEAN_ANOMALY: set.meanAnomaly,
          EPHEMERIS_TYPE: 0,
          CLASSIFICATION_TYPE: "U",
          NORAD_CAT_ID: set.number,
          ELEMENT_SET_NO: set.elementSetNumber,
          REV_AT_EPOCH: set.revAtEpoch,
          BSTAR: set.bstar,
          MEAN_MOTION_DOT: set.meanMotionDot,
          MEAN_MOTION_DDOT: set.meanMotionDdot,
        });
        propagated++;
      } catch {
        // A set the catalogue published that describes no orbit: rare, and the detector will see it as such.
      }
    }
    expect(propagated).toBeGreaterThan(190);
  });

  test("every built year's manifest reads", () => {
    for (const built of years) expect(readManifest(archive!, built).year).toBe(built);
  });
});
