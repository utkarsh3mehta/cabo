import type { Server as HttpServer, IncomingMessage } from 'node:http';
import {
  CLIENT_EVENTS,
  SOCKET_PATH,
  commandEnvelopeSchema,
  safeError,
  socketAuthSchema,
  type ClientToServerEvents,
  type CommandAck,
  type ErrorCode,
  type PlayerId,
  type ServerToClientEvents,
} from '@cabo/shared';
import { Server, type Socket } from 'socket.io';
import type { ServerConfig } from './config.js';
import type { Logger, RoomTransport } from './room.js';
import type { RoomManager } from './roomManager.js';

interface SocketData {
  roomCode: string;
  playerId: PlayerId;
  ip: string;
}

type CaboServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type CaboSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const seatChannel = (roomCode: string, playerId: PlayerId) => `seat:${roomCode}:${playerId}`;

/** Simple token bucket used to rate-limit commands per connection. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }
  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.refillPerSecond);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

function connectError(code: ErrorCode): Error {
  const err = new Error(code) as Error & { data?: unknown };
  err.data = safeError(code);
  return err;
}

function clientIp(req: IncomingMessage, config: ServerConfig): string {
  if (config.trustProxy !== false) {
    const forwarded = req.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** Placeholder transport used until the Socket.IO server exists (rooms are never created before that). */
export function createDeferredTransport(): { transport: RoomTransport; bind: (io: CaboServer) => void } {
  let server: CaboServer | null = null;
  const transport: RoomTransport = {
    snapshot(roomCode, playerId, view) {
      server?.to(seatChannel(roomCode, playerId)).emit('room:snapshot', view);
    },
    events(roomCode, playerId, events) {
      server?.to(seatChannel(roomCode, playerId)).emit('game:events', events);
    },
    endSession(roomCode, playerId, reason, socketId) {
      if (!server) return;
      const io = server;
      const payload = reason === 'seatTakenOver' ? { reason, error: safeError('SEAT_TAKEN_OVER') } : { reason };
      // Disconnect on a later tick so that a pending command acknowledgement
      // (for example the reply to "leave") is flushed first.
      if (socketId) {
        const s = io.sockets.sockets.get(socketId);
        s?.emit('session:ended', payload);
        setTimeout(() => s?.disconnect(true), 50);
        return;
      }
      const channel = seatChannel(roomCode, playerId);
      const sockets = [...(io.sockets.adapter.rooms.get(channel) ?? [])];
      io.to(channel).emit('session:ended', payload);
      setTimeout(() => {
        for (const id of sockets) io.sockets.sockets.get(id)?.disconnect(true);
      }, 50);
    },
  };
  return { transport, bind: (io) => (server = io) };
}

export function attachSocketServer(
  httpServer: HttpServer,
  config: ServerConfig,
  manager: RoomManager,
  logger: Logger,
  bindTransport: (io: CaboServer) => void,
): CaboServer {
  const allowedOrigins = config.publicOrigin ? [config.publicOrigin] : null;
  const connectionsByIp = new Map<string, number>();

  const io: CaboServer = new Server(httpServer, {
    path: SOCKET_PATH,
    serveClient: false,
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 10_000,
    pingTimeout: 8_000,
    connectionStateRecovery: undefined,
    cors: allowedOrigins ? { origin: allowedOrigins, credentials: false } : undefined,
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      // Browsers always send Origin; non-browser clients still need a valid session token.
      if (origin && allowedOrigins && !allowedOrigins.includes(origin)) return callback('origin not allowed', false);
      callback(null, true);
    },
  });
  bindTransport(io);

  io.use((socket, next) => {
    const ip = clientIp(socket.request, config);
    if ((connectionsByIp.get(ip) ?? 0) >= config.maxConnectionsPerIp) return next(connectError('RATE_LIMITED'));
    const auth = socketAuthSchema.safeParse(socket.handshake.auth);
    if (!auth.success) return next(connectError('INVALID_SESSION'));
    const binding = manager.sessions.resolve(auth.data.token);
    if (!binding) return next(connectError('INVALID_SESSION'));
    const room = manager.getRoom(binding.roomCode);
    if (!room || room.disposed) return next(connectError('ROOM_NOT_FOUND'));
    const participant = room.participant(binding.playerId);
    if (!participant) return next(connectError('INVALID_SESSION'));
    if (participant.takenOverByBot) return next(connectError('SEAT_TAKEN_OVER'));
    socket.data = { roomCode: binding.roomCode, playerId: binding.playerId, ip };
    next();
  });

  io.on('connection', (socket: CaboSocket) => {
    const { roomCode, playerId, ip } = socket.data;
    connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1);
    const bucket = new TokenBucket(40, 15);
    let strikes = 0;

    const room = () => manager.getRoom(roomCode);
    const limited = (ack: (r: CommandAck) => void): boolean => {
      if (bucket.take()) return false;
      ack({ ok: false, error: safeError('RATE_LIMITED') });
      if (++strikes > 200) socket.disconnect(true);
      return true;
    };

    void socket.join(seatChannel(roomCode, playerId));
    room()?.attach(playerId, socket.id);

    socket.on(CLIENT_EVENTS.sync, (_payload, ack) => {
      if (typeof ack !== 'function') return;
      if (limited(ack)) return;
      const r = room();
      if (!r) return ack({ ok: false, error: safeError('ROOM_NOT_FOUND') });
      r.sendSnapshot(playerId);
      ack({ ok: true, version: r.version });
    });

    socket.on(CLIENT_EVENTS.command, (payload, ack) => {
      if (typeof ack !== 'function') return;
      if (limited(ack)) return;
      const parsed = commandEnvelopeSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, error: safeError('INVALID_PAYLOAD') });
      const r = room();
      if (!r) return ack({ ok: false, error: safeError('ROOM_NOT_FOUND') });
      try {
        ack(r.handleCommand(playerId, parsed.data));
      } catch (err) {
        logger.error({ room: roomCode, err: (err as Error)?.message }, 'socket command crashed');
        ack({ ok: false, error: safeError('INTERNAL_ERROR') });
      }
    });

    socket.on('disconnect', () => {
      const count = (connectionsByIp.get(ip) ?? 1) - 1;
      if (count <= 0) connectionsByIp.delete(ip);
      else connectionsByIp.set(ip, count);
      room()?.detach(playerId, socket.id);
    });
  });

  return io;
}
