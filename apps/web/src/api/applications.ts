import type {
  ApplicationResponse,
  ApplicationStage,
  ApplicationWithCandidateResponse,
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
