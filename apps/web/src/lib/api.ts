import {
  ERROR_MESSAGES,
  isErrorCode,
  type CreateRoomRequest,
  type RoomInfoResponse,
  type SafeError,
  type SessionResponse,
} from '@cabo/shared/client';

export class ApiError extends Error {
  constructor(readonly error: SafeError) {
    super(error.message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  } catch {
    throw new ApiError({ code: 'INTERNAL_ERROR', message: 'Could not reach the server. Check your connection and try again.' });
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // fall through to a generic error
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: unknown } } | null)?.error;
    const code = isErrorCode(err?.code) ? err.code : res.status === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR';
    throw new ApiError({ code, message: ERROR_MESSAGES[code] });
  }
  return body as T;
}

export function createRoom(body: CreateRoomRequest): Promise<SessionResponse> {
  return request('/api/rooms', { method: 'POST', body: JSON.stringify(body) });
}

export function joinRoom(code: string, name: string): Promise<SessionResponse> {
  return request(`/api/rooms/${encodeURIComponent(code)}/join`, { method: 'POST', body: JSON.stringify({ name }) });
}

export function getRoomInfo(code: string): Promise<RoomInfoResponse> {
  return request(`/api/rooms/${encodeURIComponent(code)}`);
}
