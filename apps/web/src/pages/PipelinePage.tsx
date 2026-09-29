import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import { Chip, Link, Snackbar, Stack, Typography } from '@mui/material';
import { NotFoundState } from '../components/NotFoundState';
import { PageLoader } from '../components/PageLoader';
import { QueryErrorAlert } from '../components/QueryErrorAlert';
import { isNotFound } from '../lib/errors';
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

  if (vacancy.isPending || applications.isPending) {
    return <PageLoader />;
  }

  if (vacancy.isError) {
    if (isNotFound(vacancy.error)) {
      return (
        <NotFoundState
          title="Vacancy not found"
          backTo="/vacancies"
          backLabel="← Vacancies"
        />
      );
    }
    return (
      <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
        {backLink}
        <QueryErrorAlert error={vacancy.error} what="this vacancy" />
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
        <QueryErrorAlert error={applications.error} what="applications" />
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
