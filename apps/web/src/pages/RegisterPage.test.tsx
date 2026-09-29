import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSessionStore } from '../auth/sessionStore';
import { server } from '../test/server';
import { renderApp } from '../test/render';

const baseUrl = 'http://localhost:3000';
const user = { id: '1', email: 'a@b.com' };

async function fillAndSubmit(confirmPassword = 'password123') {
  await userEvent.type(screen.getByLabelText('Email'), 'a@b.com');
  await userEvent.type(screen.getByLabelText('Password'), 'password123');
  await userEvent.type(
    screen.getByLabelText('Confirm password'),
    confirmPassword,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('RegisterPage', () => {
  it('shows a mismatch error and sends no request', async () => {
    renderApp({ route: '/register' });
    await fillAndSubmit('different1');
    expect(
      await screen.findByText('Passwords do not match'),
    ).toBeInTheDocument();
  });

  it('registers, logs in, and lands on /vacancies with the session set', async () => {
    let registerBody: unknown;
    let loginBody: unknown;
    let meCalled = false;
    server.use(
      http.post(`${baseUrl}/auth/register`, async ({ request }) => {
        registerBody = await request.json();
        return HttpResponse.json(
          { id: '1', email: 'a@b.com' },
          { status: 201 },
        );
      }),
      http.post(`${baseUrl}/auth/login`, async ({ request }) => {
        loginBody = await request.json();
        return HttpResponse.json({ success: true });
      }),
      http.get(`${baseUrl}/auth/me`, () => {
        meCalled = true;
        return HttpResponse.json(user);
      }),
      http.get(`${baseUrl}/vacancies`, () => HttpResponse.json([])),
    );
    const { router } = renderApp({ route: '/register' });
    await fillAndSubmit();
    await screen.findByRole('heading', { name: 'Vacancies' });
    expect(registerBody).toEqual({ email: 'a@b.com', password: 'password123' });
    expect(loginBody).toEqual({ email: 'a@b.com', password: 'password123' });
    expect(meCalled).toBe(true);
    expect(router.state.location.pathname).toBe('/vacancies');
    expect(useSessionStore.getState()).toMatchObject({
      status: 'authenticated',
      user,
    });
  });

  it('shows an already-registered error on the email field for a 409', async () => {
    server.use(
      http.post(
        `${baseUrl}/auth/register`,
        () => new HttpResponse(null, { status: 409 }),
      ),
    );
    renderApp({ route: '/register' });
    await fillAndSubmit();
    expect(
      await screen.findByText('Email already registered'),
    ).toBeInTheDocument();
  });

  it('shows an account-created message when auto-login fails', async () => {
    server.use(
      http.post(`${baseUrl}/auth/register`, () =>
        HttpResponse.json({ id: '1', email: 'a@b.com' }, { status: 201 }),
      ),
      http.post(
        `${baseUrl}/auth/login`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    renderApp({ route: '/register' });
    await fillAndSubmit();
    expect(await screen.findByText(/Account created/)).toBeInTheDocument();
  });

  it('links back to the login page', async () => {
    renderApp({ route: '/register' });
    await userEvent.click(
      screen.getByRole('link', { name: 'Already have an account? Log in' }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Log in' }),
    ).toBeInTheDocument();
  });
});
