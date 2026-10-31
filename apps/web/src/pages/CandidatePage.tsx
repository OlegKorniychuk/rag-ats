import { useState } from 'react';
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
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import type { ParseStatus, VacancyResponse } from '@rag-ats/shared';
import { NotFoundState } from '../components/NotFoundState';
import { PageLoader } from '../components/PageLoader';
import { QueryErrorAlert } from '../components/QueryErrorAlert';
import { apiUrl } from '../api/client';
import { AddToVacancyDialog } from '../candidates/AddToVacancyDialog';
import { CandidateVacancies } from '../candidates/CandidateVacancies';
import { GithubSection } from '../candidates/GithubSection';
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
const NOT_FOUND = 'Not found in the CV';
const PARSE_FAILED = 'Not available — the CV could not be parsed';

/** What an empty profile field means depends on how far the parse got. */
function emptyFieldText(status: ParseStatus): string {
  if (isParseInFlight(status)) return PARSING;
  return status === 'failed' ? PARSE_FAILED : NOT_FOUND;
}

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
  const [dialog, setDialog] = useState({ open: false, openCount: 0 });
  const [added, setAdded] = useState<VacancyResponse | null>(null);

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
    github,
    parseStatus,
    parseError,
    createdAt,
  } = candidate.data;
  const placeholder = emptyFieldText(parseStatus);

  const openDialog = () =>
    setDialog((d) => ({ open: true, openCount: d.openCount + 1 }));
  const closeDialog = () => setDialog((d) => ({ ...d, open: false }));
  const handleAdded = (vacancy: VacancyResponse) => {
    closeDialog();
    setAdded(vacancy);
  };

  return (
    <Stack spacing={3}>
      {backLink}

      <Stack
        direction="row"
        sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
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
        <Button variant="contained" onClick={openDialog}>
          Add to vacancy
        </Button>
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

      <CandidateVacancies candidateId={id} />

      <GithubSection github={github} />

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

      <AddToVacancyDialog
        key={dialog.openCount}
        open={dialog.open}
        candidateId={id}
        onClose={closeDialog}
        onAdded={handleAdded}
      />

      <Snackbar
        open={added !== null}
        autoHideDuration={6000}
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') setAdded(null);
        }}
        message={added ? `Added to ${added.title}` : ''}
        action={
          added && (
            <Button
              color="inherit"
              size="small"
              component={RouterLink}
              to={`/vacancies/${encodeURIComponent(added.id)}`}
            >
              View pipeline
            </Button>
          )
        }
      />
    </Stack>
  );
}
