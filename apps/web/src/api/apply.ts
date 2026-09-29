import type {
  PublicVacancyResponse,
  SubmitApplicationRequest,
  SuccessResponse,
} from '@rag-ats/shared';
import { apiFetch } from './client';

export const getPublicVacancy = (token: string) =>
  apiFetch<PublicVacancyResponse>(`/apply/${encodeURIComponent(token)}`);

export const submitApplication = (
  token: string,
  body: SubmitApplicationRequest,
) =>
  apiFetch<SuccessResponse>(`/apply/${encodeURIComponent(token)}`, {
    method: 'POST',
    json: body,
  });
