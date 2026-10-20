import {
  Alert,
  Chip,
  Link,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import type { GithubRepoSummary, GithubSummary } from '@rag-ats/shared';
import { formatDate } from '../lib/format';
import { safeExternalUrl } from '../lib/safeUrl';

const HEADING_ID = 'github-heading';

const UNAVAILABLE_REASON = {
  not_found: 'profile not found',
  unavailable: 'GitHub could not be reached',
} as const;

function SafeLink({ href, children }: { href: string; children: string }) {
  const safeUrl = safeExternalUrl(href);
  if (!safeUrl) return <>{children}</>;
  return (
    <Link href={safeUrl} target="_blank" rel="noopener noreferrer">
      {children}
    </Link>
  );
}

function RepoItem({ repo }: { repo: GithubRepoSummary }) {
  const details = [
    repo.language,
    `★ ${repo.stars}`,
    `pushed ${formatDate(repo.pushedAt)}`,
  ].filter(Boolean);

  return (
    <ListItem disableGutters>
      <ListItemText
        primary={<SafeLink href={repo.url}>{repo.name}</SafeLink>}
        secondary={
          <>
            {repo.description && (
              <Typography
                component="span"
                variant="body2"
                sx={{ display: 'block' }}
              >
                {repo.description}
              </Typography>
            )}
            <Typography
              component="span"
              variant="body2"
              color="text.secondary"
              sx={{ display: 'block' }}
            >
              {details.join(' · ')}
            </Typography>
          </>
        }
        slotProps={{ secondary: { component: 'div' } }}
      />
    </ListItem>
  );
}

export function GithubSection({ github }: { github: GithubSummary | null }) {
  if (!github) return null;

  if (github.status !== 'ok') {
    return (
      <Alert severity="info">
        GitHub data unavailable ({UNAVAILABLE_REASON[github.status]}) — the
        profile was parsed from the CV only.
      </Alert>
    );
  }

  return (
    <Paper component="section" aria-labelledby={HEADING_ID} sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'baseline' }}>
          <Typography id={HEADING_ID} variant="h6">
            GitHub
          </Typography>
          <SafeLink href={github.profileUrl}>{`@${github.username}`}</SafeLink>
        </Stack>

        {github.languages.length > 0 && (
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            {github.languages.map(({ name, repoCount }) => (
              <Chip key={name} label={`${name} · ${repoCount}`} />
            ))}
          </Stack>
        )}

        {github.repos.length === 0 ? (
          <Typography color="text.secondary">No public repositories</Typography>
        ) : (
          <List dense disablePadding>
            {github.repos.map((repo) => (
              <RepoItem key={repo.url} repo={repo} />
            ))}
          </List>
        )}
      </Stack>
    </Paper>
  );
}
