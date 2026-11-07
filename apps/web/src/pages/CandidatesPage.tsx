import { type FormEvent, useState } from 'react';
import {
  Chip,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { Link as RouterLink, useSearchParams } from 'react-router';
import { PageLoader } from '../components/PageLoader';
import { QueryErrorAlert } from '../components/QueryErrorAlert';
import { formatDate } from '../lib/format';
import { useCandidates } from '../candidates/queries';
import { CandidateSearchResults } from '../candidates/CandidateSearchResults';
import { ParseStatusChip } from '../candidates/ParseStatusChip';

const MAX_VISIBLE_SKILLS = 5;

export function CandidatesPage() {
  const { data, isPending, isError, error } = useCandidates();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  // the input edits a local draft; only Enter commits it to the URL (and so
  // triggers a search, which costs an embedding call)
  const [draft, setDraft] = useState(query);
  const [syncedQuery, setSyncedQuery] = useState(query);
  if (query !== syncedQuery) {
    // ?q= changed by navigation (back/forward, link): mirror it in the input
    setSyncedQuery(query);
    setDraft(query);
  }

  const commitQuery = (value: string) => {
    const trimmed = value.trim();
    setSearchParams(trimmed ? { q: trimmed } : {}, { replace: true });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    commitQuery(draft);
  };

  const countText =
    !query && data && data.length > 0 ? `${data.length} candidates` : undefined;

  return (
    <Stack spacing={3}>
      <Stack
        direction="row"
        sx={{ justifyContent: 'space-between', alignItems: 'center' }}
      >
        <Typography variant="h4">Candidates</Typography>
        {countText && (
          <Typography color="text.secondary">{countText}</Typography>
        )}
      </Stack>

      <form role="search" onSubmit={handleSubmit}>
        <TextField
          label="Search candidates"
          placeholder="e.g. backend engineer with Kafka and Kubernetes"
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setDraft('');
              commitQuery('');
            }
          }}
          sx={{ width: { xs: '100%', sm: 400 } }}
          slotProps={{
            input: {
              startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1 }} />,
            },
          }}
        />
      </form>

      {query && <CandidateSearchResults query={query} />}

      {!query && isPending && <PageLoader />}

      {!query && isError && <QueryErrorAlert error={error} what="candidates" />}

      {!query && !isPending && !isError && data?.length === 0 && (
        <Typography>No candidates yet</Typography>
      )}

      {!query && !isPending && !isError && data && data.length > 0 && (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Skills</TableCell>
                <TableCell>Added</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.map((candidate) => {
                const visibleSkills = candidate.skills.slice(
                  0,
                  MAX_VISIBLE_SKILLS,
                );
                const extraSkillCount =
                  candidate.skills.length - visibleSkills.length;
                return (
                  <TableRow key={candidate.id}>
                    <TableCell>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center' }}
                      >
                        <Link
                          component={RouterLink}
                          to={`/candidates/${candidate.id}`}
                        >
                          {candidate.name}
                        </Link>
                        <ParseStatusChip status={candidate.parseStatus} />
                      </Stack>
                    </TableCell>
                    <TableCell>{candidate.email}</TableCell>
                    <TableCell>
                      <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{ flexWrap: 'wrap' }}
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
                    </TableCell>
                    <TableCell>{formatDate(candidate.createdAt)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}
