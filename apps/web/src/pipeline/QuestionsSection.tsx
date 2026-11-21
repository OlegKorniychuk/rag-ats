import { useId } from 'react';
import type {
  ApplicationScore,
  InterviewQuestion,
  QuestionBasis,
  QuestionSet,
} from '@rag-ats/shared';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { QuoteBlock } from '../components/QuoteBlock';
import { errorMessage } from '../lib/errors';
import { formatDate } from '../lib/format';
import { ImportanceChip } from './ImportanceChip';
import { useApplicationQuestions, useGenerateQuestions } from './queries';

const GROUPS = [
  { basis: 'gap', title: 'Gaps to probe', chip: 'GAP' },
  { basis: 'fact', title: 'Facts to verify', chip: 'FACT' },
] as const satisfies readonly {
  basis: QuestionBasis;
  title: string;
  chip: string;
}[];

function QuestionItem({
  question,
  chip,
}: {
  question: InterviewQuestion;
  chip: string;
}) {
  return (
    <Stack component="li" spacing={1} sx={{ listStyle: 'none' }}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {question.criterion}
        </Typography>
        <ImportanceChip importance={question.importance} />
        <Chip
          size="small"
          variant="outlined"
          color={question.basis === 'gap' ? 'warning' : 'info'}
          label={chip}
        />
      </Stack>
      <Typography variant="body2">{question.text}</Typography>
      <Typography variant="caption" color="text.secondary">
        {`Checks: ${question.purpose}`}
      </Typography>
      {question.quotes.map((quote, index) => (
        <QuoteBlock key={index} quote={quote} />
      ))}
    </Stack>
  );
}

function QuestionGroup({
  title,
  chip,
  questions,
}: {
  title: string;
  chip: string;
  questions: InterviewQuestion[];
}) {
  const titleId = useId();
  if (questions.length === 0) return null;
  return (
    <Stack spacing={1}>
      <Typography id={titleId} variant="subtitle1" component="h4">
        {title}
      </Typography>
      <Stack
        component="ul"
        aria-labelledby={titleId}
        spacing={2}
        sx={{ m: 0, p: 0 }}
      >
        {questions.map((question, index) => (
          <QuestionItem key={index} question={question} chip={chip} />
        ))}
      </Stack>
    </Stack>
  );
}

function QuestionSetView({ set, stale }: { set: QuestionSet; stale: boolean }) {
  return (
    <Stack
      spacing={2}
      data-testid="questions-result"
      sx={{ opacity: stale ? 0.6 : 1 }}
    >
      {GROUPS.map((group) => (
        <QuestionGroup
          key={group.basis}
          title={group.title}
          chip={group.chip}
          questions={set.questions.filter((q) => q.basis === group.basis)}
        />
      ))}
      <Typography variant="caption" color="text.secondary">
        {`Generated ${formatDate(set.generatedAt)} · ${set.model}`}
      </Typography>
    </Stack>
  );
}

interface QuestionsSectionProps {
  applicationId: string;
  score: ApplicationScore;
}

/** Interview questions of an application, generated on demand from its fit score. */
export function QuestionsSection({
  applicationId,
  score,
}: QuestionsSectionProps) {
  const query = useApplicationQuestions(applicationId);
  const generate = useGenerateQuestions(applicationId);
  const questions = query.data;
  const status = questions?.status ?? null;
  const inFlight = status === 'pending' || status === 'generating';
  const scoreReady = score.status === 'scored' && !score.stale;

  const label =
    status === null
      ? 'Generate questions'
      : status === 'failed'
        ? 'Retry'
        : 'Regenerate';
  const button = (
    <Button
      variant="outlined"
      size="small"
      disabled={!scoreReady || !questions || inFlight || generate.isPending}
      onClick={() => generate.mutate()}
    >
      {label}
    </Button>
  );

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <Typography variant="h6" component="h3" sx={{ flex: 1 }}>
          Interview questions
        </Typography>
        {scoreReady ? (
          button
        ) : (
          <Tooltip title="Score the application first">
            <span>{button}</span>
          </Tooltip>
        )}
      </Stack>

      {query.isError && (
        <Alert severity="error">{errorMessage(query.error)}</Alert>
      )}

      {inFlight && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={18} />
          <Typography variant="body2">Generating questions…</Typography>
        </Box>
      )}

      {status === 'failed' && (
        <Alert severity="error">
          {questions?.error || 'Could not generate questions'}
        </Alert>
      )}

      {generate.isError && (
        <Alert severity="error">{errorMessage(generate.error)}</Alert>
      )}

      {questions?.stale && questions.result && !inFlight && (
        <Typography variant="body2" color="warning.main">
          Outdated: the CV, requirements or score changed
        </Typography>
      )}

      {questions?.result && (
        <QuestionSetView set={questions.result} stale={questions.stale} />
      )}
    </Stack>
  );
}
