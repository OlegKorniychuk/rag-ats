import { describe, expect, it, vi } from 'vitest';
import type { DragEndEvent } from '@dnd-kit/core';
import type { ApplicationWithCandidateResponse } from '@rag-ats/shared';
import { ApiError } from '../api/client';
import { createDragEndHandler } from './dragEnd';

const candidate = {
  id: 'c1',
  name: 'Ada',
  email: 'ada@example.com',
  githubUrl: null,
  portfolioUrl: null,
  skills: [],
  experience: '',
  projects: [],
  summary: '',
  cv: {
    id: 'cv1',
    filename: 'cv.pdf',
    sizeBytes: 1024,
    uploadedAt: '2024-01-01T00:00:00.000Z',
  },
  createdAt: '2024-01-01T00:00:00.000Z',
};

function makeApplication(
  overrides: Partial<ApplicationWithCandidateResponse>,
): ApplicationWithCandidateResponse {
  return {
    id: 'a1',
    vacancyId: 'v1',
    candidateId: 'c1',
    stage: 'applied',
    createdAt: '2024-01-01T00:00:00.000Z',
    candidate,
    ...overrides,
  };
}

function fakeDragEndEvent(
  activeId: string,
  overId: string | null,
): DragEndEvent {
  return {
    active: { id: activeId, data: { current: undefined }, rect: {} },
    over: overId
      ? { id: overId, disabled: false, data: { current: undefined }, rect: {} }
      : null,
    activatorEvent: new Event('pointerup'),
    collisions: null,
    delta: { x: 0, y: 0 },
  } as unknown as DragEndEvent;
}

describe('createDragEndHandler', () => {
  it('calls mutate with the resolved move on a valid drop', () => {
    const applications = [makeApplication({ id: 'a1', stage: 'applied' })];
    const mutate = vi.fn();
    const handler = createDragEndHandler(applications, { mutate }, vi.fn());

    handler(fakeDragEndEvent('a1', 'screened'));

    expect(mutate).toHaveBeenCalledWith(
      { id: 'a1', stage: 'screened' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('does not call mutate for a same-column drop', () => {
    const applications = [makeApplication({ id: 'a1', stage: 'applied' })];
    const mutate = vi.fn();
    const handler = createDragEndHandler(applications, { mutate }, vi.fn());

    handler(fakeDragEndEvent('a1', 'applied'));

    expect(mutate).not.toHaveBeenCalled();
  });

  it('does not call mutate when dropped outside a column', () => {
    const applications = [makeApplication({ id: 'a1', stage: 'applied' })];
    const mutate = vi.fn();
    const handler = createDragEndHandler(applications, { mutate }, vi.fn());

    handler(fakeDragEndEvent('a1', null));

    expect(mutate).not.toHaveBeenCalled();
  });

  it('forwards a friendly message to onError when the mutation fails', () => {
    const applications = [makeApplication({ id: 'a1', stage: 'applied' })];
    const onError = vi.fn();
    const mutate = vi.fn(
      (_vars: unknown, options?: { onError?: (error: unknown) => void }) => {
        options?.onError?.(new ApiError(500, ['boom']));
      },
    );
    const handler = createDragEndHandler(applications, { mutate }, onError);

    handler(fakeDragEndEvent('a1', 'screened'));

    expect(onError).toHaveBeenCalledWith('boom');
  });
});
