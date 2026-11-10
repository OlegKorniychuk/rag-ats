import type { KeyboardEvent, MouseEvent, ReactElement } from 'react';
import type { ApplicationScore, ParseStatus } from '@rag-ats/shared';
import { Chip, CircularProgress, Tooltip } from '@mui/material';
import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined';
import HistoryIcon from '@mui/icons-material/History';
import { isBlockedByFailedParse, isScoreInFlight, scoreBand } from './score';

interface ScoreBadgeProps {
  score: ApplicationScore;
  /** The candidate's parse status: a score waiting on a failed parse can't progress. */
  parseStatus?: ParseStatus;
  /** Without it the badge is a plain, non-interactive chip. */
  onClick?: () => void;
}

function describe(
  score: ApplicationScore,
  blocked: boolean,
): { label: string; aria: string } {
  const previous = score.result?.overall;
  if (score.status === 'scored' && previous !== undefined) {
    return {
      label: String(previous),
      aria: `Fit score ${previous} of 100${score.stale ? ' (outdated)' : ''}`,
    };
  }
  if (score.status === 'failed' && previous !== undefined) {
    return {
      label: String(previous),
      aria: `Fit score ${previous} of 100 (last rescore failed)`,
    };
  }
  if (score.status === 'failed') {
    return { label: 'Score failed', aria: 'Fit score failed' };
  }
  if (blocked) {
    return {
      label: 'Waiting for CV (parse failed)',
      aria: 'Fit score: waiting for CV (parse failed)',
    };
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

export function ScoreBadge({ score, parseStatus, onClick }: ScoreBadgeProps) {
  const blocked = isBlockedByFailedParse(score, parseStatus);
  const { label, aria } = describe(score, blocked);
  const inFlight = isScoreInFlight(score) && !blocked;
  const previous = score.result?.overall;
  // Scored against older requirements and not being redone (a closed vacancy
  // edited since): greyed out like an in-flight stale score, but with a
  // history marker instead of a spinner, so it doesn't pass for a current one.
  const outdated = score.status === 'scored' && score.stale;

  // A rescore failed but the API kept the last valid result: show it greyed
  // out with an error marker, so the failure is visible without losing it.
  const failedWithPrevious =
    score.status === 'failed' && previous !== undefined;

  const color =
    score.status === 'scored' && previous !== undefined && !outdated
      ? scoreBand(previous)
      : score.status === 'failed'
        ? 'error'
        : 'default';

  const sx = {
    fontWeight: 600,
    ...(((inFlight && previous !== undefined) ||
      outdated ||
      failedWithPrevious) && {
      opacity: 0.6,
    }),
  };
  const icon = inFlight ? (
    <CircularProgress size={12} color="inherit" />
  ) : outdated ? (
    <HistoryIcon />
  ) : failedWithPrevious ? (
    <ErrorOutlinedIcon />
  ) : undefined;

  const tooltip = outdated
    ? 'Outdated: scored against older requirements'
    : failedWithPrevious
      ? 'Last rescore failed — showing the previous score'
      : null;
  const withTooltip = (chip: ReactElement) =>
    tooltip ? <Tooltip title={tooltip}>{chip}</Tooltip> : chip;

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
