import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSessionStore } from '../auth/sessionStore';
import { server } from '../test/server';
import { renderApp } from '../test/render';

const baseUrl = 'http://localhost:3000';
const user = { id: '1', email: 'a@b.com' };

describe('AppLayout', () => {
  it('navigates to candidates when the nav link is clicked', async () => {
    const { router } = renderApp({
      route: '/vacancies',
      session: { status: 'authenticated', user },
    });
    await userEvent.click(screen.getByRole('link', { name: 'Candidates' }));
    expect(
      await screen.findByRole('heading', { name: 'Candidates' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/candidates');
  });

  it('logs out and lands on /login when the API succeeds', async () => {
    let called = false;
    server.use(
      http.post(`${baseUrl}/auth/logout`, () => {
        called = true;
        return HttpResponse.json({ success: true });
      }),
    );
    const { router } = renderApp({
      route: '/vacancies',
      session: { status: 'authenticated', user },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await screen.findByRole('heading', { name: 'Log in' });
    expect(called).toBe(true);
    expect(router.state.location.pathname).toBe('/login');
    expect(useSessionStore.getState().status).toBe('anonymous');
  });

  it('still ends up logged out on /login when the logout API fails', async () => {
    server.use(
      http.post(
        `${baseUrl}/auth/logout`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    const { router } = renderApp({
      route: '/vacancies',
      session: { status: 'authenticated', user },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await screen.findByRole('heading', { name: 'Log in' });
    expect(router.state.location.pathname).toBe('/login');
    expect(useSessionStore.getState().status).toBe('anonymous');
  });
});
