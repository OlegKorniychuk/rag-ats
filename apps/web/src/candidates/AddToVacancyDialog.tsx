import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import type { VacancyResponse } from '@rag-ats/shared';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { QueryErrorAlert } from '../components/QueryErrorAlert';
import { errorMessage } from '../lib/errors';
import { useVacancies } from '../vacancies/queries';
import { useAddCandidateToVacancy, useCandidateApplications } from './queries';

interface AddToVacancyDialogProps {
  open: boolean;
  candidateId: string;
  onClose: () => void;
  onAdded: (vacancy: VacancyResponse) => void;
}

export function AddToVacancyDialog({
  open,
  candidateId,
  onClose,
  onAdded,
}: AddToVacancyDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <AddToVacancyForm
        candidateId={candidateId}
        onClose={onClose}
        onAdded={onAdded}
      />
    </Dialog>
  );
}

type AddToVacancyFormProps = Omit<AddToVacancyDialogProps, 'open'>;

function AddToVacancyForm({
  candidateId,
  onClose,
  onAdded,
}: AddToVacancyFormProps) {
  const [vacancyId, setVacancyId] = useState('');
  const vacancies = useVacancies();
  const applications = useCandidateApplications(candidateId);
  const add = useAddCandidateToVacancy(candidateId);

  const openVacancies = (vacancies.data ?? []).filter(
    (vacancy) => vacancy.status === 'open',
  );
  const alreadyAdded = new Set(
    (applications.data ?? []).map((application) => application.vacancyId),
  );
  const selected = openVacancies.find(
    (vacancy) => vacancy.id === vacancyId && !alreadyAdded.has(vacancy.id),
  );

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    add.mutate(selected.id, { onSuccess: () => onAdded(selected) });
  };

  const handleChange = (id: string) => {
    setVacancyId(id);
    add.reset();
  };

  const loadError = vacancies.error ?? applications.error;
  const isLoading = vacancies.isPending || applications.isPending;

  let body;
  if (loadError) {
    body = <QueryErrorAlert error={loadError} what="vacancies" />;
  } else if (isLoading) {
    body = <CircularProgress size={24} aria-label="Loading vacancies" />;
  } else if (openVacancies.length === 0) {
    body = (
      <Typography>
        You have no open vacancies to add this candidate to.{' '}
        <Link component={RouterLink} to="/vacancies">
          Go to vacancies
        </Link>
      </Typography>
    );
  } else {
    body = (
      <Stack spacing={2}>
        {add.isError && (
          <Alert severity="error">{errorMessage(add.error)}</Alert>
        )}
        <TextField
          select
          label="Vacancy"
          value={selected?.id ?? ''}
          onChange={(event) => handleChange(event.target.value)}
        >
          {openVacancies.map((vacancy) => (
            <MenuItem
              key={vacancy.id}
              value={vacancy.id}
              disabled={alreadyAdded.has(vacancy.id)}
            >
              <ListItemText
                primary={vacancy.title}
                secondary={
                  alreadyAdded.has(vacancy.id) ? 'Already added' : undefined
                }
              />
            </MenuItem>
          ))}
        </TextField>
      </Stack>
    );
  }

  const canSubmit = !loadError && !isLoading && openVacancies.length > 0;

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      <DialogTitle>Add to vacancy</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>{body}</Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={add.isPending}>
          {canSubmit ? 'Cancel' : 'Close'}
        </Button>
        {canSubmit && (
          <Button
            type="submit"
            variant="contained"
            disabled={!selected || add.isPending}
          >
            {add.isPending ? 'Adding…' : 'Add'}
          </Button>
        )}
      </DialogActions>
    </Box>
  );
}
