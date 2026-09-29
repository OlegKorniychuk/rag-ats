import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { server } from '../test/server';
import { renderApp } from '../test/render';

const baseUrl = 'http://localhost:3000';
const user = { id: '1', email: 'a@b.com' };

const vacancy = {
  title: 'Backend Dev',
  requirements: 'TypeScript\nNode.js\nSQL',
  status: 'open' as const,
};

describe('ApplyPage', () => {
  it('shows the vacancy for anonymous visitors without redirecting or an AppBar', async () => {
    server.use(
      http.get(`${baseUrl}/apply/tok123`, () => HttpResponse.json(vacancy)),
    );
    const { router } = renderApp({
      route: '/apply/tok123',
      session: { status: 'anonymous', user: null },
    });

    expect(
      await screen.findByRole('heading', { name: 'Backend Dev' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Requirements')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/apply/tok123');
    expect(
      screen.queryByRole('button', { name: 'Logout' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Submit application' }),
    ).toBeInTheDocument();
  });

  it('shows the vacancy for authenticated visitors without redirecting', async () => {
    server.use(
      http.get(`${baseUrl}/apply/tok123`, () => HttpResponse.json(vacancy)),
    );
    const { router } = renderApp({
      route: '/apply/tok123',
      session: { status: 'authenticated', user },
    });

    expect(
      await screen.findByRole('heading', { name: 'Backend Dev' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/apply/tok123');
  });

  it('shows an invalid-link warning on a 404', async () => {
    server.use(
      http.get(`${baseUrl}/apply/tok123`, () =>
        HttpResponse.json({ message: 'Vacancy not found' }, { status: 404 }),
      ),
    );
    renderApp({ route: '/apply/tok123' });

    expect(
      await screen.findByText(
        'This application link is invalid or has expired',
      ),
    ).toBeInTheDocument();
  });

  it('shows an error alert on a server error', async () => {
    server.use(
      http.get(`${baseUrl}/apply/tok123`, () =>
        HttpResponse.json({ message: 'Boom' }, { status: 500 }),
      ),
    );
    renderApp({ route: '/apply/tok123' });

    expect(
      await screen.findByText('Could not load this vacancy: Boom'),
    ).toBeInTheDocument();
  });

  it('shows an info notice and no form slot for a closed vacancy', async () => {
    server.use(
      http.get(`${baseUrl}/apply/tok123`, () =>
        HttpResponse.json({ ...vacancy, status: 'closed' }),
      ),
    );
    renderApp({ route: '/apply/tok123' });

    expect(
      await screen.findByText(
        'This vacancy is no longer accepting applications',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Submit application' }),
    ).not.toBeInTheDocument();
  });

  it('preserves newlines in the requirements text', async () => {
    server.use(
      http.get(`${baseUrl}/apply/tok123`, () => HttpResponse.json(vacancy)),
    );
    renderApp({ route: '/apply/tok123' });

    const requirements = await screen.findByText(
      (_, element) => element?.textContent === vacancy.requirements,
    );
    expect(requirements.textContent).toBe('TypeScript\nNode.js\nSQL');
  });
});
