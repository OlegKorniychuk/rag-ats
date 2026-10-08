import type { CandidateResponse } from '@rag-ats/shared';
import { apiFetch } from './client';

export const listCandidates = () =>
  apiFetch<CandidateResponse[]>('/candidates');

export const getCandidate = (id: string) =>
  apiFetch<CandidateResponse>(`/candidates/${encodeURIComponent(id)}`);

export const reparseCandidate = (id: string) =>
  apiFetch<CandidateResponse>(`/candidates/${encodeURIComponent(id)}/reparse`, {
    method: 'POST',
  });
