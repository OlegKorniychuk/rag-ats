import type { VacancyResponse } from '@rag-ats/shared';
import { Chip, IconButton, TableCell, TableRow, Tooltip } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import { ApiError } from '../api/client';
import { useUpdateVacancy } from './queries';

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
});

interface VacancyRowProps {
  vacancy: VacancyResponse;
  onNotify: (message: string) => void;
}

export function VacancyRow({ vacancy, onNotify }: VacancyRowProps) {
  const updateVacancy = useUpdateVacancy();
  const isOpen = vacancy.status === 'open';

  const handleCopyLink = async () => {
    const link = `${window.location.origin}/apply/${vacancy.applyToken}`;
    try {
      await navigator.clipboard.writeText(link);
      onNotify('Apply link copied');
    } catch {
      onNotify('Could not copy link');
    }
  };

  const handleToggleStatus = () => {
    const nextStatus = isOpen ? 'closed' : 'open';
    updateVacancy.mutate(
      { id: vacancy.id, body: { status: nextStatus } },
      {
        onSuccess: () =>
          onNotify(
            nextStatus === 'closed' ? 'Vacancy closed' : 'Vacancy reopened',
          ),
        onError: (error) =>
          onNotify(
            error instanceof ApiError
              ? error.messages.join(', ')
              : 'Something went wrong',
          ),
      },
    );
  };

  const toggleLabel = isOpen
    ? `Close ${vacancy.title}`
    : `Reopen ${vacancy.title}`;

  return (
    <TableRow>
      <TableCell>{vacancy.title}</TableCell>
      <TableCell>
        <Chip
          size="small"
          label={vacancy.status}
          color={isOpen ? 'success' : 'default'}
        />
      </TableCell>
      <TableCell>{dateFormatter.format(new Date(vacancy.createdAt))}</TableCell>
      <TableCell align="right">
        <Tooltip title={`Copy apply link for ${vacancy.title}`}>
          <IconButton
            aria-label={`Copy apply link for ${vacancy.title}`}
            onClick={handleCopyLink}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={toggleLabel}>
          <span>
            <IconButton
              aria-label={toggleLabel}
              onClick={handleToggleStatus}
              disabled={updateVacancy.isPending}
            >
              {isOpen ? (
                <LockIcon fontSize="small" />
              ) : (
                <LockOpenIcon fontSize="small" />
              )}
            </IconButton>
          </span>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}
