import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuoteBlock } from './QuoteBlock';

const longText = 'Built distributed systems. '.repeat(20);

describe('QuoteBlock', () => {
  it('renders the source label and text', () => {
    render(<QuoteBlock quote={{ source: 'github', text: 'Short quote' }} />);

    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('Short quote')).toBeInTheDocument();
  });

  it('never offers a toggle without clamp', () => {
    render(<QuoteBlock quote={{ source: 'cv', text: longText }} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not offer a toggle for short text when clamped', () => {
    render(<QuoteBlock quote={{ source: 'cv', text: 'Short' }} clamp />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('toggles long clamped text between more and less', async () => {
    render(<QuoteBlock quote={{ source: 'cv', text: longText }} clamp />);

    const toggle = screen.getByRole('button', { name: 'Show more' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(
      screen.getByRole('button', { name: 'Show more' }),
    ).toBeInTheDocument();
  });
});
