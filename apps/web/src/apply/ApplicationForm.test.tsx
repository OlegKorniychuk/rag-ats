import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../test/server';
import { renderApp } from '../test/render';

const baseUrl = 'http://localhost:3000';

const vacancy = {
  title: 'Backend Dev',
  requirements: 'TypeScript\nNode.js\nSQL',
  status: 'open' as const,
};

async function fillValidForm() {
  await screen.findByRole('heading', { name: 'Backend Dev' });
  await userEvent.type(screen.getByLabelText('Name'), 'Jane Doe');
  await userEvent.type(screen.getByLabelText('Email'), 'jane@example.com');
  await userEvent.type(screen.getByLabelText('Skills'), 'TypeScript{Enter}');
  await userEvent.type(screen.getByLabelText('Experience'), '3 years');
  await userEvent.type(screen.getByLabelText('Summary'), 'Great candidate');
}

describe('ApplicationForm', () => {
  it('shows validation errors and sends no request on an empty submit', async () => {
    let postCalled = false;
    server.use(
      http.get(`${baseUrl}/apply/tok123`, () => HttpResponse.json(vacancy)),
      http.post(`${baseUrl}/apply/tok123`, () => {
        postCalled = true;
        return HttpResponse.json({ success: true }, { status: 201 });
      }),
    );
    renderApp({ route: '/apply/tok123' });
    await screen.findByRole('heading', { name: 'Backend Dev' });

    await userEvent.click(
      screen.getByRole('button', { name: 'Submit application' }),
    );

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email')).toBeInTheDocument();
    expect(screen.getByText('Add at least one skill')).toBeInTheDocument();
    expect(screen.getByText('Experience is required')).toBeInTheDocument();
    expect(screen.getByText('Summary is required')).toBeInTheDocument();
    expect(postCalled).toBe(false);
  });

  it('shows an invalid URL error for a malformed GitHub URL and sends no request', async () => {
    let postCalled = false;
    server.use(
      http.get(`${baseUrl}/apply/tok123`, () => HttpResponse.json(vacancy)),
      http.post(`${baseUrl}/apply/tok123`, () => {
        postCalled = true;
        return HttpResponse.json({ success: true }, { status: 201 });
      }),
    );
    renderApp({ route: '/apply/tok123' });
    await fillValidForm();
    await userEvent.type(screen.getByLabelText('GitHub URL'), 'not-a-url');

    await userEvent.click(
      screen.getByRole('button', { name: 'Submit application' }),
    );

    expect(await screen.findByText('Enter a valid URL')).toBeInTheDocument();
    expect(postCalled).toBe(false);
  });

  it('submits trimmed values, omits blank optional URLs, and shows a success alert', async () => {
    let receivedBody: unknown;
    server.use(
      http.get(`${baseUrl}/apply/tok123`, () => HttpResponse.json(vacancy)),
      http.post(`${baseUrl}/apply/tok123`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ success: true }, { status: 201 });
      }),
    );
    renderApp({ route: '/apply/tok123' });
    await screen.findByRole('heading', { name: 'Backend Dev' });

    await userEvent.type(screen.getByLabelText('Name'), '  Jane Doe  ');
    await userEvent.type(screen.getByLabelText('Email'), 'jane@example.com');
    await userEvent.type(screen.getByLabelText('Skills'), 'TypeScript{Enter}');
    await userEvent.type(screen.getByLabelText('Skills'), 'Node.js{Enter}');
    await userEvent.type(screen.getByLabelText('Experience'), '  3 years  ');
    await userEvent.type(screen.getByLabelText('Projects'), 'Project A');
    await userEvent.type(
      screen.getByLabelText('Summary'),
      '  Great candidate  ',
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Submit application' }),
    );

    expect(
      await screen.findByText('Application submitted — thanks, Jane Doe!'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Submit application' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Backend Dev')).toBeInTheDocument();
    expect(receivedBody).toEqual({
      name: 'Jane Doe',
      email: 'jane@example.com',
      skills: ['TypeScript', 'Node.js'],
      experience: '3 years',
      projects: ['Project A'],
      summary: 'Great candidate',
    });
  });

  it('includes a valid githubUrl in the submitted body', async () => {
    let receivedBody: unknown;
    server.use(
      http.get(`${baseUrl}/apply/tok123`, () => HttpResponse.json(vacancy)),
      http.post(`${baseUrl}/apply/tok123`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ success: true }, { status: 201 });
      }),
    );
    renderApp({ route: '/apply/tok123' });
    await fillValidForm();
    await userEvent.type(
      screen.getByLabelText('GitHub URL'),
      'https://github.com/janedoe',
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Submit application' }),
    );

    await screen.findByText(/Application submitted/);
    expect(receivedBody).toMatchObject({
      githubUrl: 'https://github.com/janedoe',
    });
    expect(receivedBody).not.toHaveProperty('portfolioUrl');
  });

  it('shows an already-applied message on a 409 conflict', async () => {
    server.use(
      http.get(`${baseUrl}/apply/tok123`, () => HttpResponse.json(vacancy)),
      http.post(`${baseUrl}/apply/tok123`, () =>
        HttpResponse.json(
          { message: 'Already applied to this vacancy' },
          { status: 409 },
        ),
      ),
    );
    renderApp({ route: '/apply/tok123' });
    await fillValidForm();

    await userEvent.click(
      screen.getByRole('button', { name: 'Submit application' }),
    );

    expect(
      await screen.findByText("You've already applied to this vacancy"),
    ).toBeInTheDocument();
  });

  it('shows the closed notice after a 409 conflict says the vacancy is closed', async () => {
    let vacancyStatus: 'open' | 'closed' = 'open';
    server.use(
      http.get(`${baseUrl}/apply/tok123`, () =>
        HttpResponse.json({ ...vacancy, status: vacancyStatus }),
      ),
      http.post(`${baseUrl}/apply/tok123`, () => {
        vacancyStatus = 'closed';
        return HttpResponse.json(
          { message: 'Vacancy is closed' },
          { status: 409 },
        );
      }),
    );
    renderApp({ route: '/apply/tok123' });
    await fillValidForm();

    await userEvent.click(
      screen.getByRole('button', { name: 'Submit application' }),
    );

    expect(
      await screen.findByText(
        'This vacancy is no longer accepting applications',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Submit application' }),
    ).not.toBeInTheDocument();
  });

  it('shows an invalid-link message on a 404 from the submit', async () => {
    server.use(
      http.get(`${baseUrl}/apply/tok123`, () => HttpResponse.json(vacancy)),
      http.post(`${baseUrl}/apply/tok123`, () =>
        HttpResponse.json({ message: 'Vacancy not found' }, { status: 404 }),
      ),
    );
    renderApp({ route: '/apply/tok123' });
    await fillValidForm();

    await userEvent.click(
      screen.getByRole('button', { name: 'Submit application' }),
    );

    expect(
      await screen.findByText(
        'This application link is invalid or has expired',
      ),
    ).toBeInTheDocument();
  });

  it('shows a server-reach error on a network failure', async () => {
    server.use(
      http.get(`${baseUrl}/apply/tok123`, () => HttpResponse.json(vacancy)),
      http.post(`${baseUrl}/apply/tok123`, () => HttpResponse.error()),
    );
    renderApp({ route: '/apply/tok123' });
    await fillValidForm();

    await userEvent.click(
      screen.getByRole('button', { name: 'Submit application' }),
    );

    expect(
      await screen.findByText('Could not reach the server'),
    ).toBeInTheDocument();
  });
});
