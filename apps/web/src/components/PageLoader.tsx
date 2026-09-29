import { Box, CircularProgress } from '@mui/material';

export function PageLoader() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
      <CircularProgress aria-label="Loading" />
    </Box>
  );
}
