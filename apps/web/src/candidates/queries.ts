import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addCandidateToVacancy } from '../api/vacancies';
import {
  getCandidate,
  listCandidateApplications,
  listCandidates,
  reparseCandidate,
} from '../api/candidates';
import { vacancyKeys } from '../vacancies/queries';
import { hasScoreInFlight, SCORE_POLL_INTERVAL_MS } from '../pipeline/score';
import { hasParseInFlight, PARSE_POLL_INTERVAL_MS } from './parseStatus';

export const candidateKeys = {
  all: ['candidates'] as const,
  detail: (id: string) => ['candidates', id] as const,
  applications: (id: string) => ['candidates', id, 'applications'] as const,
};

export function useCandidates() {
  return useQuery({
    queryKey: candidateKeys.all,
    queryFn: listCandidates,
    refetchInterval: (query) =>
      hasParseInFlight(query.state.data) ? PARSE_POLL_INTERVAL_MS : false,
  });
}

export function useCandidate(id: string) {
  return useQuery({
    queryKey: candidateKeys.detail(id),
    queryFn: () => getCandidate(id),
    refetchInterval: (query) =>
      query.state.data && hasParseInFlight([query.state.data])
        ? PARSE_POLL_INTERVAL_MS
        : false,
  });
}

// Scores of a candidate that is still parsing are already pending, so polling
// on score progress alone also covers the parse.
export function useCandidateApplications(id: string) {
  return useQuery({
    queryKey: candidateKeys.applications(id),
    queryFn: () => listCandidateApplications(id),
    refetchInterval: (query) =>
      hasScoreInFlight(query.state.data) ? SCORE_POLL_INTERVAL_MS : false,
  });
}

export function useReparseCandidate(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => reparseCandidate(id),
    onSuccess: (data) => {
      queryClient.setQueryData(candidateKeys.detail(id), data);
      void queryClient.invalidateQueries({ queryKey: candidateKeys.all });
      // vacancy application lists embed the candidate (and its parse status)
      void queryClient.invalidateQueries({
        predicate: ({ queryKey }) =>
          queryKey[0] === 'vacancies' && queryKey[2] === 'applications',
      });
    },
  });
}

export function useAddCandidateToVacancy(candidateId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vacancyId: string) =>
      addCandidateToVacancy(vacancyId, candidateId),
    onSuccess: (_data, vacancyId) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: candidateKeys.applications(candidateId),
        }),
        queryClient.invalidateQueries({
          queryKey: vacancyKeys.applications(vacancyId),
        }),
      ]),
  });
}
