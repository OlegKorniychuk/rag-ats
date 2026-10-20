import type { ParsedProfile } from '../../llm/cv-profile.schema.js';
import type { CvExpectations } from './manifest.js';

export type CheckKind = keyof CvExpectations;

export interface CheckResult {
  kind: CheckKind;
  target: string;
  passed: boolean;
}

export interface CheckSummary {
  results: CheckResult[];
  passed: number;
  total: number;
}

const has = (haystack: string, needle: string): boolean =>
  haystack.toLowerCase().includes(needle.toLowerCase());

const anyHas = (items: string[], needle: string): boolean =>
  items.some((item) => has(item, needle));

function summarise(results: CheckResult[]): CheckSummary {
  return {
    results,
    passed: results.filter((r) => r.passed).length,
    total: results.length,
  };
}

/** All checks case-insensitive substring matches. */
export function runChecks(
  profile: ParsedProfile,
  expect: CvExpectations,
): CheckSummary {
  const results: CheckResult[] = [];

  for (const target of expect.mustHaveSkills) {
    results.push({
      kind: 'mustHaveSkills',
      target,
      passed: anyHas(profile.skills, target),
    });
  }
  for (const target of expect.forbiddenInSkills) {
    results.push({
      kind: 'forbiddenInSkills',
      target,
      passed: !anyHas(profile.skills, target),
    });
  }
  for (const target of expect.expectedProjects) {
    results.push({
      kind: 'expectedProjects',
      target,
      passed: anyHas(profile.projects, target),
    });
  }
  for (const target of expect.expectedEmployers) {
    results.push({
      kind: 'expectedEmployers',
      target,
      passed: has(profile.experience, target),
    });
  }
  for (const target of expect.experienceMustMention) {
    results.push({
      kind: 'experienceMustMention',
      target,
      passed: has(profile.experience, target),
    });
  }
  for (const target of expect.forbiddenInProjects) {
    results.push({
      kind: 'forbiddenInProjects',
      target,
      passed: !anyHas(profile.projects, target),
    });
  }
  for (const target of expect.forbiddenAnywhere) {
    const found =
      anyHas(profile.skills, target) ||
      anyHas(profile.projects, target) ||
      has(profile.experience, target) ||
      has(profile.summary, target);
    results.push({ kind: 'forbiddenAnywhere', target, passed: !found });
  }

  return summarise(results);
}

/** Every check marked failed; used when a run produced no profile at all. */
export function allChecksFailed(expect: CvExpectations): CheckSummary {
  const results: CheckResult[] = [];
  for (const kind of Object.keys(expect) as CheckKind[]) {
    for (const target of expect[kind]) {
      results.push({ kind, target, passed: false });
    }
  }
  return summarise(results);
}
