/** An instant as ISO 8601 to the millisecond: `2026-10-12T04:17:09.000Z`. */
export const isoInstant = (at: number | Date): string => new Date(at).toISOString();

/** An instant as ISO 8601 to the minute, the seconds dropped, as the truth writes its instants: `2026-10-12T04:17Z`. */
export const isoMinute = (at: number | Date): string => `${new Date(at).toISOString().slice(0, 16)}Z`;
