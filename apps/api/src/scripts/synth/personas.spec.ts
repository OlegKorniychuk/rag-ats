import { computeGroundTruth } from './ground-truth.js';
import { loadDraftData } from './test-data.js';
import {
  buildPersonas,
  DistributionError,
  generatePersonas,
} from './personas.js';
import { monthIndex, monthsToYears, roleMonths } from './timeline.js';
import type { PersonaSpec, Taxonomy, VacancySpec } from './types.js';

let taxonomy: Taxonomy;
let vacancies: VacancySpec[];
let personas: PersonaSpec[];

beforeAll(async () => {
  ({ taxonomy, vacancies } = await loadDraftData());
  personas = generatePersonas(taxonomy, vacancies, 1).personas;
});

describe('generatePersonas', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    expect(generatePersonas(taxonomy, vacancies, 1).personas).toEqual(personas);
    expect(buildPersonas(taxonomy, vacancies, 2)).not.toEqual(
      buildPersonas(taxonomy, vacancies, 3),
    );
  });

  it('produces the planned population', () => {
    expect(personas).toHaveLength(100);
    const targeted = personas.filter((p) => p.kind === 'targeted');
    expect(targeted).toHaveLength(80);
    for (const v of vacancies) {
      for (const band of ['strong', 'partial']) {
        expect(
          targeted.filter(
            (p) => p.target?.vacancyId === v.id && p.target.band === band,
          ),
        ).toHaveLength(4);
      }
    }
    const off = personas.filter((p) => p.kind === 'off_target');
    expect(off).toHaveLength(20);
    const flagCount = (flag: string) =>
      off.filter((p) => p.flags.includes(flag as never)).length;
    expect(flagCount('keyword_stuffer')).toBe(3);
    expect(flagCount('injection')).toBe(2);
    expect(flagCount('career_switcher')).toBe(5);
    expect(flagCount('bootcamp')).toBe(5);
    expect(flagCount('adjacent')).toBe(5);
    expect(off.every((p) => p.target === undefined)).toBe(true);
  });

  it('spreads languages, layouts and GitHub profiles', () => {
    expect(personas.filter((p) => p.language === 'uk')).toHaveLength(5);
    for (const layout of ['1-col', '2-col', 'compact']) {
      expect(
        personas.filter((p) => p.layout === layout).length,
      ).toBeGreaterThanOrEqual(33);
    }
    expect(personas.filter((p) => p.github !== null)).toHaveLength(40);
  });

  it('has unique ids, emails and GitHub usernames in the documented shape', () => {
    const unique = (values: string[]) => new Set(values).size === values.length;
    expect(unique(personas.map((p) => p.id))).toBe(true);
    expect(unique(personas.map((p) => p.email))).toBe(true);
    const usernames = personas.flatMap((p) =>
      p.github ? [p.github.username] : [],
    );
    expect(unique(usernames)).toBe(true);
    for (const p of personas) {
      expect(p.email).toMatch(/^[a-z0-9-]+@example\.com$/);
      if (p.github) expect(p.github.username).toMatch(/^synth-[a-z0-9-]+$/);
    }
  });

  it('only gives github_only skills to personas with a GitHub profile', () => {
    for (const p of personas) {
      if (p.skills.some((s) => s.evidence === 'github_only')) {
        expect(p.github).not.toBeNull();
      }
    }
  });

  it('has github_only key evidence for several targeted personas per vacancy', () => {
    for (const v of vacancies) {
      const probes = personas.filter(
        (p) =>
          p.target?.vacancyId === v.id &&
          p.skills.some((s) => s.evidence === 'github_only'),
      );
      expect(probes.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps github_only tags out of the CV and gives stuffers skills-only tags', () => {
    for (const p of personas) {
      const cvTags = new Set([
        ...p.roles.flatMap((r) => r.tags),
        ...p.projects.flatMap((pr) => pr.tags),
      ]);
      for (const s of p.skills) {
        const inCv = cvTags.has(s.tag);
        expect(inCv).toBe(
          s.evidence === 'cv_role' || s.evidence === 'cv_project',
        );
      }
      if (p.flags.includes('keyword_stuffer')) {
        expect(
          p.skills.filter((s) => s.evidence === 'cv_skills_only').length,
        ).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('derives cv_role years from the timeline and gives other evidence none', () => {
    for (const p of personas) {
      for (const s of p.skills) {
        if (s.evidence === 'cv_role') {
          const months = p.roles
            .filter((r) => r.tags.includes(s.tag))
            .reduce((sum, r) => sum + roleMonths(r), 0);
          expect(s.years).toBe(monthsToYears(months));
          expect(months).toBeGreaterThan(0);
        } else if (s.evidence !== 'github_only') {
          expect(s.years).toBe(0);
        } else {
          expect(s.years).toBeGreaterThan(0);
        }
      }
    }
  });

  it('builds plausible timelines ending by 2026-10', () => {
    for (const p of personas) {
      expect(p.roles.length).toBeGreaterThan(0);
      p.roles.forEach((r, i) => {
        expect(roleMonths(r)).toBeGreaterThan(0);
        if (r.end)
          expect(monthIndex(r.end)).toBeLessThanOrEqual(monthIndex('2026-10'));
        if (i > 0) {
          expect(monthIndex(r.start)).toBeGreaterThanOrEqual(
            monthIndex(p.roles[i - 1].end!),
          );
        }
      });
      expect(p.roles.slice(0, -1).every((r) => r.end !== null)).toBe(true);
    }
  });

  it('uses only taxonomy tags and valid vacancy ids', () => {
    const known = new Set(taxonomy.tags.map((t) => t.tag));
    const ids = new Set(vacancies.map((v) => v.id));
    for (const p of personas) {
      for (const s of p.skills) expect(known.has(s.tag)).toBe(true);
      for (const id of p.applyTo) expect(ids.has(id)).toBe(true);
    }
  });

  it('sizes applyTo: targeted 2-3 including the target, off-target 1-2', () => {
    for (const p of personas) {
      expect(new Set(p.applyTo).size).toBe(p.applyTo.length);
      if (p.kind === 'targeted') {
        expect(p.applyTo.length).toBeGreaterThanOrEqual(2);
        expect(p.applyTo.length).toBeLessThanOrEqual(3);
        expect(p.applyTo).toContain(p.target!.vacancyId);
      } else {
        expect(p.applyTo.length).toBeGreaterThanOrEqual(1);
        expect(p.applyTo.length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('mostly hits the targeted band (the rule always has the final say)', () => {
    const gt = computeGroundTruth(personas, vacancies);
    const targeted = personas.filter((p) => p.target);
    const hits = targeted.filter(
      (p) =>
        gt.pairs.find(
          (x) => x.personaId === p.id && x.vacancyId === p.target!.vacancyId,
        )?.band === p.target!.band,
    );
    expect(hits.length / targeted.length).toBeGreaterThan(0.9);
  });

  it('passes the distribution guard on the draft vacancies', () => {
    const result = generatePersonas(taxonomy, vacancies, 1);
    expect(result.attempts).toBeGreaterThanOrEqual(1);
    expect(result.seed).toBe(1 + result.attempts - 1);
  });

  it('retries with the next seed when the guard fails', () => {
    const real = buildPersonas(taxonomy, vacancies, 1);
    const seen: number[] = [];
    const result = generatePersonas(taxonomy, vacancies, 10, {
      build: (t, v, seed) => {
        seen.push(seed);
        return seed === 12 ? real : [];
      },
    });
    expect(seen).toEqual([10, 11, 12]);
    expect(result).toMatchObject({ seed: 12, attempts: 3 });
  });

  it('throws a clear error when no seed can satisfy the guard', () => {
    const impossible = vacancies.map((v, i) =>
      i === 0
        ? {
            ...v,
            requirements: [
              {
                id: 'x',
                text: 'x',
                kind: 'must' as const,
                tags: ['git'],
                minYears: 50,
              },
            ],
          }
        : v,
    );
    expect(() =>
      generatePersonas(taxonomy, impossible, 1, { maxAttempts: 2 }),
    ).toThrow(DistributionError);
    expect(() =>
      generatePersonas(taxonomy, impossible, 1, { maxAttempts: 2 }),
    ).toThrow(/seeds 1\.\.2.*strong/);
  });
});
