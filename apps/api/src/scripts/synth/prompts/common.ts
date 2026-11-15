import type { PersonaSpec, Taxonomy } from '../types.js';

export interface Prompt {
  system: string;
  user: string;
}

/** Appends the drift problems of the previous attempt, when there are any. */
export function withFeedback(user: string, feedback: string[] | null): string {
  if (!feedback || feedback.length === 0) return user;
  return [
    user,
    '',
    'Your previous answer was rejected by an automatic check. Problems:',
    ...feedback.map((p) => `- ${p}`),
    'Write the complete answer again and fix every problem.',
  ].join('\n');
}

export function labelsOf(tags: string[], taxonomy: Taxonomy): string[] {
  const byTag = new Map(taxonomy.tags.map((t) => [t.tag, t]));
  return tags
    .map((tag) => byTag.get(tag))
    .filter((t) => t !== undefined && t.kind !== 'experience')
    .map((t) => t.label);
}

/**
 * Tags that slip into prose by accident ("agile team", "git clone", "REST
 * endpoints"): named in the prompt when the persona lacks them.
 */
const COMMON_SLIPS = [
  'git',
  'agile',
  'rest-api',
  'ci-cd',
  'microservices',
  'linux',
  'docker',
  'sql',
  'system-design',
  'test-automation',
  'github-actions',
  'aws',
  'kubernetes',
  'web-accessibility',
  'etl',
  'html-css',
];

export function slipWords(persona: PersonaSpec, taxonomy: Taxonomy): string[] {
  const has = new Set(persona.skills.map((s) => s.tag));
  return labelsOf(
    COMMON_SLIPS.filter((t) => !has.has(t)),
    taxonomy,
  );
}

export function languageName(persona: PersonaSpec): string {
  return persona.language === 'uk' ? 'Ukrainian' : 'English';
}

/** The tags of a persona by evidence class, as taxonomy labels. */
export function skillLabels(
  persona: PersonaSpec,
  taxonomy: Taxonomy,
  evidence: PersonaSpec['skills'][number]['evidence'],
): string[] {
  return labelsOf(
    persona.skills.filter((s) => s.evidence === evidence).map((s) => s.tag),
    taxonomy,
  );
}

export const NO_REAL_NAMES =
  'Everything is fictional: invent company, product, school and project names; never use real companies, products of real companies as employers, universities or people.';
