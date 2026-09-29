import type {
  CreateVacancyRequest,
  UpdateVacancyRequest,
} from '@rag-ats/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createVacancy,
  getVacancy,
  listVacancies,
  updateVacancy,
} from '../api/vacancies';

export const vacancyKeys = {
  all: ['vacancies'] as const,
  detail: (id: string) => ['vacancies', id] as const,
  applications: (id: string) => ['vacancies', id, 'applications'] as const,
};

export function useVacancies() {
  return useQuery({ queryKey: vacancyKeys.all, queryFn: listVacancies });
}

export function useVacancy(id: string) {
  return useQuery({
    queryKey: vacancyKeys.detail(id),
    queryFn: () => getVacancy(id),
  });
}

export function useCreateVacancy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateVacancyRequest) => createVacancy(body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: vacancyKeys.all }),
  });
}

export function useUpdateVacancy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateVacancyRequest }) =>
      updateVacancy(id, body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: vacancyKeys.all }),
  });
}
