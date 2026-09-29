import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, screen, within } from '@testing-library/react';
import type { DragEndEvent } from '@dnd-kit/core';
import { server } from '../test/server';
import { renderApp } from '../test/render';

// jsdom has no layout, so real drags can't run; capture the board's onDragEnd instead
const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as ((event: DragEndEvent) => void) | undefined,
}));
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    DndContext: (props: ComponentProps<typeof actual.DndContext>) => {
      dnd.onDragEnd = props.onDragEnd;
      return <actual.DndContext {...props} />;
    },
  };
});

const baseUrl = 'http://localhost:3000';
const session = {
  status: 'authenticated' as const,
  user: { id: 'u1', email: 'r@example.com' },
};
const vacancy = {
  id: 'v1',
  recruiterId: 'r1',
  title: 'Backend Dev',
  requirements: 'TS',
  applyToken: 'tok-123',
  status: 'open' as const,
  createdAt: '2024-01-15T00:00:00.000Z',
};
const application = {
  id: 'a1',
  vacancyId: 'v1',
  candidateId: 'c1',
  stage: 'applied' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
  candidate: {
    id: 'c1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    githubUrl: null,
    portfolioUrl: null,
    skills: ['TS'],
    experience: '5 years',
    projects: [],
    summary: '',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
};

function dropOnHired() {
  act(() =>
    dnd.onDragEnd?.({
      active: { id: 'a1' },
      over: { id: 'hired' },
    } as DragEndEvent),
  );
}

describe('PipelinePage drag failures', () => {
  it.each([
    [
      'an API error',
      () =>
        HttpResponse.json(
          { statusCode: 500, message: 'boom' },
          { status: 500 },
        ),
      'boom',
    ],
    ['a network error', () => HttpResponse.error(), 'Something went wrong'],
  ])(
    'rolls the card back and shows a snackbar on %s',
    async (_, respond, message) => {
      server.use(
        http.get(`${baseUrl}/vacancies/v1`, () => HttpResponse.json(vacancy)),
        http.get(`${baseUrl}/vacancies/v1/applications`, () =>
          HttpResponse.json([application]),
        ),
        http.patch(`${baseUrl}/applications/a1`, respond),
      );
      renderApp({ route: '/vacancies/v1', session });
      await screen.findByText('Ada Lovelace');

      dropOnHired();

      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(
        within(screen.getByRole('region', { name: 'Applied' })).getByText(
          'Ada Lovelace',
        ),
      ).toBeInTheDocument();
    },
  );
});
