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
  values: SubmitApplicationRequest & { cv: File },
) => {
  const body = new FormData();
  body.append('name', values.name);
  body.append('email', values.email);
  if (values.githubUrl) body.append('githubUrl', values.githubUrl);
  if (values.portfolioUrl) body.append('portfolioUrl', values.portfolioUrl);
  body.append('cv', values.cv, values.cv.name);
  return apiFetch<SuccessResponse>(`/apply/${encodeURIComponent(token)}`, {
    method: 'POST',
    body,
  });
};
