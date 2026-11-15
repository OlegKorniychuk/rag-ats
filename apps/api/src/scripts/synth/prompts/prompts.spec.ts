import { assembleCv, assembleFixture, INJECTION_TEXT } from '../assemble.js';
import { generatePersonas } from '../personas.js';
import { loadDraftData } from '../test-data.js';
import { goodCvOutput, goodGithubOutput } from '../test-llm.js';
import type { PersonaSpec, Taxonomy, VacancySpec } from '../types.js';
import { buildCvPrompt, cvOutputSchema } from './cv-prompt.js';
import {
  buildGithubPrompt,
  githubOutputSchema,
  languageLabels,
} from './github-prompt.js';
import { buildVacancyPrompt, vacancySchema } from './vacancy-prompt.js';

let taxonomy: Taxonomy;
let vacancies: VacancySpec[];
let personas: PersonaSpec[];

beforeAll(async () => {
  ({ taxonomy, vacancies } = await loadDraftData());
  personas = generatePersonas(taxonomy, vacancies, 1).personas;
});

const label = (tag: string): string =>
  taxonomy.tags.find((t) => t.tag === tag)!.label;
const line = (text: string, start: string): string =>
  text.split('\n').find((l) => l.startsWith(start)) ?? '';

describe('buildCvPrompt', () => {
  it('asks for Ukrainian prose only for uk personas', () => {
    const uk = personas.find((p) => p.language === 'uk')!;
    const en = personas.find((p) => p.language === 'en')!;
    const ukPrompt = buildCvPrompt(uk, taxonomy);
    expect(ukPrompt.user).toContain('Language of the CV: Ukrainian');
    expect(ukPrompt.user).toContain('in Ukrainian');
    expect(ukPrompt.user).toContain('Latin script');
    const enPrompt = buildCvPrompt(en, taxonomy);
    expect(enPrompt.user).toContain('Language of the CV: English');
    expect(enPrompt.user).not.toContain('in Ukrainian');
  });

  it('lists exactly the spec technologies per role, project and class', () => {
    const p = personas.find(
      (x) =>
        x.skills.some((s) => s.evidence === 'cv_skills_only') &&
        x.skills.some((s) => s.evidence === 'github_only') &&
        x.projects.length > 0,
    )!;
    const { user } = buildCvPrompt(p, taxonomy);
    p.roles.forEach((r, i) => {
      const expected = r.tags
        .filter((t) => !t.startsWith('exp-'))
        .map(label)
        .join(', ');
      expect(user).toContain(
        `${i + 1}. ${r.title} at ${r.employer} (${r.start} to ${r.end ?? 'present'}); technologies: ${expected}`,
      );
    });
    const tagsOf = (ev: string) =>
      p.skills
        .filter((s) => s.evidence === ev)
        .map((s) => label(s.tag))
        .join(', ');
    expect(line(user, 'Skills section only')).toContain(
      tagsOf('cv_skills_only'),
    );
    expect(line(user, 'Never mention')).toContain(tagsOf('github_only'));
    expect(user).not.toMatch(/exp-/);
    p.projects.forEach((pr) => expect(user).toContain(pr.name));
  });

  it('marks a role without technologies as non-software', () => {
    const p = personas.find((x) => x.flags.includes('career_switcher'))!;
    const bare = p.roles.find(
      (r) => r.tags.filter((t) => !t.startsWith('exp-')).length === 0,
    );
    expect(bare).toBeDefined();
    expect(buildCvPrompt(p, taxonomy).user).toContain(
      `${bare!.title} at ${bare!.employer}`,
    );
    expect(buildCvPrompt(p, taxonomy).user).toContain('a non-software role');
  });

  it('names common slip words only when the persona lacks them', () => {
    const p = personas.find((x) => !x.skills.some((s) => s.tag === 'git'))!;
    const slips = line(buildCvPrompt(p, taxonomy).user, 'Words that count');
    expect(slips).toContain('Git');
    const q = personas.find((x) => x.skills.some((s) => s.tag === 'git'))!;
    expect(
      line(buildCvPrompt(q, taxonomy).user, 'Words that count'),
    ).not.toMatch(/\bGit\b/);
  });

  it('appends the problems as feedback', () => {
    const { user } = buildCvPrompt(personas[0], taxonomy, [
      '"Go" is mentioned (summary)',
    ]);
    expect(user).toContain('rejected by an automatic check');
    expect(user).toContain('- "Go" is mentioned (summary)');
    expect(buildCvPrompt(personas[0], taxonomy, []).user).not.toContain(
      'rejected',
    );
  });

  it('never carries the injection text, and the schema has no injection field', () => {
    const inj = personas.filter((p) => p.flags.includes('injection'));
    expect(inj.length).toBeGreaterThan(0);
    for (const p of inj) {
      const { system, user } = buildCvPrompt(p, taxonomy);
      expect(`${system}\n${user}`).not.toMatch(
        /PWNED|SYSTEM NOTE|ignore all previous/i,
      );
    }
    expect(Object.keys(cvOutputSchema.shape)).not.toContain('injection');
  });
});

describe('assembleCv', () => {
  it('copies the structure from the spec and adds the injection by code', () => {
    const inj = personas.find((p) => p.flags.includes('injection'))!;
    const { cv } = assembleCv(inj, goodCvOutput(inj, taxonomy));
    expect(cv!.injection).toBe(INJECTION_TEXT);
    expect(cv!.injection).toContain('PWNED-SKILL');
    expect(cv!.injection).toContain('PWNED-PROJECT');
    expect(cv!.roles.map((r) => [r.employer, r.title, r.start, r.end])).toEqual(
      inj.roles.map((r) => [r.employer, r.title, r.start, r.end]),
    );
    expect(cv!.name).toBe(inj.name);
    expect(cv!.email).toBe(inj.email);

    const plain = personas.find((p) => !p.flags.includes('injection'))!;
    expect(
      assembleCv(plain, goodCvOutput(plain, taxonomy)).cv!.injection,
    ).toBeNull();
  });

  it('sets githubUrl from the spec', () => {
    const gh = personas.find((p) => p.github)!;
    const noGh = personas.find((p) => !p.github)!;
    expect(assembleCv(gh, goodCvOutput(gh, taxonomy)).cv!.githubUrl).toBe(
      `https://github.com/${gh.github!.username}`,
    );
    expect(
      assembleCv(noGh, goodCvOutput(noGh, taxonomy)).cv!.githubUrl,
    ).toBeNull();
  });

  it('reports a wrong role count or echoed employer instead of producing a CV', () => {
    const p = personas.find((x) => x.roles.length >= 2)!;
    const out = goodCvOutput(p, taxonomy);
    out.roles = out.roles.slice(1);
    const r1 = assembleCv(p, out);
    expect(r1.cv).toBeNull();
    expect(r1.problems.join('\n')).toContain(
      `Expected ${p.roles.length} roles`,
    );

    const swapped = goodCvOutput(p, taxonomy);
    swapped.roles.reverse();
    expect(assembleCv(p, swapped).problems.join('\n')).toContain(
      'employer must be',
    );
  });
});

describe('buildGithubPrompt', () => {
  const ghPersona = () =>
    personas.find(
      (p) => p.github && p.skills.some((s) => s.evidence === 'github_only'),
    )!;

  it('lists the github_only technologies as must-appear', () => {
    const p = ghPersona();
    const { user } = buildGithubPrompt(p, taxonomy);
    const must = p.skills
      .filter((s) => s.evidence === 'github_only')
      .map((s) => label(s.tag))
      .join(', ');
    expect(line(user, 'Technologies that must appear')).toContain(must);
    expect(user).toContain(p.github!.username);
    expect(buildGithubPrompt(p, taxonomy, ['x']).user).toContain('- x');
  });

  it('restricts repo languages to the persona and its labels', () => {
    const p = ghPersona();
    const labels = languageLabels(p, taxonomy);
    for (const l of labels) {
      expect(p.skills.some((s) => label(s.tag) === l)).toBe(true);
    }
    const schema = githubOutputSchema(labels);
    const repo = (language: string | null) => ({
      bio: 'b',
      repos: [
        { name: 'a', description: 'd', language, topics: [], readme: 'r' },
      ],
    });
    expect(schema.safeParse(repo(null)).success).toBe(true);
    if (labels.length > 0) {
      expect(schema.safeParse(repo(labels[0])).success).toBe(true);
    }
    expect(schema.safeParse(repo('Brainfuck')).success).toBe(false);
    // no own languages: the schema stays a plain nullable string (strict mode
    // may reject a bare null type); drift.ts rejects foreign languages
    expect(githubOutputSchema([]).safeParse(repo(null)).success).toBe(true);
  });
});

describe('assembleFixture', () => {
  it('fills urls, stars and dates deterministically from the persona', () => {
    const p = personas.find((x) => x.github)!;
    const out = goodGithubOutput(p, taxonomy);
    const a = assembleFixture(p, out);
    expect(assembleFixture(p, out)).toEqual(a);
    expect(a.user).toEqual({
      login: p.github!.username,
      html_url: `https://github.com/${p.github!.username}`,
      bio: out.bio,
    });
    expect(a.repos.every((r) => !r.fork && !r.archived)).toBe(true);
    expect(a.repos[0].html_url).toBe(
      `https://github.com/${p.github!.username}/${out.repos[0].name}`,
    );
    const stars = a.repos.map((r) => r.stargazers_count);
    expect(stars).toEqual([...stars].sort((x, y) => y - x));
    expect(new Set(stars).size).toBe(stars.length);
    for (const r of a.repos) {
      expect(r.created_at! <= r.pushed_at!).toBe(true);
    }
    expect(Object.keys(a.readmes)).toEqual(out.repos.map((r) => r.name));
  });
});

describe('buildVacancyPrompt', () => {
  it('lists ids, levels, technologies and years, and the schema fixes the ids', () => {
    const v = vacancies.find((x) => x.id === 'frontend')!;
    const { user } = buildVacancyPrompt(v, taxonomy);
    for (const r of v.requirements) {
      expect(user).toContain(`id: ${r.id}`);
    }
    expect(user).toContain(
      'id: fe-ts | level: must have | technologies to name: TypeScript | years: 2',
    );
    expect(user).toContain(
      'id: fe-exp | level: must have | technologies to name: none | years: 3',
    );
    const schema = vacancySchema(v);
    const ok = {
      title: 't',
      intro: 'i',
      requirements: [{ id: 'fe-ts', text: 'x' }],
    };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(
      schema.safeParse({ ...ok, requirements: [{ id: 'invented', text: 'x' }] })
        .success,
    ).toBe(false);
    expect(buildVacancyPrompt(v, taxonomy, ['p1']).user).toContain('- p1');
  });
});
