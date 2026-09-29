import { ApiError } from '../api/client';

export function isNotFound(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 404 || error.status === 400)
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  // fetch throws TypeError for network failures (offline, CORS, DNS, etc.)
  if (error instanceof TypeError) return 'Could not reach the server';
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
