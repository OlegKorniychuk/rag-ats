import { useQuery } from '@tanstack/react-query';
import { getCandidate, listCandidates } from '../api/candidates';

export const candidateKeys = {
  all: ['candidates'] as const,
  detail: (id: string) => ['candidates', id] as const,
};

export function useCandidates() {
  return useQuery({ queryKey: candidateKeys.all, queryFn: listCandidates });
}

export function useCandidate(id: string) {
  return useQuery({
    queryKey: candidateKeys.detail(id),
    queryFn: () => getCandidate(id),
  });
}
