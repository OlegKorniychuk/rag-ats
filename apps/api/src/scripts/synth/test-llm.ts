/**
 * Test helper, not shipped logic: a fake LLM client and "good" model outputs
 * built from the specs, so stage and drift specs never touch the network.
 */
import type {
  LlmUsage,
  ParseStructuredParams,
  ParseStructuredResult,
} from '../../llm/llm-client.js';
import type { z } from 'zod';
import { findTags } from './aliases.js';
import type { SynthLlm } from './generation.js';
import type { CvOutput } from './prompts/cv-prompt.js';
import { languageLabels, type GithubOutput } from './prompts/github-prompt.js';
import { labelsOf } from './prompts/common.js';
import type { PersonaSpec, Taxonomy, VacancySpec } from './types.js';
import type { VacancyRewrite } from './drift.js';

export const FAKE_USAGE: LlmUsage = {
  model: 'fake-model',
  inputTokens: 1_000,
  outputTokens: 500,
  totalTokens: 1_500,
};

const unique = (items: string[]): string[] => [...new Set(items)];

const tagsOf = (persona: PersonaSpec, ...kinds: string[]): string[] =>
  persona.skills.filter((s) => kinds.includes(s.evidence)).map((s) => s.tag);

/** A CV answer that passes the drift check for `persona`. */
export function goodCvOutput(
  persona: PersonaSpec,
  taxonomy: Taxonomy,
): CvOutput {
  const using = (tags: string[]): string => {
    const labels = labelsOf(tags, taxonomy);
    return labels.length > 0
      ? `Delivered results using ${labels.join(', ')}.`
      : 'Coordinated the team and customers every day.';
  };
  const projectTags = persona.projects.flatMap((p) => p.tags);
  return {
    headline: 'Engineer',
    location: 'Lviv, Ukraine',
    summary: 'Pragmatic professional focused on reliable delivery.',
    roles: persona.roles.map((r) => ({
      employer: r.employer,
      bullets: [using(r.tags), 'Improved team throughput by 20%.'],
    })),
    projects: persona.projects.map((p) => ({
      name: p.name,
      description:
        labelsOf(p.tags, taxonomy).length > 0
          ? `A side project built with ${labelsOf(p.tags, taxonomy).join(', ')}.`
          : 'A small side project.',
    })),
    skills: labelsOf(
      unique([
        ...tagsOf(persona, 'cv_skills_only'),
        ...persona.roles.flatMap((r) => r.tags),
        ...projectTags,
      ]),
      taxonomy,
    ),
    education: [
      {
        degree: 'BSc Computer Science',
        school: 'Northfield Institute',
        end: '2019',
      },
    ],
    spokenLanguages: ['English (C1)'],
  };
}

/** A GitHub answer that passes the drift check for `persona`. */
export function goodGithubOutput(
  persona: PersonaSpec,
  taxonomy: Taxonomy,
): GithubOutput {
  const labels = labelsOf(
    unique([
      ...tagsOf(persona, 'github_only'),
      ...tagsOf(persona, 'cv_role').slice(0, 3),
    ]),
    taxonomy,
  );
  const [language] = languageLabels(persona, taxonomy);
  const filler =
    'This project explores a small idea and keeps the code tidy. '.repeat(8);
  const repo = (i: number) => ({
    name: `side-project-${i}`,
    description:
      i === 0 && labels.length > 0
        ? `A small tool built with ${labels.join(', ')}.`
        : 'A small tool for daily chores.',
    language: language ?? null,
    topics: ['cli', 'tools'],
    readme: `# Side project ${i}\n\n${filler}`,
  });
  return {
    bio: 'Builds small tools in spare time.',
    repos: [0, 1, 2].map(repo),
  };
}

export function goodVacancyOutput(
  draft: VacancySpec,
  taxonomy: Taxonomy,
): VacancyRewrite {
  return {
    title: draft.title,
    intro: draft.intro,
    requirements: draft.requirements.map((r) => {
      const labels = labelsOf(r.tags, taxonomy);
      const named = findTags(r.text, taxonomy);
      const unnamed = r.tags.every((t) => !named.has(t));
      return {
        id: r.id,
        text:
          labels.length > 0 && unnamed
            ? `${r.text} (e.g. ${labels.join(' or ')})`
            : r.text,
      };
    }),
  };
}

export type Responder = (
  params: ParseStructuredParams<z.ZodType>,
  callIndex: number,
) => ParseStructuredResult<unknown> | Promise<ParseStructuredResult<unknown>>;

export const parsed = (
  value: unknown,
  usage: LlmUsage | null = FAKE_USAGE,
): ParseStructuredResult<unknown> => ({ kind: 'parsed', parsed: value, usage });

/** Records every call and answers with `responder`. */
export class FakeLlm implements SynthLlm {
  model = 'fake-model';
  calls: ParseStructuredParams<z.ZodType>[] = [];
  constructor(private readonly responder: Responder) {}

  async parseStructured<S extends z.ZodType>(
    params: ParseStructuredParams<S>,
  ): Promise<ParseStructuredResult<z.infer<S>>> {
    const index = this.calls.length;
    this.calls.push(params);
    return (await this.responder(params, index)) as ParseStructuredResult<
      z.infer<S>
    >;
  }
}
