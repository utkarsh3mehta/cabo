import {
  ERROR_MESSAGES,
  SOCKET_PATH,
  isErrorCode,
  type CommandAck,
  type ErrorCode,
  type GameAction,
  type RoomCommand,
  type RoomView,
  type SafeError,
  type SessionEndReason,
  type SessionResponse,
  type VisibleEvent,
} from '@cabo/shared/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface RoomConnection {
  status: ConnectionStatus;
  view: RoomView | null;
  /** Recent events delivered to this player, oldest first. */
  events: VisibleEvent[];
  fatal: SafeError | null;
  ended: SessionEndReason | null;
  pending: boolean;
  send(command: RoomCommand): Promise<CommandAck>;
  game(action: GameAction): Promise<CommandAck>;
}

const FATAL_CODES: ErrorCode[] = ['INVALID_SESSION', 'SEAT_TAKEN_OVER', 'ROOM_NOT_FOUND'];
const MAX_EVENTS = 80;

function newActionId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function waitForConnect(socket: Socket, timeoutMs: number): Promise<boolean> {
  if (socket.connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off('connect', onConnect);
      resolve(false);
    }, timeoutMs);
    const onConnect = () => {
      clearTimeout(timer);
      resolve(true);
    };
    socket.once('connect', onConnect);
  });
}

const noResponse: CommandAck = {
  ok: false,
  error: { code: 'INTERNAL_ERROR', message: 'The server did not respond. Check your connection and try again.' },
};

/**
 * Owns the Socket.IO connection for one room seat. Snapshots older than the
 * latest version are ignored; commands are retried with the same actionId so
 * the server's idempotency check prevents double execution.
 */
export function useRoomConnection(session: SessionResponse | null): RoomConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [view, setView] = useState<RoomView | null>(null);
  const [events, setEvents] = useState<VisibleEvent[]>([]);
  const [fatal, setFatal] = useState<SafeError | null>(null);
  const [ended, setEnded] = useState<SessionEndReason | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!session) return;
    let closed = false;
    setStatus('connecting');
    setView(null);
    setEvents([]);
    setFatal(null);
    setEnded(null);

    const socket = io({
      path: SOCKET_PATH,
      auth: { token: session.token },
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      timeout: 10_000,
    });
    socketRef.current = socket;

    socket.on('connect', () => setStatus('connected'));
    socket.on('disconnect', () => {
      if (!closed) setStatus('reconnecting');
    });
    socket.on('connect_error', (err: Error & { data?: { code?: unknown } }) => {
      if (closed) return;
      const code = isErrorCode(err.message) ? err.message : isErrorCode(err.data?.code) ? err.data.code : null;
      if (code && FATAL_CODES.includes(code)) {
        closed = true;
        setFatal({ code, message: ERROR_MESSAGES[code] });
        setStatus('closed');
        socket.disconnect();
        return;
      }
      setStatus('reconnecting');
      // Rejections by server middleware are not retried automatically.
      if (!socket.active) setTimeout(() => !closed && socket.connect(), 2000);
    });
    socket.on('room:snapshot', (next: RoomView) => {
      setView((prev) => (!prev || next.version >= prev.version ? next : prev));
    });
    socket.on('game:events', (incoming: VisibleEvent[]) => {
      setEvents((prev) => [...prev, ...incoming].slice(-MAX_EVENTS));
    });
    socket.on('session:ended', (payload: { reason: SessionEndReason; error?: SafeError }) => {
      closed = true;
      setEnded(payload.reason);
      if (payload.error) setFatal(payload.error);
      setStatus('closed');
    });

    return () => {
      closed = true;
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session]);

  const send = useCallback(async (command: RoomCommand): Promise<CommandAck> => {
    const socket = socketRef.current;
    if (!socket) return noResponse;
    const actionId = newActionId();
    setPendingCount((n) => n + 1);
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        if (!(await waitForConnect(socket, 8000))) continue;
        try {
          return (await socket.timeout(6000).emitWithAck('room:command', { actionId, command })) as CommandAck;
        } catch {
          // Timed out: retry with the same actionId; the server will not apply it twice.
        }
      }
      return noResponse;
    } finally {
      setPendingCount((n) => n - 1);
    }
  }, []);

  const game = useCallback((action: GameAction) => send({ type: 'game', action }), [send]);

  return { status, view, events, fatal, ended, pending: pendingCount > 0, send, game };
}
