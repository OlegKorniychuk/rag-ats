import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
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
});
