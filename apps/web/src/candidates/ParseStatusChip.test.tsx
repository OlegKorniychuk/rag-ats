import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ParseStatusChip } from './ParseStatusChip';

describe('ParseStatusChip', () => {
  it.each([
    ['pending', 'Pending'],
    ['parsing', 'Parsing…'],
    ['failed', 'Failed'],
  ] as const)('renders %s', (status, label) => {
    render(<ParseStatusChip status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByLabelText(`CV parsing: ${label}`)).toBeInTheDocument();
  });

  it('renders nothing for parsed by default', () => {
    const { container } = render(<ParseStatusChip status="parsed" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders parsed when showParsed is set', () => {
    render(<ParseStatusChip status="parsed" showParsed />);
    expect(screen.getByText('Parsed')).toBeInTheDocument();
  });
});
