import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../test/server';
import { renderApp } from '../test/render';

const baseUrl = 'http://localhost:3000';
const user = { id: '1', email: 'a@b.com' };

describe('routing', () => {
  beforeEach(() => {
    server.use(http.get(`${baseUrl}/vacancies`, () => HttpResponse.json([])));
  });

  it('redirects anonymous users at /vacancies to /login', async () => {
    const { router } = renderApp({
      route: '/vacancies',
      session: { status: 'anonymous', user: null },
    });
    expect(
      await screen.findByRole('heading', { name: 'Log in' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('shows a spinner while loading, without redirecting', () => {
    const { router } = renderApp({
      route: '/vacancies',
      session: { status: 'loading', user: null },
    });
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/vacancies');
  });

  it('renders the vacancies page for authenticated users', async () => {
    renderApp({
      route: '/vacancies',
      session: { status: 'authenticated', user },
    });
    expect(await screen.findByText('RAG-ATS')).toBeInTheDocument();
    expect(screen.getByText(user.email)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Vacancies' }),
    ).toBeInTheDocument();
  });

  it('redirects authenticated users away from /login', async () => {
    const { router } = renderApp({
      route: '/login',
      session: { status: 'authenticated', user },
    });
    await screen.findByRole('heading', { name: 'Vacancies' });
    expect(router.state.location.pathname).toBe('/vacancies');
  });

  it('sends authenticated users at / to /vacancies', async () => {
    const { router } = renderApp({
      route: '/',
      session: { status: 'authenticated', user },
    });
    await screen.findByRole('heading', { name: 'Vacancies' });
    expect(router.state.location.pathname).toBe('/vacancies');
  });

  it('shows "Page not found" for an unknown path when authenticated and stays put', async () => {
    const { router } = renderApp({
      route: '/does-not-exist',
      session: { status: 'authenticated', user },
    });
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/does-not-exist');
  });

  it('shows "Page not found" for an unknown path when anonymous and stays put', async () => {
    const { router } = renderApp({
      route: '/does-not-exist',
      session: { status: 'anonymous', user: null },
    });
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/does-not-exist');
  });

  it('sends authenticated users to /vacancies from "Go to vacancies"', async () => {
    const { router } = renderApp({
      route: '/does-not-exist',
      session: { status: 'authenticated', user },
    });
    await screen.findByText('Page not found');
    await userEvent.click(
      screen.getByRole('link', { name: 'Go to vacancies' }),
    );

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/vacancies'),
    );
  });

  it('sends anonymous users to /login from "Go to vacancies"', async () => {
    const { router } = renderApp({
      route: '/does-not-exist',
      session: { status: 'anonymous', user: null },
    });
    await screen.findByText('Page not found');
    await userEvent.click(
      screen.getByRole('link', { name: 'Go to vacancies' }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});
