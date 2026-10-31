import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADDED_FROM_POOL_LABEL, AddedFromPoolIcon } from './AddedFromPoolIcon';

describe('AddedFromPoolIcon', () => {
  it('is labelled for screen readers and explains itself on hover', async () => {
    render(<AddedFromPoolIcon />);

    const icon = screen.getByRole('img', { name: ADDED_FROM_POOL_LABEL });
    await userEvent.hover(icon);

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Added from the candidate pool by a recruiter',
    );
  });
});
