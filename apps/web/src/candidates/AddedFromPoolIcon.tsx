import { Box, Tooltip } from '@mui/material';
import PersonAddAltIcon from '@mui/icons-material/PersonAddAlt';

export const ADDED_FROM_POOL_LABEL = 'Added from the candidate pool';

// An icon rather than a chip: next to the stage chip ("Applied") a text chip
// reading "Added" looked like a contradiction.
export function AddedFromPoolIcon() {
  return (
    <Tooltip title={`${ADDED_FROM_POOL_LABEL} by a recruiter`}>
      <Box
        component="span"
        role="img"
        aria-label={ADDED_FROM_POOL_LABEL}
        sx={{ display: 'inline-flex', color: 'text.secondary' }}
      >
        <PersonAddAltIcon fontSize="small" />
      </Box>
    </Tooltip>
  );
}
