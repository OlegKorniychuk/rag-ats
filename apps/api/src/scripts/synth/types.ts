/**
 * Shared types for the synthetic data set (`data/synthetic/`). Everything the
 * ground truth depends on (personas, vacancies, taxonomy) is structured data
 * produced by code; the LLM stages only write prose from these specs.
 */

export type Band = 'strong' | 'partial' | 'weak';

/** Where a skill shows up. Decides how the ground-truth rule counts it. */
export type Evidence =
  'cv_role' | 'cv_project' | 'cv_skills_only' | 'github_only';

export type Layout = '1-col' | '2-col' | 'compact';
export type Language = 'en' | 'uk';
export type PersonaKind = 'targeted' | 'off_target';
export type PersonaFlag =
  'keyword_stuffer' | 'injection' | 'career_switcher' | 'bootcamp' | 'adjacent';

export interface TaxonomyTag {
  tag: string;
  label: string;
  /** Spellings that may appear in text. Empty for experience tags. */
  aliases: string[];
  /** Short or common-word aliases: match case-sensitively, in tech context. */
  ambiguous?: boolean;
  /** Role families (vacancy ids) the tag naturally belongs to. */
  family?: string[];
  /** `experience` tags (exp-*) express "N+ years in a field" requirements. */
  kind?: 'skill' | 'experience';
}

export interface Taxonomy {
  description: string;
  tags: TaxonomyTag[];
}

export interface Requirement {
  id: string;
  text: string;
  kind: 'must' | 'nice';
  /** Any one of these tags satisfies the requirement. */
  tags: string[];
  minYears?: number;
}

/**
 * Design choice: `vacancies.draft.json` is hand-authored and fixes ids,
 * requirement ids, kinds, tags and minYears. The LLM stage (`synth vacancies`)
 * writes `vacancies.json`, rewriting only the prose (title, intro, requirement
 * text) and keeping everything else from the draft. Stages read
 * `vacancies.json` when it exists, otherwise the draft.
 */
export interface VacancySpec {
  id: string;
  title: string;
  intro: string;
  requirements: Requirement[];
  /** Rendered from the fields above by `renderVacancyText`. */
  text: string;
}

export interface Role {
  employer: string;
  title: string;
  /** YYYY-MM */
  start: string;
  /** YYYY-MM, or null for the current role. */
  end: string | null;
  tags: string[];
}

export interface Project {
  name: string;
  tags: string[];
}

export interface Skill {
  tag: string;
  /**
   * cv_role: summed months of the roles using the tag / 12. cv_project and
   * cv_skills_only: 0. github_only: years of repo activity set by the
   * generator (there is no role to sum).
   */
  years: number;
  evidence: Evidence;
}

export interface PersonaSpec {
  id: string;
  name: string;
  email: string;
  language: Language;
  layout: Layout;
  roles: Role[];
  projects: Project[];
  skills: Skill[];
  github: { username: string } | null;
  kind: PersonaKind;
  target?: { vacancyId: string; band: 'strong' | 'partial' };
  flags: PersonaFlag[];
  applyTo: string[];
}

export type RequirementStatusValue = 'met' | 'partial' | 'not_met';

export interface RequirementStatus {
  requirementId: string;
  status: RequirementStatusValue;
  /** The persona tag that gave the best status, if any. */
  tag?: string;
}

export interface GroundTruthPair {
  vacancyId: string;
  personaId: string;
  score: number;
  band: Band;
  requirements: RequirementStatus[];
}

export interface GroundTruth {
  pairs: GroundTruthPair[];
}

export interface SearchQuery {
  id: string;
  query: string;
  /** Skills a relevant candidate must have (all of them). */
  tags: string[];
  /** Computed by `synth labels`. */
  relevant?: string[];
  partiallyRelevant?: string[];
}
