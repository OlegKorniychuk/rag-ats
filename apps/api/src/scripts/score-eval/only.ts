export class OnlyError extends Error {
  constructor(message: string) {
    super(`--only: ${message}`);
    this.name = 'OnlyError';
  }
}

export interface PairSelector {
  has(vacancyId: string, cvId: string): boolean;
}

/**
 * Parses `vacancyId:cvId,vacancyId:*,...`. Undefined (flag absent) selects
 * every pair. Unknown vacancy or CV ids are rejected, listing all of them.
 */
export function parseOnly(
  raw: string | undefined,
  vacancyIds: string[],
  cvIds: string[],
): PairSelector {
  if (raw === undefined) return { has: () => true };

  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) throw new OnlyError('no pairs given');

  const bad: string[] = [];
  const pairs: Array<[string, string]> = [];
  for (const entry of entries) {
    const parts = entry.split(':');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      bad.push(`"${entry}" (expected vacancyId:cvId or vacancyId:*)`);
      continue;
    }
    const [vacancyId, cvId] = parts;
    if (!vacancyIds.includes(vacancyId)) {
      bad.push(`"${entry}" (unknown vacancy "${vacancyId}")`);
    } else if (cvId !== '*' && !cvIds.includes(cvId)) {
      bad.push(`"${entry}" (unknown CV "${cvId}")`);
    } else {
      pairs.push([vacancyId, cvId]);
    }
  }
  if (bad.length > 0) throw new OnlyError(`invalid entries: ${bad.join('; ')}`);

  return {
    has: (vacancyId, cvId) =>
      pairs.some(([v, c]) => v === vacancyId && (c === '*' || c === cvId)),
  };
}
