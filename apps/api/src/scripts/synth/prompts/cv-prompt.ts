import { z } from 'zod';
import type { PersonaSpec, Taxonomy } from '../types.js';
import {
  labelsOf,
  languageName,
  NO_REAL_NAMES,
  skillLabels,
  slipWords,
  withFeedback,
  type Prompt,
} from './common.js';

export const CV_SCHEMA_NAME = 'synthetic_cv';

/**
 * What the model writes. Names, dates, titles and contacts are not here: code
 * copies them from the persona spec (see `assembleCv`). Roles and projects
 * echo their employer / name so the code can check the order.
 */
export const cvOutputSchema = z.object({
  headline: z
    .string()
    .describe('Short professional headline, e.g. "Backend Engineer"'),
  location: z.string().describe('City and country'),
  summary: z.string().describe('2-4 sentence professional summary'),
  roles: z
    .array(
      z.object({
        employer: z.string().describe('Copy of the given employer'),
        bullets: z.array(z.string()).describe('2-5 achievement bullets'),
      }),
    )
    .describe('One entry per given role, in the given order'),
  projects: z
    .array(
      z.object({
        name: z.string().describe('Copy of the given project name'),
        description: z.string().describe('1-2 sentences'),
      }),
    )
    .describe('One entry per given project, in the given order; empty if none'),
  skills: z.array(z.string()).describe('Skills section entries'),
  education: z
    .array(
      z.object({
        degree: z.string(),
        school: z.string(),
        end: z.string().describe('Graduation year, e.g. "2019"'),
      }),
    )
    .describe('1-2 entries'),
  spokenLanguages: z.array(z.string()).describe('e.g. "English (C1)"'),
});

export type CvOutput = z.infer<typeof cvOutputSchema>;

const SYSTEM = `You write the content of a realistic CV for a synthetic recruiting data set. You get a candidate spec: roles, projects and the technologies each one uses.

The spec decides which technologies appear where. The CV is checked automatically against it, so follow these rules exactly:
- For every role, name each listed technology at least once in that role's bullets, spelled as given. For every project, name each listed technology in its description.
- Technologies marked "skills section only" appear in the skills list and nowhere else (not in bullets, projects, headline, summary or education). The skills list may also repeat technologies from roles and projects.
- Technologies marked "never mention" must not appear anywhere in the CV.
- Do not name any other technology, programming language, framework, library, database, cloud, tool, methodology or practice. When a bullet needs one that is not listed, use a generic word ("the backend", "a database", "cloud infrastructure", "automated checks"). The user message names common words to avoid.
- A role with no technologies is not a software role: its bullets describe ordinary duties and results with no technology at all.
- Name technologies in plain phrases: "using X", "with X", "built in X", or in comma-separated lists such as "Python, SQL and Airflow".
- 2 to 5 bullets per role, one sentence each, starting with a verb. About half of the bullets carry a concrete number (percent, count, latency, team size).
- Never state years of experience anywhere. You do not write titles, dates, names or contact details; only the fields of the answer.
- ${NO_REAL_NAMES}
- Education: 1 or 2 entries from invented schools that end before the first role starts. Spoken languages: 1 to 3 entries.
- Plain text only: no markdown, no emoji, no HTML.`;

const UK_RULE =
  'Write all prose (headline, summary, bullets, project descriptions, degrees, school names, location, spoken languages) in Ukrainian. Technology names stay in Latin script exactly as given, for example "використовуючи Python і Docker".';

export function buildCvPrompt(
  persona: PersonaSpec,
  taxonomy: Taxonomy,
  feedback: string[] | null = null,
): Prompt {
  const techOf = (tags: string[]): string => {
    const labels = labelsOf(tags, taxonomy);
    return labels.length > 0
      ? `technologies: ${labels.join(', ')}`
      : 'technologies: none (a non-software role: name no technology at all)';
  };
  const roles = persona.roles.map(
    (r, i) =>
      `${i + 1}. ${r.title} at ${r.employer} (${r.start} to ${r.end ?? 'present'}); ${techOf(r.tags)}`,
  );
  const projects = persona.projects.map(
    (p, i) => `${i + 1}. ${p.name}; ${techOf(p.tags)}`,
  );
  const skillsOnly = skillLabels(persona, taxonomy, 'cv_skills_only');
  const githubOnly = skillLabels(persona, taxonomy, 'github_only');
  const slips = slipWords(persona, taxonomy);

  const lines = [
    `Candidate: ${persona.name}`,
    `Language of the CV: ${languageName(persona)}`,
    ...(persona.language === 'uk' ? [UK_RULE] : []),
    '',
    `Roles (oldest first; answer in this order):`,
    ...(roles.length > 0
      ? roles
      : ['(none: the candidate has no job history)']),
    '',
    'Projects:',
    ...(projects.length > 0 ? projects : ['(none)']),
    '',
    `Skills section only (list, never mention elsewhere): ${skillsOnly.join(', ') || 'none'}`,
    `Never mention anywhere in the CV: ${githubOnly.join(', ') || 'none'}`,
    `Words that count as technologies, so avoid them unless listed above for that role or project: ${slips.join(', ')}`,
  ];
  return { system: SYSTEM, user: withFeedback(lines.join('\n'), feedback) };
}
