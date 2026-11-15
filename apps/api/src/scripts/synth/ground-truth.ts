/**
 * The ground-truth rule. Labels come from structured specs, never from an LLM.
 *
 * - A requirement is met (1) when the persona has one of its tags with
 *   evidence cv_role, cv_project or github_only and years >= minYears.
 * - It is partial (0.5) when the tag is present but years < minYears, or the
 *   only evidence is cv_skills_only (keyword stuffing).
 * - Otherwise it is not met (0).
 * - score = round(100 * sum(w*v) / sum(w)), must weight 2, nice weight 1.
 * - Bands: strong >= 75, partial 40-74, weak < 40.
 */
import type {
  Band,
  GroundTruth,
  GroundTruthPair,
  PersonaSpec,
  Requirement,
  RequirementStatus,
  RequirementStatusValue,
  SearchQuery,
  Skill,
  VacancySpec,
} from './types.js';

export const WEIGHTS = { must: 2, nice: 1 } as const;
export const STRONG_MIN = 75;
export const PARTIAL_MIN = 40;

const VALUE: Record<RequirementStatusValue, number> = {
  met: 1,
  partial: 0.5,
  not_met: 0,
};
const RANK: Record<RequirementStatusValue, number> = {
  met: 2,
  partial: 1,
  not_met: 0,
};

type Skilled = Pick<PersonaSpec, 'skills'>;

export function bandOf(score: number): Band {
  if (score >= STRONG_MIN) return 'strong';
  if (score >= PARTIAL_MIN) return 'partial';
  return 'weak';
}

/** Status of one skill against an optional minimum number of years. */
export function skillStatus(
  skill: Skill | undefined,
  minYears = 0,
): RequirementStatusValue {
  if (!skill) return 'not_met';
  if (skill.evidence === 'cv_skills_only') return 'partial';
  return skill.years >= minYears ? 'met' : 'partial';
}

export function evaluateRequirement(
  persona: Skilled,
  requirement: Requirement,
): RequirementStatus {
  let best: RequirementStatusValue = 'not_met';
  let bestTag: string | undefined;
  for (const tag of requirement.tags) {
    const skill = persona.skills.find((s) => s.tag === tag);
    const status = skillStatus(skill, requirement.minYears);
    if (RANK[status] > RANK[best]) {
      best = status;
      bestTag = tag;
    }
  }
  return {
    requirementId: requirement.id,
    status: best,
    ...(bestTag ? { tag: bestTag } : {}),
  };
}

export function scoreVacancy(
  persona: Skilled,
  vacancy: Pick<VacancySpec, 'requirements'>,
): { score: number; band: Band; requirements: RequirementStatus[] } {
  let weighted = 0;
  let total = 0;
  const requirements = vacancy.requirements.map((req) => {
    const status = evaluateRequirement(persona, req);
    weighted += WEIGHTS[req.kind] * VALUE[status.status];
    total += WEIGHTS[req.kind];
    return status;
  });
  const score = total === 0 ? 0 : Math.round((100 * weighted) / total);
  return { score, band: bandOf(score), requirements };
}

/** Every persona x vacancy pair, in persona-major order. */
export function computeGroundTruth(
  personas: Array<Skilled & Pick<PersonaSpec, 'id'>>,
  vacancies: VacancySpec[],
): GroundTruth {
  const pairs: GroundTruthPair[] = [];
  for (const persona of personas) {
    for (const vacancy of vacancies) {
      pairs.push({
        vacancyId: vacancy.id,
        personaId: persona.id,
        ...scoreVacancy(persona, vacancy),
      });
    }
  }
  return { pairs };
}

/**
 * Search relevance: relevant when every query tag is met (no minYears),
 * partially relevant when every tag is present but at least one is only
 * partial (cv_skills_only).
 */
export function searchRelevance(
  personas: Array<Skilled & Pick<PersonaSpec, 'id'>>,
  query: Pick<SearchQuery, 'tags'>,
): { relevant: string[]; partiallyRelevant: string[] } {
  const relevant: string[] = [];
  const partiallyRelevant: string[] = [];
  for (const persona of personas) {
    const statuses = query.tags.map((tag) =>
      skillStatus(persona.skills.find((s) => s.tag === tag)),
    );
    if (statuses.length === 0 || statuses.includes('not_met')) continue;
    if (statuses.every((s) => s === 'met')) relevant.push(persona.id);
    else partiallyRelevant.push(persona.id);
  }
  return { relevant, partiallyRelevant };
}

export type BandCounts = Record<Band, number>;

export function bandDistribution(
  gt: GroundTruth,
  vacancyIds: string[],
): Map<string, BandCounts> {
  const out = new Map<string, BandCounts>(
    vacancyIds.map((id) => [id, { strong: 0, partial: 0, weak: 0 }]),
  );
  for (const pair of gt.pairs) out.get(pair.vacancyId)![pair.band]++;
  return out;
}

export interface DistributionGuard {
  minStrong: number;
  minPartial: number;
}

export const DEFAULT_GUARD: DistributionGuard = { minStrong: 5, minPartial: 8 };

/** Human-readable problems; empty when every vacancy passes the guard. */
export function checkDistribution(
  gt: GroundTruth,
  vacancyIds: string[],
  guard: DistributionGuard = DEFAULT_GUARD,
): string[] {
  const problems: string[] = [];
  for (const [id, counts] of bandDistribution(gt, vacancyIds)) {
    if (counts.strong < guard.minStrong) {
      problems.push(`${id}: ${counts.strong} strong (need ${guard.minStrong})`);
    }
    if (counts.partial < guard.minPartial) {
      problems.push(
        `${id}: ${counts.partial} partial (need ${guard.minPartial})`,
      );
    }
  }
  return problems;
}
