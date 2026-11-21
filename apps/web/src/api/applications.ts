import type {
  ApplicationQuestions,
  ApplicationResponse,
  ApplicationStage,
  ApplicationWithCandidateResponse,
  GenerateQuestionsResponse,
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

export const getApplicationQuestions = (id: string) =>
  apiFetch<ApplicationQuestions>(`/applications/${id}/questions`);

export const generateApplicationQuestions = (id: string) =>
  apiFetch<GenerateQuestionsResponse>(`/applications/${id}/questions`, {
    method: 'POST',
  });
