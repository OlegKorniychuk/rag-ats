import { z } from 'zod';
import type { Taxonomy, VacancySpec } from '../types.js';
import { labelsOf, withFeedback, type Prompt } from './common.js';

export const VACANCY_SCHEMA_NAME = 'vacancy_rewrite';

/** Requirement ids are an enum, so the model cannot invent or rename them. */
export function vacancySchema(draft: VacancySpec) {
  const ids = draft.requirements.map((r) => r.id) as [string, ...string[]];
  return z.object({
    title: z.string().describe('Job title, e.g. "Senior Frontend Engineer"'),
    intro: z
      .string()
      .describe('2-3 sentences about the fictional company, team and role'),
    requirements: z
      .array(
        z.object({
          id: z.enum(ids),
          text: z.string().describe('One requirement as one short bullet'),
        }),
      )
      .describe('One entry per requirement id, in the given order'),
  });
}

const SYSTEM = `You write realistic job vacancies for a synthetic recruiting data set.

You get a vacancy draft: a role, an intro and requirements with ids. Rewrite the prose in your own words, like a real job post of a fictional company.

Rules:
- Keep every requirement id and answer once per id, in the given order. Do not add, drop, merge or reorder requirements.
- Keep the meaning of each requirement: the same technologies, the same must / nice-to-have level, the same number of years.
- Each requirement text must name every technology listed for it, using the listed spelling or a common alias, and no other technology, language, framework or tool.
- Several technologies in one requirement are alternatives: any one of them is enough. Join them with "or" ("PostgreSQL or MySQL", "such as Airflow, dbt or Spark"), never with "and".
- Do not start a requirement with a section label such as "Nice to have:" or "Must have:"; the post adds the headings.
- When a requirement lists a number of years, write that number as a digit ("3+ years", "at least 2 years").
- Requirement texts are single short bullets without a leading dash.
- The title and intro must not name technologies that the requirements do not list.
- The company, team and product are fictional. No real companies or people.
- Plain text only: no markdown, no emoji.`;

export function buildVacancyPrompt(
  draft: VacancySpec,
  taxonomy: Taxonomy,
  feedback: string[] | null = null,
): Prompt {
  const reqs = draft.requirements.map((r) => {
    const tech = labelsOf(r.tags, taxonomy);
    const bits = [
      `id: ${r.id}`,
      `level: ${r.kind === 'must' ? 'must have' : 'nice to have'}`,
      tech.length > 0
        ? `technologies to name: ${tech.join(', ')}`
        : 'technologies to name: none',
      r.minYears !== undefined ? `years: ${r.minYears}` : null,
      `draft: ${r.text}`,
    ].filter((b) => b !== null);
    return `- ${bits.join(' | ')}`;
  });
  const user = [
    `Role: ${draft.id}`,
    `Draft title: ${draft.title}`,
    `Draft intro: ${draft.intro}`,
    'Requirements:',
    ...reqs,
  ].join('\n');
  return { system: SYSTEM, user: withFeedback(user, feedback) };
}
