import type { CandidateResponse } from '@rag-ats/shared';

export function filterCandidates(
  candidates: readonly CandidateResponse[],
  query: string,
): CandidateResponse[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return [...candidates];
  }

  return candidates.filter((candidate) => {
    const haystack = [candidate.name, candidate.email, ...candidate.skills].map(
      (value) => value.toLowerCase(),
    );
    return terms.every((term) =>
      haystack.some((value) => value.includes(term)),
    );
  });
}
