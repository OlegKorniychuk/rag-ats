import type { ParseStatus } from '@rag-ats/shared';
import { Chip, CircularProgress } from '@mui/material';

const LABELS = {
  pending: 'Pending',
  parsing: 'Parsing…',
  parsed: 'Parsed',
  failed: 'Failed',
} satisfies Record<ParseStatus, string>;

const COLORS = {
  pending: 'default',
  parsing: 'info',
  parsed: 'success',
  failed: 'error',
} satisfies Record<ParseStatus, 'default' | 'info' | 'success' | 'error'>;

interface ParseStatusChipProps {
  status: ParseStatus;
  showParsed?: boolean;
}

export function ParseStatusChip({
  status,
  showParsed = false,
}: ParseStatusChipProps) {
  if (status === 'parsed' && !showParsed) return null;
  return (
    <Chip
      size="small"
      label={LABELS[status]}
      color={COLORS[status]}
      variant={status === 'pending' ? 'outlined' : 'filled'}
      icon={
        status === 'parsing' ? (
          <CircularProgress size={12} color="inherit" />
        ) : undefined
      }
      aria-label={`CV parsing: ${LABELS[status]}`}
    />
  );
}
