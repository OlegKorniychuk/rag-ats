/** Nearest chunks fetched from the vector index per search. */
export const SEARCH_CHUNK_LIMIT = 50;
/** Chunks (and candidates) below this cosine similarity are not matches. */
export const MIN_SIMILARITY = 0.3;
/** Candidates returned per search. */
export const MAX_RESULTS = 20;
/** Snippets returned per candidate. */
export const MAX_SNIPPETS = 3;

/**
 * Injection token for the similarity threshold. Production uses
 * MIN_SIMILARITY; e2e tests override it because the fake embedding model
 * (keyword-overlap cosine) scores a short query far lower against a long
 * chunk than a real model would.
 */
export const SEARCH_MIN_SIMILARITY = Symbol('SEARCH_MIN_SIMILARITY');
