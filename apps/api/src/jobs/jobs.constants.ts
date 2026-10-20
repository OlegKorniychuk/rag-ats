export const PARSE_CANDIDATE_QUEUE = 'parse-candidate';

export interface ParseCandidateJob {
  candidateId: string;
  cvDocumentId: string;
}

export const EXTRACT_VACANCY_CRITERIA_QUEUE = 'extract-vacancy-criteria';

export interface ExtractVacancyCriteriaJob {
  vacancyId: string;
}

export const SCORE_APPLICATION_QUEUE = 'score-application';

export interface ScoreApplicationJob {
  applicationId: string;
}
