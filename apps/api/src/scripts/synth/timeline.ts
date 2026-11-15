/** Career timeline arithmetic. Months are counted from year*12+month indices. */
import type { Rng } from './rng.js';

/** "Today" for the data set: no role ends after this month. */
export const ANCHOR = '2026-10';

export function monthIndex(ym: string): number {
  const [year, month] = ym.split('-').map(Number);
  return year * 12 + (month - 1);
}

export function formatMonth(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Duration in months; an open role (end null) runs to ANCHOR. */
export function roleMonths(role: {
  start: string;
  end: string | null;
}): number {
  return monthIndex(role.end ?? ANCHOR) - monthIndex(role.start);
}

/** Years rounded to 2 decimals (one month is ~0.083, so never ambiguous). */
export function monthsToYears(months: number): number {
  return Math.round((months / 12) * 100) / 100;
}

/** Splits `total` months into `parts` pieces, each at least `minPart`. */
export function splitMonths(
  total: number,
  parts: number,
  minPart: number,
  rng: Rng,
): number[] {
  const count = Math.max(1, Math.min(parts, Math.floor(total / minPart)));
  const pieces = Array<number>(count).fill(minPart);
  let rest = total - minPart * count;
  while (rest > 0) {
    const give = Math.min(rest, rng.int(1, Math.max(1, Math.ceil(rest / 2))));
    pieces[rng.int(0, count - 1)] += give;
    rest -= give;
  }
  return pieces;
}

/**
 * Places consecutive roles (durations oldest to newest) ending at ANCHOR
 * (current role) or a little before it, with 0-2 month gaps between roles.
 */
export function layoutTimeline(
  durations: number[],
  rng: Rng,
  current: boolean,
): Array<{ start: string; end: string | null }> {
  const anchor = monthIndex(ANCHOR);
  let endIndex = current ? anchor : anchor - rng.int(1, 14);
  const out: Array<{ start: string; end: string | null }> = [];
  for (let i = durations.length - 1; i >= 0; i--) {
    const startIndex = endIndex - durations[i];
    out.unshift({
      start: formatMonth(startIndex),
      end: i === durations.length - 1 && current ? null : formatMonth(endIndex),
    });
    endIndex = startIndex - (i > 0 ? rng.int(0, 2) : 0);
  }
  return out;
}
