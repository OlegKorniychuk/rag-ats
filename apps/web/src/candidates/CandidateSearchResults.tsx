import { Chip, Link, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router';
import { PageLoader } from '../components/PageLoader';
import { QueryErrorAlert } from '../components/QueryErrorAlert';
import { QuoteBlock } from '../components/QuoteBlock';
import { useCandidateSearch } from './queries';

const MAX_VISIBLE_SKILLS = 5;

export function CandidateSearchResults({ query }: { query: string }) {
  const { data, isPending, isError, error } = useCandidateSearch(query);

  if (isPending) return <PageLoader />;
  if (isError) return <QueryErrorAlert error={error} what="search results" />;
  if (data.length === 0) {
    return <Typography>No candidates match &quot;{query}&quot;</Typography>;
  }

  return (
    <Stack spacing={2}>
      <Stack spacing={0.5}>
        <Typography variant="h6" component="h2">
          {data.length} {data.length === 1 ? 'match' : 'matches'} for &quot;
          {query}&quot;
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Only candidates whose CV has been processed appear in search.
        </Typography>
      </Stack>
      <Stack
        component="ul"
        aria-label="Search results"
        spacing={2}
        sx={{ m: 0, p: 0, listStyle: 'none' }}
      >
        {data.map(({ candidate, similarity, snippets }) => {
          const visibleSkills = candidate.skills.slice(0, MAX_VISIBLE_SKILLS);
          const extraSkillCount =
            candidate.skills.length - visibleSkills.length;
          return (
            <Paper
              key={candidate.id}
              component="li"
              sx={{ p: 2, listStyle: 'none' }}
            >
              <Stack spacing={1.5}>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <Link
                    component={RouterLink}
                    to={`/candidates/${candidate.id}`}
                    variant="subtitle1"
                  >
                    {candidate.name}
                  </Link>
                  <Chip
                    size="small"
                    color="primary"
                    label={`${Math.round(similarity * 100)}% match`}
                  />
                </Stack>
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
                {snippets.map((snippet, index) => (
                  <QuoteBlock key={index} quote={snippet} clamp />
                ))}
              </Stack>
            </Paper>
          );
        })}
      </Stack>
    </Stack>
  );
}
