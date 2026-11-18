import type { SyntheticSet } from './data.js';

/**
 * Embedding calls of the retrieval part: one per search query, and one per
 * vacancy in each of the two find-matches modes. Known from the data alone.
 */
export const retrievalEmbedCalls = (
  set: Pick<SyntheticSet, 'queries' | 'vacancies'>,
): number => set.queries.length + 2 * set.vacancies.length;
