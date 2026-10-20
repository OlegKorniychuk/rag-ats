/** Shortest acceptable quote (e.g. a technology name like "Go"). */
export const MIN_QUOTE_CHARS = 2;
/** Quotes shorter than this must match a whole token, not part of a word. */
export const SHORT_QUOTE_CHARS = 8;

export interface QuoteLike {
  source: 'cv' | 'github';
  text: string;
}

export interface ScoredCriterionLike {
  criterionId: string;
  score: number;
  quotes: QuoteLike[];
}

export interface VerifyQuotesSources {
  cv: string;
  github: string | null;
}

export interface VerifyQuotesResult {
  valid: boolean;
  problems: string[];
}

/**
 * NFKC, lower-cased, whitespace after a word-attached hyphen removed (PDF line
 * wraps turn "e-commerce" into "e- commerce"), all other whitespace runs
 * collapsed to one space, trimmed. Applied to both quote and source.
 */
export function normaliseForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(\S)-\s+(?=\S)/gu, '$1-')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Long quotes: plain substring. Short ones: whole token only ("go" ≠ "google"). */
function occursIn(source: string, quote: string): boolean {
  if (quote.length >= SHORT_QUOTE_CHARS) return source.includes(quote);
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(quote)}(?![\\p{L}\\p{N}])`,
    'u',
  ).test(source);
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return JSON.stringify(flat.length > 80 ? `${flat.slice(0, 80)}...` : flat);
}

/**
 * Checks that the response covers exactly the expected criteria and that every
 * quote is a verbatim substring (after normalisation) of the source it names.
 */
export function verifyQuotes(
  response: { criteria: ScoredCriterionLike[] },
  sources: VerifyQuotesSources,
  expectedCriterionIds: string[],
): VerifyQuotesResult {
  const problems: string[] = [];
  const cv = normaliseForMatch(sources.cv);
  const github =
    sources.github === null ? null : normaliseForMatch(sources.github);

  const expected = new Set(expectedCriterionIds);
  const seen = new Set<string>();
  let totalQuotes = 0;

  for (const criterion of response.criteria) {
    const id = criterion.criterionId;
    if (!expected.has(id)) {
      problems.push(`Unknown criterion id ${preview(id)}`);
    } else if (seen.has(id)) {
      problems.push(`Criterion ${id} appears more than once`);
    }
    seen.add(id);

    if (criterion.score > 0 && criterion.quotes.length === 0) {
      problems.push(`Criterion ${id} has a score above 0 but no quotes`);
    }

    for (const quote of criterion.quotes) {
      totalQuotes += 1;
      const text = normaliseForMatch(quote.text);
      if (text.length < MIN_QUOTE_CHARS) {
        problems.push(
          `Criterion ${id}: quote ${preview(quote.text)} is shorter than ${MIN_QUOTE_CHARS} characters`,
        );
        continue;
      }
      if (quote.source === 'github') {
        if (github === null) {
          problems.push(
            `Criterion ${id}: quote ${preview(quote.text)} cites github, but no <github> data was provided`,
          );
          continue;
        }
        if (!occursIn(github, text)) {
          problems.push(
            `Criterion ${id}: quote ${preview(quote.text)} is not a verbatim excerpt of <github>`,
          );
        }
      } else if (!occursIn(cv, text)) {
        problems.push(
          `Criterion ${id}: quote ${preview(quote.text)} is not a verbatim excerpt of <cv>`,
        );
      }
    }
  }

  for (const id of expectedCriterionIds) {
    if (!seen.has(id)) problems.push(`Criterion ${id} is missing`);
  }

  if (totalQuotes === 0) problems.push('The response contains no quotes');

  return { valid: problems.length === 0, problems };
}
