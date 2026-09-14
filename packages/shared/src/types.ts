export interface Recruiter {
  id: string;
  email: string;
  createdAt: string;
}

export type ApplicationStage =
  'applied' | 'screened' | 'interview' | 'rejected' | 'hired';

export type VacancyStatus = 'open' | 'closed';

export interface Vacancy {
  id: string;
  recruiterId: string;
  title: string;
  requirements: string;
  applyToken: string;
  status: VacancyStatus;
  createdAt: string;
}

export interface CandidateProfile {
  skills: string[];
  experience: string;
  projects: string[];
  summary: string;
}

export interface Candidate {
  id: string;
  name: string;
  email: string;
  githubUrl?: string;
  portfolioUrl?: string;
  profile: CandidateProfile;
  createdAt: string;
}

export interface Application {
  id: string;
  vacancyId: string;
  candidateId: string;
  stage: ApplicationStage;
  createdAt: string;
}

export interface ScoreResult {
  score: number;
  citedSnippet: string;
  explanation: string;
}
