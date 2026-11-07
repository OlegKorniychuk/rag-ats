import type {
  ApplicationStage,
  ApplicationWithCandidateResponse,
} from '@rag-ats/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addCandidateToVacancy, getVacancyMatches } from '../api/vacancies';
import {
  listVacancyApplications,
  rescoreApplication,
  updateApplicationStage,
} from '../api/applications';
import {
  hasParseInFlight,
  PARSE_POLL_INTERVAL_MS,
} from '../candidates/parseStatus';
import { hasScoreInFlight, SCORE_POLL_INTERVAL_MS } from './score';
import { candidateKeys } from '../candidates/queries';
import { vacancyKeys } from '../vacancies/queries';

export function useVacancyApplications(vacancyId: string) {
  return useQuery({
    queryKey: vacancyKeys.applications(vacancyId),
    queryFn: () => listVacancyApplications(vacancyId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (hasParseInFlight(data?.map((a) => a.candidate))) {
        return PARSE_POLL_INTERVAL_MS;
      }
      return hasScoreInFlight(data) ? SCORE_POLL_INTERVAL_MS : false;
    },
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

export function useRescoreApplication(vacancyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rescoreApplication(id),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: vacancyKeys.applications(vacancyId),
      }),
  });
}

// Matches cost an embeddings call (and maybe a criteria extraction): keep them
// fresh for a minute and only fetch while the drawer is open.
export function useVacancyMatches(
  vacancyId: string,
  { enabled }: { enabled: boolean },
) {
  return useQuery({
    queryKey: vacancyKeys.matches(vacancyId),
    queryFn: () => getVacancyMatches(vacancyId),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

// `onAdded` runs on the mutation itself: the matches refetch removes the card
// (and its component) before a mutate-level callback could fire.
export function useAddMatch(vacancyId: string, onAdded?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (candidateId: string) =>
      addCandidateToVacancy(vacancyId, candidateId),
    onSuccess: (_data, candidateId) => {
      onAdded?.();
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: vacancyKeys.applications(vacancyId),
        }),
        queryClient.invalidateQueries({
          queryKey: vacancyKeys.matches(vacancyId),
        }),
        queryClient.invalidateQueries({
          queryKey: candidateKeys.applications(candidateId),
        }),
      ]);
    },
  });
}
