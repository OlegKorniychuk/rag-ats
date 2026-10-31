import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../test/server';
import { renderApp } from '../test/render';

const baseUrl = 'http://localhost:3000';
const session = {
  status: 'authenticated' as const,
  user: { id: 'u1', email: 'r@example.com' },
};

const vacancy = {
  id: '1',
  recruiterId: 'r1',
  title: 'Backend Dev',
  requirements: 'TS',
  applyToken: 'tok-123',
  status: 'open' as const,
  createdAt: '2024-01-15T00:00:00.000Z',
};

const formattedDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
}).format(new Date(vacancy.createdAt));

function stubClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

describe('VacanciesPage', () => {
  it('renders vacancy rows from the list', async () => {
    server.use(
      http.get(`${baseUrl}/vacancies`, () => HttpResponse.json([vacancy])),
    );
    renderApp({ route: '/vacancies', session });

    expect(await screen.findByText('Backend Dev')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.getByText(formattedDate)).toBeInTheDocument();
  });

  it('navigates to the vacancy pipeline when the title is clicked', async () => {
    server.use(
      http.get(`${baseUrl}/vacancies`, () => HttpResponse.json([vacancy])),
      http.get(`${baseUrl}/vacancies/1`, () => HttpResponse.json(vacancy)),
      http.get(`${baseUrl}/vacancies/1/applications`, () =>
        HttpResponse.json([]),
      ),
    );
    const { router } = renderApp({ route: '/vacancies', session });

    await screen.findByText('Backend Dev');
    await userEvent.click(screen.getByRole('link', { name: 'Backend Dev' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/vacancies/1'),
    );
  });

  it('shows an empty state when there are no vacancies', async () => {
    server.use(http.get(`${baseUrl}/vacancies`, () => HttpResponse.json([])));
    renderApp({ route: '/vacancies', session });

    expect(await screen.findByText('No vacancies yet')).toBeInTheDocument();
  });

  it('shows an error alert on a failed load', async () => {
    server.use(
      http.get(
        `${baseUrl}/vacancies`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    renderApp({ route: '/vacancies', session });

    expect(
      await screen.findByText(/Could not load vacancies/),
    ).toBeInTheDocument();
  });

  it('copies the apply link and shows a snackbar', async () => {
    server.use(
      http.get(`${baseUrl}/vacancies`, () => HttpResponse.json([vacancy])),
    );
    const writeText = stubClipboard();
    renderApp({ route: '/vacancies', session });

    await screen.findByText('Backend Dev');
    await userEvent.click(
      screen.getByRole('button', { name: 'Copy apply link for Backend Dev' }),
    );

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/apply/${vacancy.applyToken}`,
    );
    expect(await screen.findByText('Apply link copied')).toBeInTheDocument();
  });

  it('shows a snackbar when copying fails', async () => {
    server.use(
      http.get(`${baseUrl}/vacancies`, () => HttpResponse.json([vacancy])),
    );
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    renderApp({ route: '/vacancies', session });

    await screen.findByText('Backend Dev');
    await userEvent.click(
      screen.getByRole('button', { name: 'Copy apply link for Backend Dev' }),
    );

    expect(await screen.findByText('Could not copy link')).toBeInTheDocument();
  });

  it('closes and reopens a vacancy', async () => {
    let vacancies = [vacancy];
    let lastPatchBody: unknown;
    server.use(
      http.get(`${baseUrl}/vacancies`, () => HttpResponse.json(vacancies)),
      http.patch(`${baseUrl}/vacancies/1`, async ({ request }) => {
        lastPatchBody = await request.json();
        vacancies = vacancies.map((v) =>
          v.id === '1' ? { ...v, ...(lastPatchBody as object) } : v,
        );
        return HttpResponse.json(vacancies[0]);
      }),
    );
    renderApp({ route: '/vacancies', session });

    await screen.findByText('Backend Dev');
    await userEvent.click(
      screen.getByRole('button', { name: 'Close Backend Dev' }),
    );

    expect(await screen.findByText('Vacancy closed')).toBeInTheDocument();
    expect(lastPatchBody).toEqual({ status: 'closed' });
    expect(await screen.findByText('closed')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Reopen Backend Dev' }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Reopen Backend Dev' }),
    );

    expect(await screen.findByText('Vacancy reopened')).toBeInTheDocument();
    expect(lastPatchBody).toEqual({ status: 'open' });
    expect(await screen.findByText('open')).toBeInTheDocument();
  });

  it('shows an error snackbar on a failed close and leaves the chip unchanged', async () => {
    server.use(
      http.get(`${baseUrl}/vacancies`, () => HttpResponse.json([vacancy])),
      http.patch(`${baseUrl}/vacancies/1`, () =>
        HttpResponse.json({ message: 'Something broke' }, { status: 500 }),
      ),
    );
    renderApp({ route: '/vacancies', session });

    await screen.findByText('Backend Dev');
    await userEvent.click(
      screen.getByRole('button', { name: 'Close Backend Dev' }),
    );

    expect(await screen.findByText('Something broke')).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();
  });

  it('shows validation errors on empty submit and sends no request', async () => {
    server.use(http.get(`${baseUrl}/vacancies`, () => HttpResponse.json([])));
    renderApp({ route: '/vacancies', session });

    await screen.findByText('No vacancies yet');
    await userEvent.click(screen.getByRole('button', { name: 'New vacancy' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(
      await screen.findByText('Requirements are required'),
    ).toBeInTheDocument();
  });

  it('creates a vacancy with trimmed values and shows the new row', async () => {
    let vacancies: (typeof vacancy)[] = [];
    let lastPostBody: unknown;
    server.use(
      http.get(`${baseUrl}/vacancies`, () => HttpResponse.json(vacancies)),
      http.post(`${baseUrl}/vacancies`, async ({ request }) => {
        lastPostBody = await request.json();
        const created = { ...vacancy, id: '2', ...(lastPostBody as object) };
        vacancies = [...vacancies, created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    renderApp({ route: '/vacancies', session });

    await screen.findByText('No vacancies yet');
    await userEvent.click(screen.getByRole('button', { name: 'New vacancy' }));
    await userEvent.type(screen.getByLabelText('Title'), '  Backend Dev  ');
    await userEvent.type(screen.getByLabelText('Requirements'), '  TS  ');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Vacancy created')).toBeInTheDocument();
    expect(lastPostBody).toEqual({ title: 'Backend Dev', requirements: 'TS' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Backend Dev')).toBeInTheDocument();
  });

  it('edits a vacancy without sending status and updates the row', async () => {
    let vacancies = [vacancy];
    let lastPatchBody: unknown;
    server.use(
      http.get(`${baseUrl}/vacancies`, () => HttpResponse.json(vacancies)),
      http.patch(`${baseUrl}/vacancies/1`, async ({ request }) => {
        lastPatchBody = await request.json();
        vacancies = vacancies.map((v) =>
          v.id === '1' ? { ...v, ...(lastPatchBody as object) } : v,
        );
        return HttpResponse.json(vacancies[0]);
      }),
    );
    renderApp({ route: '/vacancies', session });

    await screen.findByText('Backend Dev');
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit Backend Dev' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Edit vacancy' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Backend Dev');
    expect(screen.getByLabelText('Requirements')).toHaveValue('TS');

    await userEvent.clear(screen.getByLabelText('Title'));
    await userEvent.type(screen.getByLabelText('Title'), 'Senior Backend Dev');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Vacancy updated · re-scoring applicants'),
    ).toBeInTheDocument();
    expect(lastPatchBody).toEqual({
      title: 'Senior Backend Dev',
      requirements: 'TS',
    });
    expect(await screen.findByText('Senior Backend Dev')).toBeInTheDocument();
  });

  it('opens the create dialog with empty fields after editing', async () => {
    let vacancies = [vacancy];
    server.use(
      http.get(`${baseUrl}/vacancies`, () => HttpResponse.json(vacancies)),
      http.patch(`${baseUrl}/vacancies/1`, async ({ request }) => {
        const body = await request.json();
        vacancies = vacancies.map((v) =>
          v.id === '1' ? { ...v, ...(body as object) } : v,
        );
        return HttpResponse.json(vacancies[0]);
      }),
    );
    renderApp({ route: '/vacancies', session });

    await screen.findByText('Backend Dev');
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit Backend Dev' }),
    );
    await screen.findByRole('heading', { name: 'Edit vacancy' });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Vacancy updated');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'New vacancy' }));
    expect(
      await screen.findByRole('heading', { name: 'New vacancy' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('Requirements')).toHaveValue('');
  });

  it('shows a server validation error and keeps the dialog open', async () => {
    server.use(
      http.get(`${baseUrl}/vacancies`, () => HttpResponse.json([])),
      http.post(`${baseUrl}/vacancies`, () =>
        HttpResponse.json(
          { message: ['title should not be empty'] },
          { status: 400 },
        ),
      ),
    );
    renderApp({ route: '/vacancies', session });

    await screen.findByText('No vacancies yet');
    await userEvent.click(screen.getByRole('button', { name: 'New vacancy' }));
    await userEvent.type(screen.getByLabelText('Title'), 'Backend Dev');
    await userEvent.type(screen.getByLabelText('Requirements'), 'TS');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(
      await screen.findByText('title should not be empty'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

const openNote =
  'Saving will re-score every applicant against the new requirements.';
const closedNote =
  "This vacancy is closed: applicants' scores will be marked outdated and re-scored when you reopen it.";

function stubEditableVacancy(
  initial: Omit<typeof vacancy, 'status'> & {
    status: 'open' | 'closed';
  } = vacancy,
) {
  let vacancies = [initial];
  server.use(
    http.get(`${baseUrl}/vacancies`, () => HttpResponse.json(vacancies)),
    http.patch(`${baseUrl}/vacancies/1`, async ({ request }) => {
      const body = await request.json();
      vacancies = vacancies.map((v) => ({ ...v, ...(body as object) }));
      return HttpResponse.json(vacancies[0]);
    }),
  );
}

describe('VacancyFormDialog re-score note', () => {
  async function openEdit() {
    renderApp({ route: '/vacancies', session });
    await screen.findByText('Backend Dev');
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit Backend Dev' }),
    );
    await screen.findByRole('heading', { name: 'Edit vacancy' });
  }

  it('is hidden initially and appears once the requirements change', async () => {
    stubEditableVacancy();
    await openEdit();

    expect(screen.queryByText(openNote)).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Requirements'), ' and SQL');

    expect(screen.getByText(openNote)).toBeInTheDocument();
  });

  it('appears when the title changes', async () => {
    stubEditableVacancy();
    await openEdit();

    await userEvent.type(screen.getByLabelText('Title'), ' II');

    expect(screen.getByText(openNote)).toBeInTheDocument();
  });

  it('uses the closed wording for a closed vacancy', async () => {
    stubEditableVacancy({ ...vacancy, status: 'closed' });
    await openEdit();

    await userEvent.type(screen.getByLabelText('Requirements'), ' and SQL');

    expect(screen.getByText(closedNote)).toBeInTheDocument();
    expect(screen.queryByText(openNote)).not.toBeInTheDocument();
  });

  it('stays hidden for whitespace-only edits and hides again after reverting', async () => {
    stubEditableVacancy();
    await openEdit();

    await userEvent.type(screen.getByLabelText('Requirements'), '   ');
    expect(screen.queryByText(openNote)).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Requirements'), 'X');
    expect(screen.getByText(openNote)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Requirements'), '{Backspace}');
    expect(screen.queryByText(openNote)).not.toBeInTheDocument();
  });

  it('is never shown in create mode', async () => {
    server.use(http.get(`${baseUrl}/vacancies`, () => HttpResponse.json([])));
    renderApp({ route: '/vacancies', session });

    await screen.findByText('No vacancies yet');
    await userEvent.click(screen.getByRole('button', { name: 'New vacancy' }));
    await userEvent.type(screen.getByLabelText('Title'), 'Backend Dev');
    await userEvent.type(screen.getByLabelText('Requirements'), 'TS');

    expect(screen.queryByText(openNote)).not.toBeInTheDocument();
    expect(screen.queryByText(closedNote)).not.toBeInTheDocument();
  });

  it('shows the plain snackbar when the criteria did not change', async () => {
    stubEditableVacancy();
    await openEdit();

    await userEvent.type(screen.getByLabelText('Requirements'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Vacancy updated')).toBeInTheDocument();
  });

  it('shows the plain snackbar when a closed vacancy is edited', async () => {
    stubEditableVacancy({ ...vacancy, status: 'closed' });
    await openEdit();

    await userEvent.type(screen.getByLabelText('Requirements'), ' and SQL');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Vacancy updated')).toBeInTheDocument();
  });
});
