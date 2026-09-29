import { Link as RouterLink, useParams } from 'react-router';
import {
  Chip,
  Link,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { NotFoundState } from '../components/NotFoundState';
import { PageLoader } from '../components/PageLoader';
import { QueryErrorAlert } from '../components/QueryErrorAlert';
import { useCandidate } from '../candidates/queries';
import { formatDate } from '../lib/format';
import { isNotFound } from '../lib/errors';
import { safeExternalUrl } from '../lib/safeUrl';

function ExternalLink({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  const safeUrl = safeExternalUrl(value);
  if (!safeUrl) {
    return <Typography>{value}</Typography>;
  }
  return (
    <Link href={safeUrl} target="_blank" rel="noopener noreferrer">
      {label}
    </Link>
  );
}

export function CandidatePage() {
  const { id = '' } = useParams();
  const candidate = useCandidate(id);

  const backLink = (
    <Link component={RouterLink} to="/candidates">
      ← Candidates
    </Link>
  );

  if (candidate.isPending) {
    return <PageLoader />;
  }

  if (candidate.isError) {
    if (isNotFound(candidate.error)) {
      return (
        <NotFoundState
          title="Candidate not found"
          backTo="/candidates"
          backLabel="← Candidates"
        />
      );
    }
    return (
      <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
        {backLink}
        <QueryErrorAlert error={candidate.error} what="this candidate" />
      </Stack>
    );
  }

  if (!candidate.data) return null;

  const {
    name,
    email,
    githubUrl,
    portfolioUrl,
    skills,
    experience,
    projects,
    summary,
    createdAt,
  } = candidate.data;

  return (
    <Stack spacing={3}>
      {backLink}

      <Stack spacing={0.5}>
        <Typography variant="h4">{name}</Typography>
        <Link href={`mailto:${email}`}>{email}</Link>
        <Typography color="text.secondary">
          Added {formatDate(createdAt)}
        </Typography>
      </Stack>

      {(githubUrl || portfolioUrl) && (
        <Stack direction="row" spacing={2}>
          <ExternalLink label="GitHub" value={githubUrl} />
          <ExternalLink label="Portfolio" value={portfolioUrl} />
        </Stack>
      )}

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Summary
        </Typography>
        <Typography sx={{ whiteSpace: 'pre-wrap' }}>{summary}</Typography>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Skills
        </Typography>
        {skills.length === 0 ? (
          <Typography color="text.secondary">No skills listed</Typography>
        ) : (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            {skills.map((skill) => (
              <Chip key={skill} label={skill} />
            ))}
          </Stack>
        )}
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Experience
        </Typography>
        <Typography sx={{ whiteSpace: 'pre-wrap' }}>{experience}</Typography>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Projects
        </Typography>
        {projects.length === 0 ? (
          <Typography color="text.secondary">No projects listed</Typography>
        ) : (
          <List dense>
            {projects.map((project, index) => (
              <ListItem key={`${index}-${project}`}>
                <ListItemText primary={project} />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
    </Stack>
  );
}
