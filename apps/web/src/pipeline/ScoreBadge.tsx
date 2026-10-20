import type { KeyboardEvent, MouseEvent } from 'react';
import type { ApplicationScore } from '@rag-ats/shared';
import { Chip, CircularProgress } from '@mui/material';
import { isScoreInFlight, scoreBand } from './score';

interface ScoreBadgeProps {
  score: ApplicationScore;
  onClick: () => void;
}

function describe(score: ApplicationScore): { label: string; aria: string } {
  const previous = score.result?.overall;
  if (score.status === 'scored' && previous !== undefined) {
    return {
      label: String(previous),
      aria: `Fit score ${previous} of 100${score.stale ? ' (outdated)' : ''}`,
    };
  }
  if (score.status === 'failed') {
    return { label: 'Score failed', aria: 'Fit score failed' };
  }
  const progress = score.waitingForParse ? 'Waiting for CV' : 'Scoring…';
  if (score.stale && previous !== undefined) {
    return {
      label: String(previous),
      aria: `Fit score ${previous} of 100, updating (${progress.replace('…', '').toLowerCase()})`,
    };
  }
  return { label: progress, aria: `Fit score: ${progress}` };
}

export function ScoreBadge({ score, onClick }: ScoreBadgeProps) {
  const { label, aria } = describe(score);
  const inFlight = isScoreInFlight(score);
  const previous = score.result?.overall;

  const color =
    score.status === 'scored' && previous !== undefined
      ? scoreBand(previous)
      : score.status === 'failed'
        ? 'error'
        : 'default';

  // The card is draggable and navigates on click/Enter/Space: keep the badge's
  // activation from reaching those handlers.
  const handleClick = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    onClick();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  return (
    <Chip
      component="button"
      type="button"
      size="small"
      label={label}
      color={color}
      icon={
        inFlight ? <CircularProgress size={12} color="inherit" /> : undefined
      }
      aria-label={aria}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      sx={{
        cursor: 'pointer',
        fontWeight: 600,
        ...(inFlight && previous !== undefined && { opacity: 0.6 }),
      }}
    />
  );
}
