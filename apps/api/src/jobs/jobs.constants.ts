export const PARSE_CANDIDATE_QUEUE = 'parse-candidate';

export interface ParseCandidateJob {
  candidateId: string;
  cvDocumentId: string;
}
