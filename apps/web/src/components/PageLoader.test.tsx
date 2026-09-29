import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageLoader } from './PageLoader';

describe('PageLoader', () => {
  it('renders a centered, labeled progress indicator', () => {
    render(<PageLoader />);
    expect(
      screen.getByRole('progressbar', { name: 'Loading' }),
    ).toBeInTheDocument();
  });
});
