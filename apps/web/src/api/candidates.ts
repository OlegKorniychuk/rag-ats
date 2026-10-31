import type {
  CandidateApplicationResponse,
  CandidateResponse,
} from '@rag-ats/shared';
import { apiFetch } from './client';

export const listCandidates = () =>
  apiFetch<CandidateResponse[]>('/candidates');

export const getCandidate = (id: string) =>
  apiFetch<CandidateResponse>(`/candidates/${encodeURIComponent(id)}`);

export const reparseCandidate = (id: string) =>
  apiFetch<CandidateResponse>(`/candidates/${encodeURIComponent(id)}/reparse`, {
    method: 'POST',
  });

export const listCandidateApplications = (id: string) =>
  apiFetch<CandidateApplicationResponse[]>(
    `/candidates/${encodeURIComponent(id)}/applications`,
  );
