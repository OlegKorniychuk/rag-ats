import { z } from 'zod';
import type { PersonaSpec, Taxonomy } from '../types.js';
import {
  labelsOf,
  skillLabels,
  slipWords,
  withFeedback,
  type Prompt,
} from './common.js';

export const GITHUB_SCHEMA_NAME = 'synthetic_github_profile';

/** Tags GitHub reports as a repo language. */
const LANGUAGE_TAGS = new Set([
  'javascript',
  'typescript',
  'python',
  'java',
  'kotlin',
  'swift',
  'go',
  'rust',
  'csharp',
  'cpp',
  'c',
  'r',
  'scala',
  'sql',
  'bash',
  'dart',
]);

/** Taxonomy labels the persona may use as a repo `language`. */
export function languageLabels(
  persona: PersonaSpec,
  taxonomy: Taxonomy,
): string[] {
  const has = new Set(persona.skills.map((s) => s.tag));
  return taxonomy.tags
    .filter((t) => LANGUAGE_TAGS.has(t.tag) && has.has(t.tag))
    .map((t) => t.label);
}

/** Per persona: `language` is an enum of the persona's own language labels. */
export function githubOutputSchema(languages: string[]) {
  const language =
    languages.length > 0
      ? z.enum(languages as [string, ...string[]]).nullable()
      : // a bare null type may be rejected by strict structured outputs; the
        // drift check rejects any language the persona doesn't have
        z.string().nullable();
  return z.object({
    bio: z.string().describe('One short sentence, no technology names'),
    repos: z
      .array(
        z.object({
          name: z.string().describe('kebab-case repo name'),
          description: z.string().describe('One sentence'),
          language,
          topics: z
            .array(z.string())
            .describe('2-6 lowercase kebab-case topics'),
          readme: z.string().describe('Markdown README, 300-1500 characters'),
        }),
      )
      .describe('3-8 repos, most significant first'),
  });
}

export type GithubOutput = z.infer<ReturnType<typeof githubOutputSchema>>;

const SYSTEM = `You write the public GitHub profile of a fictional developer for a synthetic recruiting data set: a bio and a list of repositories with description, language, topics and README.

The technologies in the spec decide what the profile may contain. It is checked automatically, so follow these rules exactly:
- Every technology marked "must appear" is named in the description, topics or language of one of the first 6 repos, and in the README of one of the first 3 (use the listed spelling; topics are lowercase kebab-case, for example "react-native").
- The other listed technologies may be used freely. Name no other technology, programming language, framework, library, database, cloud, tool or practice, in any repo, topic, README or the bio. When something unlisted is needed, use a generic word. The user message names common words to avoid; in particular write no "git clone" or similar commands, and do not write the word "GitHub".
- A repo's language is one of the allowed languages, or null for a repo without code.
- Repos are small personal or open-source projects of 1-3 sentences of scope, ordered by significance: the most significant first.
- Each README is 300 to 1500 characters of Markdown: a title, what the project does, a short feature list and a getting-started note that uses only listed technologies. No badges, images or links.
- Repo names are unique, kebab-case and do not contain a technology name that is not listed.
- Everything is fictional. No real companies, people or products.`;

export function buildGithubPrompt(
  persona: PersonaSpec,
  taxonomy: Taxonomy,
  feedback: string[] | null = null,
): Prompt {
  const mustAppear = skillLabels(persona, taxonomy, 'github_only');
  const optional = labelsOf(
    persona.skills
      .filter((s) => s.evidence !== 'github_only')
      .map((s) => s.tag),
    taxonomy,
  );
  const languages = languageLabels(persona, taxonomy);
  const roleTitle = persona.roles[persona.roles.length - 1]?.title;
  const lines = [
    `Developer: ${persona.name} (GitHub username ${persona.github?.username ?? 'unknown'})`,
    ...(roleTitle ? [`Current role: ${roleTitle}`] : []),
    `Technologies that must appear: ${mustAppear.join(', ') || 'none'}`,
    `Other technologies the developer uses (use a few of them too): ${optional.join(', ') || 'none'}`,
    `Allowed repo languages: ${languages.join(', ') || 'none (use null)'}`,
    `Words that count as technologies, so avoid them unless listed above: ${slipWords(persona, taxonomy).join(', ')}`,
    `Number of repos: 3 to 8`,
  ];
  return { system: SYSTEM, user: withFeedback(lines.join('\n'), feedback) };
}
