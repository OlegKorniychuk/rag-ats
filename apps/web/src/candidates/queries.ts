import type { CandidateResponse } from '@rag-ats/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addCandidateToVacancy } from '../api/vacancies';
import {
  getCandidate,
  listCandidateApplications,
  listCandidates,
  reparseCandidate,
  searchCandidates,
} from '../api/candidates';
import { vacancyKeys } from '../vacancies/queries';
import { hasScoreInFlight, SCORE_POLL_INTERVAL_MS } from '../pipeline/score';
import { hasParseInFlight, PARSE_POLL_INTERVAL_MS } from './parseStatus';

export const candidateKeys = {
  all: ['candidates'] as const,
  detail: (id: string) => ['candidates', id] as const,
  applications: (id: string) => ['candidates', id, 'applications'] as const,
  search: (query: string) => ['candidates', 'search', query] as const,
};

export function useCandidates() {
  return useQuery({
    queryKey: candidateKeys.all,
    queryFn: listCandidates,
    refetchInterval: (query) =>
      hasParseInFlight(query.state.data) ? PARSE_POLL_INTERVAL_MS : false,
  });
}

// An unchanged query is not re-embedded: keep results fresh for a minute.
export function useCandidateSearch(query: string) {
  return useQuery({
    queryKey: candidateKeys.search(query),
    queryFn: () => searchCandidates(query),
    enabled: query !== '',
    staleTime: 60_000,
    refetchOnWindowFocus: false,
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
// on score progress alone also covers the parse. The rows don't carry the
// candidate, so its parse status comes from the cached detail query (the
// candidate page always loads it): a score waiting on a failed parse can't
// progress, so it doesn't keep the polling going.
export function useCandidateApplications(id: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: candidateKeys.applications(id),
    queryFn: () => listCandidateApplications(id),
    refetchInterval: (query) => {
      const parseStatus = queryClient.getQueryData<CandidateResponse>(
        candidateKeys.detail(id),
      )?.parseStatus;
      const rows = query.state.data?.map(({ score }) => ({
        score,
        candidate: { parseStatus: parseStatus ?? 'parsed' },
      }));
      return hasScoreInFlight(rows) ? SCORE_POLL_INTERVAL_MS : false;
    },
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
