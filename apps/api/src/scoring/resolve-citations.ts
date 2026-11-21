import type { EvidenceUnit } from './evidence-units.js';
import { preview } from './verify-quotes.js';

/** Most units kept per criterion; later citations are dropped. */
export const MAX_QUOTES_PER_CRITERION = 3;

export interface CitingCriterion {
  criterionId: string;
  score: number;
  evidence: string[];
}

export interface ResolvedCriterion {
  criterionId: string;
  /** The input score, or 0 when the criterion is listed in `zeroed`. */
  score: number;
  quotes: { source: 'cv' | 'github'; text: string }[];
}

/**
 * On `valid`, every criterion with `score` > 0 has at least one quote: either
 * the answer cited a unit for it, or (`zeroUnsupported`) its score was set to 0
 * and its id listed in `zeroed`. `zeroed` is empty unless `zeroUnsupported`.
 * The `criteria` of an invalid result are not to be used.
 */
export interface ResolveCitationsResult {
  valid: boolean;
  problems: string[];
  criteria: ResolvedCriterion[];
  /** Criterion ids whose score above 0 was set to 0 for lack of evidence (response order). */
  zeroed: string[];
}

/**
 * The problem strings. Exported as builders so the eval failure buckets match
 * them exactly.
 */
export const citationProblems = {
  unknownCriterion: (id: string): string =>
    `Unknown criterion id ${preview(id)}`,
  duplicateCriterion: (id: string): string =>
    `Criterion ${id} appears more than once`,
  missingCriterion: (id: string): string => `Criterion ${id} is missing`,
  unknownEvidence: (criterionId: string, raw: string): string =>
    `Criterion ${criterionId} cites unknown evidence id ${preview(raw)}`,
  noEvidence: (criterionId: string): string =>
    `Criterion ${criterionId} has a score above 0 but cites no evidence`,
};

/**
 * True for a `citationProblems.noEvidence` string (any criterion id). Matched
 * against the builder's own wording so the two cannot drift apart.
 */
export function isNoEvidenceProblem(problem: string): boolean {
  const marker = '\u0000';
  const [prefix, suffix] = citationProblems.noEvidence(marker).split(marker);
  return (
    problem.length >= prefix.length + suffix.length &&
    problem.startsWith(prefix) &&
    problem.endsWith(suffix)
  );
}

export interface ResolveCitationsOptions {
  /**
   * What a score above 0 that cites nothing does. false (default, the first
   * attempt): a `noEvidence` problem, so the caller retries with feedback.
   * true (the final attempt): the score is set to 0 and the id listed in
   * `zeroed`, so it is no problem.
   *
   * A criterion that cites only unknown ids is a problem (`unknownEvidence`)
   * either way: it cited something, so it is not "no evidence".
   */
  zeroUnsupported?: boolean;
}

/**
 * Strips brackets, quotes, backticks, dots and whitespace from both ends (one
 * class, so "[S14]." and '"G3".' work), then upper-cases.
 */
export function normaliseUnitId(raw: string): string {
  return raw.replace(/^[[\]"'`.\s]+|[[\]"'`.\s]+$/g, '').toUpperCase();
}

/**
 * Checks that the response covers exactly the expected criteria and that every
 * cited evidence id names a unit, then resolves the ids to the units' text.
 * Citations are deduplicated (after normalisation) and capped per criterion.
 * A score above 0 citing nothing is a problem or is zeroed, per
 * `options.zeroUnsupported` (see `ResolveCitationsOptions`).
 */
export function resolveCitations(
  response: { criteria: CitingCriterion[] },
  units: ReadonlyMap<string, EvidenceUnit>,
  expectedCriterionIds: string[],
  options: ResolveCitationsOptions = {},
): ResolveCitationsResult {
  const problems: string[] = [];
  const resolved: ResolvedCriterion[] = [];
  const zeroed: string[] = [];
  const expected = new Set(expectedCriterionIds);
  const seen = new Set<string>();

  for (const criterion of response.criteria) {
    const id = criterion.criterionId;
    if (!expected.has(id)) {
      problems.push(citationProblems.unknownCriterion(id));
      continue;
    }
    if (seen.has(id)) {
      problems.push(citationProblems.duplicateCriterion(id));
      continue;
    }
    seen.add(id);

    const cited = new Set<string>();
    const quotes: ResolvedCriterion['quotes'] = [];
    for (const raw of criterion.evidence) {
      const unitId = normaliseUnitId(raw);
      if (cited.has(unitId)) continue;
      cited.add(unitId);

      const unit = units.get(unitId);
      if (!unit) {
        problems.push(citationProblems.unknownEvidence(id, raw));
      } else if (quotes.length < MAX_QUOTES_PER_CRITERION) {
        quotes.push({ source: unit.source, text: unit.text });
      }
    }

    let score = criterion.score;
    if (score > 0 && criterion.evidence.length === 0) {
      if (options.zeroUnsupported) {
        score = 0;
        zeroed.push(id);
      } else {
        problems.push(citationProblems.noEvidence(id));
      }
    }
    resolved.push({ criterionId: id, score, quotes });
  }

  for (const id of expectedCriterionIds) {
    if (!seen.has(id)) problems.push(citationProblems.missingCriterion(id));
  }

  return {
    valid: problems.length === 0,
    problems,
    criteria: resolved,
    zeroed,
  };
}
