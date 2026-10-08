import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getCandidate,
  listCandidates,
  reparseCandidate,
} from '../api/candidates';
import { hasParseInFlight, PARSE_POLL_INTERVAL_MS } from './parseStatus';

export const candidateKeys = {
  all: ['candidates'] as const,
  detail: (id: string) => ['candidates', id] as const,
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
