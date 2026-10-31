import { Link as RouterLink } from 'react-router';
import {
  Chip,
  CircularProgress,
  Link,
  List,
  ListItem,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import type { CandidateApplicationResponse } from '@rag-ats/shared';
import { QueryErrorAlert } from '../components/QueryErrorAlert';
import { stageLabel } from '../pipeline/board';
import { ScoreBadge } from '../pipeline/ScoreBadge';
import { useCandidateApplications } from './queries';

const HEADING_ID = 'candidate-vacancies-heading';

function VacancyRow({
  application,
}: {
  application: CandidateApplicationResponse;
}) {
  return (
    <ListItem
      disableGutters
      sx={{ gap: 1, flexWrap: 'wrap', justifyContent: 'space-between' }}
    >
      <Stack
        direction="row"
        sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
      >
        <Link
          component={RouterLink}
          to={`/vacancies/${encodeURIComponent(application.vacancyId)}`}
        >
          {application.vacancyTitle}
        </Link>
        {application.vacancyStatus === 'closed' && (
          <Chip label="Closed" size="small" variant="outlined" />
        )}
        <Chip label={stageLabel(application.stage)} size="small" />
        {application.source === 'added' && (
          <Chip label="Added" size="small" variant="outlined" />
        )}
      </Stack>
      <ScoreBadge score={application.score} />
    </ListItem>
  );
}

export function CandidateVacancies({ candidateId }: { candidateId: string }) {
  const applications = useCandidateApplications(candidateId);

  return (
    <Paper component="section" aria-labelledby={HEADING_ID} sx={{ p: 2 }}>
      <Typography id={HEADING_ID} variant="h6" gutterBottom>
        Vacancies
      </Typography>
      {applications.isPending ? (
        <CircularProgress size={24} aria-label="Loading vacancies" />
      ) : applications.isError ? (
        <QueryErrorAlert error={applications.error} what="vacancies" />
      ) : applications.data.length === 0 ? (
        <Typography color="text.secondary">
          Not on any of your vacancies yet
        </Typography>
      ) : (
        <List dense disablePadding>
          {applications.data.map((application) => (
            <VacancyRow key={application.id} application={application} />
          ))}
        </List>
      )}
    </Paper>
  );
}
