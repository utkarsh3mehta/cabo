import type { BotRng } from '@cabo/bots';
import type { Rng } from '@cabo/game-engine';
import {
  normalizeDisplayName,
  normalizeRoomCode,
  type GameMode,
  type PlayerId,
  type SessionResponse,
} from '@cabo/shared';
import type { ServerConfig } from './config.js';
import { Room, RoomError, type Logger, type RoomTransport } from './room.js';
import { SessionStore, cryptoRng, generatePlayerId, generateRoomCode } from './security.js';

export interface RoomManagerDeps {
  config: ServerConfig;
  logger: Logger;
  transport: RoomTransport;
  /** Randomness for dealing; defaults to crypto. Tests may inject a seeded source. */
  gameRng?: Rng;
  botRng?: BotRng;
  now?: () => number;
}

export interface CreateRoomInput {
  name: string;
  mode: GameMode;
  allowBots: boolean;
  botCount?: number | undefined;
}

export class RoomManager {
  readonly sessions = new SessionStore();
  private readonly rooms = new Map<string, Room>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: RoomManagerDeps) {
    this.now = deps.now ?? Date.now;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  start(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), this.deps.config.sweepIntervalMs);
    this.sweepTimer.unref?.();
  }

  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    for (const code of [...this.rooms.keys()]) this.deleteRoom(code, 'shutdown');
  }

  private newRoom(code: string, input: CreateRoomInput, hostName: string): Room {
    const { config, logger, transport } = this.deps;
    return new Room(code, { mode: input.mode, allowBots: input.allowBots }, hostName, {
      graceMs: config.reconnectGraceMs,
      botDelayMinMs: config.botDelayMinMs,
      botDelayMaxMs: config.botDelayMaxMs,
      gameRng: this.deps.gameRng ?? cryptoRng,
      botRng: this.deps.botRng ?? cryptoRng,
      transport,
      sessions: this.sessions,
      logger,
      now: this.now,
      generatePlayerId,
      onEmpty: (c) => this.deleteRoom(c, 'empty'),
    });
  }

  createRoom(input: CreateRoomInput): SessionResponse {
    if (this.rooms.size >= this.deps.config.maxRooms) throw new RoomError('SERVER_FULL');
    const name = normalizeDisplayName(input.name);
    if (!name.ok) throw new RoomError('INVALID_NAME');
    let code = generateRoomCode();
    for (let attempt = 0; this.rooms.has(code); attempt++) {
      if (attempt > 20) throw new RoomError('SERVER_FULL');
      code = generateRoomCode();
    }
    const solo = input.botCount !== undefined;
    const room = this.newRoom(code, { ...input, allowBots: solo ? true : input.allowBots }, name.name);
    if (solo) room.seatBots(input.botCount ?? 1);
    this.rooms.set(code, room);
    const host = room.participants[0] as { id: PlayerId };
    this.deps.logger.info({ room: code, solo, bots: input.botCount ?? 0 }, 'room created');
    return { roomCode: code, playerId: host.id, token: this.sessions.issue(code, host.id) };
  }

  joinRoom(rawCode: string, rawName: string): SessionResponse {
    const code = normalizeRoomCode(rawCode);
    if (!code) throw new RoomError('INVALID_ROOM_CODE');
    const room = this.rooms.get(code);
    if (!room) throw new RoomError('ROOM_NOT_FOUND');
    const participant = room.addHuman(rawName);
    return { roomCode: code, playerId: participant.id, token: this.sessions.issue(code, participant.id) };
  }

  getRoom(rawCode: string): Room | undefined {
    const code = normalizeRoomCode(rawCode);
    return code ? this.rooms.get(code) : undefined;
  }

  /** Resolves a session token to its room and seat, if both still exist. */
  resolveSession(token: string): { room: Room; playerId: PlayerId } | null {
    const binding = this.sessions.resolve(token);
    if (!binding) return null;
    const room = this.rooms.get(binding.roomCode);
    if (!room || room.disposed || !room.participant(binding.playerId)) return null;
    return { room, playerId: binding.playerId };
  }

  deleteRoom(code: string, reason: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    this.rooms.delete(code);
    room.dispose('roomClosed');
    this.deps.logger.info({ room: code, reason }, 'room closed');
  }

  /** Removes rooms per the TTL policy (ARCHITECTURE.md §5.6). */
  sweep(): void {
    const now = this.now();
    const { roomIdleTtlMs, finishedRoomTtlMs, roomMaxAgeMs } = this.deps.config;
    for (const [code, room] of this.rooms) {
      let reason: string | null = null;
      if (now - room.createdAt >= roomMaxAgeMs) reason = 'max-age';
      else if (room.phase === 'finished' && room.finishedAt !== null && now - room.finishedAt >= finishedRoomTtlMs) reason = 'finished-ttl';
      else if (room.connectedHumanCount() === 0 && now - room.lastHumanActivityAt >= roomIdleTtlMs) reason = 'idle';
      if (reason) this.deleteRoom(code, reason);
    }
  }
}
