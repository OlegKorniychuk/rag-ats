import { create } from 'zustand';
import type { AuthUserResponse } from '@rag-ats/shared';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

interface SessionState {
  status: SessionStatus;
  user: AuthUserResponse | null;
  setUser(user: AuthUserResponse): void;
  clear(): void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'loading',
  user: null,
  setUser: (user) => set({ status: 'authenticated', user }),
  clear: () => set({ status: 'anonymous', user: null }),
}));
