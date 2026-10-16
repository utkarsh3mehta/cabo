import type { SessionResponse } from '@cabo/shared/client';

/**
 * Guest sessions are kept in localStorage so a refresh or a reopened tab can
 * reconnect to the same seat. Only the room code, player id and reconnect
 * token are stored — never any card information.
 */
const SESSIONS_KEY = 'cabo.sessions.v1';
const NAME_KEY = 'cabo.name';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface StoredSession extends SessionResponse {
  savedAt: number;
}

function readAll(): Record<string, StoredSession> {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, StoredSession>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(parsed).filter(([, s]) => s && typeof s.token === 'string' && now - s.savedAt < MAX_AGE_MS));
  } catch {
    return {};
  }
}

function writeAll(sessions: Record<string, StoredSession>): void {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // Storage may be unavailable (private mode); the session then lasts only for this page.
  }
}

const memoryFallback = new Map<string, StoredSession>();

export function saveSession(session: SessionResponse): void {
  const all = readAll();
  const stored = { ...session, savedAt: Date.now() };
  all[session.roomCode] = stored;
  memoryFallback.set(session.roomCode, stored);
  writeAll(all);
}

export function loadSession(roomCode: string): SessionResponse | null {
  return readAll()[roomCode] ?? memoryFallback.get(roomCode) ?? null;
}

export function forgetSession(roomCode: string): void {
  const all = readAll();
  delete all[roomCode];
  memoryFallback.delete(roomCode);
  writeAll(all);
}

export function recentSessions(): SessionResponse[] {
  return Object.values(readAll()).sort((a, b) => b.savedAt - a.savedAt);
}

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // ignore
  }
}
