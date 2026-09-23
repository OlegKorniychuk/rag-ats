import type {
  Candidate,
  NewCandidate,
} from '../db/repositories/candidates.repository.js';
import type { SubmitApplicationDto } from './dto/submit-application.dto.js';

export type CandidateSubmission = Omit<SubmitApplicationDto, 'email'>;

function mergeSkills(existingSkills: string[], newSkills: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  // existing entries come first, so a later duplicate (case-insensitive) is
  // dropped and the first-seen (existing) casing is what survives
  for (const skill of [...existingSkills, ...newSkills]) {
    const trimmed = skill.trim();
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function mergeProjects(
  existingProjects: string[],
  newProjects: string[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const project of [...existingProjects, ...newProjects]) {
    const trimmed = project.trim();
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

function mergeExperience(
  existingExperience: string,
  newExperience: string,
): string {
  const trimmedNew = newExperience.trim();

  // exact block match, not substring - a short submission that merely prefixes
  // an existing block must still be appended
  const blocks = existingExperience.split('\n\n').map((block) => block.trim());
  if (blocks.includes(trimmedNew)) {
    return existingExperience;
  }

  return `${existingExperience}\n\n${trimmedNew}`;
}

export function mergeCandidateProfile(
  existing: Candidate,
  submission: CandidateSubmission,
): Partial<NewCandidate> {
  return {
    name: submission.name,
    summary: submission.summary,
    skills: mergeSkills(existing.skills, submission.skills),
    projects: mergeProjects(existing.projects, submission.projects),
    experience: mergeExperience(existing.experience, submission.experience),
    githubUrl: submission.githubUrl ?? existing.githubUrl,
    portfolioUrl: submission.portfolioUrl ?? existing.portfolioUrl,
  };
}
