/**
 * Drift checks: does LLM-written prose still say what the spec says? Pure
 * functions returning human-readable problems; the retry loop feeds `errors`
 * back to the model. `warnings` are reported but never fail a generation.
 *
 * What fails (errors):
 * - Evidence class would change. The ground truth counts a skill by where it
 *   is evidenced (cv_role > cv_project > cv_skills_only; github_only is not in
 *   the CV at all). Text that moves a skill to a stronger class (a
 *   cv_project / cv_skills_only / github_only tag showing up in role bullets,
 *   a github_only tag anywhere in the CV, a skills-only tag in prose) or drops
 *   it from its own place makes the label wrong.
 * - Leak: a taxonomy tag the persona does not have appears anywhere.
 * What only warns: a cv_role tag mentioned in a role that does not carry it
 * (the persona has the tag elsewhere, so the class does not change), and
 * stated years of experience.
 */
import { findTags, findTagsIn, findTagsInTopic } from './aliases.js';
import {
  MAX_REPOS,
  README_REPO_COUNT,
} from '../../github/github-profile-fetcher.js';
import type { GithubFixture } from '../../github/fixture-github-client.js';
import type { CvContent } from './cv-content.js';
import type { PersonaSpec, Taxonomy, VacancySpec } from './types.js';

export interface DriftReport {
  errors: string[];
  warnings: string[];
}

export const BULLETS_MIN = 2;
export const BULLETS_MAX = 5;
export const REPOS_MIN = 3;
export const REPOS_MAX = 8;
/** Prompted as 300-1500; checked leniently because models miscount. */
export const README_MIN_CHARS = 200;
export const README_MAX_CHARS = 2000;

const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{1,60}$/;

const YEARS_CLAIM =
  /\b\d{1,2}\+?\s*(?:years?|yrs?)\b|\b\d{1,2}\+?\s*(?:рок|рік|роки|років)/iu;

function labeller(taxonomy: Taxonomy): (tag: string) => string {
  const labels = new Map(taxonomy.tags.map((t) => [t.tag, t.label]));
  return (tag) => labels.get(tag) ?? tag;
}

/** Tags with aliases (experience tags never appear in prose). */
function proseTags(taxonomy: Taxonomy): Set<string> {
  return new Set(
    taxonomy.tags.filter((t) => t.kind !== 'experience').map((t) => t.tag),
  );
}

function personaEvidence(
  persona: PersonaSpec,
  taxonomy: Taxonomy,
): Map<string, PersonaSpec['skills'][number]['evidence']> {
  const prose = proseTags(taxonomy);
  return new Map(
    persona.skills
      .filter((s) => prose.has(s.tag))
      .map((s) => [s.tag, s.evidence]),
  );
}

interface Segment {
  where: string;
  tags: Set<string>;
}

function leakErrors(
  segments: Segment[],
  evidence: Map<string, unknown>,
  label: (tag: string) => string,
  subject: string,
): string[] {
  const where = new Map<string, string[]>();
  for (const s of segments) {
    for (const tag of s.tags) {
      if (evidence.has(tag)) continue;
      where.set(tag, [...(where.get(tag) ?? []), s.where]);
    }
  }
  return [...where].map(
    ([tag, places]) =>
      `"${label(tag)}" is mentioned (${[...new Set(places)].join(', ')}) but the candidate does not have it. Remove it from the ${subject}; use a generic word instead.`,
  );
}

export function checkCv(
  cv: CvContent,
  persona: PersonaSpec,
  taxonomy: Taxonomy,
): DriftReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const label = labeller(taxonomy);
  const evidence = personaEvidence(persona, taxonomy);

  if (cv.roles.length !== persona.roles.length) {
    errors.push(
      `Expected ${persona.roles.length} roles, got ${cv.roles.length}.`,
    );
  }
  if (cv.projects.length !== persona.projects.length) {
    errors.push(
      `Expected ${persona.projects.length} projects, got ${cv.projects.length}.`,
    );
  }
  cv.roles.forEach((r, i) => {
    const n = r.bullets.filter((b) => b.trim() !== '').length;
    if (n < BULLETS_MIN || n > BULLETS_MAX) {
      errors.push(
        `Role ${i + 1} (${r.title}) has ${n} bullets, expected ${BULLETS_MIN}-${BULLETS_MAX}.`,
      );
    }
  });
  if (cv.summary.trim() === '' || cv.headline.trim() === '') {
    errors.push('Headline and summary must not be empty.');
  }
  if (cv.skills.length === 0) errors.push('The skills list is empty.');

  const roleTags = cv.roles.map((r) =>
    findTags(r.bullets.join('\n'), taxonomy),
  );
  const projectTags = cv.projects.map((p) => findTags(p.description, taxonomy));
  const skillsTags = findTagsIn(cv.skills, taxonomy);
  const profileTags = findTagsIn([cv.headline, cv.summary], taxonomy);
  const otherTags = findTagsIn(
    [
      cv.location,
      ...cv.spokenLanguages,
      ...cv.education.flatMap((e) => [e.degree, e.school]),
    ],
    taxonomy,
  );
  const union = (sets: Set<string>[]): Set<string> =>
    new Set(sets.flatMap((s) => [...s]));

  // The leak check above keeps the strict tech-context rule: a tag the persona
  // lacks must not be reported for "Go to market". Presence and placement of
  // the persona's own tags use case-sensitive matching without the context
  // cue, so "pipelines in R" counts as R (and a stray "Go" in the wrong
  // section is caught rather than missed).
  const owned = { assumeTechContext: true };
  const ownRoleTags = cv.roles.map((r) =>
    findTags(r.bullets.join('\n'), taxonomy, owned),
  );
  const ownProjectTags = cv.projects.map((p) =>
    findTags(p.description, taxonomy, owned),
  );
  const ownSkillsTags = findTagsIn(cv.skills, taxonomy, owned);
  const ownProfileTags = findTagsIn([cv.headline, cv.summary], taxonomy, owned);
  const ownOtherTags = findTagsIn(
    [
      cv.location,
      ...cv.spokenLanguages,
      ...cv.education.flatMap((e) => [e.degree, e.school]),
    ],
    taxonomy,
    owned,
  );
  const anyRole = union(ownRoleTags);
  const anyProject = union(ownProjectTags);

  errors.push(
    ...leakErrors(
      [
        ...roleTags.map((tags, i) => ({
          where: `role ${i + 1} bullets`,
          tags,
        })),
        ...projectTags.map((tags, i) => ({
          where: `project ${i + 1}`,
          tags,
        })),
        { where: 'skills list', tags: skillsTags },
        { where: 'headline or summary', tags: profileTags },
        { where: 'education, location or languages', tags: otherTags },
      ],
      evidence,
      label,
      'CV',
    ),
  );

  const inProse = [anyRole, anyProject, ownProfileTags, ownOtherTags];
  for (const [tag, ev] of evidence) {
    const name = label(tag);
    switch (ev) {
      case 'cv_role': {
        const carrying = persona.roles
          .map((r, i) => (r.tags.includes(tag) ? i : -1))
          .filter((i) => i >= 0);
        if (!carrying.some((i) => ownRoleTags[i]?.has(tag))) {
          errors.push(
            `"${name}" must appear by name in the bullets of ${carrying.map((i) => `role ${i + 1} (${persona.roles[i].title})`).join(' or ')}.`,
          );
        }
        ownRoleTags.forEach((tags, i) => {
          if (tags.has(tag) && !carrying.includes(i)) {
            warnings.push(
              `"${name}" is mentioned in role ${i + 1}, which does not list it.`,
            );
          }
        });
        break;
      }
      case 'cv_project': {
        const carrying = persona.projects
          .map((p, i) => (p.tags.includes(tag) ? i : -1))
          .filter((i) => i >= 0);
        if (!carrying.some((i) => ownProjectTags[i]?.has(tag))) {
          errors.push(
            `"${name}" must appear by name in the description of project ${carrying.map((i) => `"${persona.projects[i].name}"`).join(' or ')}.`,
          );
        }
        if (anyRole.has(tag)) {
          errors.push(
            `"${name}" belongs to a project only; it must not appear in any role bullets.`,
          );
        }
        break;
      }
      case 'cv_skills_only': {
        if (!ownSkillsTags.has(tag)) {
          errors.push(`"${name}" must be listed in the skills list.`);
        }
        if (inProse.some((s) => s.has(tag))) {
          errors.push(
            `"${name}" belongs to the skills list only; it must not appear in bullets, projects, headline, summary or education.`,
          );
        }
        break;
      }
      case 'github_only': {
        if (
          anyRole.has(tag) ||
          anyProject.has(tag) ||
          ownSkillsTags.has(tag) ||
          ownProfileTags.has(tag) ||
          ownOtherTags.has(tag)
        ) {
          errors.push(
            `"${name}" must not appear anywhere in the CV (it is evidenced on GitHub only).`,
          );
        }
        break;
      }
    }
  }

  if (YEARS_CLAIM.test(`${cv.headline}\n${cv.summary}`)) {
    warnings.push('The headline or summary states years of experience.');
  }
  return { errors, warnings };
}

/** The repos the real fetcher puts in a snapshot, and which of them get a README. */
function visibleRepos(fixture: GithubFixture): GithubFixture['repos'] {
  return fixture.repos
    .filter((r) => !r.fork && !r.archived)
    .sort(
      (a, b) =>
        b.stargazers_count - a.stargazers_count ||
        (b.pushed_at ?? '').localeCompare(a.pushed_at ?? ''),
    )
    .slice(0, MAX_REPOS);
}

export function checkGithub(
  fixture: GithubFixture,
  persona: PersonaSpec,
  taxonomy: Taxonomy,
): DriftReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const label = labeller(taxonomy);
  const evidence = personaEvidence(persona, taxonomy);
  const ownLabels = new Set(
    taxonomy.tags.filter((t) => evidence.has(t.tag)).map((t) => t.label),
  );
  const allLabels = new Set(taxonomy.tags.map((t) => t.label));

  const { repos } = fixture;
  if (repos.length < REPOS_MIN || repos.length > REPOS_MAX) {
    errors.push(
      `Expected ${REPOS_MIN}-${REPOS_MAX} repos, got ${repos.length}.`,
    );
  }
  if (new Set(repos.map((r) => r.name.toLowerCase())).size !== repos.length) {
    errors.push('Repo names must be unique.');
  }
  for (const r of repos) {
    if (!REPO_NAME.test(r.name)) {
      errors.push(
        `Repo name "${r.name}" must be kebab-case letters, digits, "-", "." or "_" only.`,
      );
    }
    const readme = fixture.readmes[r.name];
    if (readme === undefined) {
      errors.push(`Repo "${r.name}" has no README.`);
    } else if (
      readme.length < README_MIN_CHARS ||
      readme.length > README_MAX_CHARS
    ) {
      errors.push(
        `README of "${r.name}" is ${readme.length} characters, expected 300-1500.`,
      );
    }
    if (r.language !== null && !ownLabels.has(r.language)) {
      errors.push(
        `Repo "${r.name}" has language "${r.language}", which is not one of the candidate's skills${allLabels.has(r.language) ? '' : ' (use a technology label from the list)'}.`,
      );
    }
  }

  const repoTags = (r: GithubFixture['repos'][number], withReadme: boolean) =>
    union([
      findTags(
        `${r.name.replace(/[-_.]/g, ' ')}\n${r.description ?? ''}`,
        taxonomy,
      ),
      ...(r.topics ?? []).map((t) => findTagsInTopic(t, taxonomy)),
      r.language ? findTags(r.language, taxonomy) : new Set<string>(),
      withReadme
        ? findTags(fixture.readmes[r.name] ?? '', taxonomy)
        : new Set<string>(),
    ]);

  const segments: Segment[] = [
    { where: 'bio', tags: findTags(fixture.user.bio ?? '', taxonomy) },
    ...repos.map((r) => ({
      where: `repo "${r.name}"`,
      tags: repoTags(r, true),
    })),
  ];
  errors.push(...leakErrors(segments, evidence, label, 'GitHub profile'));

  const visible = visibleRepos(fixture).map((r, i) =>
    repoTags(r, i < README_REPO_COUNT),
  );
  const visibleTags = union(visible);
  for (const [tag, ev] of evidence) {
    if (ev === 'github_only' && !visibleTags.has(tag)) {
      errors.push(
        `"${label(tag)}" must appear by name in the description, topics or language of one of the first ${MAX_REPOS} repos (or in the README of one of the first ${README_REPO_COUNT}).`,
      );
    }
  }
  const coversCv = [...evidence].some(
    ([tag, ev]) => ev === 'cv_role' && visibleTags.has(tag),
  );
  if (!coversCv && [...evidence.values()].includes('cv_role')) {
    warnings.push('No repo covers any of the candidate CV technologies.');
  }
  return { errors, warnings };
}

function union(sets: Set<string>[]): Set<string> {
  return new Set(sets.flatMap((s) => [...s]));
}

export interface VacancyRewrite {
  title: string;
  intro: string;
  requirements: { id: string; text: string }[];
}

/** Wording that offers technologies as alternatives (English or Ukrainian). */
const ALTERNATIVE_CUE =
  /\bor\b|\bsuch as\b|\be\.g\.|\bany of\b|\bone of\b|(?:^|\s)або(?:\s|$)/i;

export function checkVacancy(
  draft: VacancySpec,
  rewrite: VacancyRewrite,
  taxonomy: Taxonomy,
): DriftReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const label = labeller(taxonomy);
  const prose = proseTags(taxonomy);

  if (rewrite.title.trim() === '' || rewrite.intro.trim() === '') {
    errors.push('Title and intro must not be empty.');
  }
  const draftIds = draft.requirements.map((r) => r.id);
  const gotIds = rewrite.requirements.map((r) => r.id);
  const missing = draftIds.filter((id) => !gotIds.includes(id));
  const extra = gotIds.filter((id) => !draftIds.includes(id));
  if (
    missing.length > 0 ||
    extra.length > 0 ||
    new Set(gotIds).size !== gotIds.length
  ) {
    errors.push(
      `Requirement ids must match exactly (missing: ${missing.join(', ') || 'none'}; unexpected: ${extra.join(', ') || 'none'}; each id once).`,
    );
  }

  // Requirement text is about technology by construction, so ambiguous
  // aliases ("React", "Spark") need no context cue here.
  const tagsIn = (text: string): Set<string> =>
    findTags(text, taxonomy, { assumeTechContext: true });

  // Any one of a requirement's tags satisfies it, so the text only has to
  // name one of them. The candidates are the tags the draft text names (it
  // may name only some: "CI/CD pipelines" for ci-cd + github-actions); when
  // it names none, any of the requirement's tags.
  const alternatives = (req: VacancySpec['requirements'][number]): string[] => {
    const own = req.tags.filter((t) => prose.has(t));
    const named = tagsIn(req.text);
    const kept = own.filter((t) => named.has(t));
    return kept.length > 0 ? kept : own;
  };

  for (const req of draft.requirements) {
    const text = rewrite.requirements.find((r) => r.id === req.id)?.text;
    if (text === undefined) continue;
    const found = tagsIn(text);
    const drafted = tagsIn(req.text);
    const options = alternatives(req);
    if (options.length > 0 && !options.some((tag) => found.has(tag))) {
      errors.push(
        `${req.id}: the text must mention ${options
          .map((tag) => `"${label(tag)}"`)
          .join(' or ')} by name.`,
      );
    }
    for (const tag of found) {
      if (!req.tags.includes(tag) && !drafted.has(tag)) {
        errors.push(
          `${req.id}: the text mentions "${label(tag)}", which is not part of this requirement.`,
        );
      }
    }
    // The ground-truth rule counts any one tag as meeting the requirement, so
    // a text naming several must offer them as alternatives, not demand all.
    const named = req.tags.filter((tag) => found.has(tag));
    if (named.length >= 2 && !ALTERNATIVE_CUE.test(text)) {
      errors.push(
        `${req.id}: ${named
          .map((tag) => `"${label(tag)}"`)
          .join(
            ', ',
          )} are alternatives (any one is enough): join them with "or", never "and".`,
      );
    }
    if (
      req.minYears !== undefined &&
      !new RegExp(`(?<![0-9])${req.minYears}(?![0-9])`).test(text)
    ) {
      errors.push(
        `${req.id}: the text must state ${req.minYears} years as the digit "${req.minYears}".`,
      );
    }
    if (text.trim() === '') errors.push(`${req.id}: the text is empty.`);
  }

  const allReqTags = new Set(draft.requirements.flatMap((r) => r.tags));
  for (const tag of findTags(`${rewrite.title}\n${rewrite.intro}`, taxonomy)) {
    if (!allReqTags.has(tag)) {
      warnings.push(
        `Title or intro mentions "${label(tag)}", not a requirement.`,
      );
    }
  }
  return { errors, warnings };
}
