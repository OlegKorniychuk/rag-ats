import type {
  CreateVacancyRequest,
  UpdateVacancyRequest,
  VacancyResponse,
} from '@rag-ats/shared';
import { apiFetch } from './client';

export const listVacancies = () => apiFetch<VacancyResponse[]>('/vacancies');

export const createVacancy = (body: CreateVacancyRequest) =>
  apiFetch<VacancyResponse>('/vacancies', { method: 'POST', json: body });

export const updateVacancy = (id: string, body: UpdateVacancyRequest) =>
  apiFetch<VacancyResponse>(`/vacancies/${id}`, {
    method: 'PATCH',
    json: body,
  });
