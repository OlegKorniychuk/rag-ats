/**
 * A criterion counts as matched when its best chunk reaches this cosine
 * similarity. Tuned in the step 8 smoke: 0.3 (step 7's search floor) let weak
 * candidates match most criteria; 0.35 keeps the expected strong CVs on top
 * with an honest "N of M criteria"; 0.38+ starts dropping their real matches.
 */
export const MATCH_FLOOR = 0.35;
/** Nearest chunks fetched per criterion in `criteria` mode. */
export const PER_CRITERION_CHUNK_LIMIT = 30;
/** Nearest chunks fetched for the single query in `whole_text` mode. */
export const WHOLE_TEXT_CHUNK_LIMIT = 50;
/** Matches returned per request. */
export const MAX_MATCHES = 10;
/** Snippets returned per match. */
export const MAX_MATCH_SNIPPETS = 3;

/**
 * Injection token for the match floor. Production uses MATCH_FLOOR; e2e tests
 * override it because the fake embedding model (keyword-overlap cosine) scores
 * a short criterion far lower against a long chunk than a real model would.
 */
export const MATCH_FLOOR_TOKEN = Symbol('MATCH_FLOOR');
