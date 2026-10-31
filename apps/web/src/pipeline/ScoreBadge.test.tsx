import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApplicationScore, ScoreResult } from '@rag-ats/shared';
import { ScoreBadge } from './ScoreBadge';

const result = (overall: number): ScoreResult => ({
  overall,
  rationale: 'ok',
  criteria: [],
  cvDocumentId: 'cv1',
  model: 'gpt',
  mode: 'full_text',
  scoredAt: '2024-01-01T00:00:00.000Z',
});

const makeScore = (overrides: Partial<ApplicationScore>): ApplicationScore => ({
  status: 'pending',
  error: null,
  waitingForParse: false,
  stale: false,
  result: null,
  ...overrides,
});

describe('ScoreBadge', () => {
  it('shows the overall score with an accessible label', () => {
    render(
      <ScoreBadge
        score={makeScore({ status: 'scored', result: result(82) })}
        onClick={() => undefined}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Fit score 82 of 100' }),
    ).toHaveTextContent('82');
  });

  it('shows "Scoring…" while pending or scoring', () => {
    render(
      <ScoreBadge
        score={makeScore({ status: 'scoring' })}
        onClick={() => undefined}
      />,
    );
    expect(screen.getByRole('button')).toHaveTextContent('Scoring…');
  });

  it('shows "Waiting for CV" when waiting for the parse', () => {
    render(
      <ScoreBadge
        score={makeScore({ waitingForParse: true })}
        onClick={() => undefined}
      />,
    );
    expect(screen.getByRole('button')).toHaveTextContent('Waiting for CV');
  });

  it('keeps the old number while a stale score is being recomputed', () => {
    render(
      <ScoreBadge
        score={makeScore({ stale: true, result: result(61) })}
        onClick={() => undefined}
      />,
    );
    const badge = screen.getByRole('button', { name: /61 of 100, updating/ });
    expect(badge).toHaveTextContent('61');
    expect(badge.querySelector('[role="progressbar"]')).not.toBeNull();
  });

  it('greys out an outdated score that is not being recomputed', async () => {
    render(
      <ScoreBadge
        score={makeScore({ status: 'scored', stale: true, result: result(71) })}
        onClick={() => undefined}
      />,
    );
    const badge = screen.getByRole('button', {
      name: 'Fit score 71 of 100 (outdated)',
    });
    expect(badge).toHaveTextContent('71');
    expect(badge).toHaveClass('MuiChip-colorDefault');
    expect(badge.querySelector('[data-testid="HistoryIcon"]')).not.toBeNull();
    expect(badge.querySelector('[role="progressbar"]')).toBeNull();

    await userEvent.hover(badge);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Outdated: scored against older requirements',
    );
  });

  it('keeps the band colour and no marker for a current score', () => {
    render(
      <ScoreBadge
        score={makeScore({ status: 'scored', result: result(82) })}
        onClick={() => undefined}
      />,
    );
    const badge = screen.getByRole('button');
    expect(badge).toHaveClass('MuiChip-colorSuccess');
    expect(badge.querySelector('[data-testid="HistoryIcon"]')).toBeNull();
  });

  it('shows a failed chip', () => {
    render(
      <ScoreBadge
        score={makeScore({ status: 'failed', error: 'boom' })}
        onClick={() => undefined}
      />,
    );
    expect(screen.getByRole('button')).toHaveTextContent('Score failed');
  });

  it('calls onClick without bubbling to the parent', async () => {
    const onClick = vi.fn();
    const onParentClick = vi.fn();
    const onParentKeyDown = vi.fn();
    render(
      <div onClick={onParentClick} onKeyDown={onParentKeyDown}>
        <ScoreBadge
          score={makeScore({ status: 'scored', result: result(90) })}
          onClick={onClick}
        />
      </div>,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();

    screen.getByRole('button').focus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(onParentKeyDown).not.toHaveBeenCalled();
  });

  describe('without onClick', () => {
    it('renders a non-interactive chip with the same label and aria text', () => {
      render(
        <ScoreBadge
          score={makeScore({ status: 'scored', result: result(82) })}
        />,
      );
      const badge = screen.getByRole('img', { name: 'Fit score 82 of 100' });
      expect(badge).toHaveTextContent('82');
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(badge.tagName).not.toBe('BUTTON');
    });

    it('keeps the in-flight and waiting states', () => {
      const { rerender } = render(
        <ScoreBadge score={makeScore({ status: 'scoring' })} />,
      );
      const scoring = screen.getByRole('img', { name: 'Fit score: Scoring…' });
      expect(scoring).toHaveTextContent('Scoring…');
      expect(scoring.querySelector('[role="progressbar"]')).not.toBeNull();

      rerender(<ScoreBadge score={makeScore({ waitingForParse: true })} />);
      expect(screen.getByRole('img')).toHaveTextContent('Waiting for CV');
    });

    it('does not swallow clicks meant for a parent', async () => {
      const onParentClick = vi.fn();
      render(
        <div onClick={onParentClick}>
          <ScoreBadge
            score={makeScore({ status: 'scored', result: result(90) })}
          />
        </div>,
      );
      await userEvent.click(screen.getByRole('img'));
      expect(onParentClick).toHaveBeenCalledTimes(1);
    });
  });
});
