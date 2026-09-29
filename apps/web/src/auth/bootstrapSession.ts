import { getMe } from '../api/auth';
import { useSessionStore } from './sessionStore';

export async function bootstrapSession(): Promise<void> {
  try {
    const user = await getMe();
    useSessionStore.getState().setUser(user);
  } catch {
    useSessionStore.getState().clear();
  }
}
