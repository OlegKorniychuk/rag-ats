import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChipInput } from './ChipInput';

function Wrapper() {
  const [value, setValue] = useState<string[]>([]);
  return <ChipInput label="Skills" value={value} onChange={setValue} />;
}

describe('ChipInput', () => {
  it('adds a chip on Enter and clears the input', async () => {
    render(<Wrapper />);
    const input = screen.getByLabelText('Skills');
    await userEvent.type(input, 'TypeScript{Enter}');
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('adds a chip on comma', async () => {
    render(<Wrapper />);
    const input = screen.getByLabelText('Skills');
    await userEvent.type(input, 'React,');
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('ignores blank input', async () => {
    render(<Wrapper />);
    const input = screen.getByLabelText('Skills');
    await userEvent.type(input, '   {Enter}');
    expect(screen.queryAllByTestId('CancelIcon')).toHaveLength(0);
  });

  it('ignores exact duplicates', async () => {
    render(<Wrapper />);
    const input = screen.getByLabelText('Skills');
    await userEvent.type(input, 'React{Enter}');
    await userEvent.type(input, 'React{Enter}');
    expect(screen.getAllByText('React')).toHaveLength(1);
  });

  it('commits pending text on blur', async () => {
    render(
      <>
        <Wrapper />
        <button>outside</button>
      </>,
    );
    const input = screen.getByLabelText('Skills');
    await userEvent.type(input, 'Node');
    await userEvent.click(screen.getByRole('button', { name: 'outside' }));
    expect(screen.getByText('Node')).toBeInTheDocument();
  });

  it('deletes a chip', async () => {
    render(<Wrapper />);
    const input = screen.getByLabelText('Skills');
    await userEvent.type(input, 'Go{Enter}');
    expect(screen.getByText('Go')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('CancelIcon'));
    expect(screen.queryByText('Go')).not.toBeInTheDocument();
  });
});
