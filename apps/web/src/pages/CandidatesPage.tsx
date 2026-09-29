import { useMemo } from 'react';
import {
  Alert,
  Chip,
  CircularProgress,
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
import { formatDate } from '../lib/format';
import { useCandidates } from '../candidates/queries';
import { filterCandidates } from '../candidates/filter';

const MAX_VISIBLE_SKILLS = 5;

export function CandidatesPage() {
  const { data, isLoading, isError, error } = useCandidates();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';

  const filtered = useMemo(
    () => (data ? filterCandidates(data, query) : []),
    [data, query],
  );

  const handleQueryChange = (value: string) => {
    setSearchParams(value ? { q: value } : {}, { replace: true });
  };

  const countText =
    data && data.length > 0
      ? query
        ? `${filtered.length} of ${data.length}`
        : `${data.length} candidates`
      : undefined;

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

      <TextField
        label="Filter by name, email or skill"
        type="search"
        value={query}
        onChange={(event) => handleQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            handleQueryChange('');
          }
        }}
        sx={{ width: { xs: '100%', sm: 400 } }}
        slotProps={{
          input: {
            startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1 }} />,
          },
        }}
      />

      {isLoading && <CircularProgress />}

      {isError && (
        <Alert severity="error">
          Could not load candidates: {error.message}
        </Alert>
      )}

      {!isLoading && !isError && data?.length === 0 && (
        <Typography>No candidates yet</Typography>
      )}

      {!isLoading &&
        !isError &&
        data &&
        data.length > 0 &&
        query &&
        filtered.length === 0 && (
          <Typography>No candidates match &quot;{query}&quot;</Typography>
        )}

      {!isLoading && !isError && filtered.length > 0 && (
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
              {filtered.map((candidate) => {
                const visibleSkills = candidate.skills.slice(
                  0,
                  MAX_VISIBLE_SKILLS,
                );
                const extraSkillCount =
                  candidate.skills.length - visibleSkills.length;
                return (
                  <TableRow key={candidate.id}>
                    <TableCell>
                      <Link
                        component={RouterLink}
                        to={`/candidates/${candidate.id}`}
                      >
                        {candidate.name}
                      </Link>
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
