import { Link as RouterLink, useParams } from 'react-router';
import {
  Alert,
  Button,
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
import { apiUrl } from '../api/client';
import { ParseStatusChip } from '../candidates/ParseStatusChip';
import { isParseInFlight } from '../candidates/parseStatus';
import { useCandidate, useReparseCandidate } from '../candidates/queries';
import { formatDate } from '../lib/format';
import { errorMessage, isNotFound } from '../lib/errors';
import { safeExternalUrl } from '../lib/safeUrl';

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const PARSING = 'Parsing CV…';
const NOT_AVAILABLE = 'Not available yet — profile will be filled from the CV';

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
  const reparse = useReparseCandidate(id);

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
    cv,
    parseStatus,
    parseError,
    createdAt,
  } = candidate.data;
  const placeholder = isParseInFlight(parseStatus) ? PARSING : NOT_AVAILABLE;

  return (
    <Stack spacing={3}>
      {backLink}

      <Stack spacing={0.5}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Typography variant="h4">{name}</Typography>
          <ParseStatusChip status={parseStatus} />
        </Stack>
        <Link href={`mailto:${email}`}>{email}</Link>
        <Typography color="text.secondary">
          Added {formatDate(createdAt)}
        </Typography>
      </Stack>

      {parseStatus === 'failed' && (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              size="small"
              disabled={reparse.isPending}
              onClick={() => reparse.mutate()}
            >
              Retry parsing
            </Button>
          }
        >
          {parseError || 'Could not parse the CV'}
          {reparse.isError && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {errorMessage(reparse.error)}
            </Typography>
          )}
        </Alert>
      )}

      {(githubUrl || portfolioUrl) && (
        <Stack direction="row" spacing={2}>
          <ExternalLink label="GitHub" value={githubUrl} />
          <ExternalLink label="Portfolio" value={portfolioUrl} />
        </Stack>
      )}

      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Button
          component="a"
          variant="outlined"
          href={apiUrl(`/candidates/${encodeURIComponent(id)}/cv`)}
          target="_blank"
          rel="noopener noreferrer"
        >
          View CV
        </Button>
        <Typography color="text.secondary">
          {cv.filename} · {formatSize(cv.sizeBytes)} · uploaded{' '}
          {formatDate(cv.uploadedAt)}
        </Typography>
      </Stack>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Summary
        </Typography>
        {summary ? (
          <Typography sx={{ whiteSpace: 'pre-wrap' }}>{summary}</Typography>
        ) : (
          <Typography color="text.secondary">{placeholder}</Typography>
        )}
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Skills
        </Typography>
        {skills.length === 0 ? (
          <Typography color="text.secondary">{placeholder}</Typography>
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
        {experience ? (
          <Typography sx={{ whiteSpace: 'pre-wrap' }}>{experience}</Typography>
        ) : (
          <Typography color="text.secondary">{placeholder}</Typography>
        )}
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Projects
        </Typography>
        {projects.length === 0 ? (
          <Typography color="text.secondary">{placeholder}</Typography>
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
