import type { CriterionMatch, VacancyMatch } from '@rag-ats/shared';
import { Link as RouterLink } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Drawer,
  IconButton,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import { QueryErrorAlert } from '../components/QueryErrorAlert';
import { QuoteBlock } from '../components/QuoteBlock';
import { errorMessage } from '../lib/errors';
import { useAddMatch, useVacancyMatches } from './queries';

const MAX_VISIBLE_SKILLS = 5;

// Pixel strings on purpose: in `sx`, a bare `1` means 100%.
const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  border: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

function CriterionChip({ criterion }: { criterion: CriterionMatch }) {
  const { matched, importance } = criterion;
  return (
    <Chip
      component="li"
      size="small"
      variant="outlined"
      color={matched ? 'success' : 'default'}
      icon={matched ? <CheckIcon /> : undefined}
      // long criteria wrap instead of being cut off (with their "(must)")
      sx={{
        height: 'auto',
        maxWidth: '100%',
        '& .MuiChip-label': { whiteSpace: 'normal', py: 0.25 },
      }}
      label={
        <>
          {criterion.criterion}
          {importance === 'must' && (
            <Box component="strong" sx={{ ml: 0.5 }}>
              (must)
            </Box>
          )}
          <Box component="span" sx={visuallyHidden}>
            {matched ? ', matched' : ', not matched'}
          </Box>
        </>
      }
    />
  );
}

interface MatchCardProps {
  vacancyId: string;
  match: VacancyMatch;
  onAdded: (name: string) => void;
}

function MatchCard({ vacancyId, match, onAdded }: MatchCardProps) {
  const { candidate, criteria, snippets } = match;
  const add = useAddMatch(vacancyId, () => onAdded(candidate.name));
  const matchedCount = criteria.filter((c) => c.matched).length;
  const criterionText = new Map(criteria.map((c) => [c.criterionId, c]));
  const visibleSkills = candidate.skills.slice(0, MAX_VISIBLE_SKILLS);
  const extraSkillCount = candidate.skills.length - visibleSkills.length;

  return (
    <Paper component="li" sx={{ p: 2, listStyle: 'none' }}>
      <Stack spacing={1.5}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', flexWrap: 'wrap', flex: 1 }}
          >
            <Link
              component={RouterLink}
              to={`/candidates/${candidate.id}`}
              variant="subtitle1"
            >
              {candidate.name}
            </Link>
            {criteria.length > 0 && (
              <Chip
                size="small"
                color="primary"
                label={`${matchedCount} of ${criteria.length} criteria`}
              />
            )}
          </Stack>
          <Button
            size="small"
            variant="contained"
            disabled={add.isPending}
            startIcon={
              add.isPending ? (
                <CircularProgress size={14} color="inherit" />
              ) : undefined
            }
            aria-label={`Add ${candidate.name}`}
            onClick={() => add.mutate(candidate.id)}
          >
            {add.isPending ? 'Adding…' : 'Add'}
          </Button>
        </Stack>

        {add.isError && (
          <Alert severity="error">{errorMessage(add.error)}</Alert>
        )}

        {criteria.length > 0 && (
          <Stack
            component="ul"
            aria-label={`Criteria for ${candidate.name}`}
            direction="row"
            sx={{ m: 0, p: 0, listStyle: 'none', flexWrap: 'wrap', gap: 0.5 }}
          >
            {criteria.map((criterion) => (
              <CriterionChip
                key={criterion.criterionId}
                criterion={criterion}
              />
            ))}
          </Stack>
        )}

        {visibleSkills.length > 0 && (
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ flexWrap: 'wrap', rowGap: 0.5 }}
          >
            {visibleSkills.map((skill) => (
              <Chip key={skill} size="small" label={skill} />
            ))}
            {extraSkillCount > 0 && (
              <Chip
                size="small"
                variant="outlined"
                label={`+${extraSkillCount}`}
              />
            )}
          </Stack>
        )}

        {snippets.map((snippet, index) => {
          const forCriterion =
            snippet.criterionId === null
              ? undefined
              : criterionText.get(snippet.criterionId);
          return (
            <Stack key={index} spacing={0.5}>
              {forCriterion && (
                <Typography variant="caption" color="text.secondary">
                  For: {forCriterion.criterion}
                </Typography>
              )}
              <QuoteBlock quote={snippet} clamp />
            </Stack>
          );
        })}
      </Stack>
    </Paper>
  );
}

interface MatchesBodyProps {
  vacancyId: string;
  open: boolean;
  onAdded: (name: string) => void;
}

function MatchesBody({ vacancyId, open, onAdded }: MatchesBodyProps) {
  const matches = useVacancyMatches(vacancyId, { enabled: open });

  if (matches.isError) {
    return <QueryErrorAlert error={matches.error} what="matches" />;
  }
  if (!matches.data) {
    return (
      <Stack
        direction="row"
        role="status"
        sx={{ alignItems: 'center', gap: 1.5 }}
      >
        <CircularProgress size={20} />
        <Typography color="text.secondary">Finding matches…</Typography>
      </Stack>
    );
  }
  if (matches.data.matches.length === 0) {
    return (
      <Typography color="text.secondary">
        No pool candidates match this vacancy yet.
      </Typography>
    );
  }

  return (
    <Stack
      component="ul"
      aria-label="Matches"
      spacing={2}
      sx={{ m: 0, p: 0, listStyle: 'none' }}
    >
      {matches.data.matches.map((match) => (
        <MatchCard
          key={match.candidate.id}
          vacancyId={vacancyId}
          match={match}
          onAdded={onAdded}
        />
      ))}
    </Stack>
  );
}

interface MatchesDrawerProps {
  vacancyId: string;
  open: boolean;
  onClose: () => void;
  onAdded: (name: string) => void;
}

export function MatchesDrawer({
  vacancyId,
  open,
  onClose,
  onAdded,
}: MatchesDrawerProps) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: { sx: { width: { xs: '100vw', sm: 480 }, maxWidth: '100vw' } },
      }}
    >
      <Stack spacing={2} sx={{ p: 3 }}>
        <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
          <Stack sx={{ flex: 1, minWidth: 0 }} spacing={0.5}>
            <Typography variant="h5" component="h2">
              Matches from the candidate pool
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Ranked by how closely each candidate&apos;s CV and GitHub match
              the requirements. Added candidates are scored like applicants.
            </Typography>
          </Stack>
          <IconButton aria-label="Close matches" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Stack>
        <MatchesBody vacancyId={vacancyId} open={open} onAdded={onAdded} />
      </Stack>
    </Drawer>
  );
}
