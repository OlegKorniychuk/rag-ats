import type {
  ApplicationResponse,
  ApplicationStage,
  ApplicationWithCandidateResponse,
  RescoreResponse,
  UpdateApplicationRequest,
} from '@rag-ats/shared';
import { apiFetch } from './client';

export const listVacancyApplications = (vacancyId: string) =>
  apiFetch<ApplicationWithCandidateResponse[]>(
    `/vacancies/${vacancyId}/applications`,
  );

export const updateApplicationStage = (id: string, stage: ApplicationStage) =>
  apiFetch<ApplicationResponse>(`/applications/${id}`, {
    method: 'PATCH',
    json: { stage } satisfies UpdateApplicationRequest,
  });

export const rescoreApplication = (id: string) =>
  apiFetch<RescoreResponse>(`/applications/${id}/rescore`, { method: 'POST' });
