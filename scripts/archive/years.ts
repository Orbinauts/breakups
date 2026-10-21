/**
 * The years the Archive spans and the scorecard scores, in one place, so
 * that every script which reads the truth "from the scorecard's first
 * year", lists the craft in orbit since the earliest replayed year, fetches
 * the space weather from it or scores from the year after the warm-up
 * reads the same numbers, and a year the Archive holds below the
 * scorecard's first is never scored by mistake.
 *
 * The detector meets every object and launch new in its first year, with
 * no record of steps, no background of new bodies and no cloud remembered;
 * in use it would have that history, so the first year of a span is its
 * warm-up year: replayed, never scored (the tenth phase's methodology, from
 * the ninth's held-out reading, twelve of whose thirty-one false
 * confirmations fell in 2005). The even and odd splits run from 2005 and
 * score from 2006. The years before them are the fresh validation (the
 * thirteenth decision record): 1995 to 2004 with 1994
 * as their warm-up, read by the detector once per truth and never fitted
 * on, kept apart from every other split; until the Archive holds them and
 * the scorecard reads them by that rule, `scoredYears` leaves any year
 * below the scorecard's first out.
 */

/** The fresh validation: the years read once per truth and never fitted on, with their warm-up year. */
export const FRESH_VALIDATION = { warmup: 1994, from: 1995, through: 2004 } as const;
/** The earliest year any replay runs: the fresh validation's warm-up. The visiting craft are listed from it, and the space weather fetched from it. */
export const EARLIEST_YEAR = FRESH_VALIDATION.warmup;
/** The first day a craft must still have been in orbit on to be among the visiting craft: the earliest replayed year's first day. */
export const IN_ORBIT_FROM = `${EARLIEST_YEAR}-01-01`;
/** The first year the even and odd splits replay: their warm-up year, and the first year the truth's reports count from. */
export const SCORECARD_FROM = 2005;
/** The first year the even and odd splits score: the year after their warm-up. */
export const SCORED_FROM = SCORECARD_FROM + 1;

/** The years of a list that the even and odd splits may replay: those from their warm-up year on, in order; the fresh validation's years are left out until the scorecard reads them by their own rule. */
export const scoredYears = (years: Iterable<number>): number[] => [...years].filter((year) => year >= SCORECARD_FROM).sort((a, b) => a - b);
