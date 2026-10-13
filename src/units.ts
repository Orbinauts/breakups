/**
 * The units the library counts in: time in milliseconds since 1970, as
 * `Date` does, so a day and an hour are these many; and angles in degrees,
 * a difference of two of them read as the turn between them, a half-turn
 * either side.
 */

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

/** An angle in degrees, wrapped into [-180, 180). */
export const wrapDegrees = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
