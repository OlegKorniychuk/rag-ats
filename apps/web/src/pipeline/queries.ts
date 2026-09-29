import type {
  ApplicationStage,
  ApplicationWithCandidateResponse,
} from '@rag-ats/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listVacancyApplications,
  updateApplicationStage,
} from '../api/applications';
import { vacancyKeys } from '../vacancies/queries';

export function useVacancyApplications(vacancyId: string) {
  return useQuery({
    queryKey: vacancyKeys.applications(vacancyId),
    queryFn: () => listVacancyApplications(vacancyId),
  });
}

export function useUpdateApplicationStage(vacancyId: string) {
  const queryClient = useQueryClient();
  const queryKey = vacancyKeys.applications(vacancyId);
  return useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: ApplicationStage }) =>
      updateApplicationStage(id, stage),
    onMutate: async ({ id, stage }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous =
        queryClient.getQueryData<ApplicationWithCandidateResponse[]>(queryKey);
      if (previous) {
        queryClient.setQueryData<ApplicationWithCandidateResponse[]>(
          queryKey,
          previous.map((application) =>
            application.id === id ? { ...application, stage } : application,
          ),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
}
