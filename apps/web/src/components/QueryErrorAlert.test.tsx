import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApiError } from '../api/client';
import { QueryErrorAlert } from './QueryErrorAlert';

describe('QueryErrorAlert', () => {
  it('shows what failed and the error message', () => {
    render(
      <QueryErrorAlert error={new ApiError(500, ['Boom'])} what="vacancies" />,
    );
    expect(
      screen.getByText('Could not load vacancies: Boom'),
    ).toBeInTheDocument();
  });

  it('renders as an error severity alert', () => {
    render(<QueryErrorAlert error={new Error('oops')} what="candidates" />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not load candidates: oops',
    );
  });
});
