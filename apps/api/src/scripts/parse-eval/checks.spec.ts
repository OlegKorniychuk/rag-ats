import type { ParsedProfile } from '../../llm/cv-profile.schema.js';
import { allChecksFailed, runChecks } from './checks.js';
import type { CvExpectations } from './manifest.js';

const profile: ParsedProfile = {
  skills: ['TypeScript', 'React', 'PostgreSQL'],
  experience: 'Frontend Developer at Acme Corp, 2021-2024',
  projects: ['Pixel Board - collaborative whiteboard'],
  summary: 'A frontend engineer who loves Rust.',
};

const none: CvExpectations = {
  mustHaveSkills: [],
  forbiddenInSkills: [],
  expectedProjects: [],
  expectedEmployers: [],
  experienceMustMention: [],
  forbiddenInProjects: [],
  forbiddenAnywhere: [],
};

describe('runChecks', () => {
  it('returns 0/0 for empty expectations', () => {
    expect(runChecks(profile, none)).toEqual({
      results: [],
      passed: 0,
      total: 0,
    });
  });

  it('mustHaveSkills passes and fails', () => {
    const s = runChecks(profile, {
      ...none,
      mustHaveSkills: ['react', 'Kubernetes'],
    });
    expect(s.results).toEqual([
      { kind: 'mustHaveSkills', target: 'react', passed: true },
      { kind: 'mustHaveSkills', target: 'Kubernetes', passed: false },
    ]);
    expect([s.passed, s.total]).toEqual([1, 2]);
  });

  it('uses substring semantics on skills entries', () => {
    const s = runChecks(profile, { ...none, mustHaveSkills: ['script'] });
    expect(s.passed).toBe(1);
  });

  it('forbiddenInSkills passes when absent and fails when present', () => {
    const s = runChecks(profile, {
      ...none,
      forbiddenInSkills: ['Teacher', 'POSTGRES'],
    });
    expect(s.results.map((r) => r.passed)).toEqual([true, false]);
  });

  it('forbiddenInSkills ignores other fields', () => {
    const s = runChecks(profile, { ...none, forbiddenInSkills: ['Acme'] });
    expect(s.passed).toBe(1);
  });

  it('expectedProjects checks the projects list only', () => {
    const s = runChecks(profile, {
      ...none,
      expectedProjects: ['pixel board', 'Acme'],
    });
    expect(s.results.map((r) => r.passed)).toEqual([true, false]);
  });

  it('expectedEmployers checks experience, case-insensitively', () => {
    const s = runChecks(profile, {
      ...none,
      expectedEmployers: ['acme corp', 'Globex'],
    });
    expect(s.results.map((r) => r.passed)).toEqual([true, false]);
  });

  it('experienceMustMention checks experience, case-insensitively', () => {
    const s = runChecks(profile, {
      ...none,
      experienceMustMention: ['ACME', '40%'],
    });
    expect(s.results.map((r) => r.passed)).toEqual([true, false]);
  });

  it('forbiddenInProjects fails when any project contains the phrase', () => {
    const s = runChecks(profile, {
      ...none,
      forbiddenInProjects: ['whiteboard', 'on-call'],
    });
    expect(s.results.map((r) => r.passed)).toEqual([false, true]);
  });

  it('forbiddenAnywhere looks in skills, projects, experience and summary', () => {
    const s = runChecks(profile, {
      ...none,
      forbiddenAnywhere: ['postgresql', 'whiteboard', '2021', 'rust', 'cobol'],
    });
    expect(s.results.map((r) => r.passed)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
    expect([s.passed, s.total]).toEqual([1, 5]);
  });
});

describe('allChecksFailed', () => {
  it('marks every expectation as failed', () => {
    const s = allChecksFailed({
      ...none,
      mustHaveSkills: ['a'],
      forbiddenAnywhere: ['b'],
    });
    expect(s.results).toEqual([
      { kind: 'mustHaveSkills', target: 'a', passed: false },
      { kind: 'forbiddenAnywhere', target: 'b', passed: false },
    ]);
    expect([s.passed, s.total]).toEqual([0, 2]);
  });
});
