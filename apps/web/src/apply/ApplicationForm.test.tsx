import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../test/server';
import { renderApp } from '../test/render';

const baseUrl = 'http://localhost:3000';

const pdf = () =>
  new File(['%PDF-1.4 test'], 'cv.pdf', { type: 'application/pdf' });

const vacancy = {
  title: 'Backend Dev',
  requirements: 'TypeScript\nNode.js\nSQL',
  status: 'open' as const,
};

async function fillValidForm() {
  await screen.findByRole('heading', { name: 'Backend Dev' });
  await userEvent.type(screen.getByLabelText('Name'), 'Jane Doe');
  await userEvent.type(screen.getByLabelText('Email'), 'jane@example.com');
  await userEvent.upload(screen.getByLabelText('Upload CV (PDF)'), pdf());
}

function trackPost() {
  const state = { called: false };
  server.use(
    http.get(`${baseUrl}/apply/tok123`, () => HttpResponse.json(vacancy)),
    http.post(`${baseUrl}/apply/tok123`, () => {
      state.called = true;
      return HttpResponse.json({ success: true }, { status: 201 });
    }),
  );
  return state;
}

const submit = () =>
  userEvent.click(screen.getByRole('button', { name: 'Submit application' }));

describe('ApplicationForm', () => {
  it('shows validation errors and sends no request on an empty submit', async () => {
    const post = trackPost();
    renderApp({ route: '/apply/tok123' });
    await screen.findByRole('heading', { name: 'Backend Dev' });

    await submit();

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email')).toBeInTheDocument();
    expect(screen.getByText('Attach your CV as a PDF')).toBeInTheDocument();
    expect(post.called).toBe(false);
  });

  it('shows an invalid URL error for a malformed GitHub URL and sends no request', async () => {
    const post = trackPost();
    renderApp({ route: '/apply/tok123' });
    await fillValidForm();
    await userEvent.type(screen.getByLabelText('GitHub URL'), 'not-a-url');

    await submit();

    expect(await screen.findByText('Enter a valid URL')).toBeInTheDocument();
    expect(post.called).toBe(false);
  });

  it('rejects a non-PDF file without sending a request', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const post = trackPost();
    renderApp({ route: '/apply/tok123' });
    await fillValidForm();
    await user.upload(
      screen.getByLabelText('Upload CV (PDF)'),
      new File(['hello'], 'cv.txt', { type: 'text/plain' }),
    );

    await user.click(
      screen.getByRole('button', { name: 'Submit application' }),
    );

    expect(await screen.findByText('CV must be a PDF')).toBeInTheDocument();
    expect(post.called).toBe(false);
  });

  it('rejects a file over 5 MB without sending a request', async () => {
    const post = trackPost();
    renderApp({ route: '/apply/tok123' });
    await fillValidForm();
    await userEvent.upload(
      screen.getByLabelText('Upload CV (PDF)'),
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.pdf', {
        type: 'application/pdf',
      }),
    );

    await submit();

    expect(
      await screen.findByText('CV must be 5 MB or smaller'),
    ).toBeInTheDocument();
    expect(post.called).toBe(false);
  });

  it('submits multipart with trimmed values, omits blank links, and shows a success alert', async () => {
    let form: FormData | undefined;
    server.use(
      http.get(`${baseUrl}/apply/tok123`, () => HttpResponse.json(vacancy)),
      http.post(`${baseUrl}/apply/tok123`, async ({ request }) => {
        form = await request.formData();
        return HttpResponse.json({ success: true }, { status: 201 });
      }),
    );
    renderApp({ route: '/apply/tok123' });
    await screen.findByRole('heading', { name: 'Backend Dev' });

    await userEvent.type(screen.getByLabelText('Name'), '  Jane Doe  ');
    await userEvent.type(screen.getByLabelText('Email'), 'jane@example.com');
    await userEvent.type(
      screen.getByLabelText('GitHub URL'),
      'https://github.com/janedoe',
    );
    await userEvent.upload(screen.getByLabelText('Upload CV (PDF)'), pdf());
    expect(screen.getByText('cv.pdf')).toBeInTheDocument();

    await submit();

    expect(
      await screen.findByText('Application submitted — thanks, Jane Doe!'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Submit application' }),
    ).not.toBeInTheDocument();
    expect(form?.get('name')).toBe('Jane Doe');
    expect(form?.get('email')).toBe('jane@example.com');
    expect(form?.get('githubUrl')).toBe('https://github.com/janedoe');
    expect(form?.has('portfolioUrl')).toBe(false);
    const cv = form?.get('cv');
    // jsdom's File loses its filename when serialized by the Node fetch layer
    // (the filename is asserted in api/apply.test.ts), so check type and size.
    expect(cv).toBeTruthy();
    expect((cv as Blob).type).toBe('application/pdf');
    expect((cv as Blob).size).toBe(pdf().size);
  });

  it('shows the server message on a 400', async () => {
    server.use(
      http.get(`${baseUrl}/apply/tok123`, () => HttpResponse.json(vacancy)),
      http.post(`${baseUrl}/apply/tok123`, () =>
        HttpResponse.json(
          { message: 'CV is not a readable PDF' },
          { status: 400 },
        ),
      ),
    );
    renderApp({ route: '/apply/tok123' });
    await fillValidForm();

    await submit();

    expect(
      await screen.findByText('CV is not a readable PDF'),
    ).toBeInTheDocument();
  });

  it('maps a 413 to the size message', async () => {
    server.use(
      http.get(`${baseUrl}/apply/tok123`, () => HttpResponse.json(vacancy)),
      http.post(`${baseUrl}/apply/tok123`, () =>
        HttpResponse.json({ message: 'File too large' }, { status: 413 }),
      ),
    );
    renderApp({ route: '/apply/tok123' });
    await fillValidForm();

    await submit();

    expect(
      await screen.findByText('CV must be 5 MB or smaller'),
    ).toBeInTheDocument();
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
