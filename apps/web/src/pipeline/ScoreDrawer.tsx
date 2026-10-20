import type {
  ApplicationWithCandidateResponse,
  CriterionScore,
  ScoreQuote,
  ScoreResult,
} from '@rag-ats/shared';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { ApiError } from '../api/client';
import { errorMessage } from '../lib/errors';
import { formatDate } from '../lib/format';
import { useRescoreApplication } from './queries';
import { isScoreInFlight, scoreBand } from './score';

const SOURCE_LABELS = {
  cv: 'CV',
  github: 'GitHub',
} satisfies Record<ScoreQuote['source'], string>;

const IMPORTANCE_LABELS = {
  must: 'Must',
  nice: 'Nice to have',
} satisfies Record<CriterionScore['importance'], string>;

function sortCriteria(criteria: readonly CriterionScore[]): CriterionScore[] {
  return [...criteria].sort((a, b) => {
    if (a.importance !== b.importance) return a.importance === 'must' ? -1 : 1;
    return b.score - a.score;
  });
}

function QuoteBlock({ quote }: { quote: ScoreQuote }) {
  return (
    <Box
      component="blockquote"
      sx={{
        m: 0,
        pl: 1.5,
        py: 0.5,
        borderLeft: 3,
        borderColor: 'divider',
        bgcolor: 'action.hover',
      }}
    >
      <Chip
        size="small"
        variant="outlined"
        label={SOURCE_LABELS[quote.source]}
        sx={{ mb: 0.5 }}
      />
      <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
        {quote.text}
      </Typography>
    </Box>
  );
}

function CriterionItem({ criterion }: { criterion: CriterionScore }) {
  return (
    <Stack component="li" spacing={1} sx={{ listStyle: 'none' }}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {criterion.criterion}
        </Typography>
        <Chip
          size="small"
          label={IMPORTANCE_LABELS[criterion.importance]}
          color={criterion.importance === 'must' ? 'primary' : 'default'}
          variant={criterion.importance === 'must' ? 'filled' : 'outlined'}
        />
      </Stack>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <LinearProgress
          variant="determinate"
          value={criterion.score}
          color={scoreBand(criterion.score)}
          aria-label={`Score for ${criterion.criterion}`}
          sx={{ flex: 1, height: 6, borderRadius: 3 }}
        />
        <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 28 }}>
          {criterion.score}
        </Typography>
      </Stack>
      <Typography variant="body2">{criterion.reasoning}</Typography>
      {criterion.quotes.map((quote, index) => (
        <QuoteBlock key={index} quote={quote} />
      ))}
    </Stack>
  );
}

function ResultSection({ result }: { result: ScoreResult }) {
  const band = scoreBand(result.overall);
  return (
    <Stack spacing={2}>
      <Stack spacing={1}>
        <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1 }}>
          <Typography
            variant="h3"
            component="p"
            color={`${band}.main`}
            aria-label={`Overall score ${result.overall} of 100`}
          >
            {result.overall}
          </Typography>
          <Typography color="text.secondary">/ 100</Typography>
        </Stack>
        <LinearProgress
          variant="determinate"
          value={result.overall}
          color={band}
          aria-hidden
          sx={{ height: 8, borderRadius: 4 }}
        />
      </Stack>
      <Typography>{result.rationale}</Typography>
      <Divider />
      <Typography variant="h6" component="h3">
        Criteria
      </Typography>
      <Stack component="ul" spacing={3} sx={{ m: 0, p: 0 }}>
        {sortCriteria(result.criteria).map((criterion) => (
          <CriterionItem key={criterion.criterionId} criterion={criterion} />
        ))}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Scored {formatDate(result.scoredAt)} · {result.model}
      </Typography>
    </Stack>
  );
}

interface ScoreDrawerContentProps {
  vacancyId: string;
  vacancyTitle: string;
  application: ApplicationWithCandidateResponse;
  onClose: () => void;
}

function ScoreDrawerContent({
  vacancyId,
  vacancyTitle,
  application,
  onClose,
}: ScoreDrawerContentProps) {
  const rescore = useRescoreApplication(vacancyId);
  const { score, candidate } = application;
  const inFlight = isScoreInFlight(score);

  return (
    <Stack spacing={2} sx={{ p: 3 }}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5" component="h2">
            {candidate.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Fit for {vacancyTitle}
          </Typography>
        </Stack>
        <IconButton aria-label="Close score details" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Stack>

      {inFlight && (
        <Alert
          severity="info"
          icon={<CircularProgress size={18} color="inherit" />}
        >
          {score.waitingForParse
            ? 'Waiting for the CV to be parsed'
            : 'Scoring in progress'}
          {score.stale && score.result && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              Showing the previous score; a new one is being computed.
            </Typography>
          )}
        </Alert>
      )}

      {score.status === 'failed' && (
        <Alert severity="error">{score.error || 'Scoring failed'}</Alert>
      )}

      {score.status === 'scored' && score.stale && (
        <Alert severity="warning">
          This score is out of date. Rescore to refresh it.
        </Alert>
      )}

      <Box>
        <Button
          variant="outlined"
          disabled={inFlight || rescore.isPending}
          onClick={() => rescore.mutate(application.id)}
        >
          Rescore
        </Button>
      </Box>

      {rescore.isError && (
        <Alert severity="error">
          {rescore.error instanceof ApiError && rescore.error.status === 409
            ? rescore.error.message
            : errorMessage(rescore.error)}
        </Alert>
      )}

      {score.result && <ResultSection result={score.result} />}
    </Stack>
  );
}

interface ScoreDrawerProps {
  vacancyId: string;
  vacancyTitle: string;
  application: ApplicationWithCandidateResponse | null;
  onClose: () => void;
}

export function ScoreDrawer({
  vacancyId,
  vacancyTitle,
  application,
  onClose,
}: ScoreDrawerProps) {
  return (
    <Drawer
      anchor="right"
      open={application !== null}
      onClose={onClose}
      slotProps={{
        paper: { sx: { width: 480, maxWidth: '100vw' } },
      }}
    >
      {application && (
        <ScoreDrawerContent
          key={application.id}
          vacancyId={vacancyId}
          vacancyTitle={vacancyTitle}
          application={application}
          onClose={onClose}
        />
      )}
    </Drawer>
  );
}
