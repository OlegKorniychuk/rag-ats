import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  CandidateApplicationResponse,
  CandidateResponse,
  VacancyResponse,
} from '@rag-ats/shared';
import { server } from '../test/server';
import { renderApp } from '../test/render';

const baseUrl = 'http://localhost:3000';
const session = {
  status: 'authenticated' as const,
  user: { id: 'u1', email: 'r@example.com' },
};

const candidate: CandidateResponse = {
  id: 'c1',
  name: 'Ada Lovelace',
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
  parseStatus: 'parsed',
  github: null,
  parseError: null,
  createdAt: '2024-01-15T00:00:00.000Z',
};

function makeVacancy(overrides: Partial<VacancyResponse>): VacancyResponse {
  return {
    id: 'v1',
    recruiterId: 'u1',
    title: 'Backend Dev',
    requirements: 'TS',
    applyToken: 'tok',
    status: 'open',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeApplication(
  overrides: Partial<CandidateApplicationResponse>,
): CandidateApplicationResponse {
  return {
    id: 'a1',
    vacancyId: 'v1',
    vacancyTitle: 'Backend Dev',
    vacancyStatus: 'open',
    stage: 'applied',
    source: 'applied',
    createdAt: '2024-01-20T00:00:00.000Z',
    score: {
      status: 'pending',
      error: null,
      waitingForParse: false,
      stale: false,
      result: null,
    },
    ...overrides,
  };
}

const backend = makeVacancy({ id: 'v1', title: 'Backend Dev' });
const frontend = makeVacancy({ id: 'v2', title: 'Frontend Dev' });
const designer = makeVacancy({
  id: 'v3',
  title: 'Old Designer',
  status: 'closed',
});

function useBackend(
  vacancies: VacancyResponse[],
  applications: CandidateApplicationResponse[] = [],
) {
  server.use(
    http.get(`${baseUrl}/candidates/c1`, () => HttpResponse.json(candidate)),
    http.get(`${baseUrl}/candidates/c1/applications`, () =>
      HttpResponse.json(applications),
    ),
    http.get(`${baseUrl}/vacancies`, () => HttpResponse.json(vacancies)),
  );
}

async function openDialog() {
  renderApp({ route: '/candidates/c1', session });
  await userEvent.click(
    await screen.findByRole('button', { name: 'Add to vacancy' }),
  );
  return screen.findByRole('dialog', { name: 'Add to vacancy' });
}

async function openSelect(dialog: HTMLElement) {
  await userEvent.click(await within(dialog).findByRole('combobox'));
  return screen.findByRole('listbox');
}

describe('AddToVacancyDialog', () => {
  it('lists only open vacancies and disables the ones already added', async () => {
    useBackend(
      [backend, frontend, designer],
      [makeApplication({ vacancyId: 'v1' })],
    );
    const dialog = await openDialog();
    const listbox = await openSelect(dialog);

    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(
      within(listbox).queryByRole('option', { name: /Old Designer/ }),
    ).not.toBeInTheDocument();

    const added = within(listbox).getByRole('option', { name: /Backend Dev/ });
    expect(added).toHaveAttribute('aria-disabled', 'true');
    expect(within(added).getByText('Already added')).toBeInTheDocument();

    const free = within(listbox).getByRole('option', { name: 'Frontend Dev' });
    expect(free).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('disables submit until a vacancy is chosen', async () => {
    useBackend([backend, frontend]);
    const dialog = await openDialog();
    const submit = await within(dialog).findByRole('button', { name: 'Add' });
    expect(submit).toBeDisabled();

    const listbox = await openSelect(dialog);
    await userEvent.click(
      within(listbox).getByRole('option', { name: 'Frontend Dev' }),
    );
    expect(submit).toBeEnabled();
  });

  it('adds the candidate, closes, shows the snackbar link and the new row', async () => {
    let applications: CandidateApplicationResponse[] = [];
    let receivedBody: unknown;
    server.use(
      http.get(`${baseUrl}/candidates/c1`, () => HttpResponse.json(candidate)),
      http.get(`${baseUrl}/candidates/c1/applications`, () =>
        HttpResponse.json(applications),
      ),
      http.get(`${baseUrl}/vacancies`, () =>
        HttpResponse.json([backend, frontend]),
      ),
      http.post(`${baseUrl}/vacancies/v2/applications`, async ({ request }) => {
        receivedBody = await request.json();
        applications = [
          makeApplication({
            id: 'a2',
            vacancyId: 'v2',
            vacancyTitle: 'Frontend Dev',
            source: 'added',
          }),
        ];
        return HttpResponse.json({ id: 'a2' }, { status: 201 });
      }),
    );
    const dialog = await openDialog();
    const listbox = await openSelect(dialog);
    await userEvent.click(
      within(listbox).getByRole('option', { name: 'Frontend Dev' }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    expect(
      await screen.findByText('Added to Frontend Dev'),
    ).toBeInTheDocument();
    expect(receivedBody).toEqual({ candidateId: 'c1' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'View pipeline' })).toHaveAttribute(
      'href',
      '/vacancies/v2',
    );

    const section = screen.getByRole('region', { name: 'Vacancies' });
    expect(
      await within(section).findByRole('link', { name: 'Frontend Dev' }),
    ).toHaveAttribute('href', '/vacancies/v2');
  });

  it('disables the form while the request is pending', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    useBackend([backend]);
    server.use(
      http.post(`${baseUrl}/vacancies/v1/applications`, async () => {
        await gate;
        return HttpResponse.json({ id: 'a1' }, { status: 201 });
      }),
    );
    const dialog = await openDialog();
    const listbox = await openSelect(dialog);
    await userEvent.click(
      within(listbox).getByRole('option', { name: 'Backend Dev' }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    expect(
      await within(dialog).findByRole('button', { name: 'Adding…' }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    ).toBeDisabled();

    release();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('shows a 409 inline, keeps the dialog open and clears it on a new selection', async () => {
    useBackend([backend, frontend]);
    server.use(
      http.post(`${baseUrl}/vacancies/v2/applications`, () =>
        HttpResponse.json(
          { message: 'Candidate is already on this vacancy' },
          { status: 409 },
        ),
      ),
    );
    const dialog = await openDialog();
    let listbox = await openSelect(dialog);
    await userEvent.click(
      within(listbox).getByRole('option', { name: 'Frontend Dev' }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    expect(
      await within(dialog).findByText('Candidate is already on this vacancy'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Added to Frontend Dev')).not.toBeInTheDocument();

    listbox = await openSelect(dialog);
    await userEvent.click(
      within(listbox).getByRole('option', { name: 'Backend Dev' }),
    );
    expect(
      within(dialog).queryByText('Candidate is already on this vacancy'),
    ).not.toBeInTheDocument();
  });

  it('explains there is nothing to add to when no vacancy is open', async () => {
    useBackend([designer]);
    const dialog = await openDialog();

    expect(
      await within(dialog).findByText(/no open vacancies/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('link', { name: 'Go to vacancies' }),
    ).toHaveAttribute('href', '/vacancies');
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Add' }),
    ).not.toBeInTheDocument();
  });

  it('shows an error when the vacancies cannot be loaded', async () => {
    useBackend([]);
    server.use(
      http.get(
        `${baseUrl}/vacancies`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    const dialog = await openDialog();

    expect(
      await within(dialog).findByText(/Could not load vacancies/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
  });
});
