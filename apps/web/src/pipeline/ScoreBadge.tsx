import type { KeyboardEvent, MouseEvent, ReactElement } from 'react';
import type { ApplicationScore } from '@rag-ats/shared';
import { Chip, CircularProgress, Tooltip } from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import { isScoreInFlight, scoreBand } from './score';

interface ScoreBadgeProps {
  score: ApplicationScore;
  /** Without it the badge is a plain, non-interactive chip. */
  onClick?: () => void;
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
  // Scored against older requirements and not being redone (a closed vacancy
  // edited since): greyed out like an in-flight stale score, but with a
  // history marker instead of a spinner, so it doesn't pass for a current one.
  const outdated = score.status === 'scored' && score.stale;

  const color =
    score.status === 'scored' && previous !== undefined && !outdated
      ? scoreBand(previous)
      : score.status === 'failed'
        ? 'error'
        : 'default';

  const sx = {
    fontWeight: 600,
    ...(((inFlight && previous !== undefined) || outdated) && { opacity: 0.6 }),
  };
  const icon = inFlight ? (
    <CircularProgress size={12} color="inherit" />
  ) : outdated ? (
    <HistoryIcon />
  ) : undefined;

  const withTooltip = (chip: ReactElement) =>
    outdated ? (
      <Tooltip title="Outdated: scored against older requirements">
        {chip}
      </Tooltip>
    ) : (
      chip
    );

  if (!onClick) {
    return withTooltip(
      <Chip
        role="img"
        size="small"
        label={label}
        color={color}
        icon={icon}
        aria-label={aria}
        sx={sx}
      />,
    );
  }

  // The card is draggable and navigates on click/Enter/Space: keep the badge's
  // activation from reaching those handlers.
  const handleClick = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    onClick();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  return withTooltip(
    <Chip
      component="button"
      type="button"
      size="small"
      label={label}
      color={color}
      icon={icon}
      aria-label={aria}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      sx={{ cursor: 'pointer', ...sx }}
    />,
  );
}
