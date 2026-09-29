import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSessionStore } from '../auth/sessionStore';
import { server } from '../test/server';
import { renderApp } from '../test/render';

const baseUrl = 'http://localhost:3000';
const user = { id: '1', email: 'a@b.com' };

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
  await userEvent.type(screen.getByLabelText('Password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
}

describe('LoginPage', () => {
  it('shows validation errors and sends no request on an empty submit', async () => {
    renderApp({ route: '/login' });
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument();
    expect(
      screen.getByText('Password must be at least 8 characters'),
    ).toBeInTheDocument();
  });

  it('logs in and lands on /vacancies with the session set', async () => {
    let loginBody: unknown;
    server.use(
      http.post(`${baseUrl}/auth/login`, async ({ request }) => {
        loginBody = await request.json();
        return HttpResponse.json({ success: true });
      }),
      http.get(`${baseUrl}/auth/me`, () => HttpResponse.json(user)),
    );
    const { router } = renderApp({ route: '/login' });
    await fillAndSubmit();
    await screen.findByRole('heading', { name: 'Vacancies' });
    expect(loginBody).toEqual({ email: 'a@b.com', password: 'password123' });
    expect(router.state.location.pathname).toBe('/vacancies');
    expect(useSessionStore.getState()).toMatchObject({
      status: 'authenticated',
      user,
    });
  });

  it('returns to the page that redirected an anonymous user', async () => {
    server.use(
      http.post(`${baseUrl}/auth/login`, () =>
        HttpResponse.json({ success: true }),
      ),
      http.get(`${baseUrl}/auth/me`, () => HttpResponse.json(user)),
    );
    const { router } = renderApp({ route: '/candidates' });
    await screen.findByRole('heading', { name: 'Log in' });
    expect(router.state.location.pathname).toBe('/login');
    await fillAndSubmit();
    await screen.findByRole('heading', { name: 'Candidates' });
    expect(router.state.location.pathname).toBe('/candidates');
  });

  it('shows an invalid credentials message on 401', async () => {
    server.use(
      http.post(
        `${baseUrl}/auth/login`,
        () => new HttpResponse(null, { status: 401 }),
      ),
    );
    const { router } = renderApp({ route: '/login' });
    await fillAndSubmit();
    expect(
      await screen.findByText('Invalid email or password'),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('shows a server-reach error on a network failure', async () => {
    server.use(http.post(`${baseUrl}/auth/login`, () => HttpResponse.error()));
    renderApp({ route: '/login' });
    await fillAndSubmit();
    expect(
      await screen.findByText('Could not reach the server'),
    ).toBeInTheDocument();
  });

  it('links to the register page', async () => {
    renderApp({ route: '/login' });
    await userEvent.click(
      screen.getByRole('link', { name: 'Create an account' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Register' }),
    ).toBeInTheDocument();
  });
});
