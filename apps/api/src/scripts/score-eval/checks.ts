import type { GithubSnapshot } from '../../github/github-snapshot.js';
import { normaliseText } from '../../llm/cv-profile-parser.js';
import { buildGithubBlock } from '../../llm/prompts/cv-profile.prompt.js';
import {
  normaliseForMatch,
  verifyQuotes,
} from '../../scoring/verify-quotes.js';
import type { Band } from './vacancies.js';

export interface CheckQuote {
  source: 'cv' | 'github';
  text: string;
}

export interface CheckCriterion {
  id: string;
  score: number;
  quotes: CheckQuote[];
}

export interface GroundedSources {
  cv: string;
  github: string | null;
}

/**
 * The exact texts `ApplicationScorer` verified quotes against: the normalised
 * CV text, and the GitHub block only for an `ok` snapshot.
 */
export function scorerSources(
  cvText: string,
  github: GithubSnapshot | null,
): GroundedSources {
  return {
    cv: normaliseText(cvText),
    github: github?.status === 'ok' ? buildGithubBlock(github) : null,
  };
}

export interface GroundedCheck {
  ok: boolean;
  problems: string[];
}

/**
 * Grounded: every criterion scored above 0 has at least one quote, and every
 * quote re-verifies (`verifyQuotes`) against the sources the scorer saw.
 */
export function checkGrounded(
  criteria: CheckCriterion[],
  sources: GroundedSources,
): GroundedCheck {
  const problems: string[] = [];
  for (const criterion of criteria) {
    if (criterion.score > 0 && criterion.quotes.length === 0) {
      problems.push(`${criterion.id}: score ${criterion.score} but no quotes`);
    }
    criterion.quotes.forEach((quote, index) => {
      const result = verifyQuotes(
        {
          criteria: [
            {
              criterionId: criterion.id,
              score: criterion.score,
              quotes: [quote],
            },
          ],
        },
        sources,
        [criterion.id],
      );
      for (const problem of result.problems) {
        problems.push(`${criterion.id} q${index + 1}: ${problem}`);
      }
    });
  }
  return { ok: problems.length === 0, problems };
}

export type BandResult = 'match' | 'miss' | 'none';

/** strong: overall >= 75, partial: 40-74, weak: < 40. */
export function bandOf(overall: number): Band {
  if (overall >= 75) return 'strong';
  if (overall >= 40) return 'partial';
  return 'weak';
}

/** `none` when the pair has no expectation; a missing overall is a miss. */
export function bandResult(
  overall: number | null,
  expected: Band | null,
): BandResult {
  if (expected === null) return 'none';
  if (overall === null) return 'miss';
  return bandOf(overall) === expected ? 'match' : 'miss';
}

export interface FillerSuspect {
  criterionId: string;
  /** The suspicious quote text, as stored. */
  quote: string;
  /** Other criteria that carry the same quote. */
  sharedWith: string[];
}

/**
 * Criteria scored 0 whose quote (normalised) is word-for-word a quote used for
 * another criterion in the same pair: likely a generic filler quote.
 */
export function findFillerSuspects(
  criteria: CheckCriterion[],
): FillerSuspect[] {
  const suspects: FillerSuspect[] = [];
  for (const criterion of criteria) {
    if (criterion.score !== 0) continue;
    for (const quote of criterion.quotes) {
      const key = normaliseForMatch(quote.text);
      const sharedWith = criteria
        .filter(
          (other) =>
            other.id !== criterion.id &&
            other.quotes.some((q) => normaliseForMatch(q.text) === key),
        )
        .map((other) => other.id);
      if (sharedWith.length > 0) {
        suspects.push({
          criterionId: criterion.id,
          quote: quote.text,
          sharedWith,
        });
      }
    }
  }
  return suspects;
}

export interface CoverageResult {
  covered: string[];
  missing: string[];
}

/** A term is covered when some criterion text contains it, case-insensitively. */
export function checkCoverage(
  terms: string[],
  criteriaTexts: string[],
): CoverageResult {
  const haystack = criteriaTexts.map((t) => t.toLowerCase());
  const covered: string[] = [];
  const missing: string[] = [];
  for (const term of terms) {
    const needle = term.toLowerCase();
    (haystack.some((t) => t.includes(needle)) ? covered : missing).push(term);
  }
  return { covered, missing };
}

/** max - min of the overalls; null when fewer than two runs. */
export function spread(overalls: number[]): number | null {
  if (overalls.length < 2) return null;
  return Math.max(...overalls) - Math.min(...overalls);
}
