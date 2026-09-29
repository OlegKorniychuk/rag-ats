import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from './sessionStore';

const initialState = { status: 'loading' as const, user: null };

describe('sessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState(initialState);
  });

  it('starts in loading state with no user', () => {
    expect(useSessionStore.getState()).toMatchObject(initialState);
  });

  it('setUser transitions to authenticated with the given user', () => {
    const user = { id: '1', email: 'a@b.com' };
    useSessionStore.getState().setUser(user);
    expect(useSessionStore.getState()).toMatchObject({
      status: 'authenticated',
      user,
    });
  });

  it('clear transitions to anonymous with no user', () => {
    useSessionStore.getState().setUser({ id: '1', email: 'a@b.com' });
    useSessionStore.getState().clear();
    expect(useSessionStore.getState()).toMatchObject({
      status: 'anonymous',
      user: null,
    });
  });
});
