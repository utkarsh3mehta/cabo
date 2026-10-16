import type { CommandEnvelope } from './protocol.js';
import type { SafeError } from './errors.js';
import type { VisibleEvent } from './events.js';
import type { RoomPhase, RoomView } from './views.js';

// Zod-free protocol constants and types, safe to import in the browser bundle.

export interface SessionResponse {
  roomCode: string;
  playerId: string;
  /** Secret reconnect credential. Store it, never display or log it. */
  token: string;
}

export interface RoomInfoResponse {
  code: string;
  phase: RoomPhase;
  seatsTaken: number;
  maxSeats: number;
  joinable: boolean;
}

export interface ErrorResponse {
  error: SafeError;
}

export const SOCKET_PATH = '/socket.io';

export const CLIENT_EVENTS = {
  sync: 'room:sync',
  command: 'room:command',
} as const;

export const SERVER_EVENTS = {
  snapshot: 'room:snapshot',
  events: 'game:events',
  sessionEnded: 'session:ended',
} as const;

export type CommandAck = { ok: true; version: number; duplicate?: boolean } | { ok: false; error: SafeError };

export type SessionEndReason = 'seatTakenOver' | 'roomClosed' | 'replacedByNewConnection' | 'left' | 'removed';

export interface ServerToClientEvents {
  'room:snapshot': (view: RoomView) => void;
  'game:events': (events: VisibleEvent[]) => void;
  'session:ended': (payload: { reason: SessionEndReason; error?: SafeError }) => void;
}

export interface ClientToServerEvents {
  'room:sync': (payload: Record<string, never>, ack: (result: CommandAck) => void) => void;
  'room:command': (payload: CommandEnvelope, ack: (result: CommandAck) => void) => void;
}

export interface SocketAuth {
  token: string;
}

