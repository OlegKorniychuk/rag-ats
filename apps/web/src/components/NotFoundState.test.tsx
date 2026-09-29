import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { NotFoundState } from './NotFoundState';

describe('NotFoundState', () => {
  it('shows the title and a working back link', () => {
    render(
      <MemoryRouter>
        <NotFoundState
          title="Vacancy not found"
          backTo="/vacancies"
          backLabel="← Vacancies"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Vacancy not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Vacancies' })).toHaveAttribute(
      'href',
      '/vacancies',
    );
  });
});
