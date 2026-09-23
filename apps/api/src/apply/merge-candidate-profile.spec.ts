import type { Candidate } from '../db/repositories/candidates.repository.js';
import {
  mergeCandidateProfile,
  type CandidateSubmission,
} from './merge-candidate-profile.js';

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'candidate-id',
    name: 'Existing Name',
    email: 'existing@example.com',
    githubUrl: 'https://github.com/existing',
    portfolioUrl: 'https://existing.dev',
    skills: ['TypeScript', 'Node.js'],
    experience: 'Existing experience block',
    projects: ['Project A'],
    summary: 'Existing summary',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeSubmission(
  overrides: Partial<CandidateSubmission> = {},
): CandidateSubmission {
  return {
    name: 'New Name',
    skills: ['New Skill'],
    experience: 'New experience block',
    projects: ['Project B'],
    summary: 'New summary',
    ...overrides,
  };
}

describe('mergeCandidateProfile', () => {
  describe('skills', () => {
    it('unions skills, existing first, then new ones', () => {
      const existing = makeCandidate({ skills: ['TypeScript', 'Node.js'] });
      const submission = makeSubmission({ skills: ['Node.js', 'PostgreSQL'] });

      const patch = mergeCandidateProfile(existing, submission);

      expect(patch.skills).toEqual(['TypeScript', 'Node.js', 'PostgreSQL']);
    });

    it('dedupes case-insensitively after trim, keeping existing casing', () => {
      const existing = makeCandidate({ skills: ['TypeScript'] });
      const submission = makeSubmission({
        skills: ['  typescript  ', 'TYPESCRIPT'],
      });

      const patch = mergeCandidateProfile(existing, submission);

      expect(patch.skills).toEqual(['TypeScript']);
    });
  });

  describe('projects', () => {
    it('unions projects, existing first, then new ones', () => {
      const existing = makeCandidate({ projects: ['Project A'] });
      const submission = makeSubmission({ projects: ['Project B'] });

      const patch = mergeCandidateProfile(existing, submission);

      expect(patch.projects).toEqual(['Project A', 'Project B']);
    });

    it('dedupes exact matches after trim, case-sensitively', () => {
      const existing = makeCandidate({ projects: ['Project A'] });
      const submission = makeSubmission({
        projects: ['  Project A  ', 'project a'],
      });

      const patch = mergeCandidateProfile(existing, submission);

      expect(patch.projects).toEqual(['Project A', 'project a']);
    });

    it('allows an empty projects submission', () => {
      const existing = makeCandidate({ projects: ['Project A'] });
      const submission = makeSubmission({ projects: [] });

      const patch = mergeCandidateProfile(existing, submission);

      expect(patch.projects).toEqual(['Project A']);
    });
  });

  describe('experience', () => {
    it('appends the new experience block after the existing one', () => {
      const existing = makeCandidate({ experience: 'Existing block' });
      const submission = makeSubmission({ experience: 'New block' });

      const patch = mergeCandidateProfile(existing, submission);

      expect(patch.experience).toBe('Existing block\n\nNew block');
    });

    it('keeps existing unchanged when new text equals existing (trimmed)', () => {
      const existing = makeCandidate({ experience: 'Same block' });
      const submission = makeSubmission({ experience: '  Same block  ' });

      const patch = mergeCandidateProfile(existing, submission);

      expect(patch.experience).toBe('Same block');
    });

    it('keeps existing unchanged when the block was already appended before', () => {
      const existing = makeCandidate({
        experience: 'Existing block\n\nAlready appended block',
      });
      const submission = makeSubmission({
        experience: '  Already appended block  ',
      });

      const patch = mergeCandidateProfile(existing, submission);

      expect(patch.experience).toBe('Existing block\n\nAlready appended block');
    });

    it('keeps existing unchanged when new text matches the first block', () => {
      const existing = makeCandidate({
        experience: 'First block\n\nSecond block',
      });
      const submission = makeSubmission({ experience: 'First block' });

      const patch = mergeCandidateProfile(existing, submission);

      expect(patch.experience).toBe('First block\n\nSecond block');
    });

    it('appends a new block that is only a prefix of an existing block', () => {
      const existing = makeCandidate({
        experience: 'First block\n\nNode.js at Acme 2020-2023',
      });
      const submission = makeSubmission({ experience: 'Node.js' });

      const patch = mergeCandidateProfile(existing, submission);

      expect(patch.experience).toBe(
        'First block\n\nNode.js at Acme 2020-2023\n\nNode.js',
      );
    });
  });

  describe('summary and name', () => {
    it('overwrites name and summary with the latest submission', () => {
      const existing = makeCandidate({
        name: 'Old Name',
        summary: 'Old summary',
      });
      const submission = makeSubmission({
        name: 'New Name',
        summary: 'New summary',
      });

      const patch = mergeCandidateProfile(existing, submission);

      expect(patch.name).toBe('New Name');
      expect(patch.summary).toBe('New summary');
    });
  });

  describe('githubUrl and portfolioUrl', () => {
    it('overwrites when provided in the submission', () => {
      const existing = makeCandidate({
        githubUrl: 'https://github.com/old',
        portfolioUrl: 'https://old.dev',
      });
      const submission = makeSubmission({
        githubUrl: 'https://github.com/new',
        portfolioUrl: 'https://new.dev',
      });

      const patch = mergeCandidateProfile(existing, submission);

      expect(patch.githubUrl).toBe('https://github.com/new');
      expect(patch.portfolioUrl).toBe('https://new.dev');
    });

    it('keeps existing values when not provided in the submission', () => {
      const existing = makeCandidate({
        githubUrl: 'https://github.com/old',
        portfolioUrl: 'https://old.dev',
      });
      const submission = makeSubmission({
        githubUrl: undefined,
        portfolioUrl: undefined,
      });

      const patch = mergeCandidateProfile(existing, submission);

      expect(patch.githubUrl).toBe('https://github.com/old');
      expect(patch.portfolioUrl).toBe('https://old.dev');
    });
  });
});
