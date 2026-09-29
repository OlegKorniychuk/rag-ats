export class ApiError extends Error {
  status: number;
  messages: string[];

  constructor(status: number, messages: string[]) {
    super(messages.join(', '));
    this.status = status;
    this.messages = messages;
  }
}

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, headers, ...rest } = init ?? {};
  const finalHeaders = new Headers(headers);
  let body = rest.body;
  if (json !== undefined) {
    body = JSON.stringify(json);
    finalHeaders.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...rest,
    body,
    headers: finalHeaders,
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') {
      unauthorizedHandler?.();
    }
    throw await toApiError(response);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  return (text === '' ? undefined : text) as T;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message: string | string[] }).message;
    return new ApiError(
      response.status,
      Array.isArray(message) ? message : [message],
    );
  }

  const fallback =
    response.statusText || `Request failed with status ${response.status}`;
  return new ApiError(response.status, [fallback]);
}
