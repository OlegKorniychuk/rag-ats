import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { server } from '../test/server';
import { renderWithProviders } from '../test/render';
import { HomePage } from './HomePage';

const baseUrl = 'http://localhost:3000';

describe('HomePage', () => {
  it('renders API: ok when the health check succeeds', async () => {
    server.use(
      http.get(`${baseUrl}/`, () => new HttpResponse('ok', { status: 200 })),
    );
    renderWithProviders(<HomePage />);
    expect(await screen.findByText('API: ok')).toBeInTheDocument();
  });

  it('renders an error alert when the health check fails', async () => {
    server.use(
      http.get(`${baseUrl}/`, () => new HttpResponse(null, { status: 500 })),
    );
    renderWithProviders(<HomePage />);
    expect(await screen.findByText(/API unreachable:/)).toBeInTheDocument();
  });
});
