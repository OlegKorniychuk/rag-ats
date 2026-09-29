import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp } from '../test/render';

const user = { id: '1', email: 'a@b.com' };

describe('routing', () => {
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

  it('sends an unknown path to /vacancies when authenticated', async () => {
    const { router } = renderApp({
      route: '/does-not-exist',
      session: { status: 'authenticated', user },
    });
    await screen.findByRole('heading', { name: 'Vacancies' });
    expect(router.state.location.pathname).toBe('/vacancies');
  });

  it('sends an unknown path to /login when anonymous', async () => {
    const { router } = renderApp({
      route: '/does-not-exist',
      session: { status: 'anonymous', user: null },
    });
    await screen.findByRole('heading', { name: 'Log in' });
    expect(router.state.location.pathname).toBe('/login');
  });
});
