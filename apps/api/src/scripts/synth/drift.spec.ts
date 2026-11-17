import { checkCv, checkGithub, checkVacancy } from './drift.js';
import { findTagsIn } from './aliases.js';
import { assembleCv, assembleFixture, completeSkills } from './assemble.js';
import { generatePersonas } from './personas.js';
import { loadDraftData } from './test-data.js';
import {
  goodCvOutput,
  goodGithubOutput,
  goodVacancyOutput,
} from './test-llm.js';
import type { CvContent } from './cv-content.js';
import type { PersonaSpec, Taxonomy, VacancySpec } from './types.js';

let taxonomy: Taxonomy;
let vacancies: VacancySpec[];
let personas: PersonaSpec[];

beforeAll(async () => {
  ({ taxonomy, vacancies } = await loadDraftData());
  personas = generatePersonas(taxonomy, vacancies, 1).personas;
});

const label = (tag: string): string =>
  taxonomy.tags.find((t) => t.tag === tag)!.label;

function cvFor(p: PersonaSpec): CvContent {
  const { cv, problems } = assembleCv(p, goodCvOutput(p, taxonomy));
  expect(problems).toEqual([]);
  return cv!;
}

/** First persona with a skill of the given evidence. */
const withEvidence = (evidence: string, extra?: (p: PersonaSpec) => boolean) =>
  personas.find(
    (p) =>
      p.skills.some((s) => s.evidence === evidence) && (extra?.(p) ?? true),
  )!;

const missingTag = (p: PersonaSpec): string =>
  taxonomy.tags.find(
    (t) =>
      t.kind !== 'experience' &&
      t.aliases.every((a) => a.length > 4) &&
      !p.skills.some((s) => s.tag === t.tag),
  )!.tag;

describe('checkCv', () => {
  it('passes a faithful CV for every persona', () => {
    for (const p of personas) {
      const report = checkCv(cvFor(p), p, taxonomy);
      expect({ id: p.id, errors: report.errors }).toEqual({
        id: p.id,
        errors: [],
      });
    }
  });

  it('fails when a cv_role tag is missing from the role bullets', () => {
    const p = withEvidence('cv_role');
    const tag = p.skills.find(
      (s) => s.evidence === 'cv_role' && s.tag !== 'git',
    )!.tag;
    const cv = cvFor(p);
    cv.roles.forEach((r) => {
      r.bullets = r.bullets.map((b) => b.replaceAll(label(tag), 'tools'));
    });
    const { errors } = checkCv(cv, p, taxonomy);
    expect(errors.join('\n')).toContain(`"${label(tag)}" must appear by name`);
  });

  it('counts an own ambiguous tag without a context cue ("pipelines in R")', () => {
    const p = personas.find((x) =>
      x.skills.some((s) => s.tag === 'r' && s.evidence === 'cv_role'),
    );
    if (!p) return; // seed-dependent; the generator gives several R personas
    const cv = cvFor(p);
    const role = p.roles.findIndex((r) => r.tags.includes('r'));
    cv.roles[role].bullets = cv.roles[role].bullets.map((b) =>
      b.replace(/\bR\b/g, 'tools'),
    );
    cv.roles[role].bullets.push('Rebuilt the forecasting pipelines in R.');
    expect(checkCv(cv, p, taxonomy).errors).toEqual([]);
  });

  it('only warns when a role mentions a tag the persona has elsewhere', () => {
    const p = personas.find(
      (x) =>
        x.roles.length >= 2 &&
        x.roles[0].tags.some(
          (t) => !t.startsWith('exp-') && !x.roles[1].tags.includes(t),
        ),
    )!;
    const tag = p.roles[0].tags.find(
      (t) => !t.startsWith('exp-') && !p.roles[1].tags.includes(t),
    )!;
    const cv = cvFor(p);
    cv.roles[1].bullets.push(`Also helped out using ${label(tag)}.`);
    const report = checkCv(cv, p, taxonomy);
    expect(report.errors).toEqual([]);
    expect(report.warnings.join('\n')).toContain(label(tag));
  });

  it('fails when a cv_project tag leaks into role bullets (raises evidence)', () => {
    const p = withEvidence('cv_project');
    const tag = p.skills.find((s) => s.evidence === 'cv_project')!.tag;
    const cv = cvFor(p);
    cv.roles[0].bullets.push(`Used ${label(tag)} on the job.`);
    const { errors } = checkCv(cv, p, taxonomy);
    expect(errors.join('\n')).toContain('must not appear in any role bullets');
  });

  it('fails when a cv_project tag is missing from its project', () => {
    const p = withEvidence('cv_project');
    const tag = p.skills.find((s) => s.evidence === 'cv_project')!.tag;
    const cv = cvFor(p);
    cv.projects.forEach((pr) => (pr.description = 'A small side project.'));
    const { errors } = checkCv(cv, p, taxonomy);
    expect(errors.join('\n')).toContain(
      `"${label(tag)}" must appear by name in the description`,
    );
  });

  it('fails when a skills-only tag is missing from the skills list', () => {
    const p = withEvidence('cv_skills_only');
    const tag = p.skills.find((s) => s.evidence === 'cv_skills_only')!.tag;
    const cv = cvFor(p);
    cv.skills = cv.skills.filter((s) => s !== label(tag));
    const { errors } = checkCv(cv, p, taxonomy);
    expect(errors.join('\n')).toContain('must be listed in the skills list');
  });

  it('fails when a skills-only tag shows up in prose (raises evidence)', () => {
    const p = withEvidence('cv_skills_only');
    const tag = p.skills.find((s) => s.evidence === 'cv_skills_only')!.tag;
    const cv = cvFor(p);
    cv.summary = `Expert in ${label(tag)}.`;
    const { errors } = checkCv(cv, p, taxonomy);
    expect(errors.join('\n')).toContain('belongs to the skills list only');
  });

  it('fails when a github_only tag appears in the CV', () => {
    const p = withEvidence('github_only');
    const tag = p.skills.find((s) => s.evidence === 'github_only')!.tag;
    for (const place of ['skills', 'bullets', 'summary'] as const) {
      const cv = cvFor(p);
      if (place === 'skills') cv.skills.push(label(tag));
      if (place === 'bullets') cv.roles[0].bullets.push(`Used ${label(tag)}.`);
      if (place === 'summary') cv.summary = `Loves ${label(tag)}.`;
      const { errors } = checkCv(cv, p, taxonomy);
      expect(errors.join('\n')).toContain('must not appear anywhere in the CV');
    }
  });

  it('fails on a leak: a tag the persona lacks, anywhere', () => {
    const p = personas[0];
    const tag = missingTag(p);
    for (const place of [
      'bullets',
      'project',
      'skills',
      'headline',
      'education',
    ] as const) {
      const cv = cvFor(p);
      const text = `built with ${label(tag)}`;
      if (place === 'bullets')
        cv.roles[0].bullets.push(`Delivered work ${text}.`);
      if (place === 'project' && cv.projects[0])
        cv.projects[0].description += ` ${text}.`;
      if (place === 'project' && !cv.projects[0]) cv.headline += ` ${text}`;
      if (place === 'skills') cv.skills.push(label(tag));
      if (place === 'headline') cv.headline = `Engineer using ${label(tag)}`;
      if (place === 'education') cv.education[0].degree = `BSc ${label(tag)}`;
      const { errors } = checkCv(cv, p, taxonomy);
      expect(errors.join('\n')).toContain(`"${label(tag)}" is mentioned`);
    }
  });

  it('ignores the injection text (it is added by code, not checked)', () => {
    const p = personas.find((x) => x.flags.includes('injection'))!;
    const cv = cvFor(p);
    expect(cv.injection).toContain('PWNED-SKILL');
    expect(checkCv(cv, p, taxonomy).errors).toEqual([]);
  });

  it('checks bullet counts and warns about years claims', () => {
    const p = personas[0];
    const cv = cvFor(p);
    cv.roles[0].bullets = ['Only one.'];
    cv.summary = 'Engineer with 8 years of experience.';
    const report = checkCv(cv, p, taxonomy);
    expect(report.errors.join('\n')).toContain('has 1 bullets');
    expect(report.warnings.join('\n')).toContain('years of experience');
  });
});

describe('checkGithub', () => {
  const profile = (): PersonaSpec =>
    withEvidence('github_only', (p) => p.github !== null);
  const fixtureFor = (p: PersonaSpec) =>
    assembleFixture(p, goodGithubOutput(p, taxonomy));

  it('passes a faithful profile for every persona with GitHub', () => {
    for (const p of personas.filter((x) => x.github)) {
      const report = checkGithub(fixtureFor(p), p, taxonomy);
      expect({ id: p.id, errors: report.errors }).toEqual({
        id: p.id,
        errors: [],
      });
    }
  });

  it('fails when a github_only tag is not in the repos', () => {
    const p = profile();
    const fixture = fixtureFor(p);
    fixture.repos.forEach((r) => (r.description = 'Nothing special.'));
    const { errors } = checkGithub(fixture, p, taxonomy);
    expect(errors.join('\n')).toContain('must appear by name');
  });

  it('fails when a github_only tag only shows up in a repo outside the snapshot', () => {
    const p = profile();
    const out = goodGithubOutput(p, taxonomy);
    const hidden = out.repos[0].description;
    out.repos.forEach((r) => (r.language = null));
    out.repos = [
      ...out.repos.map((r) => ({ ...r, description: 'Nothing special.' })),
      ...[3, 4, 5, 6].map((i) => ({
        ...out.repos[1],
        name: `extra-${i}`,
        description: 'Nothing special.',
      })),
      { ...out.repos[0], name: 'seventh', description: hidden },
    ];
    const fixture = assembleFixture(p, out);
    // Hidden behind six better-ranked repos, the tag is not in the snapshot.
    expect(checkGithub(fixture, p, taxonomy).errors.join('\n')).toContain(
      'must appear by name',
    );
  });

  it('fails on a leak in bio, readme or topics', () => {
    const p = profile();
    const tag = missingTag(p);
    const bio = fixtureFor(p);
    bio.user.bio = `I love ${label(tag)} a lot`;
    expect(checkGithub(bio, p, taxonomy).errors.join('\n')).toContain(
      'is mentioned (bio)',
    );

    const readme = fixtureFor(p);
    readme.readmes[readme.repos[2].name] += ` Built with ${label(tag)}.`;
    expect(checkGithub(readme, p, taxonomy).errors.join('\n')).toContain(
      `repo "${readme.repos[2].name}"`,
    );

    const topics = fixtureFor(p);
    topics.repos[1].topics = [label(tag).toLowerCase().replace(/\s+/g, '-')];
    expect(checkGithub(topics, p, taxonomy).errors.join('\n')).toContain(
      'is mentioned',
    );
  });

  it('requires language values the persona has', () => {
    const p = profile();
    const foreign = taxonomy.tags.find(
      (t) =>
        ['go', 'rust', 'dart', 'scala'].includes(t.tag) &&
        !p.skills.some((s) => s.tag === t.tag),
    )!;
    const fixture = fixtureFor(p);
    fixture.repos[1].language = foreign.label;
    expect(checkGithub(fixture, p, taxonomy).errors.join('\n')).toContain(
      `has language "${foreign.label}"`,
    );
    fixture.repos[1].language = 'Brainfuck';
    expect(checkGithub(fixture, p, taxonomy).errors.join('\n')).toContain(
      'technology label',
    );
  });

  it('checks repo count, names and README length', () => {
    const p = profile();
    const fixture = fixtureFor(p);
    fixture.repos = fixture.repos.slice(0, 2);
    fixture.repos[0].name = 'bad name!';
    fixture.readmes[fixture.repos[1].name] = 'short';
    const text = checkGithub(fixture, p, taxonomy).errors.join('\n');
    expect(text).toContain('Expected 3-8 repos');
    expect(text).toContain('kebab-case');
    expect(text).toContain('expected 300-1500');
  });
});

describe('checkVacancy', () => {
  it('passes the drafts themselves', () => {
    for (const v of vacancies) {
      const report = checkVacancy(v, goodVacancyOutput(v, taxonomy), taxonomy);
      expect({ id: v.id, errors: report.errors }).toEqual({
        id: v.id,
        errors: [],
      });
    }
  });

  it('accepts one named alternative, ambiguous aliases without a cue', () => {
    const v = vacancies.find((x) => x.id === 'full-stack')!;
    const out = goodVacancyOutput(v, taxonomy);
    // the draft names React, Vue and Angular; "in React" has no context cue
    out.requirements.find((r) => r.id === 'fs-ui')!.text =
      'Ship polished interfaces in React';
    expect(checkVacancy(v, out, taxonomy).errors).toEqual([]);
  });

  it('fails when alternatives are joined with "and"', () => {
    const v = vacancies.find((x) => x.id === 'data-engineering')!;
    const out = goodVacancyOutput(v, taxonomy);
    out.requirements.find((r) => r.id === 'de-orchestration')!.text =
      'Experience with Airflow, dbt and Spark';
    expect(checkVacancy(v, out, taxonomy).errors.join('\n')).toContain(
      'de-orchestration: "Airflow", "dbt", "Spark" are alternatives',
    );
    out.requirements.find((r) => r.id === 'de-orchestration')!.text =
      'Pipeline tooling such as Airflow, dbt or Spark';
    expect(checkVacancy(v, out, taxonomy).errors).toEqual([]);
  });

  it('fails when a requirement names none of its alternatives', () => {
    const v = vacancies[0];
    const out = goodVacancyOutput(v, taxonomy);
    const req = v.requirements.find(
      (r) => r.tags.length > 1 && !r.tags[0].startsWith('exp-'),
    )!;
    out.requirements.find((r) => r.id === req.id)!.text =
      'Some framework knowledge';
    const text = checkVacancy(v, out, taxonomy).errors.join('\n');
    expect(text).toContain(`${req.id}: the text must mention`);
  });

  it('fails when a requirement adds a tag that is not its own', () => {
    const v = vacancies[0];
    const out = goodVacancyOutput(v, taxonomy);
    const req = v.requirements.find((r) => r.tags.includes('git'))!;
    out.requirements.find((r) => r.id === req.id)!.text += ' and Docker';
    expect(checkVacancy(v, out, taxonomy).errors.join('\n')).toContain(
      'not part of this requirement',
    );
  });

  it('fails when the years number is missing', () => {
    const v = vacancies[0];
    const out = goodVacancyOutput(v, taxonomy);
    const req = v.requirements.find((r) => r.minYears !== undefined)!;
    out.requirements.find((r) => r.id === req.id)!.text = out.requirements
      .find((r) => r.id === req.id)!
      .text.replace(String(req.minYears), 'several');
    expect(checkVacancy(v, out, taxonomy).errors.join('\n')).toContain(
      `must state ${req.minYears} years`,
    );
  });

  it('fails when ids are renamed, dropped or duplicated', () => {
    const v = vacancies[0];
    const out = goodVacancyOutput(v, taxonomy);
    out.requirements[0].id = 'made-up';
    out.requirements.push({ ...out.requirements[1] });
    expect(checkVacancy(v, out, taxonomy).errors.join('\n')).toContain(
      'Requirement ids must match exactly',
    );
  });

  it('warns about technologies in the title or intro', () => {
    const v = vacancies.find((x) => x.id === 'frontend')!;
    const out = goodVacancyOutput(v, taxonomy);
    out.intro += ' Our stack is built on Kubernetes.';
    const report = checkVacancy(v, out, taxonomy);
    expect(report.errors).toEqual([]);
    expect(report.warnings.join('\n')).toContain('Kubernetes');
  });
});

describe('completeSkills', () => {
  it('adds every CV-evidenced label the model left out, never github_only', () => {
    const p =
      personas.find(
        (x) =>
          x.skills.some((s) => s.evidence === 'github_only') &&
          x.skills.some((s) => s.evidence === 'cv_skills_only'),
      ) ??
      personas.find((x) => x.skills.some((s) => s.evidence === 'github_only'))!;
    const skills = completeSkills([], p, taxonomy);
    const tags = findTagsIn(skills, taxonomy, { assumeTechContext: true });
    for (const s of p.skills) {
      const kind = taxonomy.tags.find((t) => t.tag === s.tag)?.kind;
      if (kind === 'experience') continue;
      expect({ tag: s.tag, listed: tags.has(s.tag) }).toEqual({
        tag: s.tag,
        listed: s.evidence !== 'github_only',
      });
    }
  });

  it('keeps the model entries and does not duplicate them', () => {
    const p = personas[0];
    const first = completeSkills([], p, taxonomy);
    expect(completeSkills(first, p, taxonomy)).toEqual(first);
    expect(completeSkills(['Team leadership'], p, taxonomy)[0]).toBe(
      'Team leadership',
    );
  });
});
