import type {
  AuthUserResponse,
  LoginRequest,
  RegisterRequest,
  RegisterResponse,
  SuccessResponse,
} from '@rag-ats/shared';
import { apiFetch } from './client';

export const register = (body: RegisterRequest) =>
  apiFetch<RegisterResponse>('/auth/register', { method: 'POST', json: body });

export const login = (body: LoginRequest) =>
  apiFetch<SuccessResponse>('/auth/login', { method: 'POST', json: body });

export const logout = () =>
  apiFetch<SuccessResponse>('/auth/logout', { method: 'POST' });

export const getMe = () => apiFetch<AuthUserResponse>('/auth/me');
