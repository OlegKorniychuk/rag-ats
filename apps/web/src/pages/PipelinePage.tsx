import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import {
  Alert,
  Chip,
  CircularProgress,
  Link,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import { ApiError } from '../api/client';
import { PipelineBoard } from '../pipeline/PipelineBoard';
import { useVacancyApplications } from '../pipeline/queries';
import { useVacancy } from '../vacancies/queries';

export function PipelinePage() {
  const { id = '' } = useParams();
  const vacancy = useVacancy(id);
  const applications = useVacancyApplications(id);
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);

  const backLink = (
    <Link component={RouterLink} to="/vacancies">
      ← Vacancies
    </Link>
  );

  if (vacancy.isLoading || applications.isLoading) {
    return <CircularProgress />;
  }

  if (vacancy.isError) {
    const notFound =
      vacancy.error instanceof ApiError &&
      (vacancy.error.status === 404 || vacancy.error.status === 400);
    return (
      <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
        {backLink}
        <Alert severity={notFound ? 'warning' : 'error'}>
          {notFound ? 'Vacancy not found' : vacancy.error.message}
        </Alert>
      </Stack>
    );
  }

  if (!vacancy.data) return null;

  const isOpen = vacancy.data.status === 'open';
  const applicationsData = applications.data ?? [];

  return (
    <Stack spacing={3}>
      {backLink}
      <Stack direction="row" sx={{ alignItems: 'center', gap: 2 }}>
        <Typography variant="h4">{vacancy.data.title}</Typography>
        <Chip
          size="small"
          label={vacancy.data.status}
          color={isOpen ? 'success' : 'default'}
        />
      </Stack>

      {applications.isError && (
        <Alert severity="error">
          Could not load applications: {applications.error.message}
        </Alert>
      )}

      {applicationsData.length === 0 && !applications.isError && (
        <Typography color="text.secondary">
          No applicants yet — share the apply link to get started
        </Typography>
      )}

      <PipelineBoard
        vacancyId={id}
        applications={applicationsData}
        onError={setSnackbarMessage}
      />

      <Snackbar
        open={snackbarMessage !== null}
        autoHideDuration={3000}
        onClose={() => setSnackbarMessage(null)}
        message={snackbarMessage}
      />
    </Stack>
  );
}
