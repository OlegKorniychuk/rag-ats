import {
  AppBar,
  Box,
  Button,
  Container,
  Toolbar,
  Typography,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { logout } from '../api/auth';
import { useSessionStore } from '../auth/sessionStore';

const navLinkSx = {
  color: 'inherit',
  '&.active': { textDecoration: 'underline' },
};

export function AppLayout() {
  const user = useSessionStore((state) => state.user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSettled: () => {
      useSessionStore.getState().clear();
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });

  return (
    <>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6">RAG-ATS</Typography>
          <Button
            component={NavLink}
            to="/vacancies"
            sx={{ ...navLinkSx, ml: 3 }}
          >
            Vacancies
          </Button>
          <Button component={NavLink} to="/candidates" sx={navLinkSx}>
            Candidates
          </Button>
          <Box sx={{ flexGrow: 1 }} />
          <Typography sx={{ mr: 2 }}>{user?.email}</Typography>
          <Button color="inherit" onClick={() => logoutMutation.mutate()}>
            Logout
          </Button>
        </Toolbar>
      </AppBar>
      <Container sx={{ mt: 4 }}>
        <Outlet />
      </Container>
    </>
  );
}
