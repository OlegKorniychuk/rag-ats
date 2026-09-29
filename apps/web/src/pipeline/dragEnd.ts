import type {
  ApplicationStage,
  ApplicationWithCandidateResponse,
} from '@rag-ats/shared';
import type { DragEndEvent } from '@dnd-kit/core';
import { ApiError } from '../api/client';
import { resolveDrop } from './board';

interface UpdateStageMutation {
  mutate: (
    variables: { id: string; stage: ApplicationStage },
    options?: { onError?: (error: unknown) => void },
  ) => void;
}

export function createDragEndHandler(
  applications: readonly ApplicationWithCandidateResponse[],
  updateStage: UpdateStageMutation,
  onError: (message: string) => void,
) {
  return (event: DragEndEvent) => {
    const move = resolveDrop(
      String(event.active.id),
      event.over ? String(event.over.id) : null,
      applications,
    );
    if (!move) return;
    updateStage.mutate(move, {
      onError: (error) =>
        onError(
          error instanceof ApiError
            ? error.messages.join(', ')
            : 'Something went wrong',
        ),
    });
  };
}
